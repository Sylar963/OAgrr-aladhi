import type { Logger } from 'pino';
import { Alerter } from './alerts/alerter.js';
import { type FetchLike, ResendSink, TelegramSink } from './alerts/sinks.js';
import { KeyCipher } from './cipher.js';
import type { ExecutionConfig } from './config.js';
import { LiveControl } from './control.js';
import { Journal } from './journal.js';
import { KeyStore } from './key-store.js';
import { CommandServer } from './socket-server.js';
import { StepUpSecretStore, StepUpVerifier } from './step-up.js';
import { StubVenueGateway, type VenueGateway } from './venue-gateway.js';

const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RunningDaemon {
  control: LiveControl;
  journal: Journal;
  gateway: VenueGateway;
  stop(reason: string): Promise<void>;
}

export class JournalCorruptError extends Error {
  constructor(readonly seq: number) {
    super(`Journal hash chain is broken at seq ${seq}`);
    this.name = 'JournalCorruptError';
  }
}

export async function startDaemon(
  config: ExecutionConfig,
  log: Logger,
  fetchFn: FetchLike = fetch,
): Promise<RunningDaemon> {
  const journal = Journal.open(config.stateDir);
  const alerter = new Alerter({
    telegram: config.telegram
      ? new TelegramSink(config.telegram.botToken, config.telegram.chatId, fetchFn)
      : null,
    email: config.email
      ? new ResendSink(config.email.apiKey, config.email.from, config.email.to, fetchFn)
      : null,
    onDeliveryFailure: (result) => {
      journal.append('system', 'alert_delivery_failed', {
        event: result.alert.event,
        severity: result.alert.severity,
        failed: result.failed,
      });
      log.error({ event: result.alert.event, failed: result.failed }, 'alert delivery failed');
    },
  });

  const broken = journal.verifyChain();
  if (broken !== null) {
    await alerter.send({
      event: 'journal_corrupt',
      severity: 'critical',
      message: `Execution journal hash chain broken at seq ${broken}; daemon refused to start.`,
    });
    journal.close();
    throw new JournalCorruptError(broken);
  }

  const cipher = new KeyCipher(config.keyId, config.keyEncryptionKey);
  const keys = new KeyStore(config.stateDir, cipher);
  const stepUp = new StepUpVerifier({ secrets: new StepUpSecretStore(config.stateDir, cipher), journal });
  const gateway: VenueGateway = new StubVenueGateway();
  const control = new LiveControl({ journal, alerter, keys, gateway, stepUp });
  const server = new CommandServer({ control, journal, hmacKey: config.hmacKey, log });

  journal.append('system', 'daemon_started', { pid: process.pid, venue: gateway.name });
  await server.listen(config.socketPath);
  log.info({ socket: config.socketPath }, 'execution daemon listening');

  const test = await alerter.sendTest();
  journal.append('system', 'alert_test', { delivered: test.delivered, failed: test.failed });
  await alerter.send({
    event: 'daemon_restart',
    severity: 'info',
    message: 'Execution daemon started; every user is disarmed until they arm again.',
  });

  const digestTimer = setInterval(() => {
    alerter.flushDigest().catch((err) => log.error({ err }, 'digest flush failed'));
  }, DIGEST_INTERVAL_MS);

  let stopped = false;
  return {
    control,
    journal,
    gateway,
    async stop(reason: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(digestTimer);
      await server.close();
      journal.append('system', 'daemon_stopped', { reason });
      journal.close();
    },
  };
}
