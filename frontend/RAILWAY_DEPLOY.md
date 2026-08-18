# Railway Deployment — API Configuration

## Why you see "Could not reach the server"

The frontend JS bundle calls `/api/*` using a base URL baked in at **build time**.
If `VITE_API_URL` is not set during the Railway build, the bundle uses an empty
base URL — so `/api/inventory/` resolves to the *frontend's own host*, nginx returns
`index.html`, and every API call fails with the "Could not reach the server" error.

## Fix (Railway dashboard)

1. Open your **frontend service** on Railway
2. Go to **Variables** → add a build variable:
   ```
   VITE_API_URL = https://adminwebappbackend-production.up.railway.app
   ```
   (replace with your actual backend Railway URL)
3. **Redeploy** — Railway will re-run `npm run build` with the variable baked in

## How to find your backend URL

Railway dashboard → your backend service → **Settings** → **Networking** → Public URL.

## Belt-and-suspenders: nginx proxy

The nginx template also has an `/api/` proxy block. Set:
```
BACKEND_URL = https://adminwebappbackend-production.up.railway.app
```
on the frontend service's **runtime** variables. This catches any requests that
still use relative paths (e.g. if the build env var was missed).
