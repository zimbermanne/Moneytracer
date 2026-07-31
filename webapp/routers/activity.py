from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from database import get_db
from auth import get_current_user
from models import ActivityLog, User

router = APIRouter(prefix="/api/activity", tags=["activity"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ActivityLogOut(BaseModel):
    id: int
    username: str
    action: str
    details: str
    created_at: datetime

    class Config:
        from_attributes = True


class ActivityLogCreate(BaseModel):
    action: str
    details: str = ""


# ── Helper functions (used by other routers) ──────────────────────────────────

def log_activity(db: Session, username: str, action: str, details: str = "", account_id: int = None):
    """Log an activity with optional account_id for multi-tenant scoping."""
    entry = ActivityLog(username=username, action=action, details=details, account_id=account_id)
    db.add(entry)
    db.commit()


def log_activity_for_user(db: Session, user: User, action: str, details: str = ""):
    """Log an activity for a specific user, automatically using their account_id."""
    account_id = user.account_id if user.account_id else None
    log_activity(db, user.username, action, details, account_id)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/log", status_code=200)
def post_activity_log(
    payload: ActivityLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Frontend-facing endpoint to log an activity action."""
    log_activity_for_user(db, current_user, payload.action, payload.details)
    return {"status": "logged"}


@router.get("/", response_model=List[ActivityLogOut])
def get_activity_logs(
    limit: int = Query(500, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return recent activity logs for the current user's account."""
    query = db.query(ActivityLog)
    if current_user.account_id:
        query = query.filter(ActivityLog.account_id == current_user.account_id)
    logs = query.order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return logs


@router.get("/stats")
def get_activity_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a summary count of actions grouped by type."""
    query = db.query(ActivityLog.action, func.count(ActivityLog.id).label("count"))
    if current_user.account_id:
        query = query.filter(ActivityLog.account_id == current_user.account_id)
    results = query.group_by(ActivityLog.action).all()
    return [{"action": r.action, "count": r.count} for r in results]
