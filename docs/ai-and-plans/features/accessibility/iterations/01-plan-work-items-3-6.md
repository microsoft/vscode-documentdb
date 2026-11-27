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
| 4 | 3. Query Playground keyboard workflow | #773, #774 | M | Needs four UX decisions (3a-3d below). |

One PR per work item keeps each fix independently verifiable by the TCS/C+AI testers,
who close the issues. Items 5 and 6 are small enough to share a PR if preferred.

**Implementation dispatch (2026-11-27).** The operator requested implementation
on this branch and allowed bundling simple work. Opus (`claude-opus-5.5`) is the
read-only advisor. Its coding recommendations and actual assignments are
`mai-code-2` for 5, 6, the Playground foundation (3a-3c), the header and manual
documentation (3e, 7), and Document initial focus (4a); `gpt-6.1-sol` for the
Playground result lifecycle (3d). The setting/keybindings and result lifecycle
stay together so their commit builds without a placeholder API. Lightweight
coordination, exploration and checks use `mai-code-2-flash`. Document workbench
verification (4b) is last. These splits do not add accepted scope; work items
1 and 2 remain parked.

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

**Coordination (2026-11-27).** The required question was
[posted](https://github.com/microsoft/vscode-documentdb/issues/768#issuecomment-7224367147)
before implementation. The accepted prerequisite is to ask, not to require a
reply. Indexes still needs a real Accessibility Insights check; a unit assertion
is not that verification.

> **Done (2026-11-27), commit `04affdf7`:** `mai-code-2` added the explicit
> Documents accessible label while preserving the tooltip, plus two Documents
> tests and one Indexes guard. Naming follows the operator's accepted 0006
> decision; the leader approved the one-line implementation at 99% confidence
> because it directly supplies VS Code's supported accessibility label.
> The leader requested reuse of the existing Indexes test fixture instead of a
> new double cast; no existing behavior assertions were weakened. The focused
> Documents/Indexes run passed all 16 tests. Case 1 batch build and real
> Accessibility Insights verification remain pending; the issue stays open.

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

> **Done (2026-11-27), commit `91dd07c4`:** `mai-code-2` added four persistent
> Announcers for primary/secondary success and failure and used `disabledFocusable`
> during loading and after success. This follows the operator's accepted 0006
> design. Advised (`claude-opus-5.5`), 88% confidence: action handlers and
> disabling conditions stay unchanged; retry clears error state so the existing
> Announcer can announce the same failure again. The leader required a fresh DOM
> identity assertion and a post-success duplicate-click check. Four new component
> tests passed, covering both actions and repeated failures. The worker's type
> check hit TS6305 because workspace declaration outputs had not been built;
> the Case 1 batch build remains pending. No new message keys or live-region
> provider were introduced. Actual screen-reader announcement remains unverified.

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

**Operator test gates (2026-11-27).** The operator explicitly left workbench
checks pending. Before any #769 fix, capture `document.activeElement.outerHTML`
and `document.hasFocus()` after F6 in Webview DevTools and compare Markdown
preview. Do not infer upstream ownership or add a speculative redirect.
Initial Save focus-ring verification also remains pending. The operator chose
a direct keyborg dependency for the accepted focus helper (decision 0008).

**Helper-idea inspection (2026-11-27).** At the operator's request, a read-only
`mai-code-2-flash` agent inspected public `microsoft/vscode-cosmosdb`. Its
[Monaco wrapper](https://github.com/microsoft/vscode-cosmosdb/blob/main/src/webviews/MonacoEditor.tsx#L139-L151)
has an invisible focus-trap bumper and uses `useUncontrolledFocus`; the inspected
Document panel had no explicit initial-focus or F6 handling. This is a candidate
to identify during the F6 reproduction, not evidence of the root cause or a
recommended implementation. No bumper or focus-trap change is authorized here.

## 3. Query Playground keyboard workflow (#773, #774)

The two issues describe one workflow: connect, write a query, run it, read the result,
and move it to another surface. Today that workflow assumes a mouse at two points
(the CodeLens buttons) and assumes sight at a third (noticing that the result tab
updated). The decisions below are listed in the order they block implementation.

### 3.1 Current behavior (from the code)

| Action | CodeLens (mouse) | Keyboard path today | Gaps |
| --- | --- | --- | --- |
| Connect | "Connect" on line 1 | Command Palette "Query Playground: Connect to Database"; status bar item (F6 to the status bar, then arrow keys) | Neither is visible from the editor or the Tab order, so testers did not find them |
| Change connection | "$(plug) cluster/db" on line 1 → modal | Status bar item → same modal | `showConnectionInfo` is hidden from the palette |
| Run All | line 1 | `Ctrl+Shift+Enter` | Hidden from the palette; only documented in the file's header comment |
| Run block | block start line | `Ctrl+Enter` | Same as Run All |
| Open block in Shell | block start line, only when connected and the block contains code | **none** | Not contributed in `package.json`; the handler returns silently without `uri, startLine, endLine` arguments |
| Open block in Collection View | same as Shell | **none** | Same as Shell |

Sources: [PlaygroundCodeLensProvider.ts](../../../../../src/documentdb/playground/PlaygroundCodeLensProvider.ts),
[PlaygroundService.ts:347-366](../../../../../src/documentdb/playground/PlaygroundService.ts)
(the status bar item already switches to Connect when disconnected),
[playgroundOpenInShell.ts:26-28](../../../../../src/commands/playground/playgroundOpenInShell.ts),
`package.json:973-974` (empty `editor/title` and `editor/context`) and the
`commandPalette` entries that set `when: never` for `runAll`, `runSelected` and
`showConnectionInfo`.

VS Code's built-in fallback, "Show CodeLens Commands for Current Line"
(`codelens.showLensesInCurrentLine`), has no default keybinding and lists only the lenses
on the **cursor's line** (checked in VS Code's `codelensController.ts`). Our Connect and
Run All lenses sit on line 1 and the block lenses on the block's first line, so a
keyboard user would have to move the cursor to exactly those lines. It is a workaround,
not a fix.

Running a query reports progress in a notification and shows failures with
`showErrorMessage`, which screen readers announce. **Success is the only silent
outcome**: the result opens or updates beside the editor with `preserveFocus: true`
([PlaygroundResultProvider.ts:95-113](../../../../../src/documentdb/playground/PlaygroundResultProvider.ts)).

### 3.2 #773: make every action reachable without CodeLens

The principle: CodeLens stays as the mouse shortcut, and every lens action also exists
as a regular command on standard keyboard-reachable VS Code surfaces. No custom focus
handling is needed in the editor.

Required groundwork, independent of the decisions below:

- Make `openQueryInShell` and `openQueryInCollectionView` work without arguments by
  using the block at the cursor, with the same fallback to the preceding block that
  `runSelected` uses. Extract that block resolution into a shared helper so CodeLens,
  `runSelected` and the new entry points agree on the block.
- Add context keys for menu `when` clauses: the playground is connected, and the
  current block contains code. Set them from the existing `onDidChangeState` and
  selection listeners. Context-key names must not have the `name.ext` shape when they
  appear on their own in `package.json` (see the manifest-ID rule in
  `copilot-instructions.md`).
- Record `activationSource` per surface (`codeLens`, `editorTitle`, `editorContext`,
  `commandPalette`, `keybinding`) so we can see which surfaces people use.

**Amendment (2026-11-27).** The operator approved honest grouped attribution
instead of guessing indistinguishable VS Code invocation surfaces; see
[decision 0007](../decisions.md#0007--playground-telemetry-groups-indistinguishable-invocation-surfaces).
The coding interface uses bounded CodeLens, editor-menu, screen-reader-shortcut
and other buckets, preserving existing CodeLens telemetry.

**Decision 3a: which surfaces to add.** **Decided 2026-11-27
([decisions 0002](../decisions.md#0002--playground-actions-use-standard-vs-code-surfaces-no-new-keybindings)):**
palette, editor title, context menu and header comment; no new default keybindings.
`Ctrl+Enter` and `Ctrl+Shift+Enter` stay as they are.

| Surface | How keyboard users reach it | Discoverable? | Cost | Recommendation |
| --- | --- | --- | --- | --- |
| Command Palette entries | `Ctrl+Shift+P`, type "Query Playground" | Medium | Tiny: change `when: never` to `editorLangId == 'documentdb-playground'` | **Yes**, the minimum |
| Editor title toolbar (`editor/title`) | Focus the tab, then Tab into the toolbar | High: visible buttons next to the tab | Small; icons needed | **Yes**, the closest equivalent to the CodeLens buttons |
| Editor context menu (`editor/context`) | `Shift+F10` or the Menu key in the editor | Medium | Small | **Yes**, it acts on the cursor's block, matching the block lenses |
| Default keybindings for Shell / Collection View | Shortcut | Low unless documented | Risk of conflicts with user or other extension bindings | **No**; users can bind the commands themselves |
| Header comment in new playgrounds | Read with the file | High for screen-reader users | Tiny | **Yes**: name the palette commands and the context menu |

**Decision 3b: what goes inline in the editor title and what goes in the overflow
menu ("…").** Inline buttons are the most visible but crowd the title bar, which also
holds VS Code's own split and more-actions buttons.

- Recommended inline: **Run All** (with the `run-all` icon) and **Connect / Change
  Connection** (with the `plug` icon). These are file-level actions, like their
  line-1 lenses.
- Recommended overflow: **Run Block**, **Open Block in Shell**, **Open Block in
  Collection View**. They depend on the cursor position, so they fit the context menu
  better and should be there too.
- Alternative: put all five in the overflow menu to keep the title bar clean, at the
  cost of discoverability.

**Decision 3c: one Connect entry point or two.** Today the connected state uses
`showConnectionInfo` (a modal offering to switch), and the disconnected state uses
`connect`. The editor title can show the right command per state using the
"connected" context key, or show a single "Connect to Database…" that always opens the
picker. Recommended: one title action per state, mirroring the CodeLens and the status
bar, so all three surfaces behave the same.

**Decisions 3b and 3c: decided as recommended
([decisions 0003](../decisions.md#0003--playground-editor-title-layout-and-connect-follow-the-recommendations)).**

**Out of scope.** A setting to hide CodeLens, and changing the CodeLens layout. The
issue is about reachability, not about removing CodeLens.

### 3.3 #774: make the completed run discoverable

The issue accepts either outcome: "keyboard focus should move to the newly opened
result tab, **or** users should be notified". Moving focus is costly here because
`Ctrl+Enter` and `Ctrl+Shift+Enter` only work while the playground editor has focus. A
user whose focus moves to the result after every run has to return to the playground
(for example with "View: Focus Previous Editor Group") before running again.

**Decision 3d: what happens by default after a successful run.** **Decided 2026-11-27
([decisions 0004](../decisions.md#0004--after-a-run-focus-moves-to-the-result-only-in-screen-reader-mode)):**
option B through the `afterRun` setting below, documented on a new Accessibility page
(§7). The options are kept for the record.

| Option | Behavior | Who benefits | Cost | Satisfies #774 for a tester using NVDA? |
| --- | --- | --- | --- | --- |
| A. Always move focus | `preserveFocus: false` | Screen-reader users | Breaks the edit-run loop for everyone | Yes |
| B. Move focus only in screen-reader-optimized mode | A second `Ctrl+Enter` / `Ctrl+Shift+Enter` keybinding with `when: … && accessibilityModeEnabled` and `args: { screenReaderMode: true }`; the command then moves focus to the result | Screen-reader users | Sighted keyboard-only users see no change. Runs started from CodeLens or the palette do not carry the args. | Yes, if VS Code detected the screen reader or `editor.accessibilitySupport` is `on` |
| C. Announce instead of moving focus | On success, show a non-modal notification such as "Query returned 20 documents" with a **Focus Result** button; focus stays in the playground | Screen-reader users; also gives everyone a one-step way to the result | A toast after every run is noise for sighted users | Yes, notifications are announced |
| C'. Announce instead of moving focus, only in screen-reader mode | Same as C, but only for runs that carry `screenReaderMode: true` (same keybinding mechanism as B). **An alternative to B, not an addition**: in screen-reader mode a run either moves focus (B) or announces (C'), never both | Screen-reader users | Same path limits as B | Yes, if the testers accept "notified" rather than "focus moved" |
| D. Setting only | `documentDB.playground.afterRun`: `stay` (default), `focusResult`, `notify` | Users who find the setting | Default behavior unchanged | **No**, default behavior still fails |

Notes for evaluating the options:

- VS Code defines `CONTEXT_ACCESSIBILITY_MODE_ENABLED` for screen-reader-optimized mode,
  and VS Code's own features gate keybindings on it. **Verify** that the key string is
  `accessibilityModeEnabled` with "Developer: Inspect Context Keys" before relying on it.
  Extensions cannot read context keys directly, so the keybinding `args` is the only
  way to pass this mode to the command. Reading the `editor.accessibilitySupport`
  setting only helps when it is explicitly `on`, not `auto`.
- `runSelected(context, startLine, endLine)` takes positional line numbers from
  CodeLens. Keybinding `args` arrive as one object in the first position, so the
  signature must accept either form, for example `startLineOrOptions: number | { screenReaderMode?: boolean }`.
- "Focus Query Playground Result" as a palette command is cheap and useful under every
  option. A matching "Focus Query Playground" command, also bound inside the result
  editor, gives a one-key way back, which removes most of option A's cost for users who
  choose to move focus.
- A completion announcement should state what came back (count or type, from
  `formatResult`), not only "done", so it carries information for every user.

**Recommendation: B as the default, exposed through one setting.** The setting is the
single source of truth; the screen-reader keybinding only informs its `auto` value.

`documentDB.playground.afterRun`:

| Value | Run started in screen-reader mode (keybinding passes `screenReaderMode: true`) | Any other run (normal keybinding, CodeLens, palette, title or context menu) |
| --- | --- | --- |
| `auto` (default) | Move focus to the result (option B) | Stay in the playground (today's behavior) |
| `stay` | Stay in the playground | Stay in the playground |
| `focusResult` | Move focus to the result | Move focus to the result |
| `notify` | Stay, and show the completion notification with **Focus Result** (option C) | Same |

Rules:

- An explicit value (`stay`, `focusResult`, `notify`) overrides the screen-reader
  default for every run and every entry point. Only `auto` looks at
  `screenReaderMode`.
- The behaviors never combine: one run produces exactly one of "stay", "move focus" or
  "notify". C' is therefore not part of the recommendation; it is the alternative to
  choose for `auto` if the operator prefers announcing over moving focus in
  screen-reader mode.
- Errors keep today's error notification under every value.
- The "Focus Query Playground Result" and "Focus Query Playground" commands are added
  under every value, so returning to the playground after a focus move is one command.

Everyone who does not use screen-reader-optimized mode keeps today's edit-run loop
unless they change the setting.

**Fallback if the testers do not use screen-reader mode.** With `auto`, nothing changes
for a keyboard-only tester. Ask on #774 which configuration they verify with before
implementing. If the answer is "keyboard only", change `auto` so that runs outside
screen-reader mode show the notification (option C) only on the **first** run per
playground, the run that opens the result tab, which is the "newly opened tab" case the
issue describes. Later runs stay silent, and the explicit setting values keep the
meaning in the table above.

### 3.4 Tests and verification

- Unit tests: block resolution for the new no-argument command paths, the
  `runSelected` argument forms, and the `showResult` focus option.
- Manifest: every new command and menu `when` clause is checked by `npm run build` and
  the VSIX/activation checks. Commands registered at activation do not need a
  `LAZY_COMMANDS` entry.
- Manual pass with NVDA and with keyboard only: connect, run a block, run all, open the
  block in Shell and in Collection View, and return to the playground, without the
  mouse. Record the result in the PR.

## 7. Accessibility page in the user manual

**Decided 2026-11-27
([decisions 0005](../decisions.md#0005--a-dedicated-accessibility-page-in-the-user-manual)).**
A new top-level page, `docs/user-manual/accessibility.md` (`parent: 'User Manual'`,
`nav_order: 5`, after AI Features), collects what the extension offers for assistive
technology. Proposed outline:

1. **Keyboard access**: Query Playground actions through the palette, editor title and
   context menu; the run shortcuts; the new focus commands.
2. **Screen readers**: the playground `afterRun` setting and its screen-reader default;
   status announcements in webviews (Query Insights, index management, connection
   diagnostics); Escape to leave embedded editors.
3. **Interactive Shell**: `documentDB.shell.display.colorSupport` for plain output;
   links are underlined even with colors off, so they never rely on color alone
   ([#631](https://github.com/microsoft/vscode-documentdb/pull/631)); the open terminal
   accessibility pass
   ([#941](https://github.com/microsoft/vscode-documentdb/issues/941)), mentioned only
   for whatever it ships.
4. **Settings reference**: `documentDB.accessibility.hideCountPrefix`,
   `documentDB.shell.display.colorSupport`, `documentDB.playground.afterRun`, and any
   other accessibility-related settings found while writing the page.
5. **Known limitations and reporting**: VS Code-owned issues (Quick Pick contrast, see the
   README's upstream tracking) and how to file an issue.

Rules: describe only shipped behavior; link from Query Playground and Interactive Shell
instead of repeating content; add the page in the PR that ships work item 3, or earlier
with sections 3-5 only. Preview with the `previewing-docs-site` skill.

## Decisions

All decisions from this plan are recorded in [decisions.md](../decisions.md)
(0002-0006). Still open:

1. Confirm the `accessibilityModeEnabled` context key (0004).
2. Ask on #774 which configuration the testers verify with. If they test keyboard-only,
   the first-run notification fallback for `auto` needs a new decision.
3. Ask @Jacquelinezhong on #768 whether they still plan a PR.

**Coordination update (2026-11-27).** Questions 2 and 3 were posted on
[#774](https://github.com/microsoft/vscode-documentdb/issues/774#issuecomment-7224367128)
and [#768](https://github.com/microsoft/vscode-documentdb/issues/768#issuecomment-7224367147).
Replies are pending. The accepted `auto` behavior is unchanged; a keyboard-only
fallback still requires a new operator decision. Context-key and shortcut-args
inspection remains an operator workbench gate before review handoff.

## Verification and closure

Each PR follows Case 1 while in draft and Case 2 when handed over. No fix is claimed
here. The issues stay open until the TCS/C+AI testers verify them.
