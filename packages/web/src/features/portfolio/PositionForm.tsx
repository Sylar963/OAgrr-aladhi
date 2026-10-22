import { useState } from 'react';
import { z } from 'zod';

import type { PositionLegInput } from '@oggregator/protocol';

import { defineMessages, useT } from '@lib/i18n';

import { useAddPosition } from './hooks/queries';
import styles from './PositionForm.module.css';

interface Props {
  defaultUnderlying?: string;
}

const messages = defineMessages(
  {
    underlyingRequired: 'underlying is required',
    expiryFormat: 'expiry must be YYYY-MM-DD',
    strikePositive: 'strike must be a positive number',
    sizeNonZero: 'size must be a non-zero number',
    entryPositive: 'entry price must be > 0',
    invalidForm: 'invalid form',
    failed: 'failed',
    underlying: 'Underlying',
    expiry: 'Expiry',
    strike: 'Strike',
    right: 'Right',
    size: 'Size',
    sizePlaceholder: '1 (negative = short)',
    entryUsd: 'Entry $',
    entryIv: 'Entry IV %',
    adding: 'Adding…',
    addLeg: 'Add leg',
  },
  {
    underlyingRequired: 'el subyacente es obligatorio',
    expiryFormat: 'el vencimiento debe ser AAAA-MM-DD',
    strikePositive: 'el strike debe ser un número positivo',
    sizeNonZero: 'el tamaño debe ser un número distinto de cero',
    entryPositive: 'el precio de entrada debe ser > 0',
    invalidForm: 'formulario inválido',
    failed: 'falló',
    underlying: 'Subyacente',
    expiry: 'Vencimiento',
    strike: 'Strike',
    right: 'Tipo',
    size: 'Tamaño',
    sizePlaceholder: '1 (negativo = short)',
    entryUsd: 'Entrada $',
    entryIv: 'IV entrada %',
    adding: 'Agregando…',
    addLeg: 'Agregar leg',
  },
);

const FORM_ISSUES = [
  'underlyingRequired',
  'expiryFormat',
  'strikePositive',
  'sizeNonZero',
  'entryPositive',
] as const;
type FormIssue = (typeof FORM_ISSUES)[number];

const PositionFormSchema = z.object({
  underlying: z.string().min(1, 'underlyingRequired' satisfies FormIssue).transform((v) => v.trim()),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiryFormat' satisfies FormIssue),
  strike: z.coerce.number().positive('strikePositive' satisfies FormIssue),
  optionRight: z.enum(['call', 'put']),
  size: z.coerce.number().refine((v) => v !== 0, 'sizeNonZero' satisfies FormIssue),
  entryPriceUsd: z.coerce.number().positive('entryPositive' satisfies FormIssue),
  entryIvPct: z.preprocess(
    (v) => (v == null || (typeof v === 'string' && v.trim().length === 0) ? null : v),
    z.union([z.null(), z.coerce.number().min(0).max(500)]),
  ),
});

function isFormIssue(message: string): message is FormIssue {
  return (FORM_ISSUES as readonly string[]).includes(message);
}

export default function PositionForm({ defaultUnderlying = 'BTC' }: Props) {
  const t = useT(messages);
  const [underlying, setUnderlying] = useState(defaultUnderlying);
  const [expiry, setExpiry] = useState('');
  const [strike, setStrike] = useState('');
  const [optionRight, setOptionRight] = useState<'call' | 'put'>('call');
  const [size, setSize] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryIvPct, setEntryIvPct] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addPosition = useAddPosition();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const parsed = PositionFormSchema.safeParse({
      underlying,
      expiry,
      strike,
      optionRight,
      size,
      entryPriceUsd: entryPrice,
      entryIvPct,
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(
        first == null ? t('invalidForm') : isFormIssue(first.message) ? t(first.message) : first.message,
      );
      return;
    }

    const data = parsed.data;
    const input: PositionLegInput = {
      underlying: data.underlying,
      expiry: data.expiry,
      strike: data.strike,
      optionRight: data.optionRight,
      size: data.size,
      entryPriceUsd: data.entryPriceUsd,
      entryIv: data.entryIvPct == null ? null : data.entryIvPct / 100,
      venueHint: null,
      source: 'manual',
    };

    try {
      await addPosition.mutateAsync(input);
      setStrike('');
      setEntryPrice('');
      setEntryIvPct('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('underlying')}</span>
          <input value={underlying} onChange={(e) => setUnderlying(e.target.value.toUpperCase())} placeholder="BTC" />
        </label>
        <label className={styles.field}>
          <span>{t('expiry')}</span>
          <input value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="2026-06-27" />
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('strike')}</span>
          <input value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="70000" inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{t('right')}</span>
          <select value={optionRight} onChange={(e) => setOptionRight(e.target.value as 'call' | 'put')}>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('size')}</span>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder={t('sizePlaceholder')} inputMode="decimal" />
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('entryUsd')}</span>
          <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="2500" inputMode="decimal" />
        </label>
        <label className={styles.field}>
          <span>{t('entryIv')}</span>
          <input value={entryIvPct} onChange={(e) => setEntryIvPct(e.target.value)} placeholder="62" inputMode="decimal" />
        </label>
      </div>
      {error != null && <div className={styles.error}>{error}</div>}
      <button type="submit" className={styles.submit} disabled={addPosition.isPending}>
        {addPosition.isPending ? t('adding') : t('addLeg')}
      </button>
    </form>
  );
}
