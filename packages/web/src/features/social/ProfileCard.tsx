import { useClerk, useUser } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';

import { useSocialProfile, useUpdateSocialProfile } from './hooks/queries';
import styles from './ProfileCard.module.css';

const SHARED_ITEMS = [
  'Your account username',
  'Your open positions, streamed live with marks and unrealized PnL',
  'Your closed trades with realized PnL',
  'Your all-time equity curve and return',
];

export default function ProfileCard() {
  const clerk = useClerk();
  const profile = useSocialProfile();
  const update = useUpdateSocialProfile();
  const [confirming, setConfirming] = useState(false);
  const { user } = useUser();
  const clerkUsername = user?.username ?? null;
  const seenUsername = useRef(clerkUsername);
  const { refetch } = profile;

  useEffect(() => {
    if (seenUsername.current === clerkUsername) return;
    seenUsername.current = clerkUsername;
    void refetch();
  }, [clerkUsername, refetch]);

  const handle = profile.data?.handle ?? null;
  const joined = profile.data?.leaderboardVisible ?? false;
  const error = update.error instanceof Error ? update.error.message : null;

  function join() {
    update.mutate({ leaderboardVisible: true }, { onSuccess: () => setConfirming(false) });
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
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  Sharing on leaderboard
                </span>
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
                disabled={update.isPending}
              >
                Join leaderboard
              </button>
            )}
          </div>
        )}
      </div>

      {confirming && !joined && (
        <div className={styles.consent} role="dialog" aria-label="Join leaderboard">
          <p className={styles.consentTitle}>
            Joining shares your paper account with every signed-in user:
          </p>
          <ul className={styles.consentList}>
            {SHARED_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.muted}>You can leave at any time; your stream stops immediately.</p>
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

      <p className={styles.hint} data-error={error != null}>
        {error ??
          (handle
            ? 'Named chat posts and the leaderboard use your account username. Anonymous posts never show it.'
            : 'Add a username to your account to join the leaderboard or post under your name. Anonymous chat works without one.')}
      </p>
    </section>
  );
}
