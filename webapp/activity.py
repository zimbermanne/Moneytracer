from sqlalchemy.orm import Session
from models import ActivityLog, SuperadminAuditLog, User


def log_activity(db: Session, username: str, action: str, details: str = "", account_id: int = None):
    """Log an activity with optional account_id for multi-tenant scoping."""
    entry = ActivityLog(username=username, action=action, details=details, account_id=account_id)
    db.add(entry)
    db.commit()


def log_activity_for_user(db: Session, user: User, action: str, details: str = ""):
    """Log an activity for a specific user, automatically using their account_id."""
    account_id = user.account_id if user.account_id else None
    log_activity(db, user.username, action, details, account_id)


def log_superadmin_action(
    db: Session,
    superadmin: User,
    action: str,
    details: str = "",
    target_account_id: int = None,
    target_user_id: int = None,
    target_label: str = "",
):
    """Record a superadmin's action in the dedicated audit trail, separate
    from the tenant-facing ActivityLog. Call this alongside (not instead
    of) log_activity_for_user in superadmin.py — that call still gives the
    affected tenant visibility in their own activity feed; this one gives
    the platform owner a queryable-by-target record of what every
    superadmin has done. See models.SuperadminAuditLog for why this
    exists as its own table."""
    entry = SuperadminAuditLog(
        actor_username=superadmin.username,
        action=action,
        details=details,
        target_account_id=target_account_id,
        target_user_id=target_user_id,
        target_label=target_label,
    )
    db.add(entry)
    db.commit()
