import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * How many trailing tab groups must fold into the overflow menu so the
 * inline groups plus the menu trigger fit in `available` px.
 */
export function foldCount(
  groupWidths: readonly number[],
  moreWidth: (folded: number) => number,
  available: number,
): number {
  let inline = groupWidths.reduce((sum, w) => sum + w, 0);
  if (inline <= available) return 0;
  for (let k = 1; k < groupWidths.length; k++) {
    inline -= groupWidths[groupWidths.length - k]!;
    if (inline + moreWidth(k) <= available) return k;
  }
  return groupWidths.length;
}

interface TabFitRefs {
  bar: RefObject<HTMLElement | null>;
  left: RefObject<HTMLElement | null>;
  right: RefObject<HTMLElement | null>;
  tabs: RefObject<HTMLElement | null>;
  measure: RefObject<HTMLElement | null>;
}

const width = (el: Element | null) => el?.getBoundingClientRect().width ?? 0;

/**
 * Priority-plus nav: measures a hidden copy of every tab group and returns how
 * many trailing groups to fold so the tabs never collide with the side clusters.
 * `activeGroupIndex` matters because the trigger shows the active tab's label
 * once that tab is folded, which is wider than "More".
 */
export function useTabFold(refs: TabFitRefs, activeGroupIndex: number): number {
  const [fold, setFold] = useState(0);

  useLayoutEffect(() => {
    const { bar, left, right, tabs, measure } = refs;
    if (!bar.current || !left.current || !right.current || !tabs.current || !measure.current) return;
    const barEl = bar.current;
    const tabsEl = tabs.current;
    const measureEl = measure.current;

    const update = () => {
      const barStyle = getComputedStyle(barEl);
      if (getComputedStyle(tabsEl).display === 'none') return;
      const tabsStyle = getComputedStyle(tabsEl);
      const inner =
        barEl.clientWidth - parseFloat(barStyle.paddingLeft) - parseFloat(barStyle.paddingRight);
      const gaps = 2 * (parseFloat(barStyle.columnGap) || 0);
      const chrome =
        parseFloat(tabsStyle.paddingLeft) +
        parseFloat(tabsStyle.paddingRight) +
        parseFloat(tabsStyle.borderLeftWidth) +
        parseFloat(tabsStyle.borderRightWidth);
      const available = inner - width(left.current) - width(right.current) - gaps - chrome;

      const groupWidths = [...measureEl.querySelectorAll('[data-measure="group"]')].map(width);
      const moreLabel = width(measureEl.querySelector('[data-measure="more"]'));
      const activeLabel = width(measureEl.querySelector('[data-measure="more-active"]'));
      const moreWidth = (k: number) =>
        activeGroupIndex >= groupWidths.length - k ? activeLabel : moreLabel;

      setFold(foldCount(groupWidths, moreWidth, available));
    };

    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    for (const el of [barEl, left.current, right.current, measureEl]) observer.observe(el);
    return () => observer.disconnect();
  }, [refs, activeGroupIndex]);

  return fold;
}
