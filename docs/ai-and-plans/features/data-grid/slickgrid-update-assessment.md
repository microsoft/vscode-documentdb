---
feature: data-grid
kind: research
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - package.json
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx
  - src/webviews/slickgrid.scss
---

# Has SlickGrid addressed our pain points?

**Yes: there have been substantial, directly relevant accessibility and column-resizing
improvements since our pinned version.** Staying on SlickGrid is not the same as staying on
today's implementation. This makes an upgrade a credible comparison option, not the preferred
long-term recommendation in [the migration report](./migration-research.md).

Research date: **2026-11-26**. Our manifest uses `slickgrid-react ~9.13.0`; the lockfile resolves
9.13.0. That release dates to 2026-01-30. At research time, both the configured registry's `latest` tag and the
current monorepo's latest stable release are **11.0.0**, released 2026-11-10.
Registry metadata here came from the environment's preconfigured registry; direct npmjs.org
access is not permitted, and no published tarball was inspected.
`~9.13.0` will not receive 10.x or 11.x changes.

## 1. Follow the correct upstream project

The old [`ghiscoding/slickgrid-react`](https://github.com/ghiscoding/slickgrid-react/releases/tag/v5.14.1)
repository's latest release is 5.14.1 from 2025-05-08. Its release note explicitly says the
framework wrappers are moving into
[`ghiscoding/slickgrid-universal`](https://github.com/ghiscoding/slickgrid-universal).
It is **not** evidence that development stopped at v5. Follow the monorepo's
[9.13.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v9.13.0),
[10.0.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v10.0.0),
[10.2.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v10.2.0),
[10.10.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v10.10.0) and
[11.0.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v11.0.0) releases.
The similarly named `6pac/SlickGrid` is a related implementation; a fix there must not be assumed
to exist in our wrapper until it is ported into Slickgrid-Universal.

## 2. Relevant shipped improvements

Dates below are release dates; links identify the implementation work. Relevance is assessed
against our actual options, not the entire SlickGrid feature catalogue.

| Released                               | Change                                                                                                                                                                                                                                                                                                                                                                                                       | Relevance to DocumentDB                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.0.0, 2026-03-03                     | [ghiscoding/slickgrid-universal#2393](https://github.com/ghiscoding/slickgrid-universal/pull/2393): focusable headers/menus/select-all, arrow-key menu navigation, Enter/Space sorting, focus-visible styling. [ghiscoding/slickgrid-universal#2404](https://github.com/ghiscoding/slickgrid-universal/pull/2404): ARIA row/column counts.                                                                   | Core focus and structural metadata matter. Menu/select-all improvements are largely latent because our table disables menus and its checkbox selector.                                                                                                   |
| 10.0.0                                 | [ghiscoding/slickgrid-universal#2405](https://github.com/ghiscoding/slickgrid-universal/pull/2405): resize-handle/cursor styling; [ghiscoding/slickgrid-universal#2402](https://github.com/ghiscoding/slickgrid-universal/pull/2402): grid-menu overlap with resize handles.                                                                                                                                 | Handle usability is relevant; our menu is disabled, so do not claim the overlap fix explains our particular symptom.                                                                                                                                     |
| 10.2.0, 2026-03-24                     | [ghiscoding/slickgrid-universal#2456](https://github.com/ghiscoding/slickgrid-universal/pull/2456): focus-sink/focus-mode refinement; [ghiscoding/slickgrid-universal#2457](https://github.com/ghiscoding/slickgrid-universal/pull/2457): menu-focus restoration; [ghiscoding/slickgrid-universal#2448](https://github.com/ghiscoding/slickgrid-universal/pull/2448): Space/Left/Right tree/group expansion. | Tree keyboard behavior and core focus handling are especially relevant. The previous plan must not treat today's tree keyboard behavior as already proven.                                                                                               |
| 10.5.0, 2026-04-18; 10.5.1, 2026-04-22 | [ghiscoding/slickgrid-universal#2531](https://github.com/ghiscoding/slickgrid-universal/pull/2531): resize beyond the viewport with automatic scrolling; [ghiscoding/slickgrid-universal#2538](https://github.com/ghiscoding/slickgrid-universal/pull/2538): follow-up outside-webview behavior.                                                                                                             | Addresses wide-grid pointer resizing. It is not a fix for our manual container `ResizeObserver`, nor evidence of keyboard resize support.                                                                                                                |
| 10.7.0, 2026-05-09                     | [ghiscoding/slickgrid-universal#2573](https://github.com/ghiscoding/slickgrid-universal/pull/2573): respect `multiSelect` in checkbox and keyboard row selection.                                                                                                                                                                                                                                            | Relevant to retaining predictable single/multi-row actions after upgrading.                                                                                                                                                                              |
| 10.8.3, 2026-07-04                     | [ghiscoding/slickgrid-universal#2631](https://github.com/ghiscoding/slickgrid-universal/pull/2631): custom-tooltip accessibility; [ghiscoding/slickgrid-universal#2632](https://github.com/ghiscoding/slickgrid-universal/pull/2632): frozen-column/resize auto-scroll interaction.                                                                                                                          | Tooltip work may help if that plugin is used; our formatter currently supplies `toolTip`. Frozen-column behavior is not a current enabled feature.                                                                                                       |
| 10.10.0, 2026-08-28                    | [ghiscoding/slickgrid-universal#2694](https://github.com/ghiscoding/slickgrid-universal/pull/2694): missing header ARIA row/rowgroup structure; [ghiscoding/slickgrid-universal#2773](https://github.com/ghiscoding/slickgrid-universal/pull/2773): prevent resize auto-scroll jumps.                                                                                                                        | Both are directly relevant. The resize fix clamps the pointer at the viewport edge and paces scrolling rather than immediately jumping hundreds of pixels.                                                                                               |
| 11.0.0, 2026-11-10                     | [ghiscoding/slickgrid-universal#2872](https://github.com/ghiscoding/slickgrid-universal/pull/2872), merged 2026-10-27: stable resize-handle hit box on hover.                                                                                                                                                                                                                                                | Particularly close to "hard to grab" resizing: previously the hovered handle itself shrank, could lose hover and flicker; the visual pill now uses a pseudo-element. This is a plausible contributor, not a diagnosis of our unrecorded repro.           |
| 11.0.0                                 | [ghiscoding/slickgrid-universal#2884](https://github.com/ghiscoding/slickgrid-universal/pull/2884), merged 2026-10-30: content sizing uses canvas text measurements, CSS font/padding and distributed row sampling; optional inclusion of header width.                                                                                                                                                      | More accurate than length-times-average-character estimates. Our table enables autosizing, but these **resize-by-content** improvements require checking which sizing path/options we actually use. Not every auto-size mode is content fitting.         |
| 11.0.0                                 | [ghiscoding/slickgrid-universal#2906](https://github.com/ghiscoding/slickgrid-universal/pull/2906), merged 2026-11-05: synchronize `aria-selected`, expose primary visible `aria-sort`, preserve existing tooltip descriptions, resolve header key events from nested controls, ignore row-detail toggle keys from inside panels.                                                                            | Selection/header semantics are directly useful. Row-detail work does not affect our current tree/table because we do not enable that plugin. Menu focus after commands was explicitly deferred, so this is not a blanket accessibility completion claim. |
| 11.0.0                                 | Single-viewport pinning replaces frozen panes; sticky docking, tree multi-column sorting and tree lookup/performance changes.                                                                                                                                                                                                                                                                                | Potential improvements, but not migration prerequisites. Our existing grid does not enable freezing and explicitly disables tree sorting. Upstream benchmarks are not measurements of our extension.                                                     |

The v10 guide also documents a **Fluent UI visual theme**, and v11 adds a Fluent icon-set option.
This weakens the old argument that a SlickGrid refresh necessarily leaves us with only its default
visual theme. It does **not** turn the imperative wrapper into Fluent React components or remove
our VS Code token integration.

## 3. Is upgrading a small alternative?

Smaller than replacing both renderers, but **not a dependency-only bump**:

1. Follow both tagged migration guides:
   [v10](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/docs/migrations/migration-to-10.x.md)
   and [v11](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/docs/migrations/migration-to-11.x.md).
   The v10 selection change directly touches us: `enableRowSelection` becomes `enableSelection`;
   `rowSelectionOptions` becomes `selectionOptions`; the hybrid model replaces the separate models.
   Explicitly preserve row-selection behavior rather than accepting new mixed-selection defaults.
2. Audit dynamic column replacement, hidden-column semantics, formatter/tree classes, CSS/SASS
   overrides and tests. v10 keeps hidden columns in the complete column list; v11 changes tree
   toggle classes and renderer DOM. Our build fixture asserts version-specific SlickGrid styles.
3. Check resizing modes and all custom theme overrides. Some v11 sizing options were renamed or
   removed; handle hover decoration moved to `::after`. Do not transplant selectors blindly.
4. React is not an immediate blocker: our manifest uses React/React DOM `~19.2.4`, while
   [Slickgrid React v11](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/package.json)
   declares React `>=19.0.0`. The migration guide's i18next/react-i18next minimums matter **if
   using that translation integration**; they are not both declared React wrapper peer dependencies.
   Preserve our existing `@vscode/l10n` localization rather than assuming a second translation
   stack is required.
5. Run the same [parity and accessibility gates](./migration-parity.md) as a replacement. The
   upstream fixes do not remove our object drill-in/type-indicator responsibilities, stale-event
   handling, explicit rerender workaround or chosen manual container resizing.

## 4. Assessment

**Do not justify migration by saying "SlickGrid has not improved." It has.** In particular,
the v11 handle-hover and v10 resize-jump fixes deserve a brief reproducible comparison if we want
to identify the current resizing problem's cause.

The stronger reasons to migrate remain React integration, a smaller imperative adapter surface,
sharing a partner's maintained approach, and owning cell interactions in ordinary React.
An upgrade is a credible fallback or temporary mitigation if replacing the tree blocks release.
No evidence here establishes WCAG conformance for either option, and no screen reader, packaged
extension, resize repro or performance benchmark was run as part of this source research.
