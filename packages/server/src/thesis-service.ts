import { randomUUID } from 'node:crypto';

import {
  classifyBook,
  contextDiff,
  expiryInstantMs,
  gateDecision,
  oppositeDirection,
  rebaseToMark,
  THESIS_GATE_SHOWN_DEDUPE_MS,
  THESIS_REVERSAL_COOLDOWN_MS,
  THESIS_WAIT_MS,
  thesisStatus,
  type ThesisCandle,
  type ThesisLegWithMark,
} from '@oggregator/core';
import {
  type DeferredLog,
  FlushSchedule,
  type PersistedThesis,
  type PersistedThesisEvent,
  readJsonLines,
  rewriteJsonLines,
  type ThesisStore,
} from '@oggregator/db';
import {
  isSpotCandleUnderlying,
  type PortfolioSource,
  THESIS_FLIP_CONFIRMATION,
  type ThesisClassification,
  type ThesisCooldown,
  type ThesisCreateRequest,
  ThesisCreateRequestSchema,
  type ThesisEvent,
  type ThesisEventKind,
  ThesisEventSchema,
  type ThesisFlipRequest,
  type ThesisGateCheckRequest,
  type ThesisGateCheckResponse,
  type ThesisListResponse,
  type ThesisMarketContext,
  type ThesisPendingFlip,
  type ThesisRecord,
  ThesisRecordSchema,
  ThesisTightenRequestSchema,
  type ThesisShare,
  type ThesisStatusDetail,
  type ThesisStructureClass,
  type ThesisView,
} from '@oggregator/protocol';

export interface ThesisChainStats {
  atmIv: number | null;
  skew25d: number | null;
}

export interface ThesisMarketPort {
  spotUsd(underlying: string): number | null;
  candles(underlying: string, resolutionSec: number, buckets: number): Promise<ThesisCandle[]>;
  chainStats(underlying: string, expiry: string): Promise<ThesisChainStats | null>;
  dvol(underlying: string): number | null;
  netGexUsdMillions(underlying: string): Promise<number | null>;
}

export interface ThesisHeldBook {
  /** False when the source is not connected, so its (empty) list says nothing. */
  live: boolean;
  legs: ThesisLegWithMark[];
}

export interface ThesisBookPort {
  heldBook(accountId: string, source: PortfolioSource, underlying: string): Promise<ThesisHeldBook>;
  subscribe(listener: (accountId: string, source: PortfolioSource) => void): () => void;
}

export interface ThesisServiceOptions {
  store: ThesisStore;
  market: ThesisMarketPort;
  book: ThesisBookPort;
  cachePath: string;
  flushIntervalMs: number;
  evaluateIntervalMs: number;
  /** Sources whose books are combined and watched. Paper is a simulation and stays out. */
  bookSources: readonly PortfolioSource[];
  log: DeferredLog & { info: (obj: object, msg: string) => void };
  now?: () => number;
}

export interface SharedThesis {
  thesis: ThesisRecord & { share: ThesisShare };
  /** Null once the thesis ended. */
  status: ThesisStatusDetail | null;
  spotUsd: number | null;
}

export class ThesisError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ThesisError';
  }
}

const DAY_MS = 86_400_000;
const LOAD_ENDED_WINDOW_MS = 30 * DAY_MS;
const CONTEXT_CACHE_MS = 60_000;
const MARKET_TIMEOUT_MS = 5_000;
const BOOK_CHANGE_DEBOUNCE_MS = 2_000;
const MAX_CANDLE_BUCKETS = 3_000;
const SPOT_FALLBACK_RESOLUTION_SEC = 3600;

type OutboxLine = { type: 'thesis'; row: ThesisRecord } | { type: 'event'; row: ThesisEvent };

function decodeOutboxLine(value: unknown): OutboxLine {
  const line = value as { type?: unknown; row?: unknown } | null;
  if (line?.type === 'thesis') return { type: 'thesis', row: ThesisRecordSchema.parse(line.row) };
  if (line?.type === 'event') return { type: 'event', row: ThesisEventSchema.parse(line.row) };
  throw new Error('unknown thesis outbox line');
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), MARKET_TIMEOUT_MS);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function structureHash(req: ThesisGateCheckRequest): string {
  return JSON.stringify(
    [...req.legs]
      .map((leg) => [leg.expiry, leg.strike, leg.optionRight, leg.side, leg.size])
      .sort(),
  );
}

/**
 * Theses, their status and the flip gate. Live state is in memory; every change is written to
 * a local NDJSON outbox at once and reaches Postgres on the daily FlushSchedule.
 */
export class ThesisService {
  private readonly theses = new Map<string, ThesisRecord>();
  private readonly events = new Map<string, ThesisEvent[]>();
  private readonly pendingTheses = new Map<string, ThesisRecord>();
  private pendingEvents: ThesisEvent[] = [];
  private readonly gateShownAt = new Map<string, number>();
  private readonly contextCache = new Map<string, { at: number; value: ThesisMarketContext }>();
  private readonly bookTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private schedule: FlushSchedule | null = null;
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeBook: (() => void) | null = null;
  private flushing = false;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly options: ThesisServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): Promise<void> {
    this.readyPromise ??= this.load().then(() => {
      if (this.options.store.enabled) {
        this.schedule = new FlushSchedule(
          this.options.cachePath,
          this.options.flushIntervalMs,
          async () => {
            const result = await this.flush();
            this.options.log.info(result, 'theses flushed');
          },
          (err: unknown) => {
            this.options.log.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'thesis flush failed',
            );
          },
        );
      }
      this.evaluateTimer = setInterval(() => void this.evaluate(), this.options.evaluateIntervalMs);
      this.evaluateTimer.unref?.();
      this.unsubscribeBook = this.options.book.subscribe((accountId, source) =>
        this.onBookChange(accountId, source),
      );
    });
    return this.readyPromise;
  }

  dispose(): void {
    this.schedule?.dispose();
    this.schedule = null;
    if (this.evaluateTimer != null) clearInterval(this.evaluateTimer);
    this.evaluateTimer = null;
    this.unsubscribeBook?.();
    this.unsubscribeBook = null;
    for (const timer of this.bookTimers.values()) clearTimeout(timer);
    this.bookTimers.clear();
  }

  // ── Reads ────────────────────────────────────────────────────────────

  async list(accountId: string): Promise<ThesisListResponse> {
    await this.ready();
    const active: ThesisView[] = [];
    for (const thesis of this.accountTheses(accountId)) {
      if (thesis.state !== 'active') continue;
      const view = await this.view(thesis, true);
      if (view.thesis.state === 'active') active.push(view);
    }
    const reversalCooldowns: ThesisView[] = [];
    for (const thesis of this.reversalCandidates(accountId)) {
      reversalCooldowns.push(await this.view(thesis, false));
    }
    const latestEnded = new Map<string, ThesisRecord>();
    for (const thesis of this.accountTheses(accountId)) {
      if (thesis.state === 'active' || thesis.endedAt == null || thesis.endedAt < this.now() - LOAD_ENDED_WINDOW_MS) continue;
      const previous = latestEnded.get(thesis.underlying);
      if (previous == null || thesis.endedAt >= (previous.endedAt ?? 0)) latestEnded.set(thesis.underlying, thesis);
    }
    return { active, reversalCooldowns, recentlyEnded: [...latestEnded.values()] };
  }

  /** Shared theses, newest first; active ones are re-evaluated so their status is current. */
  async shared(limit: number): Promise<SharedThesis[]> {
    await this.ready();
    const theses = [...this.theses.values()]
      .filter((thesis): thesis is SharedThesis['thesis'] => thesis.share != null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return Promise.all(
      theses.map(async (thesis): Promise<SharedThesis> => {
        if (thesis.state !== 'active') {
          return { thesis, status: null, spotUsd: await this.spot(thesis.underlying) };
        }
        const view = await this.view(thesis, false);
        return {
          thesis: { ...view.thesis, share: thesis.share },
          status: view.thesis.state === 'active' ? view.status : null,
          spotUsd: view.status.spotUsd,
        };
      }),
    );
  }

  async gateCheck(accountId: string, req: ThesisGateCheckRequest): Promise<ThesisGateCheckResponse> {
    await this.ready();
    const underlying = req.underlying.toUpperCase();
    const nowMs = this.now();
    let active = this.activeThesis(accountId, underlying);
    let activeView = active == null ? null : await this.view(active, true);
    if (activeView != null && activeView.thesis.state !== 'active') {
      active = null;
      activeView = null;
    }
    const reversal = active == null ? this.reversalThesis(accountId, underlying) : null;
    const ref = active ?? reversal;

    const nearestLegExpiry = [...req.legs].map((leg) => leg.expiry).sort()[0]!;
    const horizonExpiry = ref?.horizonExpiry ?? nearestLegExpiry;
    const horizonMs = expiryInstantMs(horizonExpiry);
    const [spotUsd, stats] = await Promise.all([
      this.spot(underlying),
      withTimeout(this.options.market.chainStats(underlying, horizonExpiry), null),
    ]);
    const atmIv = stats?.atmIv ?? null;

    const proposedLegs = req.legs.map((leg, index): ThesisLegWithMark => ({
      leg: {
        legId: `thesis-gate-${index}`,
        underlying,
        expiry: leg.expiry,
        strike: leg.strike,
        optionRight: leg.optionRight,
        size: leg.side === 'buy' ? leg.size : -leg.size,
        entryPriceUsd: leg.premiumUsd,
        entryIv: leg.iv,
        realizedPnlUsd: 0,
        entryTs: nowMs,
        venueHint: null,
        source: 'manual',
      },
      mark: {
        underlyingPriceUsd: spotUsd,
        forwardPriceUsd: spotUsd,
        markPriceUsd: leg.premiumUsd,
        iv: leg.iv,
        delta: null,
        gamma: null,
        vega: null,
        theta: null,
        yearsToExpiry: null,
      },
    }));
    const proposed = classifyBook({ legs: proposedLegs, spotUsd, horizonMs, nowMs, atmIv });

    const sources = req.combineWith != null ? [req.combineWith] : this.options.bookSources;
    const held: ThesisLegWithMark[] = [];
    const combinedSources: PortfolioSource[] = [];
    for (const source of sources) {
      const book = await this.options.book.heldBook(accountId, source, underlying);
      if (!book.live || book.legs.length === 0) continue;
      held.push(...rebaseToMark(book.legs));
      combinedSources.push(source);
    }

    let heldClass: ThesisStructureClass | null = null;
    let combined: ThesisStructureClass | null = null;
    let heldBookNote: string | null = null;
    if (held.length > 0) {
      heldClass = classifyBook({ legs: held, spotUsd, horizonMs, nowMs, atmIv });
      combined = classifyBook({ legs: [...held, ...proposedLegs], spotUsd, horizonMs, nowMs, atmIv });
      heldBookNote =
        combined.classification === 'unknown'
          ? `Held ${combinedSources.join(' + ')} book could not be valued (${combined.note ?? 'unknown'}); judged on the structure alone.`
          : `Combined with your ${combinedSources.join(' + ')} ${underlying} book.`;
    } else {
      heldBookNote =
        req.combineWith != null
          ? `No live ${req.combineWith} ${underlying} positions; judged on the structure alone.`
          : `No connected ${underlying} positions found; judged on the structure alone.`;
    }
    const target: ThesisClassification =
      combined != null && combined.classification !== 'unknown'
        ? combined.classification
        : proposed.classification;

    const decision = gateDecision({
      thesisDirection: active?.direction ?? null,
      status: activeView?.status.status ?? null,
      reversalDirection: reversal?.direction ?? null,
      target,
    });

    const view = activeView ?? (reversal != null ? await this.view(reversal, false) : null);
    if (decision.decision === 'gate' && ref != null) {
      const key = `${ref.id}|${structureHash(req)}`;
      const lastShown = this.gateShownAt.get(key);
      if (lastShown == null || nowMs - lastShown >= THESIS_GATE_SHOWN_DEDUPE_MS) {
        this.gateShownAt.set(key, nowMs);
        this.append(ref, 'gate_shown', {
          reason: decision.reason,
          target,
          proposed,
          held: heldClass,
          combined,
          spotUsd,
          materialCount: view?.diff?.materialCount ?? null,
        });
      }
    }

    return {
      decision: decision.decision,
      reason: decision.reason,
      proposed,
      held: heldClass,
      combined,
      heldBookNote,
      view,
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────

  /** `shareAs` is the social user to publish under; callers check that the user has a username. */
  async create(
    accountId: string,
    input: ThesisCreateRequest,
    bypassCooldown = false,
    shareAs: string | null = null,
  ): Promise<ThesisView> {
    await this.ready();
    const req = ThesisCreateRequestSchema.parse(input);
    const underlying = req.underlying.toUpperCase();
    if (!isSpotCandleUnderlying(underlying)) {
      throw new ThesisError(400, 'unsupported_underlying', `No price history for ${underlying}`);
    }
    const nowMs = this.now();
    if (expiryInstantMs(req.horizonExpiry) <= nowMs) {
      throw new ThesisError(400, 'horizon_passed', 'The horizon expiry has already passed');
    }
    if (this.activeThesis(accountId, underlying) != null) {
      throw new ThesisError(409, 'active_exists', `An active ${underlying} thesis already exists`);
    }
    if (!bypassCooldown) {
      const reversal = this.reversalThesis(accountId, underlying);
      if (reversal != null && req.direction === oppositeDirection(reversal.direction)) {
        throw new ThesisError(
          409,
          'reversal_cooldown',
          'You ended an opposite thesis less than 24h ago; flipping now needs the override form',
        );
      }
    }
    const spotUsd = await this.spot(underlying);
    if (spotUsd != null) {
      const wrongSide = req.direction === 'bearish' ? req.level <= spotUsd : req.level >= spotUsd;
      if (wrongSide) {
        throw new ThesisError(
          400,
          'level_wrong_side',
          req.direction === 'bearish'
            ? 'A bearish invalidation level must be above spot'
            : 'A bullish invalidation level must be below spot',
        );
      }
    }

    const thesis: ThesisRecord = {
      id: randomUUID(),
      accountId,
      underlying,
      direction: req.direction,
      horizonExpiry: req.horizonExpiry,
      level: req.level,
      confirmSec: req.confirmSec,
      reason: req.reason,
      contextAtCreation: await this.captureContext(underlying, req.horizonExpiry, true),
      linkedSnapshotId: req.linkedSnapshotId ?? null,
      state: 'active',
      createdAt: nowMs,
      endedAt: null,
      endNote: null,
      share: shareAs == null ? null : { userId: shareAs, sharedAt: nowMs },
    };
    this.putThesis(thesis);
    this.append(thesis, 'created', { spotUsd, shared: shareAs != null });
    return this.view(thesis, true);
  }

  async keep(accountId: string, id: string): Promise<ThesisView> {
    await this.ready();
    const thesis = this.owned(accountId, id);
    this.append(thesis, 'gate_kept', {});
    return this.view(thesis, thesis.state === 'active');
  }

  async wait(accountId: string, id: string): Promise<ThesisView> {
    await this.ready();
    const thesis = this.ownedActive(accountId, id);
    const nowMs = this.now();
    const running = this.waitCooldown(thesis, nowMs);
    if (running != null && !running.completed) {
      throw new ThesisError(409, 'wait_running', 'A wait is already running');
    }
    const msToHorizon = Math.max(0, expiryInstantMs(thesis.horizonExpiry) - nowMs);
    const endsAt = nowMs + Math.min(THESIS_WAIT_MS, msToHorizon);
    this.append(thesis, 'cooldown_started', { endsAt });
    return this.view(thesis, true);
  }

  async flip(accountId: string, id: string, req: ThesisFlipRequest): Promise<ThesisView> {
    await this.ready();
    let thesis = this.owned(accountId, id);
    if (req.newThesis.direction !== oppositeDirection(thesis.direction)) {
      throw new ThesisError(400, 'not_a_flip', 'The new thesis must take the opposite direction');
    }
    const before = thesis.state === 'active' ? await this.view(thesis, true) : null;
    if (before != null) thesis = before.thesis;
    const shareAs = req.newThesis.share === false ? null : (thesis.share?.userId ?? null);
    if (thesis.state === 'invalidated' || thesis.state === 'expired') {
      // The rule fired or the horizon passed: a new opposite thesis is not a flip against it.
      return this.create(accountId, { ...req.newThesis, underlying: thesis.underlying }, true, shareAs);
    }
    const nowMs = this.now();
    const inReversal = thesis.state === 'ended_early' && this.isInReversalCooldown(thesis, nowMs);
    if (thesis.state !== 'active' && !inReversal) {
      throw new ThesisError(409, 'not_flippable', 'This thesis is no longer active');
    }
    const waitCompleted = thesis.state === 'active' && this.waitCooldown(thesis, nowMs)?.completed === true;
    if (!waitCompleted && req.confirmation?.trim() !== THESIS_FLIP_CONFIRMATION) {
      throw new ThesisError(
        400,
        'confirmation_required',
        `Type "${THESIS_FLIP_CONFIRMATION}" to flip before a wait has finished`,
      );
    }

    const nextThesis = await this.createAfterFlip(accountId, thesis, req, shareAs);
    const kind: ThesisEventKind = req.late ? 'flip_logged_late' : waitCompleted ? 'flip_after_wait' : 'override';
    if (thesis.state === 'active') {
      this.putThesis({
        ...thesis,
        state: waitCompleted ? 'reversed' : 'overridden',
        endedAt: nowMs,
        endNote: req.reason,
      });
    }
    this.append(thesis, kind, {
      reason: req.reason,
      newThesisId: nextThesis.thesis.id,
      spotUsd: before?.status.spotUsd ?? nextThesis.thesis.contextAtCreation.spotUsd,
      status: before?.status.status ?? null,
      materialCount: before?.diff?.materialCount ?? null,
    });
    return nextThesis;
  }

  async tighten(accountId: string, id: string, level: number): Promise<ThesisView> {
    await this.ready();
    ThesisTightenRequestSchema.parse({ level });
    const before = await this.view(this.ownedActive(accountId, id), false);
    const thesis = this.ownedActive(accountId, id);
    if (thesis !== before.thesis) return this.tighten(accountId, id, level);
    const tighter = thesis.direction === 'bearish' ? level < thesis.level : level > thesis.level;
    if (!tighter) {
      throw new ThesisError(
        400,
        'widen_rejected',
        'The level can only move toward spot; end the thesis and write a new one to widen it',
      );
    }
    const spotUsd = before.status.spotUsd;
    if (spotUsd == null) {
      throw new ThesisError(409, 'spot_unavailable', 'Wait for a current spot price before tightening the level');
    }
    if (thesis.direction === 'bearish' ? level <= spotUsd : level >= spotUsd) {
      throw new ThesisError(400, 'level_wrong_side', thesis.direction === 'bearish'
        ? 'A bearish invalidation level must be above spot'
        : 'A bullish invalidation level must be below spot');
    }
    const updated = { ...thesis, level, levelEffectiveAt: this.now() };
    this.putThesis(updated);
    this.append(updated, 'level_tightened', { from: thesis.level, to: level });
    return this.view(updated, true);
  }

  /** Publishing needs an active thesis; withdrawing works at any time. */
  async setShared(accountId: string, id: string, shareAs: string | null): Promise<ThesisView> {
    await this.ready();
    const thesis = shareAs == null ? this.owned(accountId, id) : this.ownedActive(accountId, id);
    if ((shareAs == null) === (thesis.share == null)) return this.view(thesis, thesis.state === 'active');
    const updated: ThesisRecord = {
      ...thesis,
      share: shareAs == null ? null : { userId: shareAs, sharedAt: this.now() },
    };
    this.putThesis(updated);
    this.append(updated, shareAs == null ? 'unshared' : 'shared', {});
    return this.view(updated, updated.state === 'active');
  }

  async end(accountId: string, id: string, note: string | undefined): Promise<ThesisView> {
    await this.ready();
    const thesis = this.ownedActive(accountId, id);
    const updated: ThesisRecord = {
      ...thesis,
      state: 'ended_early',
      endedAt: this.now(),
      endNote: note?.trim() ? note.trim() : null,
    };
    this.putThesis(updated);
    this.append(updated, 'ended_early', { note: updated.endNote });
    return this.view(updated, false);
  }

  async backToThesis(accountId: string, id: string): Promise<ThesisView> {
    await this.ready();
    const thesis = this.ownedActive(accountId, id);
    if (this.pendingFlip(thesis) == null) {
      throw new ThesisError(409, 'no_pending_flip', 'No detected flip to resolve');
    }
    this.append(thesis, 'back_to_thesis', {});
    return this.view(thesis, true);
  }

  // ── Background ───────────────────────────────────────────────────────

  async evaluate(): Promise<void> {
    await this.ready();
    const nowMs = this.now();
    const accounts = new Set<string>();
    for (const thesis of [...this.theses.values()]) {
      if (thesis.state !== 'active') continue;
      try {
        const view = await this.view(thesis, false);
        if (view.thesis.state !== 'active') continue;
        accounts.add(thesis.accountId);
        const wait = this.waitCooldown(thesis, nowMs);
        const lastStarted = this.lastEvent(thesis.id, 'cooldown_started');
        if (wait?.completed && lastStarted != null && !this.hasEventAfter(thesis.id, 'cooldown_ended', lastStarted.createdAt)) {
          this.append(thesis, 'cooldown_ended', { endsAt: wait.endsAt });
        }
      } catch (err: unknown) {
        this.options.log.warn(
          { err: err instanceof Error ? err.message : String(err), thesisId: thesis.id },
          'thesis evaluation failed',
        );
      }
    }
    for (const accountId of accounts) {
      for (const source of this.options.bookSources) await this.checkHeldBook(accountId, source);
    }
  }

  async flush(): Promise<{ theses: number; events: number; pending: number }> {
    if (this.flushing || (this.pendingTheses.size === 0 && this.pendingEvents.length === 0)) {
      return { theses: 0, events: 0, pending: this.pendingTheses.size + this.pendingEvents.length };
    }
    this.flushing = true;
    const theses = [...this.pendingTheses.values()];
    const events = [...this.pendingEvents];
    try {
      const result = await this.options.store.save(theses.map(toPersistedThesis), events.map(toPersistedEvent));
      for (const thesis of theses) {
        if (this.pendingTheses.get(thesis.id) === thesis) this.pendingTheses.delete(thesis.id);
      }
      const flushed = new Set(events);
      this.pendingEvents = this.pendingEvents.filter((event) => !flushed.has(event));
      this.persist();
      return { ...result, pending: this.pendingTheses.size + this.pendingEvents.length };
    } finally {
      this.flushing = false;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────

  private ready(): Promise<void> {
    return this.readyPromise ?? this.start();
  }

  private async load(): Promise<void> {
    if (this.options.store.enabled) {
      try {
        const loaded = await this.options.store.load({
          endedSince: new Date(this.now() - LOAD_ENDED_WINDOW_MS),
        });
        for (const row of loaded.theses) {
          const parsed = ThesisRecordSchema.safeParse(row.record);
          if (parsed.success) this.theses.set(parsed.data.id, parsed.data);
        }
        for (const row of loaded.events) {
          const parsed = ThesisEventSchema.safeParse({
            id: row.id,
            thesisId: row.thesisId,
            accountId: row.accountId,
            kind: row.kind,
            payload: row.payload,
            createdAt: row.createdAt.getTime(),
          });
          if (parsed.success) this.indexEvent(parsed.data);
        }
      } catch (err: unknown) {
        this.options.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'thesis load from database failed; serving the local outbox only',
        );
      }
    }
    const lines = readJsonLines(this.options.cachePath, decodeOutboxLine, this.options.log);
    for (const line of lines) {
      if (line.type === 'thesis') {
        this.theses.set(line.row.id, line.row);
        this.pendingTheses.set(line.row.id, line.row);
      } else {
        if (!this.hasEvent(line.row)) this.indexEvent(line.row);
        this.pendingEvents.push(line.row);
      }
    }
  }

  private persist(): void {
    const lines: OutboxLine[] = [
      ...[...this.pendingTheses.values()].map((row) => ({ type: 'thesis' as const, row })),
      ...this.pendingEvents.map((row) => ({ type: 'event' as const, row })),
    ];
    rewriteJsonLines(this.options.cachePath, lines, (line) => line);
  }

  private putThesis(thesis: ThesisRecord): void {
    this.theses.set(thesis.id, thesis);
    this.pendingTheses.set(thesis.id, thesis);
    this.persist();
  }

  private append(thesis: ThesisRecord, kind: ThesisEventKind, payload: Record<string, unknown>): ThesisEvent {
    const event: ThesisEvent = {
      id: randomUUID(),
      thesisId: thesis.id,
      accountId: thesis.accountId,
      kind,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      createdAt: this.now(),
    };
    this.indexEvent(event);
    this.pendingEvents.push(event);
    this.persist();
    return event;
  }

  private indexEvent(event: ThesisEvent): void {
    const list = this.events.get(event.thesisId) ?? [];
    list.push(event);
    list.sort((a, b) => a.createdAt - b.createdAt);
    this.events.set(event.thesisId, list);
  }

  private hasEvent(event: ThesisEvent): boolean {
    return (this.events.get(event.thesisId) ?? []).some((existing) => existing.id === event.id);
  }

  private lastEvent(thesisId: string, kind: ThesisEventKind): ThesisEvent | null {
    const list = this.events.get(thesisId) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.kind === kind) return list[i]!;
    return null;
  }

  private hasEventAfter(thesisId: string, kind: ThesisEventKind, afterMs: number): boolean {
    return (this.events.get(thesisId) ?? []).some((e) => e.kind === kind && e.createdAt >= afterMs);
  }

  private accountTheses(accountId: string): ThesisRecord[] {
    return [...this.theses.values()]
      .filter((thesis) => thesis.accountId === accountId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private activeThesis(accountId: string, underlying: string): ThesisRecord | null {
    return (
      this.accountTheses(accountId).find(
        (thesis) => thesis.state === 'active' && thesis.underlying === underlying,
      ) ?? null
    );
  }

  private isInReversalCooldown(thesis: ThesisRecord, nowMs: number): boolean {
    return (
      thesis.state === 'ended_early' &&
      thesis.endedAt != null &&
      nowMs - thesis.endedAt < THESIS_REVERSAL_COOLDOWN_MS
    );
  }

  /** Latest thesis ended early on this underlying whose cooldown runs and that no flip resolved. */
  private reversalThesis(accountId: string, underlying: string): ThesisRecord | null {
    if (this.activeThesis(accountId, underlying) != null) return null;
    const nowMs = this.now();
    const candidates = this.accountTheses(accountId).filter(
      (thesis) =>
        thesis.underlying === underlying &&
        this.isInReversalCooldown(thesis, nowMs) &&
        this.lastEvent(thesis.id, 'override') == null &&
        this.lastEvent(thesis.id, 'flip_logged_late') == null,
    );
    return candidates.at(-1) ?? null;
  }

  private reversalCandidates(accountId: string): ThesisRecord[] {
    const underlyings = new Set(this.accountTheses(accountId).map((thesis) => thesis.underlying));
    return [...underlyings]
      .map((underlying) => this.reversalThesis(accountId, underlying))
      .filter((thesis): thesis is ThesisRecord => thesis != null);
  }

  private owned(accountId: string, id: string): ThesisRecord {
    const thesis = this.theses.get(id);
    if (thesis == null || thesis.accountId !== accountId) {
      throw new ThesisError(404, 'not_found', 'Thesis not found');
    }
    return thesis;
  }

  private ownedActive(accountId: string, id: string): ThesisRecord {
    const thesis = this.owned(accountId, id);
    if (thesis.state !== 'active') throw new ThesisError(409, 'not_active', 'This thesis is no longer active');
    return thesis;
  }

  private waitCooldown(thesis: ThesisRecord, nowMs: number): ThesisCooldown | null {
    const started = this.lastEvent(thesis.id, 'cooldown_started');
    if (started == null) return null;
    const endsAt = Number(started.payload['endsAt']);
    if (!Number.isFinite(endsAt)) return null;
    return { kind: 'wait', startedAt: started.createdAt, endsAt, completed: nowMs >= endsAt };
  }

  private pendingFlip(thesis: ThesisRecord): ThesisPendingFlip | null {
    const detected = this.lastEvent(thesis.id, 'flip_detected');
    if (detected == null) return null;
    const events = this.events.get(thesis.id) ?? [];
    const after = events.slice(events.indexOf(detected) + 1);
    if (after.some((event) => event.kind === 'flip_cleared')) return null;
    const source = String(detected.payload['source']) as PortfolioSource;
    const classification = String(detected.payload['classification']) as ThesisClassification;
    return {
      detectedAt: detected.createdAt,
      source,
      classification,
      backToThesis: after.some((event) => event.kind === 'back_to_thesis'),
    };
  }

  private async spot(underlying: string): Promise<number | null> {
    const live = this.options.market.spotUsd(underlying);
    if (live != null && live > 0) return live;
    const candles = await withTimeout(
      this.options.market.candles(underlying, SPOT_FALLBACK_RESOLUTION_SEC, 2),
      [] as ThesisCandle[],
    );
    return candles.at(-1)?.close ?? null;
  }

  private async captureContext(
    underlying: string,
    horizonExpiry: string,
    fresh = false,
  ): Promise<ThesisMarketContext> {
    const key = `${underlying}|${horizonExpiry}`;
    const nowMs = this.now();
    const cached = this.contextCache.get(key);
    if (!fresh && cached != null && nowMs - cached.at < CONTEXT_CACHE_MS) return cached.value;
    const [spotUsd, stats, gex] = await Promise.all([
      this.spot(underlying),
      withTimeout(this.options.market.chainStats(underlying, horizonExpiry), null),
      withTimeout(this.options.market.netGexUsdMillions(underlying), null),
    ]);
    const value: ThesisMarketContext = {
      capturedAt: nowMs,
      spotUsd,
      dvol: this.options.market.dvol(underlying),
      atmIv: stats?.atmIv ?? null,
      skew25d: stats?.skew25d ?? null,
      netGexUsdMillions: gex,
    };
    this.contextCache.set(key, { at: nowMs, value });
    return value;
  }

  private async status(thesis: ThesisRecord): Promise<ThesisStatusDetail> {
    const nowMs = this.now();
    const spanMs = thesis.confirmSec * 1000;
    const buckets = Math.min(MAX_CANDLE_BUCKETS, Math.ceil((nowMs - thesis.createdAt) / spanMs) + 2);
    const [candles, spotUsd, stats] = await Promise.all([
      withTimeout(this.options.market.candles(thesis.underlying, thesis.confirmSec, buckets), [] as ThesisCandle[]),
      this.spot(thesis.underlying),
      withTimeout(this.options.market.chainStats(thesis.underlying, thesis.horizonExpiry), null),
    ]);
    const levelEffectiveAt = thesis.levelEffectiveAt ?? this.lastEvent(thesis.id, 'level_tightened')?.createdAt;
    return thesisStatus({ ...thesis, levelEffectiveAt }, { candles, spotUsd, atmIv: stats?.atmIv ?? null, nowMs });
  }

  /** Builds a view and moves an active thesis to invalidated/expired when its rule says so. */
  private async view(thesis: ThesisRecord, withDiff: boolean): Promise<ThesisView> {
    const status = await this.status(thesis);
    const latest = this.theses.get(thesis.id);
    if (latest != null && latest !== thesis) return this.view(latest, withDiff);
    let current = thesis;
    if (thesis.state === 'active' && (status.status === 'INVALIDATED' || status.status === 'EXPIRED')) {
      current = {
        ...thesis,
        state: status.status === 'INVALIDATED' ? 'invalidated' : 'expired',
        endedAt: this.now(),
      };
      this.putThesis(current);
      this.append(current, status.status === 'INVALIDATED' ? 'invalidated' : 'expired', {
        firedCandleTs: status.firedCandleTs,
        spotUsd: status.spotUsd,
      });
    }
    const nowMs = this.now();
    const diff = withDiff
      ? contextDiff(
          thesis.contextAtCreation,
          await this.captureContext(thesis.underlying, thesis.horizonExpiry),
          status.status,
        )
      : null;
    const books = withDiff && current.state === 'active' ? await this.bookStatuses(current) : undefined;
    const afterReads = this.theses.get(thesis.id);
    if (afterReads != null && afterReads !== current) return this.view(afterReads, withDiff);
    let cooldown: ThesisCooldown | null = null;
    if (current.state === 'active') cooldown = this.waitCooldown(current, nowMs);
    else if (current.state === 'ended_early' && current.endedAt != null && this.isInReversalCooldown(current, nowMs)) {
      cooldown = {
        kind: 'reversal',
        startedAt: current.endedAt,
        endsAt: current.endedAt + THESIS_REVERSAL_COOLDOWN_MS,
        completed: false,
      };
    }
    return {
      thesis: current,
      status,
      diff,
      cooldown,
      pendingFlip: current.state === 'active' ? this.pendingFlip(current) : null,
      waitCompleted: current.state === 'active' && this.waitCooldown(current, nowMs)?.completed === true,
      books,
    };
  }

  private async createAfterFlip(
    accountId: string,
    previous: ThesisRecord,
    req: ThesisFlipRequest,
    shareAs: string | null,
  ): Promise<ThesisView> {
    // The old thesis is still active here, so free the slot only once the new one validates.
    const wasActive = previous.state === 'active';
    if (wasActive) this.theses.set(previous.id, { ...previous, state: 'overridden' });
    try {
      return await this.create(accountId, { ...req.newThesis, underlying: previous.underlying }, true, shareAs);
    } catch (err) {
      if (wasActive) this.theses.set(previous.id, previous);
      throw err;
    }
  }

  private onBookChange(accountId: string, source: PortfolioSource): void {
    if (!this.options.bookSources.includes(source)) return;
    const key = `${accountId}|${source}`;
    const existing = this.bookTimers.get(key);
    if (existing != null) return;
    const timer = setTimeout(() => {
      this.bookTimers.delete(key);
      void this.checkHeldBook(accountId, source).catch((err: unknown) => {
        this.options.log.warn(
          { err: err instanceof Error ? err.message : String(err), source },
          'thesis held-book check failed',
        );
      });
    }, BOOK_CHANGE_DEBOUNCE_MS);
    timer.unref?.();
    this.bookTimers.set(key, timer);
  }

  /** Detects a held book that turned against an intact thesis, and clears it once it no longer does. */
  async checkHeldBook(accountId: string, source: PortfolioSource): Promise<void> {
    await this.ready();
    if (!this.options.bookSources.includes(source)) return;
    const nowMs = this.now();
    for (const thesis of this.accountTheses(accountId)) {
      if (thesis.state !== 'active') continue;
      const book = await this.options.book.heldBook(accountId, source, thesis.underlying);
      if (this.theses.get(thesis.id) !== thesis) continue;
      this.observeBook(thesis, source, book);
      if (!book.live) continue;
      const pending = this.pendingFlip(thesis);
      let classification: ThesisClassification = 'neutral';
      let bias: number | null = null;
      const openLegs = book.legs.filter(({ leg }) => leg.size !== 0);
      if (openLegs.length > 0) {
        const [spotUsd, stats] = await Promise.all([
          this.spot(thesis.underlying),
          withTimeout(this.options.market.chainStats(thesis.underlying, thesis.horizonExpiry), null),
        ]);
        const result = classifyBook({
          legs: rebaseToMark(openLegs),
          spotUsd,
          horizonMs: expiryInstantMs(thesis.horizonExpiry),
          nowMs,
          atmIv: stats?.atmIv ?? null,
        });
        classification = result.classification;
        bias = result.bias;
      }
      if (classification === 'unknown') continue;
      if (this.theses.get(thesis.id) !== thesis) continue;
      const opposite = classification === oppositeDirection(thesis.direction);
      if (opposite && pending == null) {
        const status = await this.status(thesis);
        if (this.theses.get(thesis.id) !== thesis || this.pendingFlip(thesis) != null) continue;
        if (status.status !== 'INTACT' && status.status !== 'AT_RISK') continue;
        this.append(thesis, 'flip_detected', { source, classification, bias, spotUsd: status.spotUsd });
      } else if (!opposite && pending != null && pending.source === source) {
        this.append(thesis, 'flip_cleared', { source, classification, bias });
      }
    }
  }

  private observeBook(thesis: ThesisRecord, source: PortfolioSource, book: ThesisHeldBook): NonNullable<ThesisView['books']>[number] {
    const previous = (this.events.get(thesis.id) ?? []).findLast((event) =>
      (event.kind === 'book_opened' || event.kind === 'book_closed') && event.payload['source'] === source,
    );
    if (!book.live) return { source, state: 'unavailable', openLegCount: 0 };
    const openLegCount = book.legs.filter(({ leg }) => leg.size !== 0).length;
    const state = openLegCount > 0 ? 'open' : previous != null ? 'closed' : 'empty';
    const kind = state === 'open' ? 'book_opened' : state === 'closed' ? 'book_closed' : null;
    if (kind != null && previous?.kind !== kind && this.theses.get(thesis.id) === thesis) {
      this.append(thesis, kind, { source, openLegCount });
    }
    if (openLegCount === 0 && this.pendingFlip(thesis)?.source === source) {
      this.append(thesis, 'flip_cleared', { source, classification: 'neutral', bias: null });
    }
    return { source, state, openLegCount };
  }

  private async bookStatuses(thesis: ThesisRecord): Promise<NonNullable<ThesisView['books']>> {
    return Promise.all(this.options.bookSources.map(async (source) => {
      try {
        const book = await this.options.book.heldBook(thesis.accountId, source, thesis.underlying);
        return this.observeBook(thesis, source, book);
      } catch (err: unknown) {
        this.options.log.warn({ err, source, thesisId: thesis.id }, 'thesis book status unavailable');
        return { source, state: 'unavailable' as const, openLegCount: 0 };
      }
    }));
  }
}

function toPersistedThesis(thesis: ThesisRecord): PersistedThesis {
  return {
    id: thesis.id,
    accountId: thesis.accountId,
    underlying: thesis.underlying,
    state: thesis.state,
    createdAt: new Date(thesis.createdAt),
    endedAt: thesis.endedAt == null ? null : new Date(thesis.endedAt),
    record: thesis,
  };
}

function toPersistedEvent(event: ThesisEvent): PersistedThesisEvent {
  return {
    id: event.id,
    thesisId: event.thesisId,
    accountId: event.accountId,
    kind: event.kind,
    payload: event.payload,
    createdAt: new Date(event.createdAt),
  };
}
