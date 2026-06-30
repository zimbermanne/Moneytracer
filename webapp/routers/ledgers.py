from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Debtor, Creditor, User, LedgerStatus
from schemas import DebtorCreate, CreditorCreate, LedgerOut, PaymentRequest
from auth import get_current_user
from activity import log_activity

router = APIRouter(prefix="/api/ledgers", tags=["ledgers"])


def _update_status(entry):
    if entry.amount_paid <= 0:
        entry.status = LedgerStatus.unpaid
    elif entry.amount_paid >= entry.total_owed:
        entry.status = LedgerStatus.paid
    else:
        entry.status = LedgerStatus.partial


@router.get("/debtors", response_model=List[LedgerOut])
def list_debtors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Debtor).order_by(Debtor.created_at.desc()).all()


@router.post("/debtors", response_model=LedgerOut)
def add_debtor(payload: DebtorCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    debtor = Debtor(**payload.model_dump())
    db.add(debtor)
    db.commit()
    db.refresh(debtor)
    log_activity(db, current_user.username, "debtor_add", f"Added debtor {debtor.name}")
    return debtor


@router.post("/debtors/pay/{debtor_id}", response_model=LedgerOut)
def pay_debtor(debtor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    debtor = db.query(Debtor).filter(Debtor.id == debtor_id).first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")
    debtor.amount_paid += payload.amount
    _update_status(debtor)
    db.commit()
    db.refresh(debtor)
    log_activity(db, current_user.username, "debtor_payment", f"{debtor.name} paid {payload.amount}")
    return debtor


@router.get("/creditors", response_model=List[LedgerOut])
def list_creditors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Creditor).order_by(Creditor.created_at.desc()).all()


@router.post("/creditors", response_model=LedgerOut)
def add_creditor(payload: CreditorCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    creditor = Creditor(**payload.model_dump())
    db.add(creditor)
    db.commit()
    db.refresh(creditor)
    log_activity(db, current_user.username, "creditor_add", f"Added creditor {creditor.name}")
    return creditor


@router.post("/creditors/pay/{creditor_id}", response_model=LedgerOut)
def pay_creditor(creditor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    creditor = db.query(Creditor).filter(Creditor.id == creditor_id).first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    creditor.amount_paid += payload.amount
    _update_status(creditor)
    db.commit()
    db.refresh(creditor)
    log_activity(db, current_user.username, "creditor_payment", f"Paid {creditor.name} {payload.amount}")
    return creditor
