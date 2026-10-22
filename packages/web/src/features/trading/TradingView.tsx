import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { ChallengePanel, useFundedRun } from '@features/funded';
import { fmtDelta, fmtNum, fmtUsd } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import AccountContextPicker from './AccountContextPicker';
import { setPaperAccountScope } from './api';
import { useInitPaperAccount, useOverview, usePaperAccount } from './hooks/queries';
import { usePaperWs } from './hooks/usePaperWs';
import PaperTraderPanel from './PaperTraderPanel';
import ThalexLivePanel from './ThalexLivePanel';
import styles from './TradingView.module.css';

const messages = defineMessages(
  {
    equity: 'Equity',
    cash: 'Cash',
    totalPnl: 'Total PnL',
    realizedNet: 'Realized (net)',
    unrealizedPnl: 'Unrealized PnL',
    fees: 'Fees',
    sync: 'Sync',
    notInitialized: 'Paper account not initialized',
    capital: 'Capital',
    resetConfirm: 'Reset paper account to {amount}? This clears current paper history.',
    reset: 'Reset',
    initialize: 'Initialize',
    live: 'Live',
    reconnecting: 'Reconnecting',
    error: 'Error',
    closed: 'Closed',
  },
  {
    equity: 'Patrimonio',
    cash: 'Efectivo',
    totalPnl: 'PnL total',
    realizedNet: 'Realizado (neto)',
    unrealizedPnl: 'PnL no realizado',
    fees: 'Comisiones',
    sync: 'Sincr.',
    notInitialized: 'Cuenta paper sin inicializar',
    capital: 'Capital',
    resetConfirm: '¿Reiniciar la cuenta paper a {amount}? Esto borra el historial paper actual.',
    reset: 'Reiniciar',
    initialize: 'Inicializar',
    live: 'En vivo',
    reconnecting: 'Reconectando',
    error: 'Error',
    closed: 'Cerrado',
  },
);

export default function TradingView() {
  const t = useT(messages);
  const activeContext = useAppStore((s) => s.activeContext);
  const accountSession = useAccountSession();
  const queryClient = useQueryClient();
  const { data: paperAccount } = usePaperAccount();
  const { data: overview } = useOverview();
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [capitalInput, setCapitalInput] = useState('1000');
  const initPaperAccount = useInitPaperAccount();

  const challengeRunId = activeContext.kind === 'challenge' ? (activeContext.runId ?? null) : null;
  const { data: challengeRun } = useFundedRun(challengeRunId);

  const activeScope =
    activeContext.kind === 'challenge' ? (challengeRun?.paperAccountId ?? null) : null;
  const wsState = usePaperWs(activeScope);

  useEffect(() => {
    setPaperAccountScope(activeScope);
    if (accountSession.accountId) {
      const cacheAccountId = activeScope ?? accountSession.accountId;
      void queryClient.invalidateQueries({
        queryKey: ['account', cacheAccountId, 'paper'],
      });
    }
    return () => setPaperAccountScope(null);
  }, [accountSession.accountId, activeScope, queryClient]);

  useEffect(() => {
    if (paperAccount) {
      setCapitalInput(String(Math.round(paperAccount.initialCashUsd)));
    }
  }, [paperAccount]);

  const selectedCapital = parseCapital(capitalInput);
  const isConfigured = paperAccount?.isInitialized ?? false;

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <HeaderStat label={t('equity')} value={fmtUsd(overview?.pnl.equityUsd ?? null)} />
        <HeaderStat label={t('cash')} value={fmtUsd(overview?.pnl.cashUsd ?? null)} />
        <HeaderStat
          label={t('totalPnl')}
          value={fmtUsd(overview?.pnl.totalUsd ?? null)}
          tone={tone(overview?.pnl.totalUsd)}
        />
        <HeaderStat
          label={t('realizedNet')}
          value={fmtUsd(overview?.pnl.realizedUsd ?? null)}
          tone={tone(overview?.pnl.realizedUsd)}
        />
        <HeaderStat
          label={t('unrealizedPnl')}
          value={fmtUsd(overview?.pnl.unrealizedUsd ?? null)}
          tone={tone(overview?.pnl.unrealizedUsd)}
        />
        <HeaderStat label={t('fees')} value={fmtUsd(overview?.pnl.feesUsd ?? null)} />
        <HeaderStat label="Delta" value={fmtDelta(overview?.risk.delta ?? null)} />
        <HeaderStat label="Gamma" value={fmtNum(overview?.risk.gamma ?? null, 4)} />
        <HeaderStat label="Theta" value={fmtUsd(overview?.risk.theta ?? null)} />
        <HeaderStat label="Vega" value={fmtUsd(overview?.risk.vega ?? null)} />
        <HeaderStat
          label={t('sync')}
          value={wsLabel(wsState, t)}
          tone={wsState === 'live' ? 'positive' : 'neutral'}
        />
        <div className={styles.headerPicker}>
          <AccountContextPicker />
        </div>
      </div>

      <div className={styles.workspace}>
        {activeContext.kind === 'paper' && (
          <PaperTraderPanel
            selectedTradeId={selectedTradeId}
            setSelectedTradeId={setSelectedTradeId}
          />
        )}
        {activeContext.kind === 'challenge' && <ChallengePanel runId={challengeRunId} />}
        {activeContext.kind === 'thalex' && <ThalexLivePanel />}
      </div>

      {activeContext.kind === 'paper' && (
        <footer className={styles.accountFooter}>
          <span className={styles.accountFooterLabel}>
            {isConfigured
              ? `${paperAccount?.label ?? 'Paper'} · ${fmtUsd(paperAccount?.initialCashUsd ?? null)}`
              : t('notInitialized')}
          </span>
          <span className={styles.accountFooterSep}>·</span>
          <input
            className={styles.accountFooterInput}
            type="number"
            min={1000}
            max={100000}
            step={1000}
            inputMode="numeric"
            value={capitalInput}
            onChange={(event) => setCapitalInput(event.target.value)}
            aria-label={t('capital')}
          />
          <button
            className={styles.accountFooterButton}
            disabled={initPaperAccount.isPending || selectedCapital == null}
            onClick={() => {
              if (selectedCapital == null) return;
              if (
                isConfigured &&
                !window.confirm(t('resetConfirm', { amount: fmtUsd(selectedCapital) }))
              ) {
                return;
              }
              initPaperAccount.mutate(
                { initialCashUsd: selectedCapital },
                {
                  onSuccess: () => {
                    setSelectedTradeId(null);
                  },
                },
              );
            }}
          >
            {isConfigured ? t('reset') : t('initialize')}
          </button>
        </footer>
      )}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div>
      <div className={styles.headerLabel}>{label}</div>
      <div className={`${styles.headerValue} ${toneClassName(tone)}`}>{value}</div>
    </div>
  );
}

function wsLabel(
  state: 'connecting' | 'live' | 'closed' | 'error',
  t: Translate<typeof messages.en>,
): string {
  switch (state) {
    case 'live':
      return t('live');
    case 'connecting':
      return t('reconnecting');
    case 'error':
      return t('error');
    case 'closed':
      return t('closed');
  }
}

function tone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value == null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function toneClassName(toneValue: 'positive' | 'negative' | 'neutral' | undefined): string {
  if (toneValue === 'positive') return styles.positive ?? '';
  if (toneValue === 'negative') return styles.negative ?? '';
  return '';
}

function parseCapital(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount < 1_000 || amount > 100_000) return null;
  if (amount % 1_000 !== 0) return null;
  return amount;
}
