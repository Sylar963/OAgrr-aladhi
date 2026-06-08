import type { FundedTemplateDto } from '@oggregator/protocol';
import { useState } from 'react';
import styles from './FundedView.module.css';
import {
  useFundedRun,
  useFundedRuns,
  useFundedTemplates,
  useStartRun,
  useWithdrawRun,
} from './hooks/queries';

export function FundedView() {
  const templates = useFundedTemplates();
  const runs = useFundedRuns();
  const startRun = useStartRun();
  const withdrawRun = useWithdrawRun();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deposit, setDeposit] = useState('500');
  const runDetail = useFundedRun(selectedRunId);

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
      <section className={styles.section}>
        <h2 className={styles.heading}>Challenge Templates</h2>
        {templates.isLoading && <div className={styles.muted}>Loading templates…</div>}
        {templates.isError && (
          <div className={styles.error}>Funded program is not available right now.</div>
        )}
        {!templates.isLoading && !templates.isError && templateList.length === 0 && (
          <div className={styles.muted}>No templates available.</div>
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
              Start
            </button>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>My Runs</h2>
        {runs.isLoading && <div className={styles.muted}>Loading runs…</div>}
        {!runs.isLoading && runList.length === 0 && (
          <div className={styles.muted}>No runs yet.</div>
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
                Withdraw
              </button>
            )}
          </div>
        ))}
      </section>

      {runDetail.data && (
        <section className={styles.section}>
          <h2 className={styles.heading}>Run {runDetail.data.id}</h2>
          <div>Status: {runDetail.data.status}</div>
          <h3 className={styles.subheading}>Settlements</h3>
          {runDetail.data.settlements.map((s) => (
            <div key={s.settledAt} className={styles.detailRow}>
              {s.settledAt} — equity {s.equityUsd} — share {s.traderShareUsd}
              {s.floorBreached ? ' — BREACHED' : ''}
            </div>
          ))}
          <h3 className={styles.subheading}>Events</h3>
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
