# TradFi backend — production deploy

The TradFi service (`@oggregator/tradfi`) is a **persistent Fastify process** with a live
DXLink WebSocket and an in-memory store. It does **not** fit Vercel's serverless model —
it runs on the **Scaleway host**, exactly like the crypto API (`api.oggregator.xyz`).
The web SPA stays on Vercel and reaches this service over HTTPS at a subdomain.

```
app.oggregator.xyz (Vercel SPA)  ──HTTPS──▶  tradfi-api.oggregator.xyz
                                                 │ (nginx on Scaleway)
                                                 ▼
                                          127.0.0.1:3200  (ogg-tradfi.service)
```

## What is already done in this repo (local)

- `ogg-tradfi.service` — user systemd unit (this folder)
- `nginx-tradfi-api.conf` — reverse-proxy vhost (this folder)
- `.env.example` (repo root) — the required `TASTYTRADE_*` / `TRADFI_*` keys
- Honest readiness: `/health` (liveness) and `/ready` (readiness) routes; `/chains`
  returns `503` while warming up (the web client already retries 503s).

These are **templates committed to git**. An engineer applies them on the host below.

## Host steps (engineer runs on the Scaleway box)

1. **Pull the branch and install**
   ```bash
   cd ~/oggregator && git fetch && git checkout feat/tastytrade-v2-chain && git pull
   pnpm install --frozen-lockfile
   ```

2. **Put the real secrets in the repo-root `.env`** (gitignored, host-only):
   ```
   TASTYTRADE_CLIENT_ID=...
   TASTYTRADE_CLIENT_SECRET=...
   TASTYTRADE_REFRESH_TOKEN=...
   TRADFI_PORT=3200
   TRADFI_UNDERLYINGS=SPX,NDX,SPY,QQQ,AAPL,NVDA,TSLA
   ```

3. **Build (protocol → core → tradfi)**
   ```bash
   pnpm --filter @oggregator/protocol build \
     && pnpm --filter @oggregator/core build \
     && pnpm --filter @oggregator/tradfi build
   ```

4. **Install + start the service**
   ```bash
   cp packages/tradfi/deploy/ogg-tradfi.service ~/.config/systemd/user/
   # edit WorkingDirectory (and pnpm path if needed) in that file
   systemctl --user daemon-reload
   systemctl --user enable --now ogg-tradfi.service
   loginctl enable-linger "$USER"
   systemctl --user status ogg-tradfi.service     # expect: active (running)
   ```

5. **DNS** — add an `A` record `tradfi-api.oggregator.xyz` → the Scaleway box IP
   (wherever `oggregator.xyz` DNS is managed).

6. **nginx + TLS**
   ```bash
   sudo cp packages/tradfi/deploy/nginx-tradfi-api.conf /etc/nginx/sites-available/tradfi-api.oggregator.xyz
   sudo ln -s /etc/nginx/sites-available/tradfi-api.oggregator.xyz /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d tradfi-api.oggregator.xyz
   ```

7. **Vercel (web)** — set the env var on the `oggregator-web` project, then redeploy:
   ```
   VITE_TRADFI_API_BASE = https://tradfi-api.oggregator.xyz
   ```
   This both points the web at the backend **and** un-hides the TRADFI button
   (the button is gated on this var in production).

## Verify (host)

```bash
curl http://127.0.0.1:3200/health        # 200, status: ok, readiness {...}
curl -i http://127.0.0.1:3200/ready       # 503 until catalog+data, then 200
curl http://127.0.0.1:3200/underlyings    # ["SPX","NDX",...]
curl "http://127.0.0.1:3200/expiries?underlying=AAPL"
curl "http://127.0.0.1:3200/chains?underlying=AAPL&expiry=<real-expiry>"   # 200 once warm
# then externally:
curl https://tradfi-api.oggregator.xyz/ready
```

## Notes

- **Delayed data**: the connected account currently has delayed-only market data, so the
  quote token returns a `…/delayed` DXLink URL. Upgrading to real-time is a TastyTrade
  account agreement — **zero code change** (the URL is dynamic).
- **REST `/market-data/by-type` is `403`** for this account. `/chains` still tries it as a
  best-effort cold-start fallback (logged + ignored on failure); live data comes from DXLink.
- `/chains` distinguishes three states: `503 catalog not loaded`, `503 no market data yet`
  (warming up), and `200` with an empty `strikes` array (the expiry genuinely has no
  instruments). The web client retries 503 automatically.
