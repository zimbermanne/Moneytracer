"""Bank reconciliation: the classic manual workflow of ticking off journal
lines against a physical/downloaded bank statement, entering the
statement's ending balance, and confirming the difference is zero.

No CSV/OFX import in this first pass — the person checks off lines by eye
against their statement, same as reconciling a checkbook. Import can be
layered on top later (it would just pre-tick likely matches) without
changing this data model at all.
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import (
    User, ChartOfAccount, JournalEntry, JournalLine, PaymentMethod,
    LedgerAccountType, BankReconciliation,
)
from schemas import (
    ChartOfAccountOut, ReconcilableLineOut, BankReconciliationComplete, BankReconciliationOut,
)
from auth import get_current_user, require_manager_up
from ledger import signed_balance
from routers.ledgers import get_account_filter

router = APIRouter(prefix="/api/bank-reconciliation", tags=["bank-reconciliation"])


@router.get("/accounts", response_model=List[ChartOfAccountOut])
def list_reconcilable_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Cash/bank accounts worth reconciling — Asset accounts that are
    actually mapped from a PaymentMethod (a real till/bank account someone
    picks at checkout), not every Asset account in the chart (Inventory,
    Debtors, and Fixed Assets are Asset-type too, but nobody reconciles
    those against a bank statement)."""
    account_id = get_account_filter(current_user)
    query = db.query(ChartOfAccount).join(
        PaymentMethod, PaymentMethod.chart_account_id == ChartOfAccount.id
    ).filter(ChartOfAccount.account_type == LedgerAccountType.asset)
    if account_id is not None:
        query = query.filter(ChartOfAccount.account_id == account_id)
    return query.distinct().order_by(ChartOfAccount.code).all()


@router.get("/{chart_account_id}/lines", response_model=List[ReconcilableLineOut])
def list_reconcilable_lines(
    chart_account_id: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every journal line posted to this account, oldest first, with its
    current reconciled state. Returns both reconciled and unreconciled
    lines (not just the pending ones) so a past tick can be corrected if
    something was checked off in error."""
    account_id = get_account_filter(current_user)
    chart_account = db.query(ChartOfAccount).filter(ChartOfAccount.id == chart_account_id).first()
    if chart_account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account_id is not None and chart_account.account_id != account_id:
        raise HTTPException(status_code=404, detail="Account not found")

    query = db.query(JournalLine).join(JournalEntry).options(
        selectinload(JournalLine.journal_entry)
    ).filter(
        JournalLine.chart_account_id == chart_account_id,
        JournalEntry.is_voided == False,
    )
    if start_date is not None:
        query = query.filter(JournalEntry.date >= start_date)
    if end_date is not None:
        query = query.filter(JournalEntry.date <= end_date)

    lines = query.order_by(JournalEntry.date.asc(), JournalEntry.id.asc()).all()
    return [
        ReconcilableLineOut(
            line_id=l.id,
            journal_entry_id=l.journal_entry_id,
            date=l.journal_entry.date,
            description=l.description or l.journal_entry.description,
            reference=l.journal_entry.reference,
            debit=l.debit,
            credit=l.credit,
            is_reconciled=l.is_reconciled,
            reconciled_at=l.reconciled_at,
        )
        for l in lines
    ]


@router.post("/lines/{line_id}/toggle", response_model=ReconcilableLineOut)
def toggle_line_reconciled(
    line_id: int, db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_up),
):
    """Flip one line's reconciled state. Kept as its own endpoint (rather
    than a bulk save) so a tick registers immediately — matches how people
    actually work through a paper/PDF statement, one line at a time."""
    account_id = get_account_filter(current_user)
    line = db.query(JournalLine).join(JournalEntry).options(
        selectinload(JournalLine.journal_entry), selectinload(JournalLine.account)
    ).filter(JournalLine.id == line_id).first()
    if line is None:
        raise HTTPException(status_code=404, detail="Line not found")
    if account_id is not None and line.account.account_id != account_id:
        raise HTTPException(status_code=404, detail="Line not found")

    line.is_reconciled = not line.is_reconciled
    line.reconciled_at = datetime.utcnow() if line.is_reconciled else None
    db.commit()
    db.refresh(line)
    return ReconcilableLineOut(
        line_id=line.id,
        journal_entry_id=line.journal_entry_id,
        date=line.journal_entry.date,
        description=line.description or line.journal_entry.description,
        reference=line.journal_entry.reference,
        debit=line.debit,
        credit=line.credit,
        is_reconciled=line.is_reconciled,
        reconciled_at=line.reconciled_at,
    )


@router.post("/{chart_account_id}/complete", response_model=BankReconciliationOut)
def complete_reconciliation(
    chart_account_id: int, payload: BankReconciliationComplete,
    db: Session = Depends(get_db), current_user: User = Depends(require_manager_up),
):
    """Save a reconciliation snapshot: sum every currently-ticked line for
    this account (that's the book side), compare it to the statement
    balance the person typed in, and record the difference. A difference
    of 0 means clean; anything else means something's still unmatched
    (a line not yet ticked, or a bank fee/interest not yet entered as its
    own transaction) — same as balancing a checkbook by hand."""
    account_id = get_account_filter(current_user)
    chart_account = db.query(ChartOfAccount).filter(ChartOfAccount.id == chart_account_id).first()
    if chart_account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if account_id is not None and chart_account.account_id != account_id:
        raise HTTPException(status_code=404, detail="Account not found")

    reconciled_lines = db.query(JournalLine).filter(
        JournalLine.chart_account_id == chart_account_id,
        JournalLine.is_reconciled == True,
    ).all()
    total_debit = sum(l.debit for l in reconciled_lines)
    total_credit = sum(l.credit for l in reconciled_lines)
    book_balance = signed_balance(chart_account.account_type, total_debit, total_credit)
    difference = round(payload.statement_balance - book_balance, 2)

    record = BankReconciliation(
        account_id=chart_account.account_id,
        chart_account_id=chart_account_id,
        statement_date=payload.statement_date,
        statement_balance=payload.statement_balance,
        book_balance=round(book_balance, 2),
        difference=difference,
        notes=payload.notes or "",
        created_by=current_user.email,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/{chart_account_id}/history", response_model=List[BankReconciliationOut])
def reconciliation_history(
    chart_account_id: int, db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account_id = get_account_filter(current_user)
    query = db.query(BankReconciliation).filter(BankReconciliation.chart_account_id == chart_account_id)
    if account_id is not None:
        query = query.filter(BankReconciliation.account_id == account_id)
    return query.order_by(BankReconciliation.statement_date.desc()).all()
