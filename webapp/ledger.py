"""
Double-entry ledger helpers.

The ChartOfAccount/JournalEntry/JournalLine tables (added in models.py)
were previously unused — Sale/Purchase/Expense rows were the only record
of a transaction, and reports summed those tables directly instead of
reading from a ledger. This module wires the two together:

- ensure_default_chart_of_accounts(): seeds a standard starter chart for a
  tenant the first time it's needed (idempotent — safe to call every time).
- post_journal_entry(): the single entry point for writing a balanced
  journal entry. Raises if debits != credits, so it's impossible to post
  an unbalanced entry through this helper.
- post_sale_entry / post_purchase_entry / post_expense_entry: build the
  correct debit/credit lines for each transaction type.

Call the relevant post_*_entry() function right after committing the
Sale/Purchase/Expense row in each router. It's intentionally decoupled
(plain functions, not signals/hooks) so it stays easy to trace.
"""
from datetime import datetime
from sqlalchemy.orm import Session

from models import (
    Account, ChartOfAccount, CogsMethod, JournalEntry, JournalLine, LedgerAccountType,
    FiscalPeriod, FiscalPeriodStatus, PaymentMethod,
)


def _get_cogs_method(db: Session, account_id: int) -> CogsMethod:
    """Look up this tenant's cash/accrual setting. Missing account or null
    column (pre-migration rows) both fall back to accrual, the historical
    default — never silently switch a tenant's accounting method."""
    account = db.query(Account).filter(Account.id == account_id).first()
    method = getattr(account, "cogs_method", None) if account else None
    return method or CogsMethod.accrual


class FiscalPeriodLockedError(ValueError):
    """Raised when a post/edit is attempted against a date inside a closed
    fiscal period. Callers should surface this as a 400, not swallow it —
    per the integrity guardrail, closed periods are never silently skipped."""
    pass


def get_locked_period(db: Session, account_id: int, when: datetime) -> FiscalPeriod:
    """Return the closed FiscalPeriod covering `when`, or None if the date
    falls in an open period or no period has been defined for it at all
    (undefined periods are treated as open, not locked)."""
    when = when or datetime.utcnow()
    return (
        db.query(FiscalPeriod)
        .filter(
            FiscalPeriod.account_id == account_id,
            FiscalPeriod.status == FiscalPeriodStatus.closed,
            FiscalPeriod.start_date <= when,
            FiscalPeriod.end_date >= when,
        )
        .first()
    )


# code -> (name, type). Kept small and flat; sub-accounts can be added later
# via parent_id without touching this list.
_STANDARD_CHART = [
    ("1000", "Cash", LedgerAccountType.asset),
    # Sub-accounts a POS Payment Method can be mapped to — see
    # ensure_default_payment_methods() below. Kept alongside the original
    # "1000 Cash" umbrella account (still used as the fallback debit target
    # for any sale with no payment_method_id set).
    ("1001", "Cash In Hand", LedgerAccountType.asset),
    ("1002", "Vodacom Lipa Namba", LedgerAccountType.asset),
    ("1003", "Tigo Lipa Namba", LedgerAccountType.asset),
    ("1010", "Bank Account", LedgerAccountType.asset),
    # Matches the spec exactly: 1200 = Debtors / Accounts Receivable.
    # Inventory moved to 1210 to free this code up — existing tenants'
    # historical data is carried over automatically, see
    # _migrate_renumber_chart_of_accounts() in migrate.py.
    ("1200", "Debtors / Accounts Receivable", LedgerAccountType.asset),
    ("1210", "Inventory", LedgerAccountType.asset),
    ("1300", "Fixed Assets", LedgerAccountType.asset),
    ("1310", "Accumulated Depreciation", LedgerAccountType.asset),  # Contra-asset
    ("1400", "Financial Investments", LedgerAccountType.asset),
    ("2000", "Accounts Payable", LedgerAccountType.liability),
    ("2100", "VAT Payable (Output)", LedgerAccountType.liability),
    ("2110", "VAT Receivable (Input)", LedgerAccountType.asset),
    ("2200", "Bank Loans Payable", LedgerAccountType.liability),
    ("2210", "Interest Payable", LedgerAccountType.liability),
    ("3000", "Owner's Equity", LedgerAccountType.equity),
    ("4000", "Sales Revenue", LedgerAccountType.revenue),
    ("4100", "Revaluation Gain (Unrealized)", LedgerAccountType.revenue),
    ("5000", "Cost of Goods Sold", LedgerAccountType.expense),
    ("5100", "Operating Expenses", LedgerAccountType.expense),
    ("5200", "Interest Expense", LedgerAccountType.expense),
    ("5300", "Salaries & Wages Expense", LedgerAccountType.expense),
    ("5400", "Depreciation Expense", LedgerAccountType.expense),
    ("2300", "PAYE Tax Payable", LedgerAccountType.liability),
    ("2310", "Social Security Payable", LedgerAccountType.liability),
    ("2320", "Other Payroll Deductions Payable", LedgerAccountType.liability),
]


def ensure_default_chart_of_accounts(db: Session, account_id: int) -> dict:
    """Return {code: ChartOfAccount} for this tenant, creating any missing
    standard accounts first. Safe to call on every request — only inserts
    codes that don't already exist for this account_id."""
    existing = {
        c.code: c
        for c in db.query(ChartOfAccount).filter(ChartOfAccount.account_id == account_id).all()
    }
    created = False
    for code, name, acc_type in _STANDARD_CHART:
        if code not in existing:
            row = ChartOfAccount(account_id=account_id, code=code, name=name, account_type=acc_type)
            db.add(row)
            existing[code] = row
            created = True
    if created:
        db.commit()
        for row in existing.values():
            db.refresh(row)
    return existing


# name -> (chart_account_code, is_credit). Seeded once per tenant, matching
# the codes registered in _STANDARD_CHART above. A tenant can rename these,
# add more (e.g. a second mobile-money till), deactivate ones they don't
# use, or repoint one at a different account — see routers/ledgers.py
# payment-methods endpoints.
_DEFAULT_PAYMENT_METHODS = [
    ("Cash", "1001", False),
    ("Vodacom Lipa Namba", "1002", False),
    ("Tigo Lipa Namba", "1003", False),
    ("Bank Transfer", "1010", False),
    ("Credit (Debtors)", "1200", True),
]


def ensure_default_payment_methods(db: Session, account_id: int) -> list:
    """Return this tenant's active PaymentMethod rows, seeding the standard
    starter set (mapped to the standard chart of accounts) the first time
    it's needed. Idempotent — safe to call on every request."""
    chart = ensure_default_chart_of_accounts(db, account_id)
    existing = (
        db.query(PaymentMethod)
        .filter(PaymentMethod.account_id == account_id)
        .all()
    )
    if existing:
        return existing

    created = []
    for order, (name, code, is_credit) in enumerate(_DEFAULT_PAYMENT_METHODS):
        row = PaymentMethod(
            account_id=account_id,
            name=name,
            chart_account_id=chart[code].id,
            is_credit=is_credit,
            sort_order=order,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for row in created:
        db.refresh(row)
    return created


def post_journal_entry(db: Session, account_id: int, description: str, lines: list,
                        reference: str = None, created_by: str = None, date: datetime = None) -> JournalEntry:
    """lines: list of (chart_account_code, debit, credit) tuples.
    Raises ValueError if the entry doesn't balance — this is the one place
    that guarantees every posted entry is valid double-entry accounting."""
    total_debit = round(sum(l[1] for l in lines), 2)
    total_credit = round(sum(l[2] for l in lines), 2)
    if total_debit != total_credit:
        raise ValueError(
            f"Unbalanced journal entry '{description}': debits {total_debit} != credits {total_credit}"
        )

    entry_date = date or datetime.utcnow()
    locked = get_locked_period(db, account_id, entry_date)
    if locked is not None:
        raise FiscalPeriodLockedError(
            f"Cannot post '{description}' on {entry_date.date()} — fiscal period "
            f"'{locked.name}' is closed. Use a correction/reversing entry in an open period instead."
        )

    chart = ensure_default_chart_of_accounts(db, account_id)

    entry = JournalEntry(
        account_id=account_id,
        date=entry_date,
        description=description,
        reference=reference,
        created_by=created_by,
    )
    db.add(entry)
    db.flush()  # get entry.id without a full commit

    for code, debit, credit in lines:
        if code not in chart:
            raise ValueError(f"Unknown chart of accounts code '{code}' for account {account_id}")
        db.add(JournalLine(
            journal_entry_id=entry.id,
            chart_account_id=chart[code].id,
            debit=debit,
            credit=credit,
        ))

    db.commit()
    db.refresh(entry)
    return entry


def post_sale_entry(db: Session, account_id: int, sale, created_by: str = None) -> JournalEntry:
    """Dr the mapped Payment Method's Cash/Bank/AR account, Cr Sales Revenue
    (4000) + VAT Payable (Output) — plus Dr COGS / Cr Inventory for the cost
    side, when a cost is known.

    The debit account is resolved in this order:
      1. sale.payment_method.chart_account.code — the cashier's chosen POS
         Payment Method (Cash In Hand, a specific mobile-money till, Bank,
         Debtors, ...), set on checkout via payment_method_id.
      2. Fall back to the legacy payment_mode enum (cash -> 1000, credit ->
         1100) for sales recorded before Payment Methods existed, or through
         any caller that doesn't set payment_method_id.
    """
    lines = []
    payment_method = getattr(sale, "payment_method", None)
    if payment_method is not None and payment_method.chart_account is not None:
        cash_or_ar_code = payment_method.chart_account.code
    else:
        cash_or_ar_code = "1200" if getattr(sale, "payment_mode", None) and sale.payment_mode.value == "credit" else "1000"
    
    # Get tax rate from sale if available, otherwise 0
    tax_rate = getattr(sale, "tax_rate", 0) or 0
    tax_amount = getattr(sale, "tax_amount", 0) or 0
    
    # Debit Cash/AR for the full amount
    lines.append((cash_or_ar_code, sale.total, 0))
    
    # Split credit: net revenue + output VAT
    if tax_rate > 0 and tax_amount > 0:
        # VAT-registered sale: split revenue and VAT
        net_revenue = sale.total - tax_amount
        lines.append(("4000", 0, net_revenue))
        lines.append(("2100", 0, tax_amount))  # VAT Payable (Output)
    else:
        # Non-VAT sale: full amount to revenue
        lines.append(("4000", 0, sale.total))

    # Under accrual, the cost of what sold moves from Inventory into COGS
    # right now. Under cash-basis, that cost was already expensed in full
    # when the stock was purchased (see post_purchase_entry) — posting it
    # again here would double-count it, so cash-basis tenants skip this
    # pair entirely.
    if _get_cogs_method(db, account_id) == CogsMethod.accrual:
        cost = (sale.cost_price_at_sale or 0) * (sale.quantity or 0)
        if cost:
            lines.append(("5000", cost, 0))
            lines.append(("1210", 0, cost))

    # Cost lines unbalance the revenue lines above unless summed together —
    # post as one entry so debits/credits both include the cost pair.
    return post_journal_entry(
        db, account_id,
        description=f"Sale: {sale.item_name or 'item'} x{sale.quantity}",
        lines=lines,
        reference=sale.receipt_no or f"sale-{sale.id}",
        created_by=created_by,
        date=sale.created_at,
    )


def post_purchase_entry(db: Session, account_id: int, purchase, created_by: str = None) -> JournalEntry:
    """Accrual (default): Dr Inventory + VAT Receivable (Input), Cr Cash/AP —
    stock is capitalized as an asset until it sells.

    Cash-basis (per-tenant opt-in via Account.cogs_method): Dr Cost of Goods
    Sold (5000) + VAT Receivable (Input), Cr Cash/AP instead — the purchase
    reduces profit immediately. See CogsMethod docstring in models.py. When
    cash-basis is on, post_sale_entry() skips its own cost/Inventory lines
    for the same tenant so the cost is never expensed twice.
    """
    lines = []
    cost_code = "5000" if _get_cogs_method(db, account_id) == CogsMethod.cash else "1210"

    # Get tax rate from purchase if available (for future VAT support)
    # Currently Purchase model doesn't have tax_rate/tax_amount, but we'll add the structure
    tax_rate = getattr(purchase, "tax_rate", 0) or 0
    tax_amount = getattr(purchase, "tax_amount", 0) or 0
    
    if tax_rate > 0 and tax_amount > 0:
        # VAT-registered purchase: split cost/inventory and input VAT
        net_cost = purchase.total - tax_amount
        lines.append((cost_code, net_cost, 0))
        lines.append(("2110", tax_amount, 0))  # VAT Receivable (Input)
    else:
        # Non-VAT purchase: full amount to cost/inventory
        lines.append((cost_code, purchase.total, 0))
    
    lines.append(("1000", 0, purchase.total))
    
    return post_journal_entry(
        db, account_id,
        description=f"Purchase: {purchase.item_name or 'item'} x{purchase.quantity} from {purchase.supplier or 'supplier'}",
        lines=lines,
        reference=f"purchase-{purchase.id}",
        created_by=created_by,
        date=purchase.created_at,
    )


def post_expense_entry(db: Session, account_id: int, expense, created_by: str = None) -> JournalEntry:
    """Dr Operating Expenses, Cr Cash."""
    lines = [
        ("5100", expense.amount, 0),
        ("1000", 0, expense.amount),
    ]
    return post_journal_entry(
        db, account_id,
        description=f"Expense: {expense.category} — {expense.description or ''}".strip(" —"),
        lines=lines,
        reference=f"expense-{expense.id}",
        created_by=created_by,
        date=expense.created_at,
    )


def find_journal_entry_by_reference(db: Session, account_id: int, reference: str) -> JournalEntry:
    """Look up the (non-reversal) journal entry originally posted for a
    given transaction reference, e.g. 'sale-42' or 'expense-7'."""
    return (
        db.query(JournalEntry)
        .filter(
            JournalEntry.account_id == account_id,
            JournalEntry.reference == reference,
            JournalEntry.is_reversal.is_(False),
        )
        .first()
    )


def reverse_journal_entry(db: Session, account_id: int, original: JournalEntry,
                           created_by: str = None, reason: str = "Void/correction") -> JournalEntry:
    """Post an equal-and-opposite entry against `original` instead of ever
    deleting or mutating a posted entry. The original is marked voided (kept
    for audit trail) and the reversal links back to it via reversed_entry_id.
    Posts today, in whatever period is currently open — reversals of a
    closed-period entry still land in an open period, never back-dated into
    the closed one."""
    if original is None:
        raise ValueError("Cannot reverse a journal entry that does not exist")
    if original.is_voided:
        raise ValueError(f"Journal entry {original.id} has already been reversed")

    # Flip every debit/credit pair.
    lines = [(line.account.code, line.credit, line.debit) for line in original.lines]

    reversal = post_journal_entry(
        db, account_id,
        description=f"Reversal: {original.description} ({reason})",
        lines=lines,
        reference=f"reversal-of-{original.reference or original.id}",
        created_by=created_by,
        date=datetime.utcnow(),
    )
    reversal.is_reversal = True
    reversal.reversed_entry_id = original.id
    original.is_voided = True
    original.is_locked = True
    db.commit()
    db.refresh(reversal)
    return reversal


def post_loan_disbursement_entry(db: Session, account_id: int, loan, created_by: str = None):
    """Bank/lender puts money in your account: debit Bank (asset up),
    credit Bank Loans Payable (liability up)."""
    lines = [("1010", loan.principal, 0), ("2200", 0, loan.principal)]
    return post_journal_entry(
        db, account_id,
        description=f"Loan disbursed: {loan.lender_name}",
        lines=lines,
        reference=f"loan-disbursement-{loan.id}",
        created_by=created_by,
        date=loan.start_date,
    )


def post_loan_payment_entry(db: Session, account_id: int, loan, payment, created_by: str = None):
    """A repayment reduces what's owed (principal portion) and recognizes
    the cost of borrowing (interest portion) — both come out of the bank
    account for the total payment amount."""
    lines = [
        ("2200", payment.principal_portion, 0),  # reduces the liability
        ("5200", payment.interest_portion, 0),   # interest expense
        ("1010", 0, payment.amount),              # cash/bank goes out
    ]
    return post_journal_entry(
        db, account_id,
        description=f"Loan payment: {loan.lender_name}",
        lines=lines,
        reference=f"loan-payment-{payment.id}",
        created_by=created_by,
        date=payment.paid_at,
    )


def post_loan_interest_accrual_entry(db: Session, account_id: int, loan, amount: float, date: datetime):
    """Dr Interest Expense, Cr Interest Payable."""
    lines = [
        ("5200", amount, 0),  # Interest Expense
        ("2210", 0, amount),  # Interest Payable
    ]
    return post_journal_entry(
        db, account_id,
        description=f"Interest accrual: {loan.lender_name}",
        lines=lines,
        reference=f"loan-accrual-{loan.id}-{date.strftime('%Y%m')}",
        created_by="system",
        date=date,
    )


def post_asset_creation_entry(db: Session, account_id: int, asset, created_by: str = None):
    """Dr Fixed Assets / Financial Investments, Cr Cash/Bank."""
    code = "1400" if asset.asset_type.value == "financial_investment" else "1300"
    lines = [(code, asset.acquisition_cost, 0), ("1000", 0, asset.acquisition_cost)]
    return post_journal_entry(
        db, account_id,
        description=f"Asset acquired: {asset.name}",
        lines=lines,
        reference=f"asset-acquire-{asset.id}",
        created_by=created_by,
        date=asset.acquired_date,
    )


def post_asset_revaluation_entry(db: Session, account_id: int, asset, reval, created_by: str = None):
    """If gain: Dr Asset, Cr Revaluation Gain. If loss: Dr Revaluation Gain, Cr Asset."""
    code = "1400" if asset.asset_type.value == "financial_investment" else "1300"
    if reval.gain_loss_amount >= 0:
        lines = [(code, reval.gain_loss_amount, 0), ("4100", 0, reval.gain_loss_amount)]
    else:
        loss = abs(reval.gain_loss_amount)
        lines = [("4100", loss, 0), (code, 0, loss)]

    return post_journal_entry(
        db, account_id,
        description=f"Asset revaluation: {asset.name}",
        lines=lines,
        reference=f"asset-reval-{reval.id}",
        created_by=created_by,
        date=reval.date,
    )


def post_depreciation_entry(db: Session, account_id: int, asset, amount: float, date: datetime, created_by: str = None):
    """Dr Depreciation Expense, Cr Accumulated Depreciation."""
    lines = [("5400", amount, 0), ("1310", 0, amount)]
    return post_journal_entry(
        db, account_id,
        description=f"Depreciation: {asset.name}",
        lines=lines,
        reference=f"asset-depr-{asset.id}-{date.strftime('%Y%m')}",
        created_by=created_by,
        date=date,
    )
