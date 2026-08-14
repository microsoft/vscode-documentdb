# PR #733 — Atlas MongoDB Discovery: UX Review (Iteration 2) — Cluster Item Presentation

**Branch:** `dev/bchoudhury/atlas-mongodb-discovery`
**Plugin path:** `src/plugins/service-atlas-mongodb/`
**Reviewer focus (this iteration):** discovery-tree cluster item presentation — icon stability and `description` content.
**Date:** 2026-06-30

> Note: The authentication portion of this review iteration has been removed. Interactive
> browser sign-in was researched and **deferred to future work** (no supported third-party
> path today — see the design-decisions doc, §3). The shipped auth methods are **API Key** and
> **Service Account**, so this iteration focuses on the cluster-item presentation findings.

---

## Topic — Cluster item icon uses cluster lifecycle state

### Finding 2-A — Icon changes with `stateName`; violates the stable-icon convention

`AtlasClusterItem.getStateIcon()` maps the `stateName` field returned by the Atlas Admin API to a VS Code `ThemeIcon`:

```
IDLE               → circle-filled  (green, testing.iconPassed)
CREATING / UPDATING / REPAIRING → loading~spin  (animated spinner)
DELETING           → circle-filled  (red, testing.iconFailed)
<anything else>    → circle-outline
```

**Where `stateName` comes from:** The Atlas Admin API v2 (`GET /api/atlas/v2/groups/{groupId}/clusters`) returns a `stateName` field. The extension models it as:

```ts
type AtlasClusterState = 'IDLE' | 'CREATING' | 'UPDATING' | 'DELETING' | 'REPAIRING' | 'UNKNOWN';
```

Reference: [Atlas API — Advanced Clusters](https://www.mongodb.com/docs/atlas/reference/api-resources-spec/v2/#tag/Advanced-Clusters/operation/listClusters) (`stateName` enum field on the cluster response object).

**Why this is a problem:** The Kubernetes UX review (iteration 1 of this review series, §4.3 "Surfacing transient state") established that **all sibling discovery plugins use stable provider-identity icons**. Dynamic icons that change with transient state cause the tree to feel unstable — icons flash between states on every refresh. Azure VM expresses "No Connectivity" via the `description` property while keeping its icon constant. The Kubernetes plugin does the same.

`AtlasClusterItem` is the **only** tree node across all discovery plugins that uses a state-driven icon.

#### Work item — Replace state-driven icon with a static icon; surface state via `description` and tooltip

> **Status:** Open

The cluster item icon should be a fixed, provider-identity icon (e.g. a generic database/server icon). The `stateName` should be surfaced through the existing VS Code `description` property (the grey secondary text rendered to the right of the label) and the tooltip should explain what each state means.

**Proposed `description` behaviour:**
| `stateName` | Shown in `description` |
|---|---|
| `IDLE` | _(omit — normal state, no annotation needed)_ |
| `CREATING` | `Creating…` |
| `UPDATING` | `Updating…` |
| `REPAIRING` | `Repairing…` |
| `DELETING` | `Deleting…` |
| `UNKNOWN` | `Unknown state` |

**Proposed tooltip addition:** For non-`IDLE` states, append a human-readable explanation of what the state means and what the user can/cannot do (e.g. _"This cluster is being created. It will be available to connect once creation is complete."_).

**Files to change:**

- `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts` — replace `getStateIcon()` with a fixed icon; update `buildDescription()` to prepend the state string; update `buildTooltip()` with per-state explanations.
- `src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts` — `stateName` is currently typed as `string`; tighten it to use `AtlasClusterState` (already defined in `AtlasProjectModel.ts`) for safety.

**Prior art in this codebase:** Iteration 1 of this UX review (`ux-review-iteration-1-k8s-alignment.md`) §4.3 documents the same finding for the root item's state-driven icon.

---

### Finding 2-B — Cluster item `description` carries too much noise

`buildDescription()` currently produces:

```
M10, AWS, us-east-1
```

Three fields — tier, cloud provider, region — all joined with commas into a single flat string. This is a lot of secondary text to scan for every row, and much of it duplicates what the tooltip already shows in detail.

The Kubernetes review established the same principle for cluster items: the `description` field should carry **the single most useful discriminator** — enough to tell entries apart at a glance — and the tooltip is the right place for the full detail.

For Atlas clusters, the most useful at-a-glance discriminator is the **tier** (`instanceSizeName`, e.g. `M10`). Provider and region are secondary; users rarely have two clusters of the same name differing only in cloud or region, but they often have a mix of tiers.

#### Work item — Trim `description` to tier only; keep provider + region in tooltip

> **Status:** Open

Simplify `buildDescription()` to return only `instanceSizeName` (e.g. `M10`). The full `providerName` + `regionName` are already present in the tooltip — no information is lost. When combined with Finding 2-A (state surfaced in description), the final `description` column would read:

| State      | `description` shown |
| ---------- | ------------------- |
| `IDLE`     | `M10`               |
| `CREATING` | `M10 · Creating…`   |
| `UPDATING` | `M10 · Updating…`   |
| `DELETING` | `M10 · Deleting…`   |

If `instanceSizeName` is absent (e.g. serverless clusters), fall back to the cloud/region pair as today.

**File to change:** `AtlasClusterItem.buildDescription()` in `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts`.

---

### Summary table

| #   | Finding                                                                                  | Severity   | Effort | Owner |
| --- | ---------------------------------------------------------------------------------------- | ---------- | ------ | ----- |
| 2-A | Cluster icon is state-driven; replace with static icon + `description`/tooltip for state | **Medium** | Low    | —     |
| 2-B | `description` shows tier + provider + region — too noisy; trim to tier only              | Low        | Low    | —     |
