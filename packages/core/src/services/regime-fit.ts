import { Worker } from 'node:worker_threads';
import { feedLogger } from '../utils/logger.js';
import { type FitOptions, type FitResult, fitGaussianHmm } from './regime-hmm.js';

const log = feedLogger('regime-fit');

export type HmmFitter = (
  data: readonly (readonly number[])[],
  opts: FitOptions,
) => Promise<FitResult>;

export interface FitRequest {
  values: Float64Array;
  rows: number;
  cols: number;
  opts: FitOptions;
}

export type FitResponse = { ok: true; result: FitResult } | { ok: false; error: string };

export const inProcessHmmFitter: HmmFitter = async (data, opts) => fitGaussianHmm(data, opts);

export function packObservations(data: readonly (readonly number[])[]): Float64Array<ArrayBuffer> {
  const cols = data[0]?.length ?? 0;
  const values = new Float64Array(data.length * cols);
  for (let t = 0; t < data.length; t++) {
    const row = data[t]!;
    for (let k = 0; k < cols; k++) values[t * cols + k] = row[k]!;
  }
  return values;
}

export function unpackObservations(values: Float64Array, rows: number, cols: number): number[][] {
  const data: number[][] = new Array(rows);
  for (let t = 0; t < rows; t++) data[t] = Array.from(values.subarray(t * cols, (t + 1) * cols));
  return data;
}

export function runFitRequest(request: FitRequest): FitResponse {
  try {
    const data = unpackObservations(request.values, request.rows, request.cols);
    return { ok: true, result: fitGaussianHmm(data, request.opts) };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Baum-Welch over a full 90-day buffer blocks for 10-17s, so production fits run on a
 * short-lived worker thread. The fit is pure and seeded, so the worker returns exactly what
 * an in-process fit would.
 */
export function createWorkerHmmFitter(options: { timeoutMs?: number } = {}): HmmFitter {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  return (data, opts) =>
    new Promise<FitResult>((resolve, reject) => {
      const values = packObservations(data);
      const request: FitRequest = { values, rows: data.length, cols: data[0]?.length ?? 0, opts };
      const worker = new Worker(new URL('./regime-fit-worker.js', import.meta.url));
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error(`regime fit worker timed out after ${timeoutMs}ms`))),
        timeoutMs,
      );
      timer.unref?.();
      worker.once('message', (response: FitResponse) =>
        finish(() => (response.ok ? resolve(response.result) : reject(new Error(response.error)))),
      );
      worker.once('error', (err) => finish(() => reject(err)));
      worker.once('exit', (code) => {
        if (!settled) log.warn({ code }, 'regime fit worker exited before replying');
        finish(() => reject(new Error(`regime fit worker exited with code ${code}`)));
      });
      worker.postMessage(request, [values.buffer]);
    });
}
