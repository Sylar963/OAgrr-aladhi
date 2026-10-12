import { useClerk, useUser } from '@clerk/react';
import type { SocialVenue } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { useEffect, useRef, useState } from 'react';

import { useSocialProfile, useUpdateSocialProfile } from './hooks/queries';
import styles from './ProfileCard.module.css';
import VenueTag, { venueLabel } from './VenueTag';

function sharedItems(venue: SocialVenue): string[] {
  return [
    'Your account username',
    `Your ${venueLabel(venue)} open positions, streamed live with marks and unrealized PnL`,
    venue === 'paradex'
      ? 'Closing fills are not shown: Paradex does not report fill history'
      : `Your ${venueLabel(venue)} closing fills with realized PnL`,
    `Your ${venueLabel(venue)} account equity history and return, as the venue reports it (deposits and withdrawals included)`,
  ];
}

export default function ProfileCard() {
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
          <span className={styles.label}>Username</span>
          {profile.isLoading ? (
            <span className={styles.muted}>Loading…</span>
          ) : handle ? (
            <span className={styles.handle}>@{handle}</span>
          ) : (
            <span className={styles.muted}>No username on your account</span>
          )}
        </div>

        {!handle && !profile.isLoading && (
          <div className={styles.actions}>
            <button className={styles.secondary} onClick={() => clerk.openUserProfile()}>
              Set username
            </button>
            <button
              className={styles.ghost}
              onClick={() => void profile.refetch()}
              disabled={profile.isFetching}
            >
              {profile.isFetching ? 'Checking…' : 'Refresh'}
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
                    Sharing on leaderboard
                  </span>
                ) : broadcastVenue ? (
                  <span className={styles.waitingBadge}>
                    Waiting for {venueLabel(broadcastVenue)} connection
                  </span>
                ) : (
                  <span className={styles.waitingBadge}>Choose an account to broadcast</span>
                )}
                <button
                  className={styles.ghost}
                  onClick={() => update.mutate({ leaderboardVisible: false })}
                  disabled={update.isPending}
                >
                  Leave
                </button>
              </>
            ) : (
              <button
                className={styles.primary}
                onClick={() => setConfirming(true)}
                disabled={update.isPending || venues.length === 0}
              >
                Join leaderboard
              </button>
            )}
          </div>
        )}
      </div>

      {handle && !profile.isLoading && (
        <div className={styles.row}>
          <div className={styles.identity}>
            <span className={styles.label}>Broadcast account</span>
            {venues.length === 0 ? (
              <span className={styles.muted}>
                No venue account connected. Connect Derive, Thalex or Paradex from the account menu;
                paper accounts are not ranked.
              </span>
            ) : (
              <div className={styles.venues} role="radiogroup" aria-label="Broadcast account">
                {venues.map((entry) => (
                  <button
                    key={entry.venue}
                    role="radio"
                    aria-checked={entry.venue === selectedVenue}
                    className={styles.venueBtn}
                    data-active={entry.venue === selectedVenue}
                    onClick={() => chooseVenue(entry.venue)}
                    disabled={update.isPending}
                    title={entry.connected ? 'Connected' : 'Not connected right now'}
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
        <div className={styles.consent} role="dialog" aria-label="Join leaderboard">
          <p className={styles.consentTitle}>
            Joining shares your {venueLabel(selectedVenue)} account with every signed-in user:
          </p>
          <ul className={styles.consentList}>
            {sharedItems(selectedVenue).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.muted}>
            The connection stays open while you are listed, so your book keeps streaming after you
            close the app. You can leave at any time; your stream stops immediately.
          </p>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={join} disabled={update.isPending}>
              {update.isPending ? 'Joining…' : 'Share & join'}
            </button>
            <button className={styles.ghost} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirming && !joined && !selectedVenue && venues.length > 0 && (
        <p className={styles.hint}>Choose which venue account to broadcast first.</p>
      )}

      <p className={styles.hint} data-error={error != null}>
        {error ??
          (handle
            ? 'Named chat posts and the leaderboard use your account username. Anonymous posts never show it.'
            : 'Add a username to your account to join the leaderboard or post under your name. Anonymous chat works without one.')}
      </p>
    </section>
  );
}
