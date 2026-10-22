import { useState } from 'react';

import { defineMessages, intlLocale, type Locale, useLocale, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import type { NormalizedOptionContract } from '@shared/common';

import { contractToExecution } from './build-execution';
import { computeExecutionCost, rankExecutions } from './compute-execution';
import type { OrderSide, OptionSide, ExecutionCost, VenueExecution } from './types';
import styles from './OptionBuilder.module.css';

const messages = defineMessages(
  {
    save: 'save {amount} ({pct}%)',
    best: 'BEST',
    entryPrice: 'Entry price',
    premium: 'Premium',
    spreadCost: 'Spread cost',
    takerFee: 'Taker fee',
    avail: '{size} avail',
    slippageRisk: 'slippage risk',
    execution: 'Execution',
    call: 'Call',
    put: 'Put',
    buy: 'Buy',
    sell: 'Sell',
    qty: 'Qty',
    noPricing: 'No venue has pricing for this contract',
    summaryBefore: 'Best execution on ',
    summaryMid: ' saves',
    summaryAfter: 'vs worst venue',
  },
  {
    save: 'ahorra {amount} ({pct}%)',
    best: 'MEJOR',
    entryPrice: 'Precio de entrada',
    premium: 'Prima',
    spreadCost: 'Costo del spread',
    takerFee: 'Comisión taker',
    avail: '{size} disp.',
    slippageRisk: 'riesgo de slippage',
    execution: 'Ejecución',
    call: 'Call',
    put: 'Put',
    buy: 'Comprar',
    sell: 'Vender',
    qty: 'Cant.',
    noPricing: 'Ningún exchange tiene precio para este contrato',
    summaryBefore: 'La mejor ejecución en ',
    summaryMid: ' ahorra',
    summaryAfter: 'vs el peor exchange',
  },
);

interface OptionBuilderProps {
  underlying: string;
  expiry: string;
  strike: number;
  initialSide: OptionSide;
  callContracts: Record<string, NormalizedOptionContract>;
  putContracts: Record<string, NormalizedOptionContract>;
  underlyingPrice: number;
  onClose: () => void;
}

function fmtUsdExec(v: number): string {
  if (v >= 100) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  return '$' + v.toFixed(4);
}

function formatExpiry(iso: string, locale: Locale): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface SavingsBadgeProps {
  best: number;
  current: number;
}

function SavingsBadge({ best, current }: SavingsBadgeProps) {
  const t = useT(messages);
  if (current <= best) return null;
  const saved = current - best;
  const pctSaved = (saved / current) * 100;
  return (
    <span className={styles.savingsBadge}>
      {t('save', { amount: fmtUsdExec(saved), pct: pctSaved.toFixed(1) })}
    </span>
  );
}

interface ExecutionCardProps {
  exec: ExecutionCost;
  rank: number;
  bestCost: number;
  orderSide: OrderSide;
}

function ExecutionCard({ exec, rank, bestCost, orderSide }: ExecutionCardProps) {
  const t = useT(messages);
  const meta = VENUES[exec.venue];
  const isBest = rank === 0;
  const isSell = orderSide === 'sell';

  return (
    <div className={styles.execCard} data-best={isBest}>
      <div className={styles.execHeader}>
        <div className={styles.execVenue}>
          {meta && <img src={meta.logo} alt={meta.label} className={styles.execLogo} />}
          <span className={styles.execName}>{meta?.label ?? exec.venue}</span>
          {isBest && <span className={styles.bestTag}>{t('best')}</span>}
        </div>
        <span className={isSell ? styles.totalProfit : styles.totalCost}>
          {isSell ? '+' : ''}
          {fmtUsdExec(Math.abs(exec.totalCostUsd))}
        </span>
      </div>
      {!isBest && (
        <div className={styles.savingsRow}>
          <SavingsBadge best={bestCost} current={exec.totalCostUsd} />
        </div>
      )}

      <div className={styles.execBreakdown}>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>{t('entryPrice')}</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.entryPrice)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>{t('premium')}</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.premiumUsd)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>{t('spreadCost')}</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.spreadCostUsd)}</span>
        </div>
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>{t('takerFee')}</span>
          <span className={styles.breakdownValue}>{fmtUsdExec(exec.feeUsd)}</span>
        </div>
      </div>

      <div className={styles.execFooter}>
        {exec.sizeAvailable != null && (
          <span className={exec.fillable ? styles.sizeOk : styles.sizeWarn}>
            {exec.fillable ? '✓' : '⚠'} {t('avail', { size: exec.sizeAvailable.toFixed(1) })}
          </span>
        )}
        {exec.slippageWarning && <span className={styles.slippageWarn}>{t('slippageRisk')}</span>}
      </div>
    </div>
  );
}

export default function OptionBuilder({
  underlying,
  expiry,
  strike,
  initialSide,
  callContracts,
  putContracts,
  underlyingPrice,
  onClose,
}: OptionBuilderProps) {
  const t = useT(messages);
  const locale = useLocale();
  const [optionSide, setOptionSide] = useState<OptionSide>(initialSide);
  const [orderSide, setOrderSide] = useState<OrderSide>('buy');
  const [quantity, setQuantity] = useState(1);

  const contracts = optionSide === 'call' ? callContracts : putContracts;

  const executions = Object.values(contracts)
    .map((contract) => contractToExecution(contract, underlyingPrice))
    .filter((execution): execution is VenueExecution => execution != null);

  const costs = executions.map((ve) => computeExecutionCost(ve, orderSide, quantity));
  const ranked = rankExecutions(costs);
  const bestCost = ranked[0]?.totalCostUsd ?? 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>{t('execution')}</span>
          <span className={styles.contract}>
            {underlying} · {strike.toLocaleString()} · {formatExpiry(expiry, locale)}
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.controls}>
        <div className={styles.toggleGroup}>
          <button
            className={styles.toggleBtn}
            data-active={optionSide === 'call'}
            data-variant="call"
            onClick={() => setOptionSide('call')}
          >
            {t('call')}
          </button>
          <button
            className={styles.toggleBtn}
            data-active={optionSide === 'put'}
            data-variant="put"
            onClick={() => setOptionSide('put')}
          >
            {t('put')}
          </button>
        </div>

        <div className={styles.toggleGroup}>
          <button
            className={styles.toggleBtn}
            data-active={orderSide === 'buy'}
            onClick={() => setOrderSide('buy')}
          >
            {t('buy')}
          </button>
          <button
            className={styles.toggleBtn}
            data-active={orderSide === 'sell'}
            onClick={() => setOrderSide('sell')}
          >
            {t('sell')}
          </button>
        </div>

        <div className={styles.qtyGroup}>
          <label className={styles.qtyLabel}>{t('qty')}</label>
          <input
            type="number"
            className={styles.qtyInput}
            value={quantity}
            min={0.01}
            step={0.1}
            onChange={(e) => setQuantity(Math.max(0.01, Number(e.target.value)))}
          />
        </div>
      </div>

      <div className={styles.execList}>
        {ranked.length === 0 && (
          <div className={styles.noData}>{t('noPricing')}</div>
        )}
        {ranked.map((exec, i) => (
          <ExecutionCard
            key={exec.venue}
            exec={exec}
            rank={i}
            bestCost={bestCost}
            orderSide={orderSide}
          />
        ))}
      </div>

      {ranked.length >= 2 && (
        <div className={styles.summary}>
          <span className={styles.summaryText}>
            {t('summaryBefore')}
            <strong>{VENUES[ranked[0]!.venue]?.label}</strong>
            {t('summaryMid')}{' '}
            <strong className={styles.summaryGreen}>
              {fmtUsdExec(ranked[ranked.length - 1]!.totalCostUsd - ranked[0]!.totalCostUsd)}
            </strong>{' '}
            {t('summaryAfter')}
          </span>
        </div>
      )}
    </div>
  );
}
