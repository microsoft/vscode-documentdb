---
feature: local-quickstart
kind: review
status: active
prs: [1072]
created: 2026-11-10
---

# Setup stage Details — implementation review

The operator requested implementation of the accepted [plan](./11-setup-stage-details.md)
with Opus 5.5 advising the leader. Each phase received a read-only Opus review.
This record distinguishes implementation corrections within the accepted plan
from the operator's final author/workbench review, which remains pending.

## Findings and disposition

| Item | Severity | Finding                                                                                                                         | Disposition within the accepted plan                                                                                                                                                                                                                    | Evidence                                                  |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P1   | Medium   | Activating Check Docker again removed the focused action; the first test focused the Details toggle instead.                    | Fixed: hand focus to the footer before removing the action. Added a real link-focused test, preserving the original toggle-focused test. This implements the already accepted focus requirement.                                                        | `90cc28f3`; final Opus review approved, high confidence.  |
| P2   | Medium   | Creating facts claimed an existing volume was replaced before removal succeeded; a failed create could also claim a new volume. | Fixed: omit the optional outcome until established; preserve volume name/path facts and all actual volume operations. Added removal-failure, cancellation and create-failure regressions. This implements the already accepted no-incorrect-facts rule. | `3c13d1aa`; final Opus review approved, high confidence.  |
| P3   | Low      | Moving attempt accounting shifted the first retry wait from 500 ms to 750 ms.                                                   | Fixed: retain actual attempt counts but restore the original 500 ms, 750 ms sequence, pinned with fake timers. Also corrected singular one-attempt wording. No intended timing change was authorized.                                                   | `6d366944`; final Opus review found no significant issue. |
| P4   | None     | Reviewed bounded input, close-only telemetry, StrictMode-safe opening calls, resets, fixtures and documentation.                | Approved: no high-confidence bugs found.                                                                                                                                                                                                                | `b791aef9`; Opus review, high confidence.                 |

Review locations: the Local Quick Start webview's row components, pure presentation,
focus/reset state, router and wizard telemetry; the service's provision/resume,
image inspection, readiness, sample-data and failure paths; focused regressions,
browser scenarios and directly related documentation. A separate read-only branch
review launched by the Case 1 runner also reported no significant issue.

## Constraints retained

- Error explanations and actions remain in the one MessageBlock; Details hold evidence.
- No stage durations, persisted facts, authentication changes or raw inspect/environment data.
- Missing image/server facts are omitted. The live official-image check returned API
  compatibility evidence but no product-version field.
- Sample-data failure does not turn a ready instance into a failed setup.
- Only bounded stage IDs and counts are added to the existing close telemetry event.
- W5 engine-check wording remains outside scope.

## Operator review still needed

In the extension workbench, run Set up and inspect Details on Set up and Done.
Use keyboard navigation to open a failed checking row, activate Check Docker again,
and verify footer focus and the failure actions remain usable. Check a short panel's
layout and actual screen-reader announcements; browser-computed region names do not
prove spoken output. Try Retry setup, Start over and Wait longer to confirm the
intended collapse/reset behavior.

The PR remains draft. The operator's final author decisions and any subsequent
GitHub Copilot reviewer comments have not been fabricated or marked complete.
Verification results and execution/cost records are tracked in the source plan.
