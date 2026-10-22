import { defineMessages, type Translate, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import { useState } from 'react';
import { z } from 'zod';
import styles from './SpreadBuilderPanel.module.css';
import type { AlphaMarket } from './useAlphaMarketData';
import { formatQuantity, type VenueSizeRule } from './venue-sizing';

const messages = defineMessages(
  {
    yourTradeSize: 'Your trade size',
    tradeVenue: 'Trade venue',
    markOnly: ' (mark only)',
    equity: 'Account equity · USD',
    quantity: 'Quantity · {unit} per leg',
    riskPct: 'Max loss budget · % of equity',
    reserve: 'Exit / settlement / slippage reserve · USD',
    tradfiUnit: '{underlying} shares (100 = 1 contract)',
    autoHint: 'Auto: each venue uses the size its book fills best. Type to fix one size for all.',
    fixedHint: 'Fixed for every venue ·',
    autoSize: 'Auto-size per venue',
    minimum: '{venue} minimum {min} · step',
    use: 'Use {value}',
    equityNote:
      'Equity is manual, not your live balance. 1% and $0.25 are editable planning examples, not recommended limits or verified costs. Check free margin on the venue.',
  },
  {
    yourTradeSize: 'Tamaño de tu trade',
    tradeVenue: 'Exchange de ejecución',
    markOnly: ' (solo mark)',
    equity: 'Capital de la cuenta · USD',
    quantity: 'Cantidad · {unit} por pata',
    riskPct: 'Presupuesto de pérdida máx. · % del capital',
    reserve: 'Reserva de salida / liquidación / slippage · USD',
    tradfiUnit: 'acciones de {underlying} (100 = 1 contrato)',
    autoHint:
      'Auto: cada exchange usa el tamaño que mejor llena su libro. Escribe para fijar un tamaño para todos.',
    fixedHint: 'Fijo para todos los exchanges ·',
    autoSize: 'Tamaño automático por exchange',
    minimum: '{venue} mínimo {min} · paso',
    use: 'Usar {value}',
    equityNote:
      'El capital es manual, no tu saldo en vivo. 1% y $0.25 son ejemplos de planificación editables, no límites recomendados ni costos verificados. Revisa el margen libre en el exchange.',
  },
);

export interface AlphaSizing {
  equity: string;
  quantity: string;
  riskPct: string;
  reserve: string;
}

const SIZING: Record<
  AlphaMarket,
  {
    storageKey: string;
    defaults: AlphaSizing;
    unit: (underlying: string, t: Translate<typeof messages.en>) => string;
  }
> = {
  crypto: {
    storageKey: 'alpha-sizing-v1',
    defaults: { equity: '', quantity: '0.01', riskPct: '1', reserve: '0.25' },
    unit: (underlying) => underlying,
  },
  tradfi: {
    storageKey: 'alpha-sizing-tradfi-v1',
    defaults: { equity: '', quantity: '100', riskPct: '1', reserve: '0.25' },
    unit: (underlying, t) => t('tradfiUnit', { underlying }),
  },
};
const sizingSchema = z.object({
  equity: z.string(),
  quantity: z.string(),
  riskPct: z.string(),
  reserve: z.string(),
  quantities: z.record(z.string(), z.string()).optional(),
});
type StoredSizing = AlphaSizing & { quantities: Record<string, string> };

function loadSizing(market: AlphaMarket): StoredSizing {
  const { storageKey, defaults } = SIZING[market];
  try {
    const stored = sizingSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    if (stored.success) {
      const { quantities, ...rest } = stored.data;
      // v1 kept one quantity for every ticker; it was sized for BTC/ETH, so it only carries over there.
      const legacy =
        quantities ?? (market === 'crypto' ? { BTC: rest.quantity, ETH: rest.quantity } : {});
      return { ...rest, quantities: legacy };
    }
  } catch {}
  return { ...defaults, quantities: {} };
}

/**
 * Equity, risk and reserve are account-wide; quantity is per underlying because coin units
 * differ by orders of magnitude (0.01 BTC vs 1 SOL vs 100 DOGE). Until the user sets one,
 * the quantity is auto and the caller substitutes a venue-suggested size for the fallback.
 */
export function useAlphaSizing(market: AlphaMarket, underlying: string) {
  const { storageKey, defaults } = SIZING[market];
  const [stored, setStored] = useState<StoredSizing>(() => loadSizing(market));
  const fallback = market === 'tradfi' ? stored.quantity : defaults.quantity;
  const sizing: AlphaSizing = {
    equity: stored.equity,
    riskPct: stored.riskPct,
    reserve: stored.reserve,
    quantity: stored.quantities[underlying] ?? fallback,
  };
  const quantityIsAuto = stored.quantities[underlying] == null;
  function persist(change: (previous: StoredSizing) => StoredSizing) {
    setStored((previous) => {
      const next = change(previous);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function update(key: keyof AlphaSizing, value: string) {
    persist((previous) =>
      key === 'quantity'
        ? { ...previous, quantities: { ...previous.quantities, [underlying]: value } }
        : { ...previous, [key]: value },
    );
  }
  function resetQuantity() {
    persist((previous) => {
      const { [underlying]: _cleared, ...quantities } = previous.quantities;
      return { ...previous, quantities };
    });
  }
  return { sizing, update, quantityIsAuto, resetQuantity };
}

export default function AlphaTradeSizing({
  sizing,
  update,
  venue,
  venues,
  onVenue,
  underlying,
  market,
  sizeRule,
  quantityIsAuto,
  onAutoQuantity,
  markOnlyVenues,
}: {
  sizing: AlphaSizing;
  update: (key: keyof AlphaSizing, value: string) => void;
  venue: VenueId;
  venues: readonly VenueId[];
  onVenue: (venue: VenueId) => void;
  underlying: string;
  market: AlphaMarket;
  sizeRule: VenueSizeRule | null;
  quantityIsAuto: boolean;
  onAutoQuantity: () => void;
  markOnlyVenues?: ReadonlySet<VenueId>;
}) {
  const t = useT(messages);
  const { defaults, unit } = SIZING[market];
  const quantity = Number(sizing.quantity);
  const offRule =
    sizeRule != null &&
    Number.isFinite(quantity) &&
    (quantity < sizeRule.min ||
      Math.abs(quantity / sizeRule.step - Math.round(quantity / sizeRule.step)) > 1e-7);
  return (
    <div className={styles.block}>
      <div className={styles.label}>{t('yourTradeSize')}</div>
      <label className={styles.hint}>
        {t('tradeVenue')}
        <select
          className={styles.select}
          value={venue}
          onChange={(e) => onVenue(e.target.value as VenueId)}
        >
          {venues.map((v) => (
            <option key={v} value={v}>
              {VENUES[v]?.label ?? v}
              {markOnlyVenues?.has(v) ? t('markOnly') : ''}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ['equity', t('equity'), '1080'],
          ['quantity', t('quantity', { unit: unit(underlying, t) }), defaults.quantity],
          ['riskPct', t('riskPct'), '1'],
          ['reserve', t('reserve'), '0.25'],
        ] as const
      ).map(([key, label, placeholder]) => (
        <label key={key} className={styles.hint}>
          {label}
          <input
            className={styles.select}
            type="number"
            min="0"
            step="any"
            placeholder={placeholder}
            value={sizing[key]}
            onChange={(e) => update(key, e.target.value)}
          />
          {key === 'quantity' && market === 'crypto' && (
            <span>
              {quantityIsAuto ? (
                t('autoHint')
              ) : (
                <>
                  {t('fixedHint')}{' '}
                  <button type="button" className={styles.inlineAction} onClick={onAutoQuantity}>
                    {t('autoSize')}
                  </button>
                </>
              )}
            </span>
          )}
          {key === 'quantity' && sizeRule != null && (
            <span data-invalid={offRule || undefined}>
              {t('minimum', {
                venue: VENUES[venue]?.label ?? venue,
                min: formatQuantity(sizeRule.min),
              })}{' '}
              {formatQuantity(sizeRule.step)}
              {offRule && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className={styles.inlineAction}
                    onClick={() => update('quantity', formatQuantity(sizeRule.min))}
                  >
                    {t('use', { value: formatQuantity(sizeRule.min) })}
                  </button>
                </>
              )}
            </span>
          )}
        </label>
      ))}
      <p className={styles.hint}>
        {t('equityNote')}
      </p>
    </div>
  );
}
