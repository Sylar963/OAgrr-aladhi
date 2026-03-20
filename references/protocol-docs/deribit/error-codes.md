# Deribit Error Codes

> Source: https://docs.deribit.com/articles/errors

## Error Response Structure

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": 10028,
    "message": "too_many_requests",
    "data": { "reason": "...", "param": "..." }
  },
  "usIn": 1234567890,
  "usOut": 1234567891,
  "usDiff": 1,
  "id": 42
}
```

## Primary Error Categories

### Authentication & Authorization (10000-10099)

| Code | Message | Description |
|------|---------|-------------|
| 10000 | authorization_required | Auth required for this method |
| 10001 | invalid_credentials | Invalid API credentials |
| 10002 | insufficient_funds | Not enough funds |
| 10005 | forbidden | Insufficient permissions |
| 10028 | too_many_requests | Rate limit exceeded |

### Token Management (13000-13099)

| Code | Message | Description |
|------|---------|-------------|
| 13009 | invalid_token | Expired/invalid auth token |
| 13010 | token_revoked | Token has been revoked |
| 13011 | insufficient_scope | Token lacks required scope |

### Trading Errors (11000-11099)

| Code | Message | Description |
|------|---------|-------------|
| 11000 | not_found | Order not found |
| 11001 | already_filled | Order already filled/cancelled |
| 11003 | price_out_of_range | Price outside acceptable range |
| 11004 | amount_too_small | Below minimum amount |
| 11005 | amount_too_large | Exceeds maximum amount |
| 11006 | post_only_reject | Would take liquidity |
| 11007 | reduce_only_reject | Would increase position |
| 11008 | position_limit | Position limit reached |
| 11009 | self_trade | Self-trade would occur |

## Handling Strategies

- **Rate Limiting (10028)**: Exponential backoff (2^n seconds, max 30s)
- **Token Expiration (13009)**: Auto-refresh token before retry
- **Insufficient Funds (10002)**: Non-recoverable, alert user
- **Order Rejections (11xxx)**: Adjust parameters based on reason
