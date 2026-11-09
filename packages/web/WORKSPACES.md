# Desktop workspaces

Every crypto desktop tab opens an editable Dockview layout. Drag panel headers to split or group
them, drag dividers to resize, close a panel to remove it, and use **+ Widget** to add one.
**Reset layout** restores the active built-in preset. Custom tabs use **Clear layout** instead;
their names, order, markets, and storage format are preserved.

## Built-in presets

| Tab | Default panels |
|---|---|
| Chain | Table, statistics, and venues, in three resizable groups |
| Analytics | All ten existing cards, grouped into four visible areas |
| Volatility | Six panel types for both BTC and ETH: twelve independent instances in four groups |
| Other nine tabs | Their complete existing view, inside one movable panel |

Panels within the same group are tabs: only the active panel mounts. The presets keep access to
every existing Analytics card and both sides of the volatility comparison without running all
charts at once. The complete Alpha, Builder, Paper, Portfolio, Flow, and Social views retain their
internal controls and shared feature state. Their internal sections have not been split into
separate widgets.

## State and persistence

- `src/lib/workspace-layouts.ts` defines presets, canonical instance IDs, membership validation,
  capacity rules, and semantic navigation targets. An instance is `{ id, kind, underlying? }`.
  Only surface cards support an explicit BTC/ETH ticker. Such instances use controlled ticker
  props; ordinary unconfigured cards retain their existing ticker selection behavior.
- `selectActiveLayoutId` separates layout identity from market identity. Built-in layouts have
  IDs such as `builtin-chain`, but keep using the shared `main` market. Custom layouts retain
  their independent market contexts. Built-ins consume no custom-tab slots.
- `selectLayoutPanels` adapts the existing custom-tab `kinds` representation to the same instance
  model used by built-ins. The weak cache keeps selectors stable without duplicating UI state.
- `DockHost` handles initialization, restore, membership reconciliation, visibility, focus, and
  debounced layout saves for both sources. Preset placement runs only at initialization; adding
  a widget later activates it without rearranging existing groups.
- `WorkspaceView` is the lazy desktop entry; mobile still renders the original single views.
  TradFi continues to use its separate application shell. Public tab/ticker hashes are unchanged.

| Key | Contents |
|---|---|
| `ogg.customTabs.v1` | Existing custom-tab metadata and market selections |
| `ogg.customTabLayout.v1.<id>` | Existing custom-tab dock arrangements |
| `ogg.builtinLayouts.v1` | Built-in membership overrides, parsed independently by tab |
| `ogg.builtinLayout.v1.<tab>` | Built-in dock arrangements |

An absent override uses the preset; an empty array deliberately opens an empty layout. Reset
deletes only the active override and arrangement, then remounts the host. The revision guard
prevents a pending save from bringing back the old arrangement. Teardown flushes panel removals
before saving, so closing a panel and immediately switching tabs does not resurrect it.

Saved panel parameters must match membership before restore. Legacy custom arrangements without
instance IDs in their parameters are hydrated from membership. Bad overrides cannot block startup.
All data stays local to the browser; no backend or account persistence is added.

## Navigation and resource limits

Feature navigation resolves a semantic destination to an instance in the active layout: Chain
can focus `chain-table`, and Builder can remain docked alongside it. Otherwise it opens the
corresponding built-in layout and carries the ticker and expiry. If its main panel was removed,
navigation restores that panel while retaining other layout choices. Capacity reserves a slot
for that destination while it is absent. Mobile navigation ignores desktop panel membership.

Custom tabs retain their eight-widget and ten-tab limits. The ten-card Analytics and twelve-card
Volatility stock presets have capacity for their existing content; additions beyond eight are
limited to restoring that preset's own cards. Those extra native cards use REST data. This does
not increase the allowance for optional socket-bearing widgets. Complete Chain, Analytics, and
Volatility views cannot be added alongside their constituent cards. Unsafe duplicate singleton
views and more than two differently configured 3D surface instances are rejected.

The feed hub's three-chain limit is unchanged. Hidden widgets unmount, and layout changes do not
subscribe to market ticks. Dockview stays outside the entry bundle and is never requested by the
mobile single-view renderer. Keep the existing ten-socket budget when extending the catalog.

## Verification

Run `pnpm precommit` and `pnpm --filter @oggregator/web build`. On machines with heavy concurrent
work, `VITEST_MAX_WORKERS=2 pnpm precommit` runs the same tests and assertions with fewer workers.
Regression tests cover default coverage, duplicate prevention, metadata parsing, semantic focus,
mobile navigation, intentional empty layouts, reset races, and teardown persistence.

The migration was also exercised in Chromium: all twelve desktop defaults, close/reload/reset,
adding and focusing Builder, custom-tab persistence and clear, BTC/ETH comparison, a 1000px
desktop viewport, and a 390px mobile viewport. Mobile requested no Dockview code.

Final migration validation:

| Check | Result |
|---|---|
| `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm precommit` | All typechecks and 4,495 tests across 548 files passed |
| `pnpm --filter @oggregator/web build` | Passed |
| Chromium layout interactions | Resize and drag-to-group arrangements survived reload; no page errors |
| Entry JS versus original `4dd28a0b` | Approximately 1.2 KB additional gzip, within the 5 KB budget |

The first concurrent full-suite runs exposed unrelated timing-sensitive core/server failures.
The sequential gate passed with the same assertions and timeouts. Browser verification used a
temporary Vite configuration matching the production ES2022 target to avoid the installed
dependency optimizer's older-target transformation error; repository Vite settings were unchanged.
