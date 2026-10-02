import uuid
from datetime import datetime, date
from collections import defaultdict
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Sale, InventoryItem, Debtor, DebtorItem, User, PaymentMode, LedgerStatus, RoleEnum, PaymentMethod
from schemas import SaleCreate, SaleOut, CheckoutRequest, CheckoutResponse, ReceiptUpdate
from auth import get_current_user, require_manager_up, require_sales_up
from activity import log_activity_for_user
from ledger import (
    post_sale_entry, find_journal_entry_by_reference, reverse_journal_entry,
    FiscalPeriodLockedError, ensure_default_payment_methods,
    get_locked_period, find_open_journal_entries_by_reference,
)


def _resolve_payment_method(db: Session, account_id: int, payment_method_id):
    """Look up + validate a POS Payment Method for this tenant. Seeds the
    default set on first use so a fresh account always has something to pick
    from. Returns None if no id was given (legacy payment_mode-only path)."""
    if payment_method_id is None:
        return None
    ensure_default_payment_methods(db, account_id)
    method = (
        db.query(PaymentMethod)
        .filter(PaymentMethod.id == payment_method_id, PaymentMethod.account_id == account_id)
        .first()
    )
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return method

router = APIRouter(prefix="/api/sales", tags=["sales"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _decrement_stock(db: Session, item: InventoryItem, qty: float):
    if item.quantity < qty:
        raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}")
    item.quantity -= qty


def _normalize_customer_name(name: Optional[str]) -> str:
    """Standardize one-off cash sales strictly to 'Walk-in'."""
    clean = (name or "").strip()
    if not clean or clean.lower() in ("walk-in", "walkin", "cash"):
        return "Walk-in"
    return clean

@router.post("/", response_model=SaleOut)
def record_sale(payload: SaleCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot record sales")
    
    item = None
    unit_price = payload.unit_price or 0
    item_name = payload.item_name or ""
    if payload.item_id:
        item = db.query(InventoryItem).filter(InventoryItem.id == payload.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        if item.account_id != account_id:
            raise HTTPException(status_code=403, detail="Item does not belong to your account")
        _decrement_stock(db, item, payload.quantity)
        unit_price = payload.unit_price if payload.unit_price is not None else item.selling_price
        item_name = item.name

    if unit_price <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Sale total cannot be zero. Items must have a positive unit price."
        )

    payment_method = _resolve_payment_method(db, account_id, payload.payment_method_id)
    is_credit_sale = (payment_method.is_credit if payment_method else payload.payment_mode == PaymentMode.credit)

    # Standardize customer name
    customer_name = _normalize_customer_name(payload.customer_name)

    total = unit_price * payload.quantity
    sale = Sale(
        account_id=account_id,
        item_id=item.id if item else None,
        item_name=item_name,
        quantity=payload.quantity,
        unit_price=unit_price,
        cost_price_at_sale=item.cost_price if item else None,
        total=total,
        payment_mode=payload.payment_mode,
        payment_method_id=payment_method.id if payment_method else None,
        customer_name=customer_name,
        sold_by=current_user.username,
        receipt_no=f"RCT-{uuid.uuid4().hex[:8].upper()}",
    )
    db.add(sale)

    if is_credit_sale:
        debtor = Debtor(
            account_id=account_id,
            name=customer_name,
            total_owed=total,
            status=LedgerStatus.unpaid,
            note=f"Credit sale: {item_name}",
        )
        db.add(debtor)
        db.flush()  # need debtor.id before attaching the item line
        db.add(DebtorItem(
            debtor_id=debtor.id,
            item_id=item.id if item else None,
            description=item_name,
            quantity=payload.quantity,
            unit_price=unit_price,
        ))

    db.commit()
    db.refresh(sale)
    try:
        post_sale_entry(db, account_id, sale, created_by=current_user.username)
    except ValueError as e:
        log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))
    log_activity_for_user(db, current_user, "sale_record", f"Sold {payload.quantity} x {item_name}")
    return sale


@router.post("/checkout", response_model=CheckoutResponse)
def checkout(payload: CheckoutRequest, db: Session = Depends(get_db),
             current_user: User = Depends(require_sales_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot perform checkout")
    
    # Validate stock for all lines first (no overselling)
    items_map = {}
    for line in payload.lines:
        item = db.query(InventoryItem).filter(InventoryItem.id == line.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")
        if item.account_id != account_id:
            raise HTTPException(status_code=403, detail=f"Item {line.item_id} does not belong to your account")
        if item.quantity < line.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}")
        items_map[line.item_id] = item

    payment_method = _resolve_payment_method(db, account_id, payload.payment_method_id)
    is_credit_sale = (payment_method.is_credit if payment_method else payload.payment_mode == PaymentMode.credit)

    # Standardize customer name
    customer_name = _normalize_customer_name(payload.customer_name)

    receipt_no = f"RCT-{uuid.uuid4().hex[:8].upper()}"
    sales = []
    grand_total = 0.0
    is_salesman_mode = payload.sale_mode == "salesman"

    for line in payload.lines:
        item = items_map[line.item_id]
        item.quantity -= line.quantity
        if is_salesman_mode and line.unit_price is not None:
            price = line.unit_price
        else:
            price = item.selling_price
        
        if price <= 0:
            raise HTTPException(
                status_code=400, 
                detail=f"Item '{item.name}' has an invalid price (TZS {price}). "
                       "Zero-value sales are not permitted. Please enter a valid price or "
                       "record this as a promotional expense in the Expenses module."
            )

        total = price * line.quantity
        grand_total += total
        sale = Sale(
            account_id=account_id,
            item_id=item.id,
            item_name=item.name,
            quantity=line.quantity,
            unit_price=price,
            cost_price_at_sale=item.cost_price,
            total=total,
            payment_mode=payload.payment_mode,
            payment_method_id=payment_method.id if payment_method else None,
            customer_name=customer_name,
            sold_by=current_user.username,
            receipt_no=receipt_no,
        )
        db.add(sale)
        sales.append(sale)

    if is_credit_sale:
        debtor = Debtor(
            account_id=account_id,
            name=customer_name,
            phone=payload.customer_phone or "",
            total_owed=grand_total,
            status=LedgerStatus.unpaid,
            note=f"Credit sale receipt {receipt_no}",
        )
        db.add(debtor)
        db.flush()  # need debtor.id before attaching item lines
        # One DebtorItem per cart line, so the Debtors page shows the same
        # itemized breakdown as the receipt, instead of just a lump total.
        for line, s in zip(payload.lines, sales):
            db.add(DebtorItem(
                debtor_id=debtor.id,
                item_id=line.item_id,
                description=s.item_name,
                quantity=s.quantity,
                unit_price=s.unit_price,
            ))

    db.commit()
    for s in sales:
        db.refresh(s)
    # Post each cart line to the general ledger (Dr Cash/AR, Cr Revenue [+ VAT
    # Payable], and Dr COGS / Cr Inventory when cost is known) — reuses the
    # same post_sale_entry() helper record_sale() already posts through, so
    # POS checkouts stop being the only sale path that never touches the
    # ledger. Mirrors record_sale()'s failure handling: a ledger-posting
    # error must never roll back a checkout that's already been given to the
    # customer as a printed receipt — log it as critical and let it be
    # reconciled manually instead.
    for s in sales:
        try:
            post_sale_entry(db, account_id, s, created_by=current_user.username)
        except ValueError as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_post_failed", str(e))
    overridden = sum(1 for line, s in zip(payload.lines, sales) if is_salesman_mode and line.unit_price is not None)
    mode_label = f"salesman mode, {overridden} price override(s)" if is_salesman_mode else "pos mode"
    log_activity_for_user(db, current_user, "pos_checkout",
                           f"Checkout {receipt_no} total {grand_total} ({mode_label})")
    return CheckoutResponse(receipt_no=receipt_no, sales=sales, total=grand_total)


@router.get("/", response_model=List[SaleOut])
def list_sales(start: Optional[date] = None, end: Optional[date] = None,
                db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    query = db.query(Sale)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    if start:
        query = query.filter(Sale.created_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(Sale.created_at <= datetime.combine(end, datetime.max.time()))
    return query.order_by(Sale.created_at.desc()).all()


@router.get("/stats/summary")
def sales_stats(db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    query = db.query(Sale)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    sales = query.all()
    total_revenue = sum(s.total for s in sales)
    total_qty = sum(s.quantity for s in sales)

    qty_by_item = defaultdict(float)
    revenue_by_item = defaultdict(float)
    for s in sales:
        qty_by_item[s.item_name] += s.quantity
        revenue_by_item[s.item_name] += s.total

    most_sold_item = None
    if qty_by_item:
        name = max(qty_by_item, key=qty_by_item.get)
        most_sold_item = {"item_name": name, "quantity": qty_by_item[name]}

    top_revenue_item = None
    if revenue_by_item:
        name = max(revenue_by_item, key=revenue_by_item.get)
        top_revenue_item = {"item_name": name, "revenue": round(revenue_by_item[name], 2)}

    return {
        "total_sales": len(sales),
        "total_revenue": round(total_revenue, 2),
        "total_quantity": total_qty,
        "average_sale": round(total_revenue / len(sales), 2) if sales else 0,
        "most_sold_item": most_sold_item,
        "top_revenue_item": top_revenue_item,
    }


@router.get("/customers/history")
def customer_purchase_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns each customer with the items they bought and when, for the Purchases Ledger view."""
    query = db.query(Sale)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    sales = query.order_by(Sale.created_at.desc()).all()
    grouped = {}
    for s in sales:
        key = s.customer_name or "Walk-in"
        grouped.setdefault(key, []).append({
            "item_name": s.item_name,
            "quantity": s.quantity,
            "unit_price": s.unit_price,
            "total": s.total,
            "payment_mode": s.payment_mode.value,
            "receipt_no": s.receipt_no,
            "date": s.created_at.isoformat(),
        })
    return [
        {
            "customer_name": name,
            "purchase_count": len(purchases),
            "total_spent": round(sum(p["total"] for p in purchases), 2),
            "last_purchase": purchases[0]["date"] if purchases else None,
            "purchases": purchases,
        }
        for name, purchases in grouped.items()
    ]


def _receipt_sales(db: Session, account_id, receipt_no: str):
    """All Sale rows on one receipt. Legacy sales that never got a receipt
    number are shown by the UI as 'SALE-<id>', so resolve those by id."""
    q = db.query(Sale)
    if account_id is not None:
        q = q.filter(Sale.account_id == account_id)
    sales = q.filter(Sale.receipt_no == receipt_no).order_by(Sale.id).all()
    if not sales and receipt_no.startswith("SALE-") and receipt_no[5:].isdigit():
        sales = q.filter(Sale.id == int(receipt_no[5:]), Sale.receipt_no.in_(["", None])).all()
    return sales


@router.put("/receipt/{receipt_no}")
def update_receipt(receipt_no: str, payload: ReceiptUpdate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_manager_up)):
    """Correct a receipt after the fact: client name, and per-line price /
    quantity / removal. Everything that hangs off the receipt is kept in step:

      * stock is adjusted by the quantity change (and refused if it would go
        negative),
      * the linked Debtor (credit sales) gets the new total, items and name,
      * the ledger is corrected by REVERSING the original journal entries and
        posting fresh ones -- posted entries are never edited in place, so the
        audit trail stays intact.

    A customer-name-only edit touches no money, so it is allowed even when the
    receipt's fiscal period is closed. Price/quantity edits are not.
    """
    account_id = get_account_filter(current_user)
    sales = _receipt_sales(db, account_id, receipt_no)
    if not sales:
        raise HTTPException(status_code=404, detail="Receipt not found")
    acct = sales[0].account_id
    by_id = {s.id: s for s in sales}

    # ---- validate -------------------------------------------------------
    new_name = None
    if payload.customer_name is not None:
        new_name = _normalize_customer_name(payload.customer_name)

    changes = {}  # sale_id -> {"qty": float, "price": float, "remove": bool}
    for ln in (payload.lines or []):
        sale = by_id.get(ln.sale_id)
        if sale is None:
            raise HTTPException(status_code=400, detail=f"Line {ln.sale_id} is not on receipt {receipt_no}")
        qty = sale.quantity if ln.quantity is None else ln.quantity
        price = sale.unit_price if ln.unit_price is None else ln.unit_price
        if not ln.remove:
            if qty <= 0:
                raise HTTPException(status_code=400, detail=f"Quantity for '{sale.item_name}' must be greater than zero")
            if price <= 0:
                raise HTTPException(status_code=400, detail=f"Price for '{sale.item_name}' must be greater than zero. "
                                                            "Zero-value sales are not permitted.")
        if ln.remove or qty != sale.quantity or price != sale.unit_price:
            changes[sale.id] = {"qty": qty, "price": price, "remove": ln.remove}

    removed_ids = {sid for sid, c in changes.items() if c["remove"]}
    if len(removed_ids) >= len(sales):
        raise HTTPException(status_code=400, detail="A receipt needs at least one line. Delete the whole sale instead.")
    financial = bool(changes)

    # ---- guard rails for money changes ---------------------------------
    stock_delta = {}  # item_id -> units to take OUT of stock (negative = put back)
    if financial:
        for s in sales:
            locked = get_locked_period(db, s.account_id, s.created_at)
            if locked is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"This receipt falls in the closed fiscal period '{locked.name}', so prices and "
                           "quantities can't be changed. You can still correct the customer name.",
                )
        for sid, c in changes.items():
            sale = by_id[sid]
            if not sale.item_id:
                continue
            new_qty = 0 if c["remove"] else c["qty"]
            stock_delta[sale.item_id] = stock_delta.get(sale.item_id, 0) + (new_qty - sale.quantity)
        items = {}
        for item_id, delta in stock_delta.items():
            item = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.account_id == acct).first()
            if item is None:
                continue  # item deleted since the sale; nothing to adjust
            if delta > 0 and item.quantity < delta:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for {item.name}: need {delta:g} more, {item.quantity:g} available")
            items[item_id] = item

    # ---- find the credit-sale debtor, if any ---------------------------
    is_credit = any(
        s.payment_mode == PaymentMode.credit or (s.payment_method is not None and s.payment_method.is_credit)
        for s in sales
    )
    debtor = None
    if is_credit:
        debtor = (db.query(Debtor)
                  .filter(Debtor.account_id == acct, Debtor.note == f"Credit sale receipt {receipt_no}")
                  .first())

    remaining = [s for s in sales if s.id not in removed_ids]
    new_total = sum((changes[s.id]["qty"] * changes[s.id]["price"]) if s.id in changes else s.total for s in remaining)
    if debtor is not None and financial and (debtor.amount_paid or 0) > round(new_total, 2):
        raise HTTPException(
            status_code=400,
            detail=f"{debtor.name} has already paid {debtor.amount_paid:,.0f}, which is more than the corrected "
                   f"total of {new_total:,.0f}. Adjust the payments on the Debtors page first.",
        )

    # ---- snapshot for the audit log ------------------------------------
    old_total = sum(s.total for s in sales)
    old_name = sales[0].customer_name
    notes = []

    # ---- apply ----------------------------------------------------------
    if new_name is not None and new_name != old_name:
        for s in sales:
            s.customer_name = new_name
        notes.append(f"client '{old_name}' -> '{new_name}'")
        if debtor is not None:
            debtor.name = new_name
    if debtor is not None and payload.customer_phone is not None:
        debtor.phone = payload.customer_phone.strip()

    if financial:
        for sid, c in changes.items():
            sale = by_id[sid]
            if c["remove"]:
                notes.append(f"removed {sale.item_name} x{sale.quantity:g}")
                db.delete(sale)
                continue
            if c["qty"] != sale.quantity:
                notes.append(f"{sale.item_name} qty {sale.quantity:g} -> {c['qty']:g}")
            if c["price"] != sale.unit_price:
                notes.append(f"{sale.item_name} price {sale.unit_price:,.0f} -> {c['price']:,.0f}")
            sale.quantity = c["qty"]
            sale.unit_price = c["price"]
            sale.total = round(c["qty"] * c["price"], 2)
        for item_id, delta in stock_delta.items():
            if item_id in items:
                items[item_id].quantity -= delta

        if debtor is not None:
            debtor.total_owed = round(new_total, 2)
            paid = debtor.amount_paid or 0
            debtor.status = (LedgerStatus.unpaid if paid <= 0
                             else LedgerStatus.paid if paid >= round(new_total, 2)
                             else LedgerStatus.partial)
            for di in list(debtor.items):
                db.delete(di)
            db.flush()
            for s in remaining:
                db.add(DebtorItem(debtor_id=debtor.id, item_id=s.item_id, description=s.item_name,
                                  quantity=s.quantity, unit_price=s.unit_price))
    db.commit()
    for s in remaining:
        db.refresh(s)

    # ---- ledger: reverse what was posted, post what's now true ----------
    ledger_warning = None
    if financial:
        reference = receipt_no if not receipt_no.startswith("SALE-") or sales[0].receipt_no else f"sale-{sales[0].id}"
        try:
            for entry in find_open_journal_entries_by_reference(db, acct, reference):
                reverse_journal_entry(db, acct, entry, created_by=current_user.username,
                                      reason=f"Receipt {receipt_no} corrected")
            for s in remaining:
                post_sale_entry(db, acct, s, created_by=current_user.username)
        except ValueError as e:
            ledger_warning = f"Receipt saved, but the ledger needs a manual correction: {e}"
            log_activity_for_user(db, current_user, "CRITICAL: ledger_repost_failed", f"{receipt_no}: {e}")

    if notes:
        log_activity_for_user(db, current_user, "receipt_edit",
                              f"Edited receipt {receipt_no} (total {old_total:,.0f} -> {new_total:,.0f}): " + "; ".join(notes))

    return {
        "receipt_no": receipt_no,
        "customer_name": remaining[0].customer_name,
        "total": round(sum(s.total for s in remaining), 2),
        "sales": [SaleOut.model_validate(s) for s in remaining],
        "ledger_warning": ledger_warning,
    }


@router.get("/by-item/{item_id}", response_model=List[SaleOut])
def sales_by_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    query = db.query(Sale).filter(Sale.item_id == item_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    return query.order_by(Sale.created_at.desc()).all()


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_sales_up)):
    query = db.query(Sale).filter(Sale.id == sale_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    sale = query.first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.delete("/{sale_id}")
def delete_sale(sale_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Sale).filter(Sale.id == sale_id)
    if account_id is not None:
        query = query.filter(Sale.account_id == account_id)
    sale = query.first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    original_entry = find_journal_entry_by_reference(db, account_id or sale.account_id, sale.receipt_no or f"sale-{sale.id}")
    if original_entry is not None:
        try:
            reverse_journal_entry(db, sale.account_id, original_entry, created_by=current_user.username,
                                   reason=f"Sale {sale_id} deleted")
        except FiscalPeriodLockedError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ValueError as e:
            log_activity_for_user(db, current_user, "CRITICAL: ledger_reversal_failed", str(e))

    if sale.item_id:
        item = db.query(InventoryItem).filter(InventoryItem.id == sale.item_id).first()
        if item:
            item.quantity += sale.quantity
    db.delete(sale)
    db.commit()
    log_activity_for_user(db, current_user, "sale_delete", f"Deleted sale {sale_id}, stock restored, ledger reversed")
    return {"detail": "Sale deleted, stock restored, and ledger entry reversed"}