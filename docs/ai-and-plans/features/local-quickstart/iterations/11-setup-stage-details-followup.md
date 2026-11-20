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

| Item | Operator requests   | Implementation                                                                                                                                                             | Model                                          | Status                               |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| F1   | 2, 4, 6             | Discover both CLI executables without changing engine preference; carry previous image ID when already inspected; emit known image facts at pull start                     | Sol: host/readiness contract spans modules     | Done `40056c79`                      |
| F2   | 1, 2, 3, 4, 5, 6, 7 | Capitalized evidence segments, truthful CLI labels, full-ID tooltips, previous image identity, concise summaries and active image facts; remove checking explanation notes | Terra: bounded presentation work               | Done `c6752605`                      |
| F3   | 8                   | Stream the latest bounded, masked engine-output line during pull, with coalescing and cancellation cleanup                                                                 | Sol: command streaming and generator lifecycle | Done: F3a `a203ac50`, F3b `ba8c43de` |
| F4   | All                 | Browser coverage in all themes, accessible ID tooltips and progress checks; update related design/docs                                                                     | Terra: isolated fixtures/scenarios and docs    | Done `f2a07985`; docs separately     |

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
- Browser scenario contracts: `npx vitest run --config build/verification/browser/vitest.config.ts build/verification/browser/scenarios.test.ts`.
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

## Final verification and cost report

Both requested verification cases passed on the completed follow-up. Generated
localization and formatting were committed separately as `b87560b8`; no
behavioral corrections were needed after the checks.

| Case | Command                                      | Result                                 |
| ---- | -------------------------------------------- | -------------------------------------- |
| 1    | `npm run build`                              | Passed, 36.092 s                       |
| 1    | Focused service/webview Vitest command above | Passed                                 |
| 2    | `npm run l10n`                               | Passed                                 |
| 2    | `npm run prettier-fix`                       | Passed                                 |
| 2    | `npm run l10n:check`                         | Passed                                 |
| 2    | `npm run lint`                               | Passed                                 |
| 2    | `npm run build`                              | Passed                                 |
| 2    | `npm run typecheck:tests`                    | Passed                                 |
| 2    | `npx vitest run`                             | Passed                                 |
| 2    | `npm run package`                            | Passed; `vscode-documentdb-1.0.2.vsix` |

The check agent took 9m53s; the host recorded 8m46s for the command batch.
Individual times and runtime-suite totals were not retained in its final report,
so none are invented here. The focused implementation runs recorded 575 service
tests and 258 webview tests passing; the browser contract suite recorded 31.
All 45 live Local Quick Start routes passed, plus the full-ID and changing-output
checks described above. The leader stopped its temporary Vite helper afterward.

### Work-item timings and implementation costs

| Item | Commits    | Coding model    | Agent time | Coding AIU |
| ---- | ---------- | --------------- | ---------- | ---------- |
| F1   | `40056c79` | `gpt-6.1-sol`   | 4m45s      | 41.7       |
| F2   | `c6752605` | `gpt-6.1-terra` | 7m05s      | 38.0       |
| F3a  | `a203ac50` | `gpt-6.1-sol`   | 6m02s      | 38.5       |
| F3b  | `ba8c43de` | `gpt-6.1-sol`   | 3m41s      | 26.0       |
| F4   | `f2a07985` | `gpt-6.1-terra` | 4m57s      | 24.8       |

Times are summed agent elapsed times, not additive wall time: F2 and F3a ran in
parallel. The leader separately completed F4's initially blocked browser checks.
Six Opus consultations covered planning, the cheap progress option, F1 review,
F2/F3a review, active placement clarification and F3b review. No operator question
is parked. Technical verdicts were followed, including the clarified visible
placement instead of the initial hidden-Details suggestion.

### AIU by model, including the advisor

Host-log snapshot: **2026-11-10 10:22:11 UTC**, approximately one hour after the
follow-up began. The combined column includes the initial implementation and this
follow-up since 06:34:52 UTC. Every counted usage record supplied AIU; monetary
cost was not reported. Totals are rounded independently.

| Model             | Role                             | This follow-up AIU | Combined AIU |
| ----------------- | -------------------------------- | -----------------: | -----------: |
| `claude-opus-5.5` | Advisor                          |              404.4 |       1057.4 |
| `gpt-6.1-sol`     | Leader and coding                |              303.5 |        721.5 |
| `gpt-6.1-terra`   | Presentation, scenarios and docs |               62.8 |        146.3 |
| `gpt-5.6-luna`    | Checks                           |                1.2 |         13.4 |
| `gpt-6-luna`      | Initial-round typing fixes only  |           Not used |          1.0 |
| **Total**         |                                  |          **771.9** |   **1939.6** |

The same snapshot reports follow-up leader 197.4 AIU and subagents 574.5 AIU.
Report-writing and publishing after this snapshot are not yet included.

### Remaining operator checks

The PR remains draft. Check real-workbench short-panel layout and actual
screen-reader speech before requesting human review. Full-ID tooltips, visible
keyboard focus, discovery facts and changing activity have been verified in the
browser in all three themes; spoken output is not inferred from that evidence.

## Creating-container layout correction — 2026-11-10

**Done, commit `9f5ad480`:** the operator reported that the Creating container
summary added lines and moved the following rows. The leader reproduced a
20 px pending/active row becoming 37 px on completion at 900 px and 1280 px
viewports. Only Checking reserved its detail line, despite every stage now
receiving a summary.

Advised (Opus 5.5, 80% confidence): use the existing `reserveDetailSpace` option
for every shared setup row. Terra applied that one-line correction without
changing summaries, controls, package APIs or accessible text. Two regressions
failed before the fix and passed afterward, covering reserved hidden lines and
the same detail container holding the completed summary and Details toggle.

Case 1 verification: `npm run build` passed; all 260 Local Quick Start webview
tests passed, including 50 focused disclosure tests. Root type check also passed.
Live measurements in dark, light and high contrast at both 900 px and 1280 px
showed Creating container remaining **37 px** through pending, active and done,
with **0 px** movement of Starting container and summary/Details on one line.
All 45 live Local Quick Start routes passed.

Narrow panels still wrap long content naturally rather than clipping summaries
or hiding controls; this fix reserves one normal detail line, not arbitrary
future wrapped height. No new wording, persisted data, timing or telemetry was
introduced. Case 2 remains deferred while the PR is draft; the complete suite
passed for the preceding follow-up. The temporary scenario helper was stopped.

## Active engine-output layout correction — 2026-11-10

**Done, commit `5f9d7f46`:** the operator clarified that the shifting content was
the engine output stacked below the image, not the Creating container summary.
They explicitly allowed dropping the already-selected image from that status
line. The active pull now shows exactly one non-wrapping line: image and origin
before output, then literal engine output instead. Long text is ellipsized
visually while the full text remains in the DOM, title and setup log. The width
constraint applies only to active pulling; no settled Details controls are clipped.
The earlier row-reservation fix remains useful for completed stage summaries.

Advised (Opus 5.5, medium-high confidence): approved the replacement design.
The implementation review found no concrete issue in the renderer, single-line
styles or changed assertions (85% confidence); its tool budget ended before
reviewing the row wrapper. The leader completed that small CSS scope review
(95% confidence: active-only copy growth and span max-width, with no lifecycle
changes) and measured the actual browser behavior rather than assuming it.
Terra implemented the change; the existing announcement, telemetry, controls,
cleanup and escaping assertions were retained. One regression was added and the
old stacking-specific expectations were updated to the operator's new requirement.

Case 1 verification: build and root type check passed; all **261 webview tests**
and **31 browser scenario contract tests** passed. All **45 live Local Quick Start
routes** passed. Across dark, light and high contrast at **440, 600, 900 and
1280 px** viewports, the active pull stayed **37 px** high for a long image
fallback, short output and 160-character output; the following row moved **0 px**.
The full title was retained, output remained on one line within the row, the
image was absent once output appeared, and polite announcements were unchanged.
No localization key, host streaming behavior or telemetry changed.

The temporary scenario helper was stopped after verification. The PR remains
draft; Case 2 formatting, localization, lint and packaging are deferred until
ready for review, rather than rerun for this scoped correction.

## Unified stage typography — 2026-11-10

**Done, commit `1af902e0`:** the operator approved simplifying all five Local
Quick Start stages while retaining useful muted add-ons. Main labels and status
icons are unchanged. Ordinary summaries, fact terms, values and action links use
the same proportional UI font at 12 px, regular weight and 16 px line height.
Fact terms and values share the primary foreground; links keep their action
colour and focus styling. Code-like values no longer switch to monospace, and
shortened ID triggers are focusable spans retaining full-value tooltip descriptions.

Optional context remains muted at that same size and weight. A separate internal
qualification field keeps the unconfirmed-port "As requested" text in the primary
foreground. The local context-note colour uses VS Code's description foreground,
falling back to Fluent's secondary foreground. This avoids the existing adaptive
dark theme mapping both primary and secondary text to the same colour without
changing the shared theme. High contrast continues to respect its own colours;
in the representative high-contrast palette, description text is also white.

Advised (Opus 5.5, medium-high confidence): implement consumer-scoped overrides,
not shared-package changes. The implementation review recommended the description
foreground for optional notes (85% confidence). Terra applied that exact
refinement without changing the general muted class elsewhere in the view.
Three tests were added; existing model/DOM assertions were updated only for the
approved removal of code styling and the explicit qualification distinction.
Meaningful message severity emphasis, every evidence value, disclosure behavior,
keyboard focus, telemetry and single-line pull activity remain unchanged.

### Verification

- `npm run build`: passed (final Case 1 run 38.20 s).
- Focused webview suite: 264 tests in 10 files passed (19.93 s).
- Root `tsc --noEmit -p .`: passed during implementation.
- Browser scenario contracts: 31 passed (2.04 s).
- All 45 live Local Quick Start routes passed using the forwarded preview origin.
- Computed styles in dark, light and high contrast confirmed unchanged 14 px /
  20 px main labels; ordinary summaries, fact labels, values, links and ID triggers
  use 12 px / 16 px, regular weight and the same proportional font. There are no
  code elements in stage Details.
- All three shortened 71-character IDs remained keyboard-accessible with matching
  full tooltip descriptions; tooltip text also remained 12 px regular.
- Optional notes were visibly secondary in dark and light, while "As requested"
  matched the primary value colour. High contrast followed its theme, without
  opacity tricks.
- At 440 px and 900 px in every theme, long active-pull output remained one line
  in a 37 px row, with 0 px movement of the following row.

The original shared browser tab's pointer-driven sweep stalled; a fresh forwarded
preview completed all 45 routes. This was an automation limitation, not bypassed
product assertions. An existing scenario server was reused after the attempted
temporary helper found its port occupied; no existing server was stopped.

This is Case 1 on a draft PR. Full Case 2, including formatting, localization
validation, lint and packaging, remains deferred until ready for review. No
localization key or host API changed. Shared StatusList defaults and Diagnose
connection remain untouched.

### Models and host costs

Snapshot at 12:12:51 UTC, from this request's start at 11:48:44 UTC:

| Model             | Role                                      |       AIU |
| ----------------- | ----------------------------------------- | --------: |
| `gpt-6.1-sol`     | Leader and browser validation             |     277.1 |
| `claude-opus-5.5` | Two advisor consultations                 |      58.3 |
| `gpt-6.1-terra`   | Implementation and note-colour refinement |      22.6 |
| `gpt-5.6-luna`    | Case 1 checks                             |       0.6 |
| **Total**         | Independently rounded host values         | **358.6** |

Implementation turns took 4m06s plus the narrow note-colour refinement; the final
check agent took 1m15s. The snapshot reports leader 277.1 AIU and subagents 81.4 AIU.
Monetary cost was not reported. Reporting and publishing after the snapshot are
not included.

## Shared row highlighting — 2026-11-10

**Done, commit `e24789a4`:** the operator requested the same hover tracking as
Diagnose connection. Both the Set up and Done StatusList instances now enable
the package's existing `highlightRowsOnHover` property. This explicitly supersedes
the original plan's choice to leave it off. No local hover CSS, package changes,
new interaction logic or wording was added.

Luna implemented the two-property enablement. The leader carried out the accepted
decision without an additional advisor gate (100% confidence: the package's
existing documented property is the exact requested behavior). Case 1 build
passed and all 53 focused disclosure tests passed.

Live checks on both screens in dark, light and high contrast confirmed pointer
hover and keyboard-visible-focus highlighting, with 0 px row or following-row
movement. The remote browser's transition timing initially produced transient
computed colours; the final check finished the existing CSS transitions before
sampling their end state, without changing application styles. The existing
shared preview server was left untouched.

The PR was marked ready externally during this work, so the complete Case 2 list
was then run. Localization generation was unnecessary because no string changed;
localization validation still ran. Formatting, localization validation, build,
strict `npm run typecheck:tests`, the full runtime suite and packaging passed.
Full root lint passed after the documented keyboard-tooltip exception below.

The full suite found one lint issue in the preceding typography change:
`jsx-a11y/no-noninteractive-tabindex` on the read-only identifier's focusable group.
Advised (Opus 5.5, high confidence): retain keyboard access and use the exact
reasoned exception already used for read-only tooltips in DashboardHeader.
Luna added that single scoped JSX comment (`ad33b6f3`), leaving semantics, focus,
tooltip descriptions and runtime behavior unchanged. Focused lint and all 53
disclosure tests passed; the root lint rerun passed as well. Case 2 formatting
was committed separately (`845ab510`).

Final full runtime rerun: **388 files passed; 8,212 tests passed and 1 skipped**
(124.41 s). Packaging produced `vscode-documentdb-1.0.2.vsix`. No shared package,
persisted data, host operation or telemetry behavior changed. The leader did not
change the PR's ready/draft state.
