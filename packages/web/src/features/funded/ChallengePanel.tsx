import type { FundedTemplateDto } from '@oggregator/protocol';
import { defineMessages, useT } from '@lib/i18n';
import { useState } from 'react';
import styles from './ChallengePanel.module.css';
import {
  useFundedRun,
  useFundedRuns,
  useFundedTemplates,
  useStartRun,
  useWithdrawRun,
} from './hooks/queries';

const messages = defineMessages(
  {
    claim: 'Claim funding → deposit $100 on Thalex',
    instant: 'Go funded now: deposit $200 → 1,000 ABC',
    templates: 'Challenge Templates',
    loadingTemplates: 'Loading templates…',
    unavailable: 'Funded program is not available right now.',
    noTemplates: 'No templates available.',
    start: 'Start',
    myRuns: 'My Runs',
    loadingRuns: 'Loading runs…',
    noRuns: 'No runs yet.',
    withdraw: 'Withdraw',
    run: 'Run {id}',
    status: 'Status: {status}',
    settlements: 'Settlements',
    settlement: '{at} — equity {equity} — share {share}',
    breached: ' — BREACHED',
    events: 'Events',
  },
  {
    claim: 'Reclama el fondeo → deposita $100 en Thalex',
    instant: 'Fondéate ya: deposita $200 → 1,000 ABC',
    templates: 'Plantillas de desafío',
    loadingTemplates: 'Cargando plantillas…',
    unavailable: 'El programa de fondeo no está disponible ahora.',
    noTemplates: 'No hay plantillas disponibles.',
    start: 'Iniciar',
    myRuns: 'Mis intentos',
    loadingRuns: 'Cargando intentos…',
    noRuns: 'Aún no hay intentos.',
    withdraw: 'Retirar',
    run: 'Intento {id}',
    status: 'Estado: {status}',
    settlements: 'Liquidaciones',
    settlement: '{at} — patrimonio {equity} — parte {share}',
    breached: ' — VULNERADO',
    events: 'Eventos',
  },
);

export function ChallengePanel({ runId }: { runId: string | null }) {
  const tr = useT(messages);
  const templates = useFundedTemplates();
  const runs = useFundedRuns();
  const startRun = useStartRun();
  const withdrawRun = useWithdrawRun();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runId);
  const [deposit, setDeposit] = useState('500');
  const runDetail = useFundedRun(selectedRunId);

  const refUrl = import.meta.env.VITE_THALEX_REF_URL || '#';
  const passed = runDetail.data?.status === 'test_passed';

  const onStart = (t: FundedTemplateDto) => {
    startRun.mutate({
      templateId: t.id,
      depositUsd: t.routeType === 'test' ? Number(deposit) : undefined,
    });
  };

  const templateList = templates.data?.templates ?? [];
  const runList = runs.data?.runs ?? [];

  return (
    <div className={styles.container}>
      {passed && (
        <a className={styles.claimCta} href={refUrl} target="_blank" rel="noreferrer">
          {tr('claim')}
        </a>
      )}
      <a className={styles.instantCta} href={refUrl} target="_blank" rel="noreferrer">
        {tr('instant')}
      </a>

      <section className={styles.section}>
        <h2 className={styles.heading}>{tr('templates')}</h2>
        {templates.isLoading && <div className={styles.muted}>{tr('loadingTemplates')}</div>}
        {templates.isError && (
          <div className={styles.error}>{tr('unavailable')}</div>
        )}
        {!templates.isLoading && !templates.isError && templateList.length === 0 && (
          <div className={styles.muted}>{tr('noTemplates')}</div>
        )}
        {templateList.map((t) => (
          <div key={t.id} className={styles.row}>
            <span className={styles.name}>{t.name}</span>
            <span className={styles.meta}> · {t.routeType}</span>
            <span className={styles.meta}> · {t.fundedAbc} ABC</span>
            {t.routeType === 'test' && (
              <input
                className={styles.input}
                aria-label={`deposit-${t.id}`}
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            )}
            <button
              type="button"
              className={styles.button}
              onClick={() => onStart(t)}
              disabled={startRun.isPending}
            >
              {tr('start')}
            </button>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{tr('myRuns')}</h2>
        {runs.isLoading && <div className={styles.muted}>{tr('loadingRuns')}</div>}
        {!runs.isLoading && runList.length === 0 && (
          <div className={styles.muted}>{tr('noRuns')}</div>
        )}
        {runList.map((r) => (
          <div key={r.id} className={styles.row}>
            <button
              type="button"
              className={styles.runButton}
              onClick={() => setSelectedRunId(r.id)}
            >
              {r.id} — {r.status} — {r.abcCredited} ABC
            </button>
            {r.status === 'funded_active' && (
              <button
                type="button"
                className={styles.button}
                onClick={() => withdrawRun.mutate(r.id)}
                disabled={withdrawRun.isPending}
              >
                {tr('withdraw')}
              </button>
            )}
          </div>
        ))}
      </section>

      {runDetail.data && (
        <section className={styles.section}>
          <h2 className={styles.heading}>{tr('run', { id: runDetail.data.id })}</h2>
          <div>{tr('status', { status: runDetail.data.status })}</div>
          <h3 className={styles.subheading}>{tr('settlements')}</h3>
          {runDetail.data.settlements.map((s) => (
            <div key={s.settledAt} className={styles.detailRow}>
              {tr('settlement', { at: s.settledAt, equity: s.equityUsd, share: s.traderShareUsd })}
              {s.floorBreached ? tr('breached') : ''}
            </div>
          ))}
          <h3 className={styles.subheading}>{tr('events')}</h3>
          {runDetail.data.events.map((e) => (
            <div key={`${e.kind}-${e.ts}`} className={styles.detailRow}>
              {e.ts} — {e.kind}: {e.summary}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
