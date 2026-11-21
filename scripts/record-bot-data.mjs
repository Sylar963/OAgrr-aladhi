import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NewsStreamMessageSchema, ServerWsMessageSchema } from '../packages/protocol/dist/index.js';

const [baseArg, underlying, expiry, venueArg, output = '.cache/bot-recording.ndjson'] =
  process.argv.slice(2);
if (!baseArg || !underlying || !expiry || !venueArg) {
  throw new Error(
    'Usage: node scripts/record-bot-data.mjs BASE_URL UNDERLYING YYYY-MM-DD VENUE[,VENUE] [OUTPUT.ndjson]',
  );
}
const base = new URL(baseArg);
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password)
  throw new Error('Use a public HTTP(S) API origin without credentials');
const source = base.origin;
const request = { underlying, expiry, venues: venueArg.split(',') };
const maxBytes = Number(process.env.BOT_CAPTURE_MAX_BYTES ?? 1_073_741_824);
if (!Number.isSafeInteger(maxBytes) || maxBytes < 1_000_000)
  throw new Error('BOT_CAPTURE_MAX_BYTES must be an integer of at least 1000000');
await mkdir(dirname(output), { recursive: true });
const checkpointPath = `${output}.cursor.json`;
let checkpoint = {};
try {
  checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (checkpoint.source && checkpoint.source !== source)
  throw new Error('Checkpoint belongs to a different API origin');
let newsCursor = checkpoint.newsCursor;
if (!newsCursor) {
  const response = await fetch(`${source}/api/news/events?limit=1`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`News startup HTTP ${response.status}`);
  const page = await response.json();
  newsCursor = page.oldestCursor ?? page.nextCursor;
}
let written = await stat(output)
  .then((info) => info.size)
  .catch((error) => {
    if (error.code === 'ENOENT') return 0;
    throw error;
  });
const file = await open(output, 'a', 0o600);
const connections = new Set();
const retries = new Set();
let pendingBytes = 0;
let ending = false;
let tail = Promise.resolve();
let shutdown;

function append(value, cursor) {
  if (ending) return Promise.reject(new Error('Recorder is stopping'));
  const line = JSON.stringify(value) + '\n';
  const bytes = Buffer.byteLength(line);
  if (pendingBytes + bytes > 8 * 1024 * 1024)
    return Promise.reject(
      new Error('Capture backlog exceeded 8 MiB; stopping without silently dropping frames'),
    );
  pendingBytes += bytes;
  const work = tail
    .then(async () => {
      if (written + bytes > maxBytes)
        throw new Error('Capture size limit reached; start another output file');
      await file.appendFile(line);
      await file.sync();
      written += bytes;
      if (cursor) {
        const temporary = `${checkpointPath}.tmp`;
        await writeFile(temporary, JSON.stringify({ source, newsCursor: cursor }), {
          mode: 0o600,
          flush: true,
        });
        await rename(temporary, checkpointPath);
        newsCursor = cursor;
      }
    })
    .finally(() => {
      pendingBytes -= bytes;
    });
  tail = work.catch((error) => {
    void stop(error);
  });
  return work;
}

function stop(error) {
  if (shutdown) return shutdown;
  ending = true;
  for (const timer of retries) clearTimeout(timer);
  for (const socket of connections) {
    try {
      socket.close();
    } catch {}
  }
  if (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
  shutdown = (async () => {
    await tail;
    await file.appendFile(
      JSON.stringify({
        type: error ? 'capture-gap' : 'capture-stop',
        receivedAt: Date.now(),
        reason: error?.message ?? 'shutdown',
      }) + '\n',
    );
    await file.sync();
    await file.close();
  })().catch((failure) => {
    process.stderr.write(`Capture shutdown: ${failure.message}\n`);
    process.exitCode = 1;
  });
  return shutdown;
}

function connect(stream, attempt = 0) {
  if (ending) return;
  const sessionId = randomUUID();
  const url = new URL(stream === 'news' ? '/ws/news' : '/ws/chain', source);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  if (stream === 'news') url.searchParams.set('after', newsCursor);
  const socket = new WebSocket(url);
  connections.add(socket);
  const openedAt = Date.now();
  socket.addEventListener('open', () => {
    if (ending) {
      socket.close();
      return;
    }
    if (stream === 'chain')
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          subscriptionId: sessionId,
          request,
          patchFormat: 'diff',
        }),
      );
  });
  socket.addEventListener('error', () => {});
  socket.addEventListener('message', (event) => {
    const receivedAt = Date.now();
    try {
      const raw = JSON.parse(String(event.data));
      const frame = (stream === 'news' ? NewsStreamMessageSchema : ServerWsMessageSchema).parse(
        raw,
      );
      const cursor =
        stream === 'news' && frame.type === 'events' ? frame.page.nextCursor : undefined;
      void append({ stream, sessionId, receivedAt, frame }, cursor).catch((error) => {
        void stop(error);
      });
      if (frame.type === 'error' && frame.code !== 'NOT_READY')
        void stop(new Error(`${stream}: ${frame.code}; explicit replay recovery is required`));
    } catch (error) {
      void stop(error);
    }
  });
  socket.addEventListener('close', (event) => {
    connections.delete(socket);
    if (ending) return;
    void append({
      type: 'connection-gap',
      stream,
      sessionId,
      receivedAt: Date.now(),
      closeCode: event.code,
    }).catch((error) => {
      void stop(error);
    });
    const nextAttempt = Date.now() - openedAt > 30000 ? 0 : attempt + 1;
    const timer = setTimeout(
      () => {
        retries.delete(timer);
        connect(stream, nextAttempt);
      },
      Math.min(30000, 1000 * 2 ** Math.min(nextAttempt, 5)),
    );
    retries.add(timer);
  });
}

await append({
  type: 'capture-start',
  version: 1,
  source,
  request,
  receivedAt: Date.now(),
  completeHistory: false,
  maxBytes,
});
connect('news');
connect('chain');
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
process.stdout.write(
  `Recording public news and chain frames to ${output}; replay checkpoint ${checkpointPath}\n`,
);
