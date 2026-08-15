---
feature: query-playground
kind: notes
status: active
prs: [533, 536, 540, 553, 559, 560, 583, 758]
verified: 2026-08-14
code:
  - src/documentdb/playground/**
  - src/commands/playground/**
---

# Query Playground

**Status:** shipped · **Verified:** 2026-08-14

> Why `.documentdb` files replaced the legacy scrapbook, and how a playground stays bound to its
> connection.

A Query Playground is a `.documentdb` file where the user writes and runs DocumentDB API queries in
JavaScript syntax. Each playground document is permanently bound to the cluster and database it was
created for, so several can be open at once against different servers, each with its own worker
thread and result panel.

It is one of three query surfaces built on a shared foundation. See
[the query-surfaces roadmap](../interactive-shell/iterations/00-program-roadmap.md), and the
sibling areas [interactive-shell](../interactive-shell/README.md) and
[completions-and-schema](../completions-and-schema/README.md).

## Code map

- `src/documentdb/playground/**` — the playground service, evaluation, result rendering, type
  definitions, and the TypeScript server plugin
- `src/commands/playground/**` — commands, including the Connect picker

## User docs

- [docs/user-manual/query-playground.md](../../../user-manual/query-playground.md)
- [docs/user-manual/query-runtime.md](../../../user-manual/query-runtime.md) — including
  "Running Several Sessions at Once", which is the source of truth for the per-cluster worker
  behavior that [multi-connection-behavior.md](./multi-connection-behavior.md) used to hold

## Architecture (intent — code is authoritative for behavior)

- **Evaluation runs in a persistent worker thread**, not `vm.runInContext()`. The worker owns its
  own database client, which buys infinite-loop safety, client isolation, and no re-authentication
  after the first run.
- **Connection metadata is keyed by document URI** and is independent of the worker lifecycle. A
  worker crash, timeout, or network error does not drop the connection; only closing the document
  does.
- **Results render through a `TextDocumentContentProvider`**, which is what makes result tabs stable
  and well formatted instead of ad-hoc.
- **The name is "Query Playground".** "Scrapbook" and "scratchpad" were removed everywhere,
  including command ids, language ids, folder names, and webpack entry points.

## Timeline

| Step  | PR   | What changed                                         | Docs                                                                                             |
| ----- | ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 5     | #533 | Legacy scrapbook removed (ANTLR, LSP, child process) | [iterations/05-legacy-scrapbook-removal.md](./iterations/05-legacy-scrapbook-removal.md)         |
| 6     | #536 | The Query Playground itself                          | [iterations/06-query-playground.md](./iterations/06-query-playground.md)                         |
| 6.2   | #540 | Persistent worker evaluation                         | [iterations/06.2-persistent-worker-eval.md](./iterations/06.2-persistent-worker-eval.md)         |
| 7.1.5 | #553 | Name unification                                     | [iterations/07.1.5-name-unification.md](./iterations/07.1.5-name-unification.md)                 |
| 7.1.6 | #559 | Console logging and result display                   | [iterations/07.1.6-console-logging.md](./iterations/07.1.6-console-logging.md)                   |
| 7.2   | #560 | Pre-shell hardening                                  | [iterations/07.2-pre-shell-critical.md](./iterations/07.2-pre-shell-critical.md)                 |
| 8     | #583 | Multi-connection playgrounds                         | [iterations/08-multi-connection-playgrounds.md](./iterations/08-multi-connection-playgrounds.md) |
| 9     | #758 | Connections survive save and reopen; Connect picker  | [iterations/09-query-playground-connections.md](./iterations/09-query-playground-connections.md) |

Iteration numbers are the original step numbers of the shell-integration program where one existed.

## Decisions

No separate `decisions.md` yet. The recovery model and its corner cases are argued in
[iterations/08-multi-connection-playgrounds-review.md](./iterations/08-multi-connection-playgrounds-review.md);
the constraints and design forks behind connection persistence are in
[iterations/09-query-playground-connections.md](./iterations/09-query-playground-connections.md).

## Open gaps

- [future-work.md](./future-work.md) — deferred playground enhancements
- [future-work-aggregation-pipeline.md](./future-work-aggregation-pipeline.md) — the aggregation
  pipeline editor and its completion provider, scoped as a separate work item

## Reading order for newcomers

1. This README
2. [iterations/06-query-playground.md](./iterations/06-query-playground.md)
3. [iterations/08-multi-connection-playgrounds.md](./iterations/08-multi-connection-playgrounds.md)
