import { ChallengePanel, useFundedRun } from '@features/funded';
import { fmtDelta, fmtNum, fmtUsd } from '@lib/format';
import { useAppStore } from '@stores/app-store';
import { useEffect, useState } from 'react';
import AccountContextPicker from './AccountContextPicker';
import { setPaperAccountScope } from './api';
import { useInitPaperAccount, useOverview, usePaperAccount } from './hooks/queries';
import { usePaperWs } from './hooks/usePaperWs';
import PaperTraderPanel from './PaperTraderPanel';
import ThalexLivePanel from './ThalexLivePanel';
import styles from './TradingView.module.css';

export default function TradingView() {
  const activeContext = useAppStore((s) => s.activeContext);
  const { data: paperAccount } = usePaperAccount();
  const { data: overview } = useOverview();
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [capitalInput, setCapitalInput] = useState('1000');
  const wsState = usePaperWs();
  const initPaperAccount = useInitPaperAccount();
  const [showRefreshPrompt, setShowRefreshPrompt] = useState(false);

  const challengeRunId = activeContext.kind === 'challenge' ? (activeContext.runId ?? null) : null;
  const { data: challengeRun } = useFundedRun(challengeRunId);

  useEffect(() => {
    if (activeContext.kind === 'challenge') {
      setPaperAccountScope(challengeRun?.paperAccountId ?? null);
    } else {
      setPaperAccountScope(null);
    }
  }, [activeContext.kind, challengeRun?.paperAccountId]);

  useEffect(() => {
    if (wsState === 'error') {
      setShowRefreshPrompt(true);
    }
  }, [wsState]);

  useEffect(() => {
    if (paperAccount) {
      setCapitalInput(String(Math.round(paperAccount.initialCashUsd)));
    }
  }, [paperAccount]);

  const selectedCapital = parseCapital(capitalInput);
  const isConfigured = paperAccount?.isInitialized ?? false;

  return (
    <div className={styles.view}>
      {showRefreshPrompt && (
        <div className={styles.refreshBanner}>
          <span>Server restarted. Please refresh to sync.</span>
          <button
            className={styles.primaryButton}
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </button>
        </div>
      )}
      <div className={styles.header}>
        <HeaderStat label="Equity" value={fmtUsd(overview?.pnl.equityUsd ?? null)} />
        <HeaderStat label="Cash" value={fmtUsd(overview?.pnl.cashUsd ?? null)} />
        <HeaderStat
          label="Realized PnL"
          value={fmtUsd(overview?.pnl.realizedUsd ?? null)}
          tone={tone(overview?.pnl.realizedUsd)}
        />
        <HeaderStat
          label="Unrealized PnL"
          value={fmtUsd(overview?.pnl.unrealizedUsd ?? null)}
          tone={tone(overview?.pnl.unrealizedUsd)}
        />
        <HeaderStat label="Delta" value={fmtDelta(overview?.risk.delta ?? null)} />
        <HeaderStat label="Gamma" value={fmtNum(overview?.risk.gamma ?? null, 4)} />
        <HeaderStat label="Theta" value={fmtUsd(overview?.risk.theta ?? null)} />
        <HeaderStat label="Vega" value={fmtUsd(overview?.risk.vega ?? null)} />
        <HeaderStat
          label="Sync"
          value={wsLabel(wsState)}
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
              : 'Paper account not initialized'}
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
            aria-label="Capital"
          />
          <button
            className={styles.accountFooterButton}
            disabled={initPaperAccount.isPending || selectedCapital == null}
            onClick={() => {
              if (selectedCapital == null) return;
              if (
                isConfigured &&
                !window.confirm(
                  `Reset paper account to ${fmtUsd(selectedCapital)}? This clears current paper history.`,
                )
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
            {isConfigured ? 'Reset' : 'Initialize'}
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

function wsLabel(state: 'connecting' | 'live' | 'closed' | 'error'): string {
  switch (state) {
    case 'live':
      return 'Live';
    case 'connecting':
      return 'Reconnecting';
    case 'error':
      return 'Error';
    case 'closed':
      return 'Closed';
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
