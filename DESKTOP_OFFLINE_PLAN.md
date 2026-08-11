# Moneytracer Desktop — Offline-First Windows App Implementation Plan

Audience: an AI agent team picking this up as a work plan. This is a
significant architecture addition, not a feature patch — treat each phase
below as a gate, not a checklist item to blast through. Do not proceed to
sync-writes (Phase 3+) until Phase 1-2 are solid; a half-built sync layer on
financial data (stock, debts, ledgers) is worse than no sync at all — it can
silently corrupt a business's books.

---

## 0. Current state (audited from the live repo, ground truth as of this doc)

- **Frontend:** React + Vite, already has a `manifest.json`/icons — a PWA
  install already works today with zero extra build effort. Worth shipping
  as an interim step regardless of what else happens here.
- **Backend:** FastAPI + PostgreSQL (Railway), multi-tenant via
  `account_id` on every business table.
- **IDs:** plain auto-increment `Integer` primary keys on every table
  (`Sale.id`, `Debtor.id`, `InventoryItem.id`, etc.) — **this is the first
  real blocker**, see Phase 2.
- **Change tracking:** only 6 tables currently have an `updated_at` column
  with `onupdate`. Most core business tables (`Sale`, `Debtor`,
  `InventoryItem` partially, ledger tables) do not. A sync engine needs
  "what changed since timestamp X" on every synced table — this doesn't
  exist yet anywhere close to comprehensively.
- **Auth:** httpOnly cookie (`SameSite=None; Secure`), built for
  cross-site browser behavior — needs verification/likely rework for a
  desktop webview context (see Phase 1).
- **Business logic with race/offline implications:** `_decrement_stock` in
  `routers/sales.py` checks stock live against the DB at write time. Any
  offline queue that defers this check to sync-time needs the same
  validation re-run server-side, with a defined behavior for the conflict
  case (see Phase 4).

---

## Tech stack & language decision

Settled here so the team doesn't re-litigate it per-task.

**Language:** No new language required. The shell layer (Tauri) is
written in Rust internally, but day-to-day work stays in JavaScript/TS —
Tauri is configured via `tauri.conf.json` plus JS glue code that calls
into the existing React app. Rust is only needed if/when deeper native OS
integration is wanted later (e.g. custom file-system hooks) — not for the
baseline wrap. Backend stays Python/FastAPI, unchanged.

**Tauri vs Electron — Tauri, decided:** Electron bundles its own Chromium
runtime (~100-150MB installs, higher RAM). Tauri uses Windows' built-in
WebView2 instead — ~5-15MB installers, and WebView2 already ships on most
Windows machines. This matters concretely for this product's actual user
base (small businesses in Tanzania, often on slower connections/older
hardware) more than it would for a typical enterprise tool — smaller
install, less to download, less to update.

**"Web form or fully native GUI" — three real options, not two:**

| | PWA install | Tauri shell (this plan) | Full native rewrite (WPF/WinUI/.NET) |
|---|---|---|---|
| What it is | Existing browser tab, installed via `manifest.json` | Existing React app wrapped in a native window | Ground-up rebuild in a native UI toolkit |
| Feels like | A website with a window frame | A real desktop app — own icon/window/installer, no browser chrome | Fully native Windows widgets |
| Offline | None | Read-only cache (Phase 1), optional offline writes (Phase 3) | Whatever's built — same sync challenges either way |
| Effort | Zero — works today | Moderate — days to a couple weeks for Phase 1 | Very high — months, and a second UI codebase to maintain forever after |
| Maintenance going forward | Free — same codebase as the web app | One shared codebase (React), thin platform-specific shell | Two separate frontends to keep in sync on every future feature |

**Decision: Tauri, wrapping the existing React frontend.** A full native
rewrite means every future feature gets built twice, forever — not
sustainable for a small team (AI-agent or otherwise) maintaining one
product. Ship Phase 0 (PWA) immediately as a stopgap, treat the Tauri
shell as the real target, and do not scope a native rewrite unless a
concrete, specific requirement emerges that Tauri genuinely can't meet.

---



Before any native app work: confirm Windows/Edge "Install app" works
cleanly off the existing `manifest.json`. This is not offline-capable (it's
still a browser tab under the hood, no local storage), but it's a taskbar
icon / own-window experience for near-zero cost, and buys time to plan the
rest properly. Don't skip this step just because it's not the "real"
answer — it's the fastest thing that actually ships.

---

## Phase 1 — Desktop shell, read-only cache (no offline writes yet)

Goal: app opens without internet, shows the last-synced data (dashboard,
inventory list, debtor balances, recent sales) as read-only. Any action
that changes money or stock (recording a sale, taking a payment) requires
being online and is disabled/greyed out when offline, with a clear
"You're offline — some actions are unavailable" banner.

This phase deliberately avoids conflict resolution entirely by not
allowing offline writes. It's the highest-value, lowest-risk step.

**Tasks:**
1. **Shell:** Tauri (not Electron) — uses Windows' built-in WebView2
   instead of bundling Chromium, so installers stay ~5-15MB vs 100MB+.
   Wraps the existing React/Vite frontend as-is.
2. **Auth in a webview context:** verify whether the existing httpOnly
   `SameSite=None; Secure` cookie flow works inside Tauri's webview.
   If not (likely, since that flag is designed for cross-site browser
   requests, not a native app's embedded webview), switch desktop auth to:
   login → receive a JWT in the response body (add this alongside the
   existing cookie-set, don't break the web app) → store it in Tauri's
   secure storage (`tauri-plugin-store` or OS keychain via
   `keyring`) → send as `Authorization: Bearer` header on every request
   from the desktop build. Gate this behind a build-time flag so the web
   app's existing cookie flow is untouched.
3. **Local read cache:** SQLite via Tauri's SQL plugin. On each successful
   online fetch of dashboard/inventory/debtors/recent-sales, mirror the
   response into local tables. On app launch without connectivity, read
   from these tables instead of failing.
4. **Connectivity detection:** a simple periodic ping to the backend
   (e.g. a lightweight `/health` endpoint — add one if it doesn't exist)
   to flip the app between online/offline UI state.
5. **Update mechanism:** Tauri's built-in updater, manifests hosted on
   GitHub Releases (simplest option, no extra infra).
6. **Code signing:** get a Windows code-signing certificate before any
   real distribution — without one, every install triggers a Microsoft
   Defender SmartScreen "Unknown Publisher" warning, which kills trust
   for a financial tool. Budget ~$100-400/year depending on CA.

**Exit criteria for this phase:** a business owner can open the app with
no internet, see yesterday's numbers, and knows clearly what they can't do
right now. No data is ever written locally.

---

## Phase 2 — Backend prerequisites for real sync

Do this phase on the backend *before* writing any offline-write code on
the desktop side. These are foundational changes that offline-write
depends on, and are risky to retrofit later once real offline data exists
in the wild.

1. **Switch to client-generatable IDs.** Auto-increment integers don't
   work when two disconnected clients (or a disconnected desktop client
   and the live web app) might create a `Sale` independently — they can't
   both claim "the next ID." Migrate primary keys on every table that will
   support offline creation (`Sale`, `Debtor`, `DebtorItem`, `Purchase`,
   inventory movements, journal entries — audit the full list before
   committing to scope) to **UUIDs**, generated client-side at creation
   time. This is a real migration: every FK reference, every existing
   row, every frontend piece that currently assumes integer IDs. Plan it
   as its own tracked migration, not a drive-by change.
   - Alternative if a full UUID migration is judged too disruptive short
     term: keep integer PKs for server-created rows, but give offline-created
     rows a client-generated UUID `local_id` / `client_ref` column used
     for idempotent upsert during sync, and let the server assign the
     "real" integer ID on first successful sync. More backward-compatible,
     but pushes complexity into the sync logic instead of the schema —
     the team should explicitly choose one approach, not blend both ad hoc.
2. **Add `updated_at` (and consider `deleted_at` for soft deletes) to every
   table that will be synced.** Currently only 6 tables have it. Sync
   fundamentally depends on "give me everything changed since timestamp
   X" — that's not possible without this on each relevant table.
3. **Build the sync endpoints:**
   - `GET /sync/pull?since=<timestamp>&tables=sales,debtors,inventory,...`
     → returns all rows changed (created/updated/deleted) since that
     timestamp, scoped to the caller's `account_id`.
   - `POST /sync/push` → accepts a batch of offline-created/modified
     records with their client-side UUIDs and timestamps, validates each
     one against current server state (see Phase 4 for what "validates"
     means for stock/money specifically), applies them, and returns a
     per-record success/conflict result — not an all-or-nothing batch
     result, since a batch of 20 offline sales shouldn't all fail because
     one oversold an item.
4. **Decide and document the conflict policy per table**, before writing
   code: e.g. append-only records (sales, payments) are generally safe to
   accept as new rows even if they arrive late; mutable records (a
   debtor's `total_owed`, an inventory item's `quantity`) need an explicit
   strategy — likely "server recomputes derived totals from the full set
   of underlying transactions rather than trusting a client-sent total,"
   which sidesteps a lot of conflict pain by making the client send events
   (a sale happened) rather than states (the new total is X).

---

## Phase 3 — Offline write queue (desktop side)

Only start this once Phase 2 is live and tested against the existing web
app (i.e. the sync endpoints work correctly even with zero desktop clients
yet, proven via the web app's normal read/write traffic continuing to
behave correctly).

1. Local SQLite gets write tables mirroring the syncable server tables,
   plus a `sync_queue` table: every offline create/update gets a row here
   (operation type, table, payload, client UUID, created_at, synced
   boolean).
2. Offline actions (recording a sale, taking a debtor payment) write
   immediately to local SQLite + `sync_queue`, and update the local UI
   optimistically. `_decrement_stock`-equivalent check happens against
   local cached stock — but is explicitly labeled provisional in the UI
   ("pending sync") since it can't be authoritative offline.
3. When connectivity returns: drain `sync_queue` in creation order via
   `POST /sync/push`. Handle per-record results:
   - Success → mark synced, replace any provisional local state with the
     server's authoritative response.
   - Conflict (e.g. oversold stock revealed at sync time) → do not
     silently drop or silently apply; surface it to the user explicitly
     ("This sale of 5x Widget couldn't be completed — only 2 were in
     stock by the time this synced. Review and resolve.") A business
     tool should never make a financial correction invisibly.
4. Also run `GET /sync/pull` on reconnect, before or interleaved with the
   push, to pull down anything that changed on the server/web app while
   this device was offline (e.g. someone adjusted stock from the web
   app), so local conflict detection has current data to compare against.

---

## Phase 4 — Validation & hardening

- Re-run every business-rule check (`_decrement_stock`'s insufficient-stock
  check and its equivalents elsewhere) server-side at sync time, never
  trust the offline client's local validation as final.
- Load-test the sync endpoints with realistic offline-queue sizes (a
  device offline for a full business day could queue dozens of sales).
- Decide and test what happens to **ledger/journal entries** specifically
  — these are the most order-sensitive data in the app (per the existing
  `FiscalPeriodLockedError` / reversing-entries logic already in
  `ledger.py`). An offline sale that posts a journal entry out of
  chronological order relative to other entries needs explicit handling,
  not just "whatever order the sync happened to process them in."
- Decide the retention/cleanup policy for `sync_queue` rows after
  successful sync (don't grow it unbounded on the local SQLite file).

---

## Sequencing summary

| Phase | Ships | Risk | Depends on |
|---|---|---|---|
| 0 | PWA install | none | nothing — do this now |
| 1 | Desktop shell, read-only offline cache | low | Phase 0 |
| 2 | Backend sync foundation (IDs, timestamps, endpoints, conflict policy) | medium — real migration work | Phase 1 proven stable |
| 3 | Offline write queue on desktop | high | Phase 2 fully live & tested |
| 4 | Hardening, ledger ordering, load testing | — | Phase 3 |

**Recommendation to the team:** treat Phase 3 as a genuine go/no-go
decision point, not an assumed next step. If the actual business need
turns out to be "spotty internet at some locations" rather than "hours of
true offline operation," Phase 1 alone (read cache, online-required
writes) may already solve the real problem at a fraction of the risk and
cost of building and maintaining full bidirectional sync on financial data.
