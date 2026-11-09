# @oggregator/web — Quick Reference

```bash
pnpm dev          # :5173, proxies /api → :3100
pnpm build        # tsc --noEmit && vite build
pnpm typecheck    # tsc --noEmit
```

```
src/features/{name}/   queries.ts, components, index.ts
src/lib/               http, formatters, query-client, colors
src/stores/            Zustand (UI state only)
src/shared-types/      Types mirroring core enrichment output
```

Notable features: `chain/`, `surface/`, `portfolio/`, `trading/`, `flow/`, `analytics/`, `alpha/`, `dvol/`.

TanStack Query for server state. Zustand for UI state. IV stored as fractions, displayed via `fmtIv(v) = v × 100 + "%"`. CSS Modules for all components. Prefer `@oggregator/protocol` types for portfolio and trading payloads.

Desktop crypto tabs use editable presets and the same dock host as custom tabs. Read
`WORKSPACES.md` before changing layout state, persistence, widget membership, or navigation.
