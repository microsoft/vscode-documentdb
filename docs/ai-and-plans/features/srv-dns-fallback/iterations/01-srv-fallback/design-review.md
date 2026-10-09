---
feature: srv-dns-fallback
kind: review
status: active
created: 2026-10-09
---

# Increment 1: design review of the dev plan

An external source and design review of [plan.md](./plan.md), received by the
operator on 2026-10-09. The reviewer compared issue #993 and the plan against the code and the
`mongodb` 7.2.0 driver. No runtime validation was done in the review itself.

Each observation below was **checked independently** before the plan was changed, because the
operator noted the feedback might be wrong. Checks were run against the driver installed in the
main checkout (`node_modules/mongodb`, 7.2.0) and the source on this branch (`v0.11.0`).

| #   | Severity | Observation                                                           | Verdict      | Plan change                         |
| --- | -------- | --------------------------------------------------------------------- | ------------ | ----------------------------------- |
| R1  | High     | The host-side preflight breaks Entra ID and managed identity          | **Confirmed** | WI-4 step 3 (was step 2), WI-6      |
| R2  | High     | Cancelling during DNS preparation can still run the playground code   | **Confirmed** | WI-4, WI-6                          |
| R3  | High     | "Exact driver semantics" is missing rules                             | **Confirmed** | WI-2, WI-3, WI-4 output             |
| R4  | Medium   | The fallback timeout is not bounded end to end                        | **Confirmed** | WI-3, WI-6; Q8 → D0018             |
| R5  | Medium   | The proposed diagnostic can report something false                    | **Confirmed** | WI-4 step 4, WI-7                   |
| R6  | —        | The differential test compares at the wrong boundary                  | **Confirmed** | WI-2 tests                          |

The reviewer's "would not expand" list (the transient rewrite, keeping the original string, asking
only the system resolver, host-side integration, and the already deferred SRV polling and
wrong-server-list gaps) matches the recorded decisions. Nothing changes there.

---

## R1: the host-side preflight breaks Entra ID and managed identity

**Claim.** WI-6 sets `authMechanism = 'MONGODB-OIDC'` on the host, and WI-4 step 2 then constructs
a `MongoClient` to validate the original URI. `OIDC_CALLBACK` exists only inside the worker, and the
driver validates credentials at construction time, so every Entra ID and managed identity SRV
connection from the shell or playground would fail, even on unaffected networks.

**Check.** Constructed real clients with driver 7.2.0:

```
new MongoClient('mongodb+srv://x.global.mongocluster.cosmos.azure.com/?tls=true',
                { authMechanism: 'MONGODB-OIDC', tls: true })
→ MongoInvalidArgumentError: Either a ENVIRONMENT, OIDC_CALLBACK, or OIDC_HUMAN_CALLBACK must be
  specified for mechanism 'MONGODB-OIDC'.

same URI, authMechanismProperties: { OIDC_CALLBACK: async () => { throw … } }
→ OK (no network access, the callback is never invoked)
```

Step 2 runs for every `+srv` string, before the probe, so the claim about unaffected networks also
holds. The `ClustersClient` path is not affected: its auth handlers put a real `OIDC_CALLBACK` in
`options` before the helper is called.

**Verdict:** confirmed, high. **Plan change:**

- The preflight runs **only on the fallback path**, after an eligible probe error. It exists to
  protect the rewrite. On the Node.js path the driver sees the original string anyway, so a
  preflight there adds nothing, and limiting it to the fallback path limits the impact of any bug in
  it.
- The preflight options are a copy of the worker-equivalent options. For `MONGODB-OIDC` without a
  callback or `ENVIRONMENT`, a **stub** `OIDC_CALLBACK` that rejects is added. The stub is never
  invoked, because the preflight client never connects. Nothing is serialized and no token is
  acquired.
- Tests use the real driver constructor for Entra ID and managed identity, on both the Node.js path
  and the fallback path.

---

## R2: cancelling during DNS preparation can still run the playground code

**Claim.** Cancellation today terminates the worker. With preparation placed before
`new Worker(...)`, a cancel during preparation finds no worker. The awaited preparation then
completes, spawns a worker, and `PlaygroundEvaluator` sends the evaluation right after
initialization, so a cancelled script (including writes) could still run.

**Check.** Read the code paths:

- `executePlaygroundCode.ts:186–191`: `token.onCancellationRequested` calls `evaluator.killWorker()`.
  `DocumentDBShellPty.ts:984` does the same for the shell.
- `WorkerSessionManager.terminateWorker()` terminates `this._worker` **if it exists**, sets the state
  to `idle`, and rejects pending requests. During preparation there is neither a worker nor a
  pending request, so nothing is interrupted.
- `PlaygroundEvaluator.evaluate()` awaits `ensureWorker(...)` and then immediately calls
  `sendEval(...)`. Nothing re-checks cancellation in between.

Today `new Worker()` is the first thing `initializeWorker` does, so the window does not exist. The
plan as written would open it.

**Verdict:** confirmed, high. The consequence (cancelled code still executing) is real. **Plan
change (WI-4, WI-6):**

- Each worker startup gets its own `AbortController`. `terminateWorker`, `killWorker` and `dispose`
  abort it.
- The abort signal reaches the Node.js probe (a `dns.promises.Resolver` instance, so `cancel()` is
  available; still the default timeout, per D0017), the fallback's SRV and TXT queries, and the
  preflight.
- After preparation, and again right before `new Worker(...)`, the manager checks the signal and
  throws `UserCancelledError` without creating a worker. `ensureWorker` therefore rejects, and
  `evaluate()` never reaches `sendEval`.
- "Rethrow the original probe error" gets an explicit exception: a `UserCancelledError` always
  propagates as cancellation.
- Test: hold DNS pending, cancel, then let DNS complete. Assert that no `Worker` was constructed and
  no `eval` message was posted, for the playground and the shell.

---

## R3: "exact driver semantics" is missing rules

**Claims and checks** (driver 7.2.0, real constructor):

| Claim                                                                       | Check                                                                                                                                                                                                                             | Result        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Absent TXT is valid                                                         | `resolveSRVRecord` returns the hosts without TXT options when the TXT lookup fails with `ENODATA` or `ENOTFOUND`. The plan never says this; WI-3 maps those replies to errors.                                                     | Confirmed     |
| TXT can introduce invalid combinations                                      | `+srv` with `srvMaxHosts=1&replicaSet=rs` → `Cannot use srvMaxHosts option with replicaSet`. The rewritten `mongodb://…/?replicaSet=rs` (with `srvMaxHosts` removed) → **accepted**. The driver also checks TXT-provided `replicaSet` against `srvMaxHosts` (`Cannot combine replicaSet option with srvMaxHosts`). | Confirmed     |
| Sampling hosts can hide an invalid load-balanced setup                      | `+srv` with `srvMaxHosts=1&loadBalanced=true` → `Cannot limit srv hosts with loadBalanced enabled`. Rewritten with two hosts and `loadBalanced=true` → `loadBalanced option only supported with a single host in the URI`. Sampling down to one host first would hide both errors. | Confirmed     |
| SRV-only options can be passed programmatically                             | Rewritten URI with `{ srvMaxHosts: 1 }` or `{ srvServiceName: 'custom' }` in the options → `Cannot use srvMaxHosts or srvServiceName with a non-srv connection string`.                                                           | Confirmed     |

**Verdict:** confirmed, high. **Plan change:** new WI-2 rules and fixtures. The helper also returns
**sanitized driver options** (a copy without `srvMaxHosts` and `srvServiceName`) alongside the
string. Caller-owned options are never mutated. Validation runs on the full target list, before any
`srvMaxHosts` sampling.

---

## R4: the fallback timeout is not bounded end to end

**Claim.** The cap applies to the custom DNS client only. The fallback's TXT lookup goes through
Node's default resolver (one more default timeout), and separate SRV and TXT calls could each get a
fresh budget. Separately, `WorkerSessionManager` starts its init timeout only when it sends the
`init` request, so preparation extends the effective connection timeout.

**Check.**

- The plan's WI-4 step 4 says "resolve TXT with Node (or WI-3 on an eligible Node error)". A Node
  TXT `ETIMEOUT` measured **27 s** on this machine (plan Q2, Investigation), outside any fallback
  cap.
- WI-3 describes "an overall cap" per client call, without saying it is shared across SRV and TXT.
- `WorkerSessionManager.initializeWorker` calls
  `sendRequest(initMsg, initTimeoutMs, settingsKeys.connectionTimeout)`, so the timer starts after
  any preparation.

**Verdict:** confirmed, medium. As the reviewer notes, this is separate from the accepted unbounded
probe (D0017), which is not reopened. **Plan change:** inside the fallback, TXT is resolved by our
own client too, started in parallel with SRV (as the driver does), and SRV, TXT and TCP retries
share **one** deadline (D0016). How preparation relates to the shell and playground init timeout is
a new operator question, **Q8**.

---

## R5: the proposed diagnostic can report something false

**Claim.** Matching `error.code === 'ECONNREFUSED'` on its own would classify an ordinary database
socket refusal as an SRV DNS failure. The wording asserts that the fallback failed, even when it
was disabled, and says the server rejected the lookup when c-ares may have rejected the server's
reply. Also undefined: the error when a forced fallback fails after a successful probe, where there
is no probe error to rethrow.

**Check.** WI-7 says "match `/querySrv (…|ECONNREFUSED)/` on the message **or** `error.code`". A
socket refusal carries `code: 'ECONNREFUSED'` with `syscall: 'connect'`, so the `error.code` branch
would match it. On the worker path, errors arrive as `new Error(msg.error)` (no `code`), so message
matching is required anyway. The provider receives only the error, so it cannot know whether the
fallback ran, failed or was disabled (D0011). WI-4 step 4 defines only "rethrow the original probe
error".

**Verdict:** confirmed, medium. **Plan change:** WI-7 requires evidence of an SRV DNS operation (the
message starts with `querySrv `, or `syscall === 'querySrv'`), never `code` on its own. The wording
does not claim anything about the fallback's outcome or about who rejected what. Negative tests
cover an ordinary TCP refusal and a disabled fallback. WI-4 step 4 defines the forced-fallback case:
the fallback's own error is thrown (development only, D0010).

---

## R6: the differential test compares at the wrong boundary

**Claim.** `resolveSRVRecord` does not apply `srvMaxHosts` sampling; the topology constructor does.
For `srvMaxHosts=1`, comparing host lists directly would fail even for a correct rewrite.

**Check.** In `mongodb/lib/sdam/topology.js` lines 88–92, the `Topology` constructor applies
`shuffle(seedlist, options.srvMaxHosts)`. `resolveSRVRecord` returns every target.

**Verdict:** confirmed. **Plan change:** the differential test compares resolution and option
semantics (TXT handling, TLS, `replicaSet`, `loadBalanced`, `credentials.source`, the error class
and message) against `resolveSRVRecord` on the **full** target list. Host selection is tested
separately: the selected count is `min(srvMaxHosts, targets)`, every selected host is a target,
and an injected random source makes the exact selection deterministic.
