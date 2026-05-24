import { useEffect, useState } from 'react';

import { useFeedToasts } from '@hooks/useFeedToasts';
import { addDismissedId, loadDismissedIds, selectActiveNotice } from '@lib/system-status';
import { useAppStore } from '@stores/app-store';

import StatusBanner from './StatusBanner';
import StatusTakeover from './StatusTakeover';
import ToastStack from './ToastStack';

export default function SystemNotifications() {
  // Side-effect only: subscribes to feed state and drives feedDegraded + toasts.
  useFeedToasts();

  const announcement = useAppStore((s) => s.announcement);
  const feedDegraded = useAppStore((s) => s.feedDegraded);
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => loadDismissedIds());
  const [now, setNow] = useState(() => Date.now());

  const selection = selectActiveNotice(announcement, feedDegraded, dismissedIds, now);

  // Tick once per second only while a countdown or expiry is pending.
  const needsTick =
    (announcement?.startsAt != null && announcement.startsAt > now) ||
    announcement?.endsAt != null;

  useEffect(() => {
    if (!needsTick) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [needsTick]);

  const handleDismiss = () => {
    if (selection.notice?.id) setDismissedIds(addDismissedId(selection.notice.id));
  };

  return (
    <>
      {selection.surface === 'banner' && selection.notice && (
        <StatusBanner notice={selection.notice} now={now} onDismiss={handleDismiss} />
      )}
      {selection.surface === 'takeover' && selection.notice && (
        <StatusTakeover notice={selection.notice} />
      )}
      <ToastStack />
    </>
  );
}
