---
feature: accessibility
kind: plan
status: active
created: 2026-11-27
---

# Plan: work items 3-6

Plan and suggestions for the four work items that are available now (see the
[feature README](../README.md)). Work items 1 and 2 stay parked until the grid update
lands on `main`.

The issue bodies were re-read and the current code was inspected on 2026-11-27. Every
"Finding" below cites the code it is based on. Statements marked **verify** are
platform behavior that has not been confirmed in this session and must be checked
before relying on them.

## Suggested order and PR shape

| Order | Work item | Issues | Size | Why this order |
| --- | --- | --- | --- | --- |
| 1 | 5. Explorer tree accessible names | #768 | XS | One-line fix, no UX decision. Coordinate with the volunteer first. |
| 2 | 6. Index-creation announcement | #772 | S | Reuses the existing `Announcer` pattern. |
| 3 | 4. New Document focus management | #769, #770 | S-M | #769 needs a reproduction before a fix can be chosen. |
| 4 | 3. Query Playground keyboard workflow | #773, #774 | M | Needs two UX decisions (below). |

One PR per work item keeps each fix independently verifiable by the TCS/C+AI testers,
who close the issues. Items 5 and 6 are small enough to share a PR if preferred.

## 5. Explorer tree accessible names (#768)

**Finding.** `DocumentsItem.getTreeItem()` sets a static string tooltip,
`'Click to open the collection view'`
([DocumentsItem.ts:56](../../../../../src/tree/documentdb/DocumentsItem.ts)). The issue
reports the accessible name as that tooltip text (on 0.9.1 it read "Double-click…"; the
wording has changed since, but it still does not contain "Documents"). VS Code's custom
tree view uses a string tooltip as the row's accessible name when no
`accessibilityInformation` is set (**verify** against the current VS Code tree
accessibility provider).

`IndexesItem` on this branch sets **no** tooltip
([IndexesItem.ts:154-161](../../../../../src/tree/documentdb/IndexesItem.ts)), so its name
should already be "Indexes" plus the count description. That contradicts the 2026-08-20
comment on #768; re-check it with Accessibility Insights rather than changing it blindly.
A search of `src/tree` and `src/plugins` found no other static `l10n.t()` string tooltip.

**Suggested fix.** Set
`accessibilityInformation: { label: l10n.t('Documents') }` on the Documents item and keep
the hover tooltip for sighted users. Alternative: drop the tooltip, or make it start with
the visible label ("Documents – click to open the collection view").

**Tests.** A unit test asserting the accessible name of `DocumentsItem` contains its
label. Optionally a small guard test over tree items that use a plain-string tooltip.

**Before starting.** @Jacquelinezhong volunteered on the issue and no PR exists (checked
2026-11-27). Ask on #768 whether they still plan to submit it.

## 6. Index-creation completion announcement (#772)

**Finding.** `ImprovementCard` renders success and error `MessageBar`s conditionally
after the action resolves
([ImprovementCard.tsx:216-246](../../../../../src/webviews/documentdb/collectionView/queryInsightsTab/components/optimizationCards/ImprovementCard.tsx)).
They are not live regions, so nothing is announced. On success the primary button also
becomes `disabled` (`disabled={… || !!primaryState.successMessage}`), which drops focus
from the button the user just activated to the document body. The same card serves the
drop-index and other actions, primary and secondary.

**Suggested fix.**

- Announce through the existing `Announcer` component, using the key-bump pattern from
  `IndexesTab.tsx:256-268` and `ClusterDashboard.tsx`: polite for success, assertive for
  errors. This matches the issue's requirement that the live region exist before the
  text is injected.
- Keep focus on the activated button by using Fluent's `disabledFocusable` instead of
  `disabled` after success, or move focus to the result message (`tabIndex={-1}`).
- Fix it in `ImprovementCard` for both buttons and both outcomes, not only create index.

Alternative: Fluent `MessageBar` `politeness`. **Verify** that it announces without an
`AriaLiveAnnouncer` provider in our webviews before choosing it; `Announcer` is the
established pattern in this repo.

**Tests.** A component test asserting a `role="status"` region receives the success
text, and that the button keeps focus. Add a browser scenario if Query Insights already
has one.

## 4. New Document focus management (#769, #770)

**Finding (#770).** On mount, `DocumentView` calls `saveButtonRef.current?.focus()`
([documentView.tsx:143](../../../../../src/webviews/documentdb/documentView/documentView.tsx)).
Fluent v9 draws focus rings only in keyboard-navigation mode (`:focus-visible` via
tabster/keyborg), and a programmatic focus on load does not enter that mode, so the ring
is missing until the user presses Tab (**verify** in the webview DevTools).

Related: in `view` mode Save is disabled, so the same `focus()` call silently does
nothing.

**Suggested fix (#770).** Add a small shared helper in
`src/webviews/components/accessibility/`, for example `focusWithVisibleIndicator(el)`,
that focuses the element and forces the visible indicator. Candidates, in order of
preference: Fluent/keyborg's keyboard-mode API; `el.focus({ focusVisible: true })`
(**verify** support in the VS Code Electron build); a scoped `:focus` style for the
initial-focus case. Use it at both `focus()` call sites, and pick a focus target that is
enabled in `view` mode.

**Finding (#769).** Not yet reproducible from code. The report: F6 from the editor
lands on invisible static content; then Shift+Tab reaches Save and Tab reaches a
"Go Back" button that is not in our toolbar, likely VS Code's title-bar navigation. That
pattern suggests focus landed on the webview document itself (body or iframe) or on a
hidden element such as Monaco's aria container or a Fluent portal.

**Suggested approach (#769).**

1. Reproduce and log `document.activeElement` from the webview DevTools after F6.
2. Compare with another webview editor (for example Markdown preview) to decide whether
   the F6 target is VS Code-owned.
3. If it is ours: remove any `tabIndex={0}` from non-interactive elements, and when the
   webview receives focus with `document.activeElement === document.body`, redirect it
   to the first meaningful control using the helper above.
4. If it is VS Code-owned: record it under "Upstream tracking" in the README, as was
   done for #767 and #778.

**Tests.** Cover initial open, F6, Tab and Shift+Tab together (the README requires
this). A browser scenario for the Document view can assert the initial
`document.activeElement` and the focus-visible state.

## 3. Query Playground keyboard workflow (#773, #774)

**Finding (#773).** Connect, Run, Run All, Collection View and Shell are CodeLens items
([PlaygroundCodeLensProvider.ts](../../../../../src/documentdb/playground/PlaygroundCodeLensProvider.ts)).
CodeLens items are not in the Tab order; keyboard users can only reach them through
VS Code's "Show CodeLens Commands for Current Line", which has no default keybinding.
Current non-CodeLens surfaces:

- `playground.connect` is in the Command Palette.
- `runAll` and `runSelected` have keybindings (`Ctrl+Shift+Enter`, `Ctrl+Enter`) but are
  hidden from the palette.
- `openQueryInShell` and `openQueryInCollectionView` are **not contributed in
  `package.json` at all**, so they have no keyboard path.
- `editor/title` and `editor/context` menus are empty (`package.json:973-974`).
- A status bar item exists, but it only shows connection info
  ([PlaygroundService.ts:75-76](../../../../../src/documentdb/playground/PlaygroundService.ts)).

**Suggested fix (#773).** Keep CodeLens for mouse users and add native,
keyboard-reachable surfaces:

1. Contribute `openQueryInShell` and `openQueryInCollectionView` as commands. Without
   arguments they act on the block at the cursor. Show them in the palette when a
   playground is active and connected (new context key, for example
   `documentdb.playgroundConnected`; it must not have the `name.ext` shape when used on
   its own, see the manifest-ID rule in `copilot-instructions.md`).
2. Add `editor/title` actions for playground editors: Run All and Connect / Change
   Connection inline, Shell and Collection View in the overflow menu. The editor title
   toolbar is keyboard reachable.
3. Add an `editor/context` group with the same commands (Shift+F10).
4. Make the status bar item act as Connect while disconnected, and offer "Change
   connection" when connected. The status bar is reachable with F6.
5. Show `runAll` and `runSelected` in the palette for playground editors.
6. Optionally mention the shortcuts and "Show CodeLens Commands for Current Line" in the
   new-playground header template.

**Finding (#774).** `PlaygroundResultProvider.showResult()` always opens the result
beside the editor with `preserveFocus: true`
([PlaygroundResultProvider.ts:95-113](../../../../../src/documentdb/playground/PlaygroundResultProvider.ts)).
This is deliberate for the edit-run loop: `Ctrl+Enter` is bound only while the
playground editor has focus, so moving focus would break repeated runs.

**Options (#774).** The issue accepts either moving focus or notifying.

| Option | Effect | Trade-off |
| --- | --- | --- |
| A. Always move focus (`preserveFocus: false`) | Matches the issue's first expectation | Breaks the run-edit-run loop for everyone |
| B. Move focus only in screen-reader mode | Add a `Ctrl+Enter` keybinding variant with `when: … && accessibilityModeEnabled` and `args: { focusResult: true }` | Testers who check keyboard-only without screen-reader mode still see no change. **Verify** the context key. |
| C. Setting `documentDB.playground.focusResultAfterRun` (default off) plus a "Focus Query Playground Result" command | User control and a fast way to jump | Default behavior still fails the report |
| D. Notify on completion (`showInformationMessage` with a "Focus Result" button) | Announced by screen readers | Noisy for sighted users on every run |

**Recommendation.** B + C: screen-reader mode moves focus by default, everyone else can
opt in, and a dedicated command makes results reachable with one keystroke. Choose D
instead if the testers verify #774 without screen-reader mode enabled.

**Tests.** Unit tests for the `showResult` focus option and the command `when` clauses.
`npm run build` covers the manifest; the activation check applies if any new command is
registered lazily.

## Open decisions for the operator

1. #774: which option (B + C recommended, or D).
2. #773: which commands go inline in the editor title versus the overflow menu.
3. #768: wait for @Jacquelinezhong, or take the fix.
4. Ship items 5 and 6 together or separately.

## Verification and closure

Each PR follows Case 1 while in draft and Case 2 when handed over. No fix is claimed
here. The issues stay open until the TCS/C+AI testers verify them.
