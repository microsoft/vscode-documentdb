---
feature: srv-dns-fallback
kind: notes
status: active
created: 2026-10-09
code:
    - packages/documentdb-js-srv-resolver/**
    - src/documentdb/srv/**
    - src/documentdb/ClustersClient.ts
    - src/documentdb/playground/WorkerSessionManager.ts
    - src/documentdb/playground/PlaygroundEvaluator.ts
    - src/documentdb/playground/playgroundWorker.ts
    - docs/user-manual/troubleshooting-srv-dns.md
---

# SRV DNS fallback

**Status:** implemented on the branch (increment 1, M1–M8); manual verification pending · **Issue:** [#993](https://github.com/microsoft/vscode-documentdb/issues/993) ·
**Branch:** `dev/tnaum/c-ares-workaround`

> Why `mongodb+srv://` connections get their own in-memory SRV resolver as a fallback, and why
> the resolved `mongodb://` string never leaves memory.

On some networks a `mongodb+srv://` connection fails before any socket to the server is opened:

```
Error: querySrv EBADRESP _mongodb._tcp.<cluster>.global.mongocluster.cosmos.azure.com
```

Node.js resolves SRV records with **c-ares**, not the OS resolver. Since c-ares **1.34.7**
([c-ares/c-ares#1190](https://github.com/c-ares/c-ares/pull/1190)), the reply parser rejects DNS
name compression inside SRV RDATA. Home routers, phone hotspots and Samba AD domain controllers
compress the SRV `TARGET`, and an Azure DocumentDB target shares a long suffix with the queried
name, so a compressing forwarder almost always uses a pointer. VS Code builds on Node.js 24.19+
bundle c-ares 1.34.8, so users can start seeing this after a VS Code auto-update, with no change on
their side. The upstream fix ([c-ares/c-ares#1290](https://github.com/c-ares/c-ares/pull/1290))
was closed without merging; any fix would still need to ship through c-ares, Node.js, Electron and
VS Code.

The full root-cause analysis, platform exposure table and interim workarounds live in the issue.
They are not duplicated here.

## Intent (code is authoritative for behavior once it exists)

- **Unaffected users see no change.** The driver keeps receiving the original `mongodb+srv://`
  string whenever Node's resolver works. This also keeps the driver's SRV polling.
- **The fallback triggers only on a broken or refused reply.** It runs only when Node rejects the
  reply or the query (`EBADRESP`, `EFORMERR`, `ECONNREFUSED`). Our own resolver (`dns-packet` over
  UDP, then TCP) then asks the **same system DNS servers** (`dns.getServers()`), in order. No public
  resolvers, no DNS over HTTPS. An environment variable turns it off for support cases; there is no
  user setting.
- **The rewrite is transient.** The fallback produces a `mongodb://host1:port1,…` string, in
  memory, at client-creation time, on every new connection. It is never written to storage,
  secrets, settings, tree models or the credential cache. Every user-facing feature keeps using
  the persisted `+srv` string.
- **It keeps the driver's SRV semantics.** That means the parent-domain check, the TXT option
  allowlist, implicit `tls=true`, `srvMaxHosts`, `srvServiceName`, and the `$external` auth rule
  for TXT `authSource`.
- **Every SRV connection is observable.** One telemetry event per `+srv` connection records which
  path resolved it and why. Trace-level output in the extension output channel shows each step,
  for support and local debugging.
- **The ID identifies the current connection, not its source.** SRV output uses
  `[SrvResolution] startup=<UUID>`, matching the enclosing extension or worker startup summary,
  and the SRV event carries the same `startupCorrelationId`. A shell's metadata link or session ID
  is never logged in its place. See the
  [connection IDs](../../telemetry-correlation-ids.md#connection-ids-2026-10-12).
- **Visible in the trace, later on the dashboard.** The `[SrvResolution]` trace says when the
  fallback resolved a connection; the cluster dashboard will show it (D0021).
- **Ships as `v0.11.1`**, which is `v0.11.0` plus this fix, from `release/0.11.1`. It is then
  forward-merged into `main` for 1.0.

## Code map

Increment 1 ([plan](./iterations/01-srv-fallback/plan.md), progress recorded per work item).

| Site                                                                                                 | Surface                       | What it does                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/documentdb-js-srv-resolver/` (`@documentdb-js/srv-resolver`, published after merge, D0023) | —                             | No VS Code imports. `srvUriRewrite.ts` (driver-equivalent rewrite), `fallbackDnsClient.ts` (`dns-packet` over UDP/TCP), `resolveSrvForDriver.ts` (probe, fallback, error and cancellation rules), `report.ts`, `constants.ts` (D0016 timings), `types.ts` |
| `src/documentdb/srv/prepareDriverConnectionString.ts`                                                | All                           | Extension adapter: environment switches, deadline, trace output, `connect.srvResolution` telemetry, `UserCancelledError`                                                                                                                                  |
| `src/documentdb/srv/srvResolutionTelemetry.ts`, `srvResolutionSummary.ts`                            | All                           | Telemetry properties without hosts or IPs; the in-memory summary kept on `ClustersClient` for the future dashboard (D0021)                                                                                                                                |
| `src/documentdb/srv/SrvDnsDiagnosticsProvider.ts`                                                    | Error messages                | Neutral, actionable text for `querySrv EBADRESP`/`EFORMERR`/`ECONNREFUSED` (WI-7)                                                                                                                                                                         |
| `src/documentdb/ClustersClient.ts`                                                                   | Tree, webviews, commands      | Resolves between `configureAuth()` and `new MongoClient()`; `getSrvResolution(clusterId)`                                                                                                                                                                 |
| `src/documentdb/playground/WorkerSessionManager.ts`, `PlaygroundEvaluator.ts`                        | Interactive shell, playground | Resolves on the host before `new Worker()`; per-startup abort; rethrows cancellation                                                                                                                                                                      |
| `src/documentdb/playground/playgroundWorker.ts`, `workerTypes.ts`                                    | (worker)                      | Unchanged driver call; OIDC allowed hosts taken from the host                                                                                                                                                                                             |
| `docs/user-manual/troubleshooting-srv-dns.md`                                                        | Docs                          | Symptoms, confirmation, workarounds, timing, trace, switches                                                                                                                                                                                              |
| `src/services/localQuickStart/QuickStartService.ts`, `connectToClient.ts`                            | —                             | Out of scope (D0007); `connectToClient` is deprecated                                                                                                                                                                                                     |

## Timeline

| Date       | PR   | What changed                                                                                                   | Docs                                                                                                                           |
| ---------- | ---- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-09 | —    | Feature folder and dev plan                                                                                    | [iterations/01-srv-fallback/plan.md](./iterations/01-srv-fallback/plan.md)                                                     |
| 2026-10-09 | —    | Operator answers Q1, Q3–Q7 (D0011–D0016); Q2 investigated; future work                                         | [decisions.md](./decisions.md), [future-work.md](./future-work.md)                                                             |
| 2026-10-09 | —    | Q2 answered (D0017); `v0.11.1` release steps confirmed (D0015)                                                 | [decisions.md](./decisions.md)                                                                                                 |
| 2026-10-09 | —    | Design review: findings verified and folded into the plan; Q8 added and answered (D0018)                       | [iterations/01-srv-fallback/design-review.md](./iterations/01-srv-fallback/design-review.md)                                   |
| 2026-10-09 | —    | VS Code-independent logic goes into workspace package `@documentdb-js/srv-resolver` (D0020, WI-0)              | [decisions.md](./decisions.md)                                                                                                 |
| 2026-10-09 | —    | D0005, D0007–D0010 accepted; `connectToClient` deprecated; iteration 01 moved into a folder                    | [decisions.md](./decisions.md)                                                                                                 |
| 2026-10-12 | -    | Increment 1 implemented; end-of-work review; simplified per operator review (D0022); manual checks 2-8 pending | [plan.md Outcome](./iterations/01-srv-fallback/plan.md#outcome), [code-review.md](./iterations/01-srv-fallback/code-review.md) |
| 2026-10-12 | #997 | PR pre-review with the Copilot reviewer's comments cross-checked; proposed solutions, author decisions pending | [pr-997-review.md](./iterations/01-srv-fallback/pr-997-review.md)                                                              |

## Decisions

See [decisions.md](./decisions.md). D0001 to D0004 are the operator's own positions from issue #993.
D0011 to D0018 are the operator's answers to the plan's open questions (2026-10-09). D0020 to D0022
are later operator decisions (workspace package, no tree flag, option validation left to the
driver). D0005 and D0007 to D0010 were accepted by the operator on 2026-10-09 (D0007 with
`connectToClient` marked deprecated). Every decision is settled.

## Open gaps

- **Wrong DNS servers.** If `dns.getServers()` returns the wrong servers (c-ares 1.34.6,
  `127.0.0.1` on Windows, [nodejs/node#62326](https://github.com/nodejs/node/issues/62326)), the
  fallback asks the wrong server as well. Only an OS-level resolver (`os-dns-native`) would cover
  that case. Telemetry sizes it (D0012); see [future-work.md](./future-work.md) FW-3.
- **No SRV polling on the fallback path.** A client created from the rewritten string does not
  re-poll SRV. A long-lived cached client does not follow `.global.` failover until it is
  recreated (D0013). See [future-work.md](./future-work.md) FW-1, and FW-2 for the wider plan:
  showing the servers behind a connection, and letting the user reconnect or refresh it.

## Reading order

1. Issue #993: root cause and alternatives
2. This README
3. [decisions.md](./decisions.md)
4. [iterations/01-srv-fallback/plan.md](./iterations/01-srv-fallback/plan.md): the dev plan
5. [iterations/01-srv-fallback/design-review.md](./iterations/01-srv-fallback/design-review.md): design review
   findings and the evidence behind them
6. [iterations/01-srv-fallback/code-review.md](./iterations/01-srv-fallback/code-review.md): end-of-work
   code review and its triage
7. [iterations/01-srv-fallback/pr-997-review.md](./iterations/01-srv-fallback/pr-997-review.md): PR #997
   review, Copilot cross-check, proposed solutions and author decisions
8. [future-work.md](./future-work.md): deferred items
