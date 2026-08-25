from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Expense, User, RoleEnum, PaymentMethod
from schemas import ExpenseCreate, ExpenseOut
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import (
    post_expense_entry, find_journal_entry_by_reference, reverse_journal_entry,
    FiscalPeriodLockedError, ensure_default_payment_methods,
)

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _resolve_payment_method(db: Session, account_id: int, payment_method_id: Optional[int]):
    """Look up + validate a Payment Method for this tenant, same pattern as
    routers/sales.py:_resolve_payment_method(). An expense can't be "paid"
    out of a credit-sale method (that account represents money owed TO the
    business, not a source of cash to spend) — that scenario is a Creditor
    (money the business owes a supplier), tracked separately."""
    if payment_method_id is None:
        return None
    ensure_default_payment_methods(db, account_id)
    method = (
        db.query(PaymentMethod)
        .filter(PaymentMethod.id == payment_method_id, PaymentMethod.account_id == account_id)
        .first()
    )
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    if method.is_credit:
        raise HTTPException(
            status_code=400,
            detail="Can't pay an expense from a credit-sale payment method. "
                   "If this is money owed to a supplier, record it under Creditors instead.",
        )
    return method


@router.post("/", response_model=ExpenseOut)
def record_expense(payload: ExpenseCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot record expenses")

    payment_method = _resolve_payment_method(db, account_id, payload.payment_method_id)

    expense = Expense(**payload.model_dump(), account_id=account_id)
    db.add(expense)
    db.commit()
    db.refresh(expense)
    try:
        post_expense_entry(db, account_id, expense, created_by=current_user.username)
    except ValueError as e:
        # Ledger posting failure shouldn't block the expense record itself,
        # but it must not fail silently — surface it in the activity log.
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))
    log_activity_for_user(db, current_user, "expense_record", f"Recorded expense {expense.amount} ({expense.category})")
    return expense


@router.get("/", response_model=List[ExpenseOut])
def list_expenses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Expense)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    return query.order_by(Expense.created_at.desc()).all()


@router.get("/stats/summary")
def expense_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Expense)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    expenses = query.all()
    by_category = {}
    for e in expenses:
        by_category[e.category] = by_category.get(e.category, 0) + e.amount
    return {
        "total_expenses": len(expenses),
        "total_amount": round(sum(e.amount for e in expenses), 2),
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
    }


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Expense).filter(Expense.id == expense_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    expense = query.first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Expense).filter(Expense.id == expense_id)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    expense = query.first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    original_entry = find_journal_entry_by_reference(db, expense.account_id, f"expense-{expense.id}")
    if original_entry is not None:
        try:
            reverse_journal_entry(db, expense.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Expense {expense_id} deleted")
        except FiscalPeriodLockedError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ValueError as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    db.delete(expense)
    db.commit()
    log_activity_for_user(db, current_user, "expense_delete", f"Deleted expense {expense_id}, ledger reversed")
    return {"detail": "Expense deleted and ledger entry reversed"}
