---
feature: cluster-dashboard
kind: review
status: active
prs: [980]
created: 2026-09-29
---

# Dashboard navigation and metric scope: PR review

## Scope and verdict

Reviewed [PR #980](https://github.com/microsoft/vscode-documentdb/pull/980),
**Improve dashboard navigation and clarify metric scope**, at
`eb4545396617197dd137d4c13fcf2e5278b989fe`.
The comparison starts at merge base `72886260be59d082833c20ba349649e8b13f29b9`;
GitHub's current base was `69f9c0c1d235cd1fea90b6f54c25224d82d7b91c`.
The local head and changed-file list matched GitHub.

The review covered all 15 changed files and the adjacent inventory state, row-action,
toolbar, router, Fluent breadcrumb, styling, localization, and test paths needed to
evaluate them. The future collectors and tabs described in the proposals are not
implemented by this PR and were not treated as missing functionality.

**Initial verdict: keep the PR in draft until its validation blockers are resolved.**
No Critical/P0 or High/P1 issue, and no confirmed runtime regression, was found.
There are two Medium/P2 validation blockers and two Low/P3 findings below.
The blockers were already acknowledged in the PR description; this review independently
verified them against the code, ESLint configuration, and current CI output.

**Operator follow-up (2026-09-29):** Fix R1 and R2; retain the implemented design for R3
because the proposals were ideas, not a specification; record that R4 was tested manually.
The resolutions below preserve the original findings and their severity. The PR remains
a draft; these follow-ups do not establish that all ready-for-review gates have passed.

Severity here means:

- **Critical/P0:** immediate, broad data-loss or availability impact.
- **High/P1:** major user-facing failure requiring urgent correction.
- **Medium/P2:** bounded functional defect or required validation blocker.
- **Low/P3:** documentation or regression-protection weakness without a demonstrated runtime failure.

The P2 lint findings block required checks, not execution of the dashboard.

## Findings

| ID  | Severity  | Finding                                                                         | Evidence                                                                                    | Status                                                            |
| --- | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| R1  | Medium/P2 | Two new files omit the required license header                                  | `DashboardBreadcrumb.tsx:1`; `NamespaceTable.test.tsx:1`; CI `license-header/header` errors | Fixed in `3322fa5b` at operator request                           |
| R2  | Medium/P2 | The metric test mock uses a forbidden inline import type                        | `StatusStrip.test.tsx:17`; CI `@typescript-eslint/consistent-type-imports` error            | Fixed in `df0a647f` at operator request                           |
| R3  | Low/P3    | The feature overview incorrectly calls the adopted scope proposal unimplemented | `README.md:45`, contradicted by the proposal status and shipped JSX                         | Resolved in `c48109fa` by operator decision 0023                  |
| R4  | Low/P3    | The new shell tests do not exercise the navigation-dependent client behavior    | `clusterDashboardRouter.test.ts:129`; `ClusterDashboard.tsx:319`                            | Manual validation recorded in `0429bda1`; no automated test added |

### R1 - Restore license headers in both new files

**Severity:** Medium/P2. **Confidence:** high.

**Locations:**
[DashboardBreadcrumb.tsx](../../../../../src/webviews/documentdb/clusterDashboard/components/DashboardBreadcrumb.tsx#L1)
and
[NamespaceTable.test.tsx](../../../../../src/webviews/documentdb/clusterDashboard/components/NamespaceTable.test.tsx#L1).

Both files start directly with imports. The repository's
[ESLint configuration](../../../../../eslint.config.mjs#L78) requires the standard
Microsoft/MIT header. The existing
[Code Quality & Tests job](https://github.com/microsoft/vscode-documentdb/actions/runs/36588194393/job/109474045628)
reports `Missing license header` at line 1 of each file.

**Impact:** these two violations make the required lint check fail even though the build
and focused tests pass. They are introduced by this PR, not inherited from the base.

**Recommended fix:** add the standard header used by the neighboring source and test files
to both files. This preserves behavior and satisfies the existing repository policy.
An ESLint exemption would also suppress the error, but would create an unnecessary
exception for ordinary source files; it is not recommended.

**Verification after fixing:** run the appropriate repository verification case; at the
ready-for-review handoff, lint must no longer report either file.

**Author decision (2026-09-29):** Fix R1.

**Implementation:** added the standard Microsoft/MIT header to both files, without
changing executable code or adding lint exemptions.

**Commit:** [3322fa5b](https://github.com/microsoft/vscode-documentdb/commit/3322fa5b22e7df8f7dd2b4654e7e0d97f62cad74)
adds both required headers to satisfy the existing license-header rule without changing
dashboard behavior.

### R2 - Use a named React type import in the test mock

**Severity:** Medium/P2. **Confidence:** high.

**Location:**
[StatusStrip.test.tsx](../../../../../src/webviews/documentdb/clusterDashboard/components/StatusStrip.test.tsx#L17).

The new mock calls `jest.requireActual<typeof import('react')>('react')`.
The repository enables `@typescript-eslint/consistent-type-imports` with its default
`disallowTypeAnnotations: true`. Current CI explicitly reports
`` `import()` type annotations are forbidden `` at line 17, column 45.
TypeScript accepting this expression does not make it compliant with that rule.

**Impact:** this is a third PR-introduced lint error and independently prevents the
quality gate from passing.

**Recommended fix:** add a named type-only namespace import, for example
`import type * as ReactModule from 'react'`, then use
`jest.requireActual<typeof ReactModule>('react')`.
This keeps the actual React module loaded inside the mock factory and preserves its
type safety. Removing the generic weakens type checking; disabling the rule adds an
unnecessary exception. Neither is recommended.

**Verification after fixing:** the focused metric tests should still pass, and the
ready-for-review lint run must no longer report the inline import type.

**Author decision (2026-09-29):** Fix R2.

**Implementation:** added the type-only `ReactModule` namespace import and used
`jest.requireActual<typeof ReactModule>('react')`. The mock retains its runtime load
and type safety.

**Commit:** [df0a647f](https://github.com/microsoft/vscode-documentdb/commit/df0a647ff8013f21761c1749c5b35c0b8c16e85a)
replaces the forbidden inline import type with a named type-only import to comply with
the existing rule without weakening the mock's types.

### R3 - Distinguish the adopted scope proposal from the deferred proposals

**Severity:** Low/P3. **Confidence:** high.

**Location:** the new
[Discussion proposals paragraph](../README.md#discussion-proposals).

The paragraph says that the eight proposals "are not accepted decisions or part of
the current implementation." However, the
[proposal document](../cosmos-dashboard-proposals.md#1-name-the-metric-scope)
explicitly records proposal 1 as adopted, the architecture section describes that
decision, and
[StatusStrip.tsx](../../../../../src/webviews/documentdb/clusterDashboard/components/StatusStrip.tsx#L218)
implements it.

**Impact:** a contributor reading the feature entry point receives contradictory
guidance about whether the scope line is current behavior or future work.
This inconsistency is in newly added text, rather than the older, explicitly acknowledged
historical framing of the design document.

**Recommended fix:** say that proposal 1 was adopted as the informational scope line,
while proposals 2-8 remain discussion only and the elevated breadcrumb/tab experiments
were rejected. This preserves the useful distinction between the chosen design and
future candidates. Removing the status statement entirely is less precise.

**Verification after fixing:** compare the overview with the proposal document's opening
status and the selected-design section. No code validation is needed for this edit.

**Author decision and reasoning (2026-09-29):** Keep the design as implemented. The operator
clarified that the proposals were a set of ideas, not a specification. No runtime change
is requested to conform to the earlier suggestions.

**Resolution:** recorded
[decision 0023](../decisions.md#0023-dashboard-proposals-are-ideas-not-a-specification)
and clarified the overview, design, and proposal document. The implementation is approved;
the remaining ideas are not approved work.

**Commit:** [c48109fa](https://github.com/microsoft/vscode-documentdb/commit/c48109faa907ffcaf7e5052d5223c9a65f4a0bcb)
records decision 0023 and updates the overview, design, and proposals to preserve the
operator-approved implementation and prevent ideas from being mistaken for a binding spec.

### R4 - Test shell targeting through real inventory navigation

**Severity:** Low/P3. **Confidence:** high.

**Locations:**
[clusterDashboardRouter.test.ts](../../../../../src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.test.ts#L129)
and
[ClusterDashboard.tsx](../../../../../src/webviews/documentdb/clusterDashboard/ClusterDashboard.tsx#L319).

The new router tests explicitly supply either `{ databaseName: 'catalog' }` or
`{ databaseName: 'test' }`. In particular, the test named "uses the cluster-level database
after navigating back from a database dashboard" never navigates: it constructs host
context and directly supplies `test`.

These tests correctly protect host-side forwarding. They do not protect the actual
behavior changed by this PR: deriving the argument from
`inventoryViewState.currentDatabase`, updating the callback after navigation, and using
the same callback in the visible toolbar and overflow menu.
Changing the client back to always passing `test` would leave all three router tests green.
The new scope/breadcrumb fixture does not invoke the shell either.

**Impact:** the main shell regression motivating this change can return without these
new assertions detecting it. The current implementation appears correct by inspection;
this is a test-coverage finding, not a claim that shell targeting is broken.

**Recommended fix:** add a component-level test using the production dashboard and a
mock tRPC client. Open Shell at cluster level, navigate into a database and open it
again, then return to Databases and open it once more. Assert mutation arguments
`test`, the selected database, and `test`, respectively. Include initial database scope
and the overflow action where the existing harness permits.

This tests the state-to-request boundary directly. Extracting only a string-selection
helper would be cheaper, but would not detect a stale callback or incorrect toolbar
wiring; relying solely on manual testing would not provide persistent protection.

**Verification after fixing:** the test must fail if the client always supplies `test`
or retains the database from before navigation.

**Author response (2026-09-29):** "R4 was tested manually."

**Resolution:** record operator-reported manual validation and leave the existing tests
unchanged for this follow-up. The operator did not specify the individual scenarios or
environment, so no additional coverage is claimed. This does not turn the existing router
tests into a navigation regression test; the automation gap remains documented.

**Commit:** [0429bda1](https://github.com/microsoft/vscode-documentdb/commit/0429bda1e3f39acabca014a5edf7e85f8f9c2ba1)
persists the review and the operator's manual-validation response, leaving automated
coverage unchanged because the operator confirmed manual testing rather than requesting
the proposed test. It also records the preceding R1-R3 commits and their rationale.
This reference is added in a documentation-only follow-up because the report's own
commit hash was not available until that commit was created.

## Other CI blockers, not introduced by this PR

The same CI job reports two additional **Medium/P2 validation blockers**:

| Location in CI's tested revision                                                                              | Rule                                                                                 | Attribution                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [ClustersClient.test.ts](../../../../../src/documentdb/ClustersClient.test.ts), line 6                        | `no-restricted-imports` on the `@microsoft/vscode-azext-utils` namespace type import | Change on newer `main`; absent from this PR's diff |
| [WorkerSessionManager.test.ts](../../../../../src/documentdb/playground/WorkerSessionManager.test.ts), line 6 | Same restricted namespace type import                                                | Change on newer `main`; absent from this PR's diff |

The diff from the PR merge base to its head changes neither test nor the ESLint
configuration. The diff from that merge base to GitHub's current base adds the namespace
type imports in those tests. These are separate integration blockers, not dashboard
findings. They were not changed during this review. Fixing R1 and R2 alone therefore
does not establish that the current PR CI job will pass.

## Behavior checked and non-findings

- Collection rows now use the existing activation path. The primary action stops
  propagation before activating, preventing the row handler from activating a second
  time. The More actions button also stops propagation. Busy rows retain the guard and
  disabled action buttons.
- A native button remains the keyboard-reachable activation path; making the whole row
  clickable does not remove it. The added test verifies row and explicit-button clicks
  independently at both inventory levels.
- The shell callback reads current inventory state and includes that state in its
  dependency list. Both toolbar presentations receive the current callback. The router
  validates a nonempty database name and forwards it through the existing shell command.
- Metric scope and cards read the same `currentDatabase` prop. The scope line adds no
  focus target, navigation action, collector, or refresh behavior. Its lack of a tooltip
  is an explicit design choice, not a missing feature.
- The extracted breadcrumb retains the existing upward-navigation helper and telemetry.
  Its full database name remains in the button's text. The tooltip's
  `relationship="inaccessible"` does not, by itself, hide that button text from the
  accessibility tree; a duplicate accessible description is not required to expose it.
- Existing best-effort aggregate semantics and previously accepted dashboard limitations
  were not reclassified as new PR regressions.

## Verification and limitations

**Case 1 applies:** this is a review of a draft, not a request to mark it ready.

The following results are from the initial review of `eb454539`, before the operator's
requested fixes:

| Check                           | Result                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Local `npm run build`           | Passed, including workspace package builds                                                                  |
| Local focused Jest run          | Passed: 4 suites, 36 tests                                                                                  |
| Existing GitHub review comments | No inline review comments or submitted reviews were returned; no Copilot comments to merge at review time   |
| Existing CI quality job         | Failed: five lint errors, split into three PR-introduced errors under R1/R2 and two newer-base errors above |
| Existing CI full Jest run       | Passed: 289 suites, 4,533 tests, 4 snapshots; this is CI evidence, not a local full-suite run               |
| Existing CI Build & Package job | Skipped; packaging is not verified                                                                          |

Focused command:

```bash
npx jest --no-coverage \
  src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.test.ts \
  src/webviews/documentdb/clusterDashboard/components/InventoryPanel.test.ts \
  src/webviews/documentdb/clusterDashboard/components/NamespaceTable.test.tsx \
  src/webviews/documentdb/clusterDashboard/components/StatusStrip.test.tsx
```

VS Code's test tool did not discover these files, so the repository's Jest CLI was used.
The editor also reported missing Jest globals in the metric test file, but the actual
TypeScript build and typed Jest run passed; that editor-only diagnostic was not treated
as a confirmed PR defect.

The full local Case 2 checks, including `prettier-fix`, lint, localization, the full test
suite, and packaging, were deferred until the PR is ready for review. Reading existing
CI results does not replace that handoff.

No live-cluster shell execution, extension-host navigation, browser layout/zoom checks,
or real screen-reader testing was performed by the reviewing agent. The operator subsequently
confirmed manual testing for R4, as recorded above. In particular, long-name ellipsis, fixed
scope-line height, tooltip behavior on keyboard focus, and overflow-menu behavior remain
manual/browser validation items; DOM tests do not establish their visual correctness.

This report is a single review pass with code/test/CI evidence. It does not claim the
different-vendor validation gate in CONTRIBUTING section 6.1 has run. The operator's
subsequent decisions are recorded inline; the separate validation gate remains outstanding.

### Follow-up verification after R1 and R2

On 2026-09-29, after applying the requested fixes and again before committing them:

- `npm run build` passed, including workspace package builds.
- The focused Jest run for `InventoryPanel.test.ts`, `NamespaceTable.test.tsx`, and
  `StatusStrip.test.tsx` passed: **3 suites, 26 tests**.
- The source diff contains only the two license headers and the type-only import change;
  no runtime behavior was changed.
- Lint and the remaining Case 2 checks were not rerun because this remains a draft.
  The original CI results above predate these fixes and are not evidence of a new
  passing CI run. The unrelated newer-base lint blockers remain outside this follow-up.

## Outcome

The severity-ranked report and operator responses are recorded here and linked from the
feature overview. R1 and R2 have source/test hygiene fixes; R3 is resolved through an
explicit decision approving the implementation and clarifying the proposals' authority;
R4 records operator-reported manual testing without additional automated tests.
Runtime behavior and PR state are unchanged. R1, R2, R3, and the R4 review/manual-validation
record were committed separately; their references and rationale are recorded inline.
A documentation-only follow-up adds the R4 commit reference.
Commits are local only; nothing has been pushed or posted as a GitHub review.
