---
feature: connectivity-troubleshooter
kind: review
status: active
prs: [1066]
created: 2026-11-06
updated: 2026-11-06
---

# Diagnose connection: GitHub Copilot feedback assessment

## Scope and provenance

- **PR:** [#1066](https://github.com/microsoft/vscode-documentdb/pull/1066).
- **Review:** [Copilot's review submitted 2026-11-06 at 15:16:37 UTC](https://github.com/microsoft/vscode-documentdb/pull/1066#pullrequestreview-5802264080).
- **Reviewed and assessed head:** `579ef6769faddc520457be479efbebf9c0676e51`.
  The local checkout matched the reviewed head and was clean before this assessment.
- **Coverage:** all four inline comments from that review, all unresolved when retrieved.
  The review overview repeats these four findings; it contains no additional actionable finding.
- **Method:** direct source tracing, existing focused tests, and synthetic local reproductions
  against the current TypeScript source. No live cloud resources or production telemetry were used.
- **Scope boundary:** this evaluates feedback, not the entire PR again. No implementation changes,
  GitHub replies, thread resolutions, commits, or PR-state changes are part of this assessment.
- **Decision status:** the recommendations below are proposals, not accepted operator decisions.
  This file supplements, rather than replaces, [iteration 04](./04-parallel-pr-review.md)
  and [iteration 05](./05-ux-review.md).

## Summary

**All four comments identify real defects: three medium, one low.** Two claims need qualification:
the report can throw before the exact expression Copilot names, and a large timeout override does
not make _every_ operation time out when a shorter applicable deadline wins.

Severity here means:

- **High:** a broadly reachable severe failure, demonstrated credential disclosure, or comparable
  major impact. None established in this assessment.
- **Medium:** incorrect diagnosis, unusable reports for supported input, or disclosure of identifiers
  contrary to the telemetry contract.
- **Low:** a real defect requiring an unusual configuration, with normal product defaults unaffected.

| ID  | Actual GitHub comment                                                                                                                                    | Verdict                                                          | Severity | Confidence                                                            | Recommended option                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| C1  | [Preserve typed report steps when truncating arrays](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004762)                    | Valid; also affects findings inside a step                       | Medium   | High: reproduced                                                      | A: schema-aware bounded copying with separate omission metadata           |
| C2  | [Reject timeout values above the Node timer limit](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004860)                      | Valid; the oversized value must become the effective timer delay | Low      | High: reproduced with controls                                        | A: explicit upper-bound validation, including the equivalent runner input |
| C3  | [Mask diagnostic credential-read errors in their own telemetry context](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004930) | Valid; outer masking does not protect the inner event            | Medium   | High: source trace and local masking reproduction                     | A: enable whole-error masking before the callback                         |
| C4  | [Refresh the target when reusing the diagnosis panel](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494005005)                   | Valid; reopening discards the replacement node                   | Medium   | High: reproduced with replacement targets; Atlas path source-verified | A: session-owned current target, snapshotted for each run                 |

Suggested implementation order: **C3, C4, C1, C2**. C3 crosses the telemetry privacy boundary;
C4 gives a misleading answer in a normal recovery workflow; C1 breaks the reusable package's
report contract; C2 is inexpensive hardening of an extreme but accepted input.

### Second assessment (2026-11-06)

A second pass re-traced each finding against the same head (`579ef676`). It **agrees all four
are real**. It changes one severity, chooses an option for each, and refines C1. Details are
inline at the end of each section, under **Second assessment**.

| ID  | First severity | Second severity                                                     | Chosen solution                                                                                                                                               | Delta from the first assessment                                                                                                                                                                  |
| --- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Medium         | **Low** in the extension, Medium for the package before publication | **A′** (a concrete form of A): typed `copyStep`, `omitted*Count` fields on the parent record, and the same cap on top-level findings and `summary.serverRows` | The first rubric is applied inconsistently: C1 is as unreachable from the product as C2. Top-level `result.findings` is currently **unbounded**, contrary to the README limit                    |
| C2  | Low            | **Low** (agree)                                                     | **A**, using one shared validator for both input routes                                                                                                       | Confirmed the shipped extension never passes overrides or `connectionTimeouts`                                                                                                                   |
| C3  | Medium         | **Medium** (agree), fix first                                       | **A**                                                                                                                                                         | The exposure largely repeats the existing unmasked `getCredentials` event (same reads, mostly the same event name). It breaks the diagnostics contract but is not a new leak class               |
| C4  | Medium         | **Medium** (agree)                                                  | **A**; keep B as a follow-up                                                                                                                                  | Also discards the newer `entryPoint` and correlation IDs, so telemetry links reruns to the old failure. Only providers that keep discovery state in the node instance return a wrong _diagnosis_ |

Implementation order: **C3, C4, C1, C2** (unchanged). C1 and C2 affect only the package and
can move to a follow-up package PR if merge scope is tight. They cannot be skipped before the
package is published.

### Implementation approval (2026-11-06)

The operator requested implementation of this review, following the recommended/chosen solution
from the **second assessment for each item**: C3 **A**, C4 **A**, C1 **A′**, C2 **A**.
The assessment above records the recommendations as written; this instruction accepts these
four choices, including the report's additive omission fields, the timeout input constraint and
replacement of first-opening-only correlation on panel reuse.

Work follows the leader workflow retrieved from PR #1060 at `4176c081`, with
`claude-opus-5.5` as the operator-named advisor. Implementation models use the host defaults;
no coding-model override was requested. Completion records are added below the corresponding
items in this repository copy, never in the read-only attachment.

## C1 - Truncation inserts strings into typed report arrays

**Source comment:** [discussion_r4494004762](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004762),
on [sanitize.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/sanitize.ts#L47).

**Verdict:** accept the finding. **Severity:** medium. **Confidence:** high.

### Evidence and impact

1. The [sanitizer](../../../../../packages/documentdb-js-connection-diagnostics/src/report/sanitize.ts)
   keeps the first 32 array entries and appends a string such as `[1 more omitted]`.
   That representation is reasonable for arbitrary fact lists, not for schema-typed records.
2. [copyResult](../../../../../packages/documentdb-js-connection-diagnostics/src/report/buildReport.ts#L64)
   sanitizes the entire steps array and casts the result back to `CheckStepResult[]`.
   Nested `step.findings` arrays pass through the same generic traversal.
3. [renderMarkdown](../../../../../packages/documentdb-js-connection-diagnostics/src/report/renderMarkdown.ts)
   assumes actual step and finding records in the section, findings, summary, and timings paths.
   The cast does not restore the missing properties on an omission string.
4. The existing [buildReport test](../../../../../packages/documentdb-js-connection-diagnostics/src/report/buildReport.test.ts)
   explicitly expects a string at `steps[32]`. It tests the malformed snapshot in isolation,
   not whether that snapshot still satisfies the renderer's input contract.

Local source-level reproduction:

| Input to the report builder                           | Observed result                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 32 valid steps                                        | Markdown renders                                                                                           |
| 33 valid steps                                        | Markdown throws with identifiers shown **and** hidden                                                      |
| One step containing 33 valid findings                 | Markdown throws with identifiers shown **and** hidden                                                      |
| 33 valid steps, JSON output without identifier hiding | JSON contains the string `[1 more omitted]` at `results[0].steps[32]`, violating the declared record shape |

With the package's English report text, the observed exception was
`TypeError: Cannot read properties of undefined (reading 'replace')`. Rendering reaches an
undefined label/code before the `step.findings.length` expression cited by Copilot. This is a
qualification of the example, not a reason to reject the bug.

This is not evidence that the default extension workflow currently produces 33 authentication
phases. Its [authentication steps](../../../../../src/connectionDiagnostics/checks/authenticate.ts)
are fixed. The supported package API, however, accepts consumer checks with such step/finding
arrays and publishes the resulting report as typed data.

### Options

| Option                                                                                                                                                                                                                                                 | Pros                                                                                                                                                        | Cons                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Copy structural records explicitly; enforce their bounds separately and store omission counts outside record arrays.** Reuse the existing finding-copy logic, sanitize facts/data/text, and render report-truncation notices from typed metadata. | Preserves record types, the existing size bound, and truthful omission information; fixes Markdown and JSON together; does not invent a diagnostic outcome. | Requires small report-schema/type additions and renderer/redaction wiring; compatibility and localized omission wording need explicit consideration.                                           |
| **B. Preserve every structural step/finding; bound only arbitrary facts and payload arrays.**                                                                                                                                                          | Smallest code change, matching the existing top-level result/finding copying pattern; no new report metadata; retains all diagnostic evidence.              | Relaxes the documented repeated-list bound and permits unbounded structural report growth. Requires an intentional safety-contract/documentation change.                                       |
| **C. Make omission markers an explicit union member and teach all consumers to handle them.**                                                                                                                                                          | Can retain the existing truncation representation and count.                                                                                                | Changes the public record-array contract and spreads branching through renderers, redaction, summary lookup, timings, and downstream consumers. Guarding only the reported line is incomplete. |
| **D. Defer, documenting a maximum of 32 steps/findings per step.**                                                                                                                                                                                     | No implementation work; current fixed authentication phases remain below the step threshold.                                                                | Currently accepted inputs still crash, and the report builder still lies about its output type. Documentation alone cannot enforce the limit.                                                  |

**Recommendation: A.** Keep omission information in the report model, not as a fabricated
successful/skipped check or an invented consumer finding code. Distinguish report truncation from
diagnostic timeout/coverage so it does not offer a meaningless longer-timeout retry. Keep the
original run unchanged.

The fix should also inspect the same boundary for other typed arrays passed to the generic
sanitizer, especially [summary.serverRows](../../../../../packages/documentdb-js-connection-diagnostics/src/report/types.ts#L12).
This is a bounded audit of the same mechanism, not a report-system redesign. Ensure an omitted
headline finding has an explicit truncation explanation rather than silently presenting the
remaining excerpt as complete.

**Acceptance checks:**

- Exercise `buildReport` -> Markdown and JSON with 32, 33, and more steps, and independently with
  more than 32 findings in one step; test identifier hiding both ways.
- Assert every retained step/finding has the declared shape, omission counts are exact, and
  truncation does not invent statuses or finding codes.
- Preserve control-character removal, payload limits, redaction, deep freezing, and input immutability.
- Replace the existing assertion that endorses a string inside the typed steps array.
- Update the [package report contract](../../../../../packages/documentdb-js-connection-diagnostics/README.md)
  and [design report bounds](../design.md#6-report) with the chosen representation.

### Second assessment - C1

**Severity: Low for the extension, Medium for the package before it is published.**
The first assessment marks C2 Low because "normal product defaults are unaffected". By that
same rule C1 is also Low for the product: the shipped authentication check emits a fixed,
small set of steps, and no built-in step comes close to 32 findings. Only an external package
consumer with custom checks can reach it. When it is reached, the failure is loud: Markdown
throws and no report is produced. It does not show a wrong answer, but the JSON output is
silently malformed. Because the package (`@documentdb-js/connection-diagnostics`, not
`private`) is meant to be reusable, fix it before publishing.

**A gap the first assessment missed:** top-level findings are **not bounded at all**.
[copyResult](../../../../../packages/documentdb-js-connection-diagnostics/src/report/buildReport.ts#L71)
maps `result.findings` through `copyFinding` without a cap. Only findings _inside steps_
receive the 32-entry cap, by accident of the generic traversal. The
[README safety limit](../../../../../packages/documentdb-js-connection-diagnostics/README.md#L105)
("One repeated report list: 32 entries") is therefore broken in one place and malformed in
another. A side effect of the generic traversal: data in a step's finding starts four levels
deeper than data in a top-level finding, so it reaches the depth limit earlier.

**Chosen solution: A′ (a concrete, smaller form of A).**

1. Add `copyStep`, mirroring `copyResult`: copy `stepId`/`status`/`skippedBecause`/`durationMs`
   structurally, map `findings` through `copyFinding`, and sanitize only `facts`.
2. Cap structural arrays with `slice(0, 32)` and record the remainder as an optional count on
   the **parent record**: `CheckResult.omittedStepCount?`, `CheckResult.omittedFindingCount?`,
   `CheckStepResult.omittedFindingCount?`. This follows the existing
   [`coverage.omittedTargetCount`](../../../../../packages/documentdb-js-connection-diagnostics/src/types.ts#L211)
   convention, so the counts are not a separate side structure that consumers have to correlate.
3. Apply the same cap to top-level `result.findings` (closing the gap above) and copy
   `summary.serverRows` explicitly as `{ label, value }` strings with the same cap.
4. The renderer prints one localized line, for example "N more steps not shown", from the count.
   This line must not offer a timeout retry. `schemaVersion` can stay at `1` because the
   fields are optional additions.

A′ keeps the documented safety limit, fixes Markdown and JSON together and adds no union member.
It is smaller than A as written because it adds no new report-level metadata block.

**Acceptable fallback if merge scope is frozen: B,** limited to steps and step findings.
Check code produces these arrays; the 32-entry limit protects mainly against server- and
environment-supplied lists. B requires editing the README limit, so A′ is preferred.
Reject C and D for the reasons above.

**Minor, not blocking:** the generic marker `[N more omitted]` is hard-coded English. It still
appears inside localized string lists such as `nextSteps`/`notes`/fact lists. Leave it in this
PR, and record it only if the report gains a non-English consumer.

**Done (2026-11-06), commit `ff55f27e`:** C1 A′ preserves typed structural arrays with
32-entry caps and optional parent omission counts, including top-level findings and server rows.
Counts are recomputed, absent when zero and never trusted from the input; the run stays unchanged.
Markdown explains omissions, including an omitted headline code, without timeout advice.
Operator decision: implement second-assessment A′; leader confidence 97% that this matches the
instruction. Advised (`claude-opus-5.5`): no correctness/design blockers, confidence 85%.
Worker: host-default `gpt-6.1-sol`. New boundary tests cover 32/33/39 entries, both redaction
modes, Markdown/JSON, bogus counts, freezing, input immutability and sanitization.
Report suites: **85 passed**; package build passed; root report-text/acceptance/router suites:
**77 passed**. Step facts and finding data now receive their own sanitization depth budget.
The advisor recommended localization generation before commit and formatting; these procedural
recommendations were **deferred under the repository's mandatory Case 1 policy**. The three
new localization templates are intentionally not yet in the generated bundle. Case 2, including
`npm run l10n`, `prettier-fix` and `l10n:check`, remains required before review handoff.

**Build follow-up, commit `0ca8c110`:** the final root build caught `TS2493` in the
new localization test: the overloaded `vscode.l10n.t` spy inferred an empty rest tuple.
The same worker added an explicit `unknown[]` rest type, preserving all assertions and
production behavior. The localized-text suite then passed **17 tests** and `npm run build`
passed. This test-only correction is a separate commit rather than amending the C1 commit.

## C2 - Accepted timeout values can overflow Node timers

**Source comment:** [discussion_r4494004860](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004860),
on [resolveTimeouts](../../../../../packages/documentdb-js-connection-diagnostics/src/timeouts.ts#L70).

**Verdict:** accept with a narrower impact statement. **Severity:** low. **Confidence:** high.

### Evidence and impact

[resolveTimeouts](../../../../../packages/documentdb-js-connection-diagnostics/src/timeouts.ts)
rejects non-numbers, non-finite numbers, and values at or below zero, but accepts values above
`2_147_483_647` milliseconds. The [runner's default clock](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.ts#L29)
passes the selected delay directly to Node's timer.

The important qualification is the [effective-timeout selection](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.ts#L181):
the smallest applicable connection, check, and remaining-run timeout wins. A large override is
dangerous only when it survives that selection and an asynchronous operation is still pending.
There is no independent oversized run timer that automatically terminates every other check.

Source-level reproductions on Node.js 22.21.1 used a check that normally completes after 25 ms:

| Configuration                                                                   | Observed result                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `runTimeoutMs: 3_000_000_000`, check without its own timeout kind               | `check.timeout`, source `run`, after 5 ms; Node emitted `TimeoutOverflowWarning`        |
| Same large run timeout, check with the normal `probe` timeout                   | Pass after 25 ms; the shorter probe deadline wins                                       |
| `probeTimeoutMs: 3_000_000_000`, normal run timeout                             | Pass after 26 ms; the remaining run deadline wins                                       |
| `input.connectionTimeouts.probe: 3_000_000_000`, `noDiagnosticTimeouts` profile | `check.timeout`, source `connection`, after 2 ms; Node emitted `TimeoutOverflowWarning` |

Elapsed times are observations, not timing guarantees. The stable assertion is the unexpected
timeout versus the passing control cases.

The equivalent `input.connectionTimeouts` validation in
[runDiagnostics](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.ts#L74)
has the same missing upper bound. Fixing only the six override fields leaves that route open.
Normal extension profiles use small values or `null` and do not reach this defect, which keeps
severity low despite the incorrect timeout result.

### Options

| Option                                                                                                                                                                                    | Pros                                                                                                                              | Cons                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Reject numeric deadlines above `2_147_483_647` at the package input boundaries.** Use a shared range rule for diagnostic overrides and the runner's equivalent connection deadlines. | Small, predictable fix; fails explicitly before I/O; no misleading early timeout; `null` already expresses no diagnostic timeout. | Narrows the documented positive-finite contract, including for custom clocks that could support longer delays; requires a clear error and documentation.                       |
| **B. Support long deadlines by scheduling bounded timer chunks.**                                                                                                                         | Honors the existing broad numeric contract and finite multi-week deadlines.                                                       | Adds rescheduling, elapsed-time, cancellation, and cleanup complexity for an implausible diagnosis duration; default-clock and injected-clock semantics need careful handling. |
| **C. Clamp oversized values, or interpret them as `null`.**                                                                                                                               | Very small implementation; avoids Node's immediate overflow.                                                                      | Silently changes user intent: clamping shortens a requested deadline; `null` removes it. Neither is an honest implementation of an explicit finite timeout.                    |
| **D. Defer with documentation directing callers to `null`.**                                                                                                                              | Reasonable low-priority deferral if release scope is frozen; product defaults are unaffected.                                     | Public inputs still produce misleading timeouts, despite the cheap validation fix.                                                                                             |

**Recommendation: A.** Name the offending field and upper limit, and explain `null` for
**diagnostic overrides**. Do not promise `null` for `input.connectionTimeouts`, whose current
contract is numeric, or silently remove a connection-configured deadline.

This proposal changes an accepted-input constraint. Update the
[package timeout documentation](../../../../../packages/documentdb-js-connection-diagnostics/README.md)
and [design timeout contract](../design.md) when implementing it; approval of this assessment
alone should not be recorded as operator acceptance of that constraint.

**Acceptance checks:**

- For every diagnostic timeout field: accept the maximum; reject maximum + 1 and
  `3_000_000_000`; keep `null`, existing valid fractions, and all current invalid-input checks.
- Cover the corresponding runner connection-timeout fields and the no-diagnostic-timeouts case.
- Use a fake clock to inspect large accepted delays without waiting for them.
- Verify rejection occurs before checks/I/O begin, and ordinary minimum-deadline precedence,
  cancellation, and the three shipped profiles remain unchanged.

### Second assessment - C2

**Severity: Low (agree).** Additional evidence that the product cannot reach it:
[runConnectionDiagnostics](../../../../../src/connectionDiagnostics/runConnectionDiagnostics.ts#L274)
passes only `timeoutProfile`, never `timeouts` overrides. The extension also never sets
`input.connectionTimeouts`, as
[input.test.ts](../../../../../src/connectionDiagnostics/input.test.ts#L264) asserts.

This finding still matters more than its reach suggests. Under the repository rule that
"diagnostics must never show an incorrect answer", an early `check.timeout` is a _wrong
diagnosis_: it is the worse kind of failure, even though it is rarer than C1's crash.

**Chosen solution: A.** Implement it as **one** helper, for example `validateTimeoutMs(name,
value, { allowNull })`, used by both `resolveTimeouts` and the `connectionTimeouts` loop in
`runDiagnostics`. Two copies of the range check would let the two routes drift apart. Export
the limit as a constant so the README and tests use the same number. Reject C: clamping silently
changes the requested deadline, which is the kind of quiet wrong answer this feature avoids.
B is not worth its complexity for a diagnosis lasting more than 24 days.

**Done (2026-11-06), commit `290cb77b`:** C2 A shares timeout validation between
diagnostic overrides and all five runner connection-timeout kinds, exporting `MAX_TIMEOUT_MS`
(`2_147_483_647`). The maximum is accepted; larger values fail before checks/events/I/O.
Only diagnostic overrides accept or suggest `null`; fractions remain valid, with no clamping.
Operator decision: implement second-assessment A; leader confidence 99% that this matches the
instruction. Advised (`claude-opus-5.5`): approved, confidence 88%. Worker: host-default
`gpt-6.1-sol`. Tests cover every field/profile, invalid and boundary inputs, early rejection,
and maximum effective delays through an injected clock: **115 passed**; package build passed.
The separate URI/network-option `connectTimeoutMS` route remains outside this accepted item;
this change does not claim to validate every possible network deadline.

## C3 - Nested credential-read telemetry lacks whole-error masking

**Source comment:** [discussion_r4494004930](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494004930),
on [readCredentialsForDiagnostics](../../../../../src/tree/documentdb/readCredentialsForDiagnostics.ts#L41).

**Verdict:** accept. **Severity:** medium, with priority before merge. **Confidence:** high.

### Evidence and impact

The helper creates a new telemetry context. It enables rethrow, disables error UI and issue
reporting, and sets `connectionIntent`, but does not enable `maskEntireErrorMessage`.

The installed `@microsoft/vscode-azext-utils` implementation:

1. Creates a fresh context for each `callWithTelemetryAndErrorHandling` invocation.
2. Captures failure properties and processes telemetry in `finally`, even when rethrowing.
3. Uses whole-error masking only if that particular context enables it. Otherwise its
   `maskUserInfo` function applies best-effort patterns and registered values, not a guarantee
   that all private host/resource names disappear.

Consequently, the outer catch's typed `ConnectionSourceUnavailableError` is too late to protect
the nested event. Neither `suppressDisplay` nor the parent diagnosis run's mask flag is inherited.
This violates the explicit [mask every independent context contract](../design.md#74-masking).

The path is reachable from actual providers: the
[Azure Resource Manager reader](../../../../../src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts#L55)
and [Kubernetes reader](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts#L238)
perform reads through this helper.

A local fixture verified that the flag is absent **before the callback runs**. Passing the
synthetic error text `Permission denied for namespace orchid-prod at api.orchid.internal`
through the installed SDK's actual best-effort masker preserved both the namespace and hostname.
No telemetry event was sent to a service.

**Severity boundary:** this establishes an identifier-disclosure path, not evidence that real
customer data was already collected or that passwords/tokens escaped masking. Azure IDs, URLs,
and other strings can be partially masked by the SDK; the defect is the lack of the stronger
guarantee required here, not the claim that every error is emitted completely untouched.

### Options

| Option                                                                                                | Pros                                                                                                                                                                         | Cons                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Set `context.telemetry.maskEntireErrorMessage = true` before invoking the credential callback.** | Minimal, shared fix across providers; follows existing diagnosis policy; preserves event duration/result and safe categorical properties; does not change error propagation. | Removes detailed error-message/type text from this event, so useful classifications must use explicitly safe, bounded properties.                         |
| **B. Suppress the nested event entirely.**                                                            | Stops this event from disclosing data, including any accidentally added non-error properties.                                                                                | Loses credential-read observability and duration; broader than necessary, and contrary to the helper's current intent to retain telemetry.                |
| **C. Add a bespoke error sanitizer or register anticipated sensitive values.**                        | Could retain more diagnostic detail.                                                                                                                                         | Resource names and private hostnames are not exhaustively predictable; fails to provide the required guarantee and duplicates SDK/error-policy machinery. |
| **D. Defer because the parent context is masked.**                                                    | No implementation work.                                                                                                                                                      | Not a mitigation: the independent child event remains exposed.                                                                                            |

**Recommendation: A.** Set the flag immediately on entry to the nested callback, before provider
work. Keep the current typed-error wrapping, rethrow behavior, and no-dialog behavior. Do not
silently swallow failures to make telemetry look successful.

Whole-error masking also redacts properties whose **names** contain `error` or `exception`.
If adding a safe classification, use the existing bounded naming conventions rather than putting
it under one of those names. This is not a request to add new telemetry fields.

**Acceptance checks:**

- Extend [diagnosticCredentialRead.test.ts](../../../../../src/tree/documentdb/diagnosticCredentialRead.test.ts)
  to assert the mask flag inside the callback, not just after completion.
- Cover both generic source failures and already-typed errors; preserve original error/cause
  information host-side, cancellation, and the lack of error dialogs.
- In an isolated telemetry-sink test, verify synthetic private identifiers do not appear in emitted
  error fields while the bounded intent/result remain useful. Do not use a production reporter.

### Second assessment - C3

**Severity: Medium (agree), and fix it first because it is a one-line change.** Context the
first assessment omits: the same reads already emit unmasked errors on the **normal** path.
For example, [VCoreResourceItem.getCredentials](../../../../../src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts#L49)
uses `callWithTelemetryAndErrorHandling('getCredentials', ...)` without whole-error masking. Six
of the seven diagnostic readers (all except Kubernetes) also reuse the event name `'getCredentials'`
([VCoreResourceItem](../../../../../src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts#L58)).
So C3 is mainly a **breach of the diagnostics masking contract** (design §7.4), not a new leak
class. Severity stays Medium because the contract exists for diagnostics specifically: this
feature runs while the user is troubleshooting, when error text is most likely to contain
private host or namespace names.

The SDK behaviour was verified in
`node_modules/@microsoft/vscode-azext-utils/dist/esm/src/callWithTelemetryAndErrorHandling.js`:
masking is evaluated per context in `finally`, and whole-error masking replaces every
property whose _name_ matches `/(error|exception)/i`. Other properties receive only the
less aggressive mask. The Kubernetes reader's `populateTelemetry` adds only bounded values
(`discoveryProviderId`, `view`, `serviceType`, `journeyCorrelationId`), so option A covers the
remaining exposure.

**Chosen solution: A.** Also extend the test to assert the flag is set **before** `callback`
runs. If a later provider adds a nested `callWithTelemetryAndErrorHandling` inside its reader,
that child context also needs masking. Add one sentence to that effect in the
`readCredentialsForDiagnostics` doc comment. Masking the normal `getCredentials` path is
outside this PR's scope; record it as a follow-up if wanted.

**Done (2026-11-06), commit `174a5d4f`:** C3 A enables whole-error masking before any
diagnostic credential callback and documents the same requirement for nested independent
contexts. Operator decision: implement second-assessment A; leader confidence 99% that this
matches that instruction. Advised (`claude-opus-5.5`): approved, confidence 88%; error wrapping,
typed-error identity and notification suppression remain unchanged. Worker: host-default
`gpt-6.1-sol`. Added success and during-read cancellation regressions, expanded typed failures,
and asserted masking inside callbacks; focused credential-read suite: **20 passed**.
The tests verify the SDK flag, not an emitted telemetry sink; the advisor verified SDK masking.
Ordinary credential-read masking and the pre-existing SDK handling of `UserCancelledError`
remain outside this change.

## C4 - Reopening a panel retains the first tree node

**Source comment:** [discussion_r4494005005](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4494005005),
on [openConnectionDiagnostics](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController.ts#L30).

**Verdict:** accept. **Severity:** medium. **Confidence:** high.

### Evidence and impact

1. [diagnoseConnection](../../../../../src/commands/diagnoseConnection/diagnoseConnection.ts)
   captures `targetNode` in the target's credential-reader closure.
2. The [panel controller](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController.ts)
   correctly keys panels by stable `clusterId`, but its existing-panel branch only reveals the
   panel and offers a rerun. It never uses the replacement target.
3. The [run router](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsRouter.ts#L363)
   invokes diagnosis using that original context target.
4. [AtlasProjectItem](../../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts)
   builds new cluster items from refreshed discovery data.
   [AtlasClusterItem.getCredentialsForDiagnostics](../../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts#L153)
   reads its instance's cluster state and endpoint; a previously unavailable instance does not
   become current merely because another instance has the same stable ID.

The local controller reproduction opened a target whose reader reported `notConnectable`, then
reopened with the same cluster ID and a replacement target whose reader could return an endpoint.
Only one panel existed, as intended, but the next credential read called the old reader once and
the replacement reader zero times. The retained target was still the first object.

The full Atlas paused/creating -> ready scenario was source-traced, not exercised against a live
Atlas deployment. The controller-level stale-reference behavior was reproduced directly.

This is a normal recovery workflow, not merely an old label: the user refreshes discovery, selects
the new node, and still receives a diagnosis of the old unavailable state. Closing the panel is a
workaround, not an acceptable hidden prerequisite for obtaining a correct rerun.

### Options

| Option                                                                                                                                                 | Pros                                                                                                                                                    | Cons                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Let the existing panel session own the current target/entry point; replace them when Diagnose is invoked again, and snapshot them at run start.** | Small, local change; preserves one panel and its session; uses the exact node the user just selected; does not add provider lookup or network activity. | Requires controller/session/router wiring and run-snapshot tests; does not by itself refresh a cached node when the user only presses Run again without reopening from a refreshed tree. |
| **B. Resolve the current node by stable ID and owning provider on every run.**                                                                         | Can also address stale nodes when rerunning without another Diagnose command.                                                                           | Broader dependency on provider lookup/cache semantics, deleted-node behavior, and no-prompt/no-side-effect guarantees; lookup by stable ID alone does not guarantee fresh service data.  |
| **C. Dispose and recreate the panel for every new target object.**                                                                                     | Straightforward way to discard the stale closure.                                                                                                       | Loses panel/session continuity, can interrupt runs or report state, and fights the intended focus-and-offer-rerun behavior.                                                              |
| **D. Document close-and-reopen as a workaround.**                                                                                                      | No code change.                                                                                                                                         | Leaves a misleading diagnosis in the exact workflow that should recover it; unsuitable as the recommended fix.                                                                           |

**Recommendation: A** for the reported reopening defect. Reuse
[DiagnosticsPanelSession](../../../../../src/webviews/documentdb/connectionDiagnostics/diagnosticsPanelSession.ts)
as the owner rather than introducing a second target registry. Treat B as a separately scoped
enhancement if every standalone rerun must re-resolve discovery state.

Implementation constraints:

- Preserve the stable `clusterId` map key. Do not switch to `treeId` to force a new panel.
- Keep target/entry-point ownership in one place; remove or stop reading the obsolete context
  fields rather than maintaining two independently mutable copies.
- Capture the target object and entry point once for a run, and use that same snapshot for
  credentials, correlation, report name, and run metadata. A later reopen must not relabel an
  in-flight run or change its identity halfway through.
- The [tRPC transport](../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L235)
  shallow-copies context per operation. A session reference is shared intentionally; changing a
  single operation's `ctx.target` is not a persistent panel update.
- Retain focus-and-offer-rerun behavior; do not silently start a new run or destroy the previous
  completed report just because the user focuses the panel.
- Check display-name consistency if the replacement node was renamed. The current controller
  supplies panel title and initial configuration once; updating execution state does not
  automatically refresh those presentation values.

**Acceptance checks:**

- Extend [connectionDiagnosticsController.test.ts](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController.test.ts)
  with two distinct target objects sharing a cluster ID and different credential readers.
  After reopening and rerunning, the replacement reader must be used.
- Cover unavailable -> available and available -> unavailable, preserving the panel/session ID.
- Cover a replacement arriving during an active run: the old run keeps its original snapshot;
  the next run uses the replacement, including report naming and correlation.
- Preserve disposal/cancellation, different-cluster isolation, and stable identity across folder
  moves. Existing tests verify panel identity, but not replacement-reader freshness.

### Second assessment - C4

**Severity: Medium (agree), with a more precise scope.** The stale closure keeps the whole
`DiagnosticsTarget`, not just the reader:

- **Wrong diagnosis** happens only for providers whose diagnostic read starts from discovery
  state held in the node instance. Atlas is confirmed (cluster state and endpoint). Kubernetes
  starts from the instance's `serviceInfo`. Saved connections and the Azure Resource Manager
  readers re-read their source on every call, so they still produce a current diagnosis.
- **Wrong telemetry linkage** happens for _every_ provider. `correlation` (`connectionCorrelationId`,
  `failedStartupCorrelationId`) and `entryPoint` are captured in
  [diagnoseConnection](../../../../../src/commands/diagnoseConnection/diagnoseConnection.ts)
  and read by the [router](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsRouter.ts#L364).
  After "connect fails again -> Diagnose", the rerun links to the _first_ failed startup and
  reports the first entry point. This affects the funnel analysis described in the telemetry
  design, beyond the user-visible result.

**Chosen solution: A.** The session-owned target, snapshotted at run start, fixes all three
stale fields (reader, correlation, entry point) with one change. Keep the panel title and
`connectionName` presentation in the same update when `displayName` changed. B (re-resolving
the node by ID on every run) remains a reasonable follow-up for "press Run again without
reopening". It needs a provider lookup contract with no prompts and no side effects, which
is out of scope here.

**Done (2026-11-06), commit `289312cb`:** C4 A makes the panel session the sole owner of
the current target and entry point. Each run snapshots its reader, name and correlation;
reopening retargets the existing panel, updates its title/header and preserves previous reports.
Operator decision: implement second-assessment A; leader confidence 97% that this matches the
instruction. Advised (`claude-opus-5.5`): no blockers, confidence 85%. Worker: host-default
`gpt-6.1-sol`. Added replacement-availability, active-run snapshot, latest-name replay and
header/report regressions; controller, router, React and acceptance suites: **124 passed**.
The existing suppression of rerun offers during an active run remains: reopening updates the
header, but that offer is not queued for when the run finishes; Re-run remains available then.
A reloaded webview briefly uses its original configured name until the latest-name event arrives.
Live discovery recovery and tab/header behavior still need an operator workbench check.
Provider re-resolution for a standalone Re-run (option B) remains out of scope.

## Implementation verification and handoff (2026-11-06)

### Still needs a live workbench check

These are not claimed as live-verified; the corresponding host and React regressions pass:

1. Open Diagnose on an unavailable discovery node, refresh it after it becomes available, and
   invoke Diagnose again. Confirm the same panel is focused, its current name appears, and
   Re-run reads the replacement node rather than requiring the panel to be closed.
2. Reopen Diagnose from a renamed/refreshed node during an active run. Confirm the header/tab
   update while the active run's report keeps its original name; the next Re-run uses the new
   subject. The existing active-run suppression of the rerun banner is unchanged.

### Final automated checks

**Case 1 (implementation, not a ready-for-review handoff):**

- `npm run build` — **passed**, including workspace builds and root TypeScript compilation.
  The first attempt found the C1 test-typing issue documented above; it was corrected and the
  build rerun successfully.
- Combined focused suite — **39 files, 1,326 tests passed**:

  ```bash
  npx vitest run \
    packages/documentdb-js-connection-diagnostics/src/report \
    packages/documentdb-js-connection-diagnostics/src/timeouts.test.ts \
    packages/documentdb-js-connection-diagnostics/src/runner.test.ts \
    src/tree/documentdb/diagnosticCredentialRead.test.ts \
    src/webviews/documentdb/connectionDiagnostics \
    src/connectionDiagnostics
  ```

`l10n`, `prettier-fix`, `l10n:check`, `lint`, `typecheck:tests`, the full runtime suite and
`package` were **not run**. All Case 2 checks remain required before review handoff; in
particular, the three new localized omission templates still need generation. The implementation
phase did not change PR state, GitHub threads, issues or remote branches. The subsequently
requested thread replies are recorded below.

### Decisions and advisor record

All four operator-selected solutions were implemented; none was parked or replaced.
The source attachment was read-only and was not edited. Code commits are C3 `174a5d4f`,
C4 `289312cb`, C1 `ff55f27e` (test correction `0ca8c110`), and C2 `290cb77b`.
All coding workers resolved to host-default `gpt-6.1-sol`.

Five `claude-opus-5.5` advisor consultations covered the interface plan and each item's
logic review. Final correctness verdicts were C3 88%, C4 85%, C1 85% and C2 88%.
The plan advisor's report-only subtype alternative was not adopted: the operator explicitly
selected A′'s counts on `CheckResult`/`CheckStepResult`. The C1 advisor's procedural request
to generate localization before commit was deferred under the repository's Case 1 rule.
No accepted technical solution was changed, and no operator question remains parked.

Last host-log checkpoint: **leader 118.2 AIU; subagents 454.2 AIU; total 572.4 AIU**.
These are the statistics helper's reported figures, not estimates; subsequent documentation
and handoff activity is outside that checkpoint.

### Copilot thread replies (2026-11-06)

The operator requested that each fixed Copilot issue be recorded both here and in its original
review thread, explaining what changed, how it addresses the issue and the fix commit.
Replies were posted and read back for all four items:

| Item | Reply                                                                                                                       | Fix reference                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| C1   | [Typed report truncation](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4495234530)                  | `ff55f27e`, test correction `0ca8c110` |
| C2   | [Timer-safe timeout validation](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4495234438)            | `290cb77b`                             |
| C3   | [Diagnostic credential telemetry masking](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4495234481)  | `174a5d4f`                             |
| C4   | [Refreshed panel target and run snapshots](https://github.com/microsoft/vscode-documentdb/pull/1066#discussion_r4495234546) | `289312cb`                             |

Each reply includes the full commit hash, implementation rationale and relevant validation,
and explicitly states that the commits are local and not yet pushed. The threads remain open;
no push or thread resolution was performed.

## Assessment verification record and handoff (before implementation)

**Existing tests:** 118 passed, zero failed, through the VS Code test runner across:

- [buildReport.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/buildReport.test.ts)
- [renderMarkdown.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/renderMarkdown.test.ts)
- [sanitize.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/sanitize.test.ts)
- [timeouts.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/timeouts.test.ts)
- [runner.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.test.ts)
- [diagnosticCredentialRead.test.ts](../../../../../src/tree/documentdb/diagnosticCredentialRead.test.ts)
- [connectionDiagnosticsController.test.ts](../../../../../src/webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController.test.ts)

**Additional local checks:** the C1-C4 reproductions and C1/C2 control cases above all asserted
the observed behavior successfully. They loaded current source via in-memory TypeScript
transpilation, avoiding reliance on stale package build output. Report/runner logic and the SDK
masker were real; VS Code panel creation and the credential wrapper's telemetry boundary were
stubbed. Synthetic identifiers only; no database, cloud API, or telemetry service was contacted.

Passing existing tests does **not** close the findings: C1 has an assertion that preserves the
wrong shape, while the other suites omit the pertinent overflow, masking, and target-replacement
assertions.

**Verification case:** Case 1 assessment/documentation work, not a request for Case 2 handover.
The PR was already non-draft; its state was not changed. No source was modified, so no build,
localization generation, formatting sweep, lint, packaging, strict test-typecheck, or full runtime
suite was run. The focused tests above support this assessment only; they are not a new
ready-for-review certification.

**Next step:** decide on the recommended options, implement the accepted fixes with their
regressions, then reply to and resolve the linked threads only after verification. No thread is
claimed fixed by this document.
