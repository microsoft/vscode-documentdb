# MongoDB Atlas Discovery — UX Review Pack (Iteration 3)

> **Who this is for:** anyone about to do a hands-on UX review of the **MongoDB Atlas
> discovery provider**, or anyone triaging the findings.
> **What this is:** a single catch-up document that captures a round of runtime UX
> feedback, states what the code _actually does today_ (verified against the current
> branch), and — for each item — offers a **suggestion** and a **status**. Items are
> **sorted by priority** (P0 → P3).

- **Feature area:** [src/plugins/service-atlas-mongodb/](../../../../src/plugins/service-atlas-mongodb)
- **PR / branch:** [microsoft/vscode-documentdb#733](https://github.com/microsoft/vscode-documentdb/pull/733) · `dev/tnaum/atlas-discovery-review-iteration-2`
- **Related design docs:** [decisions.md](./decisions.md) · [ux-review-iteration-1-k8s-alignment.md](./ux-review-iteration-1-k8s-alignment.md) · [ux-review-iteration-2-cluster-item.md](./ux-review-iteration-2-cluster-item.md) · [atlas-mongodb-discovery-flow.md](../../../atlas-mongodb-discovery-flow.md)
- **Scope:** the UX-facing surface (tree structure, wording, icons, webviews, lifecycle
  actions, error recovery). Backend internals appear only where they explain a
  user-visible symptom.
- **Review date:** 2026-07-13

## How this review was run

A person exercised the real feature and dictated observations; an AI assistant did the
code-checking, root-cause tracing, and write-up. Each finding is backed by the exact code
path that produces the behavior, so a later implementation pass doesn't have to re-derive
it. Items are grouped and ordered **by priority**; each carries an **Observation** (what
the reviewer saw), a **Finding** (what the code does and why), a **Suggestion**, and a
**Status**. Heavier design questions with real trade-offs are pulled into
[Open ideas](#open-ideas--options-pros--cons).

> **This is iteration 3.** Iterations 1 (K8s/Azure alignment) and 2 (cluster-item
> presentation) have largely **landed** — the root node, cluster icon/description, and the
> root-level modal+retry error flow are all implemented (see [Implemented](#implemented)).
> This pass re-verifies the surface against the current branch and concentrates on the
> gaps that remain: **error-surface asymmetry at the _project_ tree level**, the
> **wizard raw-throw dead-ends**, and a handful of polish items.

## Legend

### Priority

| Priority | Meaning                                            |
| -------- | -------------------------------------------------- |
| **P0**   | Blocking — the user gets stuck                     |
| **P1**   | Broken / misleading, or a consistency & safety gap |
| **P2**   | Polish, expectation, or a smaller feature gap      |
| **P3**   | Nice-to-have / cosmetic / acknowledged             |

### Status

| Status             | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| 🟠 **Open**        | Recorded + analyzed; carries a recommendation but stays a _suggestion_   |
| 🟡 **Open (soft)** | Open, but depends on an investigation or is a soft "leave as-is"         |
| ✅ **Implemented** | Changed on this branch and verified (Decision + commit link recorded)    |
| 🚫 **Closed**      | Won't fix — with a mandatory one-line reason                             |
| 🔗 **Tracked**     | Deferred to a repo issue (linked); dropped from the active priority list |

> **Items are worked in iterations.** Anything still 🟠 Open at the end of an iteration
> **moves to the next one** — an item leaves this ledger only as ✅ Implemented, 🚫 Closed,
> or 🔗 Tracked. Each fix records **why it was chosen** (Decision) and **how it was done**
> (Implemented + commit link).

### Complexity (≈ files touched)

A rough sizing so work can be distributed: the approximate number of files each item touches
(source + tests + `package.json` / l10n), **bucketed in groups of five**. It is an _effort
signal for parallelizing the work_, not a contract.

| Bucket  | ≈ Files | Rough scope                                              |
| ------- | ------- | -------------------------------------------------------- |
| **~5**  | 1–5     | One or two files + tests; a localized change             |
| **~10** | 6–10    | Several files across one area (e.g. remove a feature)    |
| **~15** | 11–15   | A new surface (webview / tree level) spanning many files |
| **~20** | 16–20   | Cross-cutting redesign (storage + API + tree + wizard)   |

### Markers (inline)

| Marker            | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| ⚠️ **Flag**       | Confirmed gap or bug                                    |
| 💡 **Suggestion** | A design/wording recommendation to react to             |
| 🔍 **Answered**   | A "how does this work?" question answered from the code |

> **For the operator:** items below are **Open** by default — each records a recommendation
> that is a **suggestion, not a final decision**. Disagree freely; where there are real
> trade-offs, see [Open ideas](#open-ideas--options-pros--cons).

---

## User interaction map _(seed now)_

Where every user action **starts** and where it **terminates**. Divergent terminations
(modal vs. non-modal vs. silent vs. raw throw) are flagged here and re-checked live.

**ASCII flow**

```text
DISCOVERY PANEL
  Expand "MongoDB Atlas" root
    ├─ no session ──────────────► auth QuickPick ──► API Key / Service Account flow
    │                               │                  ├─ success ► toast + tree refresh
    │                               │                  └─ fail ───► MODAL error ✅
    │                               └─ cancel ────────► [Sign in] node (sign-in icon)
    ├─ session ok ─────────────────► list projects
    │        ├─ 0 projects ────────► [info] "No projects found"            (passive ✅)
    │        ├─ all filtered ──────► [filter] "All projects are hidden…"   (passive ✅)
    │        └─ load/auth failure ─► MODAL + [Click here to retry] node    ✅ (root)
    └─ Expand a PROJECT
             ├─ 0 clusters ────────► [info] "No clusters found…"           (passive ✅)
             ├─ no session ────────► [warning] "Please sign in… again."    ⚠️ PASSIVE
             ├─ 401/403 (None) ────► [error] "Please sign in… again."      ⚠️ PASSIVE
             ├─ 401/403 (intact) ──► [error] raw error.message            ⚠️ PASSIVE
             └─ load failure ──────► [error] "Failed to load clusters: …"  ⚠️ PASSIVE
                     └─ Expand a CLUSTER (Layer-2 SCRAM auth)
                              ├─ success ► databases
                              └─ fail ───► MODAL "Failed to connect…" ✅

ADD-CONNECTION WIZARD (Atlas provider)
  getDiscoveryWizard
    ├─ no session ──► auth QuickPick ─► success ► continue │ cancel ► UserCancelledError ✅
    ├─ Select project step
    │      └─ session missing ─────► THROW "Atlas session not available"  ⚠️ RAW → closes wizard
    └─ Select cluster step
           ├─ filters to IDLE-only clusters (hides CREATING/UPDATING)     ⚠️ tree/wizard mismatch
           └─ 0 IDLE clusters ─────► THROW "No active clusters found…"    ⚠️ RAW → closes wizard
```

**Mermaid**

```mermaid
flowchart TD
    Root[Expand 'MongoDB Atlas' root] --> RSess{Session valid?}
    RSess -- no --> AuthQP[Auth QuickPick]
    AuthQP -- success --> RList[List projects]
    AuthQP -- fail --> RModal([MODAL error ✅])
    AuthQP -- cancel --> SignIn([Sign in node])
    RSess -- yes --> RList
    RList -- load/auth fail --> RootErr([MODAL + 'Click here to retry' ✅])

    RList --> Proj[Expand a Project]
    Proj -- no session --> P1([PASSIVE warning row ⚠️])
    Proj -- 401/403 --> P2([PASSIVE error row ⚠️])
    Proj -- load fail --> P3([PASSIVE 'Failed to load clusters' ⚠️])
    Proj -- ok --> Clus[Expand a Cluster]
    Clus -- connect fail --> CModal([MODAL ✅])

    Wiz[Add-Connection wizard] --> WProj{Session?}
    WProj -- missing --> WThrow([RAW throw → wizard closes ⚠️])
    Wiz --> WClus[Select cluster]
    WClus -- 0 IDLE clusters --> WThrow2([RAW throw → wizard closes ⚠️])
```

The diagram makes the asymmetry obvious: **root-level** failures terminate in a **modal +
canonical retry node** (the house style), while **project-level** failures terminate in
**passive in-tree rows**, and the **wizard** terminates in **raw thrown errors** that
close the flow. The reviewer also flagged the **entry edge** itself: expanding the
signed-out root **auto-opens the auth QuickPick** rather than waiting for the user to click
the sign-in node (item 1).

**Interaction inventory**

| #   | User action (entry)                   | Where it lives                                                                                                                    | Terminal state(s)                                      | Surface           | ⚠️  |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------- | --- |
| 1   | Expand root (signed out)              | [AtlasServiceRootItem.getChildren](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L39)      | **Auto-opens** auth QuickPick → success/`Sign in` node | quickpick / tree  | ⚠️  |
| 2   | Root load / auth failure              | [AtlasServiceRootItem.showLoadFailure](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L205) | **Modal** + `Click here to retry` node                 | modal + tree      | ✅  |
| 3   | Expand project, load clusters         | [AtlasProjectItem.getChildren](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts#L36)              | **Passive** error/warning rows                         | tree only         | ⚠️  |
| 4   | Expand cluster (SCRAM connect)        | [AtlasClusterItem.authenticateAndConnect](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts#L100)  | Databases / **modal** on failure                       | modal             | ✅  |
| 5   | Auth (API Key / Service Account)      | [AtlasApiKeyFlow.executeApiKeyFlow](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts#L15)                    | Toast on success / **modal** on failure                | toast + modal     | ✅  |
| 6   | Manage Credentials (signed in)        | [AtlasDiscoveryProvider.configureCredentials](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L169)       | QuickPick (account / sign out / exit)                  | quickpick         |     |
| 7   | Organizations filter                  | [AtlasDiscoveryProvider.showOrganizations](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L221)          | Tree refresh / **modal** on fetch failure              | quickpick + modal | ✅  |
| 8   | Project filter (funnel icon)          | [AtlasDiscoveryProvider.configureTreeItemFilter](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L104)    | Tree refresh / info toast on empty                     | quickpick + toast |     |
| 9   | Add-Connection wizard: select project | [SelectAtlasProjectStep.prompt](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts#L22)           | QuickPick / **raw throw** closes wizard                | quickpick / throw | ⚠️  |
| 10  | Add-Connection wizard: select cluster | [SelectAtlasClusterStep.prompt](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts#L57)           | QuickPick (IDLE-only) / **raw throw** closes wizard    | quickpick / throw | ⚠️  |

---

## The story in one paragraph

The Atlas provider has come a long way: root label, stable icons, trimmed cluster
descriptions, and the modal+retry error pattern all landed from iterations 1–2. The
hands-on pass (iteration 3) surfaced a cluster of **release-blocking** first-run problems
that all trace back to the **authentication experience**: expanding the root **auto-opens
an auth picker** the user didn't ask for; that picker is a bare QuickPick that **doesn't
tell the user where to get the keys**; when a key is **wrong or under-permissioned** there
is **no retry / update-credentials path** (you must restart the whole wizard); and an
under-permissioned key is silently mis-reported as **"No projects found"** (a 200 with an
empty list, not an error) with a long, unreadable description. Underneath sits the same
structural gap from earlier iterations — **project-level failures are still passive rows**
and the **wizard throws raw errors**. Beyond the blockers, the reviewer scoped two larger
design directions to plan now and build next: a **guided webview** for credential entry,
and **multi-credential management** modeled on the Azure accounts flow — plus a
**tree/list view toggle** (with an org level) mirroring Kubernetes.

---

## Priority index

> **P0/P1 block a release.** Everything in the P0 and P1 sections must be resolved (✅
> Implemented, 🚫 Closed with a reason, or 🔗 Tracked with a committed follow-up) **before
> this PR can ship**. P2/P3 are strongly desired but do not gate the release.

| #   | Priority | Item                                                                          | ≈ Files | Reviewer?  | Status                                                                                      |
| --- | -------- | ----------------------------------------------------------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------- |
| 1   | **P1**   | Root auto-opens the auth picker on expand — should just show the sign-in node | ~5      | 🗣️ #1      | ✅ Implemented                                                                              |
| 2   | **P1**   | Auth-recovery tree node wording is inconsistent                               | ~5      | 🗣️ #3/live | 🟠 Open — reopened 2026-07-23                                                               |
| 3   | **P1**   | No-projects result uses a non-actionable information row                      | ~5      | 🗣️ #4/live | 🟠 Open — reopened 2026-07-23                                                               |
| 4   | **P1**   | Project-level failures are passive rows (root uses modal + retry)             | ~5      | —          | ✅ Implemented                                                                              |
| 5   | **P1**   | Wizard steps throw raw errors → close the flow (no in-flow recovery)          | ~5      | (🗣️ #3)    | ✅ Implemented ([313950f2](https://github.com/microsoft/vscode-documentdb/commit/313950f2)) |
| 14  | **P1**   | Remove all filtering (org + project) and its storage — release cleanup        | ~10     | 🗣️ live    | ✅ Implemented ([a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70)) |
| 6   | **P2**   | Rework credential entry as a guided webview (where to get keys)               | ~15     | 🗣️ #2      | ✅ Implemented                                                                              |
| 7   | **P2**   | Multi-credential management like the Azure accounts flow (add/remove)         | ~20     | 🗣️ #6      | 🟡 Open (soft)                                                                              |
| 8   | **P2**   | Tree/List view toggle + org level (Kubernetes-style)                          | ~15     | 🗣️ #5      | 🟡 Open (soft)                                                                              |
| 9   | **P2**   | Wizard hides non-IDLE clusters the tree shows (tree/wizard mismatch)          | ~5      | —          | ✅ Implemented ([368a4cff](https://github.com/microsoft/vscode-documentdb/commit/368a4cff)) |
| 10  | **P2**   | Project node has no tooltip                                                   | ~5      | —          | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |
| 11  | **P2**   | No reveal/expand of the Atlas root after a successful sign-in                 | ~5      | —          | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |
| 12  | **P3**   | Root shows no "signed in as…" identity when Active                            | ~5      | —          | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |
| 13  | **P3**   | ~~Active-filter state not visible on the root~~ — superseded by #14           | —       | —          | 🚫 Closed                                                                                   |

---

## Work bundles (grouped & ordered)

The same items, **bundled by the code they touch** and ordered so a contributor can pick a
self-contained chunk. No items are added or removed here — every active item from the index
appears in exactly one bundle (closed #13 is noted where it belongs). Bundles A–C are the
release blockers; D is quick polish; E is the sequenced follow-up redesign. Each item carries
its **≈ files** estimate (from the [Complexity legend](#complexity--files-touched)) so work can
be sized and distributed.

### Bundle overview — what runs in parallel

The four release-blocker bundles (**A, B, C, D**) touch **disjoint files** and have **no
cross-bundle dependency** — they can be picked up by four contributors **at the same time**.
Bundle **E** is the only one that must wait (it builds on C's cleanup and A's single sign-in
entry, and is internally sequential).

| Bundle | Theme                         | Priority | Items (in order)                                                                   | \u2248 Files (sum) | Parallelizable with     |
| ------ | ----------------------------- | -------- | ---------------------------------------------------------------------------------- | ------------------ | ----------------------- |
| **A**  | Sign-in & error surfacing     | P1       | 1 ✅ → 4 ✅ → {2 ‖ 3}                                                              | ~20                | **B, C, D**             |
| **B**  | Add-Connection wizard         | P1       | 5 ✅ → 9                                                                           | ~10                | **A, C, D**             |
| **C**  | Filtering removal             | P1       | 14 ✅ ([a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70)) | ~10                | **A, B, D** (completed) |
| **D**  | Tree/root presentation polish | P2–P3    | 10 ‖ 11 ‖ 12                                                                       | ~15                | **A, B, C**             |
| **E**  | Credential & view redesign    | P2       | 6 → 7 → 8                                                                          | ~50                | after **C** (& **A**)   |

> Legend for the ordering column: `→` = must be done in sequence; `‖` = order does not matter
> (safe to parallelize); `{ }` = a parallel group. So Bundle A is _1, then 4, then 2 and 3 in
> parallel_; Bundle D is _all three in any order / in parallel_.

### Bundle A — Sign-in & error surfacing (root + project) · **P1 · do first**

The first-run authentication cluster: one sign-in node, one retry story, consistent error
surfacing. All live in `AtlasServiceRootItem` / `AtlasProjectItem` / the auth flow.

| Order | Item                                                                      | Touches                                                       | \u2248 Files | Parallel within bundle?                                |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ | ------------------------------------------------------ |
| 1     | **Item 1** — remove auto-prompt; expand shows only the sign-in node       | `AtlasServiceRootItem` (+ delete `consumeSuppressAutoPrompt`) | ~5           | ✅ Implemented — establishes the single sign-in entry  |
| 2     | **Item 4** — project errors → modal + single retry node; detail to output | `AtlasProjectItem`, shared `showLoadFailure` helper           | ~5           | ✅ Implemented — defines the shared modal+retry helper |
| 3a    | **Item 2** — align auth-recovery tree action wording                      | `AtlasServiceRootItem`, shared tree-action wording            | ~5           | 🟠 Reopened — follow-up to Iteration 3 implementation  |
| 3b    | **Item 3** — no-projects result → modal + canonical retry node            | `AtlasServiceRootItem.fetchProjectItems`, retry-node cache    | ~5           | 🟠 Reopened — follow-up to Iteration 3 implementation  |

> Sequence: 1 establishes the single sign-in entry, 4 defines the shared modal+retry helper,
> then 2 and 3 reuse that helper for the auth-failure and empty-state cases **in parallel**.

### Bundle B — Add-Connection wizard · **P1**

Both items live in `SelectAtlasSteps` / `getDiscoveryWizard`.

| Order | Item                                                                                             | Touches                                       | \u2248 Files | Parallel within bundle?                                                                      |
| ----- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| 1     | **Item 5** — raw throws → Azure-style "Manage MongoDB Atlas Credentials…" + `UserCancelledError` | `SelectAtlasSteps`, `getDiscoveryWizard`      | ~5           | ✅ Implemented — completed; unblocks item 9                                                  |
| 2     | **Item 9** — reconcile the IDLE-only cluster filter to match the tree                            | `SelectAtlasSteps` (`SelectAtlasClusterStep`) | ~5           | ✅ Implemented in [368a4cff](https://github.com/microsoft/vscode-documentdb/commit/368a4cff) |

### Bundle C — Filtering removal · **P1 · implemented**

| Order | Item                                                                      | Touches                                                                              | \u2248 Files | Parallel within bundle?                                                                                              |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1     | **Item 14** — remove all org/project filtering + storage (**closes #13**) | `AtlasDiscoveryProvider`, `AtlasServiceRootItem`, `AtlasSessionManager`, `config.ts` | ~10          | ✅ Implemented in [a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70); `npm run build` passed |

> Completed independently of A/B: it deleted code that the credential/view redesign (Bundle
> E) would otherwise have had to carry forward. The shared `filterProviderContent` command
> remains because Azure discovery providers still use it; Atlas no longer contributes its
> `enableFilterCommand` context token.

### Bundle D — Tree/root presentation polish · **P2–P3 · quick wins**

Small, independent touches to the tree items and root description. **All three touch different
files — order does not matter and they can be done in parallel.**

| Order | Item                                                            | Touches                                    | \u2248 Files | Parallel within bundle?                                                                     |
| ----- | --------------------------------------------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------- |
| ‖     | **Item 10** — add a project-node tooltip                        | `AtlasProjectItem.getTreeItem`             | ~5           | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |
| ‖     | **Item 11** — reveal/expand the root after a successful sign-in | `AtlasDiscoveryProvider`                   | ~5           | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |
| ‖     | **Item 12** — show the signed-in identity in the root (P3)      | `AtlasServiceRootItem.getStateDescription` | ~5           | ✅ Implemented ([41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)) |

### Bundle E — Credential & view redesign · **P2 · sequenced follow-up PRs**

The three larger reviewer design directions; **strictly sequential** because each depends on
the previous (see [Sequencing](#sequencing-suggested)).

| Order | Item                                                                            | Touches                                                                                                 | \u2248 Files | Parallel within bundle?                        |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| 1     | **Item 6** — guided webview for credential entry (hosts "Add" / "Update creds") | new webview (React + tRPC router + controller), `AtlasApiKeyFlow`, `AtlasServiceAccountFlow`            | ~15          | ✅ Implemented — do first                      |
| 2     | **Item 7** — multi-credential management on the shared `StorageService`         | `AtlasSessionManager` → N-credential store, `configureCredentials` wizard, API client, tree attribution | ~20          | After 6 — the webview is the "Add" surface     |
| 3     | **Item 8** — Tree/List view toggle + org level                                  | new `AtlasOrgItem`, `config.ts`, 2 commands, `package.json`, `AtlasProjectItem`/`AtlasClusterItem`      | ~15          | After 7 — needs the org-aware credential model |

> Bundle E benefits from Bundle C having landed (fewer filter surfaces to migrate) and from
> Bundle A's single sign-in entry point.

---

## P0 — Blocking (the user gets stuck) — release blocker

_None classified P0 outright. The four P1 items below are grouped first-run auth blockers;
if the reviewer decides any single one leaves a user with **no way forward** (e.g. a bad
key with no recovery path), promote it to P0. **P0 and P1 both block the release.**_

---

## P1 — Broken / misleading, or consistency & safety — release blocker

> These gate the release. The first three are the **first-run authentication** cluster the
> reviewer hit live; items 4–5 are the pre-existing structural gaps they build on; item 14
> is a completed scope-reduction cleanup (filtering removed in
> [a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70)).

### 1. Root auto-opens the auth picker on expand — should just show the sign-in node ⚠️ 🗣️

**Priority:** P1 · **Status:** ✅ Implemented · **Complexity:** ~5 files · **Reviewer #1**

> 🤖 **Automatic audit note (2026-07-23): Accept as closed.** Code inspection confirms
> that expanding a signed-out root returns only the explicit sign-in node and does not launch
> the authentication QuickPick. The implementation follows the recorded decision.

**Observation:** _"When I attempt to expand the Atlas discovery, the auth wizard shows —
don't do this. We already have an error node that lets a user sign in. That is enough."_

**Finding:**

- ⚠️ [AtlasServiceRootItem.getChildren](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L39) calls `promptAuthentication()` **automatically** on expand when no session exists — opening the auth-method QuickPick as a side effect of expanding a tree node. Only if the user _cancels_ does it fall back to `createSignInNode()` (via the `consumeSuppressAutoPrompt()` latch).
- 🔍 This is the "no magic" convention (checklist §12): expanding a node should not launch a modal picker the user didn't request. All Azure siblings render a passive placeholder and wait for an explicit "Manage Credentials" / sign-in click.
- 🔍 The [sign-in node](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L183) already exists and already routes to `manageCredentials` — so the auto-prompt is redundant.

💡 **Suggestion:** Remove the auto-prompt branch; on "no session" simply return
`createSignInNode()`. The user signs in explicitly by clicking that node (or the inline
"Manage Credentials" action). This also deletes the `consumeSuppressAutoPrompt()`
work-around, since there is no longer an auto-prompt to suppress. **Influences items 2, 6,
7** (all sign-in entry points funnel through the same node/flow).

> **Decision (Iteration 3):** Remove the auto-prompt. Expanding the signed-out root shows
> **only** the "Sign in to view MongoDB Atlas clusters" error node — no QuickPick fires on
> expand. **Reason:** the sign-in node is already a sufficient, explicit call to action;
> auto-opening a picker the user didn't request is surprising ("no magic") and inconsistent
> with the Azure siblings.

✅ **Implemented (Iteration 3):** `AtlasServiceRootItem.getChildren()` now returns the existing
sign-in node immediately when no session exists. The automatic auth QuickPick path and the
`AtlasSessionManager.consumeSuppressAutoPrompt()` cancellation latch were removed. **Verification:**
`npm run build` passed.

---

### 2. Auth failure / bad key has no retry or "update credentials" path ⚠️ 🗣️

**Priority:** P1 · **Status:** ✅ Implemented (Iteration 4) · **Complexity:** ~5 files · **Reviewer #3/live**

> 🤖 **Automatic audit note (2026-07-23): Further implementation and hands-on testing
> required — do not accept as closed yet.** The recovery actions exist, but the second tree
> action is currently labeled **Update credentials**. The established wording used by other
> actionable error nodes is **Click here to update credentials**.

**Observation:** _"When auth fails (I tried the API key path), it just fails and I have no
retry / update-creds path — I had to restart the wizard. A retry node and an 'update
credentials' node would be better. Retry, because maybe the user will change permissions or
IP filters on the cluster. Simple retry is enough."_

**Finding:**

- ⚠️ [executeApiKeyFlow](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts#L59) shows a modal on rejection and `return false`. Back in [AtlasServiceRootItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L51), a failed `promptAuthentication()` renders the generic **sign-in** node — there is **no dedicated "retry" affordance** that re-runs the _same_ credentials, and no "update credentials" node to correct a typo without starting over.
- 🔍 The root already has a canonical `Click here to retry` node ([createRetryNode](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L192)) for _load_ failures — but the **auth-flow failure** path doesn't reuse it.
- 🔍 Reviewer's rationale matters: an auth failure is frequently **transient/fixable outside the extension** (add the key to the project, allow the current IP in the Access List — the API-key modal already hints at this). A one-click retry lets the user fix Atlas-side and re-list without re-typing.

💡 **Suggestion:** After an auth-flow failure, return the existing **`Click here to retry`**
node (re-attempts with the stored key) **plus** a **"Click here to update credentials"** node
(re-opens the entry flow). "Simple retry is enough" per the reviewer, so retry is the
must-have; update-credentials is the strong-nice-to-have. This lands even better once entry is a
webview (item 6). **Merges with item 4** (unify the retry/error presentation across root +
project).

✅ **Implemented (Iteration 3):** Submitted API key and Service Account credentials are now
stored in secure storage before validation, preserving a retry path when Atlas-side access is
corrected. A failed authentication renders **Click here to retry** and **Update credentials**
at the root. Retry uses the stored credential; update credentials opens the existing credential
management flow. The future multi-credential storage redesign remains in Bundle E. **Verification:**
`npm run build` passed.

#### Follow-up observation — Iteration 4.1 (2026-07-23) 🗣️

**Observation:** The two auth-recovery rows are actionable error nodes, but their labels do
not follow the same sentence-style call-to-action wording. The screenshot shows the established
wording used elsewhere in the extension.

**Finding:** The retry node already uses the canonical **Click here to retry** label. The
credential action in `AtlasServiceRootItem.createUpdateCredentialsNode()` instead uses the
shorter **Update credentials** label. Elsewhere, actionable error nodes use
**Click here to update credentials**, so the two Atlas recovery rows currently look unrelated
and inconsistent.

💡 **Suggestion:** Use these exact labels for the two auth-recovery error nodes:

1. **Click here to retry** — retry with the stored credential after Atlas-side permissions or
   access-list settings have been corrected.
2. **Click here to update credentials** — open credential management so the submitted values
   can be replaced.

Keep both rows styled as actionable error/recovery nodes. Do not shorten the second label to
**Update credentials** and do not use the wizard-only **Manage MongoDB Atlas Credentials...**
wording in this tree context.

**Status:** 🟠 **Open.** Update the tree label and verify both actions from the failed-auth
state before accepting this item as closed.

> **Decision (Iteration 4, Step 4):** The interim label fix is **superseded**. The two recovery
> rows are replaced by the selected design's single consolidated row, **Click here to revisit
> credentials**, which is itself a sentence-style call to action and therefore satisfies the
> wording concern. Both recovery actions the reviewer asked for still exist - they moved from the
> tree into the credential-management QuickPick the row opens, where **Retry** re-attempts the
> selected credential only and **Update credentials…** reopens the guided entry surface.
>
> Reason for the deviation: with several credentials, per-credential recovery rows multiply in the
> tree (two rows per failed credential). The consolidated row keeps the label constant no matter
> how many credentials failed and moves the detail into a tooltip, which is exactly the "reduce
> description noise" goal recorded in the POC's archived alternative A1.

✅ **Implemented (Iteration 4, Step 4):** [9c8baa0f](https://github.com/microsoft/vscode-documentdb/commit/9c8baa0f)
— `createRevisitCredentialsNode` renders one warning row whose tooltip enumerates every affected
credential and reason; clicking it opens the credential manager
([c0c49ce6](https://github.com/microsoft/vscode-documentdb/commit/c0c49ce6)) with per-credential
Retry, Update credentials, and Remove. A scoped project-level cluster failure still uses the
canonical **Click here to retry** row, because a retry is the accurate action for a failure that
is not necessarily credential-related.

---

### 3. Under-permissioned key mis-reported as "No projects found" (+ unreadable description) ⚠️ 🗣️

**Priority:** P1 · **Status:** ✅ Implemented (Iteration 4) · **Complexity:** ~5 files · **Reviewer #4/live**

> 🤖 **Automatic audit note (2026-07-23): Further implementation and hands-on testing
> required — do not accept as closed yet.** Iteration 3 implemented its original plan, but
> the resulting **No projects visible to this API key** information row is non-actionable.
> The live review has superseded that presentation with a modal + retry recommendation.

**Observation:** _"An unexpected node with a long description said no projects were found in
the Atlas org, with long text that's not readable because it's too long. And it was wrong —
it was just the permissions of the API key; I had to add more to see an existing project."_

**Finding:**

- ⚠️ Atlas returns **200 with an empty `results` array** for an under-permissioned key — [AtlasApiClient.listProjects](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts#L49) surfaces no error, so [fetchProjectItems](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L114) hits the `projects.length === 0` branch and renders **"No projects found"** / "Create a project in the Atlas console". That is a **misdiagnosis**: the account _has_ projects, the key just can't see them.
- ⚠️ The **long text lives in the node `description`**, which VS Code truncates in the tree — so it is both _wrong_ and _unreadable_ (checklist: detail belongs in a tooltip, not a truncating description).
- 🔍 The extension already fetches organizations in parallel ([fetchProjectItems](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L112)). "Orgs visible but zero projects" is a strong signal of a **permissions scope** problem rather than a genuinely empty account.

💡 **Suggestion:** Disambiguate the empty case: if `orgs.length > 0 && projects.length === 0`,
show a **permissions-oriented** empty state ("No projects visible to this API key — check the
key's project access / roles") with the actionable hint, rather than "Create a project…".
Keep the label short; move any longer explanation into a **tooltip**, not the `description`.
Optionally offer a **Click here to update credentials** affordance here too (ties to item 2). **Merges
with item 4** as part of the project/empty-state presentation pass.

✅ **Implemented (Iteration 3):** The empty result now distinguishes a genuinely empty account
from a permissions problem. When the API key can see organizations but no projects, the tree
shows **No projects visible to this API key** and places the project-access guidance in its
tooltip. The generic empty-account guidance also moved from `description` to a tooltip.
**Verification:** `npm run build` passed.

#### Follow-up observation — Iteration 4.1 (2026-07-23) 🗣️

**Observation:** When the API key can see organizations but no projects, the tree shows an
information item — **No projects visible to this API key** — with a long tooltip. The item
cannot be acted on. Non-actionable status rows should not occupy the discovery tree.

**Finding:** [AtlasServiceRootItem.fetchProjectItems](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L90)
currently returns an `info` tree item for both no-visible-projects and genuinely empty-account
results. The root already has the established error-recovery contract: a modal explanation,
the canonical **Click here to retry** action from `createRetryNode()`, and a retry-node cache
that prevents the modal from repeating until the user explicitly retries.

💡 **Suggestion:** Remove the non-actionable no-projects information item and its long tooltip.
When the Atlas request returns no visible projects:

1. Show a concise **modal error dialog** explaining whether the account appears empty or the
   API key appears unable to see projects, with permissions/access-list guidance in the modal
   detail rather than in the tree.
2. Return only the canonical error action **Click here to retry** — this is the repository's
   established label, rather than **Refresh** or **Reload**.
3. Let the existing retry-node cache suppress repeated dialogs during passive tree refreshes.
   When the user clicks **Click here to retry**, clear the cached failure and load again; if
   the result is still empty, show the explanatory modal again and restore the retry node.

**Status:** 🟠 **Open.** This follow-up changes the presentation agreed in Iteration 3; it
requires implementation plus hands-on verification for both an under-permissioned key and a
genuinely empty account.

> **Decision (Iteration 4, Steps 2 and 4):** The Iteration 4.1 proposal to show a modal plus
> **Click here to retry** for every no-projects result is **superseded**, exactly as this
> document's own roadmap section already anticipated. The live L2 checks confirmed that Atlas
> distinguishes the two cases at the protocol level: a healthy but unprivileged credential returns
> `200 []`, while an enforced access list returns `403` and a bad secret returns `401`.
>
> Because `200 []` is an authoritative answer rather than a failure, retrying it can never change
> the result, so offering a retry would train the user to click something that does nothing.
> Emptiness therefore uses the standard `empty` placeholder (`$(indent)` icon, label `empty`,
> permissions explanation in the tooltip), and only `401`, `403`, rate-limit, and network failures
> raise the consolidated recovery action.

✅ **Implemented (Iteration 4):** [ee2bf417](https://github.com/microsoft/vscode-documentdb/commit/ee2bf417)
classifies each outcome (`auth`, `forbidden`, `rateLimited`, `network`, `other`) and keeps a healthy
empty list out of the error path;
[9c8baa0f](https://github.com/microsoft/vscode-documentdb/commit/9c8baa0f) renders the `empty`
placeholder under an organization with the permissions hint in its tooltip and no retry suggestion.
The non-actionable sentence row is gone.

---

### 4. Project-level load/auth errors render as passive in-tree rows ⚠️

**Priority:** P1 · **Status:** ✅ Implemented ([313950f2](https://github.com/microsoft/vscode-documentdb/commit/313950f2)) · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Accept as closed.** Code inspection confirms
> that project failures use the shared modal/output-channel helper and leave a single retry
> node instead of passive raw-error rows, matching the recorded decision.

**Observation:** Break discovery after projects are already listed (revoke the key / drop
the network), then expand a **project** — you get a plain error row, not the modal +
"Click here to retry" the root gives.

**Finding:**

- ⚠️ [AtlasProjectItem.getChildren](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts#L36) surfaces **four** failure classes as passive
  `createGenericElementWithContext` rows with **no modal and no canonical retry node**:
  - no session → `warning` icon, "Please sign in to MongoDB Atlas again."
  - 401/403 with session cleared → `error` icon, "Please sign in to MongoDB Atlas again."
  - 401/403 transient → `error` icon, **raw** `error.message`
  - generic → `error` icon, "Failed to load clusters: {0}"
- 🔍 The **root** was already migrated to the house style — [AtlasServiceRootItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L80) calls `showLoadFailure()` (modal) + a single `Click here to retry` node. The project item is the **lone outlier** across the feature.
- 🔍 Same inconsistency iteration 1 §F flagged for _both_ levels; the root half shipped, the project half did not. **This is the shared home for the retry work in items 2 and 3.**

💡 **Suggestion:** Mirror the root pattern in `AtlasProjectItem`: on a real load attempt,
raise a modal (reuse a `showLoadFailure`-style helper) and return **one** `Click here to
retry` node instead of a passive classified row. The inherited error-node cache
(`resetNodeErrorState`) already prevents modal spam. Route raw `error.message` to the
output channel + a friendly summary. See [O2](#o2-project-level-error--retry-presentation-items-2-3-4).

> **Decision (Iteration 3):** **All** the passive "failed to load clusters" / session / auth
> error tree nodes go away. On a project load failure: show an **error modal** and leave
> **only a single retry node** in the tree; push the full detail to the **`ext.outputChannel`**.
> **Reason:** passive error rows are the last inconsistency left — the root already does modal
>
> - retry, and the tree should never carry raw, truncating error strings when the output
>   channel can hold the detail.

✅ **Implemented (Iteration 3):** Root and project load failures now use a shared
`showAtlasLoadFailure()` helper. The helper logs the technical detail to `ext.outputChannel`
and shows a concise modal; `AtlasProjectItem` now returns only the canonical retry node and
participates in the inherited retry-node cache. **Verification:** `npm run build` passed.

---

### 5. Add-Connection wizard steps throw raw errors that close the flow ⚠️

**Priority:** P1 · **Status:** ✅ Implemented · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Further investigation and targeted testing
> required — do not accept as closed yet.** The planned pinned recovery action and clean
> empty-state exits exist, but project/cluster API requests still run before the QuickPick is
> shown, so a stale session, 401/403, or network failure can bypass the recovery action and
> close the wizard. The flow also shows **Credential management completed** even when
> authentication returns `false`. Test both failure paths and correct the outcome messaging.

**Observation:** Start the Add-Connection wizard with a dropped session, or pick a project
whose clusters are all mid-provision — the wizard **closes with a raw error** instead of
keeping you in flow. (Reviewer #3's "I had to restart the wizard" pain shows up here too.)

**Finding:**

- 🔍 The old raw-throw dead-ends in `SelectAtlasProjectStep` / `SelectAtlasClusterStep` have been removed from the expected recovery paths.
- ✅ Both steps now inject an Azure-style top `alwaysShow` action — **Manage MongoDB Atlas Credentials...** — with key icon and separator, followed by the normal project/cluster options.
- ✅ Selecting the manage-credentials action runs the Atlas credential flow, records telemetry, shows a modal retry instruction, and exits with `UserCancelledError` rather than a generic `Error`.
- ✅ Empty-state dead-ends now terminate cleanly: missing project/cluster selection and no-connectable-clusters paths use `UserCancelledError` with clear guidance instead of raw thrown errors that surface as hard wizard failures.

💡 **Suggestion:** Replace the raw throws with an in-flow affordance (Azure style: an
always-show header row + clean `UserCancelledError`; or K8s style: inline "Sign in…" and
re-prompt). For the empty-cluster case, keep the user in the wizard with a clear "no
connectable clusters in this project" step rather than throwing. See
[O1](#o1-wizard-no-session--empty-cluster-recovery-item-5).

> **Decision (Iteration 3):** Adopt the **Azure style** (Option A). The Add-Connection wizard
> **always** shows a top `alwaysShow` item that opens credential management — mirror Azure's
> smart wording from [SelectSubscriptionStep](../../../../src/plugins/api-shared/azure/wizard/SelectSubscriptionStep.ts#L120):
> label **"Manage MongoDB Atlas Credentials…"**, detail _"Sign in with a different API key or
> Service Account to see more projects and clusters."_, `key` icon, followed by a separator
> and the project/cluster list. On selection, run credential management, show a short
> "completed — retry discovery" notice, then exit cleanly with `UserCancelledError` (never a
> raw `throw`). **Reason:** the user should always have a way to fix/switch credentials from
> inside the wizard; this is the established, well-worded pattern across all three Azure
> siblings.

✅ **Implemented (Iteration 3):** [313950f2](https://github.com/microsoft/vscode-documentdb/commit/313950f2)
landed Item 5 in
[SelectAtlasSteps.ts](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts) and follows the Azure wizard contract end-to-end.

- Added typed quick-pick item models for project and cluster steps, including explicit
  `manageCredentials` and empty-state item types.
- Added the top **Manage MongoDB Atlas Credentials...** `alwaysShow` item (with separator)
  to both project and cluster pickers.
- Replaced raw throw paths in recovery scenarios with clean `UserCancelledError` exits.
- Added wizard-scope credential management handlers that run auth, emit telemetry
  (`credentialConfigActivated`, `initiatedFrom`, `authMethod`, `authSuccess`), and show a
  modal "retry discovery" instruction before returning control.
- Replaced the old no-IDLE dead-end with a guided no-connectable-clusters message and
  graceful cancellation path.

**Verification:** `npm run l10n`, `npm run prettier-fix`, `npm run lint`,
`npx jest --no-coverage` (2668 tests / 159 suites), and `npm run build` all passed.

---

### 14. Remove all filtering (org + project) and its storage — release cleanup ⚠️ 🗣️

**Priority:** P1 · **Status:** ✅ Implemented ([a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70)) · **Complexity:** ~10 files · **Reviewer (live pass)**

> 🤖 **Automatic audit note (2026-07-23): Accept as closed.** The Atlas-specific project
> and organization filter UI, context token, persisted selections, and storage keys are absent
> from the current code. The remaining organization lookup is read-only, as allowed by the plan.

**Observation:** _"Filtering — I think we can skip this completely, at least for now. Users
can't log in as themselves; they use scoped Service Accounts and keys. So clean up everything
filter-related for the Atlas discovery, including any associated storage."_

**Finding:** Filtering is spread across several surfaces, all of which would be removed:

- ⚠️ **Project filter** — [AtlasDiscoveryProvider.configureTreeItemFilter](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L104) (the "Filter Entries…" QuickPick) and the `enableFilterCommand` token on the root [contextValue](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L29).
- ⚠️ **Org filter** — [AtlasDiscoveryProvider.showOrganizations](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L221) and the "account → organizations" branch of [configureCredentials](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L169).
- ⚠️ **Filter application + empty state** — the org/project filter logic and the "All projects are hidden by filter" node in [fetchProjectItems](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L114).
- ⚠️ **Session-manager API + storage** — `getSelectedOrgId` / `setSelectedOrgId` / `getSelectedProjectIds` / `setSelectedProjectIds` in [AtlasSessionManager](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts), plus the `STATE_SELECTED_PROJECTS` and `STATE_SELECTED_ORG_ID` keys in [config.ts](../../../../src/plugins/service-atlas-mongodb/config.ts#L37).
- 🔍 Atlas discovery **has never shipped**, so there is **no persisted user state to migrate** — the storage keys can simply be deleted.

💡 **Suggestion:** Remove all of the above (command registration, provider methods, session
API, storage keys, and the `enableFilterCommand` token). Keep a **minimal org lookup only if
item 3 needs it** for the "orgs present but no projects → permissions" disambiguation — that
is a read, not a filter, and can be a lightweight count check rather than a stored selection.

> **Decision (Iteration 3):** **Remove filtering entirely for now.** **Reason:** with scoped
> Service Accounts / API keys (no interactive personal login), a key already sees only what
> it's authorized for, so org/project filtering adds UI and storage that don't earn their
> keep. Revisit only if interactive sign-in (many orgs per user) ever lands.

✅ **Implemented (Iteration 3):** [a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70)
removes the Atlas project-filter QuickPick, credential-menu organization picker, selected
organization/project storage APIs and keys, root `enableFilterCommand` context token, and
filtered empty state. Organization lookup remains read-only for project descriptions and
future permissions diagnostics. **Verification:** `npm run build` passed.

---

## P2 — Polish, expectation, or feature gap

### 6. Rework credential entry as a guided webview (tell the user where to get the keys) 🗣️

**Priority:** P2 · **Status:** ✅ Implemented · **Complexity:** ~15 files · **Reviewer #2**

> 🤖 **Automatic audit note (2026-07-23): Further investigation, fixes, and targeted
> testing required — do not accept as closed yet.** The hybrid QuickPick + guided-webview
> surface was implemented, but credentials are persisted before validation, contrary to the
> recorded decision; a failed update can replace previously valid credentials. Service Account
> submission verifies token acquisition but not Atlas Admin API access. Also test panel-close
> cancellation and screen-reader announcements for validation/loading states before closure.

**Observation:** _"The sign-in QuickPick will have to be redone as a webview. It's currently
too hard for the user to know what to do — the QuickPick doesn't share enough context on
where to get the data from. It will be reworked as a webview where each step has some intro
and info on where the data is to be taken from."_

**Finding:**

- 🔍 Today entry is a bare [QuickPick](../../../../src/plugins/service-atlas-mongodb/auth/AtlasAuthQuickPick.ts#L19) → a sequence of [`showInputBox`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts#L18) prompts (public key, private key). There is nowhere to explain _where in the Atlas console_ to create/find a key, what an Access List is, or the difference between an API Key and a Service Account. The QuickPick secondary text is also in `description` (truncates) rather than `detail`.
- 🔍 The repo already has a React webview stack ([packages/vscode-ext-react-webview](../../../../packages/vscode-ext-react-webview), [src/webviews/](../../../../src/webviews)) and a tRPC messaging pattern (see the `webview-trpc-messaging` skill), so a guided form is well-supported.
- 🔍 This **subsumes the earlier P3 "move secondary text to `detail`" item** — a webview replaces that surface entirely.

💡 **Suggestion:** Build a small guided webview: step 1 chooses the method (with real
"where to get this" copy + a deep link to the Atlas console API-keys page); step 2 collects
the credential with inline help and validation. Keep the **non-secret orchestration** in the
extension host and only render the form in the webview (per Reviewer #6's "I don't want to
move everything into a webview"). This is the natural home for the **retry / update-credentials**
affordance from item 2. See [O3](#o3-credentialentry-surface-webview-vs-quickpick-item-6).
_Likely a follow-up PR, not a release blocker — confirm scope._

> **Decision (Iteration 3 — Option C):** Adopt the **hybrid approach**: the auth-method
> chooser (`promptAtlasAuthMethod`) and the manage-credentials list (`configureCredentials`)
> **remain QuickPicks** — they are simple list selections that need no extra help text.
> Only the **add/edit credential form** becomes a guided webview. This keeps the existing
> `executeAtlasAuthFlow(method, sessionManager): Promise<boolean>` contract intact so every
> caller — the discovery tree, the retry node, the wizard — works without change.
> Single-session storage is retained (multi-credential store is deferred to item 7).
> The webview opens as an **editor-tab panel** (not a modal); credentials are validated
> host-side before storage; the panel self-closes on success and resolves `true` to the
> caller, or resolves `false` when the user closes it without completing.
> **Reason:** the QuickPick method-chooser is already an appropriate surface (two options,
> no help needed); replacing it with a multi-step webview wizard would add friction without
> adding value. The form itself is where users need guidance — that is what becomes a webview.

✅ **Implemented (Iteration 3):** Seven files were created or modified:

_New files:_

- [`src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts`](../../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts) — host-side tRPC router. `RouterContext` carries a live `AtlasSessionManager` reference and a `onCredentialsStored` one-shot callback (both survive the shallow context clone in `attachTrpc`). Two mutations: `submitApiKey` (trims keys, stores for retry first via `storeApiKeyCredentialsForRetry`, validates against `AtlasApiClient.listProjects`, then calls `storeApiKeyCredentials` + `onCredentialsStored`) and `submitServiceAccount` (same pattern via `fetchServiceAccountToken`). On 401/403, `describeAtlasError` appends an Access-List/permissions hint. Telemetry records `authMethod` and `authSuccess`.
- [`src/webviews/documentdb/atlasCredentials/atlasCredentialsController.ts`](../../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsController.ts) — exports `AtlasCredentialsWebviewConfig` (JSON-safe, carries only `authMethod`) and `openAtlasCredentialsWebview(authMethod, sessionManager): Promise<boolean>`. Wraps the panel in a `Promise`; `onCredentialsStored` resolves `true` and disposes the panel on the next tick (so the mutation response reaches the webview first); `onDisposed` resolves `false`.
- [`src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx`](../../../../src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx) — React form (Fluent UI v9). Layout: title → brief intro text → collapsible `<details>` step-by-step guide (4 steps; step 2 has a nested sub-list for org creation) → documentation + console links → form fields → Connect button + spinner → permission hint. The step-by-step guide covers the full journey from sign-in through IDENTITY & ACCESS → Applications → the correct tab. Both auth methods share steps 1–3; step 4 diverges (API Keys tab vs. Service Accounts tab). Inline `MessageBar` shows validation errors without closing the form. On success the host disposes the panel — no client-side navigation needed.

_Modified files:_

- [`src/webviews/_integration/appRouter.ts`](../../../../src/webviews/_integration/appRouter.ts) — registered `atlasCredentialsRouter` as a top-level key alongside `common` and `mongoClusters`.
- [`src/webviews/_integration/WebviewRegistry.ts`](../../../../src/webviews/_integration/WebviewRegistry.ts) — registered `atlasCredentials: AtlasCredentialsView`.
- [`src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts) — rewritten: calls `sessionManager.setAuthenticating()`, opens `openAtlasCredentialsWebview('apikey', sessionManager)`, on `false` calls `cancelAuthentication()` and returns `false`; on `true` shows the success toast and returns `true`. All input-box and standalone-validation logic removed.
- [`src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountFlow.ts`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountFlow.ts) — rewritten analogously for `'serviceaccount'`.

**Verification:** `npm run l10n` (1619 keys), `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage` (2668 tests / 159 suites), and `npm run build` all passed.

> **Decision (Iteration 4, Step 3):** The Iteration 3 note above deliberately kept the auth-method
> chooser as a separate QuickPick. That is now **reversed**: the chooser became the webview's first
> step. **Reason:** with multiple credentials, the choice is no longer a one-time setup detail but
> a recurring decision that needs the "which should I use?" guidance from the POC's auth-method
> strategy (Service Account recommended and rotatable, API Key legacy and never expiring). A
> QuickPick cannot carry that guidance, and keeping the chooser inside the panel makes the whole
> add flow one guided surface whose toggle live-swaps the fields and the help text.
>
> The "store first, then validate" order is also **reversed**: the credential is now validated with
> a real discovery call **before** anything is written. **Reason:** storing first was only there to
> keep a single-session retry node alive. With per-credential records, storing an unvalidated
> secret would either create a junk credential or, worse, overwrite a working one during an update.

✅ **Implemented (Iteration 4, Step 3):** [c0c49ce6](https://github.com/microsoft/vscode-documentdb/commit/c0c49ce6)
— the webview opens on the method choice (Service Account preselected and marked recommended, API
Key labelled legacy and simplest), supports an edit mode that replaces an existing credential's
secret in place, validates before storing, keeps the panel open with the entered values on failure,
and stores nothing when cancelled.
[caa1a823](https://github.com/microsoft/vscode-documentdb/commit/caa1a823) removed the now-unused
auth-method QuickPick and the flow wrappers.

---

### 7. Multi-credential management, modeled on the Azure accounts flow 🗣️

**Priority:** P2 · **Status:** ✅ Implemented (Iteration 4) · **Complexity:** ~20 files · **Reviewer #6**

> 🤖 **Automatic audit note (2026-07-23): Keep open; implementation is still required.**
> Code inspection confirms that Atlas still uses fixed single-credential storage and a flat
> update/sign-out QuickPick. This item cannot be accepted as closed and should be revisited
> only after item 6's credential-entry contract is settled.

**Observation:** _"Redesign credential management — support multiple API keys. Replicate the
Azure 'Manage Credentials' QuickPick: see what we have, a 'Remove' option in a submenu, and
when the user picks 'Add', the webview starts. A proper manage-credentials flow like Azure,
with many accounts / API keys. This leads to an API redesign since we'd have to iterate — but
we can do it."_

**Finding:**

- 🔍 Atlas today is **single-session**: [AtlasSessionManager](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts) holds one `AtlasSession`, and [configureCredentials](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L169) shows a flat account / sign-out / exit QuickPick. There is no concept of a credential list.
- 🔍 The Azure reference is [configureAzureCredentials](../../../../src/plugins/api-shared/azure/credentialsManagement/configureAzureCredentials.ts#L94) → an `AzureWizard` of `SelectAccountStep` → `AccountTenantsStep` → `TenantActionStep` (+ `ExecuteStep`), titled "Manage Azure Accounts", supporting multiple accounts with add/remove. That structure maps cleanly onto Atlas (accounts/keys instead of Azure accounts; orgs/projects instead of tenants/subscriptions).
- 🔍 **Reuse the Kubernetes storage stack (build on what we already have).** Atlas currently persists secrets with **fixed single-slot keys** — [AtlasSessionManager](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts) calls `secretStorage.store('atlas-mongodb.apikey.publicKey', …)` etc., which structurally allows **exactly one** API key and one Service Account. Kubernetes already solved "an ordered list of credentials, each with its own secrets" on top of the shared **[StorageService](../../../../src/services/storageService.ts)** — a per-workspace item store that persists **`properties` → `globalState`** and **`secrets` → `SecretStorage`** in a single typed API. The reference wrapper is [sourceStore.ts](../../../../src/plugins/service-kubernetes/sources/sourceStore.ts): each source is a `StorageItem` with an `order` field for stable display order, an inline secret in `secrets[]`, and an in-memory cache with explicit invalidation.
- 🔍 **API-redesign impact (as the reviewer noted):** `AtlasSessionManager` becomes a store of **N** credentials (each API key / Service Account), the API client is selected per credential, and the tree must attribute each org/project/cluster to the credential that surfaced it (relevant to the org level in item 8). This is the biggest structural change of the three design items.

💡 **Suggestion:** Adopt the Azure `credentialsManagement/` wizard shape for the UI (a
"Manage MongoDB Atlas Credentials" QuickPick listing existing credentials with a per-item
**Remove** submenu and an **Add** action that launches the guided webview, item 6), and
adopt the **Kubernetes `sourceStore` + `StorageService` pattern for persistence** so we
build on the same secrets solution rather than a bespoke one:

- Model each credential as a `StorageItem` under
  `StorageService.get('atlas-mongodb-discovery')` in a `credentials` workspace — non-secret
  metadata (auth method, user-facing label, selected org) in `properties`, and the
  public/private key or client id/secret in `secrets[]` (SecretStorage-backed, exactly like
  the K8s inline-YAML secret).
- Keep an `order` field for stable list ordering and an in-memory cache, mirroring
  `sourceStore.ts`.
- **No migration needed** — Atlas discovery has never shipped, so the current single-slot
  `AtlasSessionManager` keys carry no real user data; the new store starts clean.

See [O4](#o4-multi-credential-model--api-redesign-item-7). **This supersedes the earlier
"staged Back/status wording" polish item** — that lands for free with the Azure-style flow.
_Follow-up PR; sequence after item 6._

> **Decision (Iteration 4, Steps 2 and 3):** Implemented as suggested, on both reference stacks:
> the Kubernetes `sourceStore` shape for persistence and the Azure `credentialsManagement/` wizard
> shape for the UI (`AzureWizard` prompt steps, `GoBackError` for Back, a sentinel
> `UserCancelledError` message for a graceful exit). Reusing both patterns verbatim is what keeps
> the two providers' credential flows maintainable side by side.
>
> Two deliberate deviations, both recorded here:
>
> 1. **Aggregation does not copy Azure's fan-out.** Azure's wizard uses `Promise.all`, so one
>    failing account collapses the whole list. Atlas uses `Promise.allSettled` behind a bounded
>    limiter and returns healthy data together with typed per-credential errors, because a dead
>    credential must never blank the fleet.
> 2. **Re-entering the same Atlas identity updates the existing record instead of adding a
>    duplicate.** The record ID stays stable across a secret rotation, which is what keeps tree
>    paths and saved connections valid.

✅ **Implemented (Iteration 4):** [ee2bf417](https://github.com/microsoft/vscode-documentdb/commit/ee2bf417)
(store, per-credential sessions, `listAll()` aggregation, pagination),
[c0c49ce6](https://github.com/microsoft/vscode-documentdb/commit/c0c49ce6) (Manage MongoDB Atlas
Credentials QuickPick with Add, Retry, Update, Remove, Sign out of all, Back, Exit), and
[caa1a823](https://github.com/microsoft/vscode-documentdb/commit/caa1a823) (retirement of the
single-session manager). Tests cover independent restore, token-refresh isolation, credential
removal, partial failure, pagination, duplicate/overlapping project access, stable ordering,
cancellation, and every management action.

---

### 8. Tree/List view toggle with an org level (Kubernetes-style) 🗣️

**Priority:** P2 · **Status:** ✅ Implemented (Iteration 4) · **Complexity:** ~15 files · **Reviewer #5**

> 🤖 **Automatic audit note (2026-07-23): Keep open; implementation is still required.**
> No organization tree node, flat-list mode, view-mode state, or toggle commands were added.
> This item cannot be accepted as closed and remains dependent on the org-aware
> multi-credential model in item 7.

**Observation:** _"Replicate the modes from the Kubernetes view — the user can switch between
tree and list. The tree would show orgs → projects → clusters nested; the list would show all
clusters with project and org info in the description."_

**Finding:**

- 🔍 Kubernetes implements exactly this: [config.ts](../../../../src/plugins/service-kubernetes/config.ts#L79) defines `KubernetesViewMode = 'list' | 'tree'` + a `DISCOVERY_VIEW_MODE_STATE_KEY` globalState key; [switchKubernetesViewMode.ts](../../../../src/plugins/service-kubernetes/commands/switchKubernetesViewMode.ts) provides the two commands; [KubernetesContextItem.getChildren](../../../../src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts#L168) branches on the mode; a `discoveryKubernetesViewModeTree` / `…List` contextValue marker drives an **inline toggle whose icon reflects the current mode** (package.json menus, [~L880](../../../../package.json#L880)).
- ⚠️ **Structural note:** Atlas today has **no org tree level** — the hierarchy is Project → Cluster, with org only used for filtering/labels ([AtlasProjectItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts)). Reviewer #5's "tree = orgs → projects → clusters" therefore **adds a new Org tree level**, which also interacts with multi-credential attribution (item 7).

💡 **Suggestion:** Port the K8s view-mode scaffold verbatim (config key + two commands +
contextValue marker + inline toggle). **Tree mode:** new `AtlasOrgItem` → `AtlasProjectItem`
→ `AtlasClusterItem`. **List mode:** flat `AtlasClusterItem`s with `org · project` in the
description. Sequence **after** the org-aware credential model (item 7) so the org grouping
has a stable data source. See [O5](#o5-treelist-toggle--org-level-item-8). _Feature work;
follow-up PR._

> **Decision (Iteration 4, Steps 4 and 5):** Ported as suggested, sequenced after the credential
> model exactly as recommended. Tree mode is the default because the organization level is what
> makes several credentials legible; List mode stays one click away.
>
> Deviation worth noting: the earlier idea of forcing Tree mode and disabling the List toggle on
> error was **dropped**. Because the recovery row is just another row, it drops into a flat list
> unchanged, so List mode needs no special casing and the layout never changes under the user.

✅ **Implemented (Iteration 4):** [9c8baa0f](https://github.com/microsoft/vscode-documentdb/commit/9c8baa0f)
adds the organization level and the merged tree;
[3674133d](https://github.com/microsoft/vscode-documentdb/commit/3674133d) adds the persisted
Tree/List toggle, the flat deduplicated cluster list with `organization · project` context, and the
same recovery row in both modes.

---

### 9. Wizard shows only IDLE clusters — the tree shows all ⚠️

**Priority:** P2 · **Status:** ✅ Implemented ([368a4cff](https://github.com/microsoft/vscode-documentdb/commit/368a4cff)) · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Accept as closed.** Code inspection confirms
> that all clusters appear, non-IDLE states are annotated, and selecting a non-IDLE entry
> explains the restriction before returning to the picker. This follows the UX review's
> recorded decision while allowing only `IDLE` clusters to proceed to connection.

**Observation:** A cluster visible in the discovery tree (e.g. tagged `Updating…`) is
**absent** from the Add-Connection wizard's cluster list.

**Finding:**

- ✅ The wizard now lists **all** clusters returned by Atlas, matching the discovery tree's existence model.
- ✅ Non-IDLE clusters are kept visible but marked as unavailable in the wizard, with the current state surfaced directly in the item description.
- ✅ Selecting a non-IDLE cluster no longer creates a disappearance/mismatch problem; instead the user gets an in-flow explanation and returns to the picker.
- 🔍 This keeps the safer connectability rule from item 5 intact: the wizard still only proceeds with `IDLE` clusters, but it no longer hides clusters that the tree already shows.

💡 **Suggestion:** Either show non-IDLE clusters in the wizard as **disabled/annotated**
items (so the list matches the tree and the reason is legible), or document the filter as
intentional and give the empty case a friendly in-flow message (ties into item 5).

> **Decision (Iteration 3):** Keep the wizard's **IDLE-only connectability rule**, but stop
> hiding non-IDLE clusters. Show all clusters in the picker so the wizard matches the tree,
> annotate non-IDLE entries with their state, and if the user selects one, explain that it is
> not connectable until it returns to `IDLE`. **Reason:** the problem was not that the wizard
> rejected non-IDLE clusters; the problem was that the clusters disappeared entirely, making the
> wizard contradict the tree. This keeps the lower-risk connection rule while fixing the UX
> mismatch.

✅ **Implemented (Iteration 3):** [368a4cff](https://github.com/microsoft/vscode-documentdb/commit/368a4cff)
updated [SelectAtlasSteps.ts](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts)
to align the wizard with the tree.

- Removed the `IDLE`-only filter from the cluster list builder so all Atlas clusters now appear
  in the picker.
- Added wizard-local state labels and explanations for non-IDLE cluster states.
- Annotated non-IDLE cluster items in-place instead of hiding them.
- Kept only `IDLE` clusters selectable for connection; selecting any non-IDLE cluster shows a
  modal explanation and returns the user to the picker.
- Replaced the old "no connectable clusters" dead-end with a true "no clusters in this
  project" empty state, since visible-but-unavailable clusters are now shown directly.

**Verification:** `npm run l10n`, `npm run prettier-fix`, `npm run lint`,
`npx jest --no-coverage` (2668 tests / 159 suites), and `npm run build` all passed.

---

### 10. Project node has no tooltip ⚠️

**Priority:** P2 · **Status:** ✅ Implemented · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Further remediation and testing required — do
> not accept as closed yet.** The requested tooltip exists, but Atlas-provided project and
> organization values are interpolated into Markdown without escaping. Align with the existing
> cluster-tooltip escaping and test names containing Markdown syntax before closure.
>
> ✅ **Audit note resolved (Iteration 4, Step 6):** see the escaping entry at the end of this item.

**Finding:**

- ⚠️ [AtlasProjectItem.getTreeItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts#L112) sets `label`, `description`, `iconPath` but **no `tooltip`**. The cluster tooltip is rich markdown; the project has none (iteration 1 §D flagged this; still open). Related to item 3 — longer detail belongs in a tooltip, not a truncating description.

💡 **Suggestion:** Add a grouped markdown tooltip (org name, project ID, cluster count) in
the same `---`-separated style as the cluster tooltip for cross-provider consistency.

> **Decision (Iteration 3):** Add a `MarkdownString` tooltip with project name as the heading, organization name (when available), project ID, and cluster count — matching the same style as the cluster tooltip.

✅ **Implemented (Iteration 3):** [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2) — `AtlasProjectItem` now has a private `buildTooltip()` method that returns a `vscode.MarkdownString` with project name (bold heading), org name (if present), project ID, and cluster count. `getTreeItem()` wires it in via the `tooltip` property. **Verification:** `npm run l10n` (1652 keys), `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage` (2668 tests / 159 suites), and `npm run build` all passed.

> **Decision (Iteration 4, Step 6):** The escaping gap is closed by reusing the repository-wide
> [`escapeMarkdown`](../../../../src/webviews/utils/escapeMarkdown.ts) helper rather than the
> private copy that lived inside `AtlasClusterItem`. **Deviation from the literal instruction**
> ("use the same helper as the cluster tooltip"): the cluster tooltip's private copy was deleted
> and both tooltips now call the shared helper. Reason — the shared helper escapes a strict
> superset of characters (adds `<`, `>`, `&`), keeping two tooltips on one contract removes a
> silent drift risk, and the shared helper already has its own test suite. Confidence: high.

✅ **Implemented (Iteration 4, Step 6):** [f53c0ca3](https://github.com/microsoft/vscode-documentdb/commit/f53c0ca3)
— `AtlasProjectItem.buildTooltip()` escapes project name, organization name, and project ID;
`AtlasClusterItem` drops its duplicated local helper and imports the shared one. New
`AtlasProjectItem.test.ts` covers emphasis (`**not bold**`), link-like organization names,
underscore-bearing project IDs, and asserts the tooltip stays `isTrusted = false`.

---

### 11. No reveal/expand of the Atlas root after a successful sign-in ⚠️

**Priority:** P2 · **Status:** ✅ Implemented · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Accept as closed against the documented scope.**
> Code inspection confirms that successful authentication through
> `authenticateAndFetchUserInfo()` refreshes and reveals the Atlas root with `expand: true`,
> and reveal failures are isolated and logged as planned.

**Finding:**

- ⚠️ [AtlasDiscoveryProvider](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L44) `onDidChangeSession` calls `resetNodeErrorState(rootId)` + `refresh()` but never `reveal()`/expands the root, so after sign-in the user must manually expand to see projects (Kubernetes reveals the newly-added source — iteration 1 §B/#22).

💡 **Suggestion:** After `transitionTo(Active)`, reveal + expand the Atlas root so projects
appear without a manual expand.

> **Decision (Iteration 3):** After a successful authentication in `authenticateAndFetchUserInfo()`, call a new private `revealAtlasRoot()` method that finds the root node and calls `ext.discoveryTreeView.reveal(atlasRoot, { select: false, focus: false, expand: true })`. Mirror the Kubernetes pattern from `refreshKubernetesRoot.ts`. Wrap in try/catch so a reveal failure never breaks the sign-in outcome.

✅ **Implemented (Iteration 3):** [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2) — `AtlasDiscoveryProvider` has a new private `revealAtlasRoot()` method. After a successful `executeAtlasAuthFlow` call in `authenticateAndFetchUserInfo()`, `void this.revealAtlasRoot()` is called after the tree refresh. The method resolves the Atlas root from `ext.discoveryBranchDataProvider.getChildren()` and calls `ext.discoveryTreeView.reveal()` with `expand: true`. Non-critical failures log a warning to `ext.outputChannel` and do not surface to the user. **Verification:** `npm run build` passed.

---

## P3 — Nice-to-have / cosmetic / acknowledged

### 12. Root shows no "signed in as…" identity when Active ⚠️

**Priority:** P3 · **Status:** 🚫 Closed (superseded, Iteration 4) · **Complexity:** ~5 files

> 🤖 **Automatic audit note (2026-07-23): Further investigation and targeted testing
> required — do not accept as closed yet.** The Active-state text was added, but credential
> replacement does not clear the previously stored display name. Switching API keys or moving
> from an API key to a Service Account can therefore show stale identity. Test credential
> replacement and correct the display-name lifecycle before closure.

**Finding:** [getStateDescription](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L221) only annotates `Expired` / `Authenticating`; when `Active` the description is blank even though `getUserDisplayName()` is available (iteration 1 §9.1). Gains extra value under multi-credential (item 7): the root could show _which_ credential is active.

💡 **Suggestion:** Surface the signed-in display name / org in the root description or
tooltip when Active.

> **Decision (Iteration 3):** Add an `Active` case to `getStateDescription()` that returns `"Signed in as {displayName}"` when a display name is stored, or `"Signed in"` as a fallback (covers Service Accounts for which no user-profile endpoint exists).

✅ **Implemented (Iteration 3):** [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2) — `AtlasServiceRootItem.getStateDescription()` now handles `AtlasSessionState.Active`: it returns `vscode.l10n.t('Signed in as {0}', displayName)` when `getUserDisplayName()` returns a value, or `vscode.l10n.t('Signed in')` as the fallback. Service Accounts that have no resolvable display name show the fallback gracefully. **Verification:** `npm run build` passed.

> **Decision (Iteration 4):** 🚫 **Closed as superseded.** The audit note above is exactly right
> that the display-name lifecycle was broken, and the multi-credential model resolves it by
> deleting the concept: a single global "signed in as" slot cannot describe a fleet of
> credentials, and the root description is the one place the quiet-tree design specifically wants
> to stay empty. Identity moved to where it is actionable - the Manage MongoDB Atlas Credentials
> QuickPick lists every credential with its resolved label (user label, then cached organization
> name, then a non-secret identity hint) and its live status.
>
> 🚫 **Reason:** a per-credential identity list replaces a single stale root description.
> Implemented by [caa1a823](https://github.com/microsoft/vscode-documentdb/commit/caa1a823), which
> removed the `userDisplayName` state slot together with the single-session manager.

---

### 13. Active filter state is not visible on the root 🚫

**Priority:** P3 · **Status:** 🚫 Closed

> 🤖 **Automatic audit note (2026-07-23): Accept as closed.** Item 14 removed Atlas
> filtering and its persisted state, so there is no active-filter state left to represent.
> Closing this item as superseded matches the documented decision.

**Finding:** Two independent filters existed (org via Manage Credentials, project via the
funnel), with no "filtered" badge on the root (iteration 1 §9.2).

🚫 **Closed (Iteration 3):** Superseded by **item 14** — filtering was removed in
[a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70), so there is no
filter state left to surface. **Reason:** no filtering, no filter indicator.

---

---

## Implemented

Items resolved in iterations 1–2, re-verified against the current branch (do not re-open
without cause):

- ✅ **Root renamed to "MongoDB Atlas"** — [config.ts LABEL](../../../../src/plugins/service-atlas-mongodb/config.ts#L15) + [root label](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L163).
- ✅ **Stable root identity icon** (`cloud`); transient state moved to `description` — [getStateDescription](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L221).
- ✅ **Cluster uses a static brand-mark icon**; state moved to description + tooltip (iteration 2 Finding 2-A) — [AtlasClusterItem.getTreeItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts#L213).
- ✅ **Cluster `description` trimmed to tier + state** with `·` separators (iteration 2 Finding 2-B) — [buildDescription](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts#L266).
- ✅ **Root load failures use modal + canonical "Click here to retry" node** (iteration 1 §F) — [AtlasServiceRootItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L92).
- ✅ **Auth-flow failures use modals** (not toasts) — [AtlasApiKeyFlow](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts#L59).
- ✅ **Cluster connection failure uses a modal** — [authenticateAndConnect](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts#L196).
- ✅ **Wizard pre-authenticates** (no session → auth QuickPick, clean `UserCancelledError` on cancel) — [promptSignInForWizard](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L84).
- ✅ **No destructive inline actions**; single shared `manageCredentials` entry point.

---

## Iteration log

A running record of each fix pass. Items still 🟠 Open at the end of an iteration roll into
the next one; nothing is dropped without a terminal status.

### Iteration 3 (this pass)

| #   | Item                                                                       | Decision (why)                                                                                      | Outcome                                                                                                              |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Root auto-opens auth picker on expand (🗣️ #1)                              | Remove auto-prompt; show only the sign-in node ("no magic"; the node is enough)                     | 🟠 Decided — **release blocker**                                                                                     |
| 2   | Auth failure has no retry / update-creds path (🗣️ #3)                      | Store submitted credentials, then show retry and update credentials recovery nodes                  | ✅ Implemented                                                                                                       |
| 3   | "No projects found" masks under-permissioned key (🗣️ #4)                   | Distinguish visible organizations with no visible projects; move guidance to tooltip                | ✅ Implemented                                                                                                       |
| 4   | Project-level passive error rows                                           | Remove all passive rows → error modal + single retry; detail to `ext.outputChannel`                 | 🟠 Decided — **release blocker**                                                                                     |
| 5   | Wizard raw-throw dead-ends                                                 | Azure-style always-show "Manage MongoDB Atlas Credentials…" + clean `UserCancelledError`            | ✅ Implemented in [313950f2](https://github.com/microsoft/vscode-documentdb/commit/313950f2)                         |
| 14  | Remove all filtering + storage (🗣️ live)                                   | Removed entirely; scoped keys make filtering pointless; no migration (never shipped)                | ✅ Implemented in [a7737b70](https://github.com/microsoft/vscode-documentdb/commit/a7737b70); `npm run build` passed |
| 6–8 | Design items: webview (🗣️ #2), multi-credential (🗣️ #6), tree/list (🗣️ #5) | _pending_                                                                                           | 🟡 Open (soft) — likely follow-up PRs                                                                                |
| 9   | Wizard/tree cluster mismatch                                               | Show all clusters in the wizard, annotate non-IDLE states, keep only `IDLE` connectable             | ✅ Implemented in [368a4cff](https://github.com/microsoft/vscode-documentdb/commit/368a4cff)                         |
| 10  | Project node tooltip                                                       | Add markdown tooltip (org name, project ID, cluster count) — `buildTooltip()` in `AtlasProjectItem` | ✅ Implemented in [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)                         |
| 11  | Reveal/expand root after sign-in                                           | `revealAtlasRoot()` after successful auth; mirrors K8s `revealKubernetesSource` pattern             | ✅ Implemented in [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)                         |
| 12  | "Signed in as…" root identity                                              | `Active` case in `getStateDescription()` with display name or "Signed in" fallback                  | ✅ Implemented in [41ec69f2](https://github.com/microsoft/vscode-documentdb/commit/41ec69f2)                         |
| 13  | Active filter state not visible on root                                    | #13 closed (filtering removed)                                                                      | 🚫 Closed                                                                                                            |

> 🗣️ = raised by the reviewer in the live pass. "Decided" items have an agreed direction (see
> the Decision block on each) but are not yet implemented. Items 6–8 are dependent (see
> [Sequencing](#sequencing-suggested)) and larger than a single release.

### Iteration 4.1 follow-up (2026-07-23)

| #   | Item                                                                   | Recommendation                                                                                                                                                    | Outcome                                                |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2   | Auth-recovery error-node wording                                       | Keep **Click here to retry** and rename **Update credentials** to **Click here to update credentials**, matching established actionable tree rows                 | 🟠 Open — implementation and hands-on testing required |
| 3   | Non-actionable **No projects visible to this API key** information row | Replace it with a concise modal explanation + canonical **Click here to retry** node; show the modal again only after an explicit retry still returns no projects | 🟠 Open — implementation and hands-on testing required |

---

## Open ideas — options, pros & cons

**What these are (and when they must be answered).** Each `O`-block is a **decision aid** for
one item: it lays out the realistic options with pros/cons and a 💡 **Suggested** pick. They
are _not_ extra work items and they are _not_ all gating. Two categories:

- **Already decided** — for the P1 release blockers, the choice is **made** and recorded in
  that item's **Decision** block (the `O`-table just preserves the alternatives that were
  weighed). No further sign-off needed; a contributor can start from the Decision. This covers
  **O1** (item 5 → Option A) and **O2** (items 2/3/4 → Option A).
- **Must be answered before Bundle E starts** — for the P2 follow-up redesign, the direction is
  still a _suggestion_. **O3, O4, O5** need an explicit pick **before** the corresponding
  Bundle E item is implemented — but they do **not** block Bundles A–D, which can proceed now.

| Block  | Item(s) | Bundle | Priority | Answer needed before…                    | State                          |
| ------ | ------- | ------ | -------- | ---------------------------------------- | ------------------------------ |
| **O1** | 5       | B      | P1       | already answered                         | ✅ Implemented — Option A      |
| **O2** | 2, 3, 4 | A      | P1       | already answered                         | ✅ Decided — Option A          |
| **O3** | 6       | E      | P2       | starting **Bundle E · item 6**           | 🟡 Open — 💡 suggests Option C |
| **O4** | 7       | E      | P2       | starting **Bundle E · item 7** (after 6) | 🟡 Open — 💡 suggests Option A |
| **O5** | 8       | E      | P2       | starting **Bundle E · item 8** (after 7) | 🟡 Open — 💡 suggests Option A |

> So: nothing here blocks the release-blocker bundles (A–D). Only **O3/O4/O5** need a decision,
> and only at the point Bundle E's sequenced work reaches each item.

### O1. Wizard no-session / empty-cluster recovery (item 5) · ✅ Implemented (Option A — see [item 5](#5-add-connection-wizard-steps-throw-raw-errors-that-close-the-flow-))

| Option                                                               | Pros                                                                | Cons                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. Azure style** — always-show header + clean `UserCancelledError` | Matches 3 of 4 shipped siblings; smallest change; no dead-end error | User leaves the wizard to fix state, then re-opens        |
| **B. K8s style** — inline "Sign in…" + re-prompt in the same wizard  | Smoothest UX; user never leaves the flow                            | More wiring; must re-enter the step after auth            |
| **C. Keep throw, improve message**                                   | Trivial                                                             | Still a dead-end; still closes the wizard — least aligned |

> 💡 **Suggested:** Option A for fastest parity with the Azure siblings; Option B if the
> team wants the best UX. Either beats today's raw throw (Option C).

### O2. Project-level error + retry presentation (items 2, 3, 4) · ✅ Decided (Option A — see [item 4](#4-project-level-loadauth-errors-render-as-passive-in-tree-rows-))

| Option                                                                                                  | Pros                                                                            | Cons                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **A. Full root parity** — modal + `Click here to retry` (+ optional `Click here to update credentials`) | Feature-wide consistency; directly answers Reviewer #3's retry ask; house style | Slightly more code; must reuse the error cache           |
| **B. Retry node only** (no modal)                                                                       | Quieter; still gives a way out                                                  | Diverges from the root's modal-on-load behaviour         |
| **C. Leave passive rows**                                                                               | No work                                                                         | Perpetuates the last remaining asymmetry; blocks release |

> 💡 **Suggested:** Option A — the root already proves the pattern, and a single shared
> retry/error helper covers items 2, 3, and 4 at once. Retry is the must-have (Reviewer #3:
> "simple retry is enough"); **Click here to update credentials** is the strong nice-to-have.

### O3. Credential-entry surface: webview vs QuickPick (item 6) · 🟡 Open — decide before **Bundle E · item 6**

| Option                                                                           | Pros                                                                                     | Cons                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **A. Guided webview form** (Reviewer #2)                                         | Room for "where to get the key" copy, deep links, inline validation; best onboarding     | New surface to build/maintain; must keep secrets out of the webview |
| **B. Enrich the QuickPick / input boxes**                                        | Cheap; `detail` + `prompt` + validation link can carry _some_ guidance                   | Still cramped; can't show images/steps; truncation persists         |
| **C. Hybrid** — QuickPick to choose method, webview only for the credential form | Keeps orchestration in host (Reviewer #6's constraint); webview only where it adds value | Two surfaces to reason about                                        |

> 💡 **Suggested:** Option C — matches Reviewer #6's "I don't want to move everything into a
> webview." The method chooser and manage-credentials list stay QuickPicks; only the
> add/edit credential form is a webview. Do Option B's `detail` tweak as a cheap stopgap if
> the webview slips past this release.

### O4. Multi-credential model + API redesign (item 7) · 🟡 Open — decide before **Bundle E · item 7**

| Option                                         | Pros                                                                           | Cons                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **A. Full Azure-style multi-credential store** | Matches Reviewer #6's target; parity with Azure; supports teams with many keys | Largest change; `AtlasSessionManager` → N-credential store; tree must attribute nodes to a credential |
| **B. Single credential + easy switch/replace** | Much smaller; covers "wrong key, fix it" without a list                        | No simultaneous multi-key browsing; diverges from Azure                                               |
| **C. Keep single session (today)**             | No work                                                                        | Reviewer explicitly wants multi-key; blocks the tree/list org grouping in item 8                      |

> 💡 **Suggested:** Option A as the destination, staged after item 6 (the webview is the
> "Add" surface). If the release timeline is tight, ship Option B first (replace/retry a
> single credential) and grow into A — the `AtlasSessionManager` interface change is the
> gating dependency for the org level in item 8.
>
> **Persistence — reuse, don't reinvent.** Whichever option, build the storage on the
> shared **[StorageService](../../../../src/services/storageService.ts)** the way Kubernetes
> does in [sourceStore.ts](../../../../src/plugins/service-kubernetes/sources/sourceStore.ts)
> (ordered list of `StorageItem`s; `properties` → globalState, `secrets` → SecretStorage;
> in-memory cache). No migration is required — Atlas discovery has never shipped, so the
> current single-slot [AtlasSessionManager](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts)
> keys carry no real user data and the new store starts clean. This keeps Atlas on the same
> secrets solution as the rest of the extension.

### O5. Tree/List toggle + org level (item 8) · 🟡 Open — decide before **Bundle E · item 8**

| Option                                                                        | Pros                                                           | Cons                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **A. Port the K8s scaffold + add an Org level**                               | Proven pattern; matches Reviewer #5; consistent cross-provider | Requires the new `AtlasOrgItem` level and org-aware data (item 7) |
| **B. List/Tree toggle only, no org level** (Project→Cluster tree / flat list) | Smaller; reuses today's hierarchy                              | Doesn't deliver Reviewer #5's "orgs → projects → clusters" tree   |
| **C. Defer**                                                                  | No work                                                        | Feature gap vs Kubernetes                                         |

> 💡 **Suggested:** Option A, sequenced last — it depends on the org-aware credential model
> (item 7). Reuse [switchKubernetesViewMode.ts](../../../../src/plugins/service-kubernetes/commands/switchKubernetesViewMode.ts),
> the `config.ts` mode key, and the inline contextValue toggle verbatim.

---

## Sequencing (suggested)

The three reviewer design items are dependent, not parallel:

```text
item 6 (guided webview)  ──►  item 7 (multi-credential + API)  ──►  item 8 (tree/list + org level)
  hosts add/update UI            org-aware data model feeds          org grouping needs a stable
                       the org tree level                  per-credential org source
```

The **release-blocking** P1 work (items 1–5) is independent of the above and can land first.

---

## Appendix A — current flow (reference)

See the full data-flow write-up in
[atlas-mongodb-discovery-flow.md](../../../atlas-mongodb-discovery-flow.md) and the
decision rationale in [decisions.md](./decisions.md). The two-layer auth model (Atlas Admin
API session for discovery vs. SCRAM database credentials for connection) is the key mental
model: "signed in to Atlas" (Layer 1) does **not** mean "authenticated to the database"
(Layer 2) — the user is still prompted for SCRAM credentials on cluster expand.

---

_Prepared for the MongoDB Atlas discovery (PR #733) UX review, iteration 3. Code references
verified against the `dev/tnaum/atlas-discovery-review-iteration-2` branch. No code was
modified in this pre-assessment; all items are recommendations to react to during the
hands-on pass._

---

## Open work summary and proposed order (2026-07-24)

This section reconciles the open statuses, Iteration 4.1 follow-ups, and automatic-audit
notes into one execution order. It is the current hand-off list: an item remains here until
it is implemented and verified, explicitly closed with a reason, or moved to a linked issue.

<a id="step-0--multi-credential-feasibility-poc-do-first"></a>

### Architecture decision now established

The multi-credential feasibility POC and UX design are complete. See
[multi-credential-poc-plan.md](./multi-credential-poc-plan.md) for the Atlas Admin API research,
isolated experiments, selected tree/webview design, and alternatives that were rejected.
Production work should now implement these decisions rather than repeat the feasibility phase:

- support multiple API Keys and Service Accounts in an `AtlasCredentialStore` built on the
  shared `StorageService`, with stable random credential IDs, non-secret metadata in
  `properties`, and credential material in `SecretStorage`;
- isolate session state and Service Account token refresh per credential;
- expose one non-throwing `AtlasDiscoveryService.listAll()` aggregation surface, using bounded
  parallelism and `Promise.allSettled` so one failed credential does not hide healthy results;
- key and merge organizations, projects, and clusters by Atlas resource ID while retaining the
  set of credentials that can reach each resource;
- manage credentials through an Azure-style QuickPick that opens the guided webview for add and
  update; keep credential-management rows out of the healthy tree;
- render a quiet organization → project → cluster tree and a flat cluster list, with one
  consolidated **Click here to revisit credentials** action whenever any credential fails; and
- treat a healthy `200 []` response as authoritative emptiness, not a retryable failure. The
  final multi-credential UX uses the standard `empty` placeholder under the organization.

The last point supersedes this review's provisional Iteration 4.1 recommendation to show a modal
plus **Click here to retry** for every no-projects result. Until the new tree ships, the existing
non-actionable sentence remains an open UX issue; its production replacement is the selected
`empty` placeholder, while `401`, `403`, rate-limit, and network failures use the consolidated
credential-recovery action.

#### Agent hand-off: controlling POC sections and evidence

Agents implementing this roadmap must treat the POC document as the source of truth for the
multi-credential architecture and UX. Start with these sections rather than reconstructing the
design from this review summary:

| Need                                                      | Controlling POC section                                                                                                               | Current evidence/status                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Credential scope and same-org project union               | [§3.1 — Credential scoping](./multi-credential-poc-plan.md#31-credential-scoping--the-load-bearing-fact)                              | ✅ Different-org, same-org subset/overlap/disjoint union, healthy emptiness, and Service Account scope parity live-confirmed         |
| Store, session, aggregation, labels, and token lifecycle  | [§5 — Proposed API-level design](./multi-credential-poc-plan.md#5-proposed-api-level-design)                                          | Production design selected; no production implementation yet                                                                         |
| Partial-result and error taxonomy                         | [§6 — Error reporting model](./multi-credential-poc-plan.md#6-error-reporting-model--partial-results-with-per-credential-attribution) | ✅ Healthy `200 []`, unrestricted/detail `200`, enforced non-match `403`, matching-IP `200`, and invalid-secret `401` live-confirmed |
| QuickPick, webview, tree, list, empty, and retry behavior | [§7 — Selected credential/tree UX](./multi-credential-poc-plan.md#7-credential-management--tree-ux-selected-design)                   | Selected design; archived alternatives in §7.7 are not implementation options                                                        |
| Answers to the seven original POC questions               | [§8 — POC answers](./multi-credential-poc-plan.md#8-answers-to-the-seven-poc-questions-ledger-step-0)                                 | All seven answered at design/isolated-experiment level                                                                               |
| Component ownership and data flow                         | [§9 — Reference architecture](./multi-credential-poc-plan.md#9-reference-architecture-diagram)                                        | Use as the implementation boundary map                                                                                               |
| Relative slices and decision gates                        | [§11 — Effort and gates](./multi-credential-poc-plan.md#11-effort-estimate-decision-gates--scrap-criteria)                            | Slices A–G define the intended dependency order                                                                                      |

The POC's completed experiments are evidence for architecture decisions, not production test
coverage:

| Experiment                                                                                                                                | Status                                | What an implementing agent may rely on                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Experiment 1 — aggregation semantics](./multi-credential-poc-plan.md#experiment-1--aggregation-semantics)                                | ✅ Executed in isolation              | `Promise.allSettled` preserves healthy credential results when peers fail; `Promise.all` does not                                      |
| [Experiment 2 — non-throwing aggregation](./multi-credential-poc-plan.md#experiment-2--single-list-all-api-with-per-credential-isolation) | ✅ Executed in isolation              | One aggregation surface can return organizations, projects, clusters, and credential-scoped errors together                            |
| [Experiment 3 — parallel fan-out](./multi-credential-poc-plan.md#experiment-3--parallel-vs-sequential-fan-out)                            | ✅ Executed in isolation              | Parallel fan-out produced an approximately 8× improvement for eight simulated credentials; production must still use a bounded limiter |
| [Experiment 4 — token-bucket headroom](./multi-credential-poc-plan.md#experiment-4--token-bucket-headroom)                                | ✅ Executed analytically/in isolation | Discovery request volume is far below documented limits; retain defensive `429`/`Retry-After` handling                                 |
| [Live-check matrix](./multi-credential-poc-plan.md#residual-live-matrix)                                                                  | ✅ Blocking gates complete            | Only optional Service Account L2/cluster-detail parity remains; L3 is mocked-contract-only and L4 uses production telemetry            |

The executable production tests listed in Steps 2–7 below are still required. Do not cite the
isolated experiment script as proof that storage, session restoration, webview cancellation,
tree rendering, wizard attribution, or live Atlas behavior works in the extension.

### Open work at a glance

| Order | Item(s)            | Open work                                                                                                                                                   | Why it sits here                                                                                         |
| ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1     | **#7, #8, #12**    | ✅ Live feasibility gates complete; preserved as production contract tests                                                                                  | L1/L2/L5 now confirm org/project attribution, union semantics, auth parity, and the `401`/`403` taxonomy |
| 2     | **#7, #12**        | ✅ Done — credential storage, per-credential sessions, `listAll()` aggregation ([ee2bf417](https://github.com/microsoft/vscode-documentdb/commit/ee2bf417)) | Every UI surface depends on stable credential/resource attribution and partial-result behavior           |
| 3     | **#6, #7, #12**    | ✅ Done — credential-management QuickPick and guided add/edit webview ([c0c49ce6](https://github.com/microsoft/vscode-documentdb/commit/c0c49ce6))          | Builds the production lifecycle on the new store without coupling management to the tree                 |
| 4     | **#2, #3, #7, #8** | ✅ Done — merged organization tree, empty state, consolidated recovery action ([9c8baa0f](https://github.com/microsoft/vscode-documentdb/commit/9c8baa0f))  | Requires the aggregated model and management entry point                                                 |
| 5     | **#5, #8**         | ✅ Done — List mode and credential ownership through the wizard ([3674133d](https://github.com/microsoft/vscode-documentdb/commit/3674133d))                | Reuses the merged snapshot and proves either view can connect through a valid owning credential          |
| 6     | **#10**            | ✅ Done — Atlas-provided Markdown escaped in project tooltips ([f53c0ca3](https://github.com/microsoft/vscode-documentdb/commit/f53c0ca3))                  | Independent and safe to land in parallel with steps 1–5                                                  |
| 7     | **All open items** | ✅ Automated tests and the full checklist run; ledger reconciled. **Outstanding: the hands-on UX matrix**                                                   | Verifies both auth methods, partial failures, empty results, duplicate resources, reload, and both modes |

#### Iteration 4 implementation progress

Tracked inline as the steps land. Order deviation: **Step 6 was landed first** because the plan
itself marks it as parallel-safe and it carries no dependency on the multi-credential foundation;
landing it early removes a security-relevant gap regardless of how far the larger steps get.

| Step | State                                                              | Commit                                                                                                                                                          |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | ✅ Complete                                                        | Documentation only (live gates)                                                                                                                                 |
| 2    | ✅ Complete                                                        | [ee2bf417](https://github.com/microsoft/vscode-documentdb/commit/ee2bf417)                                                                                      |
| 3    | ✅ Complete                                                        | [c0c49ce6](https://github.com/microsoft/vscode-documentdb/commit/c0c49ce6)                                                                                      |
| 4    | ✅ Complete                                                        | [9c8baa0f](https://github.com/microsoft/vscode-documentdb/commit/9c8baa0f)                                                                                      |
| 5    | ✅ Complete                                                        | [3674133d](https://github.com/microsoft/vscode-documentdb/commit/3674133d) + [caa1a823](https://github.com/microsoft/vscode-documentdb/commit/caa1a823) cleanup |
| 6    | ✅ Complete                                                        | [f53c0ca3](https://github.com/microsoft/vscode-documentdb/commit/f53c0ca3)                                                                                      |
| 7    | ✅ Automated checks complete; hands-on UX matrix still outstanding | `npm run l10n` (1672 keys), `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage` (2743 tests / 166 suites), `npm run build`                         |

**Remaining for a human:** the hands-on UX matrix in Step 7 (both auth methods, multiple
credentials in different organizations, overlapping credentials in one organization, mixed
valid/invalid credentials, retries, healthy empty results, the `401` vs `403` distinction,
extension reload, and both view modes). Everything above is covered by automated tests, which are
no substitute for a live pass.

#### Post-implementation corrections (from live use)

Found while exercising the branch against a real Atlas account. Each is a deviation from the plan
as written; the reasoning is recorded here rather than only in the commit message.

| Change                                                                                                                                                                                                                                 | Deviates from                                                                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-derive every session on explicit refresh ([612522fa](https://github.com/microsoft/vscode-documentdb/commit/612522fa))                                                                                                               | The plan only required refresh to re-attempt every credential                                                             | A Service Account access token carries the roles it was minted with and is cached for its ~1h lifetime. Dropping the snapshot but reusing the token kept reporting the old scope after the user granted a role in Atlas. Organization and project items also gained their own `refresh()` hooks, without which the generic path only re-read the cache.                                                                                                               |
| Recovery row picks its action from the error taxonomy ([a9aa1143](https://github.com/microsoft/vscode-documentdb/commit/a9aa1143))                                                                                                     | §7.3 specifies one fixed **Click here to revisit credentials** row for `401`, `403`, rate-limit **and** network failures  | One row can only offer one verb, and the fixed wording is wrong for the catastrophic cases: offline or Atlas-down fails every credential with kind `network`, and the tree told the user to re-enter secrets that are fine. `auth`/`forbidden` keep the credentials wording; `network`/`rateLimited`/`other` become a retry; mixed leads to the manager.                                                                                                              |
| Snapshot cache gets a 30s TTL ([810b44a6](https://github.com/microsoft/vscode-documentdb/commit/810b44a6))                                                                                                                             | §7.3's "passive expansion must not repeatedly call known-failing credentials" was implemented as an invalidate-only cache | Invalidate-only put the burden on every node type to remember to invalidate, and the one that forgot served a frozen tree indefinitely. The cache only ever needed to cover a single interaction burst. The TTL keeps the anti-hammering property while removing the whole class of stale-tree bug; explicit refresh still bypasses it and re-derives sessions.                                                                                                       |
| Fleet-wide **Retry all** in the credential manager ([9619d020](https://github.com/microsoft/vscode-documentdb/commit/9619d020))                                                                                                        | Step 3 lists only a per-credential **Retry**                                                                              | With several failures the list is a snapshot of the last discovery pass, so rows the user is not looking at keep showing stale outcomes. Re-checking them one at a time is tedious and gives no fleet-level answer.                                                                                                                                                                                                                                                   |
| Credential manager always refreshes Atlas on exit ([36abaf65](https://github.com/microsoft/vscode-documentdb/commit/36abaf65))                                                                                                         | The shared discovery convention (and the Azure prior art) refreshes only when credential storage changed                  | Atlas holds state the extension cannot observe. The common flow is: open the manager, switch to the Atlas web UI to grant a role, come back. Nothing in local storage changed, so the `changed` guard skipped the refresh entirely. Explicitly accepted as an Atlas-only divergence.                                                                                                                                                                                  |
| **Open in MongoDB Atlas** deep link per credential ([a3c96ac7](https://github.com/microsoft/vscode-documentdb/commit/a3c96ac7))                                                                                                        | Not in the plan at all                                                                                                    | A `403` from an enforced IP access list and a healthy `200 []` from a too-narrow role are the two failures the extension can name but not fix, and both are only resolvable in the Atlas console behind an organization picker. Service Accounts link to their own page, API keys to the organization key list, and a credential with no cached `orgId` (which is precisely the `403` case) falls back to the console root.                                           |
| `403` no longer re-mints a token; concurrent refreshes deduplicated; `allSettled` per credential ([0da09f76](https://github.com/microsoft/vscode-documentdb/commit/0da09f76))                                                          | Not in the plan; found by reading a live trace                                                                            | One retry of a forbidden credential issued four requests and minted two throwaway tokens. `403` means authenticated but not permitted, so a new token carries the same roles and cannot help; only `401` refreshes now. `refreshSession` had no in-flight dedupe, so the parallel org/project calls each minted a token. `Promise.all` also orphaned the sibling request, whose failure then logged after the result was recorded and read like a second racing pass. |
| **Add a credential** promoted above **Retry all** ([60f8cfae](https://github.com/microsoft/vscode-documentdb/commit/60f8cfae))                                                                                                         | Step 3 lists the actions without an order                                                                                 | The credential manager is the everyday way to widen what discovery can see, not only a recovery surface, so the primary action reads first and now carries the same explanatory detail as its peers.                                                                                                                                                                                                                                                                  |
| TLS connection failures get their own modal, deliberately without a diagnosis ([45626dc9](https://github.com/microsoft/vscode-documentdb/commit/45626dc9), [5eec3dea](https://github.com/microsoft/vscode-documentdb/commit/5eec3dea)) | Not in the plan                                                                                                           | A raw OpenSSL `SSL alert number 80` was shown under "Revisit connection details", which is misleading straight after the user typed credentials. The first attempt over-corrected by naming the IP access list as the cause; MongoDB documents that the list gates cluster connections but never that a blocked address surfaces as this alert, so the wording was pulled back to what the signature actually proves plus a list of things to check.                  |
| Full API error envelope traced, with rate-limit headers ([0a07b4da](https://github.com/microsoft/vscode-documentdb/commit/0a07b4da))                                                                                                   | Not in the plan                                                                                                           | `errorCode` was parsed away entirely, and it is the only stable machine-readable field: it separates `IP_ADDRESS_NOT_ON_ACCESS_LIST` from any other `403`, and throttling from a genuine refusal. It is now traced and carried on `AtlasApiError`. Failed responses also trace `retry-after`, `x-ratelimit-*` and the request id.                                                                                                                                     |
| Logged durations moved to the monotonic clock ([1789949c](https://github.com/microsoft/vscode-documentdb/commit/1789949c))                                                                                                             | Not in the plan; found by reading a live trace                                                                            | A wall-clock step backwards mid-request produced lines like `GET /orgs -> 200 in -157ms`. An impossible value in a diagnostic log discredits every other number on the line. The snapshot TTL moved too, and that was a real bug: a negative `age` satisfies `age < TTL`, so a stale snapshot could be served indefinitely. Token `expiresAt` stays on the wall clock because it is persisted across processes.                                                       |

**Follow-up filed:** [#814](https://github.com/microsoft/vscode-documentdb/issues/814) tracks using the
Admin API access-list endpoints to turn these diagnostics into precise, actionable messages.

##### Field note: the intermittent `403` was a rotating egress address

Worth recording, because the log looked like an Atlas bug and was not. A credential intermittently
returned `403 IP_ADDRESS_NOT_ON_ACCESS_LIST` naming a fixed address, while a sibling credential
succeeded in the same pass, seconds apart. Three documented behaviours combined to make this
opaque:

1. The API access list is **per credential** and all-or-nothing, so one credential can be refused
   while another works from the same machine at the same moment.
2. It is enforced when a Service Account token is **used**, not when it is minted, so the log shows
   a successful mint followed immediately by `403` on every call with that token.
3. Atlas only reports the observed address when it rejects you, so successful requests give no
   evidence about which address they left from.

The machine's egress address was in fact rotating within a corporate NAT pool. The clock step that
exposed the negative-duration bug turned out to be a side effect of the same network transition
that changed the address. **Resolved by allowlisting the whole CIDR block rather than a single
address**, after which the behaviour was stable. No extension change was needed.

### Step 1 — Live API gates closed

The POC established feasibility, selected the architecture, and completed the blocking checks in
[§10.2 — live Atlas experiments](./multi-credential-poc-plan.md#102-experiments-requiring-a-live-atlas-account):

1. **L1 passed:** different-org attribution, same-org subset/overlap/disjoint union, healthy
   no-project scope, organization/project/cluster detail retrieval, and Service Account scope
   parity behaved as designed.
2. **L2 passed:** an empty non-required list allowed list/detail requests; enabling enforcement
   with a non-matching IP produced `403`; allowing the caller restored `200`; and an invalid
   private key produced `401`.

L5's overlap and disjoint-union paths were covered by the same L1 runs. L3 will not be run live;
implement the API pagination contract with mocked multi-page tests. L4 is telemetry-deferred: add
privacy-reviewed production telemetry for Service Account token-mint throttling/failure
classification and use observed frequency to decide whether further mitigation is needed.

The exact sanitized evidence and residual optional Service Account enforcement/cluster-detail
checks are maintained in the [POC live matrix](./multi-credential-poc-plan.md#residual-live-matrix).
No remaining live check blocks Step 2.

**Blocking open questions: none.** The remaining pagination tests, production telemetry,
Service Account parity checks, and hands-on UX matrix are implementation or acceptance work,
not prerequisites for starting the multi-credential foundation.

### Step 2 — Build the multi-credential foundation (#7, #12)

Land the POC's
[slices A–C](./multi-credential-poc-plan.md#111-effort-relative) before adding production UI:

1. Add `AtlasCredentialStore` on `StorageService`, with one stable random ID per credential,
   versioned non-secret metadata, independent secret slots, stable ordering, and cache
   invalidation.
2. Refactor session and API-client ownership so authentication method, Service Account token,
   expiry, refresh, and failure state are isolated per credential. Remove the global display-name
   slot in favor of user label → cached org name → public-key/client-ID prefix fallback.
3. Add `AtlasDiscoveryService.listAll()` with cancellation, pagination, bounded concurrency, and
   `Promise.allSettled`. Return healthy data and typed credential/project errors together; never
   discard the fleet because one credential failed.
4. Merge resources by `orgId`, `projectId`, and `clusterId`, retaining all healthy owning
   credential IDs and choosing a healthy owner for subsequent requests.

Focused tests must cover independent restore, token refresh, credential removal, partial failure,
pagination, duplicate/overlapping project access, stable ordering, and cancellation. This step is
complete only when the existing single-credential path can run on the new foundation without a UX
regression.

### Step 3 — Implement credential management and lifecycle (#6, #7, #12)

Build the [selected credential-management flow](./multi-credential-poc-plan.md#72-credential-management-wizard-quickpick--webview--paths--flows)
on the new store:

- add a **Manage MongoDB Atlas Credentials** QuickPick with credential status, Add, Retry,
  Update, Remove, Sign out of all, Back, and Exit actions;
- make the item-#6 webview the add/edit surface, with the auth-method choice first, Service
  Account recommended, and API Key retained as the legacy/simple option;
- validate with a real Admin API discovery operation before storing or replacing credentials;
- keep the webview open with inline errors after failed validation and retain entered values for
  correction;
- replace a working secret only after the new credential validates; cancellation or webview
  disposal stores nothing and cancels in-flight validation; and
- announce validation progress and inline errors accessibly.

Close #6 and #12 only after add, update, removal, cancellation, denied access, secret expiry,
auth-method replacement, and extension-reload paths are tested. Removing one credential must not
delete another credential's secrets or healthy tree data.

### Step 4 — Build the merged organization tree and recovery UX (#2, #3, #7, #8)

Render the [selected quiet tree](./multi-credential-poc-plan.md#73-tree-mode--the-quiet-tree)
from the aggregated snapshot:

- healthy path: organization → project → cluster, with duplicate resources merged by Atlas ID;
- show cluster state only when it is not `IDLE`;
- healthy `200 []`: show the standard `empty` placeholder under the organization, with the
  permissions explanation in its tooltip and no retry suggestion;
- any `401`, `403`, rate-limit, or network failure: keep all healthy data visible and add one
  top-level **Click here to revisit credentials** action whose tooltip summarizes affected
  credentials and whose command opens the management QuickPick; and
- when one of several credentials for an organization fails, keep merged healthy projects and
  mark the organization with a warning icon; do not create bare information rows or modal storms.

Passive expansion must not repeatedly call known-failing credentials. Explicit tree refresh
retries all credentials; Retry in the management flow retries only the selected credential. If
the implementation is split across PRs and the old single-session recovery rows remain
temporarily, #2's interim labels stay **Click here to retry** and **Click here to update
credentials** until the consolidated action replaces them.

### Step 5 — Add List mode and complete wizard attribution (#5, #8)

Add the item-#8 [List mode](./multi-credential-poc-plan.md#74-list-mode--same-error-node-no-switch)
only after the merged snapshot powers Tree mode:

- List mode renders deduplicated clusters with `organization · project` context and the same
  consolidated recovery action; failures never force a view-mode switch;
- persist the selected mode using the established view-state pattern; and
- update the add-connection wizard to consume the aggregation service, deduplicate clusters,
  carry a healthy owning `credentialId` through selection and connection creation, and preserve
  the recovery action when project or cluster loading fails.

Never report **Credential management completed** when authentication was cancelled or returned
`false`. Test the same resource visible through multiple credentials, mixed healthy/failed
credentials, switching modes during partial failure, and connection creation after an owning
credential is updated or removed.

### Step 6 — Close the independent tooltip safety gap (#10)

Escape project name, organization name, and project ID before appending them as Markdown, using
the same helper/contract as the cluster tooltip. Add focused tests with Markdown punctuation and
link-like names. This work may proceed in parallel with any production step above.

### Step 7 — Final verification and ledger reconciliation

Add focused tests for each contract above, then run the full localization, formatting, lint,
test, and build checklist. Complete a hands-on pass covering both auth methods, multiple
credentials in different organizations, overlapping credentials in one organization, mixed
valid/invalid credentials, retries, healthy empty results, `401`/`403` distinction, root identity,
extension reload, and both view modes. Update every affected item with its decision reason,
implementation commit, verification evidence, and terminal status; remove nothing from this
summary without one of those outcomes.
