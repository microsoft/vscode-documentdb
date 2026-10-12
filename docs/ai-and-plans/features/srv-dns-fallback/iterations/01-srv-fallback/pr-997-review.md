---
feature: srv-dns-fallback
kind: review
status: active
created: 2026-10-12
---

# PR #997 review: findings, Copilot cross-check, proposed solutions

AI pre-review of [PR #997](https://github.com/microsoft/vscode-documentdb/pull/997) (CONTRIBUTING
§6.1), `git diff origin/release/0.11.1...HEAD` at `6940c641`, run by GitHub Copilot
(`claude-opus-5.5`). The review covers the full branch: the `@documentdb-js/srv-resolver` package,
the extension adapter, `ClustersClient`, `WorkerSessionManager`, the shell and playground wiring,
diagnostics, telemetry, docs and release metadata. The GitHub Copilot reviewer's three comments
(made at `8d629ccb`) were pulled from the PR, re-checked against `6940c641` and re-rated.

Not yet done: the §6.1 step 3 validation gate with a model from a different vendor.

## Summary

| ID  | Source                 | Severity     | Finding                                                                | Author decision                      |
| --- | ---------------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| C1  | Copilot, valid         | Medium       | Webview errors never get the SRV explanation                           | A: fixed in `c3b9c28b`               |
| P1  | Review                 | Medium       | A refused DNS query costs a full UDP timeout, not milliseconds (D0012) | A: fixed in `af0af52f`               |
| P2  | Review                 | Medium       | Troubleshooting link is 404 until the docs reach `main`                | No change: release process covers it |
| P3  | Review                 | Medium       | Version is `0.11.1-preview`, not `0.11.1`                              | Dedicated work item                  |
| P4  | Review                 | Low          | One UDP attempt per server, no retransmit                              | A (refined): fixed in `c830c252`     |
| C2  | Copilot, doc-only      | Low          | Force mode still runs the Node.js probe; D0010 says it skips it        | A: D0010 updated in `b3e142d7`       |
| P5  | Review                 | Low (latent) | Concurrent `ensureWorker()` during SRV preparation can orphan a worker | C: `1c7e2f34`, issue #1002           |
| P6  | Review                 | Info         | D0022 overstates what the driver still validates                       | A: D0022 updated in `44c6dd3c`       |
| P7  | Review                 | Info         | `ClustersClient.getSrvResolution()` has no production caller           | A: keep, no change                   |
| P8  | Review                 | Info         | Feature README still says the package is not published                 | A: fixed in `7e012e66`               |
| C3  | Copilot, **not valid** | None         | Lowercase DNS names before the parent-domain comparison                | A: no change, replied in thread      |

Checked and found correct: the rewritten string is never logged or persisted; telemetry carries
only categorical codes, classes and counts; fallback queries use a random ID and source port and
match the reply's source, ID and question; `dns-packet` 5.6.1 rejects forward and looping name
pointers; OIDC `ALLOWED_HOSTS` is computed from the original `+srv` host (the parent-domain check
keeps targets inside it); the local-instance error hint reads the original string; cancellation
reaches the probe, the fallback and worker startup, and `PlaygroundEvaluator` now rethrows the
cancellation that the telemetry wrapper used to swallow.

---

## C1: Webview errors never get the SRV explanation

**Source:** [Copilot comment](https://github.com/microsoft/vscode-documentdb/pull/997#discussion_r4246112028) ·
**Severity:** Medium (Copilot did not rate it) · **Status at `6940c641`:** still valid

**Evidence.** Webviews send only the message across tRPC: `common.explainOperationFailure` calls
`ConnectionDiagnosticsService.explain({ clusterId, error: input.message })` with a `string`
([appRouter.ts](../../../../../../src/webviews/_integration/appRouter.ts#L160)). The provider
returns early on `!(error instanceof Error)`
([SrvDnsDiagnosticsProvider.ts](../../../../../../src/documentdb/srv/SrvDnsDiagnosticsProvider.ts#L18)),
so Collection View, Document View and Query Insights never show the SRV text. The test case
`'a non-Error value'` in `SrvDnsDiagnosticsProvider.test.ts` locks this in. Plan WI-7 already
matches on the message ("the worker path only has the message"), and
`KubernetesDiagnosticsProvider` uses `error instanceof Error ? error.message : String(error)`.

**Impact.** Only when a webview makes the first connection and the fallback fails or is disabled.
Usually the tree connects first, so the user sees the explained error there.

| Option                                                                                                                                                                                                                             | Pros                                                                                                                  | Cons                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A. Accept a string.** `const message = typeof error === 'string' ? error : error instanceof Error ? error.message : undefined`; keep the `UserCancelledError` exclusion; flip the `'a non-Error value'` test to expect the text. | One-line change. Matches WI-7 and the Kubernetes provider. The `querySrv ` prefix still guards against false matches. | The string path has only the message prefix as SRV evidence (already the case for worker-relayed errors). |
| **B. Add a `message` field to `ConnectionDiagnosticsRequest`** (the L5 follow-up from the local-quickstart error-translation review).                                                                                              | Fixes the class of bug for every provider.                                                                            | Touches the shared service and every provider. Too broad for a patch release.                             |
| **C. No change.**                                                                                                                                                                                                                  | None.                                                                                                                 | A surface the plan promises stays unexplained.                                                            |

**Recommendation: A** in this PR, then reply in the Copilot thread. Leave B for `main`.

**Author decision (2026-10-12): A**, as recommended.

**Done in [`c3b9c28b`](https://github.com/microsoft/vscode-documentdb/commit/c3b9c28b).** The
provider takes the message from a string or an `Error`, keeps the `UserCancelledError` exclusion
and the `querySrv ` evidence check, and reads `syscall` and `code` only from `Error` objects. The
old `'a non-Error value'` case is now a positive `'webview-relayed EBADRESP'` case; an unrelated
string and a non-string value stay untranslated. Replied in the Copilot thread.

---

## P1: A refused DNS query costs a full UDP timeout, not milliseconds

**Severity:** Medium

**Evidence.** D0012 makes `ECONNREFUSED` fallback-eligible because "a refused query fails within
milliseconds, so a useless fallback attempt costs almost nothing". The fallback sends from an
**unconnected** UDP socket (`udp.bind(0)` then `send(query, port, host)`,
[fallbackDnsClient.ts](../../../../../../packages/documentdb-js-srv-resolver/src/fallbackDnsClient.ts#L414)).
The kernel reports ICMP port-unreachable only on a connected UDP socket. Measured on Linux against a
closed port on `127.0.0.1`: unconnected, no error after 3,000 ms; connected, `ECONNREFUSED` after
7 ms.

**Impact.** In the c-ares 1.34.6 `127.0.0.1` case that D0012 names as the main source of
`ECONNREFUSED`, every SRV connection waits `FALLBACK_UDP_TIMEOUT_MS` (5 s) per server, up to
`min(20 s, connectionTimeout)`, before the original error is shown.

| Option                                                                                                                                           | Pros                                                                                                                                          | Cons                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Connect the UDP socket.** `udp.connect(server.port, server.host, () => udp.send(query, cb))`; drop or keep the manual source-address check. | Makes D0012's premise true: refusal in milliseconds. The kernel filters replies by peer, so the source check becomes redundant. Small change. | Windows reports a refused connected UDP send differently (`WSAECONNRESET`); `socketErrorCode` maps any socket error to `ECONNREFUSED`, so the worst case is today's timeout. Needs a closed-port stub test. |
| **B. Remove `ECONNREFUSED` from the eligible codes.**                                                                                            | No cost at all for refused queries.                                                                                                           | Reopens an operator decision (D0012) and loses any refusal the fallback could fix.                                                                                                                          |
| **C. Shorter UDP timeout when the probe failed with `ECONNREFUSED`** (for example 1 s).                                                          | Bounds the cost without touching sockets.                                                                                                     | Still costs 1 s per server. A heuristic, and a slow but working server is then given up too early.                                                                                                          |

**Recommendation: A**, with a test that a closed UDP port fails within a few hundred milliseconds,
and a one-line note in D0012 that the premise depends on a connected socket.

**Author decision (2026-10-12): A**, as recommended.

**Done in [`af0af52f`](https://github.com/microsoft/vscode-documentdb/commit/af0af52f).** The UDP
socket is connected to the server and sends without an address. The manual source-address check
and `normalizedAddress()` are removed because the kernel now filters replies by peer. New test:
a closed UDP port on `127.0.0.1` rejects with `ECONNREFUSED` in under 1 s with a 2 s UDP timeout.
D0012 gained a sentence saying the premise depends on the connected socket.

---

## P2: Troubleshooting link is 404 until the docs reach `main`

**Severity:** Medium (release process)

**Evidence.** `Links.SrvDnsTroubleshooting` points to
`https://microsoft.github.io/vscode-documentdb/user-manual/troubleshooting-srv-dns`, which returned
404 on 2026-10-12. The docs deploy (`deploy-documentation-production.yml`) runs only on pushes to
`main` and checks out `ref: main`, so merging into `release/0.11.1` does not publish the page.

| Option                                                                       | Pros                                      | Cons                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| **A. No change; merge into `main` after tagging and before publishing.**     | Fits the release process. No extra steps. | Depends on keeping that order.                                        |
| **B. Run the docs deploy manually (`workflow_dispatch`) before publishing.** | Independent of merge order.               | The workflow checks out `main`, so the page must be on `main` anyway. |
| **C. Link to the GitHub blob URL of the page.**                              | Works immediately.                        | Worse reading experience; a branch-specific URL in a shipped string.  |

**Recommendation: A.**

**Author decision (2026-10-12): A, no change.** The release is published from `main` only. The
branch is merged into `main` right after the release is tagged and before it is published, so the
docs deploy runs before any user can see the link.

---

## P3: Version is `0.11.1-preview`, not `0.11.1`

**Severity:** Medium (release blocker, not a merge blocker)

**Evidence.** `package.json` and `package-lock.json` carry `0.11.1-preview` (commit `72d3d019`,
developer-preview build). `CHANGELOG.md` and `docs/release-notes/0.11.md` say `0.11.1`. The
Marketplace does not accept semver pre-release suffixes.

| Option                                          | Pros                                  | Cons                                                |
| ----------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| **A. Set `0.11.1` in this PR.**                 | Branch is releasable as merged.       | Loses the distinct preview VSIX name during review. |
| **B. Set it in a dedicated release work item.** | Keeps the preview build identifiable. | Must not be forgotten before tagging.               |

**Recommendation: B**, tracked as part of the release steps.

**Author decision (2026-10-12): B.** The version is fixed in a dedicated work item.

---

## P4: One UDP attempt per server, no retransmit

**Severity:** Low

**Evidence.** `resolveFallback` sends one UDP query per server and moves on after
`FALLBACK_UDP_TIMEOUT_MS`
([fallbackDnsClient.ts](../../../../../../packages/documentdb-js-srv-resolver/src/fallbackDnsClient.ts#L158)).
The affected users mostly sit behind a home router, which is often the only server
`dns.getServers()` returns. One lost datagram fails the fallback after 5 s and shows the original
`EBADRESP`. c-ares retries several times.

| Option                                                                                                            | Pros                                                                   | Cons                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A. Walk the server list twice** (a second pass with a new socket and ID), still bounded by the shared deadline. | Small loop change. Handles one lost packet. New ID per try stays safe. | `fallbackServersTried` then counts attempts, not servers (rename or document). Worst case still bounded by the 20 s deadline. |
| **B. Retransmit on the same socket** after half the UDP timeout, accepting a reply to either send.                | Closest to c-ares. Faster recovery than A.                             | More timer logic inside `exchange()` and more tests.                                                                          |
| **C. No change.**                                                                                                 | No code.                                                               | The user retries by hand; telemetry shows it as `fallbackErrorCode=ETIMEOUT`.                                                 |

**Recommendation: A**, after P1 (so a refused server fails fast on both passes). If the branch must
stay minimal, C now and A on `main`, decided from `fallbackErrorCode=ETIMEOUT` telemetry.

**Author decision (2026-10-12): A**, as recommended.

**Done in [`c830c252`](https://github.com/microsoft/vscode-documentdb/commit/c830c252).** Refined
from A: the second pass retries only servers whose first attempt timed out. A refused server
(fast after P1) or a `SERVFAIL`/`REFUSED` rcode is not retried, and an authoritative answer still
stops at once. Each retry uses a new socket and query ID, and the shared deadline still bounds
all attempts. `serversTried` keeps counting distinct servers, so `fallbackServersTried` keeps its
meaning. New tests: a server that ignores the first query and answers the second; a `SERVFAIL`
server is queried once.

---

## C2: Force mode still runs the Node.js probe

**Source:** [Copilot comment](https://github.com/microsoft/vscode-documentdb/pull/997#discussion_r4246111883) ·
**Severity:** Low (Copilot: medium) · **Status at `6940c641`:** valid as a doc/code mismatch only

**Evidence.** D0010 says the switch "skips Node's resolver and treats the probe as `EBADRESP`". Plan
WI-4 (R5, "force switch after a **successful** probe") and the code
([resolveSrvForDriver.ts](../../../../../../packages/documentdb-js-srv-resolver/src/resolveSrvForDriver.ts#L99))
run the probe first. The switch is development-only; when the probe stalls on dead DNS, the
fallback asks the same dead servers and fails too, so skipping the probe gains little.

| Option                                                                                              | Pros                                                                                                       | Cons                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A. Change the D0010 text to match the code** (the probe runs; force only overrides the decision). | Keeps `nodeErrorCode` and `nodeProbeDurationMs` in forced reports, and the R5 tests as they are. Doc only. | None for production.                                                                  |
| **B. Skip the probe when `mode === 'force'`** (Copilot's suggestion).                               | Matches D0010 as written. Forced runs start faster when DNS is slow.                                       | Forced reports lose the probe result; R5 behaviour and tests change; no user benefit. |

**Recommendation: A**, then reply in the Copilot thread.

**Author decision (2026-10-12): A**, as recommended.

**Done in [`b3e142d7`](https://github.com/microsoft/vscode-documentdb/commit/b3e142d7).** D0010
now says the switch always runs the fallback whatever Node's resolver returns, and records that the
probe still runs first so forced events keep the probe fields. No code change. Replied in the
Copilot thread.

---

## P5: Concurrent `ensureWorker()` during SRV preparation can orphan a worker

**Severity:** Low (latent; no current caller triggers it)

**Evidence.** `_worker` is now assigned only after `await prepareDriverConnectionString(...)`
([WorkerSessionManager.ts](../../../../../../src/documentdb/playground/WorkerSessionManager.ts#L323)).
Meanwhile `ensureWorker()` checks `!this._worker || this._workerState === 'idle'`
([line 179](../../../../../../src/documentdb/playground/WorkerSessionManager.ts#L179)), so a
second call starts a second spawn, replaces `_startupAbortController` without aborting the first,
and the first worker is later overwritten in `_worker` and never terminated. Before this PR there
was no `await` between the check and the assignment. Today the playground guards with
`isExecuting(clusterId)` and the shell calls `initialize()` once.

| Option                                                                                                                                                                                | Pros                                                                                                              | Cons                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A. Join an in-flight startup.** Keep the spawn promise and its `clusterId`; a same-cluster call awaits it, a different-cluster call calls `terminateWorker()` (which aborts) first. | Closes the race for any future caller. Also stops a second caller from sending `eval` before the worker is ready. | New state in a class that just had a cancellation rework; needs tests. |
| **B. Treat `'spawning'` as busy and throw.**                                                                                                                                          | Few lines.                                                                                                        | Callers get an error instead of a worker.                              |
| **C. No code change; record the invariant** (callers serialize `ensureWorker`) in a one-line comment, and open an issue for A on `main`.                                              | No risk to the patch release.                                                                                     | The race stays latent.                                                 |

**Recommendation: C** for `release/0.11.1`, with an issue for A on `main` (CONTRIBUTING §6.5).

**Author decision (2026-10-12): C**, as recommended.

**Done in [`1c7e2f34`](https://github.com/microsoft/vscode-documentdb/commit/1c7e2f34).** One-line
comment above the spawn check in `ensureWorker()`; no behaviour change. Option A is tracked in
[#1002](https://github.com/microsoft/vscode-documentdb/issues/1002).

---

## P6: D0022 overstates what the driver still validates

**Severity:** Info

**Evidence.** D0022: "Option conflicts ... are rejected by the driver when it parses the rewritten
`mongodb://` string". `srvMaxHosts` is removed before the driver sees the string, so on the
fallback path `srvMaxHosts` with `replicaSet` or with `loadBalanced` is accepted, where the
`+srv` path rejects it. The effect is more lenient, not harmful.

| Option                                                                           | Pros                                 | Cons                                       |
| -------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| **A. Add one sentence to D0022** naming the `srvMaxHosts` conflicts as accepted. | Doc matches behaviour. No code risk. | None.                                      |
| **B. Restore the two `srvMaxHosts` conflict checks in `rewriteSrvUri`.**         | Exact driver parity.                 | Reverses the operator's KISS pass (D0022). |

**Recommendation: A.**

**Author decision (2026-10-12): A**, as recommended.

**Done in [`44c6dd3c`](https://github.com/microsoft/vscode-documentdb/commit/44c6dd3c).** D0022
names the exception: `srvMaxHosts` with `replicaSet` or `loadBalanced` is accepted on the fallback
path.

---

## P7: `ClustersClient.getSrvResolution()` has no production caller

**Severity:** Info

**Evidence.** `_srvResolution` and `getSrvResolution()` are used only by
`ClustersClient.test.ts`. D0021 keeps them for the cluster dashboard (future-work FW-2).

| Option                                      | Pros                                      | Cons                              |
| ------------------------------------------- | ----------------------------------------- | --------------------------------- |
| **A. Keep as recorded in D0021.**           | Dashboard work has its data source ready. | A small unused API until FW-2.    |
| **B. Remove; add back with the dashboard.** | Less code in the patch release.           | Churn; D0021 would need updating. |

**Recommendation: A.**

**Author decision (2026-10-12): A**, as recommended. No change; D0021 stands.

---

## P8: Feature README still says the package is not published

**Severity:** Info

**Evidence.** [README.md](../../README.md#L78) lists the package as "not published, D0020". D0023
and the new `publish_srv_resolver` workflow input plan to publish it after merge.

**Options.** A: change the cell to "published after merge, D0023". B: no change. **Recommendation:
A.**

**Author decision (2026-10-12): A**, as recommended.

**Done in [`7e012e66`](https://github.com/microsoft/vscode-documentdb/commit/7e012e66).**

---

## C3: Lowercase DNS names before the parent-domain comparison

**Source:** [Copilot comment](https://github.com/microsoft/vscode-documentdb/pull/997#discussion_r4246111965) ·
**Severity:** None (Copilot: medium) · **Status at `6940c641`:** not valid

**Evidence.** The rewrite mirrors the driver on purpose
([srvUriRewrite.ts](../../../../../../packages/documentdb-js-srv-resolver/src/srvUriRewrite.ts#L128)).
In the installed driver, `mongoOptions.srvHost = hosts[0]` (`lib/connection_string.js`), and
`hosts` comes from `mongodb-connection-string-url` with the case as typed
(`new ConnectionString('mongodb+srv://CLUSTER.Example.com/').hosts` is
`['CLUSTER.Example.com']`). The driver's `checkParentDomainMatch` (`lib/utils.js`) does not
lowercase either. An uppercase URI with lowercase SRV targets therefore fails the same way on the
driver path.

| Option                                                          | Pros                                                       | Cons                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **A. No change; reply in the thread with the driver evidence.** | Keeps driver parity and the differential tests meaningful. | None.                                                                                                  |
| **B. Lowercase both names in the fallback only.**               | More forgiving on the fallback path.                       | The two paths disagree: the same URI works only when Node's DNS is broken. Breaks the parity contract. |

**Recommendation: A.**

**Author decision (2026-10-12): A**, as recommended. No code change; replied in the Copilot thread
with the driver evidence.
