from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Reminder, User, RoleEnum
from schemas import ReminderCreate, ReminderOut
from auth import get_current_user
from activity import log_activity_for_user

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    return current_user.account_id


@router.get("/", response_model=List[ReminderOut])
def list_reminders(include_done: bool = False, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    """Active reminders for the account, newest first — this is what feeds
    the clock bar. Past-due reminders still show until dismissed."""
    q = db.query(Reminder)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        q = q.filter(Reminder.account_id == account_id)
    if not include_done:
        q = q.filter(Reminder.is_done.is_(False))
    return q.order_by(Reminder.created_at.desc()).all()


@router.post("/", response_model=ReminderOut)
def create_reminder(payload: ReminderCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    if not payload.text.strip():
        raise HTTPException(400, "Reminder text is required")
    reminder = Reminder(
        account_id=current_user.account_id,
        created_by=current_user.username,
        text=payload.text.strip(),
        due_at=payload.due_at,
    )
    db.add(reminder); db.commit(); db.refresh(reminder)
    log_activity_for_user(db, current_user, "reminder_create", reminder.text)
    return reminder


@router.patch("/{reminder_id}/done", response_model=ReminderOut)
def complete_reminder(reminder_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    q = db.query(Reminder).filter(Reminder.id == reminder_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        q = q.filter(Reminder.account_id == account_id)
    reminder = q.first()
    if not reminder: raise HTTPException(404, "Reminder not found")
    reminder.is_done = True
    db.commit(); db.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}")
def delete_reminder(reminder_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    q = db.query(Reminder).filter(Reminder.id == reminder_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        q = q.filter(Reminder.account_id == account_id)
    reminder = q.first()
    if not reminder: raise HTTPException(404, "Reminder not found")
    db.delete(reminder); db.commit()
    return {"detail": "Reminder deleted"}
