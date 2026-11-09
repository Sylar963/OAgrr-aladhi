# Desktop workspaces

Every crypto desktop tab opens an editable Dockview layout. Drag panel headers to split or group
them, drag dividers to resize, close a panel to remove it, and use **+ Widget** to add one.
**Reset layout** restores the active built-in preset. Template-based tabs offer **Reset template**;
blank tabs offer **Clear layout**. Custom-tab names, order, markets, and storage format are preserved.

## Starting from a template

1. Click **+** in the top bar or **Templates** in the workspace toolbar.
2. Choose a setup, review its panel preview, and click **Create workspace**.
3. Customize the panels as usual. **Reset template** restores that setup's starting arrangement.

| Template | Included panels |
|---|---|
| Market overview | Chain table (including tenor statistics), OI summary, vol smile |
| Trade planning | Chain table, Builder, vol smile |
| Volatility research | Vol smile, IV rank, ATM term structure, realized vs implied, skew history, 3D surface |
| Flow & positioning | Flow, GEX, OI by strike, top positions |
| Portfolio review | Portfolio, chain table, GEX; the Portfolio panel retains its sign-in boundary |
| Blank workspace | An empty canvas |

The picker creates a new tab with the current market context. On an empty custom tab, **Choose a
template** or **Templates** offers **Use in this tab**, preserving its name, ticker, and tab slot.
A populated tab is never replaced by that action. Canceling creates nothing. The picker states
the destination and explains the ten-tab limit when no additional tab can be created.

All templates fit the existing eight-widget custom-tab limit and start with at most four visible
groups. The gallery previews are diagrams; they mount no market widgets or subscriptions.

## Multiple monitors

1. Click **↗** at the right of a panel group's header to open its active panel in a real browser
   window. Drag that window onto another monitor and resize it with the operating system.
2. For a tabbed group, **▣↗** opens all of its tabs together. Only its selected tab runs.
3. Use **BTC · Workspace** (or the current ticker) in a detached header to change the shared market
   from that monitor. Workspace-bound panels share ticker, expiry, venue filters and account state.
   Panels with their own ticker controls or configured BTC/ETH comparisons retain those selections.
4. Click **Dock back**, or close the detached window, to return its panels. If every panel is out,
   the main canvas offers **Bring panels back**.

For example, start with **Trade planning** and put Chain, Builder and Vol smile on different
monitors to keep them live together within one workspace.

Allow pop-ups for this site if the browser blocks opening or restoring a window. A blocked window
leaves its panels available in the main workspace, with a retry explanation. Desktop workspaces
support this; the separate TradFi shell and mobile navigation retain their existing behavior.

The main browser window owns the session and must stay open. Detached windows belong to the active
workspace: switching workspaces closes that workspace's windows; returning restores its saved
layout, subject to the browser's pop-up permission. Resetting a layout also closes its windows.
Saved layouts include detached groups and their window geometry. Physical placement on another
monitor is ultimately controlled by the browser and operating system.

Implementation uses Dockview's native pop-out groups and React portals, keeping the same React
providers, Zustand stores, query cache and feed hub. `public/workspace-popout.html` is a script-free
host, so opening a panel doesn't bootstrap another application or duplicate its sockets. Saved
pop-out URLs are replaced with this fixed local path before restoration. `PanelDocumentContext`
keeps menus, tooltips, the asset palette, calculator and overlays in their owning window, while
`syncPopoutDocument` follows lazy-loaded CSS and language changes. All document observers and
listeners are disposed when a window closes.

Visibility is aggregated across the main document and registered pop-outs. Query polling, chain
recovery and session-idle timers treat a visible detached window as an active application, even
when the main tab is hidden. Socket and widget limits remain unchanged.

## Built-in presets

| Tab | Default panels |
|---|---|
| Chain | Table with tenor statistics, and venues, in two resizable groups |
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
- `src/lib/workspace-templates.ts` contains stable template IDs and starting groups. Custom-tab
  metadata has an optional `templateId`; older tabs remain valid and unknown template IDs are
  ignored without losing saved panels. Saved arrangements still take priority over starter groups.
  `selectLayoutPreset` supplies both built-in and template arrangements to the same dock host.
- `WorkspaceTemplatesProvider` owns the picker's transient UI state. Its native modal gallery is
  lazy-loaded when opened, supports keyboard selection and Escape, and returns focus on close.
  No template or Dockview chunk is requested by mobile navigation.

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

Chain statistics stay directly below the tenor selector inside the chain table. Legacy stats panels
merge into the table on restore, preserving the other docked and detached panel positions. A saved
workspace containing only the old stats panel receives the complete chain table in its place.

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
Template tests also cover canceling without changes, filling only empty tabs, capacity, unknown
template IDs, and retaining a template through persistence and reset.

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

Template-gallery validation: the same sequential gate passed all 4,514 tests across 551 files,
including 1,401 web tests. The production build passed. Chromium verified selection previews,
keyboard navigation, Escape and focus return, canceling without changes, reset/reload, filling an
empty tab in place, preserving populated workspaces, Spanish labels, and mobile chunk isolation.
The gallery adds about 0.6 KB gzip to the entry bundle; its UI loads on demand.

Multi-monitor validation covered native panel and group windows, selecting a hidden tab in a
detached group, shared market changes, same-window asset selection and menus, calculator movement
and entered-value preservation, dock back, operating-system window close, bringing every panel
back, blocked opens and blocked saved-window restoration, custom-template workspace switching,
reload membership, Spanish labels/language, parent-window cleanup, and mobile chunk isolation.
These Chromium checks passed against both development and production builds without page errors.
The final production entry is 362,102 bytes gzip, 2,786 bytes above the original migration baseline;
Dockview and its window controls remain lazy-loaded. The focused regression suite passes 41 tests.
The final `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm precommit` gate passed all
typechecks and 4,576 tests across 560 files. `pnpm --filter @oggregator/web build` also passed.
