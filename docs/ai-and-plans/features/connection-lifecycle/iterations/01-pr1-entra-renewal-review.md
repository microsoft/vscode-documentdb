---
feature: connection-lifecycle
kind: review
status: active
created: 2026-11-20
---

# PR 1 pre-review: Entra silent renewal

Reviewed `2666f2ac7..f731f482f` (WI-1 only). GPT-6.2-Sol performed the initial review;
Claude Opus 5.5 validated the findings and performed an independent sweep. The PR was not yet
published, so there were no GitHub review comments to incorporate.

## F1. Regenerate localization before review

**Confirmed; blocks full CI.** The five new strings in
[entraCallbackErrors.ts](../../../../../src/documentdb/auth/entraErrors/entraCallbackErrors.ts)
and [EntraSignInRequiredErrorExplainer.ts](../../../../../src/documentdb/auth/entraErrors/EntraSignInRequiredErrorExplainer.ts)
are not in the checked-in bundle. Generate the bundle as already scheduled for Case 2, then run
`npm run l10n:check`. No wording change is needed.

**Resolved:** `a52f06320` regenerates the bundle with exactly five new keys. `npm run l10n:check`
passed.

## F2. Typed Entra explanations do not yet reach webviews

**Confirmed; deferred to WI-5/WI-6.** The existing webview explanation request passes only
an error message. The new explainer needs the typed error or its cause chain. The current
Collection View path can show a generic heading; the detail depends on what survives transport.

**Advisor recommendation:** Track this in WI-5/WI-6, whose classifier and structured unavailable
response are designed to handle it. PR 1 does not ship separately. The alternative is to add an
allowlisted error name to the current webview request, but that still does not convey driver
server-selection causes and would add call-site changes that WI-6 replaces. Do not match raw
message text or wrap errors solely to transport explanations.

**Author decision (2026-11-20):** Defer F2 to WI-5/WI-6. PR 1 will not add a temporary webview
transport for typed sign-in errors.

## Independent sweep

- **Recovery depends on WI-5.** The driver retains a rejected callback. PR 1 diagnoses the silent
  miss but cannot recover that client by signing in again; WI-5 must replace it.
- **Provider-change wording:** `providerChanged` uses the planned expired-sign-in wording.
  Changing it would be a separate user-visible decision.
- **Callback failure detail:** The new wrapper uses a bounded message and preserves the original
  cause. Do not expose raw cause text as part of this PR.
- **Provider seam:** The installed dependency has a public getter, but the repository's token
  resource module does not export a shared getter. WI-1 uses the public getter directly; WI-3
  should check both consumers during the dependency upgrade.

OP-1b passed with a real cluster: the database list loaded after idle and no sign-in prompt
appeared. That test did not cover webview failure presentation or replacement after a silent miss.

## Review handoff (2026-11-20)

Case 2 ran on `6e108f0a3` with the generated localization and formatting applied. Localization,
formatting, localization check, build, test type-check, full Vitest (9,651 passed, one skipped),
and VSIX packaging passed. Lint initially rejected an inline import type in the Entra handler
test. `a0c1d1312` replaced it with a type-only import; full lint, the affected suite (47 passed),
and its formatting check then passed. No runtime code changed in that follow-up.

## Copilot review follow-up (2026-11-20)

- **R3, done in `cae1db890`:** Startup telemetry recognizes the three typed Entra callback
  failures as `entraToken`, including wrapped and server-selection errors. The callback does not
  write startup telemetry. The advisor (`claude-opus-5.5`, 80% confidence) recommended classifying
  the error at the existing startup boundary; the leader applied that recommendation directly.
  Build and 79 focused tests passed, including three new cases. [Thread reply](https://github.com/microsoft/vscode-documentdb/pull/1108#discussion_r4641033663).
- **R1, done in `98be5f18e`:** The operator approved pinning the effective cloud and authority.
  The handler checks that snapshot before acquisition, after acquisition, and around silent
  lookups. The snapshot also covers the wait for token-resource resolution. The advisor
  (`claude-opus-5.5`, 85% confidence) approved the revised guard. Build and 137 focused tests passed.
  [Thread reply](https://github.com/microsoft/vscode-documentdb/pull/1108#discussion_r4641386918).
- **R2, done in `7ed07bd1f`:** The operator kept decision 0001: every callback does a silent
  lookup. Diagnostics now reports the callback acquisition that supplies the token to the driver,
  or reports an acquisition failure instead of keeping the earlier token facts. Late callbacks
  cannot change a finished report. `claude-opus-5.5` approved the implementation at 85% confidence.
  Build and 213 focused tests passed for the review fixes.
- **R4, done in `897329a8f`:** The operator approved the actionable account-mismatch heading. It
  tells users to sign in with the account originally used for the connection. The error detail
  is unchanged. Localization was regenerated and 16 focused tests passed.
  [Thread reply](https://github.com/microsoft/vscode-documentdb/pull/1108#discussion_r4641336633).
- **R5, deferred to WI-5:** The advisor (`claude-opus-5.5`, 85% confidence) verified from the pinned
  driver's source that plain callback errors are not stored in per-server descriptions. They reach
  the caller directly, where the existing cause traversal can explain them. WI-5 carries forward
  the driver check and the shared explanation path if needed; PR1 does not add a second traversal.
  The operator confirmed this deferral.
