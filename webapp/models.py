import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum, UniqueConstraint
)
from sqlalchemy.orm import relationship
from database import Base, schema_args, fk_ref, SCHEMA_BUSINESS, SCHEMA_COMMUNITY, SCHEMA_PERSONAL


class RoleEnum(str, enum.Enum):
    superadmin = "superadmin"
    admin = "admin"
    manager = "manager"
    employee = "employee"
    member = "member"  # read-only community-group member login (own records only)


class CogsMethod(str, enum.Enum):
    """How this tenant recognizes the cost of purchased stock.

    accrual (default): the historically correct behavior — a Purchase
    capitalizes into Inventory (1210), and Cost of Goods Sold (5000) is
    only recognized when the item actually sells, matched against
    Sale.cost_price_at_sale. Inventory on the balance sheet reflects
    unsold stock value.

    cash: purchases hit Cost of Goods Sold (5000) immediately instead of
    Inventory, and sales no longer post a separate cost/COGS line (the
    cost was already expensed at purchase — posting it again at sale
    would double-count it). This trades balance-sheet accuracy (no
    Inventory asset value, no period-matching between when stock is
    bought and when it's sold) for immediate visibility into purchase
    spend on the P&L — the way many small cash-basis businesses actually
    think about their money. InventoryItem.quantity still tracks physical
    stock either way; only the monetary ledger treatment changes.
    """
    accrual = "accrual"
    cash = "cash"


class BusinessStructure(str, enum.Enum):
    solo = "solo"
    company = "company"


class AccountType(str, enum.Enum):
    business = "business"
    community = "community"
    personal = "personal"


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    account_type = Column(Enum(AccountType), default=AccountType.business)
    business_structure = Column(Enum(BusinessStructure), default=BusinessStructure.solo)
    name = Column(String(150), nullable=False, index=True)
    tin = Column(String(50), nullable=True)  # Tax Identification Number, required for company
    vrn = Column(String(50), nullable=True)  # VAT Registration Number, shown on tax invoices
    owner_full_name = Column(String(150), nullable=False)
    business_type = Column(String(80), default="retail")
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=True, index=True)  # African country reference
    region = Column(String(80), default="")
    district = Column(String(80), default="")
    street_address = Column(String(255), default="")
    phone = Column(String(40), default="")
    email = Column(String(120), default="")
    logo_url = Column(String(255), default="")
    tax_rate = Column(Float, default=0)
    revenue_authority_id = Column(Integer, ForeignKey("revenue_authorities.id"), nullable=True)  # Reference to country's tax authority
    # ISO 4217 currency code (e.g. "TZS", "KES", "GHS", "XOF") — auto-filled
    # from country on first save (see routers/accounts.py, same pattern as
    # tax_rate/revenue_authority_id), editable afterwards. Drives money
    # formatting on receipts/statements across all 54 African markets this
    # app serves rather than a hardcoded currency.
    currency = Column(String(10), default="TZS")
    invoice_prefix = Column(String(20), default="INV")
    payment_terms_days = Column(Integer, default=7)
    # Bank details for invoice footers — optional; left blank until the owner fills them in.
    bank_name = Column(String(120), default="")
    bank_account_name = Column(String(120), default="")
    bank_account_number = Column(String(60), default="")
    bank_branch = Column(String(120), default="")
    is_active = Column(Boolean, default=True)
    is_suspended = Column(Boolean, default=False)
    onboarding_completed = Column(Boolean, default=False)
    # Defaults to accrual so every existing tenant's historical P&L and
    # Inventory balances are unaffected — this is opt-in per account.
    # See CogsMethod docstring for what each value means.
    cogs_method = Column(Enum(CogsMethod), default=CogsMethod.accrual)
    created_at = Column(DateTime, default=datetime.utcnow)

    # ---- Superadmin/platform-management fields (not tenant-editable) ----
    # Subscription tier. Free-text on purpose (not an Enum) — plan names and
    # limits are still being figured out, and a plain string lets the
    # superadmin console change/introduce tiers without a code deploy.
    plan = Column(String(40), default="free")
    # Internal notes visible only to superadmins (support context, billing
    # status, escalation history) — never surfaced on any tenant-facing
    # endpoint. See AccountAdminOut in schemas.py, the only schema that
    # includes it.
    admin_notes = Column(Text, default="")

    # ---- Soft-delete / trash (see routers/accounts.py delete_account) ----
    # "Delete" from the superadmin console never immediately destroys data:
    # it flags the account here and schedules a permanent purge ~90 days
    # out, giving a recovery window for accidental/mistaken deletes or a
    # tenant who changes their mind. Only the purge sweep (or an explicit
    # superadmin "purge now" override) actually calls db.delete().
    pending_deletion = Column(Boolean, default=False, index=True)
    deletion_requested_at = Column(DateTime, nullable=True)
    scheduled_purge_at = Column(DateTime, nullable=True, index=True)
    deletion_requested_by = Column(String(80), default="")

    users = relationship("User", back_populates="account")
    country = relationship("Country")
    revenue_authority = relationship("RevenueAuthority")


class PaymentMode(str, enum.Enum):
    cash = "cash"
    credit = "credit"
    mobile_money = "mobile_money"


class PurchaseOrderStatus(str, enum.Enum):
    # Deliberately not reusing DocumentStatus.paid — a PO's meaningful event
    # is goods arriving (which is what should move stock and post the
    # ledger), not payment, since many purchases are made on credit and
    # settled separately later. Defined here (rather than next to
    # DocumentStatus further down) because PurchaseOrder itself is defined
    # right after Purchase, well before DocumentStatus's usual spot.
    #
    # "approved" is a distinct step from "received": approving authorizes
    # the order (a manager/admin signing off that it's OK to buy) but does
    # NOT touch stock or the ledger yet — that only happens once goods
    # physically arrive and someone marks it received. Keeping these
    # separate means a PO can be approved today and received next week
    # without prematurely inflating inventory before the goods exist.
    draft = "draft"
    sent = "sent"
    approved = "approved"
    received = "received"
    cancelled = "cancelled"


class LedgerStatus(str, enum.Enum):
    unpaid = "unpaid"
    partial = "partial"
    paid = "paid"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, index=True, nullable=False)
    full_name = Column(String(120), default="")
    email = Column(String(120), default="")
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(RoleEnum), default=RoleEnum.employee)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)  # nullable for superadmin
    is_active = Column(Boolean, default=True)
    is_demo = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Bumped to force-invalidate every outstanding JWT for this user (e.g. a
    # superadmin "force logout") without waiting for natural token expiry.
    # The login token embeds the value at issue-time as "tv"; get_current_user
    # rejects any token whose "tv" doesn't match the current column value.
    token_version = Column(Integer, default=0)

    account = relationship("Account", back_populates="users")


class InventoryItem(Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        # Scoped per account — two different businesses on the platform must
        # be free to both use e.g. "SKU001". Previously this was a bare
        # column-level unique=True, which was unique across *all* tenants.
        UniqueConstraint("account_id", "sku", name="uq_inventory_account_sku"),
        schema_args(SCHEMA_BUSINESS),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False, index=True)
    sku = Column(String(80), nullable=True, index=True)
    category = Column(String(80), default="General", index=True)
    quantity = Column(Float, default=0)
    unit = Column(String(30), default="pcs")
    cost_price = Column(Float, default=0)
    selling_price = Column(Float, default=0)
    reorder_point = Column(Float, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    sales = relationship("Sale", back_populates="item")


class Customer(Base):
    """A real customer record — name, contact, address, TIN — distinct from
    the free-text customer_name field still used on Sale/Invoice/Quotation/
    Debtor for backward compatibility. Aggregation across those tables is
    done by matching Customer.name against each record's customer_name
    (or Debtor.name), scoped to the same account_id — see
    routers/customers.py. Not a hard foreign-key link, so existing
    historical records don't need a migration to show up once a Customer
    record with the matching name is created.
    """
    __tablename__ = "customers"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(40), default="")
    email = Column(String(150), default="")
    address = Column(String(255), default="")
    tin_number = Column(String(50), default="")
    notes = Column(String(500), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Supplier(Base):
    """The supplier-side mirror of Customer — a real, addressable supplier
    record (name, contact, address, TIN/VRN) distinct from the free-text
    supplier/supplier_name fields still used on Purchase/PurchaseOrder/
    Creditor. Same non-FK, name-matching aggregation approach as Customer
    (see routers/suppliers.py) so existing historical purchase records show
    up under a Supplier record the moment one with a matching name exists —
    no backfill migration needed."""
    __tablename__ = "suppliers"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(40), default="")
    email = Column(String(150), default="")
    address = Column(String(255), default="")
    tin_number = Column(String(50), default="")
    vrn_number = Column(String(50), default="")
    notes = Column(String(500), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    item_name = Column(String(150))
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    # Snapshot of the item's cost_price at the moment of this sale, so COGS/margin
    # for a past sale stays accurate even if the item's cost later changes via
    # new purchases. Nullable to stay backward-compatible with sales recorded
    # before this column existed (those fall back to the item's current cost).
    cost_price_at_sale = Column(Float, nullable=True)
    total = Column(Float, default=0)
    payment_mode = Column(Enum(PaymentMode), default=PaymentMode.cash)
    # Which specific Cash/Bank/Mobile-Money till the payment landed in, so the
    # ledger can debit the exact account instead of a single generic "Cash"
    # bucket. Nullable: legacy sales predate this field and fall back to the
    # old payment_mode-based mapping in ledger.post_sale_entry().
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=True)
    customer_name = Column(String(150), default="Walk-in")
    sold_by = Column(String(80), default="")
    receipt_no = Column(String(40), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    item = relationship("InventoryItem", back_populates="sales")
    payment_method = relationship("PaymentMethod")


class PosDraft(Base):
    """A parked POS cart, saved so a cashier can pause a sale and resume it
    later without losing the items already scanned/added."""
    __tablename__ = "pos_drafts"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    customer_name = Column(String(150), default="Walk-in")
    items_json = Column(Text, default="[]")
    total_amount = Column(Float, default=0)
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    item_name = Column(String(150))
    supplier = Column(String(150), default="")
    quantity = Column(Float, default=1)
    unit_cost = Column(Float, default=0)
    total = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    item = relationship("InventoryItem")


class PurchaseOrder(Base):
    """A document sent to a supplier requesting goods — distinct from
    Purchase (an actual received/paid transaction). A PurchaseOrder only
    turns into real Purchase rows (and only then affects stock and the
    ledger) once it's marked 'received' — mirrors how Invoice only becomes
    a Sale once marked 'paid'."""
    __tablename__ = "purchase_orders"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    po_no = Column(String(30), default="")
    supplier_name = Column(String(150), default="")
    supplier_phone = Column(String(50), default="")
    supplier_email = Column(String(150), default="")
    supplier_address = Column(String(255), default="")
    supplier_tin = Column(String(50), default="")
    supplier_vrn = Column(String(50), default="")
    expected_date = Column(DateTime, nullable=True)
    subtotal = Column(Float, default=0)
    tax_rate = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    discount = Column(Float, default=0)
    total = Column(Float, default=0)
    notes = Column(String(500), default="")
    status = Column(Enum(PurchaseOrderStatus), default=PurchaseOrderStatus.draft)
    # Who authorized this PO and when — set the moment status first
    # transitions to "approved". Distinct from created_by/created_at
    # (who wrote the PO) since the same person doesn't always approve
    # their own order, and a paper trail matters here.
    approved_by = Column(String(80), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    # Set once this PO has generated its Purchase rows (on first transition
    # to "received"). Prevents double-booking stock if received is set twice.
    converted_to_purchase = Column(Boolean, default=False)
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    items = relationship("PurchaseOrderItem", back_populates="po", cascade="all, delete-orphan")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    po_id = Column(Integer, ForeignKey(fk_ref("purchase_orders.id", SCHEMA_BUSINESS)), nullable=False)
    # Optional link to an existing inventory item, picked from the dropdown.
    # Null means a freehand line — something new you're stocking for the
    # first time, or a non-inventory line (freight, customs, etc.).
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    description = Column(String(255), default="")
    quantity = Column(Float, default=1)
    # Named unit_price (not unit_cost) so this row is interchangeable with
    # InvoiceItem/DocumentLineOut for the shared PDF renderer — semantically
    # this is what you're paying the supplier per unit, i.e. your cost.
    unit_price = Column(Float, default=0)
    total = Column(Float, default=0)

    po = relationship("PurchaseOrder", back_populates="items")
    item = relationship("InventoryItem")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    category = Column(String(80), default="General")
    description = Column(String(255), default="")
    amount = Column(Float, default=0)
    # Which till/bank/mobile-money account the money actually left — the
    # same PaymentMethod used on the POS checkout dropdown, so an expense
    # posts (Dr Expense / Cr <that account>) instead of always assuming
    # generic Cash. Nullable for expenses recorded before this existed, or
    # a cash-drawer expense with no method configured — those fall back to
    # the legacy hard-coded Cash account (1000) in post_expense_entry().
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    payment_method = relationship("PaymentMethod")

    @property
    def payment_method_name(self):
        return self.payment_method.name if self.payment_method else None


class Debtor(Base):
    __tablename__ = "debtors"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(40), default="")
    # TIN, alongside phone, is how a Debtor row is tied back to the same
    # real-world party as a Creditor row for reconciliation — see
    # routers/ledgers.py:reconcile_party(). Optional: most walk-in debtors
    # never provide one, so matching falls back to phone in that case.
    tin_number = Column(String(50), default="")
    total_owed = Column(Float, default=0)
    amount_paid = Column(Float, default=0)
    status = Column(Enum(LedgerStatus), default=LedgerStatus.unpaid)
    note = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("DebtorItem", back_populates="debtor", cascade="all, delete-orphan")


class DebtorItem(Base):
    """What was bought on credit — informational/reference only, linked to
    an inventory item when picked from stock, or a freehand description
    otherwise. Does not auto-drive total_owed; that stays a manually set
    figure on Debtor, same as before this existed."""
    __tablename__ = "debtor_items"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    debtor_id = Column(Integer, ForeignKey(fk_ref("debtors.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    debtor = relationship("Debtor", back_populates="items")


class Creditor(Base):
    __tablename__ = "creditors"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    phone = Column(String(40), default="")
    # Mirrors Debtor.tin_number — same reconciliation key, since a supplier
    # can independently become a debtor (e.g. they owe us for a return) and
    # we need to tie the two rows to one real-world party.
    tin_number = Column(String(50), default="")
    total_owed = Column(Float, default=0)
    amount_paid = Column(Float, default=0)
    status = Column(Enum(LedgerStatus), default=LedgerStatus.unpaid)
    note = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("CreditorItem", back_populates="creditor", cascade="all, delete-orphan")


class CreditorItem(Base):
    """What was bought on credit FROM this supplier — mirrors DebtorItem.
    Informational/reference only, linked to an inventory item when picked
    from stock, or a freehand description otherwise. Does not auto-drive
    total_owed."""
    __tablename__ = "creditor_items"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    creditor_id = Column(Integer, ForeignKey(fk_ref("creditors.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    creditor = relationship("Creditor", back_populates="items")


class DocumentStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    paid = "paid"
    accepted = "accepted"
    rejected = "rejected"
    expired = "expired"


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    invoice_no = Column(String(40), unique=True, index=True)
    customer_name = Column(String(150), nullable=False, default="Walk-in")
    customer_phone = Column(String(40), default="")
    customer_address = Column(String(255), default="")
    customer_tin = Column(String(50), default="")
    customer_vrn = Column(String(50), default="")
    due_date = Column(DateTime, nullable=True)
    po_number = Column(String(80), default="")  # client's Purchase/Delivery Order number
    verify_token = Column(String(40), unique=True, index=True, nullable=True)  # for QR-code public verification
    subtotal = Column(Float, default=0)
    tax_rate = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    discount = Column(Float, default=0)
    total = Column(Float, default=0)
    notes = Column(String(500), default="")
    status = Column(Enum(DocumentStatus), default=DocumentStatus.sent)
    # True once this invoice has generated Sale records (happens exactly once,
    # the moment it's marked paid — see routers/invoices.py update_status).
    # Prevents double-booking sales if the status is toggled paid more than once.
    converted_to_sale = Column(Boolean, default=False)
    # When this invoice's status actually flipped to "paid" — distinct from
    # created_at, and needed so the customer statement can net out a paid
    # invoice's balance at the moment payment was received, not leave it
    # permanently outstanding. Null for invoices that were paid before this
    # column existed or that are still unpaid.
    paid_at = Column(DateTime, nullable=True)
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey(fk_ref("invoices.id", SCHEMA_BUSINESS)), nullable=False)
    # Optional link to a tracked inventory item. Null means this line was
    # typed in freehand for something not carried in inventory (a service
    # fee, a one-off item, etc.) — those lines never touch stock levels.
    item_id = Column(Integer, ForeignKey(fk_ref("inventory_items.id", SCHEMA_BUSINESS)), nullable=True)
    description = Column(String(255), default="")
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    total = Column(Float, default=0)

    invoice = relationship("Invoice", back_populates="items")
    item = relationship("InventoryItem")


class Quotation(Base):
    __tablename__ = "quotations"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    quote_no = Column(String(40), unique=True, index=True)
    customer_name = Column(String(150), nullable=False, default="Walk-in")
    customer_phone = Column(String(40), default="")
    customer_address = Column(String(255), default="")
    subtotal = Column(Float, default=0)
    tax_rate = Column(Float, default=0)
    tax_amount = Column(Float, default=0)
    discount = Column(Float, default=0)
    total = Column(Float, default=0)
    notes = Column(String(500), default="")
    valid_until = Column(DateTime, nullable=True)
    status = Column(Enum(DocumentStatus), default=DocumentStatus.draft)
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")


class QuotationItem(Base):
    __tablename__ = "quotation_items"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    quotation_id = Column(Integer, ForeignKey(fk_ref("quotations.id", SCHEMA_BUSINESS)), nullable=False)
    description = Column(String(255), default="")
    quantity = Column(Float, default=1)
    unit_price = Column(Float, default=0)
    total = Column(Float, default=0)

    quotation = relationship("Quotation", back_populates="items")


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    created_by = Column(String(80), default="")
    text = Column(String(255), nullable=False)
    due_at = Column(DateTime, nullable=True)  # optional; null = show until dismissed
    is_done = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)  # nullable for superadmin actions
    username = Column(String(80))
    action = Column(String(255))
    details = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SuperadminAuditLog(Base):
    """Immutable-by-convention record of every write a superadmin makes
    through the superadmin console — distinct from ActivityLog, which is
    the tenant-facing (and tenant-scoped) activity feed.

    ActivityLog entries for superadmin actions are logged with
    account_id=None (see comment above) because the superadmin generally
    has no account_id of their own — that made superadmin actions
    un-queryable by "which tenant did this affect?". This table fixes
    that: every row records the actor, the specific action, and the
    target (account and/or user) it was performed on, so "what has this
    admin done, and to whom" is a straightforward query rather than a
    grep through free-text details.

    Nothing in the app currently exposes an UPDATE or DELETE for these
    rows — treat that as a hard rule, not just an oversight, if this
    model is ever touched again."""
    __tablename__ = "superadmin_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    actor_username = Column(String(80), nullable=False, index=True)
    action = Column(String(255), nullable=False, index=True)
    target_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    target_label = Column(String(255), default="")  # human-readable target, e.g. account name / username
    details = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SupportThread(Base):
    """A tenant's message (or thread of messages) to the platform
    superadmin — 'contact support' from the tenant side, a live inbox from
    the superadmin console side. One thread per topic; each side can keep
    replying. Deliberately not scoped to SCHEMA_BUSINESS (same reasoning
    as ActivityLog/SuperadminAuditLog above): the superadmin, who has no
    account_id, needs to read and write these across every tenant."""
    __tablename__ = "support_threads"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    subject = Column(String(200), default="")
    status = Column(String(20), default="open", index=True)  # 'open' | 'closed'
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_username = Column(String(80), default="")
    unread_by_superadmin = Column(Boolean, default=True)   # tenant sent the latest message
    unread_by_tenant = Column(Boolean, default=False)      # superadmin sent the latest message
    last_message_at = Column(DateTime, default=datetime.utcnow, index=True)
    last_message_preview = Column(String(200), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SupportMessage(Base):
    """One message within a SupportThread. sender_is_superadmin tells the
    UI which side of the conversation to render it on, without needing to
    join back to Users and compare roles for every message."""
    __tablename__ = "support_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("support_threads.id"), nullable=False, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    sender_username = Column(String(80), default="")
    sender_is_superadmin = Column(Boolean, default=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class AnnouncementLevel(str, enum.Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class Announcement(Base):
    """Platform-wide banner, set by a superadmin, shown to every tenant user
    (e.g. maintenance windows, new-feature notices). Deliberately a flat
    table with no account_id — these are broadcast to everyone, not scoped
    to a tenant."""
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    level = Column(Enum(AnnouncementLevel), default=AnnouncementLevel.info)
    is_active = Column(Boolean, default=True)
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ---------- Pan-African Reference Data ----------


class AfricanRegion(str, enum.Enum):
    north = "North Africa"
    west = "West Africa"
    central = "Central Africa"
    east = "East Africa"
    southern = "Southern Africa"


class LanguageStatus(str, enum.Enum):
    official = "official"
    national = "national"
    regional = "regional"
    widely_spoken = "widely_spoken"


class Country(Base):
    """African countries with ISO codes and regional classification."""
    __tablename__ = "countries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False, unique=True, index=True)
    iso_code = Column(String(2), nullable=False, unique=True)  # ISO 3166-1 alpha-2
    region = Column(Enum(AfricanRegion), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    languages = relationship("Language", back_populates="country")
    revenue_authority = relationship("RevenueAuthority", back_populates="country", uselist=False)


class Language(Base):
    """Languages spoken in African countries with status classification."""
    __tablename__ = "languages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False, index=True)
    iso_639_code = Column(String(3), nullable=True)  # ISO 639-2/3 code where available
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=False, index=True)
    status = Column(Enum(LanguageStatus), default=LanguageStatus.official)
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    country = relationship("Country", back_populates="languages")


class RevenueAuthority(Base):
    """Revenue/tax authorities for African countries with default tax rates."""
    __tablename__ = "revenue_authorities"

    id = Column(Integer, primary_key=True, index=True)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    acronym = Column(String(50), nullable=True)
    website_url = Column(String(255), nullable=True)
    default_vat_rate = Column(Float, nullable=True)  # Default VAT rate as percentage
    effective_year = Column(Integer, nullable=True)  # Year the rate became effective
    source_url = Column(String(255), nullable=True)  # Official source URL for verification
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    country = relationship("Country", back_populates="revenue_authority")
    tax_rate_history = relationship("TaxRateHistory", back_populates="revenue_authority", cascade="all, delete-orphan")


class TaxRateHistory(Base):
    """Historical tax rate changes for revenue authorities."""
    __tablename__ = "tax_rate_history"

    id = Column(Integer, primary_key=True, index=True)
    revenue_authority_id = Column(Integer, ForeignKey("revenue_authorities.id"), nullable=False, index=True)
    tax_type = Column(String(50), nullable=False)  # VAT, PAYE, Corporate, Excise, etc.
    rate = Column(Float, nullable=False)  # Rate as percentage
    effective_year = Column(Integer, nullable=False)
    source_url = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    revenue_authority = relationship("RevenueAuthority", back_populates="tax_rate_history")


# ---------- Community-based informal finance (VICOBA / Vibati / Chama / etc.) ----------
# One Account (account_type == community) has exactly one SavingsGroup. Ordinary
# members are just name+phone records (GroupMember) with no login by default;
# a member only gets a login (a User with role=member) if the recorder
# explicitly creates one for them, so they can view their own contributions
# and loan balance in-app. No OTP/WhatsApp self-service for now.

class ContributionStyle(str, enum.Enum):
    fixed = "fixed"       # everyone pays the same amount each cycle (classic "Vibati")
    flexible = "flexible"  # members vary how much they contribute (classic "VICOBA")


class CycleFrequency(str, enum.Enum):
    weekly = "weekly"
    biweekly = "biweekly"
    monthly = "monthly"


class GroupLoanStatus(str, enum.Enum):
    active = "active"
    paid = "paid"
    defaulted = "defaulted"


class SavingsGroup(Base):
    __tablename__ = "savings_groups"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, unique=True, index=True)
    name = Column(String(150), nullable=False)
    registration_number = Column(String(80), default="")  # optional govt/community registration number
    # Cultural label only (VICOBA, Vibati, Chama, Stokvel, Susu, Tontine, Other...) —
    # does NOT drive behavior. Behavior is driven by rotation_enabled/lending_enabled.
    group_type = Column(String(50), default="")
    region = Column(String(80), default="")
    district = Column(String(80), default="")
    contribution_style = Column(Enum(ContributionStyle), default=ContributionStyle.fixed)
    contribution_amount = Column(Float, nullable=True)  # used when contribution_style == fixed
    currency = Column(String(10), default="TZS")
    cycle_frequency = Column(Enum(CycleFrequency), default=CycleFrequency.monthly)
    meeting_day = Column(String(20), default="")
    rotation_enabled = Column(Boolean, default=False)  # ROSCA-style pot rotation
    lending_enabled = Column(Boolean, default=False)   # ASCA-style internal lending
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account")
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("savings_groups.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # set only if member has a login
    name = Column(String(150), nullable=False)
    age = Column(Integer, nullable=True)
    phone = Column(String(40), default="")
    group_role = Column(String(30), default="member")  # 'chairman' | 'treasurer' | 'secretary' | 'member'
    is_recorder = Column(Boolean, default=False)  # treasurer/secretary who logs in and records entries
    joined_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("SavingsGroup", back_populates="members")
    user = relationship("User")


class Contribution(Base):
    __tablename__ = "contributions"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("savings_groups.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey(fk_ref("group_members.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    cycle_label = Column(String(40), default="")  # e.g. "2026-07" or "Cycle 3"
    amount = Column(Float, default=0)
    recorded_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    member = relationship("GroupMember")


class Payout(Base):
    """Rotating pot payout — only meaningful when SavingsGroup.rotation_enabled."""
    __tablename__ = "payouts"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("savings_groups.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey(fk_ref("group_members.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    cycle_label = Column(String(40), default="")
    amount = Column(Float, default=0)
    recorded_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    member = relationship("GroupMember")


class GroupLoan(Base):
    """Internal member borrowing from the group's pooled fund — only meaningful
    when SavingsGroup.lending_enabled. Distinct from the business-side bank Loan."""
    __tablename__ = "group_loans"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("savings_groups.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey(fk_ref("group_members.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    principal = Column(Float, default=0)
    interest_rate = Column(Float, default=0)  # flat % applied once at issuance (simplest model for v1)
    balance = Column(Float, default=0)  # outstanding = principal*(1+interest_rate/100) - repayments
    status = Column(Enum(GroupLoanStatus), default=GroupLoanStatus.active)
    issued_at = Column(DateTime, default=datetime.utcnow)

    member = relationship("GroupMember")
    repayments = relationship("GroupLoanRepayment", back_populates="loan", cascade="all, delete-orphan")


class GroupLoanRepayment(Base):
    __tablename__ = "group_loan_repayments"
    __table_args__ = schema_args(SCHEMA_COMMUNITY)

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey(fk_ref("group_loans.id", SCHEMA_COMMUNITY)), nullable=False, index=True)
    amount = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    loan = relationship("GroupLoan", back_populates="repayments")


# ---------------------------------------------------------------------------
# Personal spending track (envelope budgets, habit tags, savings challenges).
# Deliberately separate from business (Account/InventoryItem/Sale/...) and
# community (SavingsGroup/GroupMember/...) models above, even though a
# "spending challenge" is conceptually similar to a chama — they are kept as
# distinct concepts/tables so personal and community data never mix.
# ---------------------------------------------------------------------------

class SpendingTag(str, enum.Enum):
    necessary = "necessary"
    impulse = "impulse"


class SpendingCategory(Base):
    __tablename__ = "spending_categories"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    icon = Column(String(20), default="")
    monthly_budget = Column(Float, default=0)  # used in envelope mode, ignored in habit mode
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("SpendingTransaction", back_populates="category")


class SpendingTransaction(Base):
    __tablename__ = "spending_transactions"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey(fk_ref("spending_categories.id", SCHEMA_PERSONAL)), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    note = Column(String(255), default="")
    tag = Column(Enum(SpendingTag), nullable=True)  # only set in habit mode
    spent_at = Column(DateTime, default=datetime.utcnow, index=True)

    category = relationship("SpendingCategory", back_populates="transactions")


class SpendingGroup(Base):
    """A personal savings challenge shared between friends/family.
    Distinct from the community-track SavingsGroup (chama/table-banking)."""
    __tablename__ = "spending_groups"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    goal_amount = Column(Float, default=0)
    target_date = Column(DateTime, nullable=True)
    invite_code = Column(String(20), unique=True, index=True)
    created_by_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship("SpendingGroupMember", back_populates="group", cascade="all, delete-orphan")
    contributions = relationship("SpendingGroupContribution", back_populates="group", cascade="all, delete-orphan")


class SpendingGroupMember(Base):
    __tablename__ = "spending_group_members"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("spending_groups.id", SCHEMA_PERSONAL)), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("SpendingGroup", back_populates="members")


class SpendingGroupContribution(Base):
    __tablename__ = "spending_group_contributions"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey(fk_ref("spending_groups.id", SCHEMA_PERSONAL)), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    contributed_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("SpendingGroup", back_populates="contributions")


# ---------------------------------------------------------------------------
# Lightweight savings-scheme profile — a record that "I'm part of a Vikoba/
# chama/stokvel called X", owned by ANY account type (business or personal),
# with none of the operational machinery of a real community tenant: no
# login, no treasurer role, no Contribution/Payout/GroupLoan rows. Deliberately
# NOT a SavingsGroup — a SavingsGroup is a full community-type tenant that
# someone actively operates; this is just a personal note about a scheme
# someone belongs to. account_id is not unique — one account can log several.
# ---------------------------------------------------------------------------

class SavingsSchemeProfile(Base):
    __tablename__ = "savings_scheme_profiles"
    __table_args__ = schema_args(SCHEMA_PERSONAL)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    group_type = Column(String(50), default="")  # free-text cultural label (VICOBA, Vibati, Chama, Stokvel, Susu...)
    contribution_amount = Column(Float, nullable=True)
    cycle_frequency = Column(Enum(CycleFrequency), default=CycleFrequency.monthly)
    member_names = Column(Text, default="")  # freeform, comma or newline separated — not real member rows
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account")


# ---------------------------------------------------------------------------
# Bank loans (business borrowing FROM a bank/lender) — distinct from
# GroupLoan above (a member borrowing from a Vikoba's own pooled fund).
# ---------------------------------------------------------------------------

class LoanInterestType(str, enum.Enum):
    simple = "simple"
    reducing_balance = "reducing_balance"


class LoanStatus(str, enum.Enum):
    active = "active"
    closed = "closed"
    defaulted = "defaulted"


# ---------------------------------------------------------------------------
# Assets — a flat value-tracker (house, vehicle, equipment, etc). No
# depreciation schedule for v1; estimated_value is whatever the owner last
# updated it to. account_id is intentionally not restricted to business-type
# accounts — personal-type tenants use these same endpoints/tables directly
# (the personal/business/community separation is enforced elsewhere, e.g.
# community.py's ownership check; it was never actually enforced here).
# ---------------------------------------------------------------------------

class AssetType(str, enum.Enum):
    fixed_asset = "fixed_asset"
    financial_investment = "financial_investment"
    intangible = "intangible"


class AssetCategory(str, enum.Enum):
    property = "property"
    vehicle = "vehicle"
    equipment = "equipment"
    shares = "shares"
    bonds = "bonds"
    group_equity = "group_equity"
    other = "other"


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    asset_type = Column(Enum(AssetType), default=AssetType.fixed_asset)
    category = Column(Enum(AssetCategory), default=AssetCategory.other)
    acquisition_cost = Column(Float, default=0)
    estimated_value = Column(Float, default=0)  # Current Carrying Value
    salvage_value = Column(Float, default=0)
    useful_life_years = Column(Integer, default=5)
    acquired_date = Column(DateTime, nullable=True)
    last_revaluation_date = Column(DateTime, nullable=True)
    notes = Column(String(255), default="")
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    revaluation_history = relationship("AssetRevaluationHistory", back_populates="asset", cascade="all, delete-orphan")


class AssetRevaluationHistory(Base):
    __tablename__ = "asset_revaluation_history"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey(fk_ref("assets.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    date = Column(DateTime, default=datetime.utcnow)
    previous_value = Column(Float, nullable=False)
    new_value = Column(Float, nullable=False)
    gain_loss_amount = Column(Float, nullable=False)
    notes = Column(Text, default="")

    asset = relationship("Asset", back_populates="revaluation_history")


class BankLoan(Base):
    __tablename__ = "bank_loans"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    lender_name = Column(String(120), nullable=False)
    principal = Column(Float, nullable=False)
    interest_type = Column(Enum(LoanInterestType), default=LoanInterestType.simple)
    annual_rate = Column(Float, default=0)  # % per year
    start_date = Column(DateTime, nullable=False)
    due_day_of_month = Column(Integer, default=1)  # 1-28, for reminder scheduling
    term_months = Column(Integer, nullable=True)  # optional — enables a projected roadmap
    grace_period_days = Column(Integer, default=0)
    status = Column(Enum(LoanStatus), default=LoanStatus.active)
    notes = Column(String(255), default="")
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    payments = relationship("BankLoanPayment", back_populates="loan",
                             cascade="all, delete-orphan", order_by="BankLoanPayment.paid_at")


class BankLoanPayment(Base):
    __tablename__ = "bank_loan_payments"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey(fk_ref("bank_loans.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    interest_portion = Column(Float, default=0)
    principal_portion = Column(Float, default=0)
    balance_after = Column(Float, default=0)
    paid_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(80), default="")

    loan = relationship("BankLoan", back_populates="payments")


# ---------------------------------------------------------------------------
# Compliance deadlines (TRA, BRELA, NSSF/WCF/OSHA, or a custom recurring
# obligation). Reminders are generated by the scheduler, not stored here —
# this table just holds the "what/when/how often", scheduler.py does the
# threshold math (7/1 days for monthly, 30/14/7/1 for yearly) each run.
# ---------------------------------------------------------------------------

class DeadlineType(str, enum.Enum):
    tra_paye = "tra_paye"
    tra_sdl = "tra_sdl"
    tra_vat = "tra_vat"
    brela_annual_fee = "brela_annual_fee"
    business_name_renewal = "business_name_renewal"
    nssf = "nssf"
    wcf = "wcf"
    osha = "osha"
    custom = "custom"


class DeadlineRecurrence(str, enum.Enum):
    monthly = "monthly"
    yearly = "yearly"
    once = "once"


class ComplianceDeadline(Base):
    __tablename__ = "compliance_deadlines"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    deadline_type = Column(Enum(DeadlineType), default=DeadlineType.custom)
    label = Column(String(120), nullable=False)
    due_date = Column(DateTime, nullable=False)  # next occurrence; rolled forward by the scheduler once past
    recurrence = Column(Enum(DeadlineRecurrence), default=DeadlineRecurrence.monthly)
    is_active = Column(Boolean, default=True)  # false = paused/cancelled, no more reminders
    notes = Column(String(255), default="")
    created_by = Column(String(80), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------- Double-Entry Accounting Ledger ----------


class LedgerAccountType(str, enum.Enum):
    """Standard account types for double-entry accounting."""
    asset = "asset"
    liability = "liability"
    equity = "equity"
    revenue = "revenue"
    expense = "expense"


class ChartOfAccount(Base):
    """Chart of accounts - the foundation for double-entry accounting."""
    __tablename__ = "chart_of_accounts"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    code = Column(String(20), nullable=False, index=True)  # e.g., "1000" for Assets
    name = Column(String(150), nullable=False)
    account_type = Column(Enum(LedgerAccountType), nullable=False)  # Asset/Liability/Equity/Revenue/Expense
    parent_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=True)  # For sub-accounts
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Self-referential relationship for hierarchical accounts
    parent = relationship("ChartOfAccount", remote_side=[id], backref="children")
    # Journal lines that reference this account
    journal_lines = relationship("JournalLine", back_populates="account")


class PaymentMethod(Base):
    """A POS payment method (Cash, a mobile-money till, a bank account, store
    credit, ...) mapped to the Asset/Cash & Bank account it should hit in the
    Chart of Accounts. Replaces the old hard-coded cash/mobile_money/credit
    enum on the POS dropdown — a tenant can add as many tills/accounts as
    they actually use, and each one knows exactly which ledger account to
    debit on checkout."""
    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)  # e.g. "Vodacom Lipa Namba"
    chart_account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    is_credit = Column(Boolean, default=False)  # True = "sell on credit" (Debtors), not an immediate cash/bank hit
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    chart_account = relationship("ChartOfAccount")


class JournalEntry(Base):
    """Journal entry header - groups related debits/credits as a single transaction."""
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    description = Column(String(255), nullable=False)
    reference = Column(String(100), nullable=True)  # e.g., invoice number, receipt number
    created_by = Column(String(80), nullable=True)
    is_locked = Column(Boolean, default=False)  # Prevents edits once posted/closed period
    is_reversal = Column(Boolean, default=False)  # True if this entry itself is a reversal
    reversed_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)  # set on the reversal, pointing back at the original
    is_voided = Column(Boolean, default=False)  # True on the original once a reversal has been posted against it
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    lines = relationship("JournalLine", back_populates="journal_entry", cascade="all, delete-orphan")
    reversed_entry = relationship("JournalEntry", remote_side=[id], backref="reversals")


class JournalLine(Base):
    """Individual debit or credit line within a journal entry."""
    __tablename__ = "journal_lines"

    id = Column(Integer, primary_key=True, index=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=False, index=True)
    chart_account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False, index=True)
    debit = Column(Float, default=0)
    credit = Column(Float, default=0)
    description = Column(String(255), nullable=True)

    journal_entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("ChartOfAccount", back_populates="journal_lines")


class FiscalPeriodStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class FiscalPeriod(Base):
    """A closable accounting period (e.g. a calendar month). Once closed, no
    journal entry may be posted with a date inside [start_date, end_date] —
    corrections must go through a reversing entry in an open period instead."""
    __tablename__ = "fiscal_periods"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    name = Column(String(80), nullable=False)  # e.g. "2026-06" or "Q2 2026"
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(Enum(FiscalPeriodStatus), default=FiscalPeriodStatus.open, index=True)
    closed_by = Column(String(80), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        # Ensure periods don't overlap for the same account
        UniqueConstraint("account_id", "start_date", "end_date", name="uq_fiscal_period_dates"),
    )


class Attachment(Base):
    """File attachments for transactions (expenses, purchases, invoices)."""
    __tablename__ = "attachments"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False, index=True)  # "expense", "purchase", "invoice"
    entity_id = Column(Integer, nullable=False, index=True)  # ID of the related entity
    file_url = Column(String(500), nullable=False)  # URL to stored file (S3, local, etc.)
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)  # Size in bytes
    uploaded_by = Column(String(80), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow, index=True)


class RecurringInvoice(Base):
    """Template for automatically generating invoices on a recurring schedule."""
    __tablename__ = "recurring_invoices"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey(fk_ref("debtors.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    name = Column(String(150), nullable=False)  # e.g., "Monthly retainer - ABC Corp"
    description = Column(String(500), nullable=True)
    
    # Line items stored as JSON for flexibility
    line_items = Column(Text, nullable=False)  # JSON array of {item_id, description, quantity, unit_price}
    
    # Schedule
    frequency = Column(String(50), nullable=False)  # "weekly", "biweekly", "monthly", "quarterly", "yearly"
    interval = Column(Integer, default=1)  # e.g., 2 for "every 2 months"
    day_of_month = Column(Integer, nullable=True)  # For monthly: 1-31
    day_of_week = Column(String(20), nullable=True)  # For weekly: "monday", "tuesday", etc.
    
    # Control
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=True)  # Optional end date
    last_generated = Column(DateTime, nullable=True)  # Last time an invoice was generated
    next_generation = Column(DateTime, nullable=True, index=True)  # Next scheduled generation
    is_active = Column(Boolean, default=True, index=True)
    
    created_by = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExchangeRate(Base):
    """Exchange rates for multi-currency support. Rates are stored as base_currency to target_currency."""
    __tablename__ = "exchange_rates"
    __table_args__ = (
        UniqueConstraint("account_id", "base_currency", "target_currency", "effective_date",
                        name="uq_exchange_rate_date"),
        schema_args(SCHEMA_BUSINESS),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    base_currency = Column(String(3), nullable=False, index=True)  # e.g., "TZS", "USD", "EUR"
    target_currency = Column(String(3), nullable=False, index=True)  # e.g., "TZS", "USD", "EUR"
    rate = Column(Float, nullable=False)  # 1 base_currency = rate target_currency
    effective_date = Column(DateTime, nullable=False, index=True)
    source = Column(String(50), nullable=True)  # "manual", "bank", "api"
    created_by = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Employee(Base):
    """Employee records for payroll."""
    __tablename__ = "employees"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)  # Link to user if employee has login
    employee_number = Column(String(20), nullable=False, unique=True, index=True)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(120), nullable=True)
    phone = Column(String(40), nullable=True)
    address = Column(String(255), nullable=True)
    
    # Employment details
    hire_date = Column(DateTime, nullable=False)
    position = Column(String(100), nullable=True)
    department = Column(String(100), nullable=True)
    employment_type = Column(String(50), nullable=True)  # "full-time", "part-time", "contract"
    is_active = Column(Boolean, default=True, index=True)
    
    # Compensation
    salary = Column(Float, nullable=False)  # Monthly salary
    pay_frequency = Column(String(20), default="monthly")  # "weekly", "biweekly", "monthly"
    
    # Tax and deductions
    tax_id = Column(String(50), nullable=True)  # NIN, TIN, etc.
    bank_name = Column(String(100), nullable=True)
    bank_account = Column(String(50), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Payslip(Base):
    """Generated payslip for an employee for a pay period."""
    __tablename__ = "payslips"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey(fk_ref("employees.id", SCHEMA_BUSINESS)), nullable=False, index=True)
    
    # Pay period
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    pay_date = Column(DateTime, nullable=False)
    
    # Earnings
    gross_pay = Column(Float, nullable=False)
    basic_salary = Column(Float, nullable=False)
    overtime = Column(Float, default=0)
    bonuses = Column(Float, default=0)
    allowances = Column(Float, default=0)
    
    # Deductions
    paye_tax = Column(Float, default=0)  # Pay As You Earn
    social_security = Column(Float, default=0)
    pension = Column(Float, default=0)
    other_deductions = Column(Float, default=0)
    total_deductions = Column(Float, default=0)
    
    # Net pay
    net_pay = Column(Float, nullable=False)
    
    # Status
    status = Column(String(20), default="draft")  # "draft", "finalized", "paid"
    notes = Column(Text, nullable=True)
    
    created_by = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Approval(Base):
    """Approval workflow for transactions above a threshold."""
    __tablename__ = "approvals"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    
    # Target entity
    entity_type = Column(String(50), nullable=False, index=True)  # "invoice", "expense", "purchase"
    entity_id = Column(Integer, nullable=False, index=True)
    
    # Approval details
    requested_by = Column(String(80), nullable=False)
    requested_at = Column(DateTime, default=datetime.utcnow, index=True)
    approved_by = Column(String(80), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(String(80), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    
    status = Column(String(20), default="pending")  # "pending", "approved", "rejected"
    amount = Column(Float, nullable=False)  # Amount being approved
    reason = Column(Text, nullable=True)  # Reason for rejection
    
    created_at = Column(DateTime, default=datetime.utcnow)


class Budget(Base):
    """Budget tracking for expense categories."""
    __tablename__ = "budgets"
    __table_args__ = schema_args(SCHEMA_BUSINESS)

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    
    # Budget period
    period_type = Column(String(20), nullable=False)  # "monthly", "quarterly", "yearly"
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=True)  # For monthly budgets
    quarter = Column(Integer, nullable=True)  # For quarterly budgets
    
    # Category budget
    category = Column(String(100), nullable=False, index=True)  # e.g., "Office Supplies", "Marketing"
    budgeted_amount = Column(Float, nullable=False)
    
    # Actual tracking
    actual_amount = Column(Float, default=0)
    variance = Column(Float, default=0)
    
    is_active = Column(Boolean, default=True)
    created_by = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class LoginSession(Base):
    """One row per login (or demo-login) — IP, best-effort geolocation, and
    parsed device/browser/OS from the User-Agent header. Purely additive
    telemetry for the superadmin console: understanding where users log in
    from and what devices/browsers they use, to prioritize mobile-vs-desktop
    work, browser compat, and regional performance (e.g. slow connections in
    a particular country). Never used for auth decisions — a lookup failure
    here must never block or affect login itself (see device_tracking.py).
    """
    __tablename__ = "login_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    username = Column(String(80), index=True)

    ip_address = Column(String(64), default="")
    city = Column(String(120), default="")
    region = Column(String(120), default="")
    country = Column(String(120), default="")
    isp = Column(String(200), default="")

    device_type = Column(String(20), default="")   # mobile / tablet / desktop / bot / unknown
    os = Column(String(60), default="")             # e.g. "Android 14", "iOS 17", "Windows 10"
    browser = Column(String(60), default="")        # e.g. "Chrome 126", "Safari 17"
    user_agent = Column(Text, default="")

    event = Column(String(20), default="login")     # "login" or "demo_login"
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
