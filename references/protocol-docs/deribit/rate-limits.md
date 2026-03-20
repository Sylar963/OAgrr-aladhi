# Deribit Rate Limits

> Source: https://docs.deribit.com/articles/rate-limits

## Credit-Based System ("Leaky Bucket")

Credits replenish continuously at a fixed rate.

### Non-Matching Engine (Default)

- **Cost**: 500 credits per request
- **Maximum Credits**: 50,000
- **Refill Rate**: 10,000 credits/second (20 req/sec sustained)
- **Burst Capacity**: ~100 requests

### Specific Method Costs

| Method | Cost | Max Credits | Sustained Rate | Burst |
|--------|------|-------------|----------------|-------|
| `public/get_instruments` | 10,000 | 500,000 | 1 req/sec | 50 |
| `public/subscribe` | 3,000 | 30,000 | ~3.3 req/sec | 10 |
| `private/move_positions` | 100,000 | 600,000 | 6 req/min | 6 |
| `private/get_transaction_log` | 10,000 | 80,000 | 1 req/sec | 8 |

### Matching Engine (Tier-based on 7-day volume)

| Tier | Volume | Sustained | Burst |
|------|--------|-----------|-------|
| Tier 1 | >$25M | 30 req/sec | 100 |
| Tier 2 | >$5M | 20 req/sec | 50 |
| Tier 3 | >$1M | 10 req/sec | 30 |
| Tier 4 | <=1M | 5 req/sec | 20 |

## Exceeding Limits

When credits reach zero: `too_many_requests` error (code `10028`) and **session terminated**. Must wait for credits to replenish and reconnect.

## Important Notes

- Rate limits are **per sub-account**
- Web platform consumes API credits from same pool
- Public (non-auth) requests rate-limited **per IP**
- Production and Testnet have independent pools
