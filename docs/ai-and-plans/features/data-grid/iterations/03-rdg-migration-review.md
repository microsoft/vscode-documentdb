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

**Author decision and rationale:** _Pending._

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

**Author decision and rationale:** _Pending._

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

**Author decision and rationale:** _Pending._

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

**Author decision and rationale:** _Pending._

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

**Author decision and rationale:** _Pending._

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

## Ready for author decisions (pending)

| Item | Decision needed                                                       | Reviewer recommendation                  | Status  |
| ---- | --------------------------------------------------------------------- | ---------------------------------------- | ------- |
| R1   | How falsy-ID saves preserve identity                                  | (a) own-property `_id` in `saveDocument` | Pending |
| R2   | Focus target after keyboard step-in; reply to deletion part of thread | (a) root `_id` cell of same row          | Pending |
| R3   | Packaged L2 Collection View result expectations                       | (a), plus (b) if cheap                   | Pending |
| R4   | Reply to Copilot thread without code change                           | (a) no change                            | Pending |
| R5   | Accessible type name on focused cells versus D8 acceptance            | (a) or explicit (c)                      | Pending |

**Suggested sequence:** R1 (data integrity) → R2 (documented keyboard journey) → R3
(verification truthfulness) → R5 decision → R4 and the R2-deletion thread replies. Case 2
checks stay with the separate handover work.

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
- Author decisions / G3a: _Pending; not released._
- Case 1 draft stage: this was a review-file-only task with execution explicitly excluded.
  Full Case 2 checks, including `prettier-fix`, are deferred until ready-for-review handover.
