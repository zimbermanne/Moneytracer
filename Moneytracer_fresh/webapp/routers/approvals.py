from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Approval, Budget, User, RoleEnum
from schemas import ApprovalCreate, ApprovalOut, BudgetCreate, BudgetUpdate, BudgetOut
from auth import get_current_user, require_manager_up
from activity import log_activity_for_user

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


# ---------- Approvals ----------

@router.get("", response_model=List[ApprovalOut])
def list_approvals(
    status: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List approvals with optional status filter."""
    account_id = get_account_filter(current_user)
    query = db.query(Approval)
    if account_id is not None:
        query = query.filter(Approval.account_id == account_id)
    if status:
        query = query.filter(Approval.status == status)
    return query.order_by(Approval.requested_at.desc()).all()


@router.post("", response_model=ApprovalOut)
def create_approval(
    payload: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an approval request."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create approvals")

    approval = Approval(
        account_id=account_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        requested_by=current_user.username,
        amount=payload.amount,
        status="pending",
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)
    log_activity_for_user(db, current_user, "approval_create", f"Requested approval for {payload.entity_type} {payload.entity_id}")
    return approval


@router.put("/{approval_id}/approve")
def approve_approval(
    approval_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Approve an approval request."""
    account_id = get_account_filter(current_user)
    query = db.query(Approval).filter(Approval.id == approval_id)
    if account_id is not None:
        query = query.filter(Approval.account_id == account_id)
    approval = query.first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval is not pending")

    approval.status = "approved"
    approval.approved_by = current_user.username
    approval.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(approval)
    
    log_activity_for_user(db, current_user, "approval_approve", f"Approved {approval.entity_type} {approval.entity_id}")
    return approval


@router.put("/{approval_id}/reject")
def reject_approval(
    approval_id: int,
    reason: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Reject an approval request."""
    account_id = get_account_filter(current_user)
    query = db.query(Approval).filter(Approval.id == approval_id)
    if account_id is not None:
        query = query.filter(Approval.account_id == account_id)
    approval = query.first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval is not pending")

    approval.status = "rejected"
    approval.rejected_by = current_user.username
    approval.rejected_at = datetime.utcnow()
    approval.reason = reason
    db.commit()
    db.refresh(approval)
    
    log_activity_for_user(db, current_user, "approval_reject", f"Rejected {approval.entity_type} {approval.entity_id}")
    return approval


# ---------- Budgets ----------

@router.get("/budgets", response_model=List[BudgetOut])
def list_budgets(
    year: int = None,
    period_type: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List budgets with optional year and period_type filters."""
    account_id = get_account_filter(current_user)
    query = db.query(Budget)
    if account_id is not None:
        query = query.filter(Budget.account_id == account_id)
    if year:
        query = query.filter(Budget.year == year)
    if period_type:
        query = query.filter(Budget.period_type == period_type)
    return query.order_by(Budget.year.desc(), Budget.period_type, Budget.category).all()


@router.post("/budgets", response_model=BudgetOut)
def create_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Create a new budget."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create budgets")

    budget = Budget(
        account_id=account_id,
        period_type=payload.period_type,
        year=payload.year,
        month=payload.month,
        quarter=payload.quarter,
        category=payload.category,
        budgeted_amount=payload.budgeted_amount,
        actual_amount=0,
        variance=payload.budgeted_amount,
        created_by=current_user.username,
    )
    db.add(budget)
    db.commit()
    db.refresh(budget)
    log_activity_for_user(db, current_user, "budget_create", f"Created budget for {payload.category}")
    return budget


@router.put("/budgets/{budget_id}", response_model=BudgetOut)
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Update a budget."""
    account_id = get_account_filter(current_user)
    query = db.query(Budget).filter(Budget.id == budget_id)
    if account_id is not None:
        query = query.filter(Budget.account_id == account_id)
    budget = query.first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    if payload.budgeted_amount is not None:
        budget.budgeted_amount = payload.budgeted_amount
    if payload.actual_amount is not None:
        budget.actual_amount = payload.actual_amount
        budget.variance = budget.budgeted_amount - budget.actual_amount
    if payload.is_active is not None:
        budget.is_active = payload.is_active

    db.commit()
    db.refresh(budget)
    log_activity_for_user(db, current_user, "budget_update", f"Updated budget for {budget.category}")
    return budget


@router.delete("/budgets/{budget_id}")
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Delete a budget."""
    account_id = get_account_filter(current_user)
    query = db.query(Budget).filter(Budget.id == budget_id)
    if account_id is not None:
        query = query.filter(Budget.account_id == account_id)
    budget = query.first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    db.delete(budget)
    db.commit()
    log_activity_for_user(db, current_user, "budget_delete", f"Deleted budget for {budget.category}")
    return {"message": "Budget deleted"}
