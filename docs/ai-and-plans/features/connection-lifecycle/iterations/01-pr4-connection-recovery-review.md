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

## Handoff verification

OP-3 passed on the older CI VSIX. The current review proposals do not change the tested
sign-out, dismissal, or explicit sign-in sequence. The local `1.1.1-alpha.1` VSIX packaged
successfully; its shared Shell/Playground worker booted in plain Node and acknowledged
shutdown. A live Shell and Playground smoke test is separate.

Final local Case 2 passed: localization generation and check, formatting, lint, build,
strict workspace test type-check, the full runtime suite (**432 files; 9,796 passed, one
skipped**), and VSIX packaging. The initial label test was corrected to assert the
label on the existing plain-object tree fixture. The review-fix run also caught an
enum-to-string lint error and a storage fixture type mismatch; both were fixed
without changing recovery behavior or weakening any assertions. PR4 remains a draft
until the live packaged Shell and Playground smoke test is recorded.
