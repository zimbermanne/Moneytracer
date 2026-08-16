"""Accounts Receivable dashboard — modeled on the Coupler.io "Accounts
receivable dashboard for Xero" template the user asked us to mirror:
a KPI summary, unpaid-by-customer (top 10), AR aging buckets, paid-vs-unpaid,
and a 12-month paid trend, all filterable by customer and date range.

Unlike the customer Statement (customers.py), which nets Invoice + Debtor
ledger entries together, this uses Invoice as the single source of truth
for "what's owed" — status + paid_at is a cleaner AR definition than the
mixed ledger, and it's what a Xero-style AR dashboard actually reports on.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import Invoice, User, DocumentStatus
from auth import get_current_user
from routers.invoices import get_account_filter

router = APIRouter(prefix="/api/ar-dashboard", tags=["ar-dashboard"])


def _scoped(db: Session, current_user: User):
    q = db.query(Invoice)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        q = q.filter(Invoice.account_id == account_id)
    return q


def _apply_period(q, date_from: Optional[datetime], date_to: Optional[datetime]):
    # Filters on created_at, matching "Data is collected between these
    # dates" in the template — the window an invoice was raised in, not
    # when it was paid, so a still-unpaid invoice from the start of the
    # window stays visible throughout.
    if date_from:
        q = q.filter(Invoice.created_at >= date_from)
    if date_to:
        q = q.filter(Invoice.created_at <= date_to)
    return q


@router.get("/customers")
def list_customers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Distinct customer names for the filter dropdown."""
    rows = _scoped(db, current_user).with_entities(Invoice.customer_name).distinct().order_by(Invoice.customer_name).all()
    return [r[0] for r in rows if r[0]]


@router.get("")
def ar_dashboard(
    customer: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base = _scoped(db, current_user)
    if customer:
        base = base.filter(Invoice.customer_name == customer)
    base = _apply_period(base, date_from, date_to)

    invoices = base.all()
    now = datetime.utcnow()

    unpaid = [i for i in invoices if i.status != DocumentStatus.paid]
    paid = [i for i in invoices if i.status == DocumentStatus.paid]

    # ---- Summary ----------------------------------------------------
    total_unpaid = sum(i.total for i in unpaid)
    overdue = [i for i in unpaid if i.due_date and i.due_date < now]
    total_overdue = sum(i.total for i in overdue)
    total_paid = sum(i.total for i in paid)
    avg_days_overdue = (
        sum((now - i.due_date).days for i in overdue) / len(overdue) if overdue else 0
    )

    summary = {
        "total_unpaid": total_unpaid,
        "total_overdue": total_overdue,
        "unpaid_count": len(unpaid),
        "overdue_count": len(overdue),
        "total_paid": total_paid,
        "avg_days_overdue": round(avg_days_overdue, 1),
    }

    # ---- Unpaid invoices by customer (Top 10) ------------------------
    by_customer = {}
    for i in unpaid:
        by_customer[i.customer_name] = by_customer.get(i.customer_name, 0) + i.total
    unpaid_by_customer = sorted(
        ({"customer": k, "amount": v} for k, v in by_customer.items()),
        key=lambda r: r["amount"], reverse=True,
    )[:10]

    # ---- AR aging -----------------------------------------------------
    # Standard 4-bucket aging, matching the template: not yet due, then
    # 1-30 / 31-60 / 61-90 / 90+ days past due_date. Invoices without a
    # due_date are treated as "Current" (nothing to age against).
    buckets = {"Current": 0.0, "1-30 days": 0.0, "31-60 days": 0.0, "61-90 days": 0.0, "90+ days": 0.0}
    for i in unpaid:
        if not i.due_date or i.due_date >= now:
            buckets["Current"] += i.total
            continue
        days = (now - i.due_date).days
        if days <= 30:
            buckets["1-30 days"] += i.total
        elif days <= 60:
            buckets["31-60 days"] += i.total
        elif days <= 90:
            buckets["61-90 days"] += i.total
        else:
            buckets["90+ days"] += i.total
    aging = [{"bucket": k, "amount": v} for k, v in buckets.items()]

    # ---- Paid invoices by customer -------------------------------------
    paid_by_customer = {}
    for i in paid:
        paid_by_customer[i.customer_name] = paid_by_customer.get(i.customer_name, 0) + i.total
    paid_by_customer_list = sorted(
        ({"customer": k, "amount": v} for k, v in paid_by_customer.items()),
        key=lambda r: r["amount"], reverse=True,
    )[:10]

    # ---- Paid vs unpaid -------------------------------------------------
    paid_vs_unpaid = [
        {"status": "Paid", "amount": total_paid},
        {"status": "Unpaid", "amount": total_unpaid},
    ]

    # ---- Last 12 months paid trend --------------------------------------
    # Independent of the date_from/date_to filter above (a trend is more
    # useful showing a fixed rolling window), scoped only to customer.
    twelve_months_ago = (now.replace(day=1) - timedelta(days=365)).replace(day=1)
    trend_q = _scoped(db, current_user).filter(
        Invoice.status == DocumentStatus.paid,
        Invoice.paid_at.isnot(None),
        Invoice.paid_at >= twelve_months_ago,
    )
    if customer:
        trend_q = trend_q.filter(Invoice.customer_name == customer)
    trend_invoices = trend_q.all()

    months = []
    cursor = twelve_months_ago
    for _ in range(12):
        months.append(cursor.strftime("%Y-%m"))
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    trend_totals = {m: 0.0 for m in months}
    for i in trend_invoices:
        key = i.paid_at.strftime("%Y-%m")
        if key in trend_totals:
            trend_totals[key] += i.total
    paid_last_12_months = [{"month": m, "amount": trend_totals[m]} for m in months]

    return {
        "summary": summary,
        "unpaid_by_customer": unpaid_by_customer,
        "aging": aging,
        "paid_by_customer": paid_by_customer_list,
        "paid_vs_unpaid": paid_vs_unpaid,
        "paid_last_12_months": paid_last_12_months,
    }
