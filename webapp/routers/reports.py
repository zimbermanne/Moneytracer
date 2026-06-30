from datetime import datetime, date
from collections import defaultdict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import Sale, Purchase, Expense, Debtor, Creditor, InventoryItem, User, LedgerStatus
from schemas import DebtorCreate, CreditorCreate, LedgerOut
from auth import get_current_user
from activity import log_activity

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/financial-summary")
def financial_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sales = db.query(Sale).all()
    expenses = db.query(Expense).all()
    revenue = sum(s.total for s in sales)
    # COGS approximation: quantity sold * cost_price of the linked item
    cogs = 0.0
    for s in sales:
        if s.item and s.item.cost_price:
            cogs += s.item.cost_price * s.quantity
    total_expenses = sum(e.amount for e in expenses)
    gross_profit = revenue - cogs
    net_profit = gross_profit - total_expenses
    return {
        "revenue": round(revenue, 2),
        "cogs": round(cogs, 2),
        "gross_profit": round(gross_profit, 2),
        "expenses": round(total_expenses, 2),
        "net_profit": round(net_profit, 2),
    }


@router.get("/profit-loss")
def profit_loss(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sales = db.query(Sale).all()
    expenses = db.query(Expense).all()

    revenue_by_item = defaultdict(float)
    for s in sales:
        revenue_by_item[s.item_name] += s.total

    expense_by_category = defaultdict(float)
    for e in expenses:
        expense_by_category[e.category] += e.amount

    total_revenue = sum(revenue_by_item.values())
    total_expenses = sum(expense_by_category.values())

    return {
        "revenue_by_item": {k: round(v, 2) for k, v in revenue_by_item.items()},
        "total_revenue": round(total_revenue, 2),
        "expense_by_category": {k: round(v, 2) for k, v in expense_by_category.items()},
        "total_expenses": round(total_expenses, 2),
        "net_profit": round(total_revenue - total_expenses, 2),
    }


@router.get("/debtors")
def debtors_report(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    debtors = db.query(Debtor).all()
    total_owed = sum(d.total_owed - d.amount_paid for d in debtors)
    by_status = defaultdict(int)
    for d in debtors:
        by_status[d.status.value] += 1
    return {
        "total_outstanding": round(total_owed, 2),
        "count": len(debtors),
        "by_status": dict(by_status),
    }


@router.get("/creditors")
def creditors_report(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    creditors = db.query(Creditor).all()
    total_owed = sum(c.total_owed - c.amount_paid for c in creditors)
    by_status = defaultdict(int)
    for c in creditors:
        by_status[c.status.value] += 1
    return {
        "total_outstanding": round(total_owed, 2),
        "count": len(creditors),
        "by_status": dict(by_status),
    }


@router.get("/inventory-valuation")
def inventory_valuation(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = db.query(InventoryItem).all()
    by_category = defaultdict(float)
    for i in items:
        by_category[i.category] += i.quantity * i.cost_price
    total_value = sum(by_category.values())
    return {
        "total_value": round(total_value, 2),
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
    }


@router.get("/daily-summary")
def daily_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = datetime.combine(today, datetime.max.time())
    sales_today = db.query(Sale).filter(Sale.created_at >= start, Sale.created_at <= end).all()

    items_sold = sum(s.quantity for s in sales_today)
    earnings = sum(s.total for s in sales_today)

    top_product = None
    if sales_today:
        totals = defaultdict(float)
        for s in sales_today:
            totals[s.item_name] += s.total
        top_product = max(totals, key=totals.get)

    low_stock_count = db.query(InventoryItem).filter(
        InventoryItem.quantity <= InventoryItem.reorder_point
    ).count()

    return {
        "date": str(today),
        "items_sold": items_sold,
        "earnings": round(earnings, 2),
        "top_product": top_product,
        "low_stock_count": low_stock_count,
        "transactions": len(sales_today),
    }


@router.post("/add-debtor", response_model=LedgerOut)
def add_debtor(payload: DebtorCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    debtor = Debtor(**payload.model_dump())
    db.add(debtor)
    db.commit()
    db.refresh(debtor)
    log_activity(db, current_user.username, "debtor_add", f"Added debtor {debtor.name}")
    return debtor


@router.post("/add-creditor", response_model=LedgerOut)
def add_creditor(payload: CreditorCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    creditor = Creditor(**payload.model_dump())
    db.add(creditor)
    db.commit()
    db.refresh(creditor)
    log_activity(db, current_user.username, "creditor_add", f"Added creditor {creditor.name}")
    return creditor
