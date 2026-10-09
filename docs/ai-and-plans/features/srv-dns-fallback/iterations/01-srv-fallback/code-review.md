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
focus on the high-risk areas: the OIDC preflight (R1), cancellation before a worker is created (R2),
parity with the driver (D0004, R3, R6), never persisting or logging credentials or the rewritten
string, `clusterId` keying, error identity, the fallback DNS client, the tree refresh, and timing
(D0016–D0018). No earlier milestone review was run. The M6 cancellation risk was covered by tests
that hold DNS pending and then cancel.

## Findings and triage

| #   | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                           | Triage                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Medium   | `withSrvResolutionTooltip` copied the existing tooltip with `Object.assign(md, tooltip)`. In VS Code, `MarkdownString` keeps its text in a private `#delegate` field behind prototype accessors, so nothing was copied: every fallback-resolved cluster's tooltip would have shown only the DNS line, losing the host, auth and TLS-disabled warning. The jest mock stores `value` as an own field, which hid it. | **Fixed** in the M8 commit by the WI-10 coding agent. The helper returns a tooltip that already has the line unchanged, and otherwise copies `value`, `supportThemeIcons`, `isTrusted`, `supportHtml` and `baseUri` explicitly. The tooltip, `BaseExtendedTreeDataProvider` and `ClusterItemBase` tests now use a `MarkdownString` double with private-field accessors; they failed before the fix. |

No other findings.

> **Update (2026-10-09).** The operator later removed the tooltip line altogether (D0021), so C1's
> code no longer exists.

## Areas checked and found correct

The reviewer reported these as checked, with no finding:

- **R1 preflight.** It runs only on the fallback path; in driver 7.2.0 the `MongoClient` constructor
  opens no sockets, starts no timers and invokes no OIDC callback. The stub goes only into a
  preflight copy of the options and never reaches the returned options. The worker path receives
  only serializable options plus `ALLOWED_HOSTS` computed from the original string.
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
- **`clusterId` keying.** The summary, tooltip, refresh notification and the `renderedClusters`
  outer key all use `clusterId`; `treeId` is only the inner row key.
- **Error identity.** The original probe error is rethrown by identity after a fallback DNS failure;
  preflight and rewrite errors pass through as they are; R5 force-mode case correct; the diagnostics
  provider requires SRV evidence.
- **Fallback DNS client.** Reply matching (source address and port, ID, QR, question), TCP framing,
  one shared deadline, sockets closed on every path, empty or invalid server lists, authoritative
  `NXDOMAIN`/`NODATA`.
- **Tree refresh.** No loop, the map is bounded (cleared on refresh and dispose), no runtime import
  cycle.
- **Timing.** The probe has no extra limit; the fallback deadline is `min(20 s, connectionTimeout)`;
  the worker init timeout starts after preparation.
