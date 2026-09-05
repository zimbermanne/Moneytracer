"""Bank loan tracking — a business borrowing FROM a bank/lender, with either
simple or reducing-balance interest. Distinct from GroupLoan (routers/community.py),
which is a Vikoba member borrowing from the group's own pooled fund.

Every disbursement and payment posts to the double-entry ledger (see
ledger.post_loan_disbursement_entry / post_loan_payment_entry) — this
follows the same "ledger-first" principle as sales/purchases/expenses:
a loan is real money moving, and reports.py's trial balance should reflect
it without a separate reconciliation step.
"""
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import BankLoan, BankLoanPayment, User, RoleEnum, LoanInterestType, LoanStatus
from schemas import (
    BankLoanCreate, BankLoanUpdate, BankLoanOut,
    BankLoanPaymentCreate, BankLoanPaymentUpdate, BankLoanPaymentOut, LoanRoadmapEntry,
)
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import (
    post_loan_disbursement_entry, post_loan_payment_entry, FiscalPeriodLockedError,
    find_journal_entry_by_reference, reverse_journal_entry,
)

router = APIRouter(prefix="/api/bank-loans", tags=["bank-loans"])


def get_account_filter(current_user: User):
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _monthly_rate(loan: BankLoan) -> float:
    return (loan.annual_rate / 100) / 12


def _calculate_loan_state(loan: BankLoan, at_date: Optional[datetime.datetime] = None):
    now = at_date or datetime.datetime.utcnow()
    start_date = loan.start_date
    daily_rate = (loan.annual_rate / 100) / 365

    # 1. Outstanding Principal
    paid_principal = sum(p.principal_portion for p in loan.payments)
    outstanding_principal = round(max(0.0, loan.principal - paid_principal), 2)

    # 2. Accrued Interest (unpaid)
    if now < start_date:
        accrued_interest = 0.0
    elif loan.interest_type == LoanInterestType.simple:
        total_days = (now - start_date).days
        total_interest_accrued = loan.principal * daily_rate * total_days
        total_interest_paid = sum(p.interest_portion for p in loan.payments)
        accrued_interest = round(max(0.0, total_interest_accrued - total_interest_paid), 2)
    else:
        # Reducing Balance
        total_interest_accrued = 0.0
        running_principal = loan.principal
        last_date = start_date
        for p in loan.payments:
            p_date = p.paid_at
            if p_date > now: break
            days = (p_date - last_date).days
            total_interest_accrued += running_principal * daily_rate * days
            last_date = p_date
            running_principal = max(0.0, running_principal - p.principal_portion)

        if now > last_date:
            days = (now - last_date).days
            total_interest_accrued += running_principal * daily_rate * days

        total_interest_paid = sum(p.interest_portion for p in loan.payments)
        accrued_interest = round(max(0.0, total_interest_accrued - total_interest_paid), 2)

    total_balance = round(outstanding_principal + accrued_interest, 2)

    days_overdue = 0
    if (outstanding_principal > 0 or accrued_interest > 0) and now > start_date:
        due_day = loan.due_day_of_month
        try:
            this_month_due = now.replace(day=due_day, hour=0, minute=0, second=0, microsecond=0)
            if now < this_month_due:
                if now.month == 1:
                    last_due = now.replace(year=now.year - 1, month=12, day=due_day)
                else:
                    last_due = now.replace(month=now.month - 1, day=due_day)
            else:
                last_due = this_month_due
            
            if last_due > start_date:
                effective_due = last_due + datetime.timedelta(days=loan.grace_period_days or 0)
                if now > effective_due:
                    days_overdue = (now - effective_due).days
        except ValueError:
            pass

    return {
        "outstanding_principal": outstanding_principal,
        "accrued_interest": accrued_interest,
        "total_balance": total_balance,
        "days_overdue": days_overdue
    }


@router.get("/", response_model=List[BankLoanOut])
def list_loans(status: Optional[LoanStatus] = None, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    if status is not None:
        q = q.filter(BankLoan.status == status)

    loans = q.order_by(BankLoan.created_at.desc()).all()
    for l in loans:
        state = _calculate_loan_state(l)
        l.outstanding_principal = state["outstanding_principal"]
        l.accrued_interest = state["accrued_interest"]
        l.total_balance = state["total_balance"]
        l.days_overdue = state["days_overdue"]
    return loans


@router.get("/{loan_id}", response_model=BankLoanOut)
def get_loan(loan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    state = _calculate_loan_state(loan)
    loan.outstanding_principal = state["outstanding_principal"]
    loan.accrued_interest = state["accrued_interest"]
    loan.total_balance = state["total_balance"]
    loan.days_overdue = state["days_overdue"]
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

    # If critical fields change, we need to reverse and re-post disbursement
    critical_fields = {"principal", "start_date"}
    data = payload.model_dump(exclude_unset=True)
    needs_repost = any(f in data for f in critical_fields)

    if needs_repost:
        original_entry = find_journal_entry_by_reference(db, loan.account_id, f"loan-disbursement-{loan.id}")
        if original_entry:
            try:
                reverse_journal_entry(db, loan.account_id, original_entry, created_by=current_user.username,
                                       reason=f"Loan {loan_id} terms updated")
            except Exception as e:
                log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    for field, value in data.items():
        setattr(loan, field, value)
    
    db.commit()
    db.refresh(loan)

    if needs_repost:
        try:
            post_loan_disbursement_entry(db, account_id, loan, created_by=current_user.username)
        except Exception as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

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

    original_entry = find_journal_entry_by_reference(db, loan.account_id, f"loan-disbursement-{loan.id}")
    if original_entry:
        try:
            reverse_journal_entry(db, loan.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Loan {loan_id} deleted")
        except FiscalPeriodLockedError as e:
            raise HTTPException(status_code=400, detail=f"Cannot delete: disbursement entry is in a locked period. {e}")
        except ValueError as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    db.delete(loan)
    db.commit()
    log_activity_for_user(db, current_user, "loan_delete", f"Deleted loan {loan_id} and reversed ledger entries")
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

    payment_date = payload.paid_at or datetime.datetime.utcnow()
    state = _calculate_loan_state(loan, at_date=payment_date)
    current_balance = state["outstanding_principal"]
    accrued_interest = state["accrued_interest"]

    if current_balance <= 0 and accrued_interest <= 0:
        raise HTTPException(status_code=400, detail="This loan is already fully repaid")

    interest_portion = min(payload.amount, accrued_interest)
    principal_portion = round(payload.amount - interest_portion, 2)
    new_principal_balance = round(current_balance - principal_portion, 2)

    payment = BankLoanPayment(
        loan_id=loan.id,
        amount=payload.amount,
        interest_portion=interest_portion,
        principal_portion=principal_portion,
        balance_after=max(new_principal_balance, 0),
        payment_method_id=payload.payment_method_id,
        paid_at=payment_date,
        created_by=current_user.username,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    try:
        post_loan_payment_entry(db, loan.account_id, loan, payment, created_by=current_user.username)
    except (ValueError, FiscalPeriodLockedError) as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    if new_principal_balance <= 0:
        loan.status = LoanStatus.closed
        db.commit()

    log_activity_for_user(db, current_user, "loan_payment", f"Paid {payload.amount} on loan {loan_id}")
    return payment


@router.put("/payments/{payment_id}", response_model=BankLoanPaymentOut)
def update_payment(payment_id: int, payload: BankLoanPaymentUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    payment = db.query(BankLoanPayment).filter(BankLoanPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    loan = payment.loan
    account_id = get_account_filter(current_user)
    if loan.account_id != account_id and account_id is not None:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Reverse old ledger entry
    original_entry = find_journal_entry_by_reference(db, loan.account_id, f"loan-payment-{payment.id}")
    if original_entry:
        try:
            reverse_journal_entry(db, loan.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Payment {payment_id} updated")
        except Exception as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    # Update payment record
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(payment, field, value)
    
    db.commit()
    db.refresh(payment)

    # Post new ledger entry
    try:
        post_loan_payment_entry(db, loan.account_id, loan, payment, created_by=current_user.username)
    except Exception as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    log_activity_for_user(db, current_user, "loan_payment_update", f"Updated payment {payment_id} on loan {loan.id}")
    return payment


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    payment = db.query(BankLoanPayment).filter(BankLoanPayment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    loan = payment.loan
    account_id = get_account_filter(current_user)
    if loan.account_id != account_id and account_id is not None:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Reverse ledger entry
    original_entry = find_journal_entry_by_reference(db, loan.account_id, f"loan-payment-{payment.id}")
    if original_entry:
        try:
            reverse_journal_entry(db, loan.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Payment {payment_id} deleted")
        except Exception as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    db.delete(payment)
    db.commit()
    log_activity_for_user(db, current_user, "loan_payment_delete", f"Deleted payment {payment_id} on loan {loan.id}")
    return {"detail": "Payment deleted and ledger reversed"}


@router.get("/{loan_id}/roadmap", response_model=List[LoanRoadmapEntry])
def loan_roadmap(
    loan_id: int,
    monthly_payment: Optional[float] = Query(None, description="Assumed fixed monthly payment. Defaults to an amortizing payment computed from term_months if set."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account_id = get_account_filter(current_user)
    q = db.query(BankLoan).filter(BankLoan.id == loan_id)
    if account_id is not None:
        q = q.filter(BankLoan.account_id == account_id)
    loan = q.first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    state = _calculate_loan_state(loan)
    balance = state["outstanding_principal"]
    if balance <= 0 and state["accrued_interest"] <= 0:
        return []

    r = _monthly_rate(loan)
    payment_amount = monthly_payment

    if payment_amount is None:
        if loan.term_months:
            now = datetime.datetime.utcnow()
            months_elapsed = (now.year - loan.start_date.year) * 12 + now.month - loan.start_date.month
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
            payment_amount = (balance * (1 + r * 12)) / 12

    schedule = []
    running_balance = balance
    last_date = datetime.datetime.utcnow()
    period = len(loan.payments)
    safety_cap = 600
    while running_balance > 0.01 and len(schedule) < safety_cap:
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


def _add_month(d: datetime.datetime, months: int) -> datetime.datetime:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, 28)
    return d.replace(year=year, month=month, day=day)
