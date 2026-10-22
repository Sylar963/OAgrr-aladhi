import { useClerk, useUser } from '@clerk/react';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import type { SocialVenue } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import { useSocialProfile, useUpdateSocialProfile } from './hooks/queries';
import styles from './ProfileCard.module.css';
import VenueTag, { venueLabel } from './VenueTag';

const messages = defineMessages(
  {
    sharedUsername: 'Your account username',
    sharedPositions: 'Your {venue} open positions, streamed live with marks and unrealized PnL',
    sharedNoFills: 'Closing fills are not shown: Paradex does not report fill history',
    sharedFills: 'Your {venue} closing fills with realized PnL',
    sharedEquity:
      'Your {venue} account equity history and return, as the venue reports it (deposits and withdrawals included)',
    username: 'Username',
    loading: 'Loading…',
    noUsername: 'No username on your account',
    setUsername: 'Set username',
    checking: 'Checking…',
    refresh: 'Refresh',
    sharing: 'Sharing on leaderboard',
    waitingFor: 'Waiting for {venue} connection',
    chooseAccount: 'Choose an account to broadcast',
    leave: 'Leave',
    join: 'Join leaderboard',
    broadcastAccount: 'Broadcast account',
    noVenue:
      'No venue account connected. Connect Derive, Thalex or Paradex from the account menu; paper accounts are not ranked.',
    connected: 'Connected',
    notConnected: 'Not connected right now',
    consentTitle: 'Joining shares your {venue} account with every signed-in user:',
    consentStream:
      'The connection stays open while you are listed, so your book keeps streaming after you close the app. You can leave at any time; your stream stops immediately.',
    joining: 'Joining…',
    shareJoin: 'Share & join',
    cancel: 'Cancel',
    chooseFirst: 'Choose which venue account to broadcast first.',
    hintHandle:
      'Named chat posts and the leaderboard use your account username. Anonymous posts never show it.',
    hintNoHandle:
      'Add a username to your account to join the leaderboard or post under your name. Anonymous chat works without one.',
  },
  {
    sharedUsername: 'Tu nombre de usuario',
    sharedPositions:
      'Tus posiciones abiertas en {venue}, transmitidas en vivo con mark y PnL no realizado',
    sharedNoFills: 'No se muestran ejecuciones de cierre: Paradex no reporta historial de ejecuciones',
    sharedFills: 'Tus ejecuciones de cierre en {venue} con PnL realizado',
    sharedEquity:
      'Tu historial de equity y retorno de la cuenta de {venue}, tal como lo reporta el exchange (incluye depósitos y retiros)',
    username: 'Usuario',
    loading: 'Cargando…',
    noUsername: 'Tu cuenta no tiene nombre de usuario',
    setUsername: 'Definir usuario',
    checking: 'Verificando…',
    refresh: 'Actualizar',
    sharing: 'Compartiendo en el ranking',
    waitingFor: 'Esperando conexión de {venue}',
    chooseAccount: 'Elige una cuenta para transmitir',
    leave: 'Salir',
    join: 'Unirse al ranking',
    broadcastAccount: 'Cuenta transmitida',
    noVenue:
      'No hay cuenta de exchange conectada. Conecta Derive, Thalex o Paradex desde el menú de cuenta; las cuentas Paper no entran al ranking.',
    connected: 'Conectada',
    notConnected: 'Sin conexión en este momento',
    consentTitle: 'Al unirte compartes tu cuenta de {venue} con todos los usuarios que iniciaron sesión:',
    consentStream:
      'La conexión permanece abierta mientras estés en la lista, así que tu libro sigue transmitiéndose aunque cierres la app. Puedes salir cuando quieras; tu transmisión se detiene de inmediato.',
    joining: 'Uniéndote…',
    shareJoin: 'Compartir y unirse',
    cancel: 'Cancelar',
    chooseFirst: 'Primero elige qué cuenta de exchange transmitir.',
    hintHandle:
      'Los mensajes con nombre en el chat y el ranking usan tu nombre de usuario. Los mensajes anónimos nunca lo muestran.',
    hintNoHandle:
      'Agrega un nombre de usuario a tu cuenta para unirte al ranking o publicar con tu nombre. El chat anónimo funciona sin él.',
  },
);

function sharedItems(venue: SocialVenue, t: Translate<typeof messages.en>): string[] {
  const name = venueLabel(venue);
  return [
    t('sharedUsername'),
    t('sharedPositions', { venue: name }),
    venue === 'paradex' ? t('sharedNoFills') : t('sharedFills', { venue: name }),
    t('sharedEquity', { venue: name }),
  ];
}

export default function ProfileCard() {
  const t = useT(messages);
  const clerk = useClerk();
  const profile = useSocialProfile();
  const update = useUpdateSocialProfile();
  const [confirming, setConfirming] = useState(false);
  const [draftVenue, setDraftVenue] = useState<SocialVenue | null>(null);
  const { user } = useUser();
  const clerkUsername = user?.username ?? null;
  const configuredVenueIds = useAppStore((s) => s.configuredVenueIds);
  const seen = useRef({ clerkUsername, venues: configuredVenueIds.join(',') });
  const { refetch } = profile;

  useEffect(() => {
    const venues = configuredVenueIds.join(',');
    if (seen.current.clerkUsername === clerkUsername && seen.current.venues === venues) return;
    seen.current = { clerkUsername, venues };
    void refetch();
  }, [clerkUsername, configuredVenueIds, refetch]);

  const handle = profile.data?.handle ?? null;
  const joined = profile.data?.leaderboardVisible ?? false;
  const venues = profile.data?.venues ?? [];
  const broadcastVenue = profile.data?.broadcastVenue ?? null;
  const selectedVenue = joined
    ? broadcastVenue
    : ((draftVenue && venues.some((v) => v.venue === draftVenue) ? draftVenue : null) ??
      (broadcastVenue && venues.some((v) => v.venue === broadcastVenue) ? broadcastVenue : null) ??
      (venues.length === 1 ? venues[0]!.venue : null));
  const broadcastConnected =
    joined && venues.some((v) => v.venue === broadcastVenue && v.connected);
  const error = update.error instanceof Error ? update.error.message : null;

  function chooseVenue(venue: SocialVenue) {
    setDraftVenue(venue);
    if (joined && venue !== broadcastVenue) {
      update.mutate({ leaderboardVisible: true, broadcastVenue: venue });
    }
  }

  function join() {
    if (!selectedVenue) return;
    update.mutate(
      { leaderboardVisible: true, broadcastVenue: selectedVenue },
      { onSuccess: () => setConfirming(false) },
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <div className={styles.identity}>
          <span className={styles.label}>{t('username')}</span>
          {profile.isLoading ? (
            <span className={styles.muted}>{t('loading')}</span>
          ) : handle ? (
            <span className={styles.handle}>@{handle}</span>
          ) : (
            <span className={styles.muted}>{t('noUsername')}</span>
          )}
        </div>

        {!handle && !profile.isLoading && (
          <div className={styles.actions}>
            <button className={styles.secondary} onClick={() => clerk.openUserProfile()}>
              {t('setUsername')}
            </button>
            <button
              className={styles.ghost}
              onClick={() => void profile.refetch()}
              disabled={profile.isFetching}
            >
              {profile.isFetching ? t('checking') : t('refresh')}
            </button>
          </div>
        )}

        {handle && (
          <div className={styles.actions}>
            {joined ? (
              <>
                {broadcastConnected ? (
                  <span className={styles.liveBadge}>
                    <span className={styles.liveDot} />
                    {t('sharing')}
                  </span>
                ) : broadcastVenue ? (
                  <span className={styles.waitingBadge}>
                    {t('waitingFor', { venue: venueLabel(broadcastVenue) })}
                  </span>
                ) : (
                  <span className={styles.waitingBadge}>{t('chooseAccount')}</span>
                )}
                <button
                  className={styles.ghost}
                  onClick={() => update.mutate({ leaderboardVisible: false })}
                  disabled={update.isPending}
                >
                  {t('leave')}
                </button>
              </>
            ) : (
              <button
                className={styles.primary}
                onClick={() => setConfirming(true)}
                disabled={update.isPending || venues.length === 0}
              >
                {t('join')}
              </button>
            )}
          </div>
        )}
      </div>

      {handle && !profile.isLoading && (
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.label}>{t('broadcastAccount')}</span>
            {venues.length === 0 ? (
              <span className={styles.muted}>{t('noVenue')}</span>
            ) : (
              <div className={styles.venues} role="radiogroup" aria-label={t('broadcastAccount')}>
                {venues.map((entry) => (
                  <button
                    key={entry.venue}
                    role="radio"
                    aria-checked={entry.venue === selectedVenue}
                    className={styles.venueBtn}
                    data-active={entry.venue === selectedVenue}
                    onClick={() => chooseVenue(entry.venue)}
                    disabled={update.isPending}
                    title={entry.connected ? t('connected') : t('notConnected')}
                  >
                    <VenueTag venue={entry.venue} />
                    <span className={styles.venueDot} data-connected={entry.connected} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {confirming && !joined && selectedVenue && (
        <div className={styles.consent} role="dialog" aria-label={t('join')}>
          <p className={styles.consentTitle}>
            {t('consentTitle', { venue: venueLabel(selectedVenue) })}
          </p>
          <ul className={styles.consentList}>
            {sharedItems(selectedVenue, t).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.muted}>{t('consentStream')}</p>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={join} disabled={update.isPending}>
              {update.isPending ? t('joining') : t('shareJoin')}
            </button>
            <button className={styles.ghost} onClick={() => setConfirming(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {confirming && !joined && !selectedVenue && venues.length > 0 && (
        <p className={styles.hint}>{t('chooseFirst')}</p>
      )}

      <p className={styles.hint} data-error={error != null}>
        {error ??
          (handle ? t('hintHandle') : t('hintNoHandle'))}
      </p>
    </section>
  );
}
