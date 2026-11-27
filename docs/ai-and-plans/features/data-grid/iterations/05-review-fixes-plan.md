---
feature: data-grid
kind: plan
status: proposed
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

**Status:** Pending.

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

**Status:** Pending. Intended to preserve behavior; not yet proven by execution.

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

Plan prepared against the current source and accepted dispositions. No product changes, runtime
verification, commits, pushes or review replies were performed by this planning task. All work
items remain pending. Case 2 checks, including `prettier-fix`, remain deferred until handover.
