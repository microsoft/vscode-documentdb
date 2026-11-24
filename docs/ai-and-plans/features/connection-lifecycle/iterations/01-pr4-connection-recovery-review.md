---
feature: connection-lifecycle
kind: review
status: active
created: 2026-11-23
---

# PR4 pre-review: connection failure recovery

[PR #1117](https://github.com/microsoft/vscode-documentdb/pull/1117), reviewed locally at
`69112da71` against PR3's `a301f6561`. GPT-6.2-Sol performed the initial review; Claude
Opus 5.5 validated the findings and performed an independent sweep. No published GitHub
reviews were present. The review findings below reflect the reviewed revision; the
operator's dispositions and verification are recorded separately.

| ID  | Severity | Validation                   | Finding and recommended disposition                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Medium   | Partial, 75%                 | A rejected replacement outside the tree can try the same Entra settings again; the tree already covers its own path. Reproduce first, then latch only a current, verified Entra replacement with a terminal rejection. Leave first-startup and Native/RU behavior alone. [Startup](../../../../../src/documentdb/ClustersClient.ts#L1010)                                                                                                                                |
| F2  | Medium   | Valid, 85%; predates PR4     | An explicit tenant edit can leave the old tenant pin after a sign-in failure. Keep the existing WI-7 requirement to replace or clear the pin on a saved tenant change; do not pull the broader credential-update transaction into PR4. [Update credentials](../../../../../src/commands/updateCredentials/updateCredentials.ts#L171)                                                                                                                                     |
| F3  | Medium   | Valid, 80%                   | An old Retry row can close a healthy replacement already published before the click. Fence the destructive step to the failed client; refresh without closing a newer client. [Retry](../../../../../src/commands/retryAuthentication/retryAuthentication.ts#L155)                                                                                                                                                                                                       |
| F4  | Medium   | Plausible race, 65%          | A late successful database listing could render old rows after another account becomes current. Reproduce first. Discard a result when the identity differs or a latch is set, using the existing stale-result path; a same-identity replacement alone should not discard it. [Expansion](../../../../../src/tree/documentdb/ClusterItemBase.ts#L559)                                                                                                                    |
| F5  | Medium   | Valid, 85%                   | For a latched stored Native connection, Retry does nothing; Update credentials is the repair. Hide only a Retry row with no action, while retaining Diagnose and Open shell and preserving error detection. Keep working RU and Native Discovery Retry paths. [Recovery rows](../../../../../src/tree/documentdb/ClusterItemBase.ts#L360)                                                                                                                                |
| N1  | Medium   | Valid, 90%; WI-6 integration | The operation wrapper lacks auth context for startup rejection. Cover it when WI-6 first wires the wrapper to routers; the host must return the typed unavailable reason instead of a generic error. [Operation wrapper](../../../../../src/documentdb/runWithClient.ts#L48)                                                                                                                                                                                             |
| N2  | Medium   | Potential regression, 70%    | The new recovery fence applies to ordinary edits, and a return after storage has saved can leave storage and cached settings out of sync. Reproduce first; keep any PR4 repair scoped to the new regression. Leave the broader save, latch, and teardown transaction in WI-7. [Credentials save](../../../../../src/commands/updateCredentials/ExecuteStep.ts#L110) and [connection string save](../../../../../src/commands/updateConnectionString/ExecuteStep.ts#L95). |
| N3  | Medium   | Valid, 90%                   | A real database named `sign-in-again` can match the recovery row's ID. Require the reserved error context as well as the ID, and test that the real database remains visible as healthy. [Error detection](../../../../../src/tree/documentdb/ClusterItemBase.ts#L610)                                                                                                                                                                                                   |

## Author decisions

The operator approved scoped PR4 fixes for F1, F3–F5 and N2–N3, with reproduction
before changing F1, F4 or N2. They asked to avoid nonessential edge cases and keep the
implementation simple. F2 stays in WI-7; N1 stays in WI-6.

The focused regressions reproduced F1, F3, F4, F5 and N3. All 132 tests in the three
affected suites passed after `87ab0ed1f` (F1, F3) and `1500634d1` (F4, F5, N3).
The stale-tree guard checks identity, not generation, so a same-identity replacement does
not by itself discard a result.

N2 was reproduced in both edit commands: a connection-string edit was skipped, and a
credential write succeeded without updating the runtime cache. `64d6f3ffd` limits the
wizard epoch check to recovery edits and records a completed storage save accurately.
An obsolete recovery still cannot evict newer state or clear its latch. All 62 focused
tests passed across six suites. Reconciling an already in-flight recovery save that lands
after teardown stays in WI-7, with F2.

## Copilot review follow-up

Claude Opus 5.5 validated the nine inline findings against `ca841a7c8`. The confirmed medium
findings are addressed in dedicated commits. The operator approved reporting child expansion
failures in this PR without adding child recovery actions or replaying the request.

| Finding                                                                                                                                                                      | Disposition                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [R1](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677891992)                                                                                        | `27345af20` explains how to restore the pinned Azure cloud or provider before retrying sign-in.                                                                                                                                                                    |
| [R2](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892084)                                                                                        | Preserve the approved F1 scope: no new Native/RU or first-startup latch policy.                                                                                                                                                                                    |
| [R3](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892154)                                                                                        | Keep retrying the silent lookup on a later foreground request so signing back in through VS Code Accounts can restore the session. Track in [#1119](https://github.com/microsoft/vscode-documentdb/issues/1119#issuecomment-7127895057).                           |
| [R4](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892272)                                                                                        | `f3407187a` preserves localized Managed Identity guidance in the typed callback error without copying unrecognized SDK text into the message.                                                                                                                      |
| [R5](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892358), [R7](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892494) | Defer the two low-severity telemetry gaps to [#1123](https://github.com/microsoft/vscode-documentdb/issues/1123).                                                                                                                                                  |
| [R6](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892428)                                                                                        | `195243c52` lets Quick Start Retry clear only its current rejection and reload its service-owned credentials.                                                                                                                                                      |
| [R8](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892557)                                                                                        | `228be9f90` explains the rejection and points to the appropriate existing tree action.                                                                                                                                                                             |
| [R9](https://github.com/microsoft/vscode-documentdb/pull/1117#discussion_r4677892633)                                                                                        | `b1b446e6d` reports foreground database and index listing failures against the binding that ran them and rethrows the original error. Optional navigation to the owning cluster is tracked in [#1124](https://github.com/microsoft/vscode-documentdb/issues/1124). |

## Handoff verification

OP-3 passed on the older CI VSIX. The current review proposals do not change the tested
sign-out, dismissal, or explicit sign-in sequence. The local `1.1.1-alpha.1` VSIX packaged
successfully; its shared Shell/Playground worker booted in plain Node and acknowledged
shutdown. On 2026-11-24, the operator confirmed that both Shell and Playground work
on the requested CI-built `1.1.1-alpha.1` VSIX. The live smoke gate is cleared.

Final local Case 2 passed: localization generation and check, formatting, lint, build,
strict workspace test type-check, the full runtime suite (**432 files; 9,796 passed, one
skipped**), and VSIX packaging. The initial label test was corrected to assert the
label on the existing plain-object tree fixture. The review-fix run also caught an
enum-to-string lint error and a storage fixture type mismatch; both were fixed
without changing recovery behavior or weakening any assertions. Full CI also passed
on code head `d422d065b`. The operator confirmation is a documentation-only follow-up;
it does not change the tested build or require repeating OP-3.

After the Copilot fixes, local Case 2 passed again: localization generation and check,
formatting, lint, build, strict workspace test type-check, the full runtime suite
(432 files; 9,805 tests passed, one skipped), and VSIX packaging. The earlier OP-3 and
worker smoke results stand; no repeat live test was required for these fixes.
