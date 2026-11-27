---
feature: accessibility
kind: plan
status: active
created: 2026-11-27
---

# Accessibility work items

Issue-based grouping of all **13 open issues labelled `a11y`** as of 2026-11-27.
The issue bodies and comments were read; the codebase was not inspected to establish
current behavior or root causes. "Available" means available to start, not implemented
or verified.

## Scope and sequencing

The operator's decision on 2026-11-27 is to **park work items 1 and 2 until the grid
update lands on `main`**. Work items 3-6 are available now and do not need to wait for
that merge. After the grid update lands, reassess the parked reports against the
updated implementation before making additional changes.

The plan for work items 3-6 is in
[iterations/01-plan-work-items-3-6.md](./iterations/01-plan-work-items-3-6.md).

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

**Status:** available now.
**Issues:** [#773](https://github.com/microsoft/vscode-documentdb/issues/773),
[#774](https://github.com/microsoft/vscode-documentdb/issues/774).

- Keyboard access and activation for "Connect to..." and "Shell", with visible focus.
- Make newly opened query results discoverable through focus movement **or
  notification**, as #774 permits.

Treat these as an editor-to-results workflow. @tnaum-ms identifies the CodeLens
approach as the concern in #773; no replacement approach has been selected here.

### 4. New Document focus management

**Status:** available now.
**Issues:** [#769](https://github.com/microsoft/vscode-documentdb/issues/769),
[#770](https://github.com/microsoft/vscode-documentdb/issues/770).

- F6 must not land on invisible, non-interactive content.
- Save must show a visible focus indicator when initially focused, not only after
  navigating away and back.
- Cover initial opening and subsequent F6, Tab, and Shift+Tab navigation together.

### 5. Explorer tree accessible names

**Status:** available now.
**Issue:** [#768](https://github.com/microsoft/vscode-documentdb/issues/768).

Accessible names must include the visible "Documents" label. @Jacquelinezhong's
2026-08-20 comment reports the same problem for "Indexes" and proposes fixing both
together. Include both labels and check for overlapping contributor work before
implementation; the comment alone does not establish that a fix has landed.

### 6. Index-creation completion announcement

**Status:** available now.
**Issue:** [#772](https://github.com/microsoft/vscode-documentdb/issues/772).

Announce successful index creation from AI Performance Insights without requiring
users to locate or focus the confirmation manually. This is a distinct status-message
fix, separate from visual contrast.

## Upstream tracking

Both reports below are open with the `wontfix` label. @tnaum-ms identifies the native
VS Code Quick Pick colors as outside extension control; @kapilvaishna links the
corresponding upstream reports:

| Local issue | Report | Upstream |
| --- | --- | --- |
| [#767](https://github.com/microsoft/vscode-documentdb/issues/767) | Quick Pick placeholder text contrast | [microsoft/vscode#321135](https://github.com/microsoft/vscode/issues/321135) |
| [#778](https://github.com/microsoft/vscode-documentdb/issues/778) | Quick Pick focused-item text contrast | [microsoft/vscode#325289](https://github.com/microsoft/vscode/issues/325289) |

Upstream issue status was not checked. Keep the focused table-row symptom from #778
under work item 2 rather than assuming an upstream Quick Pick fix covers it.

## Verification and closure

This document records grouping and sequencing only; no fix or accessibility
verification is claimed. The reports that reserve closure for TCS/C+AI accessibility
testers must remain open until those testers verify the fixes.
