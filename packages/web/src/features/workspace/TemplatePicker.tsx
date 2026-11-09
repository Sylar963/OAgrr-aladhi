import { OverlayPortal } from '@components/ui';
import { MAX_CUSTOM_TABS } from '@lib/custom-tabs';
import { defineMessages, useT } from '@lib/i18n';
import { WIDGET_TRAITS, type WidgetKind } from '@lib/tabs';
import {
  WORKSPACE_TEMPLATE_IDS,
  WORKSPACE_TEMPLATES,
  type WorkspaceTemplateId,
} from '@lib/workspace-templates';
import { useAppStore, useMarket } from '@stores/app-store';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './TemplatePicker.module.css';
import { useWidgetCatalog } from './widget-catalog';

const messages = defineMessages(
  {
    library: 'WORKSPACE TEMPLATES',
    title: 'A useful place to start.',
    subtitle: 'Choose a setup for what you want to do. Arrange every panel your way afterward.',
    overview: 'Market overview',
    overviewDescription: 'Read the chain, check market activity, and compare volatility.',
    planning: 'Trade planning',
    planningDescription: 'Keep contracts, the strategy builder, and volatility side by side.',
    volatility: 'Volatility research',
    volatilityDescription: 'Explore the smile, term structure, IV rank, and realized volatility.',
    flow: 'Flow & positioning',
    flowDescription: 'Follow the tape, gamma exposure, and where open interest is concentrated.',
    portfolio: 'Portfolio review',
    portfolioDescription: 'Review your positions with the option chain and gamma exposure nearby.',
    blank: 'Blank workspace',
    blankDescription: 'Start with an empty canvas and choose your own panels.',
    recommended: 'START HERE',
    account: 'Portfolio sign-in',
    count: '{n} panels',
    empty: 'Your own layout',
    includes: 'Includes',
    newTab: 'New tab · {ticker}',
    existingTab: '{name} · {ticker}',
    createsNew: 'Creates a new tab with the current ticker.',
    fillsEmpty: 'Adds this setup to your empty tab.',
    create: 'Create workspace',
    use: 'Use in this tab',
    close: 'Close templates',
    limit: 'You have {n} custom tabs. Close one to create another.',
  },
  {
    library: 'PLANTILLAS DE ESPACIO DE TRABAJO',
    title: 'Un buen punto de partida.',
    subtitle:
      'Elige una configuración para lo que quieres hacer. Después, organiza cada panel a tu gusto.',
    overview: 'Vista del mercado',
    overviewDescription: 'Lee la cadena, revisa la actividad del mercado y compara la volatilidad.',
    planning: 'Planificación de trades',
    planningDescription:
      'Mantén los contratos, el constructor y la volatilidad uno al lado del otro.',
    volatility: 'Análisis de volatilidad',
    volatilityDescription:
      'Explora el smile, la estructura temporal, el rango de IV y la volatilidad realizada.',
    flow: 'Flujo y posicionamiento',
    flowDescription:
      'Sigue las operaciones, la exposición gamma y la concentración del interés abierto.',
    portfolio: 'Revisión de portafolio',
    portfolioDescription:
      'Revisa tus posiciones con la cadena de opciones y la exposición gamma cerca.',
    blank: 'Espacio en blanco',
    blankDescription: 'Empieza desde cero y elige tus propios paneles.',
    recommended: 'EMPIEZA AQUÍ',
    account: 'Acceso al portafolio',
    count: '{n} paneles',
    empty: 'Tu propio diseño',
    includes: 'Incluye',
    newTab: 'Nueva pestaña · {ticker}',
    existingTab: '{name} · {ticker}',
    createsNew: 'Crea una nueva pestaña con el ticker actual.',
    fillsEmpty: 'Agrega esta configuración a tu pestaña vacía.',
    create: 'Crear espacio',
    use: 'Usar en esta pestaña',
    close: 'Cerrar plantillas',
    limit: 'Tienes {n} pestañas personalizadas. Cierra una para crear otra.',
  },
);

export default function TemplatePicker({
  targetTabId,
  onClose,
}: {
  targetTabId?: string;
  onClose: () => void;
}) {
  const t = useT(messages);
  const [selected, setSelected] = useState<WorkspaceTemplateId>('overview');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const underlying = useMarket((market) => market.underlying);
  const tabs = useAppStore((state) => state.customTabs);
  const createCustomTab = useAppStore((state) => state.createCustomTab);
  const applyTemplate = useAppStore((state) => state.applyTemplateToEmptyTab);
  const catalog = useWidgetCatalog();
  const target = tabs.find((tab) => tab.id === targetTabId && tab.kinds.length === 0);
  const atLimit = !target && tabs.length >= MAX_CUSTOM_TABS;
  const template = WORKSPACE_TEMPLATES[selected];
  const label = (kind: WidgetKind) => catalog.find((entry) => entry.kind === kind)?.label ?? kind;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function apply() {
    const applied = target
      ? applyTemplate(target.id, selected)
      : createCustomTab(t(selected), selected);
    if (applied) onClose();
  }

  return (
    <OverlayPortal>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={helpId}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{t('library')}</span>
            <h2 id={titleId}>{t('title')}</h2>
            <p id={helpId}>{t('subtitle')}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>
        <fieldset className={styles.grid}>
          <legend className={styles.srOnly}>{t('library')}</legend>
          {WORKSPACE_TEMPLATE_IDS.map((id) => {
            const panels = WORKSPACE_TEMPLATES[id].panels;
            const groups = [...new Set(panels.map((panel) => panel.group))];
            return (
              <label key={id} className={styles.card} data-selected={selected === id}>
                <input
                  type="radio"
                  name="workspace-template"
                  value={id}
                  checked={selected === id}
                  aria-label={t(id)}
                  onChange={() => setSelected(id)}
                />
                <div className={styles.cardHeading}>
                  <span>{t(id)}</span>
                  <span className={styles.selection} aria-hidden="true">
                    {selected === id ? '✓' : ''}
                  </span>
                </div>
                <div className={styles.preview} data-groups={groups.length} aria-hidden="true">
                  {groups.length === 0 ? (
                    <span className={styles.blank}>+</span>
                  ) : (
                    groups.map((group) => {
                      const members = panels.filter((panel) => panel.group === group);
                      return (
                        <span key={group} className={styles.previewPanel}>
                          <span className={styles.previewTitle}>{label(members[0]!.kind)}</span>
                          <span className={styles.previewLines}>
                            <i />
                            <i />
                            <i />
                          </span>
                          {members.length > 1 && <span className={styles.previewTabs}>••</span>}
                        </span>
                      );
                    })
                  )}
                </div>
                <p className={styles.description}>{t(`${id}Description`)}</p>
                <div className={styles.cardMeta}>
                  <span>{panels.length > 0 ? t('count', { n: panels.length }) : t('empty')}</span>
                  {id === 'overview' && (
                    <span className={styles.recommended}>{t('recommended')}</span>
                  )}
                  {panels.some((panel) => WIDGET_TRAITS[panel.kind].requiresAccount) && (
                    <span>{t('account')}</span>
                  )}
                </div>
              </label>
            );
          })}
        </fieldset>
        <div className={styles.footer}>
          <div className={styles.summary}>
            <span className={styles.destination}>
              {target
                ? t('existingTab', { name: target.name, ticker: underlying })
                : t('newTab', { ticker: underlying })}
            </span>
            <span>
              {template.panels.length > 0
                ? `${t('includes')}: ${template.panels.map((panel) => label(panel.kind)).join(' · ')}`
                : t('blankDescription')}
            </span>
            <span
              className={atLimit ? styles.limit : undefined}
              role={atLimit ? 'status' : undefined}
            >
              {atLimit
                ? t('limit', { n: MAX_CUSTOM_TABS })
                : t(target ? 'fillsEmpty' : 'createsNew')}
            </span>
          </div>
          <button type="button" className={styles.primary} onClick={apply} disabled={atLimit}>
            {t(target ? 'use' : 'create')} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </dialog>
    </OverlayPortal>
  );
}
