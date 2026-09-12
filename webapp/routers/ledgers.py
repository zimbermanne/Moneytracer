import io
import os
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, and_

from database import get_db
from models import (
    Debtor, DebtorItem, Creditor, CreditorItem, User, LedgerStatus, RoleEnum,
    FiscalPeriod, FiscalPeriodStatus, ChartOfAccount, JournalEntry, JournalLine,
    LedgerAccountType, PaymentMethod,
)
from schemas import (
    DebtorCreate, DebtorUpdate, DebtorOut, CreditorCreate, CreditorUpdate, CreditorOut,
    LedgerOut, PaymentRequest, FiscalPeriodCreate, FiscalPeriodOut,
    ChartOfAccountOut, JournalEntryOut, JournalEntryCreate, JournalLineOut,
    PaymentMethodOut, PaymentMethodCreate, PaymentMethodUpdate,
    ReconciliationEntry, ReconciliationStatement,
)
from auth import get_current_user, require_manager_up, require_admin, require_accountant_up
from activity import log_activity_for_user
from ledger import post_journal_entry, FiscalPeriodLockedError, ensure_default_chart_of_accounts, ensure_default_payment_methods, signed_balance
from routers.invoices import get_account_details

router = APIRouter(prefix="/api/ledgers", tags=["ledgers"])

COMPANY_NAME    = os.getenv("COMPANY_NAME", "Moneytracer")
COMPANY_ADDRESS = os.getenv("COMPANY_ADDRESS", "Arusha, Tanzania")
COMPANY_PHONE   = os.getenv("COMPANY_PHONE", "")
COMPANY_EMAIL   = os.getenv("COMPANY_EMAIL", "")
CURRENCY        = os.getenv("CURRENCY", "TZS")


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _update_status(entry):
    if entry.amount_paid <= 0:
        entry.status = LedgerStatus.unpaid
    elif entry.amount_paid >= entry.total_owed:
        entry.status = LedgerStatus.paid
    else:
        entry.status = LedgerStatus.partial


@router.get("/debtors", response_model=List[DebtorOut])
def list_debtors(db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    query = db.query(Debtor)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    return query.order_by(Debtor.created_at.desc()).all()


@router.post("/debtors", response_model=DebtorOut)
def add_debtor(payload: DebtorCreate, db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot add debtors")

    fields = payload.model_dump(exclude={"items"})
    debtor = Debtor(**fields, account_id=account_id)
    db.add(debtor)
    db.flush()  # need debtor.id before attaching items
    for line in payload.items:
        db.add(DebtorItem(debtor_id=debtor.id, **line.model_dump()))
    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_add", f"Added debtor {debtor.name}")
    return debtor


@router.put("/debtors/{debtor_id}", response_model=DebtorOut)
def update_debtor(debtor_id: int, payload: DebtorUpdate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    for field, value in updates.items():
        setattr(debtor, field, value)
    _update_status(debtor)

    if payload.items is not None:  # explicit [] clears items; omitted leaves them untouched
        db.query(DebtorItem).filter(DebtorItem.debtor_id == debtor.id).delete()
        for line in payload.items:
            db.add(DebtorItem(debtor_id=debtor.id, **line.model_dump()))

    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_update", f"Updated debtor {debtor_id}")
    return debtor


@router.delete("/debtors/{debtor_id}")
def delete_debtor(debtor_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    account_id = get_account_filter(current_user)
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")
    db.delete(debtor)
    db.commit()
    log_activity_for_user(db, current_user, "debtor_delete", f"Deleted debtor {debtor_id}")
    return {"detail": "Debtor deleted"}


@router.post("/debtors/pay/{debtor_id}", response_model=DebtorOut)
def pay_debtor(debtor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")
    debtor.amount_paid += payload.amount
    _update_status(debtor)
    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_payment", f"{debtor.name} paid {payload.amount}")
    return debtor


def _render_debit_note_pdf(debtor: Debtor, account: dict = None) -> io.BytesIO:
    """Renders a Debit Note styled after the classic freight/trading debit-note
    layout: boxed header with party + document details, a red DEBIT NOTE
    title, an itemised charges table, a total line, and a bank-details box
    for settlement. Mirrors the visual structure of invoices._render_pdf but
    with the boxed-table header this document type traditionally uses."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    RED   = colors.HexColor("#C0392B")
    NAVY  = colors.HexColor("#1F3864")
    INK   = colors.HexColor("#2B2622")
    LINE  = colors.HexColor("#8C8C8C")

    biz_name    = (account or {}).get("name") or COMPANY_NAME
    biz_address = (account or {}).get("address") or COMPANY_ADDRESS
    biz_phone   = (account or {}).get("phone") or COMPANY_PHONE
    biz_email   = (account or {}).get("email") or COMPANY_EMAIL

    dn_no   = f"DN-{debtor.id:06d}"
    dn_date = debtor.created_at.strftime("%d %b, %Y").upper() if debtor.created_at else ""

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4,
          topMargin=16*mm, bottomMargin=20*mm, leftMargin=16*mm, rightMargin=16*mm)
    styles = getSampleStyleSheet()
    normal   = ParagraphStyle("N", parent=styles["Normal"], fontSize=9.5, leading=13, textColor=NAVY)
    normal_b = ParagraphStyle("NB", parent=normal, fontName="Helvetica-Bold")
    center_b = ParagraphStyle("CB", parent=styles["Normal"], fontSize=9.5, leading=13,
                               textColor=NAVY, alignment=TA_CENTER, fontName="Helvetica-Bold")
    label    = ParagraphStyle("L", parent=normal, fontName="Helvetica-Bold", fontSize=9)

    elems = []

    # ---- Letterhead ----
    company_style = ParagraphStyle("Co", parent=styles["Normal"], fontSize=16, leading=19,
                                    alignment=TA_CENTER, textColor=NAVY, fontName="Helvetica-Bold")
    sub_style = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9, leading=12,
                                alignment=TA_CENTER, textColor=INK)
    elems.append(Paragraph(biz_name, company_style))
    contact_bits = [b for b in [biz_address, biz_phone and f"Tel: {biz_phone}", biz_email] if b]
    if contact_bits:
        elems.append(Paragraph(" &nbsp;•&nbsp; ".join(contact_bits), sub_style))
    elems.append(Spacer(1, 3*mm))

    hr = Table([[""]], colWidths=[178*mm])
    hr.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1, NAVY)]))
    elems += [hr, Spacer(1, 5*mm)]

    title_style = ParagraphStyle("Title", parent=styles["Normal"], fontSize=20, leading=24,
                                  alignment=TA_CENTER, textColor=RED, fontName="Helvetica-Bold")
    elems.append(Paragraph("DEBIT NOTE", title_style))
    dn_meta_style = ParagraphStyle("DNM", parent=styles["Normal"], fontSize=9, leading=12,
                                    alignment=TA_CENTER, textColor=INK)
    elems.append(Paragraph(f"D/N No.: {dn_no} &nbsp;&nbsp;/&nbsp;&nbsp; Dated: {dn_date}", dn_meta_style))
    elems.append(Spacer(1, 5*mm))

    # ---- Boxed To / Phone / Attn grid, matching the reference layout ----
    to_lines = [f"<b>{debtor.name}</b>"]
    if debtor.note:
        to_lines.append(debtor.note)
    phone_cell = debtor.phone or "—"

    box_rows = [
        [Paragraph("To:", label), Paragraph("<br/>".join(to_lines), normal)],
        [Paragraph("Phone:", label), Paragraph(phone_cell, normal)],
        [Paragraph("Date:", label), Paragraph(dn_date, normal)],
    ]
    box = Table(box_rows, colWidths=[28*mm, 150*mm])
    box.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems += [box, Spacer(1, 6*mm)]

    section_title = ParagraphStyle("SecT", parent=styles["Normal"], fontSize=9.5, leading=12,
                                    alignment=TA_CENTER, textColor=colors.white, fontName="Helvetica-Bold")
    section_bar = Table([[Paragraph("DESCRIPTION OF GOODS AND CHARGES", section_title)]], colWidths=[178*mm])
    section_bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems += [section_bar]

    # ---- Items table ----
    rows = [["DESCRIPTION", f"UNIT PRICE ({CURRENCY})", "QUANTITY", f"TOTAL PRICE ({CURRENCY})"]]
    items = debtor.items or []
    if items:
        for it in items:
            line_total = (it.quantity or 0) * (it.unit_price or 0)
            rows.append([it.description, f"{it.unit_price:,.2f}", f"{it.quantity:g}", f"{line_total:,.2f}"])
    else:
        rows.append(["Amount owed", "", "", f"{debtor.total_owed:,.2f}"])

    col_widths = [82*mm, 34*mm, 26*mm, 36*mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), NAVY),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F7FA")]),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems += [t]

    balance = (debtor.total_owed or 0) - (debtor.amount_paid or 0)
    tot_rows = [["TOTAL OWED", f"{CURRENCY} {debtor.total_owed:,.2f}"]]
    if debtor.amount_paid:
        tot_rows.append(["AMOUNT PAID", f"{CURRENCY} {debtor.amount_paid:,.2f}"])
    tot_rows.append(["BALANCE DUE", f"{CURRENCY} {balance:,.2f}"])
    tt = Table(tot_rows, colWidths=[142*mm, 36*mm])
    tt.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.6, LINE),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("TEXTCOLOR", (0, 0), (-1, -2), RED),
        ("TEXTCOLOR", (0, -1), (-1, -1), RED),
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems += [tt, Spacer(1, 10*mm)]

    # ---- Bank details ----
    bank_name = (account or {}).get("bank_name") or ""
    bank_acct_name = (account or {}).get("bank_account_name") or ""
    bank_acct_no = (account or {}).get("bank_account_number") or ""
    bank_branch = (account or {}).get("bank_branch") or ""
    if any([bank_name, bank_acct_name, bank_acct_no, bank_branch]):
        bank_title = Table([[Paragraph("OUR BANK ACCOUNT DETAIL", section_title)]], colWidths=[178*mm])
        bank_title.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        bank_rows = []
        if bank_acct_name: bank_rows.append([Paragraph("Beneficiary", label), Paragraph(bank_acct_name, normal_b)])
        if bank_acct_no:   bank_rows.append([Paragraph("A/C No.", label), Paragraph(bank_acct_no, normal)])
        if bank_name:      bank_rows.append([Paragraph("Bank Name", label), Paragraph(bank_name, normal)])
        if bank_branch:    bank_rows.append([Paragraph("Branch", label), Paragraph(bank_branch, normal)])
        bank_table = Table(bank_rows, colWidths=[38*mm, 140*mm])
        bank_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.6, LINE),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        elems += [bank_title, bank_table, Spacer(1, 6*mm)]

    if debtor.note:
        elems += [Paragraph("Notes", label), Paragraph(debtor.note.replace("\n", "<br/>"), normal)]

    footer_style = ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8,
                                   alignment=TA_CENTER, textColor=colors.HexColor("#A79D8E"))

    def draw_footer(canvas, pdf_doc):
        canvas.saveState()
        p = Paragraph("Moneytracer", footer_style)
        w, h = p.wrap(pdf_doc.width, pdf_doc.bottomMargin)
        p.drawOn(canvas, pdf_doc.leftMargin, 10*mm)
        canvas.restoreState()

    pdf.build(elems, onFirstPage=draw_footer, onLaterPages=draw_footer)
    buf.seek(0)
    return buf


@router.get("/debtors/{debtor_id}/debit-note/pdf")
def debtor_debit_note_pdf(debtor_id: int, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")

    account = get_account_details(db, debtor.account_id)
    buf = _render_debit_note_pdf(debtor, account)
    log_activity_for_user(db, current_user, "debtor_debit_note_pdf", f"Exported debit note for {debtor.name}")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="DebitNote-DN-{debtor.id:06d}.pdf"'})


@router.get("/creditors", response_model=List[CreditorOut])
def list_creditors(db: Session = Depends(get_db), current_user: User = Depends(require_inventory_up)):
    query = db.query(Creditor)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    return query.order_by(Creditor.created_at.desc()).all()


@router.post("/creditors", response_model=CreditorOut)
def add_creditor(payload: CreditorCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot add creditors")

    fields = payload.model_dump(exclude={"items"})
    creditor = Creditor(**fields, account_id=account_id)
    db.add(creditor)
    db.flush()  # need creditor.id before attaching items
    for line in payload.items:
        db.add(CreditorItem(creditor_id=creditor.id, **line.model_dump()))
    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_add", f"Added creditor {creditor.name}")
    return creditor


@router.put("/creditors/{creditor_id}", response_model=CreditorOut)
def update_creditor(creditor_id: int, payload: CreditorUpdate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    for field, value in updates.items():
        setattr(creditor, field, value)
    _update_status(creditor)

    if payload.items is not None:  # explicit [] clears items; omitted leaves them untouched
        db.query(CreditorItem).filter(CreditorItem.creditor_id == creditor.id).delete()
        for line in payload.items:
            db.add(CreditorItem(creditor_id=creditor.id, **line.model_dump()))

    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_update", f"Updated creditor {creditor_id}")
    return creditor


@router.delete("/creditors/{creditor_id}")
def delete_creditor(creditor_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    account_id = get_account_filter(current_user)
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    db.delete(creditor)
    db.commit()
    log_activity_for_user(db, current_user, "creditor_delete", f"Deleted creditor {creditor_id}")
    return {"detail": "Creditor deleted"}


@router.post("/creditors/pay/{creditor_id}", response_model=CreditorOut)
def pay_creditor(creditor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    creditor.amount_paid += payload.amount
    _update_status(creditor)
    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_payment", f"Paid {creditor.name} {payload.amount}")
    return creditor


# ---------- Reconciliation (tie a Debtor and a Creditor to the same party) ----------
#
# A customer can independently become a supplier we owe money to (or vice
# versa) — e.g. a shop that buys from us on credit also sells us goods on
# credit. Debtor.name and Creditor.name are free text and often won't match
# exactly (nicknames, "Juma Store" vs "Juma General Store"), so name can't be
# the tie. Phone and TIN are the two identifiers a business actually treats
# as "this is the same account" — so reconciliation matches on those, never
# on name.

def _normalize_phone(phone: str) -> str:
    """Strip everything but digits, and drop a leading country/trunk prefix
    so '+255 712 345 678', '0712345678', and '255712345678' all normalize to
    the same '712345678' — otherwise formatting differences alone would make
    two rows for the same person look unrelated."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) > 9:
        digits = digits[-9:]  # last 9 digits = the actual subscriber number
    return digits


@router.get("/reconcile", response_model=ReconciliationStatement)
def reconcile_party(
    phone: Optional[str] = Query(None, description="Phone number to match on (either format)"),
    tin: Optional[str] = Query(None, description="TIN to match on"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pull every Debtor row and every Creditor row tied to the same
    real-world party — matched on phone and/or TIN, never on name — and
    return them merged into one chronological statement with a running net
    balance. Positive net_balance = the party owes the business overall;
    negative = the business owes the party overall, netting out debtor and
    creditor positions instead of showing them as two unrelated ledgers."""
    if not phone and not tin:
        raise HTTPException(status_code=400, detail="Provide a phone number or TIN to reconcile on")

    account_id = get_account_filter(current_user)
    norm_phone = _normalize_phone(phone) if phone else None
    tin_clean = tin.strip() if tin else None

    def _scoped(model):
        q = db.query(model)
        if account_id is not None:
            q = q.filter(model.account_id == account_id)
        return q.all()

    debtors = [d for d in _scoped(Debtor)
               if (norm_phone and _normalize_phone(d.phone) == norm_phone)
               or (tin_clean and d.tin_number and d.tin_number.strip() == tin_clean)]
    creditors = [c for c in _scoped(Creditor)
                 if (norm_phone and _normalize_phone(c.phone) == norm_phone)
                 or (tin_clean and c.tin_number and c.tin_number.strip() == tin_clean)]

    if not debtors and not creditors:
        raise HTTPException(status_code=404, detail="No debtor or creditor records match that phone/TIN")

    matched_phone = norm_phone and any(_normalize_phone(r.phone) == norm_phone for r in debtors + creditors)
    matched_tin = tin_clean and any(r.tin_number and r.tin_number.strip() == tin_clean for r in debtors + creditors)
    matched_on = "phone+tin" if (matched_phone and matched_tin) else ("phone" if matched_phone else "tin")

    party_name = (debtors + creditors)[0].name
    raw_entries = []
    for d in debtors:
        raw_entries.append((d.created_at, "debit", f"DN-{d.id:06d}", d.note or "", d.total_owed, d.amount_paid, d.id))
    for c in creditors:
        raw_entries.append((c.created_at, "credit", f"CN-{c.id:06d}", c.note or "", c.total_owed, c.amount_paid, c.id))
    raw_entries.sort(key=lambda e: e[0] or datetime.min)

    entries: List[ReconciliationEntry] = []
    running = 0.0
    total_debit = 0.0
    total_credit = 0.0
    for date, kind, doc_no, reference, amount, paid, source_id in raw_entries:
        outstanding = amount - paid
        if kind == "debit":
            running += outstanding
            total_debit += amount
        else:
            running -= outstanding
            total_credit += amount
        entries.append(ReconciliationEntry(
            date=date, kind=kind, doc_no=doc_no, reference=reference,
            amount=amount, paid=paid, balance=running,
            source_id=source_id, source_table="debtors" if kind == "debit" else "creditors",
        ))

    return ReconciliationStatement(
        party_name=party_name,
        phone=phone or "",
        tin_number=tin or "",
        matched_on=matched_on,
        total_debit=total_debit,
        total_credit=total_credit,
        net_balance=running,
        entries=entries,
    )


# ---------- Fiscal Periods ----------

@router.get("/fiscal-periods", response_model=List[FiscalPeriodOut])
def list_fiscal_periods(db: Session = Depends(get_db), current_user: User = Depends(require_accountant_up)):
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    return q.order_by(FiscalPeriod.start_date.desc()).all()


@router.post("/fiscal-periods", response_model=FiscalPeriodOut)
def create_fiscal_period(payload: FiscalPeriodCreate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_accountant_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create fiscal periods")
    if payload.end_date <= payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")

    overlap = (
        db.query(FiscalPeriod)
        .filter(
            FiscalPeriod.account_id == account_id,
            FiscalPeriod.start_date <= payload.end_date,
            FiscalPeriod.end_date >= payload.start_date,
        )
        .first()
    )
    if overlap:
        raise HTTPException(status_code=400, detail=f"Overlaps existing period '{overlap.name}'")

    period = FiscalPeriod(account_id=account_id, name=payload.name,
                           start_date=payload.start_date, end_date=payload.end_date)
    db.add(period)
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "fiscal_period_create", f"Created period {period.name}")
    return period


@router.post("/fiscal-periods/{period_id}/close", response_model=FiscalPeriodOut)
def close_fiscal_period(period_id: int, db: Session = Depends(get_db),
                         current_user: User = Depends(require_accountant_up)):
    """Locks the period: post_journal_entry will reject any entry dated
    inside it from this point on. Existing entries are untouched — the
    lock only blocks new posts and edits, never mutates history."""
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod).filter(FiscalPeriod.id == period_id)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    period = q.first()
    if not period:
        raise HTTPException(status_code=404, detail="Fiscal period not found")
    if period.status == FiscalPeriodStatus.closed:
        raise HTTPException(status_code=400, detail="Fiscal period is already closed")

    period.status = FiscalPeriodStatus.closed
    period.closed_by = current_user.username
    period.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "fiscal_period_close", f"Closed period {period.name}")
    return period


@router.post("/fiscal-periods/{period_id}/reopen", response_model=FiscalPeriodOut)
def reopen_fiscal_period(period_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(require_accountant_up)):
    """Reopening is intentionally left available to managers+ (not locked to
    superadmin) since small businesses need to fix a mistaken close without
    filing a support ticket — but every reopen is logged so it's auditable."""
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod).filter(FiscalPeriod.id == period_id)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    period = q.first()
    if not period:
        raise HTTPException(status_code=404, detail="Fiscal period not found")
    if period.status == FiscalPeriodStatus.open:
        raise HTTPException(status_code=400, detail="Fiscal period is already open")

    period.status = FiscalPeriodStatus.open
    period.closed_by = None
    period.closed_at = None
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "CRITICAL: fiscal_period_reopen", f"Reopened period {period.name}")
    return period


# ---------- Chart of Accounts ----------

@router.get("/chart-of-accounts", response_model=List[ChartOfAccountOut])
def list_chart_of_accounts(db: Session = Depends(get_db), current_user: User = Depends(require_accountant_up)):
    """Return ChartOfAccount records as a nested tree grouped by type, with running balances."""
    account_id = get_account_filter(current_user)
    query = db.query(ChartOfAccount)
    if account_id is not None:
        query = query.filter(ChartOfAccount.account_id == account_id)
    accounts = query.filter(ChartOfAccount.is_active == True).order_by(ChartOfAccount.code).all()

    # Compute running balance per account in a single grouped query instead
    # of one query per account — with a real chart of accounts + years of
    # transactions this was slow enough to time out the request entirely.
    #
    # Debit-minus-credit is only the correct "balance" sign for Asset/Expense
    # accounts, whose normal balance is a debit. Liability/Equity/Revenue
    # accounts carry a normal *credit* balance, so summing debit - credit for
    # them was flipping every liability/equity/revenue balance negative (or
    # showing ~0 net whenever debits and credits happened to be similar in
    # size) instead of reporting the actual amount owed/earned. We fetch raw
    # debit/credit sums here and flip the sign per account_type below.
    balance_query = (
        db.query(
            JournalLine.chart_account_id,
            func.sum(JournalLine.debit).label("total_debit"),
            func.sum(JournalLine.credit).label("total_credit"),
        )
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .filter(
            JournalLine.chart_account_id.in_([a.id for a in accounts]),
            JournalEntry.is_voided == False,
        )
    )
    if account_id is not None:
        balance_query = balance_query.filter(JournalEntry.account_id == account_id)
    balance_rows = balance_query.group_by(JournalLine.chart_account_id).all()

    accounts_by_id = {a.id: a for a in accounts}
    account_balances = {}
    for row in balance_rows:
        acc = accounts_by_id.get(row.chart_account_id)
        if acc is None:
            continue
        account_balances[row.chart_account_id] = signed_balance(acc.account_type, row.total_debit, row.total_credit)

    # Build nested tree structure. `seen` guards against a corrupted
    # parent_id cycle (e.g. A -> B -> A) recursing forever and taking the
    # whole endpoint down with a stack overflow.
    def build_tree(parent_id=None, seen=frozenset()):
        children = []
        for acc in accounts:
            if acc.parent_id == parent_id and acc.id not in seen:
                acc_dict = {
                    "id": acc.id,
                    "account_id": acc.account_id,
                    "code": acc.code,
                    "name": acc.name,
                    "account_type": acc.account_type,
                    "parent_id": acc.parent_id,
                    "is_active": acc.is_active,
                    "balance": account_balances.get(acc.id, 0),
                    "children": build_tree(acc.id, seen | {acc.id}),
                }
                children.append(ChartOfAccountOut(**acc_dict))
        return children

    return build_tree(parent_id=None)


# ---------- POS Payment Methods (mapped to Chart of Accounts) ----------

def _payment_method_out(m: PaymentMethod) -> PaymentMethodOut:
    return PaymentMethodOut(
        id=m.id,
        name=m.name,
        chart_account_id=m.chart_account_id,
        chart_account_code=m.chart_account.code if m.chart_account else "",
        chart_account_name=m.chart_account.name if m.chart_account else "",
        is_credit=m.is_credit,
        is_active=m.is_active,
        sort_order=m.sort_order,
    )


@router.get("/payment-methods", response_model=List[PaymentMethodOut])
def list_payment_methods(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dynamic list of POS Payment Methods for this tenant, each mapped to its
    Cash/Bank/AR account — seeded with the standard starter set on first
    call. This is what the POS payment dropdown fetches instead of the old
    hard-coded cash/mobile_money/credit choices."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin has no payment methods")
    methods = ensure_default_payment_methods(db, account_id)
    if not include_inactive:
        methods = [m for m in methods if m.is_active]
    methods = sorted(methods, key=lambda m: (m.sort_order, m.name))
    return [_payment_method_out(m) for m in methods]


@router.post("/payment-methods", response_model=PaymentMethodOut)
def create_payment_method(
    payload: PaymentMethodCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Add a new POS Payment Method mapped to an existing Chart of Accounts
    entry (e.g. a second mobile-money till or a newly opened bank account)."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot manage payment methods")
    chart_account = db.query(ChartOfAccount).filter(
        ChartOfAccount.id == payload.chart_account_id, ChartOfAccount.account_id == account_id
    ).first()
    if not chart_account:
        raise HTTPException(status_code=404, detail="Chart of accounts entry not found")
    method = PaymentMethod(
        account_id=account_id,
        name=payload.name,
        chart_account_id=payload.chart_account_id,
        is_credit=payload.is_credit,
        sort_order=payload.sort_order,
    )
    db.add(method)
    db.commit()
    db.refresh(method)
    log_activity_for_user(db, current_user, "payment_method_create", f"Added payment method {method.name}")
    return _payment_method_out(method)


@router.put("/payment-methods/{method_id}", response_model=PaymentMethodOut)
def update_payment_method(
    method_id: int,
    payload: PaymentMethodUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Rename a payment method, re-map it to a different Chart of Accounts
    account, reorder it, or deactivate it (soft-delete — past sales keep
    pointing at it so old journal entries/receipts stay accurate)."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot manage payment methods")
    method = db.query(PaymentMethod).filter(
        PaymentMethod.id == method_id, PaymentMethod.account_id == account_id
    ).first()
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")

    if payload.chart_account_id is not None:
        chart_account = db.query(ChartOfAccount).filter(
            ChartOfAccount.id == payload.chart_account_id, ChartOfAccount.account_id == account_id
        ).first()
        if not chart_account:
            raise HTTPException(status_code=404, detail="Chart of accounts entry not found")
        method.chart_account_id = payload.chart_account_id
    if payload.name is not None:
        method.name = payload.name
    if payload.is_credit is not None:
        method.is_credit = payload.is_credit
    if payload.is_active is not None:
        method.is_active = payload.is_active
    if payload.sort_order is not None:
        method.sort_order = payload.sort_order

    db.commit()
    db.refresh(method)
    log_activity_for_user(db, current_user, "payment_method_update", f"Updated payment method {method.name}")
    return _payment_method_out(method)


@router.delete("/payment-methods/{method_id}")
def delete_payment_method(
    method_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Soft-delete (deactivate) rather than hard-delete, since historical
    Sale rows may still reference this method's id via payment_method_id."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot manage payment methods")
    method = db.query(PaymentMethod).filter(
        PaymentMethod.id == method_id, PaymentMethod.account_id == account_id
    ).first()
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    method.is_active = False
    db.commit()
    log_activity_for_user(db, current_user, "payment_method_delete", f"Deactivated payment method {method.name}")
    return {"detail": "Payment method deactivated"}


# ---------- Journal Entries ----------

@router.get("/journal-entries", response_model=List[JournalEntryOut])
def list_journal_entries(
    account_id_filter: Optional[int] = Query(None, description="Filter by chart account ID"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_accountant_up),
):
    """Paginated list of journal entries with optional filtering by account and date range.

    When account_id_filter is set, each line also carries a server-computed
    running_balance (see ledger.signed_balance) so the frontend never has to
    re-derive the debit/credit sign convention itself — that duplication is
    exactly how the General Ledger page's balance/sign bug happened (fixed
    2026-09): the correct rule existed in list_chart_of_accounts but the
    client-side copy in GeneralLedger.jsx silently drifted out of sync with
    it. There is now exactly one implementation of the rule, and the
    frontend only ever displays what this endpoint sends.
    """
    account_id = get_account_filter(current_user)
    query = db.query(JournalEntry).options(
        selectinload(JournalEntry.lines).selectinload(JournalLine.account)
    ).filter(JournalEntry.is_voided == False)
    if account_id is not None:
        query = query.filter(JournalEntry.account_id == account_id)
    if account_id_filter is not None:
        query = query.join(JournalLine).filter(JournalLine.chart_account_id == account_id_filter)
    if start_date is not None:
        query = query.filter(JournalEntry.date >= start_date)
    if end_date is not None:
        query = query.filter(JournalEntry.date <= end_date)

    # Running balance only makes sense accumulated in true chronological
    # order (oldest first) — fetch that way regardless of display order,
    # then reverse for the newest-first response the frontend expects.
    entries = query.order_by(JournalEntry.date.asc(), JournalEntry.id.asc()).all()

    filtered_account_type = None
    if account_id_filter is not None:
        filtered_account = db.query(ChartOfAccount).filter(ChartOfAccount.id == account_id_filter).first()
        if filtered_account is not None:
            filtered_account_type = filtered_account.account_type

    # Build response with lines and running balance
    running_total_debit = 0.0
    running_total_credit = 0.0
    result = []
    for entry in entries:
        lines = []
        for line in entry.lines:
            # When filtering by a specific account, only that account's own
            # line(s) within the entry belong on its ledger — the entry's
            # other lines (the offsetting debit/credit on a different
            # account) aren't part of this account's history. Without this,
            # every entry's lines summed together always nets to the
            # compound entry's total debit == total credit (that's the
            # definition of "balanced"), so debit/credit/balance below would
            # be identical and the running balance would stay at zero
            # regardless of the actual account.
            if account_id_filter is not None and line.chart_account_id != account_id_filter:
                continue
            # line.account can be None if the chart-of-accounts row it points
            # at was ever deleted — without this guard, `.code`/`.name` on
            # None raises AttributeError and takes the whole endpoint down.
            running_balance = None
            if account_id_filter is not None and filtered_account_type is not None:
                running_total_debit += line.debit or 0
                running_total_credit += line.credit or 0
                running_balance = signed_balance(filtered_account_type, running_total_debit, running_total_credit)
            lines.append(JournalLineOut(
                id=line.id,
                chart_account_id=line.chart_account_id,
                account_code=line.account.code if line.account else "—",
                account_name=line.account.name if line.account else "(deleted account)",
                debit=line.debit,
                credit=line.credit,
                description=line.description,
                running_balance=running_balance,
            ))
        result.append(JournalEntryOut(
            id=entry.id,
            account_id=entry.account_id,
            date=entry.date,
            description=entry.description,
            reference=entry.reference,
            created_by=entry.created_by,
            is_locked=entry.is_locked,
            is_reversal=entry.is_reversal,
            is_voided=entry.is_voided,
            reversed_entry_id=entry.reversed_entry_id,
            lines=lines,
        ))
    # Reverse back to newest-first for display, now that running_balance was
    # accumulated in the correct chronological order above.
    result.reverse()
    return result


@router.post("/journal-entries", response_model=JournalEntryOut)
def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_accountant_up),
):
    """Create a manual journal entry. Validates balance and calls existing post_journal_entry."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create journal entries")

    # Validate that lines balance
    total_debit = sum(line.get("debit", 0) for line in payload.lines)
    total_credit = sum(line.get("credit", 0) for line in payload.lines)
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(status_code=400, detail=f"Entry doesn't balance: debits {total_debit} != credits {total_credit}")

    # Build lines for post_journal_entry
    lines = []
    for line in payload.lines:
        # Get account code from chart_account_id
        chart_account = db.query(ChartOfAccount).filter(
            ChartOfAccount.id == line["account_id"],
            ChartOfAccount.account_id == account_id
        ).first()
        if not chart_account:
            raise HTTPException(status_code=404, detail=f"Chart account {line['account_id']} not found")
        lines.append((chart_account.code, line.get("debit", 0), line.get("credit", 0)))

    try:
        entry = post_journal_entry(
            db,
            account_id,
            description=payload.description,
            lines=lines,
            reference=payload.reference,
            created_by=current_user.username,
            date=payload.date,
        )
    except FiscalPeriodLockedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Build response
    lines_out = []
    for line in entry.lines:
        lines_out.append(JournalLineOut(
            id=line.id,
            chart_account_id=line.chart_account_id,
            account_code=line.account.code,
            account_name=line.account.name,
            debit=line.debit,
            credit=line.credit,
            description=line.description,
        ))

    return JournalEntryOut(
        id=entry.id,
        account_id=entry.account_id,
        date=entry.date,
        description=entry.description,
        reference=entry.reference,
        created_by=entry.created_by,
        is_locked=entry.is_locked,
        is_reversal=entry.is_reversal,
        is_voided=entry.is_voided,
        reversed_entry_id=entry.reversed_entry_id,
        lines=lines_out,
    )
