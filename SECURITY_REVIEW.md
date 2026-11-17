# Security and enterprise readiness review

Reviewed: 2026-11-17. Source revision: `a5ec92cf`.

Assessment: the repository has a substantial security foundation, but enterprise readiness is not yet demonstrated. The largest gaps are inconsistent protection across services, release reproducibility, recovery evidence, and operational accountability. Preserve the existing runtime-first architecture and Alpha workspace while closing these gaps.

This is a source and local verification review, not a production penetration test. Hosting settings, branch protections, database-provider backups, identity-provider policies, and live reverse-proxy configuration were not verified. An item marked “not evidenced” means that evidence was not found in the reviewed repository; it does not prove the control is absent elsewhere.

## Priority findings

P1 means address before an enterprise rollout. P2 means planned hardening or a gate before the affected capability is enabled. These are implementation priorities, not CVSS scores.

| ID | Priority | Finding | Evidence and consequence | Required outcome |
| --- | --- | --- | --- | --- |
| SEC-01 | P1 | Production and full dependency audits are not clean | Production audit reports 24 findings: 8 high, 11 moderate, 5 low, 0 critical. The approved full audit reports 57: 16 high, 31 moderate, 10 low, 0 critical. Additional development paths include Undici, Vite, Vitest mocker, and fast-copy. Reachability varies. | Triage each affected deployment and development tool, patch compatible versions, record justified exceptions with owners and expiry dates, and automate both audits. |
| SEC-02 | P1 | TradFi lacks the main API's abuse protections | `packages/tradfi/src/app.ts:43` reflects arbitrary CORS origins, disables request logging, and registers WebSockets without the main service's explicit limits or origin gate. `routes/ws-chain.ts:43` creates a per-client subscription/pusher and serializes a chain every 200 ms. No heartbeat, output-buffer cap, or connection cap is applied there. | Apply a shared policy with exact origins, trusted proxies, request limits, bounded subscriptions, connection caps, heartbeat, and slow-client disconnection. Verify through the actual proxy. |
| SEC-03 | P1 | Main app script CSP remains report-only | `packages/server/src/app.ts:172` and root `vercel.json` enforce only object/base/frame restrictions. `script-src` and `connect-src` are report-only. This is a missing mitigation, not proof of an XSS vulnerability. | Exercise Clerk, wallet, charts, popouts, and analytics under a candidate policy; review reports and enforce the tested script/connect policy on both serving paths. |
| OPS-01 | P1 | Docker deployment does not describe a complete server artifact | `Dockerfile:10` and `:28` omit `@oggregator/trading` and `@oggregator/funded` manifests before workspace installation. Both are server dependencies. Their build filters and runtime `dist` copies are also absent. The ingest Dockerfile repeats the manifest omission. | A clean checkout must build images using the frozen lockfile and start using only packaged artifacts. Add build/start/readiness smoke checks to the release gate. |
| OPS-02 | P1 release gate | Recovery has no reviewed proof | No backup/restore automation or completed recovery drill was found among reviewed tracked operational files. Local NDJSON/SQLite state and credential encryption keys require explicit recovery treatment alongside Postgres. | Inventory authoritative data; verify provider backup retention/PITR; keep encrypted off-host copies where needed; restore to an isolated environment and measure data loss and elapsed time. |
| OPS-03 | P1 release gate | Automated release enforcement is not evidenced | No tracked GitHub Actions, GitLab, CircleCI, Jenkins, Azure, or Bitbucket pipeline was found. `pnpm precommit` exists, but a script alone does not prove protected merges or deployments. | Require CI checks and review; build once, identify artifacts by commit/digest, smoke-test staging, and exercise rollback. Verify remote branch protections separately. |
| SEC-04 | P2; before replicas | Revocation, tickets, limits, and leases assume one process | `websocket-ticket-service.ts`, `websocket-security.ts`, `live-auth.ts`, and `portfolio-assistant-usage-limiter.ts` retain security/concurrency state in memory. `paper/auth.ts:50` closes local sockets and venue sessions but adds no REST JWT denylist. The hardening document acknowledges delayed IdP revocation. | Document the current single-instance boundary. Before replicas, use atomic shared ticket consumption, shared limits, session revocation events, and distributed assistant leases. Test revocation across two instances. |
| DATA-01 | P2 | Alpha's top-level context does not carry source freshness consistently | `routes/alpha-market-context.ts:38` checks service initialization; `:74` accepts a cached spot or last daily close. `alpha-market-context.ts:190` stamps the response with the current generation time, while top-level source flags describe presence. The `automatic` evaluator separately receives an IV timestamp; that does not establish freshness for every top-level field. | Add source timestamps, stale thresholds, coverage, and fallback provenance to the existing response/UI. Test stale-present data explicitly. Preserve existing controls and distinguish modeled assessments from observed prices. |
| OPS-04 | P2 | Database failure is outside readiness checks | `readiness.ts:4` checks bootstrap/spot/flow/block flow; `/api/ready` checks feed liveness. Production config checks only the presence of `DATABASE_URL`, not database availability or migration compatibility. | Expose separate market-data and private/persistence capability status. Probe critical dependencies with bounded, cached checks; verify schema compatibility during deployment. Keep market-data availability independent when appropriate. |
| SEC-05 | P2 | Security audit history is not demonstrated | Credential changes use ordinary request/error logs; no dedicated durable security-event pipeline or audit schema was found for credential replacement/deletion, entitlement changes, or session termination. Market ledgers and assistant tool metrics serve different purposes. | Record actor, action, resource identifier, outcome, request ID, and timestamp in a protected sink. Exclude keys, JWTs, tickets, request bodies, and full prompts. Define retention, access, and alerting. |
| SEC-06 | P2 | Container privilege reduction is absent | Both Docker runtime stages omit `USER`, so they inherit the base image's root user. Base tags are mutable. | Run as a dedicated non-root user, identify images by digest, scan images, and provide only required writable cache/SQLite paths. Enforce resource limits in the deployment configuration. |

### Dependency triage details

The registry's metadata count is 24; the response groups findings into 19 advisory entries. Neither number means 24 independently exploitable endpoints. A production dependency graph also includes dependencies used by a static frontend's build or optional Node code paths.

| Package/path observed | Audit severity | Triage and remediation |
| --- | --- | --- |
| Zod 4.3.6 / 4.4.3, and transitive 3.x | High | Registry advisory GHSA-mrhx-c7xc-m3w5 reports memory exhaustion while validating oversized collections and lists 4.6.6 as patched. Inspect request body/collection limits and upstream compatibility. Do not globally force Zod 3 consumers onto Zod 4. |
| `ws` 8.18.0 through Reown → WalletConnect → viem | High and moderate | The maintainer's fragment exhaustion advisory lists 8.21.0 as patched. Direct server/core `ws` is a separate dependency path: this audit result does not establish that server WebSocket handling uses 8.18.0. Determine whether the old Node implementation is included or invoked in each artifact. |
| `decode-uri-component` 0.2.2 through wallet dependencies | High and moderate | Registry findings recommend at least 0.5.1 for the newer decoding DoS. Trace whether attacker-controlled input reaches it; prefer compatible upstream wallet updates. |
| `source-map-js` 1.2.1 through Next/PostCSS | High | Registry finding recommends 1.2.2. Determine whether untrusted source maps can reach processing; distinguish build exposure from public request exposure. |
| `follow-redirects` 1.16.1 through wallet → Coinbase SDK → Axios | High | Registry finding recommends 1.16.2 and requires a preserved cross-realm `sensitiveHeaders` array. Its text says the tested Axios path normalized that array. Presence here does not demonstrate credential disclosure. |
| Next 16.4.1 | Moderate | Maintainer advisory lists 16.4.5 as patched for a specific `use cache` / `unstable_cache()` nesting race. No occurrences of those APIs were found in the reviewed landing source. Patch the root override as well as applicable manifests when remediating. |
| Fastify 5.12.5 | Low | Maintainer advisory lists 5.12.6 as patched. It concerns case-sensitive header `propertyNames` schemas; no such application schema was found in the reviewed server/TradFi source. |
| `fast-uri`, `glob`, `minimatch` | Low/moderate | Additional parser/globbing findings need compatible updates and call-path assessment. Avoid untested major-version overrides. |

After manifest changes, run `pnpm install` to update the lockfile, then `pnpm precommit`, applicable production builds, and the vault browser check. The vault's minimal dependency policy requires a spec update for additions; preserve its isolation.

### Full development/build audit follow-up

After Roberto explicitly approved exporting the additional dependency metadata to the registry audit service, `pnpm audit --json` completed. It returned exit code 1 because advisories were found, rather than because the command failed to execute. The earlier approval block is resolved.

| Audit scope | Total reported findings | High | Moderate | Low | Critical |
| --- | --- | --- | --- | --- | --- |
| Production dependencies | 24 | 8 | 11 | 5 | 0 |
| All dependencies, including development/build | 57 | 16 | 31 | 10 | 0 |
| Additional findings in full audit | 33 | 8 | 20 | 5 | 0 |

The full response contains 45 advisory entries, including 26 entries absent from the production response. Registry metadata counts affected versions separately in some entries, so advisory-entry counts and the reported finding totals differ. The full audit includes the production findings; do not add 57 and 24.

| Additional affected package | New advisory entries | Registry-reported patch target | Practical exposure and next action |
| --- | --- | --- | --- |
| Undici 7.29.0 through jsdom | 18: 6 high, 9 moderate, 3 low | At least 7.30.1 addresses the reported 7.x ranges | Development/test dependency path. Root `package.json:50` still overrides older 7.x versions to 7.29.0, which is affected. Update the override's selector and target during remediation so it covers affected 7.x versions below the chosen patch. The installed npm package audit does not verify Node's separately bundled Undici. |
| Vite 6.4.3 | 5: 1 high, 3 moderate, 1 low | At least 6.4.4 | Dev-server/editor/filesystem handling; some advisories require Windows, network exposure, or custom middleware/import patterns. Reviewed web/vault configs do not explicitly enable a network host. Patch direct Vite dependencies and check the Vite version used by Vitest; public exploitability was not demonstrated. |
| `@vitest/mocker` 4.1.11 | 2 moderate | At least 4.1.12 | Manual mock registration injection requires the affected interceptor plugin and access to its dev-server socket. Upgrade compatible Vitest 4.1.x versions consistently across workspaces; package presence alone does not show this route is active. |
| fast-copy 4.0.3 through pino-pretty | 1 moderate | At least 4.1.0 | Deeply nested input can exhaust the stack. Assess the development logging call path and obtain a compatible patched resolution. |

These are additional development/build risks, not evidence of 33 additional exploitable production endpoints. No dependencies were changed by this follow-up. Patch targets are the minimum versions reported by this audit, not a claim that those versions resolve every possible future advisory.

## Controls already implemented

| Area | Evidence |
| --- | --- |
| Production authentication fails closed | Required DB/JWKS configuration; dev bypass requires an explicit flag, disabled persistence, and non-production mode. Live routes never accept that bypass. |
| Identity verification | RS256, issuer, optional configured audience, and authorized-party checks in `clerk-verifier.ts`; account ownership checks and regression tests. |
| Credential encryption | AES-256-GCM, random IVs, account/venue/environment AAD, key IDs, retired-key support, and rewrap tooling in `venue-credential-cipher.ts`. Rotation capability already exists; operational proof is the next step. |
| Main API network/abuse controls | Loopback binding by default, explicit trusted proxies/origins, request limits, 64 KiB WebSocket frames, connection/message limits, heartbeat, and output-buffer checks. |
| Private sockets | Single-use 30-second tickets, five-minute socket lifetimes, query-free request logging, and local logout revocation. |
| Trading vault | Separate origin, minimal dependencies, strict enforced CSP, Trusted Types, encrypted IndexedDB storage, non-extractable unlocked keys, and automatic locking. Local production browser checks passed during this review. |
| Operational instrumentation | Feed health, event-loop/memory/persistence metrics, readiness, graceful shutdown, and bounded persistence worker queues. These still need external collection, alert ownership, and incident drills. |
| Domain discipline | Shared Zod contracts, runtime-first design, reviewed options knowledge, and milestone controls for simulator changes. Existing model and simulator controls should be retained. |

The server-side Thalex read-only boundary depends on users creating the correct exchange permissions. `ThalexKeyManager.tsx:38` explicitly discloses that the key cannot report its own permissions. The server accepts a PEM after authentication; it cannot prove withdrawal/trading permissions are disabled using the reviewed login response. Treat this as a disclosed trust assumption: retain explicit attestation, verify exchange-side restrictions operationally, and never describe it as server-verified permission enforcement.

## Enterprise capabilities beyond security

| Capability | Next concrete deliverable | Acceptance evidence |
| --- | --- | --- |
| Reliability and support | Service objectives, owner/on-call contact, incident runbooks, external synthetic probes, and a status workflow | A simulated feed loss, DB outage, and process crash each produce the expected degraded UI, alert, and recovery path. |
| Performance | Workload model, per-endpoint budgets, bounded subscription fan-out, and load/soak tests | Publish p95/p99 latency, event-loop lag, RSS growth, reconnect rate, and subscription counts at agreed peak concurrency. Establish targets from measurement. |
| Recovery | Data classification, backup/PITR inventory, key recovery, and restore drill | Provisional planning targets: private durable data RPO ≤15 minutes and RTO ≤60 minutes; confirm achievable targets and costs before promising them. Archive cadence alone does not satisfy RPO. |
| Data trust | Source timestamps, provenance, partial coverage, and visible stale/degraded states | A disconnected feed never produces a fresh-looking recommendation from old observations. Maintain separate observed, estimated, and unavailable values. |
| Trading correctness | Milestone-specific replay/reconciliation/certification evidence | Follow `docs/superpowers/SIMULATOR_CONTROLS.md`; require approved child plans, deterministic replay, crash recovery, fee/unit reconciliation, and rollout controls before execution scope expands. This review does not certify simulator or live execution. |
| Team access, if selling shared desks | Organization/workspace membership, explicit viewer/operator/admin permissions, invitation/offboarding, and optional enterprise SSO policy | An authorization matrix and cross-organization negative tests cover every private API/socket. Existing user/account isolation is a starting point; database RLS is an optional additional layer. |
| Privacy and governance | Data inventory, provider/subprocessor inventory, retention/deletion/export policy, and support procedures | Account offboarding covers private credentials, portfolio snapshots, social copies, assistant conversations/memory/feedback, logs, and backup expiry. Some assistant retention/deletion controls already exist. |
| Product confidence | Critical-journey browser checks and consistent loading/error/empty/reconnect UX | Verify sign-in, venue connect, network switch, reconnect, account scope, stale data, and logout in production builds; include keyboard navigation and accessible error/status messages. |
| LLM safety and spend | User/run-scoped tool access, prompt-injection evaluations, token/dollar budgets, and fallback behavior | Existing question limits and concurrency controls remain; add provider spend ceilings and alerts, failed-run cost accounting, and multi-instance quota tests before scaling. |

Use [OWASP ASVS](https://owasp.org/projects/asvs) Level 2 requirements as a traceable verification backlog for the customer-facing/private-account surface. Choose applicable higher-assurance checks for the vault and sensitive actions through a threat model; this recommendation is not a certification claim.

## Suggested delivery order

1. **Stabilize the release boundary:** triage dependencies; close TradFi resource/origin gaps; fix Docker workspace packaging; put existing checks and builds into required CI. Keep current single-instance deployment until shared-state behavior is defined.
2. **Prove recovery and detection:** inventory durable state and secrets, restore in isolation, define dependency health, route alerts to an owner, and implement security-event logging. Version sanitized proxy/service configuration; keep secrets external. Local `ops/` exists but is ignored by Git.
3. **Finish browser and data assurance:** promote a tested CSP, add critical-journey browser checks, and expose source freshness/provenance without redesigning Alpha. Document support and rollback procedures.
4. **Add enterprise tenancy and scale when required:** permissions/organizations/offboarding, shared tickets/revocation/leases, measured load capacity, and failover. Keep core runtimes reusable; separate workers/services only where load or fault isolation warrants it.

| Workstream | Cost drivers to make explicit |
| --- | --- |
| Monitoring | Log ingestion volume, metric cardinality, retention, trace sampling, and alert seats. Filter/redact at source. |
| Recovery | Database PITR retention, snapshot storage, off-site copies, egress, and restore drill time. Check the actual provider plan. |
| Shared state | Cache availability/connection/request charges, database connection budgets, and inter-region latency. A second API process adds consistency work as well as compute cost. |
| CI/security | Runner minutes, browser/build time, image storage, scanner licensing where applicable, and dependency maintenance effort. |
| Assistant | Input/output/cached tokens, tool retries, failed runs, concurrency, and retained context. Translate quotas into a dollar ceiling. |

## Verification record

- Production dependency audit: completed; 24 findings as detailed above. Raw response is local at `/tmp/oggregator-audit-prod.json` and is not committed.
- Full development/build dependency audit: completed after explicit user approval; 57 reported findings (16 high, 31 moderate, 10 low, 0 critical), grouped into 45 advisory entries. Raw response is local at `/tmp/oggregator-audit-all.json` and is not committed. Exit code 1 indicates findings. No approval blocker remains.
- Docker workspace dependency comparison: confirmed missing `@oggregator/trading` and `@oggregator/funded` before install. No image build/start was performed.
- TradFi arbitrary-origin check: local in-memory reproduction returned HTTP 200 and `Access-Control-Allow-Origin: https://untrusted.example` for that supplied origin. No production service was contacted by this reproduction.
- Vault: production build and all existing real-browser security checks passed. The check used synthetic keys and opened the public Thalex testnet socket; no real account credentials were used.
- Repository gate: `pnpm precommit` passed (exit code 0): workspace typechecks and 4,729 tests across 581 test files passed. Test output is local at `/tmp/oggregator-security-precommit.log`.
- Production headers, firewall/listeners, IdP policies, backup subscriptions, failover, and external CI/branch settings remain unverified.

## Primary references checked

- [OWASP CSP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html): report-only policies report violations rather than blocking them.
- [WebSocket maintainer advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p): fragment/chunk memory exhaustion and fixed releases.
- [Next.js maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h): exact cache nesting preconditions and patched version.
- [Fastify maintainer advisory](https://github.com/fastify/fastify/security/advisories/GHSA-389g-gv7q-r4x8): header schema normalization preconditions and patched version.
- [Undici maintainer advisory](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx): custom TLS verification callback loss and patched releases.
- [Vite maintainer advisory](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22): specific network exposure/import-path preconditions for filesystem disclosure.
- [Vitest maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8): interceptor-plugin and socket-access preconditions for mock registration injection.

Other dependency statements above are attributed to the completed registry audit, not independently reproduced exploits.
