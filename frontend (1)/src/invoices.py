import uuid
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Invoice, InvoiceItem, User, DocumentStatus
from schemas import InvoiceCreate, InvoiceOut
from auth import get_current_user, require_manager_up
from activity import log_activity

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


def _calc_totals(items: List, tax_rate: float, discount: float):
    subtotal = sum((line.quantity * line.unit_price) for line in items)
    tax_amount = subtotal * (tax_rate / 100.0)
    total = subtotal + tax_amount - discount
    return round(subtotal, 2), round(tax_amount, 2), round(total, 2)


@router.post("/", response_model=InvoiceOut)
def create_invoice(payload: InvoiceCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Invoice must have at least one line item")

    subtotal, tax_amount, total = _calc_totals(payload.items, payload.tax_rate, payload.discount)

    invoice = Invoice(
        invoice_no=f"INV-{uuid.uuid4().hex[:8].upper()}",
        customer_name=payload.customer_name or "Walk-in",
        customer_phone=payload.customer_phone or "",
        customer_address=payload.customer_address or "",
        subtotal=subtotal,
        tax_rate=payload.tax_rate,
        tax_amount=tax_amount,
        discount=payload.discount,
        total=total,
        notes=payload.notes or "",
        status=DocumentStatus.sent,
        created_by=current_user.username,
    )
    db.add(invoice)
    db.flush()

    for line in payload.items:
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            description=line.description,
            quantity=line.quantity,
            unit_price=line.unit_price,
            total=round(line.quantity * line.unit_price, 2),
        ))

    db.commit()
    db.refresh(invoice)
    log_activity(db, current_user.username, "invoice_create", f"Created invoice {invoice.invoice_no} total {total}")
    return invoice


@router.get("/", response_model=List[InvoiceOut])
def list_invoices(start: Optional[date] = None, end: Optional[date] = None,
                   status: Optional[DocumentStatus] = None,
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Invoice)
    if start:
        query = query.filter(Invoice.created_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Invoice.created_at <= datetime.combine(end, datetime.max.time()))
    if status:
        query = query.filter(Invoice.status == status)
    return query.order_by(Invoice.created_at.desc()).all()


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.patch("/{invoice_id}/status", response_model=InvoiceOut)
def update_invoice_status(invoice_id: int, status: DocumentStatus,
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    invoice.status = status
    db.commit()
    db.refresh(invoice)
    log_activity(db, current_user.username, "invoice_status_update", f"Invoice {invoice.invoice_no} -> {status.value}")
    return invoice


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_manager_up)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(invoice)
    db.commit()
    log_activity(db, current_user.username, "invoice_delete", f"Deleted invoice {invoice.invoice_no}")
    return {"detail": "Invoice deleted"}
