---
feature: connections-tree
kind: notes
status: active
prs: [714, 726]
verified: 2026-08-14
code:
    - src/tree/connections-view/**
    - src/services/connectionStorageService.ts
    - src/services/storageService.ts
    - src/documentdb/ClustersClient.ts
---

# Connections Tree

**Status:** shipped · **Verified:** 2026-08-14

> Two rounds of work on the Connections view: what the tree shows per node, and how fast it loads.

The Connections view is the extension's primary tree. This area collects the work that changed what
its nodes display and how the connection list is loaded from storage.

## Code map

- `src/tree/connections-view/**` — the view, its items, and per-node decorations
- `src/services/connectionStorageService.ts`, `src/services/storageService.ts` — persistence and the
  in-memory wrapping around it
- `src/documentdb/ClustersClient.ts` — shared extension client initialization and startup diagnostics

## Related skills

- [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)
  — **read this first.** It owns the required patterns for cluster tree items, the dual-ID rule
  (`treeId` for tree paths, `clusterId` for cache keys), provider lookup, and the regression tests
  that protect them.

## Architecture (intent — code is authoritative for behavior)

The durable rules for this area live in the `tree-cluster-architecture` skill rather than here, so
they are loaded when an agent is actually editing tree code. This area holds the _why_ behind two
specific behaviors:

- **Item counts on tree nodes** are opt-in and bounded. The UX rationale for where counts appear,
  and where they deliberately do not, is in the item-counting iteration.
- **Connection load is not a storage read per node.** The storage-load work separates what is
  wrapped in memory from what is read on demand, and says so explicitly, because the previous shape
  made the cost invisible.

## Connection startup diagnostics

Each fresh `ClustersClient` initialization produces one `connect.startup` telemetry event and one
`ext.outputChannel` timing summary. This is the regular extension client used by trees and webviews,
not the dedicated Shell/Playground worker. Cached-client reuse emits neither; a fresh retry gets a
new `connectionCorrelationId`. The ID is assigned before auth setup, so early failures can be
identified, and is shared with the existing connection metadata events.

Reported names have stable numbers so sorting preserves their order:

1. `stage01PreparingCredentials`: cached credential lookup and auth-handler selection.
2. `stage02ConfiguringAuth`: configuring connection options, including Entra user-token acquisition.
3. `stage03PreparingClient`: host/options preparation and driver-client construction.
4. `stage04ConnectingAndAuthenticating`: the driver's `connect()`, including network setup and
   authentication. Managed identity acquires its token here via the driver's OIDC callback.
5. `stage05InitializingApis`: extension client API setup after connecting.

Only visited stages are reported. Timings do not separately measure DNS, TCP, TLS, or server-side
authentication. Metadata collection remains asynchronous and is not awaited as part of startup.
Existing authentication, connection timeout, cancellation, and caching behavior is unchanged.

The event carries `surface=extension`, `authMethod` when known, `connectionCorrelationId`, `lastStage`,
and `startupOutcome` (`succeeded`, `failed`, or `canceled`). The framework supplies `result` and
`duration` in seconds. `<stage>DurationMs` and `lastStageDurationMs` are milliseconds. The log's
`stageDurationsMs` contains those same stage timings, with a total `elapsedMs`. Success and cancellation
summaries use Trace; failures use Error. No per-stage log or telemetry events are added.

The same event also carries `tokenAcquireDurationMs` for the actual provider call and
`databaseConnectDurationMs` for driver connection work excluding overlapping token acquisition.
Both appear in the log's `costTimingsMs`. Entra user tokens are usually acquired before connecting,
so their time is not subtracted from the later database duration; managed-identity tokens acquired
inside the OIDC callback are subtracted. Overlapping provider requests count once, failures retain
elapsed timing, and late token completion cannot alter a finished startup snapshot. Native/no-auth
connections have no token-acquisition measurement. No extra event or log line is emitted.

Provider time includes cache lookup, refresh, SDK initialization, and any interactive wait, not just
Entra HTTP latency. Database time includes server selection, network setup, and database-side
authentication; it is not a pure network-latency measurement. The cost measurements are an alternative
breakdown, not additional time to sum with the numbered stages. Worker connections additionally
report token relay/scheduling overhead; see the
[shared worker diagnostics](../interactive-shell/README.md#architecture-intent--code-is-authoritative-for-behavior).

Summary logs exclude connection strings, hostnames, tokens, account details, and raw errors. The new
telemetry event receives a fixed failure without the original stack, with error fields masked, while
callers retain the original error. Existing connection and metadata telemetry remains separate.

## Timeline

| Date       | PR   | What changed                                       | Docs                                                                                                                                           |
| ---------- | ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-01 | #714 | Item counts on tree nodes (indexes, collections)   | [01-item-counting-tree.md](./iterations/01-item-counting-tree.md), [review](./iterations/01-item-counting-tree-review.md)                      |
| —          | #726 | Faster connection load; clearer in-memory wrapping | [02-storage-load-optimization.md](./iterations/02-storage-load-optimization.md), [review](./iterations/02-storage-load-optimization-review.md) |

## Decisions

No separate `decisions.md`. Each iteration carries its own "UX decisions and rationale" section plus
a review with resolutions.

## Open gaps

Follow-ups are recorded at the end of each iteration's review document.

## Reading order for newcomers

1. [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)
2. This README
3. The specific iteration you need provenance for
