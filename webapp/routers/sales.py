import uuid
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Sale, InventoryItem, Debtor, User, PaymentMode, LedgerStatus
from schemas import SaleCreate, SaleOut, CheckoutRequest, CheckoutResponse
from auth import get_current_user, require_manager_up
from activity import log_activity

router = APIRouter(prefix="/api/sales", tags=["sales"])


def _decrement_stock(db: Session, item: InventoryItem, qty: float):
    if item.quantity < qty:
        raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}")
    item.quantity -= qty


@router.post("/", response_model=SaleOut)
def record_sale(payload: SaleCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    item = None
    unit_price = payload.unit_price or 0
    item_name = payload.item_name or ""
    if payload.item_id:
        item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        _decrement_stock(db, item, payload.quantity)
        unit_price = payload.unit_price if payload.unit_price is not None else item.selling_price
        item_name = item.name

    total = unit_price * payload.quantity
    sale = Sale(
        item_id=item.id if item else None,
        item_name=item_name,
        quantity=payload.quantity,
        unit_price=unit_price,
        total=total,
        payment_mode=payload.payment_mode,
        customer_name=payload.customer_name or "Walk-in",
        sold_by=current_user.username,
        receipt_no=f"RCT-{uuid.uuid4().hex[:8].upper()}",
    )
    db.add(sale)

    if payload.payment_mode == PaymentMode.credit:
        debtor = Debtor(
            name=payload.customer_name or "Walk-in",
            total_owed=total,
            status=LedgerStatus.unpaid,
            note=f"Credit sale: {item_name}",
        )
        db.add(debtor)

    db.commit()
    db.refresh(sale)
    log_activity(db, current_user.username, "sale_record", f"Sold {payload.quantity} x {item_name}")
    return sale


@router.post("/checkout", response_model=CheckoutResponse)
def checkout(payload: CheckoutRequest, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    # Validate stock for all lines first (no overselling)
    items_map = {}
    for line in payload.lines:
        item = db.query(InventoryItem).filter(InventoryItem.id == line.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")
        if item.quantity < line.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}")
        items_map[line.item_id] = item

    receipt_no = f"RCT-{uuid.uuid4().hex[:8].upper()}"
    sales = []
    grand_total = 0.0
    for line in payload.lines:
        item = items_map[line.item_id]
        item.quantity -= line.quantity
        total = item.selling_price * line.quantity
        grand_total += total
        sale = Sale(
            item_id=item.id,
            item_name=item.name,
            quantity=line.quantity,
            unit_price=item.selling_price,
            total=total,
            payment_mode=payload.payment_mode,
            customer_name=payload.customer_name or "Walk-in",
            sold_by=current_user.username,
            receipt_no=receipt_no,
        )
        db.add(sale)
        sales.append(sale)

    if payload.payment_mode == PaymentMode.credit:
        debtor = Debtor(
            name=payload.customer_name or "Walk-in",
            phone=payload.customer_phone or "",
            total_owed=grand_total,
            status=LedgerStatus.unpaid,
            note=f"Credit sale receipt {receipt_no}",
        )
        db.add(debtor)

    db.commit()
    for s in sales:
        db.refresh(s)
    log_activity(db, current_user.username, "pos_checkout", f"Checkout {receipt_no} total {grand_total}")
    return CheckoutResponse(receipt_no=receipt_no, sales=sales, total=grand_total)


@router.get("/", response_model=List[SaleOut])
def list_sales(start: Optional[date] = None, end: Optional[date] = None,
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Sale)
    if start:
        query = query.filter(Sale.created_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Sale.created_at <= datetime.combine(end, datetime.max.time()))
    return query.order_by(Sale.created_at.desc()).all()


@router.get("/stats/summary")
def sales_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sales = db.query(Sale).all()
    total_revenue = sum(s.total for s in sales)
    total_qty = sum(s.quantity for s in sales)
    return {
        "total_sales": len(sales),
        "total_revenue": round(total_revenue, 2),
        "total_quantity": total_qty,
        "average_sale": round(total_revenue / len(sales), 2) if sales else 0,
    }


@router.get("/by-item/{item_id}", response_model=List[SaleOut])
def sales_by_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Sale).filter(Sale.item_id == item_id).order_by(Sale.created_at.desc()).all()


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.delete("/{sale_id}")
def delete_sale(sale_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager_up)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.item_id:
        item = db.query(InventoryItem).filter(InventoryItem.id == sale.item_id).first()
        if item:
            item.quantity += sale.quantity
    db.delete(sale)
    db.commit()
    log_activity(db, current_user.username, "sale_delete", f"Deleted sale {sale_id}, stock restored")
    return {"detail": "Sale deleted and stock restored"}
