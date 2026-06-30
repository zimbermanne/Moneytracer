from sqlalchemy.orm import Session
from models import ActivityLog


def log_activity(db: Session, username: str, action: str, details: str = ""):
    entry = ActivityLog(username=username, action=action, details=details)
    db.add(entry)
    db.commit()
