import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './HoverTooltip.module.css';

type Placement = 'bottom-start' | 'bottom-end';

interface HoverTooltipProps {
  children: ReactNode;
  content: ReactNode;
  placement?: Placement;
  className?: string;
  /** Tag for the trigger wrapper. Defaults to 'span' for inline use. */
  as?: 'span' | 'div';
  /** Inline style for the trigger wrapper (e.g. cursor). */
  style?: CSSProperties;
  /** Forwarded data attribute used for CSS hooks on the trigger. */
  dataPositive?: 'true' | 'false';
  dataInteractive?: 'true';
}

interface Pos {
  top: number;
  left?: number;
  right?: number;
}

const GAP = 6;

export default function HoverTooltip({
  children,
  content,
  placement = 'bottom-start',
  className,
  as = 'span',
  style,
  dataPositive,
  dataInteractive,
}: HoverTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const computePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (placement === 'bottom-end') {
      setPos({ top: rect.bottom + GAP, right: window.innerWidth - rect.right });
    } else {
      setPos({ top: rect.bottom + GAP, left: rect.left });
    }
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => computePos();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, computePos]);

  const Tag = as;

  return (
    <>
      <Tag
        ref={triggerRef as never}
        className={className}
        style={style}
        data-positive={dataPositive}
        data-interactive={dataInteractive}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
      >
        {children}
      </Tag>
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            className={styles.tooltip}
            style={{
              top: pos.top,
              left: pos.left,
              right: pos.right,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
