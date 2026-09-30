---
kind: plan
status: active
created: 2026-09-29
---

# Telemetry correlation ids (future work)

> Which id a telemetry event should carry so related events can be joined, and what each name
> means. Written after #979, where two Quick Start ids with overlapping names were easy to confuse.
> Nothing here is agreed yet: this collects the inventory and the open questions for a later pass.

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

## Inventory (2026-09-29)

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
