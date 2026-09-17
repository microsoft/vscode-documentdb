---
feature: managed-identities
kind: review
status: active
prs: [886]
created: 2026-09-17
---

# PR #886 review feedback

**PR:** [microsoft/vscode-documentdb#886](https://github.com/microsoft/vscode-documentdb/pull/886)
**Head at intake:** `dev/tnaum/managed-identities` @ `ff2ca1e0`
**Feedback refreshed:** 2026-09-17

This ledger paraphrases the complete PR feedback while preserving links to the GitHub discussions.
It is updated as each work item is completed. The earlier agent-assisted reviews remain in
[02-code-review.md](02-code-review.md) and [05-code-review.md](05-code-review.md).

## Complete inventory

The GitHub API returned 56 feedback objects:

- 20 standalone PR comments, including 18 author progress notes and 2 automated reports;
- 13 submitted reviews, of which 11 are empty wrappers created when an inline reply was submitted;
- 23 inline comments across 17 discussion roots, including 6 replies.

Three older discussion roots are resolved. Fourteen discussion roots are open. The September
Copilot review is stored by GitHub as `COMMENTED`, not `CHANGES_REQUESTED`, but its text explicitly
says [Changes recommended](https://github.com/microsoft/vscode-documentdb/pull/886#pullrequestreview-5232194282).
It contains nine published findings and one suppressed documentation finding.

### Earlier resolved discussions

| Discussion | Rephrased feedback | Outcome |
| ---------- | ------------------ | ------- |
| [JWT base64url decoding](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r3776144618) | Decode JWT payloads according to the base64url format rather than relying on Node's permissive base64 decoder. | Resolved in `71f54808`; recorded as C1 in iteration 02. |
| [Prerequisite count](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r3776144711) | Make the prose agree with the four-item prerequisite list. | Resolved in `590bc986`; recorded as C2 in iteration 02. |
| [`process.env` restoration](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r3776144772) | Restore environment entries in place so tests do not replace Node's special environment object. | Resolved in `9299a23b`; recorded as C3 in iteration 02. |

The [first Copilot review](https://github.com/microsoft/vscode-documentdb/pull/886#pullrequestreview-4928060812)
is an overview plus those three discussions.

### Standalone PR comments

These are retained here so the inventory includes every one-off comment, even where the durable
technical detail already lives in an earlier review file.

| Comment | Rephrased content |
| ------- | ------------------ |
| [F8 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292786567) | Kept storage at version 3.0 and documented append-only secret slots. |
| [F1 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292834784) | Persisted the managed identity tenant and propagated it to all token surfaces. |
| [F2 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292852588) | Consolidated token acquisition, diagnostics, and credential reuse in the shared provider. |
| [F3 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292870952) | Made explicit managed identity strings work for unrecognized custom hosts. |
| [F5 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292898200) | Removed incomplete recent-managed-identity state and UI. |
| [F4 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292920958) | Split endpoint-unreachable failures from endpoint-absence failures. |
| [F5 documentation follow-up](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292929729) | Removed stale recent-identity guidance. |
| [C2 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292934806) | Corrected the prerequisite count. |
| [C3 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292943641) | Restored test environment variables without replacing `process.env`. |
| [C1 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292952449) | Made JWT base64url decoding explicit and tested URL-safe characters. |
| [F6 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292966624) | Documented the compatibility impact of preferring persisted authentication methods. |
| [F7 resolution](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5292993104) | Verified preview-version packaging and retained the temporary preview marker at that stage. |
| [F1 lint follow-up](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5293076294) | Replaced raw authentication strings with enum members in worker routing. |
| [F4 localization follow-up](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5293076551) | Regenerated localization for endpoint-unreachable guidance. |
| [F5 localization follow-up](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5293076825) | Removed obsolete recent-identity localization entries. |
| [Validation report](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5293084574) | Reported the then-current full local verification results. |
| [Storage follow-up issue](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5293421374) | Linked issue #887 for future-version tolerant storage reads. |
| [User-testing status](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5295992092) | Marked the feature as being in user testing. |
| [Code-quality report](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5710248081) | Automated localization, lint, and formatting checks passed. |
| [Build-size report](https://github.com/microsoft/vscode-documentdb/pull/886#issuecomment-5710292018) | Automated packaging reported a 304 KB VSIX increase and no webview-bundle change. |

## Current feedback

| ID | Discussion | Rephrased feedback | Initial disposition |
| -- | ---------- | ------------------ | ------------------- |
| N1 | [Connection-string inference](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003656) | Treat `ENVIRONMENT:azure` as managed identity only when OIDC is also present, and make the compound predicate readable. | Fix; high confidence. |
| N2 | [Authentication identity casing](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003712) | Compare GUID tenant and client IDs case-insensitively so casing alone cannot bypass duplicate detection. | Fix; high confidence. |
| N3 | [Failure telemetry result](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003766) | A recovered failure callback currently looks successful. Verify the telemetry library's finalization order, determine whether this is a wider pattern, and explain the result before changing it. | Analyze first; no speculative change. |
| N4 | [Credential construction race](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003824) | Concurrent first requests can create duplicate credentials after the dynamic import. Make cache initialization atomic or recheck after the await. | Fix; high confidence. |
| N5 | [Manual registration expectation](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003880) | The checklist should expect a generic cluster authentication rejection because registration failures are not translated locally. | Fix; high confidence. |
| N6 | [User-guide diagnostic guarantee](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003927) | Do not promise that every missing prerequisite receives a specific diagnostic when unregistered identities surface a generic server error. | Fix; high confidence. |
| N7 | [Playground localization](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034003967) | Localize the managed identity configuration error returned to the Playground worker. | Fix; high confidence. |
| N8 | [Shell nested ternary](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034004008) | Replace the three-way nested authentication-label ternary with explicit control flow. | Fix; high confidence. |
| N9 | [Shell localization](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4034004043) | Localize the managed identity configuration error returned to the shell worker. | Fix; high confidence. |
| N10 | [Validation claim](https://github.com/microsoft/vscode-documentdb/pull/886#pullrequestreview-5232194282) | The guide says Azure VM testing is complete while the PR and feature status say it is pending. Keep the supported-platform statement but describe validation accurately. | Fix; high confidence. |
| N11 | [`EntraIdAuthConfig` naming](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4036232629) | Reassess whether the type name still describes account-based Entra authentication now that managed identity is also under the Entra family; do not change stored values. | Analyze before renaming. |
| N12 | [Shell Entra terminology](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4036261410) | Reassess labels that use "Entra ID" as shorthand for account sign-in even though managed identity also uses Entra ID. | Analyze and fix precise labels only. |
| N13 | [Atlas wizard routing](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4036288360) | Atlas does not support Entra ID or managed identity, so confirm whether this identity-source step should exist in that wizard. | Analyze current `shouldPrompt` behavior first. |
| N14 | [Kubernetes wizard routing](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4036301108) | As with Atlas, confirm whether the identity-source step is unreachable or should be removed. | Analyze current `shouldPrompt` behavior first. |
| N15 | [Saved-secret helper](https://github.com/microsoft/vscode-documentdb/pull/886#discussion_r4036325170) | Explain why a helper is preferable to inlining its only call site; do not change the code. | Analysis and answer only. |

## Work items

### W1 - Authentication correctness

Scope: N1, N2, and N4. Add focused regression coverage for the non-OIDC environment marker,
case-insensitive GUID identity, and concurrent credential initialization.

**Status:** Completed in
[`e700683b`](https://github.com/microsoft/vscode-documentdb/commit/e700683b).

The connection-string prompt now requires OIDC, `ENVIRONMENT:azure`, and a usable identity selector
before choosing managed identity; the named predicate requirements also make the decision readable.
Duplicate keys lowercase tenant and client GUIDs because hexadecimal casing is not identity. The
credential provider rechecks its cache after the dynamic import, so the first resumed continuation
stores the credential and concurrent continuations reuse it instead of constructing duplicates.

Focused tests cover the non-OIDC marker, both GUID discriminators, and simultaneous first token
requests. `npm run build` and all three focused suites pass (3 suites, 7 tests).

### W2 - Telemetry semantics

Scope: N3. Trace `callWithTelemetryAndErrorHandling` through the installed library and the local
telemetry skill. Change code only if the result override is proven stable; file a repository issue
if the problem affects other non-throwing failure events or the skill guidance.

**Status:** Completed in
[`c5151cd1`](https://github.com/microsoft/vscode-documentdb/commit/c5151cd1).

The installed `@microsoft/vscode-azext-utils` implementation initializes `result` to `Succeeded`,
awaits the callback, changes the result automatically only when the callback throws, and emits the
same context from `finally`. `handleTelemetry` does not restore `Succeeded`, so a callback-assigned
`Failed` value is stable and is the intended representation of a recovered, non-throwing failure.

The repository telemetry skill already documents this exact exception. Existing discovery and
Kubernetes paths also assign `Failed` before returning recovery UI, so there is no wider library,
codebase-pattern, or skill defect to track. No issue was filed. The managed identity event now sets
`result = 'Failed'`, its focused test asserts the value, and both that test and `npm run build` pass.

### W3 - User-facing accuracy and localization

Scope: N5-N10. Align documentation with implemented diagnostics, localize worker-facing errors, and
replace the nested shell label expression with explicit control flow. Regenerate localization after
the source strings are settled.

**Status:** Planned.

### W4 - Authentication terminology and wizard routing

Scope: N11-N14. Separate the broad Microsoft Entra ID family label from the narrower interactive
account method in code and UI, then verify whether Atlas and Kubernetes can reach the identity
picker after the existing `shouldPrompt` gate.

**Status:** Analysis in progress.

### W5 - Saved-secret helper rationale

Scope: N15. Explain the existing helper boundary without modifying it.

**Status:** Analysis in progress.

## Outcome

In progress. Final verification and any findings below 80 percent confidence will be recorded here.