"""Platform-level diagnostics and administration for superadmins.

This is deliberately separate from routers/accounts.py (which does the
per-account CRUD: list/get/update/suspend/delete). This module answers a
different question — not "manage one tenant" but "what's the health and
shape of the whole platform right now" — which is what the superadmin
console's dashboard and activity feed are built on top of.

Every endpoint here is require_superadmin-gated and gives a cross-account
view; nothing here is scoped by account_id the way the rest of the API is.
"""
import csv
import io
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Account, User, RoleEnum, AccountType, ActivityLog, SuperadminAuditLog,
    Sale, Purchase, Expense, Invoice, Quotation, PurchaseOrder,
    JournalEntry, FiscalPeriod, FiscalPeriodStatus, Reminder,
    Announcement, AnnouncementLevel, InventoryItem, SupportThread, SupportMessage,
    LoginSession, Attachment, MessageThread, Message
)
from schemas import (
    ActivityOut, AccountAdminOut, PlanUpdate, NotesUpdate, BulkAccountIds,
    RoleUpdate, AnnouncementCreate, AnnouncementOut, SuperadminAuditLogOut,
    InventoryOut, SuperadminUserOut, SuperadminSupportThreadOut, SupportMessageCreate, SupportMessageOut,
    LoginSessionOut, MessageThreadOut, MessageOut
)
from auth import require_superadmin
from activity import log_activity_for_user, log_superadmin_action
from pydantic import BaseModel

router = APIRouter(prefix="/api/superadmin", tags=["superadmin"])


# ---------- Platform stats ----------

@router.get("/stats")
def platform_stats(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    now = datetime.utcnow()
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_accounts = db.query(Account).count()
    active_accounts = db.query(Account).filter(Account.is_suspended.is_(False)).count()
    suspended_accounts = total_accounts - active_accounts

    # Plan breakdown
    plans = db.query(Account.plan, func.count(Account.id)).group_by(Account.plan).all()
    plan_breakdown = {p or "free": count for p, count in plans}

    signups_7d = db.query(Account).filter(Account.created_at >= since_7d).count()
    signups_30d = db.query(Account).filter(Account.created_at >= since_30d).count()

    total_users = db.query(User).filter(User.role != RoleEnum.superadmin).count()

    # Transaction leaderboard (Top 10 accounts by total transaction count)
    def _get_counts(model):
        return db.query(model.account_id, func.count(model.id).label("cnt")).group_by(model.account_id).subquery()

    s_counts = _get_counts(Sale)
    p_counts = _get_counts(Purchase)
    e_counts = _get_counts(Expense)
    i_counts = _get_counts(Invoice)

    combined_counts = (
        db.query(Account.id, Account.name,
                 (func.coalesce(s_counts.c.cnt, 0) +
                  func.coalesce(p_counts.c.cnt, 0) +
                  func.coalesce(e_counts.c.cnt, 0) +
                  func.coalesce(i_counts.c.cnt, 0)).label("total_tx"))
        .outerjoin(s_counts, Account.id == s_counts.c.account_id)
        .outerjoin(p_counts, Account.id == p_counts.c.account_id)
        .outerjoin(e_counts, Account.id == e_counts.c.account_id)
        .outerjoin(i_counts, Account.id == i_counts.c.account_id)
        .order_by(text("total_tx DESC"))
        .limit(10)
        .all()
    )
    leaderboard = [{"id": r[0], "name": r[1], "transactions": r[2]} for r in combined_counts]

    # Storage usage leaderboard
    storage_leaderboard = (
        db.query(Account.id, Account.name, func.sum(Attachment.file_size).label("total_bytes"))
        .join(Attachment, Account.id == Attachment.account_id)
        .group_by(Account.id, Account.name)
        .order_by(text("total_bytes DESC"))
        .limit(10)
        .all()
    )
    storage_leaderboard = [{"id": r[0], "name": r[1], "bytes": r[2]} for r in storage_leaderboard]

    # Regional breakdown (Top 10 regions)
    regions = (
        db.query(Account.region, func.count(Account.id))
        .filter(Account.region != "")
        .group_by(Account.region)
        .order_by(func.count(Account.id).desc())
        .limit(10)
        .all()
    )
    regional_breakdown = [{"region": r[0], "count": r[1]} for r in regions]

    # Recent signups
    recent_signups = (
        db.query(Account.id, Account.name, Account.created_at)
        .order_by(Account.created_at.desc())
        .limit(5)
        .all()
    )
    recent_signups_data = [{"id": r[0], "name": r[1], "created_at": r[2]} for r in recent_signups]

    # Recently active users (last 1 hour)
    active_now_threshold = now - timedelta(hours=1)
    active_now_count = (
        db.query(func.count(func.distinct(LoginSession.user_id)))
        .filter(LoginSession.created_at >= active_now_threshold)
        .scalar()
    )

    # Device adoption (PWA vs Browser) - 30d
    pwa_stats = (
        db.query(LoginSession.is_pwa, func.count(LoginSession.id))
        .filter(LoginSession.created_at >= since_30d)
        .group_by(LoginSession.is_pwa)
        .all()
    )
    pwa_breakdown = {("PWA" if is_pwa else "Browser"): count for is_pwa, count in pwa_stats}

    return {
        "accounts": {
            "total": total_accounts,
            "active": active_accounts,
            "suspended": suspended_accounts,
            "plans": plan_breakdown,
            "signups_last_7_days": signups_7d,
            "signups_last_30_days": signups_30d,
        },
        "users": {
            "total": total_users,
            "active_last_hour": active_now_count or 0,
        },
        "devices": {
            "pwa_adoption_30d": pwa_breakdown,
        },
        "leaderboard": leaderboard,
        "storage": storage_leaderboard,
        "regions": regional_breakdown,
        "recent_signups": recent_signups_data,
    }


# ---------- Cross-account activity feed ----------

@router.get("/activity", response_model=List[ActivityOut])
def platform_activity(
    critical_only: bool = Query(False, description="Only show CRITICAL: entries"),
    account_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None, description="Substring match on the action field"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    """The single most useful screen for 'is anything on fire right now':
    every CRITICAL:-tagged entry (ledger imbalances, locked-period
    violations, failed reversals, superadmin impersonation) across every
    tenant, in one feed — instead of having to open each account separately."""
    q = db.query(ActivityLog)
    if critical_only:
        q = q.filter(ActivityLog.action.like("CRITICAL:%"))
    if account_id is not None:
        q = q.filter(ActivityLog.account_id == account_id)
    if action:
        q = q.filter(ActivityLog.action.ilike(f"%{action}%"))
    return q.order_by(ActivityLog.created_at.desc()).offset(offset).limit(limit).all()


# ---------- Superadmin audit log ----------

@router.get("/audit-log", response_model=List[SuperadminAuditLogOut])
def superadmin_audit_log(
    actor: Optional[str] = Query(None, description="Substring match on actor_username"),
    action: Optional[str] = Query(None, description="Substring match on the action field"),
    target_account_id: Optional[int] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    q = db.query(SuperadminAuditLog)
    if actor:
        q = q.filter(SuperadminAuditLog.actor_username.ilike(f"%{actor}%"))
    if action:
        q = q.filter(SuperadminAuditLog.action.ilike(f"%{action}%"))
    if target_account_id is not None:
        q = q.filter(SuperadminAuditLog.target_account_id == target_account_id)
    if since:
        q = q.filter(SuperadminAuditLog.created_at >= since)
    if until:
        q = q.filter(SuperadminAuditLog.created_at <= until)
    return q.order_by(SuperadminAuditLog.created_at.desc()).offset(offset).limit(limit).all()


# ---------- Login sessions (IP / location / device, for UX optimization) ----------

@router.get("/login-sessions", response_model=List[LoginSessionOut])
def list_login_sessions(
    username: Optional[str] = Query(None, description="Substring match on username"),
    account_id: Optional[int] = Query(None),
    device_type: Optional[str] = Query(None, description="mobile / tablet / desktop / bot"),
    country: Optional[str] = Query(None, description="Substring match on country"),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    q = db.query(LoginSession)
    if username:
        q = q.filter(LoginSession.username.ilike(f"%{username}%"))
    if account_id is not None:
        q = q.filter(LoginSession.account_id == account_id)
    if device_type:
        q = q.filter(LoginSession.device_type == device_type)
    if country:
        q = q.filter(LoginSession.country.ilike(f"%{country}%"))
    if since:
        q = q.filter(LoginSession.created_at >= since)
    if until:
        q = q.filter(LoginSession.created_at <= until)
    return q.order_by(LoginSession.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/login-sessions/export")
def export_login_sessions(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    q = db.query(LoginSession)
    if since:
        q = q.filter(LoginSession.created_at >= since)
    if until:
        q = q.filter(LoginSession.created_at <= until)
    if account_id is not None:
        q = q.filter(LoginSession.account_id == account_id)
    entries = q.order_by(LoginSession.created_at.desc()).limit(20000).all()
    rows = [
        {
            "id": e.id,
            "username": e.username,
            "account_id": e.account_id,
            "ip_address": e.ip_address,
            "city": e.city,
            "region": e.region,
            "country": e.country,
            "isp": e.isp,
            "device_type": e.device_type,
            "os": e.os,
            "browser": e.browser,
            "event": e.event,
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
        for e in entries
    ]
    log_superadmin_action(
        db, superadmin, "export_login_sessions",
        details=f"Exported {len(rows)} login session entries to CSV",
        target_account_id=account_id,
    )
    return _csv_response(rows, "login_sessions_export.csv")


@router.get("/login-sessions/device-stats")
def login_session_device_stats(
    since: Optional[datetime] = Query(None, description="Defaults to the last 30 days"),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    since = since or (datetime.utcnow() - timedelta(days=30))
    base = db.query(LoginSession).filter(LoginSession.created_at >= since)
    total = base.count()

    def _breakdown(column):
        rows = (
            db.query(column, func.count(LoginSession.id))
            .filter(LoginSession.created_at >= since)
            .group_by(column)
            .order_by(func.count(LoginSession.id).desc())
            .all()
        )
        return [{"value": val or "unknown", "count": count} for val, count in rows]

    return {
        "since": since,
        "total_logins": total,
        "by_device_type": _breakdown(LoginSession.device_type),
        "by_os": _breakdown(LoginSession.os),
        "by_browser": _breakdown(LoginSession.browser),
        "by_country": _breakdown(LoginSession.country),
    }


# ---------- Support inbox (tenant messages to the superadmin) ----------

@router.get("/support/threads", response_model=List[MessageThreadOut])
def list_support_threads(
    status: Optional[str] = Query(None, description="'open' or 'closed'; omit for all"),
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    """List all support threads (recipient_account_id is null)."""
    q = db.query(MessageThread).filter(MessageThread.recipient_account_id == None)
    if status:
        q = q.filter(MessageThread.status == status)
    if unread_only:
        # For superadmin, unread means unread_by_recipient is FALSE (wait, recipient is null)
        # In my new model, if I am Support, I am effectively the recipient.
        # Let's say unread_by_recipient is used for Support if recipient_id is null.
        q = q.filter(MessageThread.unread_by_recipient == True)

    threads = q.order_by(MessageThread.last_message_at.desc()).all()

    out = []
    for t in threads:
        # See routers/support.py::list_my_threads for why this is built
        # manually rather than via model_validate(t) — same crash, same fix.
        obj = MessageThreadOut(
            id=t.id,
            creator_account_id=t.creator_account_id,
            recipient_account_id=t.recipient_account_id,
            subject=t.subject,
            status=t.status,
            last_message_at=t.last_message_at,
            last_message_preview=t.last_message_preview,
            created_at=t.created_at,
            messages=[],
        )
        obj.partner_name = t.creator_account.name if t.creator_account else "Unknown"
        obj.is_support = True
        obj.unread = t.unread_by_recipient
        out.append(obj)
    return out


@router.get("/support/threads/{thread_id}", response_model=MessageThreadOut)
def get_support_thread(thread_id: int, db: Session = Depends(get_db),
                        superadmin: User = Depends(require_superadmin)):
    thread = db.query(MessageThread).filter(
        MessageThread.id == thread_id,
        MessageThread.recipient_account_id == None
    ).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    if thread.unread_by_recipient:
        thread.unread_by_recipient = False
        db.commit()

    messages = (
        db.query(Message)
        .filter(Message.thread_id == thread.id)
        .order_by(Message.created_at.asc())
        .all()
    )

    obj = MessageThreadOut.model_validate(thread)
    obj.messages = [
        MessageOut(
            id=m.id,
            thread_id=m.thread_id,
            sender_username=m.sender_username or (m.sender_user.username if m.sender_user else None) or "Unknown",
            sender_account_id=m.sender_account_id,
            is_from_superadmin=m.is_from_superadmin,
            body=m.body,
            attachment_type=m.attachment_type,
            attachment_id=m.attachment_id,
            created_at=m.created_at
        ) for m in messages
    ]
    obj.partner_name = thread.creator_account.name if thread.creator_account else "Unknown"
    obj.is_support = True

    return obj


@router.post("/support/threads/{thread_id}/reply", response_model=MessageThreadOut)
def reply_to_support_thread(thread_id: int, payload: SupportMessageCreate, db: Session = Depends(get_db),
                             superadmin: User = Depends(require_superadmin)):
    thread = db.query(MessageThread).filter(
        MessageThread.id == thread_id,
        MessageThread.recipient_account_id == None
    ).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message can't be empty")

    now = datetime.utcnow()
    message = Message(
        thread_id=thread.id,
        sender_user_id=superadmin.id,
        sender_account_id=superadmin.account_id or 0, # Superadmins might not have an account
        sender_username=superadmin.username,
        is_from_superadmin=True,
        body=body,
        created_at=now,
    )
    db.add(message)

    thread.unread_by_creator = True
    thread.unread_by_recipient = False
    thread.last_message_at = now
    thread.last_message_preview = body[:200]
    db.commit()

    log_superadmin_action(
        db, superadmin, "support_reply", details=body[:120],
        target_account_id=thread.creator_account_id, target_label=f"thread #{thread.id}: {thread.subject}",
    )

    return get_support_thread(thread.id, db, superadmin)


@router.post("/support/threads/{thread_id}/close")
def close_support_thread(thread_id: int, db: Session = Depends(get_db),
                          superadmin: User = Depends(require_superadmin)):
    thread = db.query(MessageThread).filter(
        MessageThread.id == thread_id,
        MessageThread.recipient_account_id == None
    ).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread.status = "closed"
    db.commit()
    log_superadmin_action(
        db, superadmin, "support_thread_close",
        target_account_id=thread.creator_account_id, target_label=f"thread #{thread.id}: {thread.subject}",
    )
    return {"detail": "Thread closed"}


# ---------- System health / diagnostics ----------

class HealthOut(BaseModel):
    db_ok: bool
    db_error: Optional[str] = None
    scheduler_last_heartbeat: Optional[datetime] = None
    scheduler_minutes_since_heartbeat: Optional[float] = None
    scheduler_healthy: Optional[bool] = None
    table_counts: dict
    open_reminders: int


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    db_ok = True
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_ok = False
        db_error = str(e)

    heartbeat = (
        db.query(ActivityLog)
        .filter(ActivityLog.action == "scheduler_heartbeat")
        .order_by(ActivityLog.created_at.desc())
        .first()
    )
    minutes_since = None
    scheduler_healthy = None
    if heartbeat:
        minutes_since = (datetime.utcnow() - heartbeat.created_at).total_seconds() / 60
        scheduler_healthy = minutes_since < 26 * 60

    table_counts = {
        "accounts": db.query(Account).count(),
        "users": db.query(User).count(),
        "sales": db.query(Sale).count(),
        "purchases": db.query(Purchase).count(),
        "purchase_orders": db.query(PurchaseOrder).count(),
        "expenses": db.query(Expense).count(),
        "invoices": db.query(Invoice).count(),
        "quotations": db.query(Quotation).count(),
        "journal_entries": db.query(JournalEntry).count(),
        "activity_log_entries": db.query(ActivityLog).count(),
        "superadmin_audit_log_entries": db.query(SuperadminAuditLog).count(),
    }

    open_reminders = db.query(Reminder).filter(Reminder.is_done.is_(False)).count()

    return HealthOut(
        db_ok=db_ok, db_error=db_error,
        scheduler_last_heartbeat=heartbeat.created_at if heartbeat else None,
        scheduler_minutes_since_heartbeat=minutes_since,
        scheduler_healthy=scheduler_healthy,
        table_counts=table_counts,
        open_reminders=open_reminders,
    )


# ---------- Plan / internal notes ----------

def _csv_response(rows: List[dict], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/accounts/export")
def export_accounts(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    accounts = db.query(Account).order_by(Account.created_at.desc()).all()
    rows = [
        {
            "id": a.id,
            "name": a.name,
            "account_type": a.account_type.value if a.account_type else "",
            "owner_full_name": a.owner_full_name,
            "email": a.email,
            "phone": a.phone,
            "plan": a.plan,
            "is_suspended": a.is_suspended,
            "onboarding_completed": a.onboarding_completed,
            "created_at": a.created_at.isoformat() if a.created_at else "",
        }
        for a in accounts
    ]
    log_activity_for_user(db, superadmin, "export_accounts", f"Exported {len(rows)} account(s) to CSV")
    log_superadmin_action(db, superadmin, "export_accounts", details=f"Exported {len(rows)} account(s)")
    return _csv_response(rows, "accounts_export.csv")


@router.get("/users/export")
def export_all_users(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    users = db.query(User).filter(User.is_demo == False).all()  # noqa: E712
    account_ids = {u.account_id for u in users if u.account_id}
    names = dict(
        db.query(Account.id, Account.name).filter(Account.id.in_(account_ids)).all()
    ) if account_ids else {}

    rows = [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role.value if u.role else "",
            "account_id": u.account_id,
            "account_name": names.get(u.account_id) or "",
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else "",
        }
        for u in users
    ]
    log_superadmin_action(db, superadmin, "export_users", details=f"Exported {len(rows)} users")
    return _csv_response(rows, "users_export.csv")


@router.get("/accounts/{account_id}", response_model=AccountAdminOut)
def get_account_admin_view(account_id: int, db: Session = Depends(get_db),
                            superadmin: User = Depends(require_superadmin)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    users = db.query(User).filter(User.account_id == account_id).all()
    return AccountAdminOut(**account.__dict__, users=users)


@router.get("/accounts/{account_id}/items", response_model=List[InventoryOut])
def get_account_items(account_id: int, db: Session = Depends(get_db),
                       superadmin: User = Depends(require_superadmin)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return (
        db.query(InventoryItem)
        .filter(InventoryItem.account_id == account_id)
        .order_by(InventoryItem.name)
        .all()
    )


@router.put("/accounts/{account_id}/plan")
def update_plan(account_id: int, payload: PlanUpdate, db: Session = Depends(get_db),
                 superadmin: User = Depends(require_superadmin)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    old_plan = account.plan
    account.plan = payload.plan
    db.commit()
    log_activity_for_user(
        db, superadmin, "account_plan_change",
        f"Changed plan for {account.name} from '{old_plan}' to '{payload.plan}'",
    )
    log_superadmin_action(
        db, superadmin, "account_plan_change",
        details=f"Plan '{old_plan}' -> '{payload.plan}'",
        target_account_id=account.id, target_label=account.name,
    )
    return {"detail": f"Plan updated to {payload.plan}", "plan": account.plan}


@router.put("/accounts/{account_id}/notes")
def update_notes(account_id: int, payload: NotesUpdate, db: Session = Depends(get_db),
                  superadmin: User = Depends(require_superadmin)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.admin_notes = payload.admin_notes
    db.commit()
    log_activity_for_user(db, superadmin, "account_notes_update", f"Updated internal notes for {account.name}")
    log_superadmin_action(
        db, superadmin, "account_notes_update",
        details="Internal notes updated (contents not logged)",
        target_account_id=account.id, target_label=account.name,
    )
    return {"detail": "Notes updated"}


# ---------- Bulk account actions ----------

@router.post("/accounts/bulk-suspend")
def bulk_suspend(payload: BulkAccountIds, db: Session = Depends(get_db),
                  superadmin: User = Depends(require_superadmin)):
    accounts = db.query(Account).filter(Account.id.in_(payload.account_ids)).all()
    found_ids = {a.id for a in accounts}
    for account in accounts:
        account.is_suspended = True
    if found_ids:
        db.query(User).filter(User.account_id.in_(found_ids)).update(
            {User.token_version: User.token_version + 1}, synchronize_session=False
        )
    db.commit()
    log_activity_for_user(db, superadmin, "bulk_account_suspend", f"Bulk-suspended {len(found_ids)} account(s)")
    for aid in found_ids:
        log_superadmin_action(db, superadmin, "account_suspend", target_account_id=aid)
    missing = set(payload.account_ids) - found_ids
    return {"suspended": sorted(found_ids), "not_found": sorted(missing)}


@router.post("/accounts/bulk-activate")
def bulk_activate(payload: BulkAccountIds, db: Session = Depends(get_db),
                   superadmin: User = Depends(require_superadmin)):
    accounts = db.query(Account).filter(Account.id.in_(payload.account_ids)).all()
    found_ids = {a.id for a in accounts}
    for account in accounts:
        account.is_suspended = False
    db.commit()
    log_activity_for_user(db, superadmin, "bulk_account_activate", f"Bulk-activated {len(found_ids)} account(s) ")
    for aid in found_ids:
        log_superadmin_action(db, superadmin, "account_activate", target_account_id=aid)
    missing = set(payload.account_ids) - found_ids
    return {"activated": sorted(found_ids), "not_found": sorted(missing)}


# ---------- Force logout ----------

@router.post("/accounts/{account_id}/force-logout")
def force_logout_account(account_id: int, db: Session = Depends(get_db),
                          superadmin: User = Depends(require_superadmin)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    updated = db.query(User).filter(User.account_id == account_id).update(
        {User.token_version: User.token_version + 1}
    )
    db.commit()
    log_activity_for_user(db, superadmin, "force_logout_account", f"Force-logged-out all users of {account.name}")
    log_superadmin_action(
        db, superadmin, "force_logout_account", details=f"Logged out {updated} user(s)",
        target_account_id=account.id, target_label=account.name,
    )
    return {"detail": f"Logged out {updated} user(s) of {account.name}"}


@router.post("/users/{user_id}/force-logout")
def force_logout_user(user_id: int, db: Session = Depends(get_db),
                       superadmin: User = Depends(require_superadmin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    log_activity_for_user(db, superadmin, "force_logout_user", f"Force-logged-out {user.username}")
    log_superadmin_action(
        db, superadmin, "force_logout_user",
        target_account_id=user.account_id, target_user_id=user.id, target_label=user.username,
    )
    return {"detail": f"Logged out {user.username}"}


# ---------- Superadmin user management (cross-account) ----------

@router.get("/users", response_model=List[SuperadminUserOut])
def list_all_users(
    q: Optional[str] = Query(None, description="Substring match on username, full_name, or email"),
    account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    query = db.query(User).filter(User.is_demo == False)  # noqa: E712
    if account_id is not None:
        query = query.filter(User.account_id == account_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            (User.username.ilike(like)) | (User.full_name.ilike(like)) | (User.email.ilike(like))
        )
    users = query.order_by(User.username).all()

    account_ids = {u.account_id for u in users if u.account_id}
    names = dict(
        db.query(Account.id, Account.name).filter(Account.id.in_(account_ids)).all()
    ) if account_ids else {}
    return [
        SuperadminUserOut(**{c.name: getattr(u, c.name) for c in User.__table__.columns},
                           account_name=names.get(u.account_id))
        for u in users
    ]


@router.put("/users/{user_id}/role", response_model=None)
def change_user_role(user_id: int, payload: RoleUpdate, db: Session = Depends(get_db),
                      superadmin: User = Depends(require_superadmin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    old_role = user.role.value
    user.role = payload.role
    db.commit()
    log_activity_for_user(
        db, superadmin, "user_role_change",
        f"Changed {user.username}'s role from {old_role} to {payload.role.value}",
    )
    log_superadmin_action(
        db, superadmin, "user_role_change",
        details=f"Role '{old_role}' -> '{payload.role.value}'",
        target_account_id=user.account_id, target_user_id=user.id, target_label=user.username,
    )
    return {"detail": f"{user.username} is now {payload.role.value}"}


@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, db: Session = Depends(get_db),
                     superadmin: User = Depends(require_superadmin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    log_activity_for_user(db, superadmin, "user_deactivate", f"Deactivated {user.username}")
    log_superadmin_action(
        db, superadmin, "user_deactivate",
        target_account_id=user.account_id, target_user_id=user.id, target_label=user.username,
    )
    return {"detail": f"{user.username} deactivated"}


@router.post("/users/{user_id}/activate")
def activate_user(user_id: int, db: Session = Depends(get_db),
                   superadmin: User = Depends(require_superadmin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    db.commit()
    log_activity_for_user(db, superadmin, "user_activate", f"Activated {user.username}")
    log_superadmin_action(
        db, superadmin, "user_activate",
        target_account_id=user.account_id, target_user_id=user.id, target_label=user.username,
    )
    return {"detail": f"{user.username} activated"}


class SuperadminPasswordReset(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
def superadmin_reset_password(user_id: int, payload: SuperadminPasswordReset,
                               db: Session = Depends(get_db),
                               superadmin: User = Depends(require_superadmin)):
    from auth import hash_password
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_demo:
        raise HTTPException(status_code=403, detail="Cannot reset the demo account's password")
    user.hashed_password = hash_password(payload.new_password)
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    log_activity_for_user(db, superadmin, "superadmin_reset_password", f"Reset password for {user.username}")
    log_superadmin_action(
        db, superadmin, "reset_password",
        target_account_id=user.account_id, target_user_id=user.id, target_label=user.username,
    )
    return {"detail": f"Password reset for {user.username}"}


# ---------- CSV export (activity) ----------

@router.get("/activity/export")
def export_activity(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    critical_only: bool = Query(False),
    account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    q = db.query(ActivityLog)
    if since:
        q = q.filter(ActivityLog.created_at >= since)
    if until:
        q = q.filter(ActivityLog.created_at <= until)
    if critical_only:
        q = q.filter(ActivityLog.action.like("CRITICAL:%"))
    if account_id is not None:
        q = q.filter(ActivityLog.account_id == account_id)
    entries = q.order_by(ActivityLog.created_at.desc()).limit(10000).all()
    rows = [
        {
            "id": e.id,
            "account_id": e.account_id,
            "username": e.username,
            "action": e.action,
            "details": e.details,
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
        for e in entries
    ]
    log_activity_for_user(db, superadmin, "export_activity", f"Exported {len(rows)} activity log entries to CSV")
    log_superadmin_action(
        db, superadmin, "export_activity",
        details=f"Exported {len(rows)} entries (account_id={account_id}, critical_only={critical_only})",
        target_account_id=account_id,
    )
    return _csv_response(rows, "activity_export.csv")


@router.get("/audit-log/export")
def export_audit_log(
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    target_account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    superadmin: User = Depends(require_superadmin),
):
    q = db.query(SuperadminAuditLog)
    if since:
        q = q.filter(SuperadminAuditLog.created_at >= since)
    if until:
        q = q.filter(SuperadminAuditLog.created_at <= until)
    if target_account_id is not None:
        q = q.filter(SuperadminAuditLog.target_account_id == target_account_id)
    entries = q.order_by(SuperadminAuditLog.created_at.desc()).limit(10000).all()
    rows = [
        {
            "id": e.id,
            "actor_username": e.actor_username,
            "action": e.action,
            "target_account_id": e.target_account_id,
            "target_user_id": e.target_user_id,
            "target_label": e.target_label,
            "details": e.details,
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
        for e in entries
    ]
    return _csv_response(rows, "superadmin_audit_log_export.csv")


# ---------- Platform announcements ----------

@router.get("/announcements", response_model=List[AnnouncementOut])
def list_announcements(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    return db.query(Announcement).order_by(Announcement.created_at.desc()).all()


@router.post("/announcements", response_model=AnnouncementOut)
def create_announcement(payload: AnnouncementCreate, db: Session = Depends(get_db),
                         superadmin: User = Depends(require_superadmin)):
    try:
        level = AnnouncementLevel(payload.level)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid level: {payload.level}")
    announcement = Announcement(message=payload.message, level=level, created_by=superadmin.username)
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    log_activity_for_user(db, superadmin, "announcement_create", f"Posted announcement: {payload.message[:80]}")
    log_superadmin_action(
        db, superadmin, "announcement_create",
        details=f"[{level.value}] {payload.message[:120]}", target_label=f"announcement #{announcement.id}",
    )
    return announcement


@router.post("/announcements/{announcement_id}/deactivate")
def deactivate_announcement(announcement_id: int, db: Session = Depends(get_db),
                             superadmin: User = Depends(require_superadmin)):
    announcement = db.query(Announcement).filter(Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    announcement.is_active = False
    db.commit()
    log_activity_for_user(db, superadmin, "announcement_deactivate", f"Deactivated announcement #{announcement_id}")
    log_superadmin_action(
        db, superadmin, "announcement_deactivate", target_label=f"announcement #{announcement_id}",
    )
    return {"detail": "Announcement deactivated"}
