---
feature: cluster-dashboard
kind: review
status: active
prs: [823]
created: 2026-09-10
---

# Edge-case review and author decisions

Reviewed `ead1cc1c` against `origin/main`, including the 23 commits after merge `6b2fb8ad`.
This is the follow-up review and the operator's decisions recorded from the September 10 session.
The earlier multi-reviewer pre-review remains in [01-poc/ai-pre-review.md](./01-poc/ai-pre-review.md).

| Finding                                                    | Severity | Evidence                                                                                                                                                              | Author decision and outcome                                                                                                                                                                                              |
| ---------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Tree refresh reopens the dashboard                      | P2       | Two cached-client `getChildren` calls issued two dashboard-open commands.                                                                                             | Fix. Gate auto-open on the absence of a cached client before the connection attempt. Tests cover repeated reads, a recreated node, and client removal.                                                                   |
| 2. Failed collection listing claims the database is empty  | P2       | The actual collector returns an empty list with `errors`; the UI checked only RPC rejection. A denied read rendered an empty claim and New Collection, without Retry. | Fix. Zero-row collector failures now show Retry and suppress creation; partial stats failures retain rows and the list warning. Tests use real collector failure payloads.                                               |
| 3. Reconciliation is lost during an in-flight storage read | P2       | Executing the actual callback with a delayed response showed no follow-up query; the old snapshot was published.                                                      | Ignore for this iteration, as explicitly directed by the operator. No implementation change.                                                                                                                             |
| 4. Partial counts appear to be complete sums               | P2       | A two-database result with one denied `dbStats` displayed totals from only the readable database without a completeness marker.                                       | Accept the sums as good enough. Change table placeholders to N/A; no new warning icons or completeness badges. See [decision 0021](../decisions.md#0021--unavailable-table-values-are-enough-for-best-effort-summaries). |
| 5. Unbounded loading skeleton                              | P2       | A database reporting 10,000 collections requested 60,000 skeleton components despite the 100-collection collector cap.                                                | Fix. Cap the renderer at 100 rows and normalize invalid counts. Parameterized tests cover large, ordinary, missing, negative, and nonfinite values.                                                                      |

## Verification

The review's seven focused suites passed 103 tests and the build passed. Read-only probes
confirmed each finding. Each implemented fix subsequently passed its focused tests and build;
the N/A change adds a regression assertion for all five unavailable statistic cells.
Live backend and VS Code interaction testing were not performed during this review.

## History cleanup

The operator authorized consolidating the post-merge history into coherent work items: UX
remediation, shell initialization, default-enabled dashboard-on-connect, final toolbar layout,
empty/error states, telemetry, and mouse Back navigation. The review fixes remain separate
commits. Intermediate default-disabled behavior, superseded toolbar layouts, and standalone
formatting commits need not survive as separate commits; final behavior and decision rationale
must remain unchanged by the rewrite.
