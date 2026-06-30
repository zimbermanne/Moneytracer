from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, User
from schemas import ActivityOut
from auth import require_manager_up

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("/", response_model=List[ActivityOut])
def list_activity(limit: int = 100, db: Session = Depends(get_db),
                   current_user: User = Depends(require_manager_up)):
    return db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit).all()


@router.get("/stats")
def activity_stats(db: Session = Depends(get_db), current_user: User = Depends(require_manager_up)):
    logs = db.query(ActivityLog).all()
    by_user = {}
    by_action = {}
    for log in logs:
        by_user[log.username] = by_user.get(log.username, 0) + 1
        by_action[log.action] = by_action.get(log.action, 0) + 1
    return {"total_events": len(logs), "by_user": by_user, "by_action": by_action}
