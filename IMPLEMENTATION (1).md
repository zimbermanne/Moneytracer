# Moneytracer — New Features Implementation Plan

Reference doc for the features discussed: email notifications, self-service
account recovery, and a paid "Pro" tier gating the accounting module,
via ClickPesa.

---

## 1. Why this order

Recovery has to land before the paywall goes live. If a paying tenant gets
locked out and there's no self-service recovery, it's a manual support
intervention every time — that doesn't scale. Email is a prerequisite for
recovery (reset links have to go somewhere), so it comes first even though
it's the less exciting feature.

**Build order:**
1. Email notifications (foundation)
2. Self-service account recovery
3. Subscription/tenant model fields
4. ClickPesa payment integration
5. Feature gating on Pro routes

---

## 2. Current state of the repo (as of this doc)

Audited before planning, so this reflects what's actually there, not
assumptions:

| Piece | Status |
|---|---|
| Email sending (SMTP) | ✅ Already built — `webapp/email_utils.py`. Has `send_plain_email` and `send_email_with_attachment`. Configured via `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_USE_TLS` env vars. Currently used for emailing invoice/quotation PDFs. |
| Tenant `plan` field | ✅ Already exists — `Account.plan` (free-text string, default `"free"`) in `webapp/models.py`, plus a superadmin endpoint `PUT /accounts/{id}/plan` in `routers/superadmin.py` to change it manually. |
| Self-service password reset | ❌ Missing. The only existing reset endpoint, `POST /auth/reset-password/{username}` in `routers/auth.py`, requires an **admin** token to call it (`require_admin` dependency) — it's an admin resetting someone else's password, not a locked-out user recovering their own account. |
| Subscription status / expiry tracking | ❌ Missing. `plan` is just a string with no `status` or `expires_at` — can't yet distinguish "paid and current" from "paid but lapsed." |
| ClickPesa payment integration | ❌ Missing entirely. |
| Feature gating on accounting routes | ❌ Missing entirely. Chart of Accounts / General Ledger / Trial Balance / Balance Sheet / VAT Returns are open to any authenticated tenant today. |

---

## 3. Decisions made

- **Payment provider:** ClickPesa (Tanzania-friendly — supports mobile money
  M-Pesa/Tigo Pesa/Airtel Money and cards; Stripe doesn't support TZ payouts
  well).
- **Pro tier structure:** single bundled Pro tier, not separate per-feature
  add-ons. One price unlocks all of: Chart of Accounts, General Ledger,
  Trial Balance, Balance Sheet, VAT Returns.
- **Gating granularity:** per-company/tenant (whole business upgrades
  together), not per-user. Matches how `Account.plan` already works.
- **ClickPesa integration type:** Hosted Checkout Link API — one API call
  returns a checkout URL, redirect the tenant admin there, ClickPesa handles
  collection. No PCI burden, no card data stored on our side.

---

## 4. Planned schema changes

Extend `Account` in `webapp/models.py` (currently just has `plan: str`):

```python
subscription_status = Column(String(20), default="active")   # "active" | "past_due" | "cancelled"
subscription_expires_at = Column(DateTime, nullable=True)
```

`plan` itself stays as-is ("free" / "pro" values), no need to change its
type — it's already free-text by design so the superadmin console can
introduce new tiers without a code deploy.

---

## 5. Self-service account recovery — planned flow

New endpoints in `routers/auth.py`:

- `POST /auth/forgot-password` — takes username or email, generates a
  short-lived signed JWT (15–30 min expiry, no new DB table needed — reuses
  the existing JWT infra), emails a reset link via `email_utils.send_plain_email`.
  Always returns a generic success message regardless of whether the
  account exists, to avoid leaking which usernames/emails are registered.
- `POST /auth/reset-password-confirm` — takes the token + new password,
  verifies signature and expiry, updates `hashed_password`.

Needs: SMTP credentials configured in the deployment env (ask user whether
they have a provider already, e.g. Gmail app password / Zoho / SendGrid, or
need help picking one).

---

## 6. ClickPesa integration — planned flow

Reference: https://docs.clickpesa.com/api-reference/collection/generate-checkout-link/generate-checkout-link

**Auth:** Client ID + API Key (from a Hosted Application created in the
ClickPesa dashboard: Settings → Developers → Create Application → Integration
Type: Hosted) are exchanged for a short-lived JWT bearer token via
ClickPesa's token endpoint. That bearer token is then used on the checkout
call.

**Checkout call:**
```
POST https://api.clickpesa.com/third-parties/checkout-link/generate-checkout-url
Authorization: Bearer <token>
Content-Type: application/json

{
  "totalPrice": "<amount>",
  "orderReference": "<unique ref, alphanumeric only>",
  "orderCurrency": "TZS",
  "customerName": "...",
  "customerEmail": "...",
  "customerPhone": "255712345678",
  "description": "Moneytracer Pro subscription",
  "callbackUrl": "https://<backend>/billing/clickpesa-webhook"
}
```
Response: `{ "checkoutLink": "...", "clientId": "..." }` — redirect the
tenant admin to `checkoutLink`.

**Webhook handling:** `POST /billing/clickpesa-webhook` on our backend —
verify the checksum (see ClickPesa's checksum docs), then on success:
set `account.plan = "pro"`, `subscription_status = "active"`,
`subscription_expires_at = now + 30 days` (or whatever billing period is
chosen).

**Expiry sweep:** a scheduled job (project already has `webapp/scheduler.py`
for this kind of recurring task) runs daily, finds accounts where
`subscription_expires_at < now` and `plan == "pro"`, downgrades them back to
`plan = "free"`.

Needs: a ClickPesa Hosted Application (Client ID + API Key) — not yet
created as of this doc.

---

## 7. Feature gating — planned implementation

A FastAPI dependency, e.g. `require_pro_tier`, added to the routers for:
- Chart of Accounts
- General Ledger
- Trial Balance
- Balance Sheet
- VAT Returns

It checks `current_user.account.plan == "pro"` (and ideally
`subscription_status == "active"`), raising 402/403 with a clear message if
not. Frontend wraps the corresponding nav items/routes with the same check
on `company.subscription_tier` and shows an upgrade prompt instead of the
page when on the free tier.

Everything else (invoicing, POS, customers, expenses, etc.) stays
accessible on the free tier.

---

## 7.5 Self-service account recovery — confirmed scope

Confirmed: recovery is simple forgot-password-via-email, not a broader
account-recovery mechanism (no security questions, no SMS, no support
escalation flow). Matches section 5 above exactly:

1. User clicks "Forgot password?" on login, submits their username/email.
2. Backend generates a short-lived signed token (reuses existing JWT
   infra — no new table) and emails a reset link via the already-built
   `email_utils.send_plain_email`.
3. Response is always a generic "if that account exists, we've sent
   instructions" message — regardless of whether the account was found —
   so the endpoint can't be used to enumerate registered usernames/emails.
4. User clicks the link, lands on a reset-password page, submits a new
   password against the token.
5. Backend verifies the token's signature and expiry, updates
   `hashed_password`.

**Inputs required before this can be wired to a real inbox:**
- SMTP credentials: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  and the "from" address/name to show recipients (e.g.
  `noreply@zimbermanne.com`). Can use an existing business inbox (Gmail
  Workspace / Zoho, app-specific password) or a transactional provider
  (Resend, Brevo) if preferred.
- Confirm the frontend reset-link URL shape, e.g.
  `https://moneytracer.up.railway.app/reset-password?token=...` — a
  matching page needs to exist there.

**New endpoints (`routers/auth.py`):**
- `POST /auth/forgot-password` — body: `{ "username_or_email": "..." }`
- `POST /auth/reset-password-confirm` — body: `{ "token": "...", "new_password": "..." }`

**New frontend pieces:**
- "Forgot password?" link on the login screen
- `/reset-password` page that reads `token` from the URL query string and
  submits a new password

---

## 7.6 Self-service account recovery — implemented

Built and committed (frontend builds clean):

**Backend:**
- `auth.py`: `create_password_reset_token()` / `verify_password_reset_token()`
  — a dedicated, single-purpose JWT (30 min expiry) distinct from login
  tokens. Bound to the user's current `token_version` and a hash of their
  current `hashed_password`, so it's automatically invalidated the moment
  the password actually changes — can't be replayed.
- `routers/auth.py`:
  - `POST /api/auth/forgot-password` — rate-limited (5/hour), always
    returns the same generic message regardless of whether the account
    exists, so it can't be used to enumerate usernames/emails. Skips
    demo accounts and accounts with no email on file. Emails via the
    existing `email_utils.send_plain_email`; if SMTP isn't configured,
    logs it server-side but still returns the generic response.
  - `POST /api/auth/reset-password-confirm` — rate-limited (10/hour),
    verifies the token and updates the password.
- `schemas.py`: `ForgotPasswordRequest`, `ResetPasswordConfirmRequest`.

**Frontend:**
- `src/pages/ForgotPassword.jsx` — new page, submits to
  `/api/auth/forgot-password`, shows the generic confirmation message.
- `src/pages/ResetPassword.jsx` — new page, reads `?token=` from the URL,
  submits new password + confirm to `/api/auth/reset-password-confirm`,
  redirects to `/login` on success.
- Routes added in `App.jsx`: `/forgot-password`, `/reset-password`.
- "Forgot password?" link added under the password field on `Login.jsx`.

**Still required to actually go live:** SMTP env vars
(`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`) set on the
backend Railway service — without them, the emails silently don't send
(logged server-side, generic response still shown to the user).

---

## 8. Open items / inputs still needed before building

- [ ] SMTP provider + credentials (or decide on one)
- [ ] ClickPesa Hosted Application created → Client ID + API Key
- [ ] Confirm billing period (monthly? annual?) for `subscription_expires_at` math
- [ ] Confirm Pro tier price (TZS amount for the `totalPrice` field)
