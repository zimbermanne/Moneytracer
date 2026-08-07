from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, and_

from database import get_db
from models import (
    Debtor, DebtorItem, Creditor, CreditorItem, User, LedgerStatus, RoleEnum,
    FiscalPeriod, FiscalPeriodStatus, ChartOfAccount, JournalEntry, JournalLine
)
from schemas import (
    DebtorCreate, DebtorUpdate, DebtorOut, CreditorCreate, CreditorUpdate, CreditorOut,
    LedgerOut, PaymentRequest, FiscalPeriodCreate, FiscalPeriodOut,
    ChartOfAccountOut, JournalEntryOut, JournalEntryCreate, JournalLineOut
)
from auth import get_current_user, require_manager_up, require_admin
from activity import log_activity_for_user
from ledger import post_journal_entry, FiscalPeriodLockedError

router = APIRouter(prefix="/api/ledgers", tags=["ledgers"])


def get_account_filter(current_user: User):
    """Return account_id filter for queries. Superadmin gets None (no filter)."""
    if current_user.role == RoleEnum.superadmin:
        return None
    if not current_user.account_id:
        raise HTTPException(status_code=403, detail="User must belong to an account")
    return current_user.account_id


def _update_status(entry):
    if entry.amount_paid <= 0:
        entry.status = LedgerStatus.unpaid
    elif entry.amount_paid >= entry.total_owed:
        entry.status = LedgerStatus.paid
    else:
        entry.status = LedgerStatus.partial


@router.get("/debtors", response_model=List[DebtorOut])
def list_debtors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Debtor)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    return query.order_by(Debtor.created_at.desc()).all()


@router.post("/debtors", response_model=DebtorOut)
def add_debtor(payload: DebtorCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot add debtors")

    fields = payload.model_dump(exclude={"items"})
    debtor = Debtor(**fields, account_id=account_id)
    db.add(debtor)
    db.flush()  # need debtor.id before attaching items
    for line in payload.items:
        db.add(DebtorItem(debtor_id=debtor.id, **line.model_dump()))
    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_add", f"Added debtor {debtor.name}")
    return debtor


@router.put("/debtors/{debtor_id}", response_model=DebtorOut)
def update_debtor(debtor_id: int, payload: DebtorUpdate, db: Session = Depends(get_db),
                   current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    for field, value in updates.items():
        setattr(debtor, field, value)
    _update_status(debtor)

    if payload.items is not None:  # explicit [] clears items; omitted leaves them untouched
        db.query(DebtorItem).filter(DebtorItem.debtor_id == debtor.id).delete()
        for line in payload.items:
            db.add(DebtorItem(debtor_id=debtor.id, **line.model_dump()))

    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_update", f"Updated debtor {debtor_id}")
    return debtor


@router.delete("/debtors/{debtor_id}")
def delete_debtor(debtor_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    account_id = get_account_filter(current_user)
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")
    db.delete(debtor)
    db.commit()
    log_activity_for_user(db, current_user, "debtor_delete", f"Deleted debtor {debtor_id}")
    return {"detail": "Debtor deleted"}


@router.post("/debtors/pay/{debtor_id}", response_model=DebtorOut)
def pay_debtor(debtor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    query = db.query(Debtor).filter(Debtor.id == debtor_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Debtor.account_id == account_id)
    debtor = query.first()
    if not debtor:
        raise HTTPException(status_code=404, detail="Debtor not found")
    debtor.amount_paid += payload.amount
    _update_status(debtor)
    db.commit()
    db.refresh(debtor)
    log_activity_for_user(db, current_user, "debtor_payment", f"{debtor.name} paid {payload.amount}")
    return debtor


@router.get("/creditors", response_model=List[CreditorOut])
def list_creditors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Creditor)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    return query.order_by(Creditor.created_at.desc()).all()


@router.post("/creditors", response_model=CreditorOut)
def add_creditor(payload: CreditorCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot add creditors")

    fields = payload.model_dump(exclude={"items"})
    creditor = Creditor(**fields, account_id=account_id)
    db.add(creditor)
    db.flush()  # need creditor.id before attaching items
    for line in payload.items:
        db.add(CreditorItem(creditor_id=creditor.id, **line.model_dump()))
    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_add", f"Added creditor {creditor.name}")
    return creditor


@router.put("/creditors/{creditor_id}", response_model=CreditorOut)
def update_creditor(creditor_id: int, payload: CreditorUpdate, db: Session = Depends(get_db),
                     current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    for field, value in updates.items():
        setattr(creditor, field, value)
    _update_status(creditor)

    if payload.items is not None:  # explicit [] clears items; omitted leaves them untouched
        db.query(CreditorItem).filter(CreditorItem.creditor_id == creditor.id).delete()
        for line in payload.items:
            db.add(CreditorItem(creditor_id=creditor.id, **line.model_dump()))

    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_update", f"Updated creditor {creditor_id}")
    return creditor


@router.delete("/creditors/{creditor_id}")
def delete_creditor(creditor_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    account_id = get_account_filter(current_user)
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    db.delete(creditor)
    db.commit()
    log_activity_for_user(db, current_user, "creditor_delete", f"Deleted creditor {creditor_id}")
    return {"detail": "Creditor deleted"}


@router.post("/creditors/pay/{creditor_id}", response_model=CreditorOut)
def pay_creditor(creditor_id: int, payload: PaymentRequest, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    query = db.query(Creditor).filter(Creditor.id == creditor_id)
    account_id = get_account_filter(current_user)
    if account_id is not None:
        query = query.filter(Creditor.account_id == account_id)
    creditor = query.first()
    if not creditor:
        raise HTTPException(status_code=404, detail="Creditor not found")
    creditor.amount_paid += payload.amount
    _update_status(creditor)
    db.commit()
    db.refresh(creditor)
    log_activity_for_user(db, current_user, "creditor_payment", f"Paid {creditor.name} {payload.amount}")
    return creditor


# ---------- Fiscal Periods ----------

@router.get("/fiscal-periods", response_model=List[FiscalPeriodOut])
def list_fiscal_periods(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    return q.order_by(FiscalPeriod.start_date.desc()).all()


@router.post("/fiscal-periods", response_model=FiscalPeriodOut)
def create_fiscal_period(payload: FiscalPeriodCreate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_manager_up)):
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create fiscal periods")
    if payload.end_date <= payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date")

    overlap = (
        db.query(FiscalPeriod)
        .filter(
            FiscalPeriod.account_id == account_id,
            FiscalPeriod.start_date <= payload.end_date,
            FiscalPeriod.end_date >= payload.start_date,
        )
        .first()
    )
    if overlap:
        raise HTTPException(status_code=400, detail=f"Overlaps existing period '{overlap.name}'")

    period = FiscalPeriod(account_id=account_id, name=payload.name,
                           start_date=payload.start_date, end_date=payload.end_date)
    db.add(period)
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "fiscal_period_create", f"Created period {period.name}")
    return period


@router.post("/fiscal-periods/{period_id}/close", response_model=FiscalPeriodOut)
def close_fiscal_period(period_id: int, db: Session = Depends(get_db),
                         current_user: User = Depends(require_manager_up)):
    """Locks the period: post_journal_entry will reject any entry dated
    inside it from this point on. Existing entries are untouched — the
    lock only blocks new posts and edits, never mutates history."""
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod).filter(FiscalPeriod.id == period_id)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    period = q.first()
    if not period:
        raise HTTPException(status_code=404, detail="Fiscal period not found")
    if period.status == FiscalPeriodStatus.closed:
        raise HTTPException(status_code=400, detail="Fiscal period is already closed")

    period.status = FiscalPeriodStatus.closed
    period.closed_by = current_user.username
    period.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "fiscal_period_close", f"Closed period {period.name}")
    return period


@router.post("/fiscal-periods/{period_id}/reopen", response_model=FiscalPeriodOut)
def reopen_fiscal_period(period_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(require_manager_up)):
    """Reopening is intentionally left available to managers+ (not locked to
    superadmin) since small businesses need to fix a mistaken close without
    filing a support ticket — but every reopen is logged so it's auditable."""
    account_id = get_account_filter(current_user)
    q = db.query(FiscalPeriod).filter(FiscalPeriod.id == period_id)
    if account_id is not None:
        q = q.filter(FiscalPeriod.account_id == account_id)
    period = q.first()
    if not period:
        raise HTTPException(status_code=404, detail="Fiscal period not found")
    if period.status == FiscalPeriodStatus.open:
        raise HTTPException(status_code=400, detail="Fiscal period is already open")

    period.status = FiscalPeriodStatus.open
    period.closed_by = None
    period.closed_at = None
    db.commit()
    db.refresh(period)
    log_activity_for_user(db, current_user, "CRITICAL: fiscal_period_reopen", f"Reopened period {period.name}")
    return period


# ---------- Chart of Accounts ----------

@router.get("/chart-of-accounts", response_model=List[ChartOfAccountOut])
def list_chart_of_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return ChartOfAccount records as a nested tree grouped by type, with running balances."""
    account_id = get_account_filter(current_user)
    query = db.query(ChartOfAccount)
    if account_id is not None:
        query = query.filter(ChartOfAccount.account_id == account_id)
    accounts = query.filter(ChartOfAccount.is_active == True).order_by(ChartOfAccount.code).all()

    # Compute running balance per account in a single grouped query instead
    # of one query per account — with a real chart of accounts + years of
    # transactions this was slow enough to time out the request entirely.
    balance_query = (
        db.query(
            JournalLine.chart_account_id,
            (func.sum(JournalLine.debit) - func.sum(JournalLine.credit)).label("balance"),
        )
        .join(JournalEntry, JournalLine.journal_entry_id == JournalEntry.id)
        .filter(
            JournalLine.chart_account_id.in_([a.id for a in accounts]),
            JournalEntry.is_voided == False,
        )
    )
    if account_id is not None:
        balance_query = balance_query.filter(JournalEntry.account_id == account_id)
    balance_rows = balance_query.group_by(JournalLine.chart_account_id).all()
    account_balances = {row.chart_account_id: row.balance or 0 for row in balance_rows}

    # Build nested tree structure. `seen` guards against a corrupted
    # parent_id cycle (e.g. A -> B -> A) recursing forever and taking the
    # whole endpoint down with a stack overflow.
    def build_tree(parent_id=None, seen=frozenset()):
        children = []
        for acc in accounts:
            if acc.parent_id == parent_id and acc.id not in seen:
                acc_dict = {
                    "id": acc.id,
                    "account_id": acc.account_id,
                    "code": acc.code,
                    "name": acc.name,
                    "account_type": acc.account_type,
                    "parent_id": acc.parent_id,
                    "is_active": acc.is_active,
                    "balance": account_balances.get(acc.id, 0),
                    "children": build_tree(acc.id, seen | {acc.id}),
                }
                children.append(ChartOfAccountOut(**acc_dict))
        return children

    return build_tree(parent_id=None)


# ---------- Journal Entries ----------

@router.get("/journal-entries", response_model=List[JournalEntryOut])
def list_journal_entries(
    account_id_filter: Optional[int] = Query(None, description="Filter by chart account ID"),
    start_date: Optional[datetime] = Query(None, description="Filter by start date"),
    end_date: Optional[datetime] = Query(None, description="Filter by end date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Paginated list of journal entries with optional filtering by account and date range."""
    account_id = get_account_filter(current_user)
    query = db.query(JournalEntry).options(
        selectinload(JournalEntry.lines).selectinload(JournalLine.account)
    ).filter(JournalEntry.is_voided == False)
    if account_id is not None:
        query = query.filter(JournalEntry.account_id == account_id)
    if account_id_filter is not None:
        query = query.join(JournalLine).filter(JournalLine.chart_account_id == account_id_filter)
    if start_date is not None:
        query = query.filter(JournalEntry.date >= start_date)
    if end_date is not None:
        query = query.filter(JournalEntry.date <= end_date)

    entries = query.order_by(JournalEntry.date.desc()).all()

    # Build response with lines and running balance
    result = []
    for entry in entries:
        lines = []
        for line in entry.lines:
            # line.account can be None if the chart-of-accounts row it points
            # at was ever deleted — without this guard, `.code`/`.name` on
            # None raises AttributeError and takes the whole endpoint down.
            lines.append(JournalLineOut(
                id=line.id,
                chart_account_id=line.chart_account_id,
                account_code=line.account.code if line.account else "—",
                account_name=line.account.name if line.account else "(deleted account)",
                debit=line.debit,
                credit=line.credit,
                description=line.description,
            ))
        result.append(JournalEntryOut(
            id=entry.id,
            account_id=entry.account_id,
            date=entry.date,
            description=entry.description,
            reference=entry.reference,
            created_by=entry.created_by,
            is_locked=entry.is_locked,
            is_reversal=entry.is_reversal,
            is_voided=entry.is_voided,
            reversed_entry_id=entry.reversed_entry_id,
            lines=lines,
        ))
    return result


@router.post("/journal-entries", response_model=JournalEntryOut)
def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Create a manual journal entry. Validates balance and calls existing post_journal_entry."""
    account_id = get_account_filter(current_user)
    if account_id is None:
        raise HTTPException(status_code=403, detail="Superadmin cannot create journal entries")

    # Validate that lines balance
    total_debit = sum(line.get("debit", 0) for line in payload.lines)
    total_credit = sum(line.get("credit", 0) for line in payload.lines)
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(status_code=400, detail=f"Entry doesn't balance: debits {total_debit} != credits {total_credit}")

    # Build lines for post_journal_entry
    lines = []
    for line in payload.lines:
        # Get account code from chart_account_id
        chart_account = db.query(ChartOfAccount).filter(
            ChartOfAccount.id == line["account_id"],
            ChartOfAccount.account_id == account_id
        ).first()
        if not chart_account:
            raise HTTPException(status_code=404, detail=f"Chart account {line['account_id']} not found")
        lines.append((chart_account.code, line.get("debit", 0), line.get("credit", 0)))

    try:
        entry = post_journal_entry(
            db,
            account_id,
            description=payload.description,
            lines=lines,
            reference=payload.reference,
            created_by=current_user.username,
            date=payload.date,
        )
    except FiscalPeriodLockedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Build response
    lines_out = []
    for line in entry.lines:
        lines_out.append(JournalLineOut(
            id=line.id,
            chart_account_id=line.chart_account_id,
            account_code=line.account.code,
            account_name=line.account.name,
            debit=line.debit,
            credit=line.credit,
            description=line.description,
        ))

    return JournalEntryOut(
        id=entry.id,
        account_id=entry.account_id,
        date=entry.date,
        description=entry.description,
        reference=entry.reference,
        created_by=entry.created_by,
        is_locked=entry.is_locked,
        is_reversal=entry.is_reversal,
        is_voided=entry.is_voided,
        reversed_entry_id=entry.reversed_entry_id,
        lines=lines_out,
    )
