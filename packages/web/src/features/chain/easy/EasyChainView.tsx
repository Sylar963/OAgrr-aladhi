import { computeMetrics, detectStrategy, type Leg, useStrategyStore } from '@features/architect';
import { dteDays } from '@lib/format';
import { useT } from '@lib/i18n';
import type { EnrichedChainResponse } from '@shared/enriched';
import { useAppStore } from '@stores/app-store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bestBidAsk } from '../quote-selection';
import styles from './EasyChain.module.css';
import EasyOptionList, { draftKey } from './EasyOptionList';
import EasyPayoffChart from './EasyPayoffChart';
import EasyPositionPanel from './EasyPositionPanel';
import EasyTollPreview from './EasyTollPreview';
import { chanceOfProfit, type EasyLegDraft, profitZones } from './easy-explain';
import { easyBuyPreview } from './easy-toll';
import { easyMessages } from './i18n';

interface EasyChainViewProps {
  chain: EnrichedChainResponse;
  underlying: string;
  activeVenues: string[];
}

const NOTICE_MS = 4000;

export default function EasyChainView({ chain, underlying, activeVenues }: EasyChainViewProps) {
  const t = useT(easyMessages);
  const storeUnderlying = useStrategyStore((s) => s.underlying);
  const storeLegs = useStrategyStore((s) => s.legs);
  const addLeg = useStrategyStore((s) => s.addLeg);
  const updateLeg = useStrategyStore((s) => s.updateLeg);
  const removeLeg = useStrategyStore((s) => s.removeLeg);
  const clearLegs = useStrategyStore((s) => s.clearLegs);
  const navigateToWidget = useAppStore((s) => s.navigateToWidget);

  const [upCollapsed, setUpCollapsed] = useState(false);
  const [downCollapsed, setDownCollapsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    underlying: string;
    expiry: string;
    type: 'call' | 'put';
    strike: number;
  } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const legs = useMemo(
    () => (storeUnderlying === underlying ? storeLegs : []),
    [storeUnderlying, storeLegs, underlying],
  );
  const activeSet = useMemo(() => new Set(activeVenues), [activeVenues]);
  const spot = chain.stats.indexPriceUsd ?? chain.stats.forwardPriceUsd;
  const forward = chain.stats.forwardPriceUsd ?? spot;
  const preview = useMemo(() => {
    const target =
      previewTarget?.underlying === underlying && previewTarget.expiry === chain.expiry
        ? previewTarget
        : null;
    if (target) {
      const row = chain.strikes.find((s) => s.strike === target.strike);
      return row
        ? easyBuyPreview(target.type, row.strike, row[target.type], activeSet, spot)
        : null;
    }
    if (spot == null) return null;
    const nearest = [...chain.strikes].sort(
      (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
    );
    for (const row of nearest) {
      const available = easyBuyPreview('call', row.strike, row.call, activeSet, spot);
      if (available) return available;
    }
    return null;
  }, [previewTarget, underlying, chain, activeSet, spot]);
  const handlePreview = useCallback(
    (draft: EasyLegDraft) => {
      setPreviewTarget((current) =>
        current?.underlying === underlying &&
        current.expiry === chain.expiry &&
        current.type === draft.type &&
        current.strike === draft.strike
          ? current
          : { underlying, expiry: chain.expiry, type: draft.type, strike: draft.strike },
      );
    },
    [underlying, chain.expiry],
  );

  const quote = useCallback(
    (draft: EasyLegDraft): Omit<Leg, 'id'> | null => {
      const row = chain.strikes.find((s) => s.strike === draft.strike);
      if (!row) return null;
      const side = draft.type === 'call' ? row.call : row.put;
      const bba = bestBidAsk(side, activeSet);
      const price = draft.direction === 'buy' ? bba.ask : bba.bid;
      const venue = draft.direction === 'buy' ? bba.askVenue : bba.bidVenue;
      if (price == null || venue == null) return null;
      const q = side.venues[venue as keyof typeof side.venues];
      return {
        type: draft.type,
        direction: draft.direction,
        strike: draft.strike,
        expiry: chain.expiry,
        quantity: 1,
        entryPrice: price,
        venue,
        delta: q?.delta ?? null,
        gamma: q?.gamma ?? null,
        theta: q?.theta ?? null,
        vega: q?.vega ?? null,
        iv: q?.markIv ?? null,
      };
    },
    [chain, activeSet],
  );

  const handleAdd = useCallback(
    (draft: EasyLegDraft) => {
      const leg = quote(draft);
      if (!leg) {
        setNotice(t('noLiveQuoteAdd', { side: draft.direction === 'buy' ? 'ask' : 'bid' }));
        return;
      }
      const existing = legs.find(
        (l) =>
          l.expiry === chain.expiry &&
          l.strike === draft.strike &&
          l.type === draft.type &&
          l.direction === draft.direction &&
          l.venue === leg.venue &&
          l.entryPrice === leg.entryPrice,
      );
      if (existing) {
        updateLeg(existing.id, { quantity: existing.quantity + 1 });
        return;
      }
      addLeg(leg, underlying);
    },
    [legs, chain.expiry, quote, updateLeg, addLeg, underlying, t],
  );

  const handleFlip = useCallback(
    (leg: Leg) => {
      const direction = leg.direction === 'buy' ? 'sell' : 'buy';
      const fresh =
        leg.expiry === chain.expiry
          ? quote({ type: leg.type, direction, strike: leg.strike })
          : null;
      if (leg.expiry === chain.expiry && !fresh) {
        setNotice(
          t('noLiveQuoteFlip', {
            side: direction === 'buy' ? 'ask' : 'bid',
            direction: direction === 'buy' ? t('switchToBuyVerb') : t('switchToSellVerb'),
          }),
        );
        return;
      }
      updateLeg(leg.id, {
        direction,
        ...(fresh ? { entryPrice: fresh.entryPrice, venue: fresh.venue } : {}),
      });
    },
    [chain.expiry, quote, updateLeg, t],
  );

  const metrics = useMemo(
    () => (legs.length > 0 && spot != null ? computeMetrics(legs, spot) : null),
    [legs, spot],
  );
  const breakevens = useMemo(() => metrics?.breakevens ?? [], [metrics]);
  const zones = useMemo(
    () => (spot != null ? profitZones(legs, breakevens, spot) : []),
    [legs, breakevens, spot],
  );
  const mixedExpiries = new Set(legs.map((l) => l.expiry)).size > 1;
  const dte = dteDays(chain.expiry, chain.expiryTs);
  const chance =
    !mixedExpiries && forward != null && legs[0]?.expiry === chain.expiry
      ? chanceOfProfit(zones, forward, chain.stats.atmIv, Math.max(dte, 1 / 24) / 365)
      : null;

  const heldKeys = useMemo(
    () =>
      new Set(
        legs
          .filter((l) => l.expiry === chain.expiry)
          .map((l) => draftKey({ type: l.type, direction: l.direction, strike: l.strike })),
      ),
    [legs, chain.expiry],
  );

  const expiryMs = chain.expiryTs ?? Date.parse(`${chain.expiry}T08:00:00Z`);

  return (
    <div
      className={styles.layout}
      data-up-collapsed={upCollapsed}
      data-down-collapsed={downCollapsed}
    >
      <EasyOptionList
        type="call"
        underlying={underlying}
        strikes={chain.strikes}
        indexPrice={spot}
        activeSet={activeSet}
        heldKeys={heldKeys}
        collapsed={upCollapsed}
        onToggleCollapsed={() => setUpCollapsed((v) => !v)}
        onAdd={handleAdd}
        preview={preview}
        onPreview={handlePreview}
      />

      <div className={styles.center}>
        <EasyPayoffChart
          underlying={underlying}
          expiry={chain.expiry}
          expiryMs={expiryMs}
          legs={legs}
          zones={zones}
          breakevens={breakevens}
          spot={spot}
          onDropDraft={handleAdd}
          preview={preview}
        />
        <EasyTollPreview preview={preview} underlying={underlying} />
        <EasyPositionPanel
          underlying={underlying}
          legs={legs}
          metrics={metrics}
          strategyName={legs.length > 0 ? detectStrategy(legs) : ''}
          chance={chance}
          mixedExpiries={mixedExpiries}
          notice={notice}
          onQuantity={(leg, quantity) => updateLeg(leg.id, { quantity: Math.max(1, quantity) })}
          onFlip={handleFlip}
          onRemove={(leg) => removeLeg(leg.id)}
          onClear={clearLegs}
          onOpenBuilder={() => navigateToWidget('architect')}
        />
      </div>

      <EasyOptionList
        type="put"
        underlying={underlying}
        strikes={chain.strikes}
        indexPrice={spot}
        activeSet={activeSet}
        heldKeys={heldKeys}
        collapsed={downCollapsed}
        onToggleCollapsed={() => setDownCollapsed((v) => !v)}
        onAdd={handleAdd}
        preview={preview}
        onPreview={handlePreview}
      />
    </div>
  );
}
