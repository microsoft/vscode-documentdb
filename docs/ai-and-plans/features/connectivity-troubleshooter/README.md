---
feature: connectivity-troubleshooter
kind: notes
status: active
created: 2026-10-27
updated: 2026-11-04
code:
  - packages/documentdb-js-connectivity-troubleshooter/**
  - src/troubleshooter/**
  - src/commands/troubleshootConnection/**
  - src/webviews/documentdb/connectivityTroubleshooter/**
---

# Diagnose connection

> Called the **connectivity troubleshooter** until WI-17 (2026-11-02). Older decisions and
> iteration notes retain that name. Source paths and implementation names stay; the command ID changes
> ([0038](./decisions.md#0038--the-feature-is-called-diagnose-connection)).

**Status:** implemented; ready for operator review (work items in [the implementation log](./iterations/02-implementation-log.md)) ·
**Issue:** [#100](https://github.com/microsoft/vscode-documentdb/issues/100) ·
**Branch:** `dev/tnaum/connectivity-troubleshooter` (rebased onto `main` after #1050 merged)

> A step-by-step check of one connection that says which step fails and what to do next, ends with
> a summary of the server that answered, and produces a readable report a support engineer can
> work from. It works for failed and working connections.

When a connection fails, the user gets one driver error, often `ECONNREFUSED`, a server selection
timeout or an OpenSSL alert. Connection diagnosis takes the connection apart: connection string,
preparation, SRV, DNS, TCP, TLS, the wire protocol and authentication, followed by a small
connection-access check and the server's basic facts. It reports what it observed and suggests the
next thing to try. The question is "can this user connect, and if not, why might it be failing?",
not a configuration or permissions audit.

## Intent (code is authoritative for behavior once it exists)

- **A package and a surface.** The checks live in `@documentdb-js/connectivity-troubleshooter`, a
  VS Code-independent workspace package that returns stable codes, structured facts and
  language-tagged English details for convenience. The extension uses codes and structured data
  only to produce its own localized messages; it never parses or uses the English detail as a
  localization fallback. It owns the webview, entry points, messages and telemetry. A command line tool reuses the
  package later ([0001](./decisions.md#0001--the-checks-live-in-a-workspace-package-in-this-repository),
  [0003](./decisions.md#0003--this-repository-defines-the-package-api-and-its-guidelines-documentdb-cli-adapts-later),
  [0031](./decisions.md#0031--codes-are-authoritative-english-details-are-a-convenience)).
- **Written from scratch.** `microsoft/documentdb-cli` showed which checks are worth running; no
  code comes from it ([0002](./decisions.md#0002--written-from-scratch-documentdb-cli-was-inspiration-for-what-to-check-not-a-code-source)).
- **Driver-free network checks, real authentication.** DNS through `hello` use Node.js built-ins so
  the first failure is reported as it happened. Authentication runs through the extension's own
  connection path in a short-lived client, so it tests what the extension actually does, and its
  outcome is never suppressed by a failed probe ([0004](./decisions.md#0004--network-checks-are-driver-free-authentication-uses-the-extensions-real-connection-path)).
- **Finite by default, with explicit timeout retries.** URI and SRV targets only, no online check,
  10-second default network probes and a proposed 300-second whole-run timeout. A timed-out run is
  reported as limited, not proof that the server is unreachable. The user can retry with longer or
  no diagnostic timeouts; connection-configured timeouts and non-time safety limits still apply
  ([0032](./decisions.md#0032--time-limits-are-timeouts-with-explicit-longer-or-unbounded-retries)).
- **Two entry points.** An error node under a failed cluster, and a context menu item on every
  cluster node, working or not, but not on Local Quick Start instance nodes; plus the command palette
  ([0007](./decisions.md#0007--two-entry-points-from-the-start-an-error-node-and-a-context-menu-on-every-cluster),
  [0015](./decisions.md#0015--the-context-menu-item-is-on-cluster-nodes-only-not-on-quick-start-instance-nodes)).
- **Tests what the user chose, without prompting.** Authentication uses the chosen method and its
  stored credentials. It is skipped only where a real connect would ask for something; a
  configuration error a real connect would fail on is reported as a failure
  ([0013](./decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped),
  [0016](./decisions.md#0016--unavailable-authentication-inputs-mean-an-explained-skip),
  [0025](./decisions.md#0025--authentication-is-skipped-only-when-the-troubleshooter-withholds-a-prompt)).
- **A fixed, universal list.** The same eight rows with static labels for every connection, from
  the moment the panel opens, settling top to bottom: Diagnosis setup, Connection settings,
  Server address (DNS), Network connection (TCP), Secure connection (TLS), Server greeting (hello),
  Authentication, Database access. Only the status and one reserved
  evidence line change, so nothing shifts and the user always knows where the run is. There is no
  dynamic row set ([0029](./decisions.md#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list);
  row 6 and the Authentication details: [0049](./decisions.md#0049--server-greeting-hello-one-authentication-layout-and-the-shell-on-every-tree-failure)).
  A settled row that ran also shows its real duration in a squared badge at the end of its label
  line, with no rating and no total; the list shades the row under the pointer so the badge stays
  tied to its row ([0050](./decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer)).
  Details add each host's time and each TCP address's connect time where they inform (WI-31,
  WI-33).
- **Evidence lines, detailed report.** As in Local Quick Start, each row's detail says what was done
  and what was detected ("3 of 3 hosts reachable · Port 10260"); the mechanics are in the report.
  Entra ID sign-in is one Authentication row, while its three phases
  (sign-in configuration, token, server authentication) with #1050's cloud and error details are
  recorded for the report ([0027](./decisions.md#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)).
- **Ends with a result card.** Below the list, a short outcome of the diagnosis: Connection
  successful (naming any rows that need attention), Connection failed at <row> with what failed, why
  and what to do next, Connection not tested, or Diagnosis stopped / cancelled. Facts such as the
  server version and ping live in the rows' Details. Report actions live only in the footer, not
  duplicated in the card
  ([0029](./decisions.md#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list),
  [0041](./decisions.md#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)).
- **Plain DNS wording.** The panel never names Node.js's DNS libraries; it says whether your
  system's lookup and a direct DNS query disagree, or that the extension works around a known DNS
  issue. The report keeps the technical names for support
  ([0041](./decisions.md#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)).
- **Firewall guidance without a false diagnosis.** A network failure's final card and report say
  a firewall or IP allowlist may be blocking the connection, and name the network where the checks
  ran. Cloud-platform-specific firewall configuration helpers are for the next iteration, not
  this release ([0033](./decisions.md#0033--network-failures-mention-possible-firewall-blocking-cloud-helpers-come-next)).
- **Says where it ran.** The first step, "Diagnosis setup", names this computer or the remote
  host ([0014](./decisions.md#0014--the-first-step-says-where-the-checks-run)).
- **Readable diagnostics.** Show report opens a Markdown report in VS Code's preview; the
  footer's **Share report** menu offers **Copy report to clipboard** and **Save report to file…**,
  using the same snapshot (JSON is a Save option). Each run also leaves a short Output channel
  trace ([0022](./decisions.md#0022--show-diagnostics-opens-the-report-read-only-runs-leave-an-output-channel-trace)).
  Report actions are hidden until a report is ready. The footer's info text has an inline
  **Hide identifiers in the report** / **Show identifiers in the report** link instead of a
  separate toggle. It applies to the report only: the panel always shows identifiers, and Copy or
  Save with identifiers first asks in a modal warning
  ([0040](./decisions.md#0040--hide-identifiers-applies-to-the-report-only-and-sharing-a-report-with-identifiers-asks-first)).
  Shown, copied and saved Markdown ends with **About this report**, crediting the DocumentDB
  extension for Visual Studio Code and linking to its Visual Studio Marketplace listing.
  The About-style summary includes extension version/channel, VS Code, Node.js and OS, even if
  environment checks were skipped, without discovery or migration plug-in lists. Saved JSON ends
  with equivalent `generatedBy` attribution.
- **Static task header, connection-specific content.** The **Connection Diagnostics** header has an
  icon and a general task description. Like the DocumentDB Local setup page, the content starts
  with its own heading (the connection name) and subtitle (static checking text or the relative last-checked time, WI-24).
- **Complete by default, secrets never.** Report identifiers are visible unless the user hides them;
  passwords, tokens and proxy credentials never enter any output
  ([0006](./decisions.md#0006--reports-are-complete-by-default-redaction-is-an-explicit-option)).
- **Built from the shared UI toolkit.** `Container` and `StatusList`, which gains a `skipped` status
  ([0005](./decisions.md#0005--statuslist-gains-a-skipped-status),
  [0008](./decisions.md#0008--the-surface-is-a-webview-built-from-microsoftvscode-ext-webview-fluentui-components)).
- **Measure usage, not just failures**, through existing helpers and masking
  ([0020](./decisions.md#0020--collect-usage-and-diagnostic-telemetry-through-existing-helpers)).
- **Cancellable, coarsely** ([0017](./decisions.md#0017--cancellation-stops-the-run-not-necessarily-every-operation)),
  and **one first release** ([0026](./decisions.md#0026--one-first-release-later-work-is-named-not-open)).

The check catalogue, API, report contents, test plan and phasing are in [design.md](./design.md).

## Ordered checks, not globally serial checks

The supplied order is environment, connection string, preparation, SRV/TXT, then each host's
DNS -> TCP -> TLS -> `hello`, then authentication, connection access, server facts and context hints.
Up to four host chains run concurrently; the next run-level check waits for them to settle.
Results keep check and target order even when completion order differs. The panel buffers later-row
updates so its eight rows settle top to bottom; this does not change actual execution timestamps.

Ordering is not the same as dependency. Authentication requires valid connection settings and
successful preparation, not successful probes: it still tests the driver's real connection after
failed probes if time remains. An IP address skips DNS as not applicable; plaintext skips TLS.

## Timeout and retry contract

Use **timeout**, not "budget", for time limits in documentation, API fields and implementation.
Defaults: whole run 300 s (proposed), preparation 15 s, SRV/TXT 10 s, each per-host network probe
10 s, authentication 45 s, each post-connect command 5 s. A probe's address attempts and auxiliary
lookups share its timeout. Definitive failures return immediately; ten seconds is a default
ceiling, not a required wait. Shorter connection-configured timeouts still win.

- A started operation that times out reports `check.timeout`, not a skipped check or cancellation.
  A check not started before the whole-run timeout is `skipped/runTimeoutExceeded`. Dependent
  checks use `dependencyFailed` with the originating check. A timeout alone does not establish a
  firewall problem, server outage or credential rejection.
- Any diagnostic timeout that limits coverage enables **Retry with longer timeouts**, doubling
  every diagnostic timeout, or **Retry without diagnostic timeouts**, removing all diagnostic time
  limits for that run. The latter warns that the user may need to cancel; Cancel stays available.
  Neither retries individual probes automatically.
- Each retry is a fresh run and report, with no change to the saved connection or previously
  opened/exported reports; no report history is added. Ordinary Re-run uses defaults.
  Connection, OS, resolver and driver limits can still end a retry;
  if a connection-configured timeout is the cause, explain that this setting must be changed.
- Target (16), address-per-host (8), parallel-chain (4), wire-size (1 MiB) and report safety limits
  remain in force in every mode. "Without diagnostic timeouts" never means without security or
  resource limits.

Four waves of four hosts with four 10-second probes can take 160 seconds before authentication.
The proposed 300-second whole-run default leaves room for preparation, SRV, the 45-second real
connection attempt and the five post-connect commands (about 255 seconds of configured work in
total). It trades a longer worst-case wait for more complete coverage; real-run measurements
should validate these defaults.

## API messages and localization

Each finding has a stable `code`, severity, structured `data` when applicable, and a required
English convenience detail object:

```json
{
  "code": "tcp.timeout",
  "severity": "error",
  "detail": {
    "language": "en",
    "text": "The TCP connection attempt timed out. A firewall or IP allowlist may be blocking it."
  }
}
```

`language` is a BCP 47 tag. It is always `en` in the first release, not a locale-negotiation API.
English wording may change; consumers must branch on codes and documented structured data, never
parse the English. The extension selects its own localized explanation and next step from an
exhaustive code/data message table and does not fall back to `detail.text`. Consumer-added checks
supply their own English detail using the same shape. An unknown code is an explicit contract error.

English details follow the same secret-exclusion, identifier-redaction and escaping rules as
facts. JSON preserves their language tag and text; the extension's Markdown report uses localized
messages. English detail text is not sent to telemetry or the Output trace.

The future **package README** must document this contract, every exported finding code and its
concrete structured data fields, the separate skip reasons, and the timeout/retry behavior.
Keep that catalogue in sync with the public code unions as part of implementation tests.

### Finding code catalogue

The exported finding codes, their `data` fields and the skip reasons are documented in the
[package README](../../../../packages/documentdb-js-connectivity-troubleshooter/README.md#finding-codes),
which tests keep in sync with the public code unions.

## Code map

Main code:

- `packages/documentdb-js-connectivity-troubleshooter/src/types.ts`, `findingCodes.ts`: public types,
  `BuiltInFindingCode`, `SkipReason`
- `packages/documentdb-js-connectivity-troubleshooter/src/runner.ts`, `timeouts.ts`, `errors.ts`: the
  runner, timeout profiles and safety limits
- `packages/documentdb-js-connectivity-troubleshooter/src/checks/`: environment, connectionString, srv,
  dns, tcp, tls, hello; `createBuiltInChecks()` in `index.ts`
- `packages/documentdb-js-connectivity-troubleshooter/src/networkOptions.ts`: effective network options
  and their origins
- `packages/documentdb-js-connectivity-troubleshooter/src/report/`: snapshot, sanitization, identifier
  redaction, JSON and Markdown renderers, `englishReportText`
- `packages/documentdb-js-connectivity-troubleshooter/README.md`: the package contract and finding-code
  catalogue
- `packages/vscode-ext-webview-fluentui/src/components/StatusList/**`: the `skipped` status
- `src/documentdb/auth/authConnectionTarget.ts`: token-free connection string and network options per auth
  method
- `src/utils/clusterVersions.ts`: version helpers shared by the dashboard and connection diagnosis
- `src/troubleshooter/`: input building, extension checks (extensionEnvironment, credentials, prepare,
  authenticate, connectionAccess, serverFacts, contextHints), the DNS host-domain warning (`hostDomains`, WI-29),
  `runConnectivityTroubleshooter`, pure `result.ts` derivation, Output trace, telemetry, finding messages, report text, panel rows
- `src/commands/troubleshootConnection/`: the command and its entry points
- `src/webviews/documentdb/connectivityTroubleshooter/`: router, controller, panel session and React view

The router shares `result.ts` with telemetry and the Output outcome, adds localized report-summary
content, and sends a host-independent `ResultCardData` snapshot.

Changed existing code: `ClustersClient` (auth-handler factory with a non-interactive policy),
`ConnectionReachabilityService` (optional observer), `ConnectionDiagnosticsService` (optional
`source`), `readOnlyJsonDocumentProvider` (Markdown documents), the dashboard's version helpers
(moved to a shared module), `documentdbTokenResource.ts` (exported offline details helper).

## Sources

- Issue [#100](https://github.com/microsoft/vscode-documentdb/issues/100): the original eight steps,
  the operator's packaging comment, real-world failures (IP allowlists, DNS error mapping, CA
  bundles, clock skew, proxy and VPN, timeout versus refusal), and two community requests: supported
  connection string options, and private endpoint detection.
- `microsoft/documentdb-cli`, `apps/documentdb-troubleshooter`: inspiration for the check list only.
- [sovereign-clouds](../sovereign-clouds/README.md) (#1050): token-resource resolution, cloud
  mismatch, OIDC allowed hosts, the Entra error classifier and `[Authentication]` tracing that the
  Entra ID phases reuse.
- `preview/sovereign-diagnostics` (never merged): a three-dialog prototype of token audience, token
  claims and connection result; its allowlist-based value mapping moves into shipped code.
- [srv-dns-fallback](../srv-dns-fallback/README.md): the SRV resolver and its resolution report.
- [cluster-dashboard](../cluster-dashboard/README.md): the version helpers the summary reuses.
- [query-insights](../query-insights/README.md): the read-only document pattern behind Show
  report (called Show diagnostics until WI-19).
- [error-translation skill](../../../../.github/skills/error-translation/SKILL.md): the
  `ConnectionDiagnosticsService` providers the context hints check consults.

## Decisions

See [decisions.md](./decisions.md); its index table is the current status of every entry.

- **Superseded** (condensed to stubs): 0010, 0011, 0012 and 0019 by 0023; 0021 by 0027; 0024 and
  0028 by 0029; 0035 by 0036. 0031 replaces 0023's codes-without-sentences rule and 0032 amends its
  timeouts.
- **Proposed**, implemented as agent choices without explicit operator confirmation: 0023, 0025,
  0026, 0032, 0037, and points 3 and 4 of 0036.
- **Accepted:** everything else.
- **Tried and reverted:** a "Sign-in required" row in the Connections tree instead of the modal
  (WI-28). The tree shows actions only; see
  [connections-tree](../connections-tree/README.md) and the
  [tree skill](../../../../.github/skills/tree-cluster-architecture/SKILL.md). Also a **Copy summary**
  share item that copied the panel as text (WI-32, [0050](./decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer)).

## Open gaps

None in the design. Known limits:

- Without prompting, a consent or preauthorization failure (AADSTS65002) looks like "not signed in";
  the run says so and shows any failure recorded earlier in the session (design 4.9.1).
- US Government sign-in cannot be verified until the service-side preauthorization rolls out
  (sovereign-clouds D1).
- Cloud-platform-specific firewall configuration helpers are planned for the next iteration; the
  first release only explains possible blocking and existing provider hints.
- **Still to check (operator, 2026-11-02):** whether the Authentication row's Microsoft Entra ID
  details should show sovereign-cloud information: selected cloud, the cluster's cloud, the
  requested token resource and how it was chosen (design 4.9.2, "Sign-in configuration").

## Reading order

1. This README.
2. [design.md](./design.md), sections 1, 4, 5 and 6.
3. [decisions.md](./decisions.md) for the reasoning behind any one choice.
4. History only when needed: [iterations/](./iterations/) (the implementation review and the
   work-item log).
