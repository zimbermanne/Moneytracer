"""
Tiny self-healing schema migration.

Base.metadata.create_all() only creates tables that don't exist yet — it never
ALTERs existing tables to add new columns. Since the database persists across
deploys, every time a model gains a new column we'd otherwise get
`UndefinedColumn` errors on a live table. This module inspects the actual DB
schema at startup and adds any columns the models define but the table is
missing, so deploys self-heal instead of crash-looping.

For anything beyond simple "add a nullable/defaulted column" (renames, type
changes, dropping columns), switch to Alembic — this is intentionally minimal.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table_name -> list of (column_name, DDL type, default SQL literal or None)
# These tables live in the default/public schema.
_MIGRATIONS = {
    "users": [
        ("is_demo", "BOOLEAN", "false"),
        # Force-logout support — see models.User.token_version docstring.
        ("token_version", "INTEGER", "0"),
    ],
    "accounts": [
        # Existing accounts predate the onboarding wizard, so they default to
        # "already onboarded" and are never interrupted by it. Freshly
        # registered accounts explicitly set this to False (see routers/auth.py).
        ("onboarding_completed", "BOOLEAN", "true"),
        # Existing accounts predate the business/community split — they're all
        # businesses (that's all that existed before this feature).
        ("account_type", "VARCHAR(20)", "'business'"),
        # VAT registration number + bank details for the redesigned invoice template.
        ("vrn", "VARCHAR(50)", None),
        ("bank_name", "VARCHAR(120)", "''"),
        ("bank_account_name", "VARCHAR(120)", "''"),
        ("bank_account_number", "VARCHAR(60)", "''"),
        ("bank_branch", "VARCHAR(120)", "''"),
        # Pan-African Reference App: country and revenue authority references.
        ("country_id", "INTEGER", None),
        ("revenue_authority_id", "INTEGER", None),
        # Superadmin-only fields — subscription tier + internal support notes.
        ("plan", "VARCHAR(40)", "'free'"),
        ("admin_notes", "TEXT", "''"),
        # Cash vs accrual treatment of purchases — see models.CogsMethod.
        # Defaults to 'accrual' so existing tenants' books don't shift.
        ("cogs_method", "VARCHAR(20)", "'accrual'"),
        # Per-account currency (ISO 4217 code) — see models.Account.currency.
        # Existing tenants default to TZS (the app's original single-country
        # currency) and can update it via country selection or directly.
        ("currency", "VARCHAR(10)", "'TZS'"),
    ],
    "journal_entries": [
        # This table predates reversal/void support (only is_locked existed
        # originally) — without this, every query touching journal_entries
        # throws psycopg2.errors.UndefinedColumn on any DB that was created
        # before these columns were added to the model, taking down Chart of
        # Accounts, General Ledger, and VAT Return (they all query this table).
        ("is_reversal", "BOOLEAN", "false"),
        ("is_voided", "BOOLEAN", "false"),
        ("reversed_entry_id", "INTEGER", None),
    ],
}

# (schema, table) -> list of (column_name, DDL type, default SQL literal or None)
# These tables live in the per-track Postgres schema (a no-op filter under
# SQLite, where everything is unqualified — see database.USE_SCHEMAS).
_SCHEMA_MIGRATIONS = {
    ("business", "debtors"): [
        # Reconciliation key alongside phone — see models.Debtor.tin_number
        # and routers/ledgers.py:reconcile_party().
        ("tin_number", "VARCHAR(50)", "''"),
    ],
    ("business", "creditors"): [
        # Mirrors debtors.tin_number — see models.Creditor.tin_number.
        ("tin_number", "VARCHAR(50)", "''"),
    ],
    ("business", "expenses"): [
        # Which till/bank/mobile-money account the expense was paid from —
        # see models.Expense.payment_method_id.
        ("payment_method_id", "INTEGER", "NULL"),
    ],
    ("business", "sales"): [
        # Snapshot of the item's cost at time of sale, so historical gross
        # margin doesn't silently shift when the item's current cost changes.
        ("cost_price_at_sale", "FLOAT", None),
        # Which specific mapped Cash/Bank/Mobile-Money/Debtors account this
        # sale's payment landed in — see models.PaymentMethod. Nullable:
        # existing sales predate Payment Methods and fall back to the old
        # payment_mode-based account lookup in ledger.post_sale_entry().
        ("payment_method_id", "INTEGER", None),
    ],
    ("business", "purchases"): [
        # Proper FK to inventory instead of relying solely on name-matching.
        ("item_id", "INTEGER", None),
        # "Pay as Credit" — see models.Purchase.payment_mode. Stored as
        # plain VARCHAR (not a native enum type) same as accounts.cogs_method,
        # so existing rows self-heal without an enum-type migration.
        ("payment_mode", "VARCHAR(20)", "'cash'"),
    ],
    ("business", "invoices"): [
        # Fields for the redesigned Tanzania-style tax invoice template.
        ("customer_tin", "VARCHAR(50)", "''"),
        ("customer_vrn", "VARCHAR(50)", "''"),
        ("due_date", "TIMESTAMP", None),
        ("po_number", "VARCHAR(80)", "''"),
        # Random, unguessable token for the QR-code public verification link —
        # deliberately separate from invoice_no, which is sequential and easy
        # to guess, so scanning a QR can't be used to enumerate invoices.
        ("verify_token", "VARCHAR(40)", None),
        # Set once this invoice has generated its Sale records (on first
        # transition to "paid"). Existing invoices default to false, which is
        # correct even for ones that were already paid before this feature
        # shipped — see the backfill note in update_status().
        ("converted_to_sale", "BOOLEAN", "false"),
        # See models.Invoice.paid_at — needed to correctly net a paid
        # invoice's balance out of the customer statement.
        ("paid_at", "TIMESTAMP", None),
    ],
    ("business", "invoice_items"): [
        # Optional link to inventory so a paid invoice can decrement stock
        # and record a proper Sale against the item it actually sold.
        ("item_id", "INTEGER", None),
    ],
    ("business", "customers"): [
        # Customer Center: email alongside the existing phone/address/TIN
        # contact fields.
        ("email", "VARCHAR(150)", "''"),
    ],
    ("business", "purchase_orders"): [
        # See models.PurchaseOrder.approved_by/approved_at — audit trail
        # for the new "approved" status, distinct from goods being received.
        ("approved_by", "VARCHAR(80)", None),
        ("approved_at", "TIMESTAMP", None),
        # Lets the PO preview pre-fill "Send to Supplier" instead of the
        # user having to look the address up and type it in every time.
        ("supplier_email", "VARCHAR(150)", "''"),
        # "Pay as Credit" — see models.PurchaseOrder.payment_mode.
        ("payment_mode", "VARCHAR(20)", "'cash'"),
    ],
}


def _migrate_inventory_sku_constraint(engine: Engine, inspector, is_sqlite: bool):
    """inventory_items.sku used to be globally unique (across every tenant on
    the platform) — a real bug, since two different businesses could never
    both use the same SKU. Now it's scoped to (account_id, sku). SQLite has
    no ALTER TABLE ... DROP/ADD CONSTRAINT support at all (would need a full
    table rebuild), so this only runs under Postgres; a fresh SQLite dev
    database already gets the correct constraint straight from create_all()."""
    if is_sqlite:
        return
    schema, table = "business", "inventory_items"
    if table not in set(inspector.get_table_names(schema=schema)):
        return
    constraints = inspector.get_unique_constraints(table, schema=schema)
    if any(c["name"] == "uq_inventory_account_sku" for c in constraints):
        return  # already migrated

    with engine.begin() as conn:
        for c in constraints:
            if c["column_names"] == ["sku"]:
                conn.execute(text(f'ALTER TABLE {schema}.{table} DROP CONSTRAINT IF EXISTS "{c["name"]}"'))
                print(f"[migrate] dropped old global-unique constraint {c['name']} on {table}.sku")
        conn.execute(text(
            f'ALTER TABLE {schema}.{table} ADD CONSTRAINT uq_inventory_account_sku UNIQUE (account_id, sku)'
        ))
        print(f"[migrate] added composite unique constraint on {table}(account_id, sku)")


def _migrate_po_approved_enum_value(engine: Engine, is_sqlite: bool):
    """PurchaseOrderStatus gained a new member, "approved", inserted between
    "sent" and "received". On Postgres, SQLAlchemy's Enum() creates a native
    ENUM type (named after the Python class, lowercased: purchaseorderstatus)
    — adding a value to the Python enum does NOT retroactively add it to that
    already-created Postgres type. Without this, setting status='approved' on
    a live database throws `invalid input value for enum`.
    ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
    Postgres, so this uses autocommit rather than engine.begin().
    SQLite has no native enum type (Enum() becomes a plain VARCHAR there),
    so nothing to migrate — a fresh dev DB already accepts any string.
    """
    if is_sqlite:
        return
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        exists = conn.execute(text(
            "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid "
            "WHERE t.typname = 'purchaseorderstatus' AND e.enumlabel = 'approved'"
        )).first()
        if exists:
            return
        type_exists = conn.execute(text(
            "SELECT 1 FROM pg_type WHERE typname = 'purchaseorderstatus'"
        )).first()
        if not type_exists:
            return  # create_all() will create the type with all values fresh
        conn.execute(text(
            "ALTER TYPE purchaseorderstatus ADD VALUE IF NOT EXISTS 'approved' BEFORE 'received'"
        ))
        print("[migrate] added 'approved' value to purchaseorderstatus enum")


def _migrate_renumber_chart_of_accounts(engine: Engine, inspector):
    """One-time renumber to match the POS Payment Method spec exactly:
    1200 = Debtors/Accounts Receivable, Inventory moved to 1210.

    Before this, 1100 was Accounts Receivable and 1200 was Inventory. Simply
    changing _STANDARD_CHART's codes going forward would leave every
    existing tenant's historical ChartOfAccount rows (and every JournalLine
    that points at them) still labeled with the old codes — ensure_default_*
    only ever inserts missing codes, it never rewrites existing ones. That
    would silently split each tenant's AR and Inventory history across two
    different rows (old code + newly-seeded new code) instead of just
    renaming the account in place.

    Runs UPDATE chart_of_accounts SET code = ... WHERE code = ... AND
    account_id = <tenant>, per tenant, in the safe order (move 1200 out of
    the way to 1210 first, THEN move 1100 into 1200) so the two never
    collide. journal_lines/JournalLine keep pointing at the same
    chart_account_id the whole time — only the .code label changes, so
    balances and history are unaffected. Idempotent: a tenant with no row
    still coded "1100" or old "1200"/Inventory has nothing to do.
    """
    table = "chart_of_accounts"
    if table not in set(inspector.get_table_names()):
        return  # create_all() will create it fresh with the new codes

    with engine.begin() as conn:
        rows = conn.execute(text(
            f"SELECT id, account_id, code FROM {table} WHERE code IN ('1100', '1200', '1210')"
        )).fetchall()
        if not rows:
            return

        by_account = {}
        for row in rows:
            by_account.setdefault(row.account_id, {})[row.code] = row.id

        moved = 0
        for account_id, codes in by_account.items():
            # A "1210" already present means this tenant has already been
            # through this migration (or was seeded fresh post-fix) — skip,
            # otherwise a second run would treat the *new* 1200 (Debtors) as
            # the old Inventory row and wrongly bump it to 1210 again.
            if "1210" in codes:
                continue
            if "1200" in codes:
                conn.execute(text(f"UPDATE {table} SET code = '1210' WHERE id = :id"), {"id": codes["1200"]})
                moved += 1
            if "1100" in codes:
                conn.execute(text(f"UPDATE {table} SET code = '1200' WHERE id = :id"), {"id": codes["1100"]})
                moved += 1

        if moved:
            print(f"[migrate] renumbered {moved} chart-of-accounts row(s): "
                  f"old Inventory 1200 -> 1210, old Accounts Receivable 1100 -> 1200")


def run_migrations(engine: Engine):
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    is_sqlite = engine.dialect.name == "sqlite"

    with engine.begin() as conn:
        for table, columns in _MIGRATIONS.items():
            if table not in existing_tables:
                continue  # create_all() will create it fresh with all columns
            existing_cols = {c["name"] for c in inspector.get_columns(table)}
            for col_name, col_type, default in columns:
                if col_name in existing_cols:
                    continue
                default_clause = f" DEFAULT {default}" if default is not None else ""
                ddl = f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}{default_clause}"
                conn.execute(text(ddl))
                print(f"[migrate] added missing column {table}.{col_name}")

        for (schema, table), columns in _SCHEMA_MIGRATIONS.items():
            # SQLite has no real schemas; its tables were created unqualified.
            effective_schema = None if is_sqlite else schema
            schema_tables = set(inspector.get_table_names(schema=effective_schema))
            if table not in schema_tables:
                continue
            existing_cols = {c["name"] for c in inspector.get_columns(table, schema=effective_schema)}
            qualified_table = table if effective_schema is None else f"{effective_schema}.{table}"
            for col_name, col_type, default in columns:
                if col_name in existing_cols:
                    continue
                default_clause = f" DEFAULT {default}" if default is not None else ""
                ddl = f"ALTER TABLE {qualified_table} ADD COLUMN {col_name} {col_type}{default_clause}"
                conn.execute(text(ddl))
                print(f"[migrate] added missing column {qualified_table}.{col_name}")

    _migrate_inventory_sku_constraint(engine, inspector, is_sqlite)
    _migrate_po_approved_enum_value(engine, is_sqlite)
    _migrate_renumber_chart_of_accounts(engine, inspector)
