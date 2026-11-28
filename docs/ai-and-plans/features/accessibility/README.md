---
feature: accessibility
kind: plan
status: active
created: 2026-11-27
prs: [1147]
---

# Accessibility work items

Issue-based grouping of all **13 open issues labelled `a11y`** as of 2026-11-27.
The initial grouping came from issue bodies and comments, not a code inspection.
Implementation and verification progress are recorded below and inline in the
work-item plan. "Available" means available to start, not implemented or verified.

## Scope and sequencing

The operator's decision on 2026-11-27 is to **park work items 1 and 2 until the grid
update lands on `main`**. Work items 3-6 are available now and do not need to wait for
that merge. After the grid update lands, reassess the parked reports against the
updated implementation before making additional changes.

The plan for work items 3-6 is in
[iterations/01-plan-work-items-3-6.md](./iterations/01-plan-work-items-3-6.md); the
operator's decisions are in [decisions.md](./decisions.md).

Implementation is published in draft [#1147](https://github.com/microsoft/vscode-documentdb/pull/1147),
targeting `main` with milestone `1.2.0`. The operator explicitly requested both
Case 1 and Case 2 checks on 2026-11-28; both passed with the local test-run
conditions recorded in the work-item plan. The PR remains a draft: the formal AI
pre-review and the remaining workbench gates are still outstanding.

The grid update is documented under [data-grid](../data-grid/README.md). The two
VS Code-owned reports remain a separate upstream-tracking bucket, not presumed fixes
for this branch.

## Work items

### 1. Collection grid/tree keyboard interaction

**Status:** parked until the grid update lands on `main`.
**Issues:** [#383](https://github.com/microsoft/vscode-documentdb/issues/383),
[#775](https://github.com/microsoft/vscode-documentdb/issues/775),
[#776](https://github.com/microsoft/vscode-documentdb/issues/776).

- Keyboard navigation and activation in both table and tree modes, with logical,
  visible focus.
- Table-cell focus indicators with at least **3:1 contrast** against adjacent colors
  in Light 2026 and Dark 2026 themes.
- Column resizing without dragging, including a **single-pointer alternative** as
  well as keyboard operation. Keyboard support alone does not satisfy #776.

@tnaum-ms's 2026-10-01 comments already group these reports under the planned grid/tree
update and explicitly state that implementation and accessibility verification were
still pending. #383 is the severity-1 functionality blocker in the issue reports.

### 2. Collection and Query Insights visual contrast

**Status:** parked until the grid update lands on `main`, including the Query Insights
portion of this work item.
**Issues:** [#382](https://github.com/microsoft/vscode-documentdb/issues/382),
[#771](https://github.com/microsoft/vscode-documentdb/issues/771).

- Grid "AB" text with at least **4.5:1 contrast** against its background.
- Query Insights information icons and grid `{}` icons with at least **3:1 contrast**
  in Light 2026 and Dark 2026 themes.
- Retain the secondary report of low-contrast focused table-row text from
  [#778](https://github.com/microsoft/vscode-documentdb/issues/778) in this contrast
  pass. Its Quick Pick disposition does not establish that the table symptom is
  outside extension control.

These reports belong together as a visual-contrast pass; the issues do not establish
a shared implementation root cause.

### 3. Query Playground keyboard workflow

**Status:** implemented in `9bee0fb6`, `58c679d3` and `4c65547f`; documented in `66f64d92`; workbench verification pending.
**Issues:** [#773](https://github.com/microsoft/vscode-documentdb/issues/773),
[#774](https://github.com/microsoft/vscode-documentdb/issues/774).

- Keyboard access and activation for "Connect to..." and "Shell", with visible focus.
- Make newly opened query results discoverable through focus movement **or
  notification**, as #774 permits.

Treat these as an editor-to-results workflow. The accepted approach keeps CodeLens
and adds standard palette/title/context commands, with the `afterRun` setting for
result focus (decisions 0002-0004).

### 4. New Document focus management

**Status:** initial focus (#770) implemented in `0274a8dd`; automated/browser checks passed. F6 (#769) remains deferred pending installed-workbench reproduction.
**Issues:** [#769](https://github.com/microsoft/vscode-documentdb/issues/769),
[#770](https://github.com/microsoft/vscode-documentdb/issues/770).

- F6 must not land on invisible, non-interactive content.
- Save must show a visible focus indicator when initially focused, not only after
  navigating away and back.
- Cover initial opening and subsequent F6, Tab, and Shift+Tab navigation together.

No F6 redirect or focus-bumper change was made, and the target has not been
classified as extension-owned or VS Code-owned. The remaining reproduction is
an operator gate, not an assumed upstream issue.

### 5. Explorer tree accessible names

**Status:** implemented in `04affdf7`; focused tests passed; workbench verification pending.
**Issue:** [#768](https://github.com/microsoft/vscode-documentdb/issues/768).

Accessible names must include the visible "Documents" label. @Jacquelinezhong's
2026-08-20 comment reports the same problem for "Indexes" and proposes fixing both
together. Include both labels and check for overlapping contributor work before
implementation; the comment alone does not establish that a fix has landed.

### 6. Index-creation completion announcement

**Status:** implemented in `91dd07c4`; focused tests passed; screen-reader verification pending.
**Issue:** [#772](https://github.com/microsoft/vscode-documentdb/issues/772).

Announce successful index creation from AI Performance Insights without requiring
users to locate or focus the confirmation manually. This is a distinct status-message
fix, separate from visual contrast.

### 7. Accessibility manual page

**Status:** implemented in `66f64d92`; local light/dark docs preview passed.
**Decision:** [0005](./decisions.md#0005--a-dedicated-accessibility-page-in-the-user-manual).

The [Accessibility page](../../../user-manual/accessibility.md) collects keyboard
entry points, the Playground after-run setting, shell display settings and known
limitations. Feature guides link to it. It does not claim that the open
installed-workbench or screen-reader verification gates have passed.

## Upstream tracking

Both reports below are open with the `wontfix` label. @tnaum-ms identifies the native
VS Code Quick Pick colors as outside extension control; @kapilvaishna links the
corresponding upstream reports:

| Local issue                                                       | Report                                | Upstream                                                                     |
| ----------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| [#767](https://github.com/microsoft/vscode-documentdb/issues/767) | Quick Pick placeholder text contrast  | [microsoft/vscode#321135](https://github.com/microsoft/vscode/issues/321135) |
| [#778](https://github.com/microsoft/vscode-documentdb/issues/778) | Quick Pick focused-item text contrast | [microsoft/vscode#325289](https://github.com/microsoft/vscode/issues/325289) |

Upstream issue status was not checked. Keep the focused table-row symptom from #778
under work item 2 rather than assuming an upstream Quick Pick fix covers it.

## Verification and closure

Implementation commits and automated checks are recorded in the work-item plan.
They do not establish what a real screen reader announces or how the installed
workbench handles focus. Reports that reserve closure for TCS/C+AI accessibility
testers remain open until those testers verify the fixes.
