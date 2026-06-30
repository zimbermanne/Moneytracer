from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User
from schemas import UserOut, UserUpdate
from auth import require_manager_up, require_admin
from activity import log_activity

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), current_user: User = Depends(require_manager_up)):
    return db.query(User).order_by(User.username).all()


@router.put("/{username}", response_model=UserOut)
def update_user(username: str, payload: UserUpdate, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    log_activity(db, admin.username, "user_update", f"Updated user {username}")
    return user


@router.delete("/{username}")
def delete_user(username: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == admin.username:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db.delete(user)
    db.commit()
    log_activity(db, admin.username, "user_delete", f"Deleted user {username}")
    return {"detail": "User deleted"}
