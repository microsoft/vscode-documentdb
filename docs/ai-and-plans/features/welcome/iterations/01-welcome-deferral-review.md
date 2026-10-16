---
feature: welcome
kind: review
status: active
prs: [1021]
created: 2026-10-15
---

# PR #1021 code review: Welcome walkthrough deferral

**PR:** [microsoft/vscode-documentdb#1021](https://github.com/microsoft/vscode-documentdb/pull/1021)
**Branch:** `dev/tnaum/welcome-deferral`
**Base:** `main`
**Reviewed:** 2026-10-15

## Verdict

**Approve after the telemetry finding was fixed.** The deferral state transitions, retry behavior,
and fresh-install path match the documented intent. The review found no blocking correctness issue.

## Finding

### F1 - Low - Welcome telemetry was attached to an event that had already finished

**Locations:**
[`welcomeScreen.ts`](../../../../../src/services/welcomeScreen.ts),
[`ClustersExtension.ts`](../../../../../src/documentdb/ClustersExtension.ts)

`maybeShowWelcomeScreen` was launched without awaiting it so activation remained nonblocking, but it
received the activation action context and updated that context after asynchronous work completed.
`callWithTelemetryAndErrorHandling('activate', ...)` had already emitted the activation event by that
point. Successful walkthrough opens and asynchronous failures were therefore not represented in
telemetry even though the local context object was updated.

**Recommendation:** Give the background welcome operation its own
`callWithTelemetryAndErrorHandling` event. Keep activation nonblocking and suppress user-facing error
notifications because this onboarding task is optional.

**Author decision:** Fix now because the independent event is low cost and preserves the existing
nonblocking activation behavior. Do not await the welcome operation from activation, and do not add
a custom telemetry delivery mechanism because the shared infrastructure already owns delivery and
failure reporting.

**Resolution:** Fixed in commit
[`03abaf43`](https://github.com/microsoft/vscode-documentdb/commit/03abaf43a2bce4fc1fa4eaf6b53d2fa6a5486d26).
The welcome operation now owns a fire-and-forget `welcomeScreen` event, records `outcome=deferred` or
`outcome=shown`, suppresses routine no-op activations, and leaves failures retryable. Tests retain a
minimal telemetry-wrapper shim and remain focused on welcome behavior rather than re-testing the
shared telemetry infrastructure.

## Other review checks

- No GitHub Copilot review comments or unresolved review threads were present.
- The legacy welcome marker was present in releases `v0.4.0` through `v0.11.1` and was written on
  startup activation, so it is a reasonable upgrade signal for the intended cohort.
- The VS Code API defines `vscode.env.sessionId` as changing when the editor starts. The implementation
  also preserves the documented limitation for simultaneously open windows of the same workspace.
- Retry ordering keeps the shown flag unset until the walkthrough command and state write succeed.
- An independent sweep found no additional blocking defects. Concurrent calls could duplicate an open,
  but the production integration has one activation call site, so no extra guard was warranted.

## Verification

| Check                                               | Result                                      |
| --------------------------------------------------- | ------------------------------------------- |
| `npm run prettier-fix`                              | Pass                                        |
| `npm run lint`                                      | Pass                                        |
| `npx vitest run`                                    | Pass, 5,178 tests and 1 skipped             |
| `npm run build`                                     | Pass                                        |
| `npm run package`                                   | Pass                                        |
| `npx vitest run src/services/welcomeScreen.test.ts` | Pass, 14 tests                              |
| `npm run l10n`                                      | Not applicable, no localized string changed |

Installed-window verification on desktop and Remote remains a manual check as documented in the
[welcome feature README](../README.md).
