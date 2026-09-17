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

| ID  | Essential feedback                                                                                                                                                                                                                                                                                                  | Decision                                                                                | Confidence | Status                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| F1  | Cancellation must cover index client acquisition and catalog reads, and an abort must remain cancellation rather than an index-copy failure. First inspect the repository's existing connection-cancellation approach. After the fix is pushed, open an issue to revisit cancellable connection attempts generally. | Implement and add focused cancellation tests.                                           | 90%        | Planned                                                                        |
| F2  | Source index-summary failures must stop the wizard early and explain why; continuing with an unknown count is incorrect.                                                                                                                                                                                            | Restore fail-fast behavior and align user-facing documentation.                         | 95%        | Planned                                                                        |
| F3  | The feature design document names an older method. Feature intent documents are allowed to lag implementation and should not shadow-track APIs under CONTRIBUTING section 5.4.                                                                                                                                      | No code or document change; record and explain the decision in the thread.              | 95%        | Planned                                                                        |
| F4  | The implementation README's current contract snippet is stale.                                                                                                                                                                                                                                                      | Update the implementation-oriented README because it explicitly describes current code. | 99%        | Planned                                                                        |
| F5  | Authentication and credential-update telemetry is unrelated to index copying and was included accidentally.                                                                                                                                                                                                         | Remove all remaining auth telemetry changes and their dedicated tests.                  | 99%        | In progress; two new-connection comments were already addressed in `495c22d2`. |
| F6  | The reviewer requested changes and specifically asked that all unrelated telemetry be reverted because auth telemetry belongs in another PR.                                                                                                                                                                        | Satisfied by F5, then request re-review after all discussions are addressed.            | 99%        | Planned                                                                        |

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
