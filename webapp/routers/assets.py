"""Asset tracking — house, vehicle, equipment, or other. A flat value
tracker for v1: no depreciation schedule, estimated_value is whatever the
owner last set it to. Shared by business and personal account types alike.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Asset, User, RoleEnum, AssetCategory, AssetType, AssetRevaluationHistory
from schemas import AssetCreate, AssetUpdate, AssetOut, AssetRevaluationCreate
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user
from ledger import post_asset_creation_entry, post_asset_revaluation_entry, post_depreciation_entry

router = APIRouter(prefix="/api/assets", tags=["assets"])


def get_account_filter(current_user: User):
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


@router.get("/", response_model=List[AssetOut])
def list_assets(category: Optional[AssetCategory] = None, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(Asset)
    if account_id is not None:
        q = q.filter(Asset.account_id == account_id)
    if category is not None:
        q = q.filter(Asset.category == category)
    return q.order_by(Asset.created_at.desc()).all()


@router.post("/", response_model=AssetOut)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create assets")

    asset = Asset(
        account_id=account_id,
        name=payload.name,
        asset_type=payload.asset_type,
        category=payload.category,
        acquisition_cost=payload.acquisition_cost,
        estimated_value=payload.estimated_value or payload.acquisition_cost,
        salvage_value=payload.salvage_value,
        useful_life_years=payload.useful_life_years,
        acquired_date=payload.acquired_date,
        notes=payload.notes or "",
        created_by=current_user.username,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)

    try:
        post_asset_creation_entry(db, account_id, asset, created_by=current_user.username)
    except Exception as e:
        log_activity_for_user(db, current_user, "CRITICAL: asset_ledger_post_failed", str(e))

    log_activity_for_user(db, current_user, "asset_create", f"Added asset: {asset.name} ({asset.asset_type})")
    return asset


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, payload: AssetUpdate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(Asset).filter(Asset.id == asset_id)
    if account_id is not None:
        q = q.filter(Asset.account_id == account_id)
    asset = q.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    log_activity_for_user(db, current_user, "asset_update", f"Updated asset {asset_id}")
    return asset


@router.delete("/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db),
                  current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    q = db.query(Asset).filter(Asset.id == asset_id)
    if account_id is not None:
        q = q.filter(Asset.account_id == account_id)
    asset = q.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(asset)
    db.commit()
    log_activity_for_user(db, current_user, "asset_delete", f"Deleted asset {asset_id}")
    return {"detail": "Asset deleted"}


@router.post("/{asset_id}/revalue", response_model=AssetOut)
def revalue_asset(asset_id: int, payload: AssetRevaluationCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.account_id == account_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    old_value = asset.estimated_value
    gain_loss = payload.new_value - old_value

    reval = AssetRevaluationHistory(
        asset_id=asset.id,
        previous_value=old_value,
        new_value=payload.new_value,
        gain_loss_amount=gain_loss,
        notes=payload.notes or "",
    )
    db.add(reval)

    asset.estimated_value = payload.new_value
    asset.last_revaluation_date = datetime.utcnow()

    db.commit()
    db.refresh(asset)
    db.refresh(reval)

    try:
        post_asset_revaluation_entry(db, account_id, asset, reval, created_by=current_user.username)
    except Exception as e:
        log_activity_for_user(db, current_user, "CRITICAL: asset_reval_ledger_failed", str(e))

    log_activity_for_user(db, current_user, "asset_revalue", f"Revalued asset {asset.name}: {money_format(old_value)} -> {money_format(payload.new_value)}")
    return asset


@router.post("/{asset_id}/depreciate", response_model=AssetOut)
def post_manual_depreciation(asset_id: int, amount: float, db: Session = Depends(get_db),
                             current_user: User = Depends(require_manager_up)):
    """Manually post a depreciation amount for this month."""
    account_id = get_account_filter(current_user)
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.account_id == account_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    if asset.asset_type != AssetType.fixed_asset:
        raise HTTPException(status_code=400, detail="Only fixed assets can be depreciated")

    asset.estimated_value = max(0, asset.estimated_value - amount)
    db.commit()
    db.refresh(asset)

    try:
        post_depreciation_entry(db, account_id, asset, amount, datetime.utcnow(), created_by=current_user.username)
    except Exception as e:
        log_activity_for_user(db, current_user, "CRITICAL: asset_depr_ledger_failed", str(e))

    log_activity_for_user(db, current_user, "asset_depreciate", f"Posted depreciation for {asset.name}: {money_format(amount)}")
    return asset


def money_format(n):
    return f"TZS {n:,.2f}"
