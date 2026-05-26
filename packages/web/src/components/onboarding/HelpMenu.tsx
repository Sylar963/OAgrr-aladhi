import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@stores/app-store';

import styles from './HelpMenu.module.css';

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export default function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const startTour = useAppStore((s) => s.startTour);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current != null && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const takeTour = () => {
    setOpen(false);
    startTour();
  };

  const openShortcuts = () => {
    setOpen(false);
    onOpenShortcuts();
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.qbtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Help"
      >
        ?
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" className={styles.item} role="menuitem" onClick={takeTour}>
            Take the tour
          </button>
          <button type="button" className={styles.item} role="menuitem" onClick={openShortcuts}>
            Keyboard shortcuts <kbd className={styles.kbd}>?</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
