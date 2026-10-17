# ogg-exec deployment (operator, needs root)

The daemon runs as its own Unix user so the API process (user `teal`) can never read trading
keys. It runs from a root-owned copy under `/opt`, not from the repo in `/home`: if it ran from
the repo, anyone able to edit the source could change what the key holder runs.

Spec: `docs/superpowers/specs/2026-10-17-live-l0-security-foundation-design.md` §4 (O1-O7).

## O1 - user, group, dirs

```bash
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin ogg-exec
sudo groupadd --system ogg-exec-clients
sudo usermod -aG ogg-exec-clients ogg-exec
sudo usermod -aG ogg-exec-clients teal          # API user; re-login or restart user services after
sudo install -d -o root -g root -m 0755 /opt/ogg-exec
sudo install -d -o root -g ogg-exec -m 0750 /etc/ogg-exec
```

Two groups on purpose: `ogg-exec-clients` (teal + daemon) may only reach the socket; `ogg-exec`
(daemon only) may read `/etc/ogg-exec`. Putting teal in the second would hand the API user the
key-encryption key.

`/var/lib/ogg-exec` (0700) and `/run/ogg-exec` (0750) are created by systemd from the unit.

## O2 - Node and the app

Node must be ≥ 22.13 (`node:sqlite` without a flag) and outside `/home` (`ProtectHome=yes`).

```bash
# Node: copy a release build (same major as production) to /opt/ogg-exec/node
sudo tar -xJf node-v22.21.0-linux-x64.tar.xz -C /opt/ogg-exec
sudo mv /opt/ogg-exec/node-v22.21.0-linux-x64 /opt/ogg-exec/node

# App: build, then deploy an isolated copy with production deps only
pnpm --filter @oggregator/protocol build && pnpm --filter @oggregator/execution build
pnpm --filter @oggregator/execution --prod deploy --legacy /tmp/ogg-exec-app
sudo rm -rf /opt/ogg-exec/app && sudo mv /tmp/ogg-exec-app /opt/ogg-exec/app
sudo chown -R root:root /opt/ogg-exec

sudo install -o root -g root -m 0644 packages/execution/deploy/ogg-exec.service \
  /etc/systemd/system/ogg-exec.service
sudo systemctl daemon-reload
```

Redeploy = rebuild + replace `/opt/ogg-exec/app` + `sudo systemctl restart ogg-exec`. The daemon
is **not** on the hourly restart timer, and a restart comes back disarmed (a kill stays latched).

## O3 - Thalex key

In the Thalex UI, on the **testnet** subaccount first:

- permissions: view + trade on that subaccount only; **withdraw off**
- IP whitelist: `51.15.19.220`
- notifications on (for `margin_call` / `liquidation`)

Save the PEM to a file readable by `ogg-exec` only, import it (O7), then delete the file.

## O4 - Clerk

Session token v2 enabled; MFA enabled on the operator account (step-up needs a second factor).

## O5 - alert channels

- Telegram: create a bot with @BotFather, send it one message, read the chat id. The daemon only
  calls `sendMessage`; it never reads updates.
- Resend: API key with `sending_access`, restricted to the alert domain (`domain_id`).

## O6 - entitlement

```sql
INSERT INTO user_entitlements (user_id, feature_key, status, granted_by)
VALUES ('<users.id of the operator>', 'live_trading', 'enabled', 'operator');
```

## O7 - configuration

`/etc/ogg-exec/env` (root:ogg-exec, 0640 - **not** readable by teal):

```bash
EXECUTION_SOCKET_HMAC_KEY=<openssl rand -hex 32>   # same value in the API's .env
EXECUTION_KEY_ENCRYPTION_KEY=<openssl rand -hex 32> # daemon only; never in the API's .env
EXECUTION_KEY_ID=k1
LIVE_ALERT_TELEGRAM_BOT_TOKEN=...
LIVE_ALERT_TELEGRAM_CHAT_ID=...
LIVE_ALERT_RESEND_API_KEY=re_...
LIVE_ALERT_EMAIL_FROM=alerts@<your domain>
LIVE_ALERT_EMAIL_TO=<you>
```

API `.env` (mode 0600):

```bash
LIVE_TRADING_ENABLED=true
EXECUTION_SOCKET_PATH=/run/ogg-exec/exec.sock
EXECUTION_SOCKET_HMAC_KEY=<same as above>
```

Start, then import the key:

```bash
sudo systemctl enable --now ogg-exec
journalctl -u ogg-exec -f        # expect "execution daemon listening" + a Telegram and an email test

sudo -u ogg-exec bash -c 'set -a; . /etc/ogg-exec/env
  EXECUTION_STATE_DIR=/var/lib/ogg-exec; EXECUTION_SOCKET_PATH=/run/ogg-exec/exec.sock; set +a
  cd /opt/ogg-exec/app && exec /opt/ogg-exec/node/bin/node dist/cli/keys-import.js'
```

## Exit check

1. `GET /api/live/status` → `keyBound: true`, `alerts.testDelivered: true`, `journal.chainOk: true`.
2. `POST /api/live/kill` → Telegram + email arrive; `state: killed`.
3. Restart `ogg-exec` → still `killed`. `POST /api/live/reset` (asks for step-up) → `disarmed`.
