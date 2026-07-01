# Zimbermanne accounting OS — v3.0 Skysracher

This project was generated from `README3.0.md`. It implements the **"Currently Working (v3.0)"**
feature set as a working FastAPI backend (`webapp/`) and a React + Vite frontend (`frontend/`),
matching the project structure, sidebar design, and theme described in the README.

## What's included

- **Backend** (`webapp/`): JWT auth with bcrypt, role-based access (Admin/Manager/Employee),
  Inventory CRUD + batch import + low-stock alerts, POS multi-item checkout with stock
  validation, Sales/Purchases/Expenses, Debtors/Creditors ledgers, Reports (P&L, financial
  summary, debtors/creditors, inventory valuation, daily summary), Activity log, Backup
  create/list/restore/upload/delete, and an optional AI agent router (`/api/agent/*`,
  requires `ANTHROPIC_API_KEY`). SQLite is used by default (zero setup); set `DATABASE_URL`
  for PostgreSQL in production.
- **Frontend** (`frontend/`): React + Vite app with the Zoho-style collapsible grouped sidebar
  (light theme, navy/gold/cream tokens), mobile hamburger drawer, JWT login, and pages for
  Dashboard, POS, Inventory, Sales, Purchases, Expenses, Debtors, Creditors, Reports, and
  Settings — all wired to the backend API.

## Quick start

### 1. Backend

```bash
cd webapp
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python init_db.py               # seeds default admin / admin123
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `http://localhost:8000`
(see `vite.config.js`; override with `VITE_API_URL` if your backend runs elsewhere).

Default login: **admin / admin123** — change this immediately after first login
(Settings → Change Password).

## Not yet implemented

The README's **Roadmap (v3.0+)** items — double-entry accounting, invoicing/quotes,
customers/vendors as first-class entities, banking, purchase orders, advanced reports,
documents, notifications, multi-tenant, mobile money webhooks — are scaffolding targets for
the next phase and aren't built here. The `routers/` and `models.py` files are structured so
each of those can be added as its own router + model set, per the README's "What to build"
notes.

## Project layout

```
webapp/      → FastAPI backend (see webapp/README references in main README)
frontend/    → React + Vite frontend
```
# Multi-Tenant Architecture Plan

> Status: **design discussion, not yet implemented.** This document captures the
> decisions and open questions for converting Zimbermanne Retail OS from a
> single shared business database into a multi-tenant platform where many
> separate businesses can use the same deployment without seeing each other's
> data.

## Why this change

The current app is a single shared database: every logged-in user (admin,
manager, employee) sees the same inventory, sales, purchases, ledgers,
quotations, and invoices. That fits one shop with several staff sharing one
register. It does **not** fit "many independent businesses/users on one
platform," where each business's data must be private to that business.

## Chosen model: Teams / Accounts

Two layers of identity instead of one:

1. **Account** (the business / tenant) — owns all business data: inventory,
   sales, purchases, expenses, debtor/creditor ledgers, quotations, invoices,
   customers, and its own activity log.
2. **User** — belongs to exactly one account, with a role scoped *within*
   that account. Data is shared among users of the same account, and fully
   isolated from every other account.

This means almost every table gains an `account_id` foreign key
(`InventoryItem`, `Sale`, `Purchase`, `Expense`, `Debtor`, `Creditor`,
`Document`/`DocumentLine`, `ActivityLog`), and every query in every router
must filter by the current user's `account_id` — not just by what happens to
be in the table.

## Roles within an account

Keeping the existing three roles, redefined as account-scoped rather than
platform-wide:

- **admin** — full control within their own account: manage inventory,
  sales, ledgers, settings; invite/remove staff; reset staff passwords;
  view the account's activity log.
- **manager** — operational control (inventory, purchases, sales, ledgers,
  quotations/invoices) but cannot manage other users.
- **employee** — day-to-day actions (POS sales, recording purchases) but
  cannot edit inventory pricing, delete records, or see financial reports.

## Open questions (to be decided before implementation)

These determine real implementation details and are still pending a decision:

1. **Account creation** — self-serve (anyone registering creates a brand-new
   account), platform-owner-only, or both?
2. **Adding staff to an existing account** — does the account admin create
   the username/password directly, or send an invite link/code the new staff
   member signs up with? (Or admin's choice of either?)
3. **Platform-level role** — is there a `superadmin` role (for the platform
   owner, not tied to any one account) that can manage accounts (suspend,
   help with lockouts) — and if so, can it view business data for support,
   or strictly account-management only with no visibility into business data?

## Additional things to design before/alongside the above

- **Account-level settings**: currency, tax/VAT rate, business name/address/
  logo — used on invoice & quotation PDFs instead of one hardcoded company
  name (currently `COMPANY_NAME`/`COMPANY_ADDRESS`/etc. env vars in
  `routers/documents.py`), and a per-account receipt numbering prefix.
- **Seat/staff limits** — relevant if this is ever monetized per account.
- **Account suspension vs. deletion** — a way to deactivate a whole account
  (non-payment, abuse) without destroying its data, separate from a genuine
  hard-delete/export-then-delete flow for closure requests.
- **Data export per account** — account admins should be able to export
  *all* their own data (inventory, sales, ledgers, documents) for backup and
  portability.
- **Audit log scoping** — activity logs must be scoped per account; one
  business's admin should never see another's audit trail.
- **Invite expiry & revocation** — if invite links are used, they should
  expire and be revocable before use.
- **Locked-out account admin recovery** — if an account's only admin forgets
  their password, only a platform-level role (if one exists) can help;
  otherwise that account is stuck. Needs a decision either way.
- **Session handling** — whether logging in on a new device invalidates
  older sessions, especially relevant once accounts hold financial data.
- **Demo account** — the current shared `demo` user (see `is_demo` on
  `User`, and `/api/auth/demo-login` in `routers/auth.py`) should likely
  become its own isolated demo *account* with its own fake data, rather than
  a personal user inside someone else's account structure.

## Growth & Scale Considerations

These matter once we're expecting many clients rather than a handful — not
required for the initial multi-tenant cutover, but worth tracking so they're
not forgotten.

**Multi-location / scale within a single business**
- Multi-branch/multi-warehouse support for clients with more than one shop
  (separate stock per location, transfers between branches, branch-level
  reporting rolled up to the account).
- Multi-currency support for clients operating across borders.

**Onboarding & growth**
- A setup wizard for new accounts (business name, currency, first inventory
  items) instead of dropping people into an empty dashboard.
- Referral/invite incentives, if organic growth matters.
- A public marketing/landing page separate from the app itself.

**Performance at scale**
- Pagination on every list endpoint (inventory, sales, purchases,
  documents) — currently all unpaginated, fine for one shop but not for
  accounts with tens of thousands of sales rows.
- Database indexing review once data volume grows, particularly around the
  new `account_id` columns.
- Background job processing for heavy operations (bulk PDF generation,
  large spreadsheet imports/exports, scheduled report emails) so they don't
  block the request thread.
- Caching for expensive aggregate queries (dashboard metrics, reports).

**Reliability & ops**
- Automated backups with a tested restore process.
- Monitoring/alerting (uptime, error rates) and structured logging across
  many accounts.
- Rate limiting per account/IP so one client's misbehaving script (or a bad
  actor) can't degrade service for everyone else.

**Support & communication**
- In-app notifications or email alerts (low stock, invoice overdue, payment
  received).
- A support channel, even a simple "contact support" form tagged with the
  originating account.

**Trust, legal & compliance**
- Terms of Service and a Privacy Policy, since the platform holds other
  businesses' financial data.
- A real data-deletion/account-closure flow (export then delete).
- Clear data ownership language — clients should know they own their data
  and can leave with it.

**Product surface**
- A read-only API for power-user clients to integrate with their own tools.
- Optional white-labeling (logo/colors on invoices, maybe a custom
  subdomain) — already partly anticipated by account-level branding in the
  "Additional things to design" section above.

## Onboarding Wizard (new account setup)

A short guided flow shown right after a new account is created, instead of
dropping the user into an empty dashboard. Collects the data needed both for
day-to-day use and for proper invoice/quotation documents (which already
expect a business name/address — see `routers/documents.py`).

**Step 1 — Business basics**
- Business structure: **Solo/Individual** or **Registered Company**
- Business name
- TIN (Tax Identification Number) — required if Company, optional if Solo
- Owner/representative full name
- Business type/category (retail shop, restaurant, pharmacy, wholesale,
  etc.)
- Office/business location (region, district, street address)

**Step 2 — Contact & branding**
- Phone, email, logo upload
- These become the per-account values that replace the current hardcoded
  `COMPANY_NAME` / `COMPANY_ADDRESS` / `COMPANY_PHONE` / `COMPANY_EMAIL` env
  vars in `routers/documents.py`, plus TIN printed on invoices/quotations.

**Step 3 — Tax & invoicing defaults**
- Default VAT/tax rate
- Invoice numbering prefix
- Default payment terms (e.g. "due in 7 days")

**Step 4 — First inventory items (optional, skippable)**
- Add a few items manually, or jump straight to the existing spreadsheet
  import (`/api/inventory/batch`) to get a non-empty dashboard immediately.

**Step 5 — Invite staff (optional, skippable)**
- Add other staff now, or skip and do it later from Settings.

Steps 1–3 are mandatory before reaching the dashboard (this is the data the
business actually needs to operate and to issue compliant invoices); steps
4–5 are skippable and can be completed later from Settings.

This wizard depends on the `Account` model existing first (see
"Implementation impact" below) — the fields above map directly onto new
columns on that table.

## Implementation impact (high level, for later reference)

- `models.py`: new `Account` table with columns covering the wizard fields:
  `business_structure` (solo/company), `name`, `tin` (nullable, required
  only when company), `owner_full_name`, `business_type`, `location`
  (region/district/address), `phone`, `email`, `logo_url`, `tax_rate`,
  `invoice_prefix`, `payment_terms_days`. `account_id` FK added to `User`
  and to every business-data table listed above.
- Every router (`inventory.py`, `sales.py`, `purchases.py`, `expenses.py`,
  `ledgers.py`, `reports.py`, `customers.py`, `documents.py`, `activity.py`,
  `backup.py`) needs its queries filtered by `current_user.account_id`.
- `auth.py` / `routers/auth.py`: registration needs to create (or join) an
  account, not just a user; JWT payload likely needs `account_id` alongside
  `sub`/`role`.
- `routers/users.py`: admin actions (list/update/delete/reset-password)
  must be scoped to users within the same account.
- Migration: existing single-tenant data needs a one-time migration into a
  default "legacy" account so nothing breaks for current users.
