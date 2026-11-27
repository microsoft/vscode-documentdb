---
feature: accessibility
kind: decisions
status: active
created: 2026-11-27
---

# Accessibility — Decisions

> The decisions that shape the accessibility work items, and what was rejected on the way.

| #    | Decision                                                                  | Status   | Changed from the proposal?                                  | Date       | PR  |
| ---- | ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- | ---------- | --- |
| 0001 | Park work items 1 and 2 until the grid update lands on `main`             | Accepted | Recorded in the README before this file existed             | 2026-11-27 | —   |
| 0002 | Playground actions use standard VS Code surfaces, no new keybindings      | Accepted | Confirms the 3a recommendation; makes "no keybindings" firm | 2026-11-27 | —   |
| 0003 | Playground editor-title layout and Connect follow the recommendations     | Accepted | Accepted as proposed (3b, 3c)                               | 2026-11-27 | —   |
| 0004 | After a run, focus moves to the result only in screen-reader mode         | Accepted | Picks option B for `auto`; rejects C' as the default        | 2026-11-27 | —   |
| 0005 | A dedicated Accessibility page in the user manual                         | Accepted | New; not in the plan                                        | 2026-11-27 | —   |
| 0006 | Work items 4-6 and #768 proceed as recommended in the plan                | Accepted | Accepted as proposed                                        | 2026-11-27 | —   |
| 0007 | Playground telemetry groups indistinguishable invocation surfaces       | Accepted | Amends the plan's five-surface attribution requirement       | 2026-11-27 | —   |
| 0008 | Declare keyborg directly for the Document focus helper                   | Accepted | Rejects relying on the transitive dependency                 | 2026-11-27 | —   |

> Entries below are **semantically** immutable: append new entries rather than
> rewriting old ones, and record reversals as a new entry plus a status change
> above. Editing for typos, broken links, or added verification metadata is fine.
> Heading text is frozen once written — a retitle means a new decision.

## 0001 — Park work items 1 and 2 until the grid update lands on `main`

**Decision.** Collection grid/tree keyboard interaction (#383, #775, #776) and the
visual-contrast pass (#382, #771, the table symptom of #778) wait for the grid update
([data-grid](../data-grid/README.md)). After it lands, reassess the reports against the
new implementation before changing anything.

**Why.** Fixing the current grid would be thrown away by the update. Recorded here so the
sequencing in the [README](./README.md) has a decision entry.

## 0002 — Playground actions use standard VS Code surfaces, no new keybindings

**Context.** #773: Connect, Shell and Collection View exist only as CodeLens items, which
are not in the Tab order. See
[01-plan-work-items-3-6.md §3.1-3.2](./iterations/01-plan-work-items-3-6.md).

**Decision.** CodeLens stays for mouse users. Every CodeLens action is also a regular
command, offered on:

- the Command Palette, while a playground is the active editor;
- the editor title toolbar (layout in 0003);
- the editor context menu, acting on the block at the cursor;
- the header comment of new playgrounds, which names these entry points.

**No new default keybindings.** The two existing ones stay unchanged:
`Ctrl+Enter` (Run block) and `Ctrl+Shift+Enter` (Run All), `Cmd` on macOS. Shell,
Collection View, Connect and the new focus commands from 0004 get no default shortcut;
users can bind them themselves.

**Clarification for 0004.** 0004 adds a second contribution of the **same** two
shortcuts, active only in screen-reader-optimized mode, that passes an argument to the
same commands. This adds no new key combination, so it does not conflict with this
decision.

**Rejected.** Default keybindings for Shell and Collection View: risk of conflicts with
user and other extensions' bindings, for little gain over the palette and context menu.
VS Code's "Show CodeLens Commands for Current Line" as the answer: it only lists lenses on
the cursor's line and has no default keybinding.

## 0003 — Playground editor-title layout and Connect follow the recommendations

**Decision.** As proposed in the plan (§3.2, decisions 3b and 3c):

- Inline in the editor title: **Run All** and **Connect / Change Connection**.
- In the overflow menu ("…") and the context menu: **Run Block**, **Open Block in
  Shell**, **Open Block in Collection View**.
- One title action per connection state (Connect when disconnected, the connection
  info and switch action when connected), matching CodeLens and the status bar.

## 0004 — After a run, focus moves to the result only in screen-reader mode

**Context.** #774 accepts either moving focus to the new result tab or notifying the
user. Moving focus for everyone breaks the edit-run loop, because the run shortcuts only
work while the playground editor has focus. See
[01-plan-work-items-3-6.md §3.3](./iterations/01-plan-work-items-3-6.md).

**Decision.** Option B, through one setting, `documentDB.playground.afterRun`:

| Value | Run started in screen-reader mode | Any other run |
| --- | --- | --- |
| `auto` (default) | Move focus to the result | Stay in the playground (today's behavior) |
| `stay` | Stay | Stay |
| `focusResult` | Move focus to the result | Move focus to the result |
| `notify` | Stay and show a completion notification with **Focus Result** | Same |

- "Run started in screen-reader mode" means the run came from the `Ctrl+Enter` or
  `Ctrl+Shift+Enter` contribution gated on screen-reader-optimized mode (see 0002).
- An explicit value overrides the screen-reader default for every run and entry point.
- Each run produces exactly one outcome. Errors keep today's error notification.
- "Focus Query Playground Result" and "Focus Query Playground" commands are added under
  every value, without default keybindings (0002).
- The behavior and the setting must be documented (0005).

**Rejected.**

- A, always moving focus: breaks the edit-run loop for everyone.
- C', announcing instead of moving focus in screen-reader mode: #774's primary
  expectation is a focus move, and the announcement path is still available through
  `notify`.
- D, a setting with an unchanged default: default behavior would still fail #774.

**Still open.** Confirm with "Developer: Inspect Context Keys" that the context key is
`accessibilityModeEnabled`. Ask on #774 which configuration the testers verify with. If
they test keyboard-only without screen-reader mode, the plan's first-run notification
fallback for `auto` needs a new decision.

## 0005 — A dedicated Accessibility page in the user manual

**Decision.** Add `docs/user-manual/accessibility.md` as a top-level User Manual page.
It collects the accessibility behavior and settings that are currently scattered or
undocumented, starting with:

- Query Playground: keyboard access to every action (0002, 0003) and the `afterRun`
  setting with its screen-reader default (0004).
- Interactive Shell: `documentDB.shell.display.colorSupport` for plain output; clickable
  links are underlined even with colors off, so they never rely on color alone
  ([interactive-shell iteration 11](../interactive-shell/iterations/11-visible-underline-shell-links.md)).
- Tree views: `documentDB.accessibility.hideCountPrefix`.
- Other settings and behavior related to accessibility, gathered when the page is
  written.

Feature pages, such as Query Playground and Interactive Shell, link to it rather than
repeating it. The page ships with or after the first fix it documents; it describes
only behavior that has shipped.

**Why.** The operator wants one place where users of assistive technology can find what
the extension offers.

## 0006 — Work items 4-6 and #768 proceed as recommended in the plan

**Decision.** Accepted as proposed in
[01-plan-work-items-3-6.md](./iterations/01-plan-work-items-3-6.md):

- Order: 5 (#768), 6 (#772), 4 (#769, #770), 3 (#773, #774). One PR per work item by
  default.
- #768: ask @Jacquelinezhong on the issue whether they still plan a PR before taking the
  fix; set `accessibilityInformation` on the Documents item; re-check Indexes.
- #772: announce with the existing `Announcer`; keep focus with `disabledFocusable`.
- #770: a shared helper that focuses an element with a visible indicator.
- #769: reproduce first; record it under upstream tracking if the F6 target belongs to
  VS Code.

## 0007 — Playground telemetry groups indistinguishable invocation surfaces

**Decision.** During `/lead` implementation on 2026-11-27, the operator approved
"honest grouped values (CodeLens, editor menu, screen-reader shortcut, other)" and
approved recording the decision. Use bounded attribution rather than infer whether
indistinguishable arguments came from the editor title, context menu, palette or
ordinary shortcut. Preserve the existing `playgroundCodeLens` value.

**Reason for the proposal.** The Opus advisor found that VS Code passes the same
argument shapes for some entry points. Grouping avoids reporting an unobserved
surface as fact. This amends the separate-surface requirement in the plan's
section 3.2; it does not change command availability or user behavior.

**Rejected alternative.** Add distinct command entry points solely to identify all
five surfaces. The operator selected grouped attribution instead.

## 0008 — Declare keyborg directly for the Document focus helper

**Decision.** During `/lead` implementation on 2026-11-27, the operator selected
"Declare keyborg as a direct dependency" rather than import the installed
transitive dependency without declaring it.

**Additional instruction.** Inspect `vscode-cosmosdb` for potential focus-helper
ideas, not as best practice. Any relevant idea must still fit this extension's
Fluent UI behavior and the accepted scope; inspection alone does not approve
adopting another implementation.
