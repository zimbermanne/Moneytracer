from typing import List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Account, User, RoleEnum, Country, RevenueAuthority, ExchangeRate
from schemas import AccountOut, AccountUpdate, AccountWithUsersOut, AccountTrashOut, ExchangeRateCreate, ExchangeRateOut
from auth import require_superadmin, require_admin, get_current_user
from activity import log_activity_for_user, log_activity
from african_currencies import default_currency_for_country

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

DELETION_GRACE_DAYS = 90  # ~3 months

 
@router.get("/company-info")
def company_info(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lightweight account name/address/contact for any logged-in user —
    used to render the company header on invoice/quotation previews.
    (my-account below is admin-only and returns far more than this needs.)"""
    if not current_user.account_id:
        return {"name": "", "address": "", "email": "", "phone": ""}
    account = db.query(Account).filter(Account.id == current_user.account_id).first()
    if not account:
        return {"name": "", "address": "", "email": "", "phone": ""}
    return {
        "name": account.name,
        "address": ", ".join(filter(None, [account.region, account.district, account.street_address])),
        "email": account.email,
        "phone": account.phone,
    }


@router.get("/my-account", response_model=AccountOut)
def get_my_account(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Get current user's account details (account admin only)."""
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="You must belong to an account")
    
    account = db.query(Account).filter(Account.id == current_user.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    return account


@router.put("/my-account", response_model=AccountOut)
def update_my_account(payload: AccountUpdate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    """Update current user's account details (account admin only)."""
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="You must belong to an account")
    
    account = db.query(Account).filter(Account.id == current_user.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    # Prevent account admins from changing suspension status — but only block
    # an actual attempted change. Since the frontend round-trips the account
    # object it loaded (which includes the current is_suspended value), this
    # field is almost always present in the payload; comparing against the
    # current value (rather than just checking it's not None) avoids blocking
    # every save when the value hasn't actually changed.
    provided = payload.model_dump(exclude_unset=True)
    if "is_suspended" in provided and provided["is_suspended"] != account.is_suspended:
        raise HTTPException(status_code=403, detail="Cannot change suspension status")

    # "country" isn't a real column — Account.country is a relationship to
    # the Country table, so a plain setattr(account, "country", "Kenya")
    # would try to assign a string where a Country object is expected and
    # fail. Resolve it here instead: look up the Country by name, set the
    # FK, and — the first time a country is set — default tax_rate from
    # that country's revenue authority so users aren't left at 0%.
    country_name = provided.pop("country", None)
    if country_name:
        country = db.query(Country).filter(Country.name == country_name).first()
        if not country:
            raise HTTPException(status_code=400, detail=f"Unknown country: {country_name}")
        account.country_id = country.id

        authority = db.query(RevenueAuthority).filter(RevenueAuthority.country_id == country.id).first()
        if authority:
            account.revenue_authority_id = authority.id
            # Only auto-fill tax_rate if the user hasn't explicitly set one
            # in this same request and the account doesn't already have a
            # non-zero rate — don't clobber a manually-configured rate.
            if "tax_rate" not in provided and not account.tax_rate:
                account.tax_rate = authority.default_vat_rate or 0

        # Same auto-fill pattern for currency: default from the country's
        # official currency (all 54 African markets, see
        # african_currencies.py) unless the request explicitly sets one or
        # the account was already manually configured away from the
        # original "TZS" fallback.
        if "currency" not in provided and (not account.currency or account.currency == "TZS"):
            account.currency = default_currency_for_country(country_name)

    for field, value in provided.items():
        setattr(account, field, value)
    
    db.commit()
    db.refresh(account)
    log_activity_for_user(db, current_user, "account_update", f"Updated account {account.name}")
    return account


@router.get("/", response_model=List[AccountOut])
def list_accounts(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """List all accounts (superadmin only). Excludes accounts pending
    deletion — those live in the Trash view (GET /trash/list) instead, so
    they don't clutter the main Accounts tab while still being fully
    recoverable within the grace period."""
    return (
        db.query(Account)
        .filter(Account.pending_deletion.is_(False))
        .order_by(Account.created_at.desc())
        .all()
    )


@router.get("/{account_id}", response_model=AccountWithUsersOut)
def get_account(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Get account details with users (superadmin only)."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    users = db.query(User).filter(User.account_id == account_id).all()
    return AccountWithUsersOut(
        **account.__dict__,
        users=users
    )


@router.put("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, payload: AccountUpdate, db: Session = Depends(get_db),
                  superadmin: User = Depends(require_superadmin)):
    """Update account details (superadmin only)."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    
    db.commit()
    db.refresh(account)
    log_activity_for_user(db, superadmin, "account_update", f"Updated account {account.name}")
    return account


@router.post("/{account_id}/suspend")
def suspend_account(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Suspend an account (superadmin only)."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account.is_suspended = True
    # Force out anyone already logged in under this account — otherwise a
    # currently-active session keeps working until its token naturally
    # expires, even though get_current_user also independently checks
    # is_suspended on every request. Bumping token_version is the belt to
    # that suspenders: it invalidates the token outright rather than relying
    # on the suspended-account check running every time.
    db.query(User).filter(User.account_id == account_id).update(
        {User.token_version: User.token_version + 1}
    )
    db.commit()
    log_activity_for_user(db, superadmin, "account_suspend", f"Suspended account {account.name}")
    return {"detail": f"Account {account.name} has been suspended"}


@router.post("/{account_id}/activate")
def activate_account(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Activate a suspended account (superadmin only)."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account.is_suspended = False
    db.commit()
    log_activity_for_user(db, superadmin, "account_activate", f"Activated account {account.name}")
    return {"detail": f"Account {account.name} has been activated"}


@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Soft-delete an account (superadmin only). This does NOT destroy any
    data — it flags the account as pending_deletion, suspends it (blocks
    login), and schedules a permanent purge DELETION_GRACE_DAYS (~3
    months) out. See purge_expired_accounts() below for what actually
    deletes it, and POST /{id}/restore to cancel a pending deletion
    within the grace window."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.pending_deletion:
        raise HTTPException(status_code=400, detail="Account is already pending deletion")

    now = datetime.utcnow()
    account.pending_deletion = True
    account.is_suspended = True
    account.deletion_requested_at = now
    account.scheduled_purge_at = now + timedelta(days=DELETION_GRACE_DAYS)
    account.deletion_requested_by = superadmin.username
    db.commit()
    log_activity_for_user(
        db, superadmin, "account_delete_requested",
        f"Marked {account.name} for deletion — permanent purge in {DELETION_GRACE_DAYS} days "
        f"({account.scheduled_purge_at.date()}) unless restored",
    )
    return {
        "detail": f"{account.name} moved to trash. It will be permanently deleted on "
                   f"{account.scheduled_purge_at.date()} unless restored before then.",
        "scheduled_purge_at": account.scheduled_purge_at,
    }


@router.post("/{account_id}/restore")
def restore_account(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Cancel a pending deletion within the grace window."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not account.pending_deletion:
        raise HTTPException(status_code=400, detail="Account is not pending deletion")

    account.pending_deletion = False
    account.is_suspended = False
    account.deletion_requested_at = None
    account.scheduled_purge_at = None
    account.deletion_requested_by = ""
    db.commit()
    log_activity_for_user(db, superadmin, "account_delete_restored", f"Restored {account.name} from trash")
    return {"detail": f"{account.name} restored."}


@router.post("/{account_id}/purge-now")
def purge_account_now(account_id: int, db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Skip the grace period and permanently delete a pending-deletion
    account immediately. Deliberately requires the account to already be
    pending_deletion (i.e. someone already went through the normal
    DELETE /{id} step) — this is not a shortcut around the trash flow,
    it's a way to empty it early for an account already in it."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not account.pending_deletion:
        raise HTTPException(status_code=400, detail="Account must be moved to trash (DELETE) before it can be purged")

    name = account.name
    log_activity_for_user(db, superadmin, "account_purged", f"Permanently deleted {name} (early purge, before grace period ended)")
    db.delete(account)  # cascades to related data via FK relationships, same as before
    db.commit()
    return {"detail": f"{name} permanently deleted."}


@router.get("/trash/list", response_model=List[AccountTrashOut])
def list_trash(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Every account currently in the ~90-day deletion grace window,
    soonest-to-be-purged first."""
    now = datetime.utcnow()
    accounts = (
        db.query(Account)
        .filter(Account.pending_deletion.is_(True))
        .order_by(Account.scheduled_purge_at.asc())
        .all()
    )
    out = []
    for a in accounts:
        remaining = (a.scheduled_purge_at - now).days if a.scheduled_purge_at else 0
        out.append(AccountTrashOut(
            id=a.id, name=a.name, owner_full_name=a.owner_full_name,
            deletion_requested_at=a.deletion_requested_at,
            scheduled_purge_at=a.scheduled_purge_at,
            deletion_requested_by=a.deletion_requested_by,
            days_remaining=max(0, remaining),
        ))
    return out


def purge_expired_accounts(db: Session) -> int:
    """Permanently delete every account whose grace period has fully
    elapsed. Called automatically once a day by scheduler.py
    (purge_expired_deleted_accounts), and can also be triggered on demand
    via POST /api/accounts/trash/purge-expired for testing or to not wait
    for the next scheduled run."""
    now = datetime.utcnow()
    expired = (
        db.query(Account)
        .filter(Account.pending_deletion.is_(True))
        .filter(Account.scheduled_purge_at <= now)
        .all()
    )
    for account in expired:
        log_activity(
            db, username="system", action="account_purged",
            details=f"Permanently deleted {account.name} (grace period elapsed)",
        )
        db.delete(account)
    if expired:
        db.commit()
    return len(expired)


@router.post("/trash/purge-expired")
def purge_expired_now(db: Session = Depends(get_db), superadmin: User = Depends(require_superadmin)):
    """Manually run the purge sweep now, instead of waiting for the next
    app startup — useful since this app has no background scheduler."""
    count = purge_expired_accounts(db)
    return {"detail": f"Purged {count} account(s) past their grace period."}


# ---------- Exchange Rates (Multi-Currency) ----------

@router.get("/exchange-rates", response_model=List[ExchangeRateOut])
def list_exchange_rates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all exchange rates for the account."""
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="You must belong to an account")
    return db.query(ExchangeRate).filter(
        ExchangeRate.account_id == current_user.account_id
    ).order_by(ExchangeRate.effective_date.desc()).all()


@router.post("/exchange-rates", response_model=ExchangeRateOut)
def create_exchange_rate(
    payload: ExchangeRateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new exchange rate."""
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="You must belong to an account")
    
    rate = ExchangeRate(
        account_id=current_user.account_id,
        base_currency=payload.base_currency.upper(),
        target_currency=payload.target_currency.upper(),
        rate=payload.rate,
        effective_date=payload.effective_date,
        source=payload.source,
        created_by=current_user.username,
    )
    db.add(rate)
    db.commit()
    db.refresh(rate)
    log_activity_for_user(db, current_user, "exchange_rate_create", 
                        f"Added rate: {payload.base_currency} -> {payload.target_currency} = {payload.rate}")
    return rate


@router.delete("/exchange-rates/{rate_id}")
def delete_exchange_rate(
    rate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete an exchange rate."""
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="You must belong to an account")
    
    rate = db.query(ExchangeRate).filter(
        ExchangeRate.id == rate_id,
        ExchangeRate.account_id == current_user.account_id
    ).first()
    if not rate:
        raise HTTPException(status_code=404, detail="Exchange rate not found")
    
    db.delete(rate)
    db.commit()
    log_activity_for_user(db, current_user, "exchange_rate_delete", 
                        f"Deleted rate: {rate.base_currency} -> {rate.target_currency}")
    return {"message": "Exchange rate deleted"}
