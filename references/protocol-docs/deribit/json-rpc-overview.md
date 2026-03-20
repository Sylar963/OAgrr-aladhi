# JSON-RPC 2.0 Protocol - Deribit API Documentation

> Source: https://docs.deribit.com/articles/json-rpc-overview

## Overview

Deribit implements the JSON-RPC 2.0 specification for all API communications, providing "a stateless, light-weight remote procedure call (RPC) protocol that uses JSON" for data encoding. The platform supports both HTTP and WebSocket transports, though WebSocket is preferred for production systems.

## Key Protocol Limitations

The API does **not** support three JSON-RPC 2.0 features:

- **Positional parameters**: Only named parameters (object properties) accepted
- **Batch requests**: Individual requests required; no multi-request batching
- **Client notifications**: Requests without an `id` field are rejected

## Request Structure

All requests must follow this format:

```json
{
  "jsonrpc": "2.0",
  "method": "public/get_instruments",
  "params": {
    "currency": "BTC",
    "kind": "future"
  },
  "id": 42
}
```

**Field Requirements:**

| Field | Type | Required | Details |
|-------|------|----------|---------|
| `jsonrpc` | string | Yes | Must be exactly `"2.0"` |
| `method` | string | Yes | Format: `{scope}/{method_name}` (case-sensitive) |
| `params` | object | Conditional | Named parameters only; omit if none needed |
| `id` | integer/string | Yes | Unique identifier for correlation |

**Critical guidance**: WebSocket requires "proper request ID management" since responses arrive asynchronously. Use monotonically increasing integers or UUIDs, maintaining a pending request map.

## HTTP REST Endpoints

- **Production**: `https://www.deribit.com/api/v2/{method}`
- **Test**: `https://test.deribit.com/api/v2/{method}`

Both GET and POST are supported. Content-Type must be `application/json`. Connections expire after 15 minutes of inactivity.

## WebSocket Endpoints

- **Production**: `wss://www.deribit.com/ws/api/v2`
- **Test**: `wss://test.deribit.com/ws/api/v2`

WebSocket uses "text frames (UTF-8 encoded JSON)" with one JSON-RPC message per frame. Connection limits: 32 per IP address, 16 sessions per API key.

**Advantages over HTTP:**
- Bidirectional communication enabling real-time subscriptions
- Lower latency (no handshake overhead)
- Supports cancel-on-disconnect functionality
- Higher rate limits for authenticated connections

## Response Format

**Success Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": [ /* response data */ ]
}
```

**Error Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 8163,
  "error": {
    "code": 11050,
    "message": "bad_request"
  }
}
```

**Response fields:**

| Field | Type | Details |
|-------|------|---------|
| `jsonrpc` | string | Always `"2.0"` |
| `id` | integer/string | Echoes request ID |
| `result` | any | Present only on success |
| `error` | object | Present only on failure; mutually exclusive with `result` |
| `testnet` | boolean | Environment indicator |
| `usIn` | integer | Request receipt timestamp (microseconds) |
| `usOut` | integer | Response sent timestamp (microseconds) |
| `usDiff` | integer | Server processing time in microseconds |

The `testnet`, `usIn`, `usOut`, and `usDiff` fields are "Deribit-specific extensions" providing environment identification and performance monitoring capabilities.

## Notification Messages

Server-to-client notifications (subscriptions) follow this structure:

```json
{
  "jsonrpc": "2.0",
  "method": "subscription",
  "params": {
    "channel": "deribit_price_index.btc_usd",
    "data": {
      "timestamp": 1535098298227,
      "price": 6521.17
    }
  }
}
```

Notifications lack an `id` field and are "one-way communication" requiring no response.

## Instrument Naming Convention

| Kind | Examples | Template | Notes |
|------|----------|----------|-------|
| Future | `BTC-25MAR23` | `BTC-DMMMYY` | D=day, MMM=month (3 letters), YY=year |
| Perpetual | `BTC-PERPETUAL` | N/A | No expiration date |
| Option | `BTC-25MAR23-420-C` | `BTC-DMMMYY-STRIKE-K` | K=C (call) or P (put); decimals use 'd' |

## Best Practices Summary

1. **Use unique request IDs** with timeouts (30 seconds recommended)
2. **Select WebSocket for production** trading; HTTP for simple data retrieval
3. **Implement reconnection logic** with exponential backoff
4. **Monitor timing fields** (`usDiff`) for performance analysis
5. **Handle errors appropriately**, distinguishing protocol from application errors
6. **Secure credential management** using environment variables, never embedding keys
7. **Re-authenticate and re-subscribe** after reconnection
8. **Manage subscriptions efficiently**, unsubscribing from unused channels
9. **Implement circuit breakers** for repeated failures
10. **Validate all inputs** before sending requests

## Connection Management

- **Per IP limit**: 32 simultaneous connections (HTTP + WebSocket combined)
- **Per API key limit**: 16 active sessions
- **Per account limit**: 20 subaccounts

Two authentication scopes exist: connection-scoped (invalidated on disconnect) and session-scoped (persists across connections).
