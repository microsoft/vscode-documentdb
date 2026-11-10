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
| F2 | 1, 2, 3, 4, 5, 6, 7 | Capitalized evidence segments, truthful CLI labels, full-ID tooltips, previous image identity, concise summaries and active image facts; remove checking explanation notes | Terra: bounded presentation work | Queued |
| F3 | 8 | Stream the latest bounded, masked engine-output line during pull, with coalescing and cancellation cleanup | Sol: command streaming and generator lifecycle | Queued |
| F4 | All | Browser coverage in all themes, accessible ID tooltips and progress checks; update related design/docs | Terra: isolated fixtures/scenarios and docs | Queued |

These items share files and run sequentially. There is one code commit per item;
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
