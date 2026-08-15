---
area: interactive-shell
kind: notes
status: active
prs: [508, 561, 576, 580, 631]
verified: 2026-08-14
code:
    - src/documentdb/shell/**
    - src/commands/openInteractiveShell/**
    - packages/documentdb-js-shell-runtime/**
    - packages/documentdb-js-shell-api-types/**
---

# Interactive Shell

**Status:** shipped · **Verified:** 2026-08-14

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

## Architecture (intent — code is authoritative for behavior)

- **Each shell terminal owns a dedicated worker thread.** That is what makes infinite loops
  survivable and keeps clients isolated. See
  [query-playground/multi-connection-behavior.md](../query-playground/multi-connection-behavior.md)
  for the user-visible consequences of that model.
- **Highlighting reuses the Monarch tokenizer** extracted for the query editors rather than a
  second grammar, so the input line and the result formatter colorize the same way.
- **Completions are terminal-native.** Tab completion and ghost text are driven from the same
  operator registry and `SchemaStore` that feed the editors, and shell query results feed documents
  back into `SchemaStore`.
- **Clickable action sentinels** after query results are registered through VS Code's
  `TerminalLinkProvider`. VS Code offers no way to style terminal links at rest, which is why
  visibility had to be solved in the emitted text itself.

## Timeline

| Date    | PR   | What changed                                        | Docs                                                                                |
| ------- | ---- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Step 8  | #561 | The Interactive Shell itself, plus the #508 umbrella review | [iterations/08-interactive-shell/](./iterations/08-interactive-shell/)        |
| Step 9  | #576 | Tab completion and ghost text                        | [iterations/09-shell-autocompletion.md](./iterations/09-shell-autocompletion.md)     |
| Step 9.1| #576 | Shell results feed SchemaStore                       | [iterations/09.1-shell-schema-feeding.md](./iterations/09.1-shell-schema-feeding.md) |
| Step 10 | #580 | Input-line syntax highlighting                       | [iterations/10-syntax-highlighting.md](./iterations/10-syntax-highlighting.md)       |
| Step 11 | #631 | Visible underline for terminal links                 | [iterations/11-visible-underline-shell-links.md](./iterations/11-visible-underline-shell-links.md) |

Iteration numbers 8, 9 and 9.1 are the original step numbers of the shell-integration program and
are preserved. Steps 10 and 11 are new numbers for work that had none.

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
