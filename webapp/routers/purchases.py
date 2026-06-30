from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Purchase, InventoryItem, User
from schemas import PurchaseCreate, PurchaseOut
from auth import get_current_user, require_manager_up
from activity import log_activity

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


@router.post("/", response_model=PurchaseOut)
def record_purchase(payload: PurchaseCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    total = payload.unit_cost * payload.quantity
    purchase = Purchase(
        item_name=payload.item_name,
        supplier=payload.supplier or "",
        quantity=payload.quantity,
        unit_cost=payload.unit_cost,
        total=total,
    )
    db.add(purchase)

    # Increase stock if a matching inventory item exists
    item = db.query(InventoryItem).filter(InventoryItem.name == payload.item_name).first()
    if item:
        item.quantity += payload.quantity

    db.commit()
    db.refresh(purchase)
    log_activity(db, current_user.username, "purchase_record", f"Purchased {payload.quantity} x {payload.item_name}")
    return purchase


@router.get("/", response_model=List[PurchaseOut])
def list_purchases(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Purchase).order_by(Purchase.created_at.desc()).all()


@router.get("/stats/summary")
def purchase_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    purchases = db.query(Purchase).all()
    return {
        "total_purchases": len(purchases),
        "total_spent": round(sum(p.total for p in purchases), 2),
    }


@router.get("/{purchase_id}", response_model=PurchaseOut)
def get_purchase(purchase_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return purchase


@router.delete("/{purchase_id}")
def delete_purchase(purchase_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    purchase = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    db.delete(purchase)
    db.commit()
    log_activity(db, current_user.username, "purchase_delete", f"Deleted purchase {purchase_id}")
    return {"detail": "Purchase deleted"}
