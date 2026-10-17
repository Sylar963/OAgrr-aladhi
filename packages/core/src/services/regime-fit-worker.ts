import { parentPort } from 'node:worker_threads';
import { type FitRequest, runFitRequest } from './regime-fit.js';

if (parentPort == null) {
  throw new Error('regime-fit-worker must be started as a worker thread');
}

const port = parentPort;
port.once('message', (request: FitRequest) => {
  port.postMessage(runFitRequest(request));
});
