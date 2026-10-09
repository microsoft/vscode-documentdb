---
feature: srv-dns-fallback
kind: plan
status: active
created: 2026-10-09
code:
    - src/documentdb/ClustersClient.ts
---

# SRV DNS fallback: future work

Items deferred from increment 1. Each one records why it was deferred and what would decide it.

## FW-1: Follow failover on clients created through the fallback

**Deferred by:** D0013 (plan Q3, option A).

A client built from the rewritten `mongodb://` string does not poll SRV. After a `.global.`
failover or a replica promotion, the cached client keeps connecting to the old targets until it is
disposed. Today that happens only when credentials change (`ClustersClient.deleteClient` is called
from the auth-retry and update-credentials paths) or when VS Code reloads.

| Option                                                                                                                             | Pros                                                                              | Cons                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B. Recreate on reconnect** in `getClient` when the last resolution was `fallback` and the client is not connected                | Picks up new targets the next time the user acts. Small change, in one place.     | `getClient` calls `connect()`, which does nothing when already connected, so telling "disconnected" from "connected" is subtle. `llmEnhancedFeatureApis` and `QueryInsightsApis` hold the old client and must be rebuilt. |
| **C. Our own SRV poller** for fallback clients: re-resolve periodically (TTL-based); on change, evict                              | Closest to the driver's behavior.                                                 | Background DNS traffic, timers, lifecycle and error handling with no user present. The largest change.                                                                                                                    |
| **D. Evict on topology loss:** listen for SDAM events (`topologyDescriptionChanged`, heartbeat failures) with no servers available | Reacts only when it matters. No polling.                                          | Event wiring is fiddly. A short network blip can cause an unnecessary eviction.                                                                                                                                           |
| **E. User-initiated reconnect** (FW-2)                                                                                             | Explicit, and useful for every connection, not only fallback ones. No heuristics. | The user has to notice and act. On its own it does not fix the problem automatically.                                                                                                                                     |

**Decide with:** `connect.srvResolution` counts for `path=fallback` (the size of the affected group),
joined with later operation failures on the same `connectionCorrelationId`. E is worth building
regardless (FW-2). B or D would come on top only if fallback users still hit stale clients.

## FW-2: Show the servers behind a connection, and let the user reconnect or refresh

**Raised by:** operator, 2026-10-09: "envision visibility of the underlying servers, and having an
ability to reconnect/refresh … this is still missing and we wanted to add it one day anyway."

This applies to **every** connection, not only SRV or fallback ones. Today a connection is opaque:
the user sees the name they gave it, not which hosts the driver resolved, which one is primary, or
whether they are reachable. The only way to start over is to reload VS Code or change credentials.

### Envisioned capabilities

1. **What the connection resolved to.** For a connected cluster, show the stored endpoint (the
   `+srv` host or the host list), then the resolved servers: host, port, role (primary, secondary,
   arbiter, mongos, load balancer), and state (reachable, unknown, unreachable, with the last
   error). Show how it was resolved (`direct`, `SRV via Node.js`, `SRV via fallback`) and when.
   Increment 1 already provides the data for the tree's connection: `SrvResolutionSummary` from
   `ClustersClient.getSrvResolution(clusterId)` (D0019). The tooltip shows it today; the dashboard
   should reuse the same summary, extended to shell and playground sessions.
   Sources: the driver's public SDAM events (`topologyDescriptionChanged`,
   `serverDescriptionChanged`, `serverHeartbeatSucceeded/Failed`), the `srvResolution` result from
   this feature, and `getClusterMetadata`. Avoid reading the driver's internal `client.topology`.
2. **Where.** Options to evaluate:
   - a "Servers" child node, or extra lines in the cluster node tooltip;
   - a cluster-dashboard section (see the `cluster-dashboard` feature, which already gathers
     cluster-wide facts);
   - a "Show Connection Details" command that writes a summary to the output channel, cheapest
     and handy for support.
3. **Reconnect / refresh.** A command on the cluster node ("Reconnect") that:
   - calls `ClustersClient.deleteClient(clusterId)`, ends shell and playground workers bound to
     that cluster (or marks them stale), then reconnects so DNS (SRV, including the fallback) is
     resolved again;
   - leaves `CredentialCache` alone, so no prompt appears unless credentials are actually invalid;
   - refreshes the cluster's subtree afterwards.

   The existing `refresh` commands only refresh the tree; they never recreate the client. Name
   the new action so the difference is clear.

4. **Telemetry.** `connection.reconnect` with `surface`, `trigger` (`user`, or an automatic trigger
   if FW-1 B or D is built), `previousResolution`, `newResolution`, and `hostsChanged`. This shows
   whether stale-client problems are real and whether reconnect fixes them.
5. **Error translation.** A topology failure can point to "Reconnect" as the action through
   `ConnectionDiagnosticsService`. The rule there stays the same: the provider returns text and
   never reconnects by itself.

### Open questions for later

- Tree node, dashboard, or both? A child node adds tree noise for every cluster.
- Should "Reconnect" also restart open shell sessions, or only warn that they still use the old
  client?
- Does the information in capability 1 help non-Azure users (Atlas, Kubernetes, local) as well?
  Probably yes, which argues for building it as a general connection feature, not inside
  `srv-dns-fallback`. Move it to its own feature folder when the work starts.

## FW-3: A native OS resolver as a first try

**Deferred by:** issue #993 and D0003.

Add `os-dns-native` (`DnsQuery` on Windows, `res_nquery` elsewhere) ahead of the `dns-packet`
fallback. It is the only option that covers `dns.getServers()` returning the wrong servers
(c-ares 1.34.6, nodejs/node#62326). It needs prebuilt binaries for every OS and CPU, which means
per-platform VSIXs.

**Decide with:** `connect.srvResolution` where `nodeErrorCode=ECONNREFUSED` and
`fallbackOutcome=failed` (D0012). That is the share of users a native resolver would still help.
