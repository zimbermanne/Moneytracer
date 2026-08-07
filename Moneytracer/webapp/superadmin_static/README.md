# Superadmin Console

Served same-origin from this backend at `/superadmin` — e.g.
`https://adminwebappbackend-production.up.railway.app/superadmin`.

This replaces the earlier standalone-static-site approach. That version had
to be hosted on its own domain and needed CORS explicitly opened for it via
`ALLOWED_ORIGINS` on the backend — which caused persistent "Failed to fetch"
issues (wrong/missing origin, stale deploys, `file://` origin confusion).

Serving it from the same backend it manages removes the cross-origin
request entirely, so none of that applies anymore. Just open
`<your-backend-url>/superadmin` directly — no separate hosting, no
ALLOWED_ORIGINS entry needed for this tool specifically.

## What it talks to

- `routers/accounts.py` — per-tenant CRUD (list/view/suspend/activate/delete)
- `routers/superadmin.py` — cross-account diagnostics: `/api/superadmin/stats`,
  `/api/superadmin/activity` (the CRITICAL:-tagged cross-tenant feed), and
  `/api/superadmin/health`
- `POST /api/auth/impersonate/{user_id}` (in `routers/auth.py`) — 30-minute
  "Login as" support token, logged to the target account's own activity log

Only `role == "superadmin"` can log in or call any of the above.

## "Login as" still needs one setting

Since the tenant-facing app is a genuinely different app/origin, "Login as"
needs to know its URL to open a support session there. Click "Advanced:
custom API URL" on the login screen and set the **Tenant app URL** field —
this is the only cross-origin piece left, and it's just an outbound link
(`window.open`), not a fetch, so it isn't subject to CORS at all.
