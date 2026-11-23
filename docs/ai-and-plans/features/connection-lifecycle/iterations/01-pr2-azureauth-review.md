---
feature: connection-lifecycle
kind: review
status: active
created: 2026-11-20
---

# PR2 pre-review: Azure Discovery and azureauth v6

Reviewed [PR #1111](https://github.com/microsoft/vscode-documentdb/pull/1111), comparing
`8e5eda461` with `d6c4efc55`. GPT-6.2-Sol performed the initial review; Claude Opus 5.5 validated
the findings. The operator approved native SDK challenge handling and partial subscription
results with sanitized warnings. Neither decision is reopened here.

| Finding                                                                      | Validation                                                                                                                                       | Technical recommendation                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh can leave a root on Retry.                                           | Existing behavior (95% confidence). An explicit Retry clears the failed child cache; Refresh did not clear it before the upgrade either.         | Do not change the tree recovery contract in WI-3.                                                                                         |
| Another caller can consume the one-shot freshness request.                   | Confirmed, non-blocking (80%). The fresh listing refills the cache before filtering; an overlapping tree listing can still return old results.   | Observe explicit Refresh in OP-2. Keep the existing design unless the race reproduces.                                                    |
| SDK event suppression can hide a newly signed-in account.                    | WI-3 regression (90%). The SDK can suppress its cache invalidation event. A subsequent listing can miss an account that VS Code now knows about. | Read the local VS Code account inventory on each listing, while keeping tenant and subscription caches. Retain the cloud-change listener. |
| An account error can stop the filter wizard before it shows partial results. | Existing behavior (85%). The previous tenant enumeration also stopped on errors other than missing sign-in.                                      | Keep the existing wizard contract; record any live failure in OP-2.                                                                       |

## Verification before the cache follow-up

Build, lint, test type-check, localization and formatting passed after test-only lint repairs.
The first full run timed out in an unchanged Fluent UI test; a focused rerun and the subsequent
full run passed (9,682 tests passed, one skipped). The VSIX built, passed inspection, and the
inspection rejected all 24 negative controls. Local L3 activation could not start because this
Linux host lacks Electron's GUI libraries. OP-2 and the final CP-W3 verdict are still pending.

## Cache follow-up

`423c2e1b7` refreshes the local Azure account inventory even when the SDK suppresses session
events. Tenant and subscription caches remain intact. Added two focused regressions and retained
cloud-invalidation and listener-disposal coverage. The three affected suites (55 tests), root
type-check, and targeted formatting check passed.

**Author sign-off (2026-11-20):** The operator accepted the recorded dispositions: keep the
account-inventory fix, leave the existing Refresh/Retry and filter-wizard behavior unchanged,
and keep the one-shot freshness design unless the overlap race reproduces.

## OP-2 and CP-W3

The operator accepted OP-2 after testing the installed VSIX. Activation, Discovery, filters,
Refresh/Retry, same-account sign-out/sign-in, Azure New Connection discovery, and the Azure
Resources RU and vCore/DocumentDB nodes worked. Different-account switching, MFA, sovereign
cloud, Update Credentials and workspace-provider checks were not confirmed. The operator
accepted the untested deep-link URLs; partial failures were not reproducible live.

CP-W3 retains L2 (Claude Opus 5.5, 85% confidence). L1 uses the same azureauth and Azure
Resources API versions, so stepping down does not reduce the remaining risk.

## Final review handoff (2026-11-20)

Case 2 verification at `4858e97d0` passed formatting, localization check, build, test
type-check, full Vitest (9,684 passed, one skipped), and VSIX packaging. Lint initially
reported unresolved types in the fresh worktree; it passed when rerun after the workspace
build generated the package declarations. No source changes were needed. Automated VSIX
activation remains unavailable on this host; the operator accepted the manual OP-2 result
and its coverage gaps above.

## Copilot review follow-up

The operator approved all four follow-ups:

- [R1](https://github.com/microsoft/vscode-documentdb/pull/1111#discussion_r4643940342), `8de2a67da`:
  Azure policy and app-registration failures no longer get misclassified as sign-in problems.
  Typed additional-verification codes still report `signInRequired`.
- [R2](https://github.com/microsoft/vscode-documentdb/pull/1111#discussion_r4643940422), `df66e0172`:
  A deep-link cache miss triggers a fresh listing before the extension offers tenant sign-in.
  A successful tenant sign-in still triggers a fresh listing. Native SDK challenges are unchanged.
- [R3](https://github.com/microsoft/vscode-documentdb/pull/1111#discussion_r4643940489), `9805b7e25`:
  A regression test uses the same stored subscription for two ARM operations across expiry.
  Each operation creates its own management client, as production does. With the real SDK
  pipeline and fake transport, the second request uses the fresh token without prompting or
  relisting. Reusing one long-lived management client can send the previous token for an
  additional request; changing that credential adapter is outside this follow-up.
- [R4](https://github.com/microsoft/vscode-documentdb/pull/1111#discussion_r4643940542), `490cf4376`:
  Manage Azure Accounts fetches fresh tenants when loading its inventory. Routine Discovery
  listing and wizard back-navigation keep their existing caching.

Claude Opus 5.5 advised the dispositions (90%, 85%, 80%, and 85% confidence, respectively).
The build and all 109 focused tests passed. The earlier full Case 2 run predates these changes.

## Azure ESM bundle verification

The operator approved removing the obsolete CommonJS alias and replacing its historical
expected-failure test. In `f2b4641e6`, the production host probe verifies that the Azure ARM
subscription and tenant exports are callable and that the bundle uses ESM modules. The probe,
both BSON controls, all 267 verification tests, and inspection of the rebuilt VSIX passed.

Two builds of the new revision had identical VSIX entry contents. Compared with the build
before alias removal, the host chunks kept the same module membership, but some chunk bytes
and names changed. The earlier live OP-2 result therefore does not verify this package.
**OP-2 repeat accepted (2026-11-23):** On the PR2 CI-built VSIX, the operator confirmed
that the Discovery roots loaded, filters and Refresh/Retry worked, signing out and back
in worked, and New Connection and the Azure Resources nodes worked. Update Credentials,
deep links, and partial-result handling were not tested. No separate account-switch,
sovereign-cloud, or MFA result was reported. The operator accepted these coverage gaps
and cleared the gate.
