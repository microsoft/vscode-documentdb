---
feature: connectivity-troubleshooter
kind: review
status: active
issues: [1069]
prs: [1066]
created: 2026-11-09
updated: 2026-11-09
---

# Diagnose connection: Kubernetes port-forward review (#1069)

## Implementation run (2026-11-09)

The operator approved the recommended O1 + O6 paths with `/lead`, explicitly excluded
WI-K5/O7, and requested Case 1 and Case 2 verification followed by a push and green CI.
WI-K6/O2 remains deferred under the recommendation below. Advisor: `claude-opus-5.5`.
The original review below records the assessed pre-implementation behavior.

The advisor recommends `gpt-6.1-sol` for WI-K1, WI-K2, WI-K4, WI-G1 and WI-V1
(cross-module or lifecycle impact), `gpt-6.1-terra` for WI-K3 (bounded finding mapping),
and `gpt-6-luna` for WI-D1 (documentation). Execution is serial because several items
share finding messages and fixtures. The existing uncommitted feature README link addition
will be preserved and integrated with WI-D1.

An operator decision was requested about generic-service DKO-list 403 handling; the operator
was initially unavailable. Work paused when the operator requested the advisor's options.
After those options were presented, the operator directed: "make good decisions and keep working"
and "Keep working autonomously until the task is truly finished." Under that later instruction,
the leader selected Opus's recommended narrow exception: only generic services ignore a DKO-list
403 and continue to their annotated Secret; network failures still propagate, and DKO services
remain strict. This changes diagnostic failure handling only, not ordinary connections or permissions.

### Verification and handoff

Six implementation/documentation items are committed. WI-V1 remains a manual workbench gap,
not a passing outage experiment. WI-K5 is excluded and WI-K6 is deferred.

**Case 1:** `npm run build` passed; the focused Vitest run across the extension diagnostics,
Kubernetes plugin, reachability service, classification utility and package passed
69 files / 2,117 tests.

**Case 2:** all required commands ran: `npm run l10n`, `npm run prettier-fix`,
`npm run l10n:check`, `npm run lint`, `npm run build`, `npm run typecheck:tests`,
`npx vitest run`, and `npm run package`. All passed after the type-only WI-K2 lint follow-up
`2fd30d49`; it replaced an inline import type and annotated the caught error as `unknown`,
without changing behavior. The full runtime suite passed 384 files / 7,829 tests, with one
skipped test. The exact strict package-test type-check script passed separately.
The lint follow-up also passed 99 focused tests and `npx tsc --noEmit -p .`.
Generated localization and formatter output are committed separately as `0c54e890`.

The AI pre-review is this committed iteration and the item-specific Opus approvals recorded
below: eight completed advisor consultations plus one interrupted initial planning attempt.
All blocking verdicts were followed; optional broader changes were not added. The operator's
push instruction is authorized; final CI results will be reported against the pushed SHA.

## Scope and provenance

- **Issue:** [#1069](https://github.com/microsoft/vscode-documentdb/issues/1069), "Connection
  diagnostics: Kubernetes API or backend failure behind port-forward is reported as missing password
  or TLS/firewall" (opened 2026-11-06, open).
- **Tested build (issue):** the #1066 VSIX from CI run 42252782123 at `ab9ce33e`, Windows 11,
  VS Code 1.143.1, the kind lab from `scripts/k8s-test-setup.sh` (DKO 1.0.0, ClusterIP service,
  port-forward). A second tester reproduced all three runs in a separate VS Code profile.
- **Assessed head:** `8f8c8b4cfc81c6edfdbbc9fb63566135adee48f4` on
  `dev/tnaum/connectivity-troubleshooter`. `git diff ab9ce33e..8f8c8b4c` touches no Kubernetes,
  preparation, credential or result-derivation code (only report capping, timeout validation and
  panel-reuse wording), so the issue applies unchanged to this head.
- **Method:** source tracing; `npm run build`; 494 existing focused tests across the Kubernetes
  plugin, the extension's diagnostic checks and the package's TLS and runner checks (all pass);
  8 temporary isolated checks (deleted afterwards) that ran the real tunnel manager, the real
  `prepare` check and the package's real TCP and TLS checks against a loopback tunnel whose
  Kubernetes backend lookup failed. Authentication outcomes were injected in those checks.
- **Not done:** the Windows VSIX outage experiment was not repeated. The local kind lab
  (`kind-documentdb-dev`) was healthy and only read; no cluster state was changed.
- **Decision status:** findings and severities are verified; the options and work items below are
  proposals for the operator. Nothing is implemented.

## Summary

**The issue is valid. Every observation in it is reproduced or source-verified, and both proposed
causes are correct.** Two root causes produce all the wrong answers:

1. `prepare` reports **Port forward ready** after binding a local listener. The tunnel resolves its
   Kubernetes backend only when a connection arrives, so `prepare` never contacts the API or the
   service's endpoints ([I1](#i1-prepare-reports-ready-without-reaching-the-kubernetes-backend)).
2. The diagnostic credential read turns every Kubernetes API error into "no credentials", so an
   unreachable API becomes **Stored password unavailable**
   ([I2](#i2-the-credential-read-turns-kubernetes-api-failures-into-a-missing-password)).

Everything else follows: the package's TCP and TLS probes hit a local listener that accepts and then
closes, the extension words that as a server closing the handshake and adds firewall advice
([I3](#i3-a-local-tunnel-closing-the-socket-is-worded-as-a-server-and-firewall-problem)), and the
real cause stays in the Output channel ([I5](#i5-the-real-cause-reaches-only-the-output-channel)).

The 30-second authentication wait is **intended behavior**, not a defect
([I7](#i7-authentication-runs-after-the-failed-tls-probe)). It disappears once `prepare` fails
correctly, because authentication depends on `prepare`.

This review adds three findings not in the issue: a unit test that cannot catch I2
([N1](#n1-the-api-unreachable-unit-test-fails-at-a-step-that-never-fails)), a provider hint
that is vague in one case and would be wrong in another
([N2](#n2-the-kubernetes-provider-hint-is-vague-or-wrong-depending-on-the-case)), and the same
firewall advice on **direct** loopback connections, such as a stopped DocumentDB Local container
([N3](#n3-direct-loopback-connections-get-firewall-advice-too)).

**Recommended path:** fix Kubernetes **inside the existing `prepare` step** (no new framework), make
the diagnostic credential read strict, and make the generic transport wording loopback-aware so the
package and the extension never claim a firewall or a remote server for `127.0.0.1`. See
[Recommendation](#recommendation) and [Work items](#work-items).

## Severity

Severity follows the scale of [iteration 04](./04-parallel-pr-review.md#severity-and-agreement),
which this feature's reviews use:

- **high:** major correctness or reliability failure with substantial impact.
- **med:** meaningful incorrect diagnosis or breach of the report's identifier-hiding expectation in a
  supported workflow.
- **low:** narrower race or limited-impact behavior.

It is applied with the operator's guiding rule from iteration 04: "the diagnostics should not show
incorrect answers, something not showing a detail is better than showing an incorrect one". Wrong
answers are fixed; a missing detail may be a won't-fix.

### Verification of the severity

The first pass in chat (2026-11-09) rated the core findings **High** on an informal scale. Re-rated
against the scale above, they are **med**:

- **For med:** the diagnosis is wrong, not merely incomplete; it points at the password, TLS and a
  firewall instead of Kubernetes. It is deterministic (every run in these states, two testers). It
  contradicts the [user manual](../../../../user-manual/diagnose-connection.md#sign-in-is-never-prompted),
  which promises that an unreachable Kubernetes API is reported under **Connection settings** and
  stops the check there.
- **Against high:** only Kubernetes ClusterIP targets reached through the extension's tunnel are
  affected, a small share next to direct connections, which are the main use case. No credential or
  identifier leaks, nothing is changed or lost, the firewall text is hedged ("may"), the Output
  channel has the true cause, and a re-run passes after recovery.
- **Release impact:** med, but **blocking for the documented Kubernetes behavior** of the feature. Under
  the guiding rule the wrong answers must be fixed before handover; the alternative is to remove the
  Kubernetes promise from the manual, which does not stop the wrong answers.

| ID  | Finding                                                                  | Issue | Chat first pass  | **Verified**                         | Confidence                              |
| --- | ------------------------------------------------------------------------ | ----- | ---------------- | ------------------------------------ | --------------------------------------- |
| I1  | `prepare` reports ready without reaching the Kubernetes backend          | yes   | High             | **med**                              | High: isolated reproduction + source    |
| I2  | Credential read turns Kubernetes API failures into a missing password    | yes   | High             | **med**                              | High: isolated reproduction + source    |
| I3  | Local tunnel closing the socket is worded as a server and firewall issue | yes   | High (as effect) | **med** (consequence of I1)          | High: isolated reproduction             |
| I4  | "Connection not tested, enter the password"                              | yes   | Medium           | **low** alone (consequence of I2)    | High: source                            |
| I5  | Real cause reaches only the Output channel                               | yes   | Medium           | **med** with I1; **low** alone       | High: source + isolated reproduction    |
| I6  | Tunnel log lines carry no `run=` tag                                     | yes   | Low              | **low**, won't-fix candidate         | High: source                            |
| I7  | Authentication runs after the failed TLS probe and waits 30 s            | yes   | Not a defect     | **not a defect** (design)            | High: design + driver default verified  |
| N1  | "API unreachable" unit test fails at a step that never fails             | new   | Low              | **low** (test gap)                   | High: source                            |
| N2  | Kubernetes provider hint is vague (no pods) or would be wrong (API down) | new   | n/a              | **low** (hedged; resolved by I1, I2) | Medium: source-traced, not in the issue |
| N3  | Direct loopback connections get firewall advice                          | new   | n/a              | **low**                              | High: source                            |

## Findings

### I1. `prepare` reports ready without reaching the Kubernetes backend

**Severity:** med. **Covers:** the issue's three runs (API down with a fresh tunnel, API down with an
existing tunnel, no ready pods).

- [`startTunnel`](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L219) returns
  `reused` as soon as a listener with the same key exists. A new tunnel only binds `127.0.0.1:<port>`
  and registers a [connection handler](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L524).
  Neither path calls the Kubernetes API.
- The backend is resolved per incoming socket in `_handleConnection`, through
  [`resolveServiceBackend`](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L70),
  which reads the service's Endpoints. On failure it
  [logs and destroys the socket](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L657).
  This is deliberate for ordinary connects: per-connection resolution survives pod restarts.
- [`KubernetesReachabilityProvider.ensureReachable`](../../../../../src/plugins/service-kubernetes/KubernetesReachabilityProvider.ts#L50)
  returns `{ sharedTunnel: 'started' | 'reused' }`, and the
  [`prepare` check](../../../../../src/connectionDiagnostics/checks/prepare.ts#L77) turns that into
  `pass` and **Port forward ready**.

Isolated reproduction: with the Endpoints read rejecting `ECONNREFUSED` (API down), or returning no
subsets (no ready pods), `prepare` passed for both `started` and `reused`, the Endpoints read was not
called during `prepare`, TCP passed against the listener, and TLS failed with
`tls.handshakeRejectedByServer`. Restoring the Endpoints data made the next resolution succeed, which
matches the issue's "a re-run passes".

### I2. The credential read turns Kubernetes API failures into a missing password

**Severity:** med.

- The diagnostic read of a ClusterIP service makes **no** API request until credentials:
  [`resolveServiceEndpoint`](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L1122)
  returns `needsPortForward` without I/O, and
  [`createCoreApi`](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L586) only builds a
  client.
- The first request is in
  [`resolveDocumentDBCredentials`](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L1213),
  which lists DKO resources with `suppressUnexpectedErrors: true`
  ([any error becomes "no DKO resources"](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L754))
  and [swallows every Secret read error](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L1232).
  `resolveGenericServiceCredentials` does the
  [same](../../../../../src/plugins/service-kubernetes/kubernetesClient.ts#L1273).
- [`KubernetesResourceItem.resolveClusterCredentials`](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L420)
  then returns credentials without a password, the run's setup becomes `passwordMissing`, and the
  panel says [**Stored password unavailable**](../../../../../src/connectionDiagnostics/findingMessages.ts#L68).

Best-effort is right for an ordinary connect, which falls back to a password prompt. A diagnostic read
must instead let the failure propagate: the existing wrapper already turns any error into
[`ConnectionSourceUnavailableError('kubernetes')`](../../../../../src/tree/documentdb/readCredentialsForDiagnostics.ts#L50),
and [`classifyResolutionFailure`](../../../../../src/connectionDiagnostics/checks/resolveTarget.ts)
already maps it to **Kubernetes API unreachable** or **Kubernetes access denied**
([messages](../../../../../src/connectionDiagnostics/findingMessages.ts#L287)). The plumbing for the
manual's promise exists; the credential helper hides the error before it arrives.

Isolated reproduction: both `ECONNREFUSED` and `Forbidden`, from the DKO list and from the Secret read,
resolved to `undefined`.

A cached password masks the symptom: [`buildDiagnosticsSetup`](../../../../../src/connectionDiagnostics/input.ts#L51)
falls back to a cached native-auth pair. That explains why results can differ between sessions.

### I3. A local tunnel closing the socket is worded as a server and firewall problem

**Severity:** med, as a consequence of I1. The generic half is [N3](#n3-direct-loopback-connections-get-firewall-advice-too).

The tunnel accepts the TCP connection and destroys it when backend resolution fails. The package's
[TLS check](../../../../../packages/documentdb-js-connection-diagnostics/src/checks/tls.ts#L350) sees
`ECONNRESET` and reports `tls.handshakeRejectedByServer`. The observation is correct; the wording is
not. The extension says
["The server closed the TLS handshake"](../../../../../src/connectionDiagnostics/findingMessages.ts#L720)
and appends [firewall advice](../../../../../src/connectionDiagnostics/findingMessages.ts#L31), and
[`isTransport`](../../../../../src/connectionDiagnostics/result.ts#L110) enables the card's
[firewall hint](../../../../../src/connectionDiagnostics/result.ts#L303). Nothing remote answered,
and a firewall or IP allowlist is not plausible for `127.0.0.1`.

### I4. "Connection not tested, enter the password"

**Severity:** low on its own; it disappears with I2.

When authentication is skipped for missing input,
[that skip takes precedence](../../../../../src/connectionDiagnostics/result.ts#L173) and the card says
**Connection not tested**, even though TLS failed earlier. "Not tested" is accurate (the driver never
tried); the remedy "enter the password" is wrong because I2 hid the actual cause. No result-precedence
change is needed once I2 is fixed.

### I5. The real cause reaches only the Output channel

**Severity:** med as part of I1; low on its own.

The tunnel's failure text is [written to the Output channel](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L657)
and nowhere else. The diagnostic run cannot report what it never receives. Simply rethrowing the raw
error into `prepare` would not help either: `prepare` deliberately
[keeps only an allow-listed error name](../../../../../src/connectionDiagnostics/checks/prepare.ts#L87)
because Kubernetes messages name namespaces and services. The fix needs a **bounded, classified
reason**, like `resolveTarget` already has.

### I6. Tunnel log lines carry no `run=` tag

**Severity:** low; **won't-fix candidate**.

The diagnostic trace writes `[Connection diagnosis] run=<id>`
([outputTrace.ts](../../../../../src/connectionDiagnostics/outputTrace.ts#L138)); tunnel lines do not,
so filtering by run ID hides them. The tunnel is shared across runs and ordinary connects, so tagging
its lines with one run is not meaningful. Once I1 and I5 are fixed, the run's own trace carries the
`prepare` finding code, which is enough.

### I7. Authentication runs after the failed TLS probe

**Not a defect.** Authentication
[depends on the connection string and `prepare`, not on probe verdicts](../../../../../src/connectionDiagnostics/checks/authenticate.ts#L291),
as [design §3.1](../design.md#31-order-and-dependencies) requires: the driver may succeed where a probe
fails. The installed driver's default `serverSelectionTimeoutMS` is 30 000 ms (verified locally),
which is the reported wait. Once I1 makes `prepare` fail, authentication is skipped as
`dependencyFailed` and the wait is gone. Do **not** fix this by skipping authentication after failed
probes.

### N1. The "API unreachable" unit test fails at a step that never fails

**Severity:** low (test gap). [The test](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.test.ts#L908)
makes `createCoreApi` reject with `ECONNREFUSED`. In production `createCoreApi` performs no request, so
the test passes while the real API failure path (I2) goes uncovered. The regression tests in
[WI-K4](#wi-k4-regression-tests-for-the-1069-scenarios) replace it with a failing API **request**.

### N2. The Kubernetes provider hint is vague or wrong, depending on the case

**Severity:** low; source-traced, not reported in the issue.

The run's context hints ask [`KubernetesErrorExplainer`](../../../../../src/plugins/service-kubernetes/KubernetesErrorExplainer.ts#L37),
which matches error text. With the tunnel up:

- **No ready pods:** authentication fails with "Server selection timed out", which matches, so the card
  very likely also shows "The port-forward tunnel ... looks active, but the service did not answer. The
  pod behind it may have restarted or been rescheduled." That points in the right direction but is
  vague.
- **API down, no password:** no driver error exists, so
  [context hints pass the finding code as the error text](../../../../../src/connectionDiagnostics/checks/contextHints.ts#L210)
  (`tls.handshakeRejectedByServer`). It does not match, so there is no hint.
- **API down, cached password:** authentication runs and times out, the text matches, and the hint
  blames the pod although the API is down: a wrong cause, softened by "may".

The fix for I1 and I2 stops the run before this hint is needed. [WI-K5](#wi-k5-optional-the-tunnel-remembers-its-last-backend-failure)
makes the explainer answer from observed tunnel state instead of error text.

### N3. Direct loopback connections get firewall advice too

**Severity:** low. Not Kubernetes-specific.

A saved direct connection to `mongodb://localhost:10260` whose DocumentDB Local container is stopped
fails TCP with `tcp.refused`. Its next step
[starts well](../../../../../src/connectionDiagnostics/findingMessages.ts#L687) ("Check the port and
that the database service or tunnel is running") and then appends the firewall and IP allowlist text,
and the card adds the firewall hint. The same applies to a user's own `kubectl port-forward`, which
the extension does not know about. The package already classifies loopback addresses in its
[DNS check](../../../../../packages/documentdb-js-connection-diagnostics/src/checks/dns.ts#L213), so
the information to avoid this exists.

## What the fix has to respect

From the operator (2026-11-09) and existing decisions:

1. **The package stays generic.** Most runs are direct connections; the package is good for them and
   must not produce false statements in any environment. It may say less; it must not say something
   wrong.
2. **Kubernetes must not produce wrong errors.** It does not have to become a Kubernetes health tool.
3. **No mega-framework.** No new extensibility machinery unless a scenario needs it.
4. **Nothing is inserted into the network chain.** A step between DNS, TCP, TLS and `hello`, or between
   the probes and authentication, is out of bounds.
5. **At most two places where an environment can add work:** at the very start, and right after "where
   the checks run" and "what the connection string says".
6. Existing contracts: diagnostics never prompt and never show UI
   ([0013](../decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped),
   [0036](../decisions.md#0036--the-troubleshooter-reads-connection-details-silently-and-prepares-kubernetes-tunnels-only-in-prepare));
   only `prepare` prepares the endpoint, and a tunnel it starts is shared and stays open
   ([design §4.3](../design.md#43-prepare-extension)); the panel has a fixed eight-row list
   ([0029](../decisions.md#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list)).

### The two places already exist

The package runs the checks in the order the consumer supplies, with `dependsOn` for prerequisites
([design §3.1](../design.md#31-order-and-dependencies)). The extension already builds that list in
[`buildDiagnosticsChecks`](../../../../../src/connectionDiagnostics/runConnectionDiagnostics.ts#L111)
and inserts its own checks at exactly the two points requested:

```text
environment            (package)   where the checks run
extensionEnvironment   (extension) ← place 1: "at the start", after where it runs
resolveTarget          (extension) read the target's details (Kubernetes, Azure, Atlas…)
connectionString       (package)   decode the connection string
credentials            (extension)
prepare                (extension) ← place 2: after where it runs + the connection string;
                                     runs every ConnectionReachabilityProvider
srv, dns → tcp → tls → hello   (package, per host)   ← never touched
authenticate, connectionAccess, serverFacts, contextHints (extension)
```

`prepare` is already the environment hook: it calls every registered
[`ConnectionReachabilityProvider`](../../../../../src/services/connectionReachabilityService.ts#L22)
with a [diagnostic intent](../../../../../src/services/connectionReachabilityService.ts#L57)
(`interactive: false`, `signal`). Kubernetes is such a provider. **I1 is a provider that reports success
too early, not a missing extension point.**

## Options

### O1. Fix Kubernetes inside the existing `prepare` step (recommended core)

Under the diagnostic intent, the Kubernetes provider confirms what the tunnel will need **before**
reporting ready: it reads the service's Endpoints once and requires a ready pod on the service port,
the same lookup the tunnel performs per connection. Failures leave as a typed, classified error
(`ConnectionPreparationError` with a bounded reason), and `prepare` turns it into a localized finding
under **Connection settings**. The diagnostic credential read becomes strict, so API failures surface in
`resolveTarget`, which already has the messages.

- **Example (no ready pods):** Connection settings fails with "No ready pods behind the service.
  Kubernetes reports no ready endpoint for the service's port. Check that the database pods are running
  and ready and that the service selects them." DNS through authentication are skipped as depending on
  Connection settings. No TLS, no firewall, no 30-second wait.
- **Example (API down, DKO service):** `resolveTarget` fails with the existing **Kubernetes API
  unreachable**; nothing else runs.
- **Package change:** none.
- **Refactoring:** none. Extends the provider contract with one optional intent flag and one typed
  error, beside the existing `LocalPortInUseError`.
- **Size:** small to medium; about 150 to 200 production lines in about 8 files, plus tests.
- **Risk to direct connections:** none; no provider applies to them.
- **Extensible:** a future SSH tunnel or cloud proxy provider uses the same contract: "under the
  diagnostic intent, confirm what you can cheaply confirm, or fail with a classified reason".

### O2. Provider-reported sub-steps inside `prepare` (optional add-on to O1)

The provider also reports what it checked as steps of the `prepare` result, using the package's
existing `steps` model (as Authentication does for Microsoft Entra ID): kubeconfig source, API reachable,
ready endpoint, local tunnel. The panel keeps one Connection settings row; the report gains detail.

- **Example (report):** "Kubernetes port forward: kubeconfig source ✓ · API ✓ 45 ms · ready endpoint ✗
  (no ready pods) · local tunnel not started".
- **Package change:** none. **Size:** medium (observer extension, report-text labels, Details wording).
- **Value:** support quality only. The panel answer is already correct with O1. Do later, if at all.

### O3. Two registered "slots" for provider checks (the operator's idea, formalized)

Plugins register whole `Check` objects for "at the start" or "after settings"; the extension places them
and maps them to the Diagnosis setup or Connection settings row.

- **Example:** a Kubernetes check `kubernetes.backend` registered in the "after settings" slot.
- **What it adds over O1:** plugins write `Check` code directly (dependencies, timeout kind, facts,
  findings, cancellation, row mapping) instead of implementing `ensureReachable`. That is a larger,
  less guarded surface for the same result.
- **Package change:** none. **Refactoring:** medium: a registry, slot-to-row mapping in `panelRows`,
  the planned-checks list, the Output trace, telemetry and report text must accept unknown check IDs.
- **Verdict:** **not now.** Place 2 already exists as `prepare`, and place 1 has no scenario (Local
  Quick Start nodes are excluded from diagnosis by
  [0015](../decisions.md#0015--the-context-menu-item-is-on-cluster-nodes-only-not-on-quick-start-instance-nodes)).
  Revisit only if a provider needs a check that is not preparation.

### O4. Numeric step priorities (10, 20, 30 …; a plugin adds 21)

- **Example:** Kubernetes adds `21` after the connection string at `20`.
- **Why not:** the package's contract is "the supplied order is the dependency order; there is no general
  graph engine" ([design §3.1](../design.md#31-order-and-dependencies)). Priorities invite exactly the
  insertion the operator rules out (a number between TCP and TLS is as easy to type as 21). The runner's
  validation, the report order, the fixed panel rows, the Output trace and most order tests would change,
  and the package API would change before its first publication.
- **Size:** large. **Verdict:** rejected.

### O5. A Kubernetes branch in `runConnectionDiagnostics`

`if (kubernetes) checks.push(kubernetesChecks)` in the generic runner.

- **Size:** small. **Why not:** it couples the generic runner to one plugin, which the reachability
  providers were introduced to avoid
  ([connection-reachability-providers.md](../../kubernetes-discovery/connection-reachability-providers.md)),
  and O1 costs about the same. **Verdict:** rejected.

### O6. Loopback-aware transport wording (recommended; generic, independent of Kubernetes)

When a failing network probe's target resolves only to loopback addresses, nothing remote was involved:

- the card shows no firewall hint, and TCP, TLS and `hello` transport findings get a local next step
  instead of firewall advice;
- `tls.handshakeRejectedByServer` is worded by what was observed, "The connection closed during the
  secure handshake, before a certificate arrived", in every case, not "The server closed".

The package adds the address class (`public`, `private`, `loopback`, `linkLocal`, which its DNS check
already computes) to the data of transport findings, and keeps its English details neutral. The extension
chooses the wording.

- **Example (Local container stopped):** "Nothing accepted the connection on port 10260 on this
  computer. Start the local database, container or tunnel that should listen there." No firewall text.
- **Example (user's own `kubectl port-forward`, backend gone):** "The connection to a local port was
  accepted and then closed during the secure handshake. A local tunnel or proxy on this port may not be
  able to reach its destination."
- **Package change:** small and additive (one data field on existing findings; README catalogue and its
  sync test; neutral English details).
- **Size:** medium, mostly tests: the change touches wording that direct connections also use, so the
  wording, result and panel tests need care.
- **Value:** it is the safety net for every tunnel the extension does not know about, and for races O1
  cannot see (a pod dying between `prepare` and the probes).

### O7. The tunnel remembers its last backend failure (optional follow-up)

The tunnel manager records the last per-connection resolution failure for each tunnel (a bounded reason
and time, cleared on the next success). `KubernetesErrorExplainer` answers from that state rather than
from error text.

- **Example (race, or an ordinary connect from the Collection view):** "The port-forward tunnel to
  "documentdb-service-my-documentdb" in namespace "documentdb-ns" is running, but Kubernetes reports no
  ready pod behind it."
- **Note:** the [error-translation skill](../../../../../.github/skills/error-translation/SKILL.md) forbids
  caching **verdicts**. This records an **observation** with its time and expires it; the explainer must
  only use observations newer than the failing operation.
- **Size:** small to medium. Improves ordinary connects too, so it is not diagnostics-only.

## Scenarios

What the user sees today and with the recommended path (O1 + O6). "Today" is the assessed head.

| #   | Scenario                                                                                     | Today                                                                                  | With O1 + O6                                                                                                                |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| S1  | Direct Azure DocumentDB, IP not allowed                                                      | TCP timeout, firewall hint                                                             | **Unchanged** (public address)                                                                                              |
| S2  | Direct Azure DocumentDB, working                                                             | Connection successful                                                                  | **Unchanged**                                                                                                               |
| S3  | Kubernetes ClusterIP (DKO), API down, fresh or existing tunnel                               | Port forward ready · TLS "server closed" + firewall · Not tested, "enter the password" | Connection settings: **Kubernetes API unreachable** (from `resolveTarget`); nothing else runs                               |
| S4  | Kubernetes ClusterIP (generic service, no Secret annotation), API down                       | Port forward ready · TLS closed + firewall                                             | Connection settings: **Kubernetes API unreachable** (from `prepare`)                                                        |
| S5  | Kubernetes ClusterIP, no ready pods (selector matches nothing)                               | Failed at TLS, firewall hint, 30 s wait                                                | Connection settings: **No ready pods behind the service**; no wait                                                          |
| S6  | Kubernetes ClusterIP, pod dies after `prepare`, before TLS                                   | Failed at TLS, firewall hint                                                           | Failed at TLS, "closed during the secure handshake", local next step, **no firewall hint**; O7 adds the cause               |
| S7  | Kubernetes ClusterIP, RBAC forbids reading the password Secret                               | Not tested, "Stored password unavailable, enter the password"                          | Network checks run; Authentication skipped: "**The Kubernetes Secret with the password could not be read (access denied)**" |
| S8  | Saved `mongodb://127.0.0.1:27017` behind the user's own `kubectl port-forward`, backend gone | TLS "server closed" + firewall                                                         | TLS closed on a local port, "a local tunnel or proxy may not reach its destination", no firewall                            |
| S9  | DocumentDB Local container stopped, saved `localhost:10260`                                  | TCP refused + firewall                                                                 | "Nothing accepted the connection on port 10260 on this computer"; no firewall                                               |
| S10 | Kubernetes LoadBalancer or NodePort                                                          | Direct path                                                                            | **Unchanged** (no provider; not loopback)                                                                                   |
| S11 | Future SSH tunnel provider, jump host unreachable                                            | n/a                                                                                    | Implements the same `prepare` contract: Connection settings fails with its classified reason                                |

S3 works through I2's fix alone for DKO services, because the strict credential read is the first API
request. S4 and S5 need the `prepare` verification, because a generic service makes no API request
before `prepare`. That is why O1 has both parts.

## Complexity and refactoring

| Option                     | Fixes                      | Package change      | Refactoring          | Size | Risk for direct connections | Verdict         |
| -------------------------- | -------------------------- | ------------------- | -------------------- | ---- | --------------------------- | --------------- |
| O1 Kubernetes in `prepare` | I1–I5, N1, N2 (mostly)     | none                | none (contract +1)   | S–M  | none                        | **Do**          |
| O2 Sub-steps in `prepare`  | report detail only         | none                | small                | M    | none                        | Later, optional |
| O3 Registered slots        | same as O1                 | none                | medium               | M–L  | low                         | Not now         |
| O4 Numeric priorities      | same as O1                 | **API change**      | large                | L–XL | medium                      | Rejected        |
| O5 Kubernetes branch       | same as O1                 | none                | none (adds coupling) | S    | none                        | Rejected        |
| O6 Loopback-aware wording  | I3 generic, N3, S6, S8, S9 | additive data field | none                 | M    | low (wording only, tested)  | **Do**          |
| O7 Tunnel failure memory   | N2, S6, ordinary connects  | none                | none                 | S–M  | none                        | Follow-up       |

## Recommendation

**O1 + O6 now, O7 as a follow-up, O2 only if support asks for more detail. No slots, no priorities.**

- O1 fixes the wrong answers where they start, inside the step that already exists for this purpose, with
  no package change.
- O6 makes the package and the extension honest for **any** local endpoint, including tunnels the
  extension does not manage. That serves the main direct-connection case (S9) as well.
- The "two places" model is kept, but as a documented fact about the extension's composition, not as a
  new API. A provider that needs more than preparation is the trigger to revisit O3.

## Work items

Ordered; each is one commit. Sizes are relative. "Tests" names the focused files; Case 1 verification
applies per commit.

| WI    | Option | Scope                                                       | Fixes              | Size | Depends on  |
| ----- | ------ | ----------------------------------------------------------- | ------------------ | ---- | ----------- |
| WI-K1 | O1     | Strict diagnostic credential read                           | I2, I4, S3, S7     | S    | —           |
| WI-K2 | O1     | `prepare` verifies the Kubernetes backend                   | I1, S4, S5         | S–M  | —           |
| WI-K3 | O1     | Safe preparation-failure finding                            | I5, 01-review R7   | S–M  | WI-K2       |
| WI-K4 | O1     | Regression tests for the #1069 scenarios                    | N1                 | S    | K1–K3       |
| WI-G1 | O6     | Loopback-aware transport wording and firewall hint          | I3, N3, S6, S8, S9 | M    | —           |
| WI-D1 | —      | Documentation and decision record                           | —                  | S    | chosen path |
| WI-V1 | —      | Manual verification on the kind lab and a direct connection | —                  | S    | all above   |
| WI-K5 | O7     | (Optional) the tunnel remembers its last backend failure    | N2                 | S–M  | WI-K2       |
| WI-K6 | O2     | (Optional) provider sub-steps in the report                 | —                  | M    | WI-K3       |

### WI-K1. Strict diagnostic credential read

> **Deferred, escalated (2026-11-09):** Opus 5.5 found that every service, including a generic
> service with an annotated Secret, first lists DKO resources. The specified strict DKO-list
> 403 behavior would stop diagnosis even when that generic service can read its Secret and
> connect. Options: retain the literal strict rule, or ignore only DKO-list 403 for generic
> services while still propagating network failures and retaining strict DKO-service behavior.
> Recommendation: the narrow generic-service exception, recorded in `decisions.md` with operator
> approval. Advisor confidence: high; the source path is `KubernetesResourceItem.resolveClusterCredentials`.
> The operator could not answer the permission-boundary question, so no option was implemented.
> Missing Secret keys should otherwise retain the existing password-missing behavior.
>
> **Resumed (2026-11-09):** after the operator requested and received the advisor's three options,
> their subsequent autonomous-resolution instruction superseded the pause. The leader selected
> option 2 (Opus recommendation, high confidence), with the narrow generic-service exception
> described above. No broader lookup-order or permission change is authorized.
>
> **Done (2026-11-09), commit `bc124a25`:** `gpt-6.1-sol` preserved original strict API errors,
> propagated bounded Secret-read issues through diagnostic-only credentials, and retained cached
> password precedence and ordinary best-effort callers. Decisions: leader selected Opus's narrow
> generic-service DKO-list 403 exception under the operator's later autonomous-resolution instruction;
> advised (`claude-opus-5.5`), approval confidence 85%, based on error identity, type propagation and
> credential-boundary review. A known DKO Secret-read issue stops credential fallback for that
> diagnostic read rather than hiding the observed failure; ordinary fallback remains unchanged.
> Added 57 tests; 559 focused tests and `npx tsc --noEmit -p .` passed. One stale preparation
> intent assertion introduced by WI-K2 remains for WI-K4; the full batch is not yet green.

- `resolveDocumentDBCredentials` and `resolveGenericServiceCredentials` take an option (for example
  `{ strict: true }`) used only by the diagnostic read in `KubernetesResourceItem`. Ordinary connect,
  copy and save keep the best-effort behavior.
- Strict mode, DKO list: a 404 (CRD not installed) still means "no DKO resources"; any other failure
  throws, so the existing wrapper reports `target.sourceInaccessible` (unreachable, access denied,
  sign-in required) under Connection settings. The recorded option-2 exception allows a generic
  service's DKO-list 403 to continue to its annotated Secret; DKO services stay strict.
- Strict mode, Secret read: a network failure throws as above. A 403 or 404 does **not** stop the run
  (the real connect would prompt for the password, so network checks are still meaningful); it returns
  credentials without a password plus a bounded `credentialReadIssue` (`accessDenied`, `notFound`), and
  the Authentication skip names it instead of "enter the password".
- **Tests:** `kubernetesClient.test.ts`, `KubernetesResourceItem.test.ts`, `input.test.ts`,
  `findingMessages.test.ts`.

### WI-K2. `prepare` verifies the Kubernetes backend

> **Done (2026-11-09), commit `0168783a`:** `gpt-6.1-sol` added opt-in backend verification
> before tunnel start/reuse, a bounded preparation error, and shared HTTP/network classification.
> Ordinary connects retain their request count and messages; existing tunnels remain open.
> Decisions: operator-approved O1 and explicit flag carried out; advised (`claude-opus-5.5`),
> approval confidence 88%, based on the installed client error shapes and cancellation paths.
> Leader coordination confidence 99%: serialize overlapping files and defer the full build to
> the verification batch. Added 53 focused tests; seven files, 169 tests passed, and
> `npx tsc --noEmit -p .` passed. Kept ordinary-connect call assertions; diagnostic intent
> assertions now require `verifyEndpoint: true`. K3 owns the localized finding/trace mapping.
> The later type-only lint follow-up is `2fd30d49`; lint, 99 focused tests and the production
> type-check passed afterward, with no behavioral rework or new technical decision.

- Add `verifyEndpoint?: boolean` to `ConnectionReachabilityIntent` ("confirm what the provider can
  cheaply confirm before reporting success"); the `prepare` check sets it. A separate flag keeps the
  meaning explicit instead of overloading `interactive: false`.
- Add `ConnectionPreparationError` beside `LocalPortInUseError`, with a provider-neutral bounded reason:
  `sourceUnreachable`, `accessDenied`, `targetNotFound`, `noReadyBackend`, `sourceMissing`, `other`, plus
  an allow-listed error name and HTTP status. No message text and no names cross into results.
- In `ensureKubernetesPortForward`, when `verifyEndpoint` is set: call `resolveServiceBackend` with the
  already-built `coreApi` **before** starting or reusing the tunnel. On failure, throw the typed error and
  do not start a new tunnel; never close an existing shared tunnel
  ([0017](../decisions.md#0017--cancellation-stops-the-run-not-necessarily-every-operation)).
- The 15-second preparation timeout bounds the extra request; a blackholed API ends as a `prepare`
  timeout under Connection settings, which is correct.
- Ordinary connects are unchanged (no extra API request). Whether they should also verify is an
  [open question](#open-questions-for-the-operator).
- **Tests:** `ensureKubernetesPortForward.test.ts`, `KubernetesReachabilityProvider.test.ts`,
  `portForwardTunnel.test.ts`.

### WI-K3. Safe preparation-failure finding

> **Done (2026-11-09), commit `b1c184a9`; generated localization `60ccb72a`:**
> `gpt-6.1-terra` mapped typed and generic preparation failures to safe findings, localized
> Kubernetes reasons, and added the trace allow-list entry. No raw messages or infrastructure
> identifiers enter results. Decisions: operator-approved O1 carried out; advised
> (`claude-opus-5.5`), approval confidence 88%, based on error-boundary and report/panel review.
> Leader coordination confidence 99%: generated localization is a separate chore commit.
> Added 32 tests; 406 focused tests and `npx tsc --noEmit -p .` passed; `npm run l10n`
> completed. Existing precedence and eight-row behavior were preserved. Run-level dependency
> coverage belongs to WI-K4; the generic-provider numeric-code/status ambiguity is a
> non-blocking advisor risk, not an observed Kubernetes failure.

- New extension finding `prepare.failed` with `{ providerId, reason, errorName, statusCode? }`, mapped
  from `ConnectionPreparationError` in the [`prepare` check](../../../../../src/connectionDiagnostics/checks/prepare.ts#L87).
  Any other provider error gets `reason: 'other'` and generic wording, which also closes
  [01-review R7](./01-implementation-review.md) (left open as Low on 2026-10-30).
- Localized wording per provider and reason; Kubernetes reasons get Kubernetes wording ("No ready pods
  behind the service", "Kubernetes API unreachable", "Kubernetes access denied", "Kubeconfig source not
  found"). Messages name no service or namespace, so **Hide identifiers** needs no new classification.
- The card stops at Connection settings; probes and authentication are skipped as `dependencyFailed`,
  which also removes the 30-second wait (I7). The finding code appears in the run's Output trace (I6).
- Run `npm run l10n`.
- **Tests:** `prepare.test.ts`, `findingMessages.test.ts`, `result.test.ts`, `panelRows.test.ts`,
  `reportText.test.ts`.

### WI-K4. Regression tests for the #1069 scenarios

> **Done (2026-11-09), commit `e9a8ae9e`:** `gpt-6.1-sol` added three
> `TDD: Kubernetes diagnosis` contracts with the real runner, provider, tunnel manager and loopback
> sockets. They cover API-down preparation with fresh/existing tunnels and no ready backend,
> assert the absence of TLS/firewall/password headlines, and verify shared-listener survival
> and cleanup. The discovery credential regression now fails an actual API request.
> Decisions: operator-approved regression scope carried out; advised (`claude-opus-5.5`),
> approval confidence 88%, based on real request/runner/socket evidence. Leader coordination
> confidence 99%: update the incidental diagnostic intent and provider-ID assertions to the
> accepted K2/K3 contracts, retaining cluster/properties/signal, elapsed time and failure checks.
> Five focused files, 174 tests passed; the production type-check passed. Transitive dependent
> skips correctly retain the runner's `dependencySkipped`, rather than fabricating a uniform
> `dependencyFailed` value. The DKO discovery resolution failure is covered by the real
> credential-reader test plus the target-resolution tests; the three socket runs use saved
> credentials and specifically cover preparation, not that entire discovery path.

- One run-level test per issue scenario (API down with a fresh tunnel, API down with an existing tunnel,
  no ready pods), using the real tunnel manager and real loopback sockets as in this review's isolated
  checks. Each asserts the outcome **and** the absence of the wrong answer: no `tls.*` headline, no
  firewall hint, no `auth.credentialsUnavailable` headline.
- Replace [the createCoreApi-based test](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.test.ts#L908)
  with one where an API **request** fails.
- Name the suites `TDD: Kubernetes diagnosis` so later changes must ask before editing them.

### WI-G1. Loopback-aware transport wording and firewall hint

> **Done (2026-11-09), commit `1cd90a0f`:** `gpt-6.1-sol` shared the existing DNS address
> classifier with transport probes, added observed address classes, neutralized TLS-close wording,
> and suppressed firewall advice only for proven all-loopback transport failures. Public,
> mixed and unknown address evidence remains conservative; driver authentication is unchanged.
> Decisions: operator-approved O6 carried out; advised (`claude-opus-5.5`), approval confidence
> 85%, based on actual attempted/connected addresses and aggregate result review. Leader
> coordination confidence 99%: rebuild the package before extension tests. Added 85 tests;
> 644 focused tests in ten files, the package build and `npx tsc --noEmit -p .` passed.
> The removed TLS IP-access-list assertion pinned wording the operator explicitly approved
> replacing; the public/mixed/unknown firewall and authentication assertions remain.
> Case 2 must regenerate localization for the changed product strings.

- **Package:** add `addressClass` to the data of `tcp.*`, `tls.handshakeRejectedByServer` and
  `hello.noReply` findings (computed with the existing DNS classification); make the English details
  neutral ("closed during the TLS handshake before a certificate arrived"). Update the README catalogue
  and its sync test. Rebuild the package before root tests.
- **Extension:** no firewall hint when every failing transport target is loopback; loopback-specific next
  steps; neutral TLS-closed title and explanation for all address classes.
- **Tests:** package `tcp.test.ts`, `tls.test.ts`, `hello.test.ts`; extension `result.test.ts`,
  `findingMessages.test.ts`, `panelWording.test.ts`; a direct public-address case proving S1 is
  unchanged.

### WI-D1. Documentation and decision record

> **Done (2026-11-09), commit `99a34497`:** `gpt-6-luna` updated the manual, active feature
> README/design, reachability-provider contract and decision 0053, with factual addenda to
> 0033/0036. The operator's existing README link addition was preserved. Decision provenance
> distinguishes the operator's O1+O6 approval from the leader's later selection of the
> advisor-recommended generic-service exception under the autonomous-resolution instruction;
> no operator rationale is invented. Leader review confidence 95%: documentation follows the
> committed contracts and clearly distinguishes known observations from missing evidence.
> Documentation-only: `git diff --check` passed; no tests added. Historical S4 below incorrectly
> claims all generic services make no API request until preparation; active docs correctly state
> that generic services also attempt DKO lookup during target resolution.

- [User manual](../../../../user-manual/diagnose-connection.md#sign-in-is-never-prompted): add "no ready
  pods" and the Secret read case to the Kubernetes paragraph; describe local-port wording.
- [design.md §4.3](../design.md#43-prepare-extension): providers verify under `verifyEndpoint`;
  `prepare.failed`; the "two places" composition as a documented fact.
- [connection-reachability-providers.md](../../kubernetes-discovery/connection-reachability-providers.md):
  the diagnostic contract for future providers.
- Package README (with WI-G1). A decision in [decisions.md](../decisions.md) recording the chosen path
  and the rejected options (O3, O4, O5), once the operator has chosen.

### WI-V1. Manual verification

> **Deferred, escalated (2026-11-09):** `gpt-6.1-sol` performed read-only feasibility checks:
> the existing kind control plane was running, `/readyz` returned `ok`, and the database pod and
> service EndpointSlice were ready. No cluster, container, settings, credentials or selector was
> changed. Actual Diagnose workbench runs are **unverified**: no controlled workbench automation
> surface was available, and inducing outages or patching this shared lab would be unsafe.
> Leader decision confidence 99%: preserve shared infrastructure and report the gap rather than
> treating automated tests as a manual outage experiment. Before relying on the release, use an
> isolated lab to try S3 (API down, fresh/existing tunnel), S5 (no ready pods), S7 (Secret denied),
> S9 (stopped local container) and S1/S2 (direct blocked/working connection), restoring the lab
> after each case. The operator requested autonomous pushing after green automated checks;
> this manual gap remains explicit rather than being represented as a passing verification.

On the kind lab from `scripts/k8s-test-setup.sh`, re-run the issue's three cases and check S3 to S5:

- API down: stop the control-plane container (`docker stop documentdb-dev-control-plane`, or `podman`),
  run Diagnose on the discovered service with and without an existing tunnel, then start it again.
- No ready pods: save the service's selector first
  (`kubectl -n documentdb-ns get svc documentdb-service-my-documentdb -o jsonpath='{.spec.selector}'`),
  patch it to match nothing, run Diagnose, then restore it. The operator may reconcile the selector back;
  check before diagnosing.
- Also check S9 (stop a DocumentDB Local container, diagnose its saved connection) and S1 or S2 (a
  direct Azure connection) to confirm the direct path is unchanged.

### WI-K5. (Optional) The tunnel remembers its last backend failure

> **Excluded (2026-11-09), operator decision:** "don't do wi-k5 (o7)". No implementation.

- `PortForwardTunnelManager` stores `{ reason, at }` per tunnel key on resolution failure and clears it on
  success; `KubernetesErrorExplainer` uses it before its text signatures, only if it is newer than the
  failing operation.
- **Tests:** `portForwardTunnel.test.ts`, `KubernetesErrorExplainer.test.ts`.

### WI-K6. (Optional) Provider sub-steps in the report

> **Deferred (2026-11-09):** O2 is optional and not part of the accepted recommended O1+O6 path.

As described in [O2](#o2-provider-reported-sub-steps-inside-prepare-optional-add-on-to-o1).

## Open questions for the operator

1. **Path:** accept O1 + O6 now and O7 as a follow-up, with O3, O4 and O5 recorded as rejected?
2. **Flag:** a separate `verifyEndpoint` intent flag (proposed), or verification whenever
   `interactive: false`?
3. **Ordinary connects:** should a normal connect also verify the backend, to fail fast instead of after
   the driver's 30-second timeout? Proposed: no, not in this PR; it adds an API request to every connect.
4. **Secret read 403 or 404:** keep running the network checks with a specific Authentication skip
   (proposed), or stop at Connection settings?
5. **WI-G1 scope:** ship the package's `addressClass` field in this PR (proposed, because the package is
   not yet published), or keep loopback detection extension-only?

## Aside

`resolveServiceBackend` reads the core `v1 Endpoints` API, which Kubernetes 1.33+ deprecates in favor of
EndpointSlice (the lab prints the warning). It still works and is out of scope here.
