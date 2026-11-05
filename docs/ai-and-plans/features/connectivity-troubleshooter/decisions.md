---
feature: connectivity-troubleshooter
kind: decisions
status: active
created: 2026-10-27
updated: 2026-11-05
---

# Connectivity troubleshooter: decisions

> Why the troubleshooter is split into a package and an extension surface, where the checks come
> from, and what the report contains.

| #    | Decision                                                                                    | Status              | Changed from the proposal?                                         | Date       | PR  |
| ---- | ------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------ | ---------- | --- |
| 0001 | The checks live in a workspace package in this repository                                   | Accepted            | Operator agreed, issue #100 comment                                | 2026-10-27 | —   |
| 0002 | Written from scratch; `documentdb-cli` was inspiration for what to check, not a code source | Accepted            | Operator position                                                  | 2026-10-27 | —   |
| 0003 | This repository defines the package API and its guidelines; `documentdb-cli` adapts later   | Accepted            | Operator position                                                  | 2026-10-27 | —   |
| 0004 | Network checks are driver-free; authentication uses the extension's real connection path    | Accepted            | Operator agreed                                                    | 2026-10-27 | —   |
| 0005 | `StatusList` gains a `skipped` status                                                       | Accepted            | Operator agreed                                                    | 2026-10-27 | —   |
| 0006 | Reports are complete by default; redaction is an explicit option                            | Accepted            | Proposal redacted hosts; operator: no                              | 2026-10-27 | —   |
| 0007 | Two entry points from the start: an error node and a context menu on every cluster          | Accepted            | Operator request                                                   | 2026-10-27 | —   |
| 0008 | The surface is a webview built from `@microsoft/vscode-ext-webview-fluentui` components     | Accepted            | Operator request                                                   | 2026-10-27 | —   |
| 0009 | Existing workspace packages are used and changed freely                                     | Accepted            | Operator position                                                  | 2026-10-27 | —   |
| 0010 | The package returns codes and structured facts, never sentences                             | Superseded by 0023  | Settled as proposed                                                | 2026-10-27 | —   |
| 0011 | Each host runs its checks in a fixed order; hosts run concurrently                          | Superseded by 0023  | Settled with a concurrency cap                                     | 2026-10-27 | —   |
| 0012 | No standalone "is this machine online" step                                                 | Superseded by 0023  | Settled: no online check at all                                    | 2026-10-27 | —   |
| 0013 | Authentication uses the chosen method and nothing else; no method chosen means skipped      | Accepted            | Operator answer to an open gap                                     | 2026-10-27 | —   |
| 0014 | The first step says where the checks run                                                    | Accepted            | Operator answer to an open gap                                     | 2026-10-27 | —   |
| 0015 | The context menu item is on cluster nodes only, not on Quick Start instance nodes           | Accepted            | Operator answer to an open gap                                     | 2026-10-27 | —   |
| 0016 | Unavailable authentication inputs mean an explained skip                                    | Accepted            | Operator clarified review point 1                                  | 2026-10-27 | —   |
| 0017 | Cancellation stops the run, not necessarily every operation                                 | Accepted            | Operator narrowed review point 5                                   | 2026-10-27 | —   |
| 0018 | Answer the connectivity question, not a general permissions audit                           | Accepted            | Operator clarified scope and summary                               | 2026-10-27 | —   |
| 0019 | Start with seed and SRV checks, not recursive topology probing                              | Superseded by 0023  | Settled as recommended                                             | 2026-10-27 | —   |
| 0020 | Collect usage and diagnostic telemetry through existing helpers                             | Accepted            | Operator requested usage collection                                | 2026-10-27 | —   |
| 0021 | Authentication reports sub-steps; `StatusList` gains one level of nesting                   | Superseded by 0027  | Phases kept, panel nesting dropped                                 | 2026-10-28 | —   |
| 0022 | Show diagnostics opens the report read-only; runs leave an Output channel trace             | Accepted (modified) | Operator: Markdown, not JSON                                       | 2026-10-28 | —   |
| 0023 | The research proposals are settled as one bounded scope                                     | Proposed            | Codes rule replaced by 0031; timeouts amended by 0032              | 2026-10-28 | —   |
| 0024 | The run ends with a Connection summary row that shows the server that answered              | Superseded by 0029  | Content kept; a card, not a row                                    | 2026-10-28 | —   |
| 0025 | Authentication is skipped only when the troubleshooter withholds a prompt                   | Proposed            | Agent refinement of 0016 from #1050                                | 2026-10-28 | —   |
| 0026 | One first release; later work is named, not open                                            | Proposed            | Agent proposal                                                     | 2026-10-28 | —   |
| 0027 | The panel shows one plain Authenticate row; Entra ID details live in the report             | Accepted            | Operator request                                                   | 2026-10-28 | —   |
| 0028 | A fixed row list with static labels; only detail lines change                               | Superseded by 0029  | Principle kept; eight rows, no summary row                         | 2026-10-28 | —   |
| 0029 | The outcome is a card below a fixed eight-row list                                          | Accepted            | Operator request                                                   | 2026-10-28 | —   |
| 0030 | Rows have plain names, with the technical term in brackets                                  | Accepted            | Operator request                                                   | 2026-10-28 | —   |
| 0031 | Codes are authoritative; English details are a convenience                                  | Accepted            | Operator reverses the no-sentences rule                            | 2026-10-29 | —   |
| 0032 | Time limits are timeouts, with explicit longer or unbounded retries                         | Proposed            | Operator requirements; agent-selected defaults                     | 2026-10-29 | —   |
| 0033 | Network failures mention possible firewall blocking; cloud helpers come next                | Accepted            | Operator request                                                   | 2026-10-29 | —   |
| 0034 | Compression and clock offset come from the handshake; DocumentDB answers as a gateway       | Accepted            | Operator agreed to agent research                                  | 2026-10-29 | —   |
| 0035 | Azure VM targets keep the existing port prompt when the troubleshooter reads credentials    | Superseded by 0036  | Implementation finding; operator unavailable                       | 2026-10-29 | —   |
| 0036 | Silent target reads; Kubernetes tunnels are prepared only in `prepare`                      | Accepted (option A) | Pre-review R1/R2; port and VM details Proposed                     | 2026-10-30 | —   |
| 0037 | The panel borrows the wizard chrome but has no steps                                        | Proposed            | Operator request; agent reasoning on steps                         | 2026-10-30 | —   |
| 0038 | The feature is called Diagnose connection                                                   | Partly superseded by 0051 | Operator accepted the name, including internal docs and command ID | 2026-11-02 | —   |
| 0039 | Rows expand to show their findings and the evidence behind them                             | Accepted            | Operator accepted the WI-18 prototype after a UX test              | 2026-11-02 | —   |
| 0040 | Hide identifiers applies to the report only; warn before sharing identifiers                | Accepted            | Operator request after the WI-18 UX test                           | 2026-11-02 | —   |
| 0041 | The panel never names DNS libraries; the card is a short outcome summary                    | Accepted            | Operator request; wording and layout are the agent's call          | 2026-11-02 | —   |
| 0042 | Public Azure private-link aliases are info; private-access hints require failure            | Accepted            | Operator evidence from real runs                                   | 2026-11-02 | —   |
| 0043 | The panel shows each step for at least about 300 ms                                         | Accepted            | Operator request; jitter range and card beat are the agent's call  | 2026-11-02 | —   |
| 0044 | Hide identifiers updates one live report per panel, with a neutral title                    | Accepted            | Operator                                                           | 2026-11-02 | —   |
| 0045 | Static checking status and relative last-checked time                                       | Accepted            | Operator                                                           | 2026-11-02 | —   |
| 0046 | Report timestamps show local time with a zone and UTC ISO                                   | Accepted            | Operator                                                           | 2026-11-02 | —   |
| 0047 | The root cause leads when the driver reached no server                                      | Accepted            | Operator report from a real run                                    | 2026-11-02 | —   |
| 0048 | No authentication that the server will not serve needs sign-in                              | Accepted            | Operator approved direction B                                      | 2026-11-02 | —   |
| 0049 | Server greeting (hello), one Authentication layout, and the shell on every tree failure     | Accepted            | Operator approved the proposals                                    | 2026-11-03 | —   |
| 0050 | Each row shows its duration in a squared badge; the list shades the row under the pointer   | Accepted            | Operator chose the layout from mocks                               | 2026-11-04 | —   |
| 0051 | Internal names follow the feature: connection diagnostics                                   | Accepted            | Operator: full rename now; vocabulary and explanation-layer rename | 2026-11-05 | —   |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written; a retitle means a new decision. Superseded entries are condensed to a stub (what was
> proposed, what replaced it, rejected alternatives that still apply); their headings stay so links
> keep working.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

**No entry is open.** `Proposed` now means "settled by the agent, evaluated by the operator together
with the whole plan", not "awaiting an answer before the plan is complete". `Accepted` is used only
where the operator asked for or approved the outcome.

---

## 0001 — The checks live in a workspace package in this repository

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator, issue #100

### Decision

The troubleshooting logic is a VS Code-independent workspace package,
`packages/documentdb-js-connectivity-troubleshooter`, published as
`@documentdb-js/connectivity-troubleshooter`. The extension is its first consumer. A command line
tool consumes the same package later.

### Why

The operator's issue comment: keep the core UI-agnostic "so it can be reused by multiple clients",
exposing "a simple way to run checks and return a structured result that a UI can present". The
extension owns the UX; a CLI later presents the same checks differently. Asked where the package
should live, the operator agreed to this repository.

---

## 0002 — Written from scratch; `documentdb-cli` was inspiration for what to check, not a code source

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

No code is copied or ported from `microsoft/documentdb-cli`
(`apps/documentdb-troubleshooter`). That tool showed which checks are worth running; this package
is designed and implemented independently.

### Why

Operator: "we don't use anything from cli, we do everything separately, the cli was just an
inspiration of what the checks were, but we do everything on our own, we start fresh."

---

## 0003 — This repository defines the package API and its guidelines; `documentdb-cli` adapts later

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

The API is shaped by what the extension needs. Once it is stable, `documentdb-cli` is updated to
consume it. The CLI's existing probe shapes are not a compatibility constraint.

### Why

Operator: "we have full ownership … we know our api, then we'll update the cli repo, not an issue
at all, we will establish the guideline and the api."

---

## 0004 — Network checks are driver-free; authentication uses the extension's real connection path

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** agent proposal, operator agreed

### Decision

DNS, SRV, TCP, TLS and the unauthenticated `hello` use Node.js built-ins directly, not the
`mongodb` driver. Authentication, permissions and server facts go through the same path the
extension uses to connect (`AuthHandler.configureAuth`, `prepareDriverConnectionString`, the
driver), with a short-lived client of the troubleshooter's own.

### Why

The driver monitors topology, selects servers and retries. Those layers hide transient failures,
which is right for an application and wrong for a diagnosis that must report the first failure as
it happened. The authentication step is the opposite case: the user's question is "why can the
extension not connect?", so that step must exercise exactly what the extension does, including
Entra ID token acquisition and the SRV fallback.

### Rejected alternatives

- **Driver for everything.** A server selection timeout would be the answer to most questions.
- **No driver at all.** Hand-rolled SCRAM and OIDC would test a reimplementation, not the
  extension.

---

## 0005 — `StatusList` gains a `skipped` status

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** agent proposal, operator agreed

### Decision

`StatusListItemStatus` in `@microsoft/vscode-ext-webview-fluentui` gets a sixth value, `skipped`,
for a stage that did not run because it did not apply or because an earlier stage failed.

### Why

A troubleshooter reports far more "did not run" than a wizard does: no TLS step without TLS, no
SRV step without `+srv`, nothing after an unresolvable host. `pending` reads as "about to run",
which is false once the run has finished.

Operator: "we have full ownership … we know our api … we will establish the guideline and the api."

### Note

`StatusList` is in the published 1.2.0. The new value is additive, so it is a minor release.
Consumers with an exhaustive switch over the union get a type error to fix, and both consumers
in this repository (Local Quick Start, Atlas credentials) narrow the union already.

---

## 0006 — Reports are complete by default; redaction is an explicit option

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

A copied or saved report contains host names, addresses, the user name, replica set names and
certificate subjects as observed. A redaction option (a toggle in the webview, a flag in the
package's report API) replaces them with stable placeholders (`host-1`, `user-1`, …), consistent
within one report.

Secrets are never in a report in any mode: passwords, tokens, client secrets, and the password
component of the connection string. This is not redaction, it is a constraint on what is
collected.

### Why

Operator: "don't redact here, we'll have a flag to redact." A report is most often read by the
person who ran it or by a support engineer helping them, and host names are what both need.

### Rejected alternatives

- **Redact hosts by default** (the original proposal). Rejected by the operator.

---

## 0007 — Two entry points from the start: an error node and a context menu on every cluster

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

1. A "Troubleshoot connection" node appears under a cluster whose connection failed, beside
   "Click here to retry".
2. A "Troubleshoot Connection…" context menu item appears on every cluster node in the Connections,
   Discovery and Azure views, whether or not the connection works.

A command palette entry with a connection picker comes with them.

### Why

Operator: "I'd also just add it to an existing connections as a context menu item. even for a
working connection, it's reassuring to users and easier to test."

---

## 0008 — The surface is a webview built from `@microsoft/vscode-ext-webview-fluentui` components

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

The troubleshooter is a React webview using `Container` and `StatusList`, the components the Local
Quick Start setup step uses.

### Why

Operator: "it is a webview, it uses the elements we have in our ui toolkit." A step-by-step check
with a line of evidence per step is exactly what `StatusList` was built for.

---

## 0009 — Existing workspace packages are used and changed freely

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator

### Decision

The new package may depend on other workspace packages (for example
`@documentdb-js/srv-resolver` for the SRV fallback resolver), whether or not the version it needs
has been published. Those packages are changed or extended when the troubleshooter needs it,
rather than worked around.

### Why

Operator: "we can use our 'local' package, even if it wasn't published yet, we can also update
these packages, we own them all and can change/enhance these a lot."

### Consequence

Publishing order matters: a dependency must be published before a published version of the
troubleshooter package refers to it.

---

## 0010 — The package returns codes and structured facts, never sentences

**Status:** Superseded by 0023 · **Date:** 2026-10-27 · **Raised by:** agent

**Proposed:** checks return a status, finding codes with structured data and facts; every sentence
is written by the consumer, because string extractors do not scan `node_modules`.

**Outcome:** adopted by [0023](#0023--the-research-proposals-are-settled-as-one-bounded-scope), then
amended by [0031](#0031--codes-are-authoritative-english-details-are-a-convenience): codes stay
authoritative, and findings also carry a convenience English detail.

---

## 0011 — Each host runs its checks in a fixed order; hosts run concurrently

**Status:** Superseded by 0023 · **Date:** 2026-10-27 · **Raised by:** agent

**Proposed:** for one host, DNS, TCP, TLS and `hello` run strictly in order; different hosts run
concurrently. Run in parallel for one host, a closed port would also show up as a TLS failure.

**Outcome:** adopted by [0023](#0023--the-research-proposals-are-settled-as-one-bounded-scope), with at
most four host chains in parallel and `dependsOn` meaning required inputs.

---

## 0012 — No standalone "is this machine online" step

**Status:** Superseded by 0023 · **Date:** 2026-10-27 · **Raised by:** agent, from issue #100 step 2

**Proposed:** drop the issue's "ping a public host" step (Node.js cannot send ICMP; a public TCP probe
leaves the machine on every run and is blocked in corporate networks) and, on DNS failure, resolve
one public name to tell "no working DNS" from "name does not exist".

**Outcome:** [0023](#0023--the-research-proposals-are-settled-as-one-bounded-scope) drops both: no
online check and no public-name lookup. `ENOTFOUND` versus `EAI_AGAIN` and the OS versus c-ares
comparison already separate the two cases.

---

## 0013 — Authentication uses the chosen method and nothing else; no method chosen means skipped

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** agent (open gap), operator answered

### Decision

The authenticate step, and the permissions and server facts steps after it, use the
authentication method already chosen for the connection, with the credentials that go with it. A
stored password is the password used. The troubleshooter never prompts for a credential and never
picks a method on the user's behalf.

When no method has been chosen yet, typically a Discovery or Azure view cluster the user has not
connected to in this session, those three steps are `skipped`, and the detail says that no
authentication method has been chosen. Every network check still runs.

"Chosen" means `selectedAuthMethod` on the stored connection, or the method of the credentials
cached for the `clusterId` after a connect in this session. The troubleshooter reads these and
never writes them.

### Why

Operator: "troubleshooter just attempts to use the auth method chosen, so if a password is stored,
that's what's being used. in the scenario when the auth method has not been chosen … e.g. in the
discovery view etc. where we don't know yet which method from the available ones is to be used,
we'd just skip it."

A troubleshooter that prompts would test what the user typed now, not what the extension uses. One
that picks a method would test a configuration the user never chose.

### Rejected alternatives

- **Prompt for a missing password or method.** It changes what is being tested, and a
  troubleshooter opened from an error node should not open a wizard.

### Note

Reading the cached credentials for a method chosen in this session refines design.md §4.9 as first
drafted. That draft said the step never reads `CredentialCache`. It still never writes to it and
never reuses the cached client.

---

## 0014 — The first step says where the checks run

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** agent (open gap), operator answered

> [0030](#0030--rows-have-plain-names-with-the-technical-term-in-brackets) renames the rows; the
> decision is otherwise unchanged.

### Decision

The environment check (design.md §4.1) is the first row of the list, labelled
**"Where the checks run"**. It always passes. Its detail line names the place: "This computer
(Windows 11, x64)", or for a remote extension host, "Remote host: WSL (Ubuntu-24.04), not this
computer". The version facts sit in its facts table.

### Why

Under WSL, SSH, a dev container or Codespaces, the extension host is remote, so every DNS, TCP and
TLS result describes the remote machine's network. A user comparing it with what their own
machine can reach needs to see this before anything else.

Operator: "I guess in the intro? or we can have a step that is the first and just says … then it
will just pass and show what was chosen / selected in the detail text line." The operator left the
label open ("or a better label?"). "Where the checks run" reads correctly both while running and
once done, and names what matters to the user rather than the mechanism ("extension host").

### Rejected alternatives

- **Intro text only.** It is not part of the copied report's step list, and a list that starts at
  "Connection string" reads as if everything ran locally.

---

## 0015 — The context menu item is on cluster nodes only, not on Quick Start instance nodes

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** agent (open gap), operator answered

### Decision

"Troubleshoot Connection…" is contributed for `treeitem_documentdbcluster` only. The Local Quick
Start instance node (`treeItem_quickStartInstance`) does not get it.

### Why

Operator: "only the cluster node, documentdb local is local so it's obsolete." A local container has
no DNS, firewall, allowlist or certificate chain to diagnose, and its failure modes (container
stopped or removed) are already explained by the Quick Start diagnostics provider.

**Correction (2026-10-28):** "no DNS, firewall, allowlist or certificate chain to diagnose"
overstates it: container networking and TLS can fail too. The decision is unchanged, because the
managed instance has its own lifecycle surface and diagnostics provider. Saved connections to a
local server remain in scope.

---

## 0016 — Unavailable authentication inputs mean an explained skip

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator, plan-review follow-up

### Decision

This refines 0013: a missing method is not the only reason to skip authentication. Missing required
credentials, settings or a session that can be used without prompting also produce `skipped`,
with a detail explaining what is unavailable. The dependent connection-access and server-facts
checks skip too; independent network checks still run.

A chosen No Authentication method is valid input. Supplied credentials that are rejected are a
real failure, not a skip. The existing Entra handler must not open sign-in UI in this path; use
silent session acquisition or report the input as unavailable.

### Why

Operator: "step 1 was supposed to be addressed by just accepting missing credentials and stating
that that step has been 'skipped' and explain, no auth data/choice/settings available."

The troubleshooter explains the current configuration; it does not repair it by asking the user
to choose a method or supply different credentials.

---

## 0017 — Cancellation stops the run, not necessarily every operation

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator, plan-review follow-up

### Decision

The public run API is cancellable. Cancellation stops new checks and result delivery immediately.
An in-flight operation may be abandoned from the consumer's perspective and finish or time out
normally. Its eventual result or error is consumed but not delivered, and run-owned resources are
released as it winds down. Fine-grained cancellation inside each dependency can improve later.

The run promise rejects as cancelled, not as a successful diagnostic result. The UI can show that
the user cancelled without waiting for another result from the run.

### Why

Operator: "some steps we can just abandon, not every single detail needs to be cancellable" and
"the process as such should have cancellable api, and cancelled does not report back and just
winds down. the cancellation granularity can be optimized over time."

Requiring every auth, DNS and reachability dependency to support immediate interruption would
delay the feature without improving the basic cancellation experience.

---

## 0018 — Answer the connectivity question, not a general permissions audit

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator, plan-review follow-up

### Decision

Keep the summary simple: did the real connection work, did it fail, or was it not tested because
input was missing? Show the observed failure and a useful next step. Do not add a separate
topology-health scoring system. The run diagnoses the current attempt, not a replay of an old
failure.

Keep the post-connect checks small: database listing and available user/role/server facts.
Reported well-known roles are useful hints, but the troubleshooter does not resolve custom-role
inheritance, calculate effective privileges or issue write probes. A listing denial or unavailable
metadata does not undo a successful connection; explain the limitation separately.

### Why

Operator called the expanded verdict proposal overengineered, questioned the need for original
failure capture, and clarified: "this is a connectivity troubleshooter, not RBAC, configuration,
permissions troubleshooter. the question to answer [is]: can that user connect, and if not, why
might it be failing." Users remain the primary audience; the output should also help support.

Operator also noted that role names are typically well-known and useful in most scenarios. Keep
that evidence rather than dropping it or turning it into a full authorization audit.

---

## 0019 — Start with seed and SRV checks, not recursive topology probing

**Status:** Superseded by 0023 · **Date:** 2026-10-27 · **Raised by:** agent, after operator requested exploration

**Proposed:** probe URI and SRV targets only, record members advertised by `hello`, and take
unreachability evidence from the driver's server-selection errors; a one-hop pass over advertised
members could come later.

**Outcome:** [0023](#0023--the-research-proposals-are-settled-as-one-bounded-scope) keeps seed and SRV
targets only and rejects the one-hop pass: more connections and limits for a case the driver's
errors already reveal.

---

## 0020 — Collect usage and diagnostic telemetry through existing helpers

**Status:** Accepted · **Date:** 2026-10-27 · **Raised by:** operator, plan-review follow-up

### Decision

Instrument how the troubleshooter is used, not only which check fails: entry points, runs and
reruns, cancellations, auth skips, connection outcomes and report actions. Include collection
with the first usable surface, using the existing command/RPC telemetry and
`callWithTelemetryAndErrorHandling`, rather than a separate reporting system.

Reuse `maskSensitiveValuesInTelemetry`, `context.valuesToMask` and whole-error masking.
The extension sends selected categories, measurements and correlation IDs, never reports or
connection-identifying data. Report redaction does not change the telemetry policy. Existing
telemetry enablement controls still apply.

The package stays telemetry-backend-independent: its structured events/results support an
extension-owned mapper, as the SRV resolver does. The detailed event/field plan and existing code
references are in design section 7.

### Why

Operator: "include telemetry collection as we want to know how the troubleshooter is used, look
at other packages how telemetry is added in case it helps. our telemetry helper methods support
suppressing of secrets."

Failure counts alone do not show whether users discover the tool, rerun it, abandon it or use its
report. Existing helpers supply collection and masking, so the feature should reuse them while
keeping local diagnostic output separate from telemetry.

---

## 0021 — Authentication reports sub-steps; `StatusList` gains one level of nesting

**Status:** Superseded by 0027 · **Date:** 2026-10-28 · **Raised by:** operator asked to explore, agent proposal

**Proposed:** Entra ID and managed identity authentication as one Authenticate check with three
sub-steps (Sign-in configuration, Token, Server authentication), shown as nested `StatusList` rows
through a new `children` slot and a `checkStepFinished` event.

**Outcome:** [0027](#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)
keeps the three phases in `CheckResult.steps` (report and Output trace) and drops the nested rows,
the `children` slot and the event: the panel shows no implementation details.

**Rejected alternatives that still apply:**

- **Each phase as a separate top-level check.** Each phase needs the previous phase's session or
  token; passing it through the shared run context exposes a secret to every check, and the runner
  could time out or skip a phase in the middle of one sign-in.
- **A list inside `detail`.** `detail` renders inside a `Text` span; block content there is invalid
  markup.

---

## 0022 — Show diagnostics opens the report read-only; runs leave an Output channel trace

**Status:** Accepted (modified) · **Date:** 2026-10-28 · **Raised by:** operator suggestion, agent proposal

### Decision

1. **Show diagnostics** opens the report as Markdown in VS Code's Markdown preview, backed by a
   read-only virtual `.md` document (an extension of `readOnlyJsonDocumentProvider`). Copy report
   copies the same Markdown; Save report… writes Markdown or, as an alternative, JSON. All three
   render one immutable snapshot of the completed run and never reconnect. The identifier toggle
   applies to all three.
2. Each run writes a short Output channel trace keyed by its run ID, and passes that ID with
   `surface: 'troubleshooter'` to the auth handlers so their existing `[Authentication]` lines join
   it. The trace holds IDs, statuses, codes and durations only (design 6.4).

### Why

Operator: "having some of this diagnostics data would help, maybe in the trace output?" and "add a
button to copy diagnostics, or 'show diagnostics', similar to what we have on query insights where
we allow users to see some raw data - this could contain more diag info for the customer to share
with support." Then, on the proposal: "yes, but have diagnostics shown in md format so that humans
can also read it."

Users read exactly what they would share before they share it. The trace covers the user who closed
the panel without saving a report, at almost no cost, because #1050 already writes the
authentication half.

### Modified from the proposal

The proposal opened JSON in a read-only editor, like Query Insights' "View Raw Explain Output". The
operator asked for Markdown. JSON remains a Save format for tools.

### Rejected alternatives

- **Full facts in the Output channel.** The channel cannot be redacted after the fact and is often
  pasted whole; identifiers belong in the report, where the toggle applies.
- **Re-query on click**, as the cluster dashboard's "Cluster diagnostics" does. The report would no
  longer match what the user just saw.
- **A second diagnostics webview.** The built-in Markdown preview already renders it.
- **Modal dialogs**, as in the preview branch. That was a never-merge diagnostic for one reporter.

---

## 0023 — The research proposals are settled as one bounded scope

**Status:** Proposed · **Date:** 2026-10-28 · **Raised by:** agent, at the operator's request for one plan with no open questions

> Partially replaced by [0031](#0031--codes-are-authoritative-english-details-are-a-convenience):
> codes remain authoritative, but findings also carry convenience English details. Time limits
> and retry behavior are amended by
> [0032](#0032--time-limits-are-timeouts-with-explicit-longer-or-unbounded-retries).
> The original proposal below is retained as history.

### Decision

- **0010, codes not sentences:** adopted. The package exports a closed built-in code union; the
  extension adds its own through a generic parameter, so the package never owns VS Code codes. The
  package also renders Markdown with a consumer-supplied message function.
- **0011, per-host order:** adopted, with at most four host chains in parallel, and with
  `dependsOn` meaning required inputs rather than "everything earlier". Authentication depends on
  a valid connection string and preparation, not on probe verdicts (design 3.1).
- **0012, online check:** neither the issue's "ping a public host" nor the proposed public-name DNS
  lookup. `ENOTFOUND` versus `EAI_AGAIN` and the OS versus c-ares comparison already separate "no
  working DNS here" from "this name does not exist", without contacting anything unrelated.
- **0019, topology depth:** URI and SRV targets only; advertised members are facts; unreachability
  is claimed only from the driver's per-server errors.
- **Budgets:** fixed first-release limits for the run, preparation, SRV, each probe, authentication,
  each post-connect command, targets, addresses, parallel chains and wire reply size (design 3.2).
  A timed-out run produces a report marked as limited.

### Why

Operator: "the outcome is to be one solid plan with no questions open, so that we can evaluate it,
and then move forward with implementation." Each item above took the option the research
recommended, or the smaller one where the research left two. The budgets are new: per-check
timeouts did not bound a large SRV answer or the run as a whole.

### Rejected alternatives

- **One-hop probing of advertised members.** More connections, deduplication and limits for a case
  the driver's errors already reveal.
- **User-configurable limits.** A settings surface for a support tool nobody tunes.

---

## 0024 — The run ends with a Connection summary row that shows the server that answered

**Status:** Superseded by 0029 · **Date:** 2026-10-28 · **Raised by:** operator

**Proposed:** the last `StatusList` row is a derived Connection summary (Connected, Connection
failed, Connection not tested) showing the server that answered, plus a "What to do next" section
below the list.

**Outcome:** [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list) keeps the content and
moves it into a result card below the list: a summary is not a check and needs more room than one
detail line. Operator intent kept: "just for the user to see that we really have connected. nothing
heavy".

---

## 0025 — Authentication is skipped only when the troubleshooter withholds a prompt

**Status:** Proposed · **Date:** 2026-10-28 · **Raised by:** agent, while integrating #1050

### Decision

Authentication is `skipped` only where a real connect would ask the user for something: no method
chosen, no stored password, no silent Entra session. Everything else that stops a real connect is a
`fail`, including #1050's configuration errors: cloud mismatch, invalid `ossrdbmsEndpoint`, unreadable
custom cloud definition, `customCloudUnresolved`, `managedIdentityCloudUnknown`, and a host outside
the OIDC allowlist. A silent "no session" skip records no token failure.

When no silent session is available, the skip detail states that a consent or preauthorization
failure (AADSTS65002) cannot be told apart from "not signed in" without prompting, names the sign-in
log, and shows a token failure #1050 recorded for this connection in the last ten minutes, labelled
"Earlier in this session". That fact never changes the outcome.

### Why

This refines 0016 rather than reversing it: every input 0016 names (method, credentials, session)
is still a skip. 0016 also says "settings", but #1050's settings errors are not prompts the
troubleshooter withholds. A real connect fails with a message naming the setting. Reporting
"Connection not tested" there would hide both the fault and its fix.

The recent-failure fact reads state #1050 already keeps; no capture or replay is added (0018). It is
the only evidence available for the case that motivated #1050.

### Rejected alternatives

- **Skip whenever a setting is missing** (a stashed alternative skipped `customCloudUnresolved` and
  `managedIdentityCloudUnknown`). Disagrees with what a real connect does.
- **An explicit "Sign in and test" action.** It would reveal AADSTS65002 directly, but it is
  interactive sign-in, which 0013 excludes.

---

## 0026 — One first release; later work is named, not open

**Status:** Proposed · **Date:** 2026-10-28 · **Raised by:** agent

### Decision

The foundation (package, network checks, webview, reports, telemetry) and the through-the-server
work (authentication, access, server facts, context hints, summary, user manual) ship together as
the first release. Preparation is part of the foundation, because the probes need the prepared
endpoint. Later, and listed in design section 9 so they are not mistaken for gaps: Azure Resource
Manager inspection of private endpoints; a Troubleshoot button in the connect-failure message (which
revisits sovereign-clouds D10) and the new-connection flow; the reviewed "Open an issue" action;
`documentdb-cli` adoption.

### Why

The draft could release a webview that cannot answer "can I connect", which reads as an answer. The
"Open an issue" action needs its own review of what is prefilled; Show diagnostics and Copy report
already cover sharing.

---

## 0027 — The panel shows one plain Authenticate row; Entra ID details live in the report

**Status:** Accepted · **Date:** 2026-10-28 · **Raised by:** operator

### Decision

The Authenticate check still records its three Entra ID phases in `CheckResult.steps` (0021). The
panel does not show them: it shows one Authenticate row with one plain sentence that says what
happened and who can fix it (design 4.9.2). Cloud, resource, allowlist, token claims, rule IDs,
AADSTS codes and timings are in the Markdown report and the Output trace only.

The same principle applies to every row: the panel says what happened and what to do; the report
says how. Rows have one detail sentence and no facts tables, and the Connection summary line shows
only the host, version and ping.

Consequences: `StatusListItem` needs no `children` slot, so the library change is only `skipped`
(0005); the runner emits no step event; narration is one announcement per check.

### Why

Operator: "on these sub-steps for entraid and gov clouds, do note that I don't want to
over-emphasise this, the details can be in the copied details/reports in md format for the user to
inspect, or for the support to inspect. the data shown in the ui can be simplified on that step as
the user might not be interested in implementation details. from scanning the summary I suspect we
surfaced too much of the implementation details that's not really exciting to the user."

Most users need the outcome and the next step; #1050's messages and the Entra error rules already
say who can fix a sign-in problem in plain words. Support needs the mechanics, and gets them from
Show diagnostics.

### Rejected alternatives

- **Nested phase rows** (0021 as accepted). Puts sovereign-cloud mechanics in front of every Entra
  ID user and needs a library change for it.
- **Collapsible facts tables per row** (earlier drafts). The report shows the same facts, readable
  and shareable, without a second rendering in the panel.

---

## 0028 — A fixed row list with static labels; only detail lines change

**Status:** Superseded by 0029 · **Date:** 2026-10-28 · **Raised by:** operator

**Proposed:** the same eleven rows for every connection, static labels, only the status glyph and
one detail line change during a run.

**Outcome:** [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list) keeps the principle with
eight universal rows and no summary row. Operator: "I don't want to have dynamic status list
entries as this will introduce a lot of layout shifts."

**Rejected alternatives that still apply:**

- **Rows only for checks that apply.** The list length would depend on the connection, and rows
  would appear mid-run.
- **Full explanations in the detail line.** Growing a row at completion shifts every row below it.
- **Truncating long details with an ellipsis.** Hides text from keyboard and screen-reader users.

---

## 0029 — The outcome is a card below a fixed eight-row list

**Status:** Accepted · **Date:** 2026-10-28 · **Raised by:** operator

> [0030](#0030--rows-have-plain-names-with-the-technical-term-in-brackets) renames the rows; the
> decision is otherwise unchanged.

### Decision

1. **The outcome is a card, not a row.** When the run ends, a `MessageBlock` result card expands
   into place below the status list: Connected (with the server version, host and ping), Connection
   failed or Connection not tested (with what was detected, what to do next and the Show
   diagnostics and Copy report actions), or Check cancelled (design 4.13). It replaces both the
   summary row and the separate "What to do next" section.
2. **A universal, fixed set of eight rows**, present from the start and settling top to bottom:
   Where the checks run, Connection setup (connection string and preparation), DNS (SRV and host
   names), Network, TLS, Server handshake, Authentication, Database access (design 5.2). Labels are
   static; rows that do not apply are `skipped` with their reason.
3. **Detail lines are evidence lines**, as in Local Quick Start: `·`-separated segments saying
   what was done and what was detected, sent as semantic segments by the host and formatted by the
   view.

There is no dynamic row set. Design 5.2 lists the cases that seemed to need one and why a fixed row
covers each.

### Why

Operator: "summary should be just a 'card' or a message bar, not a part of the status list", "I'd
need a fixed row set that's universal", "detail line can say more about what's done, what was
detected - look at how documentdb local deals with this", and "if there is a need for dynamic row
set, then convince me to introduce it. my goal is to have a 'set' of checks that runs, and a user
knows where he's at at all times."

Local Quick Start already works this way: fixed stages with static labels, an evidence line per
stage, and its outcome in a `MessageBlock` below the list. A card below the list never moves the
rows above it.

Folding preparation into Connection setup and SRV into DNS makes the set universal: each row applies
to nearly every connection. In the 0028 list, Kubernetes port forwarding and SRV had rows that most
users only ever saw skipped.

### Rejected alternatives

- **A summary row in the list** (0024, 0028). It is not a check, and its content needs more room
  than one evidence line.
- **Card above the list.** It would push the list down when the run ends.
- **Rows per host, per auth phase or per provider step.** See design 5.2, "Why there is no dynamic
  row set".

---

## 0030 — Rows have plain names, with the technical term in brackets

**Status:** Accepted · **Date:** 2026-10-28 · **Raised by:** operator

### Decision

The eight rows are named for what they mean to the user; the technical term follows in brackets
where support and documentation use it:

| #   | Name                     | Was                  |
| --- | ------------------------ | -------------------- |
| 1   | Troubleshooter setup     | Where the checks run |
| 2   | Connection settings      | Connection setup     |
| 3   | Server address (DNS)     | DNS                  |
| 4   | Network connection (TCP) | Network              |
| 5   | Secure connection (TLS)  | TLS                  |
| 6   | Server response          | Server handshake     |
| 7   | Authentication           | unchanged            |
| 8   | Database access          | unchanged            |

The first row's evidence line says where the checks run: "Running on this computer · Windows 11 ·
x64" or "Running on remote host WSL: Ubuntu-24.04, not this computer". 0014's intent, saying where
the checks run before anything else, is unchanged; only its label moves into the detail line.
Final wording, including translations, is settled in the UX review.

### Why

Operator: "think of better names for the rows, like DNS and TLS.. these sound like 'network' to
'regular users', so you can have these acronyms in brackets but have better names. also 'where the
checks run' feels out of place, call it differently, or discuss options in chat, like
'Troubleshooter initialization', and then the detail line will say what it is."

"Troubleshooter setup" is shorter than "Troubleshooter initialization" and reads as a step of the
run, as every other label does. "Connection settings" replaces "Connection setup" so the two
"setup" labels do not sit next to each other. "Server response" says what the step observes: the
server answered as a database server. "Handshake" is protocol vocabulary.

### Rejected alternatives

- **Troubleshooter initialization.** Accurate but long, and "initialization" is developer
  vocabulary.
- **Getting started, Check environment.** The first reads like onboarding; the second like a
  system scan.
- **Action phrases** ("Finding the server", "Securing the connection"), as Local Quick Start's
  labels are. They read well while running but describe an activity after it finished; noun labels
  stay true in every state.
- **Acronyms alone.** "DNS", "TCP" and "TLS" all read as "the network" to most users.

---

## 0031 — Codes are authoritative; English details are a convenience

**Status:** Accepted · **Date:** 2026-10-29 · **Raised by:** operator

### Decision

Replace 0023's adoption of "codes, never sentences": the API returns stable codes and structured
data **plus an English detail for convenience**. The extension continues to use only codes and
data to produce its own localized messages. It never parses or falls back to the English text.
Both the feature README and the package README explain this distinction and list the codes; the
package README also documents the concrete data fields when the unions are implemented.

The proposed representation is a required `detail: { language: 'en', text: string }` on each
finding, including consumer-added findings. `language` is a BCP 47 tag; it labels the returned
text, not a locale-negotiation capability. The operator suggested a language-tagged object; the
field names are an agent-selected implementation proposal, not explicitly approved API spelling.
English text is sanitized, redacted and escaped under the same rules as other report data.

### Why

Operator: the API "should actually also return a detail in english"; "our implementation will use
codes only so that it can localize its own messages"; the English response is "for convenience".
The operator also asked whether the response should be an object with a language tag.

This keeps machine behavior independent of wording while making a raw response useful to a CLI
consumer or support engineer without a separate message catalogue. The cost is maintaining
English templates alongside the extension's localized message table and testing that they cannot
leak secrets or become an accidental localization fallback.

### Rejected alternatives

- **Codes and facts only.** Smallest API, but does not meet the English-detail requirement.
- **English strings as identifiers or localization fallback.** Couples behavior to wording and can
  mix English into the extension's localized UI.
- **Locale negotiation now.** No requested need; a language tag is not a promise of translations.

---

## 0032 — Time limits are timeouts, with explicit longer or unbounded retries

**Status:** Proposed · **Date:** 2026-10-29 · **Raised by:** operator requirements, agent-selected defaults

### Decision

The operator requires timeout terminology, a way to retry after a diagnostic timeout with
relaxed or removed diagnostic timeouts, and at least ten seconds as the default for DNS and
`hello`. Use `*TimeoutMs` API fields. Distinguish a started operation's `check.timeout` from
unstarted work's `skipped/runTimeoutExceeded`; this replaces `budgetExceeded`.

The agent proposes ten-second defaults for all four network probes and a 300-second whole-run
timeout. Preparation stays 15 seconds, SRV/TXT 10, authentication 45 and post-connect commands
5 each. A longer-timeout retry doubles every diagnostic timeout; a no-diagnostic-timeout retry
sets all of them to `null` and warns that cancellation may be needed. No persistent settings or
automatic probe retries. Each retry creates a fresh run; previously opened or exported reports
stay unchanged, without adding report history.

Shorter connection-configured timeouts still win and are not changed by a retry. Target,
address, concurrency, reply-size, report and security limits stay in force. Disabling diagnostic
timeouts cannot remove OS, resolver or driver limits or make non-abortable I/O cancellable.

The 300-second default, doubled retry profile and precise API spelling are proposed choices, not
operator-approved measurements. The explicit requirements above come from the operator.

### Why

Operator: when a run fails because of its "budget", the user should be able to retry with
"relaxed/removed budgets"; "let's be clear in the docs and code, these are timeouts"; five seconds
for DNS or `hello` seems too short, with "a minimum 10 seconds".

The agent's sizing rationale: 16 hosts in four concurrent chains, with four ten-second probes
each, can take 160 seconds before the real connection attempt. Preparation, SRV, authentication
and five post-connect commands bring configured work to about 255 seconds before overhead.
Keeping the old 120-second whole-run timeout would knowingly cut that coverage short. A
300-second default gives more room but makes black-holed paths slower; explicit cancellation
and retry profiles keep that trade-off visible. Measurements should validate the defaults.

### Rejected alternatives

- **Keep five-second default probes.** Does not meet the operator's requested minimum.
- **Only increase the whole-run timeout.** Does not help when a per-probe timeout ends work early.
- **Remove all limits by default.** Risks indefinite waiting; only diagnostic timeouts can be
  explicitly removed, never safety or security limits.
- **Silently lengthen the saved connection's timeouts.** Changes real connection behavior outside
  the diagnostic run.

---

## 0033 — Network failures mention possible firewall blocking; cloud helpers come next

**Status:** Accepted · **Date:** 2026-10-29 · **Raised by:** operator

### Decision

For transport failures, server-selection timeouts and otherwise unexplained inability to reach
the server, the final result card and report next steps mention a firewall or IP allowlist as
one possible cause. Say where the probes ran, so a remote extension host does not send the user
to the wrong computer's network rules. More specific evidence remains first. An isolated parse,
certificate-validation or credential-rejection failure does not acquire a misleading firewall
diagnosis.

The first release gives generic guidance and reuses existing provider hints; it does not inspect
cloud firewall configuration or modify rules. Cloud-platform-specific firewall configuration
helpers are planned for the next iteration.

### Why

Operator: failure "can be due to a firewall configuration"; "the final message should mention
that this is a possibility"; "in the next iteration we'll have cloud platform specific helpers
for firewall configs".

A timeout or a closed handshake cannot prove which firewall or allowlist blocked traffic.
Possibility language gives a useful next step without inventing evidence or promising a cloud
configuration inspection the first release does not perform.

### Rejected alternatives

- **Assert that the firewall caused the failure.** Client-side evidence is insufficient.
- **Put the hint only in the detailed report.** The operator asked for the final message.
- **Include new cloud firewall helpers in the first release.** The operator placed them in the
  next iteration.

---

## 0034 — Compression and clock offset come from the handshake; DocumentDB answers as a gateway

**Status:** Accepted · **Date:** 2026-10-29 · **Raised by:** operator asked which checks from another tool's connection test are worth adding; agent researched; operator agreed

### Decision

1. **Compression.** The consumer supplies the compressors it can use (`availableCompressors`).
   `cs.compressorUnavailable` (warning) flags a connection-string compressor the extension cannot
   use. The handshake probe offers the connection string's compressors as the driver does, and
   `hello.compressorUnavailable` (error) is raised when the compressor the driver would choose is one
   of them (design 4.2, 4.8).
2. **Clock offset.** The handshake probe computes the local clock's offset from the server's
   `localTime`, with half the round trip as uncertainty. Always a report fact; `hello.clockOffset`
   (info) beyond five minutes; supporting evidence for certificate-validity and Entra ID token
   failures, never a failure itself (design 4.8).
3. **DocumentDB topology.** A router-style reply (`msg: "isdbgrid"`) carrying
   `internal.documentdb_versions` is a DocumentDB gateway and is shown as such; replica set facts
   apply to MongoDB API servers only (design 4.11, 5.2).

No new rows: these are evidence on Connection settings and Server response.

### Why

The operator shared another tool's "Test MongoDB Connection" dialog and asked which of its checks
make sense here, researched first.

- **Compression:** the extension bundles neither `snappy` nor `zstd`; `zlib` is part of Node.js. The
  driver (7.2) loads these modules only when it first compresses a message, and its
  `uncompressibleCommands` list includes the handshake and `saslStart`/`saslContinue`. It uses the
  first compressor in the connection string's order that the server accepts
  (`StreamDescription`). So `compressors=snappy` against a server that accepts snappy connects and
  signs in, then fails on the first command with "Optional module `snappy` not found". That is
  confusing, would surface under Database access after Authentication passed, and happens with
  connection strings pasted from other tools. The DocumentDB gateway's handshake reply has no
  `compression` field, so DocumentDB itself is not affected.
- **Clock offset:** both MongoDB and the DocumentDB gateway (`ismaster.rs`) return `localTime`, so
  the measurement costs nothing. A wrong local clock explains "not yet valid" and "expired"
  certificate errors, and the sign-in library judges cached token validity by the local clock.
- **Gateway topology:** while checking the gateway's reply, it turned out to always answer as a
  router (`isdbgrid`), never as a replica set. The plan's example "Replica set rs0 · primary found ·
  DocumentDB" was wrong for DocumentDB.

### Rejected alternatives

From the same dialog:

- **Reading server status.** Heavy, often needs privileges, not about connectivity; excluded
  earlier for the same reasons.
- **Feature compatibility version.** Needs administrator rights, describes available features
  rather than connectivity, and DocumentDB does not model it.
- **SSH tunnel validation.** The extension has no SSH tunnels; Kubernetes port forwarding and
  remote extension hosts are already covered.
- **Connect and disconnect stages as rows.** Stages, not checks; cleanup is guaranteed and would add
  rows that are always green.

---

## 0035 — Azure VM targets keep the existing port prompt when the troubleshooter reads credentials

**Status:** Superseded by 0036 · **Date:** 2026-10-29 · **Raised by:** agent, from the Milestone B code review

**Proposed:** Azure VM nodes keep their existing port input box when the troubleshooter reads the
connection, because VM discovery data has no port and probing a guessed port would misdiagnose a
refusal.

**Outcome:** [0036](#0036--the-troubleshooter-reads-connection-details-silently-and-prepares-kubernetes-tunnels-only-in-prepare)
replaces it. Its premise that Kubernetes discovery starts no tunnel was wrong (ClusterIP services
did), so every node now has a silent diagnostic read; the VM port prompt survives as 0036 point 4,
cancellable and reusing a port already entered in the session.

---

## 0036 — The troubleshooter reads connection details silently and prepares Kubernetes tunnels only in `prepare`

**Status:** Accepted for points 1 and 2 (the operator chose option A for pre-review R1 and R2) ·
Proposed for the port policy (point 3) and the Azure VM refinement (point 4), set by the orchestrator ·
**Date:** 2026-10-30 · **Raised by:** pre-review findings R1 and R2
([01-implementation-review.md](./iterations/01-implementation-review.md))

**Corrects:** [0035](#0035--azure-vm-targets-keep-the-existing-port-prompt-when-the-troubleshooter-reads-credentials).
Its premise "Kubernetes discovery does not start a tunnel there" was wrong: for a ClusterIP service the
troubleshoot command called the discovery node's ordinary `getCredentials()`, which showed a local-port
input box and started a port-forward tunnel before the run, outside the `prepare` check, its timeout and
the report.

### Decision

1. **A diagnostic read for every cluster node.** `ClusterItemBase.getCredentialsForDiagnostics({ signal })`
   shows no notification, warning or error dialog, starts no tunnel, and lets failures propagate as
   typed errors: the source could not be read (`ConnectionSourceUnavailableError`, with the source:
   Azure, Kubernetes, Atlas), the source has no endpoint (`ConnectionEndpointUnavailableError`), or the
   user dismissed an accepted prompt (`ConnectionInputCancelledError`). `undefined` still means the
   connection no longer exists. Azure, Kubernetes and Atlas nodes run the same reads as
   `getCredentials()`, inside their existing telemetry scopes with `rethrow` and `suppressDisplay`.
   Ordinary connect, copy and save flows keep `getCredentials()` and are unchanged.
2. **Resolution inside the run, as typed outcomes.** A run-scope check, `resolveTarget`, reads the
   target before the connection string is checked. It shares the **Connection settings** row (no new
   row), declares no timeout kind of its own, and is bounded by the whole-run timeout and Cancel. On
   either, the read is abandoned ([0017](#0017--cancellation-stops-the-run-not-necessarily-every-operation));
   a late result is discarded and the read performs no side effect after its signal aborts. Its
   failures are findings: `target.notFound` (connection deleted, or ARM or Kubernetes report 404),
   `target.inputCancelled`, `target.sourceInaccessible` (with the source and a classified reason:
   sign-in required, access denied, unreachable, not connectable, other) and `target.endpointMissing`.
   The panel and card use fixed wording per outcome; the report and Output trace carry the source,
   reason, an allow-listed error name and an HTTP status, never the error message. Context hints pass
   the underlying error to `ConnectionDiagnosticsService`, as for a connect failure.
3. **Kubernetes port policy (Proposed).** The diagnostic read of a ClusterIP service returns the
   localhost endpoint and port-forward metadata. The local port is the port of a tunnel already
   forwarding the same service (source, context, namespace, service, service port), otherwise the
   configured strategy's existing suggestion (`matchRemote`: the service port; `autoSelect`: the first
   free port from the base). No input box. The `prepare` check starts or reuses the shared tunnel
   non-interactively: if the port is occupied, the tunnel manager does not show its "Use existing"
   dialog and `prepare` fails with `prepare.localPortInUse`. A tunnel `prepare` started or reused is the
   normal shared tunnel and stays open after the run; `prepare.sharedTunnel` (info) says so in the
   report and its code appears in the Output trace.
4. **Azure VM port (Proposed; refines 0035).** The port prompt stays the single prompt the
   troubleshooter can show. It now receives a cancellation token tied to the run's signal, so Cancel,
   the whole-run timeout or closing the panel dismisses it; dismissing it reports `target.inputCancelled`
   and the card says **Connection not tested**, not "This connection is no longer available". A port the
   user already entered for this VM in the session (the cached connection string) is reused without
   asking. No new persistence was added: this branch has no record of recent connection attempts.

### Why

- "The troubleshooter never prompts" ([0013](#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped),
  [0016](#0016--unavailable-authentication-inputs-mean-an-explained-skip), design §5.3) and "only this
  check prepares the endpoint" (design §4.3) are contracts; a pre-run read that prompts and starts a
  tunnel broke both, and every Re-run repeated the prompt.
- For a discovered connection, failing to read the endpoint is itself a connectivity problem. Reported
  as "no longer available", the real cause was in a separate notification, or lost.
- A read before the runner started was outside the 300-second whole-run timeout, left every row pending,
  and could not be cancelled; an input box it opened stayed on screen and could still start a tunnel.
- The eight rows and their layout are fixed ([0028](#0028--a-fixed-row-list-with-static-labels-only-detail-lines-change),
  [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list)); Connection settings already
  hosts the connection-string, credentials and preparation checks.
- The port policy reuses what an ordinary connect would use (a running tunnel, or the configured
  suggestion), so the check tests the tunnel the user actually has; a port conflict is a finding the
  user can act on rather than a choice the troubleshooter makes for them.

### Rejected alternatives

- **Option B for R1: accept a Kubernetes prompt exception.** Least work, but leaves the pre-run side
  effects and repeated prompts and does not fix timing or cancellation.
- **Option B for R2: a timeout around the pre-run read and a new generic message.** Bounds waiting, but
  the root cause stays lost, the UI and late side effects remain, and a wrapper cannot dismiss a prompt
  it does not own.
- **Resolving inside the `prepare` check itself.** `prepare` needs the connection string the
  resolution supplies, which the connection-string check validates first; and the Azure VM prompt cannot
  sit under the 15-second preparation timeout.
- **Choosing another free port silently on a conflict.** It would test a different tunnel from the one
  saved connections and ordinary connects use; the operator asked for a finding.
- **Changing the package runner to accept a lazily resolved input.** The extension passes the resolved
  input to its checks through a context overlay instead; the package API is unchanged.

### Consequences

- A dismissed Azure VM prompt shows **Connection settings** as an error row ("Port not provided") with
  a **Connection not tested** card.
- Azure SDK, Kubernetes client and storage calls are not cancelled; they are abandoned and their
  results discarded (0017).
- Whether every Azure sign-in failure carries a recognizable shape (status 401 or a known error name)
  was not verified against a live subscription; an unrecognized one is reported as "Azure details
  unavailable" with its error name in the report.

**Choice and confidence:** points 1 and 2 are the operator's choice. Point 3: about 80% (the existing
suggestion is deterministic for `matchRemote`, the default; `autoSelect` can pick a different free port
on each run when no tunnel is running). Point 4: about 75% (reusing the session's cached port is a
judgment; the prompt otherwise behaves as before).

**Commits:** `f0ea55e6` (diagnostic reads), `d032c9f0` (non-interactive preparation), `1ac3714d`
(resolution inside the run, typed outcomes).

## 0037 — The panel borrows the wizard chrome but has no steps

**Status:** Proposed · **Date:** 2026-10-30 · **Raised by:** operator request

**Context:** the operator asked to "mimic the wizard ui to the troubleshooter (icon, title, two steps …)",
added "I don't think we need steps here, but look at what we did with documentdb local wizard and reason
about it", and asked that the panel use the wizard building blocks from
`@microsoft/vscode-ext-webview-fluentui`.

**Decision:** the panel keeps composing `Container` directly and takes the wizards' chrome, not their
steps. `ContainerHeader` gets the DocumentDB Local and MongoDB Atlas pattern: a media icon
(`NetworkCheckRegular`, already used for the dashboard's connection check), the title "Troubleshoot
connection", the connection name and the live run status as two subtitle lines, and **Give Feedback**
when feedback is permitted. `ContainerBody` uses the wizards' `contentMaxWidth="760px"`. There is no
`Wizard`, `WizardStep` or `StepList`.

**Why no steps.** A wizard's steps are places in a task that the user moves between, and Local Quick
Start needs them because the user reads, then chooses settings, then waits, then sees a different
"done" screen. The troubleshooter has none of that:

- It starts on open and asks for nothing, so a first step would be a screen nobody chose to be on.
- The eight rows already answer "where am I?" ([0028](#0028--a-fixed-row-list-with-static-labels-only-detail-lines-change)):
  they settle top to bottom and stay put. A step indicator would be a second, coarser progress
  indicator next to a finer one.
- A wizard mounts only the active step. A "Checks → Result" split would either hide the rows when the
  card appears, against [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list) ("a card below
  a fixed eight-row list", which the user reads together), or show the same content in both steps.
- A step change moves focus to the new step's heading (WCAG 2.4.3). Finishing a run would then take
  focus away from wherever the user was, which is what the R5 fix avoids: focus moves only when the
  focused control disappears. Every re-run would also have to send the user back to step one.

**Alternatives:**

- **Wizard chrome, one screen (chosen).** Same visual language as the two wizards; no new controls or
  focus targets apart from Give Feedback, which never unmounts.
- **Two-step `Wizard` ("Checks", "Result").** Rejected for the reasons above.
- **One-step `Wizard`.** Renders a step indicator with a single item and a second heading for the same
  content; the indicator conveys nothing.
- **Keep the old header** (connection name as the title, status as the subtitle, no icon or feedback).
  Rejected by the operator's request for the wizard look.
- **Connection name and status on one subtitle line.** Tried first; in narrow panels the line wrapped only
  while running ("Elapsed 0:12" is longer than "Checked at …"), so the list moved when the run ended,
  which the design forbids. Two block lines keep the list at one offset.
- **A `navPosition="none"` option in the package** instead of the existing `className` override that drops
  the empty `nav` row. The Container README documents the override for exactly this; a package API can
  follow if another single-screen surface needs it.

**Choice and confidence:** about 85% confident in no steps. Recorded as Proposed because the operator
framed it as a question.

**Commits:** `1dd7793a` (WI-15).

## 0038 — The feature is called Diagnose connection

**Status:** Accepted · Partly superseded by [0051](#0051--internal-names-follow-the-feature-connection-diagnostics) · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** the operator accepted the naming proposal and added: "also internal docs, and command
id can change, nothing has shipped yet."

**Decision:** call the feature **Diagnose connection** and describe its work as **connection
diagnosis**, in the UI, the user manual and maintained internal docs. Replace the command ID
without an alias: nothing has shipped, so there is no compatibility contract to preserve.

**Why:** the feature only looks: it runs read-only checks, never changes anything to fix a
connection and never prompts for sign-in. It appears on every cluster's context menu, so its name
must invite running it on a healthy cluster too. "Troubleshoot" suggests something is already broken
and implies fixing; "Diagnose" says it finds the cause.

| Surface                                | Name                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| Context menu and Command Palette title | **Diagnose Connection…**                                   |
| Command ID                             | `vscode-documentdb.command.diagnoseConnection`             |
| Child item under a failed cluster      | **Diagnose this connection…** (tree ID suffix `/diagnose`) |
| Panel tab                              | **Diagnose: {0}**                                          |
| Panel header                           | **Connection diagnosis**                                   |
| Command Palette picker placeholder     | **Select a connection to diagnose**                        |
| First check row                        | **Diagnosis setup**                                        |
| Output trace prefix                    | `[Connection diagnosis]`                                   |

Other feature text uses diagnose/diagnosis wording. **Show diagnostics** stays as it is. The
existing **Connection diagnostics** report heading and document title, and
`connection-diagnostics-<timestamp>.md` default filename, already fit the diagnostics wording and
stay unchanged. The manual moves from `troubleshoot-connection.md` to `diagnose-connection.md`,
with all links updated, including historical links that would otherwise break.

**Alternatives:**

- **Keep "Troubleshoot".** A familiar search term, matching Azure Network Watcher's "Connection
  troubleshoot", but it implies brokenness and fixing.
- **Check Connection.** Sounds like a single ping.
- **Test Connection.** Users expect a quick pass/fail before saving.
- **Connection Health Check.** Implies ongoing monitoring.
- **Why can't I connect?** Wrong on a healthy cluster.

**Deliberately unchanged, to limit churn:**

- Source folders and file names: `src/troubleshooter/**`, `src/commands/troubleshootConnection/**`
  and `src/webviews/documentdb/connectivityTroubleshooter/**`; class, function and type names.
- The package `@documentdb-js/connectivity-troubleshooter` and its folder, and the feature docs
  folder `docs/ai-and-plans/features/connectivity-troubleshooter/`.
- Explicit telemetry event and property names and source values, including the picker's
  `telemetrySource: 'troubleshootConnection'`. The automatic command telemetry value derived from
  the command ID follows the new ID; it is not separately renamed or aliased.
- Webview and router IDs, L2-dev routes (`/connectivityTroubleshooter/...`), and the survey
  feedback source `connectivityTroubleshooter`.
- Existing decisions' text and headings, iteration history and `CHANGELOG.md`; only links made
  invalid by the manual move are repaired. Generic troubleshooting guidance for other features is
  not the name of this feature and is not renamed.

These implementation identifiers do not appear as feature names in the UI; renaming them would
create unnecessary churn without helping users recognize the read-only action. The note at the top
of the maintained README and design connects the old name to this one, so older reasoning remains
understandable.

## 0039 — Rows expand to show their findings and the evidence behind them

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** a real run against an Azure DocumentDB cluster from WSL showed a warning icon on
Server address (DNS) while the row said everything resolved. The cause
(`dns.privateEndpointPublicAddress`) appeared only in the report's Findings table: the panel had no
way to say why a row was not green. The operator also wanted to see what a name resolved into and
which options "2 options" meant. Of the ideas offered (inline title, result-card summary,
expandable rows, a details pane, tooltips), the operator chose expandable rows and asked for a
prototype (WI-18), then accepted it after a UX test with two changes: the Connection settings row
lists its options, and each Details button must clearly belong to its row.

**Decision:**

- A finished row offers a **Details** disclosure, placed on the row's title line, when it has
  findings or evidence worth showing. Expanding it shows findings first (error, warning, info),
  as panel-safe title, explanation and next step, then the row's evidence: connection settings
  and every option (secrets shown as "(hidden)", TXT-record options marked), SRV record and per-host
  alias chain and addresses, TCP addresses, TLS certificate facts, server facts, authentication
  method, and database commands. Rows that are still running never offer details.
- **Rule:** a row with a warning or error status always has details that explain it.
- Accessibility: a real button with `aria-expanded` and `aria-controls`, an accessible name
  containing the row name, the most severe finding as its accessible description, no hover-only
  content, and no focus movement on expand or collapse. A new run collapses every row.
- With Hide identifiers on, details use the report's placeholders (`host-1`, `user-1`, ...).
- `StatusListItem` in `@microsoft/vscode-ext-webview-fluentui` gains an optional `disclosure`.

**Amends:** [0027](#0027--the-panel-shows-one-plain-authenticate-row-entra-id-details-live-in-the-report)'s
rejection of per-row facts tables and design 5.2's "What the panel never shows" list, for the
expanded state only. Codes, URIs and timings other than ping still stay out of the panel.

**Alternatives:** the finding title in the row line (kept as a possible addition: it names the
cause but not the reason); an "Also found" section on the result card (review R6, still open);
a selectable list with a details pane (a larger interaction change); tooltips (fail keyboard,
touch and screen-reader users); a link into the report (takes the user out of the panel).

**Open after the UX test:** whether healthy rows should offer details at all; whether warning or
error rows should look different or start expanded; whether Hide identifiers should also cover
row lines and the result card (today only details and the report are redacted); Entra ID
sovereign-cloud details for the Authentication row (README "Open gaps").

**Commits:** `f9420b0b` (prototype, including both requested changes).

## 0040 — Hide identifiers applies to the report only, and sharing a report with identifiers asks first

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** after the WI-18 prototype, the operator wrote: "I'm fine with showing all details,
tbh, I'd like to hide these identifiers in the diagnostics file only." With Hide identifiers on,
the expanded row details showed the report's placeholders (`host-1`, `user-1`, ...) while the
evidence lines and the result card kept the real names, so the panel was half redacted. The
operator also asked for a modal warning, through the tRPC dialog feature, before a report with
identifiers is shared; to move the row's **Details** button onto the row's evidence line, "then my
headers are just headers in the list"; and to call **Show diagnostics** **Show report**.

**Decision:**

- **Hide identifiers applies to the report only.** The panel always shows full identifiers, in the
  rows, the details and the result card; toggling it changes nothing in the panel. The panel's row
  details carry one copy, not a full and a redacted one, and the host no longer builds the redacted
  copy. The report's own redaction (`renderMarkdown` and `renderJson` with `redact`) is unchanged,
  and the choice still applies to Show report, Copy and Save.
- The toggle is a link inside the footer's info line: "The report will include host and identity
  details. **Hide identifiers in the report**. Review the report before sharing." With it on: "The
  report will replace host and identity details with placeholders. **Show identifiers in the
  report**. Review the report before sharing."
- **A modal warning before sharing a report with identifiers.** With Hide identifiers off, Copy
  report and Save report… first show a modal warning dialog: "This report includes host and
  identity details." / "Host names, addresses and the user name are not hidden. To hide them,
  cancel, select Hide identifiers in the report, and then share again." Its one button names the
  action (**Copy report** or **Save report**); VS Code adds Cancel. Cancel shares nothing and
  shows no error, and the panel stays as it was. Show report gets no warning: it opens the report
  locally, for the user to read. With Hide identifiers on, there is no warning.
- The dialog is a new, generic common tRPC procedure, `common.confirm` (`{ message, detail?,
confirmLabel, severity? }` → `{ confirmed }`), which the webview calls before `copyReport` or
  `saveReport`. It is not routed through the destructive-action confirmation-style setting.
- Telemetry: `copyReport` and `saveReport` record `shareWarning` (`shown` or `notShown`) and, when
  shown, `shareWarningOutcome` (`continued` or `cancelled`). After a cancel, the webview calls the
  same procedure with `shareWarningOutcome: 'cancelled'` only to record it: the procedure shares
  nothing and records the result as `Canceled`, never `Failed`.
- The **Details** toggle ends the row's evidence line, inline after its text, in that line's type
  size and line height, so collapsed rows keep one height and the row titles are plain headings.
  A long evidence line wraps around it like a word. `StatusListItem`'s `disclosure` gains a generic
  `placement` (`label` or `detail`).
- **Show diagnostics** is renamed **Show report** in the UI. The report's own document title
  ("Connection diagnostics") and default file name stay.

**Why:** the panel is the user's own investigation view; redaction matters only when a report
leaves the user. Showing everything in the panel and redacting only the report keeps the intent of
[0006](#0006--reports-are-complete-by-default-redaction-is-an-explicit-option): complete by
default, redaction an explicit choice. The warning sits where identifiers would actually leave:
Copy and Save.

**Amends:** [0006](#0006--reports-are-complete-by-default-redaction-is-an-explicit-option) (the
choice no longer touches the panel, and sharing with identifiers now asks first),
[0022](#0022--show-diagnostics-opens-the-report-read-only-runs-leave-an-output-channel-trace)
(Show diagnostics is now Show report; the identifier toggle still applies to Show report, Copy and
Save, and Copy and Save now ask first when identifiers are included) and
[0039](#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them) (details no longer
use placeholders; the toggle moves from the title line to the evidence line). Their text is left
as it was.

**Alternatives:**

- **Drop redaction entirely.** Editing a report of about 300 lines by hand is error-prone, and the
  placeholders keep the report's cross-references intact.
- **A panel-wide toggle.** It hides the user's own data from themselves and suggests the panel is
  sanitized, while screenshots of it are not.
- **Choose redaction per share action** (separate menu items such as "Copy report without
  identifiers"). More menu items; the operator preferred the inline toggle plus a warning.

**Commits:** `49103c14` (`StatusListItem` placement), `e8961970` (`common.confirm`), `98ba0437` (panel, share warning, Show report).

## 0041 — The panel never names DNS libraries, and the result card is a short outcome summary

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator; the wording, the card's
content and its typography are the agent's call (WI-20)

**Context:** two operator observations after WI-19. First, on DNS: "why would a user care that it's
c-ares... it's all about c-ares in our code due to a bug in there, but once it's gone it's gone and I
would not mention every library that is sometimes failing. maybe it makes sense in the report... at
least for the happy path, stating that something and c-ares agree... this kind of complexity is hard
to grasp for a user." Every healthy Server address (DNS) row's details said "Resolvers: System and
c-ares agree" and "Answered by: System resolver". Second, on the card: "today the happy path says
'connected' even if it's not really the case... the task is connection diagnostic - that's the title.
so make the summary cards aligned with the title and the content", and "the layout is hard to read,
labels and some values have all the same formatting. now, with the details in place, maybe this can
be simplified."

**Decision:**

- **The panel never names a DNS library.** No "c-ares", "getaddrinfo" or "OS resolver" in row lines,
  details, the card or accessible text. What matters to a user is either that _your system's lookup_
  (hosts file, VPN, split DNS) and _a direct query to your DNS servers_ gave different answers, or
  that _this VS Code version_ has a known DNS issue the extension works around.
  - `dns.resolversDisagree`: "Name lookups disagree". Its next step no longer says only "the
    connection uses the system resolver", which was wrong for SRV: host names use the system lookup,
    but a mongodb+srv server list comes from a direct DNS query.
  - `env.caresRejectsCompressedSrv`: "Known DNS issue in this VS Code version", with no next step:
    the fallback is on unless an environment variable turns it off, and no fixed release exists.
  - `srv.compressedReplyRejected`: "DNS workaround used for the server list" (no next step), or
    "Server list could not be read" with what to do when the workaround failed or is turned off.
  - DNS details: one "Addresses" line when the two lookups agree; "Your system's lookup" and "Direct
    DNS query" only when they differ or one fails. The SRV block says "Lookup: Read with the
    extension's DNS workaround" only when the fallback ran, and no longer "Answered by".
  - **The report may name the libraries.** Support engineers read it, so its Findings table keeps the
    panel's title but explains these three findings technically, introducing "c-ares (Node.js's DNS
    resolver)" and getaddrinfo. Report field names and the JSON structure are unchanged.
  - A test scans every panel-facing string and the panel payload for `c-ares`, `cares`, `c_ares` and
    `getaddrinfo`, and every L2-dev route forbids them.
- **The result card is a short outcome of the diagnosis, and the facts live in the rows' Details.**
  - Headlines: "Connection successful"; "Connection successful, with 1 warning" (or N warnings);
    "Connection successful, but 1 check failed" (or N); "Connection successful, but N checks need
    attention" for both; "Connection failed at <row>"; "Connection not tested"; "Diagnosis stopped at
    the time limit" when the whole-run timeout came before sign-in; "Diagnosis cancelled";
    "Diagnosis did not finish". The section subtitle uses the same "Diagnosis cancelled" and
    "Diagnosis did not finish". The report's outcome label is "Connection successful".
  - A successful card is one sentence ("All checks passed. Sign-in succeeded and the database
    answered."; without authentication, "All checks passed. The database answered."), or "The
    connection works, but these checks need attention:" and each warning or failed row with its most
    severe finding, then "Select Details on a row to see why and what to do." This answers review R6.
  - A failed card says what failed (the finding title and its host), why (the explanation), and
    "Next:", then any supporting evidence, provider and firewall hints, and finally the support line,
    after any retry note.
  - Server version, API version, ping and the answering host leave the card: Server response and
    Database access Details already show them. No identifier is kept in a successful card: the
    section heading names the connection, and a failed card names the host its finding is about.
  - Typography: the headline is a level-3 heading (`role="heading"`, under the connection's h2) at
    `fontSizeBase400`, semibold; the body is the default body text; the failure's cause line is
    semibold; labels ("Next:", "Also detected:") are semibold in `colorNeutralForeground2`; each
    attention row's name is in `colorNeutralForeground2`; the Details pointer and the support line
    are captions (`fontSizeBase200`, `colorNeutralForeground2`). Checked in light, dark and high
    contrast.
  - Unchanged: the card's actions (the two retries), the R5 focus fallback, and the announcement,
    which is still the headline.

**Why:** the library is an implementation detail that changes with Node.js; naming it makes a healthy
row look complicated and tells the user nothing they can act on. The panel's title is "Connection
Diagnostics", so the card reports the diagnosis: whether the connection succeeded and what needs
attention, or where it failed, or why the diagnosis stopped. Since 0039 every row has Details, so a
facts line in the card repeats them; a short summary with one clear hierarchy is easier to read.

**Amends:** [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list) (the Connected card's
"server version, host and ping" content and its title), design 4.13 (the card's lines and the
"1 warning: <row>" line) and [0039](#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them)
(the DNS evidence "by resolver", and its "Also found" alternative tied to review R6). Their text is
left as it was.

**Alternatives:**

- **Keep the library names and add a glossary or tooltip.** Explains a term the user does not need,
  and tooltips fail keyboard and touch users.
- **Hide resolver information entirely.** Loses the one case that matters: with a VPN or split DNS,
  the system and a direct query really can disagree, and the details should show both answers.
- **Keep a facts table in the card with styled labels.** Fixes the typography but still repeats the
  Details; the card would grow with every fact a row already shows.
- **Keep the answering host in a successful card for orientation.** The section heading already
  names the connection; the host that answered is one expand away in Database access.
- **"Connected" or "Connection works" as the headline.** "Connected" read as a state rather than a
  diagnosis result; "Connection successful" pairs with "Connection failed at <row>".
- **Name only warning rows (the old "1 warning: <row>" line).** A connected run with a failed seed
  showed a red row and a green card that ignored it (review R6).

**Commits:** `f07f2167`.

## 0042 — Public Azure private-link aliases are information; private-access advice needs network failure

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator, from real runs

**Context:** most of the operator's Azure DocumentDB clusters showed "Private endpoint resolves
publicly" even though their connections worked. A CNAME through
`privatelink.mongocluster.cosmos.azure.com` resolving publicly is the normal answer outside the
resource's private network. The alias does not even establish that a private endpoint exists.

**Evidence:**

- [Azure Private Endpoint DNS](https://learn.microsoft.com/azure/private-link/private-endpoint-dns):
  > DNS resolution and access control are independent. The CNAME chain in the public
  > `privatelink.<service>.<region>.<suffix>` zone is deliberately resolvable from anywhere on the
  > internet so that hybrid and gradual-migration scenarios continue to work without breaking
  > existing clients. A successful public DNS lookup confirms only that a resource with that exact
  > name exists in the global Azure namespace. It doesn't confirm that a private endpoint is attached...
- [Use Azure Private Link with Azure DocumentDB](https://learn.microsoft.com/azure/documentdb/how-to-private-link):
  > Private Link secures your connection, however, it doesn't prevent your Azure DocumentDB endpoints
  > from being resolved by public DNS. The filtration of incoming requests is handled at the application level.

**Decision:**

- Keep `dns.privateEndpointPublicAddress` for continuity, with severity **info**, not warning. It
  does not change a successful DNS row or make the card count a warning. The panel title is
  "Public address for this Azure host name"; the explanation says the public answer is normal
  outside the cluster's private network, with no standalone next step. `dns.privateEndpoint` also
  describes resolution to a private address, without claiming a private endpoint is proven.
- When the connection cannot be made and the same host fails TCP with refusal, timeout or
  unreachable evidence, or fails later with network-access evidence, the existing context-hint
  mechanism adds: "This name resolved to a public address. If the cluster allows only private
  access, connect from its virtual network or a network that resolves the private endpoint (VPN,
  peering or a private DNS zone)." Provider guidance stays first. A successful connection has no
  private-access hint. A run-wide error without per-host evidence is correlated only when there is
  one target; it must not blame a different member's public answer.
- The failure card's support line names the sending action: "Contacting support? Use Share report
  to copy or save the report." Show report still means review; the earlier-sign-in-failure sentence
  continues to say "Show report has the details."

**Amends:** the earlier warning severity in [design §4.5](./design.md#45-dns-per-host), implemented
in WI-03b (`5ef938b9`) and observed in [0039](#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them).
It extends [0033](#0033--network-failures-mention-possible-firewall-blocking-cloud-helpers-come-next)'s
conditional network guidance and refines the support line in design §4.13 and
[0041](#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary).
Earlier decision text is left unchanged.

**Rejected alternatives:**

- **Keep the warning.** Noise on most Azure clusters; Microsoft documents the answer as normal.
- **Drop the finding entirely.** Loses useful context for private-only access when the connection fails.

**Commits:** `94f2698b`.

## 0043 — The panel shows each step for at least about 300 ms

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator; the jitter's spread, the card's
beat and what Cancel does with queued rows are the agent's call (WI-22)

**Amended 2026-11-02:** per-step minimum raised to 400 ms ± 100 ms (operator). The running counter is removed by 0045.

**Context:** checks are usually very fast, so all eight rows settled in about one frame. Users could
not follow the step-by-step story, and an instant result read as "nothing was checked". The operator:
"don't limit the entire duration - we have quite a few steps so I'd just try to do 300 ms per step
minimum, that should do. include a comment in code explaining why we do this." Then: add jitter, so
the rhythm does not look mechanical.

**Decision:**

- **Presentation only.** The webview paces how row results appear
  (`RunEventPacer`/`usePacedRunEvents`). The host, runner, report, Output trace and telemetry keep the
  real timings; nothing changes outside the webview.
- **Per-step minimum with jitter.** Each row's change to a settled status (done, warning, error,
  skipped) shows no earlier than its minimum after the previous row's settle was shown, or after the
  run started for the first row. Each minimum is drawn uniformly from **200 to 400 ms (300 ms ±
  100 ms)**. A step that took longer gets no added delay. A host update that settles several rows is
  split into one step per row, in row order. "Checking…" shows as soon as its turn comes, and a
  settled row never goes back to checking.
- **No cap on the total.** Eight instant rows and the card add about 2.7 s on average, at most 3.6 s.
- **Failures keep the rhythm.** A failed row and the skipped rows after it settle one step apart:
  the sequence is what makes the result readable.
- **The result card is one more step.** It appears after the last row, with the same 200–400 ms beat;
  report actions (Show report, Share report) appear with it. A shorter beat was considered; the same
  rhythm reads as the last step of one story.
- **Cancel stays immediate** and scoped to its run (review [S4](./iterations/01-implementation-review.md#s4--valid-medium-a-delayed-cancel-can-cancel-the-replacement-run)): it shows everything that already
  arrived for its run at once, then cancels; later updates of that run are dropped. If the run had
  in fact already finished, its real result shows and no cancel is sent: pacing must never make a
  completed check look cancelled or unchecked. Re-run, a new run and closing the panel drop queued
  updates and timers; an update from another run or run ID is never shown.
- **Accessibility follows the paced view.** Row and card announcements fire as rows settle on screen,
  in order. The elapsed counter shows real time; Cancel stays focusable until the card appears.
- **Tests and L2-dev turn it off.** The configuration's `stepPacing` (never set by the extension) is
  zero in the view's jsdom tests and every static L2-dev fixture; the random source is injectable.
  The L2-dev route `paced-run` keeps the default and asserts the order and timing.

**Why:** the operator's observation is about perception, not measurement. Pacing the presentation
makes each check visible without touching what is measured, and a random spread around 300 ms looks
less like an animation timer. Flushing on Cancel shows the true state; dropping the queued rows would
hide checks that really ran, the impression this decision exists to fix.

**Rejected alternatives:**

- **A minimum duration around each check in the runner** (`Promise.allSettled([check(), delay(ms)])`).
  It would distort recorded durations and the timeout arithmetic, and slow every consumer of the
  package, including the report and telemetry.
- **A cap on the total extra time.** The operator chose a plain per-step minimum.
- **A fixed 300 ms.** The operator asked for jitter so the rhythm does not look mechanical.
- **Showing failures immediately.** Not requested; it would break the rhythm exactly where the user
  most needs to see the order of what happened.

**Commits:** `4dc2ed70`.

## 0044 — Hide identifiers updates one live report per panel, with a neutral title

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** the operator: "this feature: 'The report will include host and identity details. Hide
identifiers in the report. Review the report before sharing.' should also influence the 'show report'
button, so if we're hiding identifiers, then the shown report should reflect this as well."
New reports already used the setting; an already-open report kept its old content.

**Decision (implemented, WI-24):**

- Each panel owns one live read-only Markdown report. Show report updates that document with the
  latest completed run and reveals its preview; repeated clicks reuse it. If its last tab closed,
  Show report opens it again under the same neutral name, with a fresh URI.
- Hide identifiers re-renders the same open report immediately, without revealing it or taking focus from the panel (orchestrator review),, in either direction. `setReportIdentifiers` validates the current run ID, does nothing visible when no report is
  open, and never opens a tab. It records `reportRedacted` and `reportLiveRefresh`, without identifiers.
- During Re-run, the preview keeps the previous completed report (still responsive to the toggle).
  On successful run completion it switches in place to the new completed snapshot using the latest
  setting, without stealing focus. Cancellation or an unexpected failure leaves the old report.
- Titles and URI paths never include connection identifiers: `Connection diagnostics.md`, then
  `Connection diagnostics (2).md`, and so on using a session-local panel counter. The connection
  name lives in the document body, where redaction applies. Trade-off: even with identifiers visible,
  tab labels no longer name the connection; neutral counters distinguish panels instead.
- The content provider fires `onDidChange(uri)` on updates. VS Code re-reads the virtual document;
  the built-in Markdown preview listens to text document changes and refreshes. Provider event
  delivery is unit-tested; actual refresh in a real VS Code session is not verified by those tests.
  R11's tab-owned lifetime remains: closing/evicting the source text model does not release content
  while a source or preview tab still shows it. Updates cannot resurrect released content.
- Copy, Save and the share warning from 0040 stay unchanged. These actions still render the latest
  completed snapshot rather than reading a separate stale preview buffer.

**Amends:** 0022 (one live report instead of a new immutable preview on each click) and 0040
(the identifier setting applies immediately to an already-open report; the panel still shows full
identifiers and the share warning is unchanged). Their original text is retained.

**Rejected alternatives:**

- **Reopening a new tab on every toggle:** tab clutter, and the old tab still shows identifiers.
- **Keeping the connection name in the title:** it leaks into the tab label and the redacted
  document's name.

## 0045 — Static checking status and relative last-checked time

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** the operator: "the checking and duration, we don't need the timer running, as the list
is dynamic anyway." For the finished status: "when we say last checked, just use similar phrasing /
wording we use in the indexes view, how we say that it was run just a moment ago, and x minutes ago,
that's a better ux."

**Decision (implemented, WI-24):** while running, show static "Checking the connection…", without an
elapsed counter or a one-second interval. Real durations remain in the report. After completion,
show "Checked a few seconds ago" below 30 seconds, "Checked less than a minute ago" below 60 seconds,
"Checked 1 minute ago", then "Checked {0} minutes ago". Match IndexList's self-rescheduling timeout
at the next threshold, not a polling interval. Relative-time updates do not announce elapsed time;
row and result announcements stay unchanged. Cancelled and failed runs retain their status wording
(they did not display a timestamp). No tooltip is needed.

Extended by the orchestrator after review: IndexList counts only minutes, which reads badly in a panel
left open for hours ("Checked 2760 minutes ago"). From 60 minutes the text is "Checked 1 hour ago" /
"Checked {0} hours ago", updated hourly; from 24 hours it is "Checked on {date and time}" and no
longer updates.

**Amends:** 0037's running status and 0043's elapsed-counter statement. Pacing remains presentation
only, now 400 ms ± 100 ms per step (0043 amendment). IndexList, LocalQuickStart's `formatLastChecked`
and InventoryPanel remain three near-duplicates; this change does not refactor them.

---

## 0046 — Report timestamps show local time with a zone and UTC ISO

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator

**Context:** the operator: "the report when sharing timestamps should have human readable format in
the user's locale, but then also iso in brackets, so that agents can better investigate complex
issues later on."

**Decision (implemented, WI-26):**

- All absolute timestamps in the Markdown report show the user's locale date and time with an
  explicit time zone, followed by ISO 8601 UTC with milliseconds in parentheses, for example
  `Nov 2, 2026, 3:12:08 PM UTC (2026-11-02T15:12:08.123Z)`. Show report, Copy report and Save Markdown
  use the same formatter and escaping.
- The extension supplies `ReportText.formatTimestamp(number | Date)` using `vscode.env.language`
  and `Intl.DateTimeFormat` with medium date and long time styles. Invalid locale tags fall back
  to the default locale. The ISO suffix always uses `Date.prototype.toISOString()`.
- The package stays UI-free and independent of VS Code. Its English default formatter returns
  deterministic ISO only; consumers inject their own formatter. Identifier redaction preserves
  timestamp fields.
- JSON stays machine-only: existing ISO strings and consumer epoch numbers are unchanged. The
  Output channel diagnosis trace has durations, not absolute timestamps, and stays unchanged.
- Durations, clock offsets and relative ages stay unchanged. Earlier-in-session sign-in evidence
  contains only `ageSeconds` in the snapshot, so no absolute time is inferred or appended. The
  panel's last-checked subtitle is outside this report-only change.

**Rejected alternatives:**

- **ISO only.** Hard for humans to read.
- **Locale only.** Ambiguous across zones and hard for tools to parse.

---

## 0047 — The root cause leads when the driver reached no server

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator, from a real run; the wording is
the agent's call (WI-27)

**Context:** a server that could not be reached showed Network connection (TCP) failed ("Did not
finish in time · 0 of 1 hosts reachable · port 27017"), TLS and Server response skipped, and
Authentication failed ("No authentication · No server selected"). The card said "Connection failed at
Authentication", "No server selected", and "Also detected: Step timed out (asf.com:27017)". The
operator: "tcp failed, so auth has failed as well, so which error is the key error, it doesn't seem
that it's the auth."

**Cause:** `deriveResult` headlined the authenticate check's own error and let only the generic
`auth.connectFailed` defer to earlier evidence. `auth.serverSelectionTimeout` counted as specific, so
it won; TCP's error became supporting evidence and the card stopped at Authentication. Yet
`isTransport` already classed `auth.serverSelectionTimeout` and a timed-out authenticate step as
transport failures: the driver never presented credentials.

**Decision (implemented, WI-27):**

- When authenticate fails with a transport-class failure (`auth.serverSelectionTimeout`, or
  `check.timeout` on authenticate) and an earlier network probe (`srv`, `dns`, `tcp`, `tls`, `hello`)
  has an error, the earliest such error, in row and target order, is the headline, and the card stops
  at its row. The driver's failure is corroboration, not a second problem: "The driver also could not
  reach a server." (or "The driver's connection attempt also did not finish in time." for a timed-out
  authenticate step), without the "Also detected:" label. The firewall hint is unchanged.
- Otherwise today's rule stands: with no earlier failure the driver timeout is "No server selected"
  at Authentication, and a rejected sign-in (`auth.failed`) keeps its headline over a failed seed,
  because credentials really were tested.
- Authenticate keeps its independence from the probes (`dependsOn: ['connectionString', 'prepare']`):
  the driver still succeeds when only some hosts are reachable, or when a probe is wrong.
- The Authentication row says "Could not reach a server", plus "sign-in not tested" for a method that
  signs in, instead of "No server selected", which read like a credential problem. The row stays
  failed: the attempt did run.
- A timed-out TCP probe uses `tcp.timeout`'s wording ("Network connection timed out", its explanation
  and next step) in the row, its Details, the card and the report, and a timed-out hello uses
  `hello.noReply`'s ("No server response"). The row drops the generic "Did not finish in time" for
  them. DNS and TLS have no timeout finding of their own and keep the generic text, as does any step
  ended by the whole-run timeout. A connection-sourced timeout keeps the advice to change that
  connection setting. The code stays `check.timeout`.

**Amends:** [0029](#0029--the-outcome-is-a-card-below-a-fixed-eight-row-list) and design 4.13 ("the
headline is the real attempt's failure, supported by the earlier evidence"): when the real attempt
reached no server, the earlier evidence is the headline. Their text is left as it was.

**Alternatives:**

- **Make Authenticate depend on TCP.** Loses the driver's evidence exactly when the probes are wrong
  or only some hosts are reachable, and turns a real attempt into "not tested".
- **Keep the driver's headline.** Blames the wrong step: the card says Authentication while the
  network never connected.

---

## 0048 — No authentication that the server will not serve needs sign-in

**Status:** Accepted · **Date:** 2026-11-02 · **Raised by:** operator (screenshot); operator approved
direction B; the title, row wording and outcome modelling are the agent's call (WI-27)

**Context:** an Azure DocumentDB connection (`mongodb+srv`) with "No authentication" showed every row
green; Database access said "Ping 93 ms", its Details "connectionStatus not supported; listDatabases
not supported", and the card "Connection successful — All checks passed. The database answered."
Expanding the connection in the tree failed: "Command listDatabases is not allowed as the connection
is not authenticated yet." The operator: "diagnostics is … correct as no auth is chosen, but … at
least warn there, and say, well, it works, but still no luck with doing anything without auth."

**Cause:** Database access classified only code 13 `Unauthorized` as denied, and anything with 59,
115 or `NotImplemented` as unsupported; the gateway's refusal before sign-in reads as an unsupported
command, so nothing warned. The DocumentDB gateway raises this refusal with `Unauthorized` (13); the
Azure gateway that produced the screenshot reported a code the check classed as unsupported.

**Decision (implemented, WI-27):**

- Database access classifies each command error: 13 `Unauthorized`, 18 `AuthenticationFailed`, or a
  message saying the connection is not authenticated or requires authentication is a refusal. A
  refusal is "requires sign-in" when the run did not sign in (No authentication) and "not allowed"
  (a permission) when it did. 59 `CommandNotFound`, 115 `CommandNotSupported` and `NotImplemented`
  stay "not supported". Codes stay in the report; the server's message is never kept.
- New finding `access.signInRequired` (warning), raised when the method is No authentication and the
  server refuses `listDatabases` for lack of sign-in; the tree needs that list to show anything, so
  other refused commands alone do not raise it. Title "Sign-in required to use this connection";
  explanation "The server answered, but it requires sign-in to list or read databases. This
  connection is set to No authentication."; next step "Choose an authentication method for this
  connection (Update Credentials…), then run the diagnosis again." The Database access row is a
  warning, "Ping 93 ms · listing databases needs sign-in", and its Details lead with the finding.
- The card is **"Connection works, but sign-in is required"**, a warning card (not success-green,
  not failure-red) with the finding's explanation and next step. Other rows that need attention
  follow as "These checks also need attention:"; Database access is not listed again, so the WI-20
  "with N warnings" path never repeats it. "Connection works" says what the diagnosis proved, avoids
  "Connected" (rejected in 0041 as a state rather than a result) and "successful" (the extension
  cannot use the connection), and "sign-in is required" names the fix rather than a state ("not
  signed in" is true of every No authentication connection).
- Modelling: the outcome stays `connected`; `TroubleshooterResult` and `ResultCardData` gain
  `signInRequired`, with the finding as the headline. The report keeps "Connection successful",
  names the finding in its summary line and lists the next step.
- A server without access control that lists databases with No authentication stays "Connection
  successful". A refusal with a signed-in method keeps the existing "Listing databases denied" path.
- No card action: Update Credentials… exists only in the Connections view, and the panel has no host
  procedure to run it for the diagnosed node. The next step names it instead.

**Amends:** [0041](#0041--the-panel-never-names-dns-libraries-and-the-result-card-is-a-short-outcome-summary)
(a connected card can now be a warning with a headline) and design 4.10 (a denied or unsupported
command still never fails a connection, but a refusal before sign-in warns). Their text is left as it
was.

**Alternatives:**

- **A silent pass.** Correct about the network, but the extension cannot use the connection, and the
  user only learns that from a modal in the tree.
- **A hard failure.** The server is reachable and No authentication is a valid setup for servers
  without access control; "failed" would send the user looking for a network problem.

## 0049 — Server greeting (hello), one Authentication layout, and the shell on every tree failure

**Status:** Accepted · **Date:** 2026-11-03 · **Raised by:** operator (two reports: password and
Microsoft Entra ID against Azure DocumentDB); operator approved the proposals

**Context:** row 6, "Server response", showed "Sharded cluster router", "Wire version 25" and
"Accepts writes: Yes". The step is an unauthenticated `hello`, but nothing said so, and "accepts
writes" read as a statement about the user's permissions. It is `isWritablePrimary`, which is always
true on a router or a DocumentDB gateway. The Authentication details differed by method: Entra ID
showed a mechanism, password sign-in did not, and neither said which step failed. In the tree, only
some connection-failure nodes offered "Click here to open the shell" (only when listing databases
failed after connecting).

**Decision:**

- Row 6 is **"Server greeting (hello)"**; the report says "Server greeting". The Details open with
  "The server answered before sign-in. No password or token was sent." Per host: Commands run
  (`hello` or `isMaster` answered without sign-in), Server type, Replica set and Member role (replica
  sets only), DocumentDB version, API compatibility ("MongoDB API 8.0 (wire 25)", "or later" between
  releases), and Password sign-in offered (the SASL mechanisms for the user). "Accepts writes" is
  removed. The evidence line adds "answered before sign-in" when the row did not fail.
- Authentication uses one layout for every method: Method; Mechanism (marked "negotiated" when the
  driver picks it from the greeting, following the driver's rule; omitted when nothing was offered);
  User, or "Signed in as" for Entra ID and managed identity; Authentication database and where it
  came from; and Steps with their outcome (password: send password; token methods: prepare sign-in
  only when it stopped there, get token, send token). A rejected password reads "Username and
  password · The cluster rejected the user name or password", in parallel with "Token obtained · The cluster rejected the token".
  Connection settings now say "Authentication database" too.
- Every part of a row's detail line starts with a capital letter after the " · " separator
  ("Microsoft Entra ID · Token obtained · The cluster rejected the token"), except values shown as
  they are (schemes, account names, host names, TLS versions, architectures). A rejection names what
  was rejected: "the token", or "the user name or password", never "it". Operator: "should be
  capitalized after the separator … say that the cluster rejected the token, not 'it'".
- The tree offers Retry, "Diagnose this connection…" and "Click here to open the shell" on every
  connection failure. Operator: "just have it added in all cases. this adds debug options for
  experts."

**Amends:** [0030](#0030--rows-have-plain-names-with-the-technical-term-in-brackets) (row 6 label).
Its text is left as it was; the design row and Details tables are updated.

**Alternatives:**

- **Keep "Accepts writes", reworded.** It never varies on DocumentDB, so it adds noise and invites a
  permissions reading. A replica set's member role keeps the useful part.
- **Show the shell only when the client exists.** The shell connects on its own and is the expert's
  way to see the raw driver error, so it is most useful exactly when the tree cannot connect.

## 0050 — Each row shows its duration in a squared badge; the list shades the row under the pointer

**Status:** Accepted · **Date:** 2026-11-04 · **Raised by:** operator, comparing another tool's
connectivity check, which lists each step with its duration; operator chose the layout from mocks

**Context:** the other tool's per-step times made the slow step (sign-in, 4.38 s) the most useful
thing on its screen. [0039](#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them)
kept "timings other than ping" out of the panel; durations were only in the report's Timings table
and the Output trace, and design 5.2 left open "whether any timing is essential". A duration pinned
to the right of a wide panel has the problem 0039 solved for Details: the eye loses the row.

**Decision:**

- **Every settled row that ran shows its duration**, with no slow or fast rating. Operator: "I'd
  show them at every step, with no rating what is slow and what is fast. locale formatting is
  important." Skipped, pending and active rows show none; there is no running timer (0045).
- **What a duration is:** the wall-clock span from the first of the row's checks starting to the last
  one finishing. Host checks run in parallel, so it is a span, never a sum. Skipped checks are left
  out. `PanelRowProjector` derives it from each `checkFinished` event's time minus the result's
  `durationMs`; the package API is unchanged. The values are real; the panel's pacing (0043) changes
  only when a row appears.
- **No total.** Operator: "no total run (as we have delays per step etc.)". With paced rows, a total
  would not match what the user watched.
- **Format:** whole milliseconds below one second, three significant digits of seconds below a
  minute, then minutes and whole seconds; below one millisecond, "< 1 ms". `Intl.NumberFormat` with
  short units in the webview's default locale, as the other webviews format numbers; not
  `Intl.DurationFormat`, which VS Code's Electron may not have.
- **Layout:** a small, outline, squared (`shape="rounded"`) informative `Badge` at the end of the
  label line, through `StatusListItem`'s new `aside`. Operator: "with the badges, but squared, as
  we do everywhere else … no dotted lines".
- **Row tracking:** `StatusList`'s new `highlightRowsOnHover` shades the row under the pointer, and
  the row whose control has keyboard focus (`:focus-visible`, so a mouse click leaves nothing
  behind), with `colorNeutralBackground2`: VS Code's alternating-row colour, the subtlest
  theme-adaptive surface. Operator: "choose some really subtle fluent shade". High contrast, where a
  shade cannot show, gets Fluent's `colorTransparentStrokeInteractive` outline instead. Padding with
  an equal negative margin keeps the layout unchanged.

- **Each host's time in Details (WI-31).** The per-host sections of Server address (DNS), Network
  connection (TCP), Secure connection (TLS) and Server greeting (hello) end with a "Time" fact: that
  host's check duration. Network connection also gives each address its connect time, failed
  attempts included ("203.0.113.10:27017 (23 ms)"). The host sends numbers; the webview formats them
  with the same `formatDuration`, and rates none of them.
- **The password mechanism on the Authentication line (WI-31).** Username and password reads
  "Username and password · SCRAM-SHA-256 · alice": the configured mechanism, else the one negotiated
  from the greeting, by the same helper the Details use (`authMechanismOf`). It is left out when no
  mechanism is known, when the check did not run, and when no server was reached (that line needs its
  room). Microsoft Entra ID and managed identity are unchanged.
- **The Secure connection evidence line names no TLS version (WI-31).** Details shows each host's
  version as "TLS 1.3" (Node's `TLSv1`…`TLSv1.3` become "TLS 1.0"…"TLS 1.3"; anything else is shown
  as it is). Operator: everything else on the line is high level, and expanding Details gives the
  version. This replaces the agreed "TLS 1.3 rather than TLSv1.3 on the TLS line".
- **The ping is formatted like every other duration (WI-31):** "Ping 12 ms", "Ping < 1 ms", "Ping
  1.23 sec" in the evidence line and the Details "Ping" fact. The Markdown report and the Output trace
  keep raw milliseconds.

**Amends:** [0039](#0039--rows-expand-to-show-their-findings-and-the-evidence-behind-them): row
durations, each host's time and each TCP address's connect time are now in the panel. Codes, URIs
and the checks' other timing facts (the greeting's round trip, command times) still stay out of it.

**Amended (WI-33): timings in Details only where they inform, in plain words.** Operator, on a
single-host TCP row whose badge said 298 ms: Details repeated it as "Time 298 ms", and "Connected to
4.197.233.101:10260 (290 ms)" did not say what the number was (a TCP connect time, not a ping).

- A host section says how long it took ("Took 61 ms") only when the row has two or more host
  sections; with one, the row's badge already says it.
- An address's connect time is shown only when its host made two or more attempts, in words: "…:10260
  in 31 ms" for the address that connected, "…:10260 after 3 sec" for a failed attempt.
- `panelDetails.ts` leaves the numbers out of the data when they would not inform, so the view only
  formats what it gets.

**Copy summary (WI-32): built, then reverted by the operator (2026-11-04).** A Share report item,
"Copy summary to clipboard", copied the panel as plain text with every row's Details expanded. Two
versions were built: one rebuilt the panel from shared view models (rejected: "drop all that
complexity"), then one in which the router kept the lines it sent to the panel in a string list. The
operator then reverted the whole feature: "revert that full copy summary feature". Share report keeps
Copy report and Save report.

**Alternatives (all mocked):**

- **Plain text at the right end.** The operator's first concern: in a wide panel it is unclear which
  row a number belongs to. Badges plus the hover shade answer it.
- **After the label** ("Authentication · 4.38 s"). Clearly owned, but the numbers do not line up.
- **First on the evidence line.** With a variable width it misaligns the evidence after it; with a
  fixed width it aligns, but the operator found it "adds noise in the UI".
- **Last on the evidence line, before Details.** Reads as one more evidence fact ("2 options ·
  147 ms") and puts two times on one line ("Ping 12 ms · 5 databases visible · 692 ms").
- **A dotted leader to the right-hand number.** Clear but busy; the operator chose no dotted lines.
- **No durations.** Keeps the panel unchanged, but leaves the slow-step signal in the report only.
- **Round badges.** Every other badge in the webviews is squared.

## 0051 — Internal names follow the feature: connection diagnostics

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** operator

**Context:** [0038](#0038--the-feature-is-called-diagnose-connection) renamed the feature in the UI
and the command ID, but deliberately kept the internal names: source folders, the package, class,
function and type names, telemetry, webview and router IDs, and L2-dev routes. Nothing has shipped:
the package is not on npm, and the feature is not on `main` or in any release tag. Operator: "I'll do
the full rename now, as it's cheap only now."

**Decision:**

- **Supersedes the "Deliberately unchanged" list of 0038**, except the feature docs folder:
  `docs/ai-and-plans/features/connectivity-troubleshooter/` keeps its name and its
  `feature: connectivity-troubleshooter` id. Older decisions, iteration history and `CHANGELOG.md`
  keep their text.
- **Vocabulary: diagnostics.** The package is `@documentdb-js/connection-diagnostics`
  (`packages/documentdb-js-connection-diagnostics/`), the extension code lives in
  `src/connectionDiagnostics/` and `src/webviews/documentdb/connectionDiagnostics/`, and
  troubleshooter names become `ConnectionDiagnostics…` or `Diagnostics…` (`runDiagnostics`,
  `DiagnosticsRun`, `runConnectionDiagnostics`). The command stays `diagnoseConnection`, now also its
  folder and handler.
- **The error-translation layer is renamed to error explanation**, so its name no longer collides
  with the feature: `ConnectionDiagnosticsService` becomes `ErrorExplanationService`, its providers
  become `*ErrorExplainer`, and its shipped telemetry event `connectionDiagnostics.explained` becomes
  `errorExplanation.explained`, with `explanationProviderId` and `explanationSource`. Operator: "we
  don't evaluate the telemetry yet so we can ignore the old data it just shipped recently."
- **The feature's own telemetry events use the `diagnoseConnection.` prefix**
  (`diagnoseConnection.run`, `diagnoseConnection.runStarted`), so they do not share a namespace with
  any other event. Properties are `diagnosticsSessionId` and `diagnosticsRunCorrelationId`; the
  picker's `telemetrySource` is `diagnoseConnection`.
- Webview, router and survey source IDs, the SRV surface and the error-explanation source become
  `connectionDiagnostics`; the panel view type is `vscode-documentdb-connection-diagnostics`; L2-dev
  routes are `/connectionDiagnostics/<scenario>/<theme>`.
- No user-visible text changes.

Implemented in iteration 03 ([plan and done notes](./iterations/03-rename-to-connection-diagnostics.md)).

**Alternatives:**

- **"Diagnosis" vocabulary** (`connection-diagnosis`, `Diagnosis…`). No collision with the existing
  service, but the operator chose diagnostics.
- **Keep the old internal names** (0038).
- **Keep the shipped `connectionDiagnostics.explained` telemetry.** Rejected: the operator has not
  evaluated that data yet.
