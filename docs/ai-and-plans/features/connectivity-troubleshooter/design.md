---
feature: connectivity-troubleshooter
kind: design
status: active
created: 2026-10-27
updated: 2026-11-09
---

# Diagnose connection: design

> Called the **connectivity troubleshooter** until WI-17 (2026-11-02). Older decisions and
> iteration notes retain that name. The command ID changed in
> [0038](./decisions.md#0038--the-feature-is-called-diagnose-connection). Internal names (package,
> source paths, symbols, telemetry) were renamed from _troubleshooter_ to _connection diagnostics_
> in RN-1…RN-5 ([0051](./decisions.md#0051--internal-names-follow-the-feature-connection-diagnostics));
> this docs folder keeps its name.

> This document records the feature's design intent. The feature is now implemented; see the
> [feature README](./README.md) for its status and the [UX review pack](./iterations/05-ux-review.md)
> for current user-facing presentations. Code is authoritative for behavior; proposed choices
> still awaiting operator confirmation are identified in the README and
> [decisions.md](./decisions.md). Where consolidation changed an earlier draft significantly,
> a **Changed:** note says why.

## 1. Who it is for

| Audience                            | What they need from it                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user whose connection fails       | Which step failed, in plain words, and the one thing to try next                                                                                                                   |
| A user whose connection works       | Confirmation that a real server answered, with a few facts about it: version, topology, round trip (operator: "it's reassuring to users")                                          |
| A support engineer or issue triager | Every version that matters (extension, VS Code, Node.js, c-ares, OpenSSL, driver, OS, server), the exact error codes, timings, and one readable report to ask for by name          |
| The team                            | How users open, run, cancel and reuse connection diagnosis, whether they share diagnostics, and which checks fail or are skipped (issue #100, "telemetry-based pattern detection") |
| Feature developers                  | A way to exercise a connection on demand, without breaking it first (operator: "easier to test")                                                                                   |

The question is **"can this user connect, and if not, why might it be failing?"** Users come
first; support gets the evidence behind the explanation. This is not an RBAC audit, a general
configuration validator or a cluster health scanner ([0018](./decisions.md#0018--answer-the-connectivity-question-not-a-general-permissions-audit)).

## 2. Architecture

```
packages/documentdb-js-connection-diagnostics      @documentdb-js/connection-diagnostics
│   no vscode, no l10n, no UI, no telemetry
├── runner        ordered checks, dependencies, timeouts, AbortSignal, streamed events
├── checks/       environment (Node facts), connectionString, srv, dns, tcp, tls, hello
├── report        report snapshot; identifier redaction; Markdown and JSON renderers with an
│                 injectable message function; English finding details for convenience
└── types         CheckStatus, CheckResult, CheckStepResult, Finding, DiagnosticsEvent

src/ (extension)
├── connectionDiagnostics/
│   ├── checks/                     extension checks on the same Check interface: environment
│   │                               (VS Code facts), prepare, authenticate, connectionAccess,
│   │                               serverFacts, contextHints
│   ├── auth/                       non-interactive auth policy, Entra ID phases, token claim summary
│   ├── result.ts                   the derived result card (4.13)
│   ├── findingMessages.ts          FindingCode → l10n.t() title, explanation, next step
│   ├── outputTrace.ts              the run's Output channel lines (6.4)
│   ├── telemetry.ts                allowlisted usage/outcome mapping through existing helpers
│   └── runConnectionDiagnostics.ts resolves the cluster, builds input, runs, records telemetry
├── commands/diagnoseConnection/
├── utils/readOnlyJsonDocumentProvider   gains Markdown documents (6.1); JSON path unchanged
└── webviews/documentdb/connectionDiagnostics/
    ├── router (tRPC)               run (subscription), cancel, showDiagnostics, copyReport, saveReport
    └── React                       Container + StatusList (8 fixed rows), result card
```

Everything runs on the extension host. The webview receives check events and secret-excluded
facts, never the connection string, a credential, a token or an original error object. A host-only
run context holds transient credentials, original errors and the owned client; it is never part of
a result, event or report.

## 3. Package API and execution contract

Representative types; the implementation adds the concrete input, event and run types.

```ts
type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';

type SkipReason =
    | 'notApplicable'       // no TLS, not +srv, an IP literal needs no DNS
    | 'inputUnavailable'    // connection diagnosis will not prompt for it (4.9.1)
    | 'dependencyFailed'
    | 'dependencySkipped'
    | 'runTimeoutExceeded'; // not started before the whole-run timeout (3.2)

interface FindingDetail {
    readonly language: 'en';                             // BCP 47 language tag
    readonly text: string;                               // convenience only, not a contract to parse
}

interface Finding<TCode extends string> {
    readonly code: TCode;                                // 'tls.hostnameMismatch'
    readonly severity: 'info' | 'warning' | 'error';
    readonly data?: Readonly<Record<string, unknown>>;   // inputs for the consumer's sentence
    readonly detail: FindingDetail;
}

interface CheckStepResult<TCode extends string> {
    readonly stepId: string;                             // 'auth.signInConfiguration'
    readonly status: CheckStatus;
    readonly skippedBecause?: { readonly reason: SkipReason; readonly stepId?: string };
    readonly durationMs: number;
    readonly findings: readonly Finding<TCode>[];
    readonly facts: Readonly<Record<string, unknown>>;
}

interface CheckResult<TCode extends string> {
    readonly checkId: string;                            // 'tls'
    readonly target?: string;                            // 'host:port' for per-host checks
    readonly status: CheckStatus;
    readonly skippedBecause?: { readonly reason: SkipReason; readonly checkId?: string };
    readonly durationMs: number;
    readonly findings: readonly Finding<TCode>[];
    readonly facts: Readonly<Record<string, unknown>>;
    readonly steps?: readonly CheckStepResult<TCode>[];  // one level deep (0021)
}

interface Check<TContext, TCode extends string> {
    readonly id: string;
    readonly scope: 'run' | 'host';                      // once, or once per host
    readonly dependsOn?: readonly string[];              // required inputs, see 3.1
    run(context: TContext, signal: AbortSignal): Promise<Omit<CheckResult<TCode>, 'checkId' | 'durationMs'>>;
}

interface DiagnosticsTimeouts {
    readonly runTimeoutMs: number | null;
    readonly preparationTimeoutMs: number | null;
    readonly srvTimeoutMs: number | null;
    readonly probeTimeoutMs: number | null;
    readonly authenticationTimeoutMs: number | null;
    readonly postConnectTimeoutMs: number | null;
}

function runDiagnostics<TCode extends string>(options: {
    input: DiagnosticsInput;                          // connection string, effective network options
    checks: readonly Check<RunContext, TCode>[];         // built-ins plus consumer checks, in order
    timeouts?: Partial<DiagnosticsTimeouts>;          // omitted: defaults; null: no diagnostic timeout
    signal?: AbortSignal;
    onEvent?: (event: DiagnosticsEvent<TCode>) => void;
    // checkStarted, checkFinished, runFinished
}): Promise<DiagnosticsRun<TCode>>;

function buildReport<TCode extends string>(run: DiagnosticsRun<TCode>): DiagnosticsReport<TCode>;
function renderMarkdown<TCode extends string>(report: DiagnosticsReport<TCode>, options: RenderOptions<TCode>): string;
function renderJson<TCode extends string>(report: DiagnosticsReport<TCode>, options: { redact: boolean; generatedBy?: Readonly<Record<string, string>> }): string;
```

Rules the API is built around:

- **Codes are authoritative; English details are a convenience**
  ([0031](./decisions.md#0031--codes-are-authoritative-english-details-are-a-convenience)).
  The package exports a closed `BuiltInFindingCode` union; the extension adds its own closed union
  for auth, access and server codes through the generic parameter. The extension's
  `Record<FindingCode, …>` message table fails the build when a code is added. Every finding also
  carries `detail: { language: 'en', text: '...' }` so a package consumer can read it without a
  message catalogue. The language is a BCP 47 tag, not a requested-locale setting; the first release
  always returns English. Wording may change without changing the code contract. Extension-added
  findings supply the same detail object.
  The extension uses only `code` and structured `data` to select and format its own localized
  messages, never parses or displays the English detail as a localization fallback. `renderMarkdown`
  still takes the consumer's message function for all report prose. An unknown code is an explicit
  contract error, not a silent fallback to English.
  The [package README](../../../../packages/documentdb-js-connection-diagnostics/README.md#finding-codes)
  lists every public finding code, its meaning and concrete structured data fields, along with this
  convenience-only English contract.
- **Consumers add checks.** The extension's authentication check plugs into the same runner as
  the built-in TCP check. A CLI adds its own later. The runner owns ordering, skipping, timeouts and
  events; a check does one job.
- **Sub-steps are recorded, not scheduled or displayed** ([0021](./decisions.md#0021--authentication-reports-sub-steps-statuslist-gains-one-level-of-nesting),
  [0027](./decisions.md#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)).
  A check whose phases share private state returns them in `steps`, for the report and the Output
  trace. The runner does not schedule, time out or skip steps, and emits no event for them. A
  check's status is its first blocking step. Steps are not separate checks, because the next phase
  would need the previous phase's session or token through the shared run context, the one place
  a secret must never be.
- **`skipped` always says why**, with one of the reasons above and, for dependencies, the check
  that caused it.
- **The connection string goes in, secrets never come out.** Credentials are used privately for
  the connection attempt and never copied into facts, findings, events, logs or reports (6.3).
  Facts and finding data are JSON-serializable values built from known fields, never spread input,
  option, error or driver objects.
- **Reuse, don't re-implement.** The package parses with `mongodb-connection-string-url` and
  decodes wire replies with `bson`, both existing dependencies. "Driver-free" means no driver-managed
  connection, monitoring or retry, not hand-written URI or BSON parsing. The extension's existing
  connection-string normalization and network-option building are extracted into shared helpers
  and used by both the real connection and the probes.
- **Injectable I/O.** DNS, socket and clock are parameters with Node.js defaults, so tests are
  deterministic and need no external network.
- **Conventions follow `@documentdb-js/srv-resolver`**: ESM-only, its own `tsconfig.test.json`,
  covered by `npm run typecheck:tests`.

> **Implemented** (WI-01) in `a67110b6`: `packages/documentdb-js-connection-diagnostics` with
> `src/types.ts` (the types above, `CheckOutcome` as the `run` return type) and `src/findingCodes.ts`
> (the closed `builtInFindingCodes`/`BuiltInFindingCode` of package-owned codes, `skipReasons`,
> `isBuiltInFindingCode`); tests in `src/findingCodes.test.ts`. WI-02 added `ProbeTarget`,
> `DiagnosticsInput`, `RunContext`, `DiagnosticsEvent` and `DiagnosticsRun`.

### 3.1 Order and dependencies

The package supplies environment, connection string, SRV/TXT, and the per-host DNS → TCP → TLS →
`hello` chain. The extension composes `extensionEnvironment` after package `environment`, inserts
`resolveTarget` before `connectionString`, and adds `credentials` and `prepare` after
`connectionString`; it adds `authenticate` after `hello`, then connection access, server facts and
context hints. This is the existing check composition, not a provider-check registration API. No
check is inserted within DNS → TCP → TLS → `hello`. The result card (4.13) is derived from these
results; it is not a check and performs no I/O.

`dependsOn` lists **required inputs**, not every earlier step:

- A dependency is satisfied by `pass`, `warning` or `skipped/notApplicable`. An IP literal reaches
  TCP without DNS; a plaintext connection reaches `hello` without TLS.
- A failed dependency skips the dependent as `dependencyFailed`; a skipped one as
  `dependencySkipped`, naming the originating check.
- Host checks depend on the same host's results; run checks depend on run results. Duplicate IDs,
  unknown or forward dependencies and invalid scope references are rejected before the run starts.
  The supplied order is the dependency order; there is no general graph engine.
- **Authenticate depends on a valid connection string and successful preparation, not on the
  network probe verdicts.** The driver may resolve SRV again or reach another member; a failed
  diagnostic probe is evidence, not a reason to suppress the real attempt.
- Connection access and server facts require the owned client from a successful authentication.
  Context hints run whenever a failure was observed.

Per host, DNS, TCP, TLS and `hello` run in order. Host chains run with at most four in parallel;
the next run check waits for all of them to settle.

This is **ordered execution, not global serial execution**: host A can be at TLS while host B is
still resolving DNS. Events reflect actual execution; stored results and the report use the
supplied check order and resolver target order, not completion order. The panel projects these
events onto its eight ordered rows (5.2), buffering later-row updates until earlier rows settle.
Authentication still runs after failed probes when its inputs and preparation are valid and time
remains; a whole-run timeout can prevent it from starting, but a probe verdict alone cannot.

> **Changed:** the research draft mixed ordering with prerequisites, so one dead seed or a
> skipped DNS step could have suppressed the authentication attempt that decides the outcome.
> Separating "required input" from "earlier in the list" prevents that without a second
> server-selection algorithm. This also settles 0011.

### 3.2 Timeouts and safety limits (formerly "budgets")

These time limits are **timeouts**, not a count of allowed checks or a verdict that the server is
down. Use `*TimeoutMs` in the API and implementation, and "timeout" in user-facing messages and
documentation. Non-time safety limits are separate. Default values are not persistent settings;
the API accepts per-run overrides. A supplied diagnostic timeout must be a positive finite number
of milliseconds no greater than `MAX_TIMEOUT_MS` (`2_147_483_647`), or `null` to remove that
diagnostic timeout. The same numeric bound applies to `input.connectionTimeouts`, which does not
accept `null`. Both routes share validation and reject invalid values before checks or I/O;
oversized values are never clamped.

| Work                                                       | Default timeout        | Longer-timeout retry    |
| ---------------------------------------------------------- | ---------------------- | ----------------------- |
| Whole run                                                  | 300 s                  | 600 s                   |
| Preparation                                                | 15 s                   | 30 s                    |
| SRV/TXT resolution                                         | 10 s                   | 20 s                    |
| Each DNS, TCP, TLS or `hello` probe, per host              | 10 s                   | 20 s                    |
| Authentication: configuration, token and driver connection | 45 s                   | 90 s                    |
| Each post-connect command (ping, access, server facts)     | 5 s, run one at a time | 10 s, run one at a time |

Ten seconds is the default minimum for a network probe, including DNS and `hello`; it is not a
promise to wait ten seconds after a definitive error. A shorter timeout explicitly configured on
the connection still wins. Each operation uses the least of its diagnostic timeout, the remaining
whole-run time and any applicable connection timeout. All address attempts and auxiliary lookups
within one host's probe share its timeout; inspection-only TLS does not receive another full
timeout. Record the selected profile, configured and effective timeouts, and which timeout expired.

With 16 hosts, four parallel chains and four 10-second probes per host, probes alone can take
160 seconds. Preparation (15), SRV (10), authentication (45) and five post-connect commands (25)
bring the configured work to about 255 seconds before overhead. The proposed 300-second default
therefore replaces 120 seconds; it makes room for the planned coverage without reserving a separate
authentication window or promising every run will finish. Typical successful checks complete much
sooner. This default is an agent recommendation, not an operator-approved measured threshold.

| Non-time safety limit                                   | Value                          |
| ------------------------------------------------------- | ------------------------------ |
| Probe targets; addresses per host; parallel host chains | 16; 8; 4                       |
| One wire reply                                          | 1 MiB, checked before decoding |

Targets keep the resolver's order and are deduplicated. Omitted targets or addresses are counted
and reported as a coverage limit; the real driver's input is never trimmed to fit.

**Timeout outcomes are distinct:**

- An operation that started and timed out produces a `fail` result with `check.timeout` and
  structured data naming the operation, effective timeout and source (`check`, `run` or
  `connection`). Preserve a more specific observed error when available. This is inconclusive
  evidence about reachability, not proof that the service is unreachable or credentials are wrong.
- Work not started before the whole-run timeout is `skipped/runTimeoutExceeded`. Work skipped
  because an earlier operation timed out instead uses `dependencyFailed`, naming that operation.
  Completed results stay, and the report marks coverage as limited. This replaces the ambiguous
  `budgetExceeded` skip reason.
- User cancellation remains separate (3.3). A timeout produces a completed, limited report.

**Explicit retry, never automatic retry:** when any diagnostic timeout limits a run, the result
card offers **Retry with longer timeouts** (the doubled defaults above) and
**Retry without diagnostic timeouts** (all six diagnostic timeouts set to `null`). Explain before
an unbounded retry that it may wait until cancelled. Each is a fresh run with a new run ID, fresh
observations and normal cleanup. Previously opened or exported reports stay unchanged; this adds
no report history. Ordinary Re-run uses defaults.
Neither option changes saved connection settings, bypasses a shorter connection-configured timeout,
removes the non-time safety limits or weakens TLS or authentication. When a connection timeout was
the limiting factor, say that the user must change that connection setting before a longer retry
can help. No individual probe retries automatically.

Removing diagnostic timeouts does not remove OS, resolver or driver limits. Cancel stays available,
and in-flight work without abort support is handled as in 3.3. The user manual, feature README and
package README must explain these distinctions and the retry profiles.

> **Changed:** five-second probes risk classifying slow DNS, VPN paths or a slow handshake as a
> failure. Ten seconds is a more forgiving starting point, at the cost of longer waits on a
> black-holed endpoint. Defaults remain finite, and a user can explicitly trade waiting time for
> coverage without removing size or security limits
> ([0032](./decisions.md#0032--time-limits-are-timeouts-with-explicit-longer-or-unbounded-retries)).

### 3.3 Cancellation ([0017](./decisions.md#0017--cancellation-stops-the-run-not-necessarily-every-operation))

Cancellation is a run-level contract, not a requirement to retrofit every dependency with an abort
API. On abort, stop scheduling checks, reject the run promise as cancelled and stop emitting events,
including `runFinished`. An in-flight operation without cancellation support may finish or reach
its own limit; its result or rejection is consumed and discarded.

Every terminal path detaches observers, drops credential and token references and closes run-owned
clients and sockets. If an abandoned operation creates a client later, its settlement handler closes
it. A shared client or Kubernetes tunnel used elsewhere is never closed.

The webview acknowledges cancel immediately and keeps the rows already shown as an incomplete run,
with no summary and no report. Closing the panel or starting another run detaches the old run's
results, so late work cannot update a newer run. Cancel names the run subscription it was sent for:
a delayed Cancel for a replaced run is ignored, and one that arrives before its run starts cancels
that run as it starts.

> **Implemented** (WI-02) in `85ff17cf`: `src/runner.ts` (`runDiagnostics`, `createTimeoutFinding`,
> `formatTarget`), `src/timeouts.ts` (`DEFAULT_TIMEOUTS`, `timeoutsForProfile`, `resolveTimeouts`,
> `SAFETY_LIMITS`) and `src/errors.ts`. Checks declare an optional `timeout` kind; the runner applies
> the least of check, remaining run and connection-configured timeouts, and checks use
> `RunContext.effectiveTimeout` for inner operations. A run-scope check publishes probe targets with
> `setTargets` (deduplicated, capped at 16). `DiagnosticsRun.coverage` records timed-out operations,
> unstarted checks, omitted targets and whether a diagnostic-timeout retry could help. Tests:
> `src/runner.test.ts`, `src/timeouts.test.ts`.

## 4. Check catalogue

For each check: **where** it runs, what makes it **skip**, the **facts** it collects and the
**findings** it can raise. A fact that could not be collected carries a reason; a certificate or
version is never invented. Finding names are illustrative; the implementation fixes the unions.

### 4.1 Environment: "Diagnosis setup" (facts only, never fails)

The first row ([0014](./decisions.md#0014--the-first-step-says-where-the-checks-run),
[0030](./decisions.md#0030--rows-have-plain-names-with-the-technical-term-in-brackets)). Its
evidence line names the place: "Running on this computer · Windows 11 · x64" or "Running on remote
host WSL: Ubuntu-24.04, not this computer".

| Where     | Facts                                                                                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package   | Node.js, c-ares (`process.versions.ares`) and OpenSSL versions, OS, release, architecture, time zone, local clock                                                                                                                                                                                                                        |
| extension | Extension version and channel, VS Code version, Electron version when the extension host has one, remote kind (WSL, SSH, container, Codespaces), `mongodb` driver version, relevant settings (timeouts, SRV fallback mode), proxy presence with non-secret endpoint and bypass details (6.3), and the Entra ID sign-in environment below |

**Entra ID sign-in environment**, collected for every connection, because a wrong cloud setting
matters as soon as a connection switches to Entra ID: the selected cloud
(`microsoft-sovereign-cloud.environment`: public, US Government, China, custom or unreadable), the
sign-in provider and broker implementation, whether `documentDB.customEnvironment.ossrdbmsEndpoint`
is absent, valid or invalid, and whether a custom `hostnameSuffix` is set and in which
scope. These are the values #1050 computes for its `entraCloud.resolved` trace. Today they exist
only inside `ResolvedTokenResource.details` / `TokenResourceResolutionError.details`, built by the
module-private `createResolutionDetails` in
[documentdbTokenResource.ts](../../../../src/documentdb/auth/documentdbTokenResource.ts); export a
small offline helper rather than reading the settings a second time.

Under a remote extension host, VS Code's sign-in, including the Windows broker, runs on the local
machine; the database checks and managed identity's instance metadata (IMDS) lookup run on the
remote host. The report records this when the chosen method is Entra ID; the panel's detail line
stays "Remote host: …".

Findings: `env.proxyConfigured` (info: VS Code's proxy setting does not apply to database traffic),
`env.caresRejectsCompressedSrv` (info, when the c-ares version is affected by the #993 regression),
`env.remoteExtensionHost` (info; also the detail line).

> **Implemented** (WI-03a) in `4e18d3bc`: `src/checks/environment.ts` (package facts and proxy
> variables parsed into safe fields; the extension adds its own facts in WI-08). Tests:
> `src/checks/environment.test.ts`.

> **Implemented** (WI-08a) in `a5a47fe0`: the extension's facts come from a separate run check,
> `src/connectionDiagnostics/checks/extensionEnvironment.ts`, shown on the same "Diagnosis setup" row.
> `cs.credentialsMissing` comes from the `credentials` check (`checks/credentials.ts`).

### 4.2 Connection string

| Where   | Skips | Facts                                                                                                                                                               |
| ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package | never | scheme, hosts and ports, database, option names and known non-secret values, user name, password present (yes/no); sensitive or unknown option values omitted (6.3) |

Findings: `cs.unparseable`, `cs.srvWithPort`, `cs.srvMultipleHosts`, `cs.unknownOption` (with the
closest known option, for "Studio 3T exported it and it doesn't work"), `cs.optionIgnoredByDriver`,
`cs.conflictingTlsOptions` (`ssl` and `tls` disagree), `cs.tlsVerificationDisabled` (warning),
`cs.directConnectionWithMultipleHosts`, `cs.unencodedReservedCharacter` (`@`, `:`, `/` or `%` in the
user name or password without percent-encoding), `cs.authSourceUnusual`.

If the authority scan finds an unencoded reserved character in credentials, parser-derived
facts (including hosts, user name, database and options) are withheld and no targets are set:
ambiguous parsing can otherwise turn a password fragment into a host. The user must fix the URI
before probes run.

The extension adds `cs.credentialsMissing` (info) when a required credential is unavailable. It
does not fail this check or block the network checks; authentication skips with the reason (4.9).

**Compressors** ([0034](./decisions.md#0034--compression-and-clock-offset-come-from-the-handshake-documentdb-answers-as-a-gateway)).
The consumer tells the package which wire compressors it can actually use (`availableCompressors`
in the input). The extension determines this at run time: `zlib` is built into Node.js, while
`snappy` and `zstd` are optional driver modules that the extension does not bundle today. When the
connection string's `compressors` option names one the extension cannot use, raise
`cs.compressorUnavailable` (warning), naming it, with the fix: remove it, or put `zlib` first.
Section 4.8 then checks whether the server would actually choose it.

The probes use the network options the chosen connection would use, not just the raw URI: TLS
defaults, stored TLS exceptions, CA and client certificates, timeouts. For example, the Entra ID
path forces TLS even when the stored URI does not. No token is acquired to determine these options.
Without a chosen method, the probes use the URI and known settings only. The report lists each
effective non-secret option and where it came from (URI, TXT record, auth handler, setting).

> **Implemented** (WI-03a, WI-04a) in `4e18d3bc` and `e9c164df`: `src/checks/connectionString.ts`
> with the option table in `src/checks/uriOptions.ts`; `src/networkOptions.ts` merges TXT, URI and
> consumer `networkOptionLayers` (origin `authHandler` or `setting`) and the check records
> `effectiveNetworkOptions`. An unknown option is an error because the driver rejects it; a
> driver-deprecated option is `cs.optionIgnoredByDriver`. Tests: `connectionString.test.ts`,
> `networkOptions.test.ts`.

### 4.3 Prepare (extension)

The existing extension composition reads the target in `resolveTarget`, checks the connection
string, and adds `credentials` and `prepare` after it on the **Connection settings** row.
`extensionEnvironment` is added at the start, after package `environment`. The diagnostic read is
silent and does not start or reuse a tunnel; only `prepare` calls
`ConnectionReachabilityService.ensureReachable`, under the 15-second preparation timeout.

Kubernetes target resolution can itself contact the API before `prepare`. DKO and generic Kubernetes
services first try the DKO credential lookup, which lists DKO resources; a generic service may then
read its annotated Secret. In diagnostic mode only, a DKO-list 403 for a generic service is ignored
so that Secret lookup can proceed. A DKO service's DKO-list 403 remains strict, and network failures
still propagate for both service kinds.
A Secret 403 or 404 is preserved as a bounded credential-read issue so network checks can continue;
an observed DKO Secret-read issue stops further diagnostic credential fallback. Ordinary credential
reads retain their existing best-effort behavior. Consequently, Kubernetes API failures may surface
in `resolveTarget` or in `prepare`, depending on which operation encounters them; backend
verification in `prepare` is still required.

The diagnostic call passes `{ interactive: false, verifyEndpoint: true, signal }`. Within diagnosis,
only `prepare` calls `ConnectionReachabilityService.ensureReachable`. For a Kubernetes ClusterIP,
the provider checks the service's Endpoints for a ready pod on the service port before starting or
reusing the normal shared tunnel. A failure is represented by
`ConnectionPreparationError`, whose bounded reason is `sourceUnreachable`, `accessDenied`,
`targetNotFound`, `noReadyBackend`, `sourceMissing` or `other`. Its raw `sourceError` is host-only.
`prepare.failed` contains only `providerId`, `reason`, an allow-listed `errorName`, and optional
`statusCode`; it never includes the raw error or its message. A preparation failure skips dependent
probes and authentication, but failed DNS/TCP/TLS/`hello` probes do not by themselves suppress
authentication. A tunnel started or reused is shared and stays open after the run; it closes when
the VS Code window closes or reloads.

For a passing Kubernetes preparation with a started or reused tunnel, facts copy only the kubeconfig
context, namespace, service, service port and local port from the saved port-forward metadata; no
additional Kubernetes query is made. Connection settings details show these fields and the tunnel
outcome, and annotate the matching loopback Host as the local end of the port forward. Ready-pod
evidence is explicitly at check time: `verifyEndpoint` completes before `startTunnel`, including
its reuse paths. External-assumed or unknown outcomes do not show these details.

Ordinary connections omit the diagnostic verification intent and keep their existing behavior.
The Kubernetes provider remains registered at activation through the existing
`ConnectionReachabilityService`; there is no new registration or check-insertion API.

> **Implemented:** WI-K2 (`0168783a`) verifies the Kubernetes backend before tunnel start/reuse;
> WI-K3 (`b1c184a9`) maps preparation errors to bounded findings; WI-K1 (`bc124a25`) preserves
> diagnostic credential-read failures. The source/API-read order above reflects the current code,
> including the generic-service DKO-list exception.

### 4.4 SRV and TXT

| Where   | Skips                | Facts                                                                                 |
| ------- | -------------------- | ------------------------------------------------------------------------------------- |
| package | not `mongodb+srv://` | SRV targets with priority, weight and port; TXT options; DNS servers; resolution path |

Uses Node.js and the in-memory fallback from `@documentdb-js/srv-resolver` under the same fallback
policy as the extension, reporting the paths actually attempted, and reuses its option and
domain-validation rules. Accepted TXT options merge with explicit URI and handler options using the
existing precedence before the downstream probes. The resolved targets become the host list for the
per-host checks. The real driver still resolves through `prepareDriverConnectionString`; a later
resolution may differ and is not presented as the same observation.

Findings: `srv.notFound`, `srv.compressedReplyRejected` (info when the fallback resolved it: the
extension already works around #993), `srv.txtUnsupportedOption`, `srv.targetOutsideDomain`.

> **Implemented** (WI-03b) in `5ef938b9`: `src/checks/srv.ts` resolves with Node.js first and
> srv-resolver's fallback under the same policy, then validates with `rewriteSrvUri`; DNS and resolver
> I/O are injectable (`io.dns`). Tests: `src/checks/srv.test.ts`.

### 4.5 DNS (per host)

| Where   | Skips         | Facts                                                                                                                         |
| ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| package | host is an IP | addresses from the OS resolver and from c-ares, CNAME chain, address class (public, private, loopback, link-local), IPv4/IPv6 |

Findings: `dns.notFound` (`ENOTFOUND`), `dns.temporaryFailure` (`EAI_AGAIN`), `dns.resolversDisagree`
(hosts file, VPN, split DNS), `dns.privateEndpoint` (info: CNAME through a `privatelink.` zone to a
private address), `dns.privateEndpointPublicAddress` (warning: usually a private DNS zone not linked
to this network), `dns.loopback`.

Private endpoint findings are client-side evidence, not proof of the Azure configuration. A
disagreement in the auxiliary resolver is a warning when the resolver the connection uses succeeds.

No separate "is this machine online" step, and no lookup of an unrelated public name
([0023](./decisions.md#0023--the-research-proposals-are-settled-as-one-bounded-scope)).

> **Changed:** 0012 proposed resolving a well-known public name after DNS failures. Its result
> says nothing about private networks, it adds traffic the user did not ask for, and
> `EAI_AGAIN`/`ENOTFOUND` plus the OS versus c-ares comparison already separate "no working DNS
> here" from "this name does not exist".

> **Implemented** (WI-03b) in `5ef938b9`: `src/checks/dns.ts`. The OS resolver is primary (the driver
> connects through it); c-ares is the auxiliary resolver. Tests: `src/checks/dns.test.ts`.

> **Implemented (WI-21)** ([0042](./decisions.md#0042--public-azure-private-link-aliases-are-information-private-access-advice-needs-network-failure)):
> the warning severity described above is superseded. `dns.privateEndpointPublicAddress` is **info**:
> an Azure private-link alias resolving publicly is normal outside the resource's private network,
> and neither alias finding proves a private endpoint exists. A passing DNS row stays passing; its
> Details explain the public answer without a next step. Only a network-access failure for that host
> adds the conditional private-access advice through `contextHints`, after any provider guidance.
> A successful connection has no such hint and no warning from this finding. The two successful
> private-endpoint L2-dev scenarios keep their info Details; `private-endpoint-blocked` covers TCP timeout.

> **Implemented (WI-29):** `dns.mixedHostDomains` (warning, extension), because of #1050 review
> finding [E2](../sovereign-clouds/iterations/02-copilot-feedback-and-edge-case-review.md#e2-unclassified-seeds-erase-known-cloud-evidence).
> For Microsoft Entra ID and managed identity only, `src/connectionDiagnostics/checks/hostDomains.ts` wraps the
> package DNS check. It classifies the hosts the driver contacts (the seeds, which for `mongodb+srv://`
> is the SRV name, and the resolved targets) with `getAzureHostSuffix` and the trusted
> `documentDB.customEnvironment.hostnameSuffix` (`normalizeCustomHostnameSuffix`); IP literals and
> every other name are unrecognized. It warns when the hosts span two or more built-in clouds, or one
> built-in cloud plus an unrecognized host. It never warns when every host is unrecognized: that is
> normal for private endpoints, and the authentication findings already explain it. The finding is
> attached once, to the first host the DNS check resolves, and turns only a pass into a warning;
> dependencies, the headline and later checks do not change. Its data holds counts, cloud enums and
> whether a custom suffix is configured, never a host name, and the panel shows it without a host.
> The wording holds whether or not the E2 resolver fix is present. Through the real resolver, the
> SRV parent-domain rule keeps resolved targets in the SRV name's domain, so they add evidence
> rather than a mix.

### 4.6 TCP (per host)

| Where   | Skips               | Facts                                                          |
| ------- | ------------------- | -------------------------------------------------------------- |
| package | DNS failed for host | each attempted address and family, outcome and connect latency |

Findings: `tcp.refused`, `tcp.timeout`, `tcp.unreachable` and `tcp.reset`. For loopback-classified
errors, their next steps point to the local database, container or tunnel and omit generic firewall
advice. Non-loopback, mixed or unknown address evidence keeps conservative network guidance.

A failed IPv6 attempt does not fail the host if IPv4 succeeds, or the reverse. TLS and `hello` use the
address that answered, keeping the original host name for SNI and certificate checks. A probe
socket is not evidence of which address the driver later used. If the effective configuration
needs a transport the probe cannot reproduce (a proxy option), the probe is
`skipped/inputUnavailable` with that reason; it never silently tests a direct connection instead.

Transport findings carry the additive `addressClass` (`public`, `private`, `loopback` or `linkLocal`)
when it is known. TCP classifies the addresses actually attempted and omits the field for mixed or
unknown attempts; TLS and `hello` classify the address that actually connected, not the host label
or an unconnected DNS answer.

> **Implemented** (WI-04a) in `e9c164df`: `src/checks/tcp.ts` with injectable sockets (`io.net`).
> Tests: `src/checks/tcp.test.ts`.

### 4.7 TLS (per host)

| Where   | Skips                           | Facts                                                                                                       |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| package | TLS off, or TCP failed for host | protocol, cipher, subject, SANs, issuer chain, validity dates, fingerprint, CA source (system, `tlsCAFile`) |

Handshake first with the effective CA, client certificate, SNI and exception options the connection
uses, and keep Node's own verification error; use `tls.checkServerIdentity` for name checks. Only if
verification failed before certificate facts were available, one inspection-only handshake with
verification off collects the public certificate facts. It never turns the first result into a
success and is never used for anything else. A server may close either handshake before sending a
certificate; that is recorded as such, not as "not a TLS server".

> **Changed:** the draft connected with verification off and evaluated trust afterwards. That
> re-implements verification and can disagree with Node's own result. Verifying first, with the
> connection's own options, tests exactly what the connection does.

When the chosen configuration allows a certificate exception, a trust problem is a warning, not a
failure.

Findings: `tls.notTlsServer` (only on positive evidence of a plaintext reply),
`tls.handshakeRejectedByServer` (the handshake closed before a certificate arrived; the finding does
not attribute the close to a remote server without evidence, and uses local-endpoint guidance when
the connected address is loopback), `tls.selfSigned`, `tls.untrustedIssuer` (missing CA bundle, corporate
TLS inspection), `tls.hostnameMismatch`, `tls.expired`, `tls.notYetValid` (with the local clock and,
when measured, the clock offset from 4.8 as supporting evidence), `tls.verificationBypassed` (info).

> **Implemented** (WI-04a) in `e9c164df`: `src/checks/tls.ts` and `src/checks/tlsOptions.ts`; test
> certificates come from `src/test/certificates.ts`, generated at test time. Tests:
> `src/checks/tls.test.ts`.

### 4.8 Wire protocol: unauthenticated `hello` (per host)

| Where   | Skips                        | Facts                                                                                                                                                                                                                                                      |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package | TCP or a required TLS failed | writable primary, replica set name, advertised members, `me`, `isdbgrid`, wire versions, SASL mechanisms for the user, `internal.documentdb_versions`, compressors the server accepts, server time (`localTime`) and the computed clock offset, round trip |

The probe sends the handshake the driver sends first: legacy `{ isMaster: 1, helloOk: true }` over
OP_QUERY to `admin.$cmd`, or OP_MSG `hello` when the connection is load-balanced or uses the Stable
API. The handshake offers the connection string's `compressors`, exactly as the driver would, so
the reply shows which ones the server accepts; nothing is compressed, because the probe sends no
further message. No speculative authentication. Frame length, `responseTo`, opcode and BSON
boundaries are validated before a reply is accepted; anything else is an inconclusive finding, not a
general protocol implementation. `saslSupportedMechs` is requested only when a user name and auth
source are known.

Findings: `hello.noReply`, `hello.notWireProtocol` (something else listens on that port),
`hello.closedWithoutReply` (with TLS off: the server probably requires TLS), `hello.inconclusive`,
`hello.mechanismNotOffered` (only when the server reported mechanisms),
`hello.compressorUnavailable`, `hello.clockOffset`.

**Compression** ([0034](./decisions.md#0034--compression-and-clock-offset-come-from-the-handshake-documentdb-answers-as-a-gateway)).
The driver uses the first compressor in the connection string's order that the server also
accepts. If that compressor is one the extension cannot use (4.2), raise
`hello.compressorUnavailable` (error): the driver would sign in successfully and then fail on the
first command with "Optional module `snappy` not found", because the handshake and SASL commands are
never compressed. Without this, the failure would first appear under Database access, after
Authentication had passed. When the server accepts no requested compressor, `cs.compressorUnavailable`
stays a warning only. DocumentDB's gateway does not negotiate compression (its handshake reply has no
`compression` field), so this concerns MongoDB API servers such as Atlas or self-hosted MongoDB.

**Clock offset** ([0034](./decisions.md#0034--compression-and-clock-offset-come-from-the-handshake-documentdb-answers-as-a-gateway)).
MongoDB and the DocumentDB gateway both return `localTime` in the handshake reply. The probe
computes `offset = localTime − (sentAt + roundTrip / 2)` with an uncertainty of half the round
trip, records it per host, and reports the measurement with the smallest uncertainty. No extra
message is sent. Raise `hello.clockOffset` (info) when the offset exceeds five minutes beyond its
uncertainty, the usual clock-skew tolerance for certificates and Entra ID tokens. It is supporting
evidence, never a failure: it explains `tls.notYetValid` or `tls.expired`, and an Entra ID
`auth.failed` when the sign-in library judged an expired token valid against a slow local clock.
A reply without a usable `localTime` leaves the offset unavailable.

Wire-version compatibility is left to the driver; the probe records versions and attaches a
compatibility finding only when the driver's rejection supplies it. A denied or unsupported
handshake never prevents the real driver attempt.

**Topology scope:** only the URI and SRV targets are probed
([0023](./decisions.md#0023--the-research-proposals-are-settled-as-one-bounded-scope)). Members
advertised by `hello` (for example internal Docker or Kubernetes names) are recorded as facts, not
probed. `hello.advertisedMembersUnreachable` is raised only when the driver's per-server errors show
it. A failed member never overrides a successful connection. `directConnection=true` is mentioned as
a local single-node workaround only, because it changes discovery and failover.

> **Changed:** this settles 0019 at its recommended starting point, and fixes the handshake the
> draft left open, without building a second driver.

> **Implemented** (WI-04b) in `4b4f76fc`: `src/checks/hello.ts` with the test responder
> `src/test/wireResponder.ts`. Choosing the host with the smallest clock-offset uncertainty is left to the
> report (WI-05). Tests: `src/checks/hello.test.ts`.

### 4.9 Authenticate (extension)

When the required inputs are available without prompting, build the client the way `ClustersClient`
does (auth handler, `configureAuth`, `prepareDriverConnectionString`), as a short-lived client owned
by the run. The auth-handler construction moves out of `ClustersClient.initializeClient` into a
shared factory (the code already carries a TODO for it) with a caller policy: ordinary connects stay
interactive; connection diagnosis is non-interactive. The run never reuses `ClustersClient`'s cached
client and never writes to `CredentialCache`.

Use the method already chosen, with its credentials, and never prompt
([0013](./decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped)).
"Chosen" means `selectedAuthMethod` on the stored connection, or the method of the credentials
cached for the `clusterId` after a connect in this session. A chosen No Authentication method is
valid input and is tested normally (and never labelled "authenticated").

For Entra ID, the non-interactive policy calls `getSessionFromVSCode` with `{ silent: true }` and
the same scope, provider and tenant, never `createIfNone` or `forceNewSession`. The function passes
`vscode.AuthenticationGetSessionOptions` through unchanged, so no new sign-in code is needed.

Facts: method, mechanism, user name, Entra ID tenant and account (when the session provides them),
managed identity kind (system- or user-assigned), time spent acquiring a token versus connecting
(from `ConnectionStartupTimings`, without counting nested waits twice).

Findings: `auth.failed` (server code 18), `auth.mechanismMismatch`, `auth.credentialsUnavailable`,
`auth.serverSelectionTimeout` (with the driver's per-server errors from the topology description,
which name the actual cause), and the Entra ID findings in 4.9.2.

> **Implemented** (WI-11, WI-12) in `d533f779` and `212e8c7e`: `src/documentdb/auth/createAuthHandler.ts`
> (caller policy, phase observers) and `src/connectionDiagnostics/checks/authenticate.ts` with a run-owned client
> (`src/connectionDiagnostics/auth/runOwnedClient.ts`).

#### 4.9.1 Skipped or failed

One rule decides every case ([0025](./decisions.md#0025--authentication-is-skipped-only-when-the-troubleshooter-withholds-a-prompt)):
**skip only where a real connect would ask the user for something; everything else that stops a
real connect is a failure.**

| Observation                                                                                                                                                                                                                                                   | Result                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No method chosen; stored password absent; no silent Entra session                                                                                                                                                                                             | `skipped/inputUnavailable`, naming what is missing. Connection access and server facts skip with it; network checks still run                                                                |
| Cloud mismatch; `ossrdbmsEndpoint` invalid; custom cloud definition unreadable; custom cloud with no resolvable resource (`customCloudUnresolved`); managed identity with an unknown cloud (`managedIdentityCloudUnknown`); a host outside the OIDC allowlist | `fail`, keeping #1050's error `kind` and its message, which names the setting to change                                                                                                      |
| A token request that throws; credentials the server rejects                                                                                                                                                                                                   | `fail`, keeping whether the token or the server rejected it                                                                                                                                  |
| Any other failed attempt that no specific finding explains                                                                                                                                                                                                    | `fail` with a safe fallback: `auth.driverOptionsRejected` when the driver rejected the options before connecting, otherwise `auth.connectFailed` (error name only, never the driver message) |

> **Changed:** a draft treated "missing settings" as a skip, and the stashed alternative skipped
> `customCloudUnresolved` and `managedIdentityCloudUnknown`. A real connect does not prompt in
> those cases; it fails with #1050's message. Reporting "not tested" would hide the fault and the
> setting that fixes it. Every case 0016 names (method, credentials, session) is still a skip, so
> this refines 0016 rather than reversing it.

**The silent lookup has one blind spot.** When no silent session is available, connection diagnosis
cannot tell "not signed in" from a consent or preauthorization failure such as AADSTS65002, today's
US Government failure. The panel says only that sign-in is needed and was not attempted (4.9.2).
The report explains the limitation and names the log to check (**Developer: Show Logs…** →
"Microsoft Sovereign Cloud Authentication", or "Microsoft Authentication" for the public cloud,
chosen as `entraErrorRules` already does). If #1050 recorded a token failure for this `clusterId`
in the last ten minutes (`getRecentEntraTokenFailure`), the report shows its classifier rule and
age under "Earlier in this session", and the result card adds "A sign-in for this connection
failed earlier. Show report has the details." This reads state that already exists; it adds no error
capture or replay, so it stays within [0018](./decisions.md#0018--answer-the-connectivity-question-not-a-general-permissions-audit).
It never changes the outcome.

#### 4.9.2 Microsoft Entra ID and managed identity phases

Entra ID authentication fails in three places with different owners: VS Code settings, the
identity platform, and the cluster. The check records them as three phases in `steps`
([0021](./decisions.md#0021--authentication-reports-sub-steps-statuslist-gains-one-level-of-nesting)).
**The panel shows them as one Authentication row with a short evidence line; the phases, their
facts and their codes are in the report** ([0027](./decisions.md#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)).

What the panel says (illustrative wording, final text in the message table and UX review). The
Authentication row's evidence line says what was detected (5.2); the explanation and fix go to the
result card (4.13).

| Outcome                   | Authentication evidence line                                                                                                                                      | Result card                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Running                   | "Checking sign-in settings…" → "Getting a sign-in token…" → "Connecting…" (real order; managed identity goes straight to "Connecting…")                           | —                                                                                                   |
| Passed                    | "Microsoft Entra ID · alice@contoso.com" (+ " · Azure US Government" for a cloud other than the public one); managed identity: "Managed identity · User-assigned" | Connected                                                                                           |
| Cloud or setting problem  | "Microsoft Entra ID · Cluster in Azure US Government · VS Code signed in to Azure"                                                                                | #1050's existing sentence, which names the setting to change                                        |
| Not signed in             | "Microsoft Entra ID · No sign-in available without a prompt"                                                                                                      | "Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the check again." |
| Token request failed      | "Microsoft Entra ID · Sign-in failed"                                                                                                                             | The existing `entraErrorRules` explanation                                                          |
| Server rejected the token | "Microsoft Entra ID · signed in · the cluster did not accept it"                                                                                                  | "Check that this identity is added as a user on the cluster."                                       |

No resource URIs, reason names, allowlists, claim values, rule IDs or AADSTS codes appear in the
panel. Native and No Authentication rows work the same way, without phases.

> **Changed:** the consolidated plan showed the three phases as nested rows in the panel. The
> operator: "I don't want to over-emphasise this, the details can be in the copied
> details/reports in md format for the user to inspect, or for the support to inspect." The
> distinction matters to whoever fixes the problem, and the sentence already names that person;
> the mechanics only help support.

The phases, as recorded for the report:

| Phase                     | Source (#1050 code reused)                                                                       | Facts                                                                                                                                                                                                                                                                         | Findings                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Sign-in configuration** | `resolveInteractiveTokenResource` / `resolveManagedIdentityTokenResource`; `getOidcAllowedHosts` | selected and host cloud; requested resource (a built-in value or "custom"); how it was chosen (`setting`, `customOverride`, `customLoginHost`, `armMetadata`, `host`, `imds`); ARM metadata and IMDS outcomes; whether every host is in the OIDC allowlist, and the allowlist | `auth.cloudMismatch`, `auth.tokenResourceUnresolved` (with the resolver's `kind`), `auth.oidcHostNotAllowed`                         |
| **Token**                 | silent `getSessionFromVSCode` (interactive); `ManagedIdentityCredential` (managed identity)      | duration; the token claim summary (4.9.3)                                                                                                                                                                                                                                     | `auth.entraTokenFailed` with the `entraErrorRules` rule ID and AADSTS code, `auth.entraAudienceMismatch`, `auth.entraTenantMismatch` |
| **Server authentication** | the driver's `MONGODB-OIDC` handshake                                                            | duration; server error name, code and code name                                                                                                                                                                                                                               | `auth.failed` (18: wrong audience, or no database user for this identity), `auth.serverSelectionTimeout`                             |

**Execution order is real order.** Interactive sign-in gets its token before the driver connects.
Managed identity gets its token inside the driver's `OIDC_CALLBACK`, after DNS, TCP and TLS succeeded,
so its Token phase completes while Server authentication is in progress. The report's timings show
that; the token is never requested early to fit a tidy order. A managed identity token failure is
not described as "before the server was contacted".

A token success does not prove the server accepts it; a network failure after the token proves
neither acceptance nor rejection. The error classification reuses `classifyEntraError` and the one
`entraErrorRules` table; there is no second classifier.

The never-merged `preview/sovereign-diagnostics` branch prototyped this as three modal dialogs. The
dialogs are not reused. Its allowlist-based value mapping (`safeResolutionDetails`,
`describeTokenClaims`, `connectionFailureRows` in `previewDiagnostics/report.ts`) moves into shipped,
tested code. Its post-connect probes are not copied as-is: they used `listDatabases` with
`nameOnly`, which is not the request the tree makes (4.10).

#### 4.9.3 Token claim summary

When a token is available, decode its payload locally and keep only an allowlisted summary, for the
report only:

- requested resource versus audience (`aud`): `match`, `different`, or `notComparable` when the
  audience is a GUID or opaque value rather than a resource URI;
- issuer cloud, from a fixed list of known issuer hosts;
- token version, client category (VS Code, managed identity, other);
- tenant present, and whether it matches the tenant configured on the connection;
- expires in, or already expired (never clamped to a valid-looking value).

Decode only a JWT-shaped token with a payload of at most 64 KiB. Anything else makes the summary
unavailable without failing authentication. The claims are unverified hints, not a signature check.
The token, its signature and every claim value outside this list are discarded immediately and never
appear in facts, events, logs or reports.

#### 4.9.4 Side effects and tracing

The #1050 handlers have side effects beyond `CredentialCache`, and connection diagnosis states its
policy for each:

- `recordEntraTokenFailure` / `clearEntraTokenFailure`: a real token failure or success in the run
  updates the record, as a real connect would. A silent "no session" skip must not record a failure,
  because it would change how the next real connect's error is explained.
- `traceContext.startupProperties.errorKind` and the cloud fields from `recordCloudResolution`: pass
  the run's telemetry properties here, never a real connection's.
- `[Authentication]` output lines: pass `AuthTraceContext { startupCorrelationId: <runId>,
surface: 'connectionDiagnostics' }`, so the lines the handlers already write identify the run (6.4).

#### 4.9.5 Scope

The run tests the extension's own connection. Since #1050, the shell and playground resolve the
token resource on the main thread with the same resolver, so a passing Sign-in configuration phase
covers them too. Their worker processes are not tested.

> **Implemented** (WI-12) in `212e8c7e`: `src/connectionDiagnostics/auth/tokenClaims.ts`; steps
> `auth.signInConfiguration`, `auth.token`, `auth.serverAuthentication`. Recorded token failures keep the
> classifier rule since `6b7b0540`.

### 4.10 Connection access (extension, not an RBAC audit)

On the owned client, bounded as in 3.2: `ping` (round trip, and proof that a command was answered),
`connectionStatus` (user and reported roles) and the same `listDatabases` request the tree makes
(`ClustersClient.listDatabases`, without `nameOnly`). Only the outcome and database count are kept,
not the list. This separates "connected, but listing databases was denied" from "could not connect";
a denied or unsupported command never turns a successful connection into a failure. A non-denial
`ping` failure (such as an unavailable negotiated compressor, §4.8) fails this check with only the
allowlisted error name and code, not raw error text. Each command timeout is reported separately
with `check.timeout`, leaves this check at warning, and does not suppress the next command.

Findings: `access.listDatabasesDenied` (warning), `access.noDatabasesVisible` (info),
`access.readRoleReported` (info, naming a known read role and its database). Custom role names are
kept as facts; inheritance and effective privileges are not computed. No write probes. An
unsupported or denied `connectionStatus` only limits the facts.

> **Implemented** (WI-13a) in `9126e815`: `src/connectionDiagnostics/checks/connectionAccess.ts`.

> **Implemented (WI-27)** ([0048](./decisions.md#0048--no-authentication-that-the-server-will-not-serve-needs-sign-in)):
> each command error is classified in `postConnectCommand.ts`. A refusal (13 `Unauthorized`,
> 18 `AuthenticationFailed`, or a "not authenticated" / "requires authentication" message) is
> `signInRequired` ("requires sign-in") when the run did not sign in and `denied` ("not allowed") when
> it did; 59, 115 and `NotImplemented` stay `unsupported` ("not supported"). Codes stay in the report.
> With No authentication, a `listDatabases` refused for lack of sign-in raises
> `access.signInRequired` (warning): the row reads "Ping 93 ms · Listing databases needs sign-in" and
> the card is "Connection works, but sign-in is required" (4.13). A refusal with a signed-in method
> keeps `access.listDatabasesDenied`.

### 4.11 Server facts (extension)

On the same owned client: bounded `buildInfo` and `hello`. Facts:

- server version (`buildInfo.version`); DocumentDB engine and API versions when
  `hello.internal.documentdb_versions` is present;
- topology: standalone, replica set (name, primary, member count), sharded router, load-balanced,
  or **DocumentDB gateway**; read-only state; wire version range;
- the endpoint that answered, when the driver reports it; seed hosts listed separately;
- platform: Azure DocumentDB (with its cloud: public, US Government, China), Atlas, Local Quick
  Start, Kubernetes, other, with the evidence for the classification.

Version semantics reuse the dashboard's `getClusterVersions` and `parseDocumentDbEngineVersion`
(today in `clusterDashboard/formatUtils.ts`; move them to a shared module that both the host and the
webview import, keeping the dashboard's tests). Without DocumentDB metadata, a version is labelled
**Server version**, not engine version, exactly as the dashboard does.

**DocumentDB answers as a gateway, not as a replica set.** The DocumentDB gateway's handshake reply
always has `msg: "isdbgrid"` and a writable primary, with `internal.documentdb_versions` and no
replica set name (`ismaster.rs` in documentdb/documentdb). A router-style reply that carries
`internal.documentdb_versions` is therefore classified and shown as "DocumentDB gateway", never as
a MongoDB sharded cluster or replica set. Replica set and member facts apply to MongoDB API servers
only ([0034](./decisions.md#0034--compression-and-clock-offset-come-from-the-handshake-documentdb-answers-as-a-gateway)).

Classify Azure hosts with #1050's `getAzureCloudFromHosts`. The existing `hasAzureDomain` only
knows `azure.com`, so an `*.azure.us` or `*.azure.cn` cluster would otherwise be "other".

Do not call the whole `getClusterMetadata` collector (it also issues `serverStatus` and `hostInfo`),
the dashboard's inventory export or any Azure Resource Manager request. Cached dashboard data never
fills a fact this run did not observe. A denied or unsupported command is a fact, not a failure.
A command timeout produces `check.timeout` and warning status, with the next command still tried.

> **Changed:** the draft said this "reuses the parsing the cluster dashboard already does". The
> dashboard deleted its reply parsing (cluster-dashboard 0017) and reports raw replies; what it
> still has is the version helper above, which is what this reuses.

> **Implemented** (WI-13a) in `9126e815`: `src/connectionDiagnostics/checks/serverFacts.ts`.

### 4.12 Context hints (extension)

When the run observed a failure, ask `ErrorExplanationService` about it. Its providers answer in
registration order (`ClustersExtension.ts`): Local Quick Start, Kubernetes, Atlas, SRV DNS and
Entra sign-in (#1050); the first answer wins. The explanation is sanitized before it enters a
result, because provider text may name a target. Platform next steps already supported by providers
are added from the facts, such as an Atlas IP access list or an Amazon DocumentDB CA bundle. The
first release also gives generic firewall, IP allowlist, VPN and routing guidance for network
failures; it does not inspect cloud firewall configuration or claim that a firewall caused the
failure. When every error finding in the failed transport checks is explicitly loopback-classified,
the final card suppresses the generic firewall hint and the transport findings point to the local
endpoint. Non-loopback, mixed or unknown address evidence retains conservative network guidance.
Cloud-platform-specific firewall configuration helpers are planned for the next iteration (9).

`explain` has telemetry side effects: the service sends `errorExplanation.explained`, and the
Entra provider sends `entraSignIn.classified` and writes an `[Authentication]` line. Add an optional
`source` field to `ErrorExplanationRequest` that both events record (`connectionDiagnostics`), so runs
are not counted as real connect failures. Providers stay text-only: no UI, retry or repair.

> **Implemented** (WI-07a) in `2656cd33`: `ErrorExplanationRequest.source` (`'connectionDiagnostics'`) is
> recorded as `explanationSource` on `errorExplanation.explained` and `entraSignIn.classified`, and as a
> `source` field in the provider's `[Authentication]` line. The context hints check comes in WI-13.

> **Implemented** (WI-13a) in `9126e815`: `src/connectionDiagnostics/checks/contextHints.ts`.

### 4.13 Result card (derived, below the list)

When the run ends, a result card (`MessageBlock`, as Local Quick Start's "All set" and failure
blocks) expands into place **below** the status list. It is not a `StatusList` row
([0029](./decisions.md#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list)). It is derived
from the check results and performs no I/O.

| Outcome                   | Card    | When                                                                                                                  |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| **Connected**             | success | The owned driver connection succeeded                                                                                 |
| **Connection failed**     | error   | The real attempt failed, or a prerequisite it needs failed (connection setup, an auth configuration failure in 4.9.1) |
| **Connection not tested** | warning | Authentication was skipped for missing input, or the whole-run timeout expired before an attempt                      |
| **Check cancelled**       | info    | The user cancelled; rows already settled stay as they are                                                             |

- **Connected:** the title "Connected", and one line with just enough to see that a real server
  answered: "DocumentDB 0.107.0 (API 7.0) at `c-mycluster.mongocluster.cosmos.azure.com` · Ping
  12 ms". The version is the DocumentDB engine version when the server reports one, otherwise
  "Server 7.0.12". When a row ended in a warning, a second line names it: "1 warning: Secure connection (TLS)". With No
  Authentication the card does not say "authenticated".
- **Failed or not tested** (content refined during UX review): the title names the row where it
  stopped ("Connection failed at Authentication"), then what was detected and what to do next,
  including the provider hint if there is one, then "Contacting support? Show diagnostics opens a
  report you can review and share." The card's actions are **Show diagnostics** and **Copy report**.
  If a timeout limited coverage, also show the retry actions from 3.2, including for a Connected
  run with incomplete diagnostic coverage.
- **Possible firewall cause:** for transport failures, server-selection timeouts or an otherwise
  unexplained inability to reach the server, the final card and report next steps include this
  guidance unless every error finding in the failed transport checks is explicitly
  loopback-classified:
  "A firewall or IP allowlist may be blocking this connection. Check access from the computer or
  remote host where these checks ran, including VPN and network rules." This is a possibility,
  never a diagnosis. Keep any more specific observed cause first; do not attach this hint to
  an isolated parse error, certificate validation error or explicit credential rejection with no
  network-failure evidence. Loopback-only failures instead point to the local database, container
  or tunnel; non-loopback, mixed or unknown evidence keeps the conservative hint. Cloud-specific firewall
  helpers come in the next iteration
  ([0033](./decisions.md#0033--network-failures-mention-possible-firewall-blocking-cloud-helpers-come-next)).
- **Cancelled:** "Check cancelled. The results so far are kept." No report actions.

The headline is the real attempt's failure, supported by the earlier evidence that explains it,
ordered by row and target order, never by whichever host finished first. A dead seed is supporting
evidence when another member answered; an auth rejection outranks it. Warnings never overturn
"Connected".

The content subtitle follows the run: static "Checking the connection…" while running,
then relative "Checked … ago" wording (WI-24). There is no running timer and no total. Each settled row
that ran shows its own duration in a squared badge at the end of its label line; the report keeps
the Timings table ([0050](./decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer)).

> **Changed:** the plan made the outcome the list's last row, and a separate "What to do next"
> section below it. The operator: "summary should be just a 'card' or a message bar, not a part of
> the status list." The list is now only the checks, and the outcome and next steps are one card.
> It appears below the list, so nothing above it moves.

> **Implemented** (WI-13b, WI-13c) in `6b7b0540` and `a2a2d3a4`: `src/connectionDiagnostics/result.ts`
> derives the outcome and card data; `DiagnosticsResultCard.tsx` renders it. A failed first command
> caused by an unavailable compressor is "Connection failed at Database access" with
> `hello.compressorUnavailable` as the headline.

> **Implemented (WI-25):** the content of row Details follows the shared package's documented
> details scale ([StatusList README, "Details content"](../../../../packages/vscode-ext-webview-fluentui/src/components/StatusList/README.md#details-content)).
> `StatusListItem` owns the frame (toggle, region, rule, indent, spacing, motion) and the base type
> (`fontSizeBase200`, `lineHeightBase200`, `code` in `fontFamilyMonospace`);
> `DiagnosticsRowDetails.tsx` supplies only content, built from `StatusListDetailsMessage`
> (findings), `StatusListDetailsSection` (per host) and `StatusListDetailsFacts` (evidence), with
> code-like values in `<code>`. No behaviour or wording changed.

> **Implemented (WI-20)** ([0041](./decisions.md#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)):
> the card is a short outcome of the diagnosis; the server line and the "1 warning: <row>" line above
> are replaced. Headlines: "Connection successful", "Connection successful, with 1 warning" (or N),
> "Connection successful, but 1 check failed" (or N), "Connection successful, but N checks need
> attention", "Connection failed at <row>", "Connection not tested", "Diagnosis stopped at the time
> limit" (the whole-run timeout before sign-in), "Diagnosis cancelled" and "Diagnosis did not
> finish". A successful card is one sentence ("All checks passed. Sign-in succeeded and the database
> answered.", or "All checks passed. The database answered." without authentication), or the rows
> that ended in a warning or an error, each with its most severe finding title, and "Select Details
> on a row to see why and what to do." That also names failed probe rows on a successful connection
> (review R6); Connected precedence is unchanged. A failed card shows the finding title with its host,
> the explanation, "Next:", supporting evidence and hints, and the support line last. Server version,
> API version, ping and the answering host live only in the Server response and Database access
> Details (and the report summary, which still uses `serverLine`). The headline is a level-3 heading
> one type step above the body; labels are semibold in the secondary foreground colour; the Details
> pointer and support line are captions. The card derives its attention rows from the panel rows, so
> `warningRows` and `deriveResult`'s `rows` parameter are gone. The report's outcome label is
> "Connection successful". L2-dev adds `seed-refused-connected`.

> **Implemented (WI-21)** ([0042](./decisions.md#0042--public-azure-private-link-aliases-are-information-private-access-advice-needs-network-failure)):
> the support caption is "Contacting support? Use Share report to copy or save the report."
> Show report remains the review action; the earlier-sign-in-failure sentence still points there.
> Public Azure alias information never contributes to the card's warning count. On network failure,
> the context hint says "This name resolved to a public address. If the cluster allows only private
> access, connect from its virtual network or a network that resolves the private endpoint (VPN,
> peering or a private DNS zone)." It is a possibility, not a diagnosis of the cluster's access policy.
>
> **Amended:** the support line is body text, not a caption, set apart by a divider: "Contacting
> support? Use Share report at the bottom of the page to copy or save the report." A successful
> copy also shows a non-modal "The report was copied to the clipboard." notification from the host.

> **Implemented (WI-27)** ([0047](./decisions.md#0047--the-root-cause-leads-when-the-driver-reached-no-server),
> [0048](./decisions.md#0048--no-authentication-that-the-server-will-not-serve-needs-sign-in)):
> when the driver reached no server (`auth.serverSelectionTimeout`, or a timed-out authenticate step)
> and an earlier network probe failed, that probe's error is the headline and the card stops at its
> row; the driver's failure is a corroborating line ("The driver also could not reach a server."),
> not "Also detected". A rejected sign-in, or a driver timeout with passing probes, keeps the
> Authentication headline. A timed-out TCP probe reads as "Network connection timed out" and a
> timed-out hello as "No server response", in the row, the card and the report; the Authentication
> row says "Could not reach a server · Sign-in not tested". A connected run with
> `access.signInRequired` keeps outcome `connected`, but its card is a warning titled "Connection
> works, but sign-in is required" with the finding's explanation and next step, and lists other
> attention rows without repeating Database access. L2-dev adds `unreachable-host` and
> `no-auth-signin-required`.

## 5. Extension integration

### 5.1 Entry points ([0007](./decisions.md#0007--two-entry-points-from-the-start-an-error-node-and-a-context-menu-on-every-cluster))

- **Error node.** `ClusterItemBase.createErrorRecoveryChildren` adds "Diagnose this connection…"
  (`contextValue: 'error'`, id suffix `/diagnose`) beside the retry node. Only the retry node ends
  in `/retry`, so `containsRetryNode` and the providers' failed-state caching are unaffected; a test
  pins this.
- **Context menu.** "Diagnose Connection…" (`vscode-documentdb.command.diagnoseConnection`) on `treeitem_documentdbcluster`
  in the Connections, Discovery and Azure views; not on the Local Quick Start instance node
  ([0015](./decisions.md#0015--the-context-menu-item-is-on-cluster-nodes-only-not-on-quick-start-instance-nodes)).
- **Command palette.** The same command with a connection picker.

> **Implemented** (WI-09) in `0c7afda9`: `src/commands/diagnoseConnection/diagnoseConnection.ts`;
> the error node is added in `ClusterItemBase.createErrorRecoveryChildren`; the palette path reuses the
> stored-connection tree picker.

### 5.2 Webview ([0008](./decisions.md#0008--the-surface-is-a-webview-built-from-microsoftvscode-ext-webview-fluentui-components))

- `Container` with a static wizard-style header (icon, "Connection Diagnostics", a general task
  description, and Give Feedback). Like DocumentDB Local's setup page, the content starts with a
  `ContainerSection` heading naming the connection and a subtitle showing static checking text while running
  or the final run status. The footer's primary action is **Cancel** while running and **Re-run**
  after the run ends; they are never offered together. **Show diagnostics** and **Share report** appear only when a completed
  report is available and are not repeated in the result card. The footer's info text starts with
  "Includes host and identity details." and an inline **Hide identifiers**
  link. When hiding is enabled, the text describes the placeholders and the link becomes
  **Show identifiers**. "Review before sharing." is last in both states.
  **Share report** opens a menu with **Copy report to clipboard** and **Save report to file…**.
  Timeout-limited results add the explicit longer-timeout and no-diagnostic-timeout retries from
  3.2; the latter warns that cancellation may be needed. Retry choices are per-run, not settings.
- **A fixed, universal list with static labels** ([0028](./decisions.md#0028--a-fixed-row-list-with-static-labels-only-detail-lines-change),
  [0029](./decisions.md#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list)). The same eight
  rows for every connection, present from the moment the panel opens as `pending`, each with
  `reserveDetailSpace`. Rows settle strictly top to bottom, so the user always knows where the run
  is. Labels never change. During the run only a row's status glyph and its evidence line change;
  the result card appears below the list when the run ends. Re-run resets the same rows to
  `pending`; it never rebuilds the list.

  | #   | Label (illustrative)     | Checks behind it              | Evidence line (illustrative)                                                                                                                                                                                           | When it does not apply                                |
  | --- | ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
  | 1   | Diagnosis setup          | environment                   | "Running on this computer · Windows 11 · x64" or "Running on remote host WSL: Ubuntu-24.04, not this computer"                                                                                                         | always applies                                        |
  | 2   | Connection settings      | connectionString, prepare     | "mongodb+srv · User alice · 2 options"; Kubernetes adds "· Using port forward"; on failure "Unknown option sslCert · Did you mean tlsCertificateKeyFile?"                                                              | always applies                                        |
  | 3   | Server address (DNS)     | srv, dns                      | "SRV record lists 3 hosts · All resolve · Private endpoint"                                                                                                                                                            | `skipped`: "Not needed: the host is an IP address"    |
  | 4   | Network connection (TCP) | tcp                           | "3 of 3 hosts reachable · Port 10260"; "host-b refused the connection · 2 of 3 reachable"                                                                                                                              | —                                                     |
  | 5   | Secure connection (TLS)  | tls                           | "Certificate trusted · Valid until 1 Mar 2027" (no TLS version: Details has it, 0050)                                                                                                                                  | `skipped`: "Not used: TLS is off for this connection" |
  | 6   | Server greeting (hello)  | hello                         | DocumentDB: "DocumentDB gateway · Answered before sign-in"; MongoDB: "Replica set rs0 · Primary found · Answered before sign-in"; adds "· This computer's clock is 12 min behind" only with `hello.clockOffset` (0049) | —                                                     |
  | 7   | Authentication           | authenticate                  | 4.9.2; native: "Username and password · SCRAM-SHA-256 · alice" (0050)                                                                                                                                                  | `skipped` with the reason (4.9.1)                     |
  | 8   | Database access          | connectionAccess, serverFacts | "Ping 12 ms · 5 databases visible"; "Connected · listing databases was denied"                                                                                                                                         | `skipped` when authentication did not succeed         |

  Labels name what the user cares about, with the technical term in brackets where support or
  documentation will use it ([0030](./decisions.md#0030--rows-have-plain-names-with-the-technical-term-in-brackets)).
  "DNS", "TLS" and "Network" alone all read as "the network" to most users; "Server address (DNS)"
  and "Secure connection (TLS)" say which part of it.

  Rows are an ordered projection, not a claim that every host executes one global phase at a
  time. Buffer later-row statuses and evidence until earlier rows settle; mark an aggregate row
  settled only when its work has settled across all hosts. A single event can then settle several
  rows, in order. Keep actual event timestamps and concurrency in the report and Output trace.
  Context hints have no row: they fill the result card. A row that does not apply stays as `skipped` with its
  reason ([0005](./decisions.md#0005--statuslist-gains-a-skipped-status)); that is information
  too ("Not used: TLS is off").

- **Evidence lines, as in Local Quick Start.** A row's detail says what was done and what was
  detected, as `·`-separated segments in order of importance: "Checking…" while active, then the
  observations, or on failure what was detected ("Certificate expired on 2 Oct 2026"). The host sends
  semantic segments and the view formats and localizes them, as Quick Start's Docker evidence line
  does (`DockerDetailSegment`), so the panel does not depend on the package's English detail (0031). A line uses at most
  four segments, chosen to fit the reserved line at the panel's usual width; everything else is in
  the report. Narrow panels may wrap; details are never cut off with an ellipsis, which hides text
  from keyboard and screen-reader users.
- **What the panel never shows** ([0027](./decisions.md#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)):
  facts tables, nested sub-step rows, finding or AADSTS codes, resource URIs, rule IDs or per-check
  timings. Show report (called Show diagnostics until WI-19) has them. Each row's own duration, and in
  Details each host's time and each TCP address's connect time, are the exception
  ([0050](./decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer)).
- **The result card** (4.13) below the list, expanding into place.
- One panel per `clusterId`; opening it again focuses the panel and offers to re-run. The session
  replaces its current target and entry point with the newly selected node, updating the tab title
  and connection name. Each run snapshots that subject once for credentials, correlation and report
  naming; reopening does not change an active run or discard a completed report.
- Live narration through the existing `Announcer`, as Local Quick Start does: one announcement per
  settled row and one for the result card; progress text in an evidence line is not announced. Rows keep
  stable IDs so focus does not jump while they update. When Cancel, a result-card retry, the re-run
  offer or a report error disappears while it holds focus, focus moves to the always-present Re-run.
- Progress arrives through a tRPC subscription. Every event carries the run ID; events from a
  replaced run are dropped. Report actions require a completed run and name its run ID.

> **Changed:** earlier drafts gave each row a collapsible facts table, and the consolidated plan
> nested the Entra ID phases as rows with a new `StatusListItem` `children` slot. Both put
> support-level detail in front of every user. The report already holds all of it, so the
> library change is no longer needed; `StatusList` gains only `skipped`.
>
> **Changed:** the consolidated plan added rows as the run went and let details grow to full
> explanations; both shift the layout. The operator asked for a fixed, universal row set where "a
> user knows where he's at at all times", with detail lines that "say more about what's done, what
> was detected", like DocumentDB Local. Eleven check-shaped rows became eight user-shaped ones:
> connection string and preparation are one "Connection settings" row (Kubernetes port forwarding no
> longer gets a row that is skipped for everyone else), and SRV joins DNS.

> **Implemented** (WI-10) in `4bb1580b` and `0d52730a`: `src/connectionDiagnostics/panelRows.ts` projects run
> events onto the eight rows from the planned check list and a `hostPhaseStarted` runner event. The
> view (`ConnectionDiagnostics.tsx`, `formatEvidence.ts`) localizes semantic segments; finding
> segments carry the host-localized title from the exhaustive message table rather than a second
> webview-side table, so the panel still never depends on the package's English detail. Router and
> controller: `connectionDiagnosticsRouter.ts`, `connectionDiagnosticsController.ts`. The result
> card shows the outcome and retry actions; report actions live only in the footer. Its headline, next steps and server line
> come in WI-13. L2-dev scenarios: `build/verification/browser/scenarios.ts`.

> **Implemented** (WI-15, [0037](./decisions.md#0037--the-panel-borrows-the-wizard-chrome-but-has-no-steps)):
> the header uses the same `ContainerHeader` building blocks as the DocumentDB Local and MongoDB Atlas
> wizards: a `NetworkCheckRegular` media icon, the title "Connection Diagnostics", the static subtitle
> "Check a connection step by step and review the results.", and **Give Feedback** when `feedbackPermitted` was true
> at open time (`common.openFeedback`, activation source `connectionDiagnostics`). Content is capped
> at `contentMaxWidth="760px"` like both wizards; the header and the footer span the panel. There is
> no step indicator and no `Wizard`: the panel is one screen, so `ContainerBody` drops its `nav` row.
> The header scrolls with the body, as a wizard header does; the footer stays pinned. The content uses
> the same `ContainerSection` as a wizard step: the connection name is its heading, with the live run
> status below it (static "Checking the connection…", then relative "Checked … ago", "Check cancelled" or
> "Check did not finish"). The list starts at the same offset (197 px in the L2-dev scenarios) in every
> state.

> **Implemented (WI-19)** ([0040](./decisions.md#0040--hide-identifiers-applies-to-the-report-only-and-sharing-a-report-with-identifiers-asks-first)):
> **Show diagnostics** is now **Show report**, in the footer, the result card ("Contacting support?
> Show report opens a report you can review and share.") and the finding text; the report's document
> title and default file name are unchanged. The info line reads "The report will include host and
> identity details. **Hide identifiers in the report**. Review the report before sharing."; with
> hiding on, "The report will replace host and identity details with placeholders. **Show identifiers
> in the report**. Review the report before sharing." The choice applies to the report only: the
> panel always shows full identifiers, and toggling it changes nothing in the panel. With identifiers
> included, **Copy report to clipboard** and **Save report to file…** first call the common tRPC
> procedure `common.confirm` (`{ message, detail?, confirmLabel, severity? }` → `{ confirmed }`,
> `src/webviews/_integration/commonDialogs.ts`), a modal warning: "This report includes host and
> identity details." / "Host names, addresses and the user name are not hidden. To hide them, cancel,
> select Hide identifiers in the report, and then share again.", with **Copy report** or **Save
> report** and VS Code's Cancel. Cancel shares nothing, shows no error and leaves the panel as it
> was; the webview then calls the same report procedure with `shareWarningOutcome: 'cancelled'` only
> to record the outcome (`shareWarning`, `shareWarningOutcome`; result `Canceled`). Show report gets
> no warning, and neither does sharing with identifiers hidden.

#### Prototype: expandable row details (WI-18)

> **Accepted after the UX test** ([0039](./decisions.md#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them)); the section keeps its prototype title for history. It reopens what
> [0027](./decisions.md#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)
> rejected ("collapsible facts tables per row") and the "What the panel never shows" list above, because
> a row could show a warning with no visible reason: on an Azure DocumentDB cluster reached from WSL,
> Server address (DNS) warned while its line said everything resolved, and the cause
> (`dns.privateEndpointPublicAddress`) was only in the report's Findings table.

- **What a row shows when expanded.** Findings first (error, warning, information), each as the
  host-localized title, explanation and next step from `describeFinding`, with the hosts it concerns;
  then evidence, built host-side in `src/connectionDiagnostics/panelDetails.ts` and localized by the view
  (`DiagnosticsRowDetails.tsx`):

  | Row                      | Evidence                                                                                                                                                                      | Offered when          |
  | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
  | Diagnosis setup          | where the checks ran, OS and release, architecture                                                                                                                            | only with findings    |
  | Connection settings      | scheme, hosts, user, password present, authentication method and source, every URI option as name = value; TXT options marked "from DNS"                                      | settled               |
  | Server address (DNS)     | SRV query, listed targets, TXT options, resolver, DNS servers; per host the CNAME chain and addresses (family, public/private), resolvers                                     | settled               |
  | Network connection (TCP) | per host the address and port that connected, and the addresses that did not, each with its connect time                                                                      | settled               |
  | Secure connection (TLS)  | per host protocol ("TLS 1.3"), certificate subject, issuer, expiry, host name match, trusted                                                                                  | settled               |
  | Server greeting (hello)  | lead "answered before sign-in"; per host the command run, server type, replica set and member role, DocumentDB version, API compatibility, password mechanisms offered (0049) | settled               |
  | Authentication           | method, mechanism (configured or negotiated), user or signed-in identity, authentication database, sign-in steps (0049)                                                       | settled with a method |
  | Database access          | commands run and how each ended, ping, databases visible, server version, answering host                                                                                      | settled after sign-in |

  Each per-host section (DNS, TCP, TLS, greeting) ends with "Took …" when the row has two or more
  host sections, and a TCP address gives its connect time ("in 31 ms", "after 3 sec") only when its
  host made two or more attempts (0050, WI-33). The view formats every time with `formatDuration`,
  with no rating.

- **Invariant.** A warning or error row always has details that explain it. With no finding of that
  severity, the host adds a generic "This check did not succeed" or "This check reported a warning"
  line that points to Show diagnostics. Pending and active rows never offer details. Tests:
  `panelDetails.test.ts`, every acceptance case (`acceptance.test.ts`, including live `rows` updates),
  and every L2-dev fixture (`scenarios.test.ts`).
- **Accessibility.** `StatusListItem` gained an optional `disclosure`: a real `<button>` ("Details",
  accessible name "Details for <row>") right after the row label on the label's own line, with
  `aria-expanded`, `aria-controls` and, as its description, the most severe finding ("Warning: Private
  endpoint resolves publicly"). The region is `role="region"`, named by the button, stays mounted but
  `hidden` while collapsed, and is indented under the row's text with a left border. The toggle is
  exactly one label line tall, so collapsed rows keep equal heights. Expanding never moves focus; a
  new run collapses every row, and a toggle that disappears while focused hands focus to the primary
  action (the R5 fallback). No hover-only content.
- **Panel safety and Hide identifiers.** No codes, raw errors, English package details or timings
  (only the database ping, each row's duration, and in Details each host's time and TCP connect
  times, 0050). Secret-bearing and unknown URI options are named with "(hidden)"; the
  package never records their values, and the password is only "present". Each row carries a `full`
  and a `redacted` copy built from the same report results: `redacted` from `redactReport`, so its
  placeholders are the shared report's. During a run, the copy comes from a report of the results so
  far; the finished run's details replace it with the final report's numbering. Evidence lines and
  the result card still show identifiers with Hide identifiers on, as before.
- **Data flow.** The router keeps every `checkFinished` result and sends rows with `details` on
  every `rows`, `cancelled` and `finished` update. Everything above is wired for real.
- **L2-dev routes.** `/connectionDiagnostics/<scenario>/<theme>`: `private-endpoint-public`
  (the reported case), `private-endpoint-identifiers-hidden`, `several-findings`, `dns-failure`,
  `running` and `default`.

> **Implemented (WI-19)** ([0040](./decisions.md#0040--hide-identifiers-applies-to-the-report-only-and-sharing-a-report-with-identifiers-asks-first)):
> the **Details** toggle moved from the title line to the end of the evidence line, inline after its
> text, so row titles are plain headings. `StatusListItem`'s `disclosure` gained a generic
> `placement` (`label`, the default, or `detail`); with `detail`, the toggle is a transparent small
> button in the evidence line's type size (`fontSizeBase200`) and exactly its line height
> (`lineHeightBase200`, 16 px), link-coloured, with a 12 px chevron, so collapsed rows keep one
> height (37 px in the L2-dev scenarios). A long evidence line wraps around it like a word
> (`network-refused` does at any width, so its row-height check leaves that row out); a row with
> details and no evidence text still shows it on the second line. Everything else above is kept: the
> real button, `aria-expanded`, `aria-controls`, the name "Details for <row>", the most severe finding
> as its description, the focus ring, no focus movement, and a new run collapsing every row. The
> panel's details now carry one copy, always with full identifiers; the `redacted` copy and the
> host-side `redactReport` call that built it are gone, and Hide identifiers applies to the report
> only. The L2-dev route `private-endpoint-identifiers-hidden` became
> `private-endpoint-report-identifiers-hidden` (and `identifiers-hidden` became
> `report-identifiers-hidden`): the panel shows full identifiers while the info line says the report
> hides them. L2-dev also asserts that each toggle sits on its own row under the row title, and that
> the Hide identifiers link changes no panel text.

> **Implemented (WI-23):** row Details use Fluent's default `Collapse` motion from
> `@fluentui/react-motion-components-preview`, now a peer of the shared Fluent UI package alongside
> its other Fluent peers. The labelled region stays mounted for `aria-controls`; its contents animate
> inside it, become `inert` immediately on collapse, and unmount after exit. The empty region takes no
> space, so collapsed row heights are unchanged, and toggling never moves focus. Fluent honours
> `prefers-reduced-motion`. The `Collapse` stays mounted before expansion so the first toggle animates;
> a new run still collapses all rows instantly by removing their disclosures as they reset to pending.

> **Implemented (WI-20)** ([0041](./decisions.md#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)):
> panel text never names a DNS library. Server address (DNS) details show one "Addresses" line when the
> system lookup and a direct DNS query agree, and "Your system's lookup" and "Direct DNS query" only
> when they differ or one fails (`dnsHost` now carries `direct`/`directFailed`). The SRV block drops
> "Answered by" and says "Lookup: Read with the extension's DNS workaround" only when the fallback
> ran. `dns.resolversDisagree`, `env.caresRejectsCompressedSrv` and `srv.compressedReplyRejected`
> have plain panel wording; the report's Findings table keeps their technical cause through
> `describeFindingForReport`. `panelResolverWording.test.ts` and the L2-dev forbidden-text list
> enforce it. The section subtitle reads "Diagnosis cancelled" and "Diagnosis did not finish".

> **Implemented (WI-22)** ([0043](./decisions.md#0043--the-panel-shows-each-step-for-at-least-about-300-ms)):
> the webview paces how rows settle; the host, runner, report and telemetry keep the real timings.
> `usePacedRunEvents.ts` (`RunEventPacer`) splits each host update so every frame settles at most one
> row, in row order, and shows each settled row, then the result card, no earlier than a minimum drawn
> uniformly from 300 to 500 ms (400 ms ± 100 ms, amended in WI-24) after the previous one (the first after the run started). A slower step
> gets no delay and there is no total cap. "Checking…" shows as soon as its turn comes; a settled row
> never goes back to checking. Announcements, `announcedRows` and the report actions follow the paced
> view; Cancel stays until the card appears (WI-24 removes the running counter). Cancel shows
> what already arrived at once and cancels (or, if the run had already finished, shows its result and
> sends no cancel); Re-run, a new run and unmount drop queued updates and timers. The configuration's
> `stepPacing` is never set by the extension; the view's jsdom tests and the static L2-dev fixtures set
> it to zero, and the L2-dev route `paced-run` asserts the order and timing (`sequence`). Rows carry
> `data-status` for that assertion.

> **Implemented (WI-24)** (0044–0045): each panel has one live Markdown report. Show report
> updates/reveals it; a closed preview reopens under the same neutral panel-counter title with a
> fresh URI. Hide identifiers calls `setReportIdentifiers` with the current run ID and immediately
> re-renders and reveals the same open document, without opening a new tab (and does nothing when none is open). The provider fires `onDidChange`
> and retains source text until its last source/preview tab closes (R11). During Re-run the old
> report stays readable and toggles still apply; completion replaces it in place, without focus.
> Titles are `Connection diagnostics.md`, `Connection diagnostics (2).md`, etc., never connection
> names; the name is in the redaction-aware body instead. Copy/Save and their warning are unchanged.
> `reportRedacted` and `reportLiveRefresh` describe toggle refreshes without identifiers. Actual
> Markdown preview refresh still needs real VS Code verification, beyond provider event unit tests.
>
> The running subtitle is static “Checking the connection…”. Completion uses IndexList's relative
> phrasing: “Checked a few seconds ago” (<30 s), “Checked less than a minute ago” (<60 s), then
> singular/plural minutes. A self-rescheduling timeout runs only at the next threshold; there is no
> 1 s interval or elapsed announcement. Cancelled/failed status text is unchanged. The report keeps
> real timings; panel pacing is now 400 ms ± 100 ms per settled row and card (300–500 ms uniform).

Open questions for the UX test: whether healthy rows should offer details at all (today six of eight
do), whether the toggle should look different on a warning or error row, whether a warning row should
start expanded, whether the evidence line should name the warning's cause, whether evidence lines and
the card should honour Hide identifiers too, how much per-host detail a three-host cluster should
show, and whether any timing (for example TCP connect time) is essential. The last is answered by
[0050](./decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer):
every row that ran shows its duration, and Details give each host's time and each TCP address's
connect time where they inform (WI-31, WI-33). A Copy summary share item was built and reverted
(WI-32).

#### Why there is no dynamic row set

Every case that seemed to need rows added at run time is covered by a fixed row plus its evidence
line and the report:

| Candidate                                                              | Why a fixed row is enough                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One row per host (replica sets, SRV)                                   | The host count is only known after DNS, so rows would appear mid-run. "2 of 3 hosts reachable · host-b refused" says what matters; the report has every host |
| Entra ID phases                                                        | Rejected in 0027: the evidence line and the card say what was detected and who fixes it                                                                      |
| Provider-specific steps (Kubernetes port forwarding, future providers) | Part of Connection settings; the evidence line names the provider's result                                                                                   |
| Checks added in a later release (private endpoint inspection)          | Added as a fixed row, or as evidence on an existing row, in that release; never decided at run time                                                          |
| A step that does not apply                                             | `skipped` with its reason, which tells the user something true                                                                                               |

A dynamic list would only be needed if the set of things checked varied per connection in a way a
user must see as separate steps. Nothing in this plan does.

### 5.3 Credentials

Credentials come from the same place a connect would take them (the stored connection, or the
credentials cached for the `clusterId` in this session), are held for the run only and dropped
afterwards. Connection diagnosis never prompts
([0013](./decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped),
[0016](./decisions.md#0016--unavailable-authentication-inputs-mean-an-explained-skip)).

> **Deviation** ([0035](./decisions.md#0035--azure-vm-targets-keep-the-existing-port-prompt-when-the-troubleshooter-reads-credentials)):
> Azure VM nodes keep their existing port prompt when connection diagnosis reads their connection details;
> credentials and sign-in are still never prompted. Proposed, awaiting operator confirmation.

> **Implemented** (WI-16,
> [0036](./decisions.md#0036--the-troubleshooter-reads-connection-details-silently-and-prepares-kubernetes-tunnels-only-in-prepare)):
> connection details are read without any UI on every other node type, including Kubernetes discovery
> (0035's statement that it starts no tunnel was wrong; it now does not). The Azure VM port prompt is
> the only prompt left: it is dismissed by Cancel, the whole-run timeout or closing the panel, a port
> entered earlier in the session is reused without asking, and closing it reports cancelled input
> (**Connection not tested**). A connection details source that cannot be read (Azure sign-in, access,
> network; the Kubernetes API; an Atlas cluster that is not available) is a typed finding on the
> Connection settings row, never a separate notification.

## 6. Report

### 6.1 One snapshot, three ways to see it ([0022](./decisions.md#0022--show-diagnostics-opens-the-report-read-only-runs-leave-an-output-channel-trace))

A completed run produces one immutable, secret-excluded snapshot. Every output renders that
snapshot; none of them reconnects, requests a token, reads a credential or runs a probe.

- **Show report** (called Show diagnostics until WI-19) opens the report as Markdown in VS Code's built-in Markdown preview, backed by
  a read-only virtual `.md` document whose source the user can also open, select and copy. Extend
  [`readOnlyJsonDocumentProvider`](../../../../src/utils/readOnlyJsonDocumentProvider.ts) with a
  Markdown method that shares its content, URI and release machinery under a Markdown file name
  and language; the JSON path and its callers (Query Insights, the cluster dashboard) stay unchanged.
- **Share report → Copy report to clipboard** copies the same Markdown.
- **Share report → Save report to file…** saves Markdown by default, with JSON as the alternative format for tools.

**Implemented (WI-24, 0044):** each panel owns one live report document. Show report reuses and
reveals it, or reopens it after its last tab closed. The identifier toggle re-renders an
open report in place without revealing it or taking focus, and never opens one by itself. During Re-run the old report remains readable; completion
replaces it in place using the latest identifier setting, without taking focus. Its neutral title
uses only a panel counter, never the connection name; the body includes the redaction-aware name. Content is released when no tab shows it any more (the
preview or its source), not when VS Code closes the source text model, which can happen while the
preview stays open. No history of reports is kept.

> **Changed:** the earlier pass opened JSON, like Query Insights' "View Raw Explain Output". The
> operator asked for Markdown so people can read it. JSON stays available through Save for tools.
> The dashboard's "Cluster diagnostics" re-queries the server on click; this report deliberately
> does not, so what the user shares is what they saw.

An "Open an issue" action that prefills a GitHub issue from the same Markdown is later work (9).

> **Implemented** (WI-07b) in `1f9512f1`: `readOnlyJsonDocumentProvider.openMarkdownDocument` opens the
> Markdown preview of a read-only `.md` virtual document (falling back to the text editor) and shares the
> JSON path's content and release machinery.

### 6.2 What the Markdown contains

The report leads with the answer, then the evidence support needs: headings, short sentences, tables
and small code blocks, never one fenced JSON dump. Prose is localized through the extension's message
table; check IDs, finding codes, error codes and units stay stable beside it, so support can read a
report in any language.

| Section                  | Content                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary                  | Connected, failed or not tested; the headline finding and next step; the server line from 4.13; when and where the run happened; run ID; extension and VS Code versions                                                                                                                                                                                         |
| Next steps               | Present on failure: the next step, provider hint, and what to share with support                                                                                                                                                                                                                                                                                |
| Coverage and limits      | Selected timeout profile; configured and effective timeouts and their sources; skipped or timed-out checks with reasons; retry options and connection-timeout caveat; omitted targets; the non-interactive sign-in limitation when it applies; which values are observed, unavailable or unverified hints                                                       |
| Environment              | Everything in 4.1, including the Entra ID sign-in environment and remote kind                                                                                                                                                                                                                                                                                   |
| Connection configuration | Scheme, seed hosts and ports, database, chosen method; each effective non-secret option with its origin; TLS, CA and client-certificate presence and verification policy; timeouts and SRV fallback mode                                                                                                                                                        |
| Preparation              | Provider, outcome, duration                                                                                                                                                                                                                                                                                                                                     |
| Name resolution          | SRV/TXT outcome and resolution path; per host: OS and c-ares addresses, CNAME chain, private-endpoint evidence; supplied, advertised, probed and omitted targets kept apart                                                                                                                                                                                     |
| Transport                | Per address: TCP outcome, code and latency. Per host: TLS outcome, protocol, cipher, certificate subject, SANs, issuer chain, validity and fingerprint; verification and inspection-only results labelled separately                                                                                                                                            |
| Wire protocol            | Handshake used, round trip, topology facts (DocumentDB gateway or MongoDB topology), wire versions, advertised members, compressors offered and accepted, server time and clock offset with its uncertainty                                                                                                                                                     |
| Authentication           | Method; for Entra ID the three phases with timings, cloud and resource decision, token claim summary, classifier rule and AADSTS code; the driver result; "Earlier in this session" when 4.9.1 applies                                                                                                                                                          |
| Server and access        | Each post-connect command with its outcome and duration; server, engine and API versions; topology; reported roles; database count; ping round trip                                                                                                                                                                                                             |
| Findings                 | Retained findings in order, at most 32 per check or phase, with omission counts: code, severity, localized explanation and next step, sanitized error code and name. JSON also preserves the convenience English `detail` object and its language tag; Markdown uses the extension's localized message table                                                    |
| Timings                  | One table: every check and retained phase with status and duration; a notice explains omitted phases                                                                                                                                                                                                                                                            |
| Trace                    | The run ID, and a note that the Output channel lines for this run carry it (6.4)                                                                                                                                                                                                                                                                                |
| About this report        | Closing attribution to the DocumentDB extension for Visual Studio Code and a link to its Visual Studio Marketplace listing. An About-style summary includes extension version/channel, VS Code, Node.js and OS even when environment checks were skipped; discovery and migration plug-in lists are excluded. JSON ends with equivalent `generatedBy` metadata. |

Server replies pass through field allowlists; raw command documents, driver monitoring events and
the dashboard's metadata map are never embedded. Each text field is limited to 8 KiB and each
repeated evidence list to 32 entries, with a count of what was omitted; sanitization happens before
text truncation. Structural steps, findings (both per check and per step) and summary server rows
remain typed records. Their parents carry optional `omittedStepCount`, `omittedFindingCount` or
`omittedServerRowCount` fields, present only when entries were omitted; arbitrary payload lists
retain their string omission marker. Markdown renders localized omission notices, including when
the headline finding was omitted, without suggesting a timeout retry. JSON retains these additive
fields under `schemaVersion: 1`; the original run is unchanged. All values are escaped as text, so a host name, certificate field or error message
cannot add Markdown headings, links, images, HTML or code fences.

An opening, with illustrative values:

```markdown
# Connection diagnostics

## Summary

**Connected** to c-mycluster.mongocluster.cosmos.azure.com:10260 on Oct 28, 2026, 9:41:00 AM UTC (2026-10-28T09:41:00.000Z).
Checks ran on this computer (Windows 11, x64). Run ID: 3f6c…

| Server             | Value                                 |
| ------------------ | ------------------------------------- |
| DocumentDB engine  | 0.107.0                               |
| API version        | 7.0                                   |
| Topology           | Replica set, 3 members                |
| Ping round trip    | 12 ms                                 |
| Authentication     | Microsoft Entra ID (public cloud)     |
```

**Implemented (WI-26):** every absolute timestamp in Show report, Copy report and saved Markdown
uses the VS Code language (`vscode.env.language`) and the local time zone, with an explicit zone
indicator, followed by UTC ISO 8601 with milliseconds in parentheses
([0046](./decisions.md#0046--report-timestamps-show-local-time-with-a-zone-and-utc-iso)).
The extension injects `ReportText.formatTimestamp(number | Date)` using
`Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long' })`; an invalid language tag
falls back to the default locale. The UI-free package's English default returns ISO only.
This covers run start/finish, environment `localTime`, certificate `validFrom`/`validTo`, wire
`serverTime`, and timestamp fields in nested facts and sub-steps (including `checkedAt` when supplied).
Formatting happens after identifier redaction and before Markdown escaping, so source `\(` and
`\)` render as ordinary parentheses. Timestamp fields are not identifiers and remain unchanged by
Hide identifiers. JSON retains machine-only ISO strings (and any consumer-supplied epoch numbers);
the Output trace is unchanged and contains durations, not absolute timestamps.

Earlier-in-session sign-in evidence retains `ageSeconds`: its snapshot contains only the relative
age, not the original absolute time, so no absolute time is reconstructed or appended. Durations,
clock offsets, uncertainties and relative wording are unchanged. The panel's relative last-checked
subtitle is outside this report-only change.

### 6.3 Secret exclusion and identifier redaction

Two separate mechanisms ([0006](./decisions.md#0006--reports-are-complete-by-default-redaction-is-an-explicit-option)):

- **Secret exclusion** is unconditional and happens when facts are collected. Secrets never enter
  facts, findings, events, logs, the Output channel or any report.
- **Identifier redaction** is controlled by the inline "Hide identifiers in the report" / "Show
  identifiers in the report" link in the footer's info text, applied when a report is rendered. Off
  by default. It applies to the report only; the panel always shows identifiers, and Copy or Save
  with identifiers first asks in a modal warning ([0040](./decisions.md#0040--hide-identifiers-applies-to-the-report-only-and-sharing-a-report-with-identifiers-asks-first)).

| Input                                                                                        | Useful output                                                | Must not enter output                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `******db.example/`                                                                          | Host, user name, password present                            | Password, including its encoded form            |
| `HTTPS_PROXY=******proxy.example:8080`                                                       | Proxy configured, scheme, host, port, authentication present | Proxy password or the raw URL containing it     |
| URI option `tlsCertificateKeyFilePassword=…`, `proxyPassword`, a token-bearing auth property | Option or property name, value supplied (yes/no)             | The value                                       |
| Unknown URI option                                                                           | Name and the closest supported spelling                      | Its value, which might be a secret              |
| Parser or driver error that repeats input                                                    | Error code and name, sanitized text                          | Repeated credentials or sensitive option values |
| Entra ID access token                                                                        | The claim summary in 4.9.3                                   | The token, its signature, other claim values    |

Facts are built from known non-secret fields, never by spreading an input, options, environment or
error object. Option keys are classified case-insensitively and encoded values are covered. Proxy
settings are parsed into safe fields; if parsing fails, the report says so without echoing the raw
value. Scheme-less proxy endpoints are parsed as HTTP; only HTTP, HTTPS and the SOCKS variants
are accepted, with a non-empty host. `proxy.host` classifies the nested
`proxy.variables[].host` fact for identifier redaction. Public certificate details are facts; private keys never are. Text that cannot be made safe is
omitted with a reason, keeping its error code and classification.
English convenience details follow these same rules: build them from safe templates and
allowlisted data, never raw exception text or the connection string. Identifier redaction also
applies to detail text in JSON; its language tag does not exempt it from sanitization.

Redaction replaces, with stable placeholders consistent across one report (`host-1`, `user-1`,
`tenant-1`, …): connection display name, host names and addresses, user and account names, tenant
IDs, managed identity client IDs, custom cloud endpoints (`ossrdbmsEndpoint`, Resource Manager
endpoint, hostname suffix), proxy hosts, replica set and member names, certificate subjects and SANs,
database names, custom role names, and Kubernetes context, service and namespace names from preparation
or context hints (structured `providerIdentifiers`). Kubeconfig contexts use the `kubeContext` kind
and `context-1` placeholders, including contexts containing account or cluster identifiers such as
EKS ARNs. Ports are not identifiers. The Host annotation contains no identifiers. Redaction keeps
cloud categories, well-known resources, public CA names, versions, timings, codes, classifier rule IDs
and match results. It applies to Show diagnostics, Copy and Save alike. New preparation facts follow
the existing trace/telemetry boundary: neither surface copies facts.

> **Changed:** the draft redacted hosts and user names only. Authentication and server facts add
> tenant, account, client ID, custom cloud and role identifiers, and a toggle that misses them
> would mislead the user about what they share.

> **Implemented** (WI-05, package part) in `9caf5864` and `7321428a`: `src/report/buildReport.ts`,
> `sanitize.ts`, `redact.ts`, `renderJson.ts`, `renderMarkdown.ts` and `text.ts`. Redaction classifies
> identifiers by fact key (consumers add keys) and then substitutes them in every string, including
> English details and consumer prose. The Markdown renderer takes a consumer `ReportText` table for all
> prose; the extension's localized table, Show diagnostics, Copy and Save come in WI-07b and WI-10a.

### 6.4 Output channel trace

Each run writes a short trace to the extension's existing output channel, in the style of #1050's
`[Authentication]` lines: one `[Connection diagnosis] run=<runId> started` line with the entry point,
one line per finished check and phase (ID, status, duration, finding codes), and one `finished`
or `cancelled` line with the outcome. The `[Authentication]` lines the handlers already write join
it through `startup=<runId> surface=connectionDiagnostics` (4.9.4).

The diagnosis trace lines hold only IDs, statuses, codes, durations and allowlisted
categories: never host names, addresses, user names, tenant or account IDs, facts or error text.
(The existing `[Authentication]` lines follow #1050's rules; they list the OIDC allowed host
patterns, which can include a custom suffix.) The toggle does not apply to the channel.

This covers the user who closed the panel without saving a report: support can ask for the Output
channel and match it by run ID.

> **Implemented** (WI-08a) in `a5a47fe0`: `src/connectionDiagnostics/outputTrace.ts`. Targets appear as a 1-based
> index, never a host name.

## 7. Telemetry ([0020](./decisions.md#0020--collect-usage-and-diagnostic-telemetry-through-existing-helpers))

Collect **usage as well as outcomes**: where users find connection diagnosis, whether they re-run it,
where they cancel, how often authentication is skipped, what prevents connecting, and whether they
open, copy or save diagnostics. One run lifecycle and the existing command/RPC events, not an event
per host, row, sub-step or progress update.

> **Implemented** (WI-08a, WI-10) in `a5a47fe0` and `0d52730a`: `src/connectionDiagnostics/telemetry.ts` and
> `runConnectionDiagnostics.ts` (runStarted, the run scope with masking), router report-action and cancel events.

### 7.1 Ownership and prior art

The package has no telemetry backend; its results and `onEvent` callback are mapped by the
extension. Follow these patterns:

- [`@documentdb-js/srv-resolver` reports](../../../../packages/documentdb-js-srv-resolver/src/report.ts)
  separate local diagnostic data from sendable fields;
  [`applySrvResolutionReport`](../../../../src/documentdb/srv/srvResolutionTelemetry.ts) maps
  categories and measurements without hosts or addresses.
- [`publicProcedureWithTelemetry`](../../../../src/webviews/_integration/trpc.ts) and its
  `ctx.actionContext` for user actions, through the
  [`@microsoft/vscode-ext-webview` telemetry middleware](../../../../packages/vscode-ext-webview/src/host/middleware/telemetry.ts).
- [Quick Start wizard telemetry](../../../../src/webviews/documentdb/localQuickStart/wizardTelemetry.ts)
  for a random panel-session ID and action counts;
  [command correlation helpers](../../../../src/utils/commandTelemetry.ts) to preserve an existing
  journey.

Use `callWithTelemetryAndErrorHandling` and the existing reporter and enablement controls. Never use
`suppressIfSuccessful` for these events: successful opens, runs and exports measure adoption.

### 7.2 Events

Event names are logical; the framework adds the extension's namespace.

| Action                             | Instrumentation                                                     | Fields / question                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open or focus the panel            | Enrich the diagnose command's existing event                        | `entryPoint` (`errorNode`, `contextMenu`, `commandPalette`), `sourceView`, `panelAction` (`created`, `focused`): where is it found and reused?                                                                                                                        |
| Start a run                        | `diagnoseConnection.runStarted` when the host accepts a run         | `runTrigger` (`initial`, `rerun`), `runIndex`, `timeoutProfile` (`default`, `longer`, `noDiagnosticTimeouts`): how many runs start, including explicit timeout retries and those that never finish                                                                    |
| Finish, cancel or fail a run       | One `diagnoseConnection.run` scope around the runner promise        | outcome, check counts, auth skip reason, cancel reason and active checks: what happened and where did users stop?                                                                                                                                                     |
| Show report, copy or save a report | Enrich the `showDiagnostics`, `copyReport`, `saveReport` RPC events | `reportFormat` (`markdown`, `json`), `reportRedacted`, result; on Copy and Save also `shareWarning` (`shown`, `notShown`) and `shareWarningOutcome` (`continued`, `cancelled`; a cancel is `Canceled`, not `Failed`): which outputs are used? Never content or a path |
| Request cancellation               | The cancel RPC's event                                              | Separate from the run's terminal result, so a cancelled run is not counted twice                                                                                                                                                                                      |

A random `diagnosticsSessionId` per panel and a fresh `diagnosticsRunCorrelationId` per run
(the run ID used in 6.4) are carried through the command, run and report actions. The IDs present
when Diagnose is invoked are carried on the command and snapshotted for each later `runStarted`/`run` event:
`journeyCorrelationId` (discovery lineage), `connectionCorrelationId` (the connected extension
client, if any) and `failedStartupCorrelationId`, the `startupCorrelationId` of the cluster's last
failed `connect.startup`. `ClustersClient` keeps that last failed startup per cluster until a
startup succeeds, and the next `connect.startup` carries it as `previousFailedStartupCorrelationId`,
so failed connect → diagnosis → retry is one join. Focusing an existing panel replaces the target,
entry point and correlation IDs for subsequent runs while preserving the panel's session ID.
An active run keeps its original snapshot, including its report name. This replaces the
first-opening-only linkage, following the operator's 2026-11-06 approval of C4's second assessment
in [iteration 06](./iterations/06-copilot-review.md#second-assessment---c4). No ID is
derived from a host, connection name, `clusterId` or `treeId`.

The run scope measures the runner, not subscription setup. On cancel it closes promptly with a
bounded `cancelReason` (`cancelButton`, `panelClosed`, `rerun`, `subscriptionClosed`) and the active
check IDs; late completions send nothing.

### 7.3 Outcome and field rules

- The wrapper's result is about connection diagnosis, not the connection: a run that correctly finds a
  refused connection is `result=Succeeded`, `connectionOutcome=failed`. `connectionOutcome` is
  `connected`, `failed` or `notTested`. Cancellation uses the framework's cancelled result and has no
  outcome; telemetry must not turn a `UserCancelledError` into a successful return.
- **Properties:** the IDs and usage fields above, `authMethod`, `authSkipReason`, platform, remote
  kind, first blocking check and phase, and deduplicated known finding codes. When the connection
  details cannot be read (`resolveTarget` fails), `targetSource` (`savedConnection`, `azure`,
  `kubernetes`, `atlas`, `other`), `targetFailureReason` (`signInRequired`, `accessDenied`,
  `unreachable`, `notConnectable`, `notProvided`, `pending`, `other`) and `targetHttpStatus`
  (100–599); each is `none` otherwise. For Entra ID, reuse
  #1050's allowlisted fields: passing the run's properties as `AuthTraceContext.startupProperties`
  fills `cloudCategory`, `tokenResourceReason`, `configuredCloud`, `hostCloud` and `entraFailureKind`
  (`recordCloudResolution` in [authTrace.ts](../../../../src/utils/authTrace.ts)); add the classifier
  rule ID and AADSTS code as `entraSignIn.classified` does.
- **No property name contains `error` or `exception`.** Whole-error masking (7.4) replaces every
  such property with `redacted:action`, whatever its value, so a bounded category under such a name
  is never received. `entraFailureKind` was `errorKind` until 2026-11-06, and was redacted on
  `connect.startup`, `worker.startup` and this feature's `run` until then.
- **Measurements:** run index, host count, counts per status, and per-check aggregates such as
  `dnsFailCount` and `dnsMaxDurationMs`. The wrapper already measures the total duration.
- **Bounded schema:** field names come from check and action IDs, never from URI options, server
  replies or role names. Finding codes are allowlisted. Never send the report, facts, finding data,
  token claim summary, English convenience detail or per-host results.
- An action succeeds only when it finished: a dismissed save dialog is cancellation. The shared
  RPC telemetry runner records a procedure that throws `UserCancelledError` as `Canceled`, without
  error fields.

### 7.4 Masking

Reuse the existing protection:

1. `context.telemetry.maskEntireErrorMessage = true` on every connection diagnosis command, run and
   report-action context before sensitive parsing or I/O, as
   [`prepareDriverConnectionString`](../../../../src/documentdb/srv/prepareDriverConnectionString.ts)
   and [`ClustersClient`](../../../../src/documentdb/ClustersClient.ts) do. Classifications go into
   `findingCodes`/`failureCode`, not raw errors. (Whole-error masking also masks fields whose names
   contain `error` or `exception`.)
2. [`maskSensitiveValuesInTelemetry`](../../../../src/documentdb/utils/connectionStringHelpers.ts)
   when a parsed connection string is available.
3. `context.valuesToMask` for other sensitive values as they are read: tokens, proxy credentials,
   sensitive options.
4. Every independently created context, including outer RPC and command contexts that could see an
   error from an inner run.

Telemetry never contains host names, addresses, user names, tenant or account IDs, role names,
connection strings, proxy URLs, certificates or report content, whatever the report's redaction
setting. Follow the
[telemetry-instrumentation](../../../../.github/skills/telemetry-instrumentation/SKILL.md) skill.

## 8. Testing

Unit and offline integration tests contact no real auth endpoint, external DNS or telemetry
backend. Existing `TDD:` contracts are respected.

| Layer                               | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runner                              | Required versus ordering-only dependencies; `notApplicable` satisfies a dependency; duplicate, unknown and forward dependencies rejected; result order stable when hosts finish in reverse or reach different phases concurrently; a check's `steps` appear in its result and the report, and emit no event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Timeouts, safety limits and cleanup | Fake clock at every configured and effective timeout in 3.2 and one unit over; default DNS and hello still pending at 5 s and not timed out before 10 s; shorter explicit connection timeout wins; started timeout is `check.timeout`, unstarted whole-run timeout is `skipped/runTimeoutExceeded`, dependent skip names its prerequisite; invalid overrides rejected; doubled and null profiles, fresh run IDs and unchanged saved settings; target, address, chain and 1 MiB limits still apply with no diagnostic timeouts; omission counts; late completion after timeout, cancel, close or re-run cannot emit, duplicate a result or leak a socket or client                                                                                                                                                              |
| Connection string, SRV, DNS         | Shared encoding fixtures through both consumers; URI/TXT/handler option precedence; compressed SRV with fallback on, off and failing; invalid TXT options and domains; OS versus c-ares disagreement; CNAME and private-zone evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TCP and TLS                         | Closed port, socket that never answers, refused, reset, unreachable; IPv6 fails while IPv4 succeeds; SNI kept when connecting by address; effective CA, client certificate and exception options match the real connection; generated self-signed, expired, future, wrong-name and private-CA certificates (no key material committed); a server that closes before sending a certificate; inspection never overrides verification                                                                                                                                                                                                                                                                                                                                                                                             |
| Wire                                | Loopback responders for OP_QUERY/OP_REPLY and OP_MSG; fragmented and coalesced frames; wrong `responseTo`; truncated, malformed and oversized replies; a denied handshake does not suppress the driver attempt; a DocumentDB-gateway reply (`isdbgrid` with `internal.documentdb_versions`) is classified as DocumentDB gateway, a replica set reply as a replica set                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Compression                         | `compressors` offered in the handshake exactly as the driver would; `snappy,zlib` with a server accepting both raises `hello.compressorUnavailable`, `zlib,snappy` does not; a server accepting none, and a DocumentDB-gateway reply without `compression`, leave only the `cs.compressorUnavailable` warning; `availableCompressors` reflects what can actually be loaded                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Clock offset                        | Offset and uncertainty from injected clocks and round trips; smallest-uncertainty host wins; threshold boundary at five minutes beyond uncertainty; missing or malformed `localTime` leaves it unavailable; the finding never fails a row and appears as evidence beside `tls.notYetValid`, `tls.expired` and Entra ID `auth.failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Preparation                         | Observer reports no provider, success and failure; existing callers and the original error unchanged; cancellation never closes the shared tunnel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Auth adapter                        | Chosen method and credentials only; no `CredentialCache` writes or cached-client reuse; same effective network options as a real connect; No Authentication tested and not called "authenticated"; ordinary sign-in stays interactive while connection diagnosis calls `getSessionFromVSCode` with `silent` and never `createIfNone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Entra ID and sovereign clouds       | Injected resolver dependencies (pattern of `documentdbTokenResource.test.ts`) for public, US Government, China and custom clouds. Each row of 4.9.1 lands in the documented result: cloud mismatch fails before any token request; invalid override, unreadable custom definition, `customCloudUnresolved`, `managedIdentityCloudUnknown` and a host outside the allowlist fail with their `kind`; no silent session skips without calling `recordEntraTokenFailure`; a recent recorded failure appears as "Earlier in this session" and does not change the outcome. Managed identity completes Token during Server authentication. AADSTS65002, the opaque broker error and an OIDC host rejection use the existing classifier. Token success followed by server rejection, or by a network timeout, never claims acceptance |
| Token claim summary                 | Matching, different and not-comparable audiences; known sovereign issuers; tenant match and mismatch; expired; malformed, opaque and oversized tokens give "unavailable"; the token and unlisted claim values are absent everywhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Server facts and summary            | All commands on the same owned client; dashboard version-helper tests keep passing after the move; several engine versions in order; "Server version" label without DocumentDB metadata; `.azure.us` and `.azure.cn` classified with their cloud; cached data never fills a missing fact; a denied command leaves "Connected"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Diagnostics side effects            | `ErrorExplanationService` events carry `source=connectionDiagnostics`; `[Authentication]` lines carry `surface=connectionDiagnostics` and the run ID; run telemetry receives #1050's cloud fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secrets and redaction               | Raw and encoded URI, proxy, option and token secrets absent from facts, findings, events, Output channel, Markdown and JSON with the toggle on and off; every identifier in 6.3 replaced consistently when on; text that cannot be made safe is omitted with a reason; Markdown, HTML, link and fence injection fixtures; truncation markers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Report outputs                      | Markdown sections and tables from 6.2; Show diagnostics, Copy and Save render the same snapshot; Save as JSON carries the same facts; an open document is unchanged by a re-run or toggle; export performs no network I/O, token request or credential read; failed copy, write or preview is reported; a cancelled run produces no report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Output channel                      | A run's lines carry its ID, statuses, codes and durations only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Telemetry                           | Stubbed reporter: entry points, initial versus re-run, started versus finished counts, all three outcomes, skip categories, cancellation without late duplicates, Show/Copy/Save and dismissed dialogs; masking of nested error messages, causes and stacks; telemetry disabled; nothing from the report or token summary sent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Types and messages                  | Exhaustive message table over built-in plus extension codes; README catalogue matches public code unions and documents structured fields; every finding has safe English detail tagged `en`; changing English text does not change localization, branching or telemetry; unknown codes fail explicitly; package `tsconfig.test.json` under `npm run typecheck:tests`; no webview import of host-only helpers                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `StatusList`                        | `skipped` status: glyph, status word read by screen readers, existing consumers unaffected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Webview                             | L2-dev scenarios in dark, light and high-contrast: connected with server line, partial version facts, remote host, DNS failure, TLS warning, each Entra ID outcome in 4.9.2 (evidence line and card), no silent session, listing denied, skipped dependencies, timeout-limited, longer and unbounded retry with warning, cancelled with late events ignored, each result card, identifiers hidden; network failure includes possible firewall guidance, isolated auth rejection does not                                                                                                                                                                                                                                                                                                                                       |
| Panel layout                        | L2-dev scenario assertions: the same 8 rows with the same labels at open, while running, after success, failure, cancel and re-run, settling top to bottom even when host chains reach different phases concurrently; later-row events are buffered without losing actual timings; each row's height does not change between pending and settled at the default panel width; every evidence-line combination in the message table fits the reserved line at that width; the result card renders only below the list and the list's position does not change when it appears                                                                                                                                                                                                                                                    |
| Panel wording                       | For every finding and every 4.9.2 outcome, the panel detail comes from the message table and contains no finding code, AADSTS code, resource URI, rule ID or timing; the same run's report contains them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Installed extension                 | Error-node retry caching and cluster-only menu in all views; Markdown preview renders the read-only virtual `.md` and its source opens; Query Insights and dashboard JSON documents unchanged; closing a document releases its content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 8.1 Acceptance cases

1. A working connection ends **Connected** with the server line, and Show diagnostics, Copy and Save
   produce the same readable Markdown.
2. A dead seed plus a reachable member: **Connected**, the dead seed kept as evidence. If that member
   rejects the credentials instead, the rejection is the headline, not the dead seed.
3. No stored password, or no silent Entra session, with passing probes: **Connection not tested**,
   explained, no prompt, and no claim that sign-in works.
4. A cloud mismatch or a missing custom cloud resource: **Connection failed**, naming the setting,
   although no token was requested.
5. Listing or version metadata denied after connecting: still **Connected**; the denied command is
   named.
6. Probes fail but the driver succeeds: **Connected**. Probes pass but the driver fails: that failure
   is the headline, with the evidence that explains it.
7. Cancel creates no summary and no report; a diagnostic timeout creates a report marked as limited.
   Late work cannot change either.
8. A DNS or `hello` probe that takes seven seconds can pass under defaults. A whole-run timeout
   before authentication says **Connection not tested**, not "server unreachable"; the user can
   retry with longer or no diagnostic timeouts and gets a new report without altering the old one.
9. A blocked or silently dropped connection with non-loopback, mixed or unknown evidence may name a
   firewall or IP allowlist as a possible cause and direct the user to the network of the actual
   extension host, without claiming inspection of cloud firewall rules. When every error finding in
   failed transport checks is explicitly loopback-classified, the guidance instead points to the
   local endpoint and omits the generic firewall hint.
10. Every finding exposes a stable code and `{ language: 'en', text: '...' }` detail in the API;
    the extension's visible wording comes only from its localized code/data message table.
11. A connection string with `compressors=snappy` to a MongoDB server that accepts snappy is flagged
    on **Server greeting (hello)** before sign-in. The real attempt still runs, and the result card explains
    the later Database access failure with the compressor fix ("remove snappy, or put zlib first")
    instead of a raw "Optional module `snappy` not found". The same string against DocumentDB
    connects, with only the Connection settings warning.
12. A DocumentDB cluster's Server greeting reads "DocumentDB gateway", never "replica set" or
    "sharded cluster"; a local clock several minutes off appears as supporting evidence on a
    certificate-validity or Entra ID token failure, and never fails a connection on its own.

### 8.2 Manual validation

Azure DocumentDB (public endpoint, private endpoint, Entra ID, managed identity over Remote-SSH to an
Azure VM), Atlas with an address not on the access list, Kubernetes ClusterIP, a saved local
connection with a stopped or self-signed server, offline, VPN and split DNS, a remote extension host,
and native, No Authentication, Entra ID and managed identity. Confirm the Quick Start instance node
has no menu entry.

Sovereign behaviors testable without sovereign access: cloud mismatch, custom cloud without a
resource, invalid override. Government, China and custom-cloud mocks prove wiring, not live service
acceptance. US Government sign-in (AADSTS65002 and success) cannot be tested until the service-side
preauthorization (sovereign-clouds D1) rolls out; it is verified then with #1050's reporter. The
connection diagnosis does not replace #1050's own release gates (D11).

## 9. Phasing

The first release ships only when both parts are complete, verified and documented
([0026](./decisions.md#0026--one-first-release-later-work-is-named-not-open)).

1. **Foundation (not released on its own).** Package types and runner with timeouts, explicit retry
   profiles, safety limits and recorded phases (`steps`); English convenience details and the package
   README's code/data catalogue;
   shared parsing and network-option helpers; the preparation observer; connection string, SRV, DNS,
   TCP, TLS, `hello` and environment checks; `StatusList` `skipped`; the webview
   and all three entry points; report snapshot, Markdown and JSON renderers, Show diagnostics, Copy,
   Save, the identifier toggle and the Output channel trace; telemetry and masking.
2. **Through the server (completes the first release).** The shared auth factory with the
   non-interactive policy; authentication with the Entra ID phases and token claim summary; owned
   client; connection access and server facts with the shared version helper; context hints with the
   `source` field; the result card; the acceptance cases; a user-manual
   page (opening it, where checks run, why sign-in is never prompted, reading the summary, timeout
   profiles and retry caveats, possible firewall blocking, sharing diagnostics safely, hiding identifiers).

> **Changed:** the draft released phase 1 with a webview that could not answer "can I connect",
> put preparation after the probes that need it, and offered an issue action early. Phase 1 alone
> would show a misleading partial diagnosis, so it does not ship by itself.

**Next iteration:** cloud-platform-specific firewall configuration helpers, building on the
first release's generic possible-firewall guidance. These are not promised as part of this release
and do not imply automatic firewall changes.

**Later, named so they are not mistaken for gaps:** Azure Resource Manager inspection of private
endpoints; a "Diagnose connection" button in the connect-failure message and the new-connection flow (the
connect-failure button also revisits sovereign-clouds D10, text-only messages); the reviewed "Open
an issue" action; `documentdb-cli` adopting the package
([0003](./decisions.md#0003--this-repository-defines-the-package-api-and-its-guidelines-documentdb-cli-adapts-later)).

## 10. Not in scope

A one-hop or recursive topology scan; an "is this machine online" check; interactive sign-in from the
connection diagnosis; RBAC, effective-permission or health audits; storage or collection inventory;
historical failure capture; automatic upload of reports.
