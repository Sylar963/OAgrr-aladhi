import { parentPort } from 'node:worker_threads';
import { VolHeatmapFeed } from './feed.js';
import { serveVolHeatmapWorker } from './worker-protocol.js';

if (parentPort == null) {
  throw new Error('vol-heatmap worker must be started as a worker thread');
}

serveVolHeatmapWorker(parentPort, (currencies, events) => new VolHeatmapFeed(currencies, events));
