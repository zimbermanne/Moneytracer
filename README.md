# Feature: log IP / location / device on login, viewable in the superadmin panel

## What this adds
Every login and demo-login now records: IP address, best-effort city/region/
country (free IP geolocation, no API key needed), and device type/OS/browser
parsed from the User-Agent — all viewable and exportable from a new
"Devices & Locations" tab in the superadmin console, plus an aggregate
breakdown (top device type / browser / country over the last 30 days) to
guide optimization priorities (e.g. "60% of logins are mobile Android —
prioritize that layout" or "nobody's on IE, drop that polyfill").

## Files in this zip -> where they go
Overwrite these at the exact same paths in your repo:

    webapp/models.py                        -> Moneytracer/webapp/models.py
    webapp/schemas.py                       -> Moneytracer/webapp/schemas.py
    webapp/device_tracking.py               -> Moneytracer/webapp/device_tracking.py   (NEW FILE)
    webapp/routers/auth.py                  -> Moneytracer/webapp/routers/auth.py
    webapp/routers/superadmin.py            -> Moneytracer/webapp/routers/superadmin.py
    webapp/superadmin_static/index.html     -> Moneytracer/webapp/superadmin_static/index.html

Every file here is your original file with the new code added — nothing
unrelated was changed. `device_tracking.py` is the only brand-new file.

## What changed, file by file
- **models.py** — new `LoginSession` table (id, user_id, account_id,
  username, ip_address, city/region/country/isp, device_type, os, browser,
  user_agent, event, created_at). It's a new table, so no `migrate.py`
  change is needed — `Base.metadata.create_all()` creates it automatically
  on next deploy (see the comment at the top of `run_migrations()`).
- **device_tracking.py** (new) — `record_login_session()`, called from
  auth.py. Extracts the real client IP (`X-Forwarded-For`, since Railway
  proxies requests), geolocates it via a free no-key API
  (`ip-api.com`, 1.5s timeout, skipped entirely for private/local IPs),
  and parses the User-Agent with regex (no new dependency). **Everything in
  here is wrapped so it can never raise or block login** — if geolocation
  times out or fails, the row is still saved with blank location fields.
- **routers/auth.py** — calls `record_login_session(db, user, request, ...)`
  right after issuing the token, in both `login()` and `demo_login()`.
- **schemas.py** — `LoginSessionOut` response model.
- **routers/superadmin.py** — three new endpoints (all `require_superadmin`-
  gated, same pattern as the existing activity/audit-log endpoints):
    - `GET /api/superadmin/login-sessions` — filterable list (username,
      account_id, device_type, country, date range)
    - `GET /api/superadmin/login-sessions/export` — CSV export
    - `GET /api/superadmin/login-sessions/device-stats` — aggregate counts
      by device type / OS / browser / country over a window (default 30d)
- **superadmin_static/index.html** — new "Devices & Locations" tab: a stats
  row (top device/browser/country) plus a filterable, exportable table.
  Wired into the existing `switchTab()` router the same way every other tab
  is.

## Deploy
Just push and redeploy as usual — the new table is created automatically on
startup (`create_all()` + `run_migrations()`, already called in `main.py`).
No manual SQL, no Alembic, no downtime.

## Notes / things worth knowing
- **No new pip dependency.** Geolocation uses stdlib `urllib.request`; UA
  parsing is stdlib `re`. Nothing was added to `requirements.txt`.
- **Geolocation provider**: `ip-api.com`'s free tier (no key, ~45 req/min
  limit, HTTP only). Fine for normal login volume; if you ever hit the rate
  limit, geolocation just silently returns blank fields for that request —
  IP/device data still gets recorded either way. If you outgrow the free
  tier, swap the `_GEO_URL` in `device_tracking.py` for a paid provider —
  everything else stays the same.
- **Privacy**: this records data about *your own users* logging into *your
  own product*, visible only to superadmins. Consider mentioning it in
  your privacy policy / terms if you don't already cover login telemetry.
- **Bots**: registrations/logins from scripts (curl, requests, etc.) are
  tagged `device_type: "bot"` via a simple User-Agent keyword match, mostly
  so they don't skew your device-mix stats.
