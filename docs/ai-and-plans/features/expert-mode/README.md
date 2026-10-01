---
feature: expert-mode
kind: notes
status: active
created: 2026-10-01
code:
  - src/documentdb/playground/**
  - src/documentdb/shell/**
  - src/documentdb/ClusterSession.ts
  - src/documentdb/ClustersClient.ts
  - src/webviews/documentdb/collectionView/**
  - src/utils/slickgrid/mongo/**
  - packages/documentdb-js-shell-runtime/src/**
---

# Expert mode

> Exploration. Nothing is implemented. These notes capture the discussion so far.

## Purpose

Show the results of Query Playground and Interactive Shell executions in the same table / tree /
JSON views the Collection View uses, instead of only as EJSON text. Possibly go further: one result
view per statement in a script, and a Collection View query bar that accepts full shell expressions.

## Documents

| Document                                                                                                 | What it covers                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [iterations/01-result-views-research.md](./iterations/01-result-views-research.md)                       | What already exists, what is missing, and the challenges of rendering shell results in a grid   |
| [iterations/01-shell-pipeline-refactor-research.md](./iterations/01-shell-pipeline-refactor-research.md) | Should every read run through the shell execution pipeline instead of the driver? Pros and cons |

## Current leaning

Unify the **output side** first: a shared `ResultSet` model and shared renderers, fed by both the
driver path and the shell runtime. Keep the Collection View on the driver for now. Decide later,
with measurements, whether its query bar should also run through the shell runtime.

No decisions have been recorded yet. Add a `decisions.md` when the first one is made.

## Open questions

- Snapshot only, fetch-up-to-a-cap, or worker-side cursor handles for paging?
- Tabs or stacked panes for multiple results per script?
- When are grid edit / delete actions safe on a script result?
- Does the worker path perform well enough to carry Collection View reads?
