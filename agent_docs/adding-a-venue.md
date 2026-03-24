# Adding a New Venue

## Steps

1. Save official API docs to `references/protocol-docs/{venue}/`
2. Create `packages/core/src/feeds/{venue}/types.ts` — Zod schemas for all raw API message shapes
3. Create `packages/core/src/feeds/{venue}/ws-client.ts` — extends `SdkBaseAdapter`
4. Create `packages/core/src/feeds/{venue}/index.ts` — single named export
5. Add export to `packages/core/src/index.ts`
6. Add venue to `VenueId` union in `packages/core/src/types/common.ts`
7. Write doc-driven tests in `packages/core/src/feeds/{venue}/types.test.ts`
8. Add adapter instance to `packages/server/src/adapters.ts`

## ws-client.ts must implement

```typescript
class XxxWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'xxx';
  protected initClients(): void { /* create WS connection */ }
  protected async fetchInstruments(): Promise<CachedInstrument[]> { /* load + parse instruments */ }
  protected async subscribeChain(underlying, expiry, instruments): Promise<void> { /* subscribe to live data */ }
  protected async unsubscribeAll(): Promise<void> { /* cleanup */ }
  override async dispose(): Promise<void> { /* close connections */ }
}
```

## Normalization rules

- Determine if inverse or linear from the settlement currency
- `safeNum()` handles string → number coercion safely
- `parseExpiry()` handles YYMMDD, YYYYMMDD, DDMmmYY, and unix timestamp formats
- `buildCanonicalSymbol()` produces `BASE/USD:SETTLE-YYMMDD-STRIKE-C/P`

## Gotchas

- Always check if the venue sends numbers or strings — varies per exchange
- REST and WS field names may differ for the same data (see Bybit)
- Respect rate limits on subscribe calls — batch if needed
- The server auto-discovers new adapters via `registerAdapter()` — no route changes needed
