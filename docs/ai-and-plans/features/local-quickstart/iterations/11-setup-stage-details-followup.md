---
feature: local-quickstart
kind: plan
status: active
prs: [1072]
created: 2026-11-10
---

# Setup stage Details — operator UX follow-up

The operator requested these eight changes on 2026-11-10, then instructed the
leader to obtain an advisor plan, execute it and finish with the same summary and
checks. This follow-up amends the original [Details plan](./11-setup-stage-details.md)
where its explanatory notes or empty evidence lines conflict with this request.
The run began at 09:22:28 UTC. Advisor: Opus 5.5; leader: Sol.

## Accepted scope and execution order

| Item | Operator requests | Implementation | Model | Status |
| ---- | ----------------- | -------------- | ----- | ------ |
| F1 | 2, 4, 6 | Discover both CLI executables without changing engine preference; carry previous image ID when already inspected; emit known image facts at pull start | Sol: host/readiness contract spans modules | Done `40056c79` |
| F2 | 1, 2, 3, 4, 5, 6, 7 | Capitalized evidence segments, truthful CLI labels, full-ID tooltips, previous image identity, concise summaries and active image facts; remove checking explanation notes | Terra: bounded presentation work | Done `c6752605` |
| F3 | 8 | Stream the latest bounded, masked engine-output line during pull, with coalescing and cancellation cleanup | Sol: command streaming and generator lifecycle | Done: F3a `a203ac50`, F3b `ba8c43de` |
| F4 | All | Browser coverage in all themes, accessible ID tooltips and progress checks; update related design/docs | Terra: isolated fixtures/scenarios and docs | Done `f2a07985`; docs separately |

These items share files and normally run sequentially. F3 is split into F3a
(host streaming) and F3b (webview rendering): F3a can run alongside F2 because
its runtime/service/test files do not overlap F2's webview files; F3b waits for
both. This coordination change does not add scope or alter the four-item count.
There is one code commit per item or explicit sub-item;
documentation/progress notes are committed separately. Case 1 runs after the
implementation batch. The operator explicitly requested the complete Case 2 list
again, even though the PR remains draft.

## Decisions within the requested scope

- **Both CLIs:** report PATH presence for Docker and Podman even when Docker wins.
  Do not claim that the unselected engine was probed or is reachable. The selected
  CLI's version and the engine/endpoint facts keep their actual meaning. Correct
  an evidence segment that names Docker when Podman was actually used.
- **IDs:** the host already sends full IDs. Short display values retain a full
  value for mouse and keyboard tooltips. Previous image ID is free: it comes from
  the before-pull inspection already used to distinguish Updated.
- **Summary lines:** every factful settled row with Details has a concise factual
  summary. Active pulling shows its image reference and custom/reused origin
  before download completes. Pending/active rows still have no disclosure.
- **Checking notes:** remove explanatory prose, rather than shortening it into
  another noisy note. Keep actual facts such as diagnostic reference, not claims
  about probes that did not run. Identifiers/architecture keep their natural case;
  localized sentences and status segments start capitalized.
- **Pull activity:** the container-client returns no structured progress from its
  pull command. Use the existing stdout/stderr stream to show a literal latest
  engine-output line, sanitized and masked before truncation, at most about four
  updates per second. It is activity feedback, not a computed completion estimate.
  Do not parse text to infer image outcome, totals, percentages or layers; do not
  add registry requests or a new engine API dependency.
- **Lifecycle:** a single latest-value slot prevents an unbounded output queue.
  Pull rejection must be observed immediately and still propagate normally.
  Clear timers/waiters on completion, failure and cancellation. Progress must not
  generate telemetry stage starts or repeated screen-reader announcements.

The advisor approved the host/presentation plan with high confidence, then judged
literal-output feedback viable with medium-high confidence. Its residual questions
about repeated active events and live regions are explicit acceptance checks for F3,
not reasons to invent progress. W5 recovery wording, preferred-engine settings,
Podman-machine startup, persisted schemas, authentication and step durations are
not in scope. No operator decisions or rationales beyond the request are invented.

## Internal contracts settled before coding

- `ContainerCliPresence = Readonly<Record<'docker' | 'podman', boolean>>`.
  `DockerReadinessBase.cliOnPath?` is unknown when absent.
  `ResolvedContainerCli.onPath` carries both lookups; client construction needs
  only `cli` and `executable`. No additional CLI version/daemon calls for the
  unselected executable.
- `PullingStageFacts.previousImageId?: string` is present only for Updated and
  comes from the existing before inspection.
- `PullingStageFacts.progress?: string` is ephemeral active engine output.
  `pullImage(imageRef, token?, onProgress?: (line: string) => void)` preserves
  existing callers. The service masks run secrets before presenting the bounded
  latest line; completed facts omit ephemeral output.
- `StageDetailFact.fullValue?: string` accompanies shortened ID values.
  `buildStageSummary(facts, status)` supplies localized concise factual summaries.
- CLI evidence segments include the selected CLI discriminant so the webview
  never substitutes Docker for Podman.

## Verification

- Focused service and webview tests: `npx vitest run --project extension src/services/localQuickStart/ src/webviews/documentdb/localQuickStart/`.
- Browser suite: `npx vitest run --config build/verification/browser/vitest.config.ts`.
- Live scenarios in dark/light/high-contrast: both CLIs, Podman-selected check,
  active image plus changing output, expanded full-ID mouse/keyboard tooltips,
  Updated previous identity and non-empty settled summaries.
- Preserve exact readiness probe counts, seed-call assertions and retry cadence.
  Update only incidental discovery result shapes and assertions for wording the
  operator explicitly changed. Never weaken a `TDD:` contract.
- Case 1: build plus focused tests. Case 2: l10n, prettier-fix, l10n:check, lint,
  build, typecheck:tests, full runtime suite and package, until green.

## Progress and review

Implementation, advisor verdicts, commits and measured costs are recorded below
as each item completes. Workbench-only layout and actual screen-reader speech
remain operator checks; browser-computed names are not spoken-output proof.

**F1 Done (2026-11-10), commit `40056c79`:** Sol added both PATH-presence flags,
preserving Docker preference and all existing command/probe counts, plus the
free previous-image identity and initial active image facts. Leader scheduling
decision: sequential ownership (100% confidence, shared files). Advised (Opus 5.5,
90% confidence): approved; snapshot flags immediately after client refresh and
never persist discovery facts. Fifteen tests added; all 565 service tests and
root type check passed. Nineteen existing exact probe/version assertions retained.
Remaining risk is the normal executable-disappears-after-lookup race, not a new
claim that the unselected engine was probed.

**F2 Done (2026-11-10), commit `c6752605`:** Terra capitalized the evidence
sentences, identified the actual selected CLI and other executable presence,
removed checking explanations, added concise summaries and full-ID tooltips, and
displayed the already-known active image. Unknown selected CLI uses a generic
label rather than inventing Docker. Forty-five tests added; all 250 focused
webview tests and root type check passed. Advised (Opus 5.5, 86% confidence,
joint review with F3a): approved; summary success wording requires confirming
done facts, and shortened IDs retain full accessible descriptions.

**F3a Done (2026-11-10), commit `a203ac50`:** Sol connected existing sanitized
stdout/stderr to the pull generator through one latest slot, coalesced at 250 ms.
No inferred totals, extra network/API calls or per-line telemetry were added.
Abort, rejection, completion and iterator-return cleanup are tested; terminal
facts omit ephemeral progress. Ten tests added; all 575 service tests and root
type check passed. The existing pull-call assertion gained its required callback;
its original inspection-count and known-image assertions were preserved.
Advised (Opus 5.5, 86% confidence): approved, no blocking issue.

**F3b placement clarification:** the reviewer initially suggested showing progress
only in Details, which would hide it during the active pull and contradict the
accepted request. A narrow advisor follow-up approved visible ordinary-text
`Engine output: ...` after the active image summary, outside the separate polite
stage announcement (80% confidence). It also required checking that StatusList is
not a live-region wrapper and preserving stage-status object identity when
repeated active events do not change status. These checks are part of F3b.

**F3b Done (2026-11-10), commit `ba8c43de`:** Sol displays literal activity
below the image summary without changing the separate polite announcement,
stage telemetry, controls or timers. Repeated status events preserve state
identity; completion, failure, cancellation and retry clear stale activity.
Eight tests added; all 258 webview tests and root type check passed.
Advised (Opus 5.5, 88% confidence): approved, no concrete bug. The package's
list/listitem wrappers are not live regions; component and live-browser checks
confirmed that changing activity leaves announcements unchanged.

**F4 Done (2026-11-10), commit `f2a07985`:** Terra added two scenarios (both CLIs present; Podman selected)
and strengthened existing summary, previous-ID, active-image/output and no-notes
assertions. Exact totals are 141 source-scenario routes overall and 45 Local
Quick Start routes. All 31 focused scenario-contract tests and root type check
passed. The worker's live checks were initially blocked by an unavailable shared
page/server; the leader started a temporary scenario helper and verified:

- All 45 Local Quick Start routes passed across dark, light and high contrast.
- All three shortened IDs on the success fixture exposed their complete
  71-character values on mouse hover and real keyboard navigation in every theme.
  Accessible descriptions matched, tooltips wrapped without overflowing, and
  keyboard focus outlines were visible, including high contrast.
- Two successive active-pull output updates rendered in every theme without
  additional RPC calls or changed polite announcements. Active pulling had no
  Details toggle, and progress disappeared when the stage completed.

The browser driver's external script environment needed an explicit timer adapter
using Playwright's wait API; no product or test-infrastructure workaround was
introduced. Layout in a real workbench and actual screen-reader speech remain
operator checks. No request is parked and no inferred progress estimate was added.
The leader reviewed the mechanical fixture/count/documentation changes directly
(100% confidence: assertions strengthen the expressly requested behavior, with
no added runtime API or inferred facts). Case 1 and the full requested Case 2
verification follow this implementation batch.
