from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Expense, User
from schemas import ExpenseCreate, ExpenseOut
from auth import get_current_user, require_manager_up
from activity import log_activity

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


@router.post("/", response_model=ExpenseOut)
def record_expense(payload: ExpenseCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    expense = Expense(**payload.model_dump())
    db.add(expense)
    db.commit()
    db.refresh(expense)
    log_activity(db, current_user.username, "expense_record", f"Recorded expense {expense.amount} ({expense.category})")
    return expense


@router.get("/", response_model=List[ExpenseOut])
def list_expenses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Expense).order_by(Expense.created_at.desc()).all()


@router.get("/stats/summary")
def expense_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    expenses = db.query(Expense).all()
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
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    log_activity(db, current_user.username, "expense_delete", f"Deleted expense {expense_id}")
    return {"detail": "Expense deleted"}
