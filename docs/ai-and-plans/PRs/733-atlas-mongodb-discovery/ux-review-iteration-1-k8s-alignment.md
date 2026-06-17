# PR #733 — Atlas MongoDB Discovery: UX Review (Iteration 1) — Alignment with the Kubernetes + Azure Discovery Conventions

**Branch:** `dev/bchoudhury/atlas-mongodb-discovery`
**Plugin path:** `src/plugins/service-atlas-mongodb/`
**Reviewer focus (this iteration):** user experience / UX only — not architecture, security, or correctness.
**Date:** 2026-06-17

---

## 0. What this document is

The Atlas MongoDB discovery provider is the fourth service-discovery plugin in the
extension (after the three Azure plugins and the recently-finalized Kubernetes plugin).
The Kubernetes plugin went through a long, deliberate UX pass documented in
[bugbash-090-kubernetes-ux-review.md](https://github.com/microsoft/vscode-documentdb/blob/main/docs/ai-and-plans/PRs/621-kubernetes-discovery/bugbash-090-kubernetes-ux-review.md)
(30 bug-bash issues + 14 iterations). That pack is the closest, most current statement
of the team's discovery-tree UX conventions.

This review walks every decision in the Kubernetes pack and asks one question: **does it
apply to Atlas, and how much effort would it take to align?** It deliberately ignores the
Kubernetes-only items (port-forward tunnels, kubeconfig sources, namespaces) and focuses
on the conventions that generalize: empty states, error surfacing, retry affordances,
tooltips, labels, icons, and wizard dead-ends.

The Kubernetes pack itself notes that some of its 30 items were bug-bash artifacts that
don't generalize; those are marked **N/A** below and not analyzed in depth.

**Expanded in this revision (Azure family).** The original draft compared Atlas only against
the Kubernetes pack. This revision adds a code-level analysis of the **three shipped Azure
discovery plugins** — `service-azure-mongo-vcore`, `service-azure-mongo-ru`, and
`service-azure-vm` — plus their high-level user-manual pages
([Service Discovery overview](../../../user-manual/service-discovery.md),
[Managing Azure Discovery](../../../user-manual/managing-azure-discovery.md), and the three
per-provider pages). The headline result: **Kubernetes and the three Azure plugins
independently converged on the same conventions** (modal-on-load + a canonical "Click here to
retry" node; an always-present "Manage Accounts…/Sign in…" item in the subscription picker;
stable provider-identity icons; no destructive inline actions). So the recommendations below
are **not Kubernetes-specific preferences — they are the established house style across every
discovery provider that ships today**, and Atlas is the lone outlier on a handful of them.
Where Azure and Kubernetes genuinely _differ_, this revision presents both as **options to
choose from** rather than a single prescription (see §4.3).

> Scope note: This is a research + recommendation document. **No code was changed.** Every
> recommendation is a suggestion for the author/reviewer to react to.

---

## 1. Executive summary

The Atlas plugin is in good shape and already follows several conventions the Kubernetes
plugin had to learn the hard way (no destructive inline trash icons; neutral `info`-icon
empty states; a single shared `manageCredentials` command entry point; `ClusterItemBase`
inheritance so the cluster node is a first-class cluster). The gaps are concentrated in
**three areas**, in priority order:

| Priority | Theme                                                        | Applicability | Effort  | One-line summary                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------ | ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**   | Error surfacing & retry affordance (§F)                      | **Strong**    | Medium  | Atlas surfaces auth/load failures as _passive in-tree error rows_ — the exact pattern Kubernetes deliberately removed. Move to **modal-on-load + a canonical "Click here to retry" first-child node**, reusing the inherited error-node cache to avoid modal spam.               |
| **P1**   | Wizard dead-end with no session (§B/#12)                     | **Strong**    | Medium  | `SelectAtlasProjectStep` throws `'Atlas session not available'` and closes the wizard when the user isn't signed in. Kubernetes keeps the user in flow with an always-present "Add a kubeconfig source…" item. Atlas should prepend an inline "Sign in to MongoDB Atlas…" entry. |
| **P2**   | Product-name & wording consistency                           | **Strong**    | Low     | Root node reads **"Atlas MongoDB"** but the official product name (and the auth prompt) is **"MongoDB Atlas"**. Two different strings describe the same "signed-out" state. Cheap, high-visibility fixes.                                                                        |
| **P2**   | Tooltips & reveal-on-sign-in                                 | **Medium**    | Low–Med | Project node has _no_ tooltip; cluster tooltip is decent but pre-`---`-grouping. After a successful sign-in the tree refreshes but does not reveal/expand the root (Kubernetes reveals the new source).                                                                          |
| **P3**   | Device-flow code presentation, list/tree toggle, icon parity | **Low–Med**   | Low     | Nice-to-haves; mostly already acceptable.                                                                                                                                                                                                                                        |

**The single most important finding:** Atlas's error UX is built on _passive in-tree error
rows that are themselves the retry button_. The Kubernetes review spent three iterations
(§F/#2/#19/#25) concluding that this is the wrong pattern and converging on **modal error +
a dedicated "Click here to retry" node**, matching the Connections view. **Crucially, all
three Azure plugins already ship exactly this pattern** — `askToConfigureCredentials()` raises
a modal on an empty/failed load and returns a single `'Click here to retry'` node (`refresh`
icon, `internal.retry` command). So this is not a Kubernetes opinion; it is the unanimous
behaviour of **all four** shipped discovery providers, and Atlas is the only one that does it
differently. Atlas should adopt the converged end-state directly rather than re-deriving it.

A cross-plugin convention matrix (§4) shows, dimension by dimension, where Atlas matches the
four siblings and where it diverges. A later forward-looking chapter (§9) covers UX
improvements beyond the sibling plugins, including research into **whether the extension could
ever use a `vscode://` OAuth redirect** instead of the device-code flow.

---

## 2. Methodology & applicability legend

Each Kubernetes item is mapped to Atlas with an **applicability** rating based on reading the
Atlas code (tree items, auth flows, wizard, `package.json` menus) and the
[PR #733 decisions doc](./decisions.md):

| Rating     | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| **Strong** | The same user-facing problem exists in Atlas; aligning materially improves UX. |
| **Medium** | A related problem exists or the convention would be a worthwhile polish.       |
| **Low**    | Minor, cosmetic, or already largely satisfied.                                 |
| **N/A**    | Kubernetes-specific (tunnels, kubeconfig, namespaces) or a bug-bash artifact.  |

Effort is **Low** (string/wording or a few lines), **Medium** (new node/command + wiring +
tests), or **High** (cross-cutting refactor). All effort estimates assume the inherited
`ClusterItemBase` / `BaseExtendedTreeDataProvider` machinery is reused.

---

## 3. Atlas UX inventory (verified against current branch)

A condensed snapshot of the surfaces this review evaluated. File references are to the
current branch.

**Tree nodes**

| Node    | Label             | Icon                                                                                         | Description              | Tooltip                                                                                     |
| ------- | ----------------- | -------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| Root    | `'Atlas MongoDB'` | `cloud` / `warning` (expired) / `loading~spin` (authenticating)                              | —                        | none                                                                                        |
| Project | `project.name`    | `project`                                                                                    | `'{org} · {N} clusters'` | **none**                                                                                    |
| Cluster | `cluster.name`    | state circle (`circle-filled` green IDLE / `loading~spin` / red DELETING / `circle-outline`) | `'M10, AWS, us-east-1'`  | rich markdown (State, Type, MongoDB, Tier, Provider, Region, Project + "expand to connect") |

**Special nodes**

| Node                    | Label                                                                                       | Icon      | contextValue | Behaviour                |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------- | ------------ | ------------------------ |
| Sign-in                 | `'Sign in to view Atlas clusters'`                                                          | `sign-in` | `error`      | runs `manageCredentials` |
| No projects             | `'No projects found'` / `'Create a project in the Atlas console'`                           | `info`    | `info`       | passive                  |
| All filtered            | `'All projects are hidden by filter'` / `'No projects found for the selected organization'` | `filter`  | `info`       | passive                  |
| No clusters             | `'No clusters found in this project'`                                                       | `info`    | `info`       | passive                  |
| Root error              | `error.message` (raw)                                                                       | `error`   | `error`      | runs `internal.retry`    |
| Project session-expired | `'Session expired. Please sign in again.'`                                                  | `warning` | `error`      | passive                  |
| Project auth error      | `'Authentication expired. Please sign in again.'`                                           | `error`   | `error`      | passive                  |
| Project load error      | `'Failed to load clusters: {0}'`                                                            | `error`   | `error`      | passive                  |

**Error surfacing today**

- Root + project **load/auth failures** → **passive in-tree error rows** (clickable = retry).
- Cluster **connection failure** → **modal** (`showErrorMessage(…, { modal: true })`). ✅ already aligned with the Kubernetes direction.
- All **auth-flow** failures (OAuth/API-key/service-account) → **non-modal toasts**.
- `manageCredentials` info/warnings ("Please sign in to Atlas first.", "No projects found…") → toasts.

**Command titles / menus (`package.json`)**

- `manageCredentials` = "Manage Credentials…" (inline `key` icon + context menu)
- `filterProviderContent` = "Filter Entries…" (inline `filter` + context)
- `learnMoreAboutProvider` = "Learn More" (inline `info` + context)
- `addConnectionToConnectionsView` = "Save To DocumentDB Connections" (inline `save` + context)
- No destructive inline trash on any row. ✅

---

## 4. The sibling-plugin baseline (3 Azure plugins + Kubernetes)

This section is the new material in this revision. It distils a code-level read of the three
Azure discovery plugins and their user-manual pages into a single comparison, so the
recommendations in §6 are anchored to **what already ships** rather than to one plugin's
review.

### 4.1 Cross-plugin convention matrix

> Legend: ✅ = follows the convention · ⚠️ = partial / diverges · ❌ = does not follow ·
> n/a = not applicable to that provider.

| UX dimension                             | vCore (`azure-mongo-vcore`)                                               | RU (`azure-mongo-ru`)              | Azure VM (`azure-vm`)                     | Kubernetes                                                  | **Atlas (today)**                                       |
| ---------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| **Root label**                           | "Azure DocumentDB"                                                        | "Azure Cosmos DB for MongoDB (RU)" | "Azure VMs (DocumentDB)"                  | "Kubernetes Clusters"                                       | ⚠️ **"Atlas MongoDB"** (product is "MongoDB Atlas")     |
| **Root icon**                            | stable `azure`                                                            | stable `azure`                     | stable `vm`                               | stable `layers`                                             | ⚠️ **state-dependent** `cloud`/`warning`/`loading~spin` |
| **Load/empty error**                     | ✅ modal + retry node                                                     | ✅ modal + retry node              | ✅ modal + retry node                     | ✅ modal + retry node                                       | ❌ **passive in-tree error row** (label = raw error)    |
| **Canonical "Click here to retry" node** | ✅ (`refresh`, `internal.retry`)                                          | ✅                                 | ✅                                        | ✅                                                          | ❌ (error label _is_ the button)                        |
| **Connection failure**                   | ✅ modal `Failed to connect to "{x}"`                                     | ✅ modal                           | ✅ modal `Failed to connect to VM "{x}"`  | ✅ modal                                                    | ✅ **modal** (already aligned)                          |
| **Wizard no-session/empty**              | ⚠️ always-show "Manage Accounts…" + modal then clean `UserCancelledError` | ⚠️ same as vCore                   | ⚠️ throws on no-VMs (suppressReportIssue) | ✅ always-show "Add a kubeconfig source…" + inline continue | ❌ **throws `'Atlas session not available'`** (raw)     |
| **Picker header item**                   | ✅ always-show "Manage Azure Accounts…" (`key`)                           | ✅ same                            | ✅ same                                   | ✅ always-show "Add…"                                       | ❌ no always-show header                                |
| **Inline destructive actions**           | ✅ none                                                                   | ✅ none                            | ✅ none                                   | ✅ none (after #1)                                          | ✅ **none**                                             |
| **Cluster-node menu parity**             | ✅ base `treeitem_documentdbcluster`                                      | ✅                                 | ✅                                        | ✅ (after §9)                                               | ✅ **aligned**                                          |
| **Tooltip**                              | plain-text (Sub ID, Tenant)                                               | plain-text                         | **markdown** bold labels                  | grouped `---` markdown                                      | cluster ✅ markdown · **project ❌ none**               |
| **Status in description**                | n/a                                                                       | n/a                                | ✅ "No Connectivity" when unreachable     | ✅ reachability text                                        | tier/region badges (no auth-state text)                 |
| **Filter affordance**                    | ✅ funnel (tenants/subs)                                                  | ✅ funnel                          | ✅ funnel + tag                           | ✅ funnel                                                   | ✅ funnel (org + project)                               |
| **Filter persistence**                   | ✅ across sessions                                                        | ✅                                 | ✅ (incl. tag)                            | ✅                                                          | ⚠️ confirm org+project filters persist                  |
| **Inline root actions**                  | Manage Creds / Filter / Learn More                                        | same                               | same                                      | same                                                        | ✅ **same** (key / filter / info)                       |

**Reading the matrix:** Atlas is already aligned on the _hard-won_ structural items
(no inline destructive actions, cluster-node parity, modal connection failure, the shared
inline action set). Its divergences cluster in exactly the rows the §6 recommendations target:
the **root label/icon**, the **load-error presentation + retry node**, the **wizard
no-session path**, and the **missing always-show picker header / project tooltip**.

### 4.2 Conventions all four siblings agree on (adopt without debate)

1. **Modal-on-load + a single "Click here to retry" node.** Every Azure plugin's
   `AzureServiceRootItem.getChildren()` raises `askToConfigureCredentials()` (a **modal** with
   "Manage Accounts" / "Adjust Filters" buttons) and, if dismissed, returns **one** node:
   `label = 'Click here to retry'`, `icon = ThemeIcon('refresh')`, `contextValue = 'error'`,
   `command = 'vscode-documentdb.command.internal.retry'`. Kubernetes reaches the identical
   end-state. This is the reference implementation Atlas should copy verbatim.
2. **An always-show header item in the picker** that lets the user fix the "no source" state
   without leaving the flow ("Manage Azure Accounts…" for Azure; "Add a kubeconfig source…"
   for Kubernetes), followed by a `QuickPickItemKind.Separator`.
3. **Stable provider-identity root icons** (`azure`/`vm`/`layers`) — none of the four change
   the root icon to reflect transient auth state.
4. **No destructive inline actions**; "Disable Registry"/"Remove" live in the context menu
   under a `rootItem` gate, never as an inline trash button.
5. **Clean product-name root labels** that match the vendor's own naming.

### 4.3 Where the siblings genuinely differ → choose an option

These are the only places the conventions diverge. For each, Atlas can pick the option that
fits best; both are already proven in the codebase, so neither is risky.

| Decision                      | Option A — **Kubernetes style**                                                                                                      | Option B — **Azure style**                                                                                                                                   | Recommendation for Atlas                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wizard with no session**    | Prepend an `alwaysShow` "Sign in…" item; on selection, run auth **inline** and **re-prompt** in the same wizard (user never leaves). | Prepend the "Manage Accounts…" item; on selection, run auth, show a modal "completed — please retry discovery", then exit cleanly with `UserCancelledError`. | **Either beats today's raw `throw`.** Option A is the smoother UX; Option B is the lighter change and is what 3 of 4 siblings already do. Pick B for fastest parity; pick A for best UX.            |
| **Tooltip format**            | Grouped markdown with `\n\n---\n\n` separators, most-important-first.                                                                | Azure VM uses **markdown bold labels** (`**Name:** …`); Azure RU/vCore use **plain-text** key/value.                                                         | Atlas cluster tooltip is already markdown — keep it; **add a project tooltip** in whichever style the team standardizes on (recommend the Kubernetes grouped style for cross-provider consistency). |
| **Surfacing transient state** | Reachability text in the description/tooltip; stable icon.                                                                           | Azure VM puts **"No Connectivity"** in the node **description** (stable icon kept).                                                                          | Prefer the Azure-VM/K8s approach: keep a **stable `cloud` root icon** and move "expired / authenticating" into the **description or tooltip**, rather than swapping the root icon.                  |

### 4.4 High-level conventions from the user manual

The shipped Azure providers are documented in
[managing-azure-discovery.md](../../../user-manual/managing-azure-discovery.md) and three
per-provider pages. Two documented conventions are worth mirroring in Atlas, and one doc gap
should be closed:

- **"Manage Credentials" is a staged Account → Tenant flow** with explicit `Back` and `Exit`
  rows and per-item status (e.g. "2 tenants available (1 signed in)", "✅ Signed in" /
  "🔐 Select to sign in"). Atlas's Manage Credentials QuickPick (account / sign-out / exit) is
  analogous; align its **status wording and Back/Exit affordances** with the documented Azure
  pattern. _Note one intentional divergence:_ the Azure flow **delegates sign-out to the VS Code
  Accounts icon** ("the wizard does not provide a sign-out option"), whereas Atlas owns its
  session and **does** offer sign-out — which is correct for Atlas (it is not part of VS Code's
  Azure account system). Keep Atlas's sign-out, but document it.
- **Dual-context filtering rule:** _"From the Service Discovery panel, filters are applied
  automatically; from the Add New Connection wizard, no filtering is applied — all
  subscriptions from all tenants are shown."_ Atlas should follow the same rule: the
  **Add-Connection wizard should show all orgs/projects unfiltered**, while the panel honours
  the org/project filter. Confirm the Atlas wizard does not silently inherit the panel filter.
- **Filter persistence across sessions** is a documented promise for Azure; confirm Atlas's
  org and project filters persist and pre-select on reopen (relates to §9.3).
- **Documentation gap:** [service-discovery.md](../../../user-manual/service-discovery.md)
  lists only the three Azure providers under "Available Service Discovery Plugins"; **Atlas is
  not yet listed and has no per-provider manual page.** Add a `service-discovery-atlas-mongodb`
  page (covering the three auth methods, the device-code flow, and the org/project model) and
  link it from the overview — mirroring the Azure pages. This also gives "Learn More" (§9.4) a
  real target.

---

## 5. Theme-by-theme mapping

### A. First run & empty state

| K8s item                                             | Atlas applicability         | Effort | Notes / recommendation                                                                                                                        |
| ---------------------------------------------------- | --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| #3 Default source shown even when missing            | **N/A**                     | —      | Atlas has no auto-seeded source; signed-out root shows a clean "Sign in" node. Already in the spirit of #3.                                   |
| #13 All providers visible by default                 | **N/A (inherited)**         | —      | Provider-visibility lives in the shared discovery layer, not the Atlas plugin. Already resolved on `main` (#13).                              |
| Neutral empty-state nodes (`info` icon, action hint) | **Low (already satisfied)** | —      | "No projects found" + "Create a project in the Atlas console" with an `info` icon is exactly the convention Kubernetes converged on. ✅ Keep. |

### B. Adding a source / getting connected

| K8s item                                                                | Atlas applicability | Effort  | Notes / recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#12 Wizard dead-ends when no source configured**                      | **Strong**          | Medium  | **Top wizard finding.** `SelectAtlasProjectStep` throws `'Atlas session not available'` (and `SelectAtlasClusterStep` throws `'No active clusters found…'`) which closes the New-Connection wizard. Kubernetes (`SelectContextStep`) **always prepends an `alwaysShow` "Add a kubeconfig source…" item** with a separator, runs the add-flow inline, then re-prompts instead of dead-ending. **Recommendation:** prepend an `alwaysShow` "Sign in to MongoDB Atlas…" item to `SelectAtlasProjectStep`. **All three Azure plugins already do this** ("Manage Azure Accounts…" + separator). Two proven variants exist — see **§4.3** (Option A: K8s inline-continue · Option B: Azure launch-then-clean-exit). Either beats today's raw `throw`. |
| #9 Picker: secondary text in `detail` not `description`; per-item icons | **Medium**          | Low     | The auth QuickPick already has per-option icons (`globe`/`key`/`server`) ✅, but its secondary text is in `description` (inline, truncates). #9's lesson: move it to `detail` (second line, wraps). Quick polish on `AtlasAuthQuickPick`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| #17 Contradicting messages (success + error together)                   | **Medium**          | Low     | Audit the three auth flows so a _failed_ auth never shows a success toast. Today success/failure are separate branches (looks fine), but the Kubernetes principle "an aborted add is an **error**, framed as one" suggests promoting auth _failures_ to a clearer, possibly modal, error (see §F).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| #16 File-dialog default location                                        | **N/A**             | —       | No file dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| #4 Clipboard read without consent                                       | **N/A**             | —       | Device flow _writes_ the user code to the clipboard (expected, announced in the progress notification). No silent clipboard _read_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| #26 Drag-and-drop of config files                                       | **N/A**             | —       | No file sources.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| #22 Reveal/expand node after it's added                                 | **Medium**          | Low–Med | After a successful sign-in, `AtlasDiscoveryProvider` resets the error cache and calls `refresh()` (decisions §12) but does **not** `reveal()`/expand the root. Kubernetes reveals + selects the newly-added source (#22). **Recommendation:** after `transitionTo(Active)`, reveal+expand the Atlas root so projects appear without a manual expand.                                                                                                                                                                                                                                                                                                                                                                                            |

### C. Tree structure, labels & icons

| K8s item                                              | Atlas applicability         | Effort | Notes / recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #10 Root node icon                                    | **Low–Med**                 | Low    | Kubernetes settled on a stable provider-identity icon. Atlas root uses a **state-dependent** icon (`cloud`/`warning`/`loading~spin`). The `warning` glyph on "expired" doubles as a status hint, which is reasonable, but it means the provider's identity icon changes under the user. Consider keeping a **stable** identity icon (`cloud`) and moving the expired/authenticating signal into the tooltip/description. **All four siblings use a stable root icon** (`azure`/`azure`/`vm`/`layers`); Azure VM surfaces transient state as a `"No Connectivity"` **description** instead of changing the icon (see §4.3). |
| #1 Inline trash too destructive                       | **Low (already satisfied)** | —      | No destructive inline actions on Atlas rows. ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| #5 Redundant labels / counts / empty-namespace bucket | **Low**                     | —      | Atlas is only two levels deep (Project → Cluster); there is no namespace wall and no redundant per-row count (the `{N} clusters` on a project is the _only_ place that count appears, so it's informative, not redundant). The "Others — no targets" bucket has no analogue. Keep as-is.                                                                                                                                                                                                                                                                                                                                   |
| #8/#11 Unified source icon                            | **N/A**                     | —      | Atlas has a single source kind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| #18 Uneditable path in description                    | **N/A**                     | —      | No file paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Iteration 14 list/tree toggle                         | **Low**                     | —      | Justified for Kubernetes (context → namespaces → clusters, 3 levels with empty namespaces). Atlas is already flat-ish (2 levels). Low value; revisit only if users with many projects ask for a flat all-clusters view.                                                                                                                                                                                                                                                                                                                                                                                                    |

### D. Tooltips & wording

| K8s item                                                   | Atlas applicability | Effort | Notes / recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #6 Tooltip trimmed; no internal/un-actionable fields       | **Medium**          | Low    | Atlas **cluster** tooltip is already reasonable (no secrets, ends with an actionable "expand to connect" line). Two improvements: (1) the **project node has no tooltip** — add one (org name, project ID, cluster count); (2) standardize the tooltip shape — Azure VM uses **markdown bold labels**, Azure RU/vCore use plain-text, Kubernetes uses grouped `\n\n---\n\n` sections (see §4.3). Recommend the Kubernetes grouped style for cross-provider consistency. |
| §9.5 Terminology: "MongoDB Cluster" → "DocumentDB cluster" | **Strong**          | Low    | Repo terminology rule: never "MongoDB" alone as a product name. **Nuance for Atlas:** "MongoDB Atlas" _is_ a legitimate product name, and "MongoDB: v{version}" in the cluster tooltip is the genuine server version — both are fine. But **generic** uses ("a MongoDB cluster", "MongoDB connection") must read "DocumentDB cluster". **Action:** audit all Atlas user-facing strings and split "MongoDB Atlas" (product, keep) from generic "MongoDB" (→ DocumentDB). |
| Root label = product name                                  | **Strong**          | Low    | Root node is **"Atlas MongoDB"**; the official product (and the auth-QuickPick placeholder, "…authenticate with MongoDB Atlas?") is **"MongoDB Atlas"**. **Rename the root node to "MongoDB Atlas"** for correctness and internal consistency.                                                                                                                                                                                                                          |
| #24 / #23 Path/OS wording                                  | **N/A**             | —      | No filesystem paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### E. Service nodes, reachability & cluster-node parity

| K8s item                                                    | Atlas applicability         | Effort | Notes / recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #21 Reachability / port-forward transparency                | **N/A**                     | —      | Atlas clusters are directly reachable via `mongodb+srv://`. No tunnel nuance.                                                                                                                                                                                                                                                                                                                                                                                          |
| §9 Cluster-node parity (discovery node = full cluster menu) | **Low (already satisfied)** | —      | `AtlasClusterItem extends ClusterItemBase` and keeps the base `treeItem_documentdbcluster` contextValue (plus `enableAddToConnectionsCommand`), with **no negative-lookahead exclusions** — so it behaves like the Azure vCore discovery node, which is the end-state Kubernetes had to refactor _toward_ in §9. ✅ Confirm during hands-on testing that Copy Connection String / Create Database / Open Shell behave on a discovered Atlas node after expand/connect. |
| Dual-auth nuance (Admin API session ≠ SCRAM db creds)       | **Medium (docs)**           | Low    | Decisions §5 captures this well. Worth a one-line tooltip/doc note so users understand that "signed in to Atlas" (discovery) does **not** mean "authenticated to the database" (they'll still be prompted for SCRAM creds on expand).                                                                                                                                                                                                                                  |

### F. Errors, recovery & refresh — **the priority theme**

This is where Atlas most diverges from **all four** siblings. Kubernetes spent
§F/#2, #19, #25 (three iterations) reaching the conclusion below — and the three Azure
plugins already implement it (`askToConfigureCredentials()` modal + `'Click here to retry'`
node). Atlas is the only provider still using passive error rows:

> A failing discovery node should show its failure as a **modal** on a _real_ load attempt
> (expand or explicit retry), keep **only** a canonical **"Click here to retry"** node
> (first child, `refresh` icon) in the tree, and **never** leave a passive classified error
> row under the node. The inherited **error-node cache** stops `getChildren()` from re-running
> on passive refreshes, so the modal fires at most once per real attempt (no modal spam).

| K8s item                                                              | Atlas today                                                                                                                                                                                                                    | Applicability               | Effort | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2/#25 Error as modal, not a passive in-tree row                      | Root + project failures render **passive in-tree error rows** whose label is the raw error and which double as the retry button. (Cluster connection failure already uses a modal ✅.)                                         | **Strong**                  | Medium | Move root/project load+auth failures to `showErrorMessage(…, { modal: true })` on a real load attempt, and stop rendering the classified error text as a passive row. **All three Azure plugins already implement this exact flow** (`askToConfigureCredentials()` modal + retry node) — copy it. The error-node cache (decisions §12, `resetNodeErrorState`) already exists, so modal-spam protection is free. |
| #19 Canonical "Click here to retry" node, first child, `refresh` icon | Retry is implicit — the **error message itself** is the clickable node (`internal.retry`). No dedicated retry node; wording differs per error.                                                                                 | **Strong**                  | Medium | Add the canonical first-child **"Click here to retry"** node (`refresh` icon) used by the Connections view and Kubernetes, instead of overloading the error label as the button.                                                                                                                                                                                                                                |
| #19 Refresh reuses cache; only Retry re-runs                          | Inherited from `BaseExtendedTreeDataProvider` (failed-children cache).                                                                                                                                                         | **Low (already satisfied)** | —      | Confirm passive `Refresh` does not re-fire auth, and only explicit retry clears the cache.                                                                                                                                                                                                                                                                                                                      |
| Wording consistency of error states                                   | Two near-duplicate strings: `'Session expired. Please sign in again.'` (warning icon) and `'Authentication expired. Please sign in again.'` (error icon) for similar situations; root error shows the **raw** `error.message`. | **Medium**                  | Low    | Unify the signed-out/expired wording and icon; route raw API messages to the output channel + a friendly summary, the way Kubernetes does.                                                                                                                                                                                                                                                                      |
| 401 vs 403 handling                                                   | Already thoughtfully handled (decisions §9 + Bug 5: 403 now clears the session so "Manage Credentials" re-prompts).                                                                                                            | **Low (already good)**      | —      | No change; just keep the modal/retry presentation consistent across 401/403/5xx.                                                                                                                                                                                                                                                                                                                                |

### G. Backend bugs / H. Won't-fix

**N/A.** Atlas has its own backend bugs (decisions Bugs 1–5, all auth-token lifecycle). The
Kubernetes "won't-fix" items (double-click-to-expand, query-table contrast) are unrelated.

---

## 6. Prioritized recommendation list

1. **(P1, Medium) Error surfacing parity (§F).** Replace passive root/project error rows with
   _modal-on-load + a canonical "Click here to retry" first-child node_. Reuse the existing
   error-node cache for modal-spam protection. This is the single biggest alignment win.
2. **(P1, Medium) Wizard no-session inline sign-in (§B/#12).** Prepend an `alwaysShow`
   "Sign in to MongoDB Atlas…" item to `SelectAtlasProjectStep`; run auth inline; never
   dead-end the wizard.
3. **(P2, Low) Rename root "Atlas MongoDB" → "MongoDB Atlas"** and audit generic "MongoDB"
   vs the "MongoDB Atlas" product name per the repo terminology rule.
4. **(P2, Low) Unify the signed-out/expired error wording + icon** (one string, one icon).
5. **(P2, Low–Med) Reveal + expand the Atlas root after a successful sign-in (#22).**
6. **(P2, Low) Add a project-node tooltip and adopt the grouped (`---`) tooltip shape (#6).**
7. **(P3, Low) Move auth-QuickPick secondary text from `description` to `detail` (#9).**
8. **(P3, Low) Consider a stable root identity icon**, moving expired/authenticating state
   into the tooltip/description (#10 / §9.6).
9. **(P3, Low) Device-flow code presentation** — see §9.1.
10. **(P2, Low–Med, docs) Add a `service-discovery-atlas-mongodb` user-manual page** and list
    Atlas in [service-discovery.md](../../../user-manual/service-discovery.md) (§4.4); gives
    "Learn More" a target.
11. **(P2, Low) Confirm the Add-Connection wizard shows orgs/projects unfiltered** and that
    org/project filters persist across sessions, per the documented Azure rule (§4.4).

Items 3–4 are near-free and high-visibility; do them regardless of the larger items.

---

## 7. What Atlas already gets right (no action)

- No destructive inline trash icons on tree rows (Kubernetes #1).
- Neutral `info`-icon empty states with an actionable hint (Kubernetes #5/#20 "Others" spirit).
- A single shared `manageCredentials` command entry point reused by the sign-in node and the
  context menu (Kubernetes' "one code path" goal, §17 of decisions).
- `AtlasClusterItem extends ClusterItemBase` with the base contextValue and **no** negative-
  lookahead command exclusions — the cluster-node parity end-state Kubernetes refactored
  _toward_ in §9.
- Cluster connection failure already uses a **modal** (the §F direction).
- Cluster tooltip already avoids internal/un-actionable fields and ends with an actionable line.
- Matches the shared inline-action set (Manage Credentials / Filter / Learn More) and the
  `rootItem`-gated "Disable Registry" of all three Azure plugins (§4.1).

---

## 8. Suggested hands-on review checklist (UX)

1. Cold start, signed out: root shows a single "Sign in" affordance; confirm wording reads
   "MongoDB Atlas".
2. Auth QuickPick: three options with icons; secondary text legible (not truncated).
3. Device flow: confirm the user code is visible, copied, and the browser opens; cancelling
   reads/leaks nothing.
4. New-Connection wizard while signed out: should offer an inline "Sign in…" entry, not a
   dead-end error (this is the #12 gap today).
5. Break discovery (revoke the token / disconnect network), expand the root: confirm whether
   you get a passive error row (today) vs the target modal + "Click here to retry".
6. Hit Refresh repeatedly on a broken root: confirm no auth re-fires / no modal spam.
7. Empty project: "No clusters found in this project" with an `info` icon. ✅
8. Cluster tooltip: trimmed, actionable; project tooltip currently absent.
9. 403 (under-privileged key): confirm "Manage Credentials" re-prompts (decisions Bug 5).

---

## 9. Other suggested UX improvements (beyond the sibling plugins)

### 9.1 Device-code presentation

The OAuth device flow currently (a) auto-copies the user code to the clipboard, (b)
auto-opens the browser, and (c) shows a cancellable **progress notification** that echoes the
code. This is solid. A common refinement (used by GitHub's auth) is a brief **modal**
_before_ opening the browser that shows the code in large text with **"Copy & Continue"** /
**"Cancel"** buttons, so the user is never surprised by a browser launch and always sees the
code even if the clipboard write is blocked by policy. **Applicability: Medium. Effort: Low.**
Keep the progress notification for the polling phase.

### 9.2 "Signed in as …" affordance on the root

When `Active`, the root could surface the signed-in identity (display name / org) in its
**description** or tooltip, so users can tell _which_ account/org is active without opening
"Manage Credentials". The data is already fetched (`getCurrentUser`, decisions §10) and the
org filter is already tracked. **Applicability: Medium. Effort: Low.**

### 9.3 Make the org/project filter state visible

Two independent filters exist (org filter via Manage Credentials; project filter via the
filter icon — decisions §11). When a filter is hiding projects, the only signal is the
"All projects are hidden by filter" empty state. Consider a small **filter badge/description**
on the root when a filter is active (mirrors VS Code's own "filtered" affordances), so users
don't think projects are _missing_. **Applicability: Medium. Effort: Low–Med.**

### 9.4 Consistent "Learn more" docs target

Kubernetes added a dedicated user-manual section and pointed "Learn more" at an `aka.ms`
slug (§11/§12). Atlas's "Learn More" should likewise point at an Atlas-discovery manual
section covering the two-layer auth model (Admin API session vs SCRAM db creds), the three
auth methods, and the org/project filters. **Applicability: Medium (docs). Effort: Low–Med.**

### 9.5 Research — could Atlas use a `vscode://` OAuth redirect instead of the device flow?

The author chose the **OAuth 2.0 Device Authorization Grant** (RFC 8628) precisely because
"Atlas does not support `vscode://` redirect URIs for apps that are not registered in their
system" (decisions §3). This section researches what it would take to change that, and
whether it's worth it.

**How the `vscode://` redirect would work technically.** VS Code fully supports this pattern:

- `vscode.window.registerUriHandler({ handleUri })` registers a handler for
  `vscode://<publisher>.<extension>/<path>` system URIs (confirmed in the
  [VS Code API: `UriHandler`](https://code.visualstudio.com/api/references/vscode-api#UriHandler)).
- `vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${extensionId}/auth-complete`))`
  produces an externally-addressable callback URI that also works in Remote/WSL/Codespaces
  (the [Remote Extensions guide](https://code.visualstudio.com/api/advanced-topics/remote-extensions#callbacks-and-uri-handlers)
  shows this exact OAuth-callback recipe).
- The standard, recommended flow would be **Authorization Code + PKCE** (no client secret in
  the client), with the IdP redirecting to the `vscode://…/auth-complete` URI carrying the
  `code`, which the URI handler exchanges for tokens.

**Why it isn't available today — the real blockers.** Per the VS Code guide itself: _"not all
providers allow `vscode://` callback URIs and others do not allow wildcard host names for
callbacks over HTTPS… you may need to build a proxy service in front of the provider."_ For
Atlas specifically:

1. **The extension is not a registered Atlas OAuth application.** Auth-Code/PKCE requires a
   `client_id` whose **redirect URIs are pre-registered** with the IdP. The current device flow
   reuses the **Atlas CLI's well-known public client** (`0oabtxactgS3gHIR0297`, decisions §3),
   which has device-flow scopes pre-approved but **no `vscode://` redirect** registered (and we
   can't add one — it's not our app registration).
2. **Atlas's public surface offers only two first-class programmatic auth methods** — **Service
   Accounts (OAuth 2.0 _client-credentials_)** and **API Keys (HTTP Digest)** — per the
   [Atlas Admin API auth methods](https://www.mongodb.com/docs/atlas/api/service-accounts-overview/)
   and [Get Started with the Atlas Administration API](https://www.mongodb.com/docs/atlas/configure-api-access/).
   Neither is an _interactive Authorization-Code_ flow with a configurable redirect URI for a
   third-party desktop app. The interactive human-login device flow the plugin uses relies on
   **private/undocumented** endpoints (`/api/private/unauth/account/device/*`, decisions §3).
3. **Cloud IdPs frequently reject custom-scheme (`vscode://`) redirects** and require **HTTPS**
   redirect URIs — which for a desktop tool means hosting an HTTPS relay.

**What "whitelisting / integrating our app" would actually require (options).**

| Option                                                                                                                                                                                            | What it entails                                                                                                                                                                                                                                                                         | Pros                                                                                                                    | Cons / risk                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Register a first-party MongoDB Atlas OAuth app** with `vscode://ms-azuretools.vscode-documentdb/auth-complete` (and an `https://*.github.dev` form for Codespaces) as approved redirect URIs | Requires MongoDB to (a) create/own an OAuth app for the extension and (b) approve our custom-scheme + wildcard-HTTPS redirects. A cross-company partner ask.                                                                                                                            | Cleanest, most "native" UX (one browser round-trip, auto-return to the editor); PKCE-secure; no undocumented endpoints. | Needs a **MongoDB partnership/registration** and their willingness to whitelist `vscode://` + wildcard HTTPS — outside our control; lead-time + ongoing ownership.          |
| **B. Host a thin HTTPS OAuth **relay/proxy\*\* we own                                                                                                                                             | Atlas redirects to `https://<our-domain>/atlas/callback`; the relay 302-redirects to the `vscode://…/auth-complete` URI (the pattern the VS Code docs explicitly recommend). Still needs a registered Atlas app + an approved **HTTPS** redirect (easier for IdPs than custom schemes). | Avoids needing `vscode://` whitelisted; works in browser-based editors; we control the relay.                           | We must **operate a production HTTPS service** (uptime, security, privacy review); still needs a registered Atlas app.                                                      |
| **C. Loopback `http://127.0.0.1:<port>` redirect** (RFC 8252 native-app pattern)                                                                                                                  | Spin up a transient localhost listener for the redirect.                                                                                                                                                                                                                                | No hosted service; standard for native apps; many IdPs allow loopback.                                                  | Decisions §3 **explicitly rejected** this (port conflicts, firewalls, Remote/WSL/Codespaces fragility). Still needs a registered Atlas app that permits loopback redirects. |
| **D. Keep the device-code flow (status quo)**                                                                                                                                                     | No redirect URI at all (RFC 8628).                                                                                                                                                                                                                                                      | Already shipped; works everywhere incl. Remote/WSL/Codespaces; same approach as the Atlas CLI.                          | Slightly clunkier UX (code + browser); depends on **undocumented** Atlas endpoints (decisions §3 risk).                                                                     |

**Recommendation.** **Keep Option D (device flow) as the default**, and treat Options A/B as a
**partnership-gated future enhancement**, not a near-term UX fix. The device flow is the
correct, portable choice given Atlas's public auth surface; the `vscode://` redirect is only
unlocked by a MongoDB-side app registration that approves our redirect URIs (A) or by us
operating an HTTPS relay (B). Both are real projects, not config tweaks. If we _do_ pursue a
native interactive redirect later, **Option B (owned HTTPS relay) + a registered Atlas app**
is the most self-reliant path and the one VS Code's own docs steer extensions toward. In the
meantime, the device-flow UX is best improved cheaply via **§9.1** (a pre-launch modal showing
the code), not by changing the grant type.

> Security note: whichever path, prefer **Authorization Code + PKCE** (no embedded client
> secret) for any interactive redirect flow, per the VS Code guidance and OAuth best practice.

---

## 10. Appendix — Kubernetes item → Atlas applicability index

| K8s #   | Topic                                    | Atlas applicability                   | Effort  |
| ------- | ---------------------------------------- | ------------------------------------- | ------- |
| 1       | Inline trash too destructive             | Low (already satisfied)               | —       |
| 2       | Error shown as passive tree row          | **Strong**                            | Medium  |
| 3       | Default source shown when missing        | N/A                                   | —       |
| 4       | Clipboard read without consent           | N/A                                   | —       |
| 5       | Noisy tree / counts / empty bucket       | Low                                   | —       |
| 6       | Tooltip trimmed / no internal fields     | **Medium**                            | Low     |
| 7       | Wrong API hook for source mgmt           | N/A                                   | —       |
| 8/11    | Unified source icon                      | N/A                                   | —       |
| 9       | Picker detail vs description + icons     | **Medium**                            | Low     |
| 10      | Root node icon                           | Low–Med                               | Low     |
| 12      | Wizard dead-ends with no source          | **Strong**                            | Medium  |
| 13      | All providers visible by default         | N/A (inherited)                       | —       |
| 14/15   | Backend init bugs                        | N/A                                   | —       |
| 16      | File-dialog default location             | N/A                                   | —       |
| 17      | Contradicting add messages               | Medium                                | Low     |
| 18      | Uneditable path in description           | N/A                                   | —       |
| 19      | Refresh re-runs discovery / retry node   | **Strong** (retry node) / Low (cache) | Medium  |
| 20      | Settings surface                         | Low                                   | —       |
| 21      | Port-forward transparency                | N/A                                   | —       |
| 22      | Reveal node when added                   | **Medium**                            | Low–Med |
| 23/24   | Path/OS wording                          | N/A                                   | —       |
| 25      | "Retry" semantics / modal error          | **Strong**                            | Medium  |
| 26      | Drag-and-drop config                     | N/A                                   | —       |
| 27      | Query-table contrast                     | N/A                                   | —       |
| 28      | Double-click expand                      | N/A                                   | —       |
| 29      | Shell error formatting                   | N/A                                   | —       |
| 30      | Port-forward after restart               | N/A                                   | —       |
| §9      | Cluster-node parity                      | Low (already satisfied)               | —       |
| §9.5    | "MongoDB Cluster" → "DocumentDB cluster" | **Strong**                            | Low     |
| Iter 14 | List/tree toggle                         | Low                                   | —       |

---

_Prepared for the Atlas MongoDB discovery (PR #733) UX review, iteration 1. Code references
verified against the `dev/bchoudhury/atlas-mongodb-discovery` branch. No code was modified;
all items are recommendations._
