---
feature: survey
kind: plan
status: active
created: 2026-10-07
code:
  - src/utils/survey.ts
  - src/utils/surveyTypes.ts
  - src/webviews/_integration/appRouter.ts
  - src/commands/openCollectionView/openCollectionView.ts
  - src/commands/openClusterDashboard/openClusterDashboard.ts
---

# Survey Refresh: Implementation Plan

> **Reconciliation (2026-10-08):** The disabled-switch and enablement-environment-variable
> descriptions below are implementation history. The operator subsequently enabled the
> shared code switch in all modes and removed the launch override; see
> [D0021](../decisions.md#0021-re-enable-surveys-in-production-and-development) and
> [review Iteration 4](./03-pr-review-and-ux-preparation.md#iteration-4---normal-enablement-and-dashboard-style-invitation).

Execution plan for the requirements in [the survey README](../README.md). Read that README
first; this plan does not repeat its constraints, it orders the work and adds completion guards.

Five stages. Each stage has a prompt for the executing agent and a guard. A stage is complete
only when every item in its guard is true. Do not start a stage before the previous guard holds.
Record progress inline under each stage (commit, what landed, deviations and rejected
alternatives), per the [knowledge base rules](../../../README.md#what-goes-inside-an-iteration-document).

## Telemetry Starts Fresh

The README asks for an old-to-new event mapping and continuity KQL. That requirement is
withdrawn: the existing survey telemetry is not evaluated by anyone, so there is no reporting
to preserve. Consequences for every stage:

- Delete `survey.measure-score`, `survey.init`, `survey.prompt`, and `survey.open` outright.
  No aliases, no dual emission, no mapping table, no historical comparison queries.
- Event names, property names, and value vocabularies are designed from scratch to answer the
  cohort questions in the README. Follow the
  [telemetry skill](../../../../../.github/skills/telemetry-instrumentation/SKILL.md) conventions.
- KQL is written only against the new schema. "What KQL Can Recover Today" in the README is
  background, not a target.
- Still binding: the privacy boundary, the `telemetryLevel === 'all'` permission gate, bounded
  emission frequencies, and gate-level cohort observability.
- Persisted user state under `ms-azuretools.vscode-documentdb.survey/*` is a separate question,
  see [D0011](../decisions.md#0011-legacy-survey-state-is-forgotten).

## Target Shape

Proposed layout. Stage 1 may adjust names; record why if it does.

| Module                                   | Responsibility                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/utils/feedbackPermission.ts`        | `isFeedbackPermitted(): boolean`, the shared `telemetryLevel === 'all'` check, fail closed. Adopted by `openCollectionView.ts` and `openClusterDashboard.ts`                                                 |
| `src/services/survey/surveyPolicy.ts`    | Pure, synchronous: `evaluateEligibility(state, now, config)` returns ordered gate results (`passed`, `blocked`, `notEvaluated`), overall result, first blocking gate, and data for the explanation text      |
| `src/services/survey/surveyState.ts`     | Versioned persisted state in `globalState`, legacy handling per D0011, write-on-transition only, in-memory honoring of failed writes                                                                         |
| `src/services/survey/surveyTelemetry.ts` | The only place survey events are emitted. Checks permission, applies per-session dedupe, owns the fixed vocabularies                                                                                         |
| `src/services/survey/SurveyService.ts`   | Singleton orchestrator: `recordSurveyActivity(featureArea)`, in-flight evaluation promise, invitation reservation, presentation right after the qualifying milestone (D0012), permission withdrawal listener |
| `src/services/survey/invitation/`        | Lightweight HTML webview view in the Secondary Sidebar (D0013; no React, no tRPC), HTML builder as a pure function, message handler                                                                          |
| `src/commands/giveFeedback/`             | "DocumentDB: Give Feedback" command (D0015)                                                                                                                                                                  |

Pre-telemetry gates (never emitted as rejections): kill switch, feedback permission, permanent
opt-out. Emitted, ordered gates: campaign/sampling (if retained), active days, cooldown
(`nextEligibleAt`), session invitation suppression.

Draft event set (finalized in Stage 1, wording reviewed in Stage 4). Every event carries
`surveyCampaignId` and `surveyPolicyVersion`; invitation events also carry `invitationSessionId`.

| Event                         | Key properties                                                                                                                                          | Bound                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `survey.cohortEntry`          | `featureArea` (first in session)                                                                                                                        | Once per host session                                  |
| `survey.eligibility`          | One property per gate with `passed`/`blocked`/`notEvaluated`, `overall`, `firstBlockingGate`, `trigger` (`sessionStart`, `newActiveDay`, `stateChange`) | Initial per host session, then only on changed result  |
| `survey.presentationDeferred` | `reason` (finite)                                                                                                                                       | Once per changed deferral reason                       |
| `survey.invitationShown`      | `isReminder`                                                                                                                                            | Once per invitation                                    |
| `survey.openForm`             | `trigger` (`invitation`, `command`), `result` (`success`, `failure`), `attempt`                                                                         | Once per attempt, bounded retries                      |
| `survey.invitationResolved`   | `outcome` (`opened`, `askLater`, `neverAgain`, `dismissed`), `wasVisible`                                                                               | Once per invitation; never after permission withdrawal |

---

## Stage 0: Decisions and Setup

**Owner:** operator, with the agent proposing. No production code.

### Prompt

> Read `docs/ai-and-plans/features/survey/README.md` and this plan. Prepare a decision sheet
> for the operator covering every open item below. For each, give a recommended value, one or
> two alternatives, and the consequence. Do not choose for the operator. After the operator
> answers, create `docs/ai-and-plans/features/survey/decisions.md` (status table plus numbered
> entries, see other features for format) recording each answer with the operator's reasoning.
> Include, as decisions already made: permanent "Never again", honest eligibility explanation,
> required cohort observability, one URL with no variants, and the fresh telemetry schema with
> no legacy event mapping. Also run `npm ci` and confirm `npx jest --no-coverage src/utils/survey`
> starts (the README notes `@swc/jest` was missing in this worktree).

Resolved values (details and reasoning in [decisions.md](../decisions.md)):

| Item                            | Decision                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Day boundary                    | Local calendar day (D0003)                                                                    |
| Active-day threshold            | 3 days (D0004)                                                                                |
| "Ask me later" cooldown         | 14 days (D0005)                                                                               |
| Cooldown after opening the form | 180 days (D0006)                                                                              |
| Close without a choice          | Own constant equal to "Ask me later" (14 days), recorded as `dismissed` (D0007)               |
| Sampling                        | Deterministic fraction kept in code at 1.0 (D0008)                                            |
| Campaign scope                  | One long-lived campaign ID, no release copy (D0009)                                           |
| Locale                          | No gate; invitation states the survey is in English (D0010)                                   |
| Legacy state                    | All dropped, including legacy opt-outs; old keys deleted after the new state is saved (D0011) |
| Presentation timing             | Right after the qualifying milestone, without taking focus (D0012)                            |
| Destination                     | Secondary Sidebar webview view only (D0013)                                                   |
| "Open survey" button            | Yes (D0014)                                                                                   |
| Commands                        | "DocumentDB: Give Feedback"; no reset command (D0015)                                         |
| Kill switch                     | Code constant, override only in `ExtensionMode.Development` (D0016)                           |
| Telemetry wording               | No "anonymized"; state what is not sent and link the Privacy Statement (D0017)                |

### Guard

- [ ] `decisions.md` exists with every item above answered by the operator.
- [ ] Jest runs in the worktree (existing survey tests may pass or fail; they are deleted in Stage 1).
- [ ] No source files changed.

### Progress

2026-10-07: operator answered all items; recorded as D0001 to D0017 in `decisions.md`. Changed
from proposals: threshold 3 (not 5), dismissal uses the "Ask me later" value (not 7 days),
presentation right after the milestone (not a delayed safe pause), Secondary Sidebar only (no
two-destination prototype). Still open: D0011 (legacy opt-outs, key deletion), D0017 (wording).
Jest setup not yet checked.

2026-10-07: D0017 resolved (no "anonymized"; Privacy Statement link). D0011: old keys deleted;
legacy opt-out handling awaiting operator confirmation.

2026-10-07: D0011 resolved: all legacy state dropped, legacy opt-outs included. All decisions
answered; only the Jest setup check remains for this stage.

2026-10-07: Jest setup checked. `npm ci` succeeded (no source or lockfile change), `@swc/jest` is
installed, and `npx jest --no-coverage src/utils/survey` ran 3 suites with 48 tests, all passing.
Working tree clean afterwards. All three Stage 0 guard items hold.

---

## Stage 1: Policy, State, Permission, and Telemetry Core

Replaces the old implementation. Surveys stay disabled by the kill switch for the whole stage,
so no user sees a change.

### Prompt

> Implement the core survey modules in the Target Shape table of
> `docs/ai-and-plans/features/survey/iterations/01-implementation-plan.md`, using the values in
> `docs/ai-and-plans/features/survey/decisions.md`. Read the README sections "Simplified Policy
> Proposal", "Required Cohort Telemetry", and "Telemetry Privacy Boundary" first, plus the
> telemetry-instrumentation skill and `.github/instructions/typescript.instructions.md`.
>
> 1. Add `feedbackPermission.ts` and switch the two existing `telemetryLevel` checks in
>    `openCollectionView.ts` and `openClusterDashboard.ts` to it without changing their behavior.
> 2. Write `surveyPolicy.ts` as pure functions. Gates are evaluated in a fixed order; once one
>    blocks, later gates are `notEvaluated`.
> 3. Write `surveyState.ts` with a single versioned state object, legacy handling per D0011,
>    and writes only on real transitions (new active day, outcome). Per D0011, read no legacy
>    values; delete the legacy keys once the new state is saved.
>    A failed opt-out write must still suppress in memory and surface a recoverable error.
> 4. Write `surveyTelemetry.ts` with the fresh event set. No survey event may be emitted unless
>    `isFeedbackPermitted()` is true at emission time. No rating, element ID, or URL in any event.
> 5. Write `SurveyService.ts` exposing `recordSurveyActivity(featureArea: SurveyFeatureArea)`
>    where `SurveyFeatureArea` is a closed union of the areas in the README coverage table. Use
>    one shared in-flight promise for evaluation and reserve the invitation before any await.
>    Listen to `onDidChangeConfiguration` for `telemetry.telemetryLevel`; on withdrawal, cancel
>    pending work and dispose any invitation without recording an outcome or emitting an event.
>    Presentation happens right after the qualifying milestone (D0012) through a stub interface
>    that Stage 2 implements. The kill switch override follows D0016.
> 6. Delete `src/utils/survey.ts`, `src/utils/surveyTypes.ts`, their three test files, the
>    `surveyPing` and `surveyOpen` procedures in `appRouter.ts`, and every `surveyPing` and
>    `promptAfterActionEventually` call site. Do not add new activity hooks yet.
> 7. Update the `_integration/README.md` row that mentions survey ping/open.
> 8. Add the event schema (names, properties, vocabularies, bounds) to a new
>    `docs/ai-and-plans/features/survey/design.md`.
>
> Write focused Jest tests next to the new modules. Use Case 1 verification only.
> Stop and ask if a decision value is missing or if any privacy constraint conflicts with the schema.

### Guard

- [ ] `npm run build` passes.
- [ ] `npx jest --no-coverage src/services/survey src/utils/feedbackPermission` passes, with tests for:
      telemetry levels `all`, `error`, `crash`, `off`, missing, unrecognized, and read failure;
      kill switch independent of permission; every gate blocked in turn with later gates
      `notEvaluated`; day boundary and threshold; repeated activity on the same day causes no
      write and no event; concurrent `recordSurveyActivity` calls evaluate once; permanent
      opt-out across restart, version change, campaign change, and arbitrary elapsed time;
      legacy keys (including a legacy opt-out) neither suppress nor qualify and are deleted
      after the new state is saved; opt-out write failure; dismissal uses its own
      constant and records `dismissed`; the development override is ignored outside
      `ExtensionMode.Development`; permission withdrawal while pending emits nothing and
      records no outcome.
- [ ] Searching `src/` for `surveyPing`, `promptAfterActionEventually`, `UsageImpact`,
      `measure-score`, and `utils/survey` returns no matches.
- [ ] Query Insights and Cluster Dashboard feedback gating behavior is unchanged (existing tests pass).
- [ ] `design.md` documents the event schema; the RU Query Insights exclusion is not a survey gate.

### Progress

2026-10-07, `8db6cdb7`: shared types and module interfaces, bodies not implemented. Changes from
the Target Shape, with rejected alternatives:

- Three extra modules: `surveyTypes.ts` (shared types), `surveyConfig.ts` (decision values, kill
  switch, URL, state keys), and `surveyPresentation.ts` (the presenter contract Stage 2
  implements). Rejected: putting the types in `surveyPolicy.ts`, which would make the state,
  telemetry, and presentation modules depend on the policy implementation.
- `evaluateEligibility(input, config)` takes an input object (`state`, `now`, `samplingValue`,
  `invitationIssuedThisSession`) instead of `(state, now, config)`, because the sampling and
  session suppression gates need values that are not in the persisted state.
- Preconditions (kill switch, permission, opt-out) are a separate pure function,
  `evaluatePreconditions`, so they cannot leak into the emitted gate snapshot.
- `resolveSurveyEnabled` takes `isDevelopmentMode: boolean`, keeping the policy free of
  `vscode`. The D0016 override is the environment variable `DOCUMENTDB_SURVEY_ENABLED`
  (`true`/`false`). Rejected: a hidden setting, which needs a `package.json` contribution that
  users could find and set.
- `survey.openForm` uses `openResult`, not `result`, because the telemetry framework sets
  `result` on every event. `survey.eligibility` sends each gate as `gate_<gateId>`.
- Deferral reasons: `presenterUnavailable` and `presentationFailed`. Stage 2 may extend them.
- The new state lives under `documentdb.survey.state`, outside the legacy key prefix, so the
  D0011 deletion cannot touch it.
- D0015 detail reviewed and adopted as proposed: the command opens the form even after
  "Never again", emits `survey.openForm` with trigger `command` only when permitted (and, as
  for every survey event, only while the kill switch is on), applies the
  180-day cooldown only when the survey is enabled, permitted, and not opted out, and never
  clears the opt-out. It also opens regardless of the kill switch, because the user asked.

2026-10-07, `83652d68`: `isFeedbackPermitted()` and `affectsFeedbackPermission()` in
`src/utils/feedbackPermission.ts`; `openCollectionView.ts` and `openClusterDashboard.ts` use it
with unchanged behavior (same fresh read, strict `'all'`, false on a throw). 15 tests cover
`all`, `error`, `crash`, `off`, missing, unrecognized, non-string, and both read failures.

2026-10-07, `1d70a695`: `surveyPolicy.ts` implemented. The 90 policy tests were written by a
separate agent from the guard and the decisions, reading only the committed stub; they passed
against the implementation unchanged, also under `TZ=America/Los_Angeles`. A non-finite sampling
value blocks at `sampling` (fail closed).

2026-10-07, `4b23ba95`: `surveyState.ts` implemented with 70 tests. The legacy keys are deleted
without reading them: all five are removed after the first successful save in each store
instance, retried after a later save if a deletion fails. Rejected: checking each legacy key's
value first, which would read legacy data that D0011 says to ignore.

2026-10-07, `9bb3f05b`: `surveyTelemetry.ts` implemented with 44 tests. Beyond the plan, each
`report*` method rejects values outside its vocabulary at runtime and requires
`invitationSessionId` to be a UUID, so a wrong caller cannot leak free text, a URL, or a count.

2026-10-07, `4dbd2a85`: `SurveyService.ts` implemented with 47 tests and created at activation in
`extension.ts` (inert while the kill switch is off). Concurrent calls share one in-flight promise
and calls that arrive while it is pending are dropped, not queued, since the pending evaluation
already covers them. Rejected: a queue of pending activities, which would re-evaluate for no
new information. A deferred presentation releases the reservation so the next milestone retries.
Withdrawal bumps a generation counter that every async continuation checks; the reservation
is kept, so the invitation does not reappear in the same session. In review I fixed two gaps
before committing: a failed "Never again" save is now surfaced even if permission is withdrawn
during the save, and a throwing kill switch getter can no longer reject `onOpenForm`.

2026-10-07, `1376feaa`: old survey code, its three test files, the `surveyPing` and
`surveyOpen` procedures, and all eight call sites removed; `_integration/README.md` row and a
comment in `service-kubernetes/config.ts` updated. The old strings in `l10n/bundle.l10n.json`
are left for `npm run l10n` in Stage 4 (Case 1 rule).

2026-10-07, `60a2651d`: fixes from the opus-5.5 review of the core. (1) High: each window's store
cached the state from construction and wrote it back whole, so a second window could erase
"Never again" or a cooldown. The store now merges the stored value before every read,
transition, and write (`mergeSurveyStates`). Rejected: a per-field write API, which
`globalState` cannot make atomic either. (2) Medium, latent until Stage 2: a `present()` that
never settles kept `inFlight` set for the session. Withdrawal and dispose now release it with a
per-run token, and the presenter contract requires `present()` to settle promptly. The review
confirmed concurrency, the withdrawal path, and the no-event-without-permission rule as correct.

2026-10-07: `design.md` added with the event schema, gates, outcomes, state, and the note that
the RU Query Insights exclusion is not a survey gate. Operator note: the test suites go beyond the
guard in places (about 278 survey tests); further hardening was stopped at this point.

---

## Stage 2: Invitation Surface

### Prompt

> Build the lightweight invitation described in the README "Invitation Surface" section and
> wire it into the presentation interface from Stage 1. Read the accessibility-aria-expert
> skill and `docs/ai-and-plans/live-preview-playwright.md`. Do not use React, FluentUI, or tRPC.
>
> 1. Write the HTML builder as a pure function taking the eligibility explanation data, the
>    localized strings, the CSP nonce, and the webview resource roots. Strict CSP, no remote
>    resources, VS Code theme variables, packaged DocumentDB artwork, native buttons.
> 2. All five stars and the "Open survey" button post the identical message (`openForm`) with
>    no index or element identity. "Ask me later" and "Never again" are distinct messages.
>    The host opens `https://aka.ms/DocumentDBSurvey` via `vscode.env.openExternal`, rechecks
>    permission first, records `success`/`failure`, and offers retry on failure without
>    consuming the acceptance cooldown.
> 3. "Why am I seeing this?" is a native `<details>` generated from the same eligibility
>    result that triggered the invitation (actual active-day count, reminder return reason).
>    Use the README draft copy without a release sentence (D0009), add a line that the survey
>    is in English (D0010), and use the D0017 telemetry wording with the Privacy Statement
>    link, opened through the host like the survey URL and never recorded.
> 4. Host the invitation as a webview view in the Secondary Sidebar (D0013). First verify, with
>    the extension's minimum `engines.vscode`, that the view container can be contributed there,
>    revealed without taking focus from the editor or terminal, and does not restore an old
>    invitation at startup. Check behavior when the user has hidden or moved the view. If any
>    of these fails, stop and report options to the operator before building further.
>    Emit `invitationShown` only when the webview reports it is rendered and visible.
> 5. Add the "DocumentDB: Give Feedback" command (D0015) using the same open-form path.
> 6. Measure time-to-visible, check widths 240, 320, and 480 px, zoom, high contrast,
>    keyboard order, screen reader names, and a long pseudo-localized string. Capture
>    screenshots and findings in this plan's Progress section.

### Guard

- [ ] Secondary Sidebar placement, reveal without focus, and no startup restore verified and
      recorded in Progress (or the operator has approved a fallback, recorded in `decisions.md`).
- [x] "Give Feedback" opens the form after "Never again" without clearing it.
- [x] Unit tests: HTML has a CSP with nonce and no `http` resource URLs; all rating controls
      produce identical messages; accessible names exist for every control; explanation text
      matches the given eligibility data (count, reminder reason, no release text when no campaign context).
- [x] Host tests: permission withdrawn before navigation blocks opening and emits nothing;
      open failure offers retry and does not set acceptance cooldown; "Never again" persists
      before close; closing without a choice records `dismissed`, not `askLater`; a hidden
      but constructed panel does not emit `invitationShown`.
- [x] Manual or Playwright check at 240/320/480 px recorded in Progress.
- [x] `npm run build` and the stage's Jest paths pass.

### Progress

2026-10-07, `b051c5ca`: invitation surface and "DocumentDB: Give Feedback" landed. The
presenter is registered at activation with SurveyService. A session-only
`documentdb.surveyInvitationActive` context gates the contributed webview view; activation
sets it false, inactive resolution supplies empty HTML, and no webview state is saved or
restored. The kill switch remains off, and Stage 3 activity hooks are not added here.

2026-10-08: developer tooling renames the unreleased `DOCUMENTDB_SURVEY_ENABLED` to
`DOCUMENTDB_DEBUG_SURVEY_ENABLED`. A single `src/debug/debugOverrides.ts` reader also
handles `DOCUMENTDB_DEBUG_SURVEY_ALWAYS_INVITE=true`, which enables the survey and bypasses
all preconditions and eligibility gates only in Development mode. Presentation and invitation
actions intentionally bypass feedback permission in this debug mode; telemetry emission still
requires `isFeedbackPermitted()` and the URL is untouched. Two underscore-prefixed palette
commands simulate a real milestone or clear persisted state and session suppression without
reloading. Both are registered and visible only in Development mode; launch defaults are false.
Production/Test behavior and decisions.md are unchanged.
Case 1 verification: `npm run build` passed; focused Jest passed 10 suites and 320 tests
covering survey, debug commands, activation, contributions, and Give Feedback. No Case 2
commands ran. A narrow ignore-rule exception allows the requested `src/debug/` source files.

API evidence: VS Code 1.106.0
[viewsExtensionPoint.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/api/browser/viewsExtensionPoint.ts)
registers `secondarySidebar` as AuxiliaryBar without a proposed-API gate. Its `when` expression
controls view availability and its custom container uses `hideIfEmpty`. The generated view
`.open` action in
[viewsService.ts](https://github.com/microsoft/vscode/blob/1.106.0/src/vs/workbench/services/views/browser/viewsService.ts)
accepts `{ preserveFocus: true }` and resolves the view's current container, including a moved
view. The installed stable WebviewView definition documents `show(true)` as preserving focus.
Tests assert these contribution and reveal arguments; actual workbench behavior remains pending
operator verification, so the first guard box is deliberately unticked. No fallback or
`enabledApiProposals` was added.

Implementation details and deviations, with rejected alternatives:

- "Closed" means WebviewView `onDidDispose`, which the API documents as explicitly hiding the
  view through its context menu. It records `dismissed`, including a hide during a failed browser
  open. Collapse, switching containers, and temporarily hiding the sidebar are visibility
  changes, not dismissal. Rejected: treating every visibility loss as a close, which would count
  normal navigation and view relocation as user dismissals. Programmatic disposal clears the
  active invitation before hiding the contribution and never invokes callbacks. A choice already
  being saved takes precedence over a simultaneous user hide.
- Reveal waits at most 1500 ms for a visible resolved view, returning `undefined` and clearing
  the context when unavailable or failing. It does not wait for rendering or user interaction.
  `onVisible` requires both the rendered message and `view.visible`, and runs once. Rejected:
  waiting indefinitely for a hidden view to be opened, which would hold the service in flight.
- The pure HTML builder receives explanation data, localized host strings, a nonce, CSP source,
  and the host-resolved packaged artwork URI. The existing DocumentDB icon is reused. Native
  buttons, details, link, theme variables, and a status live region need no React, Fluent UI,
  tRPC, new dependency, or separate runtime bundle. Every star, Open survey, and Retry uses
  exactly `{ type: 'openForm' }`. Privacy opens only the fixed Privacy Statement URL through
  `openExternal`, without a survey callback or telemetry wrapper.
- Give Feedback uses native command registration in its own command folder. Rejected: the
  usual auto-telemetry command wrapper, because the survey's permission/kill-switch gates and
  explicit event schema must remain the only survey instrumentation. It calls the existing
  service open-form path even after opt-out and with the kill switch off. The service method
  gained an optional attempt argument, defaulting to 1, for up to three user-approved command
  retries. Rejected: labeling every retry attempt 1 or introducing a second navigation path.

2026-10-07: Case 1 checks passed after the final source change:
`npm run build` and `npx jest --no-coverage src/services/survey src/commands/giveFeedback`.
Seven suites, 289 tests passed, including 26 new Stage 2 tests (8 HTML, 13 presenter/host,
5 command). Guard coverage includes CSP/escaping, identical opening payloads, accessible control
names, actual usage count and all reminder reasons, no release/anonymity copy, context-gated
contributions, empty inactive resolution, unavailable/rejected reveal, rendered plus visible,
silent disposal, permission withdrawal, failure/retry without acceptance cooldown, opt-out save
before programmatic close, explicit hide versus Ask me later, and unrecorded Privacy clicks.
No TDD contract failed. No l10n, prettier-fix, lint, or package command ran; those Case 2 checks
are deferred until ready for review.

2026-10-07: the plain-HTML Playwright approach was practical. A temporary localhost harness
served the compiled production builder and production host strings, supplied VS Code theme
variables and an `acquireVsCodeApi` stub, and served the existing packaged icon. Production CSP
was kept strict: nonce styles/scripts and a local image origin only, with no `unsafe-eval`.
Playwright 1.54.1 ran the cached Chromium 1181 with temporary/existing extracted runtime
libraries; no repository dependency or system installation changed. Findings:

- 240, 320, and 480 px passed in light, dark, and high-contrast theme variables, with both
  ordinary strings and doubled pseudo-localized text plus a long unbroken word. All 18
  combinations had no horizontal overflow, controls inside the viewport, loaded artwork, and
  nonempty accessible control names. The expanded explanation was checked too.
- The same combinations passed at 200% CSS zoom. This is a browser-layout approximation,
  not verification of actual VS Code workbench zoom or OS scaling.
- Keyboard order: stars 1 to 5, Open survey, Ask me later, Never again, disclosure. Enter
  expands the disclosure and the next Tab reaches Privacy Statement. The initial focused
  element remained BODY. All six opening controls produced identical messages; a failed
  result revealed Retry. No page errors occurred.
- Browser navigation-to-rendered-message measurements ranged from 22.1 to 91.3 ms across
  those 18 runs. This includes local page load and two animation frames, not extension-host
  reveal time or a production performance guarantee. Actual milestone-to-visible timing
  remains pending operator verification.
- Screenshots, visually checked for artwork, clipping, and overlap:
  [240 px](./02-invitation-240.png), [320 px](./02-invitation-320.png),
  [480 px](./02-invitation-480.png). They capture ordinary light-theme copy, not every theme,
  zoom, or pseudo-localized case. Browser-computed names do not prove real screen-reader speech.

Pending operator verification, not a blocker for this implementation handoff:

1. In a development extension host on VS Code 1.106.0 or newer, set
   `DOCUMENTDB_DEBUG_SURVEY_ENABLED=true` and telemetry level `all`. With existing test eligibility
   state, invoke a qualifying milestone through the service (Stage 3 hooks are not yet wired).
   Repeat with the editor focused and with a terminal focused. Confirm the invitation appears
   in the Secondary Sidebar while typing focus stays in the original surface; measure actual
   milestone-to-visible time.
2. Leave an invitation open, restart/reload VS Code, and confirm neither its content nor the
   view restores without new qualifying activity. Repeat after moving the view to another
   container. Its original container should disappear when empty.
3. During an invitation, explicitly hide the view through its context menu and confirm the
   persisted outcome is `dismissed`, not `askLater`. Collapse it or switch containers and
   confirm no dismissal. Move it, then repeat a fresh qualifying session and confirm reveal
   follows the current location without focus theft. Check previously hidden and slow remote
   destinations: if not visible within 1500 ms, the invitation must defer, not appear later.
4. Check actual VS Code zoom, high-contrast themes, small windows, and screen-reader names/status
   announcements. Browser layout and computed names were checked; workbench focus, restore,
   moved/hidden behavior, remote latency, and assistive-technology speech were not.

2026-10-07, review of `b051c5ca` and `bd8bb891` (opus-5.5): no High defects and no code fix
commits. Privacy, CSP, message validation, the two fixed external URLs, the presenter contract,
the D0015 command behavior, and the context-gated contributions were confirmed. The reveal path
uses only `.open` with `preserveFocus: true` and `show(true)`; the VS Code 1.106.0 `openView`
source opens the container without focus. Build passed and 8 suites with 304 tests passed.
Open points, not fixed:

- Needs an operator decision (Medium impact): hiding the Secondary Sidebar or switching away
  records nothing, so an unresolved invitation returns in the next session after a milestone.
  D0007 rejected "showing again next session". Any fix changes policy or the silent-dispose
  contract.
- Low: in 1.106.0, `ViewPaneContainer.removePane` disposes the pane, so dragging the view to
  another container during an invitation fires `onDidDispose`. It records `dismissed`, and the
  invitation briefly renders in the new location and then disappears. Add this to check 3.
- Low: Give Feedback while an invitation is visible records `opened` but leaves the invitation
  open; a later Ask me later or hide overwrites the 180-day cooldown with 14 days.
- Low, for operator checks: a focused Chat in the Secondary Sidebar is replaced (and loses
  focus) when the invitation opens; the Secondary Sidebar can stay open after the invitation ends
  or after a late `.open` on the timeout path.
- Low, Case 2: the six new files lack the license header that lint requires; one misindented
  JSDoc line in `SurveyService.ts`; `{0}` in the usage string is replaced only once.

2026-10-07: Part A implements D0019: first visibility persists the 14-day cooldown without
an outcome or extra event; subsequent visibility is a no-op. Timed outcomes keep the later
cooldown, and permanent opt-out remains sticky. Give Feedback is registered before survey
initialization and uses the fixed browser URL if initialization fails. Five new regression
cases pass; two opt-out fixtures now settle the visibility save first. Case 1: 8 suites,
294 tests pass; `npm run build` passes. Part A commit: `f3f01ff0`.
Rejected: treating visibility as Ask me later (would invent an outcome), and moving survey
initialization outside its catch (would fail activation). Stage 2 workbench checks remain pending.

---

## Stage 3: Feature Milestones

### Prompt

> Add `recordSurveyActivity(featureArea)` calls at the success boundaries in the README
> "Broader Activity Coverage" table. One shared completion boundary per area; add a second
> only when a usage path would otherwise be unrepresented, and justify it in Progress.
> Calls are fire-and-forget, must never throw into the feature, and must sit after success,
> not on attempt, step, chunk, poll, keystroke, or button click. Webview-originated milestones
> are recorded host-side in the router procedure that completes the work, not by a new RPC.
> Cluster Dashboard only if it is merged on the branch. Do not touch existing feature telemetry.
> Work in small batches (one or two areas per commit) and list each hook with file and reason.

### Guard

- [x] Every area in the coverage table has exactly one hook (or a justified second), listed in Progress.
- [x] No hook is on a paging, refresh, breadcrumb, view-switch, polling, completion-request,
      or per-statement path.
- [x] A test (or set of tests) shows a single-feature user reaches the threshold, and that two
      areas succeeding on the same day add one active day and no extra events.
- [x] Existing feature tests in touched folders pass; `npm run build` passes.

### Progress

2026-10-07, batch 1: completed Query Playground and Interactive Shell hooks through the
existing synchronous, never-throwing `recordSurveyActivity` helper. Two service tests prove
single-feature qualification on three local days and same-day deduplication across two areas.
Case 1: 22 suites, 847 tests pass; `npm run build` passes. Batch commit hash follows in the
next dated note.

| Area               | File                                               | Function                | Why this boundary                                        | What it excludes                                                           |
| ------------------ | -------------------------------------------------- | ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `queryPlayground`  | `src/commands/playground/executePlaygroundCode.ts` | `executePlaygroundCode` | Completed Run All/Selected evaluation and result display | Attempts, cancellation, errors, progress, individual statements            |
| `interactiveShell` | `src/documentdb/shell/DocumentDBShellPty.ts`       | `evaluateInput`         | Completed normal user evaluation and output              | Startup, keystrokes, completion requests, interrupted and special commands |

No new RPC or feature telemetry changes. Rejected: hooking evaluator internals (would count
startup or individual statements), or adding per-hook integration harnesses (service-level
guards plus existing feature tests suffice). Pending: connection, browsing, management,
analysis, and the branch check for Cluster Dashboard; final coverage guard remains open.

2026-10-07: batch 1 commit `029fd38e`. Batch 2 adds setup and browsing/editing success
boundaries. Case 1: 21 suites, 532 tests pass; `npm run build` passes. The Quick Start
router's minimal VS Code mock now isolates the survey helper, avoiding unrelated azext
module initialization. Batch 2 commit hash follows in the next dated note.

| Area           | File                                                               | Function            | Why this boundary                                                 | What it excludes                                                         |
| -------------- | ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `connection`   | `src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts` | `recordSetupResult` | Terminal successful setup, shared by provisioning and Wait longer | Discovery, readiness polls, intermediate stages, errors, reconnect loops |
| `dataBrowsing` | `src/webviews/documentdb/collectionView/collectionViewRouter.ts`   | `runFindQuery`      | Completed explicitly initial useful query                         | Refresh, pagination, omitted intent, aborted requests                    |
| `dataBrowsing` | `src/webviews/documentdb/documentView/documentsViewRouter.ts`      | `saveDocument`      | Completed user save represents edit-only users                    | Document reads, refresh, individual documents in imports                 |

The second browsing/editing hook represents a real editing-only path not covered by collection
queries. `initial` includes a query supplied when the user opens a Collection View from another
feature; no new intent field or RPC was added. Rejected: hooking all cached queries (counts
paging/refresh), or only saves (misses read-only query users). Connection/setup uses the allowed
Quick Start milestone; ordinary stored/discovered connection success is not separately hooked.
Rejected: connection-definition save (not a confirmed live connection), or shared tree/client
loads (cannot cheaply separate automatic refresh/reconnect). Pending: management, analysis,
Dashboard branch evidence, and the cumulative Case 1 check. Stage 2 workbench checks remain pending.

2026-10-07: batch 2 commit `aedb8a9e`. Batch 3 completes management, analysis, and Dashboard.
Dashboard is merged on this branch: `72886260` (#823), followed by #979 and #980. The feature
index's POC/unmerged label is stale; code and merge history control this coverage decision.
Case 1 for this batch: 29 suites, 648 tests pass; `npm run build` passes. Cumulative touched-folder
Jest check: 55 suites, 1,351 tests pass, including seven new test cases across Parts A and B.
No TDD contract failed. No l10n, prettier-fix, lint, or package command ran.

| Area               | File                                                                                | Function          | Why this boundary                                                     | What it excludes                                                                          |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `dataManagement`   | `src/webviews/documentdb/collectionView/indexesTab/indexViewRouter.ts`              | `createIndex`     | Backend creation returned a validated success                         | Attempts, rejected results, index listing, build polling                                  |
| `dataManagement`   | `src/services/taskService/taskService.ts`                                           | `Task.runWork`    | Completed collection/index copy tasks represent paste-only users      | Steps, progress, per-document copies, cancellation, failures, demo/other tasks            |
| `queryInsights`    | `src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts` | `streamStage3`    | Completed user-requested AI analysis before the terminal result yield | Automatic Stage 1/2 analysis, streamed fragments, recommendations, cancellation/errors    |
| `clusterDashboard` | `src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts`                | `getStorageStats` | Successful initial inventory load after opening Dashboard             | Manual refresh, reconciliation, background load, health polling, aborted/failed inventory |

The second management hook covers collection/index paste users who never create an index in
the drawer. The task-type check uses existing types, without a new capability abstraction.
Rejected: unconditionally recording every task (includes demo work), per-document/task-progress
hooks (noise and false successes), and hooking automatic Query Insights Stage 1/2 (counts view
changes and reanalysis). The AI hook is immediately before the terminal yield so generator
cleanup does not need another iteration to record completed analysis. Existing feature telemetry
and RPC contracts are unchanged. Dashboard's initial load follows user opening of the panel;
the existing load reason distinguishes it from automatic follow-up and refresh work.

Guard evidence: the hook tables cover all seven union values, with justified second hooks in
two areas; all hooks call the existing synchronous, never-throwing helper after successful work.
The two `Stage 3:` tests in `SurveyService.test.ts` prove three-day single-feature qualification
and cross-area same-day deduplication with unchanged writes/events. All touched folders were
included in the cumulative Jest command and the build passed after the final source edit.

Pending items are unchanged Stage 2 operator workbench checks and Stage 4 KQL/privacy review,
localization, full Case 2 checks, and enablement. The kill switch remains off. Representative
management coverage is index creation and copy/paste, not an exhaustive hook for every import,
export, or namespace command. Connection/setup is represented by completed Quick Start, not
ordinary stored/discovered connection loads. These coverage limits follow the table's
representative-milestone scope and avoid hooking automatic work. No Stage 3 implementation
guard is left open. Exact batch 3 commit hash will be appended in a documentation-only follow-up.

2026-10-07: batch 3 commit `8610e845`. Final license-header placement adjustment in the
Dashboard test mock passed its 8 suites and 91 tests, followed by another successful
`npm run build`. The cumulative 55-suite, 1,351-test run above covers all behavior changes.
This documentation-only follow-up records the exact hash without changing source, decisions,
or hook coverage. Part B shipped in three activity-hook batches; this additional commit is
only commit-hash bookkeeping. Full Case 2 checks remain deferred until ready for review.

---

## Stage 4: KQL Validation, Privacy Review, and Enablement

### Prompt

> Write the cohort KQL for the new schema in `design.md`: per enrollment cohort and policy
> version, distinct installations reaching, passing, and blocked at each gate (pass rate uses
> installations reaching the gate as denominator), first blocking gate separate from
> `notEvaluated`, eligible-but-not-shown, deferral reasons, explicit `askLater`, `dismissed`,
> `neverAgain`, open failures, and time to next stage, with a fixed follow-up window and
> censored recent enrollments reported separately. Exclude empty machine/session IDs.
>
> Build fixture journeys as datatable inputs (high day threshold blocking most installations,
> cooldown blocking returners, presentation deferral hiding eligible invitations) and show the
> query names the responsible gate in each. If a dev Application Insights resource is available,
> run a local build with the kill switch off against it and confirm real event names and
> dimension names match the query.
>
> Prepare a privacy review packet: every event, property, vocabulary, the identifiers used,
> and the invitation copy. Stop for the operator to return the review outcome and apply it.
> The copy already avoids an anonymity claim (D0017); change it only if the review asks.
>
> Finally, after the operator confirms the external form is live: flip the kill switch to
> enabled (keep it), update the README status and `docs/ai-and-plans/README.md` row, add
> user-facing notes if the operator wants them, and run the full Case 2 checks.

### Guard

- [ ] KQL in `design.md` produces the expected gate attribution for all three fixture journeys.
- [x] Event and dimension names verified against real emitted events, or explicitly recorded as unverified.
- [ ] Privacy review outcome recorded in `decisions.md`; copy updated accordingly.
- [ ] Operator confirmed the form URL is live and approved enabling.
- [ ] Case 2 list passes: `npm run l10n`, `npm run prettier-fix`, `npm run lint`,
      `npx jest --no-coverage`, `npm run build`, `npm run package`.
- [x] `# Outcome` chapter added to this plan stating what was verified and what was not.

### Progress

2026-10-07, `1046d53d`: Stage 2 Low source issues addressed: six exact license headers,
the misindented SurveyService JSDoc, and the final newline in Give Feedback. The usage-count
substitution is a one-line `replaceAll` change, with a repeated-placeholder regression test.
Adding a header initially hid Jest's first-docblock environment directive; the final HTML test
uses an explicit local DOM from the installed jsdom test tooling, preserving the exact header
without a lint exemption or shared Jest configuration change. Rejected: changing the required
header or configuring a new test project for this single file. Final Case 1 verification:
`npx jest --no-coverage src/services/survey src/commands/giveFeedback` passed 7 suites and
296 tests; `npm run build` passed. No TDD contract failed. Exact headers and final newline were
checked locally; this is not a Case 2 lint pass.

2026-10-07: autonomous Stage 4 documentation prepared in `design.md`: three shared-source cohort
reports (gates, presentation/outcomes, stage timing), 45 datatable event rows, a fixed 14-day
follow-up, and explicit recent-enrollment censoring. Fixtures attribute the high-threshold loss
to activeDays, returning suppression to cooldown, and eligible-but-unshown loss to presentation.
An ignored visible invitation stays unresolved, not dismissed (D0019). Opening failures, all
four resolution outcomes, empty IDs and a recent enrollment are also covered. Local schema and
reference-calculation checks confirm the expected observations for 11 installations (10 mature,
1 censored), not KQL execution. The exact documentation commit hash follows in a bookkeeping note.

Kusto tools are advertised as deferred, but this session cannot load them and has no usable
Kusto engine. All three queries are **unverified against a live engine**. Real Application
Insights table/prefix/dimension mapping and delivered event names are **unverified** too, as
required for this handoff. The fixture-execution guard stays unticked. The second guard is ticked
only because its explicit-unverified alternative holds, not because real events were inspected.

The Privacy Review Packet inventories every survey event/field/vocabulary, measurements,
framework identifiers/metadata, exclusions, permission and manual-command boundaries, the
26 actual English strings, both fixed external URLs and D0017's rationale. Local inspection
also corrected design.md's failed-open cooldown wording to retain D0019's visibility cooldown.
Framework duration is documented from the installed wrapper (seconds), with warehouse names
still awaiting live confirmation. The packet is **awaiting operator review**, not a privacy
approval. No new decision was made; `decisions.md` is unchanged.

Production `SURVEY_ENABLED` remains false. No push, localization generation, formatting,
lint or packaging ran. Full Case 2 checks are deferred until ready for review. The remaining
Stage 4 operator gates and Stage 2 workbench checks are listed below; Stage 4 is not complete.

2026-10-07, `f26dc72f`: the Cohort KQL, 45-row fixture source, expected-attribution table,
Privacy Review Packet and Outcome hand-over draft are committed. This final documentation-only
note records the exact hash; it does not change verification status or policy. Local checks
confirmed two satisfied and four open Stage 4 guard items, all 26 quoted English strings,
the source hygiene fixes and the unchanged disabled kill switch. Live engine/event verification,
privacy approval, form confirmation, enabling and full Case 2 checks still await the operator.

2026-10-07, operator: KQL validation leaves this plan. The operator will build and tune the
cohort queries with a separate agent that has access to the telemetry storage and its query
quirks. The KQL and fixtures in `design.md` stay as an unverified starting draft for that agent,
not a deliverable. The fixture-execution guard is no longer a blocker for this plan.

# Outcome

**Hand-over draft, awaiting the operator.** Implementation and review preparation are committed;
this is not approval to enable or a ready-for-review declaration.

| Verified locally                       | Evidence and limit                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final touched survey code              | Case 1 build passed; focused Jest passed 7 suites, 296 tests, including replacement of every usage-count placeholder                                                                                     |
| Prior Stage 1 to 3 implementation      | Earlier Progress records the policy/state/permission tests, invitation host/browser checks and milestone coverage; those observations are not manual workbench proof                                     |
| KQL inputs and expected attribution    | 45 real-shaped fixture rows, closed survey vocabularies, gate order, identifiers/attempt shapes, local reference counts/timings; 11 installations, 10 mature and 1 censored. KQL itself was not executed |
| Privacy packet copy and source hygiene | All 26 English strings checked with the TypeScript AST; six exact license headers, JSDoc and final newline checked. No Case 2 lint result is claimed                                                     |
| Release safety                         | Kill switch stays off, decisions unchanged, no push and no Case 2 commands                                                                                                                               |

| Awaiting the operator         | Required work, not yet verified                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 2 workbench checks      | VS Code 1.106.0+ editor/terminal/Chat focus; Secondary Sidebar placement; reload/no startup restore; moved/hidden/disposed and late/remote reveal behavior; actual milestone-to-visible timing; workbench zoom/high contrast and screen-reader speech. Browser checks are not substitutes |
| KQL engine and real telemetry | Out of scope for this plan: the operator's telemetry agent builds and validates the cohort queries against real storage, starting from the unverified draft in `design.md`                                                                                                                |
| Privacy review                | Return the review outcome; operator records it in decisions.md and approves any requested copy/schema changes. Stable machine IDs remain linkable; the packet does not grant approval                                                                                                     |
| External form                 | Confirm the fixed survey URL is live, English-only and owns the intended answers/consent. Browser API success never confirms submission; no live form confirmation was performed here                                                                                                     |
| Enablement                    | Explicitly approve enabling only after the outstanding checks/reviews, then change the retained kill switch and update survey README status and feature-index row; user-facing notes only if requested                                                                                    |
| Review handoff                | Run Case 2 when ready: l10n (strings changed in earlier stages), prettier-fix, lint, full Jest, build and package. Confirm the required committed AI pre-review evidence. All Case 2 checks remain deferred, not passed                                                                   |

Only the Stage 4 explicit-unverified-record and Outcome guards currently hold. Fixture engine
execution, privacy outcome, live-form approval/enablement and Case 2 guards remain open. Earlier
Stage 2 manual guard remains open too. No external submission linkage or inferred abandonment
claim is introduced by the reports.
