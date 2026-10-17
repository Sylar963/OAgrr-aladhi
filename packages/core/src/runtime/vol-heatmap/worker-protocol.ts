import type { VolHeatmapColumn, VolHeatmapMeta } from '@oggregator/protocol';
import { feedLogger } from '../../utils/logger.js';
import type { VolHeatmapFeedEvents } from './feed.js';

export type VolHeatmapWorkerRequest =
  | { t: 'start'; currencies: string[] }
  | { t: 'stop' };

export type VolHeatmapWorkerEvent =
  | { t: 'column'; currency: string; column: VolHeatmapColumn }
  | { t: 'meta'; currency: string; meta: VolHeatmapMeta };

export interface VolHeatmapPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
}

export interface VolHeatmapFeedLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const log = feedLogger('vol-heatmap-worker');
const START_RETRY_MS = 30_000;

/** Worker side: owns the feed and forwards its columns over `port`. */
export function serveVolHeatmapWorker(
  port: VolHeatmapPort,
  createFeed: (currencies: string[], events: VolHeatmapFeedEvents) => VolHeatmapFeedLike,
): void {
  let feed: VolHeatmapFeedLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const post = (event: VolHeatmapWorkerEvent): void => port.postMessage(event);

  const startFeed = (currencies: string[]): void => {
    const current = createFeed(currencies, {
      onColumn: (currency, column) => post({ t: 'column', currency, column }),
      onMeta: (currency, meta) => post({ t: 'meta', currency, meta }),
    });
    feed = current;
    current.start().catch((err: unknown) => {
      log.error({ err: String(err) }, 'vol heatmap feed failed to start, retrying');
      void current.stop();
      if (feed !== current) return;
      feed = null;
      retryTimer = setTimeout(() => startFeed(currencies), START_RETRY_MS);
    });
  };

  port.on('message', (raw) => {
    const message = raw as VolHeatmapWorkerRequest;
    if (message.t === 'start' && feed == null && retryTimer == null) {
      startFeed(message.currencies);
    } else if (message.t === 'stop') {
      if (retryTimer != null) clearTimeout(retryTimer);
      retryTimer = null;
      void feed?.stop();
      feed = null;
    }
  });
}
