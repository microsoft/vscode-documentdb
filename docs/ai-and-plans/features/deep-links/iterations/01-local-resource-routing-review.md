---
feature: deep-links
kind: review
status: historical
prs: [898]
created: 2026-09-01
code:
    - src/vscodeUriHandler.ts
    - src/vscodeUriHandler.test.ts
---

# PR #898 Review - Local resource routing and confirmation

**PR:** [microsoft/vscode-documentdb#898](https://github.com/microsoft/vscode-documentdb/pull/898)
**Reviewed:** 2026-09-01
**Initial reviewer:** Claude Opus 5
**Validation reviewer:** Grok 4.6
**GitHub Copilot comments:** None; the PR was still draft when the review ran.

## Scope

The review covered the changes made in response to maintainer feedback:

- `/local` defaults to the `documentdb` local resource type.
- `/local/documentdb` names that type explicitly.
- Unknown resource types and additional path segments are rejected.
- External local links show one confirmation when URL confirmations are enabled.
- Tests, public documentation, feature decisions, and the setting description match the behavior.

## Findings

### F1 - Medium - New localized strings were absent from the generated bundle

**Status:** Valid

Four new `l10n.t()` strings were not yet present in `l10n/bundle.l10n.json`. Runtime English
fallbacks would work, but the strings would not enter the translation pipeline and the localization
CI check would fail.

**Options considered:**

1. Run `npm run l10n`, using the repository's generator.
2. Insert the keys manually.

**Recommendation:** Run the generator. It is authoritative and avoids mistakes in generated JSON.

**Author decision:** Accepted. The operator explicitly requested cleanup and formatting for
ready-for-review handoff, so the generated localization bundle will be updated in this iteration.

### F2 - High - Changed files did not pass the formatting gate

**Status:** Valid

Prettier reported differences in the URI handler and the updated Markdown documents. This has no
runtime effect, but it blocks the required ready-for-review CI gate.

**Options considered:**

1. Run the repository-wide `npm run prettier-fix` handover command.
2. Format only the reported files.
3. Align the files manually.

**Recommendation:** Run the repository handover command so local output matches CI.

**Author decision:** Accepted. The operator explicitly requested formatting and merge readiness.

## GitHub Copilot comment reconciliation

There were no GitHub Copilot review comments to merge. The draft state correctly prevented the
automatic review from running before handoff.

## Validation and independent sweep

The second-vendor validation confirmed both findings and found no additional high-confidence
correctness, security, behavior, test-quality, or documentation-contract defects.

The reviewers specifically confirmed:

- Empty-path links still mean `connect`.
- The deep-link verb and local resource-type allow-lists remain explicit security boundaries.
- Resource-type validation runs before any confirmation or webview opening.
- `/local` and `/local/documentdb` are equivalent and case-insensitive.
- Dismissing the single confirmation leaves the webview closed.
- Disabling `showUrlHandlingConfirmations` bypasses only that confirmation.
- The command-palette path still opens Local Quick Start directly and is unaffected.
- Rejection errors and telemetry do not include the attacker-controlled qualifier.

## Resolution

F1 and F2 are accepted handover fixes. No product-code changes beyond the maintainer-requested
behavior are required by the AI review.

| Finding | Status | Fix commit                                                                   | Resolution                                       |
| ------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| F1      | Fixed  | [`25778a41`](https://github.com/microsoft/vscode-documentdb/commit/25778a41) | Regenerated `l10n/bundle.l10n.json`.             |
| F2      | Fixed  | [`25778a41`](https://github.com/microsoft/vscode-documentdb/commit/25778a41) | Applied the repository's Prettier configuration. |

The full ready-for-review verification suite passed after these fixes.
