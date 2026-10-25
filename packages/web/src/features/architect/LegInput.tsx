import { useState, useRef, useEffect } from 'react';

import type { EnrichedChainResponse } from '@shared/enriched';
import { DropdownPicker } from '@components/ui';
import { formatExpiry, dteDays } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { useStrategyStore } from './strategy-store';
import { repriceLeg } from './reprice';
import styles from './Architect.module.css';

const messages = defineMessages(
  {
    buy: 'BUY',
    sell: 'SELL',
    baseQty: 'Base qty',
    strike: 'Strike',
    entry: 'Entry',
    add: '+ Add',
  },
  {
    buy: 'COMPRA',
    sell: 'VENTA',
    baseQty: 'Cant. base',
    strike: 'Strike',
    entry: 'Entrada',
    add: '+ Agregar',
  },
);

interface LegInputProps {
  chain: EnrichedChainResponse | null;
  expiry: string;
  expiries: string[];
  underlying: string;
  activeVenues: string[];
  allowPerp?: boolean;
  onExpiryChange: (expiry: string) => void;
}

export default function LegInput({
  chain,
  expiry,
  expiries,
  underlying,
  activeVenues,
  allowPerp = true,
  onExpiryChange,
}: LegInputProps) {
  const t = useT(messages);
  const addLeg = useStrategyStore((s) => s.addLeg);
  const addHedge = useStrategyStore((s) => s.addHedge);
  const [type, setType] = useState<'call' | 'put' | 'perp'>('call');
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [strikeInput, setStrikeInput] = useState('');
  const [qty, setQty] = useState('1');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const strikeRef = useRef<HTMLDivElement>(null);

  const strikes = chain?.strikes.map((s) => s.strike) ?? [];
  const atmStrike = chain?.stats.atmStrike ?? 0;
  const perpReference = chain?.stats.indexPriceUsd ?? chain?.stats.forwardPriceUsd ?? 0;
  const isPerp = type === 'perp';

  const filtered = strikeInput
    ? strikes.filter((s) => s.toString().includes(strikeInput))
    : strikes;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (strikeRef.current && !strikeRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelectStrike(strike: number) {
    setStrikeInput(strike.toString());
    setShowSuggestions(false);
  }

  function handleAdd() {
    const parsedQty = parseFloat(qty);
    const quantity = Number.isFinite(parsedQty) ? Math.max(0.001, parsedQty) : 1;

    if (type === 'perp') {
      const entryPrice = Number(strikeInput) || perpReference;
      if (!(entryPrice > 0)) return;
      addHedge({ kind: 'perpetual', direction, quantity, entryPrice }, underlying);
      setStrikeInput('');
      return;
    }

    if (!chain || !expiry) return;

    const leg = repriceLeg(chain, activeVenues, {
      type,
      direction,
      strike: Number(strikeInput) || atmStrike,
      expiry,
      quantity,
    });

    if (!leg) return;

    addLeg(leg, underlying);
    setStrikeInput('');
  }

  return (
    <div className={styles.legInput}>
      <div className={styles.legInputRow}>
        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={direction === 'buy'}
            data-type="buy"
            onClick={() => setDirection('buy')}
          >
            {t('buy')}
          </button>
          <button
            className={styles.toggleBtn}
            data-active={direction === 'sell'}
            data-type="sell"
            onClick={() => setDirection('sell')}
          >
            {t('sell')}
          </button>
        </div>

        <input
          type="text"
          inputMode="decimal"
          className={styles.legInputField}
          placeholder={t('baseQty')}
          value={qty}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^\d.]/g, '');
            const firstDot = cleaned.indexOf('.');
            const normalized =
              firstDot === -1
                ? cleaned
                : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
            setQty(normalized);
          }}
          style={{ width: 76 }}
        />

        <div className={styles.strikeInputWrap} ref={strikeRef}>
          <input
            type="text"
            inputMode="decimal"
            className={styles.legInputField}
            placeholder={
              isPerp
                ? perpReference
                  ? Math.round(perpReference).toLocaleString()
                  : t('entry')
                : atmStrike
                  ? atmStrike.toLocaleString()
                  : t('strike')
            }
            title={isPerp ? t('entry') : t('strike')}
            value={strikeInput}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^\d.]/g, '');
              const firstDot = cleaned.indexOf('.');
              const normalized =
                firstDot === -1
                  ? cleaned
                  : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
              setStrikeInput(normalized);
              setShowSuggestions(!isPerp);
            }}
            onFocus={() => setShowSuggestions(!isPerp)}
            style={{ width: 90 }}
          />
          {showSuggestions && !isPerp && filtered.length > 0 && (
            <div className={styles.strikeSuggestions}>
              {filtered.slice(0, 20).map((s) => (
                <button
                  key={s}
                  className={styles.strikeSuggestion}
                  data-atm={s === atmStrike || undefined}
                  onClick={() => handleSelectStrike(s)}
                >
                  {s.toLocaleString()}
                  {s === atmStrike && <span className={styles.strikeSuggestionMeta}>ATM</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.legInputToggle}>
          <button
            className={styles.toggleBtn}
            data-active={type === 'call'}
            data-type="call"
            onClick={() => setType('call')}
          >
            CALL
          </button>
          <button
            className={styles.toggleBtn}
            data-active={type === 'put'}
            data-type="put"
            onClick={() => setType('put')}
          >
            PUT
          </button>
          {allowPerp && (
            <button
              className={styles.toggleBtn}
              data-active={isPerp}
              data-type="perp"
              onClick={() => {
                setType('perp');
                setShowSuggestions(false);
              }}
            >
              PERP
            </button>
          )}
        </div>

        {!isPerp && (
          <DropdownPicker
            size="sm"
            value={expiry}
            onChange={onExpiryChange}
            options={expiries.map((e) => ({
              value: e,
              label: formatExpiry(e),
              meta: `${dteDays(e)}d`,
            }))}
          />
        )}

        <button className={styles.addLegBtn} onClick={handleAdd}>
          {t('add')}
        </button>
      </div>
    </div>
  );
}
