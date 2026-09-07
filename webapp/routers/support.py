"""Unified messaging system. Handles:
1. Tenant <-> Superadmin Support (recipient_account_id IS NULL)
2. Tenant <-> Tenant Direct Messaging (recipient_account_id NOT NULL)
3. Document sharing (Invoices, Quotations, Receipts)
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import MessageThread, Message, User, Account, RoleEnum
from schemas import (
    MessageThreadOut, SupportThreadCreate, MessageCreate, MessageOut
)
from auth import get_current_user, require_account_user
from activity import log_activity_for_user

router = APIRouter(prefix="/api/messages", tags=["messaging"])


@router.get("/unread-count")
def get_unread_count(db: Session = Depends(get_db), current_user: User = Depends(require_account_user)):
    """Returns the number of threads with unread messages for the current tenant."""
    # Threads where I am the creator and unread_by_creator is true
    count_a = db.query(MessageThread).filter(
        MessageThread.creator_account_id == current_user.account_id,
        MessageThread.unread_by_creator == True
    ).count()

    # Threads where I am the recipient and unread_by_recipient is true
    count_b = db.query(MessageThread).filter(
        MessageThread.recipient_account_id == current_user.account_id,
        MessageThread.unread_by_recipient == True
    ).count()

    return {"count": count_a + count_b}


@router.get("/threads", response_model=List[MessageThreadOut])
def list_my_threads(db: Session = Depends(get_db), current_user: User = Depends(require_account_user)):
    """List all conversations for the current tenant (Support + Peer)."""
    threads = db.query(MessageThread).filter(
        or_(
            MessageThread.creator_account_id == current_user.account_id,
            MessageThread.recipient_account_id == current_user.account_id
        )
    ).order_by(MessageThread.last_message_at.desc()).all()

    out = []
    for t in threads:
        # Built manually rather than MessageThreadOut.model_validate(t) —
        # that auto-pulls the ORM `messages` relationship and validates
        # every nested Message (including sender_username, which historical
        # rows can have NULL for), which is both wasteful for a list view
        # that only needs last_message_preview, and exactly what was
        # crashing this endpoint with a 500 on every request. get_thread()
        # below is where full message history actually gets built, with a
        # defensive fallback for that same column.
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

        # Set unread flag from current tenant's perspective
        if t.creator_account_id == current_user.account_id:
            obj.unread = t.unread_by_creator
            partner = t.recipient_account
        else:
            obj.unread = t.unread_by_recipient
            partner = t.creator_account

        obj.is_support = (t.recipient_account_id is None)
        obj.partner_name = partner.name if partner else "Moneytracer Support"
        out.append(obj)

    return out


@router.get("/threads/{thread_id}", response_model=MessageThreadOut)
def get_thread(thread_id: int, db: Session = Depends(get_db),
               current_user: User = Depends(require_account_user)):
    thread = db.query(MessageThread).filter(
        MessageThread.id == thread_id,
        or_(
            MessageThread.creator_account_id == current_user.account_id,
            MessageThread.recipient_account_id == current_user.account_id
        )
    ).first()

    if not thread:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Mark as read for this tenant
    if thread.creator_account_id == current_user.account_id:
        if thread.unread_by_creator:
            thread.unread_by_creator = False
            db.commit()
    else:
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
            # Prefer the denormalized column (set at send time as of this
            # fix); fall back to the live relationship, then a plain
            # placeholder — covers historical rows from before this column
            # was populated, and the rare case of a since-deleted sender.
            sender_username=m.sender_username or (m.sender_user.username if m.sender_user else None) or "Unknown",
            sender_account_id=m.sender_account_id,
            is_from_superadmin=m.is_from_superadmin,
            body=m.body,
            attachment_type=m.attachment_type,
            attachment_id=m.attachment_id,
            created_at=m.created_at
        ) for m in messages
    ]

    partner = thread.recipient_account if thread.creator_account_id == current_user.account_id else thread.creator_account
    obj.partner_name = partner.name if partner else "Moneytracer Support"
    obj.is_support = (thread.recipient_account_id is None)

    return obj


@router.post("/threads", response_model=MessageThreadOut)
def create_thread(payload: SupportThreadCreate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_account_user)):
    """Start a new conversation with Support or another Business."""
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message can't be empty")

    recipient_id = payload.recipient_account_id
    if recipient_id == current_user.account_id:
        raise HTTPException(status_code=400, detail="You cannot message yourself")

    # Check if recipient exists if provided
    if recipient_id:
        recipient = db.query(Account).filter(Account.id == recipient_id).first()
        if not recipient:
            raise HTTPException(status_code=404, detail="Recipient account not found")

    now = datetime.utcnow()
    thread = MessageThread(
        creator_account_id=current_user.account_id,
        recipient_account_id=recipient_id,
        subject=(payload.subject or "").strip()[:200] or (f"Shared {payload.attachment_type}" if payload.attachment_type else "(no subject)"),
        last_message_preview=body[:200],
        last_message_at=now,
        unread_by_creator=False,
        unread_by_recipient=True
    )
    db.add(thread)
    db.flush()

    message = Message(
        thread_id=thread.id,
        sender_user_id=current_user.id,
        sender_account_id=current_user.account_id,
        sender_username=current_user.username,
        body=body,
        attachment_type=payload.attachment_type,
        attachment_id=payload.attachment_id,
        created_at=now
    )
    db.add(message)
    db.commit()
    db.refresh(thread)

    log_activity_for_user(db, current_user, "message_sent", f"Started conversation: {thread.subject}")
    return get_thread(thread.id, db, current_user)


@router.post("/threads/{thread_id}/messages", response_model=MessageThreadOut)
def reply_to_thread(thread_id: int, payload: MessageCreate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_account_user)):
    thread = db.query(MessageThread).filter(
        MessageThread.id == thread_id,
        or_(
            MessageThread.creator_account_id == current_user.account_id,
            MessageThread.recipient_account_id == current_user.account_id
        )
    ).first()

    if not thread:
        raise HTTPException(status_code=404, detail="Conversation not found")

    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message can't be empty")

    now = datetime.utcnow()
    message = Message(
        thread_id=thread.id,
        sender_user_id=current_user.id,
        sender_account_id=current_user.account_id,
        sender_username=current_user.username,
        body=body,
        attachment_type=payload.attachment_type,
        attachment_id=payload.attachment_id,
        created_at=now
    )
    db.add(message)

    # Update unread flags based on who is sending
    if thread.creator_account_id == current_user.account_id:
        thread.unread_by_recipient = True
        thread.unread_by_creator = False
    else:
        thread.unread_by_creator = True
        thread.unread_by_recipient = False

    thread.last_message_at = now
    thread.last_message_preview = body[:200]
    thread.status = "open"
    db.commit()

    return get_thread(thread.id, db, current_user)


@router.get("/directory")
def search_businesses(q: str = Query(...), db: Session = Depends(get_db), current_user: User = Depends(require_account_user)):
    """Search for other businesses to message by name or email."""
    if len(q) < 3:
        return []

    return db.query(Account.id, Account.name, Account.email).filter(
        Account.id != current_user.account_id,
        Account.is_active == True,
        or_(
            Account.name.ilike(f"%{q}%"),
            Account.email.ilike(f"%{q}%")
        )
    ).limit(10).all()
