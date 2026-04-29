# 2. Multi-source kubeconfig tree (remove Filter)

> **Status:** Draft for review
> **Plan owner:** Copilot CLI agent (initial draft) → user review
> **Predecessors:** `kubernetes-discovery.md` (overall UX), `copy-connection-string-with-password.md`
> **Branch target:** `guanzhou/kubernetes-discovery-581` (or a follow-up branch)

---

## 1. Problem statement

Today the Kubernetes discovery plugin persists **exactly one** kubeconfig source —
`default` | `customFile` | `inline` — chosen via **Manage Credentials**. Switching the
source replaces the previous selection. There is also a separate **Filter** action used
to hide contexts inside that single source.

This forces users to jump back through Manage Credentials whenever they want to look at
a different cluster set (e.g., a personal laptop kubeconfig and a work VPN kubeconfig).
At the same time, real users typically have only a handful of contexts, so context-level
filtering is mostly redundant.

### What we want instead

```
v Discovery
  v Kubernetes
    v Default kubeconfig                     <- always present, fixed id
      v aks-prod (AKS / eastus)
        v app
          > db-primary
    v my-team.config                         <- user-added file source
      v eks-staging
        ...
    v Pasted YAML 1                          <- user-added inline source
      v kind-local
        ...
```

- **Multiple kubeconfig sources** can coexist as siblings under "Kubernetes".
- Each source expands to its **own** contexts → namespaces → services subtree, just like
  today's single source.
- The user can **add** custom file sources and **paste** YAML sources at will, **rename**
  them, **remove** them, and **refresh** them individually.
- The **Filter** capability is **removed** (UI + storage + tests + docs). Its data keys
  are wiped on first run after upgrade.

### User decisions captured (input from prompt)

| Question                                | Choice                              |
| --------------------------------------- | ----------------------------------- |
| Custom file count                       | multiple                            |
| Inline (pasted YAML) count              | multiple                            |
| Label source                            | filename / "Pasted YAML N" + Rename |
| Per-entry actions                       | remove, rename, refresh             |
| New Connection wizard                   | flat list + source name in column   |
| Filter behavior                         | remove + wipe legacy data           |
| Migration strategy                      | fresh slate (drop legacy state)     |
| Cluster ID namespacing                  | prefix with sourceId                |
| Tree-ID handling for saved connections  | accept invalidation (beta)          |

---

## 2. Scope

### In scope

- New tree node `KubernetesKubeconfigSourceItem` between root and existing context node.
- Storage redesign — single record `kubernetes-discovery.sources` plus per-source secret
  storage entries for inline YAML.
- Re-target every call to `loadConfiguredKubeConfig()` to a per-source variant.
- Cluster ID and tree ID schemes namespaced by `sourceId`.
- New commands (Add file, Paste YAML, Rename, Remove, Refresh) wired to the
  Manage-Credentials root action and the new source-level actions.
- Update New Connection wizard to flatten contexts across all sources.
- Remove all Filter code, manifest entries, tests, docs, and globalState keys.
- Migration: on first activation post-upgrade, wipe **all** legacy K8s globalState +
  secret-storage keys and start with the single Default source.
- Update `docs/user-manual/service-discovery-kubernetes.md` for the new flow.

### Out of scope

- Tunnel-management UI (still tracked separately — see plan #1 §11).
- Auto-merge of multi-file `KUBECONFIG` env paths into one Default source. Default keeps
  using the first valid path, mirroring today's behavior.
- Persisting collapsed/expanded state across reloads (left to VS Code defaults).
- Cross-source connection-string deduplication beyond the existing port-forward identity
  check (we add `sourceId` to that identity in §6.5).
- Reworking the saved-connection storage of pre-upgrade connections — they may need to
  be re-saved by the user once.

---

## 3. Requirements

### 3.1 Tree behavior

- **R-01.** The Kubernetes root MUST list children in this order:
  1. Default kubeconfig (always first, always present).
  2. User-added sources, in **insertion order** (not alphabetical).
- **R-02.** A source node's tree item MUST show:
  - `label` = source label (default = "Default kubeconfig").
  - `description` = source kind (e.g., `(file: ~/.kube/team.yaml)` or `(pasted YAML)`).
  - `tooltip` = absolute path or "stored in Secret Storage".
  - `iconPath` = `key` for default, `file` for file sources, `clippy` for inline.
- **R-03.** Expanding a source node MUST list contexts using the existing
  `KubernetesContextItem` UX. There is no per-source filter — every context is shown.
- **R-04.** A source node failure (kubeconfig missing/invalid) MUST be **scoped to that
  source only**: other sources continue to expand normally. The failed source shows the
  same recovery actions (`Configure`, `Open docs`, `Retry`) used today.

### 3.2 Source-management actions

- **R-05.** A new root-level action **"Add kubeconfig source…"** appears on the K8s root
  via the existing Manage Credentials button. It opens a quick pick:
  - "Add custom kubeconfig file…" → file dialog.
  - "Paste kubeconfig YAML from clipboard" → reads clipboard, validates, stores in
    Secret Storage under a fresh per-source key.
- **R-06.** A new context menu on **each source node** offers:
  - **Refresh** (re-fetches kubeconfig and re-expands).
  - **Rename…** (input box, defaults to current label).
  - **Remove** (confirms, deletes from sources list and from secret storage if inline,
    stops any port-forward tunnels associated with that source).
  - The Default source omits **Remove** and **Rename**; **Refresh** still applies.
- **R-07.** Adding a source MUST validate the kubeconfig before persisting. If load
  fails or `getContexts()` is empty, surface the error and abort.
- **R-08.** Default labels:
  - File source: basename of the path. If a duplicate label exists, append `(2)`, `(3)`,
    etc.
  - Inline source: `Pasted YAML N` where `N` is `(largest existing N) + 1`.
- **R-09.** Adding the **same file path twice** MUST surface an info message and reuse
  the existing entry (focus the tree node) instead of creating a duplicate.
- **R-10.** Adding **clipboard YAML identical** to an existing inline source MUST
  produce an info message and reuse that entry.
- **R-11.** Removing a source MUST stop all `PortForwardTunnelManager` tunnels whose
  port-forward identity contains that source's id (§6.5).

### 3.3 New Connection wizard

- **R-12.** `SelectContextStep` MUST list **all contexts from all sources** in a single
  quick pick. Each item shows:
  - `label` = context name.
  - `description` = `(<source label>) <server URL>` (so colliding context names are
    distinguishable).
  - `detail` = none (avoid noise).
- **R-13.** `SelectServiceStep` and `KubernetesExecuteStep` MUST use the `sourceId` of
  the selected context to load the right kubeconfig and to populate
  `kubernetesPortForward.sourceId`.
- **R-14.** When **no sources have any contexts**, the wizard fails fast with a warning
  pointing to "Add kubeconfig source…".

### 3.4 Filter removal

- **R-15.** Delete:
  - `src/plugins/service-kubernetes/filtering/` (4 files).
  - `discoveryWizardFilterConsistency.test.ts`.
  - `configureTreeItemFilter` from `KubernetesDiscoveryProvider`.
  - `enableFilterCommand` from `KubernetesRootItem.contextValue`.
- **R-16.** Manifest cleanup in `package.json`:
  - The K8s root no longer matches `enableFilterCommand` (other Azure providers still do).
- **R-17.** Storage cleanup on first activation post-upgrade:
  - Remove `kubernetes-discovery.enabledContexts`, `kubernetes-discovery.hiddenContexts`,
    `kubernetes-discovery.filteredNamespaces`, `kubernetes-discovery.kubeconfigSource`,
    `kubernetes-discovery.customKubeconfigPath` from globalState.
  - Remove `kubernetes-discovery.inlineKubeconfig` from secret storage.
  - The plugin starts with `sources = [{ id: 'default', kind: 'default', label: 'Default
    kubeconfig' }]`. The user re-adds custom/inline as needed.
- **R-18.** A migration MUST run **once** keyed off a new flag
  `kubernetes-discovery.migration.v2Done`. Subsequent activations skip the wipe.

### 3.5 IDs and identity

- **R-19.** Tree IDs MUST follow the pattern
  `<view>/kubernetes-discovery/<sanitizedSourceId>/<sanitizedContext>/<ns>/<svc>`.
- **R-20.** `KubernetesServiceModel.clusterId` MUST follow
  `${DISCOVERY_PROVIDER_ID}_${sanitizedSourceId}_${sanitizedContext}__${sanitizedNs}__${sanitizedSvc}`.
- **R-21.** `kubernetesPortForward` metadata MUST gain a new `sourceId: string` field.
  When reading older entries that lack it, treat the missing field as `'default'` so
  pre-upgrade saved connections still attempt to reconnect against the default
  kubeconfig.
- **R-22.** Per the user's choice, no rewrite of existing saved connections is performed.
  The release notes will state that K8s-discovered saved connections from prior versions
  may need to be **re-saved**.

### 3.6 Non-functional

- **R-23.** No regression in extension activation time. Source list comes from a single
  `globalState.get` call; nothing else changes at startup.
- **R-24.** No new external dependencies (continue using `@kubernetes/client-node`).
- **R-25.** All user-facing strings go through `vscode.l10n.t()`. Run `npm run l10n`
  after the change and accept the diff.
- **R-26.** No secrets in logs, telemetry, or output channel. Inline YAML stays in
  Secret Storage; the tooltip never shows the YAML body.

---

## 4. Design

### 4.1 Storage shape

```ts
// src/plugins/service-kubernetes/config.ts

export type KubeconfigSourceKind = 'default' | 'file' | 'inline';

export interface KubeconfigSourceRecord {
    /** Stable id. 'default' for the built-in entry; UUID-v4 for user-added. */
    readonly id: string;
    /** Display label. Editable for non-default entries. */
    readonly label: string;
    readonly kind: KubeconfigSourceKind;
    /** Absolute path for kind === 'file'. Undefined otherwise. */
    readonly path?: string;
    /** Per-source secret-storage key for kind === 'inline'. Undefined otherwise. */
    readonly secretKey?: string;
}

export const KUBECONFIG_SOURCES_KEY = 'kubernetes-discovery.sources';
export const MIGRATION_V2_DONE_KEY = 'kubernetes-discovery.migration.v2Done';
export const INLINE_KUBECONFIG_SECRET_PREFIX = 'kubernetes-discovery.inlineKubeconfig.';

export const DEFAULT_SOURCE_ID = 'default';
```

Reads/writes go through a thin module:

```ts
// src/plugins/service-kubernetes/sources/sourceStore.ts (new)

export async function readSources(): Promise<KubeconfigSourceRecord[]>;
export async function writeSources(sources: KubeconfigSourceRecord[]): Promise<void>;
export async function addFileSource(absolutePath: string): Promise<KubeconfigSourceRecord>;
export async function addInlineSource(yaml: string): Promise<KubeconfigSourceRecord>;
export async function renameSource(id: string, newLabel: string): Promise<void>;
export async function removeSource(id: string): Promise<void>;
export async function getSource(id: string): Promise<KubeconfigSourceRecord | undefined>;
```

The store is the **only** writer of `KUBECONFIG_SOURCES_KEY` and the only reader/writer
of inline secret keys.

### 4.2 Migration

```ts
// src/plugins/service-kubernetes/sources/migrationV2.ts (new)

export async function ensureMigrationV2(): Promise<void> {
    if (ext.context.globalState.get<boolean>(MIGRATION_V2_DONE_KEY)) return;

    // Drop legacy keys (fresh slate per user choice).
    await ext.context.globalState.update('kubernetes-discovery.kubeconfigSource', undefined);
    await ext.context.globalState.update('kubernetes-discovery.customKubeconfigPath', undefined);
    await ext.context.globalState.update('kubernetes-discovery.enabledContexts', undefined);
    await ext.context.globalState.update('kubernetes-discovery.hiddenContexts', undefined);
    await ext.context.globalState.update('kubernetes-discovery.filteredNamespaces', undefined);
    await ext.secretStorage.delete('kubernetes-discovery.inlineKubeconfig');

    // Seed sources list with the singleton default.
    await ext.context.globalState.update(KUBECONFIG_SOURCES_KEY, [
        { id: DEFAULT_SOURCE_ID, kind: 'default', label: vscode.l10n.t('Default kubeconfig') },
    ]);
    await ext.context.globalState.update(MIGRATION_V2_DONE_KEY, true);
}
```

Hook called from `KubernetesDiscoveryProvider`'s lazy-init path (the first time the
plugin is touched after install/upgrade). The discovery service registration is eager,
so we actually call this once at provider construction inside an idempotent guard.

### 4.3 New tree node

```ts
// src/plugins/service-kubernetes/discovery-tree/KubernetesKubeconfigSourceItem.ts (new)

export class KubernetesKubeconfigSourceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string; // see below
    constructor(public readonly parentId: string, public readonly source: KubeconfigSourceRecord) {
        this.id = `${parentId}/${sanitizeForId(source.id)}`;
        const editable = source.id !== DEFAULT_SOURCE_ID;
        this.contextValue = createContextValue([
            'enableRefreshCommand',
            'discoveryKubernetesSource',
            ...(editable ? ['enableRenameCommand', 'enableRemoveCommand'] : []),
        ]);
    }
    async getChildren() { /* loadKubeConfig(source) -> getContexts -> KubernetesContextItem */ }
    getTreeItem(): vscode.TreeItem { /* labels per R-02 */ }
}
```

The existing `KubernetesContextItem` is unchanged structurally; it only needs to know
its `sourceId` so it can call the per-source kubeconfig loader. We pass `source` (or
`sourceId`) through the constructor.

### 4.4 `loadConfiguredKubeConfig` signature

```ts
// kubernetesClient.ts

// OLD: export async function loadConfiguredKubeConfig(): Promise<KubeConfig>
// NEW:
export async function loadConfiguredKubeConfig(sourceId: string): Promise<KubeConfig>;
```

Internally, `getSource(sourceId)` resolves the record, then dispatches:
- `default` → `loadKubeConfig()`
- `file` → `loadKubeConfig(record.path)`
- `inline` → reads `record.secretKey` from Secret Storage → `loadKubeConfig(undefined, contents)`

Each call site that previously called `loadConfiguredKubeConfig()` is updated to pass
the sourceId it has in scope. Items that already know their context have a path to the
source: `KubernetesContextItem`, `KubernetesNamespaceItem`, and `KubernetesServiceItem`
each carry a `sourceId` field. `ensureKubernetesPortForward` reads it from the
`kubernetesPortForward` metadata stored on the connection.

### 4.5 Source-management commands

- `vscode-documentdb.command.discoveryView.kubernetes.addSource`
  - Args: root tree item.
  - Wires the existing **Manage Credentials** button to a quick pick of "Add file…" and
    "Paste YAML…". Each branch creates a record via `sourceStore.addFileSource` /
    `sourceStore.addInlineSource`, then refreshes the discovery tree.
- `vscode-documentdb.command.discoveryView.kubernetes.renameSource`
  - Args: source tree item. Defaults the input box to the current label. Persists via
    `sourceStore.renameSource` and refreshes the source node.
- `vscode-documentdb.command.discoveryView.kubernetes.removeSource`
  - Args: source tree item. Confirms with `showInformationMessage(modal: true)`. On
    confirmation: `sourceStore.removeSource`, stop tunnels for that sourceId, refresh
    the root.

These are registered in `ClustersExtension.activateClustersSupport()` next to existing
discovery commands. `package.json`:

- `view/item/context` entries for the new commands gated on the new context-value
  markers (`discoveryKubernetesSource`, `enableRenameCommand`, `enableRemoveCommand`).
- `commandPalette` blocks set them to `"when": "never"`.

### 4.6 Cluster ID and port-forward identity

```ts
// KubernetesServiceItem
const prefixedClusterId =
    `${DISCOVERY_PROVIDER_ID}_${sanitizeForId(sourceId)}_${sanitizedContext}__${sanitizedId}`;
```

```ts
// portForwardMetadata.ts
export interface KubernetesPortForwardMetadata {
    readonly kind: 'kubernetesClusterIpPortForward';
    readonly sourceId: string;        // NEW
    readonly contextName: string;
    readonly namespace: string;
    readonly serviceName: string;
    readonly servicePort: number;
    readonly servicePortName?: string;
    readonly localPort: number;
}

export function getKubernetesPortForwardIdentity(m: KubernetesPortForwardMetadata): string {
    return `${m.sourceId}/${m.contextName}/${m.namespace}/${m.serviceName}:${m.servicePort}`;
}
```

`getKubernetesPortForwardMetadata` validator falls back to `sourceId = 'default'` when
the property is absent (R-21).

### 4.7 Wizard flow updates

- `SelectContextStep`:
  - Reads `sources = await readSources()`.
  - For each source, attempts `loadConfiguredKubeConfig(source.id)`. Failures are logged
    and that source contributes 0 contexts.
  - Builds a flat `IAzureQuickPickItem<{ sourceId; contextInfo }>` list with the source
    label included in the description (`(my-team.config) https://api.example.com`).
- `SelectServiceStep`: uses `selected.data.sourceId` instead of a global default.
- `KubernetesExecuteStep`: writes `kubernetesPortForward.sourceId` into
  `connectionProperties`.

### 4.8 Removing Filter

- Delete `filtering/` directory and `discoveryWizardFilterConsistency.test.ts`.
- Drop `configureTreeItemFilter` from `KubernetesDiscoveryProvider`.
- Strip `enableFilterCommand` from `KubernetesRootItem.contextValue`.
- The shared `vscode-documentdb.command.discoveryView.filterProviderContent` command
  stays — Azure providers still use it. We just no longer route it for K8s.

### 4.9 Manifest changes (`package.json`)

- Remove the `kubernetesServiceLeaf` no-op gates (already noted as a no-op in plan #1).
  Either leave them (harmless) or take this opportunity to clean up. Recommendation:
  **leave them** to keep this plan's diff focused; revisit in a separate cleanup PR.
- Add `view/item/context` entries for `kubernetes.addSource` (already wired through
  Manage Credentials but available as inline icon on the root), `renameSource`, and
  `removeSource`. Keep them gated on `view == discoveryView` and the new context values.
- Refresh inline icon (`refresh`) is reused via `enableRefreshCommand`.

---

## 5. Validation plan

### 5.1 Unit tests (additions / updates)

| Test                                               | What it covers                                                  |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `sources/sourceStore.test.ts` (new)                | Add file / add inline / rename / remove / dedup by path / dedup by hash; `KUBECONFIG_SOURCES_KEY` written correctly. |
| `sources/migrationV2.test.ts` (new)                | Legacy keys wiped; default source seeded; flag set; idempotent on re-run. |
| `discovery-tree/KubernetesKubeconfigSourceItem.test.ts` (new) | Children are `KubernetesContextItem`s; failure shows recovery; tree item description matches R-02; default source omits rename/remove markers. |
| `discovery-tree/KubernetesRootItem.test.ts` (update) | Children are now source items, in insertion order with default first; recovery node when no sources (defensive — should not happen post-migration). |
| `discovery-tree/KubernetesContextItem.test.ts` (update) | `sourceId` propagates to namespace items; `loadConfiguredKubeConfig(sourceId)` is called. |
| `discovery-tree/KubernetesNamespaceItem.test.ts` (update) | Same — sourceId threading. |
| `discovery-tree/KubernetesServiceItem.test.ts` (update) | `clusterId` includes the sourceId; port-forward metadata includes `sourceId`. |
| `discovery-wizard/SelectContextStep.test.ts` (new) | Quick pick lists contexts from multiple sources; description includes source label; failed source is skipped. |
| `discovery-wizard/KubernetesExecuteStep.test.ts` (update) | `kubernetesPortForward.sourceId` written; tunnel started against the right kubeconfig. |
| `portForwardMetadata.test.ts` (new or expanded)    | `getKubernetesPortForwardMetadata` falls back to `'default'` when sourceId missing; identity now includes sourceId. |
| `commands/addKubeconfigSource.test.ts` (new)       | File picker happy path; clipboard happy path; validation failure aborts. |
| `commands/renameKubeconfigSource.test.ts` (new)    | Rename persists; default source rejects. |
| `commands/removeKubeconfigSource.test.ts` (new)    | Confirmation flow; tunnels stopped; default source rejects. |
| `discoveryWizardFilterConsistency.test.ts`         | **Deleted.** |
| `filtering/configureKubernetesFilter.test.ts`      | **Deleted.** |
| `kubernetesClient.test.ts` (update)                | `loadConfiguredKubeConfig(sourceId)` for default / file / inline; throws on unknown sourceId. |

Existing copy-string and DocumentDBClusterItem tests should still pass without changes.

### 5.2 Manual smoke test

1. **Migration.** Install pre-upgrade build with a customFile + 2 hidden contexts +
   namespace filters. Upgrade. Open Discovery → Kubernetes:
   - Root shows only **Default kubeconfig**.
   - All legacy keys are gone (verify via debug console / `globalState`).
2. **Add file source.** Click Manage Credentials → Add custom kubeconfig file → pick
   `~/.kube/team.yaml`. Confirm new node appears with label `team.yaml`. Expand →
   contexts list.
3. **Add inline source.** Copy YAML to clipboard → Manage Credentials → Paste kubeconfig
   YAML → confirm `Pasted YAML 1` appears. Repeat → `Pasted YAML 2`.
4. **Rename.** Right-click `Pasted YAML 1` → Rename → `Personal cluster`. Tree updates
   without reload.
5. **Remove.** Right-click `team.yaml` → Remove → confirm. Tree updates; any active
   tunnels for that source are stopped.
6. **New Connection wizard.** Run **New Connection → Kubernetes**. Confirm flat picker
   shows contexts from all 3 sources, each with the source label in the description.
7. **Reconnect from saved connection.** Save a K8s ClusterIP connection. Restart VS
   Code. Open the connection → tunnel auto-starts using the right sourceId.
8. **Default-only restrictions.** Verify Default source has no Rename / Remove menu;
   Refresh works.
9. **Pre-upgrade saved connection.** Hand-craft a stored connection with old
   port-forward metadata (no `sourceId`). Open it → tunnel attempts against `default`
   source; if default kubeconfig still has the context, it succeeds; otherwise the
   user-visible error explains the mismatch.

### 5.3 Build / lint / l10n / test gates

Per `.github/copilot-instructions.md`:

```bash
npm run l10n          # accept new strings (Add/Rename/Remove labels, etc.)
npm run prettier-fix
npm run lint
npx jest --no-coverage
npm run build
```

### 5.4 Documentation

- Rewrite `docs/user-manual/service-discovery-kubernetes.md`:
  - Add a "Kubeconfig sources" section explaining the new tree shape.
  - Add a "Manage sources" section covering Add/Rename/Remove/Refresh.
  - Remove the "Contexts and Filters" section.
  - Keep the discovery rules, RBAC, troubleshooting, and provider-detection sections
    unchanged.

---

## 6. Risk register

| Risk                                                  | Mitigation                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Saved K8s connections invalidated by clusterId rename | Documented in release notes; user re-saves once. Alternative (`writeMigration`) deferred.        |
| Multiple sources expose same context name             | New Connection wizard description includes source label; tree shows them under different parents. |
| Inline YAML accumulates unused secrets                | `removeSource` deletes the matching `secretKey`; one-time scrub during migrationV2.              |
| File source path becomes invalid (file moved)         | Source node shows recovery actions; user can Remove or Rename; we never auto-delete entries.     |
| Race when multiple sources concurrently load          | Existing per-call lazy-load pattern is async-safe; unit test threads sourceId through correctly. |
| User adds the **same** custom path twice              | R-09 dedup; surface "Already added" info message.                                                |
| User pastes the **same** YAML twice                   | R-10 dedup by YAML SHA-256 of normalized contents (whitespace-trimmed).                          |
| Default source missing on disk                        | Existing recovery flow (kubeconfig not loadable) renders inside the Default source node.         |

---

## 7. Implementation checklist

The agent will tick these as it completes them.

### Phase 1 — Storage and migration
- [x] Add `KubeconfigSourceRecord`, `KubeconfigSourceKind`, new keys, and the
      `DEFAULT_SOURCE_ID` constant to `config.ts`.
- [x] Add `sources/sourceStore.ts` with full CRUD + dedup helpers.
- [x] Add `sources/migrationV2.ts` and call it lazily on first plugin touch.
- [x] Unit-test the store and migration.

### Phase 2 — Tree changes
- [x] Add `KubernetesKubeconfigSourceItem` and its tests.
- [x] Update `KubernetesRootItem` to render source children + drop filter children.
- [x] Add `sourceId` to `KubernetesContextItem`, `KubernetesNamespaceItem`,
      `KubernetesServiceItem`. Update tests.
- [x] Update tree IDs and clusterIds per §4.6. Update tests.
- [x] Update `kubernetesPortForward` metadata to include `sourceId`. Update validator
      and identity helper. Update tests.

### Phase 3 — Loader changes
- [x] Change `loadConfiguredKubeConfig` signature to `(sourceId: string)`.
- [x] Update all 8 call sites (search-and-replace + sourceId propagation).
- [x] Update `kubernetesClient.test.ts` for the new signature.

### Phase 4 — Commands
- [x] Implement `addKubeconfigSource.ts` (file + clipboard branches).
- [x] Implement `renameKubeconfigSource.ts`.
- [x] Implement `removeKubeconfigSource.ts` (confirm + stop tunnels).
- [x] Wire commands in `ClustersExtension.activateClustersSupport()`.
- [x] Wire `KubernetesDiscoveryProvider.configureCredentials` to launch the new
      "Add source" quick pick (replacing today's single-source wizard).
- [x] Add `view/item/context` and `commandPalette` entries in `package.json`.

### Phase 5 — Wizard
- [x] Update `SelectContextStep` to flatten across sources.
- [x] Update `SelectServiceStep` to use the selected source.
- [x] Update `KubernetesExecuteStep` to write `sourceId` in metadata.
- [x] Update / extend `KubernetesExecuteStep.test.ts`.

### Phase 6 — Filter removal
- [x] Delete `src/plugins/service-kubernetes/filtering/` (4 files).
- [x] Delete `discoveryWizardFilterConsistency.test.ts`.
- [x] Drop `configureTreeItemFilter` from `KubernetesDiscoveryProvider`.
- [x] Drop `enableFilterCommand` from `KubernetesRootItem.contextValue`.
- [x] Confirm Azure providers still match their own `enableFilterCommand` markers.

### Phase 7 — Documentation
- [x] Rewrite `docs/user-manual/service-discovery-kubernetes.md`.
- [x] Update plan #1 (`kubernetes-discovery.md`) review checklist to remove the
      "filter / hidden contexts" open questions.

### Phase 8 — Quality gates
- [x] `npx jest --no-coverage` green.
- [x] `npm run prettier-fix` clean.
- [x] `npm run lint` clean.
- [x] `npm run build` clean.
- [x] `npm run l10n` — accept additions for new commands and source kind labels.
- [ ] Manual smoke test §5.2 walked through (out of scope for the agent; user task).

---

## 8. Open questions for next review

1. **Default kubeconfig refresh under `KUBECONFIG` env changes.** If the user sets a new
   `KUBECONFIG` env var after VS Code launched, the Default source still uses the new
   value because we resolve at load time. Worth a callout in the doc?
2. **Source ordering controls.** Should the tree allow drag-to-reorder, or expose a
   "Move up / Move down" pair of actions? The spec today is "insertion order"; users
   may want to pin work configs to the top.
3. **Inline secret cleanup on uninstall.** If the user removes the K8s plugin, who
   deletes the `kubernetes-discovery.inlineKubeconfig.<id>` secrets? Today VS Code does
   not auto-clean Secret Storage on extension removal. Possible follow-up: a CLI
   `vscode-documentdb.command.kubernetes.purgeSources` for support scenarios.
4. **DBA-first preset.** Should the Default source be hidden or auto-collapsed when the
   user has at least one custom source? (My recommendation: keep it expanded; explicit
   is better than implicit.)
5. **Per-source proxy / auth-plugin caveats.** Some kubeconfigs use exec auth plugins
   (e.g., `aws-iam-authenticator`). They already work today via `@kubernetes/client-node`,
   but each new source instance reuses the host process — no isolation. Worth adding to
   the troubleshooting table?

---

## Iteration 2 — separate `+` (Add) and `key` (Manage) inline actions

### Problem
The single key icon on the Kubernetes root is overloaded: it is the only entry point
both for **adding** a new kubeconfig source *and* for managing the existing list. Users
have no obvious way to delete a source they no longer want, or to temporarily hide one
without permanently removing it. The action is also non-obvious — "key" implies
credentials, not "add a config".

### Decision
Split the inline icons on the Kubernetes root:

- **`+` (add)** — Add a new kubeconfig source (opens the existing
  `addKubeconfigSource` quick pick: file picker / clipboard YAML).
- **`key` (manage credentials)** — Open a multi-select QuickPick that lists all
  existing sources. The user can:
  - **Toggle visibility** by checking / unchecking entries. Unchecked sources are
    persisted as hidden and disappear from the discovery tree without losing the
    underlying record (so re-enabling them later does not require re-adding).
  - **Remove** a source via an inline trash button on the QuickPick item. Default
    source is exempt from both removing and unchecking.

The right-click `Rename` and `Remove` actions on individual source nodes stay as-is.

### Storage
- New globalState key `kubernetes-discovery.hiddenSourceIds: string[]` — list of
  source ids that should not appear in the tree. Default source id is filtered out
  defensively whenever the value is read or written.

### Manifest
- New command id `vscode-documentdb.command.discoveryView.kubernetes.addSource`,
  exposed as inline `+` on the Kubernetes root (matched via the existing
  `discoveryKubernetesRootItem` context-value marker).
- The existing `vscode-documentdb.command.discoveryView.manageCredentials` keeps the
  `key` inline icon for K8s but the K8s-specific implementation now opens the manage
  QuickPick instead of the add flow.

### Validation
- Add unit test `manageKubeconfigSources.test.ts` (multi-select + button + persistence).
- Update `KubernetesRootItem.test.ts` to assert hidden ids are filtered out.
- Update `KubernetesDiscoveryProvider.test.ts` to assert `configureCredentials` calls
  the manage UI rather than the add flow.

### Iteration 2 implementation checklist
- [x] Update plan doc.
- [x] Add storage helpers for hidden source ids + tests.
- [x] Filter visible sources in the tree.
- [x] Register new addSource command + bind to `+` inline icon.
- [x] Implement `manageKubeconfigSources` QuickPick.
- [x] Repoint `configureCredentials` at the manage UI.
- [x] Update manifest (commands, view/item/context, commandPalette never).
- [x] Update tests (provider, RootItem, sourceStore, manageKubeconfigSources).
- [x] Update user manual.
- [x] Run jest / prettier / lint / build / l10n green.
