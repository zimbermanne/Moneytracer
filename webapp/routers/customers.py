from collections import defaultdict
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Sale, Invoice, Quotation, Debtor, Customer, User, RoleEnum
from auth import get_current_user
from schemas import (
    CustomerCreate, CustomerUpdate, CustomerOut,
    CustomerProfile, CustomerMonthlyIncome,
    CustomerStatement, CustomerStatementEntry,
    InvoiceOut, QuotationOut, DebtorOut,
)
from activity import log_activity_for_user

router = APIRouter(prefix="/api/customers", tags=["customers"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _scoped_customer(db: Session, customer_id: int, account_id):
    q = db.query(Customer).filter(Customer.id == customer_id)
    if account_id is not None:
        q = q.filter(Customer.account_id == account_id)
    customer = q.first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def _related(db: Session, model, name_field, customer_name: str, account_id):
    q = db.query(model).filter(name_field == customer_name)
    if account_id is not None:
        q = q.filter(model.account_id == account_id)
    return q.all()


# ---------- Customer directory (a real record: name, phone, address, TIN) ----------

@router.get("/", response_model=List[CustomerOut])
def list_customers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(Customer)
    if account_id is not None:
        q = q.filter(Customer.account_id == account_id)
    customers = q.order_by(Customer.name).all()

    result = []
    for c in customers:
        sales = _related(db, Sale, Sale.customer_name, c.name, account_id)
        debts = _related(db, Debtor, Debtor.name, c.name, account_id)
        invoices = _related(db, Invoice, Invoice.customer_name, c.name, account_id)
        all_dates = [s.created_at for s in sales] + [d.created_at for d in debts] + [i.created_at for i in invoices]
        result.append(CustomerOut(
            id=c.id, name=c.name, phone=c.phone, address=c.address,
            tin_number=c.tin_number, notes=c.notes, created_at=c.created_at,
            total_purchased=round(sum(s.total for s in sales), 2),
            total_owed=round(sum(d.total_owed - d.amount_paid for d in debts), 2),
            last_activity=max(all_dates) if all_dates else None,
        ))
    return result


@router.post("/", response_model=CustomerOut)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Superadmin cannot create a customer without a target account")

    existing = db.query(Customer).filter(
        Customer.account_id == account_id, Customer.name == payload.name.strip()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A customer with this name already exists")

    customer = Customer(account_id=account_id, name=payload.name.strip(), phone=payload.phone or "",
                        address=payload.address or "", tin_number=payload.tin_number or "",
                        notes=payload.notes or "")
    db.add(customer)
    db.commit()
    db.refresh(customer)
    log_activity_for_user(db, current_user, "create_customer", f"Added customer {customer.name}")
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone,
                       address=customer.address, tin_number=customer.tin_number,
                       notes=customer.notes, created_at=customer.created_at)


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    log_activity_for_user(db, current_user, "update_customer", f"Updated customer {customer.name}")
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone,
                       address=customer.address, tin_number=customer.tin_number,
                       notes=customer.notes, created_at=customer.created_at)


@router.delete("/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)
    name = customer.name
    db.delete(customer)
    db.commit()
    log_activity_for_user(db, current_user, "delete_customer", f"Deleted customer {name}")
    return {"detail": f"Customer {name} deleted"}


# ---------- Customer profile: purchases, invoices, quotations, debts, income chart ----------
# Matches the reference screenshots: contact info, "Receivables", an income
# chart described as "displayed in the organization's base currency",
# and the Invoices/Quotes/Payments breakdown under a Transactions view.

@router.get("/{customer_id}/profile", response_model=CustomerProfile)
def customer_profile(customer_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)

    invoices = sorted(_related(db, Invoice, Invoice.customer_name, customer.name, account_id),
                      key=lambda i: i.created_at, reverse=True)
    quotations = sorted(_related(db, Quotation, Quotation.customer_name, customer.name, account_id),
                        key=lambda q: q.created_at, reverse=True)
    debts = sorted(_related(db, Debtor, Debtor.name, customer.name, account_id),
                   key=lambda d: d.created_at, reverse=True)
    sales = _related(db, Sale, Sale.customer_name, customer.name, account_id)

    outstanding_receivables = round(sum(d.total_owed - d.amount_paid for d in debts), 2)

    # Last 6 months, from Sale totals + paid Invoice totals.
    now = datetime.utcnow()
    months = []
    cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(6):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months = list(reversed(months))

    monthly_totals = defaultdict(float)
    for s in sales:
        monthly_totals[s.created_at.strftime("%Y-%m")] += s.total
    for i in invoices:
        if i.status == "paid":
            monthly_totals[i.created_at.strftime("%Y-%m")] += i.total

    income_last_6_months = [
        CustomerMonthlyIncome(month=m.strftime("%Y-%m"), total=round(monthly_totals.get(m.strftime("%Y-%m"), 0), 2))
        for m in months
    ]

    return CustomerProfile(
        customer_name=customer.name,
        phone=customer.phone,
        address=customer.address,
        tin=customer.tin_number,
        vrn="",
        outstanding_receivables=outstanding_receivables,
        income_last_6_months=income_last_6_months,
        total_income_last_6_months=round(sum(p.total for p in income_last_6_months), 2),
        invoices=[InvoiceOut.model_validate(i) for i in invoices],
        quotations=[QuotationOut.model_validate(q) for q in quotations],
        debts=[DebtorOut.model_validate(d) for d in debts],
    )


# ---------- Customer statement: a running-balance ledger, matching the
# "Statement of Accounts" reference screenshot (opening balance, invoiced
# amount, amount received, balance due). ----------

@router.get("/{customer_id}/statement", response_model=CustomerStatement)
def customer_statement(customer_id: int, date_from: datetime = None, date_to: datetime = None,
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)

    now = datetime.utcnow()
    if date_to is None:
        date_to = now
    if date_from is None:
        date_from = date_to.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    invoices = _related(db, Invoice, Invoice.customer_name, customer.name, account_id)
    debts = _related(db, Debtor, Debtor.name, customer.name, account_id)

    # Opening balance: everything before the period start.
    opening_balance = 0.0
    for i in invoices:
        if i.created_at < date_from:
            opening_balance += i.total
    for d in debts:
        if d.created_at < date_from:
            opening_balance += d.total_owed
            opening_balance -= d.amount_paid

    # In-period events.
    events = []
    for i in invoices:
        if date_from <= i.created_at <= date_to:
            events.append((i.created_at, f"Invoice {i.invoice_no}", i.invoice_no, i.total, 0.0))
    for d in debts:
        if date_from <= d.created_at <= date_to:
            events.append((d.created_at, d.note or "Credit sale", "", d.total_owed, 0.0))
            if d.amount_paid:
                events.append((d.created_at, f"Payment against {d.note or 'credit sale'}", "", 0.0, d.amount_paid))
    events.sort(key=lambda e: e[0])

    entries = []
    running = opening_balance
    invoiced_amount = 0.0
    amount_received = 0.0
    for date, desc, ref, invoiced, received in events:
        running += invoiced - received
        invoiced_amount += invoiced
        amount_received += received
        entries.append(CustomerStatementEntry(
            date=date, description=desc, reference=ref,
            invoiced=round(invoiced, 2), received=round(received, 2), balance=round(running, 2),
        ))

    return CustomerStatement(
        customer_name=customer.name,
        date_from=date_from,
        date_to=date_to,
        opening_balance=round(opening_balance, 2),
        invoiced_amount=round(invoiced_amount, 2),
        amount_received=round(amount_received, 2),
        balance_due=round(running, 2),
        entries=entries,
    )
