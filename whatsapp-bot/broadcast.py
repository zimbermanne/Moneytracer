"""
Moneytracer WhatsApp Bot — Broadcast
======================================
Sends a WhatsApp message TEMPLATE to everyone in recipients.json (built
up by webhook_server.py's opt-in handling).

IMPORTANT — why this uses templates, not freeform text:
WhatsApp does not allow businesses to send arbitrary marketing text to
someone outside a 24-hour window after they last messaged you. To reach
your whole list (most of whom messaged you once, days or weeks ago),
Meta requires you to use a pre-approved "Message Template" — a fixed
structure (with optional variable placeholders) that Meta reviews for
policy compliance before you're allowed to send it at scale. This is
Meta's rule, not a limitation of this script — trying to blast freeform
text to the whole list will simply get rejected by the API for anyone
outside the 24h window.

SETUP (one-time, per template, in Meta Business Manager):
1. Go to business.facebook.com > WhatsApp Manager > Message Templates.
2. Click "Create Template". Choose category "Marketing".
3. Write your template — see templates/*.json in this folder for the
   exact wording already prepared for you to copy in.
4. Submit for review. Approval usually takes minutes to ~24 hours.
5. Once APPROVED, use that exact template name in TEMPLATE_NAME below.

Run manually:      python broadcast.py
Run on a schedule:  python broadcast.py --daemon   (posts every
                     BROADCAST_INTERVAL_HOURS, see .env.example)
"""

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
import httpx

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("whatsapp-broadcast")

WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID", "")
GRAPH_API_VERSION = os.getenv("GRAPH_API_VERSION", "v20.0")
TEMPLATE_NAME = os.getenv("TEMPLATE_NAME", "moneytracer_promo_intro")
TEMPLATE_LANGUAGE = os.getenv("TEMPLATE_LANGUAGE", "en")
BROADCAST_INTERVAL_HOURS = float(os.getenv("BROADCAST_INTERVAL_HOURS", "168"))  # weekly by default
SEND_DELAY_SECONDS = float(os.getenv("SEND_DELAY_SECONDS", "1.0"))  # spacing between sends
RECIPIENTS_FILE = Path(__file__).parent / "recipients.json"

if not WHATSAPP_TOKEN or not PHONE_NUMBER_ID:
    raise SystemExit(
        "Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID. Copy .env.example to "
        ".env and fill both in — see README.md."
    )


def _load_recipients() -> list[str]:
    if not RECIPIENTS_FILE.exists():
        logger.warning("recipients.json doesn't exist yet — nobody has opted in via the webhook.")
        return []
    return json.loads(RECIPIENTS_FILE.read_text())


async def _send_template(client: httpx.AsyncClient, to_number: str) -> bool:
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages"
    headers = {"Authorization": f"Bearer {WHATSAPP_TOKEN}", "Content-Type": "application/json"}
    payload = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "template",
        "template": {
            "name": TEMPLATE_NAME,
            "language": {"code": TEMPLATE_LANGUAGE},
        },
    }
    resp = await client.post(url, headers=headers, json=payload, timeout=15)
    if resp.status_code >= 400:
        logger.error("Failed to send to %s: %s", to_number, resp.text)
        return False
    logger.info("Sent '%s' to %s", TEMPLATE_NAME, to_number)
    return True


async def run_broadcast():
    recipients = _load_recipients()
    if not recipients:
        logger.info("No recipients to send to. Nothing done.")
        return

    sent, failed = 0, 0
    async with httpx.AsyncClient() as client:
        for number in recipients:
            ok = await _send_template(client, number)
            sent += 1 if ok else 0
            failed += 0 if ok else 1
            await asyncio.sleep(SEND_DELAY_SECONDS)  # gentle pacing, avoids rate limits

    logger.info("Broadcast complete: %d sent, %d failed, %d total recipients.", sent, failed, len(recipients))


async def run_daemon():
    logger.info(
        "Daemon mode: broadcasting '%s' every %.1f hour(s) to whoever is in recipients.json at send time.",
        TEMPLATE_NAME, BROADCAST_INTERVAL_HOURS,
    )
    while True:
        await run_broadcast()
        await asyncio.sleep(BROADCAST_INTERVAL_HOURS * 3600)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--daemon", action="store_true", help="Run forever, broadcasting on an interval instead of once.")
    args = parser.parse_args()

    if args.daemon:
        asyncio.run(run_daemon())
    else:
        asyncio.run(run_broadcast())
