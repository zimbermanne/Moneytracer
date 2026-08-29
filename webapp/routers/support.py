"""Tenant-facing 'contact support' — lets any logged-in tenant user leave a
message for the platform superadmin, and see/continue the conversation.

The superadmin side of this (list every account's threads, reply, close)
lives in routers/superadmin.py next to the rest of the cross-account admin
endpoints, not here — this file only ever sees the current user's own
account_id, the same scoping every other tenant router uses.
"""
from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import SupportThread, SupportMessage, User
from schemas import SupportThreadOut, SupportThreadCreate, SupportMessageCreate, SupportMessageOut
from auth import get_current_user, require_account_user
from activity import log_activity_for_user

router = APIRouter(prefix="/api/support", tags=["support"])


@router.get("/threads", response_model=List[SupportThreadOut])
def list_my_threads(db: Session = Depends(get_db), current_user: User = Depends(require_account_user)):
    return (
        db.query(SupportThread)
        .filter(SupportThread.account_id == current_user.account_id)
        .order_by(SupportThread.last_message_at.desc())
        .all()
    )


@router.get("/threads/{thread_id}", response_model=SupportThreadOut)
def get_my_thread(thread_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(require_account_user)):
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread or thread.account_id != current_user.account_id:
        raise HTTPException(status_code=404, detail="Thread not found")
    if thread.unread_by_tenant:
        thread.unread_by_tenant = False
        db.commit()
    messages = (
        db.query(SupportMessage)
        .filter(SupportMessage.thread_id == thread.id)
        .order_by(SupportMessage.created_at.asc())
        .all()
    )
    out = SupportThreadOut.model_validate(thread)
    out.messages = [SupportMessageOut.model_validate(m) for m in messages]
    return out


@router.post("/threads", response_model=SupportThreadOut)
def create_thread(payload: SupportThreadCreate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_account_user)):
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message can't be empty")
    now = datetime.utcnow()
    thread = SupportThread(
        account_id=current_user.account_id,
        subject=(payload.subject or "").strip()[:200] or "(no subject)",
        created_by_user_id=current_user.id,
        created_by_username=current_user.username,
        last_message_preview=body[:200],
        last_message_at=now,
    )
    db.add(thread)
    db.flush()  # get thread.id before the message insert
    message = SupportMessage(
        thread_id=thread.id,
        sender_user_id=current_user.id,
        sender_username=current_user.username,
        sender_is_superadmin=False,
        body=body,
        created_at=now,
    )
    db.add(message)
    db.commit()
    db.refresh(thread)
    log_activity_for_user(db, current_user, "support_message_sent", f"New thread: {thread.subject}")
    out = SupportThreadOut.model_validate(thread)
    out.messages = [SupportMessageOut.model_validate(message)]
    return out


@router.post("/threads/{thread_id}/messages", response_model=SupportThreadOut)
def reply_to_thread(thread_id: int, payload: SupportMessageCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_account_user)):
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread or thread.account_id != current_user.account_id:
        raise HTTPException(status_code=404, detail="Thread not found")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message can't be empty")
    if thread.status == "closed":
        thread.status = "open"  # replying reopens it
    now = datetime.utcnow()
    message = SupportMessage(
        thread_id=thread.id,
        sender_user_id=current_user.id,
        sender_username=current_user.username,
        sender_is_superadmin=False,
        body=body,
        created_at=now,
    )
    db.add(message)
    thread.unread_by_superadmin = True
    thread.unread_by_tenant = False
    thread.last_message_at = now
    thread.last_message_preview = body[:200]
    db.commit()
    log_activity_for_user(db, current_user, "support_message_sent", f"Replied in thread #{thread.id}")
    messages = (
        db.query(SupportMessage)
        .filter(SupportMessage.thread_id == thread.id)
        .order_by(SupportMessage.created_at.asc())
        .all()
    )
    out = SupportThreadOut.model_validate(thread)
    out.messages = [SupportMessageOut.model_validate(m) for m in messages]
    return out
