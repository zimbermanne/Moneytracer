"""
Moneytracer WhatsApp Bot — Webhook & Opt-In Handler
=====================================================
This is the piece that makes the broadcast bot (broadcast.py) legal and
compliant: WhatsApp requires recipients to have opted in before you send
them marketing messages. This webhook listens for inbound WhatsApp
messages and treats ANY inbound message as an opt-in (adds the sender's
number to recipients.json) — the same pattern as Telegram's /start:
someone messages your business number, they're now subscribed to
updates, and you reply with a confirmation.

This also matters for a second reason: receiving a message from someone
opens a 24-hour "customer service window" during which you can send them
freeform text (not just approved templates). So this webhook is also
what unlocks normal replies, not just the opt-in bookkeeping.

SETUP (Meta side — you do this once in Meta Business Manager / developers.facebook.com):
1. Create a Meta App -> add "WhatsApp" product.
2. Under WhatsApp > API Setup, get a temporary token (or generate a
   permanent one via System User in Business Settings for production).
3. Note your Phone Number ID (shown in API Setup).
4. Deploy this webhook somewhere with a public HTTPS URL (Railway works
   well — see README.md).
5. In Meta App > WhatsApp > Configuration > Webhook, set:
   - Callback URL: https://your-deployed-url.com/webhook
   - Verify Token: whatever you set as WEBHOOK_VERIFY_TOKEN in .env
   - Subscribe to the "messages" field.

Run with: uvicorn webhook_server:app --host 0.0.0.0 --port 8000
"""

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
import httpx

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("whatsapp-webhook")

VERIFY_TOKEN = os.getenv("WEBHOOK_VERIFY_TOKEN", "")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID", "")
GRAPH_API_VERSION = os.getenv("GRAPH_API_VERSION", "v20.0")
RECIPIENTS_FILE = Path(__file__).parent / "recipients.json"

app = FastAPI(title="Moneytracer WhatsApp Bot Webhook")


def _load_recipients() -> list[str]:
    if not RECIPIENTS_FILE.exists():
        return []
    return json.loads(RECIPIENTS_FILE.read_text())


def _save_recipients(numbers: list[str]):
    RECIPIENTS_FILE.write_text(json.dumps(sorted(set(numbers)), indent=2))


async def _send_freeform_reply(to_number: str, text: str):
    """Freeform (non-template) reply — only works within the 24h window
    that opens after the person messages you, which is exactly the
    situation we're in here (we're replying to their inbound message)."""
    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages"
    headers = {"Authorization": f"Bearer {WHATSAPP_TOKEN}", "Content-Type": "application/json"}
    payload = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "text",
        "text": {"body": text},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            logger.error("Failed to send reply to %s: %s", to_number, resp.text)
        else:
            logger.info("Replied to %s", to_number)


@app.get("/webhook")
async def verify_webhook(request: Request):
    """Meta calls this once when you save the webhook config, to confirm
    you control this URL."""
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == VERIFY_TOKEN:
        challenge = params.get("hub.challenge", "")
        logger.info("Webhook verified successfully.")
        return Response(content=challenge, media_type="text/plain")
    logger.warning("Webhook verification failed — check WEBHOOK_VERIFY_TOKEN matches Meta config.")
    return Response(status_code=403)


@app.post("/webhook")
async def receive_webhook(request: Request):
    """Handles inbound messages. Every distinct sender is treated as an
    opt-in for future broadcast messages, and gets a one-time welcome
    reply. Duplicate opt-ins from the same number are silently ignored
    (no repeat welcome spam)."""
    body = await request.json()

    try:
        entry = body.get("entry", [])[0]
        change = entry.get("changes", [])[0]
        value = change.get("value", {})
        messages = value.get("messages", [])
    except (IndexError, KeyError):
        return Response(status_code=200)  # not a message event (e.g. a status update) — ignore

    if not messages:
        return Response(status_code=200)

    recipients = _load_recipients()

    for msg in messages:
        sender = msg.get("from")
        if not sender:
            continue

        is_new = sender not in recipients
        if is_new:
            recipients.append(sender)
            logger.info("New opt-in: %s", sender)

        # Always send a reply so the sender knows the bot is alive, but
        # only the FIRST message is the "welcome" — repeat messages get
        # a short acknowledgement instead of the full pitch again.
        if is_new:
            await _send_freeform_reply(
                sender,
                "👋 Thanks for reaching out to Moneytracer!\n\n"
                "You're now subscribed to occasional updates about new "
                "features. Reply STOP anytime to unsubscribe.\n\n"
                "Track sales, inventory, invoices & expenses — all from "
                "your phone: https://moneytracer.up.railway.app"
            )
        elif msg.get("text", {}).get("body", "").strip().upper() == "STOP":
            if sender in recipients:
                recipients.remove(sender)
                logger.info("Unsubscribed: %s", sender)
            await _send_freeform_reply(sender, "You've been unsubscribed. Reply anytime to opt back in.")
        else:
            await _send_freeform_reply(sender, "Thanks for your message! 🙌 Type STOP anytime to unsubscribe from updates.")

    _save_recipients(recipients)
    return Response(status_code=200)


@app.get("/")
def health():
    return {"status": "ok", "recipients_count": len(_load_recipients())}
