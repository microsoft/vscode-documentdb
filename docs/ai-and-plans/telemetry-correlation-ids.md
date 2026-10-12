---
kind: plan
status: active
created: 2026-09-29
---

# Telemetry correlation IDs

> Which id a telemetry event should carry so related events can be joined, and what each name
> means. Written after #979, where two Quick Start ids with overlapping names were easy to confuse.
> The connection IDs section below is implemented. The wider inventory and proposed rule
> remain evidence and draft proposals for a later pass, not a repository-wide migration.

## Connection IDs (2026-10-12)

Three questions, three IDs.

| Question                                          | Property                                 | Meaning                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How long did a connection take, and did it fail?  | `startupCorrelationId`                   | One database client: the extension's `ClustersClient`, or one shell or playground worker. New for every attempt, retry, and worker restart. Cached reuse creates none.                                                                                                                             |
| Which cluster is this?                            | `connectionCorrelationId`                | The extension client whose `connect.staticmetadata` and `connect.getmetadata` events describe the cluster. On extension events it equals `startupCorrelationId`. Shell and playground events carry it only as a pointer to that metadata, and only when an extension client was already connected. |
| What did the user do in this shell or playground? | `shellSessionId`, playground `sessionId` | One terminal (stable across worker restarts), or one playground worker session.                                                                                                                                                                                                                    |

`startupCorrelationId` appears on `connect.startup`, `worker.startup`, `connect.srvResolution`,
`connect.staticmetadata`, `connect.getmetadata`, and `connect.managedIdentityToken` failures.
A shell captures `connectionCorrelationId` once, when it is created, and puts it on its
`worker.startup`, SRV, and `shell.sessionStart` events.

### Output channel

Every line about a database connection carries `startup=<id>`: the startup summaries
(`[ClustersClient]`, `[WorkerSessionManager]`), `[SrvResolution]`, `[Authentication]`,
`[Shell Worker]`, and `[Playground Worker]`. The ID stays with that client for its lifetime, so
later token refreshes and worker messages show the startup ID that created the client. To follow
one connection, search the output for its ID.

Authentication steps outside a connection (pickers, wizards) show their own `authId=<id>`.
`auth=<method>` in a startup summary is the authentication method, not an ID.
`[SrvResolution] startup=unknown` means a caller did not pass the ID, which is a bug.

### Counting

- **Attempts and outcomes:** each `connect.startup` and `worker.startup` event is one attempt.
  Count them by `surface` and `startupOutcome`.
- **Time:** the same events carry `<stage>DurationMs`, `tokenAcquireDurationMs`,
  `databaseConnectDurationMs`, and `srvResolution`. Join `connect.srvResolution` on
  `startupCorrelationId` only when DNS detail is needed.
- **Success rate:** `succeeded` / (`succeeded` + `failed` + `timedOut` + `exited`). Report
  `canceled` separately.
- **Journeys (best effort):** group shell events and `worker.startup` by `shellSessionId`. Join to
  cluster metadata through `connectionCorrelationId` when present. A shell without that link is
  still a valid attempt.
- **Not covered:** cached-client reuse, driver reconnects, and events lost to crashes. None of these
  IDs identifies a user or a cluster.

Example: the user expands a cluster in the tree, then opens a shell. That is two attempts (two
startup IDs), one shell session, and one metadata link from the shell to the extension client.

```kusto
RawEventsVSCodeExt
| where EventName endswith "connect.startup" or EventName endswith "worker.startup"
| summarize attempts = count()
    by surface = tostring(Properties.surface), outcome = tostring(Properties.startupoutcome)
```

Scope the query to this extension and a time range. Ingested property names are lowercase.

## Why this needs a convention

Ids are the only way to join events that come from different telemetry contexts: a command, the
tRPC procedures of a webview, a background task. Each feature has picked names on its own. The one
written rule lives in a single feature's decisions file
([copy-paste-collections](./features/copy-paste-collections/decisions.md), "Reuse
`journeyCorrelationId`. Rejected because it identifies discovery/tree lineage and can span unrelated
commands, not one paste attempt."). The telemetry skill shows `journeyCorrelationId` and
`connectionCorrelationId` as examples but does not say when to use which, or when to create a new
one.

The confusion in #979: the Quick Start wizard's panel id (`quickStartSessionId`) felt like a journey
id, while the existing Quick Start `journeyCorrelationId` actually identified one setup run. The run
id was renamed to `provisionCorrelationId` in the same PR.

## Inventory (2026-09-29, historical)

This inventory predates the connection IDs section above, which supersedes it for connection
startup. Shell and worker events carry `connectionCorrelationId` only as a metadata link.

The ids fall into three scopes.

**Lineage: open-ended, spans commands**

| Id                     | Created by                                                                | Carried by                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journeyCorrelationId` | Discovery tree roots (Azure vCore, Azure RU, Azure VM, Atlas, Kubernetes) | Tree items under that root; any command run on them through `withCommandCorrelation` / `withTreeNodeCommandCorrelation`; the Cluster Dashboard, passed through from the command that opened it |

It has no defined end: it lives as long as the root tree item, which can be hours and many clusters.

**Surface session: one UI surface, from open to close**

| Id                    | Surface                            | Carried by                                                                                     |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dashboardSessionId`  | One Cluster Dashboard panel        | The open command, every dashboard procedure event, webview events sent through `reportEvent`   |
| `quickStartSessionId` | One Local Quick Start wizard panel | The open command, `documentDB.quickstart.wizard.step` / `.close`, every wizard procedure event |
| `shellSessionId`      | One interactive shell terminal     | Shell events                                                                                   |
| `sessionId`           | One query playground evaluator     | Playground execution events. Generic name, easy to confuse with `VSCodeSessionId`.             |

**Operation: one attempt at one thing**

| Id                                  | Operation                            | Carried by                                                                                             |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `connectionCorrelationId`           | One connection attempt               | `connect`, `connect.staticmetadata`, `connect.getmetadata`                                             |
| `copyOperationCorrelationId`        | One Paste Collection / Paste Indexes | Wizard, task initialization, task execution                                                            |
| `provisionCorrelationId`            | One Local Quick Start setup run      | `startQuickStart` procedure, `documentDB.quickstart.provision`, `.provision.stage`, `.resumeReadiness` |
| `managedIdentityTokenCorrelationId` | One managed identity token request   | Managed identity auth events                                                                           |
| `startupCorrelationId`              | One playground worker startup        | Worker startup events                                                                                  |

## Proposed rule (draft)

1. **`journeyCorrelationId` means lineage only.** Create it at a tree root, carry it on tree items,
   and let commands pick it up. Never create one for a single operation or a single panel.
2. **`<surface>SessionId` for how long a UI surface is open.** One per panel or terminal, created when
   it opens, stamped on every event it produces. If the surface was opened from a node that carries a
   `journeyCorrelationId`, carry that too, as the dashboard does.
3. **`<operation>CorrelationId` for one attempt.** Named after the operation or its event
   (`provisionCorrelationId` for `documentDB.quickstart.provision`). Never a bare `correlationId`.
4. **Nesting is explicit.** An event carries every id it belongs to: a setup run's procedure event
   carries both `quickStartSessionId` and `provisionCorrelationId`.

## Open questions

- **Where the rule lives.** A "which id to use" section in the telemetry skill is the natural home,
  with a pointer from the copy-paste decision.
- **Generic names.** Should the playground's `sessionId` be renamed (for example
  `playgroundSessionId`)? Only if nothing queries it yet.
- **Surfaces without lineage.** The Connections view and Local Quick Start trees create no
  `journeyCorrelationId`, so their commands and panels start with none. Is lineage worth adding there,
  and what question would it answer? For Quick Start, the main one is "did a successful setup lead to
  the instance being used". A `connect` event with `connectionType = localQuickStart` in the same
  VS Code session may already answer it well enough.
- **Connect events for Local Quick Start.** `QuickStartClusterItem` does not set
  `connectionCorrelationId`, unlike the other cluster items.
