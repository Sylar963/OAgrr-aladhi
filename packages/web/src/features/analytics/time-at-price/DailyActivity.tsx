import { useMemo, useState } from 'react';
import type { TimeAtPriceResponse } from '@oggregator/protocol';
import { defineMessages, intlLocale, useLocale, useT } from '@lib/i18n';
import { ACTIVITY_PAGE_DAYS, calendarActivity, DAY_MS, weekdayActivity } from './activity';
import styles from './DailyActivity.module.css';

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const messages = defineMessages(
  {
    title: 'Hour by hour',
    subtitle: 'Compare hourly ranges and daily volatility · UTC',
    dates: 'Calendar days',
    weekdays: 'Weekday averages',
    endDate: 'Through',
    older: 'Previous 14 days',
    newer: 'Next 14 days',
    day: 'Day / UTC hour',
    coverage: 'Hours',
    range: 'Day range',
    vol: 'Day vol',
    meanRange: 'Mean day range',
    meanVol: 'Pooled vol',
    days: '{n} full days',
    missing: 'No data',
    detail: '{day} · {hour}:00–{end}:00 UTC · range {range}',
    weekdayDetail: '{day} · {hour}:00–{end}:00 UTC · mean range {range} · {n} samples',
    hint: 'Hover, tap or focus a cell to inspect an hour.',
    legend: 'Hourly high–low range',
    note: 'Cell = (high / low − 1) for one completed hourly candle. Day range uses the day’s high and low; day vol is annualized Parkinson volatility from that day’s observed hours. Missing hours stay blank; partial days show coverage out of 24. Candles do not measure exact minutes spent at a price.',
    weekdayNote:
      'Weekday averages use complete UTC days only, across the selected lookback. Cells and day ranges are arithmetic means; pooled vol is the square root of mean daily variance. These are historical observations.',
  },
  {
    title: 'Hora por hora',
    subtitle: 'Compara rangos horarios y volatilidad diaria · UTC',
    dates: 'Días del calendario',
    weekdays: 'Promedios por día',
    endDate: 'Hasta',
    older: '14 días anteriores',
    newer: '14 días siguientes',
    day: 'Día / hora UTC',
    coverage: 'Horas',
    range: 'Rango diario',
    vol: 'Vol diaria',
    meanRange: 'Rango diario medio',
    meanVol: 'Vol combinada',
    days: '{n} días completos',
    missing: 'Sin datos',
    detail: '{day} · {hour}:00–{end}:00 UTC · rango {range}',
    weekdayDetail: '{day} · {hour}:00–{end}:00 UTC · rango medio {range} · {n} muestras',
    hint: 'Pasa el cursor, toca o enfoca una celda para consultar una hora.',
    legend: 'Rango horario máx–mín',
    note: 'Celda = (máximo / mínimo − 1) de una vela horaria completa. El rango diario usa el máximo y mínimo del día; la vol diaria es Parkinson anualizada de las horas observadas de ese día. Las horas faltantes quedan vacías; los días parciales muestran cobertura sobre 24. Las velas no miden minutos exactos en un precio.',
    weekdayNote:
      'Los promedios usan solo días UTC completos del periodo seleccionado. Las celdas y rangos diarios son medias aritméticas; la vol combinada es la raíz de la varianza diaria media. Son observaciones históricas.',
  },
);

function dateValue(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function percent(value: number | null) {
  return value == null ? '—' : `${(value * 100).toFixed(2)}%`;
}

export function DailyActivity({ data }: { data: TimeAtPriceResponse }) {
  const t = useT(messages);
  const locale = useLocale();
  const [mode, setMode] = useState<'dates' | 'weekdays'>('dates');
  const [chosenEnd, setChosenEnd] = useState<number | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const firstDay = Math.floor(data.from / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(data.to / DAY_MS) * DAY_MS;
  const endDay = Math.max(firstDay, Math.min(chosenEnd ?? lastDay, lastDay));
  const rows = useMemo(
    () =>
      mode === 'dates'
        ? calendarActivity(data.dailyActivity, endDay).filter((day) => day.ts >= firstDay)
        : weekdayActivity(data.dailyActivity),
    [data.dailyActivity, endDay, firstDay, mode],
  );
  const maximum = useMemo(() => {
    const values = mode === 'dates' ? data.dailyActivity : rows;
    return values.reduce(
      (max, day) =>
        day.hourlyRanges.reduce<number>((hourMax, range) => Math.max(hourMax, range ?? 0), max),
      0,
    );
  }, [data.dailyActivity, mode, rows]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: 'UTC',
        weekday: 'long',
      }),
    [locale],
  );

  return (
    <section className={styles.section} aria-label={t('title')}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>{t('title')}</h3>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.toggle}>
            {(['dates', 'weekdays'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setDetail(null);
                }}
              >
                {t(value)}
              </button>
            ))}
          </div>
          {mode === 'dates' && (
            <div className={styles.dateControls}>
              <button
                type="button"
                aria-label={t('older')}
                disabled={endDay - (ACTIVITY_PAGE_DAYS - 1) * DAY_MS <= firstDay}
                onClick={() => {
                  setChosenEnd(
                    Math.max(
                      firstDay + (ACTIVITY_PAGE_DAYS - 1) * DAY_MS,
                      endDay - ACTIVITY_PAGE_DAYS * DAY_MS,
                    ),
                  );
                  setDetail(null);
                }}
              >
                ←
              </button>
              <label>
                {t('endDate')}{' '}
                <input
                  type="date"
                  value={dateValue(endDay)}
                  min={dateValue(firstDay)}
                  max={dateValue(lastDay)}
                  onChange={(event) => {
                    const ts = Date.parse(`${event.target.value}T00:00:00Z`);
                    if (Number.isFinite(ts)) {
                      setChosenEnd(ts);
                      setDetail(null);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                aria-label={t('newer')}
                disabled={endDay >= lastDay}
                onClick={() => {
                  setChosenEnd(Math.min(lastDay, endDay + ACTIVITY_PAGE_DAYS * DAY_MS));
                  setDetail(null);
                }}
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('subtitle')}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('day')}</th>
              {HOURS.map((hour) => (
                <th scope="col" key={hour}>
                  {hour}
                </th>
              ))}
              <th scope="col">{t('coverage')}</th>
              <th scope="col">{t(mode === 'dates' ? 'range' : 'meanRange')}</th>
              <th scope="col">{t(mode === 'dates' ? 'vol' : 'meanVol')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const label = (mode === 'dates' ? dateFormatter : weekdayFormatter).format(row.ts);
              return (
                <tr key={row.ts}>
                  <th scope="row">{label}</th>
                  {row.hourlyRanges.map((range, hour) => {
                    const description =
                      range == null
                        ? `${label} · ${HOURS[hour]}:00 UTC · ${t('missing')}`
                        : t(mode === 'dates' ? 'detail' : 'weekdayDetail', {
                            day: label,
                            hour: HOURS[hour]!,
                            end: String(hour + 1).padStart(2, '0'),
                            range: percent(range),
                            n: row.days,
                          });
                    return (
                      <td className={styles.hour} key={hour}>
                        <button
                          type="button"
                          aria-label={description}
                          title={description}
                          data-missing={range == null || undefined}
                          style={
                            range == null
                              ? undefined
                              : {
                                  backgroundColor: `rgba(237, 111, 28, ${0.08 + 0.82 * (maximum > 0 ? range / maximum : 0)})`,
                                }
                          }
                          onPointerEnter={() => setDetail(description)}
                          onFocus={() => setDetail(description)}
                          onClick={() => setDetail(description)}
                        >
                          {range == null ? (
                            '·'
                          ) : (
                            <span className={styles.srOnly}>{percent(range)}</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td
                    className={styles.value}
                    title={mode === 'weekdays' ? t('days', { n: row.days }) : undefined}
                  >
                    {mode === 'dates' ? `${row.bars}/24` : row.bars.toLocaleString('en-US')}
                  </td>
                  <td className={styles.value}>{percent(row.range)}</td>
                  <td className={styles.value}>{percent(row.vol)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.footer}>
        <span className={styles.detail} role="status">
          {detail ?? t('hint')}
        </span>
        <span className={styles.legend}>
          {t('legend')} <span>0%</span>
          <i />
          <span>{percent(maximum)}</span>
        </span>
      </div>
      <p className={styles.note}>
        {t('note')}
        {mode === 'weekdays' ? ` ${t('weekdayNote')}` : ''}
      </p>
    </section>
  );
}
