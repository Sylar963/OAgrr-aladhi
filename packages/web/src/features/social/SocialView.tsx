import { useState } from 'react';

import ChatDock from './ChatDock';
import { useSocialSocket } from './hooks/useSocialSocket';
import Leaderboard from './Leaderboard';
import ProfileCard from './ProfileCard';
import styles from './SocialView.module.css';
import ThesisFeed from './ThesisFeed';
import TraderPanel from './TraderPanel';

export default function SocialView() {
  const socket = useSocialSocket();
  const [selected, setSelected] = useState<string | null>(null);

  function select(handle: string | null) {
    const next = handle === selected ? null : handle;
    setSelected(next);
    socket.watch(next);
  }

  const watched = socket.state.trader;
  const trader =
    watched && selected && watched.handle.toLowerCase() === selected.toLowerCase() ? watched : null;
  const gone = socket.state.traderUnavailable;
  const unavailable =
    selected != null && gone?.handle.toLowerCase() === selected.toLowerCase() ? gone.reason : null;

  return (
    <div className={styles.view}>
      <ProfileCard />
      <div className={styles.body}>
        <div className={styles.main} data-split={selected != null}>
          <div className={styles.board}>
            <Leaderboard selectedHandle={selected} onSelect={(handle) => select(handle)} />
          </div>
          {selected && (
            <TraderPanel
              handle={selected}
              trader={trader}
              unavailable={unavailable}
              onClose={() => select(null)}
            />
          )}
        </div>
        <aside className={styles.theses}>
          <ThesisFeed
            selectedHandle={selected}
            onSelectTrader={(handle) => {
              if (handle.toLowerCase() !== selected?.toLowerCase()) select(handle);
            }}
          />
        </aside>
      </div>
      <ChatDock state={socket.state} send={socket.send} reconnect={socket.reconnect} />
    </div>
  );
}
