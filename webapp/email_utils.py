"""Small SMTP helper used to email invoice/quotation PDFs to customers.

Configure via environment variables:
  SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD,
  SMTP_FROM (defaults to SMTP_USER), SMTP_USE_TLS (default "true")

If SMTP_HOST/SMTP_USER/SMTP_PASSWORD aren't set, send_email_with_attachment
raises a RuntimeError with a clear message — callers turn that into a 400.
"""
import os
import smtplib
import logging
from email.message import EmailMessage

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
# Use TLS if port is 587 or if explicitly set to true.
# Use SSL if port is 465 or if explicitly set to false but port is 465.
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() != "false"


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _get_smtp_server():
    """Helper to return the right SMTP or SMTP_SSL instance based on port/config."""
    if SMTP_PORT == 465:
        return smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20)
    return smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)


def send_email_with_attachment(to_email: str, subject: str, body: str,
                                attachment_bytes: bytes, attachment_filename: str):
    if not is_configured():
        raise RuntimeError(
            "Email sending isn't configured yet. Set SMTP_HOST, SMTP_USER and "
            "SMTP_PASSWORD (and optionally SMTP_PORT, SMTP_FROM) on the backend."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)
    msg.add_attachment(attachment_bytes, maintype="application", subtype="pdf",
                        filename=attachment_filename)

    try:
        with _get_smtp_server() as server:
            if SMTP_PORT != 465 and SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        raise RuntimeError(f"SMTP Error: {str(e)}")


def send_plain_email(to_email: str, subject: str, body: str):
    """Like send_email_with_attachment, but for notifications (e.g. overdue
    invoice reminders) that have no PDF to attach."""
    if not is_configured():
        raise RuntimeError(
            "Email sending isn't configured yet. Set SMTP_HOST, SMTP_USER and "
            "SMTP_PASSWORD (and optionally SMTP_PORT, SMTP_FROM) on the backend."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)

    try:
        with _get_smtp_server() as server:
            if SMTP_PORT != 465 and SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        logger.error(f"Failed to send plain email to {to_email}: {e}")
        raise RuntimeError(f"SMTP Error: {str(e)}")
