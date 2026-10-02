from collections import defaultdict
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from pydantic import BaseModel

from models import Sale, Invoice, Quotation, Debtor, Customer, PosDraft, User, RoleEnum, DocumentStatus
from auth import get_current_user, require_sales_up, require_manager_up
from schemas import (
    CustomerCreate, CustomerUpdate, CustomerOut,
    CustomerProfile, CustomerMonthlyIncome,
    CustomerStatement, CustomerStatementEntry,
    InvoiceOut, QuotationOut, DebtorOut,
)
from activity import log_activity_for_user

router = APIRouter(prefix="/api/customers", tags=["customers"])


_IGNORED_NAMES = {"", "walk-in", "walk in", "walkin"}


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

@router.get("/lookup", response_model=CustomerOut)
def lookup_customer_by_name(name: str, db: Session = Depends(get_db),
                            current_user: User = Depends(require_sales_up)):
    """Used by the receipt printer to pull a customer's phone/TIN by name
    at print time, without changing the Sale/checkout schema -- receipts
    only ever stored customer_name, never phone or TIN."""
    account_id = get_account_filter(current_user)
    q = db.query(Customer).filter(Customer.name == name)
    if account_id is not None:
        q = q.filter(Customer.account_id == account_id)
    customer = q.first()
    if not customer:
        raise HTTPException(status_code=404, detail="No matching customer record")
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone, email=customer.email,
                       address=customer.address, tin_number=customer.tin_number,
                       notes=customer.notes, created_at=customer.created_at)


@router.get("/suggestions")
def customer_suggestions(db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    """Lightweight list for the POS customer-name dropdown: directory customers
    plus anyone who has appeared on a past sale, most recent first.
    Deliberately avoids the per-customer totals that list_customers computes."""
    from sqlalchemy import func
    account_id = get_account_filter(current_user)

    cq = db.query(Customer)
    if account_id is not None:
        cq = cq.filter(Customer.account_id == account_id)
    directory = {c.name: c.phone or "" for c in cq.all()}

    sq = db.query(Sale.customer_name, func.max(Sale.created_at)).group_by(Sale.customer_name)
    if account_id is not None:
        sq = sq.filter(Sale.account_id == account_id)
    last_sale = {name: ts for name, ts in sq.all() if name and name.strip().lower() != "walk-in"}

    names = set(directory) | set(last_sale)
    out = [
        {"name": n, "phone": directory.get(n, ""), "last_purchase": last_sale[n].isoformat() if n in last_sale else None}
        for n in names if n and n.strip().lower() != "walk-in"
    ]
    # most recent buyers first, never-purchased directory entries last (alphabetical)
    recent = sorted([r for r in out if r["last_purchase"]], key=lambda r: r["last_purchase"], reverse=True)
    rest = sorted([r for r in out if not r["last_purchase"]], key=lambda r: r["name"].lower())
    return recent + rest


@router.get("/", response_model=List[CustomerOut])
def list_customers(db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
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
            id=c.id, name=c.name, phone=c.phone, email=c.email, address=c.address,
            tin_number=c.tin_number, notes=c.notes, created_at=c.created_at,
            total_purchased=round(sum(s.total for s in sales), 2),
            total_owed=round(sum(d.total_owed - d.amount_paid for d in debts), 2),
            last_activity=max(all_dates) if all_dates else None,
        ))
    return result


@router.post("/", response_model=CustomerOut)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Superadmin cannot create a customer without a target account")

    existing = db.query(Customer).filter(
        Customer.account_id == account_id, Customer.name == payload.name.strip()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A customer with this name already exists")

    customer = Customer(account_id=account_id, name=payload.name.strip(), phone=payload.phone or "",
                        email=payload.email or "", address=payload.address or "", tin_number=payload.tin_number or "",
                        notes=payload.notes or "")
    db.add(customer)
    db.commit()
    db.refresh(customer)
    log_activity_for_user(db, current_user, "create_customer", f"Added customer {customer.name}")
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone, email=customer.email,
                       address=customer.address, tin_number=customer.tin_number,
                       notes=customer.notes, created_at=customer.created_at)


def _customer_out(c: Customer) -> CustomerOut:
    return CustomerOut(id=c.id, name=c.name, phone=c.phone, email=c.email, address=c.address,
                       tin_number=c.tin_number, notes=c.notes, created_at=c.created_at)


def _rename_everywhere(db: Session, account_id: int, old: str, new: str) -> dict:
    """Sales, invoices, quotations, debts and parked POS carts are linked to a
    customer by NAME, not by id. So when a customer is renamed (or merged into
    another), every one of those records has to follow, otherwise the customer
    silently loses their whole history. Posted ledger entries are left alone on
    purpose -- they are an audit trail."""
    counts = {}
    for label, model, col in [
        ("sales", Sale, "customer_name"),
        ("invoices", Invoice, "customer_name"),
        ("quotations", Quotation, "customer_name"),
        ("debts", Debtor, "name"),
        ("drafts", PosDraft, "customer_name"),
    ]:
        counts[label] = (db.query(model)
                         .filter(model.account_id == account_id, getattr(model, col) == old)
                         .update({col: new}, synchronize_session=False))
    return counts


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)
    old_name = customer.name
    changes = payload.model_dump(exclude_unset=True)

    if "name" in changes and changes["name"] is not None:
        new_name = changes["name"].strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Customer name can't be empty")
        if new_name.lower() in _IGNORED_NAMES:
            raise HTTPException(status_code=400, detail="'Walk-in' is reserved for one-off cash sales. Choose a real name.")
        clash = db.query(Customer).filter(
            Customer.account_id == customer.account_id, Customer.id != customer.id,
        ).all()
        if any(c.name.strip().lower() == new_name.lower() for c in clash):
            raise HTTPException(status_code=409,
                                detail=f"A customer called '{new_name}' already exists. Use Merge to combine the two.")
        changes["name"] = new_name

    for field, value in changes.items():
        if value is not None:
            setattr(customer, field, value.strip() if isinstance(value, str) else value)

    moved = {}
    if customer.name != old_name:
        moved = _rename_everywhere(db, customer.account_id, old_name, customer.name)
    db.commit()
    db.refresh(customer)

    detail = f"Updated customer {customer.name}"
    if moved:
        detail = (f"Renamed customer '{old_name}' -> '{customer.name}' "
                  f"(moved {moved['sales']} sale line(s), {moved['invoices']} invoice(s), "
                  f"{moved['quotations']} quotation(s), {moved['debts']} debt(s))")
    log_activity_for_user(db, current_user, "update_customer", detail)
    return _customer_out(customer)


class CustomerMerge(BaseModel):
    source_id: int


@router.post("/{customer_id}/merge", response_model=CustomerOut)
def merge_customer(customer_id: int, payload: CustomerMerge, db: Session = Depends(get_db),
                   current_user: User = Depends(require_manager_up)):
    """Fold a duplicate customer (source) into this one (target). All of the
    duplicate's sales, invoices, quotations and debts move across, any contact
    details the target is missing are copied over, and the duplicate is removed."""
    account_id = get_account_filter(current_user)
    target = _scoped_customer(db, customer_id, account_id)
    if payload.source_id == target.id:
        raise HTTPException(status_code=400, detail="Pick a different customer to merge in")
    source = _scoped_customer(db, payload.source_id, account_id)
    if source.account_id != target.account_id:
        raise HTTPException(status_code=400, detail="Customers belong to different accounts")

    moved = _rename_everywhere(db, target.account_id, source.name, target.name)
    for field in ("phone", "email", "address", "tin_number"):
        if not getattr(target, field) and getattr(source, field):
            setattr(target, field, getattr(source, field))
    if source.notes:
        target.notes = f"{target.notes}\n{source.notes}".strip() if target.notes else source.notes
    source_name = source.name
    db.delete(source)
    db.commit()
    db.refresh(target)
    log_activity_for_user(db, current_user, "merge_customers",
                          f"Merged '{source_name}' into '{target.name}' "
                          f"({moved['sales']} sale line(s), {moved['invoices']} invoice(s), "
                          f"{moved['quotations']} quotation(s), {moved['debts']} debt(s) moved)")
    return _customer_out(target)


# ---------- Receipts for one customer: grouped POS sales with their lines, plus
# a few buying-pattern numbers. Editing a receipt itself goes through
# PUT /api/sales/receipt/{receipt_no}, which keeps stock, debtors and the
# ledger in step. ----------

@router.get("/{customer_id}/receipts")
def customer_receipts(customer_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)
    sales = (db.query(Sale)
             .filter(Sale.customer_name == customer.name, Sale.account_id == customer.account_id)
             .order_by(Sale.created_at.desc(), Sale.id).all())

    grouped = {}
    for s in sales:
        key = s.receipt_no or f"SALE-{s.id}"
        r = grouped.get(key)
        if r is None:
            method = s.payment_method.name if s.payment_method is not None else s.payment_mode.value
            is_credit = (s.payment_method.is_credit if s.payment_method is not None
                         else s.payment_mode.value == "credit")
            r = grouped[key] = {
                "receipt_no": key, "created_at": s.created_at.isoformat(), "customer_name": s.customer_name,
                "payment_method": method, "is_credit": bool(is_credit), "sold_by": s.sold_by or "",
                "total": 0.0, "lines": [],
            }
        r["total"] = round(r["total"] + s.total, 2)
        r["lines"].append({"sale_id": s.id, "item_id": s.item_id, "item_name": s.item_name,
                           "quantity": s.quantity, "unit_price": s.unit_price, "total": s.total})
    receipts = list(grouped.values())
    for r in receipts:
        r["lines"].sort(key=lambda l: l["sale_id"])  # lines in the order they were rung up

    by_item = defaultdict(lambda: {"quantity": 0.0, "total": 0.0})
    for s in sales:
        by_item[s.item_name]["quantity"] += s.quantity
        by_item[s.item_name]["total"] += s.total
    top_items = sorted(
        ({"item_name": n, "quantity": round(v["quantity"], 2), "total": round(v["total"], 2)} for n, v in by_item.items()),
        key=lambda x: x["total"], reverse=True)[:5]

    dates = [r["created_at"] for r in receipts]
    total_spent = round(sum(r["total"] for r in receipts), 2)
    return {
        "customer_name": customer.name,
        "summary": {
            "receipt_count": len(receipts),
            "total_spent": total_spent,
            "average_receipt": round(total_spent / len(receipts), 2) if receipts else 0,
            "first_purchase": min(dates) if dates else None,
            "last_purchase": max(dates) if dates else None,
            "top_items": top_items,
        },
        "receipts": receipts,
    }


@router.delete("/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_sales_up)):
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
                     current_user: User = Depends(require_sales_up)):
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
        customer_id=customer.id,
        customer_name=customer.name,
        phone=customer.phone,
        email=customer.email,
        address=customer.address,
        tin=customer.tin_number,
        vrn="",
        notes=customer.notes,
        total_purchased=round(sum(s.total for s in sales), 2),
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
                       db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)

    now = datetime.utcnow()
    if date_to is None:
        date_to = now
    if date_from is None:
        date_from = date_to.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    invoices = _related(db, Invoice, Invoice.customer_name, customer.name, account_id)
    debts = _related(db, Debtor, Debtor.name, customer.name, account_id)

    # Opening balance: everything before the period start. An invoice that
    # was marked paid before the period start nets to zero here — it was
    # invoiced and settled entirely before this statement's window, so it
    # shouldn't inflate the opening balance. paid_at falls back to
    # created_at for invoices paid before this column existed, which still
    # nets correctly since both dates land in the same "before/after
    # date_from" bucket for those older records.
    opening_balance = 0.0
    for i in invoices:
        if i.created_at < date_from:
            opening_balance += i.total
            if i.status == DocumentStatus.paid:
                paid_date = i.paid_at or i.created_at
                if paid_date < date_from:
                    opening_balance -= i.total
    for d in debts:
        if d.created_at < date_from:
            opening_balance += d.total_owed
            opening_balance -= d.amount_paid

    # In-period events. A paid invoice contributes both the original
    # "invoiced" line (if raised in-period) and a separate "received" line
    # dated at the moment it was actually paid — mirroring how Debtor
    # payments are already netted below. Without this, a fully-paid
    # invoice would stay counted as outstanding forever, since nothing
    # here previously offset it (see the comment on Invoice.paid_at).
    events = []
    for i in invoices:
        if date_from <= i.created_at <= date_to:
            events.append((i.created_at, f"Invoice {i.invoice_no}", i.invoice_no, i.total, 0.0))
        if i.status == DocumentStatus.paid:
            paid_date = i.paid_at or i.created_at
            if date_from <= paid_date <= date_to:
                events.append((paid_date, f"Payment received — Invoice {i.invoice_no}", i.invoice_no, 0.0, i.total))
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


# ---------- Backfill: link customer names already scattered across Sale/
# Invoice/Quotation/Debtor (from before the Customer model existed) into
# real Customer records. Safe to run repeatedly -- only creates records
# for names that don't already have one (case-insensitive match), never
# touches or duplicates existing Customer rows. ----------

@router.post("/sync-existing")
def sync_existing_customers(db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Superadmin cannot sync customers without a target account")

    found_names = set()
    for model, name_field in [
        (Sale, Sale.customer_name),
        (Invoice, Invoice.customer_name),
        (Quotation, Quotation.customer_name),
        (Debtor, Debtor.name),
    ]:
        rows = db.query(name_field).filter(model.account_id == account_id).distinct().all()
        for (name,) in rows:
            if name and name.strip().lower() not in _IGNORED_NAMES:
                found_names.add(name.strip())

    existing = db.query(Customer.name).filter(Customer.account_id == account_id).all()
    existing_lower = {n.lower() for (n,) in existing}

    created = []
    for name in sorted(found_names):
        if name.lower() in existing_lower:
            continue
        customer = Customer(account_id=account_id, name=name)
        db.add(customer)
        created.append(name)
        existing_lower.add(name.lower())  # guard against case-variant duplicates within this same batch

    db.commit()
    if created:
        log_activity_for_user(db, current_user, "sync_customers",
                              f"Imported {len(created)} customer(s) from existing records")

    return {
        "created_count": len(created),
        "created_names": created,
        "skipped_count": len(found_names) - len(created),
    }
