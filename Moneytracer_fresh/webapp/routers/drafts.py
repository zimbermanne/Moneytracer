import json
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import PosDraft, User, RoleEnum
from schemas import PosDraftCreate, PosDraftOut
from auth import get_current_user

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


@router.post("/", response_model=PosDraftOut)
def create_draft(payload: PosDraftCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot save POS drafts")

    draft = PosDraft(
        account_id=account_id,
        customer_name=payload.customer_name or "Walk-in",
        items_json=json.dumps(payload.items),
        total_amount=payload.total_amount,
        created_by=current_user.username,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return draft


@router.get("/", response_model=List[PosDraftOut])
def list_drafts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        return []
    return (
        db.query(PosDraft)
        .filter(PosDraft.account_id == account_id)
        .order_by(PosDraft.created_at.desc())
        .all()
    )


@router.delete("/{draft_id}")
def delete_draft(draft_id: int, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    draft = db.query(PosDraft).filter(PosDraft.id == draft_id).first()
    if not draft or draft.account_id != account_id:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()
    return {"ok": True}
