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

## F2. Typed Entra explanations do not yet reach webviews

**Confirmed; delivery decision pending.** The existing webview explanation request passes only
an error message. The new explainer needs the typed error or its cause chain. The current
Collection View path can show a generic heading; the detail depends on what survives transport.

**Advisor recommendation:** Track this in WI-5/WI-6, whose classifier and structured unavailable
response are designed to handle it. PR 1 does not ship separately. The alternative is to add an
allowlisted error name to the current webview request, but that still does not convey driver
server-selection causes and would add call-site changes that WI-6 replaces. Do not match raw
message text or wrap errors solely to transport explanations.

**Author decision:** Pending.

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
