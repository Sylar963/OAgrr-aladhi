import type { FastifyInstance } from 'fastify';
import { getAllAdapters, getRegisteredVenues } from '@oggregator/core';
import { SERVER_BOOT_TIME, SERVER_VERSION } from '../app.js';
import { currentReadinessStatus, isTrafficReady } from '../readiness.js';
import { getRuntimeMetricsSnapshot } from '../runtime-metrics.js';
import {
  getFeedHealthSnapshot,
  getLivenessMaxMs,
  isFeedLivenessStale,
} from '../feed-health.js';
import {
  blockFlowService,
  flowService,
  getIvHistoryStorageStats,
  isBlockFlowReady,
  isDvolReady,
  isFlowReady,
  isIvHistoryReady,
  isNewsReady,
  isSpotReady,
  spotService,
} from '../services.js';
import { getSystemAnnouncement } from '../system-status.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => {
    const ivHistoryStorage = await getIvHistoryStorageStats();
    return {
      status: currentReadinessStatus(),
      venues: getRegisteredVenues(),
      services: {
        flow: isFlowReady(),
        dvol: isDvolReady(),
        spot: isSpotReady(),
        blockFlow: isBlockFlowReady(),
        ivHistory: isIvHistoryReady(),
        news: isNewsReady(),
        ivHistoryStorage,
      },
      runtime: getRuntimeMetricsSnapshot(),
      feeds: getFeedHealthSnapshot({
        spot: spotService,
        flow: flowService,
        blockFlow: blockFlowService,
        chain: getAllAdapters(),
      }),
      bootTime: SERVER_BOOT_TIME,
      version: SERVER_VERSION,
      announcement: getSystemAnnouncement(),
      ts: Date.now(),
    };
  });

  app.get('/ready', async (_req, reply) => {
    if (!isTrafficReady()) {
      return reply.status(503).send({ status: currentReadinessStatus() });
    }
    // Post-bootstrap liveness check: bootstrap succeeded once, but every feed
    // has gone silent — process is alive but useless. Returning 503 here lets
    // an external watchdog (systemd / Caddy / cron) recycle the process,
    // replacing the blunt 2h restart cron.
    const feeds = getFeedHealthSnapshot({
      spot: spotService,
      flow: flowService,
      blockFlow: blockFlowService,
      chain: getAllAdapters(),
    });
    if (isFeedLivenessStale(feeds, getLivenessMaxMs())) {
      return reply.status(503).send({
        status: 'stale',
        lastAnyMessageAgeMs: feeds.summary.lastAnyMessageAgeMs,
      });
    }
    return { status: 'ok' };
  });
}
