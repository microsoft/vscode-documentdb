---
feature: copy-paste-collections
kind: review
status: active
prs: [848]
created: 2026-09-17
code:
    - src/commands/pasteCollection/**
    - src/documentdb/ClustersClient.ts
    - src/services/taskService/data-api/indexes/**
    - src/services/taskService/tasks/copy-and-paste/**
---

# PR feedback review - copy secondary indexes (PR #848)

**PR:** [#848](https://github.com/microsoft/vscode-documentdb/pull/848), base `main`.
**Feedback captured:** 2026-09-17 after the requested-changes review.

This file paraphrases the feedback while preserving links to the original discussions. Empty review
records created as containers for inline comments are represented by their linked discussions rather
than duplicated as separate feedback.

## Feedback summary

| ID  | Essential feedback                                                                                                                                                                                                                                                                                                  | Decision                                                                                | Confidence | Status                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------- |
| F1  | Cancellation must cover index client acquisition and catalog reads, and an abort must remain cancellation rather than an index-copy failure. First inspect the repository's existing connection-cancellation approach. After the fix is pushed, open an issue to revisit cancellable connection attempts generally. | Implement and add focused cancellation tests.                                           | 90%        | Completed in `e02d58b3`; follow-up issue pending. |
| F2  | Source index-summary failures must stop the wizard early and explain why; continuing with an unknown count is incorrect.                                                                                                                                                                                            | Restore fail-fast behavior and align user-facing documentation.                         | 95%        | Completed in `60c56ac0`.                          |
| F3  | The feature design document names an older method. Feature intent documents are allowed to lag implementation and should not shadow-track APIs under CONTRIBUTING section 5.4.                                                                                                                                      | No code or document change; record and explain the decision in the thread.              | 95%        | Completed without code changes.                   |
| F4  | The implementation README's current contract snippet is stale.                                                                                                                                                                                                                                                      | Update the implementation-oriented README because it explicitly describes current code. | 99%        | Completed in `60c56ac0`.                          |
| F5  | Authentication and credential-update telemetry is unrelated to index copying and was included accidentally.                                                                                                                                                                                                         | Remove all remaining auth telemetry changes and their dedicated tests.                  | 99%        | Completed in `495c22d2` and `ef89f674`.           |
| F6  | The reviewer requested changes and specifically asked that all unrelated telemetry be reverted because auth telemetry belongs in another PR.                                                                                                                                                                        | Satisfied by F5, then request re-review after all discussions are addressed.            | 99%        | Telemetry removal completed; re-review pending.   |

## Discussion references

### F1 - cancellation during client and catalog loading

- [Copilot finding](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4033983361)
- [Maintainer decision](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035695532)

### F2 - index-summary failures must abort

- [Copilot finding](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4033983412)
- [Maintainer decision](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035706364)

### F3 - feature design documents do not mirror APIs

- [Copilot finding](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4033983452)
- [Maintainer decision](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035714152)
- The Copilot review also contains a suppressed duplicate about the sequence diagram.

### F4 - implementation README contract

- [Copilot finding](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4033983499)
- [Maintainer acknowledgement](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035716816)

### F5 - unrelated authentication telemetry

- [Scope finding in `DocumentDBClusterItem`](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4033983526)
- [Maintainer investigation note](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035724636)
- [Remove new-connection prompt telemetry](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035875651) - addressed in `495c22d2`
- [Remove new-connection execution telemetry](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035877524) - addressed in `495c22d2`
- [Remove update-credentials auth-method telemetry](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035933099)
- [Remove update-credentials reconnect telemetry](https://github.com/microsoft/vscode-documentdb/pull/848#discussion_r4035937483)

### F6 - requested changes

- [Requested-changes review](https://github.com/microsoft/vscode-documentdb/pull/848#pullrequestreview-5234562125)

## Other PR comments and reviews

- [Initial maintainer note](https://github.com/microsoft/vscode-documentdb/pull/848#issuecomment-5302483857): promote the quick index-copy work into a reviewed feature.
- [Copilot review](https://github.com/microsoft/vscode-documentdb/pull/848#pullrequestreview-5232168605): changes recommended; its five published findings and one suppressed duplicate are represented by F1-F5.
- [Code-quality automation](https://github.com/microsoft/vscode-documentdb/pull/848#issuecomment-5710207263): localization, ESLint, and Prettier passed on the last CI update.
- [Build-size automation](https://github.com/microsoft/vscode-documentdb/pull/848#issuecomment-5710266570): VSIX increased by 3 KB and the webview bundle was unchanged.

## Work-item record

Each completed item will record what changed, why, focused verification, the implementation commit,
and the corresponding GitHub response.

### Work item 1 - remove unrelated authentication telemetry

Completed in [`ef89f674`](https://github.com/microsoft/vscode-documentdb/commit/ef89f674995d429af3b598a34afdd196a670619d),
following the earlier new-connection cleanup in
[`495c22d2`](https://github.com/microsoft/vscode-documentdb/commit/495c22d2).

Removed the remaining telemetry writes from the connection, authentication, and
update-credentials flows, along with the tests that existed only for those writes. This keeps PR
#848 focused on collection index copying; the auth behavior itself is unchanged and can be
instrumented in its dedicated PR.

Focused verification:

- `npx jest --no-coverage src/commands/updateCredentials/PromptReconnectStepForErrorNodes.test.ts`
  - passed: 1 suite, 7 tests
- The auth-related working-tree diff against `origin/main` is empty.

### Work item 2 - fail fast when index summary loading fails

Completed in [`60c56ac0`](https://github.com/microsoft/vscode-documentdb/commit/60c56ac04ef52760d4a5656717202b86abbe0d46).

`CountSourceIndexesStep` now records and logs the bounded failure as before, then throws an error
that includes the underlying reason. The wizard's existing error handler shows that reason and
aborts before confirmation. The user guide now describes the fail-fast behavior, and the
implementation README uses the current `getSourceIndexSummary` contract. The intent-level design
document and historical review were deliberately left unchanged.

Focused verification:

- `npx jest --no-coverage src/commands/pasteCollection/CountSourceIndexesStep.test.ts`
  - passed: 1 suite, 4 tests
- `npm run build` - passed
- Prettier check for the four touched files - passed

### Work item 3 - preserve the intent-level design document

The no-change decision was first recorded in
[`f4d89e2d`](https://github.com/microsoft/vscode-documentdb/commit/f4d89e2d68dcb215b59684a49f346dbb202bb3dc).

CONTRIBUTING section 5.4 says feature `README.md` and `design.md` files record intent rather than
exact behavior and are updated when a decision, constraint, or intended design changes, or when a
known statement becomes materially misleading. The copier boundary and flow are unchanged here;
renaming the method in this document would shadow-track an implementation detail. The
implementation-oriented indexes README was corrected in work item 2 instead.

### Work item 4 - cancel index client and catalog loading

Completed in [`e02d58b3`](https://github.com/microsoft/vscode-documentdb/commit/e02d58b3a810e90b5486fb375cb17f50447afc14).

`ClustersClient.getClient` already accepts an `AbortSignal`; during connection or reconnection it
closes the pending `MongoClient` and rejects with `UserCancelledError`. The index copier now passes
the task signal to both source and target client acquisition and to both catalog waits. If either
path rejects after the task is stopped, `CopyPasteCollectionTask` rethrows the cancellation without
setting `indexCopyFailed` or wrapping it as a copy failure.

Focused verification:

- Index copier and copy/paste task suites - passed: 2 suites, 20 tests
- `src/documentdb/ClustersClient.test.ts` - passed: 1 suite, 1 test
- `npm run build` - passed
