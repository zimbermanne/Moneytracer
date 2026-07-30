# Moneytracer Implementation Plan — Closing the Feature Gaps

This README turns `FEATURE_GAP_ANALYSIS.md` into an actionable build order:
what to build, in what sequence, and how each piece fits the existing
FastAPI + React + Kotlin stack.

## Verified against the actual repo (`Moneytracer.zip`)

Checked the plan below directly against `webapp/models.py`, `webapp/ledger.py`,
`webapp/routers/ledgers.py`, `webapp/scheduler.py`, `webapp/email_utils.py`,
and `frontend/src/pages/`. Findings:

- **Confirmed, matches the plan exactly:** `routers/ledgers.py` only exposes
  debtors, creditors, and fiscal periods — no chart-of-accounts or
  journal-entry endpoints exist. `ledger.py` has `post_journal_entry()`,
  `post_sale_entry()`, `post_purchase_entry()`, `post_expense_entry()`,
  `reverse_journal_entry()`, and fiscal-period locking via
  `get_locked_period()` — exactly as described. `models.py` has
  `ChartOfAccount`, `JournalEntry`, `JournalLine`, `FiscalPeriod` already
  defined, just with no API surface. Phase 1 as written is accurate.
- **No `Attachment`, `RecurringInvoiceTemplate`, `ExchangeRate`, `Employee`,
  or `Budget` models exist anywhere in `models.py`** — Phases 2, 3, 4, and 5
  are genuinely greenfield, confirming the gap analysis.
- **Correction — recurring infrastructure already exists, reuse it:**
  `scheduler.py` already runs an APScheduler `BackgroundScheduler`
  (`start_scheduler()`) with daily jobs for overdue invoice reminders and
  compliance deadline reminders, including a `_add_months()` helper and
  roll-forward logic for recurring compliance deadlines. Phase 3
  (Recurring Invoices) should add a new job to this same scheduler instance
  rather than introducing new scheduling infrastructure.
- **Correction — email is already implemented, not just planned:**
  `email_utils.py` sends invoice/quotation PDFs via plain SMTP
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` env vars), not Resend/Postmark.
  Phase 3's auto-send step should call `send_email_with_attachment()`
  directly instead of standing up a new provider integration.
- **`Documents.jsx` is not attachments** — it's the existing
  Invoices/Quotations list/editor page. Phase 2's new component should be
  named distinctly (e.g. `AttachmentUploader.jsx`) to avoid confusion with
  this existing file.
- **No file-upload/multipart handling exists anywhere in `routers/`** —
  every router that mentions "attachment" does so only in the context of
  emailing a generated PDF, not accepting uploads. Phase 2 needs a genuinely
  new upload endpoint and storage integration.
- **No `currency_code` field on `Invoice`, `Purchase`, `Account`, or any
  other model** — currency today is a single per-account setting (via the
  `Country`/`african_currencies.py` reference data), not a per-transaction
  field. Phase 4 as scoped is required work, not an extension of something
  partial.

Priority order follows the analysis: Chart of Accounts/GL UI → Document
Attachments → Recurring Invoices → Multi-Currency → Payroll → everything
else.

---

## Phase 1 — Chart of Accounts & General Ledger UI

**Why first:** the double-entry engine (`ledger.py` → `post_journal_entry()`)
already exists and is battle-tested by every sale/purchase/expense that
posts through it today. This phase is almost entirely a "front door" —
new read endpoints plus one write endpoint that reuses existing logic.

### Backend (`routers/ledgers.py`)

1. `GET /ledgers/chart-of-accounts`
   - Return `ChartOfAccount` records as a nested tree (parent_id → children),
     grouped by type (asset/liability/equity/revenue/expense).
   - Include running balance per account (sum of posted journal lines,
     scoped to the tenant's `account_id`).

2. `GET /ledgers/journal-entries?account_id=&start_date=&end_date=`
   - Paginated list of journal lines for a given account — this is the
     "drill-down" view from an account row to its transaction history.
   - Return: date, description, debit, credit, running balance, and a
     reference back to the source document (sale/purchase/expense id) if
     the entry wasn't manual.

3. `POST /ledgers/journal-entries`
   - Accepts a manual entry: array of `{account_id, debit, credit}` lines.
   - **Do not duplicate posting logic.** Validate and call the existing
     `post_journal_entry()` so balancing rules, fiscal-period locking, and
     reversal support stay identical to every other posting path.
   - Reject if the fiscal period is closed (existing lock already covers
     this — just make sure the manual path checks it too).
   - Tag these entries `source_type = "manual"` so the GL can distinguish
     manual entries from system-generated ones in the UI.

### Frontend

4. `ChartOfAccounts.jsx`
   - Collapsible account tree grouped by type, balance per account,
     click-through to General Ledger filtered by that account.

5. `GeneralLedger.jsx`
   - Table view: date / description / debit / credit / running balance.
   - Filter by account, date range.
   - "New Journal Entry" button opens a form with dynamic debit/credit
     rows that must balance to zero before submit is enabled (client-side
     check; server re-validates).

### Definition of done
- A user can browse every account, see its balance, drill into its
  transaction history, and post a manual entry (e.g. opening balances)
  without touching the database directly.

---

## Phase 2 — Document Attachments on Transactions

**Why second:** cheap relative to its trust/audit payoff, and it doesn't
touch the accounting engine at all — pure additive feature.

1. **Storage:** use an object store (Railway supports S3-compatible
   buckets, or use a provider like Cloudflare R2/Backblaze B2 for cost —
   avoid storing binary blobs in Postgres).
2. **Model:** add an `Attachment` table — `id, account_id (tenant), entity_type
   ("expense"|"purchase"|"invoice"), entity_id, file_url, file_name,
   mime_type, uploaded_by, uploaded_at`.
3. **Endpoints:**
   - `POST /attachments` (multipart upload, returns file_url)
   - `GET /attachments?entity_type=&entity_id=`
   - `DELETE /attachments/{id}` (permission-gated — see Phase 6)
4. **Frontend:** a small `<AttachmentUploader>` component embedded on the
   expense/purchase/invoice detail views — thumbnail previews for images,
   a generic file icon + filename for PDFs.
5. **OCR (stretch goal, not in v1):** defer until the base upload flow is
   solid. If pursued later, a lightweight OCR API (e.g. Google Vision or
   Tesseract self-hosted) can pre-fill expense amount/vendor from a
   receipt photo — flag as a distinct, separate ticket.

### Definition of done
- Every expense/purchase/invoice can have one or more files attached and
  viewed inline, scoped correctly per tenant.

---

## Phase 3 — Recurring Invoices

**Why third:** direct revenue impact for service/retainer businesses, and
Moneytracer already has invoicing and reminders — this extends rather than
introduces new infrastructure.

1. **Model:** `RecurringInvoiceTemplate` — customer_id, line items, frequency
   (weekly/monthly/custom cron-like interval), next_run_date, active flag,
   auto-send toggle.
2. **Scheduler:** add a new job to the existing `scheduler.py`
   `BackgroundScheduler` (already running `send_overdue_invoice_reminders`
   and `send_compliance_deadline_reminders` on 24-hour intervals) — don't
   introduce separate scheduling infrastructure. The new job finds
   templates due today, generates a real `Invoice` row from the template,
   and — if auto-send is on — calls the existing
   `email_utils.send_email_with_attachment()` (SMTP-based) to send it.
3. **Endpoints:** CRUD for templates, plus a manual "run now" trigger for
   testing.
4. **Frontend:** a "Recurring Invoices" tab under Invoicing — template
   list, next-run date, pause/resume toggle.

### Definition of done
- A retainer client's invoice generates and sends itself on schedule with
  zero manual action.

---

## Phase 4 — Multi-Currency

**Why fourth:** high regional value (cross-border trade) but a genuinely
invasive change — touches invoices, journal entries, and reports.

1. **Model changes:**
   - Add `currency_code` to `Invoice`, `Purchase`, `Expense`.
   - Add `ExchangeRate` table: `from_currency, to_currency, rate, date`.
   - Every `JournalEntry` line keeps its original transaction currency
     *and* a converted base-currency (tenant's home currency) amount —
     never convert destructively; store both.
2. **Rate source:** a scheduled job pulls daily rates from a free/low-cost
   FX API (e.g. exchangerate.host, or a paid provider if reliability
   matters) and caches them locally — don't call an external API per
   transaction.
3. **Period-end revaluation:** at fiscal period close, revalue open
   foreign-currency balances (e.g. an unpaid USD invoice) against the
   period-end rate and post the FX gain/loss as a journal entry. This is
   the trickiest accounting logic in this phase — build it as an isolated,
   well-tested function since it directly affects the P&L.
4. **Reports:** balance sheet/P&L must clearly show base-currency totals,
   with an optional "as invoiced" column for transaction-level views.

### Definition of done
- A tenant can invoice in USD while books consolidate to TZS, with FX
  gain/loss correctly posted at period end.

---

## Phase 5 — Payroll

**Why fifth:** biggest lift of the near-term priorities, but closes a real
gap versus users bolting on a separate payroll tool.

1. **Model:** `Employee` (linked to tenant), `PayrollRun`, `Payslip`,
   `StatutoryDeduction` (configurable per country — PAYE bands, NSSF/social
   security rates vary by country, so this needs a lookup table, not
   hardcoded logic, given Moneytracer's 54-country support).
2. **Calculation engine:** gross pay → statutory deductions (by country
   config) → net pay. Keep this as its own module (`payroll.py`) separate
   from `ledger.py`, but have it call `post_journal_entry()` at the end so
   payroll runs post into the same books as everything else (salary
   expense, PAYE payable, net pay payable).
3. **Endpoints:** employee CRUD, run payroll for a period, generate
   payslip PDFs (reuse existing PDF export patterns from invoicing).
4. **Frontend:** Payroll module — employee list, "Run Payroll" wizard,
   payslip history/download.

### Definition of done
- A business can maintain an employee roster, run monthly payroll, and
  have salary expenses and statutory liabilities post automatically to
  the ledger.

---

## Phase 6 and beyond — Lower-urgency items

These are worth scoping but shouldn't block Phases 1–5:

- **Approval workflows & granular permissions** — add a `status`
  (pending/approved/rejected) field to expenses above a configurable
  threshold, plus a simple approval queue for admin/manager roles. Pairs
  naturally with Phase 2's attachment permission-gating.
- **Budgeting & forecasting** — a `Budget` table (category, month, amount)
  compared against actuals already computable from existing P&L queries;
  mostly a reporting feature, not a new engine.
- **Immutable audit trail** — harden `ActivityLog` into a version-chained,
  append-only log; block edits entirely (not soft-lock) once a period is
  closed.
- **Tax filing integration** — depends entirely on what API/format TRA (or
  other target revenue authorities) exposes; research spike before any
  build estimate.
- **Multi-entity consolidation** — a "parent account" concept that
  aggregates reports across two or more tenant accounts owned by the same
  user.
- **Bank reconciliation** — bank feed integration plus a matching UI
  (statement line ↔ ledger entry, mark cleared); likely needs a
  bank-data provider (Plaid-equivalent for the region, if one exists) —
  research spike first.
- **Job/project costing** — add an optional `project_id` tag to
  income/expense records and a per-project P&L report; additive, no
  engine changes needed.

---

## Cross-cutting notes

- **Everything routes through `post_journal_entry()`.** Any new feature
  that touches money (payroll, recurring invoices, FX revaluation) must
  post through the existing engine, not write journal rows directly —
  this is what keeps balancing, reversal, and period-locking guarantees
  intact.
- **Tenant isolation.** Every new table needs the same per-account
  scoping already fixed for the core tenancy bug — test explicitly for
  cross-tenant leakage on each new endpoint before shipping.
- **Migrations.** Given the model additions across phases (Attachment,
  RecurringInvoiceTemplate, ExchangeRate, Employee, etc.), keep each
  phase's migration self-contained and reversible.
