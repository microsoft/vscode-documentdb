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

**Status:** Pending.

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

**Status:** Pending.

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

**Status:** Pending.

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

**Status:** Pending with implementation; this planning task adds only the plan and its index link.

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

**Status:** Pending; not authorized by this planning request.

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

Execution is in progress. WI-G3-1 (`8cc23e15`) and WI-G3-2 (`bf7285d3`) are implemented with
their focused evidence recorded inline. WI-G3-3 through WI-G3-6 remain pending; WI-G3-7 requires
push/reply authorization. Browser setup and intermittent gesture failures are retained above,
including the distinction between combined affected-scenario coverage and clean full runs.
No push, thread reply, package, formatting or gate release has occurred. #1142 remains draft
Case 1; full Case 2 checks, including `prettier-fix`, remain deferred until handover.

## Fresh-session handoff (operator-requested pause, 2026-11-27)

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
