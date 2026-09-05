import io
import csv
from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import Expense, User, RoleEnum, PaymentMethod, ChartOfAccount, JournalLine, JournalEntry
from schemas import ExpenseCreate, ExpenseUpdate, ExpenseOut
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

    # Use explicitly provided expense_date or fall back to now
    expense_date = payload.expense_date or datetime.utcnow()

    expense = Expense(
        account_id=account_id,
        category=payload.category,
        description=payload.description,
        vendor_name=payload.vendor_name,
        amount=payload.amount,
        expense_date=expense_date,
        payment_method_id=payload.payment_method_id
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)

    try:
        post_expense_entry(db, account_id, expense, created_by=current_user.username)
    except ValueError as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    log_activity_for_user(db, current_user, "expense_record", f"Recorded expense {expense.amount} ({expense.category})")
    return expense


@router.get("/", response_model=List[ExpenseOut])
def list_expenses(
    start: Optional[date] = None,
    end: Optional[date] = None,
    category: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    account_id = get_account_filter(current_user)
    query = db.query(Expense)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)

    if start:
        query = query.filter(Expense.expense_date >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Expense.expense_date <= datetime.combine(end, datetime.max.time()))
    if category:
        query = query.filter(Expense.category == category)
    if q:
        query = query.filter(
            (Expense.description.ilike(f"%{q}%")) | (Expense.vendor_name.ilike(f"%{q}%"))
        )

    return query.order_by(Expense.expense_date.desc()).all()


@router.get("/export/csv")
def export_expenses_csv(
    start: Optional[date] = None,
    end: Optional[date] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    expenses = list_expenses(start, end, category, None, db, current_user)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Category", "Vendor", "Description", "Paid From", "Amount"])
    
    for e in expenses:
        writer.writerow([
            e.expense_date.strftime("%Y-%m-%d"),
            e.category,
            e.vendor_name,
            e.description,
            e.payment_method_name or "Cash",
            e.amount
        ])
    
    output.seek(0)
    filename = f"expenses_{datetime.now().strftime('%Y%m%d')}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return StreamingResponse(io.BytesIO(output.getvalue().encode()), media_type="text/csv", headers=headers)


@router.get("/stats/summary")
def expense_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        return {"total_expenses": 0, "total_amount": 0, "cogs": 0, "total_outgoings": 0, "by_category": {}}

    expenses = db.query(Expense).filter(Expense.account_id == account_id).all()
    by_category = {}
    total_op_expenses = 0.0
    for e in expenses:
        by_category[e.category] = by_category.get(e.category, 0) + e.amount
        total_op_expenses += e.amount

    cogs = (
        db.query(func.sum(JournalLine.debit))
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .join(ChartOfAccount, JournalLine.chart_account_id == ChartOfAccount.id)
        .filter(
            ChartOfAccount.code == "5000",
            ChartOfAccount.account_id == account_id,
            JournalEntry.is_voided == False,
        )
        .scalar()
    ) or 0.0

    return {
        "total_expenses": len(expenses),
        "total_amount": round(total_op_expenses, 2),
        "cogs": round(float(cogs), 2),
        "total_outgoings": round(total_op_expenses + float(cogs), 2),
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
    }


@router.get("/categories/list")
def list_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        return []
    rows = db.query(Expense.category).filter(Expense.account_id == account_id).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    query = db.query(Expense).filter(Expense.id == expense_id)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    expense = query.first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, payload: ExpenseUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Expense).filter(Expense.id == expense_id)
    if account_id is not None:
        query = query.filter(Expense.account_id == account_id)
    expense = query.first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    # 1. Reverse original ledger entry (if it exists)
    original_entry = find_journal_entry_by_reference(db, expense.account_id, f"expense-{expense.id}")
    if original_entry:
        try:
            reverse_journal_entry(db, expense.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Expense {expense_id} updated")
        except FiscalPeriodLockedError as e:
            raise HTTPException(status_code=400, detail=f"Cannot edit: original entry is in a locked period. {e}")

    # 2. Update model
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(expense, field, value)
    
    db.commit()
    db.refresh(expense)

    # 3. Post new ledger entry
    try:
        post_expense_entry(db, expense.account_id, expense, created_by=current_user.username)
    except FiscalPeriodLockedError as e:
        # If the new date is locked, we've already reversed the old one.
        # This is a bit awkward but strictly correct: you can't move an expense INTO a locked period.
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Cannot move expense to a locked period. {e}")
    except ValueError as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))

    log_activity_for_user(db, current_user, "expense_update", f"Updated expense {expense_id} ({expense.category})")
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
