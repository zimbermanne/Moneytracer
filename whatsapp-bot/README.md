# Moneytracer Promo Bot (WhatsApp)

Two small services that work together:

1. **`webhook_server.py`** — listens for inbound WhatsApp messages. Anyone
   who messages your business number is automatically added to
   `recipients.json` (opted in) and gets a welcome reply. Reply `STOP`
   to unsubscribe.
2. **`broadcast.py`** — sends an approved marketing message template to
   everyone in `recipients.json`, either once or on a repeating schedule.

## Why it works this way (please read before setup)

- **WhatsApp Channels have no official API in 2026.** The Telegram-style
  "post to a channel, everyone following sees it" pattern doesn't exist
  as a sanctioned Meta feature for WhatsApp. Third-party "Channel API"
  services exist, but they automate the consumer app through unofficial
  methods not affiliated with or endorsed by Meta/WhatsApp — real risk
  of the number getting banned. This bot uses Meta's actual, official
  WhatsApp Business Cloud API instead.
- **Marketing messages require a pre-approved Template.** You cannot
  send freeform promotional text to your whole list — WhatsApp requires
  businesses to submit exact wording ahead of time for approval (usually
  minutes to ~24 hours). This is why `broadcast.py` sends a *template
  name*, not free text. See `templates/*.json` for ready-made wording to
  submit.
- **Recipients must opt in.** You legally and practically can't message
  random numbers — WhatsApp will restrict/ban numbers that get flagged
  for unsolicited messages. `webhook_server.py` is what makes someone
  "opted in": they message you first (e.g. via a "Chat on WhatsApp"
  button on your website, a QR code, or your number shared anywhere),
  and that action subscribes them.

## Setup

### 1. Meta App & WhatsApp Business Platform
1. Go to [developers.facebook.com](https://developers.facebook.com),
   create an App, add the **WhatsApp** product.
2. Under **WhatsApp > API Setup** you'll see a **temporary access
   token** (valid 24h — fine for testing) and a **Phone Number ID**.
   For production, generate a **permanent token**: Business Settings >
   Users > System Users > create one > generate token with
   `whatsapp_business_messaging` permission.
3. Note the Phone Number ID — you'll need it in `.env`.

### 2. Configure
```bash
cp .env.example .env
```
Fill in `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, and pick any secret string
for `WEBHOOK_VERIFY_TOKEN` (you'll re-enter this same value in Meta's
dashboard in step 4).

### 3. Install & test locally
```bash
pip install -r requirements.txt
uvicorn webhook_server:app --reload --port 8000
```

### 4. Deploy the webhook somewhere public
Meta needs a real HTTPS URL to send webhooks to — `localhost` won't
work. Deploy `webhook_server.py` the same way as your existing
Moneytracer backend, e.g. on Railway:
1. Push this folder to a repo, deploy as a new Railway service.
2. Set the start command to:
   `uvicorn webhook_server:app --host 0.0.0.0 --port $PORT`
3. Add your `.env` values as Railway environment variables (never
   commit `.env` / your real token to git).
4. Railway gives you a public URL like `https://your-service.up.railway.app`.

### 5. Point Meta's webhook at it
In your Meta App > WhatsApp > Configuration > Webhook:
- Callback URL: `https://your-service.up.railway.app/webhook`
- Verify Token: same string as `WEBHOOK_VERIFY_TOKEN` in your `.env`
- Subscribe to the **messages** field.

Meta will immediately call your `/webhook` (GET) to verify — if
everything's configured right, it'll say "Verified" in the dashboard.

### 6. Get a template approved
1. Go to [business.facebook.com](https://business.facebook.com) >
   WhatsApp Manager > Message Templates > Create Template.
2. Category: **Marketing**.
3. Copy the wording from `templates/moneytracer_promo_intro.json` (or
   write your own) into the template body.
4. Submit. Wait for approval (check the dashboard — usually fast).
5. Once approved, set `TEMPLATE_NAME` in `.env` to match exactly.

### 7. Get people to opt in
Share your WhatsApp Business number somewhere people can message it —
a "Chat on WhatsApp" link (`https://wa.me/<your-number>`) on your
website, Instagram bio, or a QR code on a flyer/receipt. The moment
someone sends any message, they're opted in automatically.

### 8. Broadcast
```bash
python broadcast.py                # sends once, to everyone currently in recipients.json
python broadcast.py --daemon       # runs forever, re-sending every BROADCAST_INTERVAL_HOURS
```

Deploy `broadcast.py --daemon` as a second Railway background worker
service (no public URL needed, just needs to keep running) if you want
it fully automatic — same pattern as the webhook service, different
start command.

## Adding more templates

Each `templates/*.json` file is documentation for what to paste into
Meta's template editor — the JSON itself isn't submitted via API by
this bot (Meta's template creation API exists but requires extra
permissions; doing it by hand in WhatsApp Manager is simpler to start
with). Write new promo copy, get it approved under a new name, then
either change `TEMPLATE_NAME` in `.env` or extend `broadcast.py` to
rotate between several approved template names if you want variety.

## Costs

WhatsApp's Cloud API has a free tier (a set number of conversations per
month), then charges per conversation beyond that — pricing varies by
country. Check current rates at
[developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing)
before broadcasting to a large list.
