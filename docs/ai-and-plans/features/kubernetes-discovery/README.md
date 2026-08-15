---
feature: kubernetes-discovery
kind: notes
status: active
prs: [621]
verified: 2026-08-14
code:
    - src/plugins/service-kubernetes/**
    - src/services/connectionReachabilityService.ts
---

# Kubernetes Discovery

**Status:** shipped · **Verified:** 2026-08-14

> How Kubernetes service discovery works, and why connect-time port forwarding had to become a
> generic extension point.

The Kubernetes discovery provider lists DocumentDB services from the user's kube contexts and lets
them connect. Connecting frequently requires a port-forward tunnel to be established first, which is
what forced the reachability-provider abstraction described below.

Its sibling is [atlas-discovery](../atlas-discovery/README.md); Atlas UX review iteration 1 aligned
the two deliberately.

## Code map

- `src/plugins/service-kubernetes/**` — the provider, source store, discovery tree, view-mode
  switching, and the port-forward machinery
- `src/services/connectionReachabilityService.ts` — the generic connect-time hook

## User docs

- [docs/user-manual/service-discovery-kubernetes.md](../../../user-manual/service-discovery-kubernetes.md)
- [docs/user-manual/service-discovery-kubernetes-getting-started.md](../../../user-manual/service-discovery-kubernetes-getting-started.md)

## Related skills

- [.github/skills/error-translation](../../../../.github/skills/error-translation/SKILL.md) —
  reachability providers translate infrastructure failures; they never show UI themselves
- [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)

## Architecture (intent — code is authoritative for behavior)

[connection-reachability-providers.md](./connection-reachability-providers.md) is the durable
document here, and it is referenced directly from the source. The short version:

- `DocumentDBClusterItem` is the **generic** Connections-view node for every saved cluster. While
  adding Kubernetes discovery it grew a Kubernetes-specific method called from three connect-time
  paths. That was the wrong direction of dependency.
- The fix is a registry: a plugin registers a **reachability provider**, and the generic cluster node
  asks the registry to make the connection reachable before connecting. The call is cheap and a
  no-op when no provider applies.
- Failures propagate into the connect flow's existing telemetry and error handling. Providers do not
  present UI.

## Timeline

| Date | PR   | What changed                                              | Docs                                                                                                                    |
| ---- | ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| —    | #621 | Kubernetes service discovery, pre-merge code review        | [iterations/01-kubernetes-discovery/pre-merge-code-review.md](./iterations/01-kubernetes-discovery/pre-merge-code-review.md) |
| —    | #621 | 0.9.0 bug-bash UX review, organized by user journey        | [iterations/01-kubernetes-discovery/bugbash-090-ux-review.md](./iterations/01-kubernetes-discovery/bugbash-090-ux-review.md) |
| —    | #621 | Reachability providers extracted (follow-up)               | [connection-reachability-providers.md](./connection-reachability-providers.md)                                           |

## Decisions

No separate `decisions.md`. The one architectural decision that outlived its iteration —
reachability providers — is its own area-root document.

## Open gaps

Tracked inside
[iterations/01-kubernetes-discovery/bugbash-090-ux-review.md](./iterations/01-kubernetes-discovery/bugbash-090-ux-review.md),
which was reconciled after merge and is a good model for journey-organized UX review.

## Reading order for newcomers

1. This README
2. [connection-reachability-providers.md](./connection-reachability-providers.md)
3. The bug-bash UX review, only if you need the reasoning behind a specific interaction
