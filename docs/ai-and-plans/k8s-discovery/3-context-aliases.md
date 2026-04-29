# 3. Context display aliases (right-click rename)

> **Status:** Draft for review
> **Predecessors:** plans #1, #2
> **Branch target:** `guanzhou/kubernetes-discovery-581` (or follow-up branch)

---

## 1. Problem statement

Kubernetes context names are inherited verbatim from the kubeconfig YAML
(`contexts[].name`). In practice they are often long, cryptic, or auto-generated
by the cloud CLI:

- `clusterUser_documentdb-vscode-test-rg_documentdb-vscode-test-aks` (`az aks get-credentials`)
- `arn:aws:eks:us-east-1:123456789012:cluster/prod` (default EKS)
- `gke_my-project_us-central1-a_prod-cluster` (GKE)
- `kind-documentdb-e2e-arm64-1772647342` (kind with timestamp suffix)

Users want a friendly display name ("Prod AKS East", "Local kind") without
mutating the underlying kubeconfig file (which is also used by kubectl, helm,
terraform, CI scripts, etc.).

### What we want

- A per-context **display alias** stored separately from the kubeconfig.
- Set / cleared via **right-click on the context tree node**.
- The kubeconfig YAML is **never** modified.
- The real context name keeps being the identity used for cluster IDs,
  port-forward metadata, and saved connections.

### User decisions captured (from prompt)

| Question | Choice |
| --- | --- |
| Always optional? | Yes |
| Asked during initial source add? | No |
| Set how? | Right-click action on the context node only |

---

## 2. Scope

### In scope

- New "Rename Context…" right-click action on `KubernetesContextItem` nodes in
  the Discovery view.
- New persistent map of aliases keyed by `(sourceId, contextName)`.
- Tree label, tree description, and tooltip updates for `KubernetesContextItem`.
- Wizard QuickPick label update in `SelectContextStep` so the alias appears as
  the primary label (with original name kept in the description for unambiguity).
- Best-effort orphan cleanup of aliases when contexts disappear from a source
  (on tree refresh) or when a source is removed.

### Out of scope

- Aliases for namespaces or services (low value, high overhead — defer).
- Mutating the user's kubeconfig file or the inline-stored YAML.
- Migrating saved connections — they keep using the real `contextName` from
  port-forward metadata and don't care about display aliases.
- A "show original everywhere" toggle — original always appears in tooltip,
  that's enough.

---

## 3. Requirements

### 3.1 Functional

- **R-01.** A right-click action **"Rename Context…"** appears on every
  `KubernetesContextItem` node in the Discovery view.
- **R-02.** Selecting "Rename Context…" opens an input box. Default value =
  current alias if any; empty if no alias.
- **R-03.** Submitting a non-empty value persists it as the alias for
  `(sourceId, contextName)`.
- **R-04.** Submitting an empty value (or "Clear" action) removes the alias.
- **R-05.** Cancelling (Escape) leaves the existing alias unchanged.
- **R-06.** Tree label of a context node:
  - With alias: `<alias>`
  - Without alias: `<contextName>` (current behavior)
- **R-07.** Tree description of a context node always shows the underlying
  `<provider> / <region>` when known. When an alias is in effect, the
  description **also** shows the real context name in parentheses, e.g.
  `(originalName) AKS / eastus`.
- **R-08.** Tree tooltip always shows the real context name plus cluster /
  server / provider / region (current behavior; explicitly preserved).
- **R-09.** `SelectContextStep` (New Connection wizard) QuickPick item label =
  alias when set, else context name. Description always includes
  `(<sourceLabel>) <server>` plus `[<originalName>]` when an alias is in effect.
- **R-10.** Aliases are **never** sent to telemetry or any log. Only the real
  context name appears in `outputChannel`.
- **R-11.** Saved connections, `clusterId`, and `kubernetesPortForward.contextName`
  MUST NOT change. Aliases are display-only.

### 3.2 Storage

- **R-12.** Aliases live under `kubernetes-discovery/aliases` workspace as a
  single `StorageItem` with id `contextAliases`. Properties:
  ```ts
  { aliases: Array<{ sourceId: string; contextName: string; alias: string }> }
  ```
  (Array, not map, so source/context names that contain odd characters are
  preserved verbatim without escaping.)
- **R-13.** A single read returns the whole array; lookup is `O(n)` over the
  small list. Writes overwrite the whole row.
- **R-14.** `aliasFor(sourceId, contextName)` lookup ignores entries where
  alias is empty/whitespace.

### 3.3 Lifecycle

- **R-15.** Removing a source (via right-click or via the Manage UI's trash
  button) MUST also drop every alias whose `sourceId` matches the removed
  source's id.
- **R-16.** When `KubernetesKubeconfigSourceItem.getChildren()` loads contexts
  for a source, aliases for that `sourceId` whose `contextName` is NOT in the
  loaded set MAY be silently pruned (best effort; tolerate failures). This
  prevents stale aliases when the user `kubectl config rename-context`s the
  underlying name.
- **R-17.** Migration v3 (already present) does not need to change. New
  installs start with no aliases; existing installs simply have an empty
  alias workspace until the user creates one.

### 3.4 Non-functional

- **R-18.** No new external dependencies.
- **R-19.** All user-facing strings via `vscode.l10n.t()`. Run `npm run l10n`
  after the change.
- **R-20.** Cancel + Escape always work. Invalid input (empty after trim) is
  treated as "clear alias", not as an error.

---

## 4. Design

### 4.1 Storage layer

```ts
// src/plugins/service-kubernetes/sources/aliasStore.ts (new)

export interface ContextAliasEntry {
    readonly sourceId: string;
    readonly contextName: string;
    readonly alias: string;
}

export async function readAliases(): Promise<ContextAliasEntry[]>;
export async function aliasFor(sourceId: string, contextName: string): Promise<string | undefined>;
export async function setAlias(sourceId: string, contextName: string, alias: string | undefined): Promise<void>;
export async function clearAliasesForSource(sourceId: string): Promise<void>;
export async function pruneAliasesForSource(sourceId: string, knownContextNames: readonly string[]): Promise<void>;
```

Stored as a single StorageItem under workspace `aliases`:

```ts
const item: StorageItem<{ entries: ContextAliasEntry[] }> = {
    id: 'contextAliases',
    name: 'Kubernetes context aliases',
    version: '1',
    properties: { entries: [...] },
};
await StorageService.get(KUBECONFIG_STORAGE_NAME).push('aliases', item, /* overwrite */ true);
```

Same caching approach as `sourceStore.ts` — module-scoped cache, invalidate on
write. Don't memoize `StorageService.get(...)` per-call (consistent with
`sourceStore.ts`'s current style).

### 4.2 Tree node integration

`KubernetesContextItem.getTreeItem()` already builds label / description /
tooltip. Inject the alias lookup at construction or in `getTreeItem`:

```ts
const alias = await aliasFor(this.sourceId, this.contextInfo.name);
const treeLabel = alias ?? this.contextInfo.name;
const aliasHint = alias ? `(${this.contextInfo.name}) ` : '';
const baseDescription = buildBaseDescription(this.contextInfo); // existing
const description = `${aliasHint}${baseDescription}`;
```

Caveat: `getTreeItem()` is sync today. Two options:

1. Resolve the alias eagerly when the parent (`KubernetesKubeconfigSourceItem`)
   builds children — it already does an `await` on the kubeconfig load. Pass
   the resolved alias map to each `KubernetesContextItem`.
2. Convert `getTreeItem` to async or read from a sync in-memory cache populated
   on first read.

**Pick option 1.** Parent passes a `Map<string, string>` (key = contextName,
value = alias) into the constructor; `KubernetesContextItem` reads it
synchronously when building the tree item. Aliases for missing contexts are
ignored. This keeps `getTreeItem()` synchronous and avoids races.

### 4.3 Wizard integration

`SelectContextStep` already loops over sources and contexts. Add an
`aliasesBySource: Map<string, Map<string, string>>` resolved once at the start
of `prompt()`:

```ts
const allAliases = await readAliases();
const bySource = new Map<string, Map<string, string>>();
for (const entry of allAliases) {
    if (!bySource.has(entry.sourceId)) bySource.set(entry.sourceId, new Map());
    bySource.get(entry.sourceId)!.set(entry.contextName, entry.alias);
}

for (const source of sources) {
    const aliases = bySource.get(source.id) ?? new Map();
    // ... existing per-source loop ...
    for (const ctx of contexts) {
        const alias = aliases.get(ctx.name);
        const label = alias ?? ctx.name;
        const aliasHint = alias ? `[${ctx.name}] ` : '';
        picks.push({
            label,
            description: `${aliasHint}(${source.label})${ctx.server ? ` ${ctx.server}` : ''}`,
            data: { source, contextInfo: ctx },
        });
    }
}
```

### 4.4 Command — `renameKubernetesContext`

```ts
// src/plugins/service-kubernetes/commands/renameKubernetesContext.ts (new)

export async function renameKubernetesContext(
    context: IActionContext,
    node: KubernetesContextItem,
): Promise<void> {
    const currentAlias = await aliasFor(node.sourceId, node.contextInfo.name);
    const input = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rename Kubernetes context'),
        prompt: vscode.l10n.t(
            'Set a display name for "{0}". The kubeconfig is not modified. Leave empty to clear.',
            node.contextInfo.name,
        ),
        value: currentAlias ?? '',
        placeHolder: node.contextInfo.name,
    });
    if (input === undefined) {
        throw new UserCancelledError();
    }
    const trimmed = input.trim();
    await setAlias(node.sourceId, node.contextInfo.name, trimmed.length === 0 ? undefined : trimmed);
    refreshKubernetesRoot();
}
```

Registered in `ClustersExtension.activateClustersSupport()` next to the source
commands. Manifest entry as `view/item/context` gated on a new context value
marker on `KubernetesContextItem` (e.g., `discovery.kubernetesContext`); also
gated `commandPalette: never`.

### 4.5 Source removal hook

`removeKubeconfigSource` and `manageKubeconfigSources` (the trash button) MUST
call `clearAliasesForSource(sourceId)` after `removeSource()` succeeds.

### 4.6 Orphan pruning

In `KubernetesKubeconfigSourceItem.getChildren()` after `getContexts(kc)`:

```ts
const knownContextNames = sortedContexts.map((c) => c.name);
void pruneAliasesForSource(this.source.id, knownContextNames); // fire-and-forget
```

Fire-and-forget because pruning is a UX nicety, not correctness.

### 4.7 Manifest changes (`package.json`)

```jsonc
{ "command": "vscode-documentdb.command.discoveryView.kubernetes.renameContext",
  "title": "Rename Context…",
  "icon": "$(edit)",
  "category": "DocumentDB" }
```

```jsonc
// view/item/context
{ "command": "vscode-documentdb.command.discoveryView.kubernetes.renameContext",
  "when": "view == discoveryView && viewItem =~ /\\bdiscovery\\.kubernetesContext\\b/i",
  "group": "1@3" }

// commandPalette
{ "command": "vscode-documentdb.command.discoveryView.kubernetes.renameContext",
  "when": "never" }
```

`KubernetesContextItem.contextValue` gains `'discovery.kubernetesContext'`
alongside its existing markers.

---

## 5. Validation

### 5.1 Unit tests (additions)

| Test file | Coverage |
| --- | --- |
| `sources/aliasStore.test.ts` (new) | read/set/clear/prune lifecycle; cache invalidation; key uniqueness; empty/undefined alias collapses to "no alias"; clearing non-existent is a no-op. |
| `commands/renameKubernetesContext.test.ts` (new) | input flow happy path (set / clear / cancel); refresh is called; UserCancelledError on Escape. |
| `discovery-tree/KubernetesContextItem.test.ts` (update) | when `aliasMap` provides an alias, label = alias and description prefixes with `(<original>)`; tooltip always shows the real name. |
| `discovery-tree/KubernetesKubeconfigSourceItem.test.ts` (update) | passes per-source alias map to context items; calls prune on load. |
| `discovery-wizard/SelectContextStep.test.ts` (update) | quick pick item label uses alias when present; description prefix `[origname]` appears only when alias differs. |
| `commands/removeKubeconfigSource.test.ts` (update) | invokes `clearAliasesForSource` after `removeSource`. |
| `commands/manageKubeconfigSources.test.ts` (update) | trash-button removal path also clears aliases. |

### 5.2 Manual smoke test

1. Add a default kubeconfig source. Confirm contexts show their original names.
2. Right-click a context (e.g., `clusterUser_…`) → "Rename Context…" → enter
   `Prod AKS`. Tree label updates to `Prod AKS`; description shows
   `(clusterUser_…) AKS / eastus`.
3. Run **New Connection → Kubernetes**. Confirm the QuickPick shows `Prod AKS`
   as label and `[clusterUser_…] (Default kubeconfig) https://…` as description.
4. Right-click the same context → "Rename Context…" → submit empty. Tree
   reverts to original name; description loses the alias prefix.
5. Set an alias, then `kubectl config rename-context clusterUser_… new-name`.
   Refresh the tree. The alias is silently pruned (because `clusterUser_…` no
   longer exists in the kubeconfig).
6. Set aliases on two contexts of one source. Remove that source via Manage
   trash. Re-add the same kubeconfig (file source gets a new uuid id). Aliases
   from the removed source are gone. Set fresh aliases.
7. Open a previously-saved K8s connection in the Connections view. Tunnel
   replays correctly — confirms `kubernetesPortForward.contextName` was untouched.

### 5.3 Build / lint / l10n / test gates

```bash
npm run l10n
npm run prettier-fix
npm run lint
npx jest --no-coverage
npm run build
```

### 5.4 Documentation

- Append a "Rename a context" section to
  `docs/user-manual/service-discovery-kubernetes.md` explaining:
  - Right-click → Rename Context…
  - Aliases are local to this extension; the kubeconfig is unchanged.
  - The original name still appears in tooltips, error messages, and the
    output channel.

---

## 6. Risks / open questions

| Risk | Mitigation |
| --- | --- |
| Two contexts with the same name across sources end up with the same alias accidentally | Aliases are keyed by `(sourceId, contextName)` — same alias text in two sources is fine; they're distinct rows. |
| User sets alias on Default source, removes Default source, re-adds it | Default source id is constant (`'default'`), so aliases survive a remove + re-add cycle. Match is intentional. |
| `getTreeItem()` is synchronous but alias lookup is async | Resolved by parent passing a sync `Map` into the child constructor (§4.2 option 1). |
| Aliases growing unbounded (many test contexts, many sources) | Acceptable in v1 — a few dozen entries max. Prune on load + on source remove keeps it bounded. |
| Telemetry leakage of personally-meaningful alias text | R-10 forbids it; reviewed in code. |

### Open question

- **Display format with alias active.** Should the description show `(originalName)` (parentheses) or `[originalName]` (brackets) or `originalName ·` (separator)? Default proposal: parentheses in the tree (`(originalName)`), brackets in the wizard (`[originalName]`) so the wizard pick stays scannable. Open to bikeshed.

---

## 7. Implementation checklist

### Phase 1 — Storage
- [x] Add `sources/aliasStore.ts` with `read/set/clear/prune` plus tests.

### Phase 2 — Tree
- [x] Add `discovery.kubernetesContext` to `KubernetesContextItem.contextValue` (already present from plan #2).
- [x] Resolve alias map in `KubernetesKubeconfigSourceItem.getChildren()` and
      pass it into each `KubernetesContextItem` constructor.
- [x] Update `KubernetesContextItem.getTreeItem()` to apply the alias to label
      and description while keeping tooltip on the real name.
- [x] Fire-and-forget orphan prune in `getChildren()`.

### Phase 3 — Wizard
- [x] Update `SelectContextStep.prompt()` to read aliases and use them for the
      QuickPick label / description.

### Phase 4 — Command
- [x] Add `commands/renameKubernetesContext.ts`.
- [x] Register in `ClustersExtension.activateClustersSupport()`.
- [x] Add manifest entries (`commands`, `view/item/context`, `commandPalette: never`).

### Phase 5 — Source-removal hook
- [x] `clearAliasesForSource(id)` in `removeKubeconfigSource.ts` after success.
- [x] Same in `manageKubeconfigSources.ts` trash-button path.

### Phase 6 — Tests + docs + gates
- [x] Add `aliasStore.test.ts` (12 tests covering lifecycle / prune / clear / edge cases).
- [x] Add `renameKubernetesContext.test.ts` (5 tests covering set / clear / cancel / default-value / no-node).
- [x] Update `KubernetesContextItem.test.ts` with alias label / description / tooltip cases.
- [x] Update `docs/user-manual/service-discovery-kubernetes.md` with the "Rename a context" section.
- [x] `npm run l10n` — 3 new keys merged.
- [x] `npm run prettier-fix` — clean.
- [x] `npm run lint` — clean.
- [x] `npx jest --no-coverage` — 2148/2148 pass.
- [x] `npm run build` — clean.
- [x] `npm run webpack-dev-ext` — bundle rebuilt.
- [ ] Manual smoke test §5.2 — out of scope for the agent.
