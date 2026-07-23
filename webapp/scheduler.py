"""Background CRON workflows.

Currently: a daily job that finds invoices past their due_date and still
unpaid, and sends a reminder for each one — email if SMTP is configured for
the tenant, and always an in-app Reminder + ActivityLog entry (the
WhatsApp-reminder placeholder: wiring an actual WhatsApp Business API call
is a follow-up, but every overdue invoice gets *some* surfaced reminder
either way, so nothing silently goes unnoticed).

Runs once at startup (so a redeploy doesn't wait a full day for the first
pass) and then every 24h via APScheduler's BackgroundScheduler, which runs
in-process — fine for a single-instance deploy; if this API ever scales to
multiple instances, this job needs to move to a distinct worker/leader-only
process, or every instance will send duplicate reminders.
"""
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler

from database import SessionLocal
from models import (
    Invoice, DocumentStatus, Account, ActivityLog, Reminder,
    ComplianceDeadline, DeadlineRecurrence, BankLoan, LoanStatus,
)
from activity import log_activity
import email_utils

_REMINDER_ACTION = "invoice_reminder_sent"
_DEADLINE_REMINDER_ACTION = "deadline_reminder_sent"
_LOAN_REMINDER_ACTION = "loan_reminder_sent"


def _already_reminded_today(db, invoice_id: int) -> bool:
    since = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.action == _REMINDER_ACTION,
            ActivityLog.details.like(f"%invoice_id={invoice_id}%"),
            ActivityLog.created_at >= since,
        )
        .first()
        is not None
    )


def send_overdue_invoice_reminders():
    """The actual job body — kept as a standalone function so it can also be
    called directly (e.g. from a manual /api/reminders/run-now endpoint or a
    test), not just from the scheduler."""
    db = SessionLocal()
    try:
        log_activity(db, username="system", action="scheduler_heartbeat",
                     details="overdue_invoice_reminders run started", account_id=None)

        now = datetime.utcnow()
        overdue = (
            db.query(Invoice)
            .filter(
                Invoice.due_date.isnot(None),
                Invoice.due_date < now,
                Invoice.status.in_([DocumentStatus.sent, DocumentStatus.draft]),
            )
            .all()
        )

        for invoice in overdue:
            if _already_reminded_today(db, invoice.id):
                continue

            days_overdue = (now - invoice.due_date).days
            account = db.query(Account).filter(Account.id == invoice.account_id).first()
            message = (
                f"Invoice {invoice.invoice_no} for {invoice.customer_name} "
                f"({invoice.total:.2f}) is {days_overdue} day(s) overdue."
            )

            # In-app reminder — always created, regardless of email config.
            db.add(Reminder(
                account_id=invoice.account_id,
                created_by="system",
                text=message,
                due_at=now,
            ))

            # Email the account owner if SMTP is configured. Best-effort: a
            # missing/failed SMTP config must never stop the in-app reminder
            # or the audit trail from being written.
            if email_utils.is_configured() and account and account.email:
                try:
                    email_utils.send_plain_email(
                        to_email=account.email,
                        subject=f"Overdue invoice {invoice.invoice_no}",
                        body=message + "\n\nThis is an automated reminder from Moneytracer.",
                    )
                except Exception as e:
                    log_activity(
                        db, username="system", action="CRITICAL: invoice_reminder_email_failed",
                        details=f"invoice_id={invoice.id} {e}", account_id=invoice.account_id,
                    )

            log_activity(
                db, username="system", action=_REMINDER_ACTION,
                details=f"invoice_id={invoice.id} {message}",
                account_id=invoice.account_id,
            )

        db.commit()
    finally:
        db.close()


def _already_reminded_today_for(db, action: str, marker: str) -> bool:
    since = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(ActivityLog)
        .filter(ActivityLog.action == action, ActivityLog.details.like(f"%{marker}%"),
                ActivityLog.created_at >= since)
        .first()
        is not None
    )


def _add_months(d: datetime, months: int) -> datetime:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, 28)
    return d.replace(year=year, month=month, day=day)


def send_compliance_deadline_reminders():
    """TRA PAYE/SDL/VAT, BRELA annual fee, business name renewal, NSSF/WCF/
    OSHA, or a custom recurring obligation. Alert windows per the spec:
    monthly/once -> 7 and 1 days before; yearly -> 30/14/7/1 days before.
    Once a recurring deadline's date has passed, it rolls forward
    automatically (monthly -> +1 month, yearly -> +1 year) rather than
    nagging forever about a date that's already gone."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        today = now.date()
        thresholds = {
            DeadlineRecurrence.monthly: {7, 1},
            DeadlineRecurrence.once: {7, 1},
            DeadlineRecurrence.yearly: {30, 14, 7, 1},
        }

        deadlines = db.query(ComplianceDeadline).filter(ComplianceDeadline.is_active.is_(True)).all()
        for d in deadlines:
            days_until = (d.due_date.date() - today).days
            marker = f"deadline_id={d.id}:{today.isoformat()}"

            if (days_until in thresholds.get(d.recurrence, set()) or days_until < 0) and \
               not _already_reminded_today_for(db, _DEADLINE_REMINDER_ACTION, f"deadline_id={d.id}"):
                when = f"in {days_until} day(s)" if days_until >= 0 else f"{-days_until} day(s) overdue"
                message = f"{d.label} is due {when} ({d.due_date.date().isoformat()})."
                db.add(Reminder(account_id=d.account_id, created_by="system", text=message, due_at=now))
                log_activity(db, username="system", action=_DEADLINE_REMINDER_ACTION,
                             details=f"deadline_id={d.id} {message}", account_id=d.account_id)

            # Roll a recurring deadline forward once it's clearly past (a
            # day of grace so the "overdue" reminder above still fires at
            # least once before it moves on).
            if days_until < -1 and d.recurrence != DeadlineRecurrence.once:
                d.due_date = _add_months(d.due_date, 1 if d.recurrence == DeadlineRecurrence.monthly else 12)
                log_activity(db, username="system", action="deadline_rolled_forward",
                             details=f"deadline_id={d.id} new_due_date={d.due_date.date().isoformat()}",
                             account_id=d.account_id)

        db.commit()
    finally:
        db.close()


def send_loan_payment_reminders():
    """Bank loan repayment reminders: 7 days, 1 day before, and overdue —
    based on due_day_of_month for the current calendar month. Skips loans
    that are already closed/defaulted or already fully repaid."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        today = now.date()

        loans = db.query(BankLoan).filter(BankLoan.status == LoanStatus.active).all()
        for loan in loans:
            try:
                this_month_due = today.replace(day=loan.due_day_of_month)
            except ValueError:
                continue  # invalid day for this month (shouldn't happen, due_day capped at 28)

            days_until = (this_month_due - today).days
            if days_until not in (7, 1) and days_until >= 0:
                continue
            if days_until < -14:
                continue  # long overdue — already nagged plenty this cycle, don't nag forever

            if _already_reminded_today_for(db, _LOAN_REMINDER_ACTION, f"loan_id={loan.id}"):
                continue

            when = f"in {days_until} day(s)" if days_until >= 0 else f"{-days_until} day(s) overdue"
            message = f"Payment to {loan.lender_name} is due {when} ({this_month_due.isoformat()})."
            db.add(Reminder(account_id=loan.account_id, created_by="system", text=message, due_at=now))
            log_activity(db, username="system", action=_LOAN_REMINDER_ACTION,
                         details=f"loan_id={loan.id} {message}", account_id=loan.account_id)

        db.commit()
    finally:
        db.close()


_scheduler = None


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        send_overdue_invoice_reminders,
        "interval", hours=24,
        id="overdue_invoice_reminders",
        next_run_time=datetime.utcnow() + timedelta(seconds=30),  # first pass shortly after boot, not at import time
        coalesce=True, max_instances=1,
    )
    _scheduler.add_job(
        send_compliance_deadline_reminders,
        "interval", hours=24,
        id="compliance_deadline_reminders",
        next_run_time=datetime.utcnow() + timedelta(seconds=45),
        coalesce=True, max_instances=1,
    )
    _scheduler.add_job(
        send_loan_payment_reminders,
        "interval", hours=24,
        id="loan_payment_reminders",
        next_run_time=datetime.utcnow() + timedelta(seconds=60),
        coalesce=True, max_instances=1,
    )
    _scheduler.start()
    return _scheduler
