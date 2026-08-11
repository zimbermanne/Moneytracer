# Moneytracer — System Overview

A full map of what exists today: features, how they're arranged, how the
system works underneath, its security model, sync status, configuration,
and — at the end — a recommendation on sequencing so you're not holding
the whole system in your head at once while building on it.

---

## 1. How the app is arranged (the sidebar is the real map)

The sidebar (`frontend/src/components/Sidebar.jsx`) is the actual source
of truth for how the product is organized — it's grouped exactly how a
business owner thinks about their operations, not how the code happens to
be split into files. In order:

- **Home** (`/app`) — dashboard
- **POS** (`/app/pos`) — point of sale, business/community accounts only
- **Sales**
  - Sales history
  - Customers
- **Clients/Debtors** (`/app/debtors`) — people who owe the business money
- **Purchases**
  - Purchases ledger
  - Purchase Orders
- **Creditors** (`/app/creditors`) — people/suppliers the business owes money to
- **Proforma**
  - Invoices
  - Quotations
- **Inventory**
  - Inventory ledger
- **Accounting** *(this whole group is the "Pro tier" we scoped earlier)*
  - Chart of Accounts
  - General Ledger
  - Trial Balance
  - Balance Sheet
  - VAT Return
- **Reports**
  - Profit & Loss
  - Financial Summary
  - Cash Flow
  - Debtors Report
  - Creditors Report
  - Inventory Valuation
- **Expenses**
- **Bank Loans**
- **Assets**
- **Payroll** — business/community accounts only
- **Budgets** — business/community accounts only
- **Personal** — a personal-finance mode, separate from the business books
- **Deadlines** — compliance/reminder tracking
- **Activity Logs** — manager/admin/superadmin only
- **Settings**

A few nav items are conditionally shown based on **account type**
(`business` vs `community` vs presumably a personal-only type) or **role**
(Activity Logs only shows for manager+). This matters for anyone adding a
new feature: decide up front which account types and roles should see it,
the same way every existing item does.

---

## 2. What each area actually does (grounded in the backend routers)

The backend has 28 routers (`webapp/routers/`), each owning one feature
area. Roughly, by what they're responsible for:

| Area | Router(s) | What it does |
|---|---|---|
| Auth & accounts | `auth.py`, `accounts.py`, `users.py` | Login, registration, password reset/recovery (just built), tenant (`Account`) management, user management within a tenant |
| Point of Sale | `sales.py` | Cart checkout, stock decrement, receipt generation, auto-creates a `Debtor` + itemized `DebtorItem`s on credit sales (just fixed) |
| Inventory | `inventory.py` | Stock items, SKUs, quantities, reorder points, cost/selling price |
| Debtors / Creditors | `ledgers.py` | Who owes the business, who the business owes, itemized lines, payments against a balance, status (unpaid/partial/paid) |
| Purchasing | `purchases.py`, `purchase_orders.py` | Buying stock in, PO lifecycle (draft → ordered → received, moves stock on receipt) |
| Invoicing | `invoices.py`, `quotations.py` | Formal documents sent to customers, PDF generation, public verification links (`/verify/invoice/:id`) |
| Accounting core | `ledgers.py` (chart of accounts / journal entries), `reports.py` | Double-entry bookkeeping: Chart of Accounts, General Ledger, Trial Balance, Balance Sheet, journal entries, **fiscal period locking** (periods can be closed so historical entries can't be silently edited) |
| Expenses | `expenses.py` | Business spending, categorized |
| Payroll | `payroll.py` | Employees, payslips |
| Assets & loans | `assets.py`, `bank_loans.py` | Fixed assets, business loan tracking with repayment schedules |
| Budgets | (model exists: `Budget`) | Budget vs actual tracking |
| Personal finance | `personal.py` | A separate ledger for personal (non-business) money — has its own spending categories/tags |
| Community/savings groups | `community.py` | Vikoba-style group savings: contributions, payouts, group loans — a distinct feature set from the core business accounting |
| Compliance | `deadlines.py` | Recurring compliance deadlines (tax filings etc.) with reminders |
| Documents | `attachments.py`, `backup.py` | File attachments on records, account backup/export |
| Activity & audit | `activity.py` | Every significant action logs an `ActivityLog` row — this is your audit trail |
| AI assistant | `agent.py` | A chat endpoint that hands the last 50 sales + expenses + purchases + inventory to Claude (via `ANTHROPIC_API_KEY`) for Q&A — off by default unless that key is set |
| Multi-tenant admin | `superadmin.py` | Cross-tenant management — changing a tenant's `plan`, etc. (this is where Pro-tier gating would plug in) |
| Reference data | `reference.py`, `public.py` | Countries, languages, tax authorities/rates, public-facing document verification |
| Approvals | `approvals.py` | A generic approval-workflow model (`Approval`) — for gating actions behind a second person's sign-off |

**The throughline:** almost every table has an `account_id` foreign key.
That's the multi-tenancy boundary — one Postgres database, every table
scoped to a business, enforced in each router via a `get_account_filter()`
helper that restricts queries to the logged-in user's `account_id` (or no
filter at all for superadmin).

---

## 3. How the pieces actually connect (the request lifecycle)

1. Frontend (`api-config.js`) sends a request with either the httpOnly
   auth cookie or (if you followed the desktop plan) a Bearer token.
2. FastAPI's `get_current_user` dependency (`auth.py`) decodes the JWT,
   loads the `User` row.
3. Router-level dependencies (`require_admin`, `require_manager_up`,
   `require_superadmin`, or just `get_current_user`) gate the endpoint by
   role.
4. Inside the endpoint, `get_account_filter(current_user)` scopes every
   query to that user's tenant.
5. Many write operations don't just touch one table — e.g. POS checkout
   touches `Sale`, conditionally `Debtor` + `DebtorItem`, decrements
   `InventoryItem.quantity`, and posts a `JournalEntry` via
   `post_sale_entry()` in `ledger.py` — so the accounting side of the app
   stays in sync with the operational side automatically, without a
   separate manual bookkeeping step.
6. `log_activity_for_user()` writes an `ActivityLog` row for anything
   significant — this is the audit trail referenced in the Activity Logs
   nav item.

---

## 4. Security model, as it actually stands

- **Auth:** JWT (via `python-jose`), `HS256`, signed with `SECRET_KEY`.
  Delivered as an httpOnly cookie (`SameSite=None; Secure`) — chosen
  because frontend and backend are on different Railway subdomains
  (cross-site). `SECRET_KEY` **must** be set as a persistent env var in
  production; the code deliberately falls back to a random one-time key
  if it isn't set, specifically so tokens don't survive a restart rather
  than silently using a weak default — but that also means every restart
  invalidates every logged-in session until it's set properly.
- **Password hashing:** `passlib` (bcrypt-family, via `pwd_context`).
- **Roles:** `RoleEnum` — at least `admin`, `manager`, `superadmin` (plus
  whatever a base authenticated user is). Role checks are composable
  FastAPI dependencies (`require_admin = require_roles(RoleEnum.admin)`),
  applied per-router-endpoint, not globally.
- **Tenant isolation:** enforced per-query via `account_id` filtering, not
  via separate databases/schemas per tenant — meaning a bug in any single
  endpoint that forgets to apply the filter is a cross-tenant data leak.
  This is the single most important pattern to get right on every new
  endpoint added to the system.
- **Rate limiting:** `slowapi` (`rate_limit.py`), applied to
  auth-sensitive endpoints (login, register, forgot-password) —
  `forgot-password` at 5/hour, `reset-password-confirm` at 10/hour, etc.
- **Password reset tokens:** deliberately a *separate* JWT purpose/claim
  from login tokens (`purpose: "password_reset"`), bound to the user's
  current password hash so a token is invalidated the instant it's used —
  can't be replayed.
- **CORS:** `ALLOWED_ORIGINS` env var, currently set to the production
  frontend URL specifically (not `*`) — correct for production.
- **Fiscal period locking:** `FiscalPeriodLockedError` in `ledger.py` —
  once an accounting period is closed, journal entries in it can't be
  silently edited; corrections have to go through reversing entries. This
  is a real accounting-integrity feature, not just a UI restriction.
- **What's notably *not* yet built:** no 2FA, no session/device
  management (can't see or revoke individual logged-in sessions), no
  granular per-feature permissions beyond the 3-ish roles, no field-level
  audit diffing (activity log records that an action happened, not
  necessarily a full before/after diff of every field).

---

## 5. Sync mechanism — there isn't one yet

Worth being direct about this: **there is currently no offline/sync layer
in this system.** Every read and write goes straight to the Railway
Postgres database over a live connection. This was the subject of the
separate `DESKTOP_OFFLINE_PLAN.md` doc — if a Windows offline-capable app
is still the goal, that plan lays out what's required (client-generatable
IDs instead of auto-increment integers, `updated_at` tracking added to
most tables, new `/sync/pull` and `/sync/push` endpoints, a conflict
policy per table). Nothing described there exists in the codebase yet —
it's a future phase, not a current feature.

---

## 6. Configuration — every env var that currently drives behavior

| Variable | Purpose | Default if unset |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | falls back to local SQLite file (dev only) |
| `SECRET_KEY` | JWT signing key | random per-restart (sessions don't survive a restart until this is set) |
| `ALGORITHM` | JWT algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Login session length | `60` |
| `COOKIE_SECURE` | Whether the auth cookie requires HTTPS | `true` |
| `ALLOWED_ORIGINS` | CORS allowlist | `*` (should always be set explicitly in production — it already is) |
| `FRONTEND_URL` | Used to build links back to the frontend (invoice verification links, password reset links) | `https://moneytracer.up.railway.app` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_USE_TLS` | Outbound transactional email (invoices, password reset) | unset = emails silently don't send, logged server-side only |
| `CURRENCY` | Default display currency | `TZS` |
| `COMPANY_NAME` / `COMPANY_ADDRESS` / `COMPANY_EMAIL` / `COMPANY_PHONE` | Used on generated documents (invoices/receipts) | `Moneytracer` / `Arusha, Tanzania` / blank / blank |
| `ANTHROPIC_API_KEY` | Enables the AI assistant chat endpoint | unset = that feature returns a clear 503, doesn't break anything else |

**Not yet added** (from our earlier planning): `VITE_API_URL` (frontend
build arg, already wired), and nothing yet for ClickPesa (`CLICKPESA_CLIENT_ID`,
`CLICKPESA_API_KEY`) — those get added when that phase starts.

---

## 7. How to reduce the load of thinking while building on this

This is the actually important part of your question. The system is
large — 65+ models, 28 routers — and trying to hold all of it in your head
at once while building new features is how bugs like the `DebtorItem`
one (a feature reworked in one place but not updated in the other place
that also touches it) happen. Some concrete ways to lower that load:

1. **Treat this document (and the two others — `IMPLEMENTATION.md`,
   `DESKTOP_OFFLINE_PLAN.md`) as living reference, not one-time reading.**
   Have your AI agents re-read the relevant section before touching an
   area, rather than working from memory of the codebase. The `DebtorItem`
   bug happened specifically because two related pieces of code lived in
   different files and one got updated without the other — a
   quick "what else touches this model?" search before shipping a change
   would have caught it.

2. **Work one vertical slice at a time, not one file at a time.** A
   feature like "credit sale" touches `Sale`, `Debtor`, `DebtorItem`,
   `InventoryItem`, and the `JournalEntry`/ledger posting — all in one
   request. When changing behavior here, grep for every model/router that
   references the same tables before considering the change done, rather
   than assuming the file you edited is the only place affected.

3. **Let the multi-tenancy pattern do the thinking for you.** Every new
   table needs `account_id`, every new query needs
   `get_account_filter()` applied. This is mechanical enough that it
   should be a checklist item on every new endpoint, not something to
   reason about fresh each time.

4. **Separate "core operational" work from "new frontier" work.** Things
   like POS, inventory, debtors/creditors, invoicing, and core accounting
   are stable, well-established patterns in this codebase — safe for
   agents to extend by following existing examples closely. Things like
   offline sync, payments, and new Pro-tier gating are genuinely new
   architecture with no existing pattern to copy — those deserve more
   deliberate, single-threaded attention (one agent, one focused session,
   full read of the relevant plan doc) rather than being parallelized
   across multiple agents working from partial context.

5. **Use the existing audit trail as a debugging tool, not just a
   compliance feature.** `ActivityLog` already records what happened and
   by whom — when something looks wrong in production, check there before
   guessing.

6. **Given you have an AI agent team:** the highest-leverage thing you can
   do is keep these three markdown docs (this one, `IMPLEMENTATION.md`,
   `DESKTOP_OFFLINE_PLAN.md`) up to date as living specs, and have each
   agent's task explicitly reference the relevant section rather than
   re-deriving context from scratch by reading the whole codebase every
   time. That's the actual lever for "reducing the load of thinking" —
   not simplifying the system itself (it's already reasonably
   well-organized for its size), but making sure the *context* required
   to work on any given piece is written down once and reused, instead of
   rebuilt in every agent's head on every task.
