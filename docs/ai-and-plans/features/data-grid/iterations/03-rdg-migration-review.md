---
feature: data-grid
kind: review
status: draft
prs: [1142]
created: 2026-11-27
---

# RDG migration: initial edge-case review

WI-12, CONTRIBUTING §6.1 steps 1–2 (initial review) and 3–4 (independent validation and sweep). Reviewed `feature/rdg-migration` at
`4b22242140614ea65340cadcc5f63c34bddb29d8` against the local `origin/main` merge-base
`8f81840d5aeeccece79321699e94d4789755a1fa`, for draft
[#1142](https://github.com/microsoft/vscode-documentdb/pull/1142).
Reviewer: `gpt-6-astra`; host-default reasoning/context.

Source review covered the actual migration diff, WI-12 and the relevant scope/interface contracts,
active design/decisions, identity and action consumers, grid keyboard/rendering code, the installed
beta.64 implementation, and related verification code. No build, tests, browser, live database,
commit, push, or remote review action was run. Findings below are source-confirmed; runtime
reproduction and independent validation remain pending. Historical verification reports were not
rerun or treated as proof of these edge cases.

Steps 3–4 were done by a separate fresh-context reviewer that did not reuse the initial reviewer's
or advisor's context. Each finding was re-traced from `git show 4b222421:<path>` and
`git diff 8f81840d 4b222421`, not from pending worktree changes (early Case 2 formatting, l10n and
lint corrections are handled separately and are not review decisions). Again no build, tests,
browser, live database, commit, push or remote comment was run. **Source-confirmed** means the
call path was traced in code; **runtime unconfirmed** means it was not reproduced.

## Findings

### R1 — High: newly actionable falsy IDs save as a different document

**Source:** `src/utils/documentGrid/documentIdentity.ts:37–53,83–86`;
`src/webviews/documentdb/collectionView/CollectionView.tsx:665–679`.
The new identity path admits `0`, `false`, `""`, and `null` and enables Edit.
However, `src/webviews/documentdb/documentView/documentsViewRouter.ts:83–104` still tests `_id`
by truthiness and passes `''` to `upsertDocument` for these values.
`src/documentdb/ClustersClient.ts:1224–1241` then generates a new ObjectId, removes the original
`_id`, and performs an upsert.

**Scenario/impact:** open a Table row with `_id: 0`, edit a non-ID field, and save without changing
the ID. In an ordinary collection without another conflicting unique constraint, this inserts a
new document instead of updating the selected one, while reporting success.

**Provenance:** the save-path defect predates this branch, but this migration newly makes these
rows usable Edit targets. The old shaper's `if (doc._id)` did not supply their action IDs. This is
a newly exposed integration failure, not a claim that the PR introduced the truthiness check.

**Recommendation:** distinguish an absent ID from an own falsy ID in the save path, preserving
the selected identity through save. Add focused save-path cases proving no generated ID/extra
document for all four values. The current identity browser check ends at the Edit RPC
(`build/verification/browser/scenarios.ts:754–756`), so it cannot catch this.

**Independent validation:** **Valid, High.** Source-confirmed; runtime unconfirmed. The falsy IDs
are deliberately actionable under the K2 contracts (`build/verification/browser/scenarios.ts:751–760`),
and Edit reaches the right document: `editDocumentById` opens Document View, whose
`getDocumentById` uses `pointRead` with the parsed canonical ID
(`documentsViewRouter.ts:46–60`). Only save diverges: `documentsViewRouter.ts:85–88` drops an own
falsy `_id`, line 103 passes `''`, and `ClustersClient.ts:1224–1226,1234–1242` substitutes a new
ObjectId, strips `_id` and upserts. The original stays unchanged, a second document is created,
and the confirmation (`documentsViewRouter.ts:118–120`) names the new ID. View and Delete are not
affected (`pointRead`; `deleteDocuments` uses `$in` over parsed IDs, `ClustersClient.ts`). This is a
pre-existing save defect that the migration newly exposes; it was not introduced by it.

**Options:**

- (a) In `saveDocument`, test for an own `_id` property instead of truthiness, and pass
  `EJSON.stringify(id)` whenever it is present. This keeps K2, is the smallest change, and also
  fixes such documents opened from other entry points. A document without `_id` (Add) keeps the
  generated-ID path.
- (b) Withhold Edit, but not View or Delete, for falsy IDs. No Document View change, but it
  reverses an accepted K2 contract and leaves the save defect in place.
- (c) Replace the `''` sentinel in `upsertDocument` with `undefined` (its own TODO at line 1225).
  It is cleaner, but a wider API change.

**Recommendation:** (a), with focused save-path tests for `0`, `false`, `""` and `null` (no new
ObjectId, same filter ID) and one Add case without `_id` that still generates an ID.

**Author decision and rationale:** **Approved (operator): (a).** Decided after a deeper
investigation of `_id` equality, including the driver and object `_id` field order. See
[R1 deep dive](#r1-deep-dive-object-_id-field-order-and-the-comparator-question), which adds R6
and R7.

### R2 — Medium: keyboard step-in removes the focused cell without restoring grid focus

**Source:** `src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx:115–138,175–185`;
`src/webviews/documentdb/collectionView/CollectionView.tsx:351–364,699–725`.
Enter changes the path and replaces the field-keyed columns, but no post-replacement focus
transfer is scheduled. RDG keys cells by `column.key`; its beta.64 implementation only performs
programmatic focus when a new `positionToFocus` is requested
(`node_modules/react-data-grid/lib/index.js:381–408,448–467,3068–3085`).

**Scenario/impact:** focus an object field `details`, press Enter, and receive children with
different names, such as `city`. The focused `field:details` cell is unmounted. If the child level
also has fewer columns, RDG resets the out-of-bounds active position without focusing a replacement.
The next arrow/Space cannot continue the grid journey until focus is recovered. This concerns the
new M7 keyboard action, not a request to replace all accepted RDG refresh defaults.

**Recommendation:** retain the initiating root row and restore focus to a surviving cell after
the matching step-in response, without stealing focus if the user moved elsewhere meanwhile.
Extend M7 with an uninterrupted Enter → arrow/Space journey, including fewer child columns.
The existing test checks only resulting text, then clicks Up
(`build/verification/browser/scenarios.ts:652–658`). Browser reproduction remains pending.

**GitHub Copilot corroboration:** [Step-in focus comment](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030349).
The comment also raises focus after deletion; that additional path is not established by the
step-in finding and should be evaluated separately.

**Independent validation:** **Valid for step-in, Medium.** Source-confirmed; runtime unconfirmed.
The baseline Table only stepped in on double-click
(`git show 8f81840d:src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx`,
line 217), so Enter is new M7 behavior. D6 accepts RDG focus after refresh "unless keyboard use
breaks" (`iterations/01-rdg-migration-plan.md:119`); this is that case. Row keys survive step-in,
but cells are keyed `field:<name>` (`src/utils/documentGrid/toTablePage.ts:34–39`), so the focused
cell unmounts unless the child level has the same field name. RDG refocuses only on a new
`positionToFocus` (`node_modules/react-data-grid/lib/index.js:454–461`) and resets an out-of-bounds
position without focus (`index.js:384–388`). The user manual documents Enter followed by arrow
keys (`docs/user-manual/collection-view-querying.md:244,252`), so the documented journey is the
one that breaks. Double-click unmounts the same cell, but pointer users are unaffected.

**Deletion part of the Copilot comment: not established.** Delete starts only from the toolbar
button (`CollectionView.tsx:873`) through a host confirmation (`collectionViewRouter.ts:357–364`),
so focus is outside the grid when acknowledged rows are removed. No grid-focus regression from
deletion was found; this is not broadened into R2.

**Options:**

- (a) After the matching step-in page is applied, focus the same row's root `_id` cell (always
  present, index 0) with `setActivePosition(..., { shouldFocus: true })`. Only do this if focus
  is on `body` or still inside the grid. This is the simplest and is predictable.
- (b) Keep the column index where it is still in bounds, otherwise fall back to (a). This keeps
  the position, but the column under focus then has a different meaning.
- (c) Accept and document the focus loss. This contradicts the user manual and D6's
  keyboard-breaks exception.

**Recommendation:** (a), and extend M7 with an uninterrupted Enter → arrow/Space journey,
including a child level with fewer columns.

**Author decision and rationale:** **Approved: (a).** The operator approved the recommended option
for every item not discussed individually. Reply on the Copilot thread that the deletion part is
not established (Delete starts from the toolbar through a host confirmation).

### R3 — Medium: packaged L2 no longer requires any Collection View results

**Source:** `build/verification/browser/fixtures.ts:506–515` replaces the two result-row markers
with only `Documents` and removes every grid style/layout expectation.
`build/verification/browser/runtime.ts:303–350` checks those configured markers/selectors and
Monaco, not a grid independently; `harness.ts:90–99` uses this fixture for the packaged page.

**Scenario/impact:** a packaged Collection View that renders its tab header and Monaco but leaves
results empty, hidden, or as a non-error placeholder can now satisfy this smoke check. Merely
including RDG in the bundle does not prove that it renders. The previous fixture rejected missing
result rows.

**Recommendation:** restore result-row and visible-grid expectations for the packaged fixture,
using neutral roles/layout rather than old SlickGrid classes. Keep empty/Tree/loading L2-dev
readiness separate where necessary. This does not require moving the accepted on-demand scenario
suite into CI.

**Independent validation:** **Valid, Medium (verification truthfulness; no direct user impact).**
Source-confirmed. The baseline fixture required both row texts
(`git show 8f81840d:build/verification/browser/fixtures.ts`); now `content` is `['Documents']`
and the styles cover only `.collectionView` and Monaco (`fixtures.ts:509–515`), while the table
RPC is still served (`fixtures.ts:521`). `ready()`/`check()` assert only those
(`runtime.ts:304–331`). `inspect.cjs:481` proves that RDG is in the Collection View graph, not
that it renders. The broken-CSS page (`harness.ts:96–100`) therefore cannot detect missing grid
styles either. No reason for the relaxation was found in the reviewed docs. If the rows did not
render in the packaged harness, for example because of zero-height virtualization, that would
be a product finding in its own right; unconfirmed.

**Options:**

- (a) Restore the two row texts and add a neutral `[role="grid"]` style entry, which also gains
  `check()`'s non-empty layout test. This is the simplest.
- (b) Also assert one RDG stylesheet property, so the broken-CSS control covers the grid.
- (c) Keep the fixture and document the gap. This is weaker than the baseline.

**Recommendation:** (a), plus (b) if cheap.

**Author decision and rationale:** **Approved: (a)** (recommended option, approved by default);
(b) only if it is trivially cheap.

### R4 — GitHub Copilot: focus after Tree results are replaced

**Source:** [Tree refresh comment](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030434),
`DataViewPanelTree.tsx` and `useTreeRows.ts`. Copilot reports that a replacement page collapses
branches and can remove a focused descendant. It suggests restoring focus to a surviving
ancestor or root, only if focus was in Tree before the replacement. Verify the actual refresh
path, its intended focus policy, and whether this is a migration regression.

**Severity and independent validation:** **Not established as a regression; Low.** Source analysis;
runtime unconfirmed. Tree nodes are replaced only by `getDataForView` for Tree
(`CollectionView.tsx:378–389`), after a new active query (`456–546`) or a view switch (`554–574`).
Each trigger starts outside the Tree: the query editor, run/refresh and paging toolbar, or the
view picker. There is no host-pushed refresh, and the only contributed keybindings are for the
playground (`package.json` `keybindings`). Inside the Tree, collapse already moves focus to the
surviving parent (`DataViewPanelTree.tsx:54–60,117–119`) and ArrowLeft is suppressed (`100–103`).
Collapsing on replacement is intended (`useTreeRows.ts:76–80`), and D6 accepts RDG focus after
refresh.

**Options:**

- (a) No change; reply on the Copilot thread with the trigger analysis. Recommended.
- (b) A defensive restore to a surviving ancestor or root, only if focus was in the Tree. Low
  value now; worth revisiting only if an in-Tree refresh trigger is ever added.

**Author decision and rationale:** **Approved: (a)** (operator). No code change; reply on the
Copilot thread with the trigger analysis.

### R5 — GitHub Copilot: BSON type description on keyboard-focused Table cells

**Source:** [BSON tooltip comment](https://github.com/microsoft/vscode-documentdb/pull/1142#discussion_r4719030494),
`TypedValueCell.tsx` and `DataViewPanelTable.tsx`. Copilot reports that the tooltip and
description are attached to an inner span instead of the actual focused gridcell. It suggests
putting the description and tooltip on the focused cell without a second Tab stop. Verify
what the focusable cell exposes and distinguish the optional hover tooltip from required
accessible access to the type.

**Severity and independent validation:** **Valid as an accessibility gap, Low; not a regression.**
Source-confirmed; assistive-technology output unverified. The focusable element is RDG's
gridcell. `TypedValueCell.tsx:86–92` attaches the `relationship="description"` tooltip to an
inner, non-focusable span. The description therefore does not belong to the focused cell, and
the tooltip does not open on keyboard focus. The cell's name from content still includes the
short glyph (`Ab`, `i32`), so type information is reachable but cryptic. The missing-cell label
(`75–79`) is included in the cell name. The baseline was no better: SlickGrid used a CSS glyph
and a hover tooltip. Parity T06 asks for an accessible textual type description, and T12 for
exposure on keyboard focus (`migration-parity.md:37,43`). D8 makes the hover tooltip optional
"if the type indicator is readable on its own" (`01-rdg-migration-plan.md:121`).

**Options:**

- (a) Make the glyph `aria-hidden` and add the full type name as visually hidden cell text.
  There is no extra Tab stop or duplicate announcement, and the change is small.
- (b) Set an `aria-description` on the gridcell through the existing `renderCell` override. It
  works for screen readers, but the tooltip stays hover-only.
- (c) Accept under D8 and record that the glyph counts as readable on its own.

**Recommendation:** (a), or an explicit (c) decision.

**Author decision and rationale:** **Approved (operator): remove the type tooltip, and screen
readers announce the cell as "type value".** This is (a) without the hover tooltip. The glyph
becomes `aria-hidden`, and the full type name becomes visually hidden text placed before the
value, so the focused gridcell's name reads, for example, "Int32 7". The visual layout is
unchanged, there is no extra Tab stop, and the full type name is no longer shown on hover. This
is acceptable under D8 because the type is now available as text. Assumption to confirm: the
missing-field cell keeps its "Not set" label (`TypedValueCell.tsx:74–80`).

## Independent sweep (steps 3–4)

No additional material new regression was established. These were checked and not raised:

- **Identity and save/delete:** `_id` projections that are computed, nested or non-boolean are
  untrusted (`ClusterSession.ts:280–293`; `documentIdentity.ts:60–73`). The canonical round-trip
  withholds IDs whose relaxed parse would change form, such as Long, instead of mis-targeting
  them (`documentIdentity.ts:48–53`). Delete and the host cache subtraction match only the
  requested canonical IDs (`ClusterSession.ts:333–350`).
- **Refresh and view lifecycle:** `isCurrentTablePage` and the request counter gate actions on
  query, page, path and loading (`CollectionView.tsx:176–209,336–346`). Local delete keeps the
  page's path reference, so the selection anchor survives. The Tree `?? []` fallback cannot loop
  `useTreeRows`.
- **Data order:** the Tree sorts roots and siblings by Field (`useTreeRows.ts:35–37`), which
  departs from server sort order for roots. This is accepted decision O2 (`decisions.md:108`)
  and is not re-raised.
- **Support floor:** `^1.123.0` for beta.64 is accepted decision 0001.

The protected out-of-scope topics (cell ranges, Tree selection, cross-page/shard duplicate
mitigation) were not reviewed.

## Second pass: re-validation at HEAD and simplicity review

Reviewed local `feature/rdg-migration` at `3cff9df9` (three commits ahead of the pushed
`4b222421`). Source review only; no build, tests or browser run. Product changes since `4b222421`
are formatting, l10n, and moving the selection-anchor reset from render into `selectRow`
(`DataViewPanelTable.tsx:50–56`); none of them touches R1–R5.

### Re-validation of R1–R5

| Item | Still valid at `3cff9df9`? | Evidence at HEAD                                                                                                                                                                                                                                | Severity |
| ---- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1   | Yes                        | `documentsViewRouter.ts` still tests `if (documentBson['_id'])` and passes `''`; `ClustersClient.ts:1224–1242` still generates an ObjectId, deletes `_id` and upserts. `toDocumentId` (`documentIdentity.ts:38–58`) still admits own falsy IDs. | High     |
| R2   | Yes                        | `handleStepInRequest` (`CollectionView.tsx:696–722`) only changes the path; the path effect (`:551–553`) reloads. Nothing restores grid focus; `DataViewPanelTable.tsx` has no post-load focus logic.                                           | Medium   |
| R3   | Yes                        | `build/verification/browser/fixtures.ts:509` is still `content: ['Documents']`, with only Monaco and `.collectionView` styles.                                                                                                                  | Medium   |
| R4   | Not established            | Unchanged: Tree replacement is triggered only from outside the Tree.                                                                                                                                                                            | Low      |
| R5   | Yes, Low                   | `TypedValueCell.tsx:84–92` still puts the description tooltip on an inner span.                                                                                                                                                                 | Low      |

**R1 pros and cons, made explicit:**

- (a) Own-property test in `saveDocument`. Pro: about 3 lines; fixes every entry point and keeps
  K2. Con: touches the Document View save path, which this PR otherwise leaves alone, so it needs
  its own small test.
- (b) Withhold Edit for falsy IDs. Pro: no change outside the grid. Con: reverses accepted K2, and
  the latent save bug stays for other entry points.
- (c) Use `undefined` instead of `''` in `upsertDocument`. Pro: removes the TODO sentinel. Con:
  wider API change, not needed to fix the bug.
- (d) Won't fix. Con: silent duplicate document while reporting success. Not acceptable for data
  integrity.

**Recommendation unchanged: (a).** It is the smallest correct fix.

**R2 pros and cons:** (a) root `_id` cell. Pro: one `setActivePosition` call after the matching
page is applied; always in bounds. Con: column position is lost. (b) keep the column index. Pro:
less movement. Con: an extra bounds branch, and the focused column then means something else. (c)
won't fix. Con: breaks the documented Enter → arrows journey. **Recommendation unchanged: (a).**

**R3 pros and cons:** (a) restore the row texts and add one `[role="grid"]` style entry. Pro: a
couple of lines; restores the baseline guarantee. Con: none material. (c) won't fix. Con: the
packaged smoke test cannot catch an empty grid. **Recommendation: (a); skip (b) unless trivially
cheap.**

### Simplicity pass

Question: did the migration add more structure than it needs? Overall, **no major
over-engineering in product code.** The shapers (`toTablePage`, `toTreeNodes`,
`documentIdentity`) are small and each check has a reason. The excess is concentrated in
`CollectionView.tsx`, where defensive guards and copy-paste have accumulated. The verification
infrastructure is large but declarative and proportionate.

#### S1 — Low/Medium: stale-reply guards in `CollectionView.tsx` overlap

**Evidence:** four refs, `dataRequestRef`, `cachedQueryRef`, `tablePageQueryRef` and
`tablePageRequestRef` (`CollectionView.tsx:169–172`), plus a per-effect `cancelled` flag
(`:458,545`). `isCurrentRequest` (`:342–347`) re-checks query, view and path; the Table `then`
also re-checks `result.path` (`:354`); `isCurrentTablePage` (`:176–186`) checks six conditions.
Every trigger already bumps `dataRequestRef`: query change (effect start `:460` and cleanup
`:545`), view switch (`getDataForView` from `:574`), and path change (`:551`). So:

- `tablePageQueryRef === activeQuery` is implied by `tablePageRequestRef === dataRequestRef`.
- `isCurrentRequest`'s query, view and path checks and the `result.path` check are implied by
  `request === dataRequestRef.current`.

**Options:**

- (a) Remove `tablePageQueryRef` and reduce `isCurrentRequest` to the counter check. Keep
  `cachedQueryRef`, `cancelled`, and the path comparison in `isCurrentTablePage`, which covers the
  render between a path change and its effect. Pro: one fewer ref and about 12 fewer lines; one
  rule to explain ("a reply is current if its request number is the latest"). Con: touches race
  code; relies on the existing late-query, late-delete and step-in scenarios to prove nothing
  regressed.
- (b) Won't fix. Pro: zero risk now; the guards are correct, only redundant. Con: future
  maintainers must keep five overlapping invariants in sync.

**Recommendation:** (a) as a small follow-up commit in this PR if R2 is being changed in the same
file anyway; otherwise (b) is acceptable.

#### S2 — Low: duplicated selection → targets → commands logic

**Evidence:** the pair `isCurrentTablePage(...)` + `resolveDocumentTargets(...)` appears five times
(`handleSelectedRowKeysChange`, delete twice, view, edit). The four-flag `commands` block is
duplicated (`:199–204` and the delete `then`). `handleViewDocumentRequest` and
`handleEditDocumentRequest` are identical except for the RPC.

**Options:**

- (a) One `getSelectedTargets(context)` helper, one `commandsFor(targets)` helper, and one
  `openSelectedDocument(rpc)` for View and Edit. Pro: about 40 fewer lines; the
  enable-buttons rule lives in one place. Con: a small mechanical refactor.
- (b) Won't fix. Con: the next change to the enable rules must be made in two places.

**Recommendation:** (a). It is mechanical, low risk, and covered by the WI-7 action-guard
scenarios.

#### S3 — Low: redundant guards in step-in

**Evidence:** `handleStepInRequest` (`CollectionView.tsx:702–713`) checks
`columnKey === ROOT_ID_COLUMN_KEY`, which is equivalent to `field === undefined` via
`fieldFromColumnKey`. `field === '_id'` cannot occur because `toTablePage.ts:37,66` never emits
an `_id` field column, and `page.columns.some(...)` re-checks a key that came from the page.
`onCellDoubleClick` (`DataViewPanelTable.tsx:157–160`) looks the column up only to narrow its
type. The guards that matter are `isCurrentTablePage`, `field !== undefined` (which also rejects
the root `_id` column), and `type === 'object'`.

**Options:** (a) keep those three guards and delete the rest. Pro: readable intent, about 6
fewer lines. Con: none. (b) Won't fix. **Recommendation:** superseded by the revised S3 options
in [S3–S4 provenance](#s3s4-provenance-isrootid-and-nested-_id-operator-request), which keep
`field === '_id'` as the documented O1 rule.

#### S4 — Low: dead `isRootId` prop

**Evidence:** `DataViewPanelTable` passes `isRootId` to `TypedValueCell`, which declares it
(`TypedValueCell.tsx:68`) but destructures only `value` (`:71`). `TableColumn.isRootId`
(`types.ts:29`) duplicates `key === ROOT_ID_COLUMN_KEY`; its only other reader is the S3 guard.

**Options:** (a) remove the prop and the field. Pro: one fewer concept in the wire type. Con:
touches `toTablePage` tests. (b) Remove only the unused prop. **Recommendation:** (a) if S3 is
done, otherwise (b).

#### S3–S4 provenance: `isRootId` and nested `_id` (operator request)

The operator asked whether `isRootId` is old code that handled embedded objects with fields
called `_id`.

- **`isRootId` is new and has no embedded-`_id` role.** It first appears in the WI-1 interface
  sketch (`02-rdg-execution-plan.md:414`) and the WI-1c spec (`373373a0`), and then in
  `b415822b` (types) and `80200fc6` (shaper). The spec intended it as a cell-component prop
  (`02-rdg-execution-plan.md:447`: "the cell component's props (`value: GridCellValue |
undefined`, `isRootId`)"). WI-6 (`bf2686fd`) created `TypedValueCell` with the prop but never
  read it; its tests pass only `isRootId={false}`. A future `_id` column pin
  (`frozen: 'start'`, `grid-scorecard.md:368`) can use `column.key === ROOT_ID_COLUMN_KEY`.
- **The embedded-`_id` handling is old, and it is a different mechanism.** Since the initial
  import (`43015bbc`, 2025-05-16, inherited from vscode-cosmosdb), the baseline shaper skipped
  `_id` at every nesting level with the comment `// _id has been processed already`
  (`git show 8f81840d:src/utils/slickgrid/mongo/toSlickGridTable.ts`). The flat row used the key
  `_id` for the root ID cell, so a nested `_id` would have overwritten it. The migration's
  `root:_id` / `field:<name>` keys (`types.ts:13–24`) remove that collision. O1
  (`decisions.md:107`) then kept the nested `_id` hidden for parity (`toTablePage.ts:37,66`),
  and `design.md:51` documents that step-in rejects "`_id` fields".
- **Verdict on the hypothesis:** correct for the column-key split and the `_id` filter in
  `toTablePage`; not correct for `isRootId`.

**Revised S3 options:**

- (a) Keep `isCurrentTablePage`, `field === undefined` (which already rejects the root column,
  because `fieldFromColumnKey('root:_id')` is `undefined`), `field === '_id'` with a one-line
  comment pointing to O1, and the object-type check. Remove `columnKey === ROOT_ID_COLUMN_KEY`
  and the `page.columns.some(...)` scan; the row's cell lookup already requires a column from
  this page. Pro: keeps the documented O1 rule at the gesture boundary for one token, and needs
  no doc change. Con: `field === '_id'` is unreachable today.
- (b) Also drop `field === '_id'` and update `design.md:51`. Pro: one more line gone. Con: the
  O1 rule then lives only in the shaper.
- (c) Won't fix.

**Recommendation:** S3 (a); S4 (a) unchanged.

**Author decision and rationale:** **Approved (operator): S3 revised (a) and S4 (a).**

#### S5 — Low: Escape handler inlined in JSX

**Evidence:** a 40-line `onKeyDown` lambda inside the render tree (`CollectionView.tsx:889–923`).
**Options:** (a) move it unchanged into a named `handleResultsKeyDown`. Pro: the render tree
reads as layout again. Con: none. (b) Won't fix. **Recommendation:** (a), opportunistically.

#### S6 — Checked, keep: identity and column-key design

- `toDocumentId` layers a type exclusion, `isSafeIdentityValue`, and an EJSON round-trip
  (`documentIdentity.ts:15–58`). Each layer has a reason. The `$`-key rejection stops an `_id`
  such as `{ $gt: … }` from becoming an operator in the action filter. The round-trip withholds
  IDs that relaxed parsing would change, such as Long. **Won't fix.**
- `root:_id` / `field:<name>` column keys and `getCell`'s own-property read (`types.ts:13–24,61`)
  keep user field names such as `__proto__` or the old `x-objectid` from colliding with grid
  keys. This replaces the baseline's documented collision TODO. **Won't fix.**

#### S7 — Checked, keep with a caveat: `useTreeRows` state reset

**Evidence:** `useTreeRows.ts:72–94` stores `{ nodes, expandedKeys }` and resets during render
when `nodes` changes (React's "adjust state on prop change" pattern), then repeats the identity
check in `setExpanded`. A remount with a per-load `key` would be shorter, but it also resets
scroll and RDG state, and needs a load counter threaded from `CollectionView`. **Won't fix**: the
logic is contained and unit-tested (`useTreeRows.test.ts`).

Also duplicated, and kept: the focus-syncing `Cell` override exists in both Table and Tree
(`DataViewPanelTable.tsx:166–178`, `DataViewPanelTree.tsx:118–129`). Two copies of about 10
lines with different extra props; a shared helper would need parameters and cost more than it
saves. **Won't fix**, but both comments should explain the same RDG Tab-exit reason.

#### S8 — Checked, keep: verification infrastructure

**Evidence:** `scenarios.ts` grows from 3,422 to 4,926 lines; `collectionViewFixtures.ts` is 741
new lines. Despite the size, the scenarios are declarative data, not bespoke code. Only three
assertion kinds are new (`focused`, `style`, `countAtMost`), and each is reused (`countAtMost` 4
times, the others many). The grid-navigation generator (`scenarios.ts:311–438`) has three call
sites (Table, Tree, 500-row) and keeps Table and Tree keyboard contracts in parity. The fixture
datasets are deliberately hand-written for BSON, identity and nesting edge cases; the 500-row
page is already generated. The meta-tests guard against silently skipped scenarios and missing
themes. No dead code was found.

**Options:** (a) later, move the Collection View contracts out of `scenarios.ts` into their own
module for navigability (no behavior change). (b) Won't fix. **Recommendation:** (b) for this
PR; (a) only if the file keeps growing.

### Simplicity summary

| Item | Severity   | Recommendation                        | Est. lines saved |
| ---- | ---------- | ------------------------------------- | ---------------- |
| S1   | Low/Medium | (a) if R2 lands in this file, else WF | ~12              |
| S2   | Low        | (a) do now                            | ~40              |
| S3   | Low        | revised (a) with S2, keep `_id` rule  | ~5               |
| S4   | Low        | (a) with S3, else (b)                 | ~5               |
| S5   | Low        | (a) opportunistic                     | 0 (readability)  |
| S6   | n/a        | Won't fix (justified)                 | —                |
| S7   | n/a        | Won't fix (contained)                 | —                |
| S8   | n/a        | Won't fix (proportionate)             | —                |

S1–S5 are behavior-preserving and together are well under 100 lines; none of them blocks the
PR. They are covered by existing WI-7, WI-8 and late-reply browser scenarios plus the unit tests.

## R1 deep dive: object `_id` field order and the comparator question

Moved to a dedicated file at the operator's request:
[Object `_id` field order and document identity](./04-object-id-field-order.md). In short:

- **R6 (Medium, pre-existing):** an object `_id` with an integer-like key, at any depth, is read
  back in a different key order, so View, Edit, Delete and Save can target nothing or the wrong
  document. Approved (a): #1142 withholds the actions. Follow-up
  [#1144](https://github.com/microsoft/vscode-documentdb/issues/1144) explains the reason to the
  user and links to a manual page.
- **R7 (High, pre-existing, outside #1142):** Document View changes numeric BSON types on save.
  Approved (a): filed as [#1145](https://github.com/microsoft/vscode-documentdb/issues/1145).
- **Comparator:** rejected; the order is lost before any client comparison runs.

## Author decisions

Items the operator did not address individually take the reviewer recommendation, as the
operator instructed.

| Item | Decision                                                                                              | Status                 |
| ---- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| R1   | (a) own-property `_id` in `saveDocument`                                                              | Approved (operator)    |
| R2   | (a) focus the root `_id` cell of the same row; reply on the deletion part                             | Approved (recommended) |
| R3   | (a) packaged L2 requires Collection View results                                                      | Approved (recommended) |
| R4   | (a) no code change; reply with the trigger analysis                                                   | Approved (operator)    |
| R5   | Remove the tooltip; announce "type value"                                                             | Approved (operator)    |
| R6   | (a) withhold actions for multi-key object `_id`s with integer-like keys; follow-up #1144 explains why | Approved (operator)    |
| R7   | (a) separate issue #1145; no change in #1142                                                          | Approved (operator)    |
| S1   | (a) collapse the stale-reply guards (R2 lands in the same file)                                       | Approved (recommended) |
| S2   | (a) one selection → targets helper                                                                    | Approved (recommended) |
| S3   | Revised (a): keep the `_id` rule with an O1 comment, drop the rest                                    | Approved (operator)    |
| S4   | (a) remove `isRootId` from the wire type, the cell props and the tests                                | Approved (operator)    |
| S5   | (a) extract the Escape handler                                                                        | Approved (recommended) |
| S6–8 | Won't fix                                                                                             | Approved (recommended) |

**Suggested sequence:** R1 + R6 together (identity and save, data integrity) → R2 with S1–S5 in
the same file as one cleanup commit → R5 → R3 (verification truthfulness) → R4 and R2-deletion
thread replies. R7 (#1145) and the R6 follow-up (#1144) are tracked outside #1142. Case 2 checks
stay with the separate handover work.

## Boundaries and remaining evidence

- Canonical IDs, projection provenance, page-local duplicate withholding, current-page action
  guards, and ID-based late-delete subtraction were inspected. No additional new wrong-target
  deletion defect was established. The late-delete scenario covers a changed selection, and
  late-query covers a delayed nested-page reply—not every query/delete interleaving.
- The shared host cache's unversioned assignment after an awaited find
  (`src/documentdb/ClusterSession.ts:296–311`) is pre-existing. Client reply guards alone do not
  establish end-to-end isolation from overlapping host queries; that race was not reproduced here.
- Tree Enter/arrow/Tab/Escape handling, hierarchy attributes, stable gutter and virtualization,
  localized strings, exact dependency pin, and host/other-view bundle exclusion checks were
  inspected without establishing another material regression. Actual announcements, Windows
  contrast themes, resize stability, and packaged interaction/runtime behavior remain unverified.
- Accepted exclusions remain: cell ranges, Tree selection, cross-page/shard uniqueness mitigation,
  and the documented RDG-default/deferred accessibility work. Case 2 localization generation,
  formatting and the full handover checks are known outstanding, not independent findings.

## Review progress

- [GitHub Copilot review](https://github.com/microsoft/vscode-documentdb/pull/1142#pullrequestreview-6087706856)
  was submitted on `4b222421`; its three inline comments are merged above (R2, R4 and R5).
- Independent fresh-context validation and sweep (steps 3–4): done on `4b222421`. R1–R3 are
  valid; R4 is not established; R5 is a Low gap; no new material regression was found. No
  runtime reproduction; reviewer vendor relative to the initial reviewer was not recorded.
- Second pass (re-validation at `3cff9df9` and simplicity review): done. R1–R5 assessments are
  unchanged; S1–S5 add small optional cleanups, and S6–S8 record checked won't-fix items. Source
  only; no build, tests or browser run.
- R1 deep dive and S3–S4 provenance (operator request): done. Offline `bson` 7.2.0 experiment,
  source trace and history search; no server run. Adds R6 (Medium, pre-existing) and R7 (High,
  pre-existing, outside #1142), rejects an order-insensitive comparator, and revises S3. The deep
  dive now lives in [04-object-id-field-order.md](./04-object-id-field-order.md).
- Author decisions / G3a: all items decided on 2026-11-27 and recorded in
  [decisions.md](../decisions.md) (0004 and 0005). R7 and the R6 follow-up are filed as #1145 and
  #1144. G3a is _not released_: the approved changes are not implemented yet.
- Case 1 draft stage: this was a review-file-only task with execution explicitly excluded.
  Full Case 2 checks, including `prettier-fix`, are deferred until ready-for-review handover.

## Implementation and evidence follow-up

These notes append earned results without changing the original findings or decisions. Full
commands, timings, failures, and retries remain in the
[review-fix plan](./05-review-fixes-plan.md).

| Item  | Implementation and earned evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | Item 1, commit `8cc23e15`: owned falsy `_id` values now retain their identity through save; only an absent `_id` takes the Add sentinel. The four falsy cases are covered by mocked save/filter integration. Failing first: 7 failures, 69 passes; after fix: 76/76 and build. This is not live-server evidence and does not claim numeric BSON-type preservation on save.                                                                                                    |
| R6    | Item 1, commit `8cc23e15`: the exact conservative multi-key integer-like-key object guard is recursive, including objects inside arrays, while array indexes, displayed values, and positional browsing/selection are retained. A row with an unsafe identity has no `documentId`. The item-1 76/76 suite and build cover the guard; no comparator or raw-BSON transport was added.                                                                                           |
| R2    | Item 3, commit `9eb782bd`: keyboard step-in restores focus once after the matching current Table page to the same `rowKey`'s root `_id` column (0), without selecting it; outside focus, failure, supersession, disappearance and unmount cancel. Pointer behavior is unchanged. Failing first: 63/75 passed, 12 new M7 failures; then component 11/11, harness 78/78, build, and 9 source journeys 90/90 with 135 calls and zero errors passed.                              |
| R3    | Item 5, commit `3ac66077`: strict default fixture readiness again requires the Alpha/Beta result rows and a grid with `display: grid`; non-default source presets remain independent. Six regressions failed before the fix; afterward 154/154 tests, build, and 15 source journeys 177/177 with 66 calls and zero errors passed. The fresh packaged normal/broken-CSS proof was pending at that source-evidence point and is recorded below.                                 |
| R5    | Item 4, commit `c09cdb6d`: the full type precedes the value in the focused cell name, the glyph is decorative, the BSON type Tooltip is removed, and missing-field behavior is unchanged. Cell tests 3/3, harness 79/79, build, and 15 source journeys 261/261 with 114 calls and zero errors passed. Exact browser-computed names were `Int32 7` and `Decimal128 12.50`; no BSON hover Tooltip appeared during 544-568 ms observations. NVDA/Narrator speech was not tested. |
| S1-S5 | Item 2, commit `bf7285d3`: the stale-reply and selection/action simplifications, step-in guard cleanup, dead `isRootId` removal, and named Escape handler were implemented with behavior preserved. Focused tests 29/29, harness 146/146, build, and 21 affected source journeys 228/228 with 411 calls and zero errors passed; the multi-attempt/retry provenance is retained in the plan.                                                                                   |
| R4    | No code change. The original trigger analysis remains: Tree replacement begins from controls outside the Tree; it was not established as a regression. The later R2 focus evidence applies only to Table keyboard step-in, not to Tree refresh or Delete focus.                                                                                                                                                                                                               |

**R3 packaged follow-up (2026-11-27).** The fresh packaged L2 reports from
`vscode-documentdb-1.1.1-alpha.0.vsix` at `3429b30f` (SHA-256
`b8599529968b826f965f8fc1dbbd0bbc7b977f62a64a90e8c2b6e5c8ee66faa1`) are authoritative. The normal
Collection View report was verified with empty errors, settled Alpha/Beta result-row markers and
the expected grid `display: grid` with a nonzero layout. The broken-CSS control was verified as an
expected failure and reported only four CSS mismatches: Collection View `display`, Monaco editor
`position`, overflow, and grid `display`. It reported no unrelated, CSP or HTTP errors. Across the
seven persisted reports, all six normal views verified with empty error lists and all recorded
responses were HTTP 200. The Collection `$computeUnicodeHighlights` and Document JSON
`doValidation` worker round trips succeeded. The owned port-18084 server was stopped and shared
Vite port 18080 was left untouched.

This closes R3's packaged positive/negative evidence gap, not the entire handover. That Case 2
static/package checks passed: formatting, localization generation/checking, lint, build, strict
test type-checking and packaging. Its runtime suite had 9,696 passed, one unchanged DNS
port-fixture bind failure and eight pre-existing pending cases. The DNS contract amendment was
not approved at that point; no code or test changed, and an unmodified retest was attempted. Native NVDA/Narrator
announcements, Windows contrast themes and manual G3b checks remain unverified. These results do
not release G3a/G3b, release the feature, or make A11 green.

On 2026-11-28 the operator approved test-only environment-resilience changes. Random
bounded dual-transport port allocation and per-width shell sweep cases passed **500/500**
focused tests and build, without changing production behavior, assertions or timeouts.
The final full Case 2 checks now pass, including the exact strict package-test typecheck,
runtime (**10,063 passed, zero failed, eight unchanged pre-existing skipped cases**) and
packaging. The [review-fix plan](./05-review-fixes-plan.md) records each command separately,
the original failures and the new VSIX hash. This satisfies A11's automated requirement;
native/manual acceptance and G3a/G3b release are still outstanding. #1142 remains draft.
