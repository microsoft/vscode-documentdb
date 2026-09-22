---
feature: interactive-shell
kind: notes
status: active
prs: [508, 561, 576, 580, 631, 937]
verified: 2026-09-22
code:
  - src/documentdb/shell/**
  - src/commands/openInteractiveShell/**
  - packages/documentdb-js-shell-runtime/**
  - packages/documentdb-js-shell-api-types/**
---

# Interactive Shell

**Status:** shipped · **Verified:** 2026-09-22

> How the in-terminal DocumentDB REPL was built, and why it behaves like a shell rather than a
> webview.

The Interactive Shell is a REPL inside a VS Code terminal, wired to the extension's connection
management and to the `shell-runtime` evaluation engine. Users type one command at a time, use shell
helpers (`show dbs`, `use db`, `it`, `help`, `exit`), keep variables across commands, and navigate
history with the arrow keys.

It is one of three query surfaces built on a shared foundation. See
[iterations/00-program-roadmap.md](./iterations/00-program-roadmap.md) for the
program-level narrative, and the sibling areas
[query-playground](../query-playground/README.md) and
[completions-and-schema](../completions-and-schema/README.md).

## Code map

- `src/documentdb/shell/**` — the pseudoterminal, session manager, input line, and highlighting
- `src/commands/openInteractiveShell/**` — entry points
- `packages/documentdb-js-shell-runtime/**` — the evaluation engine
- `packages/documentdb-js-shell-api-types/**` — the shell API type definitions

## User docs

- [docs/user-manual/interactive-shell.md](../../../user-manual/interactive-shell.md)
- [docs/user-manual/query-runtime.md](../../../user-manual/query-runtime.md) — "Running Several
  Sessions at Once" covers how shells and playgrounds share worker threads

## Architecture (intent — code is authoritative for behavior)

- **Each shell terminal owns a dedicated worker thread.** That is what makes infinite loops
  survivable and keeps clients isolated. The user-visible consequences are documented in the
  user manual; the reasoning for the shell/playground split is in
  [query-playground/multi-connection-behavior.md](../query-playground/multi-connection-behavior.md).
- **Highlighting reuses the Monarch tokenizer** extracted for the query editors rather than a
  second grammar, so the input line and the result formatter colorize the same way.
- **Completions are terminal-native.** Tab completion and ghost text are driven from the same
  operator registry and `SchemaStore` that feed the editors, and shell query results feed documents
  back into `SchemaStore`. Collection names are refreshed after connect and after `use <database>`
  only when the extension host already has a client for that cluster; completion never creates a
  second connection. Having the connected worker supply this data is tracked in
  [#938](https://github.com/microsoft/vscode-documentdb/issues/938).
- **Inline assistance has two user-controlled affordances.** Insertable suggestions and Tab
  completion are governed by `documentDB.shell.display.autocompletion`; informational lines marked
  `🛈` are governed independently by `documentDB.shell.display.inlineHints`.
  Candidate previews, completions, and fully-typed descriptions precede the `db.` collection count,
  then history, missing-schema hints, and closing brackets. The count falls through when hints are
  disabled; candidate branches do not. A future history-first UX change is explicitly deferred in
  [future-work.md](./future-work.md#7-history-versus-description-priority).
- **Clickable action sentinels** after query results are registered through VS Code's
  `TerminalLinkProvider`. VS Code offers no way to style terminal links at rest, which is why
  visibility had to be solved in the emitted text itself. The same provider turns compact setting
  markers in shell `help` into links that open the owning VS Code setting.
- **Shell `help` is English by design today.** Width-sensitive help is generated in the worker by
  `documentdb-js-shell-runtime`, a package that cannot depend on `vscode` and therefore cannot call
  `vscode.l10n.t()`. A reusable localization mechanism for vscode-free worker packages is tracked
  in [#940](https://github.com/microsoft/vscode-documentdb/issues/940); moving help rendering back
  to the host is not the chosen workaround.

## Timeline

| Date     | PR   | What changed                                                 | Docs                                                                                               |
| -------- | ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Step 8   | #561 | The Interactive Shell itself, plus the #508 umbrella review  | [iterations/08-interactive-shell/](./iterations/08-interactive-shell/)                             |
| Step 9   | #576 | Tab completion and ghost text                                | [iterations/09-shell-autocompletion.md](./iterations/09-shell-autocompletion.md)                   |
| Step 9.1 | #576 | Shell results feed SchemaStore                               | [iterations/09.1-shell-schema-feeding.md](./iterations/09.1-shell-schema-feeding.md)               |
| Step 10  | #580 | Input-line syntax highlighting                               | [iterations/10-syntax-highlighting.md](./iterations/10-syntax-highlighting.md)                     |
| Step 11  | #631 | Visible underline for terminal links                         | [iterations/11-visible-underline-shell-links.md](./iterations/11-visible-underline-shell-links.md) |
| Step 12  | #937 | Startup, connection, styling, cache warming and settings UX  | [iterations/12-shell-session-ux.md](./iterations/12-shell-session-ux.md)                           |
| Step 13  | #937 | Ghost text clipped to terminal width (input-line corruption) | [iterations/13-ghost-text-wrap-clipping.md](./iterations/13-ghost-text-wrap-clipping.md)           |
| Step 14  | #937 | Bracket-notation completion now removes the `db.` dot        | [iterations/14-bracket-notation-dot-removal.md](./iterations/14-bracket-notation-dot-removal.md)   |
| Step 15  | #937 | Liveness audit: nine planned items plus four follow-up fixes | [iterations/15-shell-liveness-audit-fixes.md](./iterations/15-shell-liveness-audit-fixes.md)       |

Iteration numbers 8, 9 and 9.1 are the original step numbers of the shell-integration program and
are preserved. Steps 10 and 11 are new numbers for work that had none.

## Open backlog

[shell-liveness-audit.md](./shell-liveness-audit.md) — an audit of the first minutes of shell use,
written after Steps 13 and 14 both turned out to be reachable within the first three keystrokes. It
lists verified findings (resize can strand the cursor, ghost text can paint over real text,
`String.length` used for width in two remaining places) alongside rated quality-of-life proposals,
grouped into **Fix**, **Deferred** and **Won't fix**.

All nine original **Fix** items shipped in Step 15. Using that build raised **N1–N4**: completion
lists losing to ghost text, inconsistent hint markers, inert display settings, and suggestion chains
ending after an accepted completion. All four follow-ups also shipped and carry their commit and
decision record inline in the audit.

**Deferred** and **Won't fix** items remain the live backlog. I7 (Tab-cycling as menu-select) and its
prerequisite I10 are the largest, and I4 (persisting history) is blocked on a redaction decision
rather than on storage.

## Decisions

No separate `decisions.md` yet. The reviewed alternatives are inside the iteration documents; the
most decision-dense is [iterations/08-interactive-shell/pr-review-508.md](./iterations/08-interactive-shell/pr-review-508.md),
a three-model consolidated review with each finding verified against the source.

## Open gaps

- [future-work.md](./future-work.md) — terminal-surface items deferred deliberately, including
  autocompletion through `TerminalCompletionProvider`.

## Reading order for newcomers

1. This README
2. [iterations/00-program-roadmap.md](./iterations/00-program-roadmap.md)
3. [iterations/08-interactive-shell/plan.md](./iterations/08-interactive-shell/plan.md)
