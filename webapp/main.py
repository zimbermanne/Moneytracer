import os
import warnings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from slowapi.middleware import SlowAPIMiddleware

from database import Base, engine, ensure_schemas
import models  # noqa: F401 ensures models are registered before create_all
from migrate import run_migrations
from seed_pan_african_data import seed_all_pan_african_data
from rate_limit import limiter
from routers import auth, inventory, sales, purchases, expenses, ledgers, reports, users, activity, backup, agent, invoices, quotations, customers, suppliers, accounts, reminders, community, personal, public, reference, purchase_orders, superadmin, bank_loans, deadlines, assets, attachments, payroll, approvals
from scheduler import start_scheduler
from database import SessionLocal

ensure_schemas(engine)
Base.metadata.create_all(bind=engine)
run_migrations(engine)

# Self-healing reference data: seed_countries()/seed_revenue_authorities()/
# seed_languages() each skip rows that already exist, so this is safe to run
# on every startup/deploy. Without this, any country added to
# african_currencies.py never reaches the live DB until someone remembers to
# run the seed script by hand -- which is exactly how "Unknown country:
# Burkina Faso" errors happened during registration.
with SessionLocal() as _seed_db:
    seed_all_pan_african_data(_seed_db)

app = FastAPI(title="Moneytracer API", version="2.5.0")


@app.on_event("startup")
def _start_background_jobs():
    # Runs in-process — see scheduler.py docstring for the multi-instance caveat.
    start_scheduler()

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc):
    # Without this, an unhandled exception deep in a request (e.g. a bad
    # lazy-load, a None attribute access) can, depending on how far it
    # unwinds, produce a response the browser can't parse as a normal HTTP
    # error — which shows up client-side as a bare network failure ("Could
    # not reach the server") instead of a readable error, making it look
    # like a connectivity problem when it's actually a 500. This guarantees
    # every request gets a clean, CORS-safe JSON response no matter what
    # goes wrong inside the route.
    import logging
    logging.getLogger("uvicorn.error").exception("Unhandled exception on %s %s", request.method, request.url.path)
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [o.strip() for o in origins_env.split(",")] if origins_env != "*" else ["*"]

# Auth in this app is a Bearer token sent in the Authorization header (see
# auth.py / useAuth.jsx) — never cookies — so the browser doesn't need
# credentialed CORS to make authenticated requests work. Wildcard origins
# combined with allow_credentials=True is a known anti-pattern (and most
# browsers reject that combination outright), so credentials are only
# enabled once specific origins are configured via ALLOWED_ORIGINS.
allow_credentials = allowed_origins != ["*"]
if allowed_origins == ["*"]:
    warnings.warn(
        "ALLOWED_ORIGINS is not set — CORS is wide open (any origin can call "
        "this API). Set ALLOWED_ORIGINS to your actual frontend domain(s) "
        "(comma-separated) in production.",
        RuntimeWarning,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(inventory.router)
app.include_router(sales.router)
app.include_router(purchases.router)
app.include_router(purchase_orders.router)
app.include_router(expenses.router)
app.include_router(ledgers.router)
app.include_router(reports.router)
app.include_router(users.router)
app.include_router(activity.router)
app.include_router(backup.router)
app.include_router(agent.router)
app.include_router(invoices.router)
app.include_router(quotations.router)
app.include_router(customers.router)
app.include_router(suppliers.router)
app.include_router(accounts.router)
app.include_router(superadmin.router)
app.include_router(bank_loans.router)
app.include_router(deadlines.router)
app.include_router(assets.router)
app.include_router(reminders.router)
app.include_router(community.router)
app.include_router(personal.router)
app.include_router(public.router)
app.include_router(reference.router)
app.include_router(attachments.router)
app.include_router(payroll.router)
app.include_router(approvals.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.5.0"}

# Superadmin console — served same-origin from this same backend, on
# purpose: it's the same API it manages, so there's no cross-origin request
# for it to make, no CORS configuration needed, none of the "Failed to
# fetch" grief that comes from hosting it as a separate origin and trying
# to whitelist that origin via ALLOWED_ORIGINS.
superadmin_static_dir = os.path.join(os.path.dirname(__file__), "superadmin_static")
if os.path.isdir(superadmin_static_dir):
    app.mount("/superadmin", StaticFiles(directory=superadmin_static_dir, html=True), name="superadmin")

# Serve the legacy static SPA shell, if present, at the root
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
