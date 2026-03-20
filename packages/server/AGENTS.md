# @oggregator/server — Quick Reference

```bash
pnpm dev            # hot reload on :3100
pnpm build          # tsc
pnpm typecheck      # tsc --noEmit
```

```
GET /api/health          → service status
GET /api/venues          → connected venues
GET /api/underlyings     → base assets per venue
GET /api/expiries        → expiry dates (query: underlying)
GET /api/chains          → cross-venue comparison (query: underlying, expiry)
```

Import from `@oggregator/core` only. 503 until adapters ready.
