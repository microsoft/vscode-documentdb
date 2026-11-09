---
feature: task-packages
kind: decisions
status: active
created: 2026-11-05
---

# Task Service and Data Transfer Packages Decisions

> Decisions for extracting the Task Service and the document transfer engine into shareable
> packages. All entries come from the planning discussion on 2026-11-05.

| #    | Decision                                                                 | Status              | Changed from the proposal?                                             | Date       | PR  |
| ---- | ------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------- | ---------- | --- |
| 0001 | Two packages, not four                                                   | Accepted            | Merged the maintainer's four-way split into two                        | 2026-11-05 | —   |
| 0002 | Task core and VS Code presentation ship in one package                   | Accepted            | Raised by the maintainer                                               | 2026-11-05 | —   |
| 0003 | Name the packages as a family                                            | Accepted (modified) | Renamed from `vscode-ext-data-transfer` after maintainer review        | 2026-11-05 | —   |
| 0004 | The tasks package is a required peer of the data transfer package        | Accepted            | Changed from an optional peer                                          | 2026-11-05 | —   |
| 0005 | Product UX, including option pickers, stays in the extension             | Accepted            | Confirmed on the maintainer's question                                 | 2026-11-05 | —   |
| 0006 | Packages never call `vscode.l10n.t`; the consumer injects strings        | Accepted            | Follows from how `npm run l10n` extracts strings                       | 2026-11-05 | —   |
| 0007 | Delete `RetryOrchestrator`; keep the shipped inline retry loop           | Accepted            | Raised by the maintainer                                               | 2026-11-05 | —   |
| 0008 | Keep every refactor behavior-neutral for the DocumentDB path             | Accepted            | —                                                                      | 2026-11-05 | —   |
| 0009 | Make partial-write reporting pluggable through one outcome shape         | Accepted            | Requested by the maintainer; outcome shape open until the NoSQL review | 2026-11-05 | —   |
| 0010 | Layer writer settings: package < adapter < caller                        | Accepted            | Requested by the maintainer                                            | 2026-11-05 | —   |
| 0011 | Treat a server-suggested wait as a floor, without a cap                  | Accepted            | Simplified by the maintainer                                           | 2026-11-05 | —   |
| 0012 | Keep task telemetry event and property names                             | Proposed            | —                                                                      | 2026-11-05 | —   |
| 0013 | Ship 0.x until the contract review with the NoSQL team                   | Proposed            | —                                                                      | 2026-11-05 | —   |
| 0014 | Document packages with examples, reference code and a For agents section | Accepted            | Requested by the maintainer                                            | 2026-11-05 | —   |

> Entries below are semantically immutable. Append a new decision rather than rewriting an old one,
> and record a reversal as a new entry plus a status change in the table.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

## 0001 — Two packages, not four

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

The maintainer considered four packages: the task service core, its UI, the data readers and
writers, and a dedicated copy-and-paste package. Is that the right granularity?

### Decision

Two packages: `@microsoft/vscode-ext-tasks` (task core with its VS Code presentation) and
`@microsoft/vscode-ext-tasks-data-transfer` (the engine, with the copy task under
`./copy-collection`). Runtime and audience differences are expressed as subpaths, as in
`@microsoft/vscode-ext-webview` (`.`, `/host`, `/webview`, `/react`).

### Reasoning

- The UI is about 350 lines, is useless without the core, and would always be released with it.
- The copy task is about 580 lines bound to the engine's types (`StreamWriteResult`,
  `StreamingWriterError`, `CollectionIndexCopier`); a package of its own adds publishing overhead
  without independent versioning value.
- The engine is kept apart from the task core because it is where throttling tuning and the NoSQL
  team's changes will happen; those should not force a release of the task core.

### Rejected alternatives

- **Four packages:** too granular; three of the four boundaries never version independently.
- **One package with four subpaths:** the lowest publishing overhead, but ties task core releases
  to engine changes. Kept as the fallback if publishing two packages proves costly.

## 0002 — Task core and VS Code presentation ship in one package

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Decision

The progress notifications, the conflict modal and the lifecycle log observer ship in
`@microsoft/vscode-ext-tasks` under `./vscode`. The root entry imports no `vscode` module.

### Reasoning

The presentation only consumes registry events. A subpath keeps the root testable without a VS Code
stub while sparing consumers a second package. A future webview task panel can be added as
`./react`.

## 0003 — Name the packages as a family

**Status:** Accepted (modified) · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

The first proposal named the second package `@microsoft/vscode-ext-data-transfer`. The maintainer
pointed out that it implements the task API. What should it be called?

### Decision

`@microsoft/vscode-ext-tasks` and `@microsoft/vscode-ext-tasks-data-transfer`.

### Reasoning

This follows webview-fluentui-package decision 0002: a shared stem keeps the pairing obvious, and
the suffix names the boundary rather than a category. The admission test becomes "does this exist
to move documents from a source to a target as a task?". Here the shared stem is more accurate than
in the webview pair, because these two packages do depend on each other.

### Rejected alternatives

- **`vscode-ext-data-transfer`:** accurate for the engine, but hides the dependency and the family.
- **`vscode-ext-tasks-collection-copy`:** too narrow if import or export to a file later reuses the
  engine.
- **Copy task at the root and the engine under `./engine`:** puts the task first, but makes adapter
  authors (the NoSQL team) import from a subpath.

## 0004 — The tasks package is a required peer of the data transfer package

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** agent, after 0003

### Decision

`@microsoft/vscode-ext-tasks` is a required peer, not an optional one.

### Reasoning

Every known consumer, including the NoSQL team, wants the copy task and not only the engine. An
optional peer would serve a consumer that does not exist. The root entry still does not import
`Task`, so the layering stays clean.

## 0005 — Product UX, including option pickers, stays in the extension

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

Is the UI for choosing options, such as the conflict resolution strategy, part of a package?

### Decision

No. The packages own what an option means and how it behaves (`ConflictResolutionStrategy` and the
writer contract). The extension owns how a user chooses it and how it is worded: wizards, quick
picks, warnings, confirmations, tree annotations and copy and paste state. Writers declare
`supportedConflictStrategies` so the extension's picker can hide what a target cannot do.

### Reasoning

The wording is database specific ("Generate new `_id` values" versus `id` on NoSQL), the steps
are built on `AzureWizardPromptStep`, and ordering, defaults and warnings are product decisions. A
second consumer may ask in a webview instead. See [design.md §4](./design.md#4-what-stays-in-the-extension).

## 0006 — Packages never call `vscode.l10n.t`; the consumer injects strings

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** agent, from repository constraints

### Decision

Packages take user-facing text through strings objects (`TaskStrings` and similar) with English
defaults. The extension passes `vscode.l10n.t` values built in `src/`.

### Reasoning

`l10n/scripts/build.l10n.mjs` extracts strings from `./src` only, so a string inside a package
would silently never be translated. It also matches the scope gate of webview-fluentui-package
decision 0001: no product strings in packages.

## 0007 — Delete `RetryOrchestrator`; keep the shipped inline retry loop

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

Two retry implementations exist. Which one moves into the package?

### Decision

The inline loop in `StreamingDocumentWriter.writeBatchWithRetry`. Delete `RetryOrchestrator` and
correct the README and JSDoc that describe it as the retry engine.

### Reasoning

The writer constructs a `RetryOrchestrator` but nothing calls it, and it has no tests. The inline
loop has shipped since the November 2025 rewrite of the writer and is the battle-tested behavior.
The two differ in defaults (1 s × 1.5 versus 100 ms × 2), so keeping both invites confusion.

## 0008 — Keep every refactor behavior-neutral for the DocumentDB path

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** agent, on the maintainer's
"battle tested" concern

### Decision

Every new hook and setting defaults to today's behavior. The DocumentDB adapter needs no change to
keep working, and the existing writer test suite must pass unchanged. Behavior changes, such as
reading `RetryAfterMs` from 16500 errors, ship as separate follow-ups.

### Reasoning

The current engine is proven in production. Mixing extraction with behavior changes would make any
regression impossible to attribute.

## 0009 — Make partial-write reporting pluggable through one outcome shape

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

Throttle recovery assumes ordered writes that throw with a written count. NoSQL bulk operations are
unordered and often return per-operation 429s instead of throwing. How should an adapter report a
partial write?

### Decision

Either by throwing (today's route) or by returning the outcome from `writeBatch`. Both routes
produce one internal `BatchAttemptOutcome` with `result`, `remaining` documents, `errorType` and
`retryAfterMs`, and the retry loop handles only that shape. When an adapter reports only a count,
`remaining` defaults to dropping the written prefix, as today. The exact shape is in
[design.md §5.1](./design.md#51-pluggable-partial-write-reporting-gaps-1-and-2) and stays open
until the contract review with the NoSQL team.

### Rejected alternatives

- **Indices instead of documents for `remaining`:** error-prone and can drift from the batch.
- **Requiring NoSQL adapters to throw synthetic errors:** forces a fake exception path and still
  cannot express scattered successes.

## 0010 — Layer writer settings: package < adapter < caller

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Decision

Batch modes, the start mode, the minimum batch size, the buffer memory limit, the retry backoff and
the document size estimator become `StreamingWriterSettings`. Package defaults equal today's
constants; an adapter supplies its defaults through the protected constructor; the caller can
override them. VS Code settings are out of scope.

### Reasoning

A NoSQL adapter that knows the target is provisioned in RUs can start in RU-limited mode instead of
discovering it through a throttle, and can estimate size from the payload it already has.

## 0011 — Treat a server-suggested wait as a floor, without a cap

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Decision

When the adapter provides a suggested wait, the writer waits `max(computedBackoff, retryAfterMs)`.
It never retries earlier than the server asks. There is no cap; Stop interrupts the wait.

### Reasoning

The maintainer asked to keep it simple and at least never retry early. A cap would add a setting
and a policy question without a known need, and cancellation already prevents an unbounded wait.

## 0012 — Keep task telemetry event and property names

**Status:** Proposed · **Date:** 2026-11-05 · **Raised by:** agent

### Decision

The extension's telemetry runner keeps `taskService.taskInitialization`,
`taskService.taskExecution` and the `task_*` properties when the base class moves into the package.

### Reasoning

Renamed events break dashboard continuity, and new or renamed properties stay hidden until they are
classified.

## 0013 — Ship 0.x until the contract review with the NoSQL team

**Status:** Proposed · **Date:** 2026-11-05 · **Raised by:** agent

### Decision

Publish both packages as 0.x until the NoSQL team has reviewed the writer contract, including the
outcome shape (0009), partition keys and `GenerateNewIds` semantics.

### Reasoning

The writer contract is the part most likely to change once a second database implements it.

## 0014 — Document packages with examples, reference code and a For agents section

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Decision

Each package README, shipped in the npm tarball, contains:

1. simple, complete examples for the common paths, kept in a type-checked examples file in the
   package;
2. links to this repository's code as reference implementations (the DocumentDB adapters, the
   paste `ExecuteStep`, the activation wiring, the telemetry runner, the strings objects, the
   conflict checks), as absolute GitHub URLs pinned to a release tag;
3. the API and the consumer's responsibilities;
4. a **For agents** section with the technical detail a coding agent in another repository needs:
   the adapter and wiring checklists and their invariants, pitfalls, how to test an adapter, and a
   map from each concept to its reference implementation.

If the For agents section outgrows the README, it moves to an `AGENTS.md` listed in `files`.

### Reasoning

The packages are frameworks: the value is in implementing an adapter and wiring the task
correctly, and a working implementation already exists here. Pointing at it is cheaper and more
accurate than writing a parallel tutorial. Adopting teams increasingly work with coding agents; a
dense, checklist-style section lets an agent find the contract and invariants without reading this
repository's history, while keeping the human-facing part of the README short. Shipping it in the
tarball means an agent can read it from `node_modules` without network access.

### Rejected alternatives

- **Relative links into this repository:** they break for npm readers.
- **Links to `main`:** they rot when files move; a tag keeps them stable.
- **Agent guidance only in this repository's `.github/skills/`:** invisible to other repositories.
- **Untested README snippets:** they drift from the API silently.
