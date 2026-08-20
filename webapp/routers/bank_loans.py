"""Bank loan tracking — a business borrowing FROM a bank/lender, with either
simple or reducing-balance interest. Distinct from GroupLoan (routers/community.py),
which is a Vikoba member borrowing from the group's own pooled fund.

Every disbursement and payment posts to the double-entry ledger (see
ledger.post_loan_disbursement_entry / post_loan_payment_entry) — this
follows the same "ledger-first" principle as sales/purchases/expenses:
a loan is real money moving, and reports.py's trial balance should reflect
it without a separate reconciliation step.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import BankLoan, BankLoanPayment, User, RoleEnum, LoanInterestType, LoanStatus
from schemas import (
    BankLoanCreate, BankLoanUpdate, BankLoanOut,
    BankLoanPaymentCreate, BankLoanPaymentOut, LoanRoadmapEntry,
)
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import post_loan_disbursement_entry, post_loan_payment_entry, FiscalPeriodLockedError

router = APIRouter(prefix="/api/bank-loans", tags=["bank-loans"])


def get_account_filter(current_user: User):
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _monthly_rate(loan: BankLoan) -> float:
    return (loan.annual_rate / 100) / 12


def _current_balance(loan: BankLoan) -> float:
    """Outstanding principal right now — original principal minus every
    principal_portion paid off so far. Interest already paid doesn't
    reduce this; only principal repayment does."""
    paid_principal = sum(p.principal_portion for p in loan.payments)
    return round(loan.principal - paid_principal, 2)


def _split_payment(loan: BankLoan, amount: float, current_balance: float):
    """The two formulas from the spec:
    - simple: interest is fixed each period, computed on the ORIGINAL
      principal, never on the shrinking balance.
    - reducing_balance: interest is computed on whatever's still owed
      right now, so it shrinks as the balance shrinks.
    Either way, whatever isn't interest is principal — that's what
    actually pays down the balance."""
    if loan.interest_type == LoanInterestType.simple:
        interest = round(loan.principal * _monthly_rate(loan), 2)
    else:
        interest = round(current_balance * _monthly_rate(loan), 2)
    principal_portion = round(amount - interest, 2)
    new_balance = round(current_balance - principal_portion, 2)
    return interest, principal_portion, new_balance


@router.get("/", response_model=List[BankLoanOut])
def list_loans(status: Optional[LoanStatus] = None, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    if status is not None:
        q = q.filter(BankLoan.status == status)
    return q.order_by(BankLoan.created_at.desc()).all()


@router.get("/{loan_id}", response_model=BankLoanOut)
def get_loan(loan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.post("/", response_model=BankLoanOut)
def create_loan(payload: BankLoanCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create loans")
    if payload.principal <= 0:
        raise HTTPException(status_code=400, detail="Principal must be positive")
    if not (1 <= payload.due_day_of_month <= 28):
        raise HTTPException(status_code=400, detail="due_day_of_month must be between 1 and 28")

    loan = BankLoan(
        account_id=account_id,
        lender_name=payload.lender_name,
        principal=payload.principal,
        interest_type=payload.interest_type,
        annual_rate=payload.annual_rate,
        start_date=payload.start_date,
        due_day_of_month=payload.due_day_of_month,
        term_months=payload.term_months,
        grace_period_days=payload.grace_period_days,
        notes=payload.notes or "",
        created_by=current_user.username,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)

    try:
        post_loan_disbursement_entry(db, account_id, loan, created_by=current_user.username)
    except (ValueError, FiscalPeriodLockedError) as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    log_activity_for_user(db, current_user, "loan_create", f"Loan from {loan.lender_name}: {loan.principal}")
    return loan


@router.put("/{loan_id}", response_model=BankLoanOut)
def update_loan(loan_id: int, payload: BankLoanUpdate, db: Session = Depends(get_db),
                 current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(loan, field, value)
    db.commit()
    db.refresh(loan)
    log_activity_for_user(db, current_user, "loan_update", f"Updated loan {loan_id}")
    return loan


@router.delete("/{loan_id}")
def delete_loan(loan_id: int, db: Session = Depends(get_db),
                 current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.payments:
        raise HTTPException(
            status_code=400,
            detail="This loan has recorded payments and can't be deleted — set its status to "
                   "'closed' or 'defaulted' instead, to keep the payment history and ledger entries intact.",
        )
    db.delete(loan)
    db.commit()
    log_activity_for_user(db, current_user, "loan_delete", f"Deleted loan {loan_id}")
    return {"detail": "Loan deleted"}


@router.post("/{loan_id}/payments", response_model=BankLoanPaymentOut)
def log_payment(loan_id: int, payload: BankLoanPaymentCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != LoanStatus.active:
        raise HTTPException(status_code=400, detail=f"Loan is {loan.status.value}, not active")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be positive")

    current_balance = _current_balance(loan)
    if current_balance <= 0:
        raise HTTPException(status_code=400, detail="This loan is already fully repaid")

    interest, principal_portion, new_balance = _split_payment(loan, payload.amount, current_balance)
    if principal_portion < 0:
        raise HTTPException(
            status_code=400,
            detail=f"This payment ({payload.amount}) doesn't even cover this period's interest "
                   f"({interest}) — it would increase the balance rather than pay it down.",
        )

    payment = BankLoanPayment(
        loan_id=loan.id,
        amount=payload.amount,
        interest_portion=interest,
        principal_portion=principal_portion,
        balance_after=max(new_balance, 0),
        paid_at=payload.paid_at or datetime.utcnow(),
        created_by=current_user.username,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    try:
        post_loan_payment_entry(db, loan.account_id, loan, payment, created_by=current_user.username)
    except (ValueError, FiscalPeriodLockedError) as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    if new_balance <= 0:
        loan.status = LoanStatus.closed
        db.commit()

    log_activity_for_user(db, current_user, "loan_payment", f"Paid {payload.amount} on loan {loan_id}")
    return payment


@router.get("/{loan_id}/roadmap", response_model=List[LoanRoadmapEntry])
def loan_roadmap(
    loan_id: int,
    monthly_payment: Optional[float] = Query(None, description="Assumed fixed monthly payment. Defaults to an amortizing payment computed from term_months if set."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Projects the remaining payment schedule from TODAY's actual balance
    forward — not from the original principal — so it stays accurate for a
    pay-as-you-go loan with irregular past payments, not just a fresh one."""
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    balance = _current_balance(loan)
    if balance <= 0:
        return []

    r = _monthly_rate(loan)
    payment_amount = monthly_payment

    if payment_amount is None:
        if loan.term_months:
            months_elapsed = len(loan.payments)
            months_remaining = max(loan.term_months - months_elapsed, 1)
            if loan.interest_type == LoanInterestType.simple:
                fixed_interest = loan.principal * r
                payment_amount = (balance + fixed_interest * months_remaining) / months_remaining
            else:
                if r == 0:
                    payment_amount = balance / months_remaining
                else:
                    payment_amount = balance * r * (1 + r) ** months_remaining / ((1 + r) ** months_remaining - 1)
        else:
            raise HTTPException(
                status_code=400,
                detail="This loan has no term_months set, so there's no way to infer a payment "
                       "amount — pass ?monthly_payment=<amount> to project a roadmap at that rate.",
            )

    schedule = []
    running_balance = balance
    last_date = loan.payments[-1].paid_at if loan.payments else loan.start_date
    period = len(loan.payments)
    safety_cap = 600  # 50 years — a runaway loop guard, not a real expectation
    while running_balance > 0.01 and period < safety_cap:
        period += 1
        if loan.interest_type == LoanInterestType.simple:
            interest = round(loan.principal * r, 2)
        else:
            interest = round(running_balance * r, 2)
        this_payment = min(payment_amount, running_balance + interest)
        principal_portion = round(this_payment - interest, 2)
        running_balance = round(running_balance - principal_portion, 2)
        next_date = _add_month(last_date, 1)
        last_date = next_date
        schedule.append(LoanRoadmapEntry(
            period=period, date=next_date, interest=interest,
            principal=principal_portion, payment=round(this_payment, 2),
            balance=max(running_balance, 0),
        ))

    return schedule


def _add_month(d: datetime, months: int) -> datetime:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, 28)  # keeps things simple across month lengths
    return d.replace(year=year, month=month, day=day)
