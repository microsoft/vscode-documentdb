---
feature: srv-dns-fallback
kind: review
status: active
created: 2026-10-09
---

# Increment 1: end-of-work code review (M8)

One code review of the whole branch, `git diff v0.11.0..HEAD` at `cbd711d6`, run by a `code-review`
agent (`claude-opus-5.5`) at milestone M8. The brief pointed it at [plan.md](./plan.md),
[../../decisions.md](../../decisions.md) and [design-review.md](./design-review.md), and asked it to
focus on the high-risk areas: cancellation before a worker is created (R2), parity with the driver
(D0004, R3, R6), never persisting or logging credentials or the rewritten string, `clusterId`
keying, error identity, the fallback DNS client, and timing (D0016–D0018). No earlier milestone
review was run. The M6 cancellation risk was covered by tests that hold DNS pending and then
cancel.

## Findings and triage

No findings apply to the current code.

## Areas checked and found correct

The reviewer reported these as checked, with no finding:

- **R2 cancellation.** `terminateWorker`, `killWorker`, `dispose` and `shutdown` (with no worker) abort
  the per-startup controller. The signal is checked after preparation and before `new Worker`.
  Stale-startup guards compare controller identity. `UserCancelledError` is rethrown after every
  telemetry wrapper that swallows it (adapter, `spawnWorker`, `PlaygroundEvaluator`). The
  abort-versus-result race is closed.
- **R3/R6 driver parity.** Parent-domain check, TXT rules, `$external`/credentials rule for
  `authSource`, `replicaSet`/`srvMaxHosts`/`loadBalanced` validation on the full target list,
  `tls` default, removal of `srvServiceName`/`srvMaxHosts` from URI and options, userinfo copied
  verbatim. Query re-encoding through `URLSearchParams` was checked with the real driver (`+` vs
  space, `%2B`, `%26`, `@` in `appName`, repeated and empty `readPreferenceTags`, invalid `%zz`,
  non-ASCII): every option parses the same.
- **Privacy.** Telemetry holds only categorical codes, classes and counts; error stacks are replaced
  by stack-less placeholders; trace lines never contain the connection string, userinfo or error
  messages. The rewritten string lives only in the `MongoClient` and the worker `init` message;
  nothing is written to `CredentialCache`, settings, storage or tree models.
- **`clusterId` keying.** The summary uses `clusterId`, never `treeId`.
- **Error identity.** The original probe error is rethrown by identity after a fallback DNS failure;
  rewrite errors pass through as they are; R5 force-mode case correct; the diagnostics
  provider requires SRV evidence.
- **Fallback DNS client.** Reply matching (source address and port, ID, QR, question), TCP framing,
  one shared deadline, sockets closed on every path, empty or invalid server lists, authoritative
  `NXDOMAIN`/`NODATA`.
- **Timing.** The probe has no extra limit; the fallback deadline is `min(20 s, connectionTimeout)`;
  the worker init timeout starts after preparation.
