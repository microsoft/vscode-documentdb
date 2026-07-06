# Connection Reachability Providers

_Status: implemented on `dev/guanzhousong/kubernetes-service-discovery` (PR #621 follow-up)._

## Problem

`DocumentDBClusterItem` is the **generic** Connections-view tree node for every saved cluster. While
adding Kubernetes service discovery, it grew a Kubernetes-specific method,
`ensureKubernetesPortForwardIfNeeded()`, called from three connect-time code paths:

- `getCredentials()`
- `authenticateAndConnect()`
- `beforeCachedClientConnect()`

The reason is real: a saved **Kubernetes ClusterIP** connection stores its connection string as
`127.0.0.1:<localPort>` plus port-forward metadata, and that string only works while a local
port-forward tunnel is active. So before connecting we must (re-)establish the tunnel.

The smell is that a generic node had to **know that Kubernetes exists**. Any future source that needs a
pre-connect step (an SSH tunnel, Azure Bastion, a cloud proxy, …) would pile another
`ensureXyzIfNeeded()` into the same generic class.

## Decision

Introduce a small **provider registry** so the generic node asks a source-agnostic question — _"does
anything need to make this connection reachable first?"_ — instead of naming any one source.

This mirrors the established singleton-registry pattern already used by `DiscoveryService` and
`MigrationService`.

### Pieces

| Piece                                                                                      | Location                                                            | Responsibility                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ConnectionReachabilityProvider` (interface) + `ConnectionReachabilityService` (singleton) | `src/services/connectionReachabilityService.ts`                     | Generic, source-agnostic registry. Lives in `services/` beside `discoveryServices.ts`. |
| `KubernetesReachabilityProvider`                                                           | `src/plugins/service-kubernetes/KubernetesReachabilityProvider.ts`  | Kubernetes-specific implementation. Lives in the plugin that owns the behavior.        |
| Registration                                                                               | `src/documentdb/ClustersExtension.ts` (`registerDiscoveryServices`) | Wires the provider at activation, next to the discovery-provider registrations.        |
| Consumption                                                                                | `src/tree/connections-view/DocumentDBClusterItem.ts`                | Calls `ConnectionReachabilityService.ensureReachable(properties)` before connecting.   |

### Interface

```ts
export interface ConnectionReachabilityProvider {
  readonly id: string;
  // Cheap, side-effect-free check against the stored connection properties.
  appliesTo(connectionProperties: Record<string, unknown> | undefined): boolean;
  // Runs the preparation step (e.g. re-open a tunnel). Only called when appliesTo is true.
  ensureReachable(connectionProperties: Record<string, unknown>): Promise<void>;
}
```

`DocumentDBClusterItem` now keeps a single thin wrapper:

```ts
private async ensureConnectionReachable(connectionProperties: Record<string, unknown> | undefined) {
    await ConnectionReachabilityService.ensureReachable(connectionProperties);
}
```

## Why this placement

- **`services/`** holds the generic registry because it is **source-agnostic** and matches the existing
  `DiscoveryService` / `MigrationService` singletons. The Connections-view node depends on a service, not
  on a plugin.
- **The plugin** holds `KubernetesReachabilityProvider` because the behavior (and its heavy
  `@kubernetes/client-node` dependency) belongs to the Kubernetes source. The generic layer never imports
  the plugin.

## Laziness preserved

The original code used a **dynamic import** to keep the heavy tunnel machinery out of the
Connections-view load path. That property is kept:

- `KubernetesReachabilityProvider` statically imports only `portForwardMetadata` (dependency-light).
- The heavy `ensureKubernetesPortForward` (which pulls in `@kubernetes/client-node`) is still imported
  **lazily inside `ensureReachable()`**, so it loads only when a Kubernetes port-forward connection is
  actually opened — not at activation and not for non-Kubernetes connections.

## Behavior & safety

- **No behavior change** for users. Non-Kubernetes connections hit a no-op (no provider applies). Kubernetes
  ClusterIP connections re-establish the tunnel exactly as before.
- **Re-reads on every connect.** `ensureReachable` is invoked with the freshly loaded stored properties on
  each connect attempt, so there is no stale state (this is why a metadata-driven check was preferred over a
  subclass fixed at construction time — see "Alternatives").
- **Failures propagate** to the connect flow, where the existing `callWithTelemetryAndErrorHandling`
  wrappers report them.

## Alternatives considered

- **Subclass `KubernetesConnectionClusterItem` selected by a factory.** Rejected: the deciding signal
  (port-forward metadata) is read from storage and can change; binding "is a Kubernetes connection" to the
  object's **type at construction** is more brittle than a per-connect metadata check, and it adds factory
  indirection at the three `new DocumentDBClusterItem(...)` sites.
- **Leave the inline method, just extract a helper.** Rejected as the primary fix: it tidies the code but
  does not remove Kubernetes knowledge from the generic node, and does not give future sources a clean seam.

## Adding a new source later

1. Implement `ConnectionReachabilityProvider` in that source's plugin (lazy-import any heavy deps inside
   `ensureReachable`).
2. Register it once in `ClustersExtension.registerDiscoveryServices` via
   `ConnectionReachabilityService.registerProvider(...)`.

No change to `DocumentDBClusterItem` is required.

## Tests

- `src/services/connectionReachabilityService.test.ts` — applies/skips routing, undefined properties,
  failure propagation, idempotent re-registration by id.
- `src/plugins/service-kubernetes/KubernetesReachabilityProvider.test.ts` — `appliesTo` gating and lazy
  delegation to `ensureKubernetesPortForward`.
