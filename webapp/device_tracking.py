"""Best-effort IP / geolocation / device capture for the superadmin console.

Records where users log in from and what device/browser/OS they use, so the
superadmin panel can show real usage patterns (mobile vs desktop split,
which browsers to prioritize testing on, which countries/regions have the
slowest logins, etc.) to guide where to spend optimization effort.

Hard rule: nothing in this module may ever raise out of record_login_session()
or slow login down noticeably. Geolocation is a single short-timeout HTTP
call to a free IP-lookup API; if it's slow, blocked by network policy, or
errors, we still record the IP/device info we already have and move on with
empty location fields. Login must never fail or hang because of this.
"""
import json
import re
import socket
import urllib.request
from urllib.error import URLError

from sqlalchemy.orm import Session

from models import LoginSession, User

_GEO_TIMEOUT_SECONDS = 1.5
# Free, no-API-key IP geolocation lookup. Only called for public IPs (see
# _is_private_ip) — never for localhost/dev traffic.
_GEO_URL = "http://ip-api.com/json/{ip}?fields=status,city,regionName,country,isp"


def get_client_ip(request) -> str:
    """Best guess at the real client IP. Railway (like most PaaS) terminates
    TLS at a proxy, so request.client.host is the proxy's IP, not the
    user's — the real IP arrives in X-Forwarded-For, leftmost entry."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""


def _is_private_ip(ip: str) -> bool:
    if not ip:
        return True
    try:
        packed = socket.inet_aton(ip)
        first = packed[0]
        second = packed[1]
    except OSError:
        return True  # not a valid IPv4 (e.g. IPv6, or garbage) — skip lookup
    if first == 10:
        return True
    if first == 172 and 16 <= second <= 31:
        return True
    if first == 192 and second == 168:
        return True
    if first == 127:
        return True
    return False


def geolocate_ip(ip: str) -> dict:
    """Returns {"city", "region", "country", "isp"} — all "" on any failure
    or for private/local IPs. Never raises."""
    empty = {"city": "", "region": "", "country": "", "isp": ""}
    if _is_private_ip(ip):
        return empty
    try:
        with urllib.request.urlopen(_GEO_URL.format(ip=ip), timeout=_GEO_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") != "success":
            return empty
        return {
            "city": data.get("city") or "",
            "region": data.get("regionName") or "",
            "country": data.get("country") or "",
            "isp": data.get("isp") or "",
        }
    except (URLError, TimeoutError, socket.timeout, ValueError, OSError):
        return empty


# Lightweight User-Agent parsing — deliberately not a full library (no new
# dependency): good enough to bucket by device/OS/browser for optimization
# purposes, not meant to be forensically precise.
_OS_PATTERNS = [
    (re.compile(r"Windows NT 10\.0"), "Windows 10/11"),
    (re.compile(r"Windows NT 6\.3"), "Windows 8.1"),
    (re.compile(r"Windows NT 6\.1"), "Windows 7"),
    (re.compile(r"Windows"), "Windows (other)"),
    (re.compile(r"Android (\d+(?:\.\d+)?)"), "Android {0}"),
    (re.compile(r"iPhone OS (\d+)_(\d+)"), "iOS {0}.{1}"),
    (re.compile(r"iPad.*OS (\d+)_(\d+)"), "iPadOS {0}.{1}"),
    (re.compile(r"Mac OS X (\d+)[._](\d+)"), "macOS {0}.{1}"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Linux"), "Linux"),
]

_BROWSER_PATTERNS = [
    (re.compile(r"Edg/(\d+)"), "Edge {0}"),
    (re.compile(r"OPR/(\d+)"), "Opera {0}"),
    (re.compile(r"CriOS/(\d+)"), "Chrome (iOS) {0}"),
    (re.compile(r"FxiOS/(\d+)"), "Firefox (iOS) {0}"),
    (re.compile(r"Chrome/(\d+)"), "Chrome {0}"),
    (re.compile(r"Firefox/(\d+)"), "Firefox {0}"),
    (re.compile(r"Version/(\d+).*Safari"), "Safari {0}"),
    (re.compile(r"MSIE (\d+)"), "Internet Explorer {0}"),
    (re.compile(r"Trident/.*rv:(\d+)"), "Internet Explorer {0}"),
]

_BOT_RE = re.compile(r"bot|crawler|spider|curl|python-requests|axios|postman", re.IGNORECASE)


def parse_user_agent(ua: str) -> dict:
    """Returns {"device_type", "os", "browser"} from a raw User-Agent string.
    Best-effort/heuristic — never raises."""
    ua = ua or ""
    if not ua.strip():
        return {"device_type": "unknown", "os": "", "browser": ""}
    if _BOT_RE.search(ua):
        return {"device_type": "bot", "os": "", "browser": ""}

    os_name = ""
    for pattern, label in _OS_PATTERNS:
        m = pattern.search(ua)
        if m:
            try:
                os_name = label.format(*m.groups())
            except (IndexError, KeyError):
                os_name = label
            break

    browser = ""
    for pattern, label in _BROWSER_PATTERNS:
        m = pattern.search(ua)
        if m:
            try:
                browser = label.format(*m.groups())
            except (IndexError, KeyError):
                browser = label
            break

    if "iPad" in ua or ("Android" in ua and "Mobile" not in ua and "Tablet" in ua):
        device_type = "tablet"
    elif "Mobi" in ua or "iPhone" in ua or ("Android" in ua and "Mobile" in ua):
        device_type = "mobile"
    else:
        device_type = "desktop"

    return {"device_type": device_type, "os": os_name, "browser": browser}


def record_login_session(db: Session, user: User, request, event: str = "login") -> None:
    """Best-effort — swallow ALL exceptions so a tracking hiccup can never
    break login. Call this after authentication succeeds, before returning
    the token."""
    try:
        ip = get_client_ip(request)
        ua = request.headers.get("user-agent", "")
        device = parse_user_agent(ua)
        geo = geolocate_ip(ip)

        entry = LoginSession(
            user_id=getattr(user, "id", None),
            account_id=getattr(user, "account_id", None),
            username=getattr(user, "username", ""),
            ip_address=ip,
            city=geo["city"],
            region=geo["region"],
            country=geo["country"],
            isp=geo["isp"],
            device_type=device["device_type"],
            os=device["os"],
            browser=device["browser"],
            user_agent=ua,
            event=event,
        )
        db.add(entry)
        db.commit()
    except Exception:
        # Never let telemetry break login. If commit half-happened, roll
        # back so it doesn't poison the caller's session for the real work
        # (issuing the token / logging activity) still to come.
        try:
            db.rollback()
        except Exception:
            pass
