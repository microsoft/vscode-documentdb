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

| #   | Priority | Item                                                                           | ≈ Files | Reviewer? | Status         |
| --- | -------- | ------------------------------------------------------------------------------ | ------- | --------- | -------------- |
| 1   | **P1**   | Root auto-opens the auth picker on expand — should just show the sign-in node  | ~5      | 🗣️ #1     | 🟠 Open        |
| 2   | **P1**   | Auth failure / bad key has no retry or "update credentials" path               | ~5      | 🗣️ #3     | 🟠 Open        |
| 3   | **P1**   | Under-permissioned key mis-reported as "No projects found" (+ unreadable desc) | ~5      | 🗣️ #4     | 🟠 Open        |
| 4   | **P1**   | Project-level failures are passive rows (root uses modal + retry)              | ~5      | —         | 🟠 Open        |
| 5   | **P1**   | Wizard steps throw raw errors → close the flow (no in-flow recovery)           | ~5      | (🗣️ #3)   | 🟠 Open        |
| 14  | **P1**   | Remove all filtering (org + project) and its storage — release cleanup         | ~10     | 🗣️ live   | 🟠 Open        |
| 6   | **P2**   | Rework credential entry as a guided webview (where to get keys)                | ~15     | 🗣️ #2     | 🟡 Open (soft) |
| 7   | **P2**   | Multi-credential management like the Azure accounts flow (add/remove)          | ~20     | 🗣️ #6     | 🟡 Open (soft) |
| 8   | **P2**   | Tree/List view toggle + org level (Kubernetes-style)                           | ~15     | 🗣️ #5     | 🟡 Open (soft) |
| 9   | **P2**   | Wizard hides non-IDLE clusters the tree shows (tree/wizard mismatch)           | ~5      | —         | 🟠 Open        |
| 10  | **P2**   | Project node has no tooltip                                                    | ~5      | —         | 🟠 Open        |
| 11  | **P2**   | No reveal/expand of the Atlas root after a successful sign-in                  | ~5      | —         | 🟠 Open        |
| 12  | **P3**   | Root shows no "signed in as…" identity when Active                             | ~5      | —         | 🟠 Open        |
| 13  | **P3**   | ~~Active-filter state not visible on the root~~ — superseded by #14            | —       | —         | 🚫 Closed      |

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

| Bundle | Theme                         | Priority | Items (in order) | \u2248 Files (sum) | Parallelizable with    |
| ------ | ----------------------------- | -------- | ---------------- | ------------------ | ---------------------- |
| **A**  | Sign-in & error surfacing     | P1       | 1 → 4 → {2 ‖ 3}  | ~20                | **B, C, D**            |
| **B**  | Add-Connection wizard         | P1       | 5 → 9            | ~10                | **A, C, D**            |
| **C**  | Filtering removal             | P1       | 14               | ~10                | **A, B, D** (do early) |
| **D**  | Tree/root presentation polish | P2–P3    | 10 ‖ 11 ‖ 12     | ~15                | **A, B, C**            |
| **E**  | Credential & view redesign    | P2       | 6 → 7 → 8        | ~50                | after **C** (& **A**)  |

> Legend for the ordering column: `→` = must be done in sequence; `‖` = order does not matter
> (safe to parallelize); `{ }` = a parallel group. So Bundle A is _1, then 4, then 2 and 3 in
> parallel_; Bundle D is _all three in any order / in parallel_.

### Bundle A — Sign-in & error surfacing (root + project) · **P1 · do first**

The first-run authentication cluster: one sign-in node, one retry story, consistent error
surfacing. All live in `AtlasServiceRootItem` / `AtlasProjectItem` / the auth flow.

| Order | Item                                                                      | Touches                                                       | \u2248 Files | Parallel within bundle?                                  |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| 1     | **Item 1** — remove auto-prompt; expand shows only the sign-in node       | `AtlasServiceRootItem` (+ delete `consumeSuppressAutoPrompt`) | ~5           | **Do first** — establishes the single sign-in entry      |
| 2     | **Item 4** — project errors → modal + single retry node; detail to output | `AtlasProjectItem`, shared `showLoadFailure` helper           | ~5           | After 1 — **defines the shared modal+retry helper**      |
| 3a    | **Item 2** — retry / "update credentials" after an auth failure           | `AtlasServiceRootItem`, `AtlasApiKeyFlow`                     | ~5           | After 4 — **‖ parallel with 3b** (both reuse the helper) |
| 3b    | **Item 3** — disambiguate "No projects found" (permissions vs. empty)     | `AtlasServiceRootItem.fetchProjectItems`, tooltip             | ~5           | After 4 — **‖ parallel with 3a**                         |

> Sequence: 1 establishes the single sign-in entry, 4 defines the shared modal+retry helper,
> then 2 and 3 reuse that helper for the auth-failure and empty-state cases **in parallel**.

### Bundle B — Add-Connection wizard · **P1**

Both items live in `SelectAtlasSteps` / `getDiscoveryWizard`.

| Order | Item                                                                                             | Touches                                       | \u2248 Files | Parallel within bundle?                                                  |
| ----- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| 1     | **Item 5** — raw throws → Azure-style "Manage MongoDB Atlas Credentials…" + `UserCancelledError` | `SelectAtlasSteps`, `getDiscoveryWizard`      | ~5           | Do first                                                                 |
| 2     | **Item 9** — reconcile the IDLE-only cluster filter to match the tree                            | `SelectAtlasSteps` (`SelectAtlasClusterStep`) | ~5           | No hard dependency on 5, but **same file** — sequence to avoid conflicts |

### Bundle C — Filtering removal · **P1 · independent, do early**

| Order | Item                                                                      | Touches                                                                                              | \u2248 Files | Parallel within bundle?                          |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------ |
| 1     | **Item 14** — remove all org/project filtering + storage (**closes #13**) | `AtlasDiscoveryProvider`, `AtlasServiceRootItem`, `AtlasSessionManager`, `config.ts`, `package.json` | ~10          | Single item; independent of A/B — **land early** |

> Independent of A/B and worth landing early: it deletes code that the credential/view
> redesign (Bundle E) would otherwise have to carry forward.

### Bundle D — Tree/root presentation polish · **P2–P3 · quick wins**

Small, independent touches to the tree items and root description. **All three touch different
files — order does not matter and they can be done in parallel.**

| Order | Item                                                            | Touches                                    | \u2248 Files | Parallel within bundle?               |
| ----- | --------------------------------------------------------------- | ------------------------------------------ | ------------ | ------------------------------------- |
| ‖     | **Item 10** — add a project-node tooltip                        | `AtlasProjectItem.getTreeItem`             | ~5           | **Fully parallel** — independent file |
| ‖     | **Item 11** — reveal/expand the root after a successful sign-in | `AtlasDiscoveryProvider`                   | ~5           | **Fully parallel** — independent file |
| ‖     | **Item 12** — show the signed-in identity in the root (P3)      | `AtlasServiceRootItem.getStateDescription` | ~5           | **Fully parallel** — independent file |

### Bundle E — Credential & view redesign · **P2 · sequenced follow-up PRs**

The three larger reviewer design directions; **strictly sequential** because each depends on
the previous (see [Sequencing](#sequencing-suggested)).

| Order | Item                                                                            | Touches                                                                                                 | \u2248 Files | Parallel within bundle?                        |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| 1     | **Item 6** — guided webview for credential entry (hosts "Add" / "Update creds") | new webview (React + tRPC router + controller), `AtlasApiKeyFlow`                                       | ~15          | **Strictly sequential** — do first             |
| 2     | **Item 7** — multi-credential management on the shared `StorageService`         | `AtlasSessionManager` → N-credential store, `configureCredentials` wizard, API client, tree attribution | ~20          | After 6 — the webview is the "Add" surface     |
| 3     | **Item 8** — Tree/List view toggle + org level                                  | new `AtlasOrgItem`, `config.ts`, 2 commands, `package.json`, `AtlasProjectItem`/`AtlasClusterItem`      | ~15          | After 7 — needs the org-aware credential model |

> Bundle E benefits from Bundle C landing first (fewer filter surfaces to migrate) and from
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
> is a decided scope-reduction cleanup (remove filtering).

### 1. Root auto-opens the auth picker on expand — should just show the sign-in node ⚠️ 🗣️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~5 files · **Reviewer #1**

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

---

### 2. Auth failure / bad key has no retry or "update credentials" path ⚠️ 🗣️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~5 files · **Reviewer #3**

**Observation:** _"When auth fails (I tried the API key path), it just fails and I have no
retry / update-creds path — I had to restart the wizard. A retry node and an 'update
credentials' node would be better. Retry, because maybe the user will change permissions or
IP filters on the cluster. Simple retry is enough."_

**Finding:**

- ⚠️ [executeApiKeyFlow](../../../../src/plugins/service-atlas-mongodb/auth/AtlasApiKeyFlow.ts#L59) shows a modal on rejection and `return false`. Back in [AtlasServiceRootItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L51), a failed `promptAuthentication()` renders the generic **sign-in** node — there is **no dedicated "retry" affordance** that re-runs the _same_ credentials, and no "update credentials" node to correct a typo without starting over.
- 🔍 The root already has a canonical `Click here to retry` node ([createRetryNode](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L192)) for _load_ failures — but the **auth-flow failure** path doesn't reuse it.
- 🔍 Reviewer's rationale matters: an auth failure is frequently **transient/fixable outside the extension** (add the key to the project, allow the current IP in the Access List — the API-key modal already hints at this). A one-click retry lets the user fix Atlas-side and re-list without re-typing.

💡 **Suggestion:** After an auth-flow failure, return the existing **`Click here to retry`**
node (re-attempts with the stored key) **plus** an **"Update credentials"** node (re-opens
the entry flow). "Simple retry is enough" per the reviewer, so retry is the must-have;
update-credentials is the strong-nice-to-have. This lands even better once entry is a
webview (item 6). **Merges with item 4** (unify the retry/error presentation across root +
project).

---

### 3. Under-permissioned key mis-reported as "No projects found" (+ unreadable description) ⚠️ 🗣️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~5 files · **Reviewer #4**

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
Optionally offer an "Update credentials" affordance here too (ties to item 2). **Merges
with item 4** as part of the project/empty-state presentation pass.

---

### 4. Project-level load/auth errors render as passive in-tree rows ⚠️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~5 files

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

---

### 5. Add-Connection wizard steps throw raw errors that close the flow ⚠️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~5 files

**Observation:** Start the Add-Connection wizard with a dropped session, or pick a project
whose clusters are all mid-provision — the wizard **closes with a raw error** instead of
keeping you in flow. (Reviewer #3's "I had to restart the wizard" pain shows up here too.)

**Finding:**

- ⚠️ [SelectAtlasProjectStep.prompt](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts#L23) throws `new Error('Atlas session not available')` when the session is missing.
- ⚠️ [SelectAtlasClusterStep.prompt](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts#L59) throws the same, plus `'No active clusters found in project "{0}"'` when the IDLE filter yields nothing.
- 🔍 `getDiscoveryWizard` now pre-authenticates via [promptSignInForWizard](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L84), so the _session_ throw is unlikely on the happy path — but the **no-IDLE-clusters** throw is reachable whenever a project's clusters are all `CREATING`/`UPDATING`. A raw `throw` surfaces as a generic error and ends the wizard, unlike the Azure siblings' clean `UserCancelledError` + always-show header.

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

---

### 14. Remove all filtering (org + project) and its storage — release cleanup ⚠️ 🗣️

**Priority:** P1 · **Status:** 🟠 Open · **Complexity:** ~10 files · **Reviewer (live pass)**

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

---

## P2 — Polish, expectation, or feature gap

### 6. Rework credential entry as a guided webview (tell the user where to get the keys) 🗣️

**Priority:** P2 · **Status:** 🟡 Open (soft) · **Complexity:** ~15 files · **Reviewer #2**

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

---

### 7. Multi-credential management, modeled on the Azure accounts flow 🗣️

**Priority:** P2 · **Status:** 🟡 Open (soft) · **Complexity:** ~20 files · **Reviewer #6**

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

---

### 8. Tree/List view toggle with an org level (Kubernetes-style) 🗣️

**Priority:** P2 · **Status:** 🟡 Open (soft) · **Complexity:** ~15 files · **Reviewer #5**

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

---

### 9. Wizard shows only IDLE clusters — the tree shows all ⚠️

**Priority:** P2 · **Status:** 🟠 Open · **Complexity:** ~5 files

**Observation:** A cluster visible in the discovery tree (e.g. tagged `Updating…`) is
**absent** from the Add-Connection wizard's cluster list.

**Finding:**

- ⚠️ [SelectAtlasClusterStep](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts#L72) filters `clusters.filter((c) => c.stateName === 'IDLE')`, while [AtlasProjectItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts#L64) lists **all** clusters (annotating state in the description). The two surfaces disagree about which clusters exist. (Also feeds the raw-throw dead-end in item 5.)

💡 **Suggestion:** Either show non-IDLE clusters in the wizard as **disabled/annotated**
items (so the list matches the tree and the reason is legible), or document the filter as
intentional and give the empty case a friendly in-flow message (ties into item 5).

---

### 10. Project node has no tooltip ⚠️

**Priority:** P2 · **Status:** 🟠 Open · **Complexity:** ~5 files

**Finding:**

- ⚠️ [AtlasProjectItem.getTreeItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts#L112) sets `label`, `description`, `iconPath` but **no `tooltip`**. The cluster tooltip is rich markdown; the project has none (iteration 1 §D flagged this; still open). Related to item 3 — longer detail belongs in a tooltip, not a truncating description.

💡 **Suggestion:** Add a grouped markdown tooltip (org name, project ID, cluster count) in
the same `---`-separated style as the cluster tooltip for cross-provider consistency.

---

### 11. No reveal/expand of the Atlas root after a successful sign-in ⚠️

**Priority:** P2 · **Status:** 🟠 Open · **Complexity:** ~5 files

**Finding:**

- ⚠️ [AtlasDiscoveryProvider](../../../../src/plugins/service-atlas-mongodb/AtlasDiscoveryProvider.ts#L44) `onDidChangeSession` calls `resetNodeErrorState(rootId)` + `refresh()` but never `reveal()`/expands the root, so after sign-in the user must manually expand to see projects (Kubernetes reveals the newly-added source — iteration 1 §B/#22).

💡 **Suggestion:** After `transitionTo(Active)`, reveal + expand the Atlas root so projects
appear without a manual expand.

---

## P3 — Nice-to-have / cosmetic / acknowledged

### 12. Root shows no "signed in as…" identity when Active ⚠️

**Priority:** P3 · **Status:** 🟠 Open · **Complexity:** ~5 files

**Finding:** [getStateDescription](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L221) only annotates `Expired` / `Authenticating`; when `Active` the description is blank even though `getUserDisplayName()` is available (iteration 1 §9.1). Gains extra value under multi-credential (item 7): the root could show _which_ credential is active.

💡 **Suggestion:** Surface the signed-in display name / org in the root description or
tooltip when Active.

---

### 13. Active filter state is not visible on the root 🚫

**Priority:** P3 · **Status:** 🚫 Closed

**Finding:** Two independent filters existed (org via Manage Credentials, project via the
funnel), with no "filtered" badge on the root (iteration 1 §9.2).

🚫 **Closed (Iteration 3):** Superseded by **item 14** — filtering is being removed entirely,
so there is no filter state left to surface. **Reason:** no filtering, no filter indicator.

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

| #    | Item                                                                       | Decision (why)                                                                           | Outcome                               |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| 1    | Root auto-opens auth picker on expand (🗣️ #1)                              | Remove auto-prompt; show only the sign-in node ("no magic"; the node is enough)          | 🟠 Decided — **release blocker**      |
| 2    | Auth failure has no retry / update-creds path (🗣️ #3)                      | _pending_                                                                                | 🟠 Open — **release blocker**         |
| 3    | "No projects found" masks under-permissioned key (🗣️ #4)                   | _pending_                                                                                | 🟠 Open — **release blocker**         |
| 4    | Project-level passive error rows                                           | Remove all passive rows → error modal + single retry; detail to `ext.outputChannel`      | 🟠 Decided — **release blocker**      |
| 5    | Wizard raw-throw dead-ends                                                 | Azure-style always-show "Manage MongoDB Atlas Credentials…" + clean `UserCancelledError` | 🟠 Decided — **release blocker**      |
| 14   | Remove all filtering + storage (🗣️ live)                                   | Remove entirely; scoped keys make filtering pointless; no migration (never shipped)      | 🟠 Decided — **release blocker**      |
| 6–8  | Design items: webview (🗣️ #2), multi-credential (🗣️ #6), tree/list (🗣️ #5) | _pending_                                                                                | 🟡 Open (soft) — likely follow-up PRs |
| 9–13 | Polish items                                                               | #13 closed (filtering removed); rest pending                                             | 🟠 Open / 🚫 Closed                   |

> 🗣️ = raised by the reviewer in the live pass. "Decided" items have an agreed direction (see
> the Decision block on each) but are not yet implemented. Items 6–8 are dependent (see
> [Sequencing](#sequencing-suggested)) and larger than a single release.

---

## Open ideas — options, pros & cons

### O1. Wizard no-session / empty-cluster recovery (item 5)

| Option                                                               | Pros                                                                | Cons                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| **A. Azure style** — always-show header + clean `UserCancelledError` | Matches 3 of 4 shipped siblings; smallest change; no dead-end error | User leaves the wizard to fix state, then re-opens        |
| **B. K8s style** — inline "Sign in…" + re-prompt in the same wizard  | Smoothest UX; user never leaves the flow                            | More wiring; must re-enter the step after auth            |
| **C. Keep throw, improve message**                                   | Trivial                                                             | Still a dead-end; still closes the wizard — least aligned |

> 💡 **Suggested:** Option A for fastest parity with the Azure siblings; Option B if the
> team wants the best UX. Either beats today's raw throw (Option C).

### O2. Project-level error + retry presentation (items 2, 3, 4)

| Option                                                                                    | Pros                                                                            | Cons                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **A. Full root parity** — modal + `Click here to retry` (+ optional "Update credentials") | Feature-wide consistency; directly answers Reviewer #3's retry ask; house style | Slightly more code; must reuse the error cache           |
| **B. Retry node only** (no modal)                                                         | Quieter; still gives a way out                                                  | Diverges from the root's modal-on-load behaviour         |
| **C. Leave passive rows**                                                                 | No work                                                                         | Perpetuates the last remaining asymmetry; blocks release |

> 💡 **Suggested:** Option A — the root already proves the pattern, and a single shared
> retry/error helper covers items 2, 3, and 4 at once. Retry is the must-have (Reviewer #3:
> "simple retry is enough"); "Update credentials" is the strong nice-to-have.

### O3. Credential-entry surface: webview vs QuickPick (item 6)

| Option                                                                           | Pros                                                                                     | Cons                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **A. Guided webview form** (Reviewer #2)                                         | Room for "where to get the key" copy, deep links, inline validation; best onboarding     | New surface to build/maintain; must keep secrets out of the webview |
| **B. Enrich the QuickPick / input boxes**                                        | Cheap; `detail` + `prompt` + validation link can carry _some_ guidance                   | Still cramped; can't show images/steps; truncation persists         |
| **C. Hybrid** — QuickPick to choose method, webview only for the credential form | Keeps orchestration in host (Reviewer #6's constraint); webview only where it adds value | Two surfaces to reason about                                        |

> 💡 **Suggested:** Option C — matches Reviewer #6's "I don't want to move everything into a
> webview." The method chooser and manage-credentials list stay QuickPicks; only the
> add/edit credential form is a webview. Do Option B's `detail` tweak as a cheap stopgap if
> the webview slips past this release.

### O4. Multi-credential model + API redesign (item 7)

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

### O5. Tree/List toggle + org level (item 8)

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
   also hosts the "Add"          org-aware data model feeds          org grouping needs a stable
   and "Update credentials"      the org tree level                  per-credential org source
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
