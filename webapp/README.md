# Fix: accounts.pending_deletion UndefinedColumn crash

## Root cause (confirmed from your actual code)
`models.py` defines `Account.pending_deletion` + 3 related columns (line 111-114).
Your app self-heals schema drift via the `_MIGRATIONS` dict in `migrate.py`, which
runs `ALTER TABLE ... ADD COLUMN` for any model column missing from the live DB —
but nobody added an entry for these 4 new columns to that dict when they were added
to the model. So on any database created before this feature, `run_migrations()`
never adds them, and `init_db.py`'s `seed()` immediately crashes on the very next
query trying to SELECT `accounts.pending_deletion`.

## The fix
Added this block to the `"accounts": [...]` list in `migrate.py`, right after the
existing `"currency"` entry:

    ("pending_deletion", "BOOLEAN", "false"),
    ("deletion_requested_at", "TIMESTAMP", None),
    ("scheduled_purge_at", "TIMESTAMP", None),
    ("deletion_requested_by", "VARCHAR(80)", "''"),

This matches the exact pattern already used for every other self-healing entry in
this file (e.g. `onboarding_completed`, `vrn`, `plan`, etc.) — nullable/defaulted
columns only, no renames or type changes, consistent with the file's own stated
scope ("For anything beyond simple add-a-column... switch to Alembic").

## How to apply
Replace your `Moneytracer/webapp/migrate.py` with the one in this zip (only the
`"accounts"` list changed — everything else is untouched, byte-for-byte from your
upload).

## Deploy
Just redeploy normally. `run_migrations(engine)` runs at startup (before
`init_db.py`'s seed), so the 4 missing columns get added automatically via
`ALTER TABLE accounts ADD COLUMN ...` on first boot — no manual SQL, no Alembic,
no downtime beyond a normal deploy. The crash loop stops immediately after.

Nothing else needs to change — `models.py` was already correct.
