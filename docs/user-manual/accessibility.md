---
title: 'Accessibility'
parent: 'User Manual'
nav_order: 5
---

# Accessibility

This page collects accessibility behavior and related settings available in the DocumentDB extension for Visual Studio Code.
Screen-reader output can vary by screen reader and VS Code configuration.

## Keyboard access

The [Query Playground](./query-playground) keeps its CodeLens actions for mouse users and also
exposes them through standard VS Code surfaces:

| Action                        | Command Palette | Editor title or overflow menu | Editor context menu |
| ----------------------------- | --------------- | ----------------------------- | ------------------- |
| Connect or change connection  | Yes             | Yes, in the title             | No                  |
| Run All                       | Yes             | Yes, in the title             | No                  |
| Run Block                     | Yes             | Yes, in the overflow menu     | Yes                 |
| Open Block in Shell           | Yes             | Yes, in the overflow menu     | Yes                 |
| Open Block in Collection View | Yes             | Yes, in the overflow menu     | Yes                 |
| Focus Result                  | Yes             | No                            | No                  |

Open the Command Palette and search for **Query Playground**. Open the editor context menu with
`Shift+F10` or the Menu key. Block actions use the block containing the cursor; on a blank line,
they fall back to the nearest preceding block. **Open Block in Shell** and **Open Block in
Collection View** require a connected playground and a block containing code. A collection can only
be inferred from compatible code.

The existing run shortcuts remain `Ctrl+Enter` for Run Block and `Ctrl+Shift+Enter` for Run All;
use `Cmd` instead of `Ctrl` on macOS. There are no default shortcuts for Connect, Shell,
Collection View, or the focus commands. You can assign your own VS Code keybindings.

The palette commands **Query Playground: Focus Result** and **Query Playground: Focus Playground**
move between an open result and its source playground. They are available without a default
keybinding.

## Screen readers

`documentDB.playground.afterRun` controls what happens after a successful Query Playground run.
Its default is `auto`.

| Value            | Run from the screen-reader shortcut contribution                                         | Any other run                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `auto` (default) | Move focus to the result                                                                 | Stay in the playground                                                                   |
| `stay`           | Stay in the playground                                                                   | Stay in the playground                                                                   |
| `focusResult`    | Move focus to the result                                                                 | Move focus to the result                                                                 |
| `notify`         | Stay in the playground and show a completion notification with a **Focus Result** button | Stay in the playground and show a completion notification with a **Focus Result** button |

Automatic screen-reader focus applies only to the `Ctrl/Cmd+Enter` and
`Ctrl/Cmd+Shift+Enter` contributions while VS Code's `accessibilityModeEnabled` context is active.
Runs from ordinary shortcuts, CodeLens, the Command Palette, the editor title, or the editor
context menu do not carry the screen-reader flag. An explicit `stay`, `focusResult`, or `notify`
value overrides `auto` for every entry point.

Each successful run has exactly one after-run outcome. `notify` describes the result count or type
(or that there is no return value) plus **Focus Result**; it does not also move focus
automatically. Errors keep the existing error notification. Cancelled runs do not show a completion
notification.

Status announcements are used for Query Insights actions, index-management refreshes, and
connection-diagnostics progress and results. In the Document editor and Collection View's JSON
editor, `Escape` leaves the embedded editor when no suggestion or snippet session is handling the
key. This is not a blanket Escape behavior for every editor or webview.

The Documents tree item exposes the visible **Documents** label as its accessibility label while
retaining its hover tooltip.

## Interactive Shell

Set `documentDB.shell.display.colorSupport` to `false` for plain shell syntax and result output
without ANSI colors. The default is `true`. Shell action links are underlined even when color
support is off, so they do not rely on color alone.

This is not a claim that the terminal is fully accessible. In particular, the broader Interactive
Shell terminal accessibility pass is still tracked by
[#941](https://github.com/microsoft/vscode-documentdb/issues/941).

## Settings reference

| Setting                                    | Default | Effect                                                                                                                               |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `documentDB.playground.afterRun`           | `auto`  | Controls focus or notification behavior after a successful playground run as described above.                                        |
| `documentDB.shell.display.colorSupport`    | `true`  | Enables ANSI syntax and result colors in the Interactive Shell. Set it to `false` for plain output.                                  |
| `documentDB.accessibility.hideCountPrefix` | `false` | Removes the two-dot visual separator before database, collection, index, and Kubernetes namespace counts. The counts remain visible. |

## Known limitations and reporting

The following accessibility limitations remain:

- Collection grid and tree keyboard interaction and contrast work for
  [#383](https://github.com/microsoft/vscode-documentdb/issues/383),
  [#775](https://github.com/microsoft/vscode-documentdb/issues/775),
  [#776](https://github.com/microsoft/vscode-documentdb/issues/776),
  [#382](https://github.com/microsoft/vscode-documentdb/issues/382), and
  [#771](https://github.com/microsoft/vscode-documentdb/issues/771) remains open. The focused
  table-row symptom from [#778](https://github.com/microsoft/vscode-documentdb/issues/778) is
  included in the open contrast work.
- [#769](https://github.com/microsoft/vscode-documentdb/issues/769) (F6 focus into the New
  Document webview) remains under investigation.
- The native Quick Pick contrast symptoms in
  [#767](https://github.com/microsoft/vscode-documentdb/issues/767) and
  [#778](https://github.com/microsoft/vscode-documentdb/issues/778) are tracked upstream in
  VS Code.

Report accessibility problems in the
[DocumentDB extension issue tracker](https://github.com/microsoft/vscode-documentdb/issues).
When a report assigns closure to TCS/C+AI accessibility testers, source changes and automated
checks do not close it; those testers retain closure ownership.
