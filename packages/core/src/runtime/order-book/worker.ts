import { parentPort } from 'node:worker_threads';
import { ThalexBookFeed } from '../../feeds/thalex/book-feed.js';
import { serveOrderBookWorker } from './worker-protocol.js';

if (parentPort == null) {
  throw new Error('order-book worker must be started as a worker thread');
}

serveOrderBookWorker(parentPort, (events) => new ThalexBookFeed(events));
