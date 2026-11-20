---
feature: connectivity-troubleshooter
kind: review
status: active
created: 2026-10-29
updated: 2026-10-30
---

# Connectivity troubleshooter: implementation review

- PR: none yet (draft not opened).
- Reviewed on: 2026-10-29.
- Branch: `dev/tnaum/connectivity-troubleshooter`.
- Head: `14ace523989e693b670b7303cf3d3a53251efdba`.
- Base of the reviewed range: `a9bdd089153bd622d60e27ba8c661f786c3e27ea` (the last design-only commit,
  "add compression and clock-offset evidence"). The branch sits on #1050 (sovereign clouds); the
  merge base with `main` is `e15fa6c1`.
- Constraint: no live cluster, Kubernetes context, Azure subscription or remote host was used. Findings
  are established by code reading, the existing test suites and small local probes against the built
  package; none of them is a runtime observation in VS Code.

## Scope

`git diff a9bdd089..HEAD`, excluding `docs/ai-and-plans/**`, `package-lock.json` and
`l10n/bundle.l10n.json`: 177 files, about 30,800 added lines; 112 non-test files, about 13,500 added
lines. Reviewed:

- `packages/documentdb-js-connectivity-troubleshooter/**`: runner, timeouts and safety limits, network
  options, the environment, connection string, SRV, DNS, TCP, TLS and `hello` checks, Node.js I/O
  adapters, report snapshot, sanitization, identifier redaction, Markdown and JSON renderers, README.
- `packages/vscode-ext-webview-fluentui`: the `StatusList` `skipped` status.
- `packages/documentdb-js-srv-resolver`: the exported fallback-eligible error codes.
- `src/troubleshooter/**`: input building, extension checks (extension environment, credentials,
  prepare, authenticate, connection access, server facts, context hints, post-connect commands),
  token claim summary, run orchestration, result derivation, panel row projection, finding messages,
  report text, Output trace, telemetry.
- `src/commands/troubleshootConnection/**` and the `package.json` contributions.
- `src/webviews/documentdb/connectivityTroubleshooter/**`: router, controller, panel session, view
  state, React view and result card, evidence formatting.
- Changed existing code: `src/documentdb/auth/**` (`authConnectionTarget`, `createAuthHandler`,
  `authCallerPolicy`, the four handlers, `documentdbTokenResource`, Entra failure record and provider),
  `ClustersClient.ts`, `ClustersExtension.ts`, `connectionReachabilityService.ts`,
  `connectionDiagnosticsService.ts`, `prepareDriverConnectionString.ts`,
  `readOnlyJsonDocumentProvider.ts`, `clusterVersions.ts` and the dashboard imports,
  `ClusterItemBase.ts`, `DocumentDBClusterItem.ts`, the webview registry and app router.
- `build/verification/browser/**` (scenario fixtures and runner; checked for secrets and realistic
  credentials only).
- Documentation against the code: the feature [README](../README.md), [design](../design.md) and
  [decisions](../decisions.md), the package README and
  [docs/user-manual/diagnose-connection.md](../../../../user-manual/diagnose-connection.md).

Not repeated: the four Milestone B defects fixed in `28daa045` (password fragment as host, early
preparation in credential reads, lost error-node entry point, scheme-less proxy parsing) and the
Milestone C redaction gap fixed in `25cf53bf` (role, database and answering-server identifiers).
Each was rechecked and is fixed at head.

## Method

[CONTRIBUTING section 6.1](../../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor),
Stage 1:

1. **Initial edge-case review (initial pass).** Model: claude-opus-5.5. Read the range above, traced each
   entry point (context menu, error node, Command Palette) through credential resolution, the runner,
   each check, result derivation, the router and the webview, and compared the result with the
   design, decisions and user manual. One read-only helper pass covered the package's network checks
   in parallel; its candidate findings were re-verified here and only the confirmed one is kept (R9).
2. **Copilot PR reviewer comments: pending.** No pull request exists yet, so there are no reviewer
   comments to merge. Run this step after the draft PR is opened and the Copilot review has posted.
3. **Validation gate, 2026-10-29.** Model: **gpt-6.1-sol**, standard context, a different vendor
   from the initial pass. Re-read all R1–R14 against head `14ace523`, including the discovery node
   implementations actually called, their tunnel/UI behavior, ordinary auth, runner timers, report
   rendering and document lifetime. The validation section below supersedes the initial severities
   and qualifications; the original findings above are preserved as review history.
4. **Independent sweep, 2026-10-29.** Model: **gpt-6.1-sol**, same pass. Examined beyond R1–R14:
   seed versus answering-server attribution, connection-timeout enforcement in fresh sockets,
   coverage accounting, run replacement/cancellation, failure fallbacks, secret-exclusion boundaries,
   owned-client cleanup and ordinary-connect compatibility. Additional findings are S1–S5.

Evidence for steps 3 and 4:

- `npx vitest run src/troubleshooter src/webviews/documentdb/connectivityTroubleshooter src/documentdb/auth packages/documentdb-js-connectivity-troubleshooter src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.test.ts src/commands/troubleshootConnection/troubleshootConnection.test.ts src/utils/readOnlyJsonDocumentProvider.test.ts --reporter=dot`:
  **69 files, 1,719 tests passed**. This includes 66 permanent files / 1,669 tests and three
  throwaway harness files / 50 tests (10 new probes plus 40 reused fixture tests), not 1,719 new
  regression cases.
- Ten additional assertions in three throwaway Vitest files exercised R5, R7, R8, R14, S1, S2,
  S4 and S5. All passed after correcting the R14 probe's missing Output-channel dependency by
  mocking only `traceAuthFlow`; the initial probe failure was a harness error, not product evidence.
  The temporary files were removed after verification; no test or implementation changes remain.
- Inline Node.js probes independently confirmed R3's timer race and false connection provenance,
  R4's unclassified Kubernetes identifiers, R9's Node timer overflow, R10's rooted URI, and S3's
  omitted-address and connection-specific TCP-timeout coverage. R8's driver constructor rejects
  empty userinfo; the extension probe establishes that the earlier connection-string check already
  rejects it, before authentication runs.
- R11 additionally traces VS Code **1.115.0** public source, linked in its validation entry, rather
  than assuming that a Markdown preview owns its source text model. No live VS Code reproduction,
  cluster, cloud account, Kubernetes API, or external database was used.
- This is review-only, with no PR and no handover request: **Case 1**, not Case 2. No source was
  changed or committed. No full build/lint/localization/package verification is claimed; the full
  Case 2 checks, including `prettier-fix`, remain due when preparing an actual PR for review.
  Stage 1 step 2 still awaits a PR and its Copilot reviewer comments.

Evidence gathered in the initial pass:

- `npx vitest run src/troubleshooter src/webviews/documentdb/connectivityTroubleshooter src/documentdb/auth packages/documentdb-js-connectivity-troubleshooter`
  at head: 63 files, 1,615 tests passed. The suite is green; none of the findings below is caught by it.
- `npm run l10n:check` at head: "Localization file is up to date".
- Three throwaway Node.js probes against the built package (`dist/`), kept in the session folder and
  not committed: identifier redaction of a provider explanation (R4), the authentication timeout race
  with a connection-sourced timeout (R3), and fifteen connection-string edge cases (no finding; see
  below). Node's timer overflow behavior was confirmed with `setTimeout(…, 2 ** 31)` (R9).

Examined and not raised: secret handling (allowlisted facts, `sanitizeValue`, the token claim summary
that discards the token, telemetry masking, the Output trace's target indexes); the auth-handler
refactor (the four handlers produce the same connection string and options as before for ordinary
connects; the observer is a no-op without a caller); the reachability observer (provider outcomes and
errors unchanged); wire `hello` framing (length, `responseTo`, opcode, OP_MSG flags and checksum,
1 MiB bound before allocation); connection-string parsing (IPv6 literal, unescaped `@` in a password,
`+srv` with a port, `ssl`/`tls` conflict, upper-case option keys, invalid port, unknown options with
secret values withheld); `dns.lookup` not being abortable and listeners on connected sockets (both
within decision 0017 and cleaned up on socket close); localization (every panel, card, report and
error-node string goes through `l10n.t`; the Output trace and the package's English details are
deliberately not localized).

## Findings

| ID  | Severity | Finding                                                                                                                               | Evidence                                |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| R1  | High     | Kubernetes ClusterIP discovery nodes prompt for a local port and start a port-forward on every run; decision 0035 says the opposite   | Code trace                              |
| R2  | Medium   | Credential resolution runs before the runner: untimed, can show its own UI, and every discovery failure becomes "no longer available" | Code trace                              |
| R3  | Medium   | The 4-second fail-fast selection timeout becomes a "connection-configured" authentication timeout that always wins the race           | Local probe, code trace                 |
| R4  | Medium   | Hide identifiers leaves Kubernetes service and namespace names in the provider explanation                                            | Local probe                             |
| R5  | Medium   | Keyboard focus is lost when Cancel or the card's retry buttons unmount                                                                | Code reading                            |
| R6  | Low      | A Connected card does not mention rows that failed                                                                                    | Code reading, acceptance test 6         |
| R7  | Low      | A preparation provider failure has no finding, so the card has no explanation or next step                                            | Code reading                            |
| R8  | Low      | A stored password without a user name is tested instead of skipped                                                                    | Code reading (driver result unverified) |
| R9  | Low      | Timeouts above 2^31−1 ms fire after about 1 ms                                                                                        | Node.js probe, code reading             |
| R10 | Low      | Save report… defaults to the file-system root                                                                                         | Code reading                            |
| R11 | Low      | Show diagnostics content can be released while its Markdown preview is still open (unverified)                                        | Code reading only                       |
| R12 | Low      | The feature README's implementation status and code map are stale                                                                     | Doc/commit comparison                   |
| R13 | Nit      | A reused panel keeps the first invocation's target and entry point                                                                    | Code reading                            |
| R14 | Nit      | The card can explain an Entra ID token failure twice (unverified)                                                                     | Code reading only                       |

Counts: Critical 0, High 1, Medium 4, Low 7, Nit 2.

### R1. High: Kubernetes ClusterIP discovery prompts and starts a tunnel; decision 0035 says it does not

**Location:** [troubleshootConnection.ts#L76-L77](../../../../../src/commands/troubleshootConnection/troubleshootConnection.ts#L76),
[KubernetesResourceItem.ts#L199-L203](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L199),
[KubernetesResourceItem.ts#L480-L510](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L480),
[decisions.md 0035 (L1148-L1151)](../decisions.md#0035--azure-vm-targets-keep-the-existing-port-prompt-when-the-troubleshooter-reads-credentials),
[design.md §4.3](../design.md#43-prepare-extension) and §5.3,
[diagnose-connection.md#L103](../../../../user-manual/diagnose-connection.md#sign-in-is-never-prompted).

**What happens.** For every node that is not a `DocumentDBClusterItem`, the command's target calls the
node's ordinary `getCredentials()`. `KubernetesResourceItem.getCredentials()` calls
`resolveClusterCredentials(context, { startPortForward: true })`. For a ClusterIP service this calls
`promptForLocalPort`, which always shows an input box, then `PortForwardTunnelManager.startTunnel` and
an information notification "Port-forward tunnel started…". This runs in `resolveTroubleshooterSetup`,
before the runner starts, so it is outside the `prepare` check, its 15-second timeout, its observer and
the report. Every Re-run and every Retry repeats the prompt; with the `autoSelect` local port strategy
the suggested port can differ from the running tunnel's. Dismissing the prompt returns `undefined`,
which the panel reports as "This connection is no longer available" (see R2).

**Why it matters.** "The troubleshooter never prompts" is a core contract (0013, 0016, design §5.3), and
design §4.3 says "only this check prepares the endpoint". Decision 0035 records the single accepted
exception (Azure VM port) on the explicit premise that "Kubernetes discovery does not start a tunnel
there". That premise is wrong for ClusterIP services, so 0035 is awaiting operator confirmation on
incorrect information, and the user manual names Azure VM as the only exception. A tunnel started here
also outlives the run, which the report does not show.

**Evidence.** Code trace from the context-menu entry on a node with contextValue
`treeItem_documentdbcluster;discoveryKubernetesService` through `troubleshootConnection.ts#L77` →
`KubernetesResourceItem.getCredentials` (L202) → `resolveConnectionDetails` `needsPortForward`
(L480-L505). The file is unchanged on this branch, so this is existing behavior the troubleshooter now
reaches. `getCredentialsForCopy()` (L214) already provides a no-prompt, no-tunnel path that a
troubleshooter target could use, leaving the tunnel to the timed `prepare` check through the stored
port-forward metadata.

### R2. Medium: Credential resolution is untimed, can show its own UI, and its failures are mislabelled

**Location:** [runTroubleshooter.ts#L123-L140 and L202-L205](../../../../../src/troubleshooter/runTroubleshooter.ts#L123),
[input.ts#L45-L49](../../../../../src/troubleshooter/input.ts#L45),
[connectivityTroubleshooterRouter.ts#L355-L363](../../../../../src/webviews/documentdb/connectivityTroubleshooter/connectivityTroubleshooterRouter.ts#L355),
[TroubleshooterResultCard.tsx#L191-L196](../../../../../src/webviews/documentdb/connectivityTroubleshooter/TroubleshooterResultCard.tsx#L191),
[DocumentDBResourceItem.ts#L50-L68](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L50),
[VCoreResourceItem.ts#L46-L60](../../../../../src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts#L46).

**What happens.** `target.getCredentials()` is awaited in `abortableSetup` before `runTroubleshooter`
starts, so the 300-second whole-run timeout does not cover it. For discovery and Azure nodes it does
real I/O: Azure Resource Manager (`getClusterInformationFromAzure`), the Kubernetes API (kubeconfig,
service endpoint, credential secrets) or the Atlas cluster model, and it can show UI (R1, the Azure VM
port prompt, Atlas's "not connectable" warning, Kubernetes endpoint warnings). These implementations
wrap their work in `callWithTelemetryAndErrorHandling` without `rethrow`, so an ARM 403, an expired
Azure session or an unreachable Kubernetes API shows an error notification and returns `undefined`.
`resolveTroubleshooterSetup` turns `undefined` into `TroubleshootTargetUnavailableError`, and the card
says "This connection is no longer available." While setup is waiting, all eight rows stay pending.
Cancel abandons the promise but leaves any open input box on screen; answering it later still starts
a tunnel.

**Why it matters.** For discovery-backed connections, failing to obtain the endpoint is itself a
connectivity problem the user came to diagnose, and the panel reports it as a deleted connection
while a separate notification carries the real error. The design's timeout contract (§3.2) and the
"Troubleshooter setup" row imply the run's first work is bounded and visible; this phase is neither.

**Evidence.** Code reading of the call chain above and of `callWithTelemetryAndErrorHandling`
semantics (errors are displayed and swallowed unless `rethrow` is set; the troubleshooter sets
`rethrow` only on its own contexts in `telemetry.ts#L21-L25`). Not reproduced against a live
subscription.

### R3. Medium: The 4-second fail-fast becomes a "connection-configured" timeout that always fires first

**Location:** [authConnectionTarget.ts#L100-L113](../../../../../src/documentdb/auth/authConnectionTarget.ts#L100),
[input.ts#L106-L116](../../../../../src/troubleshooter/input.ts#L106),
[runner.ts#L181-L197 and L343-L366](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/runner.ts#L181),
[runner.ts#L448-L449](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/runner.ts#L448),
[findingMessages.ts#L194-L209](../../../../../src/troubleshooter/findingMessages.ts#L194),
[TroubleshooterResultCard.tsx#L213-L221](../../../../../src/webviews/documentdb/connectivityTroubleshooter/TroubleshooterResultCard.tsx#L213).

**What happens.** For emulator connections and local or private hosts with the TLS exception, the auth
handler adds `serverSelectionTimeoutMS: 4000` (the existing fail-fast policy). `input.ts` passes it as
`connectionTimeouts.authentication`, so the runner's effective authentication timeout is 4,000 ms with
source `connection`. The runner's timer starts when the check starts; the driver's server-selection
timer starts only after `configureAuth`, `prepareDriverConnectionString` and `new MongoClient`. With
equal durations the runner's timer always fires first. A stopped emulator or Local Quick Start
container therefore ends with `check.timeout` (source `connection`) instead of
`auth.serverSelectionTimeout` with the driver's per-server errors (for example `ECONNREFUSED`). The
card then says "A timeout configured on the connection limited this check. Change that connection
setting to allow more time." There is no such user setting. The `check.timeout` next step also
suggests both retry actions and adds the firewall sentence, although `retryWouldHelp` is false for a
connection-sourced timeout, so no retry button is shown.

**Why it matters.** "Local emulator is not running" is one of the most common failures, and the card
gives advice the user cannot follow, hides the per-server evidence the design wants for selection
timeouts (§4.9), and adds firewall advice to a local connection.

**Evidence.** Local probe: a run with `connectionTimeouts: { authentication: 400 }` and a check that
spends 5 ms on setup before a 400 ms driver-style selection wait produced
`{"status":"fail","codes":["check.timeout"],"data":{"operation":"authenticate","timeoutMs":400,"source":"connection"}}`
and `coverage.timedOut[0].source === 'connection'`. The 4,000 ms value and its origin were traced in code.

### R4. Medium: Hide identifiers leaves Kubernetes service and namespace names in the provider explanation

**Location:** [contextHints.ts#L18-L62 and L95-L108](../../../../../src/troubleshooter/checks/contextHints.ts#L18),
[KubernetesDiagnosticsProvider.ts#L63-L91](../../../../../src/plugins/service-kubernetes/KubernetesDiagnosticsProvider.ts#L63),
[redact.ts#L179-L217](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/report/redact.ts#L179),
[result.ts#L223](../../../../../src/troubleshooter/result.ts#L223),
[diagnose-connection.md#L170-L173](../../../../user-manual/diagnose-connection.md#share-diagnostics-safely).

**What happens.** `contextHints` stores the provider's sentence as the free-text fact `explanation`;
`sanitizeExplanation` removes connection strings and passwords but not identifiers. Redaction only
replaces substrings it has collected from classified fields. The Kubernetes provider names the service
and namespace (`"payments-db-svc" in namespace "acme-prod"`), which no classified field contains; the
host is `127.0.0.1`/`localhost`. The same text is also the card's `providerHint` and a report next step.

**Why it matters.** The user manual promises that Hide identifiers replaces identifiers "consistently
across the whole report", and the package README tells consumers that custom prose must use
identifiers collected in structured fields. Service and namespace names are tenant-specific identifiers
that users will share with support believing they were hidden.

**Evidence.** Local probe: `buildReport` + `redactReport` and `renderMarkdown(…, { redact: true })` on a
report with that explanation and a `127.0.0.1:27017` target. The JSON and Markdown kept both names
verbatim; the connection name became `connection-1`.

### R5. Medium: Keyboard focus is lost when Cancel or the card's retry buttons disappear

**Location:** [ConnectivityTroubleshooter.tsx#L292-L301 and L332-L336](../../../../../src/webviews/documentdb/connectivityTroubleshooter/ConnectivityTroubleshooter.tsx#L292),
[TroubleshooterResultCard.tsx#L234-L247](../../../../../src/webviews/documentdb/connectivityTroubleshooter/TroubleshooterResultCard.tsx#L234).

**What happens.** Cancel is rendered only while `running`. Activating it (or the run finishing while it
has focus) unmounts the focused button. "Retry with longer timeouts" and "Retry without diagnostic
timeouts" live in the result card inside `<Collapse … unmountOnExit>`; starting the retry clears
`view.result`, so the focused button unmounts too. Focus falls back to the document body; nothing moves
it to Re-run, the list or the new card.

**Why it matters.** Keyboard and screen-reader users lose their place exactly when they act (WCAG 2.4.3,
focus order). The design asks that "focus does not jump" (§5.2). The live announcements still fire, but
the next Tab starts from the top of the page.

**Evidence.** Code reading; the component tests assert that Cancel disappears
(`ConnectivityTroubleshooter.test.tsx#L300`, `#L326`) but not where focus goes.

### R6. Low: A Connected card does not mention rows that failed

**Location:** [result.ts#L128-L140 and L239](../../../../../src/troubleshooter/result.ts#L128),
[TroubleshooterResultCard.tsx#L147-L158](../../../../../src/webviews/documentdb/connectivityTroubleshooter/TroubleshooterResultCard.tsx#L147).

**What happens.** When authentication passes, the outcome is Connected regardless of failed probe rows
(intended: "the real driver attempt outranks failing probes", acceptance case 6). The card's second line
names only rows with status `warning` (`warningRows`). A replica set with one unreachable seed, or a
non-compressor `ping` failure after sign-in, shows a red row and a green Connected card that says
nothing about it.

**Why it matters.** The user sees a contradiction without an explanation. Saying "1 step failed: Network
connection (TCP)" (or similar) would keep the outcome while explaining the red row. This may be an
intentional simplification; it is not recorded in decisions.md.

**Evidence.** Code reading; acceptance test 6 asserts a failed `tcp` result with outcome `connected`
and does not assert any card text for it.

> **Resolved later (WI-20, 2026-11-02,** [0041](../decisions.md#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)**):**
> a successful card now names every row that ended in a warning or an error, with its most severe
> finding, and its title counts them ("Connection successful, but 1 check failed"). Connected
> precedence is unchanged. L2-dev route `seed-refused-connected` covers it. Commit `f07f2167`.

### R7. Low: A preparation provider failure has no finding, so the card has no explanation

**Location:** [prepare.ts#L51-L57](../../../../../src/troubleshooter/checks/prepare.ts#L51),
[result.ts#L162-L184](../../../../../src/troubleshooter/result.ts#L162).

**What happens.** When `ensureReachable` throws, `prepare` fails with `findings: []`. Authentication, SRV
and DNS are then skipped with `dependencyFailed: prepare`. `deriveResult` follows the skip chain to
`prepare`, sets "Connection failed at Connection settings", but `firstError([prepare])` finds nothing,
so the card has no explanation and no next step. Only a provider hint (today Kubernetes) can fill the
gap. A preparation timeout is not affected (the runner adds `check.timeout`).

**Why it matters.** Design §4.3 says a provider failure "fails this check"; the card contract (§4.13)
expects what was detected and what to do next. A future reachability provider without a diagnostics
provider would yield an empty failure card.

**Evidence.** Code reading of the two locations.

### R8. Low: A stored password without a user name is tested instead of skipped

**Location:** [input.ts#L50-L58 and L68-L75](../../../../../src/troubleshooter/input.ts#L50),
[DocumentDBClusterItem.ts#L127-L131](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts#L127).

**What happens.** `credentialState` is `passwordMissing` only when the password is absent. A native
connection with a password but no user name is `available`, and the troubleshooter authenticates with
an empty user name (`addAuthenticationDataToConnectionString(…, '', password)`). A real connect treats
an empty user name like a missing password and opens the credentials wizard.

**Why it matters.** Decision 0025: skip exactly where a real connect would ask. This case would be
reported as an authentication failure rather than "not tested, connect once first". It is an unusual
stored state, hence Low.

**Evidence.** Code reading. The driver's exact error for `mongodb://:password@host` was not reproduced.

### R9. Low: Timeouts above 2^31−1 ms fire after about 1 ms

**Location:** [timeouts.ts#L62-L75](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/timeouts.ts#L62),
[runner.ts#L76-L83 and L343-L366](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/runner.ts#L76),
[networkOptions.ts#L65-L71](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/networkOptions.ts#L65),
[tcp.ts#L94-L126](../../../../../packages/documentdb-js-connectivity-troubleshooter/src/checks/tcp.ts#L94).

**What happens.** Timeout overrides, `connectionTimeouts` and the URI's `connectTimeoutMS` are validated
as positive finite (safe) integers and passed to `setTimeout`. Node.js clamps values above
2,147,483,647 ms to 1 ms. In the extension the reachable case is a connection string with a very large
`connectTimeoutMS` retried "without diagnostic timeouts": every TCP attempt then times out at once with
`tcp.timeout`, source `connection`.

**Why it matters.** A public package API accepts values that invert their meaning; the README documents
"positive finite milliseconds" without the upper bound.

**Evidence.** `node -e "setTimeout(…, 2 ** 31)"` printed `TimeoutOverflowWarning … Timeout duration was set
to 1` and fired after 6 ms. The validation code was read at the locations above.

### R10. Low: Save report… defaults to the file-system root

**Location:** [connectivityTroubleshooterRouter.ts#L251-L255 and L419-L422](../../../../../src/webviews/documentdb/connectivityTroubleshooter/connectivityTroubleshooterRouter.ts#L251).

**What happens.** `defaultUri: vscode.Uri.file(defaultReportName())` turns the relative name into
`file:///connection-diagnostics-….md`, so the dialog opens at `/` (or the drive root on Windows). Export
Documents uses the workspace root when there is one (`exportDocuments.ts#L183-L190`).

**Why it matters.** Minor friction; on Linux and macOS the root is usually not writable.

**Evidence.** Code reading; `URI.file('connection-diagnostics-x.md')` yields
`file:///connection-diagnostics-x.md`.

### R11. Low: Show diagnostics content can be released while its preview is open (unverified)

**Location:** [readOnlyJsonDocumentProvider.ts#L32-L49 and L79-L81](../../../../../src/utils/readOnlyJsonDocumentProvider.ts#L32).

**What happens.** `openMarkdownDocument` stores the report in an in-memory map and opens
`markdown.showPreview`; there is no text editor. Content is released on `onDidCloseTextDocument`.
VS Code may close a text document that no editor shows, and the preview re-reads its source on refresh
or after a window reload; the provider then returns `''`.

**Why it matters.** A support engineer could see an empty report after a reload or a theme change.
The JSON path is unaffected because it opens a text editor that keeps the document alive.

**Evidence.** Code reading only. Not reproduced in VS Code.

### R12. Low: The feature README's implementation status and code map are stale

**Location:** [README.md#L228](../README.md#implementation-status), [README.md#L268-L271](../README.md#code-map).

**What happens.** WI-14 is "not started" with no commits, but `b6fd6782` (acceptance and wording
tests), `d16bf27c` (L2-dev layout assertions), `5838017f` (user manual), `5498ad71` and `14ace523`
(prettier, l10n, lint) implement it. The code map still says "The existing card presentation remains
unchanged until the next work item", although the card was implemented in `a2a2d3a4`.

**Why it matters.** The README is the maintained account of the feature; the next pass and the human
reviewer start there.

**Evidence.** Comparison of the README with `git log a9bdd089..HEAD`.

### R13. Nit: A reused panel keeps the first invocation's target and entry point

**Location:** [connectivityTroubleshooterController.ts#L28-L32](../../../../../src/webviews/documentdb/connectivityTroubleshooter/connectivityTroubleshooterController.ts#L28).

**What happens.** A second invocation for the same `clusterId` reveals the panel and offers a re-run, but
the router context keeps the first `target` (its display name and node instance) and `entryPoint`.
After a rename the header, title and report name stay old; re-runs started from an error node report
the original entry point in `connectivityTroubleshooter.run`.

**Evidence.** Code reading. Credentials themselves are re-read on each run, so results are current.

### R14. Nit: The card can explain an Entra ID token failure twice (unverified)

**Location:** [result.ts#L223](../../../../../src/troubleshooter/result.ts#L223),
[contextHints.ts#L95-L99](../../../../../src/troubleshooter/checks/contextHints.ts#L95),
[TroubleshooterResultCard.tsx#L90-L145](../../../../../src/webviews/documentdb/connectivityTroubleshooter/TroubleshooterResultCard.tsx#L90).

**What happens.** For a token failure (most likely managed identity), the headline comes from the
troubleshooter's own `tokenFailureMessage` keyed on the rule ID, while `contextHints` passes the same
error to `ConnectionDiagnosticsService`, whose Entra provider returns the `entraErrorRules` explanation
for the same rule. Both are shown: headline plus next step, then `providerHint`.

**Evidence.** Code path only; the wording overlap was not rendered.

## Validation gate (Stage 1 step 3)

**Reviewer:** gpt-6.1-sol · **Head:** `14ace523` · **Date:** 2026-10-29.

The verdict applies to the finding as written, not just its title. **Partially valid** retains the
observed defect but rejects or narrows an assumption. No finding is wholly a false positive; several
causal claims are false. Low/Nit items are not automatic handover blockers. The original summary table
above remains the initial pass's assessment; this table and the entries below are authoritative for
this validation pass.

| ID  | Verdict         | Reassessed severity | Recommended disposition                                   |
| --- | --------------- | ------------------- | --------------------------------------------------------- |
| R1  | Partially valid | High                | Block: silent resolution; preparation owns tunnel startup |
| R2  | Valid           | Medium              | Block: bounded, observable setup with typed failures      |
| R3  | Partially valid | Medium              | Block: let the driver enforce its own selection timeout   |
| R4  | Valid           | Medium              | Block: redact or withhold unclassified provider prose     |
| R5  | Valid           | Medium              | Block: restore focus only when its control disappears     |
| R6  | Partially valid | Low                 | Optional UX improvement; keep Connected precedence        |
| R7  | Valid           | Low                 | Add a safe preparation-failure finding                    |
| R8  | Partially valid | Low                 | Skip incomplete native credentials before URI synthesis   |
| R9  | Valid           | Low                 | Reject timer values above the platform maximum            |
| R10 | Partially valid | Low                 | Choose a meaningful directory for the suggested file      |
| R11 | Valid           | Medium              | Block: preserve the preview's source lifetime             |
| R12 | Valid           | Low                 | Correct maintained status before handover                 |
| R13 | Partially valid | Low                 | Refresh the target; define entry-point attribution        |
| R14 | Valid           | Nit                 | Deduplicate classifier-derived provider advice            |

### R1 — Partially valid; High

**Evidence.** The actual Kubernetes discovery target is `KubernetesResourceItem`, not a stored
`DocumentDBClusterItem`. `troubleshootConnection.ts:73–78` calls its ordinary `getCredentials()`.
`KubernetesResourceItem.ts:199–203` calls `resolveClusterCredentials(..., { startPortForward: true })`;
`:480–517` calls `promptForLocalPort()` and then `startTunnel()` for `needsPortForward` endpoints.
`promptForLocalPort.ts:25–47` always shows an input box after choosing a suggestion. The existing
Kubernetes node suite also passes tests asserting ordinary `getCredentials()` starts a tunnel and
`getCredentialsForCopy()` does not prompt/start one. The call occurs
inside setup, before the runner and timed `prepare` check (`runTroubleshooter.ts:202–205`).
**Decision 0035's statement “Kubernetes discovery does not start a tunnel there” is wrong.**

**Correction to the initial finding.** Every such resolution reaches the prompt and tunnel-start
_path_, but it does not necessarily create a new tunnel or notification: `portForwardTunnel.ts:216–228`
returns `reused` for an existing same-key tunnel, and the notification is only for `started`.
`autoSelect` can choose another available port and create another tunnel. Shared tunnels surviving
cancellation is intentional (§3.3), not itself a leak; the defect is doing this unobserved, before
preparation, and possibly after the panel has already cancelled. Non-ClusterIP nodes need not prompt.

**Solutions.**

- **A — Add a diagnostic-only, side-effect-free resolver, and start/reuse the tunnel only in
  `prepare` (recommended).** Return the endpoint plus port-forward metadata; use an existing suitable
  local port or a documented deterministic choice. Pros: restores one preparation owner, timing and
  reporting, without changing ordinary connect. Cons: requires a deliberate port-selection policy
  and tests for existing tunnels/port conflicts. `getCredentialsForCopy()` is a useful starting point,
  **not** a complete silent API: it still resolves Kubernetes data and can show endpoint warnings;
  the underlying tunnel manager can also show a port-conflict dialog (R2).
- **B — Explicitly accept another prompt exception.** Pros: least implementation work. Cons: leaves
  pre-run side effects and repeated prompts, and does not solve timing/cancellation. Requires a new
  decision correcting 0035's premise and matching design/manual changes; the agent cannot treat the
  existing Proposed Azure VM exception as author approval for Kubernetes.

**Recommendation:** A; resolve before handover. Record the author's endpoint/prompt policy in Stage 2,
then append/correct decision history rather than silently rewriting its rationale.

**Stage 3 (WI-16, option A).** The troubleshoot command no longer calls a node's ordinary
`getCredentials()`; it calls the new `ClusterItemBase.getCredentialsForDiagnostics({ signal })`.
`KubernetesResourceItem`'s version reads the same Kubernetes data without any warning, prompt or tunnel
and returns the localhost endpoint plus port-forward metadata. The local port is that of a tunnel
already forwarding the same service, otherwise the configured strategy's existing suggestion, never an
input box. The timed `prepare` check is the only step that starts or reuses the tunnel, through
`ConnectionReachabilityService` with `{ interactive: false, signal }`: `ensureKubernetesPortForward`
checks the signal before starting, and a non-interactive `startTunnel` never shows the "Use existing"
dialog (an occupied port is the new `LocalPortInUseError`, reported as `prepare.localPortInUse`). A
started or reused tunnel stays open and is reported as `prepare.sharedTunnel` (info; report and Output
trace codes). Ordinary connect is unchanged; the existing tests that ordinary `getCredentials()` starts
a tunnel and `getCredentialsForCopy()` does not still pass. Decision
[0036](../decisions.md#0036--the-troubleshooter-reads-connection-details-silently-and-prepares-kubernetes-tunnels-only-in-prepare)
corrects 0035's Kubernetes premise (0035 carries a "Corrected by" note) and records the port policy as
Proposed. Tests: `KubernetesResourceItem.test.ts` (diagnostic read never prompts or starts a tunnel;
reuses a running tunnel's port; endpoint warnings silent; ordinary read unchanged),
`portForwardTunnel.test.ts` (non-interactive conflict: typed error, no dialog, for another program and
another managed tunnel), `ensureKubernetesPortForward.test.ts` (intent forwarded; no tunnel after abort),
`KubernetesReachabilityProvider.test.ts`, `connectionReachabilityService.test.ts` and
`checks/prepare.test.ts` (shared-tunnel and port-in-use findings; nothing prepared after cancel).

### R2 — Valid; Medium

**Evidence.** `abortableSetup()` (`runTroubleshooter.ts:123–140`) races only user cancellation;
`resolveTroubleshooterSetup()` is awaited at `:202` before the package runner starts its clock.
`input.ts:45–49` maps an absent/empty connection string to `TroubleshootTargetUnavailableError`.
Discovery/Azure `getCredentials()` methods wrap real I/O in their own
`callWithTelemetryAndErrorHandling` scopes without opting into rethrow/suppress-display, e.g.
`DocumentDBResourceItem.ts:50–68` and `VCoreResourceItem.ts:46–60`. Their swallowed errors can therefore
become `undefined`, then the router's `targetUnavailable`, then “no longer available”. Kubernetes
endpoint warnings and Atlas's unavailable-cluster warning are separate UI. The cancellation signal
is not passed to those resolvers or their input boxes. A late successful resolution is ignored by
setup but any side effect it already performed is not rolled back.

Also, moving only tunnel startup into `prepare` is insufficient to guarantee silence:
`ensureKubernetesPortForward.ts` calls `startTunnel()`, whose external-port-conflict path can prompt.
The diagnostic intent must reach that path too. This is separate from making _translation_ providers
show UI: diagnostics providers remain translation-only.

**Solutions.**

- **A — A host-only diagnostic resolver contract with signal/deadline, silent intent and typed
  outcomes (recommended).** Put its work inside an observable setup/preparation phase covered by the
  whole-run clock; distinguish missing target, cancelled input, inaccessible source and missing
  endpoint. Pros: accurate panel/report and no duplicate UI; fixes all sources instead of one node.
  Cons: touches the resolver adapters and runner setup boundary; unabortable I/O must still be
  abandoned safely per 0017, not promised to stop instantly.
- **B — Add only a timeout around current setup and rename the generic failure.** Pros: fast, bounds
  panel waiting. Cons: swallowed root causes stay lost, UI and late side effects remain, and a
  wrapper cannot cancel a prompt it does not own.

**Recommendation:** A, coordinated with R1; block handover on a genuinely silent/bounded setup path.
Do not require retrofitting every SDK with hard cancellation.

**Stage 3 (WI-16, option A).** `abortableSetup()` and the pre-run read are gone. A run-scope check,
`resolveTarget`, reads the target with the check's signal before `connectionString` (which now depends
on it); it shares the Connection settings row, so the eight-row layout is unchanged, and declares no
timeout kind, so the whole-run timeout and Cancel bound it. On either, the read is abandoned (0017); a
late result is discarded before any setup or side effect. Built-in checks see the resolved input through
a context overlay; the package API is unchanged. Each node's diagnostic read runs its existing telemetry
scope with `rethrow` and `suppressDisplay` (helper `readCredentialsForDiagnostics`), so ARM, Kubernetes
and Atlas failures show no notification and arrive typed. Typed outcomes: `target.notFound` (deleted
connection; ARM or Kubernetes 404), `target.inputCancelled`, `target.sourceInaccessible` (source and a
classified reason: sign-in required, access denied, unreachable, not connectable, other) and
`target.endpointMissing` (no connection string, a pending or unreachable Kubernetes address). Findings
keep only the source, reason, an allow-listed error name and an HTTP status; the card uses fixed wording
per outcome; context hints pass the underlying error to `ConnectionDiagnosticsService`.
`TroubleshootTargetUnavailableError` and the card's "This connection is no longer available" are
removed. The Azure VM prompt now receives a cancellation token tied to the run signal; dismissal is
`target.inputCancelled` (card: **Connection not tested**), and a port entered for the VM earlier in the
session is reused silently. Tests: `checks/resolveTarget.test.ts` (each outcome's classification, card
title, outcome and row; nothing done after abort), `runTroubleshooter.test.ts` (read inside the run with
the run signal; a hanging read ends at the 300-second whole-run timeout with fake timers; cancel aborts
the read and a late resolution prepares nothing; typed outcomes skip probes without a failed run),
`src/tree/documentdb/diagnosticCredentialRead.test.ts` (ARM 401/403/404 typed with no error notification
while the ordinary read is unchanged; VM token, dismissal, session port; Atlas), and
`troubleshootConnection.test.ts`.

### R3 — Partially valid; Medium

**Evidence.** `authConnectionTarget.ts:109–110` synthesizes a 4,000 ms policy timeout for emulator/TLS
exception connections; `input.ts:106–125` copies that into `connectionTimeouts.authentication`.
The runner selects it as `source: connection` and arms its timer before invoking the check
(`runner.ts:181–197, 343–372`). The check configures auth and prepares SRV _before_ constructing and
connecting the driver client (`authenticate.ts:398–465`). A 20 ms local probe with 3 ms of setup
returned `check.timeout`, `source: connection`, `retryWouldHelp: false`, rather than the driver's
later selection result. The input suite independently asserts the synthesized 4,000 ms limit.

**Correction.** “Always wins” is too broad: an immediate error can settle first, and equal due timers
are not a universal scheduling guarantee. The defect is the avoidable earlier outer deadline and
wrong provenance on the common selection-timeout path. Firewall advice is an explicitly accepted
_possible_ cause for transport timeouts (§4.13), even if often unhelpful locally; it is not independently
a design violation. The initial text also overstates the absence of user-configurable URI timeouts:
the specific 4-second value here is extension policy, not one the user selected, and changing a URI
selection timeout does not remove that options-layer override.

**Solutions.**

- **A — Do not mirror the driver's own selection timer into an earlier whole-auth timer
  (recommended).** Keep the real driver's existing 4-second policy; leave the diagnostic 45-second
  outer guard for configuration/token/connect work. Derive timeout evidence from the driver error,
  and label an extension policy as policy rather than a user setting. Pros: preserves ordinary
  connect behavior and per-server errors; longer retries cannot pretend to override the driver.
  Cons: provenance/coverage logic must distinguish observed driver limits from diagnostic limits.
- **B — Add an outer grace interval.** Pros: small patch, usually lets the driver return first.
  Cons: arbitrary scheduling-dependent slack; still mislabels the policy and can lose evidence.

**Recommendation:** A; block on the incorrect timeout advice/evidence, not on all firewall wording.

**Stage 3 (option A).** `resolveTroubleshooterSetup()` no longer copies the auth handler's
`serverSelectionTimeoutMS` into `connectionTimeouts.authentication`; the driver still receives and
enforces the 4-second fail-fast through the handler's options, and the runner keeps its 45-second
(or retry-profile) diagnostic guard. `auth.serverSelectionTimeout` now carries `timeoutSource`
(`extensionPolicy` when the handler's options layer set the limit, `connection` for a URI
`serverSelectionTimeoutMS`, otherwise `driverDefault`), and for `extensionPolicy` the card text names
the extension's emulator/local limit and drops "change that connection setting"; firewall wording is
kept. Files: `src/troubleshooter/input.ts`, `src/troubleshooter/checks/authenticate.ts`
(`selectionTimeoutSource` and the finding data), `src/troubleshooter/findingMessages.ts`,
`src/troubleshooter/findingData.ts`; tests in `input.test.ts` (no connection timeout is synthesized),
`checks/authenticate.test.ts` ("R3: labels where the driver selection limit came from…", including
empty `coverage.timedOut`) and `findingMessages.test.ts` ("R3: labels the extension fail-fast…").
Applied by the orchestrator as the review's recommendation; pending author confirmation in Stage 2.

### R4 — Valid; Medium

**Evidence.** `KubernetesDiagnosticsProvider.ts:63–91` interpolates service and namespace.
`contextHints.ts:18–62` removes URI/password material but not infrastructure identifiers. Neither
`troubleshooterIdentifierKeys` nor the package's default classifications supplies these two values;
`redact.ts:130–217` can replace prose only with identifiers it previously collected. An independent
`buildReport`/`redactReport` probe kept `payments-db-svc` and `acme-prod` in `explanation`. This remains
true when the actual endpoint is localhost, so classifying hosts does not fix it. The user manual's
whole-report hiding promise is too strong for the implementation.

**Qualification.** This is an identifier-disclosure problem in a user-requested redacted report, not
a demonstrated password/token leak. The panel is not supposed to be redacted by that report toggle;
its unhidden `providerHint` is not a second toggle bug.

**Solutions.**

- **A — Return/classify provider identifiers structurally and use them consistently in all prose
  (preferred durable solution).** Add service/namespace metadata and suitable classifications before
  redaction, including summary next steps. Pros: keeps the useful explanation and consistent
  placeholders. Cons: expands the translation/report boundary and needs tests for every provider.
- **B — Withhold provider free text from redacted output unless its identifiers are known
  (acceptable first-release fix).** Pros: simple, privacy-safe fallback. Cons: less support context;
  the report should say that a contextual hint was omitted. Do not copy it back via summary next steps.

**Recommendation:** A, or B until A is available; block sharing handover until the hiding promise is
true. Merely adding the service/namespace names to an unclassified fact does not suffice.

**Stage 3 (option A).** A diagnostics provider may now return `{ message, identifiers }`
(`ConnectionExplanation`, identifier kinds `service` and `namespace`) instead of a plain string;
`ConnectionDiagnosis` carries the identifiers through, and every existing caller still reads only
`message`. `KubernetesDiagnosticsProvider` lists the service and namespace it names. The context
hints check stores them as `providerIdentifiers.service` / `.namespace` facts, classified in
`troubleshooterIdentifierKeys`; the package's `IdentifierKind` gains `service` and `namespace`
(placeholders `service-N`, `namespace-N`). Redaction then replaces them in the explanation fact and
in summary next steps that repeat it, with no router change. Known limit, shared with every
identifier: the package substitutes inside prose only values of three or more characters. Files:
package `src/report/types.ts`, `src/report/redact.ts`, `README.md`;
`src/services/connectionDiagnosticsService.ts`,
`src/plugins/service-kubernetes/KubernetesDiagnosticsProvider.ts`,
`src/troubleshooter/checks/contextHints.ts`, `src/troubleshooter/identifierKeys.ts`; docs: design
§6.3, user manual "Share diagnostics safely", `.github/skills/error-translation/SKILL.md`. Tests:
`checks/contextHints.test.ts` ("R4: Hide identifiers replaces provider-named Kubernetes service and
namespace everywhere": redacted JSON and Markdown, explanation and summary next step),
`KubernetesDiagnosticsProvider.test.ts` (identifiers returned), `connectionDiagnosticsService.test.ts`
(identifiers passed through). Applied by the orchestrator as the review's recommendation; pending
author confirmation in Stage 2.

### R5 — Valid; Medium

**Evidence.** `ConnectivityTroubleshooter.tsx:332–336` conditionally removes Cancel; `:292–301` and
`startingState()` remove the result card on retry. There is no focus ref/effect or handler selecting
a surviving destination. Two additional jsdom/React assertions focused the actual Cancel and Retry
buttons, activated them and observed `document.activeElement === document.body` after unmount.
This verifies lost DOM focus, not a particular screen reader or the initial claim that the next Tab
must restart at the top in every browser.

**Solutions.**

- **A — Remember whether focus is inside the disappearing controls and transfer it to the stable
  Re-run button or an appropriate stable run heading (recommended).** Pros: predictable keyboard
  location without stealing focus from someone inspecting the report/list. Cons: handle natural
  completion while Cancel is focused, both retry buttons, and the rerun-offer dismissal too.
- **B — Keep controls mounted and change their state/label.** Pros: can preserve the DOM focus target.
  Cons: risks confusing or disabled focused controls and changes the existing UI contract.

**Recommendation:** A with focused activation and natural-completion tests; block handover for this
keyboard usability regression. Do not move focus on every streamed update.

**Stage 3 (option A).** A per-element `useFocusFallback()` ref in `ConnectivityTroubleshooter.tsx`
moves focus to the footer's Re-run button (now holding `rerunButtonRef`; it is mounted in every
phase) only when the element unmounts while focus is inside it. React detaches refs before it
removes the element, so this covers activation and every other cause. It is attached to Cancel
(activation and a run ending as finished, cancelled or failed), a wrapper that unmounts with the
result card (both retry buttons, before the collapse animation ends), the re-run offer (Dismiss and
its Re-run) and the report-error bar (Dismiss, the same defect class). Each element gets its own ref
because Fluent's merged refs (`MessageBar`) drop React 19 ref cleanups. Streamed updates never
move focus. Files: `src/webviews/documentdb/connectivityTroubleshooter/ConnectivityTroubleshooter.tsx`;
tests in `ConnectivityTroubleshooter.test.tsx`, "focus when a focused control disappears" (Cancel
activated; the run finishing, cancelled or failed with Cancel focused; each retry; offer Dismiss
and Re-run; report-error Dismiss; focus left in place during updates and a card action). The eight
loss cases failed before the fix with focus on `<body>`. Design §5.2 gains one sentence.
Applied by the orchestrator as the review's recommendation; pending author confirmation in Stage 2.

**Re-evaluation after WI-15:** the fix stays valid and unchanged. WI-15 kept one screen
([decision 0037](../decisions.md#0037--the-panel-borrows-the-wizard-chrome-but-has-no-steps)), so no
step navigation or step-change heading focus competes with the fallback. The footer, Re-run and the
four disappearing elements are unchanged, so Re-run is still the right, always-mounted destination. The
only new focus target, the header's Give Feedback, is mounted for the panel's lifetime and never needs
a fallback; a new test checks that runs and re-runs leave focus on it. All R5 tests pass unchanged.

### R6 — Partially valid; Low

**Evidence.** `deriveResult()` treats successful owned authentication as Connected; its
`warningRows` includes only rows whose status is `warning` (`result.ts:128–140, 239`).
`connectedLines()` renders that list, not error rows (`TroubleshooterResultCard.tsx:147–158`). The
acceptance case with a dead seed confirms successful authentication is not overturned by probes.

**Correction.** This is **not an unrecorded behavior/design deviation**: design §4.13 expressly says
to name warning rows, and makes the owned successful connection authoritative. The red rows remain
visible. A different explanatory line is a reasonable UX enhancement, not evidence that Connected is
false. A later failed ping is a distinct reachability observation, not retroactive proof that the
earlier connection never succeeded.

**Solutions.**

- **A — Add “Connected despite …”/failed-probe or later-check context, separately from warnings.**
  Pros: explains the apparent contradiction. Cons: new wording and result fields, and must distinguish
  seed-probe failures from failures after connection.
- **B — Keep the documented result precedence and current concise card (recommended for this
  handover unless the author wants the enhancement).** Pros: no semantic churn. Cons: some users may
  need the visible rows/report to understand a failed non-authoritative check.

**Recommendation:** B or a tracked A; not a blocker and never change Connected to failed merely
because one seed probe failed.

### R7 — Valid; Low

**Evidence.** `prepare.ts:43–57` catches and retains only a safe error name, then returns failure with
no findings. `deriveResult()` follows the failed prerequisite but cannot build a headline from an
empty finding list (`result.ts:162–184`). A local throwing provider produced `outcome: failed`,
`stoppedAtRow: connectionSettings`, and no headline/next step. Existing prepare tests intentionally
assert the empty finding list; that ensures secret exclusion but not a useful explanation.

**Solutions.**

- **A — Add a localized, code-based generic preparation-failure finding with safe provider/error
  categories (recommended).** Pros: always gives a next step, preserves the original error privately
  for optional translation, and never exports raw provider text. Cons: generic advice cannot replace
  a source-specific explanation.
- **B — Make every reachability provider have a diagnostics provider.** Pros: richer contextual help.
  Cons: no guarantee that translation answers, and couples two extensibility interfaces unnecessarily.

**Recommendation:** A, ideally through the safe fallback also needed for S5. Low alone is not a
blocker; do not fix by including raw thrown messages in reports.

### R8 — Partially valid; Low

**Evidence.** `input.ts:50–75` checks only password presence to mark native inputs available, unlike
`DocumentDBClusterItem.ts:127–131`, which prompts when either native field is missing. A probe with a
password and empty user returned `credentialState: available` and a password-only userinfo URI.

**Correction.** The claimed authentication attempt/failure does **not** normally occur: the built-in
`connectionString` check rejects that synthesized URI as `cs.unparseable`, and authentication is
skipped due to its failed prerequisite. The direct driver constructor also rejects empty userinfo
with `MongoParseError`. The actual defect is converting missing credentials into a misleading
_connection-settings_ failure, not testing them against the server.

**Solutions.**

- **A — Classify both missing username and missing password before constructing native userinfo
  (recommended).** Keep the credential-free URI for probes and return an explained input-unavailable
  skip, with wording covering either missing field. Pros: matches ordinary connect's prompt boundary.
  Cons: expands the current `passwordMissing`/missing-input type and localized wording.
- **B — Let URI validation diagnose it.** Pros: no change. Cons: diagnoses an internally synthesized
  URI instead of the user's missing authentication input.

**Recommendation:** A; low-frequency, non-blocking fix. Do not relax URI validation or accept an empty
native username to make the test pass.

### R9 — Valid; Low

**Evidence.** `resolveTimeouts()` and connection-timeout validation (`timeouts.ts:62–75`,
`runner.ts:76–83`) allow positive finite numbers without Node's upper bound. URI `connectTimeoutMS`
accepts safe positive integers (`networkOptions.ts:65–71`) well above that bound and TCP installs them
as timer delays. An inline Node probe for `2 ** 31` reported `_idleTimeout: 1` and
`TimeoutOverflowWarning`. This is not a 24-day reproduction: Node clamps the value immediately.
Correction to the initial validation description: all timeout entry points do not require integers;
the API/design currently permits positive finite milliseconds.

**Solutions.**

- **A — Validate a maximum of 2,147,483,647 ms wherever a timer delay is accepted, and document it
  (recommended).** Pros: simple, explicit, no silent inversion. Cons: narrows currently accepted API
  input and needs a deliberate result for an oversized URI timeout; do not add an unrelated integer
  requirement to an API that permits fractional milliseconds.
- **B — Implement a chunked, abortable deadline timer.** Pros: genuinely supports larger durations.
  Cons: extra complexity for an implausibly long diagnostic run.

**Recommendation:** A; non-blocking hardening, with upper-bound tests for all timer sources.

### R10 — Partially valid; Low

**Evidence.** `saveReport` calls `vscode.Uri.file(defaultReportName())`
(`connectivityTroubleshooterRouter.ts:419–422`). The real `vscode-uri` implementation produced
`file:///connection-diagnostics-x.md` for the relative name. There is no workspace/home directory in
that URI. The native dialog's actual starting directory/fallback was not exercised; “always opens
at the filesystem root” is stronger than the evidence, especially across desktop/remote providers.

**Solutions.**

- **A — Join the name to an appropriate workspace/default save location (recommended).** Pros:
  meaningful default and correct URI scheme for remote workspaces. Cons: must choose a reasonable
  no-workspace fallback and avoid treating a remote URI as a local path.
- **B — Omit `defaultUri` and let VS Code choose its last-used folder.** Pros: respects dialog history.
  Cons: may lose the suggested report filename.

**Recommendation:** A; non-blocking save-dialog polish. Do not assert a tested OS dialog outcome from
a URI-only probe.

### R11 — Valid; Medium (code-backed lifecycle failure, not live reproduced)

**Evidence.** `openMarkdownDocument()` stores text and opens only `markdown.showPreview`
(`readOnlyJsonDocumentProvider.ts:32–49`). The shared `onDidCloseTextDocument` hook deletes that text
at `:79–81`; the provider tests demonstrate the deletion. Crucially, a preview tab is not proof of a
live text-model reference. In VS Code **1.115.0**:

- [`preview.ts:251–294`](https://github.com/microsoft/vscode/blob/1.115.0/extensions/markdown-language-features/src/preview/preview.ts#L251-L294)
  opens the source with `workspace.openTextDocument()` when updating, without retaining an editor
  model reference tied to the preview's lifetime.
- [`mainThreadDocuments.ts:28–81, 284–288`](https://github.com/microsoft/vscode/blob/1.115.0/src/vs/workbench/api/browser/mainThreadDocuments.ts#L28-L81)
  puts API-opened models into a bounded reference collection with a **three-minute** maximum age
  (also a count/size eviction limit).
- [`textModelResolverService.ts:107–138`](https://github.com/microsoft/vscode/blob/1.115.0/src/vs/workbench/services/textmodelResolver/common/textModelResolverService.ts#L107-L138)
  disposes a virtual model when its last resolver reference is released.

With only the preview open, expiry can close the source and trigger the extension's deletion even
though the preview tab remains. The already-rendered HTML need not disappear immediately; a forced
refresh or Show Source then reopens the same URI and the provider supplies an empty string. That
source-level chain validates the risk without claiming an observed workbench session.

**Correction.** Window reload is not a useful independent argument: all these snapshots are explicitly
in-memory, and reload restoration was not promised. A theme change alone was also not reproduced.
The actionable issue is source eviction _within the same session while the preview is still open_.

**Solutions.**

- **A — Give preview reports an explicit lifetime rather than releasing them on text-model close
  (recommended).** Keep them stable through source eviction; release on a lifetime actually owned by
  the feature, such as a managed preview's disposal. Pros: preserves immutable opened reports and can
  bound memory without invalidating visible content. Cons: the built-in preview command exposes no
  preview handle, so lifecycle ownership needs a deliberate implementation, not just another close hook.
- **B — Keep the source in a real text editor as well as opening the preview.** Pros: a live editor
  owns a model reference; small implementation. Cons: extra source tabs and closing just that editor
  can recreate the problem unless report retention is also fixed.
- **C — Retain all preview snapshots until extension disposal.** Pros: simple reliable same-session
  behavior. Cons: unbounded accumulated report memory; document/measure a limit that never evicts an
  open report, or prefer A.

**Recommendation:** A, with a workbench lifetime/refresh test; block until lifetime is fixed or a
real integration test disproves this source-backed path on supported VS Code versions. Do not add a
short arbitrary cache TTL and call that preservation of open documents.

**Stage 3 (option A).** Markdown reports now live as long as a tab shows them, not as long as their
text model. `readOnlyJsonDocumentProvider` records each Markdown URI; `onDidCloseTextDocument` no
longer releases it (JSON documents still release there, so Query Insights' and the dashboard's
`openDocument` path is unchanged). A new `tabGroups.onDidChangeTabs` listener calls
`releaseUnshownMarkdownDocuments()`. A report is shown by a tab whose input has its URI (the
source, or the text editor fallback) or by the built-in preview: a webview tab whose type ends in
`markdown.preview` and whose title contains the file name. VS Code 1.115.0 titles it
`Preview {0}` or `[Preview] {0}`, and the tab input has no resource
([`preview.ts#L799-L804`](https://github.com/microsoft/vscode/blob/1.115.0/extensions/markdown-language-features/src/preview/preview.ts#L799-L804)).
A report is released once a tab showed it and none does any more. A report no tab has shown yet is
kept, so a tab event that arrives before the preview's tab cannot release it. Bounds: reports
with the same title are kept until the last such preview closes; a report whose tab never appears is
held until the extension is disposed. Files: `src/utils/readOnlyJsonDocumentProvider.ts`; tests in
`readOnlyJsonDocumentProvider.test.ts` (the shared-hook test now expects Markdown kept and JSON
released; new "preview lifetime" block: kept after source-model close while the preview is open,
released with its last tab, kept before first shown, released when a dynamic preview switches file,
other webview types ignored). The updated shared-hook test and four of the new tests failed before
the fix, because closing the text model released the content.
This uses simulated tab events. No VS Code workbench integration test was run; that remains
an open item from the recommendation. Design §6.1 now states the release rule.
Applied by the orchestrator as the review's recommendation; pending author confirmation in Stage 2.

### R12 — Valid; Low

**Evidence.** The feature README marks WI-14 “not started” and still describes the card as unchanged.
The committed acceptance/wording, layout and documentation work is present in `b6fd6782`, `d16bf27c`,
`5838017f`, `5498ad71` and `14ace523`. The opening of `design.md` also still says “Nothing here is
implemented” despite its many implemented annotations. These are maintained-document contradictions,
not a request to sweep historical iterations for drift.

**Solutions.**

- **A — Update current status/code map and the design's stale introductory claim (recommended).**
  Pros: review starts from accurate intent/status. Cons: must distinguish implemented work from
  still-pending author decisions, live acceptance and release gates.
- **B — Remove implementation status from durable docs entirely.** Pros: less maintenance. Cons:
  loses useful navigation/provenance and does not fix already-misleading wording by itself.

**Recommendation:** A before handover; a small documentation gate, not a product-risk severity
upgrade. Only the review file is edited in this pass, as requested.

### R13 — Partially valid; Low

**Evidence.** `openConnectivityTroubleshooter()` returns early on an existing `clusterId`
(`connectivityTroubleshooterController.ts:28–32`), retaining the original router target, configuration,
name and entry point. The controller tests verify one-panel reuse but not replacement metadata.
Stored `DocumentDBClusterItem.getCredentials()` reads storage again, so a folder move is not itself
a wrong-cache-ID bug. However, the assertion that _all_ endpoints are fresh is false: e.g.
`AtlasClusterItem.getCredentials()` reads the captured node's `cluster.connectionString`; ignoring a
new node can retain its old discovered model as well as a stale display name.

**Qualification.** Recording the original entry point can reasonably mean “how this panel/session
was opened”; that alone is not proven incorrect telemetry. The run-versus-session attribution must
be specified before changing it. Stale replacement target/display data is the concrete issue.

**Solutions.**

- **A — On a new invocation refresh host target/configuration/title, snapshotting the chosen target
  per run (recommended).** Pros: re-runs use the currently selected node; avoids changing an in-flight
  run's target under its feet. Cons: requires configuration-update plumbing and explicit attribution.
- **B — Document panel metadata as fixed until close/reopen.** Pros: no new synchronization. Cons:
  surprising after a rename/rediscovery and potentially stale discovery endpoints.

**Recommendation:** A as a non-blocking follow-up, with renamed/replaced-node tests; keep stable-ID
panel reuse and distinguish panel-entry from run-trigger telemetry.

### R14 — Valid; Nit

**Evidence.** A local probe used the real Entra diagnostics provider, a classified
`AADSTS53003` error, the real `contextHints` check and `deriveResult()`. It produced both the headline
“Your organization policy appears to have blocked sign-in” and a provider hint beginning “Your
organization's policy appears to have blocked this sign-in”, with overlapping IT-help-desk advice.
`notConnectedLines()` renders both without deduplication (`TroubleshooterResultCard.tsx:90–145`). The
only mocked provider dependency was Output tracing, not classification or wording.

**Solutions.**

- **A — Suppress the Entra provider's prose when the headline already covers the same classifier
  rule, retaining distinct infrastructure hints (recommended).** Pros: one actionable explanation;
  no text-based comparison across locales. Cons: carry provider/rule identity into the decision.
- **B — Keep both as extra context.** Pros: preserves links and provider-specific details. Cons:
  repetitive card and report next steps.

**Recommendation:** A when polishing; not a blocker. Deduplicate by structured identity, not English
substring similarity.

## Independent sweep (Stage 1 step 4)

**Reviewer:** gpt-6.1-sol. These are additional findings, not restatements of R1–R14.
All five are **Valid**; the severity below is the sweep's assessment.

### S1 — Valid; Medium: A failed first seed is presented as the server that answered

**Evidence.** `serverFacts.answeredBy()` correctly declines to infer one answering server from a
multi-server topology (`serverFacts.ts:49–63`). But `result.ts:198–203, 233` replaces that uncertainty
with the **first seed**. The card formats it as “Server … at …” and the report summary labels it
“Server”, not “Seed” (`TroubleshooterResultCard.tsx:52–66`, router `reportSummary()`). A local probe
supplied a failed TCP result for `dead.fixture.invalid:27017`, a successful authentication and
`answeredBy: null` with dead/live seeds; the Connected card's server host was **dead.fixture.invalid**.
A real replica set can connect through another seed/member, so this is not a hypothetical malformed
fixture. Design §4.11 requires the endpoint that answered **when the driver reports it**, keeping
seeds separate. No decision records silently asserting that the first seed answered.

**Solutions.**

- **A — Omit the answering-host clause when it is unknown; list seeds only as seeds
  (recommended).** Pros: honest evidence, very small change, keeps successful outcome/version/ping.
  Cons: less identity reassurance for multi-server connections.
- **B — Record the selected command server using an appropriate scoped driver observation.** Pros:
  accurate richer identity. Cons: more driver integration and cleanup; an arbitrary topology member
  is still not evidence of which server answered each command.

**Recommendation:** A before handover; B can follow. Never substitute a seed, or even an available
member, without labelling the inference.

**Stage 3 (option A).** `deriveResult()` now takes the server line's host only from
`serverFacts.answeredBy`; the first-seed and URI-host fallbacks are removed, so the card and the
report summary omit the "at …"/"Server" clause when the driver did not report one server. Seeds stay
in the server facts and the probe rows. Files: `src/troubleshooter/result.ts`,
`src/troubleshooter/result.test.ts` (new regression test "S1: a failed first seed is never presented
as the server that answered"; the two tests that asserted the old seed fallback now assert an omitted
host). Applied by the orchestrator as the review's recommendation; pending author confirmation in
Stage 2.

### S2 — Valid; Medium: Fresh TLS/hello connections ignore the connection's connect timeout

**Evidence.** `resolveNetworkOptions()` reads `connectTimeoutMS`, but only TCP installs its
connection-specific timer (`tcp.ts:94–126`). TLS opens a **new** socket via `tlsConnectionOptions()`
and `connectTls()` (`tls.ts:240–276`); neither it nor `nodeNet.connected()` applies `connectTimeoutMS`.
`hello.ts:448–507` opens another fresh TCP/TLS socket with the same omission. The runner's
`effectiveTimeout()` sees only `input.connectionTimeouts`, not this URI option. Thus the URI's shorter
connect timeout is bypassed for these socket establishments; removing diagnostic timeouts can leave
one stuck until cancellation/OS failure, despite design §3.2 and the manual's “connection-configured
timeouts still apply” promise.

Two local fake-clock assertions used the real TLS/hello checks with `connectTimeoutMS=5` and
`noDiagnosticTimeouts`. A hanging `connectTls`/`connect` remained unresolved after **30 ms** and ended
only when cancelled. This test is about **establishing the new connection**, where the option
applies, not an assertion that every later operation must share a TCP timeout.

**Solutions.**

- **A — Share a per-establishment connection deadline across TCP/TLS/initial handshake as
  applicable, taking the minimum with diagnostic/run limits (recommended).** Pros: matches the real
  connection policy and keeps provenance accurate for all retry profiles. Cons: carefully delimit
  connect versus later reply work; close abandoned sockets and clear timers on every exit.
- **B — Document that connection timeouts affect only the separate TCP probe.** Pros: minimal code.
  Cons: knowingly changes the promised parity; the real driver and diagnostic TLS path can behave
  very differently, especially on an explicitly unbounded retry.

**Recommendation:** A before handover, with TLS/hello setup timeout tests for default and unbounded
profiles and with a source-specific timeout result (coordinate R9 and S3).

**Stage 3 (option A).** New package helper `src/checks/connectionDeadline.ts`
(`connectionDeadlineMs`, `establishWithin`, `ConnectionTimeoutError`, `connectionTimeoutFinding`):
when `connectTimeoutMS` is shorter than the probe timeout (or the probe timeout is removed), each new
socket the TLS and `hello` probes open, including the TLS inspection-only reconnect, must be
established (TCP connect plus TLS handshake) within it. Expiry aborts the attempt, so the adapter
destroys the socket, and the check fails with `check.timeout`
`{ operation: 'tls' | 'hello', timeoutMs, source: 'connection', target }`. The runner already
records that in `coverage.timedOut` and does not count it as retry-helpful. The `hello` reply wait
is not covered by the connect timeout, and TCP is unchanged. Files:
`packages/documentdb-js-connectivity-troubleshooter/src/checks/connectionDeadline.ts` (new),
`src/checks/tls.ts`, `src/checks/hello.ts`, `README.md` (timeouts paragraph). Tests: `tls.test.ts`
("S2: … TLS socket", default and `noDiagnosticTimeouts` profiles through the runner) and
`hello.test.ts` ("S2: … hello socket", default and unbounded, plain and TLS, plus a test showing the
reply wait is not cut short). Applied by the orchestrator as the review's recommendation; pending
author confirmation in Stage 2.

### S3 — Valid; Low: Coverage says unlimited/complete after omitted addresses or a TCP timeout

**Evidence.** `dns.ts:255–270` caps OS/c-ares addresses at eight and records omitted counts, but
`runner.ts:443–449` sets `coverage.limited` only from registered timeouts, unstarted checks and omitted
**targets**. A probe with ten OS and ten c-ares addresses reported `{ os: 2, cares: 2 }` omitted yet
`coverage.limited === false`. Separately, `runner.ts:211–231` registers only `check.timeout`, not the
more-specific `tcp.timeout`. A hanging TCP connection with `connectTimeoutMS=5` returned a real
`tcp.timeout` with `source: connection`, but `coverage.timedOut` was empty and `limited` false.
The router derives its connection-timeout caveat only from that list. Raw findings/counts remain in
the report; the defect is contradictory summary/coverage, not lost raw observations. Design §3.2
explicitly says omitted addresses count as a coverage limit and specific timeout evidence is kept.

**Solutions.**

- **A — Aggregate coverage structurally from explicit omission and timeout metadata
  (recommended).** Pros: includes specific timeout codes and address caps without parsing prose;
  panel, telemetry and report agree. Cons: extend/check the package's result/coverage contract.
- **B — Special-case current DNS facts and `tcp.timeout` in `recordResult()`.** Pros: small fix for
  current producers. Cons: brittle as more checks gain specific timeout results.

**Recommendation:** A, or B with tests until the contract is extended; non-blocking. A safety cap or
connection-only timeout must **not** imply that longer diagnostic retries will increase coverage.

### S4 — Valid; Medium: A delayed Cancel can cancel the replacement run

**Evidence.** The view's `handleCancel()` sends `cancel.mutate()` with **no run identity**, while
immediately showing a cancelled state and leaving Re-run available (`ConnectivityTroubleshooter.tsx:197–202`). Host `cancel` unconditionally aborts `session.currentRun`
(`connectivityTroubleshooterRouter.ts:396–398`); unlike report actions/events, it has no run-ID guard.
If a user cancels A then starts B before A's mutation is handled, that mutation aborts B. A local
router assertion started A and replacement B, delivered the old identity-free cancellation, and
observed B aborted with `cancelButton`. This establishes the missing guard; the exact ordering's
frequency on a live remote host was not measured. Run-update sequence guards cannot repair a host
cancelling the wrong run.

**Solutions.**

- **A — Scope cancellation to the originating run/request and ignore stale cancels
  (recommended).** Send a run ID and match it, with a defined pre-`started` cancellation strategy
  (client request identity or cancelling that specific subscription). Pros: deterministic isolation;
  works with remote latency and reruns. Cons: handle the initial-acknowledgment window, not merely
  add an optional ID that falls back to “cancel current”.
- **B — Disable Re-run until Cancel is acknowledged.** Pros: reduces one UI race. Cons: adds waiting,
  does not protect against late requests from old subscriptions/other clients, and keeps an unsafe API.

**Recommendation:** A before handover. Test both a delayed old cancel after replacement and cancellation
before the first `started` update; never let an old request select the current run implicitly.

**Stage 3 (option A).** The view generates a `requestId` (`crypto.randomUUID()`) for each run
subscription and sends it in the `run` input; `cancel` now requires `{ requestId }` (both
mandatory, with no fallback to "cancel current"). `TroubleshooterPanelSession.cancel(requestId)` aborts
the current run only when that run was started by the same request. Any other Cancel is stale or
early. It is recorded, bounded to the last 32, and `startRun(runId, requestId)` aborts a run
with `cancelButton` as it starts if its request was already cancelled. That covers a Cancel handled
before the subscription body runs, so before `started`. A stale Cancel matches nothing and is
not correlated with the current run in telemetry. Files:
`src/webviews/documentdb/connectivityTroubleshooter/{troubleshooterPanelSession.ts,connectivityTroubleshooterRouter.ts,ConnectivityTroubleshooter.tsx}`;
tests in `connectivityTroubleshooterRouter.test.ts` ("ignores a delayed Cancel from a replaced
run…", "cancels a run whose Cancel arrives before its subscription starts"; both failed before the
fix) and `ConnectivityTroubleshooter.test.tsx` ("names the run it cancels…"); existing callers
updated in those files, `connectivityTroubleshooterController.test.ts` and (by the parallel host
agent) `src/troubleshooter/acceptance.test.ts`. Design §3.3 gains one sentence.
Applied by the orchestrator as the review's recommendation; pending author confirmation in Stage 2.

### S5 — Valid; Medium: Common driver configuration failures yield no explanation or next step

**Evidence.** The connection-string check validates syntax and option _names_, not many known option
values (`connectionString.ts:191–230, 307–390`). In `authenticate.ts:445–474, 510–593`, driver
construction/connect failures outside three specific server-error categories return failure with no
finding; ordinary native/NoAuth errors have no failing auth phase to fill the gap either. A local
probe used **the real driver constructor**, with NoAuth and
`mongodb://fixture.invalid/?retryWrites=not-a-boolean`. Connection-string validation passed; construction
failed immediately with `MongoParseError`; Authenticate returned `findings: []`, and `deriveResult()`
returned a failed card with **no headline/explanation/next step**. No socket or database was involved.
The existing auth test “fails any other error with its name and no finding” explicitly protects
secret exclusion, but not the design §4.13 explanation contract. This affects current common user
configuration failures, unlike R7's preparation-provider-only case.

**Solutions.**

- **A — Guarantee a safe fallback finding for an otherwise unexplained failure, with a specific
  localized category for known invalid driver options where safely distinguishable (recommended).**
  Pros: every failed attempt has actionable next steps without exposing the raw URI/error. Cons:
  requires finding-code/message tests and clear category boundaries; generic advice cannot quote
  arbitrary driver error text.
- **B — Validate every driver option value in the package.** Pros: can diagnose many mistakes earlier.
  Cons: duplicates the driver's evolving parser and still cannot cover all later errors.

**Recommendation:** A before handover, share the safe-fallback approach with R7, and add narrowly
useful option validation only as needed. Do not export the raw `MongoParseError.message` as the fix.

**Stage 3 (option A).** The Authenticate check now guarantees an error finding whenever it fails
without one (outcome and steps checked; not after cancellation): `auth.driverOptionsRejected` when
constructing the driver client threw `MongoParseError` or `MongoInvalidArgumentError`, otherwise
`auth.connectFailed` with the safe error name and the phase (`configure`, `construct`, `connect`).
Neither quotes the driver message. Both have localized title, explanation and next step.
`deriveResult()` lets the generic `auth.connectFailed` headline yield to a specific earlier probe
error, so it never hides, for example, `tcp.refused`. No option-value validation was added to the
package. R7 (preparation provider failure) is not covered: that path skips Authenticate rather
than failing it. Files: `src/troubleshooter/types.ts` (two codes), `checks/authenticate.ts`
(`unexplainedFailureFinding`, failure phase tracking), `findingMessages.ts`, `findingData.ts`,
`result.ts` (headline precedence); docs: feature README catalogue row, design §4.9.1 table. Tests:
`checks/authenticate.test.ts` ("S5: fails any other error … safe fallback finding", replacing the
test that asserted no finding; "S5: an option value the real driver rejects …", using the real
`MongoClient` constructor with `retryWrites=not-a-boolean`), `result.test.ts` (two S5 tests),
`findingMessages.test.ts` (sample data for the new codes). Applied by the orchestrator as the
review's recommendation; pending author confirmation in Stage 2.

### Sweep coverage and non-findings

- **Secrets:** checked structured report/telemetry allowlists, password stripping, provider prose,
  token-claim summarization and Markdown escaping. R4 is a demonstrated identifier leak; no additional
  credential/token disclosure is established. `sanitizeValue()` is a size/type sanitizer, not an
  automatic secret remover; safety still depends on producers exporting only known fields.
- **Owned resources:** auth registers client cleanup before connecting and closes late successful
  clients; network adapters destroy abandoned sockets. Shared Kubernetes tunnels are deliberately
  not disposed on diagnostic cancellation (0017). Awaited best-effort cleanup and uncancellable SDK
  work deserve integration coverage, but no additional concrete leak is asserted here. UI subscription
  handles accumulate until view unmount; that small bounded-by-panel-use concern is not promoted over
  the demonstrated run-cancellation bug.
- **Ordinary connects:** `ClustersClient` now calls the factory with `interactive: true`; all four
  production handlers keep their previous target/TLS policy absent the optional observer. The
  focused auth suites passed. No additional ordinary-connect behavioral regression is established;
  diagnostic-only fixes should not alter those defaults or write `CredentialCache`.
- **Documentation/design:** additional specific mismatches are S1–S3; R12 also covers the stale
  introductory implementation claim. The Proposed choices 0023/0025/0026/0032/0035 are not retroactive
  author approval. In particular, approving 0035 requires correcting the Kubernetes premise first.

### Overall recommendation

**Do not hand over yet.** Resolve R1–R5, R11, S1, S2, S4 and S5, or obtain an explicit author decision
with a defensible revised contract and corresponding regression coverage. R1/R2 and R3/S2 are related
but not duplicates: setup/tunnel ownership differs from failure classification, and an earlier auth
timer differs from missing socket-establishment timers. Correct the small maintained-document errors
in R12 before handover as well. R6–R10, R13–R14 and S3 can be accepted or tracked as follow-ups;
R7 can be covered naturally by S5's safe fallback.

There are **19 findings** after validation: **1 High, 9 Medium, 8 Low, 1 Nit**. Six original findings
are partially valid (R1, R3, R6, R8, R10, R13); none is dismissed wholesale. Author decisions below are
intentionally blank. Stage 1 step 2, actual VS Code/discovery integration coverage and the Case 2
verification/handover requirements remain outstanding; this review does not satisfy those gates.

## Stage 3 commits

The orchestrator applied the recommended option for R3, R4, R5, R11, S1, S2, S4 and S5 in `f711df8c`
(one commit, because the fixes share files; each finding's Stage 3 note above describes its change and
tests). These are recommendations applied while the author was unavailable, not author decisions. R1 and
R2 are not applied: R1 is a scope and UX decision that also invalidates the Kubernetes premise of decision
0035, and R2's recommended fix depends on R1's port policy. The remaining Low and Nit findings are
unchanged.

After the operator's Stage 2 decisions (2026-10-30), WI-16 applied option A for R1 and R2 (`f0ea55e6`,
`d032c9f0`, `1ac3714d`, docs `330a5436`); the panel chrome change WI-15 (`1dd7793a`) left R5's fix valid.
A `code-review` agent reviewed `beb5c57e..330a5436` and found no High or Medium issues. Its two Low
findings are documented, not fixed, per the operator's instruction to address only High and Medium:

- **W1 (Low):** `resolveTarget.ts` classifies an Azure sign-in failure by `cause.name`, but
  `NotSignedInError` from `@microsoft/vscode-azext-azureauth` never sets `name`; only its
  `isNotSignedInError` flag identifies it. Such an error would read "Azure details unavailable" rather
  than "Azure sign-in needed", and the report shows `errorName: 'unknown'`. The current read path
  surfaces an expired session as a 401, which is classified correctly. Fix: also test the flag.
- **W2 (Low):** `PortForwardTunnelManager.startTunnel` lets a second caller join a pending start for the
  same key regardless of `interactive`. A troubleshooter `prepare` racing an ordinary expand of the same
  Kubernetes node can give the ordinary connect `LocalPortInUseError` instead of the "Use existing"
  dialog, or make `prepare` wait on that dialog until its timeout. Fix: do not share a pending start
  across different `interactive` values.

Case 2 then passed on line B with two lint fixes from WI-16 (an `import()` type in a test mock and an
unused catch binding).

## Author decisions (Stage 2)

Recorded from the operator's instructions of 2026-10-30: "R1: A, R2: A, and all follow recommendation. But, R5, reevaluate after the first ask in this prompt - the wizard update. Ignore the ones with low and lower." (typos corrected)

| Finding | Verdict         | Severity | Recommended                             | Author decision                                                                            |
| ------- | --------------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1      | Partially valid | High     | Silent resolver; prepare owns tunnel    | **A** (operator, 2026-10-30): silent diagnostic resolver; `prepare` owns the tunnel. WI-16 |
| R2      | Valid           | Medium   | Bound/classify diagnostic setup         | **A** (operator, 2026-10-30): bounded, observable setup with typed outcomes. WI-16         |
| R3      | Partially valid | Medium   | Let driver own selection timeout        | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| R4      | Valid           | Medium   | Classify identifiers or omit prose      | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| R5      | Valid           | Medium   | Restore disappearing-control focus      | Recommendation kept after WI-15 re-evaluation; `f711df8c` unchanged (2026-10-30)           |
| R6      | Partially valid | Low      | Keep documented Connected precedence    | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R7      | Valid           | Low      | Safe preparation-failure finding        | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R8      | Partially valid | Low      | Skip incomplete native credentials      | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R9      | Valid           | Low      | Reject oversized timer values           | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R10     | Partially valid | Low      | Use meaningful save directory           | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R11     | Valid           | Medium   | Own preview-source lifetime             | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| R12     | Valid           | Low      | Refresh maintained status docs          | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R13     | Partially valid | Low      | Refresh target on re-invocation         | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| R14     | Valid           | Nit      | Deduplicate by classifier identity      | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| S1      | Valid           | Medium   | Never assert a seed answered            | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| S2      | Valid           | Medium   | Enforce fresh-socket connection timeout | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| S3      | Valid           | Low      | Aggregate actual coverage limits        | Not addressed: operator chose to leave Low and Nit findings documented only (2026-10-30)   |
| S4      | Valid           | Medium   | Scope Cancel to originating run         | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
| S5      | Valid           | Medium   | Guarantee safe failure explanation      | Recommendation accepted (operator, 2026-10-30); applied in `f711df8c`                      |
