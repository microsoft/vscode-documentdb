---
feature: copy-paste-collections
kind: review
status: active
prs: [930]
created: 2026-09-17
verified: 2026-09-17
code:
    - src/commands/copyIndexes/**
    - src/commands/pasteIndexes/**
    - src/documentdb/ClustersClient.ts
    - src/services/CopyPasteBufferService.ts
    - src/services/taskService/data-api/indexes/**
    - src/services/taskService/tasks/copy-indexes/**
    - src/tree/documentdb/IndexItem.ts
---

# Dedicated index copy implementation review (PR #930)

**Reviewed:** `dev/tnaum/copy-indivisual-indexes`, implementation commits `d08e6fd7` through
`dbb73468`, against `origin/main`.
**PR:** [#930](https://github.com/microsoft/vscode-documentdb/pull/930), draft during review.
**Method:** independent Explore-agent sweep, primary-agent validation against owning code and tests,
targeted fixes, then an independent post-fix sweep. PR #930 had no GitHub review threads to merge.

The available agent environment did not expose a second-vendor model selector. The validation gate
was therefore performed as a separate pass with fresh prompts and direct code evidence rather than
claiming a vendor distinction that was not available.

## Findings and decisions

| ID  | Severity         | Finding                                                                                                                  | Validation and decision                                                                                                                                                                                                                                                                                   | Status               |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| F1  | Medium           | Signal-driven copier rejection was recorded as an index-copy failure before the base task transitioned to Stopped.       | Valid. Preserve the cancellation error, record cancellation, and do not set failure classification. This follows existing collection-task behavior; wrapping the error was rejected because it converts cancellation into failure telemetry.                                                              | Fixed in `3751c533`. |
| F2  | Medium           | A parent selection with zero copyable entries showed only `0 of N`, not the required explicit “nothing to copy” outcome. | Valid. Add an explicit no-copyable-index line and retain itemized exclusions. Blocking before confirmation was rejected because the modal is the surface that explains why nothing is copyable.                                                                                                           | Fixed in `f62c17e3`. |
| F3  | Low              | Cross-connection and cross-database telemetry tests covered only `true`.                                                 | Valid test gap. Add the same-connection, same-database branch without changing production code.                                                                                                                                                                                                           | Fixed in `b92bb09f`. |
| F4  | Process          | New localized strings were absent from the generated bundle.                                                             | Valid handoff task, not an implementation defect while the PR remained draft. The repository requires generation once at Case 2; hand-editing the bundle was rejected.                                                                                                                                    | Fixed in `db09112a`. |
| F5  | High (initial)   | Dismissing the copy notification should clear copied state.                                                              | False positive. Copy is complete before the notification appears; only the explicit **Cancel Copy** action clears it. Neutral dismissal keeps the reusable buffer, as decisions 0019 and 0022 require. Treating every non-button result as cancellation would also invert the meaning of the only action. | No change.           |
| F6  | High (initial)   | Hidden-index failure lacked a Show Output action and lost detail.                                                        | False positive. The copier names the created-but-not-hidden index, the dedicated task preserves that text and cause, and `TaskProgressReportingService` adds **Show Output** to every failed task. A task-specific duplicate notification was rejected.                                                   | No change.           |
| F7  | Medium (initial) | Missing-source-collection stale clearing lacked a test.                                                                  | False positive by review time. `LoadSourceIndexesStep.test.ts` and `CopyIndexesTask.test.ts` already cover stale collection clearing and task initialization failure.                                                                                                                                     | No change.           |
| F8  | Low (initial)    | Manual abort-listener removal was redundant with `{ once: true }`.                                                       | False positive. `once` removes a listener only when abort fires; manual removal is required when the operation settles first, otherwise the signal retains the closure until a later abort.                                                                                                               | No change.           |

## Author-decision gate

No new product ruling remained after validation. F1-F3 are direct corrections or tests for the
approved design. F5 and F6 were resolved by existing author decisions 0019 and 0022 and the shared
task notification behavior. F4 is mandated by the repository's handoff gate. There is therefore no
unresolved recommendation requiring an invented author decision.

## Independent post-fix sweep

The post-fix pass verified:

- cancellation remains cancellation through task telemetry and base-task state handling;
- parent and single-index confirmations retain their separate scopes;
- zero-copyable selection is explicit and still explains all known exclusions;
- both true and false cross-location telemetry branches are covered;
- stale cluster, collection, missing-index, and unsupported-index state clears only the index buffer;
- failed tasks retain the shared **Show Output** action;
- target task subscriptions dispose and refresh on Completed, Failed, and Stopped;
- buffer and menu context keys match exactly;
- no unresolved ship-blocking finding remains.

## Residual risks

- Search-index discovery is best-effort by design. Unsupported or transient search-catalog reads can
  under-report exclusions but cannot expand what the ordinary copier creates.
- Two concurrent pastes into one target can race on the same generated name. Decision 0023 accepts
  the visible driver failure and retry rather than adding task serialization.
- The installed driver cannot cancel `collection.indexes()` server-side. Wizard dismissal stops
  awaiting it and discards late results; the search aggregation receives a real abort signal. The
  alternatives and tradeoff are recorded in the design work-item log.

## Focused verification before Case 2

- `CopyIndexesTask.test.ts`: 10 tests passed after review fixes.
- `ConfirmPasteIndexesStep.test.ts`: 6 tests passed after review fixes.
- Dedicated copier, wizard, command, tree, buffer, task, and collection regressions passed in their
  work-item commits.
- `npm run build` passed after every substantive implementation and review-fix commit.

## Case 2 verification

The full handoff gate completed on 2026-09-17:

- `npm run l10n` - passed; extracted 2,354 strings and merged 2,465 keys. The generated bundle was
  committed in `db09112a`.
- `npm run prettier-fix` - passed. Required normalization and standard TypeScript headers were
  committed with lint repairs in `56829249`; the repair rerun changed nothing further.
- `npm run lint` - passed with zero ESLint errors or warnings. Node emitted the existing
  `webpack.config.views.js` `eslint-env` deprecation notice.
- `npx jest --no-coverage` - passed: 253 suites, 3,780 tests, and 4 snapshots. The first full run
  exposed an incomplete `ClustersClient` module mock in `IndexesItem.test.ts`; the focused repair
  passed 13 tests and was committed in `740f6213` before the full rerun passed.
- `npm run build` - passed with no diagnostics.
- `npm run package` - passed; produced `vscode-documentdb-0.10.2.vsix` with 153 files at 12.82 MB.

Packaging reported the existing Express dynamic-dependency warning, webview asset-size
recommendations, and an available `@vscode/vsce` update. No source or tracked generated changes
remain from packaging.

## Post-review workflow correction

UX validation found that right-clicking a multi-selection produced no index context menu because
**Copy Index...** was gated by `!listMultiSelection`. Commit `0a5a717e` applies the established
Move to Folder invocation pattern: plain command registration preserves `(clickedItem,
selectedItems[])`, then index-specific filtering retains copyable `IndexItem` nodes from one source
collection. Expanded field rows, `_id`, and keyless non-copyable entries are ignored; copyable
indexes from another collection are rejected rather than silently omitted.

Focused verification after the correction:

- `npm run prettier-fix` - passed.
- `npm run l10n` - passed; extracted 2,360 strings and merged 2,471 keys.
- `npm run lint` - passed with zero errors and the existing `webpack.config.views.js` deprecation
  notice.
- Seven focused suites passed: 54 tests covering buffer immutability, mixed tree selections,
  manifest gating, subset validation and confirmation, wizard initialization, and task telemetry.
- `npm run build` - passed with no diagnostics.
