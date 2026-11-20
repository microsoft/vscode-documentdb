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

The other three findings remain unchanged as recommended above. Author review of those
dispositions and the live OP-2 results are pending.
