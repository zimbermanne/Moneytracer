import hashlib
import os
import secrets
import warnings
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User, RoleEnum

_env_secret = os.getenv("SECRET_KEY")
if _env_secret:
    SECRET_KEY = _env_secret
else:
    # No hardcoded fallback — that would mean every deployment without the env
    # var set signs tokens with a value visible in the public repo, letting
    # anyone forge valid logins. Instead, generate a random key for this
    # process. Tokens won't survive a restart until SECRET_KEY is actually
    # set in the environment (do this in Railway/production!).
    SECRET_KEY = secrets.token_hex(32)
    warnings.warn(
        "SECRET_KEY is not set in the environment — using a random key for "
        "this process only. All existing sessions will be invalidated on "
        "every restart. Set SECRET_KEY as a persistent environment variable "
        "before relying on this in production.",
        RuntimeWarning,
    )
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# auto_error=False: don't 401 immediately when there's no Authorization header —
# get_current_user below falls back to the httpOnly cookie in that case, so a
# browser session (cookie-based) and an API client (header-based) both work.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# Name of the httpOnly cookie set on login, used by the browser frontend
# instead of storing the token in sessionStorage (which is readable by any
# injected script — see the XSS discussion this migration addresses).
ACCESS_TOKEN_COOKIE = "mt_access_token"

# Cross-site cookies (frontend and API on different Railway subdomains)
# require Secure + SameSite=None — but Secure cookies are rejected by browsers
# over plain HTTP, which breaks local dev (http://localhost). Set
# COOKIE_SECURE=false only for local development.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"
COOKIE_SAMESITE = "none" if COOKIE_SECURE else "lax"


def _truncate(password: str) -> str:
    # bcrypt only uses the first 72 bytes; truncate explicitly so behavior
    # is consistent across bcrypt versions (4.1+ raises instead of truncating).
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_truncate(plain), hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(_truncate(password))


def create_access_token(data: dict, expires_minutes: Optional[int] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


PASSWORD_RESET_EXPIRE_MINUTES = 30


def create_password_reset_token(user: "User") -> str:
    """Short-lived, single-purpose token for the forgot-password flow.

    Deliberately separate from create_access_token: it carries "purpose":
    "password_reset" so it can never be accepted by get_current_user as a
    login token, even if someone tried to reuse it that way. It also embeds
    the user's current token_version and hashed_password, so the token is
    automatically invalidated the moment the password actually changes
    (either via this same flow or any other route) — a leaked/old reset
    link can't be replayed after it's been used once.
    """
    expire = datetime.utcnow() + timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES)
    to_encode = {
        "sub": user.username,
        "purpose": "password_reset",
        "tv": user.token_version,
        # Bind the token to the current password hash so it can't be
        # replayed after a successful reset (or any other password change).
        "pwv": hashlib.sha256(user.hashed_password.encode()).hexdigest()[:16],
        "exp": expire,
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_password_reset_token(token: str, db) -> "User":
    """Decodes a password-reset token and returns the matching User, or
    raises JWTError/ValueError if it's invalid, expired, wrong-purpose, or
    already used (password changed since it was issued)."""
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("purpose") != "password_reset":
        raise ValueError("Not a password reset token")
    username = payload.get("sub")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise ValueError("User not found")
    if user.token_version != payload.get("tv"):
        raise ValueError("Token no longer valid")
    current_pwv = hashlib.sha256(user.hashed_password.encode()).hexdigest()[:16]
    if current_pwv != payload.get("pwv"):
        raise ValueError("Token already used")
    return user


def set_auth_cookie(response, token: str, expires_minutes: Optional[int] = None):
    """Set the httpOnly auth cookie on a login response. SameSite=None + Secure
    because the frontend and API are on different subdomains (cross-site) —
    both are required together for the browser to send it cross-origin."""
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=token,
        max_age=(expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def clear_auth_cookie(response):
    response.delete_cookie(key=ACCESS_TOKEN_COOKIE, path="/")


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # Prefer the Authorization header (API clients, tools, Postman, etc.);
    # fall back to the httpOnly cookie set on login (the browser frontend).
    if not token:
        token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise credentials_exception

    # Force-logout check: a superadmin bumping token_version (see
    # routers/superadmin.py force_logout_user/force_logout_account)
    # invalidates every token issued before that point, even though JWTs are
    # otherwise stateless. Tokens minted before this feature shipped have no
    # "tv" claim — treat that as version 0, matching the column's default,
    # so existing sessions aren't broken by the deploy.
    token_version = payload.get("tv", 0)
    if token_version != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if user's account is suspended (unless they're a superadmin)
    if user.role != RoleEnum.superadmin and user.account_id:
        from models import Account
        account = db.query(Account).filter(Account.id == user.account_id).first()
        if account and account.is_suspended:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is suspended. Please contact support."
            )
    
    return user


def require_roles(*roles: RoleEnum):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker


require_admin = require_roles(RoleEnum.admin)
require_manager_up = require_roles(RoleEnum.admin, RoleEnum.manager)
require_accountant_up = require_roles(RoleEnum.admin, RoleEnum.manager, RoleEnum.accountant)
require_sales_up = require_roles(RoleEnum.admin, RoleEnum.manager, RoleEnum.sales, RoleEnum.accountant)
require_inventory_up = require_roles(RoleEnum.admin, RoleEnum.manager, RoleEnum.inventory, RoleEnum.accountant)
require_superadmin = require_roles(RoleEnum.superadmin)


def require_account_user(user: User = Depends(get_current_user)) -> User:
    """Ensure user belongs to an account (not a superadmin without account)."""
    if user.role != RoleEnum.superadmin and not user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return user
