import json
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import RecurringExpense, User, RoleEnum, Expense
from schemas import RecurringExpenseCreate, RecurringExpenseUpdate, RecurringExpenseOut
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import post_expense_entry

router = APIRouter(prefix="/api/recurring-expenses", tags=["recurring-expenses"])


def get_account_filter(current_user: User):
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


@router.get("/", response_model=List[RecurringExpenseOut])
def list_recurring_expenses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account_id = get_account_filter(current_user)
    query = db.query(RecurringExpense)
    if account_id is not None:
        query = query.filter(RecurringExpense.account_id == account_id)
    return query.order_by(RecurringExpense.next_generation.asc()).all()


@router.post("/", response_model=RecurringExpenseOut)
def create_recurring_expense(
    payload: RecurringExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create recurring expenses")

    # Set initial next_generation date
    next_gen = payload.start_date

    recurring = RecurringExpense(
        account_id=account_id,
        category=payload.category,
        description=payload.description,
        vendor_name=payload.vendor_name,
        amount=payload.amount,
        payment_method_id=payload.payment_method_id,
        frequency=payload.frequency,
        interval=payload.interval,
        day_of_month=payload.day_of_month,
        day_of_week=payload.day_of_week,
        start_date=payload.start_date,
        end_date=payload.end_date,
        next_generation=next_gen,
        created_by=current_user.username,
    )
    db.add(recurring)
    db.commit()
    db.refresh(recurring)
    log_activity_for_user(db, current_user, "recurring_expense_create", f"Created recurring expense: {payload.description}")
    return recurring


@router.put("/{recurring_id}", response_model=RecurringExpenseOut)
def update_recurring_expense(
    recurring_id: int,
    payload: RecurringExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    account_id = get_account_filter(current_user)
    query = db.query(RecurringExpense).filter(RecurringExpense.id == recurring_id)
    if account_id is not None:
        query = query.filter(RecurringExpense.account_id == account_id)
    recurring = query.first()
    if not recurring:
        raise HTTPException(status_code=404, detail="Recurring expense not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(recurring, field, value)

    db.commit()
    db.refresh(recurring)
    log_activity_for_user(db, current_user, "recurring_expense_update", f"Updated recurring expense: {recurring.description}")
    return recurring


@router.delete("/{recurring_id}")
def delete_recurring_expense(
    recurring_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    account_id = get_account_filter(current_user)
    query = db.query(RecurringExpense).filter(RecurringExpense.id == recurring_id)
    if account_id is not None:
        query = query.filter(RecurringExpense.account_id == account_id)
    recurring = query.first()
    if not recurring:
        raise HTTPException(status_code=404, detail="Recurring expense not found")

    db.delete(recurring)
    db.commit()
    log_activity_for_user(db, current_user, "recurring_expense_delete", f"Deleted recurring expense: {recurring.description}")
    return {"message": "Recurring expense deleted"}


def _generate_expense_from_recurring(db: Session, rec: RecurringExpense, generation_date: datetime):
    """Internal: generates a single Expense instance from a recurring template."""
    expense = Expense(
        account_id=rec.account_id,
        category=rec.category,
        description=f"{rec.description} (Recurring)",
        vendor_name=rec.vendor_name,
        amount=rec.amount,
        expense_date=generation_date,
        payment_method_id=rec.payment_method_id
    )
    db.add(expense)
    db.flush()
    
    # Post to ledger
    try:
        post_expense_entry(db, rec.account_id, expense, created_by="system")
    except Exception as e:
        # Log error but don't fail the transaction
        from activity import log_activity
        log_activity(db, username="system", action="CRITICAL: recurring_expense_ledger_failed",
                     details=f"rec_id={rec.id} {e}", account_id=rec.account_id)

    return expense


@router.post("/{recurring_id}/generate")
def force_generate_expense(
    recurring_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Manually trigger generation of one expense from a recurring template."""
    account_id = get_account_filter(current_user)
    query = db.query(RecurringExpense).filter(RecurringExpense.id == recurring_id)
    if account_id is not None:
        query = query.filter(RecurringExpense.account_id == account_id)
    recurring = query.first()
    if not recurring:
        raise HTTPException(status_code=404, detail="Recurring expense not found")

    now = datetime.utcnow()
    expense = _generate_expense_from_recurring(db, recurring, now)
    
    recurring.last_generated = now
    # We don't advance next_generation here, as this is a manual override/one-off.
    
    db.commit()
    log_activity_for_user(db, current_user, "recurring_expense_force_generate", f"Manually generated expense from template: {recurring.description}")
    return {"message": "Expense generated", "expense_id": expense.id}
