from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Attachment, User, RoleEnum
from schemas import AttachmentCreate, AttachmentOut
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user

router = APIRouter(prefix="/api/attachments", tags=["attachments"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


@router.get("", response_model=List[AttachmentOut])
def list_attachments(
    entity_type: str = Query(None, description="Filter by entity type (expense, purchase, invoice)"),
    entity_id: int = Query(None, description="Filter by entity ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List attachments with optional filtering by entity type and ID."""
    account_id = get_account_filter(current_user)
    query = db.query(Attachment)
    if account_id is not None:
        query = query.filter(Attachment.account_id == account_id)
    if entity_type:
        query = query.filter(Attachment.entity_type == entity_type)
    if entity_id:
        query = query.filter(Attachment.entity_id == entity_id)
    return query.order_by(Attachment.uploaded_at.desc()).all()


@router.post("", response_model=AttachmentOut)
def create_attachment(
    payload: AttachmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Create a new attachment. Note: file upload should be handled separately (e.g., S3 presigned URL)."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create attachments")

    # Validate entity_type
    valid_types = ["expense", "purchase", "invoice"]
    if payload.entity_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid entity_type. Must be one of: {', '.join(valid_types)}")

    attachment = Attachment(
        account_id=account_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        file_url=payload.file_url,
        file_name=payload.file_name,
        mime_type=payload.mime_type,
        file_size=payload.file_size,
        uploaded_by=current_user.username,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    log_activity_for_user(db, current_user, "attachment_create", f"Attached {payload.file_name} to {payload.entity_type} {payload.entity_id}")
    return attachment


@router.delete("/{attachment_id}")
def delete_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Delete an attachment."""
    account_id = get_account_filter(current_user)
    query = db.query(Attachment).filter(Attachment.id == attachment_id)
    if account_id is not None:
        query = query.filter(Attachment.account_id == account_id)
    attachment = query.first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    db.delete(attachment)
    db.commit()
    log_activity_for_user(db, current_user, "attachment_delete", f"Deleted attachment {attachment.file_name}")
    return {"message": "Attachment deleted"}
