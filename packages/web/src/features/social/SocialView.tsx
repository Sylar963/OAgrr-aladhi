import ChatPanel from './ChatPanel';
import Leaderboard from './Leaderboard';
import ProfileCard from './ProfileCard';
import styles from './SocialView.module.css';

export default function SocialView() {
  return (
    <div className={styles.view}>
      <div className={styles.main}>
        <ProfileCard />
        <Leaderboard />
      </div>
      <aside className={styles.side}>
        <ChatPanel />
      </aside>
    </div>
  );
}
