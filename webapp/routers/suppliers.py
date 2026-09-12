from collections import defaultdict
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Purchase, PurchaseOrder, PurchaseOrderStatus, Creditor, Supplier, User, RoleEnum
from auth import get_current_user, require_inventory_up
from schemas import (
    SupplierCreate, SupplierUpdate, SupplierOut,
    SupplierProfile, SupplierMonthlySpend,
    PurchaseOut, PurchaseOrderOut, CreditorOut,
)
from activity import log_activity_for_user

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _scoped_supplier(db: Session, supplier_id: int, account_id):
    q = db.query(Supplier).filter(Supplier.id == supplier_id)
    if account_id is not None:
        q = q.filter(Supplier.account_id == account_id)
    supplier = q.first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


def _related(db: Session, model, name_field, supplier_name: str, account_id):
    q = db.query(model).filter(name_field == supplier_name)
    if account_id is not None:
        q = q.filter(model.account_id == account_id)
    return q.all()


# ---------- Supplier directory (a real record: name, phone, address, TIN/VRN) ----------

@router.get("/", response_model=List[SupplierOut])
def list_suppliers(db: Session = Depends(get_db), current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    q = db.query(Supplier)
    if account_id is not None:
        q = q.filter(Supplier.account_id == account_id)
    suppliers = q.order_by(Supplier.name).all()

    result = []
    for s in suppliers:
        purchases = _related(db, Purchase, Purchase.supplier, s.name, account_id)
        payables = _related(db, Creditor, Creditor.name, s.name, account_id)
        orders = _related(db, PurchaseOrder, PurchaseOrder.supplier_name, s.name, account_id)
        all_dates = [p.created_at for p in purchases] + [c.created_at for c in payables] + [o.created_at for o in orders]
        result.append(SupplierOut(
            id=s.id, name=s.name, phone=s.phone, email=s.email, address=s.address,
            tin_number=s.tin_number, vrn_number=s.vrn_number, notes=s.notes, created_at=s.created_at,
            total_spent=round(sum(p.total for p in purchases), 2),
            total_owed=round(sum(c.total_owed - c.amount_paid for c in payables), 2),
            last_activity=max(all_dates) if all_dates else None,
        ))
    return result


@router.post("/", response_model=SupplierOut)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Superadmin cannot create a supplier without a target account")

    existing = db.query(Supplier).filter(
        Supplier.account_id == account_id, Supplier.name == payload.name.strip()
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A supplier with this name already exists")

    supplier = Supplier(account_id=account_id, name=payload.name.strip(), phone=payload.phone or "",
                        email=payload.email or "", address=payload.address or "",
                        tin_number=payload.tin_number or "", vrn_number=payload.vrn_number or "",
                        notes=payload.notes or "")
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    log_activity_for_user(db, current_user, "create_supplier", f"Added supplier {supplier.name}")
    return SupplierOut(id=supplier.id, name=supplier.name, phone=supplier.phone, email=supplier.email,
                       address=supplier.address, tin_number=supplier.tin_number, vrn_number=supplier.vrn_number,
                       notes=supplier.notes, created_at=supplier.created_at)


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, payload: SupplierUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    supplier = _scoped_supplier(db, supplier_id, account_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(supplier, field, value)
    db.commit()
    db.refresh(supplier)
    log_activity_for_user(db, current_user, "update_supplier", f"Updated supplier {supplier.name}")
    return SupplierOut(id=supplier.id, name=supplier.name, phone=supplier.phone, email=supplier.email,
                       address=supplier.address, tin_number=supplier.tin_number, vrn_number=supplier.vrn_number,
                       notes=supplier.notes, created_at=supplier.created_at)


@router.delete("/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    supplier = _scoped_supplier(db, supplier_id, account_id)
    name = supplier.name
    db.delete(supplier)
    db.commit()
    log_activity_for_user(db, current_user, "delete_supplier", f"Deleted supplier {name}")
    return {"detail": f"Supplier {name} deleted"}


# ---------- Supplier profile: purchase orders, purchases, payables, spend chart ----------
# Mirrors customer_profile() — total spent (received Purchase totals),
# outstanding payables (unpaid Creditor balance), and a 6-month spend chart.

@router.get("/{supplier_id}/profile", response_model=SupplierProfile)
def supplier_profile(supplier_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    supplier = _scoped_supplier(db, supplier_id, account_id)

    orders = sorted(_related(db, PurchaseOrder, PurchaseOrder.supplier_name, supplier.name, account_id),
                    key=lambda o: o.created_at, reverse=True)
    payables = sorted(_related(db, Creditor, Creditor.name, supplier.name, account_id),
                      key=lambda c: c.created_at, reverse=True)
    purchases = sorted(_related(db, Purchase, Purchase.supplier, supplier.name, account_id),
                       key=lambda p: p.created_at, reverse=True)

    outstanding_payables = round(sum(c.total_owed - c.amount_paid for c in payables), 2)

    # Last 6 months, from actual received Purchase totals.
    now = datetime.utcnow()
    months = []
    cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(6):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months = list(reversed(months))

    monthly_totals = defaultdict(float)
    for p in purchases:
        monthly_totals[p.created_at.strftime("%Y-%m")] += p.total

    spend_last_6_months = [
        SupplierMonthlySpend(month=m.strftime("%Y-%m"), total=round(monthly_totals.get(m.strftime("%Y-%m"), 0), 2))
        for m in months
    ]

    return SupplierProfile(
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        phone=supplier.phone,
        email=supplier.email,
        address=supplier.address,
        tin=supplier.tin_number,
        vrn=supplier.vrn_number,
        notes=supplier.notes,
        total_spent=round(sum(p.total for p in purchases), 2),
        outstanding_payables=outstanding_payables,
        spend_last_6_months=spend_last_6_months,
        total_spend_last_6_months=round(sum(p.total for p in spend_last_6_months), 2),
        purchase_orders=[PurchaseOrderOut.model_validate(o) for o in orders],
        purchases=[PurchaseOut.model_validate(p) for p in purchases],
        payables=[CreditorOut.model_validate(c) for c in payables],
    )


# ---------- Backfill: link supplier names already scattered across Purchase/
# PurchaseOrder/Creditor (from before the Supplier model existed) into real
# Supplier records. Safe to run repeatedly — only creates records for names
# that don't already have one (case-insensitive match). ----------

_IGNORED_NAMES = {"", "walk-in", "walk in", "walkin"}


@router.post("/sync-existing")
def sync_existing_suppliers(db: Session = Depends(get_db), current_user: User = Depends(require_inventory_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Superadmin cannot sync suppliers without a target account")

    found_names = set()
    for model, name_field in [
        (Purchase, Purchase.supplier),
        (PurchaseOrder, PurchaseOrder.supplier_name),
        (Creditor, Creditor.name),
    ]:
        rows = db.query(name_field).filter(model.account_id == account_id).distinct().all()
        for (name,) in rows:
            if name and name.strip().lower() not in _IGNORED_NAMES:
                found_names.add(name.strip())

    existing = db.query(Supplier.name).filter(Supplier.account_id == account_id).all()
    existing_lower = {n.lower() for (n,) in existing}

    created = []
    for name in sorted(found_names):
        if name.lower() in existing_lower:
            continue
        supplier = Supplier(account_id=account_id, name=name)
        db.add(supplier)
        created.append(name)
        existing_lower.add(name.lower())  # guard against case-variant duplicates within this same batch

    db.commit()
    if created:
        log_activity_for_user(db, current_user, "sync_suppliers",
                              f"Imported {len(created)} supplier(s) from existing records")

    return {
        "created_count": len(created),
        "created_names": created,
        "skipped_count": len(found_names) - len(created),
    }
