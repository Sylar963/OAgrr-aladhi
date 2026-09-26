import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// Node gives each resolved address 250ms by default. This host has no IPv6 route, so only the
// IPv4 attempts can succeed, and a busy event loop (large outbox rewrites, startup work) makes
// all of them time out at once. Postgres connections then fail with an AggregateError.
setDefaultAutoSelectFamilyAttemptTimeout(5_000);
