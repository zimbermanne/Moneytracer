"""Compliance deadline tracking — TRA (PAYE/SDL/VAT), BRELA annual fee,
business name renewal, NSSF/WCF/OSHA, or any custom recurring obligation.

This router only holds CRUD for the "what/when/how often". The actual
reminder generation (checking who's within their alert window: 7/1 days
for monthly, 30/14/7/1 for yearly) runs in scheduler.py alongside the
existing overdue-invoice job, and rolls due_date forward automatically
once a recurring deadline's date has passed.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ComplianceDeadline, User, RoleEnum
from schemas import ComplianceDeadlineCreate, ComplianceDeadlineUpdate, ComplianceDeadlineOut
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user

router = APIRouter(prefix="/api/deadlines", tags=["deadlines"])


def get_account_filter(current_user: User):
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


@router.get("/", response_model=List[ComplianceDeadlineOut])
def list_deadlines(active_only: bool = True, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(ComplianceDeadline)
    if account_id is not None:
        q = q.filter(ComplianceDeadline.account_id == account_id)
    if active_only:
        q = q.filter(ComplianceDeadline.is_active.is_(True))
    return q.order_by(ComplianceDeadline.due_date.asc()).all()


@router.post("/", response_model=ComplianceDeadlineOut)
def create_deadline(payload: ComplianceDeadlineCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create deadlines")

    deadline = ComplianceDeadline(
        account_id=account_id,
        deadline_type=payload.deadline_type,
        label=payload.label,
        due_date=payload.due_date,
        recurrence=payload.recurrence,
        notes=payload.notes or "",
        created_by=current_user.username,
    )
    db.add(deadline)
    db.commit()
    db.refresh(deadline)
    log_activity_for_user(db, current_user, "deadline_create", f"Added deadline: {deadline.label}")
    return deadline


@router.put("/{deadline_id}", response_model=ComplianceDeadlineOut)
def update_deadline(deadline_id: int, payload: ComplianceDeadlineUpdate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(ComplianceDeadline).filter(ComplianceDeadline.id == deadline_id)
    if account_id is not None:
        q = q.filter(ComplianceDeadline.account_id == account_id)
    deadline = q.first()
    if not deadline:
        raise HTTPException(status_code=404, detail="Deadline not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(deadline, field, value)
    db.commit()
    db.refresh(deadline)
    log_activity_for_user(db, current_user, "deadline_update", f"Updated deadline {deadline_id}")
    return deadline


@router.delete("/{deadline_id}")
def delete_deadline(deadline_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(ComplianceDeadline).filter(ComplianceDeadline.id == deadline_id)
    if account_id is not None:
        q = q.filter(ComplianceDeadline.account_id == account_id)
    deadline = q.first()
    if not deadline:
        raise HTTPException(status_code=404, detail="Deadline not found")
    db.delete(deadline)
    db.commit()
    log_activity_for_user(db, current_user, "deadline_delete", f"Deleted deadline {deadline_id}")
    return {"detail": "Deadline deleted"}
