# Bug Bash 0.9.0 — Kubernetes Service Discovery UX Review Pack

> **Who this is for:** the operator about to do a hands‑on UX review (trying the extension,
> exercising user flows) of the Kubernetes service‑discovery feature.
> **What this is:** a single catch‑up document that reconstructs the UX discussion that happened
> a while ago across 30 closed bug‑bash issues, states what was _decided_, shows what the code
> _actually does today_ (verified against the current branch), and **flags** everything that is
> still open, contradictory, or only partially done.

- **Feature / PR:** [microsoft/vscode-documentdb#621 — feat(kubernetes): add multi-source service discovery](https://github.com/microsoft/vscode-documentdb/pull/621)
- **Working branch:** `dev/guanzhousong/kubernetes-service-discovery`
- **Issue tracker (closed):** [tnaum-ms/vscode-documentdb-bugbash-090 — closed issues](https://github.com/tnaum-ms/vscode-documentdb-bugbash-090/issues?q=is%3Aissue%20state%3Aclosed)
- **Scope of this doc:** the UX‑facing issues (wording, tree structure, icons, tooltips, flows).
  Pure backend bugs are listed at the end for completeness but not analyzed in depth.

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
      > Others (DocumentDB not detected)      (collapsed bucket for empty namespaces)
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
- ➡️ **Iteration 1 (owner):** _“The command should not have the label ‘Add kubeconfig source’ — it’s
  not UX-friendly. Use the field-standard naming (see Lens). Fallback: ‘Add Kubeconfig…’.”_
  - **Research — Lens (k8slens.dev):** Lens groups everything under a root called **“Kubernetes
    Clusters”** > **“Local Kubeconfigs”**, and its add actions read **“Add Kubeconfigs”** (the paste/add
    button), **“Add from filesystem”** (browse a file), and **“Manually add a kubeconfig”** (paste YAML).
    Source: [Add a local cluster — Lens docs](https://docs.k8slens.dev/k8slens/getting-started/add-clusters/add-local-cluster/).
  - **Decision:** Adopt the Lens-standard verb. The consolidated add command (which opens a picker for
    default / file / paste) is now **“Add Kubeconfigs…”** everywhere it surfaces.
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
- ⚠️ **Flag (revisit before launch):** the owner explicitly wanted to revisit this API ("maybe someone
  wants to hide all"). Confirm the hidden‑provider migration behaves for: fresh install, an explicit
  empty legacy list, and a non‑empty legacy list. Confirm `azure-discovery` is normalized to
  `azure-mongo-vcore-discovery`.
- ➡️ **Iteration 1 (owner) — resolved:** _“Redo it. All providers are always visible; they can be
  removed; we save the ‘removed’ list and show everything else. No migration path — for everyone we just
  show them all and they can still remove the ones they don’t want.”_
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
- ➡️ **Iteration 1 (owner):** the add action is singular **"Add Kubeconfig…"** (not plural
  "Kubeconfigs"). Applied to the `package.json` command title, the empty-state action, the in-wizard
  entry, and the picker placeholder. The owner reviewed Lens naming but chose the singular form for our UI.

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
- ⚠️ **Flag (history):** the owner initially mused this "might be acceptable as‑is, let's discuss next bug
  bash." It was later fixed properly. No action — just be aware the discussion looked undecided for a while.
- ➡️ **Iteration 1 (owner) — resolved:** _"When adding a kubeconfig fails (default, paste, or file), the
  error should be **modal**, and it should always be an **error** — not a warning. Unify them: we weren't
  able to continue, so it's an error."_
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
  `group-by-ref-type`** (owner's pick — it reads as "a config that groups one or more clusters").
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
- ➡️ **Iteration 1 (owner):** _“The ‘Others’ node uses the wrong icon — there’s a documented ‘folder’
  icon problem in the Connections view. Use a different icon with the same shape but a different name.”_
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
- ➡️ **Iteration 1 (owner) — resolved:** _"Remove the inline rename pencil — the context menu is enough.
  Simplify the command labels."_
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
  hide/unhide filter feature entirely** — the owner judged that with explicit Add/Remove per source there's
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
  [KubernetesServiceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts#L493-L517).
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
    [KubernetesServiceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts#L519-L560).
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
  as a recovery child, but in #25 the owner later asked to **remove** it (it's already in the context
  menu) and to make the error notification **modal**. Neither of those two follow‑ups shipped — the
  toast is still non‑modal and "Remove this kubeconfig source" is still a recovery child.
- ➡️ **Iteration 1 (owner) — resolved:** _“Get rid of that ‘Remove this kubeconfig source’ node.”_
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
- ➡️ **Iteration 1 (owner) — resolved:** _“The refresh/retry action should be worded the same as the
  other retry error nodes in the Connections view, for consistency, and it should also be the first node
  as it is in the Connections view.”_
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

**#25 — "What does Retry do here?"** ✅ rename / ⚠️ two owner asks NOT shipped

- **Verdict — Deviation.** What was done differently: only part of the ask shipped. The **Retry → Reload**
  rename plus progress/success feedback landed on the source node, but the owner's two explicit follow‑ups
  — make the error notification **modal**, and **remove** the in‑tree "Remove this kubeconfig source"
  action — were **not** implemented. This is the headline gap.
- **Reporter:** the "Retry" action on a kubeconfig source seemed to be a no‑op; suggested "Reload" might
  be clearer.
- **Owner added two asks in a comment:** (1) make the error notification **modal**; (2) **remove**
  "Remove this kubeconfig source" from the recovery actions (it's in the context menu already).
- **Decision / Code today:** Only the rename + feedback shipped — on the **source** node the action is now
  **"Reload"** with a status‑bar progress and a success toast ("Reloaded kubeconfig source 'NAME'. Found N
  context(s)."); "Retry" is intentionally kept on **context/namespace** nodes (genuinely transient errors
  like API‑server unreachable / RBAC). Verified the source recovery child labels **"Reload"** in
  [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts#L130-L138).
- ⚠️ **The two owner asks are unaddressed** — verified in current code:
  - The error is still a **non‑modal** `showWarningMessage()` (not modal). [line ~108]
  - **"Remove this kubeconfig source"** is still listed as a recovery child. [line ~117]
    These are the clearest "stated intent vs shipped code" gaps in the whole set — confirm with the team
    whether they were dropped on purpose or slipped.
- ➡️ **Iteration 1 (owner) — resolved:** _“Make it modal on expand and on retry. There’s no risk of
  modal spam because the error-node cache prevents multiple actions on tree refresh.”_
  - **Decision / Implemented:** The kubeconfig-source error notification is now **modal**
    (`showWarningMessage(…, { modal: true })`). Because the retry-node cache (#19) stops `getChildren()`
    from re-running on passive refreshes, the modal fires only on a real load attempt (expand or
    “Click here to retry”) and cannot stack. See
    [KubernetesKubeconfigSourceItem.ts](src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts).
  - This **resolves the first #25 owner ask**. The second ask (remove the in-tree “Remove this kubeconfig
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
| #25 / #2    | ✅ **Resolved (iteration 1).** Error notification is now **modal**; the in‑tree **"Remove this kubeconfig source"** node was removed. | Both owner asks from #25 are now shipped (see §7.1).                                                      | Trigger a failing source (rename `~/.kube/config` away): confirm the warning is modal and "Remove" is gone from the in‑tree recovery actions. |
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

> ✅ **Resolved in iteration 1 (Option A — modal).** The owner confirmed the literal ask: the error is
> now a **modal** `showWarningMessage(…, { modal: true })`. The modal-spam risk that made A unattractive
> is neutralized by the #19 retry-node cache — a broken source is only (re)loaded on an explicit action
> (expand or "Click here to retry"), never on passive refresh, so at most one modal fires per real
> attempt. Option D (toast-on-user-action) is no longer needed; the table below is retained for the
> record.

The owner asked for **modal**; iteration 1 shipped **modal**.

| Option                                                                               | Pros                                                            | Cons                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A. Modal warning** (owner's ask)                                                   | Impossible to miss; forces acknowledgment                       | Interrupts flow; annoying if it fires on expand/refresh of a known‑broken source; modal spam if several sources fail |
| **B. Toast (current)**                                                               | Non‑blocking; consistent with VS Code norms                     | Easy to miss; transient; can repeat if `getChildren()` re‑runs                                                       |
| **C. Quiet inline + output channel only**                                            | Zero noise; detail on demand                                    | Reverts the #2 improvement; users may not notice the error at all                                                    |
| **D. Toast on _user‑initiated_ load only** (add / Reload), silent on passive refresh | Best signal‑to‑noise; loud when the user acted, quiet otherwise | Slightly more logic to distinguish trigger source                                                                    |

> **Suggested:** **D**. It honors #2 (visible error), avoids modal fatigue, and naturally pairs with the
> #25 "Reload" affordance. If the team insists on the owner's literal ask, make the modal fire **only**
> on explicit Reload, not on passive expand/refresh.

### 4.2 "Remove" in the recovery children (#2 / #25)

> ✅ **Resolved in iteration 1 (Option "Remove it").** The owner confirmed: _"get rid of that 'remove this
> config source' node."_ The recovery list is now Reload + Docs only; Remove stays in the context menu.
> The **"Open in Editor" for file sources** idea (third row) remains an open, additive follow-up — see
> the unresolved-ideas note below.

| Option                                                                         | Pros                                                                        | Cons                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Keep it (current)**                                                          | One‑click recovery when a source is broken; discoverable                    | Duplicates the context menu; #25 explicitly wanted it gone; mildly destructive in a recovery list |
| **Remove it (owner's ask)**                                                    | De‑duplicates; recovery list = pure "fix forward" (Reload, Docs)            | Slightly less convenient for "this source is junk, delete it"                                     |
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

This chapter captures the **first round of owner feedback** on the review pack above, what was decided,
what shipped (one dedicated commit per change), and the deeper design discussions that were explicitly
requested for the **second iteration**. Inline notes were also added to the relevant items in §2/§4.

### 7.1 What shipped in iteration 1 (changelog)

| #    | Owner feedback                                                                                            | Decision                                                                     | Commit summary                                                 |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| root | Discovery root should read **"Kubernetes Clusters"** (Lens-aligned), not just "Kubernetes".               | Rename root + provider label.                                                | `rename discovery root node to 'Kubernetes Clusters'`          |
| #3   | "Add kubeconfig source" is not UX-friendly; use field-standard naming (Lens); fallback "Add Kubeconfig…". | Adopt the Lens verb; later singularized to **"Add Kubeconfig…"** (see 7.1b). | `use Lens-standard 'Add Kubeconfigs…' label`                   |
| #13  | Redo visibility: all providers always visible, store only the **hidden** list, **no migration**.          | Remove the legacy migration entirely; default hidden = `[]`.                 | `drop provider-visibility migration; hidden list only`         |
| #5   | "Others" node uses the buggy `folder` icon; use the same-shape, different-name icon.                      | Use `symbol-folder` (per the documented Connections-view fix).               | `use 'symbol-folder' icon on Others node`                      |
| #2   | Get rid of the in-tree **"Remove this kubeconfig source"** node.                                          | Delete it; Remove stays in the context menu.                                 | `drop 'Remove this kubeconfig source' recovery node`           |
| #19  | Refresh/retry wording should match the Connections view and be the **first** node.                        | Use **"Click here to retry"** + move it first across all K8s error states.   | `reword retry node to 'Click here to retry' and show it first` |
| #25  | Error notification should be **modal** on expand and retry.                                               | Make `showWarningMessage` modal; the #19 cache prevents modal spam.          | `show kubeconfig source error as a modal on load/retry`        |

**Lens naming research (for #3 / root).** Lens (k8slens.dev) is the field reference. Its
[Add a local cluster](https://docs.k8slens.dev/k8slens/getting-started/add-clusters/add-local-cluster/)
docs use: a root node **"Kubernetes Clusters"**, a group **"Local Kubeconfigs"**, and add actions
**"Add Kubeconfigs"** (the add/paste button), **"Add from filesystem"** (browse a file on disk), and
**"Manually add a kubeconfig"** (paste raw YAML). We adopted **"Kubernetes Clusters"** for the root and
**"Add Kubeconfigs…"** for the consolidated add action; the per-branch picker entries (default / file /
paste) keep their own descriptive labels.

### 7.1b Second batch of iteration-1 fixes (wording & error consistency)

A follow-up round of owner feedback on the same iteration refined wording and error handling:

| Area               | Owner feedback                                                                                                                                                  | Decision / Implementation                                                                                                                                                                                                                                     |
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
> 🔄 **Superseded by §8.1 (owner's decision).** Rather than a standalone "Copy kubectl port-forward
> command" entry, the owner chose to fold all share/copy options into a **single "Copy…" quick pick** on
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
  "Add Kubeconfig…" entry was aligned to the same icon in iteration 3 (§8.4).
- **Deferred to iteration 3:** the ClusterIP "copy connection details" experience (§8.1). Double-click-to-expand
  (former §4.4) and query-table contrast (#27) are **not** owner-requested and are closed/parked (§8.2).

---

## 8. Iteration 3 — open items & discussion

Iterations 1–2 cleared every release-blocking wording/structure/error item raised in the bug bash. What
remains is one **additive, non-blocking** enhancement (§8.1), an icon-parity fix that already landed
(§8.4), two items that are **not owner-requested** and are closed/parked (§8.2), and a live-verification
checklist (§8.5). None of these gate launch.

### 8.1 ClusterIP "Copy connection details" — a unified copy quick pick (owner's decision)

**Owner's decision.** Don't bolt on a single new "Copy kubectl port-forward command" action. We already
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

**Why this is the right shape.** It reuses a UX the user already understands (the copy-reference quick
pick), keeps the default copy honest (no silent tunnel side effects — already true after #21), folds the
teammate-share concern (#21) into the same surface instead of a separate command, and the **Learn more**
entry gives the machine-local nuance a permanent home instead of a transient warning toast.

**Prerequisite finding — why the K8s node's menu looks "thin" (answer to the owner's question).** The
discovered DocumentDB target **does** extend the shared cluster base:
[`KubernetesServiceItem extends ClusterItemBase<KubernetesServiceModel>`](src/plugins/service-kubernetes/discovery-tree/KubernetesServiceItem.ts).
It is a real cluster node (expanding it authenticates, lists databases/collections, etc.). The reason
many context-menu actions you see in the **Connections view** don't appear here is **not** the class —
it's the **menu scoping by view**:

- Tree context-menu contributions in `package.json` are gated by `view == …` _and_ a `viewItem`
  context-value regex.
- The discovered node lives in the **Discovery view** and carries the context value
  `treeItem_documentdbcluster;documentdbTargetLeaf;discovery.kubernetesService;experience_*`.
- In the Discovery view we **intentionally** expose only discovery-relevant actions — primarily
  **"Add to Connections View"** (`view == discoveryView && viewItem =~ /…documentdbTargetLeaf…/`). The
  rich cluster menu (rename, delete, copy connection string, etc.) is contributed under
  `view == connectionsView`, so it appears **after** the user adds the cluster to the Connections view.

This is **consistent with every discovery provider** (the Azure discovery cluster nodes show the same
minimal menu); the Kubernetes target is not a special-cased or lesser node. It does mean the new
**"Copy…" quick pick** above needs to be added as a **Discovery-view command** (gated on
`discovery.kubernetesService` / `documentdbTargetLeaf`) rather than assuming the Connections-view copy
commands are present.

### 8.2 Not owner-requested — closed/parked

Two items previously parked here did **not** originate from the owner; they came from bug-bash
participants and are not on the roadmap:

- **Double-click to expand tree rows (bug-bash #28).** Originated as a community bug-bash issue, not an
  owner ask. The owner does **not** want this. Closed as **won't-fix** (twistie/Enter already expand;
  adding double-click risks accidental connect/auth side effects). No further action.
- **Query-table color contrast (bug-bash #27).** Unrelated to Kubernetes discovery; tracked elsewhere
  with the table-component work. Removed from this review's agenda.

### 8.4 Cross-surface icon parity for "add kubeconfig" — ✅ resolved

There were **three** places a kubeconfig surfaced, each with its own icon. Iteration 3 aligned the two
"add" surfaces that read as the same concept:

| Surface                                                                                                                          | Icon                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tree source nodes                                                                                                                | `group-by-ref-type`                                                    |
| In-wizard "Add Kubeconfig…" entry ([SelectContextStep.ts](src/plugins/service-kubernetes/discovery-wizard/SelectContextStep.ts)) | `group-by-ref-type` ✅ (was `plug`)                                    |
| Add-Source picker per-type items ([addKubeconfigSource.ts](src/plugins/service-kubernetes/commands/addKubeconfigSource.ts))      | `home` / `folder-opened` / `clippy` (kept — per-type aids recognition) |

> ✅ **Decision / Implemented.** The in-wizard entry no longer uses `plug`; it uses the same
> `group-by-ref-type` as the tree source nodes so "kubeconfig sources" reads consistently. The dedicated
> Add-Source picker keeps its per-type icons (`home` / `folder-opened` / `clippy`) — they help the user
> distinguish default vs file vs paste at the moment of choosing, which is the one place differentiation
> is useful.

### 8.5 Live-verification checklist still outstanding

Several iteration-1/2 behaviors are timing- or platform-sensitive and were verified by tests but should
be confirmed by hand before sign-off (these are not new work, just confirmation):

- Reveal-on-add expands and selects the new source from a cold cache (#22).
- Drag-and-drop: valid file, non-kubeconfig, directory, duplicate, mixed batch (#26).
- Windows display of `%USERPROFILE%\.kube\config` in the tree/tooltip/dialog (#23/#24).
- Reload window while a ClusterIP tunnel is active, then reconnect (#30).
- Modal error fires once (not on every passive refresh) for a broken source (#2/#25).

---

_Generated for the bug‑bash‑090 UX review. Code references were verified against the
`dev/guanzhousong/kubernetes-service-discovery` branch state present in this workspace. Behavioral items
marked "verify live" depend on runtime timing and should be confirmed by hand._
