---
feature: connection-lifecycle
kind: notes
status: active
created: 2026-11-19
code:
    - src/documentdb/ClustersClient.ts
    - src/documentdb/ClusterSession.ts
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/tree/documentdb/ClusterItemBase.ts
---

# Connection lifecycle

**Status:** planned (iteration 1) · **Issues:**

- [#1102](https://github.com/microsoft/vscode-documentdb/issues/1102)
- [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059)
- [#566](https://github.com/microsoft/vscode-documentdb/issues/566)
- [#990](https://github.com/microsoft/vscode-documentdb/issues/990)
- follow-ups after 1.2.0: [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105)
  (Kubernetes tunnels, network resilience), [#1106](https://github.com/microsoft/vscode-documentdb/issues/1106)
  (out-of-date results), and [#1119](https://github.com/microsoft/vscode-documentdb/issues/1119)
  (prompt handling of Microsoft account sign-out)

**Branch:** `feature/connection-lifecycle`, with stacked sub-PRs from `dev/tnaum/*`. Implementation
does not wait for intermediate merges; the operator handles approvals and merges (decision 0006).

> How database connections stay usable across Entra token expiry, idle drops and credential
> changes, and what open surfaces do when the user must act or the identity changes.

## Problem

After an hour or more, connections stop working, and only restarting VS Code helps. There are three
defects:

1. Interactive Entra ID returns a captured token from the OIDC callback forever.
2. Azure Discovery holds subscriptions whose ARM token is frozen, and the ARM 401 challenge crashes.
3. Nothing evicts or recreates a failed client, Retry reuses it, and Collection View tabs hold the
   old instance.

Evidence, telemetry and source pointers: [research-findings.md](./research-findings.md).

## Intent

- **Recover database connections silently** from token expiry and idle drops. For database
  authentication, prompt only on a user click, never from a token callback. Separately, an Azure
  Resource Manager challenge can prompt during Azure Discovery. Subscription listing keeps
  successful results and records a sanitized diagnostic if an account or tenant cannot be listed.
- **Keep one client per cluster.** Surfaces resolve it per operation and check its identity
  fingerprint and generation.
- **Never change identity under an open surface.** It stays open, keeps its state, and shows a
  shaded, disabled view with a dialog that names the problem in a short title and gives the next
  step separately. Offer **Close view**, with **Retry** beside it when the view can safely reuse
  the available credentials. Credential repair stays in the tree.
- After a database rejects a verified Entra identity, discard the client but keep its in-memory
  connection settings for explicit sign-in. Do not retain the rejected token or retry silently.
  When the tree offers **Retry sign-in**, it does not also offer **Retry**.
- **One teardown** serves Disconnect, Remove Connection and identity-changing credential updates.
- Disconnect uses the existing task-conflict guard: if a copy or export is using the cluster,
  leave the task and connection running. The user can retry after the task finishes or is stopped.

## Documents

| Document                                                                       | Kind      |
| ------------------------------------------------------------------------------ | --------- |
| [research-findings.md](./research-findings.md)                                 | research  |
| [decisions.md](./decisions.md)                                                 | decisions |
| [iterations/01-implementation-plan.md](./iterations/01-implementation-plan.md) | plan      |
| [iterations/01-dev-plan.md](./iterations/01-dev-plan.md)                       | plan      |

## Decisions index

See [decisions.md](./decisions.md):

- 0001 silent renewal, never prompt from the callback;
- 0002 a cached client with identity and generation;
- 0003 no silent identity change;
- 0004 the Disconnect tab choice;
- 0005 azureauth v6;
- 0006 delivery through a feature branch with stacked sub-PRs, shipped once;
- 0007 the Disconnect choice is a modal, not remembered, with a setting for the default;
- 0008 the azext stack is upgraded as high as viable, with Azure Resources as the reference;
- 0009 Kubernetes tunnel recovery, stable tunnel fingerprints, case handling and wider network-resilience testing move to #1105;
- 0010 rely on the server to reject expired tokens; same-identity client replacement is transparent;
- 0011 Disconnect keeps the cached credentials and the verified identity; only Remove drops them;
- 0012 a minimal lifecycle design: no state machine, one epoch, no prompts in `getClient`, one-step teardown;
- 0013 corrections to 0012: latch before a credential save, epoch checks on replies, bindings carried through handoffs, an operation wrapper, folder deletion runs teardown.
- 0014 retain in-memory settings for explicit sign-in recovery after verified Entra rejection.
- 0015 use the existing latch to block startup after authentication rejection until explicit recovery.
- 0016 keep disconnected webviews open under a full-view overlay with explicit actions.
- 0017 limit unavailable webview recovery to Retry and Close view.

## Timeline

| Date       | Event                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| 2026-11-18 | Investigation: code read, telemetry attribution, vscode-cosmosdb comparison |
| 2026-11-19 | Operator decisions 0001–0005; implementation plan (iteration 1)             |
| 2026-11-19 | Decision 0006: delivery model (feature branch, sub-PRs, one release)        |
