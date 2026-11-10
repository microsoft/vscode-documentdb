---
feature: deep-links
kind: plan
status: implemented
created: 2026-11-10
code:
    - src/documentdb/auth/oidcAllowedHosts.ts
    - src/documentdb/auth/nonOidcConnectionString.ts
    - src/documentdb/auth/NativeAuthHandler.ts
    - src/documentdb/auth/NoAuthHandler.ts
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/documentdb/auth/ManagedIdentityAuthHandler.ts
    - src/documentdb/auth/documentdbTokenResource.ts
    - src/documentdb/utils/tlsException.ts
    - src/documentdb/playground/WorkerSessionManager.ts
    - src/documentdb/playground/playgroundWorker.ts
    - src/documentdb/playground/PlaygroundEvaluator.ts
    - src/documentdb/shell/ShellSessionManager.ts
    - src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts
    - src/commands/newConnection/PromptConnectionStringStep.ts
    - src/commands/newConnection/PromptAuthMethodStep.ts
    - src/commands/updateCredentials/updateCredentials.ts
    - src/commands/updateCredentials/PromptAuthMethodStep.ts
    - src/commands/updateConnectionString/ExecuteStep.ts
    - src/tree/connections-view/DocumentDBClusterItem.ts
    - src/vscodeUriHandler.ts
---

# Iteration 4 - Entra token destination hardening

> **Status:** B1–B7 implemented; final Case 1 and Case 2 passed locally on 2026-11-10.
> Live-cloud, workbench UX and human author review remain pending.
> Those implementation and verification results describe the prior B0–B7 revision. The
> operator-approved modal-first picker follow-up below is pending and has not shipped or been
> verified.
> The execution plan below records the accepted scope. The research and proposal remain as
> supporting evidence, not a claim that the vulnerability has been fixed.
>
> **Extended 2026-11-10** with endpoint-inventory and driver-enforcement research
> ([Research findings](#research-findings-2026-11-10)). Those findings found two further ways a
> token can reach an unapproved or unauthenticated server: a URI `ENVIRONMENT` property disables the
> driver's host check, and URI TLS-bypass parameters survive into Entra connections. They also
> identify a supported per-connection enforcement point. The design, work items and acceptance
> matrix below were revised accordingly.

## Accepted execution plan (2026-11-10)

The operator requested implementation of this document, explicitly selected **Option B, the
existing machine-scoped setting**, requested an Opus 5.5 advisor, and required the plan to be
committed before implementation. The source proposal was committed as `e572791ce`.
The implementation branch is `dev/tnaum/entra-token-destination-hardening`, stacked on
`dev/tnaum/url-handler-improvmements` (PR #1067), not on `main`.

### Settled scope and pragmatic choices

- Implement WI0–WI8 together; WI9 is out of scope. WI0 adds bounded measurement and an example
  population query, but no production telemetry query has been run and no measurement-first
  release is claimed.
- Keep the existing **single string** `documentDB.customEnvironment.hostnameSuffix`, its machine
  scope and its current custom-cloud audience role. No list, alias, new setting, global switch,
  per-connection trust checkbox, ARM attestation or remote allowlist is introduced.
- Ship the three proposed service suffixes, including Government on the operator confirmation
  already recorded in R6. Live Government, China and private-link behavior and certificate
  coverage remain explicitly unverified.
- Apply the proposal's custom-suffix restrictions. Reject parents of built-in service suffixes
  and of known customer-hosting namespaces, as well as a `cloudapp` label. This also prevents
  `usgovcloudapi.net` from undoing the restriction on its `cloudapp` children.
- Keep interactive token acquisition **eager, after the destination policy check**, rather than
  moving consent into the driver's callback. Opus found the callback's 60-second automated
  timeout does not cancel a pending VS Code consent prompt. This follows the proposal's
  pre-acquisition requirement for URI seeds only while preserving sign-in behavior. SRV answers
  are checked after sign-in but before any token is transmitted. This explicitly amends the
  original SRV zero-acquisition criterion; it does not weaken the no-disclosure invariant.
  Driver seed validation and per-socket TLS enforcement still precede token transmission.
- Strip **every case variant** of URI authentication and TLS parameters. The installed
  case-insensitive URL wrapper's single `delete()` can leave another casing behind.
- Remove URI-supplied CA/CRL and proxy overrides as well: review found these could replace peer
  trust or routing despite the hostname hook. Extension-controlled TLS configuration is a separate
  trust boundary; an untrusted connection string cannot supply its own.
- Recheck current policy at each token relay, using the worker's original connection and captured
  authentication identity, never request-message identity fields or live credential-cache entries.
- Use a selectable explanatory picker row that opens **Learn More**, then returns to the picker.
  It cannot select Entra or change trust. Use the proposed short English copy.
- Editing to a rejected destination saves the string, clears a selected Entra/managed-identity
  method and recomputes methods; editing between approved destinations retains the selection.
- Rejected saved connections fail through the existing modal flow, with **Learn More** and
  recovery actions for **Update Credentials** and **Update Connection String**. No silent fallback.
- **Learn More** targets the public documentation page
  `https://microsoft.github.io/vscode-documentdb/user-manual/entra-id-trusted-servers/`.
  It does not write or prefill settings. The page ships with this change.

These are implementation details advised by Opus 5.5, not new service-owner confirmations.
The advisor's source-backed packet identified the driver callback timeout, URI casing behavior,
TLS-option precedence, worker serialization boundary and session identity requirements.
Confidence is high for the inspected local behavior; live endpoint support remains unverified.

### Approved modal-first picker follow-up (2026-11-10; pending)

This follow-up supersedes only the prior picker direct-navigation choice above. B0–B7 and their
recorded results remain accurate for that earlier revision; the modal-first flow is not implemented
or verified yet. Keep the unavailable row label **Microsoft Entra ID: not available** and detail
**Entra ID is used only with Azure DocumentDB clusters.** Selecting that row must await a shared
informational modal:

- Title: **Microsoft Entra ID isn't available for this server.**
- Detail: **Microsoft Entra ID is available only for Azure DocumentDB**
  **or servers allowed by the trusted-server setting.**
- Optional instruction, if needed: **Choose another authentication method, or select Learn More.**
  Keep the modal body within four short lines.
- Actions: **Learn More** and **Back** (the close affordance).
- Back or Escape closes the modal and returns to the picker without opening a browser. Selecting
  **Learn More** awaits `openUrl(Links.EntraTrustedServers)`, checks for `false`, and displays a
  nonblocking warning using the existing repository wording/pattern on failure; after that, return
  to the picker. Escape on the actual quick pick still cancels the wizard.

Export `showEntraUnavailableDetails(): Promise<void>` from the shared helper
`src/documentdb/auth/showEntraUnavailableDetails.ts`. Use direct `vscode.window` APIs so modal
dismissal is not translated by the azext wrapper into `UserCancelledError`. Replace direct
navigation at all three call sites—`ChooseAuthMethodStep`,
`newConnection/PromptAuthMethodStep`, and `updateCredentials/PromptAuthMethodStep`—with an awaited
call to the helper. No setting writes, trust changes, authentication-method changes, or token
changes are in scope. This does not alter the separate rejected-connection error modal or its
**Learn More** behavior.

#### Work items and dependencies

| Item | Owner / approved model | Scope and deliverable | Depends on |
| ---- | ---------------------- | --------------------- | ---------- |
| M1 | Leader, docs editor (`gpt-6-luna`; mechanical docs-only edits) | This plan and the active feature decision/README accurately record the approved flow and pending work. Owned paths: `docs/ai-and-plans/features/deep-links/README.md`, `docs/ai-and-plans/features/deep-links/decisions.md`, and this plan. `docs/ai-and-plans/README.md` was read only as the layout reference. No code, tests, or other docs. The leader commits these docs before M2 starts. | — |
| M2 | Coding agent (`gpt-6.1-terra`; implementation/tests) | Sources: `src/documentdb/auth/showEntraUnavailableDetails.ts`, `src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts`, `src/commands/newConnection/PromptAuthMethodStep.ts`, and `src/commands/updateCredentials/PromptAuthMethodStep.ts`. Update `src/documentdb/wizards/authenticate/ChooseAuthMethodStep.test.ts`; add `src/documentdb/auth/showEntraUnavailableDetails.test.ts`, `src/commands/newConnection/PromptAuthMethodStep.test.ts`, and `src/commands/updateCredentials/PromptAuthMethodStep.test.ts`. Cover awaited modal/action ordering, both dismissal paths, open failure warning, return to picker, and quick-pick Escape cancellation. | M1 |
| M3 | Advisor (`claude-opus-5.5`; independent review) | Review the implemented modal-first flow and focused tests against the accepted behavior and verify rejection-modal Learn More and destination/trust policy remain unchanged. | M2 |
| M4 | Leader | After M2 and M3, run Case 1 (`npm run build` and the focused Vitest command below); resolve blockers and publish the implementation update. Case 1 does not run localization, formatting, lint, packaging, or the full suite. If a later handoff is for review, Case 2 also runs `npm run l10n` when localized strings changed. | M2, M3 |

Focused test command for M2/M4:

```bash
npx vitest run \
  src/documentdb/auth/showEntraUnavailableDetails.test.ts \
  src/documentdb/wizards/authenticate/ChooseAuthMethodStep.test.ts \
  src/commands/newConnection/PromptAuthMethodStep.test.ts \
  src/commands/updateCredentials/PromptAuthMethodStep.test.ts
```

### Shared interfaces

The policy and OIDC builder are extension-host independent so the worker uses the same logic:

```typescript
// oidcAllowedHosts.ts
export const BUILT_IN_ENTRA_DESTINATION_SUFFIXES: readonly [
    'mongocluster.cosmos.azure.com',
    'mongocluster.cosmos.azure.us',
    'mongocluster.cosmos.azure.cn',
];
export type EntraDestinationClass = 'documentdbService' | 'customSuffix' | 'otherAzure' | 'other';
export interface EntraDestinationDecision {
    allowed: boolean;
    destinationClass: EntraDestinationClass;
    allowedHostPatterns: readonly string[];
    customSuffixUsed?: string;
    rejection?: { microsoftCloudDomain: boolean; serviceLabel: boolean };
    firstHost?: string;
    hostCount: number;
}
export function isEntraDestinationHostAllowed(host: string, patterns: readonly string[]): boolean;
export function evaluateEntraDestination(
    connectionString: string,
    customHostnameSuffix?: unknown,
): EntraDestinationDecision;
export class EntraDestinationRejectedError extends Error {
    firstHost: string;
    additionalHostCount: number;
}
export function isEntraDestinationRejectedError(error: unknown): error is EntraDestinationRejectedError;

// oidcClientOptions.ts
export function createEntraCheckServerIdentity(
    patterns: readonly string[],
): (host: string, cert: PeerCertificate) => Error | undefined;
export function buildOidcClientConfiguration(input: {
    connectionString: string;
    customHostnameSuffix?: unknown;
    oidcCallback: OIDCCallbackFunction;
    baseOptions?: MongoClientOptions;
}): {
    connectionString: string;
    options: MongoClientOptions;
    decision: EntraDestinationDecision;
    ignoredTlsBypass: boolean;
};

// entraDestinationSettings.ts: VS Code glue only
export function getEntraCustomHostnameSuffix(): unknown;
export function evaluateEntraDestinationFromSettings(connectionString: string): EntraDestinationDecision;
```

The builder rejects before returning options. It clears URI credentials, all case variants of
`authMechanism`, `authMechanismProperties`, `tls`, `ssl`, TLS-bypass aliases and
`rejectUnauthorized`; removes conflicting TLS keys from base options; and sets mandatory TLS,
certificate/hostname validation, narrowed `ALLOWED_HOSTS` and a policy-first
`tls.checkServerIdentity` hook. Persisted strings are not rewritten by this runtime sanitization.
Host matching is DNS-label-boundary based, ASCII LDH only, case-insensitive, rejects IPs and
trailing dots, requires a label before the suffix, and authorizes **every** seed.

### Work assignment and commit boundaries

Coding agents use the harness's configured coding model; the operator explicitly selected
`claude-opus-5.5` for the read-only advisor. Each batch gets a separate commit and an inline
completion note. Non-overlapping batches may run concurrently.

**Additional integration item B7 (2026-11-10):** a late source-backed check found that selecting
Native or No Authentication can still let a URI declare `MONGODB-OIDC`. The driver then runs its
own machine workflow outside the Entra handlers. Opus confirmed this offline with `parseOptions`
for Azure, GCP and Kubernetes environment values, including Native with an empty password.
This is a blocking gap in the original every-path goal, not an optional new authentication feature.
The leader accepted the advisor's narrow remedy (high confidence): honor the selected non-OIDC
method by removing **only conflicting OIDC mechanism/properties**, in every casing, on the two
main-thread paths and the common shell/playground worker branch. Genuine native mechanisms
(SCRAM, GSSAPI, X509) and all their TLS settings must remain byte-identical.

B7 adds a pure `removeConflictingOidcMechanism(connectionString: string): string` helper in
`src/documentdb/auth/nonOidcConnectionString.ts`. It detects any case variant of an
`authMechanism` key whose value the installed driver resolves to OIDC, then removes all
case variants of both authentication keys from the runtime string. This includes the driver's
ordered regex matching for abbreviated/regex-valued mechanisms, not just literal
`MONGODB-OIDC`; exact trimmed OIDC is also removed conservatively. Otherwise it returns the
input unchanged. Invalid regexes fail explicitly as in the driver.
`NativeAuthHandler`, `NoAuthHandler` and the non-Entra worker branch call it
before constructing the driver. Persisted strings are unchanged. Tests must inspect the real
driver's effective mechanism, plus worker constructor arguments, not just string formatting.
No new setting, dialog, fallback to Entra or trust input is introduced.

| Batch | Original items      | Ownership and deliverable                                                                                                                                                                                                                                                                       | Prerequisite              |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| B0    | plan                | Leader: commit this revised plan before coding                                                                                                                                                                                                                                                  | source proposal committed |
| B1    | WI2, WI3, WI8 core  | Policy/builder worker: `oidcAllowedHosts.ts` and tests; new `oidcClientOptions.ts` and tests, `entraDestinationSettings.ts`. Keep legacy exports until consumers migrate.                                                                                                                       | B0                        |
| B2    | WI0, WI4, WI5       | Lifecycle worker: Entra/managed-identity handlers and tests, `WorkerSessionManager`, `workerTypes`, `playgroundWorker`, `ShellSessionManager`, `PlaygroundEvaluator`, related tests and `authTrace`. Narrow driver options, original-session relays, bounded telemetry and safe output records. | B1                        |
| B3    | WI4 proof           | Harness worker: new `oidcDestination.harness.test.ts` and its fixtures only. Real installed driver, loopback TLS, dummy token, seed/SRV/topology/polling/reconnect/session tests.                                                                                                               | B1                        |
| B4a   | WI6 pickers         | Picker worker: `AuthMethod`, `ChooseAuthMethodStep`, authentication/new/update-credentials contexts, new-connection and update-credentials prompt/orchestration files and their tests.                                                                                                          | B1                        |
| B4b   | WI6 saved state     | Connection worker: update-connection-string execution/tests, `DocumentDBClusterItem`, failure presentation, `ClusterItemBase`, `ConnectionsBranchDataProvider`, `constants`, `entraErrorRules` and related tests.                                                                               | B4a                       |
| B5    | WI7, WI8 docs       | Documentation worker: setting description, new public page, sovereign/managed-identity user guidance, active feature docs/decisions and acceptance evidence.                                                                                                                                    | B2, B3, B4b               |
| B6    | verification        | Leader/check worker: Case 1 and full Case 2, required fixes, AI pre-review committed under this feature's iterations; publish stacked PR.                                                                                                                                                       | B5, B7                    |
| B7    | WI3 integration gap | Coding worker: pure `nonOidcConnectionString` helper/tests, `NativeAuthHandler` and new tests, `NoAuthHandler` and tests, non-Entra `playgroundWorker` branch/tests. Prevent URI-selected OIDC from bypassing the selected non-OIDC method.                                                     | B1                        |

Focused root tests use `npx vitest run <owned test paths>`; the `extension` project includes
`src/**/*.test.{ts,tsx}`. No workspace-package source changes are planned. Intentional non-TDD
expectation changes include the old broad allowlist, handler `ALLOWED_HOSTS`, and the old
unrecognized-host managed-identity preselection. Cloud-mismatch regression tests use an approved
service host so they reach audience validation. Existing NativeAuth `TDD:` worker contracts
must remain unchanged.

### Verification and evidence

- Test each enforcement layer independently, including mixed seeds, case-variant `ENVIRONMENT`,
  all TLS bypasses, native behavior, current-setting removal and forged worker identity fields.
- The protocol harness uses a temporary CA, service-named certificates, driver `lookup` mapping
  to loopback and controlled DNS answers. It asserts token-provider calls and captured
  application/token bytes, not just error messages or server-side TLS completion.
- Pin TLS session behavior and driver-internal SRV polling assumptions. Re-run these probes on
  driver upgrades; do not claim a blocked topology/polling path without an exercised harness.
- Run Case 1 (`npm run build`, focused tests), then all Case 2 commands requested by the operator:
  `npm run l10n`, `npm run prettier-fix`, `npm run l10n:check`, `npm run lint`,
  `npm run build`, `npm run typecheck:tests`, `npx vitest run`, `npm run package`.
  Fix change-related failures and repeat affected checks until green. Do not weaken TDD contracts.
- Record results separately from manual/live gaps: consent/picker/modal/recovery presentation,
  Learn More navigation, every shipped locale's layout budgets, sovereign/private-link service
  acceptance. No production sizing, service-team audience request or upstream report is claimed.

### Progress

The nine original required items (WI0–WI8) were grouped into eight execution batches
(B0, B1, B2, B3, B4a, B4b, B5, B6). B7 is an explicitly added ninth execution batch addressing
the blocking non-Entra dispatch gap. WI9 remains excluded.

- **B0 — Done (2026-11-10), commits `e572791ce`, `639ebd072`:** original source and revised
  execution plan committed before coding. Operator chose Option B with the existing setting;
  Opus 5.5 advised interfaces and eager sign-in after destination validation (high confidence
  in inspected local behavior; no numeric confidence supplied).
- **B1 — Done (2026-11-10), commit `95f7267f2`:** shared fail-closed every-host policy,
  hardened single suffix, secure OIDC options and machine-only settings glue. Advised
  (`claude-opus-5.5`, high confidence): URI CA/CRL and proxy options must not redefine peer trust;
  strip every case variant while preserving extension-controlled CA and stored native strings.
  Final measurement correction includes both service labels and `windows.net`, without changing
  authorization. Policy/builder/settings tests and driver parsing assertions cover these decisions.
- **B2 — Done (2026-11-10), commit `b0982d727`:** handlers, workers and relays use shared policy
  before audience/token acquisition. Session identity remains captured; current machine trust
  is reevaluated without live credential-cache reads. Advised (`claude-opus-5.5`, high confidence):
  eager interactive sign-in preserves consent behavior. Worker, shell and nine direct playground
  relay tests cover forged requests, removed trust, stale sessions and native rejection.
- **B3 — Done (2026-11-10), commit `414c4e226`:** 28 real-driver TLS/BSON tests use dummy tokens,
  controlled DNS and loopback sockets. Advised (`claude-opus-5.5`, high confidence in local proof):
  assert application/token bytes, not server-side TLS completion. Three worker repetitions passed.
  The SRV-polling case exercises a trailing-dot result, not an arbitrary out-of-domain result.
- **B4a — Done (2026-11-10), commit `7f178d4d9`:** all pickers use current destination policy;
  Learn More loops without selecting auth or writing settings. Advised (`claude-opus-5.5`, high
  confidence): both Azure resource callers must pass the actual connection string; tests drive
  both contexts, including Entra-only modes. The link constant moved into this batch for dependency
  safety (leader coordination decision).
- **B4b — Done (2026-11-10), commit `c1207ab77`:** edits clear disallowed identity methods and
  recompute choices; saved selections fail without fallback. Safe modal details, Learn More and
  action-only recovery work on fresh and cached failures. Advised (`claude-opus-5.5`, high
  confidence): retain the narrow `instanceof` predicate because IPC reconstructs real instances.
  Twenty-two added edit/recovery tests plus updated diagnostics assertions passed.
- **B5 — Done (2026-11-10), commit `e6081e4b8`:** public trusted-server page, setting consequence/link, related user guidance and active
  deep-links/sovereign-clouds/managed-identities decisions updated. A bounded WI0 query is provided
  below; no production telemetry query was executed. Targeted read-only validation passed for
  14 Markdown files, 33 added local links/anchors, the explicit Learn More permalink and unchanged
  setting schema/scope. `git diff --check` passed for the owned documentation/setting files.
  The B5 worker did not run build, lint, formatting, localization or site rendering; the later
  full Case 2 runs covered repository formatting/localization/build checks.
- **B6 — Done (2026-11-10), localization commit `7a0d3675c`:** first Case 1 passed 978 tests; the final expanded Case 1 passed
  **1,001 tests in 40 files** plus `npm run build`. The first full Case 2 passed every command
  except lint's twelve new-file errors; those were corrected without weakening assertions.
  The final full Case 2 rerun passed all eight commands. The
  [AI pre-review and dispositions](./05-entra-token-destination-hardening-review.md) record all
  findings and fixes. Live/cloud/workbench/localized-layout checks remain explicitly unverified.
  After the B7 parser-parity correction, both cases were repeated in full: **1,085 focused tests
  in 42 files**, then **6,349 full-suite tests passed and 1 skipped in 347 files**.
- **B7 — Done (2026-11-10), commit `87c6bb52e`:** selected Native/No Authentication can no longer
  run URI-selected machine OIDC outside the guarded handlers. Advised (`claude-opus-5.5`, high
  confidence): match the installed driver's effective mechanism, including regex/abbreviation
  semantics, before removing competing runtime properties. Preserve genuine native strings and
  TLS options exactly. Four focused files passed 106 tests; TypeScript and focused lint passed.
  The leader corrected the worker mock to expose the real enum after the helper gained that
  dependency (one surgical test edit outside coding-agent execution).

All nine execution batches are complete. B7's additional plan was committed as `05c14f5bc`
before its implementation. The results below supersede the pre-B7 green run and cover the
final approved parser-parity correction. The PR remains a draft for the operator's final review
and recorded manual/live checks; **Case 2 was not deferred**.

| Verification                              | Final result                                                   |
| ----------------------------------------- | -------------------------------------------------------------- |
| Case 1: `npm run build`                   | Passed                                                         |
| Case 1: all affected focused Vitest tests | 42 files, 1,085 tests passed                                   |
| Case 2: `npm run l10n`                    | Passed; source bundle committed separately                     |
| Case 2: `npm run prettier-fix`            | Passed                                                         |
| Case 2: `npm run l10n:check`              | Passed                                                         |
| Case 2: `npm run lint`                    | Passed after twelve lint fixes                                 |
| Case 2: `npm run build`                   | Passed                                                         |
| Case 2: `npm run typecheck:tests`         | Passed, exact workspace script                                 |
| Case 2: `npx vitest run --reporter=dot`   | 347 files; 6,349 passed, 1 skipped; 82.25 seconds              |
| Case 2: `npm run package`                 | Passed; unsigned local VSIX, 204 files, 8.56 MB; not published |

A sixth, narrowly scoped Opus 5.5 consultation clarified the SRV acceptance wording after the
green run (high confidence; no production change). Eager interactive sign-in can occur for an
approved SRV URI before malformed or rejected DNS answers are known. The driver callback is
not invoked for rejected resolved seeds and no token is transmitted. The original matrix row
below was corrected so the harness's callback assertion is not misrepresented as proof of zero
interactive session acquisition. This follows the earlier advisor's recorded eager-sign-in
design, not a new token-destination exception.

### Lead usage snapshot

Window: 2026-11-10 15:19:08 UTC through 16:59 UTC (about 100 minutes wall-clock).
Source: the #1073 `agent-stats.mjs` helper and this session's host events, with explicit advisor
roles for all nine completed consultations and the failed review attempt. This snapshot excludes
subsequent leader work and the final response. One advisor launch failed with `401 Unauthorized`
before work and was retried once on the same model. Sync-agent follow-up was unsupported, so
subsequent narrower reviews used fresh contexts. One coding attempt stopped without edits over
the invalid `DB-OIDC` example; the actual driver error was retained and the narrow task continued.
All attempts, including the stopped attempt and test rework, are included where the host reports usage.

| Model             | Role    | Requests | Summed model time |   AIU | Share |
| ----------------- | ------- | -------: | ----------------: | ----: | ----: |
| `claude-opus-5.5` | advisor |      212 |            25m20s | 903.7 | 56.2% |
| `gpt-6.1-sol`     | leader  |       52 |            17m50s | 151.3 |  9.4% |
| `gpt-6.1-sol`     | coding  |      256 |            54m18s | 550.5 | 34.3% |
| `gpt-5.6-luna`    | checks  |       10 |               40s |   1.1 |  0.1% |

Each role has one model in this run, so these rows also give role totals. Leader: **151.3 AIU**;
subagents: **1,455.3 AIU**; run: **1,606.6 AIU**. AIU are not dollars.
All coding batches used the harness default `gpt-6.1-sol`; only the operator-named advisor model
was explicitly selected.

| Model / role                |      Input |  Output | Cache read | Cache write | Reasoning |
| --------------------------- | ---------: | ------: | ---------: | ----------: | --------: |
| `claude-opus-5.5` / advisor | 16,455,244 | 137,821 | 15,832,334 |     622,468 |    77,754 |
| `gpt-6.1-sol` / leader      |  5,700,380 |  56,908 |  5,544,588 |     155,636 |    17,724 |
| `gpt-6.1-sol` / coding      | 16,210,029 | 209,061 | 15,462,753 |     746,508 |    69,929 |
| `gpt-5.6-luna` / checks     |    187,118 |   2,216 |    165,286 |      21,802 |     1,457 |

Cache and reasoning fields may overlap input/output; they must not be added into a token total.
Summed request spans overlap and are not wall-clock elapsed time. The helper does not report a
separate end-to-end check/CI duration here; command logs provide individual execution evidence.
No hosted CI result is included in this local snapshot.

The snapshot includes the SRV clarification, B7 diagnosis, unsuccessful review launch, parser-parity
finding and final B7 approval. Failed-attempt metrics absent from host events are not inferred as zero.

Optimization: advising was the largest measured category. Nine consultations included integration
and review-driven rework; the initial broad advisor investigation was particularly expensive.
Future runs can start with smaller source-backed decision packets and retain an available advisor
context, while preserving the operator's chosen model and the required risky-logic review gates.

### WI0 bounded measurement query (not executed)

`src/utils/authTrace.ts` writes the local Output operation `entraDestination.evaluated`.
That is **not a telemetry event name**. When an `AuthTraceContext` has `startupProperties`,
`traceAuthFlow` projects `entraDestinationClass` into the existing `connect.startup` and
`worker.startup` events. Its closed values are `documentdbService`, `customSuffix`, `otherAzure`,
and `other`. Rejections additionally project string-valued `microsoftCloudDomain` and
`serviceLabel` booleans. The service-label flag tests exact `mongocluster` or `documentdb` DNS
labels; the Microsoft-domain flag includes `windows.net` and its DNS children with a dot-boundary
check. These flags classify rejections only and do not authorize destinations. They are not
hostnames, resource identifiers, or a full endpoint inventory.

This example uses the documented `RawEventsVSCodeExt` schema and lowercased ingested property
names. It bounds the time window to seven days, the extension/event population, and the number
of returned groups. Run only through the authorized telemetry workflow:

```kusto
let endTime = now();
let startTime = endTime - 7d;
RawEventsVSCodeExt
| where ServerTimestamp >= startTime and ServerTimestamp < endTime
| where EventName startswith "ms-azuretools.vscode-documentdb/"
| where EventName endswith "connect.startup" or EventName endswith "worker.startup"
| extend auth = tostring(Properties.authmethod),
         destinationClass = tostring(Properties.entradestinationclass),
         surface = tostring(Properties.surface),
         outcome = tostring(Properties.startupoutcome),
         microsoftCloudDomain = tostring(Properties.microsoftclouddomain),
         serviceLabel = tostring(Properties.servicelabel)
| where auth in ("MicrosoftEntraID", "ManagedIdentity")
| extend destinationClass = iff(isempty(destinationClass), "notRecorded", destinationClass)
| summarize attempts = count()
    by day = bin(ServerTimestamp, 1d), surface, auth, destinationClass,
       microsoftCloudDomain, serviceLabel, outcome
| order by day desc, attempts desc
| take 200
```

`otherAzure`/`other` are rejected classes; `customSuffix` counts admitted custom destinations,
not the number of custom domains or users. `notRecorded` means missing instrumentation/evaluation,
not a trusted or rejected destination. These are startup attempts, not unique clusters or users:
a tree connection and its shell can count separately. Picker-only decisions, cached-client reuse,
driver reconnects and later token relays are not independent startup events, so this is not a
complete rejection census. The 200-group cap can truncate the result.

The query has **not been executed**, ingestion is not verified, and there is no production
population estimate or pre-enforcement sizing. Shipping measurement and enforcement together
cannot establish what a measurement-first release would have shown.

### Local evidence limits

The 28-test `oidcDestination.harness.test.ts` exercises the real driver and TLS with dummy tokens.
Its later-SRV rejection uses a trailing-dot host that passes the driver's parent-domain check but
fails destination policy; it does not demonstrate an arbitrary out-of-domain poll answer reaching
the hook. Government/China/private-link service endpoint and certificate acceptance remain
unverified. Manual consent/picker/modal/recovery presentation, Learn More navigation and locale
layout are still open. No production query, service-team confirmation, service-specific audience
request or upstream driver report was performed.

## Goal

Prevent an externally supplied connection from causing the DocumentDB extension to send an Entra
database access token to an untrusted server. Enforce the same destination policy for URL links,
pasted connection strings, edited connection strings, saved connections, managed identity, and
shell/playground sessions.

Related intent: [deep links](../README.md), [sovereign clouds](../../sovereign-clouds/README.md),
[managed identities](../../managed-identities/README.md) and [SRV DNS fallback](../../srv-dns-fallback/README.md).
The connectivity troubleshooter's private-endpoint DNS work (not yet on this branch:
`docs/ai-and-plans/features/connectivity-troubleshooter/` on `dev/tnaum/connectivity-troubleshooter`)
supplied the private-link host forms in [R6](#r6-endpoint-inventory-wi1-evidence).

## Problem and existing defenses

The current OIDC allowlist permits cloud-wide suffixes such as `*.azure.com`. Those suffixes include
customer-controlled servers, not just Microsoft-operated database services. A customer-controlled
Azure hostname with a valid TLS certificate is therefore not sufficient evidence that the server
should receive an Azure database token.

For a new connection, the reviewed attack requires the user to open a crafted connection link,
accept **Add and open**, choose Microsoft Entra ID, and complete any required account authorization.
The server can receive the token during the authentication exchange even if database authorization
subsequently fails. This is not a zero-click attack.

The credential at risk is a database-audience access token, not a password or refresh token, and not
automatically an ARM or Microsoft Graph token. It is not bound to the particular database hostname
in the link. Its audience, `https://ossrdbms-aad.database.windows.net` (with per-cloud equivalents),
is the shared Azure OSS RDBMS resource, not a DocumentDB-only one ([R5](#r5-the-token-audience-is-shared-with-other-azure-database-services)).
Replay is therefore possible against any DocumentDB cluster **or Azure Database for PostgreSQL or
MySQL server** where the identity holds a database role and the attacker has network access. It is
still constrained by expiry, Conditional Access policies and network access.

Retain the existing defenses, with the limits found in the research:

- Mandatory confirmation before a link adds a new connection.
- Removal of URL-supplied certificate-validation bypasses, with the existing loopback exception.
  **Links only:** pasted and saved strings keep bypass parameters for public hosts, and Entra uses
  them ([R3](#r3-certificate-validation-bypass-survives-into-entra-connections)).
- Driver validation of OIDC destinations after initial SRV resolution. **Seed hosts only, once,
  and skipped entirely when `ENVIRONMENT` is present** ([R1](#r1-what-the-driver-actually-enforces)).
- Extension-controlled token audiences and removal of competing URI authentication properties.
  **Main-thread handlers and managed-identity paste only:** links and the shell/playground worker
  keep them ([R2](#r2-competing-uri-authentication-properties-survive-on-two-paths)).
- ARM-derived endpoints for `/connect/azure`, rather than a URL-supplied database endpoint.
- For interactive sign-in, the host/cloud mismatch check (`documentdbTokenResource.ts:156`). It
  already stops a Government- or China-signed-in user from requesting a token for a public-cloud
  host ([R7](#r7-customer-controlled-names-inside-todays-wildcards)).

The preceding read-only review demonstrated the broad-allowlist path with the real authentication
handler and installed driver, mocked authentication, blocked networking, and a dummy token delivered
to an in-memory authentication sink. It reported 350 passing targeted tests. No real credential or
live replay was used. Those results establish the starting concern; they are not verification of
this proposed fix.

## Research findings (2026-11-10)

Read-only research against the installed driver (`mongodb` 7.2.0), the extension code on this
branch, Microsoft documentation, and the sovereign-cloud, SRV-fallback and connectivity-troubleshooter
records. Driver probes ran offline: they used loopback or unresolvable hosts and a dummy token.
No real credential or live cloud was involved.

### R1. What the driver actually enforces

`MongoClient.connect()` checks every seed host against `ALLOWED_HOSTS` after the initial SRV
lookup and before the topology opens (`node_modules/mongodb/lib/mongo_client.js:236-247`). Its
limits are:

- **Once only.** Hosts added later are not re-checked. These include replica-set members learned
  from `hello` (`hosts`, `passives`, `primary`), SRV polling results and reconnects to new members.
  Pool connections to such members still authenticate through the OIDC callback, either with
  speculative authentication or with `saslStart`.
- **Skipped when `ENVIRONMENT` is set.** `isServiceAuth` (line 240) skips the whole check if the
  merged mechanism properties contain `ENVIRONMENT`, even when our `OIDC_CALLBACK` is also set.
  `getWorkflow` (`mongo_client_auth_providers.js:64`) still prefers `OIDC_CALLBACK`, so the VS Code
  session token goes to an unchecked host. Offline probe: with the URI property
  `authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:x` and
  `ALLOWED_HOSTS: ['*.mongocluster.cosmos.azure.com']`, `mongodb://evil.example.com:27999/`
  reached server selection and failed only with `ENOTFOUND`. Without the property it failed at
  once with `Host '…' is not valid for OIDC authentication`.
- **String matching only.** A host matches when it equals the pattern or ends with `.` plus the
  suffix (`utils.js:78`); `HostAddress` lowercases hosts (`utils.js:717-722`). A trailing-dot FQDN
  does not match, which fails closed. Our own predicate must reach the same result.
- **Hostname, not identity.** The check says nothing about who answers the name unless certificate
  validation is also enforced ([R3](#r3-certificate-validation-bypass-survives-into-entra-connections)).
- The extension's SRV fallback (`prepareDriverConnectionString`) may rewrite `mongodb+srv://` to
  `mongodb://` before the driver sees it. It keeps the driver's parent-domain rule
  (`packages/documentdb-js-srv-resolver/src/srvUriRewrite.ts:127`) and its TXT allowlist
  (`authSource`, `replicaSet`, `loadBalanced`), so it does not widen destinations. It does,
  however, turn SRV polling off for that connection. An extension-side pre-token check must
  therefore inspect the same resolved host list that the driver will check.

### R2. Competing URI authentication properties survive on two paths

- The main-thread Entra and managed-identity handlers delete `authMechanism` and
  `authMechanismProperties` (`MicrosoftEntraIDAuthHandler.ts:98-99`,
  `ManagedIdentityAuthHandler.ts:79-80`).
- A pasted connection string loses them only when it declares `MONGODB-OIDC` with
  `ENVIRONMENT:azure` (`PromptConnectionStringStep.ts:75-79`).
- The link import strips TLS-bypass parameters (`vscodeUriHandler.ts:555`) but not authentication
  properties, so `authMechanismProperties=ENVIRONMENT:azure,…` can be saved from a link.
- The shell and playground worker receive the saved string (`ShellSessionManager.buildInitMessage`,
  `WorkerSessionManager.initializeWorker`). The worker adds its own `ALLOWED_HOSTS` and
  `OIDC_CALLBACK` (`playgroundWorker.ts:149-152`) without stripping URI properties. Under R1, a
  saved `ENVIRONMENT` therefore disables the host check for shell and playground sessions.

Reachability today: a shell or playground needs cached credentials from a successful tree connection
(`openInteractiveShell.ts:63`). That connection goes through the stripped main-thread path, so this
gap cannot be reached on its own for a host that the main path rejects. It is a **latent bypass**
that matters as soon as the allowlist is narrowed: if the main path rejects a host but the worker
cannot, the worker becomes the weaker path. Fix it within this work.

### R3. Certificate-validation bypass survives into Entra connections

`tlsException.ts` deliberately leaves bypass parameters in saved strings for public hosts, so that
self-hosted servers keep working (`tlsException.ts:33-38`, `:146-158`). The OIDC handlers delete
only `tls` (`MicrosoftEntraIDAuthHandler.ts:100`, `ManagedIdentityAuthHandler.ts:81`). Offline
`parseOptions` with `tls: true` and OIDC options gave these results:

| URI parameter                      | Effective driver option                        |
| ---------------------------------- | ---------------------------------------------- |
| `tlsInsecure=true`                 | `rejectUnauthorized: false`                    |
| `tlsAllowInvalidCertificates=true` | `rejectUnauthorized: false`                    |
| `tlsAllowInvalidHostnames=true`    | no-op `checkServerIdentity` (no object option) |

A pasted or saved Entra connection that carries one of these parameters sends the token to whoever
answers the allowlisted name. That could be a DNS spoofer, a hostile network, a hosts-file entry or
a TLS-intercepting proxy. A hostname allowlist protects only when certificate validation is also on,
so this belongs to the same invariant rather than a separate hardening item. Links are not affected:
their bypass parameters are stripped, and only loopback hosts get the exception.

### R4. A supported per-connection enforcement point exists

The OIDC callback cannot enforce destinations: `OIDCCallbackParams` carries no host. The driver
does, however, pass `checkServerIdentity` and an SNI `servername` (the host, for non-IP hosts) to
every TLS socket, for both monitoring and pool connections (`cmap/connect.js:191-263`). Node calls
`checkServerIdentity` during the handshake, before the driver writes any application data.

Offline loopback harness: self-signed CA, `tls: true`, `MONGODB-OIDC` with a dummy callback, and a
`checkServerIdentity` that always rejects:

| Variant                             | TLS sessions completed | Bytes the server received | Hook calls | Token callbacks |
| ----------------------------------- | ---------------------- | ------------------------- | ---------- | --------------- |
| Hook only                           | 0                      | 0                         | 3          | 0               |
| URI `tlsInsecure=true`              | 1                      | 320 (driver handshake)    | 1          | 0               |
| URI `tlsAllowInvalidHostnames=true` | 0                      | 0                         | 3          | 0               |

Conclusions:

- A destination-policy check composed into `checkServerIdentity` (policy first, then
  `tls.checkServerIdentity`) covers SRV polling, topology-discovered members, reconnects and token
  refresh, without event-listener races.
- It works **only while certificate validation stays on**. Node ignores a `checkServerIdentity`
  failure when `rejectUnauthorized` is false (row 2), which makes R3 a hard prerequisite.
- The object option overrode the URI's no-op hostname check (row 3). Pin this precedence with a test
  rather than rely on it.
- Still to verify: TLS session resumption skips the callback (the driver does not share sessions
  across hosts today, so pin that with a test). IP-literal hosts get no SNI and must be rejected by
  policy anyway. Saved data must never be able to supply `servername` or `checkServerIdentity`;
  only object options can set them today, so keep it that way.

### R5. The token audience is shared with other Azure database services

The audiences in `entraScopes.ts:17-21` (plus Bleu and Delos in `documentdbTokenResource.ts:96-102`)
are each cloud's `ossrDbmsResourceId` from ARM metadata, the resource behind Azure CLI's
`--resource-type oss-rdbms`. Azure Database for PostgreSQL and Azure Database for MySQL Flexible
Server use the same audience for Entra authentication. A captured token can therefore also be
replayed against those servers, wherever the identity has a role and the attacker has network access.
Update the impact statement and severity rating to reflect this. Binding the audience to
DocumentDB alone would be a service change outside this work; record it as a request to the service
team.

### R6. Endpoint inventory (WI1 evidence)

Every Azure DocumentDB host form found sits under `mongocluster.cosmos.<azure TLD>`:

| Form                                 | Public                                                                                                                 | US Government                                                                                                 | China                                           | Evidence                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster (SRV) host                   | `<cluster>.mongocluster.cosmos.azure.com`                                                                              | `<cluster>.mongocluster.cosmos.azure.us` (assumed)                                                            | `<cluster>.mongocluster.cosmos.azure.cn`        | Learn; [China Entra how-to](https://docs.azure.cn/en-us/documentdb/how-to-connect-role-based-access-control); Government confirmed by the operator but not publicly documented ([research](../../sovereign-clouds/research-findings.md)) |
| Global read-write (replication) host | `<cluster>.global.mongocluster.cosmos.azure.com`                                                                       | unverified                                                                                                    | `<cluster>.global.mongocluster.cosmos.azure.cn` | China how-to; SRV-fallback incident (`_mongodb._tcp.<cluster>.global.mongocluster.cosmos.azure.com`)                                                                                                                                     |
| SRV targets and node hosts           | `fc-<hash>-000.<cluster>.mongocluster.cosmos.azure.com` (children of the SRV host, as the parent-domain rule requires) | unverified                                                                                                    | `<node-hostname>.mongocluster.cosmos.azure.cn`  | Troubleshooter fixtures (`panelDetails.test.ts`); Learn private-link page                                                                                                                                                                |
| Private endpoint zone (CNAME target) | `privatelink.mongocluster.cosmos.azure.com`, for example `fc-<hash>-000.privatelink.mongocluster.cosmos.azure.com`     | **Not listed:** the Private Endpoint DNS reference lists only the RU zone `privatelink.mongo.cosmos.azure.us` | `privatelink.mongocluster.cosmos.azure.cn`      | [Private Endpoint DNS zone values](https://learn.microsoft.com/azure/private-link/private-endpoint-dns) (fetched 2026-11-10); [China private link](https://docs.azure.cn/en-us/documentdb/how-to-private-link)                           |
| Legacy prefix                        | `c-<cluster>.mongocluster.cosmos.azure.com`                                                                            | —                                                                                                             | —                                               | Troubleshooter fixtures                                                                                                                                                                                                                  |
| Port                                 | 10260                                                                                                                  | 10260 (assumed)                                                                                               | 10260 (assumed)                                 | Troubleshooter reports                                                                                                                                                                                                                   |

Notes:

- A private endpoint is a DNS CNAME. The driver and TLS see the name in the connection string, not
  the CNAME target. A user who types the `privatelink.` FQDN directly stays under the same suffix;
  whether the service certificate covers that name is unverified, and is the service's concern.
- **Not Entra destinations:** RU accounts, `<account>.mongo.cosmos.azure.{com,us,cn}` and legacy
  `<account>.documents.azure.{com,us,cn}:10255`. Their MongoDB API documents only key and SCRAM
  authentication, and a [Microsoft Q&A thread (October 2025)](https://learn.microsoft.com/answers/questions/5599871/is-mongo-oidc-available-on-azure-cosmosdb-for-mong)
  found no `MONGODB-OIDC` support. They are Microsoft-operated, so including them would not leak
  tokens to customers, but there is no reason to send a token there. Exclude them, and revisit if
  RU adds OIDC.
- **Other clouds:** Bleu (`sovcloud-api.fr`), Delos (`sovcloud-api.de`) and the air-gapped
  Government Secret and Top Secret clouds publish no DocumentDB host suffix. They are reachable only
  through `documentDB.customEnvironment.hostnameSuffix`.

### R7. Customer-controlled names inside today's wildcards

The exploit needs a name the attacker can point at a raw-TCP endpoint where the attacker terminates
TLS with a publicly trusted certificate.

| Cloud         | Current allowlist | Known customer-controlled raw-TCP names                                                                                                                                                                                                                            | Inside the allowlist?        |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Public        | `*.azure.com`     | Public IP DNS labels `<label>.<region>.cloudapp.azure.com`, including the hashed-scope form `<label>.<hash>.<region>.cloudapp.azure.com`. They serve VMs, load balancers, Application Gateway and AKS LoadBalancer services. ACME CAs issue certificates for them. | **Yes: the reviewed vector** |
| US Government | `*.azure.us`      | Public IP labels are `<label>.<region>.cloudapp.usgovcloudapi.net` ([Compare Azure Government and global Azure](https://learn.microsoft.com/azure/azure-government/compare-azure-government-global-azure))                                                         | No                           |
| China         | `*.azure.cn`      | Public IP labels are `<label>.<region>.cloudapp.chinacloudapi.cn` ([China public IP addresses](https://docs.azure.cn/en-us/virtual-network/ip-services/public-ip-addresses))                                                                                       | No                           |

- The reviewed vector is specific to the public cloud. `*.azure.us` and `*.azure.cn` are still
  cloud-wide namespaces whose customer-controllable names have not been inventoried, and new ones
  can appear at any time. Narrow all three; do not argue that the sovereign wildcards are safe.
- Interactive sign-in is partly protected across clouds: when the host's cloud differs from the
  signed-in cloud, audience resolution fails before any token is requested
  (`documentdbTokenResource.ts:156`). Managed identity derives its cloud from the host instead and
  has no such guard. Hosts with no Azure evidence (custom names, IP addresses) skip the mismatch
  check and get the configured cloud's audience. Today they are rejected only because they cannot
  match `*.azure.com`.
- HTTP-only multi-tenant front ends under `azure.com`, such as Azure Machine Learning online
  endpoints, cannot speak the wire protocol. With a service-specific suffix, the fix does not depend
  on keeping this inventory complete.

### R8. Compatibility cost is small: unrecognized Entra destinations already fail

Today an Entra or managed-identity host must match `*.azure.<tld>` or the custom suffix, and
certificate validation is on unless the user added a bypass parameter. Under the narrowed policy:

| Scenario                                                                   | Today                                                                        | After                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Service FQDN, public access or private endpoint with private DNS           | Works                                                                        | Works                                                                                                                      |
| `privatelink.` FQDN typed directly                                         | Works if the certificate covers it                                           | Same                                                                                                                       |
| Custom DNS alias (for example `db.contoso.internal` CNAME to private link) | Fails, unless a custom suffix is set **and** hostname validation is bypassed | Fails: the bypass is no longer honored for Entra ([R3](#r3-certificate-validation-bypass-survives-into-entra-connections)) |
| IP literal, `localhost` SSH tunnel, `kubectl port-forward`                 | Fails (`*.azure.com` does not match)                                         | Fails; Entra stays unsupported here                                                                                        |
| Other Azure hosts (`*.cloudapp.azure.com`, RU accounts, other services)    | Token sent                                                                   | Rejected before token acquisition                                                                                          |

- The only legitimate population that loses anything is a self-hosted server on an Azure name that
  validates `ossrdbms` tokens itself. This is expected to be zero; confirm it with telemetry.
- `PromptConnectionStringStep.ts:120` offers managed identity whenever the string declares
  `MONGODB-OIDC`, even for unrecognized hosts ("private endpoint or CNAME"). Under the new policy
  that choice would always fail, so it should explain why instead.
- The existing `entraCloud.resolved` trace details (`hostCloud`, `hostsOutsideAzure`) do not
  distinguish `mongocluster` hosts from other `azure.com` hosts. Add a bounded
  `entraDestinationClass` value (`documentdbService` | `customSuffix` | `otherAzure` | `other`)
  so the cost can be measured before enforcement.

### R9. Other host classifiers must not become security predicates

- `AzureDomains`, `hasAzureDomain` and `hasDomainSuffix` (`connectionStringHelpers.ts:84-103`)
  drive cluster metadata, RU detection during import, and SRV telemetry. They know only the public
  cloud.
- `getAzureHostSuffix` also gates the extension `appName` (`ClustersClient.ts:368`). It classifies
  the cloud; it does not authorize.
- `hasDocumentDBHost` uses `some()`, which suits recognition. The authorization predicate needs
  `every()`.
- The connectivity troubleshooter treats `privatelink.` CNAME chains and address classes only as
  evidence. Its decision log records that "DNS resolution and access control are independent", and
  that the alias does not even prove a private endpoint exists. The destination policy must never
  trust resolved CNAMEs or private/public address classes: for a name the attacker controls, the
  attacker controls those answers too.

### R10. Token acquisition sites

- **Before the driver's host check.** Interactive Entra tokens are acquired at
  `MicrosoftEntraIDAuthHandler.ts:58`, and for worker `tokenRequest` messages at
  `ShellSessionManager.ts:436` and `PlaygroundEvaluator.ts:452`.
- **At the callback or worker relay.** Managed identity acquires at the driver callback
  (`ManagedIdentityAuthHandler.ts:88`) and at the worker relays in `ShellSessionManager` and
  `PlaygroundEvaluator`.
- **Required at every site:** check the policy before acquiring a token. A worker relay must check
  against the connection the worker was started for, never against a host named in the worker's
  message.

### R11. Manually created and edited connections

The same attack works without a link. The attacker gives the victim a connection string (in a chat,
a README or a support thread), or asks them to edit an existing connection. This is a more targeted
attack, because the victim has to take more steps. It also skips the link's **Add and open**
confirmation, so the destination policy is the only control.

| Entry point                                                                             | Entra offered for any host today?                                                                                                                                                                                                                                               | After saving                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New Connection** (paste a string)                                                     | **Yes.** `newConnection/PromptAuthMethodStep` builds its items with `createAuthMethodQuickPickItemsWithSupportInfo`, which lists every method, whatever `availableAuthenticationMethods` says (`AuthMethod.ts:162-168`). It is skipped only when detection preselects a method. | `selectedAuthMethod` is stored                                                                                                                                                            |
| **Update Credentials** (context menu, or the recovery action under a failed connection) | **Yes.** `shouldPrompt()` always returns `true`, and the same helper lists every method. `hasDocumentDBHost` only changes which methods are flagged as supported (`updateCredentials.ts:77`).                                                                                   | `selectedAuthMethod` is stored                                                                                                                                                            |
| **Update Connection String**                                                            | Not asked. The method is kept.                                                                                                                                                                                                                                                  | **The hosts change, and the stored Entra or managed-identity method and `availableAuthMethods` stay as they were** (`updateConnectionString/ExecuteStep.ts:40-67`); nothing is re-checked |
| **First open of a link-created connection**                                             | **Yes.** The link stores `availableAuthMethods: []` (`vscodeUriHandler.ts:705`), so `ChooseAuthMethodStep` finds no family and shows every method                                                                                                                               | `selectedAuthMethod` is stored if the user saves credentials                                                                                                                              |
| Add from Azure Resources or Discovery (`addConnectionFromRegistry`)                     | Methods come from the provider. Azure hosts come from ARM, but other providers (Kubernetes, Atlas, custom registries) supply their own hosts.                                                                                                                                   | Provider's method is stored                                                                                                                                                               |

Once `selectedAuthMethod` is Entra or managed identity, expanding the connection in the tree
connects **without any prompt** (`DocumentDBClusterItem.ts:111-127`): the picker runs only when
no method is stored, or when native credentials are missing. Shell, playground, Collection View and
dashboard reuse the cached credentials. A connection's trust is therefore decided once and reused
silently on every later connect, reconnect, VS Code restart and token refresh.

The most targeted variant follows from that. The victim already has a working Entra connection to
a real cluster. The attacker says "we migrated the cluster, update your connection string to …",
and the victim runs **Update Connection String**. The next expand sends a token to the new host
with no prompt, because the method and stored `availableAuthMethods` came from the old,
legitimate host.

What cannot happen without code already running on the victim's machine:

- Connections and secrets live in `globalState` and `SecretStorage`; no key is registered with
  `setKeysForSync`, so Settings Sync does not carry connections between machines.
- `documentDB.customEnvironment.hostnameSuffix` is machine-scoped, so a workspace cannot set it.
- The public extension API (`api/src/extensionApi.ts`) exposes the migration API, not a way to add
  connections.

Conclusion: the destination policy must be evaluated **at connect time, for every connection,
every time**, from the current hosts and current settings. Never store a decision at save time or
derive it from stored `availableAuthMethods`. The UI checks below are for UX and explanation; the
handler check is the security control.

## Proposed design

### 1. One service-specific destination policy

Evolve [oidcAllowedHosts.ts](../../../../../src/documentdb/auth/oidcAllowedHosts.ts) into the shared
source of destination trust rather than adding a URL-handler-only check.

- Replace built-in cloud-wide patterns with a curated set of verified database-service suffixes.
  Proposed built-ins, from [R6](#r6-endpoint-inventory-wi1-evidence):
  `*.mongocluster.cosmos.azure.com`, `*.mongocluster.cosmos.azure.cn` and
  `*.mongocluster.cosmos.azure.us`. The Government entry rests on operator confirmation, not
  published documentation; keep it only if the review accepts that or the service team confirms it.
  These patterns cover cluster, `global.`, node and SRV-target, `privatelink.` and legacy `c-` names.
  Exclude RU accounts and every other Azure service.
- Close the remaining sovereign and private-endpoint gaps in R6 with service-owner confirmation or
  sanitized endpoint evidence: the Government cluster, `global.` and private-link forms.
- Reject malformed or unrecognized Entra destinations explicitly. Remove the fallback to
  `*.azure.com`; failure to classify a destination must not broaden trust.
- Check every seed host. Do not reuse `hasDocumentDBHost()` unchanged as the security predicate:
  its current `some()` semantics are appropriate for recognition, not authorization of a
  multi-host connection.
- Normalize hostnames consistently and match DNS label boundaries, not substrings. Cover ports,
  case, lookalikes (`xmongocluster.cosmos.azure.com`, `mongocluster.cosmos.azure.com.evil.com`,
  unknown TLDs such as `azure.tk`), IP literals, punycode and non-ASCII names, and trailing dots.
  Make the trailing-dot decision identical in our predicate and in the input the driver sees
  ([R1](#r1-what-the-driver-actually-enforces)).
- Keep cloud classification separate from destination authorization. A host can provide evidence
  about an Azure cloud without being an approved token recipient. Never use resolved CNAMEs or IP
  address classes as trust signals ([R9](#r9-other-host-classifiers-must-not-become-security-predicates)).
- Preserve the existing audience-resolution and cloud-mismatch checks; do not infer a new audience
  from a link or an arbitrary server response.

Native/password authentication remains outside this new Entra destination restriction.

### 2. Enforce before token acquisition and throughout connection use

The intended sequence is:

```text
Parse connection -> validate destination policy -> resolve audience
                 -> validate resolved connection targets -> acquire token -> authenticate
```

In [MicrosoftEntraIDAuthHandler.ts](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts),
move destination validation ahead of `getSessionFromVSCode`. Prefer acquiring the token at the
driver callback after its destination checks, while preserving account selection, error handling,
and connection timing behavior. Apply the same rule at every acquisition site listed in
[R10](#r10-token-acquisition-sites).

Use the same policy in:

- [ManagedIdentityAuthHandler.ts](../../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts).
- [WorkerSessionManager.ts](../../../../../src/documentdb/playground/WorkerSessionManager.ts) and
  [playgroundWorker.ts](../../../../../src/documentdb/playground/playgroundWorker.ts), which serve
  shell and playground sessions, and the token relays in
  [ShellSessionManager.ts](../../../../../src/documentdb/shell/ShellSessionManager.ts) and
  [PlaygroundEvaluator.ts](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts).
- Connections reopened from storage and subsequent reconnects, not just new connections or links.

#### One OIDC options builder for every path

Build OIDC client options in one shared function that the main-thread handlers and the worker
both use. It must:

- Clear the username and password, and remove `authMechanism` and `authMechanismProperties` from
  the URI, so that `ENVIRONMENT` can never reach the driver
  ([R1](#r1-what-the-driver-actually-enforces), [R2](#r2-competing-uri-authentication-properties-survive-on-two-paths)).
- Remove `tls` and every TLS-bypass parameter: `tlsInsecure`, `tlsAllowInvalidCertificates`,
  `tlsAllowInvalidHostnames`, their `ssl*` aliases and `rejectUnauthorized`. Never set
  `tlsAllowInvalidCertificates` for OIDC. **OIDC never runs with certificate or hostname validation
  disabled.** No loopback exception is needed, because loopback is never an approved Entra
  destination. Do not strip these parameters from the saved string: native-auth users of the same
  connection may depend on them. Strip them only from the OIDC client options.
- Set `ALLOWED_HOSTS` to the narrowed patterns.
- Set `checkServerIdentity` to a function that runs the destination policy on the hostname first
  and then delegates to `tls.checkServerIdentity`. This is the per-connection enforcement point
  ([R4](#r4-a-supported-per-connection-enforcement-point-exists)), and it covers topology-discovered
  members, SRV polling, reconnects and token refresh.

Layers, in order: policy check before token acquisition, then driver `ALLOWED_HOSTS` on resolved
seeds, then `checkServerIdentity` on every TLS connection, all under enforced certificate
validation. Each layer must be independently tested; none replaces another.

Continue supplying the narrowed `ALLOWED_HOSTS` to the driver. Initial seed validation alone is
not the complete invariant: SRV results, topology-discovered members, reconnects, and token refresh
must not introduce a recipient outside the policy.

Verify the installed driver's behavior with an offline protocol-level harness. The OIDC callback
has no destination context (`OIDCCallbackParams` carries no host), so per-connection enforcement
relies on `checkServerIdentity`. If the harness shows a gap, close it with a supported mechanism or
a reviewed driver fix before claiming coverage. Do not use a timeout, an event-listener race or a
broad wildcard as a workaround. Consider reporting upstream that `ENVIRONMENT` disables the
`ALLOWED_HOSTS` check even when `OIDC_CALLBACK` is set.

Policy failures must surface through the existing localized authentication error flow. Do not
silently fall back to another authentication method or log tokens/full connection strings.

### 3. Explain the boundary in the connection UI

In [ChooseAuthMethodStep.ts](../../../../../src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts),
do not offer interactive Entra or managed identity for a destination rejected by the shared policy.
Apply the same gating where authentication methods are computed:
[PromptConnectionStringStep.ts](../../../../../src/commands/newConnection/PromptConnectionStringStep.ts)
currently adds managed identity for any string that declares `MONGODB-OIDC`, even for unrecognized
hosts, and [updateCredentials.ts](../../../../../src/commands/updateCredentials/updateCredentials.ts)
uses `hasDocumentDBHost`. When a string declares `MONGODB-OIDC` for a rejected host, say why and
point to the service FQDN or the custom-suffix setting
([R8](#r8-compatibility-cost-is-small-unrecognized-entra-destinations-already-fail)).
Keep enforcement in the handlers even when the picker is skipped or credentials were saved earlier.

Every place that offers or keeps an authentication method must consult the same policy
([R11](#r11-manually-created-and-edited-connections)):

- **New Connection and Update Credentials pickers.** Today both list every method, whatever was
  detected. Show Entra and managed identity only when the current hosts pass the policy; otherwise
  explain why they are missing.
- **First open of a link-created connection.** `availableAuthMethods: []` must not mean "offer
  everything". Compute the methods from the policy, as the picker does.
- **Update Connection String.** When the stored method is Entra or managed identity and the edited
  hosts fail the policy, do not keep the method. Clear `selectedAuthMethod`, so the next connect
  prompts and offers only the permitted methods, and say why in the confirmation. When the hosts
  still pass, keep it: renaming a cluster or adding a replica is legitimate. Recompute
  `availableAuthMethods` from the edited hosts in both cases.
- **Connect from storage.** Saved Entra and managed-identity connections connect without a prompt,
  so a rejected destination must fail with the localized explanation and a recovery action
  (**Update Credentials** or **Update Connection String**). It must never fall back silently to
  another method.

None of these replaces the connect-time check. They exist so that users find out before connecting
rather than from an authentication error.

Suggested explanatory copy, subject to UX/localization review. The full set of strings, with length
budgets, is in [Proposed user experience](#proposed-user-experience):

> Microsoft Entra ID isn't allowed for this server.

In [vscodeUriHandler.ts](../../../../../src/vscodeUriHandler.ts), retain the mandatory new-connection
confirmation and ensure the actual destination hostname is visible, not only a friendly label.
Do not display credentials embedded in a connection string.

Do not add a one-click "send the token anyway" override to the link flow. A user accepting
**Add and open** is not a substitute for destination authorization.

### 4. Preserve explicit custom-cloud support

Retain machine-scoped `documentDB.customEnvironment.hostnameSuffix` as an explicit trust input.
Explain that it authorizes matching servers to receive database access tokens, and recommend the
narrowest service-specific suffix. Preserve existing configuration validation. Destinations
admitted by the suffix get the same every-host check, `checkServerIdentity` enforcement and mandatory
certificate validation as built-in ones. The suffix is also the only route for Bleu, Delos and
air-gapped clouds ([R6](#r6-endpoint-inventory-wi1-evidence)).

A link, a link's `source` label, workspace settings, or a host's private-network address must not
grant this trust. The built-in allowlist must not widen to accommodate an unrecognized endpoint.
Any additional restriction on explicitly configured suffixes requires a compatibility decision
during review; do not silently remove current custom-cloud support.

For Azure integrations that can supply an ARM resource ID, prefer `/connect/azure`. Do not require
ARM lookup for every connection: legitimate users may have database permissions without management
permissions. ARM-derived connections must still use the common authentication policy.

## Proposed user experience

This is the walkthrough discussed with the operator on 2026-11-10. It assumes the plan is
implemented. All wording is proposed, pending UX and localization review (review decision 3).
Legend: 🆕 new, ✏️ changed; anything unmarked works as it does today.

### Length limits for the new strings

These strings appear in VS Code surfaces with hard layout limits. Keep each explanation to one
short sentence, and put the background (why, the setting name, how to verify a host) on the
documentation page behind **Learn More**.

| Surface                              | Constraint                                                                                                                                                                                           | Budget used here                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Quick-pick item `label` and `detail` | One line each, cut off with an ellipsis at the picker width; no wrapping                                                                                                                             | label ≤ 40 characters, detail ≤ 70       |
| Quick-pick `placeHolder` and `title` | One line                                                                                                                                                                                             | ≤ 70                                     |
| Non-modal notification               | Cut to 1,000 characters, and line breaks become spaces (`NotificationViewItem.MAX_MESSAGE_LENGTH`, `src/vs/workbench/common/notifications.ts`); the collapsed toast shows only the first line or two | ≤ 120, one or two sentences, no layout   |
| Modal message (title)                | Shown as the heading; on Windows and Linux it can wrap, but long headings read badly                                                                                                                 | ≤ 60                                     |
| Modal `detail`                       | Multi-line; several short lines are fine                                                                                                                                                             | ≤ 4 short lines                          |
| Host names inside any string         | A multi-host seed list can be long                                                                                                                                                                   | Show the first host, then "and {n} more" |

Every target language must fit the same budget, and German or French often runs 30-40% longer than
English. Leave room for that, so not every English string should use its full budget. Setting IDs
such as `documentDB.customEnvironment.hostnameSuffix` (43 characters) do not fit a picker item or a
toast; they belong in modal details or in the documentation.

### Opening a link

**Link to an Azure DocumentDB cluster.** The **Add and open connection?** dialog is unchanged. Its
`Connection:` line already shows the real host (`user@host1,host2`).

On first open:

```
Select an authentication method for "mycluster…"
  Username and Password
  Microsoft Entra ID                ✏️ offered because the policy allows this host
  No Authentication
```

- ✏️ The method list comes from the destination policy. Today the link saves
  `availableAuthMethods: []`, which shows every method.
- Sign-in, identity and tenant prompts work as today.
- 🆕 Nothing visible: URI authentication properties and certificate-check bypass parameters are
  left out of the Entra connection options.
- `/connect/azure` links behave the same way.

**Link to a rejected host** (for example `x.eastus.cloudapp.azure.com`). The confirmation dialog is
unchanged, including the existing line about an ignored certificate-validation request. On first open:

```
Select an authentication method for "x.eastus.cloudapp.azure.com"
  Username and Password
  No Authentication
  🆕 Microsoft Entra ID: not available                     (33 characters)
     Entra ID is used only with Azure DocumentDB clusters.  (53 characters)
```

- 🆕 Entra and managed identity are not offered. Decision 3 settles whether the explanation is a
  non-selectable row (for example a separator) or an item that opens **Learn More**.
- If only one method is left, the picker is skipped, as today.
- There is no "use Entra anyway" option.

**Link that matches an existing saved Entra connection.** The connection is reused and connects
without a prompt, as today. ✏️ The destination check runs again at connect time; a rejected host
gets the connect error below.

### Adding a connection by hand (New Connection, then Connection String)

1. **How do you want to connect?**, the connection-string input and the certificate-check step for
   local hosts: unchanged.
2. ✏️ **Authentication method picker.** For an allowed host (Azure DocumentDB, or a trusted custom
   suffix) it is the same as today. For any other host it matches the link picker above, without
   Entra and managed identity.
3. 🆕 For a string that declares `authMechanism=MONGODB-OIDC` and targets a rejected host, managed
   identity is no longer preselected. The picker opens with this `placeHolder`:
   **"This server can't use Microsoft Entra ID. Choose another method."** (64 characters)
4. Tenant, identity and username steps: unchanged.
5. 🆕 Connect: for Entra connections, certificate and hostname checks are always on, even if the
   string contains `tlsInsecure` or `tlsAllowInvalidCertificates`. No dialog appears, so a server
   with an invalid certificate shows the usual certificate error. Write one line to the output
   channel so that error can be explained:
   `[Auth] TLS validation bypass parameters are ignored for Microsoft Entra ID connections.`
   Native connections that use the same parameters work as today.

### 🆕 Connecting a saved Entra connection whose host is rejected

This applies to expanding the connection in the tree, opening the shell, playground or dashboard,
or a reconnect. Failed expands are explained in a modal, and the node's children are recovery
actions:

```
┌─ Microsoft Entra ID isn't allowed for this server ─────────────┐   (title: 48 characters)
│ Entra ID tokens are sent only to Azure DocumentDB clusters and │
│ to servers you trust in settings.                               │
│                                                                 │
│ Server: x.eastus.cloudapp.azure.com                             │
│                                           [Learn More]   [OK]   │
└─────────────────────────────────────────────────────────────────┘
```

- Recovery children: **Update Credentials** (offers only the allowed methods) and
  **Update Connection String**.
- No token is requested, and the extension never switches to another method on its own.
- **Learn More** opens documentation. It must not write any setting
  ([Self-service override](#self-service-override-for-endpoints-the-extension-does-not-recognize)).

### 🆕 Editing an existing Entra connection (Update Connection String)

If the hosts are changed to ones the policy rejects, a non-modal notification appears (117
characters):

> Connection updated. Microsoft Entra ID isn't available for the new server, so choose another
> method when you connect.

If the new hosts are still allowed, the existing **"Connection updated successfully."** appears and
the method is kept. See review decision 6 for the alternatives.

### Update Credentials

✏️ The picker offers only the methods the policy allows, with the same explanation row.

**Net effect:** users of real Azure DocumentDB clusters see no new dialogs. New text appears only
when someone tries to use Entra with a host outside the policy, and nothing offers to send the token
anyway.

## Self-service override for endpoints the extension does not recognize

**Scenario.** The service adds a legitimate endpoint form, for example a new regional or
private-link name or a new domain, and this extension ships without it. Entra users of that
endpoint are blocked until a release adds it. How can they unblock themselves without reopening
the attack this plan closes?

### What other tools do

| Tool                                     | Override                                                                                                                                                                                                                                   | Scope                                                                                   | Can it come from the connection string?                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB Node.js driver (installed 7.2.0) | `ALLOWED_HOSTS` mechanism property                                                                                                                                                                                                         | Per client                                                                              | **No.** The driver rejects it: "Auth mechanism property ALLOWED_HOSTS is not allowed in the connection string" (`connection_string.js:243`) |
| MongoDB Compass                          | "Consider Target Endpoint Trusted" checkbox ([docs](https://www.mongodb.com/docs/compass/connect/advanced-connection-options/authentication-connection/))                                                                                  | Per connection, in advanced options, "only … when connecting to servers that you trust" | No                                                                                                                                          |
| mongosh                                  | `--oidcTrustedEndpoint` ([docs](https://www.mongodb.com/docs/mongodb-shell/reference/options/))                                                                                                                                            | Per invocation                                                                          | No (command-line flag)                                                                                                                      |
| MongoDB MCP Server                       | `MDB_MCP_OIDC_TRUSTED_ENDPOINT` ([docs](https://www.mongodb.com/docs/mcp-server/local-mcp/security/connect-with-oidc/))                                                                                                                    | Per process environment                                                                 | No                                                                                                                                          |
| Azure Key Vault SDKs                     | `disableChallengeResourceVerification` / `DisableChallengeResourceVerification`, default `false` ([.NET](https://learn.microsoft.com/dotnet/api/azure.security.keyvault.secrets.secretclientoptions.disablechallengeresourceverification)) | Per client, set by the developer in code                                                | No                                                                                                                                          |

Common practice across all of these:

- **The default denies; trust is added explicitly.** None of them ships a global "send tokens
  anywhere" switch for end users. Key Vault's opt-out is per client and is set by the developer in
  code.
- **Trust never comes from the input being judged.** The driver refuses `ALLOWED_HOSTS` from the
  URI, and the MongoDB tools keep the flag outside the connection string. Here, that means a link,
  a pasted string, a workspace, Settings Sync or a discovery provider must not be able to set it.
- **The narrowest scope that works:** one connection or one host suffix, not every connection.
- **Clear consequence wording:** "only … when connecting to servers that you trust".

VS Code adds two platform rules. A `machine`-scoped setting cannot be set by a workspace and is not
carried by Settings Sync. A setting can also be restricted in untrusted workspaces.

### Options considered

| Option                                                                                                                                      | Self-service                                                                    | Attack surface                                                                                                                                                                                                        | Verdict                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Global kill switch** (`documentDB.entra.allowAnyHost: true`)                                                                           | Fully self-serve                                                                | Reopens the vulnerability for every connection, every link and every edit, for as long as it stays on, and it usually does. A one-sentence social-engineering instruction ("set X to true") defeats it. No precedent. | **Reject**                                                                                                                                    |
| **B. The existing machine-scoped `documentDB.customEnvironment.hostnameSuffix`, hardened**                                                  | Yes: add the new endpoint's service suffix, such as `.newform.cosmos.azure.com` | Limited to hosts under a suffix the user typed. It is still a social-engineering target, but the attacker must make the user type a specific suffix, and that can be validated (below)                                | **Recommend.** It already exists, already authorizes token recipients, and needs no new concept                                               |
| **C. Per-connection "trust this server" option** (the Compass pattern)                                                                      | Yes, for one connection                                                         | Exactly what the R11 attacker would ask the victim to tick. It is narrower than A, but it adds a one-checkbox bypass to every connection                                                                              | **Not now.** Revisit only if telemetry shows B is not enough. If adopted, apply the guardrails below                                          |
| **D. Trust the host Azure Resource Manager reports for the user's `mongoClusters` resource** (Azure Resources, Discovery, `/connect/azure`) | Automatic for users with ARM read access; no setting needed                     | The host comes from Microsoft, not from the user. The risk is forged provenance, so only the ARM code path may set the flag, and any host edit clears it                                                              | **Worth evaluating as a follow-up.** It covers new endpoint forms for most Azure users without any trust input. Not every user has ARM access |
| **E. Remote allowlist updates** (fetched at run time)                                                                                       | Automatic                                                                       | A new network trust dependency; a compromised or spoofed feed widens trust for everyone                                                                                                                               | **Reject.** Ship list updates as releases, with a patch release (`release/X.Y.Z`) when urgent                                                 |

### Recommendation

There is no global switch. The self-service route is option B, hardened:

1. **Keep `hostnameSuffix` machine-scoped.** Workspaces, Settings Sync, links, connection strings
   and discovery providers cannot set it. Consider accepting a list, so one machine can trust a
   custom cloud and a new public endpoint form together; if so, keep the old key as an alias.
2. **Reject suffixes that would undo the fix**, using the existing validation path:
   - the cloud-wide domains `azure.com`, `azure.us` and `azure.cn`;
   - any suffix that equals or contains a known customer-hosting label (`cloudapp`, and
     `cloudapp.usgovcloudapi.net` / `cloudapp.chinacloudapi.cn`);
   - suffixes broader than a built-in service suffix, such as `cosmos.azure.com`.

   This deny list is defense in depth, not a complete inventory. The setting description must still
   say that the suffix authorizes token recipients.

3. **Make the consequence explicit** in the setting description, staying within the length budget:
   "Microsoft Entra ID tokens are sent to servers ending with this suffix. Add only a suffix you
   have confirmed belongs to Azure DocumentDB." Link to the documentation page.
4. **Do not offer a shortcut from an error.** The rejection modal offers **Learn More**, which opens
   documentation. That page explains how to confirm the host belongs to your cluster (compare it
   with the connection string shown in the Azure portal), how to report a missing endpoint form on
   GitHub, and only then how to add the suffix. No button writes the setting or opens it pre-filled.
   Opening Settings without a value is acceptable if UX prefers it.
5. **Make it visible and auditable.**
   - Log each connection that a custom suffix admitted to the output channel. Log the suffix only,
     never tokens or connection strings.
   - Record a bounded `entraDestinationClass=customSuffix` value in telemetry.
6. **Detect missing endpoints early.** When a destination is rejected, record bounded classes only,
   never hostnames:
   - whether the host's registrable domain is a Microsoft cloud domain (`azure.com`, `azure.us`,
     `azure.cn`, `usgovcloudapi.net`, `chinacloudapi.cn`, `windows.net`);
   - whether the host contains a `mongocluster` or `documentdb` label.

   A rise in rejected hosts with such labels in Microsoft domains is the signal to ship a list update.

7. **Remember the existing fallback.** Native authentication still works wherever the cluster
   allows it.

**If option C is ever adopted**, it needs these guardrails:

- Set it only from the Update Credentials or advanced-settings UI, never from a link, connection
  string, workspace or provider.
- Bind it to the exact host list; Update Connection String clears it.
- Show the exact host names and the consequence in a modal before saving.
- Never offer it from the rejection error, and log it as described above.

## Work items and dependencies

The table below is the original proposal. The accepted execution plan above takes precedence:
WI0 and enforcement ship together without pre-enforcement sizing, and WI8 retains the existing
single string, with no list or compatibility alias.

| Work item                                            | Deliverable                                                                                                                                                                                                                                                                                                                                                                                  | Prerequisite                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| WI0: Measurement                                     | Bounded `entraDestinationClass` value in auth telemetry, and a query sizing the population in [R8](#r8-compatibility-cost-is-small-unrecognized-entra-destinations-already-fail)                                                                                                                                                                                                             | None; can ship ahead           |
| WI1: Endpoint inventory                              | [R6](#r6-endpoint-inventory-wi1-evidence) confirmed: Government cluster, `global.` and private-link forms from the service team; RU `MONGODB-OIDC` status; certificate coverage of `privatelink.` names                                                                                                                                                                                      | None                           |
| WI2: Shared destination policy                       | Fail-closed validation of all hosts, narrow built-in suffixes, custom-suffix handling, normalization (case, trailing dot, punycode, IP), unit tests                                                                                                                                                                                                                                          | WI1                            |
| WI3: OIDC options builder                            | One builder for main-thread and worker paths: strips URI auth properties and TLS bypasses from OIDC options, forces certificate validation; tests for `ENVIRONMENT` and every bypass alias ([R2](#r2-competing-uri-authentication-properties-survive-on-two-paths), [R3](#r3-certificate-validation-bypass-survives-into-entra-connections))                                                 | None; can land first           |
| WI4: Per-connection enforcement                      | Narrowed `ALLOWED_HOSTS` plus composed `checkServerIdentity`; protocol harness proving no token reaches discovered, polled or reconnect destinations outside policy ([R4](#r4-a-supported-per-connection-enforcement-point-exists))                                                                                                                                                          | WI2, WI3                       |
| WI5: Token acquisition ordering                      | Policy check before every acquisition site in [R10](#r10-token-acquisition-sites), including worker relays bound to the worker's own connection                                                                                                                                                                                                                                              | WI2                            |
| WI6: Connection UX                                   | Policy-aware authentication choices in the New Connection and Update Credentials pickers and on first open of a link-created connection; Update Connection String resets a disallowed Entra or managed-identity method; clear target and error presentation, with no bypass ([R11](#r11-manually-created-and-edited-connections))                                                            | WI2                            |
| WI7: Verification and documentation                  | Acceptance matrix results; corrected replay impact ([R5](#r5-the-token-audience-is-shared-with-other-azure-database-services)); approved intent in the deep-links, sovereign-clouds and managed-identities docs; `hostnameSuffix` setting description                                                                                                                                        | WI4, WI5, WI6                  |
| WI8: Self-service override                           | Hardened `hostnameSuffix`: deny list of cloud-wide and customer-hosting suffixes, an optional list form with an alias for the old key, consequence wording, output-channel record of admitted connections; rejection telemetry classes for detecting missing endpoints; **Learn More** page ([Self-service override](#self-service-override-for-endpoints-the-extension-does-not-recognize)) | WI2; ship with the enforcement |
| WI9 (follow-up, optional): ARM-attested destinations | Evaluate option D: a provenance flag that only the ARM paths can set, cleared on any host edit                                                                                                                                                                                                                                                                                               | WI2                            |

Implement WI2, WI4-WI6 and WI8 together for the security fix. Shipping enforcement without the
self-service route (WI8) would leave users of a newly added endpoint form with nothing but native
authentication until the next release. A picker-only or URL-handler-only change
is not an acceptable substitute. WI3 removes two independent bypasses at no compatibility cost:
user-configured TLS bypasses for Entra are already unsafe, and no supported scenario needs
`ENVIRONMENT` at runtime. It can ship as a standalone fix ahead of the policy change. WI0 should
reach users at least one release before enforcement, if the release schedule allows.

## Acceptance tests

Use dummy tokens and controlled local/in-memory infrastructure; no real user token should be sent
to a test sink. Assert token-provider calls and captured authentication payloads, not only errors.

| Scenario                                                                                                                                                                  | Required result                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer-controlled `*.cloudapp.azure.com` destination                                                                                                                    | Rejected before token acquisition; no token sent                                                                                                                              |
| Unrelated domain, deceptive suffix, malformed connection                                                                                                                  | Explicit rejection, with no permissive fallback                                                                                                                               |
| Mixed approved and unapproved seed hosts, in either order                                                                                                                 | Entire Entra attempt rejected before token acquisition                                                                                                                        |
| Supported service endpoints in each supported cloud                                                                                                                       | Authentication reaches the intended server using the correct audience                                                                                                         |
| Legitimate SRV and private-endpoint forms                                                                                                                                 | Continue to work with certificate validation enabled                                                                                                                          |
| Initial SRV results outside policy                                                                                                                                        | Driver rejects before transmission and never invokes the OIDC callback. Eager interactive sign-in can precede SRV resolution; see the accepted eager-sign-in amendment above. |
| Unapproved topology member, reconnect destination, or later SRV result                                                                                                    | No cached or newly acquired token transmitted to that destination                                                                                                             |
| Saved credentials or authentication picker skipped                                                                                                                        | Same destination policy enforced                                                                                                                                              |
| Interactive Entra, managed identity, shell, playground                                                                                                                    | Equivalent destination protection                                                                                                                                             |
| Explicit trusted custom service                                                                                                                                           | Works without widening the built-in policy                                                                                                                                    |
| Link-supplied audience/authentication properties or purported source                                                                                                      | Cannot change audience or establish destination trust                                                                                                                         |
| New-connection confirmation canceled                                                                                                                                      | No connection created and no token requested                                                                                                                                  |
| Non-Entra native/password connection                                                                                                                                      | Existing supported behavior preserved                                                                                                                                         |
| Saved `authMechanismProperties=ENVIRONMENT:azure,…` (from a link or paste), opened in the tree, shell and playground                                                      | Property removed from the OIDC options; driver host check active; no token to an unapproved host                                                                              |
| Entra or managed identity with `tlsInsecure`, `tlsAllowInvalidCertificates`, `tlsAllowInvalidHostnames`, `ssl*` aliases or `rejectUnauthorized=false` in the saved string | Certificate and hostname validation stay on; no token over an unvalidated connection; native auth on the same saved string unaffected                                         |
| Approved seed whose `hello` lists an unapproved member                                                                                                                    | `checkServerIdentity` rejects the member before any application data; no token sent                                                                                           |
| Host forms from [R6](#r6-endpoint-inventory-wi1-evidence): `global.`, `fc-…-000` node, `privatelink.`, legacy `c-`, port 10260, mixed case                                | Accepted in each supported cloud                                                                                                                                              |
| `xmongocluster.cosmos.azure.com`, `mongocluster.cosmos.azure.com.evil.com`, `….azure.tk`, punycode lookalike, trailing dot, IP literal                                    | Rejected before token acquisition, with the same outcome in our predicate and in the driver                                                                                   |
| RU account (`*.mongo.cosmos.azure.*`, `*.documents.azure.*`) with Entra                                                                                                   | Rejected with an explanation; native auth unaffected                                                                                                                          |
| Government- or China-signed-in user, public `*.cloudapp.azure.com` host                                                                                                   | Still stopped by the cloud-mismatch check before token acquisition (regression)                                                                                               |
| Managed identity, public `*.cloudapp.azure.com` host                                                                                                                      | Rejected before the IMDS request                                                                                                                                              |
| String declares `MONGODB-OIDC` for an unrecognized host                                                                                                                   | Entra and managed identity not offered; explanation shown                                                                                                                     |
| Worker `tokenRequest` while the worker's connection targets a rejected host                                                                                               | Relay refuses before token acquisition                                                                                                                                        |
| Pasted `*.cloudapp.azure.com` string in New Connection, with and without `authMechanism=MONGODB-OIDC`                                                                     | Entra and managed identity not offered; if forced through stored state, rejected before token acquisition                                                                     |
| Update Credentials on a connection to a rejected host                                                                                                                     | Entra and managed identity not offered                                                                                                                                        |
| Existing approved Entra connection; Update Connection String to a rejected host; then expand                                                                              | Stored method cleared, with an explanation; next connect prompts without Entra; no token sent                                                                                 |
| Existing approved Entra connection; Update Connection String to another approved host                                                                                     | Method kept; connects as before                                                                                                                                               |
| Saved Entra connection whose host became disallowed (built-in list narrowed, or custom suffix removed)                                                                    | Expand fails with the localized explanation and recovery actions; no token, no silent method fallback                                                                         |
| First open of a link-created connection to a rejected host                                                                                                                | Picker does not offer Entra or managed identity                                                                                                                               |
| `hostnameSuffix` set to `azure.com`, `cloudapp.azure.com`, `eastus.cloudapp.azure.com`, `cosmos.azure.com` or a sovereign `cloudapp` domain                               | Rejected by validation; built-in policy unchanged                                                                                                                             |
| `hostnameSuffix` set to a narrow new service suffix                                                                                                                       | Matching hosts accepted, with every-host, `checkServerIdentity` and certificate enforcement; the admitted connection is logged                                                |
| `hostnameSuffix` in workspace settings, or arriving through Settings Sync                                                                                                 | Ignored (machine scope)                                                                                                                                                       |
| Rejection modal **Learn More**                                                                                                                                            | Opens documentation; no setting written or pre-filled                                                                                                                         |
| New strings in every shipped locale                                                                                                                                       | Picker label and detail, placeholder, toast and modal title fit the [length budgets](#length-limits-for-the-new-strings)                                                      |

Extend the existing policy, authentication-handler, sovereign integration, authentication-picker,
worker-manager, and URI-handler suites; add the smallest protocol harness needed to prove token
non-disclosure through the actual driver.

During implementation, use Case 1 verification: `npm run build` and targeted `npx vitest run` tests
covering the changed surfaces. Do not run full handoff checks merely to commit this plan.
At ready-for-review, run the repository's full Case 2 list, including localization generation if
user-facing strings changed, and report cloud/manual verification gaps separately from unit results.
If a `TDD:` contract fails, stop for operator approval rather than changing the contract silently.

## Review decisions and release gates

The following are the original pre-approval questions. The accepted execution plan above settles
the implementation scope in items 1–4 and 6–7, while preserving the explicit live-evidence gaps.
Item 5 remains follow-up work; no service-team audience request or upstream report was performed.

Original questions:

1. The authoritative built-in suffix inventory and which sovereign/private endpoint cases still
   need service-owner or live-environment verification. In particular, whether
   `*.mongocluster.cosmos.azure.us` ships on operator confirmation alone; it is not publicly
   documented, and the Private Endpoint DNS reference lists no Government `mongocluster` zone.
2. The compatibility policy for previously accepted but unrecognized Entra destinations, and any
   new limits on explicit custom suffixes. Recommended: custom DNS aliases, IP literals and tunnels
   stay unsupported for Entra ([R8](#r8-compatibility-cost-is-small-unrecognized-entra-destinations-already-fail)).
3. The exact UI treatment of unavailable Entra choices and the user-facing explanation.
4. Whether WI3 (options builder: `ENVIRONMENT` and TLS-bypass removal) ships ahead of the policy
   change as a standalone fix.
5. Whether to ask the service team about a DocumentDB-specific token audience, since the shared
   OSS RDBMS audience widens replay ([R5](#r5-the-token-audience-is-shared-with-other-azure-database-services)),
   and whether to report the `ENVIRONMENT` and `ALLOWED_HOSTS` interaction to the driver maintainers.
6. What Update Connection String does when an Entra or managed-identity connection is edited to a
   rejected host. Proposed: save the string, clear the method and explain why. Alternatives: refuse
   to save until the user picks another method, or save and leave the error to the next connect.
   The last option is the least clear, but it is still safe, because connect-time enforcement holds
   ([R11](#r11-manually-created-and-edited-connections)).
7. The self-service override ([analysis](#self-service-override-for-endpoints-the-extension-does-not-recognize)).
   Recommended: no global switch; harden the existing machine-scoped `hostnameSuffix` (option B);
   do not add a per-connection trust checkbox for now (option C); evaluate ARM-attested destinations
   as a follow-up (option D). Also decide whether `hostnameSuffix` becomes a list.

Before declaring the fix complete:

- Demonstrate that the driver and extension together enforce the invariant for all connection
  destinations, including discovered hosts and reconnects.
- Complete the acceptance matrix and explicitly identify unverified live-cloud behavior. Government
  host forms and audience acceptance stay unverified until tested against a live Government cluster
  or confirmed by the service team.
- Re-run the R1 and R4 driver probes after any `mongodb` driver upgrade. Both the
  `ENVIRONMENT` skip and the `checkServerIdentity` forwarding are driver internals.
- After approval, update the active deep-links and sovereign-cloud documentation, related user
  configuration guidance, and misleading "safe default" comments alongside the implementation.
- Record approved security/compatibility decisions and the operator's rationale in the relevant
  feature decision log; this proposal itself does not establish those decisions.

This work does not change token audiences, make ARM permissions mandatory, or introduce a general
network-egress firewall. Shorter token lifetimes, extra confirmation dialogs, and TLS alone are not
substitutes for the destination restriction.
