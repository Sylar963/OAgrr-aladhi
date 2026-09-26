# Security hardening and deployment

## Network boundary

The main API defaults to `HOST=127.0.0.1` and TradFi defaults to
`TRADFI_HOST=127.0.0.1`. The local Caddy configuration proxies to these
loopback addresses. Restart rebuilt services to activate these defaults.

The Docker image explicitly sets `HOST=0.0.0.0` for container networking.
Publish it on loopback when the reverse proxy runs on the host:
`-p 127.0.0.1:3100:3100`. Do not publish backend ports to the internet.

The main API trusts only `127.0.0.1` and `::1` as proxies by default.
For a container proxy, set `TRUSTED_PROXIES` to its exact IP or narrowly
scoped CIDR. Never trust all peers or accept client-supplied forwarding
headers at the edge. Caddy must preserve the actual client as the nearest
untrusted address in the forwarding chain.

## Browser origins and headers

Production API CORS allows the three explicit Oggregator frontend origins.
Add individual preview origins with comma-separated `CORS_ALLOWED_ORIGINS`;
wildcards are rejected. WebSocket upgrades with a supplied Origin header
use the same allowlist. Non-browser clients without Origin still require
tickets for private sockets.

The API-served SPA and Vercel SPA enforce `object-src 'none'`,
`base-uri 'self'`, and `frame-ancestors 'none'`. A broader CSP runs in
report-only mode. Review browser console violations while signing in,
opening Plotly charts and using analytics before promoting it to enforcement.
Report-only directives do not block script execution; there is no report
collector configured yet. Add only the specific required sources.

## Abuse limits and sessions

The main API limits requests to 600/minute per resolved client IP. Lead
capture allows 5/hour, and authentication routes allow 60/minute. Existing
stricter route limits remain in force. Limits are process-local; use shared
rate-limit storage and shared revocation messaging before running replicas.

The four main API WebSocket endpoints allow 20 connections/IP and 1,000
total connections, 20 incoming messages/second, and 64 KiB incoming frames.
Heartbeat and buffered-output checks disconnect dead or slow clients.

Private sockets expire after five minutes. Clients reconnect with fresh
single-use tickets. Logout invalidates unused tickets and terminates all
private sockets for that user on this process, including other tabs.
External identity-provider revocation is picked up on reauthentication;
it is not an instantaneous remote revocation webhook. A stolen valid JWT
must also be revoked with the identity provider.

Request logging omits query strings so WebSocket tickets are not logged
by Fastify. Independently ensure proxy and hosting access logs redact them.

## Dependency maintenance and verification

Run both `pnpm audit` and `pnpm audit --prod`: the production-only audit
does not cover vulnerable build/test tools. Patched transitive versions are
managed with `pnpm.overrides` in the root package manifest. Keep the lockfile
committed; run `pnpm install` whenever manifests change.

Before deployment, run `pnpm precommit` and the web production build.
After restart, verify `ss -ltn` shows loopback backend listeners, and check
the public health endpoint, sign-in, portfolio/paper reconnects, lead
submission and the 3D surface. Frontend headers require a Vercel deployment.
These controls address the reviewed findings; they are not a guarantee
that the application has no vulnerabilities.
