from collections import defaultdict
import io
import os
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Sale, Invoice, Quotation, Debtor, Customer, User, RoleEnum, DocumentStatus
from auth import get_current_user
from schemas import (
    CustomerCreate, CustomerUpdate, CustomerOut,
    CustomerProfile, CustomerMonthlyIncome,
    CustomerStatement, CustomerStatementEntry,
    InvoiceOut, QuotationOut, DebtorOut,
    EmailDocRequest,
)
from activity import log_activity_for_user
import email_utils
from routers.invoices import get_account_details

router = APIRouter(prefix="/api/customers", tags=["customers"])

COMPANY_NAME = os.getenv("COMPANY_NAME", "Moneytracer")
CURRENCY = os.getenv("CURRENCY", "TZS")

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

@router.get("/lookup", response_model=CustomerOut)
def lookup_customer_by_name(name: str, db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_user)):
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
            id=c.id, name=c.name, phone=c.phone, email=c.email, address=c.address,
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
                        email=payload.email or "", address=payload.address or "", tin_number=payload.tin_number or "",
                        notes=payload.notes or "")
    db.add(customer)
    db.commit()
    db.refresh(customer)
    log_activity_for_user(db, current_user, "create_customer", f"Added customer {customer.name}")
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone, email=customer.email,
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
    return CustomerOut(id=customer.id, name=customer.name, phone=customer.phone, email=customer.email,
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


@router.post("/{customer_id}/email-statement")
def email_statement(customer_id: int, payload: EmailDocRequest,
                    date_from: datetime = None, date_to: datetime = None,
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    customer = _scoped_customer(db, customer_id, account_id)

    statement = customer_statement(customer_id, date_from, date_to, db, current_user)
    account = get_account_details(db, current_user.account_id)

    buf = _render_statement_pdf(statement, account)
    company = (account or {}).get("name") or COMPANY_NAME

    body = payload.message or (
        f"Dear {customer.name},\n\n"
        f"Please find attached your Statement of Account from {company}.\n"
        f"Period: {statement.date_from.strftime('%d/%m/%Y')} to {statement.date_to.strftime('%d/%m/%Y')}\n"
        f"Balance Due: {CURRENCY} {statement.balance_due:,.2f}.\n\n"
        f"Regards,\n{company}"
    )

    try:
        email_utils.send_email_with_attachment(
            to_email=payload.to_email,
            subject=f"Statement of Account from {company}",
            body=body,
            attachment_bytes=buf.getvalue(),
            attachment_filename=f"Statement-{customer.name.replace(' ', '_')}.pdf",
        )
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Failed to send email: {exc}")

    log_activity_for_user(db, current_user, "customer_email_statement", f"Emailed statement to {payload.to_email} for {customer.name}")
    return {"detail": f"Statement emailed to {payload.to_email}"}


def _render_statement_pdf(statement: CustomerStatement, account: dict = None) -> io.BytesIO:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    ACCENT = colors.HexColor("#C15F3C")
    INK = colors.HexColor("#2B2622")

    biz_name = (account or {}).get("name") or COMPANY_NAME
    biz_address = (account or {}).get("address") or ""
    biz_phone = (account or {}).get("phone") or ""
    biz_email = (account or {}).get("email") or ""

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4,
                            topMargin=18*mm, bottomMargin=24*mm, leftMargin=18*mm, rightMargin=18*mm)
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("N", parent=styles["Normal"], fontSize=10, leading=14)
    right = ParagraphStyle("R", parent=styles["Normal"], fontSize=10, leading=14, alignment=TA_RIGHT)
    section = ParagraphStyle("S", parent=styles["Heading4"], fontSize=11, textColor=ACCENT)
    biz_name_style = ParagraphStyle("BN", parent=styles["Normal"], fontSize=15, leading=18, textColor=INK)

    elems = []
    elems.append(Paragraph(f"<b>{biz_name}</b>", biz_name_style))
    if biz_address: elems.append(Paragraph(biz_address, normal))
    if biz_phone: elems.append(Paragraph(f"Phone: {biz_phone}", normal))
    if biz_email: elems.append(Paragraph(f"Email: {biz_email}", normal))
    elems += [Spacer(1, 8*mm)]

    hr = Table([[""]], colWidths=[164*mm])
    hr.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, INK)]))
    elems += [hr, Spacer(1, 8*mm)]

    elems.append(Paragraph("<b>Statement of Account</b>", styles["Heading2"]))
    elems.append(Paragraph(f"<b>Customer:</b> {statement.customer_name}", normal))
    elems.append(Paragraph(f"<b>Period:</b> {statement.date_from.strftime('%d/%m/%Y')} to {statement.date_to.strftime('%d/%m/%Y')}", normal))
    elems += [Spacer(1, 6*mm)]

    summary_data = [
        ["Opening Balance", f"{CURRENCY} {statement.opening_balance:,.2f}"],
        ["Invoiced in Period", f"{CURRENCY} {statement.invoiced_amount:,.2f}"],
        ["Received in Period", f"{CURRENCY} {statement.amount_received:,.2f}"],
        ["Balance Due", f"{CURRENCY} {statement.balance_due:,.2f}"]
    ]
    st = Table(summary_data, colWidths=[60*mm, 40*mm])
    st.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTNAME", (0, 3), (1, 3), "Helvetica-Bold"),
        ("LINEABOVE", (0, 3), (1, 3), 0.5, INK),
    ]))
    elems.append(st)
    elems += [Spacer(1, 10*mm)]

    # Transaction Table
    rows = [["Date", "Description", "Invoiced", "Received", "Balance"]]
    for e in statement.entries:
        rows.append([
            e.date.strftime("%d/%m/%Y"),
            e.description,
            f"{e.invoiced:,.2f}" if e.invoiced else "—",
            f"{e.received:,.2f}" if e.received else "—",
            f"{e.balance:,.2f}"
        ])

    t = Table(rows, colWidths=[25*mm, 64*mm, 25*mm, 25*mm, 25*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (2, 0), (4, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9f9f9")]),
    ]))
    elems.append(t)

    elems += [Spacer(1, 12*mm), Paragraph("Thank you for your business.", normal)]

    pdf.build(elems)
    buf.seek(0)
    return buf


# ---------- Backfill: link customer names already scattered across Sale/
# Invoice/Quotation/Debtor (from before the Customer model existed) into
# real Customer records. Safe to run repeatedly -- only creates records
# for names that don't already have one (case-insensitive match), never
# touches or duplicates existing Customer rows. ----------

_IGNORED_NAMES = {"", "walk-in", "walk in", "walkin"}


@router.post("/sync-existing")
def sync_existing_customers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
