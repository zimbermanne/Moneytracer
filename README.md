# Moneytracer — Docker setup

Drop these files into your repo like this:

```
moneytracer/
├── backend/
│   ├── Dockerfile        <- from here
│   ├── requirements.txt  <- already in your repo
│   └── app/...           <- already in your repo
├── frontend/
│   ├── Dockerfile        <- from here
│   ├── nginx.conf        <- from here
│   ├── package.json      <- already in your repo
│   └── src/...           <- already in your repo
├── docker-compose.yml    <- from here
├── init-schemas.sql      <- from here
└── .env                  <- copy from .env.example, fill in real values
```

If your backend/frontend folders are named differently, adjust the `build:`
paths in `docker-compose.yml` to match.

## First run

```bash
cp .env.example .env
# edit .env and set a real DB_PASSWORD (and any other backend secrets)

docker compose up --build
```

- Frontend: http://localhost
- Backend API (direct): http://localhost:8000
- Postgres: localhost:5432 (schemas `business`, `community`, `personal` are
  created automatically on first boot via init-schemas.sql)

## Running migrations

If you use Alembic, run it as a one-off after the containers are up:

```bash
docker compose run backend alembic upgrade head
```

## Notes specific to your app

- **httpOnly cookie auth**: since the frontend nginx proxies `/api/` to the
  backend, both are served from the same origin (`http://localhost`) in this
  setup, which avoids cross-origin cookie issues. If you call the backend
  directly from the frontend JS instead of through the `/api/` proxy, update
  your API base URL and CORS/cookie settings accordingly.
- **PORT**: the backend Dockerfile hardcodes port 8000 rather than relying on
  Railway's injected `$PORT`, which avoids the dynamic-PORT crash you hit
  before.
- **APScheduler reminders**: these run in-process with the API here. If you
  want them isolated from web traffic, add a second service in
  `docker-compose.yml` using the same backend image with a different `CMD`
  (e.g. `celery`/scheduler entrypoint instead of `uvicorn`).
- **Production**: for anything beyond local dev, put a real TLS-terminating
  reverse proxy (Caddy, Traefik, or nginx with certs) in front of this stack,
  and don't expose the Postgres port publicly.
