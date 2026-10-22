import type { Leg as StrategyLeg } from '@features/architect/payoff';
import { useStrategyStore } from '@features/architect/strategy-store';
import { dteDays, fmtIv, fmtNum, fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type { TabId } from '@lib/tabs';
import type { PaperFillDto, PaperTradeDetailDto, PaperTradeLegDto } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { useEffect, useState } from 'react';
import {
  useActivity,
  useAddTradeNote,
  useCloseTrade,
  useReduceTrade,
  useTrade,
  useTrades,
} from './hooks/queries';
import PaperHelpPopover from './PaperHelpPopover';
import styles from './PaperTraderPanel.module.css';

const messages = defineMessages(
  {
    openTrades: 'Open trades',
    noOpenTrades: 'No open trades. Send a strategy from Builder.',
    legs: '· {n} legs',
    premium: 'Premium',
    spot: 'Spot',
    liveFeed: 'Live feed',
    selectTrade: 'Select a trade to inspect risk, execution, journal, and history.',
    opened: '{strategy} · opened {ts}',
    reduce50: 'Reduce 50%',
    rollInBuilder: 'Roll in Builder',
    closeTrade: 'Close Trade',
    status: 'Status',
    netPremium: 'Net Premium',
    fees: 'Fees',
    realizedNet: 'Realized (net)',
    unrealized: 'Unrealized',
    totalPnl: 'Total PnL',
    positionRisk: 'Position risk',
    leg: 'Leg',
    baseQty: 'Base Qty',
    avg: 'Avg',
    mark: 'Mark',
    dte: 'DTE',
    iv: 'IV',
    source: 'Source',
    pnl: 'P&L',
    executionDetails: 'Execution details',
    time: 'Time',
    venue: 'Venue',
    fill: 'Fill',
    mid: 'Mid',
    edge: 'Edge',
    tradeJournal: 'Trade journal',
    kindNote: 'Note',
    kindThesis: 'Thesis',
    kindInvalidation: 'Invalidation',
    kindReview: 'Review',
    tagsPlaceholder: 'tags, comma separated',
    notePlaceholder: 'Write the setup, what changed, or what you learned from the trade.',
    addNote: 'Add note',
    tradeTimeline: 'Trade timeline',
    closedTrades: 'Closed trades',
    noClosedTrades: 'No closed trades yet.',
    trade: 'Trade',
    openedCol: 'Opened',
    closedCol: 'Closed',
    debit: 'Debit',
    credit: 'Credit',
  },
  {
    openTrades: 'Trades abiertos',
    noOpenTrades: 'No hay trades abiertos. Envía una estrategia desde el Constructor.',
    legs: '· {n} patas',
    premium: 'Prima',
    spot: 'Spot',
    liveFeed: 'Feed en vivo',
    selectTrade: 'Selecciona un trade para ver riesgo, ejecución, diario e historial.',
    opened: '{strategy} · abierto {ts}',
    reduce50: 'Reducir 50%',
    rollInBuilder: 'Rolar en Constructor',
    closeTrade: 'Cerrar trade',
    status: 'Estado',
    netPremium: 'Prima neta',
    fees: 'Comisiones',
    realizedNet: 'Realizado (neto)',
    unrealized: 'No realizado',
    totalPnl: 'PnL total',
    positionRisk: 'Riesgo de la posición',
    leg: 'Pata',
    baseQty: 'Cant. base',
    avg: 'Prom.',
    mark: 'Mark',
    dte: 'DTE',
    iv: 'IV',
    source: 'Fuente',
    pnl: 'P&L',
    executionDetails: 'Detalles de ejecución',
    time: 'Hora',
    venue: 'Exchange',
    fill: 'Ejecución',
    mid: 'Mid',
    edge: 'Ventaja',
    tradeJournal: 'Diario del trade',
    kindNote: 'Nota',
    kindThesis: 'Tesis',
    kindInvalidation: 'Invalidación',
    kindReview: 'Revisión',
    tagsPlaceholder: 'etiquetas, separadas por coma',
    notePlaceholder: 'Escribe el setup, qué cambió o qué aprendiste del trade.',
    addNote: 'Agregar nota',
    tradeTimeline: 'Cronología del trade',
    closedTrades: 'Trades cerrados',
    noClosedTrades: 'Aún no hay trades cerrados.',
    trade: 'Trade',
    openedCol: 'Abierto',
    closedCol: 'Cerrado',
    debit: 'Débito',
    credit: 'Crédito',
  },
);

const NOTE_KIND_KEYS = {
  note: 'kindNote',
  thesis: 'kindThesis',
  invalidation: 'kindInvalidation',
  review: 'kindReview',
} as const;

type PaperTraderPanelProps = {
  selectedTradeId: string | null;
  setSelectedTradeId: (id: string | null) => void;
};

export default function PaperTraderPanel({
  selectedTradeId,
  setSelectedTradeId,
}: PaperTraderPanelProps) {
  const t = useT(messages);
  const { data: openTradesData } = useTrades('open', 100);
  const { data: closedTradesData } = useTrades('closed', 100);
  const { data: activityData } = useActivity(50);
  const openTrades = openTradesData?.trades ?? [];
  const closedTrades = closedTradesData?.trades ?? [];
  const [noteKind, setNoteKind] = useState<'thesis' | 'invalidation' | 'review' | 'note'>('note');
  const [noteContent, setNoteContent] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const { data: selectedTrade } = useTrade(selectedTradeId);
  const addNote = useAddTradeNote();
  const closeTrade = useCloseTrade();
  const reduceTrade = useReduceTrade();
  const replaceLegs = useStrategyStore((state) => state.replaceLegs);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setUnderlying = useAppStore((state) => state.setUnderlying);

  useEffect(() => {
    const candidate = openTrades[0]?.id ?? closedTrades[0]?.id ?? null;
    const exists = [...openTrades, ...closedTrades].some((t) => t.id === selectedTradeId);
    if (!selectedTradeId || !exists) setSelectedTradeId(candidate);
  }, [closedTrades, openTrades, selectedTradeId, setSelectedTradeId]);

  const liveTrade = selectedTrade ?? null;

  return (
    <>
      <section className={styles.sidebar}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{t('openTrades')}</span>
            <span>{openTrades.length}</span>
          </div>
          <div className={styles.tradeList}>
            {openTrades.length === 0 ? (
              <div className={styles.empty}>{t('noOpenTrades')}</div>
            ) : (
              openTrades.map((trade) => (
                <button
                  key={trade.id}
                  className={styles.tradeCard}
                  data-selected={trade.id === selectedTradeId ? 'true' : undefined}
                  onClick={() => setSelectedTradeId(trade.id)}
                >
                  <div className={styles.tradeCardTop}>
                    <div>
                      <div className={styles.tradeLabel}>{trade.label}</div>
                      <div className={styles.tradeMetaLine}>
                        <span>{trade.strategyName}</span>
                        <PremiumFlowBadge netPremiumUsd={trade.netPremiumUsd} />
                        <span>{t('legs', { n: trade.openLegs })}</span>
                      </div>
                    </div>
                    <div
                      className={
                        tone(trade.totalPnlUsd) === 'positive'
                          ? styles.positive
                          : tone(trade.totalPnlUsd) === 'negative'
                            ? styles.negative
                            : ''
                      }
                    >
                      {fmtUsd(trade.totalPnlUsd)}
                    </div>
                  </div>
                  <div className={styles.tradeStatsRow}>
                    <MiniStat label={t('premium')} value={fmtUsd(trade.netPremiumUsd)} />
                    <MiniStat
                      label={t('spot')}
                      value={fmtUsd(trade.currentSpotUsd ?? trade.entrySpotUsd)}
                    />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{t('liveFeed')}</span>
            <span>{activityData?.activity.length ?? 0}</span>
          </div>
          <div className={styles.feedList}>
            {(activityData?.activity ?? []).slice(0, 12).map((item) => (
              <div key={item.id} className={styles.feedItem}>
                <div className={styles.feedSummary}>{item.summary}</div>
                <div className={styles.feedMeta}>{formatTs(item.ts)}</div>
              </div>
            ))}
          </div>
        </div>

        <PaperHelpPopover />
      </section>

      <section className={styles.main}>
        {!liveTrade ? (
          <div className={styles.section}>
            <div className={styles.empty}>
              {t('selectTrade')}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.section}>
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailTitle}>{liveTrade.label}</div>
                  <div className={styles.detailSubtitle}>
                    {t('opened', {
                      strategy: liveTrade.strategyName,
                      ts: formatTs(liveTrade.openedAt),
                    })}
                  </div>
                </div>
                <div className={styles.actionRow}>
                  <button
                    className={styles.secondaryButton}
                    disabled={reduceTrade.isPending || liveTrade.status !== 'open'}
                    onClick={() => reduceTrade.mutate({ tradeId: liveTrade.id, fraction: 0.5 })}
                  >
                    {t('reduce50')}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={liveTrade.status !== 'open'}
                    onClick={() =>
                      rollTradeInBuilder(liveTrade, replaceLegs, setUnderlying, setActiveTab)
                    }
                  >
                    {t('rollInBuilder')}
                  </button>
                  <button
                    className={styles.primaryButton}
                    disabled={closeTrade.isPending || liveTrade.status !== 'open'}
                    onClick={() => closeTrade.mutate(liveTrade.id)}
                  >
                    {t('closeTrade')}
                  </button>
                </div>
              </div>

              <div className={styles.metricGrid}>
                <MetricCard label={t('status')} value={liveTrade.status.toUpperCase()} />
                <MetricCard label={t('netPremium')} value={fmtUsd(liveTrade.netPremiumUsd)} />
                <MetricCard label={t('fees')} value={fmtUsd(liveTrade.feesUsd)} />
                <MetricCard
                  label={t('realizedNet')}
                  value={fmtUsd(liveTrade.realizedPnlUsd)}
                  tone={tone(liveTrade.realizedPnlUsd)}
                />
                <MetricCard
                  label={t('unrealized')}
                  value={fmtUsd(liveTrade.unrealizedPnlUsd)}
                  tone={tone(liveTrade.unrealizedPnlUsd)}
                />
                <MetricCard
                  label={t('totalPnl')}
                  value={fmtUsd(liveTrade.totalPnlUsd)}
                  tone={tone(liveTrade.totalPnlUsd)}
                />
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>{t('positionRisk')}</div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('leg')}</th>
                    <th className={styles.rightAlign}>{t('baseQty')}</th>
                    <th className={styles.rightAlign}>{t('avg')}</th>
                    <th className={styles.rightAlign}>{t('mark')}</th>
                    <th className={styles.rightAlign}>{t('dte')}</th>
                    <th className={styles.rightAlign}>{t('iv')}</th>
                    <th>{t('source')}</th>
                    <th className={styles.rightAlign}>{t('pnl')}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTrade.legs.map((leg) => (
                    <tr key={`${leg.expiry}-${leg.strike}-${leg.optionRight}`}>
                      <td>{formatLegSymbol(leg)}</td>
                      <td className={styles.rightAlign}>{fmtNum(leg.netQuantity, 4)}</td>
                      <td className={styles.rightAlign}>{fmtUsd(leg.avgEntryPriceUsd)}</td>
                      <td className={styles.rightAlign}>{fmtUsd(leg.markPriceUsd)}</td>
                      <td className={styles.rightAlign}>{dteDays(leg.expiry)}d</td>
                      <td className={styles.rightAlign}>{fmtIv(leg.markIv)}</td>
                      <td>{leg.marketSourceLabel}</td>
                      <td
                        className={`${styles.rightAlign} ${toneClass(leg.unrealizedPnlUsd) ? styles[toneClass(leg.unrealizedPnlUsd)!] : ''}`}
                      >
                        {fmtUsd(leg.totalPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.twoColumn}>
              <div className={styles.section}>
                <div className={styles.sectionHeader}>{t('executionDetails')}</div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('time')}</th>
                      <th>{t('venue')}</th>
                      <th>{t('leg')}</th>
                      <th className={styles.rightAlign}>{t('fill')}</th>
                      <th className={styles.rightAlign}>{t('mid')}</th>
                      <th className={styles.rightAlign}>{t('edge')}</th>
                      <th className={styles.rightAlign}>{t('fees')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveTrade.fills.map((fill) => {
                      const edge = executionEdge(fill);
                      return (
                        <tr key={fill.id}>
                          <td>{formatTs(fill.filledAt)}</td>
                          <td>{fill.venue.toUpperCase()}</td>
                          <td>{formatFillSymbol(fill)}</td>
                          <td className={styles.rightAlign}>{fmtUsd(fill.priceUsd)}</td>
                          <td className={styles.rightAlign}>{fmtUsd(fill.benchmarkMidUsd)}</td>
                          <td
                            className={`${styles.rightAlign} ${toneClass(edge) ? styles[toneClass(edge)!] : ''}`}
                          >
                            {fmtUsd(edge)}
                          </td>
                          <td className={styles.rightAlign}>{fmtUsd(fill.feesUsd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionHeader}>{t('tradeJournal')}</div>
                <div className={styles.noteComposer}>
                  <select
                    value={noteKind}
                    onChange={(event) => setNoteKind(event.target.value as typeof noteKind)}
                  >
                    <option value="note">{t('kindNote')}</option>
                    <option value="thesis">{t('kindThesis')}</option>
                    <option value="invalidation">{t('kindInvalidation')}</option>
                    <option value="review">{t('kindReview')}</option>
                  </select>
                  <input
                    value={noteTags}
                    onChange={(event) => setNoteTags(event.target.value)}
                    placeholder={t('tagsPlaceholder')}
                  />
                  <textarea
                    value={noteContent}
                    onChange={(event) => setNoteContent(event.target.value)}
                    placeholder={t('notePlaceholder')}
                  />
                  <button
                    className={styles.primaryButton}
                    disabled={addNote.isPending || noteContent.trim().length === 0}
                    onClick={() => {
                      if (!liveTrade || noteContent.trim().length === 0) return;
                      addNote.mutate(
                        {
                          tradeId: liveTrade.id,
                          content: {
                            kind: noteKind,
                            content: noteContent.trim(),
                            tags: noteTags
                              .split(',')
                              .map((tag) => tag.trim())
                              .filter(Boolean),
                          },
                        },
                        {
                          onSuccess: () => {
                            setNoteContent('');
                            setNoteTags('');
                          },
                        },
                      );
                    }}
                  >
                    {t('addNote')}
                  </button>
                </div>
                <div className={styles.noteList}>
                  {liveTrade.notes.map((note) => (
                    <div key={note.id} className={styles.noteCard}>
                      <div className={styles.noteHeader}>
                        <span>{t(NOTE_KIND_KEYS[note.kind]).toUpperCase()}</span>
                        <span>{formatTs(note.createdAt)}</span>
                      </div>
                      <div className={styles.noteBody}>{note.content}</div>
                      {note.tags.length > 0 && (
                        <div className={styles.tagRow}>
                          {note.tags.map((tag) => (
                            <span key={tag} className={styles.tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeader}>{t('tradeTimeline')}</div>
              <div className={styles.feedList}>
                {liveTrade.activity.map((item) => (
                  <div key={item.id} className={styles.feedItem}>
                    <div className={styles.feedSummary}>{item.summary}</div>
                    <div className={styles.feedMeta}>{formatTs(item.ts)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{t('closedTrades')}</span>
            <span>{closedTrades.length}</span>
          </div>
          {closedTrades.length === 0 ? (
            <div className={styles.empty}>{t('noClosedTrades')}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('trade')}</th>
                  <th>{t('status')}</th>
                  <th>{t('openedCol')}</th>
                  <th>{t('closedCol')}</th>
                  <th className={styles.rightAlign}>{t('premium')}</th>
                  <th className={styles.rightAlign}>{t('fees')}</th>
                  <th className={styles.rightAlign}>{t('realizedNet')}</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    onClick={() => setSelectedTradeId(trade.id)}
                    className={styles.clickRow}
                  >
                    <td>{trade.label}</td>
                    <td>{trade.status}</td>
                    <td>{formatTs(trade.openedAt)}</td>
                    <td>{formatTs(trade.closedAt)}</td>
                    <td className={styles.rightAlign}>{fmtUsd(trade.netPremiumUsd)}</td>
                    <td className={styles.rightAlign}>{fmtUsd(trade.feesUsd)}</td>
                    <td
                      className={`${styles.rightAlign} ${toneClass(trade.realizedPnlUsd) ? styles[toneClass(trade.realizedPnlUsd)!] : ''}`}
                    >
                      {fmtUsd(trade.realizedPnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${toneClassName(tone)}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={styles.miniLabel}>{label}</div>
      <div className={styles.miniValue}>{value}</div>
    </div>
  );
}

function PremiumFlowBadge({ netPremiumUsd }: { netPremiumUsd: number }) {
  const t = useT(messages);
  const kind = premiumFlowKind(netPremiumUsd);
  if (kind == null) return null;
  return (
    <span className={styles.premiumFlowBadge} data-kind={kind}>
      <span className={styles.premiumFlowLabel}>{kind === 'debit' ? t('debit') : t('credit')}</span>
      <span className={styles.premiumFlowValue}>{fmtUsd(Math.abs(netPremiumUsd))}</span>
    </span>
  );
}

function premiumFlowKind(netPremiumUsd: number): 'debit' | 'credit' | null {
  if (netPremiumUsd > 0) return 'debit';
  if (netPremiumUsd < 0) return 'credit';
  return null;
}

function executionEdge(fill: PaperFillDto): number | null {
  if (fill.benchmarkMidUsd == null) return null;
  return fill.side === 'buy'
    ? fill.benchmarkMidUsd - fill.priceUsd
    : fill.priceUsd - fill.benchmarkMidUsd;
}

function rollTradeInBuilder(
  trade: PaperTradeDetailDto,
  replaceLegs: (legs: StrategyLeg[], underlying: string) => void,
  setUnderlying: (underlying: string) => void,
  setActiveTab: (tab: TabId) => void,
) {
  const legs = trade.legs
    .filter((leg) => leg.netQuantity !== 0)
    .map(
      (leg, index): StrategyLeg => ({
        id: `roll-${trade.id}-${index}`,
        type: leg.optionRight,
        direction: leg.netQuantity > 0 ? 'buy' : 'sell',
        strike: leg.strike,
        expiry: leg.expiry,
        quantity: Math.abs(leg.netQuantity),
        entryPrice: leg.markPriceUsd ?? leg.avgEntryPriceUsd,
        venue: 'paper',
        delta: leg.delta,
        gamma: leg.gamma,
        theta: leg.theta,
        vega: leg.vega,
        iv: leg.markIv,
      }),
    );
  if (legs.length === 0) return;
  replaceLegs(legs, trade.underlying);
  setUnderlying(trade.underlying);
  setActiveTab('architect');
}

function formatLegSymbol(leg: PaperTradeLegDto): string {
  return `${leg.underlying} ${leg.expiry} ${leg.strike} ${leg.optionRight.toUpperCase()}`;
}

function formatFillSymbol(fill: PaperFillDto): string {
  return `${fill.side === 'buy' ? '+' : '-'}${fmtNum(fill.quantity, 4)} ${fill.underlying} ${fill.strike}${fill.optionRight === 'call' ? 'C' : 'P'}`;
}

function formatTs(value: string | null | undefined): string {
  if (!value) return '–';
  return new Date(value).toLocaleString();
}

function tone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value == null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function toneClass(value: number | null | undefined): 'positive' | 'negative' | null {
  const currentTone = tone(value);
  if (currentTone === 'neutral') return null;
  return currentTone;
}

function toneClassName(toneValue: 'positive' | 'negative' | 'neutral' | undefined): string {
  if (toneValue === 'positive') return styles.positive ?? '';
  if (toneValue === 'negative') return styles.negative ?? '';
  return '';
}
