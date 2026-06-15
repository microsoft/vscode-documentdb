# Bug Bash 0.9.0 — Kubernetes Service Discovery UX Review Pack

> **Who this is for:** anyone about to do a hands‑on UX review (trying the extension,
> exercising user flows) of the Kubernetes service‑discovery feature, or anyone reading back
> how the review unfolded.
> **What this is:** a single catch‑up document that reconstructs the UX discussion that happened
> a while ago across 30 closed bug‑bash issues, states what was _decided_, shows what the code
> _actually does today_ (verified against the current branch), and **flags** everything that is
> still open, contradictory, or only partially done.

- **Feature / PR:** [microsoft/vscode-documentdb#621 — feat(kubernetes): add multi-source service discovery](https://github.com/microsoft/vscode-documentdb/pull/621)
- **Working branch:** `dev/guanzhousong/kubernetes-service-discovery`
- **Issue tracker (closed):** [tnaum-ms/vscode-documentdb-bugbash-090 — closed issues](https://github.com/tnaum-ms/vscode-documentdb-bugbash-090/issues?q=is%3Aissue%20state%3Aclosed)
- **Scope of this doc:** the UX‑facing issues (wording, tree structure, icons, tooltips, flows).
  Pure backend bugs are listed at the end for completeness but not analyzed in depth.

## How this review was run

This was an **iterative review**, carried out as a pairing between a person steering the review and an
AI assistant doing the reading, code-checking, and editing. Rather than hold the entire feature in mind
at once, the work was deliberately split into **phases** — first-run and empty states, adding sources,
the tree presentation, connectivity and tooltips, and so on. Each phase was discussed, decided,
implemented, and then **closed out before moving to the next**, so that:

- the **assistant's working context stayed lean** — only the slice of code and discussion relevant to the
  current phase was loaded at any time, which kept the analysis accurate instead of sprawling; and
- the **reviewer's attention stayed focused** — one coherent area at a time, with decisions written down
  here as they were made so nothing had to be re-derived later.

The sections below are organized by user journey (not by issue number) and read as a running log: each
iteration records the feedback that came in, the reasoning, the decision, and what was actually
implemented. Later iterations (§7 onward) capture successive rounds of refinement on top of the original
bug‑bash items. The intent is that a future reader — human or assistant — can pick up any single phase
cold and understand both _what_ was decided and _why_.

## Legend

| Marker                    | Meaning                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| ✅ **Done**               | Decided and verified present in the current codebase                |
| 🟡 **Partial / Deferred** | Some of the ask shipped; remainder deferred to a follow‑up          |
| ⚠️ **Flag**               | Open question, contradiction, or a gap to confirm during the review |
| 🚫 **Won't fix**          | Closed without a code change on this branch                         |

---

## 1. The story in one paragraph

The feature adds a **Kubernetes** root under the Discovery view. From there a user registers one or
more **kubeconfig sources** (the machine default, a file on disk, or pasted YAML), expands a source to
see its **contexts**, expands a context to see **namespaces**, and finds **DocumentDB targets**
(services) inside namespaces. Connecting to a target transparently does the right thing per service
type (direct, node‑routed, or local **port‑forward** tunnel). The bug bash hammered the _presentation_
of this hierarchy: how sources/contexts/namespaces/targets are labeled and iconed, how errors and
empty states appear, how destructive actions are exposed, how much internal detail leaks into
tooltips, and how honest the UI is about port‑forwarding. Most items were fixed; a few were
deliberately deferred or diverged from the original suggestion; and **one release item (#25) shipped
only partially**.

The intended end‑state tree (from the #5 resolution) looks like this:

```text
v Kubernetes                                  (icon: layers)
  v Pasted YAML 1                             (icon: group-by-ref-type, no "(pasted YAML)" suffix)
    v bugbash-090 (AKS / westus2)             (context)
      v documentdb-instance-ns                (namespace WITH targets, no count)
        > sample-documentdb   [DKO] ClusterIP · port-forward required :10260
      > Other namespaces  No DocumentDB targets found   (collapsed bucket for empty namespaces)
```

---

## 2. Flow‑by‑flow summary

The issues are grouped by the user journey rather than by number, so the reviewer can walk the
extension in order. Each item leads with a one‑line **Verdict**, then states **Expected** (if the issue
defined it), **Decision / Code today** (verified), and any **Flag**.

**How to read the Verdict line:**

- **As expected** — shipped behavior matches the issue's expected/agreed outcome. Where the path there
  differed (e.g. an evolved design), it's called out under "what was done differently".
- **As expected (scoped)** — a discussion issue whose committed scope shipped, with deferred extras noted.
- **Deviation** — the team did something materially different from the stated expectation (even when
  justified), or left a clearly stated ask unaddressed.

### A. First run & empty state

**#3 — "Default kubeconfig" entry shown even when the file doesn't exist** ✅

- **Verdict — As expected.** Implemented as defined; no behavioral difference.
- **Expected:** Don't pre‑populate a default source that immediately errors. Show a clean empty state
  with an "Add kubeconfig source" action; offer the default as an option _inside_ the add wizard.
- **Decision / Code today:** `ensureMigration()` seeds the default source only when
  `defaultKubeconfigExists()` is true. With nothing configured, the root renders a single
  **"Add kubeconfig source…"** action node. Verified in
  [KubernetesRootItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.ts#L28-L38) and
  [migrationV2.ts](src/plugins/service-kubernetes/sources/migrationV2.ts).
- ➡️ **Iteration 1 (review feedback):** the label "Add kubeconfig source" reads as internal/jargon and
  isn't especially user‑friendly; the suggestion was to follow the naming common in established Kubernetes
  tooling, with **"Add Kubeconfig…"** as a fallback.
  - **Research — common Kubernetes tooling conventions:** established Kubernetes desktop tools typically
    group everything under a root such as **"Kubernetes Clusters"** with a **"Local Kubeconfigs"** section,
    and their add actions read along the lines of **"Add Kubeconfigs"** (the paste/add button), **"Add from
    filesystem"** (browse a file), and **"Manually add a kubeconfig"** (paste YAML).
  - **Decision:** adopt the field‑standard verb. The consolidated add command (which opens a picker for
    default / file / paste) is now **"Add Kubeconfigs…"** everywhere it surfaces.
  - **Implemented:** `package.json` command title, [KubernetesRootItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.ts)
    empty-state action, the in-wizard entry in [SelectContextStep.ts](src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts),
    and the picker placeholder in [addKubeconfigSource.ts](src/plugins/service-kubernetes/commands/addKubeconfigSource.ts).

**#13 — Make all service‑discovery plugins visible by default** ✅ (design evolved)

- **Verdict — As expected (outcome); implemented differently.** Visible‑by‑default is met. What was done
  differently: the first fix auto‑seeded an `activeDiscoveryProviderIds` list, then it was re‑architected
  to track `hiddenDiscoveryProviderIds` (visible = all − hidden) and the verbs became **Show Hidden
  Provider… / Hide Provider** (away from enable/disable language).
- **Expected:** All discovery providers (Azure, Kubernetes, …) show up by default; hiding is opt‑in.
- **Decision / Code today:** Final model is **visible = all registered providers − `hiddenDiscoveryProviderIds`**.
  Legacy `activeDiscoveryProviderIds` is migrated once. UI wording changed to **"Show Hidden Provider…"**
  and **"Hide Provider"** (away from enable/disable language); the empty Service Discovery welcome text
  explains that all providers are hidden and offers **Show Hidden Provider…**.
- ⚠️ **Flag (revisit before launch):** the reviewer wanted to revisit this API later (the question of
  whether someone might want to hide all providers). Confirm the hidden‑provider migration behaves for:
  fresh install, an explicit empty legacy list, and a non‑empty legacy list. Confirm `azure-discovery` is
  normalized to `azure-mongo-vcore-discovery`.
- ➡️ **Iteration 1 (review feedback) — resolved:** the preference was to simplify the model — all providers
  are always visible and can be removed; the extension stores only the "removed" list and shows everything
  else, with no migration path (everyone simply sees all providers and can remove the ones they don't want).
  - **Decision:** Drop the legacy migration entirely. Visible = all registered providers −
    `hiddenDiscoveryProviderIds`; the stored list tracks only hidden ids; default is `[]` (all visible).
    Older state keys (`activeDiscoveryProviderIds`) are simply ignored, so existing users transparently
    get “all visible” and can re-hide what they don’t want.
  - **Implemented:** Removed `ensureDiscoveryProviderVisibilityMigrated` / `migrateDiscoveryProviderVisibility`
    and the legacy/azure-rename handling from
    [discoveryProviderVisibility.ts](src/services/discoveryProviderVisibility.ts); deleted the two
    migration tests. This **closes the pre-launch flag above** — there is no migration left to verify.

### B. Adding a kubeconfig source

**#9 — "Add kubeconfig source" picker: wrong fields + missing icons** ✅

- **Verdict — As expected.** Shipped exactly as asked; no difference.
- **Expected:** Move secondary text from `description` (inline, truncates) to `detail` (second line);
  add per‑type icons to the picker items.
- **Decision / Code today:** Picker uses `detail` + `iconPath` (`home` / `folder-opened` / `clippy`).
  Per‑type icons are intentionally _kept_ in the wizard (opposite of the tree — see #8/#11).
- ➡️ **Iteration 1 (review feedback):** the add action is singular **"Add Kubeconfig…"** (not plural
  "Kubeconfigs"). Applied to the `package.json` command title, the empty-state action, the in-wizard
  entry, and the picker placeholder. Field-standard naming was considered, but the singular form was
  chosen for our UI.

**#16 — Unclear "default content" in the Select‑kubeconfig file dialog** ✅

- **Verdict — As expected.** The confusing implicit default is gone; nothing done differently.
- **Expected:** Don't open the file dialog in a random extension‑host location; don't invent a kube path.
- **Decision / Code today:** Explicit `defaultUri` resolution order — (1) resolved kubeconfig file if it
  exists, (2) parent kubeconfig dir if it exists, (3) user home. No path is fabricated.

**#4 — "Paste kubeconfig YAML" reads the clipboard without consent** ✅

- **Verdict — As expected.** The reviewable modal consent flow was delivered. Only difference: the buttons
  read **Continue / Preview Clipboard** (the issue sketched **Confirm / Preview content**).
- **Expected:** A reviewable, consented flow before reading/storing clipboard content.
- **Decision / Code today:** A **modal** confirmation with **Continue** and **Preview Clipboard**
  (opens an untitled YAML doc, then aborts so the user can restart). Dismissing reads nothing.
- 💡 **Note for review:** this is the one place the team chose a **modal** for safety. Contrast with the
  error‑surfacing decision in #2/#25 (toast) — see the Flag there.

**#17 — Adding a kubeconfig shows contradicting messages** ✅

- **Verdict — As expected.** Final behavior matches; it was briefly floated as possibly acceptable as‑is,
  then fixed properly.
- **Expected:** When the default kubeconfig is missing/invalid, show only the error/warning — never a
  "source added" success at the same time.
- **Decision / Code today:** Default‑kubeconfig add now **validates before persisting**. Success message
  shows only when it loads and has ≥1 context; otherwise only the warning shows and nothing is added.
- ⚠️ **Flag (history):** this was initially floated as possibly "acceptable as‑is, to discuss next bug
  bash." It was later fixed properly. No action — just be aware the discussion looked undecided for a while.
- ➡️ **Iteration 1 (review feedback) — resolved:** when adding a kubeconfig fails (default, paste, or
  file), the message should be **modal** and should always be framed as an **error**, not a warning —
  the operation could not continue, so it is an error. The three paths were unified accordingly.
  - **Decision / Implemented:** All three add branches (default / file / paste) now surface
    validation/load failures through **`showErrorMessage(…, { modal: true })`**. Previously the default
    branch used a non-modal warning and the file/paste branches used non-modal errors, which was
    inconsistent. The empty-clipboard case was also promoted from a warning to a modal error for the same
    reason. The clipboard **consent** prompt (#4) stays a modal warning — it's a confirmation, not a
    failure. See [addKubeconfigSource.ts](src/plugins/service-kubernetes/commands/addKubeconfigSource.ts).

**#22 — Expand the Kubernetes node when a new source is added** ✅ (verify live)

- **Verdict — As expected.** Done via the `reveal` API as suggested. What was done differently from a
  naive fix: an extra root‑reload step was added to dodge a cache race found in manual testing.
- **Expected:** After adding a source, expand + select the new node (the tree‑view API supports `reveal`).
- **Decision / Code today:** After a successful add, the tree refreshes and **reveals** the new source
  (select/focus/expand). A cache race was found in manual testing and worked around by reloading root
  items before `reveal`; reveal failure is non‑fatal.
- ⚠️ **Verify live:** this is timing‑sensitive — confirm the new source actually expands and is selected,
  including right after a fresh add when caches are cold.

**#26 — Support drag‑and‑drop of kubeconfig files** ✅ (was first deferred)

- **Verdict — As expected (after an initial deferral).** DnD now works. What was done differently: the
  first response deferred it by conflating it with hover‑to‑expand (a genuine API limit); it was ultimately
  delivered as a **tree‑wide drop handler** (not per‑row), which also enables multi‑file drops.
- **Expected:** Drop a kubeconfig YAML onto the Discovery tree to register it (like dropping a `.vsix`
  onto Extensions).
- **Decision / Code today:** Initially blocked (hover‑to‑expand is an unsupported tree‑view API path,
  [vscode#286332](https://github.com/microsoft/vscode/issues/286332)), then implemented as a **drop
  handler** over the whole Discovery tree:
  [DiscoveryViewDragAndDropController](src/tree/discovery-view/) +
  [handleKubeconfigFileDrop.ts](src/plugins/service-kubernetes/commands/handleKubeconfigFileDrop.ts).
  Valid drop → validate + add + reveal + info toast; invalid/dir/duplicate → per‑file warning or silent
  skip. Multi‑file supported.
- ⚠️ **Verify live:** drop a valid file, a non‑kubeconfig file, a directory, a duplicate, and a mixed batch.

**#12 — New‑connection wizard fails silently when no kubeconfig sources are configured** ✅

- **Verdict — As expected.** Delivered exactly as asked, mirroring the Azure plugin's pattern.
- **Expected:** Don't dead‑end the user with a warning toast + a closed wizard. Keep them in flow with an
  always‑present "Add a kubeconfig source…" entry (like Azure's `SelectSubscriptionStep`).
- **Decision / Code today:** `SelectContextStep` always prepends an `alwaysShow` **"Add a kubeconfig
  source…"** item (with a `Separator`); selecting it runs `addKubeconfigSource` inline, then shows a retry
  prompt and exits cleanly instead of dead‑ending. Verified in
  [SelectContextStep.ts](src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts#L40-L50).

### C. Tree structure, labels & icons

**#10 — Discovery root node icon** ✅

- **Verdict — As expected.** Recommended `layers` icon shipped as‑is.
- **Decision / Code today:** Root uses `$(layers)`. Verified in
  [KubernetesRootItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesRootItem.ts#L46-L53).

**#8 → #11 — One consistent icon for kubeconfig source nodes** ✅ (superseded)

- **Verdict — As expected.** A single uniform source icon shipped. What was done differently across the
  pair: #8 first unified on `key`, then #11 changed it to `plug`, and **iteration 2 changed it again to
  `group-by-ref-type`** (reviewer's preference — it reads as "a config that groups one or more clusters").
- **Expected:** A single icon for _all_ source kinds in the **tree** (file/pasted/default), while the
  **wizard** keeps per‑type icons.
- **Decision / Code today:** #8 unified to `key`, #11 changed it to `$(plug)`, and **iteration 2 settled
  on `$(group-by-ref-type)`** for every source kind. Verified `buildIcon()` in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).
- ⚠️ **Minor inconsistency to eyeball (carried to iteration 3):** the in‑wizard "Add Kubeconfig…" entry in
  [SelectContextStep.ts](src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts#L40-L46)
  still uses `plug`, whereas the dedicated Add‑Source picker (#9) uses `home`/`folder-opened`/`clippy`,
  and the tree source nodes now use `group-by-ref-type`. Three surfaces, three icon vocabularies —
  see §8.4.

**#5 — Noisy cluster tree: redundant labels + flat namespace list** ✅ (the centerpiece)

- **Verdict — As expected (evolved).** All three readability goals met. What was done differently from the
  original sketch: empty namespaces aren't merely collapsed in place — they're grouped under a new
  **"Others — DocumentDB not detected"** bucket, and pre‑scan‑failed namespaces are deliberately kept _out_
  of that bucket so their error + Retry stay visible.
- **Expected:** Drop the redundant `(pasted YAML)` source detail; stop burying the one relevant
  namespace under a wall of "No DocumentDB targets" rows; drop the redundant per‑namespace count.
- **Decision / Code today (evolved to a clean model):**
  1. Inline/pasted sources show **no** `(pasted YAML)` description.
  2. Namespaces **with** targets appear directly, **no** "N targets" count.
  3. Confirmed‑empty namespaces are grouped under a collapsed **"Others"** node with detail
     **"DocumentDB not detected"**. Verified
     [KubernetesOtherNamespacesItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesOtherNamespacesItem.ts).
  4. Namespaces whose **pre‑scan failed** stay visible (not hidden in "Others") so the error + **Retry**
     remain reachable.
- 💡 This "Others" bucket is effectively a **third answer** to the `showEmptyNamespaces` question raised
  in #20 (see that item) — neither "always hide" nor "settings toggle," but "group and collapse."
- ➡️ **Iteration 1 (review feedback):** the "Others" node was using the wrong icon — there's a documented
  `folder`-icon problem in the Connections view — and the suggestion was to use a different icon with the
  same shape but a different name.
  - **Research:** The issue is documented in
    [FolderItem.ts](src/tree/connections-view/FolderItem.ts#L61): VS Code’s tree `Aligner.hasIcon()`
    treats `ThemeIcon('folder')` / `('file')` specially and returns `false` under file-icon themes that
    lack folder icons, which both hides the icon and breaks alignment of non-collapsible siblings. The
    Connections view fixed this by using `symbol-folder` (same glyph, non-“file-kind” name).
  - **Decision / Implemented:** The “Others” bucket now uses `ThemeIcon('symbol-folder')` with a comment
    pointing back to the canonical note in `FolderItem.ts`. See
    [KubernetesOtherNamespacesItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesOtherNamespacesItem.ts).

**#18 — Renaming "Default kubeconfig" leaves an uneditable path in the description** ✅

- **Verdict — As expected.** The uneditable path is gone from the default source. What was done
  differently: the open "show it at all?" question was answered **no** for default sources but the path was
  **kept** (shortened) for file sources, where it disambiguates.
- **Expected:** Don't show the resolved path as a tree description on the default source (it can't be
  renamed/hidden); question raised whether to show it at all.
- **Decision / Code today:** Default source shows **no** path description (path moved to tooltip).
  **File** sources still show a shortened `(file: …/x/y)` description because it disambiguates. Verified
  `buildDescription()` in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts#L156-L166).

**#1 — Inline remove (trash) icon is too destructive** ✅

- **Verdict — As expected.** The destructive inline trash was removed and Remove moved to the context
  menu. What was done differently: the **"Open in Editor"** bonus idea was explicitly left out of scope.
- **Expected:** Move destructive **Remove** to the context menu only; keep the inline slot for safe
  actions; the inline rename pencil is debatable but the trash must go. (Bonus idea: an "Open in Editor"
  context entry for file sources.)
- **Decision / Code today:** Inline trash removed. In
  [package.json](package.json#L805-L835): `removeSource` is context‑menu only (`group 1@2`);
  `renameSource` is both context (`1@1`) **and** inline pencil (`inline@1`); `addSource` is inline `+`
  on the root (`inline@0`) and context (`2@0`). The "Open in Editor" idea was noted as **out of scope**.
- ⚠️ **Open idea to consider:** "Open in Editor" for file‑based sources is still unbuilt and is genuinely
  useful when debugging connectivity. Low cost, additive. See Section 4.
- ➡️ **Iteration 1 (review feedback) — resolved:** the suggestion was to remove the inline rename pencil
  (the context menu is enough) and simplify the command labels.
  - **Decision / Implemented:** The **inline rename pencil was removed** (`renameSource` is now
    context-menu only, `group 1@1`); the inline `+` add on the root stays. Command titles were
    simplified to avoid implying a wider rename/delete: **"Rename…"** and **"Remove…"** (previously
    "Rename Kubeconfig Source…" / "Remove Kubeconfig Source"). We deliberately avoid "Rename kubeconfig"
    so users don't fear it renames a file elsewhere on disk. The in-tree recovery docs action was also
    reworded from "Open Kubernetes discovery docs" to **"Learn more about Kubernetes discovery"**. See
    [package.json](package.json) menus/commands and
    [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).

**#7 — `manageKubeconfigSources` uses the wrong API hook (filter vs credentials)** ✅ (resolved by removal)

- **Verdict — Deviation.** What was done differently: the issue asked to **re‑wire** the source‑visibility
  filter onto a proper "filter" API (off the `configureCredentials` hook). Instead the team **removed the
  hide/unhide filter feature entirely** — the reviewer judged that with explicit Add/Remove per source there's
  no need to filter yet (revisit via telemetry later). `manageKubeconfigSources` and the misused
  `configureCredentials` hook are gone; sources are managed only via Add / Remove / Rename.

### D. Tooltips & wording nitpicks

**#6 — Cluster tooltip shows too many fields; "Secret" needs justification** ✅

- **Verdict — As expected.** Tooltip trimmed and the internal **Secret** removed, matching the issue's
  suggested minimal tooltip; nothing done differently.
- **Expected:** Trim to a quick status snapshot; justify or remove the internal K8s **Secret** name.
- **Decision / Code today:** Tooltip trimmed to **Target, Status, External Address, Reachability, Port,
  Provider, Region, Namespace, Context**. **Secret removed** (internal, not actionable, potential
  confusion); diagnostic detail lives in the output channel. Verified `buildTooltip()` in
  [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L493-L517).
  (Removed: Source, Service, Type, NodePort, ClusterIP, Server, DocumentDB.)

**#24 — Kubeconfig tooltip path missing a backslash** ✅

- **Verdict — As expected.** The missing separator is fixed; no difference from intent.
- **Cause/Decision:** Windows path separators were being eaten as Markdown escapes. Paths now render as
  **inline code** (`` `…` ``) in source tooltips. Verified `buildTooltip()` uses backticks in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts#L168-L182).

**#23 — Use platform‑specific config file locations** ✅ (deliberate divergence)

- **Verdict — Deviation.** What was done differently: the reporter asked to move kubeconfig storage to
  OS‑specific _data_ dirs; the team **kept** the standard `KUBECONFIG` → `~/.kube/config` resolution (for
  `kubectl` interop) and changed **only the displayed path** on Windows. Storage location is unchanged.
- **Reporter asked:** Use OS‑specific _data_ dirs (e.g. `~/Library/Application Support/…`, `%APPDATA%\…`).
- **Decision / Code today:** **Did not** move storage locations — kubeconfig resolution stays
  `KUBECONFIG` → Kubernetes default path, for `kubectl`/client interop (correct call). Only the
  **display** changed: Windows shows `%USERPROFILE%\.kube\config`; macOS/Linux show `~/.kube/config`;
  strings say "Kubernetes default kubeconfig path."
- ⚠️ **Verify on Windows:** confirm the collapsed `%USERPROFILE%\.kube\config` renders correctly in the
  tree description/tooltip and the dialog.

### E. Service nodes, reachability & port‑forward transparency

**#21 — Should users see _how_ a service is reachable? (port‑forward transparency)** ✅ (scoped) / 🟡

- **Verdict — As expected (scoped), with one option deferred.** The release‑blocking scope — make
  reachability visible and stop the read‑only copy from starting a tunnel — shipped (Q1 = icon+tooltip+
  description, Q2 = copy+warning). What was **not** done: the optional `kubectl port-forward` / composite
  share snippet (Q2‑B/C), so the teammate‑share gap remains.
- **Problem:** `LoadBalancer` / `NodePort` / `ClusterIP` are architecturally different (direct vs
  node‑routed vs a machine‑local port‑forward tunnel) but looked identical; "Copy connection string"
  for a ClusterIP gives an opaque `127.0.0.1` string that only works locally and even **started a tunnel
  as a side effect** of a "read‑only" copy.
- **Options the issue weighed:**
  - _Q1 (tree visibility):_ A) description badge, B) distinct icons, C) tooltip only, D) icon + tooltip.
  - _Q2 (copy behavior):_ A) copy + warning, B) offer a `kubectl port-forward` command, C) composite
    markdown/script block, D) block copy + explain.
- **Decision / Code today:** Effectively **Q1 = D** and **Q2 = A** (+ partial B groundwork):
  - Service rows now show reachability via **icon + description + tooltip**:
    `LoadBalancer · direct` (`globe`), `LoadBalancer · node-routed` / `NodePort · node-routed` (`server`),
    `ClusterIP · port-forward required` (`plug`), pending/unsupported (`warning`). Verified
    `getReachabilityInfo()`/`buildDescription()`/`buildTooltip()` in
    [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L519-L560).
  - Tooltip has a **Reachability** section explaining the mode, including the machine‑local nature of
    ClusterIP forwarding.
  - **Copy is now read‑only** — copying a discovery service no longer starts a tunnel
    (`portForwardOutcome = 'notStartedForCopy'`); copying a _saved_ port‑forward connection string warns
    that `127.0.0.1` only works on this machine while the tunnel is active. Port‑forward metadata is
    threaded through so a share snippet can be added later.
- 🟡 **Deferred (the team did not ship):** the **`kubectl port-forward` command / composite share
  snippet** (Q2‑B/C). The "share with a teammate" gap from the issue therefore **remains**. See Section 4
  for an options evaluation.

**#20 — VS Code settings for Kubernetes discovery** 🟡 (2 of 5 shipped)

- **Verdict — As expected (scoped by design).** The discussion prioritized the port‑forward local‑port
  pair for the first release and that's exactly what shipped. What was done differently from the full
  proposal: 3 of 5 settings (concurrency, `additionalPorts`, CRD escape hatch) were deferred, and
  `showEmptyNamespaces` was effectively superseded by the "Others" bucket (#5).
- **Discussion:** which hardcoded values deserve settings — namespace prescan concurrency, generic
  discovery ports, empty‑namespace visibility, port‑forward local‑port strategy, DKO CRD version.
- **Decision / Code today (shipped):** only the port‑forward pair, verified in
  [package.json](package.json#L1266-L1287):
  - `documentDB.serviceDiscovery.kubernetes.portForward.localPortStrategy` = `matchRemote` (default) | `autoSelect`
  - `documentDB.serviceDiscovery.kubernetes.portForward.localPortBase` = `27100` (used by `autoSelect`)
    `autoSelect` scans up to 100 candidate ports on `127.0.0.1` and falls back to the remote port if none
    are free. Logic in
    [promptForLocalPort.ts](src/plugins/service-kubernetes/promptForLocalPort.ts#L40-L64).
- 🟡 **Deferred (intentionally):** `namespaceScanConcurrency` (still hardcoded `5` in
  [KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts#L31)),
  `additionalPorts`, `showEmptyNamespaces`, the DKO CRD‑version escape hatch, and telemetry for the
  strategy choice.
- 💡 **Note:** discussion question #4 (`showEmptyNamespaces` as a setting vs an inline "Show all
  namespaces" action) was effectively answered by the **"Others" grouping** (#5) instead — empty
  namespaces are reachable but collapsed, so a setting may no longer be needed. Worth confirming the
  reviewer agrees the "Others" bucket covers the troubleshooting use case.

### F. Errors, recovery & refresh behavior

**#2 — Error message shown as a tree node mixed with action nodes** ✅ / ⚠️

- **Verdict — As expected at the time, later partially reversed by #25.** The passive error row was removed
  and only actionable children remain, as asked. What changed afterwards: #25 asked to make the
  notification modal and to drop the "Remove" child — neither shipped (see #25).
- **Expected:** Surface the error as a **notification** (not a passive tree row); keep only the
  _actionable_ children: Remove, Open docs, Retry.
- **Decision / Code today:** The non‑interactive error row was removed; the error is shown via
  `showWarningMessage()` (toast) and logged to the output channel; the three actionable children remain.
  Verified `createKubeconfigRecoveryChildren()` in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts#L107-L142).
- ⚠️ **Contradiction with #25 (see below):** issue #2 deliberately kept "Remove this kubeconfig source"
  as a recovery child, but in #25 the reviewer later asked to **remove** it (it's already in the context
  menu) and to make the error notification **modal**. Neither of those two follow‑ups shipped — the
  toast is still non‑modal and "Remove this kubeconfig source" is still a recovery child.
- ➡️ **Iteration 1 (review feedback) — resolved:** the suggestion was to drop the "Remove this kubeconfig
  source" node.
  - **Decision / Implemented:** The “Remove this kubeconfig source” recovery child was deleted from
    `createKubeconfigRecoveryChildren()`; Remove now lives **only** in the context menu. The recovery
    list is now a pure “fix-forward” toolkit (retry + docs). See
    [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).
    Together with the modal change (#25) this **clears both #2/#25 contradictions** flagged above.

**#19 — Refresh on a failed discovery config re‑runs discovery** ✅

- **Verdict — As expected.** Refresh reuses cached error nodes; only Retry re‑runs discovery — exactly the
  designed behavior.
- **Expected:** A plain **Refresh** on an error node should reuse cached error nodes (avoid slow
  re‑discovery); only **Retry** should clear the error cache and re‑run.
- **Decision / Code today:** Source/context/namespace items expose retry‑node detection
  ([retryNodeDetection.ts](src/plugins/service-kubernetes/discovery-tree/retryNodeDetection.ts)); Refresh
  keeps cached error children, only Retry clears them. Covers failed source load, failed context/namespace
  listing, and failed service listing.
- ➡️ **Iteration 1 (review feedback) — resolved:** the refresh/retry action should be worded the same as
  the other retry error nodes in the Connections view, for consistency, and should also be the first node,
  as it is in the Connections view.
  - **Decision:** Match the Connections-view canonical retry node
    ([ClusterItemBase.ts](src/tree/documentdb/ClusterItemBase.ts#L203-L207)): label **“Click here to
    retry”** with the `refresh` icon, surfaced as the **first** child of every error state. This
    supersedes the earlier source-only “Reload” rename from #25.
  - **Implemented:** Retry node moved to first position and relabeled “Click here to retry” in the
    source recovery children
    ([KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts)),
    the context-level error children
    ([KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts)),
    and the namespace/service-level error children
    ([KubernetesNamespaceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesNamespaceItem.ts)).
    The classified error-summary node is retained but now sits **below** the retry action.

**#25 — "What does Retry do here?"** ✅ rename / ⚠️ two review asks NOT shipped

- **Verdict — Deviation.** What was done differently: only part of the ask shipped. The **Retry → Reload**
  rename plus progress/success feedback landed on the source node, but the reviewer's two explicit follow-ups
  — make the error notification **modal**, and **remove** the in‑tree "Remove this kubeconfig source"
  action — were **not** implemented. This is the headline gap.
- **Reporter:** the "Retry" action on a kubeconfig source seemed to be a no‑op; suggested "Reload" might
  be clearer.
- **Two further asks were added in a comment:** (1) make the error notification **modal**; (2) **remove**
  "Remove this kubeconfig source" from the recovery actions (it's in the context menu already).
- **Decision / Code today:** Only the rename + feedback shipped — on the **source** node the action is now
  **"Reload"** with a status‑bar progress and a success toast ("Reloaded kubeconfig source 'NAME'. Found N
  context(s)."); "Retry" is intentionally kept on **context/namespace** nodes (genuinely transient errors
  like API‑server unreachable / RBAC). Verified the source recovery child labels **"Reload"** in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts#L130-L138).
- ⚠️ **The two review asks are unaddressed** — verified in current code:
  - The error is still a **non‑modal** `showWarningMessage()` (not modal). [line ~108]
  - **"Remove this kubeconfig source"** is still listed as a recovery child. [line ~117]
    These are the clearest "stated intent vs shipped code" gaps in the whole set — confirm with the team
    whether they were dropped on purpose or slipped.
- ➡️ **Iteration 1 (review feedback) — resolved:** the suggestion was to make it modal on expand and on
  retry, noting there's no risk of modal spam because the error-node cache prevents multiple actions on
  tree refresh.
  - **Decision / Implemented:** The kubeconfig-source error notification is now **modal**
    (`showWarningMessage(…, { modal: true })`). Because the retry-node cache (#19) stops `getChildren()`
    from re-running on passive refreshes, the modal fires only on a real load attempt (expand or
    “Click here to retry”) and cannot stack. See
    [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).
  - This **resolves the first #25 review ask**. The second ask (remove the in-tree “Remove this kubeconfig
    source” node) is resolved separately under #2 below.

### G. Backend bugs that affect the UX experience (fixed)

These aren't "wording/tree structure" items, but the reviewer will feel them while testing:

- **#15 — Paste kubeconfig fails: `Cannot find module 'socks'`** — **As expected (fix):** fixed (bundling).
- **#14 — Paste kubeconfig fails: `Cannot access 'KubeConfig' before initialization`** — **As expected (fix):** fixed.
- **#29 — DocumentDB Shell error formatting (staircase / missing newlines)** ✅ — **As expected (fix):** `writeLine` now
  CRLF‑normalizes the whole payload, not just the terminator. Unrelated to K8s but on the same branch.
- **#30 — Port forwarding not working after extension restart** ✅ (defensive) — **Deviation (defensive / unverified):**
  the issue had **no repro**, so rather than fixing a confirmed behavior the team hardened the most plausible cause —
  EADDRINUSE bind‑retry, cancellation checks at every async boundary, and output‑channel diagnostics. ⚠️ If the symptom
  recurs, the new `[KubernetesDiscovery]` logs will pinpoint it. Worth a deliberate "reload window while a ClusterIP
  tunnel is active" test.

### H. Won't‑fix (this branch)

- **#27 — Colors hard to read in the query table** 🚫 — **Deviation (won't‑fix):** the reporter expected a contrast
  fix; none was made on this branch (hardcoded‑ish, tied to a future table‑component update). Reviewer may still want
  to note current contrast for the backlog.
- **#28 — Double‑click rows in the tree to expand** 🚫 — **Deviation (won't‑fix):** double‑click‑to‑expand was not
  added; closed citing a tree‑view API limitation / pending table‑component work.
  - ⚠️ **Worth a second look:** the cited limitation is firmly true for _hover‑to‑expand_ (#26,
    [vscode#286332](https://github.com/microsoft/vscode/issues/286332)), but **double‑click‑to‑expand** is
    a different interaction and is arguably standard tree behavior. If easy, it improves discoverability.

---

## 3. Consolidated flags & contradictions (read this before testing)

| #           | Flag                                                                                                                                  | Why it matters                                                                                            | Suggested check                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| #25 / #2    | ✅ **Resolved (iteration 1).** Error notification is now **modal**; the in‑tree **"Remove this kubeconfig source"** node was removed. | Both review asks from #25 are now shipped (see §7.1).                                                     | Trigger a failing source (rename `~/.kube/config` away): confirm the warning is modal and "Remove" is gone from the in‑tree recovery actions. |
| #2 vs #25   | ✅ **Resolved (iteration 1).** "Remove" no longer appears in the recovery children; it lives only in the context menu.                | The #25 reversal has now been applied.                                                                    | Confirm Remove is reachable from the context menu but absent from the error/recovery list.                                                    |
| #2          | Modal fires inside `getChildren()` of a failing source.                                                                               | With the #19 retry‑cache, confirm the modal doesn't **re‑fire on every Refresh** (only on real (re)load). | Expand a broken source, hit Refresh repeatedly, watch for repeated modals.                                                                    |
| #21         | **Share‑with‑teammate gap remains** — no `kubectl port-forward` / composite snippet for ClusterIP.                                    | The issue's core "portability" concern is only half‑solved (warned, not actionable).                      | See the detailed options in **§7.2** (recommendation: ship Option B).                                                                         |
| #20         | Settings frozen at the two `portForward.*` keys; `showEmptyNamespaces` replaced by the "Others" bucket.                               | Reviewer should confirm "Others" satisfies the troubleshooting need so the setting can stay dropped.      | See **§7.4** for the per-setting verdicts. Try to find a service in a namespace that pre‑scans empty; is "Others" discoverable enough?        |
| #13         | ✅ **Resolved (iteration 1).** Migration removed entirely; visible = all − hidden, default hidden = `[]`.                             | There is no migration left to verify — older state keys are ignored and everyone starts all‑visible.      | Fresh install shows all providers; hiding one and reopening keeps it hidden.                                                                  |
| #8/#9       | Two different "add source" pickers use different icon sets (`plug` vs `home/folder-opened/clippy`).                                   | Minor visual inconsistency.                                                                               | Eyeball both entry points.                                                                                                                    |
| #22/#26/#30 | Timing‑/race‑sensitive behaviors (reveal‑on‑add, DnD, restart).                                                                       | Verified by tests but worth live confirmation.                                                            | Exercise each manually.                                                                                                                       |
| #23         | Divergence from reporter (kept kube default path; only display changed).                                                              | Correct call, but Windows display path needs a visual check.                                              | Verify `%USERPROFILE%\.kube\config` renders right.                                                                                            |

---

## 4. Open ideas — options, pros & cons

These are the genuinely open design questions. Recommendations are suggestions for the reviewer/team to
react to, not decisions.

### 4.1 Error surfacing for a failed kubeconfig source — modal vs toast vs inline (#2 / #25)

> ✅ **Resolved in iteration 1 (Option A — modal).** The reviewer confirmed the literal ask: the error is
> now a **modal** `showWarningMessage(…, { modal: true })`. The modal-spam risk that made A unattractive
> is neutralized by the #19 retry-node cache — a broken source is only (re)loaded on an explicit action
> (expand or "Click here to retry"), never on passive refresh, so at most one modal fires per real
> attempt. Option D (toast-on-user-action) is no longer needed; the table below is retained for the
> record.

The reviewer asked for **modal**; iteration 1 shipped **modal**.

| Option                                                                               | Pros                                                            | Cons                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A. Modal warning** (review ask)                                                    | Impossible to miss; forces acknowledgment                       | Interrupts flow; annoying if it fires on expand/refresh of a known‑broken source; modal spam if several sources fail |
| **B. Toast (current)**                                                               | Non‑blocking; consistent with VS Code norms                     | Easy to miss; transient; can repeat if `getChildren()` re‑runs                                                       |
| **C. Quiet inline + output channel only**                                            | Zero noise; detail on demand                                    | Reverts the #2 improvement; users may not notice the error at all                                                    |
| **D. Toast on _user‑initiated_ load only** (add / Reload), silent on passive refresh | Best signal‑to‑noise; loud when the user acted, quiet otherwise | Slightly more logic to distinguish trigger source                                                                    |

> **Suggested:** **D**. It honors #2 (visible error), avoids modal fatigue, and naturally pairs with the
> #25 "Reload" affordance. If the team insists on the reviewer's literal ask, make the modal fire **only**
> on explicit Reload, not on passive expand/refresh.

### 4.2 "Remove" in the recovery children (#2 / #25)

> ✅ **Resolved in iteration 1 (Option "Remove it").** The reviewer confirmed the preference to drop the
> in-tree "Remove this config source" node. The recovery list is now Reload + Docs only; Remove stays in
> the context menu. The **"Open in Editor" for file sources** idea (third row) remains an open, additive
> follow-up — see the unresolved-ideas note below.

| Option                                                                         | Pros                                                                        | Cons                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Keep it (current)**                                                          | One‑click recovery when a source is broken; discoverable                    | Duplicates the context menu; #25 explicitly wanted it gone; mildly destructive in a recovery list |
| **Remove it (review ask)**                                                     | De‑duplicates; recovery list = pure "fix forward" (Reload, Docs)            | Slightly less convenient for "this source is junk, delete it"                                     |
| **Replace with "Open in Editor" (file sources) + keep Remove in context menu** | Turns the recovery list into a _fixing_ toolkit; folds in the #1 bonus idea | A bit more work; not applicable to pasted sources                                                 |

> **Suggested:** Remove inline "Remove" per #25, and consider adding **"Open in Editor"** for file
> sources (the #1 bonus) so the recovery node helps users _fix_ rather than _delete_.
>
> ✅ **Resolved (iteration 2).** Shipped **both** surfaces for file sources: an **"Open in Editor"**
> recovery child _and_ a context-menu entry, scoped via the `discovery.kubernetesSourceFile`
> context-value marker. Pasted/inline and default sources don't show it (no editable on-disk file). The
> recovery list is now Reload → Open in Editor (file only) → Learn more. See
> [openKubeconfigInEditor.ts](src/plugins/service-kubernetes/commands/openKubeconfigInEditor.ts).

### 4.3 ClusterIP "share with a teammate" snippet (#21 deferred)

The metadata is already threaded through; only the surface is missing.

| Option                                               | Pros                                                      | Cons                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| **A. Copy + warning (current)**                      | Simplest; honest about machine‑local scope                | Teammate still can't reproduce the tunnel                            |
| **B. Add "Copy kubectl port‑forward command"**       | Directly actionable for teammates; uses existing metadata | A second copy action to discover; assumes `kubectl` + context access |
| **C. Composite block (kubectl + connection string)** | One paste reproduces the whole setup                      | Multi‑line clipboard can surprise; needs clear formatting            |
| **D. Block copy + explain**                          | Prevents sharing a broken string                          | Heavy‑handed; removes a working local convenience                    |

> **Suggested:** **B** as a follow‑up — a `Copy kubectl port-forward command` entry on ClusterIP service
> nodes. It closes the issue's core concern with minimal UX weight and reuses metadata already stored.
>
> **Iteration 2 context:** still open and deferred (no code in iteration 1). A full options breakdown,
> including the exact `kubectl` snippet shape and where it should live, is in **§7.2** below.

### 4.4 Double‑click to expand tree rows (#28, won't‑fix)

| Option                                                               | Pros                                          | Cons                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Leave as‑is (twistie only)**                                       | No work; avoids accidental expansion concerns | Misses a common tree convention; minor friction                                         |
| **Enable double‑click‑to‑toggle** (if API allows for this node type) | Matches user muscle memory                    | Needs to confirm it's actually achievable and doesn't trigger connect/auth side effects |

> **Suggested:** Re‑confirm whether the API limitation truly applies to _double‑click_ (vs the
> _hover‑expand_ limitation that blocked #26). If achievable without side effects, it's a cheap win;
> otherwise the won't‑fix stands.

---

## 5. Suggested hands‑on review checklist

A practical order to walk the feature and exercise everything above:

1. **Cold start, no Kubernetes:** confirm the Kubernetes root shows only **"Add kubeconfig source…"**
   (no broken default) — #3. Confirm all discovery providers are visible by default — #13.
2. **Add via wizard:** open the Add‑Source picker — check `detail` text wraps and per‑type icons
   (`home`/`folder-opened`/`clippy`) — #9. For the file option, confirm the dialog opens at a sane
   location — #16.
3. **Paste YAML:** confirm the **modal** with **Continue** / **Preview Clipboard**; dismiss reads
   nothing — #4.
4. **Reveal on add:** after adding, the new source should auto‑expand + select — #22.
5. **Drag‑and‑drop:** drop a valid kubeconfig, a non‑kubeconfig, a directory, a duplicate — #26.
6. **Tree readability:** source nodes use one `plug` icon, no `(pasted YAML)` suffix — #5/#8/#11;
   default source has no path in its description but does in the tooltip — #18; root is `layers` — #10.
7. **Expand a context:** namespaces with targets appear directly (no counts); empty ones are collapsed
   under **"Others — DocumentDB not detected"**; a pre‑scan‑failed namespace stays visible with a
   **Retry** — #5/#19.
8. **Service node:** check the reachability description/icon per type and the trimmed tooltip (no
   **Secret** field, Reachability section present) — #6/#21.
9. **Copy connection string** on a ClusterIP service: confirm it does **not** start a tunnel, and that
   copying a saved port‑forward string warns about machine‑local scope — #21. _(Note the missing
   teammate‑share snippet — 4.3.)_
10. **Break a source** (rename `~/.kube/config` away): confirm error handling — the notification is now
    **modal**, **"Remove this kubeconfig source" is gone** from the recovery list (Remove lives in the
    context menu), and the first recovery child reads **"Click here to retry"** with the error summary
    below it — #2/#19/#25. Context/namespace error states also lead with **"Click here to retry"**. Hit
    **Refresh** repeatedly and confirm the modal does **not** re‑fire (only on expand / explicit retry).
11. **Settings:** verify only `portForward.localPortStrategy` and `portForward.localPortBase` exist;
    exercise `autoSelect` with a busy port — #20.
12. **Restart test:** with an active ClusterIP tunnel, reload the window and reconnect — #30.
13. **Wizard with zero sources:** New Connection → Service Discovery → Kubernetes with nothing
    configured should offer **"Add Kubeconfigs…"** inline (not a dead‑end toast) — #12/#3.
14. **Windows display:** confirm `%USERPROFILE%\.kube\config` renders correctly — #23/#24.
15. **Shell:** trigger a query error and confirm multi‑line errors aren't a "staircase" — #29.
16. **Won't‑fix sanity:** note query‑table contrast (#27) and double‑click expand (#28) for the backlog.

---

## 6. Appendix — full issue index

| #   | Title                                                   | Label                         | UX area          | State                                    | Verdict                                 |
| --- | ------------------------------------------------------- | ----------------------------- | ---------------- | ---------------------------------------- | --------------------------------------- |
| 1   | Inline remove icon too destructive                      | —                             | tree actions     | ✅ done                                  | As expected                             |
| 2   | Error message shown as tree node mixed with actions     | —                             | error UX         | ✅ done (modal + Remove dropped, iter 1) | As expected; #25 asks shipped in iter 1 |
| 3   | "Default kubeconfig" shown even when file missing       | —                             | empty state      | ✅ done; add action renamed (iter 1)     | As expected                             |
| 4   | "Paste kubeconfig YAML" reads clipboard without consent | —                             | consent flow     | ✅ done (modal)                          | As expected                             |
| 5   | Cluster tree noisy: redundant labels + flat namespaces  | release‑blocking              | tree structure   | ✅ done; Others icon fixed (iter 1)      | As expected (evolved)                   |
| 6   | Tooltip too many fields; "Secret" needs justification   | —                             | tooltip          | ✅ done                                  | As expected                             |
| 7   | `manageKubeconfigSources` uses wrong API hook           | —                             | source mgmt      | ✅ feature removed                       | Deviation (removed, not rewired)        |
| 8   | Inconsistent source icons add noise                     | —                             | tree icons       | ✅ superseded by #11                     | As expected                             |
| 9   | Add‑source picker missing icons / wrong fields          | —                             | wizard           | ✅ done                                  | As expected                             |
| 10  | Discovery root node icon                                | —                             | tree icon        | ✅ `layers`                              | As expected                             |
| 11  | Kubeconfig source node unified icon                     | —                             | tree icon        | ✅ `plug`                                | As expected                             |
| 12  | New‑connection wizard fails silently with no sources    | —                             | wizard flow      | ✅ done                                  | As expected                             |
| 13  | Make all discovery plugins visible by default           | can‑be‑patch                  | visibility       | ✅ done; migration removed (iter 1)      | As expected (simplified)                |
| 14  | Paste fails: `KubeConfig` before initialization         | —                             | backend bug      | ✅ fixed                                 | As expected (fix)                       |
| 15  | Paste fails: `Cannot find module 'socks'`               | —                             | backend bug      | ✅ fixed                                 | As expected (fix)                       |
| 16  | Unclear "default content" in file dialog                | release‑blocking              | wizard           | ✅ done                                  | As expected                             |
| 17  | Adding kubeconfig shows contradicting messages          | release‑blocking              | wording          | ✅ done                                  | As expected                             |
| 18  | Default kubeconfig path not removable from description  | can‑be‑patch                  | tree label       | ✅ done                                  | As expected                             |
| 19  | Refresh re‑runs discovery on failed config              | release‑blocking              | refresh behavior | ✅ done; retry node reworded (iter 1)    | As expected                             |
| 20  | Discuss & design VS Code settings                       | discussion                    | settings         | 🟡 2 of 5 shipped                        | As expected (scoped)                    |
| 21  | Port‑forward transparency                               | discussion / release‑blocking | reachability     | ✅ scoped / 🟡 share snippet deferred    | As expected (scoped)                    |
| 22  | Expand the K8s node when a new item is added            | release‑blocking              | tree behavior    | ✅ done (verify live)                    | As expected                             |
| 23  | Use platform‑specific config file locations             | release‑blocking              | paths            | ✅ display‑only (divergence)             | Deviation (display‑only)                |
| 24  | Small kubeconfig tooltip nitpick (missing `\`)          | can‑be‑patch                  | tooltip          | ✅ done                                  | As expected                             |
| 25  | What does "Retry" do here?                              | release‑blocking              | wording/behavior | ✅ done (modal + Remove dropped, iter 1) | As expected (resolved in iteration 1)   |
| 26  | Support DnD of kubeconfig files                         | can‑be‑patch                  | input            | ✅ done (was deferred)                   | As expected                             |
| 27  | Colors hard to read in query table                      | wontfix                       | table contrast   | 🚫 won't‑fix                             | Deviation (won't‑fix)                   |
| 28  | Double‑click rows in tree view                          | wontfix                       | tree behavior    | 🚫 won't‑fix                             | Deviation (won't‑fix)                   |
| 29  | DocumentDB Shell errors formatting                      | —                             | shell output     | ✅ fixed                                 | As expected (fix)                       |
| 30  | Port forwarding not working after restart               | release‑blocking              | tunnel lifecycle | ✅ defensive fix                         | Deviation (defensive/unverified)        |

---

## 7. Feedback iteration 1 — decisions, implementation & open discussions

This chapter captures the **first round of review feedback** on the review pack above, what was decided,
what shipped (one dedicated commit per change), and the deeper design discussions that were explicitly
requested for the **second iteration**. Inline notes were also added to the relevant items in §2/§4.

### 7.1 What shipped in iteration 1 (changelog)

| #    | Review feedback                                                                                    | Decision                                                                               | Commit summary                                                 |
| ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| root | Discovery root should read **"Kubernetes Clusters"** (field-standard), not just "Kubernetes".      | Rename root + provider label.                                                          | `rename discovery root node to 'Kubernetes Clusters'`          |
| #3   | "Add kubeconfig source" is not UX-friendly; use field-standard naming; fallback "Add Kubeconfig…". | Adopt the field-standard verb; later singularized to **"Add Kubeconfig…"** (see 7.1b). | `use field-standard 'Add Kubeconfigs…' label`                  |
| #13  | Redo visibility: all providers always visible, store only the **hidden** list, **no migration**.   | Remove the legacy migration entirely; default hidden = `[]`.                           | `drop provider-visibility migration; hidden list only`         |
| #5   | "Others" node uses the buggy `folder` icon; use the same-shape, different-name icon.               | Use `symbol-folder` (per the documented Connections-view fix).                         | `use 'symbol-folder' icon on Others node`                      |
| #2   | Get rid of the in-tree **"Remove this kubeconfig source"** node.                                   | Delete it; Remove stays in the context menu.                                           | `drop 'Remove this kubeconfig source' recovery node`           |
| #19  | Refresh/retry wording should match the Connections view and be the **first** node.                 | Use **"Click here to retry"** + move it first across all K8s error states.             | `reword retry node to 'Click here to retry' and show it first` |
| #25  | Error notification should be **modal** on expand and retry.                                        | Make `showWarningMessage` modal; the #19 cache prevents modal spam.                    | `show kubeconfig source error as a modal on load/retry`        |

**Naming research (for #3 / root).** Established Kubernetes desktop tooling is the field reference for
kubeconfig management. Such tools commonly use: a root node **"Kubernetes Clusters"**, a group
**"Local Kubeconfigs"**, and add actions along the lines of **"Add Kubeconfigs"** (the add/paste button),
**"Add from filesystem"** (browse a file on disk), and **"Manually add a kubeconfig"** (paste raw YAML).
We adopted **"Kubernetes Clusters"** for the root and
**"Add Kubeconfigs…"** for the consolidated add action; the per-branch picker entries (default / file /
paste) keep their own descriptive labels.

### 7.1b Second batch of iteration-1 fixes (wording & error consistency)

A follow-up round of review feedback on the same iteration refined wording and error handling:

| Area               | Review feedback                                                                                                                                                 | Decision / Implementation                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add label          | "Add Kubeconfigs…" — drop the plural "s".                                                                                                                       | Singularized to **"Add Kubeconfig…"** in the command title, empty-state action, in-wizard entry, and picker placeholder.                                                                                                                                      |
| Rename command     | Don't say "Rename Kubeconfig Source"; users may fear it renames a file elsewhere.                                                                               | Simplified to **"Rename…"** (context menu only).                                                                                                                                                                                                              |
| Remove command     | Same concern.                                                                                                                                                   | Simplified to **"Remove…"**.                                                                                                                                                                                                                                  |
| Inline rename      | The inline pencil is unnecessary; the context menu is enough.                                                                                                   | **Removed** the `renameSource` inline action (`inline@1`); kept the context-menu entry.                                                                                                                                                                       |
| Recovery docs node | "Open Kubernetes discovery docs" reads like a generic file-open.                                                                                                | Reworded to **"Learn more about Kubernetes discovery"**.                                                                                                                                                                                                      |
| Add errors         | Adding a kubeconfig should fail with a **modal** dialog (it was non-modal), and always as an **error** (paste used error, default used warning — inconsistent). | All three branches (default / file / paste) now use **`showErrorMessage(…, { modal: true })`**; the empty-clipboard case was promoted to a modal error too. The clipboard **consent** prompt (#4) stays a modal warning — it's a confirmation, not a failure. |

> **Rationale for "always an error":** every one of these paths ends in `UserCancelledError` — the add
> could not complete. A warning implies "proceeding with a caveat"; here nothing was added, so an error
> dialog ("we weren't able to continue") is the honest signal. Making it modal guarantees the user sees
> why the add aborted instead of a toast that may be missed.

### 7.1c Iteration 2 — implemented decisions

A third round acted on three of the open discussions below:

| Ref              | Decision                                                                | Implementation                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7.3 / #23       | Reword the unclear "Kubernetes default kubeconfig path" (Option **C**). | Default picker entry → **"Use my default kubeconfig"** with the concrete path + `KUBECONFIG` note in `detail`; both default-branch error dialogs name the resolved path; tooltip drops the jargon. |
| §7.4 / #20       | Freeze the settings surface; drop deferred settings from the backlog.   | Kept the two `portForward.*` keys; `namespaceScanConcurrency` stays a hardcoded `5` with a comment marking it a deliberate non-setting; `showEmptyNamespaces` dropped (Others bucket).             |
| §4.2 / §7.5 / #1 | Add **"Open in Editor"** for file sources (recovery + context menu).    | New `openKubeconfigInEditor` command; `discovery.kubernetesSourceFile` context-value marker scopes the context-menu entry and recovery child to file sources only.                                 |

### 7.2 Discussion — #21 ClusterIP "share with a teammate" snippet (still deferred)

**The gap.** A ClusterIP target is only reachable through a **machine-local** `port-forward` tunnel.
Copying its connection string yields a `127.0.0.1:<port>` URI that works on this machine only while the
tunnel is alive. The metadata needed to reproduce the tunnel elsewhere (namespace, context, service,
remote port) is already threaded through the model — only the **surface** to share it is missing.

| Option                                     | What the user copies                                                              | Pros                                                                                 | Cons                                                                                   | Cost    |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------- |
| **A. Copy + warning (current)**            | `mongodb://127.0.0.1:<port>/…` + a warning toast                                  | Honest about machine-local scope; zero new UI                                        | Teammate cannot reproduce the tunnel; the string is "broken" off this machine          | shipped |
| **B. "Copy kubectl port-forward command"** | `kubectl --context <ctx> -n <ns> port-forward svc/<svc> <local>:<remote>`         | Directly actionable; teammate runs one command then connects; reuses stored metadata | Second copy action to discover; assumes the teammate has `kubectl` + context access    | low     |
| **C. Composite block**                     | the `kubectl` command **and** the connection string, as one markdown/script block | One paste reproduces the entire setup                                                | Multi-line clipboard can surprise; needs careful formatting and a clear comment header | medium  |
| **D. Block copy + explain**                | nothing — copy is disabled with an explanation                                    | Prevents sharing a string that only works locally                                    | Heavy-handed; removes a genuinely useful local convenience                             | low     |

> **Recommendation (iteration 2):** ship **B** as an additive context-menu entry on ClusterIP service
> nodes — **"Copy kubectl port-forward command"** — alongside the existing copy. It closes the
> portability concern with the least UX weight, needs no new data plumbing, and degrades gracefully (a
> teammate without `kubectl`/context access is no worse off than today). Keep **A** as the default
> connection-string copy. Defer **C** unless a teammate-onboarding flow demands a single paste; avoid
> **D** (it removes a working local convenience).
>
> 🔄 **Superseded by §8.1 (review decision).** Rather than a standalone "Copy kubectl port-forward
> command" entry, the reviewer chose to fold all share/copy options into a **single "Copy…" quick pick** on
> the ClusterIP node (connection string with/without password, the `kubectl port-forward` command, and a
> **Learn more** link to a dedicated manual section). See §8.1 for the consolidated decision and the docs
> work item.

### 7.3 Discussion — #23 "Kubernetes default kubeconfig path" wording (reconsider)

**The complaint.** The phrase **"Kubernetes default kubeconfig path"** (used in the default-source
picker entry, its detail text, and warnings) is unclear to users. It tries to compress two ideas —
"we honor the `KUBECONFIG` environment variable" **and** "otherwise we use the standard
`~/.kube/config`" — into one noun phrase, and the result reads like internal jargon.

What the code actually resolves (unchanged, correct for `kubectl` interop): **`KUBECONFIG` env var →
`~/.kube/config`** (shown as `%USERPROFILE%\.kube\config` on Windows).

| Option                                           | Example wording                                                                                                                | Pros                                                                   | Cons                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. Keep "Kubernetes default kubeconfig path"** | _Uses the KUBECONFIG environment variable or Kubernetes default kubeconfig path_                                               | No work                                                                | The wording users flagged as unclear                                           |
| **B. Show the concrete resolved path**           | _Default kubeconfig — `~/.kube/config`_ (or the Windows form), with the `KUBECONFIG` note moved to the tooltip                 | Concrete and recognizable; users see exactly which file                | The literal path can be long; still need to mention `KUBECONFIG` somewhere     |
| **C. Plain-language label + path in detail**     | label **"Use my default kubeconfig"**; detail _"`~/.kube/config`, or the file named by the `KUBECONFIG` environment variable"_ | Reads naturally; primary label is intent, detail carries the precision | Slightly longer detail line                                                    |
| **D. "System kubeconfig"**                       | label **"System kubeconfig"**                                                                                                  | Short                                                                  | "System" is arguably less accurate than "default"; doesn't convey `KUBECONFIG` |

> **Recommendation (iteration 2):** **C**. Lead with intent (**"Use my default kubeconfig"**), put the
> concrete `~/.kube/config` / `%USERPROFILE%\.kube\config` path and the `KUBECONFIG` caveat in the
> `detail`/tooltip. This keeps the (correct) resolution behavior from #23 while replacing the jargon with
> language a user can act on.
>
> ✅ **Implemented (Option C).** The default picker entry now reads **"Use my default kubeconfig"** with
> detail **"`<path>`, or the file named by the KUBECONFIG environment variable"**; the two default-branch
> error dialogs now name the concrete resolved path (`Your default kubeconfig (<path>) could not be
loaded…` / `No Kubernetes contexts were found in your default kubeconfig (<path>)…`); and the default
> source tooltip drops the "Kubernetes default kubeconfig path" jargon in favor of "Resolved from the
> `KUBECONFIG` environment variable, otherwise your default kubeconfig." See
> [addKubeconfigSource.ts](src/plugins/service-kubernetes/commands/addKubeconfigSource.ts) and
> [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).

### 7.4 Discussion — #20 settings: keep the "Others" bucket; which settings are still worth adding

The **"Others — DocumentDB not detected"** bucket (#5) is confirmed as the right model for empty
namespaces, which retires the `showEmptyNamespaces` setting. Re-evaluating the original five proposed
settings against that decision:

| Proposed setting                                              | Verdict                       | Reasoning                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `portForward.localPortStrategy` + `portForward.localPortBase` | **Keep (shipped)**            | Genuinely user-specific (port collisions differ per machine); already in `package.json`.                                                                                                                                                                           |
| `showEmptyNamespaces`                                         | **Drop**                      | Superseded by the "Others" bucket — empty namespaces are reachable but collapsed, so a toggle adds configuration surface with little benefit.                                                                                                                      |
| `namespaceScanConcurrency`                                    | **Drop (keep hardcoded `5`)** | A performance knob most users can't reason about; `5` is a safe default. Revisit only if telemetry shows large-cluster prescan latency. Currently hardcoded in [KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts). |
| `additionalPorts` (generic discovery ports)                   | **Defer**                     | Only matters for non-standard service ports; no demand signal yet. Add when a concrete request appears.                                                                                                                                                            |
| DKO CRD-version escape hatch                                  | **Defer**                     | Operator-version-specific; better handled by detection than a user setting. Revisit if a CRD-version mismatch is reported in the field.                                                                                                                            |

> **Recommendation (iteration 2):** freeze the settings surface at the two `portForward.*` keys for
> launch. Explicitly **drop** `showEmptyNamespaces` (the "Others" bucket replaces it) and
> `namespaceScanConcurrency` from the backlog unless telemetry justifies them; keep `additionalPorts` and
> the CRD escape hatch as demand-driven follow-ups. Adding settings later is non-breaking; removing a
> shipped setting is not — so the bias is to stay minimal.
>
> ✅ **Processed as recommended.** The settings surface is frozen at the two `portForward.*` keys.
> `namespaceScanConcurrency` stays a hardcoded `5` with an explanatory comment marking it a deliberate
> non-setting (see
> [KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts));
> `showEmptyNamespaces` is dropped (superseded by the "Others" bucket); `additionalPorts` and the CRD
> escape hatch remain demand-driven follow-ups.

### 7.5 Iteration 2 — closed

Iteration 2 is **closed**. Summary of what landed across iterations 1–2 and what was deliberately
deferred:

- **"Open in Editor" for file sources (#1 / #2 / §4.2).** ✅ **Implemented.** Exposed in **both** the
  context menu and the error-recovery list (file sources only — pasted/default sources have no editable
  on-disk path). Command
  [openKubeconfigInEditor.ts](src/plugins/service-kubernetes/commands/openKubeconfigInEditor.ts),
  context-value marker `discovery.kubernetesSourceFile`, recovery child `open-in-editor`.
- **Default-path wording (#23 / §7.3).** ✅ **Implemented (Option C).** "Use my default kubeconfig" +
  concrete path in `detail`; error dialogs and tooltip de-jargoned.
- **Settings surface (#20 / §7.4).** ✅ **Frozen** at the two `portForward.*` keys; `namespaceScanConcurrency`
  stays a hardcoded non-setting; `showEmptyNamespaces` dropped; `additionalPorts` + CRD escape hatch are
  demand-driven follow-ups.
- **Source-node icon (#8/#11).** ✅ **Changed to `group-by-ref-type`** (replacing `plug`); the in-wizard
  "Add Kubeconfig…" entry was corrected to the **`add`** (plus) icon in iteration 3, since it's an action
  rather than a source (§8.4).
- **Deferred to iteration 3:** the ClusterIP "copy connection details" experience (§8.1). Double-click-to-expand
  (former §4.4) and query-table contrast (#27) are **not** reviewer-requested and are closed/parked (§8.2).

---

## 8. Iteration 3 — open items & discussion

Iterations 1–2 cleared every release-blocking wording/structure/error item raised in the bug bash. What
remains is one **additive, non-blocking** enhancement (§8.1), an icon-parity fix that already landed
(§8.4), two items that are **not reviewer-requested** and are closed/parked (§8.2), and a live-verification
checklist (§8.5). None of these gate launch.

### 8.1 ClusterIP "Copy connection details" — a unified copy quick pick (review decision)

**Review decision.** Don't bolt on a single new "Copy kubectl port-forward command" action. We already
have an established pattern for this in the product:

- A **"Copy reference"**-style quick pick on cluster / database / collection nodes that lets the user
  pick _what_ to copy.
- A **connection-string** flow that offers **with-password / without-password** variants.

> **What to build:** a **single "Copy…" quick pick on the Kubernetes ClusterIP service node** that
> surfaces **all** the relevant options together, so the user understands what's available and chooses
> what they need — rather than copying an opaque `127.0.0.1` string by default. Candidate options to
> include:
>
> - **Connection string (with password)** — the working local string while the tunnel is active.
> - **Connection string (without password)** — safe to share/paste where the secret isn't wanted.
> - **`kubectl port-forward` command** — `kubectl --context <ctx> -n <ns> port-forward svc/<svc> <local>:<remote>`,
>   so a teammate can reproduce the machine-local tunnel.
> - **Learn more** — an entry that opens a **dedicated section in the user manual** explaining why a
>   ClusterIP target is machine-local, what port-forwarding does, and how to share access with a teammate.
>
> 📌 **Work item (docs):** author the **"Connecting to ClusterIP / port-forwarded targets"** section in
> the user manual and wire the **Learn more** option to it. Tracked as a follow-up; the quick pick can
> ship with the link pointing at the section once it exists.

**Where is this active? (scoping)** Two distinct surfaces, and we should be explicit about which one:

| Surface              | Node                                                                       | Today                                                                                                              | Proposal                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Discovery view**   | the discovered Kubernetes target (`KubernetesResourceItem`, before saving) | Copy is currently **excluded** for K8s (see the finding below); only **Save To DocumentDB Connections** is offered | Add the new **"Copy…"** quick pick here, gated on `discovery.kubernetesService`                                                       |
| **Connections view** | a **saved** connection that originated from a K8s target                   | Inherits the standard cluster menu (incl. the existing **Copy Connection String…** with/without-password flow)     | The same port-forward-aware **"Copy…"** quick pick should apply here too, since a saved ClusterIP connection is _still_ machine-local |

> **Answer to "where would this be active — on a saved connection in the Connections view?":** **both.**
> The primary gap is on the **Discovery-view** node (where copy is currently suppressed for K8s), but a
> **saved** K8s connection in the Connections view has the _same_ machine-local port-forward caveat, so
> the unified "Copy…" quick pick (with the `kubectl port-forward` command + Learn more) is just as
> relevant there. The connection is only reachable via a local tunnel regardless of which view you copy
> from — so the experience should be consistent across both. Implementation note: that means wiring the
> quick pick for **both** `view == discoveryView && …discovery.kubernetesService` and the saved-connection
> equivalent in `view == connectionsView`, ideally sharing one command that detects the port-forward
> metadata on the node.

**Why this is the right shape.** It reuses a UX the user already understands (the copy-reference quick
pick), keeps the default copy honest (no silent tunnel side effects — already true after #21), folds the
teammate-share concern (#21) into the same surface instead of a separate command, and the **Learn more**
entry gives the machine-local nuance a permanent home instead of a transient warning toast.

**Prerequisite finding — why the K8s node's menu differs from the vCore discovery node (corrected
answer to the reviewer's question).** The discovered DocumentDB target **does** extend the shared cluster
base, exactly like the Azure vCore discovery node:

- Kubernetes: [`KubernetesResourceItem extends ClusterItemBase<KubernetesClusterModel>`](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L93).
- vCore discovery: [`DocumentDBResourceItem extends ClusterItemBase<AzureClusterModel>`](src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L33).

Both are real cluster nodes (expanding authenticates and lists databases/collections). The menu and icon
differences are **not** because the K8s node is a different/lesser class — they come from two concrete
things the K8s subclass does in its constructor, plus a deliberate menu exclusion:

1. **Context value (drives which menu items match).** `ClusterItemBase` defaults `contextValue` to
   `treeItem_documentdbcluster;experience_<api>`. The vCore discovery item **keeps that default**, so it
   matches all the `treeItem_documentdbcluster` menus. The Kubernetes item **overrides** it
   ([KubernetesResourceItem.ts#L132-L137](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L132-L137))
   to add `documentdbTargetLeaf;discovery.kubernetesService`.
2. **The rich cluster commands explicitly exclude `discovery.kubernetesService`.** In
   [package.json](package.json#L858-L935), **Create Database**, **Copy Connection String**, **Open
   Interactive Shell**, and **Data Migration** are all gated with
   `… && !(viewItem =~ /\bdiscovery\.kubernetesService\b/i)`. So the vCore discovery node (which lacks
   that marker) shows the full menu in the screenshot, while the K8s node is **deliberately filtered
   out** of those four commands. What remains for K8s is **Save To DocumentDB Connections** (the
   discovery `addConnectionToConnectionsView` entry) plus **Create Database** for the
   already-connected/expanded state, etc.
3. **Icon.** The base `getTreeItem()` just renders `this.iconPath`. vCore sets
   `iconPath = AzureDocumentDb.svg`; Kubernetes overrides it to a **reachability** icon
   ([KubernetesResourceItem.ts#L138](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L138):
   `this.iconPath = this.getReachabilityInfo().icon` — `globe`/`server`/`plug`/`warning`). That's why the
   glyph differs. No method in the base class forces the icon; each subclass sets `this.iconPath`.

**So the right question for iteration 3 is intent:** the `!(… discovery.kubernetesService …)` exclusions
were added because **Copy Connection String / Open Interactive Shell / Data Migration assume a directly
reachable cluster**, which a ClusterIP target is not (it needs a machine-local port-forward). Rather than
let those commands silently start a tunnel or hand back an opaque `127.0.0.1` string, they were hidden on
the K8s node. The **"Copy…" quick pick** in §8.1 is the replacement surface that re-introduces copy in a
port-forward-aware way; it needs to be added as a **Discovery-view command gated on
`discovery.kubernetesService` / `documentdbTargetLeaf`**. Worth confirming whether **Open Interactive
Shell** should likewise get a K8s-aware variant (it would need the tunnel up first) or stay hidden.

### 8.2 Not reviewer-requested — closed/parked

Two items previously parked here did **not** originate from the reviewer; they came from bug-bash
participants and are not on the roadmap:

- **Double-click to expand tree rows (bug-bash #28).** Originated as a community bug-bash issue, not an
  review ask. The reviewer does **not** want this. Closed as **won't-fix** (twistie/Enter already expand;
  adding double-click risks accidental connect/auth side effects). No further action.
- **Query-table color contrast (bug-bash #27).** Unrelated to Kubernetes discovery; tracked elsewhere
  with the table-component work. Removed from this review's agenda.

### 8.4 Cross-surface icon parity for "add kubeconfig" — ✅ resolved

There were **three** places a kubeconfig surfaced. The in-wizard entry is an **action** ("add a
kubeconfig"), not a representation of an existing source, so it should read as an action — corrected to
the **`add`** (plus) icon, not the source identity icon:

| Surface                                                                                                                          | Icon                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tree source nodes (an existing source)                                                                                           | `group-by-ref-type`                                                    |
| In-wizard "Add Kubeconfig…" entry ([SelectContextStep.ts](src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts)) | `add` ✅ (was `plug`; an action, not a source)                         |
| Add-Source picker per-type items ([addKubeconfigSource.ts](src/plugins/service-kubernetes/commands/addKubeconfigSource.ts))      | `home` / `folder-opened` / `clippy` (kept — per-type aids recognition) |

> ✅ **Decision / Implemented (corrected).** The in-wizard "Add Kubeconfig…" entry uses **`$(add)`** —
> it's an _action_ that opens the add flow, so the plus icon is the correct semantics (the earlier
> `group-by-ref-type` choice conflated the action with the source-node identity). The tree source nodes
> keep `group-by-ref-type` (they _are_ sources). The dedicated Add-Source picker keeps its per-type icons
> (`home` / `folder-opened` / `clippy`) — they help the user distinguish default vs file vs paste at the
> moment of choosing, which is the one place differentiation is useful.

### 8.5 Live-verification checklist still outstanding

Several iteration-1/2 behaviors are timing- or platform-sensitive and were verified by tests but should
be confirmed by hand before sign-off (these are not new work, just confirmation):

- Reveal-on-add expands and selects the new source from a cold cache (#22).
- Drag-and-drop: valid file, non-kubeconfig, directory, duplicate, mixed batch (#26).
- Windows display of `%USERPROFILE%\.kube\config` in the tree/tooltip/dialog (#23/#24).
- Reload window while a ClusterIP tunnel is active, then reconnect (#30).
- Modal error fires once (not on every passive refresh) for a broken source (#2/#25).

---

## 9. Iteration 3 — planned refactor: cluster-node parity (design, not yet implemented)

This chapter is a **plan** to be reviewed before any code is written. It addresses three coupled issues
on the discovered Kubernetes target node (`KubernetesResourceItem`): the context-value override, the
command exclusions it forced, and the icon override. It also fixes a wording bug surfaced during review.

### 9.0 Process note — missing decision log for the original override

The reasoning behind `KubernetesResourceItem` overriding `contextValue` (and the matching
`!(discovery.kubernetesService)` exclusions in `package.json`) is **not recorded** anywhere in the
`docs/ai-and-plans/PRs/…` folder. That made this review materially harder: from the code alone it's
ambiguous whether the override was a deliberate "ClusterIP commands assume direct reachability, so hide
them" decision or an accident. We're proceeding on the **assumption it was an intentional guard** (hide
copy/shell/etc. because a ClusterIP needs a tunnel), but that guess should be confirmed by the author.

> 📌 **Process work item:** going forward, keep a short **decision log / reasoning doc per PR** in
> `docs/ai-and-plans/PRs/<pr>/` (as we do for other PRs). It helps human reviewers and code-review agents
> understand _why_ a non-obvious deviation (like overriding a shared base's context value) was made.

### 9.1 Problem statement

`ClusterItemBase` defaults `contextValue` to `treeItem_documentdbcluster;experience_<api>`, which is what
makes the full cluster menu (Create Database, Copy Connection String, Open Interactive Shell, Data
Migration) appear. The Azure vCore discovery node keeps that default and shows the full menu.

`KubernetesResourceItem` instead:

1. **Overrides `contextValue`** to add `documentdbTargetLeaf;discovery.kubernetesService`
   ([KubernetesResourceItem.ts#L132-L137](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L132-L137)).
2. Forces **four `package.json` commands to exclude** it via
   `… && !(viewItem =~ /\bdiscovery\.kubernetesService\b/i)` ([package.json](package.json#L858-L935)).
3. **Overrides the icon** to a reachability glyph
   ([KubernetesResourceItem.ts#L138](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L138)).

The net effect is a node that looks and behaves like a lesser cluster, and a `package.json` riddled with
K8s-specific negative lookaheads (command duplication / special-casing).

### 9.2 Why the guard is unnecessary (the safety analysis)

The exclusions were almost certainly added to stop commands from running against a not-yet-reachable
ClusterIP. But the shared commands **already** guard themselves correctly:

- **Every cluster command checks sign-in and bails with "expand to sign in".** Example —
  [createDatabase.ts#L31-L38](src/commands/createDatabase/createDatabase.ts#L31-L38) throws _"You are not
  signed in… Please sign in (by expanding the node …) and try again."_ if
  `CredentialCache.hasCredentials(clusterId)` is false. The same pattern holds for the other cluster
  commands. So a command invoked before the node is expanded **does not** misfire — it asks the user to
  expand first.
- **Expanding the node is what establishes the tunnel.** `KubernetesResourceItem.authenticateAndConnect()`
  and `getCredentials()` call `resolveClusterCredentials(context, { startPortForward: true })`, so once
  the node is expanded/connected the port-forward is up and the cached client is valid — exactly the
  state the cluster commands require.
- **The only command that reads connection info without connecting is "Copy Connection String".** That is
  precisely the one the base delegates to an overridable hook — `KubernetesResourceItem` already implements
  `getCredentialsForCopy()` with `startPortForward: false` and port-forward-aware annotation. So copy can
  stay correct **without** excluding the command; it's handled in the subclass.

**Conclusion:** the negative-lookahead exclusions are redundant with the sign-in guard. We can drop them
and let the K8s node use the standard cluster menu.

### 9.3 Does anything break? Saved connections that need a tunnel

**Question:** if a user saves a ClusterIP connection (which only works through a local tunnel), is the
tunnel information preserved, and will the Connections-view commands work?

**Answer: yes — already handled.** When the discovery node produces credentials for "Save To DocumentDB
Connections", it attaches **`KUBERNETES_PORT_FORWARD_METADATA_PROPERTY`** to the connection
([KubernetesResourceItem.ts#L465-L475](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L465-L475),
schema in [portForwardMetadata.ts](src/plugins/service-kubernetes/portForwardMetadata.ts)). On the
Connections-view side, [`DocumentDBClusterItem`](src/tree/connections-view/DocumentDBClusterItem.ts#L384-L392)
calls `ensureKubernetesPortForwardIfNeeded()` before connecting/copying, which reads that metadata and
**re-establishes the tunnel transparently**. So a saved ClusterIP connection already brings its tunnel up
on demand — the metadata survives the save and the Connections-view cluster menu works against it.

> This is the strongest evidence the guard is unnecessary: the _saved_ form of the exact same node
> already runs the full cluster menu **with** a tunnel, with no special-casing. The discovery-view node
> can do the same.

### 9.4 Proposed change — ✅ implemented (except shell verification)

**Audit correction (important).** During implementation the marker roles turned out to be the **opposite**
of the first guess:

- **`documentdbTargetLeaf`** is **K8s-only and redundant.** It was used only in the two
  `addConnectionToConnectionsView` menu entries as an alternation `(treeitem_documentdbcluster|documentdbTargetLeaf)`.
  Because the node keeps the base `treeItem_documentdbcluster`, those menus already match without it →
  **removed** from the code and the `package.json` alternations.
- **`discovery.kubernetesService`** must be **kept.** It is **not** only a command gate — the copy command
  reads it ([copyConnectionString.ts#L57](src/commands/copyConnectionString/copyConnectionString.ts#L57),
  `containsDelimited(node.contextValue, 'kubernetesService')`) to route to the read-only, no-tunnel
  `getCredentialsForCopy()` path and to decide the with/without-password prompt. Removing it would break
  safe copy. It stays as a **positive** marker (it no longer **excludes** any command).

**What shipped:**

1. ✅ **Context value simplified** to `treeItem_documentdbcluster;discovery.kubernetesService;experience_<api>`
   (dropped `documentdbTargetLeaf`). See
   [KubernetesResourceItem.ts#L130-L142](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L130-L142).
2. ✅ **Command duplication removed.** The four `!(viewItem =~ /\bdiscovery\.kubernetesService\b/i)`
   negative lookaheads were deleted from [package.json](package.json) so **Create Database / Copy
   Connection String / Open Interactive Shell / Data Migration** now apply to the K8s node uniformly; the
   two `addConnectionToConnectionsView` alternations were simplified to plain `treeitem_documentdbcluster`.
3. ✅ **Copy stays correct via the subclass.** `getCredentialsForCopy()` (no tunnel side effect) is still
   selected through the retained `discovery.kubernetesService` marker — not by hiding the command.
4. ⏳ **Open Interactive Shell — pending manual verification.** The shell needs a live client; after
   expand/connect the tunnel is up, so it should work, but **test deliberately** against a ClusterIP
   target before sign-off.

> ⚠️ **Residual risk to validate:** any cluster command that resolves connection info **without** first
> checking `CredentialCache.hasCredentials` would now run against the K8s node. Audited candidates
> (Create Database, Data Migration) all guard on sign-in; "Copy Connection String" is handled via the
> read-only path. Open Interactive Shell is the one to confirm live (#9.4.4).

### 9.5 Wording bug — "MongoDB Cluster" → "DocumentDB cluster" — ✅ fixed

Per the repo terminology rule (never "MongoDB" alone as the product name), three user-facing strings were
corrected:

- [createDatabase.ts#L33](src/commands/createDatabase/createDatabase.ts#L33) — _"not signed in to the
  **DocumentDB cluster**…"_
- [DatabaseNameStep.ts#L79](src/commands/createDatabase/DatabaseNameStep.ts#L79) — _"…already exists in
  the **DocumentDB cluster**…"_
- [PromptConnectionStringStep.ts#L17](src/commands/newConnection/PromptConnectionStringStep.ts#L17) —
  _"connection string of your **DocumentDB cluster**."_

These were the only three matches across the command set; code comments/JSDoc were intentionally left out
of scope (terminology rule targets user-facing strings).

### 9.6 Icon + tooltip — ✅ implemented

**Icon.** The reachability-glyph override was **removed**; the node now renders the standard DocumentDB
cluster icon **`$(server-environment)`** — the same icon the saved connection uses in the Connections
view ([DocumentDBClusterItem.ts#L449-L451](src/tree/connections-view/DocumentDBClusterItem.ts#L449-L451))
and the Azure VM discovery node uses
([AzureVMResourceItem.ts#L41](src/plugins/service-azure-vm/discovery-tree/vm/AzureVMResourceItem.ts#L41)).
The `icon` field was dropped from `ReachabilityInfo` entirely.

**Tooltip.** Reachability now lives in a **richer, grouped markdown tooltip** with horizontal rules
(`\n\n---\n\n`), in three sections:

1. **Key info** — Target, Status, Port, External Address.
2. **Reachability** — the label + the machine-local/port-forward explanation (the nuance the icon used to
   hint at).
3. **Placement** — Provider, Region, Namespace, Context.

See `buildTooltip()` in
[KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts). The
reachability text **also** remains in the node description (e.g. `[DKO] ClusterIP · port-forward required
:10260`), so the signal is preserved at-a-glance without an icon override.

#### Original plan (retained for reference)

**Reachability icons currently in use** (from `getReachabilityInfo()`,
[KubernetesResourceItem.ts#L519-L585](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L519-L585)):

| Service state                          | Icon today   | Description text (already shown)    |
| -------------------------------------- | ------------ | ----------------------------------- |
| LoadBalancer, external address present | `$(globe)`   | `LoadBalancer · direct`             |
| LoadBalancer, node-port fallback       | `$(server)`  | `LoadBalancer · node-routed`        |
| LoadBalancer, nothing assigned yet     | `$(warning)` | `LoadBalancer · pending`            |
| NodePort                               | `$(server)`  | `NodePort · node-routed`            |
| ClusterIP                              | `$(plug)`    | `ClusterIP · port-forward required` |
| Unsupported / unknown type             | `$(warning)` | `<type> · not directly supported`   |

> _(In limited test data you'll typically only see `globe`; the others appear with NodePort/ClusterIP
> services and partially-provisioned LoadBalancers.)_

Note the reachability is **already conveyed in the node description** (e.g. `[DKO] ClusterIP ·
port-forward required :10260`) **and** in the tooltip's Reachability section — so the icon is redundant
signal, not the only signal. Options for where the reachability _visual_ goes:

| Option                                              | How                                                                                                                                      | Pros                                                                                                                                            | Cons                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **A. Drop the icon entirely; keep text**            | Node shows the DocumentDB icon; reachability stays in the description + tooltip (already there)                                          | Simplest; product icon preserved; zero new surface                                                                                              | Loses the at-a-glance color/glyph; user must read the row                           |
| **B. `FileDecorationProvider` badge** (recommended) | Set `resourceUri` on the node and register a `FileDecorationProvider` that returns a 1–2 char badge + theme color keyed off reachability | Native VS Code "status badge" pattern (same as git/problems); keeps the DocumentDB icon; adds a small colored letter/dot in the row's top-right | A bit more plumbing; badges are 1–2 chars only; needs a stable `resourceUri` scheme |
| **C. Color the DocumentDB icon**                    | Use `ThemeIcon('database', new ThemeColor(...))` — same glyph, reachability-driven color                                                 | Keeps a database glyph; conveys state via color                                                                                                 | Not the brand SVG icon (theme icon only); color alone is weak for color-blind users |
| **D. Label/description suffix only**                | Encode state as a trailing tag in the description (already done)                                                                         | Already implemented; nothing to build                                                                                                           | Pure text; no visual pop                                                            |
| **E. Inline action / child "info" node**            | Surface reachability via the tooltip + an optional info child                                                                            | Detailed                                                                                                                                        | Heavier; clutters the tree                                                          |

> **Recommendation:** **B (FileDecorationProvider badge)** if we want to keep an at-a-glance visual while
> preserving the DocumentDB icon — it's the idiomatic VS Code mechanism for exactly this ("node has a
> status"). If we want the smallest change, **A** is fully acceptable because the description + tooltip
> already carry the reachability text. Either way, **the node's main icon becomes the DocumentDB icon**.

### 9.7 Suggested sequencing (original plan — completed except shell verification)

1. ✅ Fix the wording bug (§9.5) — tiny, independent, safe.
2. ✅ Remove the icon override; set the DocumentDB icon (§9.6; option A shipped — reachability moved into
   the grouped tooltip; **B** `FileDecorationProvider` badge remains an optional follow-up).
3. ✅ Drop the redundant `documentdbTargetLeaf` marker + the four `package.json` exclusions (§9.4); keep
   `discovery.kubernetesService` (needed by copy) and `getCredentialsForCopy`.
4. ⏳ Manually verify: Create Database, Copy Connection String, Open Interactive Shell, Data Migration on
   a **ClusterIP** target (expand → command), plus the same on a **saved** ClusterIP connection.

---

## 10. Iteration 4 — next up & still pending

With §9 landed, the cluster node now exposes the **standard DocumentDB cluster menu** (Create Database,
Copy Connection String, Open Interactive Shell, Data Migration) and shows the **DocumentDB icon**. That
unblocks the copy work from §8.1.

### 10.1 Unified "Copy connection string…" quick pick (was §8.1) — ✅ implemented

The reviewer asked to keep the clear **"Copy connection string…"** entry point but enrich it with **groups**
for Kubernetes port-forwarded targets, while leaving every other node untouched.

**What shipped** (in [copyConnectionString.ts](src/commands/copyConnectionString/copyConnectionString.ts)):

- **No regression for existing nodes.** Non-Kubernetes targets — and Kubernetes targets that are _not_
  reached through a port-forward tunnel — keep the exact prior behavior: the with/without-password prompt
  fires only for saved connections and Kubernetes-discovered targets that use native auth with a real
  password; otherwise the string is copied silently. (Verified by tests T-01…T-07.)
- **Richer grouped picker for port-forwarded targets.** When the resolved credentials carry
  `kubernetesPortForward` metadata, the command shows a single grouped quick pick
  (`enableGrouping: true`, the same azext pattern used by the migration picker):
  - **Connection string** group:
    - **Copy connection string without password** — safe to share.
    - **Copy connection string with password** — only when native auth + a password is present; works
      locally while the tunnel is up. (Password is registered via `valuesToMask`.)
  - **Kubernetes** group (only present when port-forwarding is in use):
    - **Copy kubectl port-forward command** — copies
      `kubectl --context <ctx> --namespace <ns> port-forward svc/<svc> <local>:<remote>` built from the
      stored metadata, so a teammate can reproduce the machine-local tunnel.
    - **Learn more…** — opens the docs entry (currently the DocumentDB Kubernetes operator preview docs;
      to be repointed at the dedicated manual section — see **§11**).
- Copying a connection string from this picker still shows the **"…uses port-forwarding and only works on
  this machine while the tunnel is active"** warning; copying the `kubectl` command shows a neutral
  information message; **Learn more** copies nothing.
- Routing still keys off the retained `discovery.kubernetesService` marker and the read-only
  `getCredentialsForCopy()` path established in iteration 1 (#21), so copy never opens a tunnel as a side
  effect. Works for **both** the Discovery-view ClusterIP node and the saved Connections-view entry,
  because the branch is driven purely by the presence of port-forward metadata on the credentials.
- Telemetry: adds `copyAction` (`withoutPassword` | `withPassword` | `portForwardCommand` | `learnMore`)
  alongside the existing `copyOrigin`, `kubernetesPortForwardCopy`, and `passwordIncluded`.

Tests in [copyConnectionString.test.ts](src/commands/copyConnectionString/copyConnectionString.test.ts)
were extended to T-12 (grouped picker variants: without/with password, kubectl command, learn more).

> 📌 **Docs work item (carried to §11):** author the **"Connecting to ClusterIP / port-forwarded
> targets"** manual section and repoint the **Learn more** entry at it.

### 10.2 Still pending (carried forward)

- ⏳ **Open Interactive Shell on a ClusterIP target** (§9.4.4) — verify live that, after expand/connect
  (tunnel up), the shell opens correctly; decide whether it needs a K8s-aware guard or works as-is.
- 🔭 **Connection-state decorations (generalized, was §9.6 option B)** — moved out of this PR into a
  **0.10.0** experiment: [microsoft/vscode-documentdb#734](https://github.com/microsoft/vscode-documentdb/issues/734)
  proposes a `FileDecorationProvider` that shows which clusters are connected vs. not across the
  Connections tree in general (more broadly useful than a Kubernetes-only reachability badge). The
  tooltip + description already carry the per-node reachability signal in the meantime.
- 📌 **Per-PR decision log** (§9.0) — keep reasoning/decision docs in `docs/ai-and-plans/PRs/<pr>/` so
  non-obvious deviations (like the original context-value override) are reviewable by humans and agents.
- ⏳ **Live-verification checklist** (§8.5) — reveal-on-add, drag-and-drop, Windows path display,
  reload-with-active-tunnel, single-modal-on-error.

### 10.3 Quick reference — what changed in §9 (for compaction)

| Area                                        | Before                                                                                     | After                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Node `contextValue`                         | `treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_*` | `treeItem_documentdbcluster;discovery.kubernetesService;experience_*`                                  |
| Node icon                                   | reachability glyph (`globe`/`server`/`plug`/`warning`) overriding the cluster icon         | `$(server-environment)` (standard DocumentDB cluster icon)                                             |
| Reachability signal                         | node icon + description + tooltip                                                          | description + **grouped** tooltip (key info `---` reachability `---` placement)                        |
| `package.json` cluster commands             | excluded K8s via `!(… discovery.kubernetesService …)` ×4                                   | apply uniformly (no exclusions)                                                                        |
| `addConnectionToConnectionsView` menu match | `(treeitem_documentdbcluster                                                               | documentdbTargetLeaf)`                                                                                 | `treeitem_documentdbcluster` |
| Copy routing                                | hidden command; copy unavailable on K8s node                                               | standard Copy command, routed to read-only `getCredentialsForCopy()` via `discovery.kubernetesService` |
| Wording                                     | "MongoDB Cluster" in 3 strings                                                             | "DocumentDB cluster"                                                                                   |

**Key files touched in §9:**
[KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts) (contextValue, icon, tooltip, reachability),
[package.json](package.json) (menu gating),
[createDatabase.ts](src/commands/createDatabase/createDatabase.ts) /
[DatabaseNameStep.ts](src/commands/createDatabase/DatabaseNameStep.ts) /
[PromptConnectionStringStep.ts](src/commands/newConnection/PromptConnectionStringStep.ts) (wording).
Copy routing logic lives in
[copyConnectionString.ts](src/commands/copyConnectionString/copyConnectionString.ts) and keys off the
retained `discovery.kubernetesService` marker.

---

## 11. Iteration 11 — documentation follow-up

### 11.1 "Connecting to ClusterIP / port-forwarded targets" manual section (carried)

The §10.1 copy picker exposes a **Learn more…** entry, which currently opens the DocumentDB Kubernetes
operator preview docs (`https://documentdb.io/documentdb-kubernetes-operator/latest/preview/`) as a
placeholder. The remaining documentation work is:

- **Author a dedicated user-manual section** under `docs/user-manual/` covering:
  - What a ClusterIP / port-forwarded target is and why its connection string is **machine-local** (only
    valid while the tunnel is active).
  - How the extension establishes and re-establishes the tunnel (port-forward metadata persisted on save;
    re-opened on expand/connect).
  - The **`kubectl port-forward` command** that the copy picker generates and how a teammate would use it
    to reproduce the tunnel on their own machine.
  - Auth/password guidance: when "Copy connection string with password" is safe vs. when to share the
    without-password variant.
- **Repoint the Learn more entry** (`KUBERNETES_PORT_FORWARD_LEARN_MORE_URL` in
  [copyConnectionString.ts](src/commands/copyConnectionString/copyConnectionString.ts)) at the new section
  once it exists. Until then the operator-preview docs are the closest existing reference.

### 11.2 Related follow-ups (tracked outside this PR)

- 🔭 **Connection-state decorations** — [microsoft/vscode-documentdb#734](https://github.com/microsoft/vscode-documentdb/issues/734)
  (0.10.0): experiment with a `FileDecorationProvider` to show connected vs. not-connected clusters across
  the Connections tree in general. Supersedes the Kubernetes-only reachability-badge idea from §9.6 option B.

### 11.3 Discovery-node `description` grammar & tooltip glyph (reference)

**Where:** [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts)
`buildDescription()` / `buildTooltip()` / `getReachabilityInfo()`.

**Design decision (this iteration):** the always-visible grey **description** was trimmed from the original
four-token line (`[<source>] <serviceType> · <reachability> :<port>`) down to **a single connectivity
caveat word**. Provenance (`DKO`/`Generic`), service type, and port are interesting at most once, so they
moved into the tooltip; the description now carries only the one signal a user re-reads: _"is there a
connectivity catch here?"_ A **non-empty** description therefore means "there's a caveat"; the healthy
`direct` case shows **no description at all** (resolves to `false`, i.e. just the node name).

| Service type | Condition                          | Node description (grey) | Tooltip glyph | Connect port |
| ------------ | ---------------------------------- | ----------------------- | ------------- | ------------ |
| LoadBalancer | external address assigned          | _(none)_                | `$(globe)`    | service port |
| LoadBalancer | no external addr, node port exists | `node-routed`           | `$(server)`   | node port    |
| LoadBalancer | neither yet                        | `pending`               | `$(warning)`  | service port |
| NodePort     | —                                  | `node-routed`           | `$(server)`   | node port    |
| ClusterIP    | —                                  | `port-forward`          | `$(plug)`     | service port |
| (other)      | —                                  | `unsupported`           | `$(warning)`  | service port |

- **`pending`** is intentional — it mirrors `kubectl`'s `EXTERNAL-IP: <pending>` for an unprovisioned
  LoadBalancer. **`unsupported`** replaces the old "not directly supported" phrase for `ExternalName` /
  unknown types (nothing is being provisioned, so "pending" would be wrong).

**Tooltip as a legend.** The tooltip has three `---`-separated groups: **key info** (Target, **Source:
DKO/Generic**, Service type, Status, Port, External Address), and **placement** (Provider, Region,
Namespace, Context) — in that order, with the **reachability group promoted to the top** because it is the
signal users care about most. The reachability line **echoes the exact description word** and then explains
it, so hovering teaches what the terse node shortcut means:

```
$(plug) Reachability (`port-forward`): Local port-forward required
VS Code connects through the Kubernetes PortForward API. Connection strings using 127.0.0.1 only work on this machine while the tunnel is active.
```

> No em dashes are used in any generated (user-facing) string; the reachability label uses
> `Reachability (`word`):` rather than an em-dash separator.

**Tooltip glyph decision:** we render **exactly one** theme icon in the tooltip — a leading `$(...)` on the
**Reachability** line — because that line is the single axis that answers _"is the copied connection string
portable?"_ (`globe` portable, `server` cluster-routed, `plug` machine-local tunnel, `warning` not
reachable as-is). Icons are deliberately **not** sprinkled across the other tooltip fields. Requires
`MarkdownString.supportThemeIcons = true`.

**Node icon:** the discovery cluster node uses the **DocumentDB brand mark** — the same icon as the
**"DocumentDB Local"** node in the Connections view — so a discovered target reads as a first-class
DocumentDB cluster. To avoid coupling to that node's own asset, dedicated copies
[`vscode-documentdb-cluster-light-themes.svg`](resources/icons/vscode-documentdb-cluster-light-themes.svg) /
[`vscode-documentdb-cluster-dark-themes.svg`](resources/icons/vscode-documentdb-cluster-dark-themes.svg)
were added (copies of `vscode-documentdb-icon-{light,dark}-themes.svg`). This replaced the earlier
`server-environment` `ThemeIcon`.

---

## 12. Iteration 12 — closeout: pending work & next-iteration backlog

This iteration (description trim, tooltip-as-legend, reachability glyph, brand icon, top-of-tooltip
reachability, em-dash removal) is **closed**. The items below are **not yet done** and are queued for the
next iteration. Each has enough context to be picked up cold.

### 12.1 Pending — verification & polish

- **T1 · Verify Open Interactive Shell on a ClusterIP target (§9.4.4).** — 📌 **Filed:**
  [microsoft/vscode-documentdb#735](https://github.com/microsoft/vscode-documentdb/issues/735) (milestone
  **0.9.1**, assigned to @guanzhousongmicrosoft).
  After expand/connect (port-forward tunnel up), confirm **Open Interactive Shell** launches against
  `127.0.0.1:<localPort>` and works. Decide whether it needs a Kubernetes-aware guard or works as-is via
  the standard cluster command. _Acceptance:_ shell connects on a live kind/AKS ClusterIP target; note any
  guard added. Files: command lives in the shared shell command path; node is
  [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts).

- **T2 · Live-verification checklist (§8.5).**
  Manually confirm: reveal-on-add, drag-and-drop into folders, Windows path display for file sources,
  reload with an active tunnel, and single-modal-on-error. _Acceptance:_ each item checked on Windows +
  one Unix OS; file bugs for any failures.

- **T3 · Visual check of the brand icon at tree size.** — ✅ **Done.**
  Verified after `87efc3ff` (which aligned the discovered-cluster leaf with the other discovery plugins
  while keeping the brand mark): the discovered target still renders the DocumentDB brand icon via
  [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts)
  (`vscode-documentdb-cluster-light-themes.svg` / `vscode-documentdb-cluster-dark-themes.svg`). The mark
  reads crisply at 16px next to sibling nodes in light/dark/high-contrast; no clipping or muddiness, so
  no simplified glyph variant was needed.

### 12.2 Documentation — ✅ done

- **T4 · Author the "Connecting to ClusterIP / port-forwarded targets" user-manual section (§11.1).** —
  ✅ **Done** (`04440da1`, `2e783a0a`). A dedicated
  [copy-connection-string.md](docs/user-manual/copy-connection-string.md) page covers machine-local
  connection strings, how the tunnel is established/reused, the generated `kubectl port-forward` command,
  and teammate password/access-sharing guidance. The copy quick pick's **Learn more**
  (`KUBERNETES_PORT_FORWARD_LEARN_MORE_URL` in
  [copyConnectionString.ts](src/commands/copyConnectionString/copyConnectionString.ts)) was repointed to
  the `aka.ms/vscode-documentdb-kubernetes-port-forward` slug that forwards to this section.

- **T5 · Document the node description/tooltip model in the user manual.** — ✅ **Done** (`04440da1`).
  [service-discovery-kubernetes.md](docs/user-manual/service-discovery-kubernetes.md) now has a **"Reading
  a discovered target"** section with the full connectivity-word table
  (_(none)_ / `node-routed` / `pending` / `port-forward` / `unsupported`) and an explanation of the
  tooltip ordering (reachability first, then identity/source/type/placement).

### 12.3 Pending — tracked outside this PR

- **T6 · Connection-state decorations** — [microsoft/vscode-documentdb#734](https://github.com/microsoft/vscode-documentdb/issues/734)
  (0.10.0): `FileDecorationProvider` showing connected vs. not-connected clusters across the Connections
  tree. Supersedes the Kubernetes-only reachability-badge idea (§9.6 option B).

### 12.4 Done in this iteration (for reference)

- ✅ Description trimmed to one connectivity word; `direct` shows none (§11.3).
- ✅ `pending` / `unsupported` wording (kubectl-grounded).
- ✅ Tooltip key-info gained `Source:` (DKO/Generic) and `Service type:`; reachability echoes the word.
- ✅ Single reachability glyph; reachability group moved to the **top** of the tooltip.
- ✅ No em dashes in generated strings.
- ✅ Discovery cluster node uses the **DocumentDB brand icon** (new `vscode-documentdb-cluster-*.svg`).
- ✅ Empty-namespace bucket reworded **`Others` / `DocumentDB not detected`** → **`Other namespaces` /
  `No DocumentDB targets found`** (noun in the label; neutral, vocabulary-consistent reason). Files:
  [KubernetesOtherNamespacesItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesOtherNamespacesItem.ts),
  tests, and the user manual.

---

## 13. Iteration 13 — description punctuation & honest placement fallbacks

This iteration cleans up two small but visible presentation issues on the Kubernetes nodes: the grey
description wrapped the inferred provider in parentheses, and the tooltips silently dropped the **Region**
row when detection failed (so a flaky detection looked like a missing field). Each task below leads with a
**Verdict**, then the reasoning and the verified change.

### 13.1 Pending — carried over from iteration 12

- **T1 · Verify Open Interactive Shell on a ClusterIP target.** Still open;
  [microsoft/vscode-documentdb#735](https://github.com/microsoft/vscode-documentdb/issues/735) (0.9.1).
- **T2 · Live-verification checklist (§8.5).** Still open; manual runtime pass on Windows + one Unix OS.
- **T6 · Connection-state decorations.** Still tracked outside this PR in
  [microsoft/vscode-documentdb#734](https://github.com/microsoft/vscode-documentdb/issues/734) (0.10.0).

### 13.2 Context-node description — drop the parentheses around provider/host

**Verdict:** ✅ **Done.** The context node's grey description now shows the inferred provider (or the
server host, when the provider can't be inferred) as a **bare token**, not wrapped in `(…)`.

**Why:** parentheses read as an aside/annotation, but the provider _is_ the primary identity hint for the
row (e.g. `bugbash-090  AKS` rather than `bugbash-090  (AKS)`). The only thing that stays parenthetical is
the **original context name** shown next to an alias, where the parentheses correctly signal "this is the
underlying name behind the friendly label."

**Code today:** [KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts)
— `descriptionParts` pushes `this.contextInfo.provider` (and the `new URL(serverUrl).host` / raw-URL
fallback) without surrounding parentheses; the alias branch still pushes `(${this.contextInfo.name})`.
Tests in [KubernetesContextItem.test.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.test.ts)
updated to expect the un-bracketed host/provider.

### 13.3 Region tooltip — explicit fallback when detection fails

**Verdict:** ✅ **Done.** Both the **context node** and the **discovered cluster (target)** tooltips now
always render a **Region** row; when region detection fails, the value is the localized `Unknown` rather
than the row vanishing.

**Why:** region is parsed best-effort from cloud-provider naming conventions (`clusterUser_…`,
`gke_<project>_<region>_…`, AKS server hostnames, EKS ARNs) and legitimately fails for non-standard
contexts. Silently omitting the row makes a flaky detection look like a rendering bug; an explicit
`Unknown` is honest and keeps the tooltip layout stable. The always-visible grey **description** is
unaffected — region stays out of it (it can be a raw hostname token), so this change is tooltip-only.

**Code today:**

- Context node: [KubernetesContextItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesContextItem.ts)
  — `**Region:** ${this.contextInfo.region ?? vscode.l10n.t('Unknown')}` is pushed unconditionally
  (Provider remains conditional — it is mirrored into the description's host fallback).
- Discovered target: [KubernetesResourceItem.ts](src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts)
  — the placement group pushes `**Region:** ${this.contextInfo.region ?? l10n.t('Unknown')}`
  unconditionally.

### 13.4 Out-of-scope Collection View changes found in the feature commit — reverted

**Verdict:** ✅ **Reverted** on this branch; **tracked separately** in
[microsoft/vscode-documentdb#738](https://github.com/microsoft/vscode-documentdb/issues/738) (0.10.0).

**What was found:** the big feature commit `e6dd3923` (_"feat(kubernetes): add multi-source service
discovery"_, author **Guanzhou Song** / @guanzhousongmicrosoft, PR #621) also carried three **general**
Collection View interaction changes that are unrelated to Kubernetes discovery and were not called out in
the commit body:

1. A `command` on the collection node ([CollectionItem.ts](src/tree/documentdb/CollectionItem.ts)) so a
   **single click** opens the Collection View (previously only the `Documents` child opened it, via a
   debounced double click).
2. A module-level `activeCollectionViews` map in
   [openCollectionView.ts](src/commands/openCollectionView/openCollectionView.ts) that **reuses an
   existing tab** (keyed by `viewId::clusterId::databaseName::collectionName`, guarded by
   `shouldReuseExistingView = initialQuery === undefined`) instead of opening a new one.
3. `revealToForeground(vscode.ViewColumn.Active)` instead of the bare `revealToForeground()`.

None of these existed on `origin/main`. Side effect of (1): the `Documents` double-click path still
registers but is effectively dead, since the parent node opens the view on selection.

**Action taken:** reverted all three to the `main` behavior (collection node is expand-only; every open
creates a new tab in the default column). Removed the branch-new `openCollectionView.test.ts` (it only
covered the reuse behavior) and updated `CollectionItem.test.ts` to assert the node carries no command.
Filed [#738](https://github.com/microsoft/vscode-documentdb/issues/738) to propose and properly scope the
feature (including an **"Open in New Collection View"** action so users can still open a second tab on
purpose), and left a note on PR #621 asking that non-feature UX changes be split out in future.

---

_Generated for the bug‑bash‑090 UX review. Code references were verified against the
`dev/guanzhousong/kubernetes-service-discovery` branch state present in this workspace. Behavioral items
marked "verify live" depend on runtime timing and should be confirmed by hand._
