import { z } from 'zod';

// Zod probes `new Function` to decide whether to compile validators. The vault's CSP forbids
// eval, so the probe would only produce a violation report; jitless skips it.
z.config({ jitless: true });
