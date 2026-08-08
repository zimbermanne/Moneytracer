import uuid
from datetime import datetime, date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Quotation, QuotationItem, Invoice, InvoiceItem, User, DocumentStatus
from schemas import QuotationCreate, QuotationOut, InvoiceOut
from auth import get_current_user, require_manager_up
from activity import log_activity

router = APIRouter(prefix="/api/quotations", tags=["quotations"])


def _calc_totals(items: List, tax_rate: float, discount: float):
    subtotal = sum((line.quantity * line.unit_price) for line in items)
    tax_amount = subtotal * (tax_rate / 100.0)
    total = subtotal + tax_amount - discount
    return round(subtotal, 2), round(tax_amount, 2), round(total, 2)


@router.post("/", response_model=QuotationOut)
def create_quotation(payload: QuotationCreate, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Quotation must have at least one line item")

    subtotal, tax_amount, total = _calc_totals(payload.items, payload.tax_rate, payload.discount)
    valid_days = payload.valid_days if payload.valid_days is not None else 14

    quotation = Quotation(
        quote_no=f"QUO-{uuid.uuid4().hex[:8].upper()}",
        customer_name=payload.customer_name or "Walk-in",
        customer_phone=payload.customer_phone or "",
        customer_address=payload.customer_address or "",
        subtotal=subtotal,
        tax_rate=payload.tax_rate,
        tax_amount=tax_amount,
        discount=payload.discount,
        total=total,
        notes=payload.notes or "",
        valid_until=datetime.utcnow() + timedelta(days=valid_days),
        status=DocumentStatus.draft,
        created_by=current_user.username,
    )
    db.add(quotation)
    db.flush()

    for line in payload.items:
        db.add(QuotationItem(
            quotation_id=quotation.id,
            description=line.description,
            quantity=line.quantity,
            unit_price=line.unit_price,
            total=round(line.quantity * line.unit_price, 2),
        ))

    db.commit()
    db.refresh(quotation)
    log_activity(db, current_user.username, "quotation_create", f"Created quotation {quotation.quote_no} total {total}")
    return quotation


@router.get("/", response_model=List[QuotationOut])
def list_quotations(start: Optional[date] = None, end: Optional[date] = None,
                     status: Optional[DocumentStatus] = None,
                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Quotation)
    if start:
        query = query.filter(Quotation.created_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Quotation.created_at <= datetime.combine(end, datetime.max.time()))
    if status:
        query = query.filter(Quotation.status == status)
    return query.order_by(Quotation.created_at.desc()).all()


@router.get("/{quotation_id}", response_model=QuotationOut)
def get_quotation(quotation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    quotation = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return quotation


@router.patch("/{quotation_id}/status", response_model=QuotationOut)
def update_quotation_status(quotation_id: int, status: DocumentStatus,
                             db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    quotation = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    quotation.status = status
    db.commit()
    db.refresh(quotation)
    log_activity(db, current_user.username, "quotation_status_update", f"Quotation {quotation.quote_no} -> {status.value}")
    return quotation


@router.post("/{quotation_id}/convert", response_model=InvoiceOut)
def convert_to_invoice(quotation_id: int, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    quotation = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if quotation.status == DocumentStatus.rejected:
        raise HTTPException(status_code=400, detail="Cannot convert a rejected quotation")

    invoice = Invoice(
        invoice_no=f"INV-{uuid.uuid4().hex[:8].upper()}",
        customer_name=quotation.customer_name,
        customer_phone=quotation.customer_phone,
        customer_address=quotation.customer_address,
        subtotal=quotation.subtotal,
        tax_rate=quotation.tax_rate,
        tax_amount=quotation.tax_amount,
        discount=quotation.discount,
        total=quotation.total,
        notes=f"Converted from quotation {quotation.quote_no}",
        status=DocumentStatus.sent,
        created_by=current_user.username,
    )
    db.add(invoice)
    db.flush()

    for line in quotation.items:
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            description=line.description,
            quantity=line.quantity,
            unit_price=line.unit_price,
            total=line.total,
        ))

    quotation.status = DocumentStatus.accepted
    db.commit()
    db.refresh(invoice)
    log_activity(db, current_user.username, "quotation_convert",
                 f"Converted quotation {quotation.quote_no} to invoice {invoice.invoice_no}")
    return invoice


@router.delete("/{quotation_id}")
def delete_quotation(quotation_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(require_manager_up)):
    quotation = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if not quotation:
        raise HTTPException(status_code=404, detail="Quotation not found")
    db.delete(quotation)
    db.commit()
    log_activity(db, current_user.username, "quotation_delete", f"Deleted quotation {quotation.quote_no}")
    return {"detail": "Quotation deleted"}
