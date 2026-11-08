import { parentPort, workerData } from 'node:worker_threads';
import type { FlowOiTick } from '@oggregator/protocol';
import { FlowOiStore } from './flow-oi-store.js';
import { FlowOiWorkerOptionsSchema, FlowOiWorkerRequestSchema } from './flow-oi-worker-protocol.js';

const port = parentPort;
if (!port) throw new Error('FLOW OI persistence requires a worker thread');
const options = FlowOiWorkerOptionsSchema.parse(workerData);
const store = new FlowOiStore(options.path, {
  connectionString: options.connectionString,
  ...(options.flushIntervalMs === undefined ? {} : { flushIntervalMs: options.flushIntervalMs }),
  log: {
    warn: (fields, message) =>
      port.postMessage({
        type: 'warning',
        message: `${message}: ${JSON.stringify(fields)}`,
      }),
  },
});

port.on('message', async (raw: unknown) => {
  const parsed = FlowOiWorkerRequestSchema.safeParse(raw);
  if (!parsed.success) return;
  const request = parsed.data;
  try {
    let value: unknown;
    switch (request.method) {
      case 'append': {
        const inserted: FlowOiTick[] = [];
        const unsubscribe = store.subscribe((tick) => inserted.push(tick));
        try {
          store.appendBatch(request.ticks);
        } finally {
          unsubscribe();
        }
        value = inserted;
        break;
      }
      case 'bracket':
        value = store.bracket(request.venue, request.instrument, request.timestamp);
        break;
      case 'prune':
        store.prune(request.before);
        break;
      case 'flush':
        await store.flush();
        break;
      case 'dispose':
        await store.dispose();
        break;
    }
    port.postMessage({ type: 'result', id: request.id, value });
    if (request.method === 'dispose') port.close();
  } catch (error: unknown) {
    port.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
