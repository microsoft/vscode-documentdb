---
feature: data-grid
kind: plan
status: active
prs: [1142]
created: 2026-11-27
code:
  - src/webviews/documentdb/documentView/documentsViewRouter.ts
  - src/utils/documentGrid/documentIdentity.ts
  - src/utils/documentGrid/types.ts
  - src/utils/documentGrid/toTablePage.ts
  - src/webviews/documentdb/collectionView/CollectionView.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/TypedValueCell.tsx
  - build/verification/browser/**
---

# Iteration 5: implementation plan for the approved review findings

Plans the "do now" decisions in the [RDG migration review](./03-rdg-migration-review.md#author-decisions)
and [Object `_id` field order](./04-object-id-field-order.md#decisions), recorded as decisions
[0004 and 0005](../decisions.md). Target: `feature/rdg-migration`, draft #1142.

**Planning baseline:** local HEAD `3fdd9126`, checked against the supplied review and current
source on 2026-11-27. The remote PR remains a draft at `4b222421`. This document does not
implement the fixes, release G3a, authorize a push, or mark the PR ready. The review records
accepted dispositions but says G3a is not released; obtain implementation authorization before
executing these items. Runtime findings remain unverified until the checks below actually run.

**Execution authorization (2026-11-27):** the operator explicitly instructed this `/lead` run to
execute this plan and implement only the approved "do now" findings. This authorizes those
implementation items, not release of G3a/G3b, a push, or review-thread replies. Keep #1142 in
draft Case 1; formatting and the full Case 2 remain deferred to the separate handover. The
operator requested `claude-opus-5.5` as advisor, implementation assignments favoring
`mai-code-2`, and `mai-code-2-flash` for tool-running checks.
The run began at `2026-11-27T14:58:25.973Z`; the source-plan baseline is commit `223844a9`.
The pre-existing README plan-index edit was left out of that baseline commit and remains
untouched. No implementation or runtime evidence is claimed by this authorization note.

**Browser authorization (2026-11-27), G3-browser:** the operator answered "Yes, use the built in
browser" to targeted L2-dev failing-first and post-fix runs in dark, light and high-contrast.
This does not authorize packaged checks, formatting, Case 2, a push or thread replies.

**Existing-server authorization (2026-11-27), G3-browser-port:** the first source-browser check
found port 18080 occupied by a responsive server (PID 54856) and did not reuse or stop it.
The operator then explicitly approved "reuse" after verifying it serves this checkout. This
server is not owned by this run and must remain running; no restart or termination is authorized.

**Model assignments, advised (`claude-opus-5.5`):** WI-G3-1 through WI-G3-5 and the WI-G3-6
documentation pass are recommended for `mai-code-2`, matching the operator's substitution
request. WI-G3-1 is a bounded save/identity change; WI-G3-2 is a specified refactor; WI-G3-3
requires request-bound focus and advisor review; WI-G3-4 is the approved accessible-name change;
WI-G3-5 separates strict packaged expectations from source readiness; WI-G3-6 records earned
evidence. Run shared-file items sequentially. Builds, focused tests and authorized source-browser
runs use `mai-code-2-flash`. WI-G3-7 remains authorization-blocked. The first advisor packet
returned on 2026-11-27; below-threshold R2 cancellation/timing recommendations and S1 interval
evidence are being clarified before their coding prompts, not treated as approved designs.

## Scope

| In scope (this plan)                                        | Out of scope (not implemented here)                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| R1, R2, R3, R5, R6, S1–S5; thread replies for R2, R4 and R5 | R7 → #1145 (Document View numeric types on save)                        |
|                                                             | R6 follow-up → #1144 (explain withheld actions, link to a manual page) |
|                                                             | S6–S8 (won't fix), R4 code change (none), Delete `deletedCount`        |
|                                                             | Correcting the `parseDocumentId` "preserves field order" comment        |

The R6 safety guard is **in scope**; only its explanation UI and manual page are deferred to
#1144. R1 does **not** include R7's numeric-type preservation, driver promotion options, or a
switch to canonical EJSON in Document View. Do not add a comparator, raw-BSON identity transport,
Tree refresh focus restoration, or deletion focus restoration.

Rules for every item: no product scope beyond the decision. Existing `TDD:` contracts must not be
edited merely to make them pass: stop and ask if one fails. Write focused regression cases before
each behavior fix, and demonstrate the relevant failure on the unfixed code. Passing preservation
cases need not fail first. Keep implementation progress and commit/evidence references beside the
work item; do not mark a decision implemented just because a plan or test exists.

## Work items

Order follows the review's suggested sequence, with one proposed execution detail: the S1–S5
refactor lands as its own behavior-preserving commit **before** R2, keeping the focus behavior
change separate from cleanup. Use one implementation commit per code row; carry its directly
related documentation with it.

| Work item | Findings | Deliverable | Prerequisites |
| --- | --- | --- | --- |
| WI-G3-1 | R1 + R6 | Safe save identity and conservative grid action eligibility | Implementation authorization |
| WI-G3-2 | S1–S5 | Behavior-preserving simplification | Implementation authorization |
| WI-G3-3 | R2 | One-shot focus restoration after keyboard step-in | WI-G3-2 |
| WI-G3-4 | R5 | Full type name in the focused cell's accessible name | WI-G3-2 (S4 props) |
| WI-G3-5 | R3 | Packaged result/grid expectations without breaking source scenarios | Implementation authorization |
| WI-G3-6 | Documentation | Implementation/evidence links and accurate current design | Relevant code items; final pass after 1–5 |
| WI-G3-7 | R2, R4, R5 replies | Evidence-based responses, no extra product fixes | Relevant evidence and authorization to push/reply |

The first, second and fifth items have no logical dependency on each other. Prefer the listed
sequence: WI-G3-2 and WI-G3-5 both edit browser fixtures, so independent does not mean safe for
concurrent edits.

### 1. R1 + R6 — identity and save (decisions 0004 R1, 0005)

**Status:** Implemented; focused mocked evidence complete. No live-server verification requested.

> **Done (2026-11-27), commit `8cc23e15`:** R1 now serializes an owned `_id` even when falsy;
> R6 applies the accepted multi-key integer-like-key guard recursively while preserving display
> and positional selection identity. Decisions: operator approved the R1/R6 behavior and exact
> conservative regex in 0004/0005; advisor `claude-opus-5.5` approved the production revision at
> approximately 90% confidence and the test-local mock correction with high confidence (no
> numerical figure supplied); leader followed the prescribed scope and kept documentation
> evidence in a separate commit. Added 16 focused cases in four test files. Failing-first:
> 7 expected failures, 69 passes; post-fix: 76/76 passes. After correcting only the new router
> mock's saved-document type, its 6/6 cases and `npm run build` passed (33.394 seconds).
> Every behavioral assertion was retained. No localized string changed. No live collection,
> package, formatting, Case 2, push or review-thread operation was performed.

**Execution progress (2026-11-27):** `mai-code-2` is writing the focused regression tests only,
before any production change. The separate `mai-code-2-flash` check must demonstrate the
relevant failures on the unfixed code before implementation proceeds.

**Failing-first evidence (2026-11-27), `mai-code-2-flash`:** on the unchanged production code,
`npx vitest run src\webviews\documentdb\documentView\documentsViewRouter.test.ts
src\documentdb\ClustersClient.test.ts src\utils\documentGrid\documentIdentity.test.ts
src\utils\documentGrid\toTablePage.test.ts` found all four files: **69 passed, 7 failed** in
8.496 seconds, with no setup failures. Four router cases passed the empty sentinel instead
of the serialized `0`, `false`, `""` and `null` IDs; three identity/row/shaper assertions exposed
unsafe object IDs still retaining action identity. Client filter and preservation cases passed.
Implementation is now in progress; no post-fix or live-server result is claimed.

**Post-fix evidence (2026-11-27):** the same focused command passed **76/76** tests in
8.153 seconds. The advisor approved the exact production diff at approximately 90% confidence,
including the real-upsert fixture. `npm run build` failed in the new router test at line 76:
its production-signature mock rejects `string | number | boolean | null`. The advisor traced
the constraint to the mocked saved document's `WithId<Document>._id`, not the returned
`documentId` (already `unknown`). The approved test-only correction uses the production method's
parameter types and a local saved-result shape with `_id: unknown`, retaining every assertion
and the real typed router caller without double casts. No production/public API change is
authorized; a commit remains blocked until the test correction builds.
No existing `TDD:` runtime assertion failed. No live-server run was performed.

**R1: Document View save keeps a falsy `_id`.**

- In `src/webviews/documentdb/documentView/documentsViewRouter.ts`, `saveDocument` (lines 80–104),
  replace **both** truthiness-dependent steps with an own-property check. Pass
  `EJSON.stringify(documentBson._id)` when the document owns `_id`, and `''` only when it does
  not. Remove the now-unnecessary `any` local and its suppressions. Keep this small change in
  the router; do not introduce a production helper solely to test serialization.
- Keep `ClustersClient.upsertDocument` and its `''` sentinel unchanged (option (c) was not
  chosen). Preserve the existing EJSON mode, response, title update, confirmation and error path.
- Add `documentsViewRouter.test.ts` beside the router. Exercise the real `saveDocument` procedure
  with a typed caller and mocked host boundaries; the `initWebviewTrpc`/`createCallerFactory`
  setup in `clusterDashboardRouter.test.ts` is existing prior art. For `0`, `false`, `""` and
  `null`, assert the actual `upsertDocument` argument retains that ID; for Add without `_id`,
  assert the argument is the empty sentinel. Include one ordinary ObjectId preservation case.
- Extend `src/documentdb/ClustersClient.test.ts` to exercise the real `upsertDocument` against a
  mocked collection, using those serialized inputs. Assert `replaceOne` and the following
  `findOne` use the same original `_id`, not a generated ObjectId. For Add, assert they use the
  same newly generated ObjectId. Do not stub `upsertDocument` in this layer or treat a
  stringify-only assertion as proof of the database filter.

**R1 acceptance:** the four falsy cases reach the existing-document filter and return that
identity; Add still takes the generated-ID path. Mocked tests prove the save/filter integration,
not a real server's document count. If live confirmation is requested, use an isolated disposable
collection: each falsy-ID document keeps its ID and changes its non-ID field with count unchanged;
Add increases the count by one. Do not use a user's collection for this check.

**R6: withhold actions for object `_id`s with integer-like keys.**

- `src/utils/documentGrid/documentIdentity.ts`, `isSafeIdentityValue`, Object branch only:
  return `false` when the object has more than one own key and any key matches
  `/^(0|[1-9]\d*)$/`. Reuse the existing recursion, including objects inside arrays; do not apply
  the multi-key rule to array indexes themselves. Keep the prototype, unsafe-key, type and
  round-trip checks. A short comment should explain the field-order risk and decision 0005.
- Follow the accepted conservative regex exactly, including integer-like keys above the JS
  array-index range. Do not narrow it to `0..4294967294` or attempt to infer the lost stored order.
- Extend `documentIdentity.test.ts` with direct and nested unsafe objects, an unsafe object inside
  an array, and the above-range over-withholding case. Preservation cases: a single-key
  `{ '1': 2 }`, `{ '01': 1, b: 2 }`, an ordinary multi-key object, and `{ a: [1, 2] }`.
- Assert `assignRowIdentities` gives the unsafe row a positional key and no `documentId`, while an
  adjacent safe row keeps its action ID. Add a shaper assertion in `toTablePage.test.ts` that the
  unsafe row's display cells survive. Existing K2 no-ID contracts cover the downstream
  browse/select-but-no-View/Edit/Delete behavior; reuse them, rather than inventing explanation UI.

**R6 acceptance:** the guard applies at any depth without hiding rows or disabling selection.
The existing canonical/column-key design remains intact. No #1144 UI/manual work or #1145
Document View type-fidelity work is included.

### 2. S1–S5 — simplify `CollectionView.tsx` (decision 0004)

**Status:** Implemented; focused and affected-source-browser evidence complete.

> **Done (2026-11-27), commit `bf7285d3`:** applied S1-S5 and the matching Table/Tree
> Tab-exit comments. Removed live `isRootId` metadata, redundant request guards and repeated
> selection/action code while retaining stable callbacks, next-selection commands,
> late-delete targeting and Escape/popup behavior. Added one active-query/held-reply
> preservation contract; existing `TDD:` expectations were not changed (cell-test props
> only removed `isRootId`). Decisions: operator approved the refactor in 0004; advisor
> `claude-opus-5.5` approved the exact production revision at 85% and the unchanged runner
> subset invocation at 85%; operator authorized the below-threshold baseline retry and
> stable-viewport paging retry; leader kept the pre-existing README edit outside the code
> commit. Focused tests: 29/29 unit and 146/146 harness; `npm run build` passed.
> Affected source journeys completed across three themes: 21/21 ready, 228/228 assertions,
> 411 RPC calls and zero errors, combining the six earlier passing dark routes with the
> authorized dark paging retry and the remaining light/high-contrast runs. Existing gesture
> failures and execution-setup retries remain recorded below; this was not one uninterrupted
> clean run. Source request-invalidation reasoning is not host cache isolation or
> render-to-effect runtime proof. No Case 2, formatting, packaging, push or thread reply.

**Execution progress (2026-11-27):** `mai-code-2` added a new active-query/held-nested-reply
preservation contract without changing existing `TDD:` assertions. Pre-refactor focused
document-grid/cell tests passed **29/29**, and focused browser-harness tests passed **146/146**.
These Vitest runs did not execute real browser journeys. The first browser attempt stopped
at the occupied-port gate without opening a page. The operator-authorized reuse retry verified
this checkout's served source and left the existing server running. Its 21 affected journeys had
**20 passes** and **218/218 executed assertions passed**, with 410 RPC calls and one
harness/runtime error: dark `no-id` timed out clicking `Browse only` because a column-header
row intercepted pointer events, before assertions began. Light/high-contrast `no-id` passed;
the new active-query/held-reply contract passed in all three themes. This is not a clean
all-journey baseline. A narrow advisor assessment is pending before a permitted unchanged
retry or any refactor. No test expectation, forced click, focus repair or product change was
used to hide the failure.

**Baseline retry decision (2026-11-27):** the advisor recommended one isolated unchanged
dark `no-id` retry with viewport/layout evidence at 75% confidence. Because that is below the
80% follow threshold, the leader escalated rather than treating it as approval. The operator
explicitly authorized the single retry. Preserve source, viewport and runner; if it fails
again, stop for the operator. A pass would establish an intermittent pre-refactor failure,
not diagnose or fix its cause. S1-S5 remains unimplemented while that evidence is pending.

**Retry dispatch returned blocked (2026-11-27):** no retry was executed. The checks worker
reported that the served helper exposes view/theme runs, not an isolated scenario route.
The advisor is identifying a supported single-scenario invocation of the same typed runner
before any execution or scope expansion. Captured current viewport: 713 x 813 CSS pixels,
DPR 1.5; this is not original-failure layout evidence. The existing server was untouched.
The leader also requested clarification of whether the first report's 21 journeys were the
executed set or a subset of a larger run; the prior counts remain provisional pending that
provenance clarification.

**Runner clarification, advised (`claude-opus-5.5`, 2026-11-27, confidence 85%):** the served
helper contains the standalone `runScenario` function followed by a route-list loop
(`scenario-server.ts:76-83`). Preserve the fetched function bytes unchanged and supply the one
existing `no-id`/dark route through the same orchestration; no new helper route or framework
change is needed. Guard the cut marker and the existing route before execution. The checks
worker clarified that the first helpers executed **54 journeys** (18 per theme), then reported
only the **21 affected journeys** above. Those counts are subset results, not full-run totals.
Full retained outcomes and the worker's reference to an earlier dark rerun have been requested;
do not infer missing full-run error counts.

**Isolated baseline retry (2026-11-27), `mai-code-2-flash`:** the one unchanged `no-id`/dark
route passed **10/10 assertions**, `ready=true`, six RPC calls and zero errors, at 713 x 813
CSS pixels / DPR 1.5. The cell-centre hit was the intended gridcell; no forced click, resize,
focus repair or new wait was used. Record the earlier gesture timeout as unexplained
intermittent behavior on the pre-refactor source, not a resolved defect. S1-S5 implementation
has now started. Post-refactor affected journeys still need to run in all three themes.

**Baseline provenance correction (2026-11-27):** outcomes for the other 33 routes in the
54-journey helper runs were not retained, so no full-run totals are asserted. The worker also
disclosed an earlier dark helper invocation missing the external `setTimeout` primitive;
all seven filtered routes reported `setTimeout is not defined`. The source-unchanged dark
helper was then rerun with the existing timer primitive, producing the affected-subset results
recorded above. This execution-setup retry was previously omitted from the report; it is not
a product fix or evidence of clean full-suite execution.

**Implementation/review progress (2026-11-27):** `mai-code-2` returned the S1-S5 refactor.
The advisor approved the exact diff at 85% confidence, including stable selection callbacks,
next-selection command resolution and late-delete subtraction of the originally requested
IDs from the latest page. Correct setter references: paging is in
`ToolbarViewNavigation.tsx:25,54,81,105`; path navigation is in
`ToolbarTableNavigation.tsx:34,60`; query action-bar setters are at
`CollectionQueryActionBar.tsx:67,84,116`; editor execution is in `CollectionView.tsx:836`,
and step-in at `:687`. Mount's initial-query setter remains cached-query-gated. The source
invalidation argument is not a runtime proof of the render-to-effect interval or end-to-end
host cache isolation. The advisor's README scope question is resolved by the existing file
ownership instruction: leave the pre-existing user edit out of WI-G3-2. Post-refactor checks
are still pending; no implementation commit yet.

**Post-refactor checks (2026-11-27), `mai-code-2-flash`:** focused unit tests passed **29/29**,
focused harness tests **146/146**, and `npm run build` passed. The exact seven-route dark
subset stopped in `paging`: the `50` option became detached/unstable during the page-size
gesture. Six routes were ready; **65/65 executed assertions passed**, with 89 RPC calls and
one harness error. `no-id` and the new active-query contract passed. No failed assertion was
recorded before the gesture error, and light/high-contrast were not run after it. The worker
reported built-in viewport drift from 934 x 813 to 713 x 813 without issuing a resize.
The advisor is assessing the bounded next step; no retry, test repair or implementation
commit is authorized by this result, and clean three-theme evidence remains incomplete.

**Paging retry gate (2026-11-27):** the advisor recommends a fixed-viewport, unchanged isolated
dark `paging` retry at approximately 80% confidence. Source review found no new render/state
ordering on the page-size path; a pre-existing loading/table-reply timing risk remains, and
no cause is established from the gesture error alone. The operator authorized pinning the
built-in page to 713 x 813 via its API if supported, avoiding panel interaction during the
single retry. Unsupported viewport setup or repeat failure must stop rather than bypass the
gate. A stable passing retry permits the already-authorized affected light/high-contrast
journeys to resume; the advisor's suggestion of fresh authorization for those is not followed
because G3-browser already provides it. No source or behavior-contract change is authorized.

**Final affected-source-browser evidence (2026-11-27), `mai-code-2-flash`:** supported API setup
pinned 713 x 813; the subsequent reported DPR was approximately 1.0 rather than the earlier
1.5. The isolated dark `paging` retry passed **15/15 assertions**, with 73 RPC calls and
zero errors. The preceding six dark routes contributed 61 passing assertions and 64 RPC
calls. Light and high-contrast each then passed seven routes / 76 assertions / 137 RPC calls
with zero errors. Combined completed coverage is **21/21 ready, 228/228 assertions, 411 RPC
calls, zero errors**; the new active-query contract passed all three themes. No forced click,
focus repair, source modification or unapproved retry was used. The existing server stayed
running. The viewport setup and multi-attempt evidence must not be described as an unchanged
single-run baseline at the original DPR.

**Execution design, advised (`claude-opus-5.5`, 2026-11-27):** keep the selection callback stable
because Table's effect cleanup depends on it. `commandsFor` is a module-local pure function;
`getSelectedTargets(context)` is a callback depending on `isCurrentTablePage`. Resolve commands
against the next selection. For S1, the advisor's source argument (confidence approximately 80%)
is React's synchronous effect flush for the current discrete-event setters
(`react-dom-client.development.js:18323`, query action bar, navigation and paging toolbars,
and step-in). A late reply released after a new request is preservation evidence, not a test
of the render-to-effect interval. Record that distinction and the setter inventory; if a
non-discrete setter invalidates the argument, stop for a decision rather than remove protection.

Use the existing WI-7/WI-8, selection, paging, late-query, late-delete and step-in contracts as
the baseline. No existing `TDD:` behavior contract changes.

- **S1:** remove `tablePageQueryRef` and its condition in `isCurrentTablePage`; reduce
  `isCurrentRequest` in `getDataForView` to `request === dataRequestRef.current` and drop the
  `result.path` re-check. Keep `cachedQueryRef`, the effect's `cancelled` flag and the path
  comparison in `isCurrentTablePage`, as well as the view/loading/page-presence and
  `tablePageRequestRef` checks. Trace every query, paging, view and path invalidation before
  deleting guards: the counter must invalidate obsolete replies before they can be consumed.
  Cover the render-to-effect interval, not only a reply after the next request starts. Existing
  `late-query` covers a held nested-page reply, not all active-query interleavings. Add one
  focused deferred-reply case for a new active query if needed; if the counter invariant fails,
  keep the necessary protection and seek a decision rather than knowingly weaken it.
- **S2:** add `getSelectedTargets(context)` (current-page check + `resolveDocumentTargets`),
  `commandsFor(targets)` (the four `disable*` flags) and `openSelectedDocument(mutation)` for View
  and Edit. Use them in `handleSelectedRowKeysChange`, both delete paths, View and Edit. Resolve
  against the **next** selection when setting state, not the previous one. Preserve exact
  single-target checks, mixed-safe/unsafe selection withholding, and error notifications.
  Late Delete continues subtracting the originally requested IDs from the latest page and
  recomputing commands for the surviving selection; it must not delete the newer selection.
- **S3:** in `handleStepInRequest` keep `isCurrentTablePage`, `field === undefined`,
  `field === '_id'` (comment: O1 keeps nested `_id` hidden, `decisions.md` O1) and the object-type
  check; remove `columnKey === ROOT_ID_COLUMN_KEY` and the `page.columns.some(...)` scan. In
  `DataViewPanelTable.onCellDoubleClick`, use the typed page column at RDG's `column.idx` instead
  of rescanning columns merely to recover `ColumnKey`; check it exists. Do not replace the scan
  with an unchecked cast. Keep the existing missing-page/row and gesture checks.
- **S4:** remove `isRootId` from `TableColumn` (`types.ts`), `toTablePage.ts`, the
  `TypedValueCell` props, `DataViewPanelTable`, `toTablePage.test.ts`, `TypedValueCell.test.tsx`,
  `build/verification/browser/fixtures.ts` and `collectionViewFixtures.ts`. Follow symbol usages
  and search object literals as well as JSX props so source, wire producers and fixtures agree.
  Keep `ROOT_ID_COLUMN_KEY`, `fieldFromColumnKey`, and the shaper's nested `_id` exclusion.
  Historical interface sketches remain historical; do not bulk-rewrite them.
- **S5:** move the inline results-area `onKeyDown` into a named `handleResultsKeyDown`, unchanged.
- Also (S7 note): make the `Cell` focus-sync comments in Table and Tree state the same RDG Tab-exit
  reason. No shared abstraction or Tree focus/state change.

**Acceptance:** action eligibility, late-delete behavior, nested `_id` policy, row gestures,
Escape's clear-then-exit behavior and popup precedence are unchanged. No live `isRootId`
producer/consumer remains. In particular, S1 is a verified simplification, not permission to
change host cache versioning or claim end-to-end query isolation.

### 3. R2 — keyboard step-in restores grid focus (decision 0004)

**Status:** Implemented; focused component and three-theme source-browser evidence complete.

> **Done (2026-11-27), commit `9eb782bd`:** keyboard step-in now carries a local,
> request/query/path-bound one-shot focus intent to the successfully applied Table page.
> Table resolves the same `rowKey` and focuses column 0 after commit without selecting it;
> outside focus, supersession, failure and unmount cancel permanently. Pointer behavior is
> unchanged. Added 11 component cases and one harness case, the three uninterrupted M7
> contracts, positional-row coverage and held-reply picker-focus preservation. Decisions:
> operator specified the behavior and models; advisor `claude-opus-5.5` approved the exact
> production logic and test-only leaf-column correction at high confidence (no numerical
> figures supplied); leader carried out those decisions and committed only owned item files.
> All behavioral assertions were retained. Initial build failed in the new RDG mock and
> was corrected without production changes. Component tests passed 11/11; the changed
> four-case Table file passed again after correction; harness tests passed 78/78; build
> passed. Post-fix source journeys: 9/9 ready, 90/90 assertions, 135 RPC calls, zero errors
> in 49.410 seconds, including positional focus and held-reply picker focus in all themes.
> Full reports and the setup failure/retry/authorized clean baseline remain recorded below.
> No localized string changed. No packaged/workbench screen-reader check, Case 2,
> formatting, push, thread reply, automation or G3a/G3b release was performed.

**Fresh-run progress (2026-11-27):** resumed from `47539263` at
`2026-11-27T16:11:34.558Z`, with the operator retaining `mai-code-2` for implementation/docs,
`mai-code-2-flash` for checks and read-only `claude-opus-5.5` advice. HEAD and draft #1142
were reverified; only the pre-existing two-line README index edit was dirty. The checks worker
reverified PID 54856, this checkout's Vite command, HTTP readiness and the existing built-in
page at 713 x 813 / DPR approximately 1.0. No server restart, viewport change or journey was
performed during that environment check.

The advisor confirmed the recorded local interfaces and identified missing positional-row
coverage (high confidence; no numerical figure supplied). Its bounded recommendation adds a
`details` object and nested reply to the existing `no-id` fixture, with contracts appended after
the existing assertions. No fixture key or assertion schema changes. The contract worker added
the three specified uninterrupted M7 assertions, the positional journey and one harness test;
production is unchanged. Leader review confirmed that existing assertions and runner bytes
were not edited. Focused harness and six targeted failing-first browser journeys are next.
Implementation remains blocked until the first new M7 focus contract fails in the real browser.

**Initial failing-first evidence and retry gate (2026-11-27):** focused harness tests passed
78/78 in 2.23 seconds. Six browser journeys (`step-in` and `no-id`, each in dark, light and
high-contrast) were ready, with 63/75 assertions passing and 12 failing only the new M7
contracts: same-row `_id` focus, ArrowRight continuation and Space selection in `step-in`,
and positional-row focus in `no-id`. No completed journey reported a harness error.
However, the first wrapper navigated to dark `step-in` and failed before assertions with
`setTimeout is not defined`; the checks worker retried contrary to its stop instruction.
It preserved the helper prefix and supplied the external timer via
`(fn, ms) => page.waitForTimeout(ms).then(() => fn())`. This is recorded as a setup deviation,
not a clean baseline or an authorized retry. Git HEAD remains `47539263`; `bf7285d3` is the
production-code baseline, not HEAD.

The leader paused implementation and raised **G3-browser-baseline-retry**. The operator
selected **`authorize-clean-rerun`**, authorizing one six-route run with the correct timer
wiring from the outset, unchanged runner/viewport/server, and no further retry. That run is
pending; production remains unchanged. Previous failures and retry evidence are retained.

**Authorized clean failing-first rerun (2026-11-27):** one guarded targeted helper execution
ran exactly `/collectionView/step-in/{dark,light,high-contrast}` and
`/collectionView/no-id/{dark,light,high-contrast}`. All six were ready; **63/75 assertions
passed, 12 failed**, with 78 RPC calls, zero route errors and 36.460 seconds combined elapsed.
Only the new M7 contracts failed, including the exact same-row `_id` focus contract in every
theme. The helper prefix was preserved (marker offset 16,666); only the manifest route array
was replaced, and the authorized external timer was supplied from the first invocation.
There was no further retry, focus repair, forced click, server restart or viewport change.
Full raw assertion/call/error reports are persisted in the fresh session's `files/` as
`wi-g3-3-before-clean.txt` (30,055 bytes) and `wi-g3-3-before-retry.txt` (24,542 bytes).
The leader accepted this operator-authorized reproduction gate and dispatched `mai-code-2`
to implement the recorded design and component tests. No post-fix result is claimed yet.

**Implementation returned (2026-11-27), `mai-code-2`:** the worker added the local
request-bound intent, keyboard/pointer discrimination and Table's exact-page one-shot layout
effect, plus 11 component cases (seven parent wiring, four Table) and a held keyboard-step-in
picker-focus contract appended to `late-query`. Existing contracts are unchanged. No checks
were run by the coding worker. The exact revision is now with `claude-opus-5.5` for lifecycle
review while `mai-code-2-flash` runs the focused component/harness tests, Case 1 build and,
only if they pass, nine affected source journeys. No approval or post-fix success is claimed
before those agents return.

**Review and first post-fix checks (2026-11-27):** the assigned advisor approved the exact
production revision at high confidence (no numerical figure supplied), including request
binding, cancellation, cleanup and Table's public-handle handoff. Component tests passed
11/11 in 15.25 seconds; harness tests passed 78/78 in 2.27 seconds. `npm run build` failed
with TS2339 in the new `DataViewPanelTable.test.tsx`, lines 54 and 71: the mock accesses
`key` on RDG's column-or-group union without narrowing the group case. No browser journeys
were run after this failure, and no existing `TDD:` assertion failed. The leader requested
an advisor-approved test-only typing correction; production and every behavioral assertion
must remain unchanged. Commit and post-fix browser evidence remain blocked.

**Test-only correction (2026-11-27):** the advisor approved narrowing the mocked RDG columns
to leaf `Column<TableRow>` values, throwing on unexpected groups rather than filtering and
shifting column indexes. `mai-code-2` applied exactly that correction, without changing
production or assertions. The parent same-path supersession case explicitly asserts equal
old/new paths; no coverage reduction was accepted. The changed four-case Table test, build
and nine source journeys are now with the checks worker.

**Checks delegation deviation (2026-11-27):** host events revealed an unnecessary
`mai-code-2-flash` review child (`8c577ad1-dbbd-4ef5-b42c-2b3cc97a5ab8`), started by the checks
worker without a model override and blocked before inspection (12.223 seconds, zero tools).
Its result was not used as advice or substituted for the designated `claude-opus-5.5`
approval. The worker's claimed child ID and statement that the assigned advisor could not
inspect were incorrect; host records established the actual ID/model. This failed attempt
is included under `review` in fresh-run usage, and further checks delegation is prohibited.

**Post-fix completion evidence (2026-11-27), `mai-code-2-flash`:** after the exact test-only
correction, the four Table cases passed in 7.78 seconds and `npm run build` passed (npm
did not report a duration). The unchanged parent seven cases and harness 78 cases had
already passed; they were not redundantly rerun. One preserved-helper execution ran
`step-in`, `no-id` and `late-query` in dark, light and high-contrast:
**9/9 ready, 90/90 assertions passed, 135 RPC calls, zero errors**, in 49.410 seconds.
Each theme contributed 13 step-in assertions/18 calls, 12 no-ID assertions/8 calls and
five late-query assertions/19 calls. There were no post-fix setup/gesture failures,
retries or focus repairs. The exact 41,739-byte raw report is persisted as
`files/wi-g3-3-after.txt` in the fresh session. The existing server and 713 x 813 page
were preserved. Production review covered the committed revision; only the previously
approved mock narrowing followed it.

**Execution design, advised (`claude-opus-5.5`, 2026-11-27, confidence 85%):** use local refs in
Collection View, not a pure intent module created solely for testing. The intent retains
`rowKey`, the initiating active-query object, destination path and claimed request number.
A temporary `focusin` listener permanently cancels on focus outside the initiating grid,
even if focus later returns. Remove it on cancellation, successful completion, current-request
failure, superseding query/navigation or unmount. Table receives a local
`{ page: TablePage; rowKey: string }` request and settles it once in `useLayoutEffect`, requiring
the identical successfully applied page object and focus on body or in the grid. RDG uses its
own layout effect for position focus (`react-data-grid/lib/index.js:455-471`). Add component
wiring tests for failure/retry, same-path superseding query, outside-focus-and-return, pointer
navigation and cleanup; pure helper tests alone would not establish that behavior. Browser
focus remains required. A browser failure after one fix iteration triggers advisor review and
operator authorization before substituting `gpt-6.1-sol`.

**Contract first** (in the `step-in` scenario list, `scenarios.ts`, right after
`TDD: M7 Enter on an object cell steps in`, before `M2 Level up`). That step already exercises the
fewer-columns case: the focused `child` cell is column 3 of 3, and the leaf level has 2 columns.

- `focused`: `TDD: M7 keyboard step-in focuses the same row's _id cell` → target the
  `aria-colindex="1"` gridcell of the row that held `{...}`.
- `focused`: `TDD: M7 arrow keys continue after keyboard step-in` → `ArrowRight` reaches that row's
  `leafName` cell.
- `attribute`: `TDD: M7 Space selects after keyboard step-in` → `Space` sets `aria-selected="true"`
  on that row.

Confirm the first contract fails on the current code before implementing.

**Implementation** (option (a)):

- Distinguish keyboard from pointer step-in at the two `onStepIn` call sites. Record one pending
  focus intent only after `handleStepInRequest` accepts the keyboard gesture. Keep it local to
  Collection View/Table, with the initiating `rowKey`, query and destination path; associate it
  with the existing request number when the destination Table load starts.
- Only a successfully applied, current response for that request may complete the intent.
  Destination-path equality alone is insufficient: a later query can reuse the same path.
  Pass the completed page/row intent to Table without adding RDG focus fields to the host's
  grid-neutral `TablePage` contract.
- After the new page and columns commit, find the initiating row by `rowKey` (not its previous
  numeric index) and request
  `gridRef.current?.setActivePosition({ idx: 0, rowIdx }, { shouldFocus: true })`.
  Focus the root `_id` cell, not the old column index. Do not select the row as a side effect.
- Consume the intent once. Restore only if focus is on `document.body` following cell removal or
  is still in this grid. Cancel if the user moves to another control while waiting, the query or
  navigation supersedes the request, the load fails, the row disappears, or the view unmounts.
  An abandoned intent must not fire during a later load. Clean up any temporary focus listeners.
- Use a post-commit effect and RDG's public handle; no timer-based delay, DOM selector focus,
  remount key, general refresh-focus manager or pointer-navigation behavior change.

**Additional acceptance:** use the existing deferred-reply/release mechanism for a held keyboard
step-in. Check that moving to the view picker retains picker focus after release, and that a
superseding query/path does not consume an old intent even when the destination path is reused.
Cover failure followed by retry without resurrecting the old intent; use a component test if
the fixture cannot express that case without new infrastructure. The normal journey must also
work for a browsable positional row: focus restoration is not a document action.

Keep the Enter → ArrowRight → Space assertions uninterrupted: no click, explicit refocus,
reload or fixed sleep may repair focus between them. Browser focus evidence is required;
jsdom alone does not establish RDG's actual focus behavior.

**Thread reply** (item 7): the step-in comment is fixed; the deletion part is not established,
because Delete starts from the toolbar through a host confirmation, so focus is outside the grid.

### 4. R5 — type is part of the cell's name; no tooltip (decision 0004)

**Status:** Implemented; focused tests and three-theme computed-name/hover evidence complete.

> **Done (2026-11-27), commit `c09cdb6d`:** defined Table values now name their full BSON
> type before the value; the original glyph remains visual and is `aria-hidden`. The
> BSON value Tooltip is removed; missing-field Tooltip/label behavior is unchanged.
> Decisions: operator specified R5 and approved the exact visibility-step amendment to
> the new glyph contract; advisor `claude-opus-5.5` diagnosed virtualization at 85%;
> leader approved the local production revision at 95% after direct review. Added one
> harness case and two browser contracts, retaining every original `TDD:` assertion.
> Cell tests passed 3/3, harness 79/79 and build passed. After the recorded harness-only
> repair, 15/15 source journeys passed 261/261 assertions with 114 RPC calls and zero
> errors. In all themes focused computed names were exactly `Int32 7` and
> `Decimal128 12.50`, excluding glyphs; no visible `Int32` Tooltip appeared after
> 544–568 milliseconds of observation. The initial 258/261 result and all raw reports
> remain recorded. No l10n string changed, screen reader was exercised, packaged check
> ran, gate was released, or external operation/Case 2/formatting was performed.

**Failing-first evidence (2026-11-27), `mai-code-2-flash`:** the unchanged `mixed-types`
journeys were ready in dark, light and high-contrast, each passing 39/39 existing assertions
with zero errors (117/117 combined), with five RPC calls per route. The worker initially
misreported 38/38 and 114 combined; its retained-report clarification corrected the counts.
In each theme the focused count gridcell's computed
snapshot was `7 i32`; exact `Int32 7` role lookup found zero matches. The glyph lacked
`aria-hidden`, and hovering displayed the `Int32` Tooltip after 426/434/413 milliseconds
respectively (installed Tooltip default show delay: 250 milliseconds). Decimal128 snapshots
were `12.50 d128`, not exact `Decimal128 12.50`. Inner spans had no added Tab stop.
These are browser-computed observations, not spoken-screen-reader evidence.
The server/page/viewport were preserved. The worker initially reported a persistence
restriction, then clarified that no write was attempted and no tool denial occurred.
The leader preserved the already-generated raw outputs as `files/wi-g3-4-before.txt`
(32,510 bytes) and `files/wi-g3-4-before-external.txt` (59,027 bytes) in the fresh session.
This corrected the omitted persistence without a browser rerun or source change.

The leader accepted the reproduced R5 failure and dispatched `mai-code-2` for the specified
hidden text, visual-only glyph and value-Tooltip removal, retaining the missing-field Tooltip.
The known runner uses substring matching for guarded cell names and `includes` for ordered
text, so no existing `TDD:` contract change is presumed or authorized. Two new glyph/Tab-stop
contracts use the existing assertion format; exact-name/hover evidence remains external.

**Implementation returned (2026-11-27), `mai-code-2`:** defined values now use the repository's
visually-hidden text style before their visible value; the original glyph is `aria-hidden`,
and only the BSON value Tooltip is removed. Missing-field Tooltip code is unchanged. The
worker updated the specified non-`TDD:` cell expectations and added one harness case/two
browser contracts without changing existing contracts or adding assertion-format fields.
Leader direct review accepted this local change at 95% confidence: the only production
consumer is Table, the props/host boundary and localization are unchanged, and the existing
layout style is preserved. Focused tests/build, 15 affected source journeys and three-theme
external computed-name/hover observations are now with `mai-code-2-flash`; no post-fix
success is claimed yet.

**First post-fix checks and TDD gate (2026-11-27):** cell tests passed 3/3 in 5.61 seconds,
harness tests 79/79 in 1.31 seconds, and build passed. The single targeted helper execution
completed all 15 requested routes, with **258/261 assertions passed**, 114 RPC calls and
zero route errors. Its three failures are the *new* glyph `aria-hidden` contract (one per
theme), reporting `null` rather than `"true"`; no pre-existing contract failed, contrary to
the worker's initial label. The helper's route loop had already executed the whole selection
before the failure report was inspected. No retry or external post-fix name/hover run occurred.
Full output is persisted as `files/wi-g3-4-after-first.txt`. Production and tests are unchanged
pending a narrow advisor assessment of target-column visibility/selector shape.
**WI-G3-4-TDD** blocks any contract repair and the implementation commit; the operator must
approve the recommended test amendment after that assessment. The intended glyph expectation
must not be weakened or removed.

**WI-G3-4-TDD resolution (2026-11-27):** advisor `claude-opus-5.5` attributed `null` to the
count column being virtualized away after header traversal ends at column 12 (85% confidence,
source-based, not a browser run). RDG renders visible columns plus overscan; the selector
matches the intended glyph when column 3 is mounted. It recommended `Home`, `ArrowRight`,
`ArrowRight` before the glyph assertion, with the unchanged Tab-stop check immediately after.
The operator selected **`approve-harness-only`**, authorizing those exact steps and their
harness pin, plus focused checks and the targeted rerun. The selector, `"true"` expectation
and all original contracts are retained; a passing glyph assertion will establish that the
following Tab-stop check examines a mounted cell. Production remains unchanged. A repeated
`null` after these steps would reopen the gate, not justify weakening the test.

**Post-fix completion evidence (2026-11-27), `mai-code-2-flash`:** the amended focused
harness passed 79/79 in 1.54 seconds. The preserved helper ran the same 15 routes:
`mixed-types`, `missing-vs-null`, `html-values`, `heterogeneous` and `step-in`, each in
dark, light and high-contrast. All were ready; **261/261 assertions passed**, with
114 RPC calls and zero errors. Per theme, route assertions/calls were 41/5, 2/5,
2/5, 29/5 and 13/18 respectively. External checks then found exactly one focused
`Int32 7` and one `Decimal128 12.50` gridcell in every theme, with `i32`/`d128` visual
glyphs `aria-hidden="true"` and no inner Tab stop. Hover observed zero visible `Int32`
Tooltips after 551/568/544 milliseconds (500-millisecond bounded observation over
the verified 250-millisecond entry delay). This wait was only hover observation, not
M7 focus repair or a runner change. Full results are persisted as
`files/wi-g3-4-after.txt` and `files/wi-g3-4-after-external.txt`; the server and viewport
were preserved. Spoken screen-reader output remains unverified.

**Execution evidence design, advised (`claude-opus-5.5`, 2026-11-27):** do not extend the exported
scenario assertion/step format with `exact` or `hover`. Use existing assertion forms for glyph
and Tab-stop contracts, plus an external script in the authorized built-in browser to require
the focused gridcell's exact computed name and absence of the BSON tooltip after hover.
Run before and after the change in all three themes; distinguish this from spoken-screen-reader
evidence. Keep the missing-field Tooltip and its existing label relationship.

- `TypedValueCell.tsx`: remove the `Tooltip` around values and its import if unused. Render a
  visually hidden span with the full type name (`bsonStringToDisplayString`) **before** the value,
  followed by a separator so the name reads "Int32 7", and mark the glyph `aria-hidden="true"`.
  Reuse the repository's visually hidden text styling pattern, so the flex layout, ellipsis and
  right-aligned glyph do not change. Do not use `display: none` or `aria-hidden` on the type name.
  No new l10n strings (type names come from the existing helper).
- Missing-field cells keep the `"This field is not set"` label and their existing blank
  presentation (confirmed in decision 0004). The removed tooltip is the **BSON type** tooltip;
  do not accidentally remove the missing-field label relationship.
- `TypedValueCell.test.tsx`: replace the `aria-describedby` assertions with: the hidden text is
  `Decimal128`, it precedes the value in DOM order, the glyph has `aria-hidden="true"`, no
  `aria-describedby`, still no `tabindex`; the untrusted-display test updates its expected
  `textContent`.
- Add a browser assertion against the **focused RDG gridcell's computed accessible name**, for
  example `Int32 7`, not just the inner span's text. The glyph must not appear in that name.
  Assert no additional cell Tab stop and no BSON type tooltip on hover. Keep explicit null,
  missing, empty-string and untrusted-text cases distinct.
- Rerun the affected mixed-types, missing-vs-null, HTML-values and keyboard journeys on demand.
  Check the runner's actual name-matching semantics; do not assume extra type text cannot affect
  existing steps. If a `TDD:` expectation needs changing, stop for operator approval.

**Acceptance:** full type precedes value in the accessible name without duplicate glyph
announcements; visual glyph and ellipsis remain. A browser-computed name is not a claim that
NVDA/Narrator were exercised. Their spoken-output confirmation stays with G3b.

**Thread reply** (item 7): the type is now part of the focused cell's name; the hover tooltip was
removed by decision.

### 5. R3 — packaged L2 requires Collection View results (decision 0004)

**Status:** Implemented; source/harness evidence complete. Fresh packaged normal/negative-control evidence remains authorization-gated.

> **Done (2026-11-27), commit `3ac66077`:** restored the packaged fixture's Alpha/Beta
> result markers and `display: grid` expectation; non-default source presets retain
> independent shell readiness, including empty/Tree/loading entry states. Added six
> runtime/manifest regressions; no existing test or runtime implementation changed.
> Decisions: operator specified R3 and the model assignments; advisor `claude-opus-5.5`
> approved the exact revision at approximately 85%; leader preserved the four prior
> shell selectors and used the previously verified wrapper after checker reset.
> Failing-first: six expected failures, 133 passes. Authoritative fresh JSON run:
> 154/154 tests in four files; build passed. Source matrix: 15/15 ready, 177/177
> assertions, 66 RPC calls, zero errors. Incomplete retained-checker reports and the
> fresh extraction failure are recorded below, not erased. The source normal case and
> jsdom CSS control do not prove a fresh packaged VSIX control. No packaging, Case 2,
> formatting, localization, external operation or G3a/G3b release was performed.

**Tests-first progress (2026-11-27), `mai-code-2`:** six new cases exercise the real
`stage0Harness.check()` with the actual Collection View fixture requirements: settled shell
without rows, rows without a grid, zero grid width, zero grid height, removed bundle-grid CSS,
and strict-default/independent-preset readiness. Test-local DOM geometry isolates the declared
layout requirements; Monaco worker proof is disabled only in these focused test fixtures.
No existing test or production fixture/scenario was changed. The leader reviewed the
bounded additions and dispatched `mai-code-2-flash` to demonstrate the expected failures
before implementing R3. This is source-harness evidence, not a fresh packaged VSIX or proof
that the product renders its rows correctly. Packaged normal/broken-CSS checks remain gated.

**Failing-first result (2026-11-27), `mai-code-2-flash`:** the focused command reported
**six new expected failures and 133 passes (139 tests)** in 6.11 seconds, with no old-test
or setup failure. The old fixture returned no errors for the missing-row, missing-grid,
zero-dimension and removed-grid-CSS cases; the default readiness still required only
`Documents` and four shell selectors. The CSS case had no unrelated diagnostics. The
reported third file is being clarified so the complete actual execution set is recorded.
The leader accepted this regression evidence and dispatched the exact fixture restoration
and explicit four-selector preset readiness. No tests, runtime implementation, public
format, product behavior or package operation beyond the accepted R3 item are changed.

**Implementation/review and checker reset (2026-11-27):** `mai-code-2` restored the two
fixture markers and grid display expectation, and separated preset/empty readiness while
preserving all four old shell selectors and fixture overrides. Advisor `claude-opus-5.5`
approved the exact four-file revision at approximately 85% confidence. The retained checker
reported 154 passing tests and a passing build, but its four-file claim listed only three
names; its browser attempt stopped at `default/dark` with an immediate `Documents missing`
message and no canonical report. Remaining routes were not run. Those incomplete reports
are not accepted as complete validation.

The operator asked to reconsider restarting agents and the browser environment. Direct
leader observation of the same page showed `Documents`, both fixture rows and the Table
grid. The leader retired the retained checker, reloaded the existing built-in page and
launched a fresh `mai-code-2-flash` checker for the canonical default-route proof only.
The shared Vite server was neither stopped nor restarted; no such permission was inferred.
The implementation commit and final validation remain pending.

The fresh checker initially substituted a named-array guard for the manifest's inline route
array and stopped before executing the canonical helper: zero assertions/calls and no
application failure. Its raw error is retained as `files/wi-g3-5-reset-guard-failure.txt`.
The leader supplied the previously successful inline-array wrapper verbatim, changing only
the selected route, and authorized one corrected extraction attempt. This is a coordination
correction (leader, 98% confidence, based on the earlier successful wrapper), not a test
amendment, product change or server restart.

**Canonical reset proof (2026-11-27):** the exact supplied wrapper passed
`/collectionView/default/dark`: ready, five/five style assertions, five RPC calls and zero
errors, including measured `display: grid`. The 45,940-byte source had a 16,666-byte prefix
and 222 manifest routes; only the selected inline array entry changed. The default showed
both fixture rows. The fresh checker is now running JSON-reported focused tests/build and
the complete 15-route readiness matrix. This avoids accepting the retained checker's
incomplete filename list or ad-hoc `Documents` failure as canonical evidence.

**Authoritative post-fix evidence (2026-11-27):** JSON reporting confirmed four actual
selected test files: `harness.test.ts` 15, `runtime.test.ts` 34,
`scenario-runtime.test.ts` 25, and `scenarios.test.ts` 80 — **154/154 passed**.
The runtime filename filter also selects `scenario-runtime.test.ts`; the fresh JSON
evidence resolves the earlier omitted-file issue without inventing historical output.
Build passed. One exact preserved-wrapper matrix ran `default`, `empty`, `deep-nesting`,
`first-load` and `loading-to-results` in all three themes: **15/15 ready, 177/177
assertions, 66 RPC calls and zero errors**. Full outputs are persisted as
`files/wi-g3-5-tests.json.txt` and `files/wi-g3-5-after.txt` in the fresh session.
Fresh packaged normal/broken-CSS checks remain pending at the separately authorized handover.

- `build/verification/browser/fixtures.ts` `collectionView`: restore
  `content: ['Stage 0 fixture row Alpha', 'Stage 0 fixture row Beta']` (the fixture rows already
  exist) and add `{ selector: '[role="grid"]', property: 'display', expected: 'grid' }`. RDG's root
  `display: grid` is declared in the installed stylesheet, making this a cheap candidate for (b)
  as well. `runtime.ts` `check()` already checks non-zero width/height; reuse it. Confirm the
  style expectation against the packaged negative control rather than claiming it passed from
  a stylesheet read.
- **Separate L2-dev readiness in the same change.** `scenarios.ts` `defaultScenario` imports
  fixture content/styles, and `collectionViewScenario` currently inherits that readiness.
  Keep the default Collection View scenario strict, but give non-default Collection View
  scenarios explicit `Documents`/shell readiness before applying their existing per-fixture
  overrides. Empty keeps `No results found`; Tree and first-load must not wait for a Table grid
  or the packaged Alpha/Beta rows. Preserve `noProgressbar: false` where already required.
- Extend existing `harness.test.ts`/`runtime.test.ts` only as needed to show that a settled
  header/Monaco shell without results is rejected, and missing or zero-layout grid expectations
  fail. Extend `scenarios.test.ts` to protect the strict-default/independent-preset split. These
  are harness regressions, not proof of production grid rendering.
- With a **fresh VSIX containing the fixes**, run packaged L2 at handover: normal Collection
  View has both rows and a visible non-zero grid; the broken-CSS control fails the grid style
  expectation for the intended reason, with unrelated diagnostics clean. Do not weaken row
  markers, skip checks or accept a placeholder if virtualization prevents rendering; investigate
  the coupled product/harness defect and record it.

**Acceptance:** packaged checks reject missing results again, while empty/Tree/loading source
scenarios still reach their intended entry state. No migration of the on-demand suite into CI.

### 6. Docs

**Status:** Implemented.

> **Done (2026-11-27), commit `668118be`, `mai-code-2`:** updated the current feature
> README/design, nested-navigation manual, parity disposition and the two earlier execution/
> review records. Preserved the original findings, unreleased gates and the user's two-line
> README plan entry verbatim. Decisions: leader carried out the accepted documentation scope
> at 95% confidence and corrected factual wording at 100% confidence: 63 passed/12 failed,
> and R1 save coverage is mocked, not browser/live-server evidence. No design deviation or
> operator rationale was invented. No tests were added or run for this docs-only item.
> Packaged normal/broken-CSS and native screen-reader/workbench evidence remain pending.

- `README.md`: link this plan now; update the current behavior/verification summary as fixes land.
- `design.md` "Table interactions": keyboard step-in moves focus to the same row's `_id` cell; the
  type indicator is visual only and the full type name is part of the cell's accessible name.
- `design.md` identity section: state the exact multi-key, any-depth integer-like-key rule from
  decision 0005. This developer-facing design note is not the deferred #1144 explanation/manual.
- `docs/user-manual/collection-view-querying.md` "Navigating Nested Results": after **Enter**, focus
  moves to the document's `_id` cell, so arrow keys and **Space** continue from there.
- `migration-parity.md` T06/T12: append the approved RDG disposition (text type name, no BSON type
  tooltip, D8); retain the baseline/parity history rather than rewriting it as current evidence.
- In the repository's `03-rdg-migration-review.md`, append per-finding implementation/evidence
  links only as earned. Preserve original findings and decisions. Never edit the read-only
  attachment or declare G3a/G3b released on the operator's behalf.
- Link completed WI-G3 items from `02-rdg-execution-plan.md` without rewriting its earlier
  outcome as if the fixes were already present. Record pending packaged or manual checks plainly.

### 7. Thread replies and push (always-ask)

**Status:** Deferred, authorization-gated.

> **Deferred, escalated (2026-11-27), operator boundary:** the current instruction forbids
> pushing, replying/resolving threads, automation and G3a/G3b release without required
> authorization. Option A is to keep these actions pending (recommended); option B requires
> explicit future push/reply authorization and the relevant packaged/manual evidence.
> No external action was attempted, and no approval is inferred from completed source fixes.

After relevant fixes and evidence are available, and only with operator approval to push/reply:
reply on the three Copilot threads
([step-in](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030349),
[Tree refresh](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030434) with
the R4 trigger analysis,
[BSON tooltip](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030494)).

For R4, explain that query, refresh, paging and view-switch triggers originate outside Tree;
in-Tree collapse already restores its surviving parent. No migration regression was established.
For R2, separate the implemented step-in fix from the unestablished deletion claim. For R5,
describe the approved type-name solution and tooltip removal, not a keyboard tooltip that was
never implemented. Include the relevant commit/evidence; do not auto-resolve threads, change
draft status, enable automation or merge as part of this plan.

## Verification

#1142 is a draft, so implementation remains **Case 1**: `npm run build` plus only the focused
Vitest selectors for files touched in that commit. The anticipated selectors are below; do not
run all of them for a documentation-only or unrelated item.

```powershell
npm run build
npx vitest run src\utils\documentGrid src\webviews\documentdb\documentView\documentsViewRouter.test.ts src\documentdb\ClustersClient.test.ts
npx vitest run src\webviews\documentdb\collectionView\components\resultsTab\TypedValueCell.test.tsx
npx vitest run --config build\verification\browser\vitest.config.ts build\verification\browser\scenarios.test.ts build\verification\browser\harness.test.ts build\verification\browser\runtime.test.ts
```

Add any new focused component-test selector to the relevant command. Browser-harness Vitest
tests use their own config and do **not** execute the real browser journeys.

**On-demand evidence, not an expansion of the per-commit Case 1 list:** when the operator asks
to run browser verification, use the existing [L2-dev recipe](../../../../../build/verification/README.md#l2-dev-source-scenarios).
Start `npm run watch:views` on port 18080 and execute the fetched
`/scenarios/run-all/collectionView.js` helper outside the page with a Playwright `page`.
Use `/collectionView/<scenario>/<theme>` routes without query strings. Check dark, light and
high-contrast, with no skipped assertions, harness errors, unexpected RPCs or focus-repair steps.
Record the source revision and results beside WI-G3-2 through WI-G3-5. Stop servers started for
the check; do not terminate another user's existing service.

The full **Case 2** list, including `prettier-fix`, `l10n:check`, `lint`, `build`,
`typecheck:tests`, full Vitest and `package`, stays with the separate ready-for-review handover.
Run `l10n` then if localized strings were added, changed or removed. Do not package during
Case 1 merely to satisfy R3 early or reuse the old G2 VSIX as proof of new code.

After the handover package exists, follow the [packaged L2 recipe](../../../../../build/verification/README.md#l2-production-webviews-in-the-integrated-browser):
`prepare:browser-check` with that VSIX and a fresh output directory, `serve:browser-check`, then
the external `/stage0/l2/integrated-all-checks.js` helper. Keep this evidence separate from
source-scenario, mocked-save and NVDA/Narrator evidence. Full Case 2 checks and the remaining
AI-review/operator gates are not waived by completing these fixes.

## Completion criteria

- R1, R2, R3, R5, R6 and S1–S5 have implementation commits and their specified evidence; regression
  checks fail on the relevant unfixed behavior and pass afterward. R4 has no code change.
- Item 2 changes no behavior contract. Any operator-approved contract amendment is recorded, not
  hidden as a test fix.
- R2's real browser focus journey and R3's fresh packaged result/negative-control evidence are
  recorded; until then, those evidence items remain pending even if the source fixes are committed.
- Related design/manual text matches the implemented decisions. #1144 and #1145 remain separate,
  with no claim that either has been fixed or closed here.
- Authorized replies distinguish implemented fixes from unestablished findings. The operator,
  not this checklist, releases gates and decides readiness.

# Outcome

Source execution is complete; handover remains gated. WI-G3-1 (`8cc23e15`),
WI-G3-2 (`bf7285d3`), WI-G3-3 (`9eb782bd`),
WI-G3-4 (`c09cdb6d`), WI-G3-5 (`3ac66077`) and WI-G3-6 (`668118be`) are implemented with their
evidence recorded inline. Authorized draft-stage source/documentation work is complete.
The full delivery plan remains gated on fresh packaged/manual evidence and WI-G3-7
push/reply authorization. Browser setup and intermittent gesture failures are retained above,
including the distinction between combined affected-scenario coverage and clean full runs.
No push, thread reply, package, formatting or gate release has occurred. #1142 remains draft
Case 1; full Case 2 checks, including `prettier-fix`, remain deferred until handover.

## Fresh-session handoff (operator-requested pause, 2026-11-27)

This is the original pre-resumption checkpoint, retained as history. Current completion and
pending gates are recorded in **Outcome** and **Fresh-run usage and completion** below.

The operator chose `fresh-handoff` after WI-G3-2 and its done note were committed. The parent
delivery plan is **paused, not complete**: two of seven accepted items are done. No coding,
advisor or checks agent is still running; retained agents are idle. Do not wait for another
implementation return or treat this checkpoint as approval to push or release a gate.

**Resume point:** WI-G3-3 (R2). Its production change, three new M7 focus contracts and component
tests have **not started**. Use the local-ref/request/page-bound design recorded under item 3,
not the rejected pure test-helper module or cancellation-only-at-completion design. Add the
three contracts at the exact specified point and demonstrate the first fails in the real
built-in browser before implementation. Component wiring tests must cover failure/retry,
superseding query/path, outside-focus-and-return, pointer navigation and listener cleanup.
Before dispatch, verify how existing fixtures cover keyboard step-in for a browsable positional
row; resolve any missing-fixture design with the advisor, without changing existing contracts.
The assigned coding model is `mai-code-2`; technical advisor is `claude-opus-5.5`; all builds,
tests and browser execution use `mai-code-2-flash`. A substitution to `gpt-6.1-sol` needs the
operator's authorization, including the recorded R2 escalation trigger.

**Remaining sequence:** WI-G3-3, then WI-G3-4 (R5), WI-G3-5 (R3), and WI-G3-6 final docs.
Their shared source/scenario files require sequential coding. WI-G3-4 uses existing scenario
forms plus external exact computed-name/hover evidence, not a new assertion-format schema.
WI-G3-5's fresh packaged normal/negative-control evidence stays pending until the separately
authorized handover package exists. WI-G3-7 remains push/reply-gated; do not post, resolve
threads, enable automation, mark ready or merge.

**Standing authorizations and environment:**

- The approved "do now" implementation and targeted failing-first/post-fix source-browser
  checks are authorized; #1144 and #1145 remain excluded.
- Use the built-in browser, not a shell-launched browser. Verified shared Vite server was
  PID 54856 on port 18080 in this checkout; reuse was explicitly authorized. It was not started
  by this run and must not be stopped or restarted. Reverify its identity/readiness after a
  fresh-session pause; do not assume a stale PID still belongs to it.
- Built-in page ID was `9cc7a269-2e89-4a0f-90c0-dc6517f68e62`. Supported viewport setup pinned
  713 x 813, with subsequent DPR approximately 1.0. Scope/authorization and multi-attempt
  evidence are recorded under item 2; do not silently repair focus, force clicks or alter waits.
- Source helpers contain `runScenario` plus trailing route-list orchestration. For a targeted
  subset, preserve the fetched function bytes above `\nconst origin = await page.evaluate(`
  and supply only existing routes; guard the marker and each route first. Execute outside the
  page with the same timer primitive. Do not run 18 routes and report only seven without
  recording the full execution set/results.
- Working branch is `feature/rdg-migration`, base `main`. Latest code commits are `8cc23e15`
  (WI-G3-1) and `bf7285d3` (WI-G3-2); done-note commit is `a5d146b4`. The handoff commit changes
  only this source plan.
- The only pre-existing dirty file is
  `docs/ai-and-plans/features/data-grid/README.md`: two user-authored lines adding this plan's
  index link. It was never staged, reverted or overwritten. Read and preserve it when doing
  the approved final README/docs update; keep it out of unrelated code commits.
- All verification remains draft **Case 1**. Formatting/full Case 2, fresh packaging,
  G3a/G3b releases and push/replies are not authorized. The recorded PR integration still
  reported #1142 as draft, with every automation option off, at handoff.

### Handoff usage and optimization evidence

Window: `/lead` start `2026-11-27T14:58:25.973Z` to host snapshot **2026-11-27 16:06 UTC**.
Wall-clock elapsed approximately **1h08m**. This is this run only, not cumulative usage from
other sessions. Later handoff serialization and the final response are excluded from this
snapshot. Summed model-request spans are **53m28s** and are not wall-clock elapsed; aggregate
check/CI time is not reported by the host (individual check durations are recorded inline).
AIU are not dollars.

| Model | Role | Requests | Model time | AIU | AIU share |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 93 | 17m19s | 669.1 | 72.7% |
| gpt-6.1-sol | leader | 80 | 17m34s | 200.0 | 21.7% |
| mai-code-2 | coding | 41 | 8m40s | 44.1 | 4.8% |
| mai-code-2-flash | checks | 71 | 9m55s | 7.0 | 0.8% |

| Role | Requests | Model time | AIU | AIU share |
| --- | ---: | ---: | ---: | ---: |
| leader | 80 | 17m34s | 200.0 | 21.7% |
| coding | 41 | 8m40s | 44.1 | 4.8% |
| advisor | 93 | 17m19s | 669.1 | 72.7% |
| checks | 71 | 9m55s | 7.0 | 0.8% |

| Model | Role | Input | Output | Cache read | Cache write | Reasoning |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 10,704,500 | 104,565 | 10,192,161 | 512,137 | 69,999 |
| gpt-6.1-sol | leader | 9,281,289 | 48,843 | 9,037,972 | 243,077 | 16,634 |
| mai-code-2 | coding | 3,341,456 | 29,708 | 2,745,344 | 0 | 12,929 |
| mai-code-2-flash | checks | 5,575,338 | 32,878 | 4,811,264 | 0 | 14,678 |

Cache/reasoning fields may overlap input/output; do not add them into a purported token total.
Totals: **leader 200.0 AIU; subagents 720.3 AIU; run 920.3 AIU**.

Three advisor agents handled **eight packets**: initial execution/model assignments plus R2
clarification (two), WI-G3-1 review/mock correction (two), and WI-G3-2 baseline/runner/review/
paging decisions (four). The low-confidence 75% baseline retry went to the operator; the
initial R2 cancellation/helper recommendations were revised before coding. Fresh authorization
for already-approved light/high-contrast runs was not requested despite that advisor suggestion.
No coding-model substitution or authorization failure occurred. Rework was the new WI-G3-1
mock type correction; browser setup and gesture retries are recorded under WI-G3-2.

Largest measured cost category: **advising, 72.7% of reported AIU**, dominated by initial broad
planning and subsequent clarification/review packets; coding and checks were 5.6% combined.
A future run can reduce overhead by preparing smaller source-linked decision packets and
verifying the built-in runner invocation/viewport before dispatch. Preserve the approved model
plan and mandatory review/operator gates; these figures do not compare model quality on unlike
work.

## Fresh-run usage and completion

Window: `2026-11-27T16:11:34.558Z` to host snapshot **2026-11-27 17:54 UTC**.
Session: `319da234-4c7c-4cc6-b872-6a56a0063cb1`. This is the resumed run only; the earlier
920.3-AIU snapshot above is not included or added to these totals. Approximate wall-clock
elapsed: **1h42m**. Summed model-request time: **1h36m54s**, not wall-clock time.
Aggregate check/CI execution time is not reported by the host; available individual
durations are recorded under the items. The final bookkeeping commit and final response
are excluded from this snapshot. AIU are not dollars.

| Model | Role | Requests | Model time | AIU | AIU share |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 63 | 6m37s | 354.6 | 31.7% |
| gpt-6.1-sol | leader | 134 | 56m23s | 685.1 | 61.2% |
| mai-code-2 | coding | 82 | 17m59s | 69.3 | 6.2% |
| mai-code-2-flash | review | 1 | 11s | 0.1 | 0.0% |
| mai-code-2-flash | checks | 97 | 15m44s | 10.5 | 0.9% |

The coding role includes the documentation worker; it does not include leading or advising.

| Role | Requests | Model time | AIU | AIU share |
| --- | ---: | ---: | ---: | ---: |
| leader | 134 | 56m23s | 685.1 | 61.2% |
| coding | 82 | 17m59s | 69.3 | 6.2% |
| advisor | 63 | 6m37s | 354.6 | 31.7% |
| review | 1 | 11s | 0.1 | 0.0% |
| checks | 97 | 15m44s | 10.5 | 0.9% |

| Model | Role | Input | Output | Cache read | Cache write | Reasoning |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 5,006,265 | 37,706 | 4,633,098 | 373,031 | 21,205 |
| gpt-6.1-sol | leader | 23,639,089 | 149,359 | 23,015,775 | 622,912 | 99,413 |
| mai-code-2 | coding | 6,910,341 | 63,517 | 6,149,632 | 0 | 29,079 |
| mai-code-2-flash | review | 29,996 | 766 | 4,608 | 0 | 729 |
| mai-code-2-flash | checks | 6,891,255 | 66,613 | 5,700,096 | 0 | 28,998 |

Cache/reasoning fields may overlap input/output; do not sum them into a purported total.
Totals: **leader 685.1 AIU; subagents 434.6 AIU; run 1119.7 AIU**.

### Agent attribution

| Agent ID | Item | Role | Model |
| --- | --- | --- | --- |
| `2657bec3-cdf3-4663-a8e4-85f6b1dc1f78` | WI-G3-3 | advisor | claude-opus-5.5 |
| `a38262e5-1c8e-41cf-b90f-bb6017ad4c24` | WI-G3-3 | checks | mai-code-2-flash |
| `4f3e63e0-c6fd-4831-94d6-c5a7274f98b5` | WI-G3-3 | coding | mai-code-2 |
| `8c577ad1-dbbd-4ef5-b42c-2b3cc97a5ab8` | WI-G3-3 | blocked review attempt | mai-code-2-flash |
| `1a5fc69d-a6af-4420-b2ac-efa9a2f5e6ec` | WI-G3-4 | checks | mai-code-2-flash |
| `dee65487-fc66-437f-b95b-fdfe721115df` | WI-G3-4 | coding | mai-code-2 |
| `3d7b09b0-c597-4875-8647-c8ac859b80b9` | WI-G3-4 | advisor | claude-opus-5.5 |
| `f111cf4c-87b6-4e39-bd3e-b4f59a8c12e9` | WI-G3-5 | coding | mai-code-2 |
| `0fb2fd0f-5183-458d-9a46-7bfaf682ed87` | WI-G3-5 | retired checks | mai-code-2-flash |
| `e992939d-7a80-417a-a76a-2297a8b31084` | WI-G3-5 | advisor | claude-opus-5.5 |
| `4cc1d91f-0ee4-4480-ace2-67c0668368a5` | WI-G3-5 | fresh checks | mai-code-2-flash |
| `0a6d3570-9406-4261-9c95-5b678d65aa40` | WI-G3-6 | documentation/coding | mai-code-2 |

Three advisor agents handled **five consultations**: WI-G3-3 interfaces/positional coverage,
production review and test-only typing correction; WI-G3-4 virtualized-column assertion;
WI-G3-5 strict/preset readiness review. Their verdicts were followed. The blocked additional
flash review was not used as advice. No coding-model substitution occurred.

Operator gates resolved in this run: **G3-browser-baseline-retry** (one clean rerun) and
**WI-G3-4-TDD** (exact visibility steps, expectation unchanged). At the operator's environment
steering, the retained checker was retired and the built-in page reloaded; the shared Vite
server was never restarted. Remaining gates are fresh packaged normal/broken-CSS evidence,
native screen-reader/workbench G3b checks, G3a/G3b release and WI-G3-7 external authorization.
#1144 and #1145 were not implemented.

**Checks:** draft **Case 1** only. Builds passed after the recorded new-test typing failure;
focused component tests passed 11/11 (changed Table file 4/4 again), cell tests 3/3,
and the final JSON-reported harness selection passed 154/154. Completed affected source
matrices passed 90/90, 261/261 and 177/177 assertions respectively. Exact type-name/hover
observations passed in all three themes. Earlier failures, retries and incomplete checker
reports remain inline and in the raw session reports. Documentation changes required no tests.
Full Case 2, including `prettier-fix`, `l10n:check`, strict `typecheck:tests`, full runtime
tests and packaging, remains deferred. No localized string changed.

**Optimization:** leading is the largest measured category (61.2%); advising is 31.7%.
Repeated evidence reconciliation, checker resets and long leader turns dominated overhead.
The failed extra review cost 0.1 AIU; retry-only usage is not separately reported.
Future runs should freeze the proven inline-array wrapper and JSON reporting before the first
checks, and keep leader packets/reconciliation short. Preserve the approved models and
mandatory gates; these figures do not rank model quality on unlike work.

### Operator-requested timing diagnosis

The operator asked where time went and whether machine performance was responsible.
This follow-up is separate from the frozen 17:54 implementation snapshot above.
A streaming session-log pass through **18:04:40 UTC** covered approximately **113m06s**
since the resumed run began; it found no malformed records.

| Role | Model requests | Summed model time | AIU |
| --- | ---: | ---: | ---: |
| leader | 139 | 65m51s | 769.2 |
| coding | 82 | 17m59s | 69.3 |
| advisor | 63 | 6m37s | 354.6 |
| checks | 99 | 16m37s | 10.8 |
| review | 1 | 11s | 0.1 |

The refreshed window reported **1204.0 AIU** and **107m15s summed model-request spans**.
It includes later bookkeeping/diagnostic activity; it is not added to either earlier snapshot.
Tool spans were PowerShell 650 seconds, browser 587 seconds, operator forms 186 seconds,
search 39 seconds, file reads 29 seconds and patches seven seconds. These overlap model and
other-agent activity and must not be added to wall time. The longest leader model records
were 351, 227, 178 and 128 seconds; overall model-duration median was 7.979 seconds and p95
59.303 seconds. Lengthy leader reasoning and repeated evidence reconciliation were material
overhead, independent of whether the machine also slowed local tools.

A current machine snapshot at **18:05 UTC** reported 22 logical cores, 31.6 GB RAM,
approximately 0.1 GB free and a 100% CIM CPU-load sample. A follow-up counter probe at
**18:09:34–18:09:57 UTC** found CPU 68% then 52%, 2,381 MB available memory,
96% committed bytes and 5,345 pages input/second. This confirms current memory/commit
pressure and significant, variable CPU utilization, not sustained 100% CPU.
Sampled individual working sets included Copilot runtime 1.670 GB, node 1.196 GB,
WebView2 1.099 GB, Code 0.651 GB and the antimalware process 0.592 GB; that list is not
complete memory accounting or proof of a single culprit.

No CPU/memory history was collected during the earlier implementation, so the share of past
delay caused by hardware cannot be quantified. Model/coordination spans dominate the recorded
activity; memory pressure can also slow browser/tool execution. Reduce unnecessary local
workloads before further heavy checks, while preserving the shared Vite server. Keep future
leader reasoning/reconciliation short and reuse the verified wrapper/structured reporting.
No process, service, browser session, source implementation or machine setting was changed by
this diagnostic.
