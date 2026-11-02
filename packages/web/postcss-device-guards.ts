import type { CSSOptions } from 'vite';

import { DESKTOP_QUERY, MOBILE_QUERY } from './src/lib/breakpoints';

type PostcssOptions = Exclude<NonNullable<CSSOptions['postcss']>, string>;
type PostcssPlugin = NonNullable<PostcssOptions['plugins']>[number];

const HOVER_MEDIA = '(hover: hover)';
const NAMED_MEDIA: Record<string, string> = {
  '(--mobile)': MOBILE_QUERY,
  '(--desktop)': DESKTOP_QUERY,
};

/**
 * Expands the `(--mobile)` and `(--desktop)` media names so CSS and useIsMobile share one
 * definition, and limits `:hover` rules to devices that can hover. Without that guard a tap
 * leaves the hover style stuck on until the next tap elsewhere.
 */
export function deviceGuards(): PostcssPlugin {
  return {
    postcssPlugin: 'device-guards',
    Once(root, { AtRule }) {
      root.walkAtRules('media', (atRule) => {
        const expanded = NAMED_MEDIA[atRule.params];
        if (expanded != null) atRule.params = expanded;
      });

      root.walkRules((rule) => {
        if (!rule.selector.includes(':hover')) return;
        const parent = rule.parent;
        if (parent?.type === 'atrule' && 'params' in parent && parent.params === HOVER_MEDIA) return;

        const hoverSelectors = rule.selectors.filter((s) => s.includes(':hover'));
        const otherSelectors = rule.selectors.filter((s) => !s.includes(':hover'));
        const guarded = new AtRule({ name: 'media', params: HOVER_MEDIA });
        guarded.append(rule.clone({ selectors: hoverSelectors }));

        if (otherSelectors.length === 0) {
          rule.replaceWith(guarded);
        } else {
          rule.selectors = otherSelectors;
          rule.after(guarded);
        }
      });
    },
  };
}
