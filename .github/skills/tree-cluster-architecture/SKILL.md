---
name: tree-cluster-architecture
description: Patterns for cluster nodes and tree data providers in vscode-documentdb. Use when adding or changing a cluster tree item, discovery provider, Connections/Azure/Discovery tree hierarchy, tree/list mode, cluster identity, treeId/clusterId lookup, Collection View import/export resolution, reveal behavior, credentials, shell actions, or copy connection string support.
---

# Tree Cluster Architecture

Use this skill whenever a tree node represents a database cluster or a hierarchy change can move a cluster node.

## Non-Negotiable Rule

Every **browsable cluster node** must extend `ClusterItemBase<TModel>` from `src/tree/documentdb/ClusterItemBase.ts`.

Do not implement a cluster as a plain `TreeElement` or `createGenericElement*` node. Hand-rolled cluster nodes silently lose shared behavior and force each feature to reimplement it:

- database and collection expansion
- credential/client cache integration
- retry and open-shell recovery nodes
- the canonical `treeItem_documentdbcluster` context tag
- standard command/menu eligibility
- `getCredentials()` used by Copy Connection String and Save/Add to Connections flows
- consistent connection progress, cancellation, and error handling

Generic tree elements are appropriate for structural parents, placeholders, actions, and **non-browsable state rows**. When a state becomes browsable, render a `ClusterItemBase` subclass.

## Implementing a Cluster Item

1. Define a model extending `BaseClusterModel`.
2. Construct a `TreeCluster<TModel>` containing both stable identity and tree position.
3. Extend `ClusterItemBase<TModel>` and call `super(cluster)`.
4. Implement:
   - `getCredentials(): Promise<EphemeralClusterCredentials | undefined>`
   - `authenticateAndConnect(): Promise<ClustersClient | null>`
5. Optionally override:
   - `beforeCachedClientConnect()` for tunnels or reachability preparation
   - presentation through `descriptionOverride`, `tooltipOverride`, `iconPath`, or a justified `getTreeItem()` override
6. Preserve the base context value. Add feature tags with `createContextValue([this.contextValue, ...extraTags])`; never replace it with a string that omits `treeItem_documentdbcluster`.
7. Use `this.cluster.clusterId` for `CredentialCache` and `ClustersClient`, never `this.id`.

Representative subclasses:

- Stored connection: `src/tree/connections-view/DocumentDBClusterItem.ts`
- Kubernetes discovery: `src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts`
- Atlas discovery: `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts`
- Managed synthetic cluster: `QuickStartClusterItem` in `src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts`

## Dual Identity Contract

A cluster has two IDs with different ownership:

| ID          | Meaning                            | Stability                                      | Valid uses                                                                       |
| ----------- | ---------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `clusterId` | Stable resource/cache identity     | Must survive tree moves and layout changes     | credentials, clients, sessions, serialized webview context, reverse lookup input |
| `treeId`    | Current hierarchical tree position | May change with folders, parents, or view mode | `TreeElement.id`, child IDs, reveal/navigation                                   |

Rules:

- `clusterId` must not contain `/`.
- `treeId` must represent the node's actual rendered path.
- `viewId` must identify the branch provider that owns the rendered node.
- Child IDs derive from `treeId`, using helpers such as `buildDatabaseTreeId()` and `buildCollectionTreeId()`.
- Never cache by `treeId` or `this.id`.
- Never assume a stable ID is also a tree path unless the provider explicitly guarantees `clusterId === treeId`.
- Never change tree construction without checking reverse lookup from `clusterId`.

## Design Rendering and Lookup Together

When adding a cluster hierarchy or a tree/list mode, specify these four functions before coding:

1. **Stable identity:** How is `clusterId` built and made collision-safe?
2. **Rendering:** How is `treeId` built in every layout?
3. **Ownership:** Which branch provider receives `viewId` and `clusterId` later?
4. **Reverse lookup:** How does that provider recover the current `treeId` and then the collection node?

The round trip must hold:

```text
rendered cluster
  -> { clusterId, treeId, viewId }
  -> open Collection View with { clusterId, viewId }
  -> owning provider resolves current treeId
  -> provider resolves <treeId>/<database>/<collection>
```

### Connections View

Persisted connections use `clusterId = storageId`. Reconstruct the current folder path from storage with `buildFullTreePath()`; do not persist or guess an old `treeId`.

Synthetic nodes are not in connection storage. Their feature must own:

- an exact, side-effect-free ownership predicate
- tree path builders used by rendering and reveal code
- stable-ID-to-tree-ID resolution

The Connections provider may dispatch to that feature before falling back to persisted storage. Classify ownership **before invoking feature code**, so a feature resolver failure cannot break ordinary stored connections. See:

- `src/tree/connections-view/resolveConnectionsClusterTreeId.ts`
- `src/tree/connections-view/LocalQuickStart/quickStartTreeIdentity.ts`

Do not put feature-specific ID prefixes or synthetic paths into `buildFullTreePath()`.

### Discovery View

`clusterId` is provider-prefixed. The current `DiscoveryBranchDataProvider` removes that prefix and finds a cached tree node by its final suffix. Therefore every layout for that provider must end the cluster `treeId` with the same stable unprefixed suffix.

- Preserve visible hierarchy in preceding path segments.
- Use one helper to build the stable suffix for both `clusterId` and every tree layout.
- Make the suffix collision-safe within the provider.
- Test tree and list modes separately.
- Do not rely on cluster display names alone when uniqueness is scoped by project, namespace, context, or source.

This suffix lookup is a current compatibility contract, not an ideal general identity mechanism. Issue #869 tracks exact stable-identity lookup. Until that changes, new Discovery providers must satisfy the suffix contract.

### Azure Resources View

Direct lookup is valid only where the provider intentionally guarantees `clusterId === treeId`. Document that invariant and test it.

## Provider Responsibilities

Branch providers must implement both when their clusters can open Collection View:

- `findClusterNodeByClusterId(clusterId)`
- `findCollectionByClusterId(clusterId, databaseName, collectionName)`

Prefer one shared cluster-ID-to-tree-ID resolver so cluster and collection lookup cannot drift. Once the cluster node is known, use scoped child lookup to avoid expanding unrelated branches.

Do not silently fall back between providers or storage zones unless identity ownership is explicit. An owned but currently unavailable synthetic cluster should return `undefined`, not masquerade as a persisted connection.

## Required Tests for New Cluster Nodes or Layouts

Add focused tests before considering the feature complete.

### 1. Base cluster behavior

- The browsable item is a `ClusterItemBase` subclass.
- Its context value retains `treeItem_documentdbcluster` plus feature tags.
- `getCredentials()` is implemented for commands that need connection material.
- Expansion returns database nodes and base failure paths return retry/open-shell nodes as applicable.

Use `src/tree/documentdb/ClusterItemBase.test.ts` as the base-behavior reference.

### 2. Identity invariants

- `clusterId` is stable and slash-free.
- Moving folders or switching layout changes only `treeId`, not `clusterId`.
- IDs remain unique where display names can repeat.
- Cache operations use `clusterId`, not `treeId`.

Use `src/tree/connections-view/models/ConnectionClusterModel.test.ts` as a reference.

### 3. Render-to-lookup round trip (mandatory)

Construct the cluster through the **real parent/root item**, not only as a model fixture, then assert:

```typescript
expect(rendered.cluster.clusterId).toBe(expectedStableId);
expect(rendered.cluster.treeId).toBe(expectedTreePath);
expect(await provider.findClusterNodeByClusterId(rendered.cluster.clusterId)).toBe(rendered);
expect(await provider.findCollectionByClusterId(rendered.cluster.clusterId, databaseName, collectionName)).toBe(
  expectedCollection,
);
```

This test must exist for every materially different layout: root/folder, tree/list, or other synthetic hierarchy. It would have caught both the Atlas suffix mismatch and the Quick Start storage-path mismatch.

### 4. Ownership isolation for synthetic nodes

- Exact owned ID uses the feature resolver.
- Ordinary IDs never invoke the feature resolver.
- Owned-but-unavailable IDs do not fall through to persisted lookup.
- A feature resolver failure cannot affect ordinary persisted lookup.

Use `src/tree/connections-view/resolveConnectionsClusterTreeId.test.ts` as a reference.

### 5. Command compatibility

At minimum, verify the context contract and `getCredentials()` path needed by:

- Copy Connection String
- Open Shell
- Save/Add to Connections when enabled

If a command is intentionally unavailable, gate it explicitly with context values and document why; do not omit base behavior accidentally.

## Review Checklist

Before approving a cluster tree change, answer yes to all:

- [ ] Browsable cluster extends `ClusterItemBase`.
- [ ] Base cluster context tag is preserved.
- [ ] `clusterId`, `treeId`, and `viewId` have documented owners.
- [ ] Credentials and clients use `clusterId` only.
- [ ] Every rendered layout has a reverse lookup strategy.
- [ ] Cluster and collection lookup share one resolver.
- [ ] Synthetic ownership is exact and isolated from stored lookup.
- [ ] IDs are collision-safe beyond display names.
- [ ] A real render-to-lookup round-trip test covers every layout.
- [ ] Standard cluster commands work or are explicitly gated off.
