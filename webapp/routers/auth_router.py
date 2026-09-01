import io
import os
import secrets
import uuid
from datetime import datetime, timedelta
from jose import JWTError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from models import User, RoleEnum, Account, AccountType, ActivityLog
from schemas import (
    UserCreate, UserOut, LoginRequest, Token, ChangePasswordRequest, AccountCreate,
    ForgotPasswordRequest, ResetPasswordConfirmRequest, CompleteProfileRequest,
)
from auth import (
    hash_password, authenticate_user, create_access_token,
    get_current_user, require_admin, require_superadmin, set_auth_cookie, clear_auth_cookie,
    create_password_reset_token, verify_password_reset_token,
)
from activity import log_activity_for_user, log_activity, log_superadmin_action
from rate_limit import limiter
import email_utils

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://moneytracer.up.railway.app")
QUICK_SIGNUP_PATH = "/quick-signup"
# Platform-wide ceiling on how many free accounts the QR shortcut can mint in
# a rolling 24h window — the per-IP "30/hour" limiter below stops one scanner
# from looping the endpoint, but doesn't stop the *link itself* (shared,
# screenshotted, or bot-driven from many IPs) from being used to spin up junk
# tenants indefinitely. This is a coarse, cheap backstop on top of that, not
# a replacement for it. Configurable via env since "normal" volume varies a
# lot by how many businesses are actually displaying the code.
QUICK_SIGNUP_DAILY_CAP = int(os.getenv("QUICK_SIGNUP_DAILY_CAP", "200"))

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=UserOut)
@limiter.limit("10/hour")
def register(request: Request, payload: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    account_type = payload.account_type or AccountType.business

    if account_type == AccountType.community:
        # Community groups skip the business fields entirely — the community
        # onboarding wizard (POST /api/community/setup) fills in the group's
        # own details afterwards.
        account = Account(
            account_type=AccountType.community,
            name=f"{payload.full_name or payload.username}'s Group",
            owner_full_name=payload.full_name or payload.username,
            email=payload.email or "",
            onboarding_completed=False,
        )
    elif account_type == AccountType.personal:
        # Personal spending accounts have no business/community setup wizard —
        # categories and budgets are created on the fly from the dashboard, so
        # these go straight through onboarding.
        account = Account(
            account_type=AccountType.personal,
            name=f"{payload.full_name or payload.username}'s Personal Account",
            owner_full_name=payload.full_name or payload.username,
            email=payload.email or "",
            onboarding_completed=True,
        )
    else:
        # Create a new account for self-service registration. It starts
        # un-onboarded so the new admin is walked through the setup wizard
        # (business basics, branding, tax/invoicing defaults) before landing
        # on the dashboard.
        account = Account(
            account_type=AccountType.business,
            name=f"{payload.full_name}'s Business",
            owner_full_name=payload.full_name or payload.username,
            business_type="retail",
            email=payload.email or "",
            onboarding_completed=False,
        )
    db.add(account)
    db.commit()
    db.refresh(account)

    user = User(
        username=payload.username,
        full_name=payload.full_name or "",
        email=payload.email or "",
        hashed_password=hash_password(payload.password),
        role=RoleEnum.admin,  # The person who creates an account is its admin/treasurer
        account_id=account.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity_for_user(db, user, "register", f"New {account_type.value} account created: {account.name}")
    return user


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
def login(request: Request, response: Response, payload: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # Include account_id in JWT token
    token_data = {"sub": user.username, "role": user.role.value, "tv": user.token_version or 0}
    if user.account_id:
        token_data["account_id"] = user.account_id
    
    token = create_access_token(token_data)
    set_auth_cookie(response, token)
    log_activity_for_user(db, user, "login", "User logged in")
    return Token(access_token=token, user=user)


@router.post("/logout")
def logout(response: Response):
    """Clear the httpOnly auth cookie. The frontend also drops any local
    auth state it's holding; this just ensures the browser stops sending
    the cookie on subsequent requests."""
    clear_auth_cookie(response)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/demo-login", response_model=Token)
@limiter.limit("20/hour")
def demo_login(request: Request, response: Response, db: Session = Depends(get_db)):
    """Instant login as a read-friendly demo account — no credentials required."""
    user = db.query(User).filter(User.username == "demo").first()
    if not user:
        # Lazily create it if init_db hasn't run yet / fresh DB
        # Create a demo account first
        demo_account = Account(
            name="Demo Business",
            owner_full_name="Demo Owner",
            business_type="retail",
            email="demo@moneytracer.africa",
            phone="+255123456789",
            onboarding_completed=True,  # demo skips the wizard
        )
        db.add(demo_account)
        db.commit()
        db.refresh(demo_account)
        
        user = User(
            username="demo",
            full_name="Demo User",
            email="demo@moneytracer.africa",
            hashed_password=hash_password(uuid.uuid4().hex),  # unguessable, unused
            role=RoleEnum.manager,
            is_demo=True,
            account_id=demo_account.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    token_data = {"sub": user.username, "role": user.role.value, "tv": user.token_version or 0}
    if user.account_id:
        token_data["account_id"] = user.account_id
    
    token = create_access_token(token_data)
    set_auth_cookie(response, token)
    log_activity_for_user(db, user, "demo_login", "Demo account accessed")
    return Token(access_token=token, user=user)


def _generate_unique_username(db: Session, prefix: str = "qr") -> str:
    """8 random hex chars is ~4 billion combinations — collisions are
    astronomically unlikely, but we still check to be safe rather than rely
    on the DB's unique constraint alone (which would surface as an opaque
    500 instead of quietly retrying)."""
    for _ in range(5):
        candidate = f"{prefix}_{secrets.token_hex(4)}"
        if not db.query(User).filter(User.username == candidate).first():
            return candidate
    # Vanishingly unlikely, but fall back to something longer rather than loop forever.
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@router.post("/quick-signup", response_model=Token)
@limiter.limit("30/hour")
def quick_signup(request: Request, response: Response, db: Session = Depends(get_db)):
    """One-tap account creation for the 'scan a QR code to sign up' shortcut.

    No form to fill in: a brand-new business account and admin user are
    created on the spot with a random username/password, the user is logged
    in immediately (same cookie as a normal login), and `profile_incomplete`
    is set so the frontend keeps prompting them to fill in their real name,
    email, and business details via PUT /api/auth/complete-profile whenever
    they're ready. Every scan of the same QR code creates a distinct account
    — this is a signup shortcut, not a way to log back into an existing one.
    """
    since = datetime.utcnow() - timedelta(hours=24)
    recent_count = db.query(ActivityLog).filter(
        ActivityLog.action == "quick_signup", ActivityLog.created_at >= since,
    ).count()
    if recent_count >= QUICK_SIGNUP_DAILY_CAP:
        raise HTTPException(
            status_code=429,
            detail="Quick sign-up is temporarily unavailable — too many accounts have been created "
                   "via QR/barcode in the last 24 hours. Please use the regular sign-up form, or try again later.",
        )

    account = Account(
        account_type=AccountType.business,
        name="New Business",
        owner_full_name="",
        business_type="retail",
        email="",
        onboarding_completed=False,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    username = _generate_unique_username(db)
    # Random, never shown to the user — they set a real password once they
    # complete their profile. Until then they can only get back in from the
    # same browser (session cookie) or by scanning a fresh QR (new account).
    user = User(
        username=username,
        full_name="",
        email="",
        hashed_password=hash_password(secrets.token_urlsafe(24)),
        role=RoleEnum.admin,
        account_id=account.id,
        profile_incomplete=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token_data = {"sub": user.username, "role": user.role.value, "tv": user.token_version or 0, "account_id": account.id}
    token = create_access_token(token_data)
    set_auth_cookie(response, token)
    log_activity_for_user(db, user, "quick_signup", "Account created via QR/barcode quick signup")
    return Token(access_token=token, user=user)


@router.get("/quick-signup/qr")
def quick_signup_qr(admin: User = Depends(require_admin)):
    """PNG of a QR code that, when scanned, opens the quick-signup landing
    page on the frontend (which immediately calls POST /quick-signup and
    drops the scanner straight into a new logged-in account). Admin-only —
    this is meant to be printed/displayed by a business, not exposed publicly,
    since anyone who reaches the URL directly gets the same result anyway
    (the value is just having a scannable code, not a secret)."""
    import qrcode

    target_url = f"{FRONTEND_URL}{QUICK_SIGNUP_PATH}"
    img = qrcode.make(target_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png", headers={
        "Cache-Control": "no-store",
        "Content-Disposition": "inline; filename=moneytracer-quick-signup-qr.png",
    })


@router.put("/complete-profile", response_model=UserOut)
@limiter.limit("20/hour")
def complete_profile(
    request: Request,
    payload: CompleteProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lets a quick-signup user (or anyone, really) fill in the details that
    were skipped at signup. Clears profile_incomplete once they've provided
    at least a name and an email — that's the bar for 'no longer anonymous',
    username/password stay whatever they were unless explicitly changed."""
    if payload.new_username and payload.new_username != current_user.username:
        if db.query(User).filter(User.username == payload.new_username).first():
            raise HTTPException(status_code=400, detail="Username already exists")
        current_user.username = payload.new_username
    if payload.new_password:
        current_user.hashed_password = hash_password(payload.new_password)
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.email is not None:
        current_user.email = payload.email

    if current_user.full_name and current_user.email:
        current_user.profile_incomplete = False

    db.commit()
    db.refresh(current_user)
    log_activity_for_user(db, current_user, "complete_profile", "Completed profile details")
    return current_user


@router.put("/change-password")
@limiter.limit("10/minute")
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from auth import verify_password
    if current_user.is_demo:
        raise HTTPException(status_code=403, detail="The demo account's password cannot be changed")
    if not verify_password(payload.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Old password is incorrect")
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    log_activity_for_user(db, current_user, "change_password", "Password changed")
    return {"detail": "Password updated successfully"}


@router.post("/reset-password/{username}")
@limiter.limit("10/minute")
def reset_password(
    request: Request,
    username: str,
    new_password: str = "changeme123",
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(new_password)
    db.commit()
    log_activity_for_user(db, admin, "reset_password", f"Reset password for {username}")
    return {"detail": f"Password reset for {username}"}


# ---- Self-service forgot-password (distinct from the admin-only reset
# above): a locked-out user recovers their own account via an emailed,
# short-lived link — no admin involved. ----

_FORGOT_PASSWORD_GENERIC_RESPONSE = {
    "detail": "If an account matches, password reset instructions have been sent to its email address."
}


@router.post("/forgot-password")
@limiter.limit("5/hour")
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Always returns the same generic message whether or not the account
    exists, and whether or not the account has an email on file — so this
    endpoint can't be used to enumerate registered usernames/emails."""
    identifier = payload.username_or_email.strip()
    user = db.query(User).filter(
        (User.username == identifier) | (User.email == identifier)
    ).first()

    if user and not user.is_demo and user.email:
        token = create_password_reset_token(user)
        reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
        try:
            email_utils.send_plain_email(
                to_email=user.email,
                subject="Reset your Moneytracer password",
                body=(
                    f"Hi {user.full_name or user.username},\n\n"
                    "We received a request to reset your Moneytracer password. "
                    f"Click the link below to choose a new one — it expires in 30 minutes:\n\n"
                    f"{reset_url}\n\n"
                    "If you didn't request this, you can safely ignore this email; "
                    "your password will not be changed.\n\n"
                    "— Moneytracer"
                ),
            )
        except RuntimeError:
            # SMTP not configured on this deployment. Don't leak that detail
            # to the caller (same generic response either way) — but do
            # surface it in server logs so it's visible to whoever's running
            # the deployment.
            print(f"[forgot-password] Email not sent for user '{user.username}': SMTP not configured.")

    return _FORGOT_PASSWORD_GENERIC_RESPONSE


@router.post("/reset-password-confirm")
@limiter.limit("10/hour")
def reset_password_confirm(request: Request, payload: ResetPasswordConfirmRequest, db: Session = Depends(get_db)):
    try:
        user = verify_password_reset_token(payload.token, db)
    except (JWTError, ValueError):
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Please request a new one.")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    log_activity_for_user(db, user, "reset_password_self_service", "Password reset via emailed link")
    return {"detail": "Password updated successfully. You can now log in with your new password."}


IMPERSONATION_MINUTES = 30


@router.post("/impersonate/{user_id}", response_model=Token)
def impersonate(user_id: int, db: Session = Depends(get_db),
                 superadmin: User = Depends(require_superadmin)):
    """Issue a short-lived token that logs in AS the target user — the
    'Login as' support tool. Deliberately narrow:
    - 30 minutes only, regardless of the platform's normal token lifetime.
    - Can't target another superadmin (no lateral platform-access escalation
      via a support tool — a superadmin who needs another superadmin's
      access has a different problem to solve, not this one).
    - Can't target an inactive user (nothing to support there).
    - Always logged to the TARGET account's activity log, not just a
      superadmin-side log — the account owner should be able to see that
      support accessed their account, when, and as whom.
    The token is otherwise indistinguishable from the user's own login token
    (same 'sub'/'role'/'account_id' shape) so it works everywhere in the app
    without special-casing — the short expiry and the audit trail are what
    make this safe, not a different code path at request time.
    """
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == RoleEnum.superadmin:
        raise HTTPException(status_code=403, detail="Cannot impersonate a superadmin")
    if not target.is_active:
        raise HTTPException(status_code=400, detail="User is inactive")

    token_data = {
        "sub": target.username, "role": target.role.value,
        "impersonated_by": superadmin.username, "tv": target.token_version or 0,
    }
    if target.account_id:
        token_data["account_id"] = target.account_id

    token = create_access_token(token_data, expires_minutes=IMPERSONATION_MINUTES)

    log_activity(
        db, username=target.username,
        action="CRITICAL: superadmin_impersonation",
        details=f"{superadmin.username} started a support session as {target.username} "
                f"(expires in {IMPERSONATION_MINUTES} min)",
        account_id=target.account_id,
    )
    log_superadmin_action(
        db, superadmin, "impersonate",
        details=f"Started {IMPERSONATION_MINUTES}-min support session as {target.username}",
        target_account_id=target.account_id, target_user_id=target.id, target_label=target.username,
    )
    return Token(access_token=token, user=target)
