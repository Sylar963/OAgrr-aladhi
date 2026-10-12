import { SocialHandleSchema } from '@oggregator/protocol';
import { type FormEvent, useEffect, useState } from 'react';

import { useSocialProfile, useUpdateSocialProfile } from './hooks/queries';
import styles from './ProfileCard.module.css';

export default function ProfileCard() {
  const profile = useSocialProfile();
  const update = useUpdateSocialProfile();
  const [handle, setHandle] = useState('');
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data) return;
    setHandle(profile.data.handle ?? '');
    setVisible(profile.data.leaderboardVisible);
  }, [profile.data]);

  const dirty =
    profile.data != null &&
    ((profile.data.handle ?? '') !== handle.trim() || profile.data.leaderboardVisible !== visible);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = handle.trim();
    if (trimmed) {
      const parsed = SocialHandleSchema.safeParse(trimmed);
      if (!parsed.success) {
        setLocalError(parsed.error.issues[0]?.message ?? 'Invalid handle');
        return;
      }
    }
    if (visible && !trimmed) {
      setLocalError('Pick a handle to appear on the leaderboard');
      return;
    }
    setLocalError(null);
    update.mutate({ handle: trimmed || null, leaderboardVisible: visible });
  }

  const error = localError ?? (update.error instanceof Error ? update.error.message : null);

  return (
    <form className={styles.card} onSubmit={submit}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Handle</span>
          <span className={styles.inputWrap}>
            <span className={styles.at}>@</span>
            <input
              className={styles.input}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="your_handle"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              disabled={profile.isLoading}
            />
          </span>
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            disabled={profile.isLoading}
          />
          <span>Show me on the leaderboard</span>
        </label>
        <button className={styles.save} type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className={styles.hint} data-error={error != null}>
        {error ??
          'Your handle is public when you post under your name or join the leaderboard. Anonymous chat posts never show it.'}
      </p>
    </form>
  );
}
