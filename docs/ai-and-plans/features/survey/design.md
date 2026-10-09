---
feature: survey
kind: design
status: active
created: 2026-10-07
code:
    - src/services/survey/**
    - src/utils/feedbackPermission.ts
---

# Survey: Design

Durable design of the survey refresh. Requirements are in the [README](./README.md), binding
choices in [decisions.md](./decisions.md), and the work order in the
[implementation plan](./iterations/01-implementation-plan.md). On conflict, the code wins for
behavior and `decisions.md` wins for intent.

## Modules

| Module                                      | Responsibility                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/feedbackPermission.ts`           | `isFeedbackPermitted()`: `telemetry.telemetryLevel === 'all'`, fail closed. Shared with the Query Insights and Cluster Dashboard feedback cards |
| `src/services/survey/surveyTypes.ts`        | Shared types: feature areas, preconditions, gates, eligibility result, persisted state                                                          |
| `src/services/survey/surveyConfig.ts`       | Decision values, kill switch, form URL, state keys                                                                                              |
| `src/services/survey/surveyPolicy.ts`       | Pure functions: kill switch override, preconditions, ordered gates, local day, cooldowns, sampling value                                        |
| `src/services/survey/surveyState.ts`        | The versioned state object in `globalState`, write on transition only, in-memory fallback on failed writes                                      |
| `src/services/survey/surveyTelemetry.ts`    | The only emitter of survey events; permission check and per-session bounds                                                                      |
| `src/services/survey/surveyDiagnostics.ts`  | Guarded local-only trace formatting through the existing DocumentDB output channel; no telemetry forwarding                                     |
| `src/services/survey/surveyPresentation.ts` | Contract for the invitation surface (Stage 2)                                                                                                   |
| `src/services/survey/SurveyService.ts`      | Orchestration: `recordSurveyActivity(featureArea)`, the shared in-flight promise, reservation, presentation, outcomes, permission withdrawal    |
| `src/services/survey/invitation/`           | Pure HTML builder, localized copy, Secondary Sidebar presenter, and generic host message handling                                               |
| `src/commands/giveFeedback/`                | Explicit user opening through the service, with user-driven retries, bounded survey telemetry, and no automatic command telemetry               |

## Invitation Surface

Stage 2 implements the stable VS Code 1.106.0 Secondary Sidebar contribution (D0018).
Iteration 4 enables the shared code switch in all modes (D0021).
The `documentdb.surveyInvitationActive` context is false on activation and true only for a
live invitation. It gates the view and its otherwise empty container. No HTML or webview
state is restored at startup. The presenter opens the view with `preserveFocus: true`, uses
`show(true)` once resolved, and returns unavailable after at most 1500 ms if it cannot become
visible. The rendered message plus current view visibility jointly trigger `onVisible` once.
Actual editor/terminal focus and moved/hidden behavior are pending operator verification;
see the Stage 2 Progress in the [implementation plan](./iterations/01-implementation-plan.md).

Explicitly hiding the view, signaled by WebviewView `onDidDispose`, counts as `dismissed`.
Collapsing it, switching containers, or temporarily hiding the sidebar does not. Programmatic
closure clears the live invitation before removing its context and calls no outcome callback.
An explicit choice already being saved takes precedence over a simultaneous user hide.
Disposal can also happen when a view moves between containers, so `dismissed` is not proof
of an intentional close. The operator chose to leave this behavior unchanged after the
[R4 API investigation](./iterations/03-pr-review-and-ux-preparation.md#r4-moving-the-view-is-recorded-as-dismissal-).

The HTML has nonce-only script/style CSP, packaged artwork with restricted resource roots,
theme variables, native controls, and a status live region. Stars are an optional native radio
group: no initial selection, no navigation, and no host message when a selection changes.
Fluent outline stars fill gold up to the checked value, with the theme foreground retained as
the identifying outline. D0024 uses 24 px glyphs inside the existing 40 px-high hit areas.
Hover previews a different count without changing the checked value or sending a message;
the text beneath the stars shows that rating's description, with no fixed endpoint labels.
Leaving restores the committed value and its description, or clears the text if unselected.
Keyboard focus also reveals a description without selecting or submitting a rating.
Clicking the selected star again, or pressing Space
while it is focused, clears the selection immediately. Arrow keys retain native radio behavior.
Opening after a reset omits the rating, even if a different star was merely hovered.
The primary "Continue to survey" button (D0027) sends `{ type: 'openForm' }` when
unselected, or `{ type: 'openForm', selectedRating: 4 }` for a chosen value such as four.
The host validates integers 1-5; the telemetry boundary validates again. The
service owns navigation permission, fixed URL, attempts, state, and telemetry. The explanation
uses the actual eligibility count and previous outcome, contains no release sentence, and
includes the English-only note and D0023's selected-rating collection disclosure. The Privacy Statement link opens the fixed
Microsoft URL through `openExternal` without recording a click. A false result or rejection
shows a localized native error notification and leaves the link usable for another explicit click.

The header/body split follows the Cluster Dashboard (D0022): 36 px icon, 18 px semibold title
with 24 px line height, 12 px gap, and 8 px vertical band padding. D0024 widens the aligned
header/content gutters to 16 px and uses 24 px content padding vertically. The
header spans the full width and uses the same VS Code token chain as Fluent's
`colorNeutralBackground2`, with `colorNeutralStroke2` for its bottom rule. Content uses
`--vscode-editor-background` and the editor foreground; it is not hard-coded white.
These mappings come from the [Fluent theme translator](../../../../packages/vscode-ext-webview-fluentui/src/theme/core/themeGenerator.ts).
The lightweight native HTML implementation remains, and long titles wrap at narrow widths.

The question is the first and only content heading (16 px semibold / 24 px line height);
the "Your Feedback Matters" line is removed again (D0025). A 12 px helper note directly
below it says the rating is optional and the survey continues, in English, in the browser.
Collection disclosure remains inside "Why am I seeing this?".

The rating is one compact, centered group (D0027): five 32 px cells with 20 px glyphs and
4 px gaps, with the hovered/selected description centered directly below. The space between
the helper note and the stars started equal to the description slot plus the gap before the
primary button (4 + 18 + 16 = 38 px); the operator then tuned the space above to 34 px by eye. "Continue to survey" spans the content box (max 480 px). "Remind me later" and
"Don't ask again" are VS Code secondary buttons 12 px below that stretch to share the same
box, and stack full-width when the sidebar is too narrow for two. There is no opt-out
explanation line (D0027). All helper text uses one 12 px / 16 px size in the description
foreground, including the disclosure body; nothing is scaled with fractional `em` sizes.
The header logo is an SVG in both variants: the navy-glyph logo by default and a
light-glyph variant in dark and high-contrast dark themes, switched via the webview body
theme classes. Nothing is vertically distributed just to fill the sidebar, and neither
opt-out action is hidden behind the disclosure.

**Resolved UX direction (D0023):** the operator rejected button-hover decoration and chose actual
local selection, accepting that the external survey cannot be prefilled. The selected rating
is captured by permitted opening telemetry, not persisted in local survey state. No selected
value is required or synthesized, and command-based Give Feedback has no rating. The browser
explanation stays small above the stars; selected-rating collection is disclosed in the
native explanation section.

A failed or blocked open is reported by the host in a modal error (D0026); the webview has no
Retry label, status line, or failure copy. The host first tells the webview to re-enable its
controls, so after the modal closes the user can simply choose "Continue to survey" again.
During opening the button stays focusable with `aria-disabled` and a busy guard, rather than
becoming native-disabled and losing focus. Rating inputs/other choice buttons are temporarily
disabled. Reenabling controls does not move focus if the user moved to Privacy Statement.

Give Feedback opens even after permanent opt-out and with the kill switch off. It never clears
opt-out. User-approved browser attempts are not capped, in either the invitation or command.
The command makes one attempt and reports a failure in a modal error without a Retry action
(D0026); the user can run it again. The invitation tries again only on another click. Only the first three permitted/enabled attempts emit the approved
`survey.openForm` event. Later attempts still open the browser and, if successful, apply the normal
outcome/cooldown rules. This command uses native VS Code registration rather than an automatic
telemetry wrapper.

## Evaluation Flow

Developer tooling is isolated in `src/debug/`. Production, Development, and Test use the same
enabled code switch (D0021), without an enablement launch setting or per-mode rule.
Normal behavior does not bypass feedback permission, permanent opt-out, active days,
cooldown, or session suppression.

For a forced preview, `DOCUMENTDB_DEBUG_SURVEY_ALWAYS_INVITE=true` still bypasses every
precondition and eligibility gate for presentation and invitation actions. That preview
override is ignored outside Development. Telemetry independently requires
`isFeedbackPermitted()` even during previews; the survey URL remains unchanged.

Development activation registers `_DocumentDB: Survey: Simulate Milestone` and
`_DocumentDB: Survey: Reset State`, with no category and palette visibility gated by
`documentdb.isDevelopmentMode`. Simulation calls the real activity entry point with
`connection`. Reset closes the invitation, invalidates pending work, waits for queued writes,
deletes `SURVEY_STATE_KEY`, and clears local reservation and session suppression. It can
clear a development opt-out without reloading; there is still no production reset command.

Each call to `recordSurveyActivity(featureArea)` marks a successful, user-requested milestone.

1. **Preconditions**, in order: shared code switch (D0021), feedback permission, permanent opt-out.
   If one fails, nothing happens: no state write, no event. Installations stopped here are
   outside the measurable cohort, not drop-offs.
2. **Cohort entry**: the first admitted call in a host session sends `survey.cohortEntry`.
3. **Active day**: the first call on a new local calendar day (D0003) increments the
   active-day count and saves the state. Further calls on the same day write nothing.
4. **Gates**, in order: `sampling`, `activeDays`, `cooldown`, `sessionSuppression`. After the
   first blocked gate, later gates are `notEvaluated`. The snapshot is sent as
   `survey.eligibility`.
5. **Presentation**: an eligible result reserves the invitation for this host session before
   any await, rechecks permission, and presents right away (D0012). If no presenter is
   available, `survey.presentationDeferred` is sent and the next milestone tries again.

Evaluation runs only on the first call in a session, on a new active day, or after a state
change (an outcome, a deferral, or a permission change). All work runs through one shared
in-flight promise, so concurrent calls evaluate once; calls that arrive while it is pending are
covered by it.

The "DocumentDB: Give Feedback" command (D0015) opens the form whenever the
user asks, even after "Never again". It sends `survey.openForm` with trigger `command` only when
the survey is enabled and permitted, applies the 180-day cooldown only when also not opted out,
and never clears the opt-out.

### Gates

| Gate                 | Passes when                                                            | Source              |
| -------------------- | ---------------------------------------------------------------------- | ------------------- |
| `sampling`           | The installation's sampling value is below the sampling fraction (1.0) | D0008               |
| `activeDays`         | At least 3 active days                                                 | D0003, D0004        |
| `cooldown`           | No `nextEligibleAt`, or it has passed                                  | D0005, D0006, D0007 |
| `sessionSuppression` | No invitation was reserved or shown in this host session               | README              |

The sampling value is derived locally from the machine ID with SHA-256 and never sent.

The Query Insights exclusion for RU accounts (`QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU`)
controls whether that feature's feedback card renders. It is **not** a survey gate: RU users
reach the survey through the same preconditions and gates as everyone else.

### Outcomes and Cooldowns

| Outcome      | Meaning                                                        | Effect on state                              |
| ------------ | -------------------------------------------------------------- | -------------------------------------------- |
| `opened`     | The external form opened (browser API success, not submission) | Cooldown of 180 days (D0006)                 |
| `askLater`   | "Remind me later"                                              | Cooldown of 14 days (D0005)                  |
| `dismissed`  | Closed without a choice                                        | Its own constant, 14 days (D0007)            |
| `neverAgain` | "Don't ask again"                                              | Permanent opt-out; nothing clears it (D0002) |

First visibility starts a 14-day cooldown without recording an outcome (D0019). Explicit
timed outcomes keep the later cooldown end, so a later dismissal or Ask me later cannot shorten
an opened-form cooldown. A failed open does not set the 180-day acceptance cooldown; the
visibility cooldown remains and the invitation stays open so the user can try again. An ignored invitation
is `invitationShown` without `invitationResolved`, never an invented `dismissed` outcome.
If saving the opt-out fails, it still applies in memory for the session and a modal error says
saving failed (D0027). There is no Retry; after a restart the user may be invited again.

### Persisted State

One object under `globalState` key `documentdb.survey.state`:

| Field            | Type                                         | Meaning                                                               |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `version`        | `1`                                          | Schema version                                                        |
| `activeDayCount` | number                                       | Distinct local days with a milestone                                  |
| `lastActiveDay`  | `YYYY-MM-DD` or absent                       | Last counted day                                                      |
| `lastOutcome`    | `opened`, `askLater`, `dismissed`, or absent | Explains a returning invitation; visibility alone leaves it unchanged |
| `nextEligibleAt` | ISO 8601 or absent                           | End of the current cooldown                                           |
| `optedOutAt`     | ISO 8601 or absent                           | Present means permanently opted out                                   |

Per D0011, no legacy value is read. The five legacy keys under
`ms-azuretools.vscode-documentdb.survey/` are deleted after the new state is first saved.
A malformed or unknown-version value starts from the empty state but keeps any `optedOutAt`.

Each VS Code window runs its own store over the same key. Before every read, transition, and
write, the store merges the stored value into memory: the opt-out is sticky (earliest kept), the
active-day count and last day take the maximum, and the later cooldown wins together with its
outcome. This protects against sequential stale-window updates, but the merge and write are
not an atomic cross-window operation. Overlapping writes can still erase a saved opt-out or
longer cooldown; see [review finding R1](./iterations/03-pr-review-and-ux-preparation.md#r1-concurrent-writes-can-erase-never-again-).
The operator accepted this rare last-writer outcome during review; no cross-window coordination
is planned for this PR. Existing sequential merge protections and the normal permanent-opt-out
behavior remain unchanged. There is no immediate notification when an overlapping write wins.

## Local diagnostics and review follow-ups

The [operator-triaged review](./iterations/03-pr-review-and-ux-preparation.md#operator-triage---2026-10-08)
records the rationale for unrestricted explicit retries (R2), the privacy-link failure
notification (R3), and local diagnostics (R5). These are implemented in the iteration's source
commits; the review ledger records their validation status.

`traceSurvey` lazily formats localized `[Survey]` messages for `ext.outputChannel.trace`.
An unavailable/throwing logger or formatting failure must not interfere with the survey or
the successful feature operation. Set the **DocumentDB for VS Code** output channel to
**Trace** to see these messages.

The service traces admitted feature-area usage, new versus already-counted active days and
the required threshold, same-day/in-flight evaluation skips, admission and eligibility gates,
cooldown expiry/remaining milliseconds, presentation, permission withdrawal, generic outcomes,
and persistence success/failure. The presenter distinguishes unavailable destinations,
reveal timeout, and reveal failure. Logging does not collect activity when admission fails,
change policy, or expose rating/element identities or database/connection details.

These are local diagnostics, not telemetry events. Counts, dates, and cooldown deadlines
remain excluded from the survey event schema below. Its three-attempt budget bounds
**reported opening events**, not the number of times a user may try to open the browser.

## Event Schema

Survey telemetry starts fresh (D0001). Events are sent only from `surveyTelemetry.ts`, only when
`isFeedbackPermitted()` is true at the moment of emission, and never while the kill switch is
off. Bounds apply per extension host session; an event withheld for lack of permission does not
count against its bound. Each `report*` method also rejects any value outside its vocabulary
and any `invitationSessionId` that is not a UUID.

### Common Properties

| Property              | Value                                 | On                                                                                |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `surveyCampaignId`    | `documentdb-satisfaction-1` (D0009)   | Every event                                                                       |
| `surveyPolicyVersion` | `1`; bumped when a gate value changes | Every event                                                                       |
| `invitationSessionId` | Random UUID per invitation            | `invitationShown`, `invitationResolved`, and `openForm` with trigger `invitation` |

The framework adds machine/session identifiers, extension metadata, `result`, and measurement
`duration`. The queries below use the README's `VSCodeMachineId` and `VSCodeSessionId` warehouse
convention; those dimension names and the event prefix remain unverified against real events.
The installed reporter documents lower-case `common.*` fields too; see the Privacy Review Packet.
Cohort queries use the machine ID for installations and the machine and session pair for sessions.

### Events

| Event                         | Properties and measurements                                                    | Vocabulary                                                                                                                 | Bound                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `survey.cohortEntry`          | `featureArea`                                                                  | `connection`, `dataBrowsing`, `queryPlayground`, `interactiveShell`, `dataManagement`, `queryInsights`, `clusterDashboard` | Once per host session                                                                |
| `survey.eligibility`          | `gate_sampling`, `gate_activeDays`, `gate_cooldown`, `gate_sessionSuppression` | `passed`, `blocked`, `notEvaluated`                                                                                        | First evaluation per host session, then only when a gate status or `overall` changes |
|                               | `overall`                                                                      | `eligible`, `blocked`                                                                                                      |                                                                                      |
|                               | `firstBlockingGate`                                                            | A gate ID, or `none`                                                                                                       |                                                                                      |
|                               | `trigger`                                                                      | `sessionStart`, `newActiveDay`, `stateChange`                                                                              |                                                                                      |
| `survey.presentationDeferred` | `reason`                                                                       | `presenterUnavailable`, `presentationFailed`                                                                               | Once per changed reason; reset when an invitation is shown                           |
| `survey.invitationShown`      | `isReminder`                                                                   | `true`, `false`                                                                                                            | Once per invitation, only when rendered and visible                                  |
| `survey.openForm`             | `trigger`                                                                      | `invitation`, `command`                                                                                                    | Once per attempt, at most 3 attempts per invitation or command call                  |
|                               | `openResult`                                                                   | `success`, `failure`                                                                                                       |                                                                                      |
|                               | measurement `attempt`                                                          | 1 to 3                                                                                                                     |                                                                                      |
|                               | measurement `selectedRating`                                                   | Optional integer 1-5; invitation trigger only, omitted when no rating was selected                                         | Same three-attempt event budget; selection itself emits nothing                      |
| `survey.invitationResolved`   | `outcome`                                                                      | `opened`, `askLater`, `neverAgain`, `dismissed`                                                                            | Once per invitation; never after permission withdrawal                               |
|                               | `wasVisible`                                                                   | `true`, `false`                                                                                                            |                                                                                      |

`openResult` is not named `result` because the framework sets `result` on every event.

`selectedRating` is a numeric measurement, not a string property or a zero sentinel. The
existing event is emitted after the browser attempt resolves, so ratings can accompany
`openResult=success` or `failure`. A rating changed before another invitation attempt applies to
that attempt; the three-reported-attempt limit still applies even though attempts are unlimited.
Give Feedback always reports attempt 1 because it no longer loops.
The score is feedback submitted from the invitation, not proof of an external-form answer
or submission. Treat repeated attempts separately when analyzing rating distributions.

### Never Sent

Hovered stars, selection-only events, element IDs, keyboard keys, the form URL, the active-day
count, dates, the sampling value, database or collection names, external-form answers, and
query text. D0023's submitted `selectedRating` is the explicit exception to the former
no-rating boundary. The form URL never carries identifiers or the rating. Clicks on the
Privacy Statement link are not recorded.

### Permission Withdrawal

When `telemetry.telemetryLevel` leaves `all`, the service cancels pending work and disposes any
invitation. That closure records no outcome and sends no event, and an invitation that was already
reserved does not reappear in the same session. If the user had already chosen "Never again" and its save fails,
the local modal error still appears, because it is not telemetry. Opening the form
rechecks permission first.

## Cohort KQL

Three reports share the source and preparation below. Paste that preparation followed by **one**
report. Change only `let Source = FixtureEvents;` to `let Source = customEvents;` to run identical
report text against Application Insights. Set the dates for a real reporting period afterwards.
The suffix normalization accepts the illustrative `documentDB/` prefix, a different framework
prefix, or no prefix. It selects only the six new events, not the retired survey schema (D0001).

An installation is a machine ID, not a person. Enrollment is its first **observed** `cohortEntry`
for a campaign/policy in the available source, not installation time. Read available history
before the enrollment window to avoid relabeling known returners as new. Report by UTC enrollment
day, campaign, policy, and `mature`; the local active-day counter is never reconstructed. Follow-up
is exactly 14 days from enrollment, bounded by `AsOf`. Recent enrollments are censored, not failed.
Permission, kill-switch and permanent-opt-out preconditions exclude installations before enrollment.

Gate counts are distinct installations with **any** such observation in the window. An installation
can both block and later pass, so passed plus blocked need not equal reached. `notEvaluated` is
reported separately and never enters a gate's pass-rate denominator. Blocked sessions/days are
machine/session and machine/UTC-day observations, not exact local activity counts. Eligible but
not shown is installation-level: eligibility and deferral events have no invitation ID. Outcomes
and ignored invitations are joined by machine, campaign, policy and `invitationSessionId`, not
by session alone. Manual command opens are separate from invitation progression.

### Fixture Source and Shared Preparation

Fixture policy `2` models a hypothetical increased day threshold; policy `1` models the current
schema. No threshold/count field is emitted. On Sep 1 three of four installations block at
`activeDays`; one opens after a failed attempt. Sep 2 returners previously chose Ask me later or
dismissed and then block at cooldown. Sep 3 two eligible installations defer without being shown.
Sep 4 has one ignored visible invitation and a later cooldown block (D0019). Sep 5 exercises a
terminal opt-out. Sep 30 supplies a censored enrollment. Two rows with missing IDs must disappear.
Helper columns below are projected away: `FixtureEvents` has exactly the `customEvents` input
shape used by the reports, including string properties and numeric `customMeasurements.attempt`.
UUIDs are synthetic, and no fixture-only reason, gate or outcome is added to the event vocabulary.

```kql
let FixtureEvents = datatable(
   timestamp:datetime, machine:string, session:string, policy:string,
   event:string, details:dynamic, customMeasurements:dynamic
)[
   datetime(2026-09-01T09:00:00Z), 'day-a', 'a1', '2', 'survey.cohortEntry', dynamic({"featureArea":"dataBrowsing"}), dynamic({}),
   datetime(2026-09-01T09:00:01Z), 'day-a', 'a1', '2', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"activeDays","gate_sampling":"passed","gate_activeDays":"blocked","gate_cooldown":"notEvaluated","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-02T09:00:00Z), 'day-a', 'a2', '2', 'survey.cohortEntry', dynamic({"featureArea":"dataBrowsing"}), dynamic({}),
   datetime(2026-09-02T09:00:01Z), 'day-a', 'a2', '2', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"activeDays","gate_sampling":"passed","gate_activeDays":"blocked","gate_cooldown":"notEvaluated","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-01T09:00:00Z), 'day-b', 'b1', '2', 'survey.cohortEntry', dynamic({"featureArea":"queryPlayground"}), dynamic({}),
   datetime(2026-09-01T09:00:01Z), 'day-b', 'b1', '2', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"activeDays","gate_sampling":"passed","gate_activeDays":"blocked","gate_cooldown":"notEvaluated","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-01T09:00:00Z), 'day-c', 'c1', '2', 'survey.cohortEntry', dynamic({"featureArea":"interactiveShell"}), dynamic({}),
   datetime(2026-09-01T09:00:01Z), 'day-c', 'c1', '2', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"activeDays","gate_sampling":"passed","gate_activeDays":"blocked","gate_cooldown":"notEvaluated","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-01T09:00:00Z), 'day-pass', 'p1', '2', 'survey.cohortEntry', dynamic({"featureArea":"connection"}), dynamic({}),
   datetime(2026-09-01T09:00:01Z), 'day-pass', 'p1', '2', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-01T09:01:00Z), 'day-pass', 'p1', '2', 'survey.invitationShown', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000001","isReminder":"false"}), dynamic({}),
   datetime(2026-09-01T09:02:00Z), 'day-pass', 'p1', '2', 'survey.openForm', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000001","trigger":"invitation","openResult":"failure"}), dynamic({"attempt":1}),
   datetime(2026-09-01T09:03:00Z), 'day-pass', 'p1', '2', 'survey.openForm', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000001","trigger":"invitation","openResult":"success"}), dynamic({"attempt":2}),
   datetime(2026-09-01T09:03:01Z), 'day-pass', 'p1', '2', 'survey.invitationResolved', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000001","outcome":"opened","wasVisible":"true"}), dynamic({}),
   datetime(2026-09-02T09:00:00Z), 'later', 'l1', '1', 'survey.cohortEntry', dynamic({"featureArea":"dataManagement"}), dynamic({}),
   datetime(2026-09-02T09:00:01Z), 'later', 'l1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-02T09:01:00Z), 'later', 'l1', '1', 'survey.invitationShown', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000002","isReminder":"true"}), dynamic({}),
   datetime(2026-09-02T09:02:00Z), 'later', 'l1', '1', 'survey.invitationResolved', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000002","outcome":"askLater","wasVisible":"true"}), dynamic({}),
   datetime(2026-09-03T09:00:00Z), 'later', 'l2', '1', 'survey.cohortEntry', dynamic({"featureArea":"dataManagement"}), dynamic({}),
   datetime(2026-09-03T09:00:01Z), 'later', 'l2', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"cooldown","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"blocked","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-02T09:00:00Z), 'closed', 'd1', '1', 'survey.cohortEntry', dynamic({"featureArea":"queryInsights"}), dynamic({}),
   datetime(2026-09-02T09:00:01Z), 'closed', 'd1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-02T09:01:00Z), 'closed', 'd1', '1', 'survey.invitationShown', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000003","isReminder":"false"}), dynamic({}),
   datetime(2026-09-02T09:02:00Z), 'closed', 'd1', '1', 'survey.invitationResolved', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000003","outcome":"dismissed","wasVisible":"true"}), dynamic({}),
   datetime(2026-09-03T09:00:00Z), 'closed', 'd2', '1', 'survey.cohortEntry', dynamic({"featureArea":"queryInsights"}), dynamic({}),
   datetime(2026-09-03T09:00:01Z), 'closed', 'd2', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"cooldown","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"blocked","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-03T09:00:00Z), 'defer-a', 'f1', '1', 'survey.cohortEntry', dynamic({"featureArea":"clusterDashboard"}), dynamic({}),
   datetime(2026-09-03T09:00:01Z), 'defer-a', 'f1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-03T09:00:02Z), 'defer-a', 'f1', '1', 'survey.presentationDeferred', dynamic({"reason":"presenterUnavailable"}), dynamic({}),
   datetime(2026-09-03T09:00:00Z), 'defer-b', 'f2', '1', 'survey.cohortEntry', dynamic({"featureArea":"clusterDashboard"}), dynamic({}),
   datetime(2026-09-03T09:00:01Z), 'defer-b', 'f2', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-03T09:00:02Z), 'defer-b', 'f2', '1', 'survey.presentationDeferred', dynamic({"reason":"presentationFailed"}), dynamic({}),
   datetime(2026-09-04T09:00:00Z), 'ignored', 'i1', '1', 'survey.cohortEntry', dynamic({"featureArea":"dataBrowsing"}), dynamic({}),
   datetime(2026-09-04T09:00:01Z), 'ignored', 'i1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-04T09:01:00Z), 'ignored', 'i1', '1', 'survey.invitationShown', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000004","isReminder":"false"}), dynamic({}),
   datetime(2026-09-05T09:00:00Z), 'ignored', 'i2', '1', 'survey.cohortEntry', dynamic({"featureArea":"dataBrowsing"}), dynamic({}),
   datetime(2026-09-05T09:00:01Z), 'ignored', 'i2', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"cooldown","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"blocked","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-05T09:00:00Z), 'optout', 'n1', '1', 'survey.cohortEntry', dynamic({"featureArea":"interactiveShell"}), dynamic({}),
   datetime(2026-09-05T09:00:01Z), 'optout', 'n1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"eligible","firstBlockingGate":"none","gate_sampling":"passed","gate_activeDays":"passed","gate_cooldown":"passed","gate_sessionSuppression":"passed"}), dynamic({}),
   datetime(2026-09-05T09:01:00Z), 'optout', 'n1', '1', 'survey.invitationShown', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000005","isReminder":"false"}), dynamic({}),
   datetime(2026-09-05T09:02:00Z), 'optout', 'n1', '1', 'survey.invitationResolved', dynamic({"invitationSessionId":"00000000-0000-4000-8000-000000000005","outcome":"neverAgain","wasVisible":"true"}), dynamic({}),
   datetime(2026-09-30T09:00:00Z), 'recent', 'r1', '1', 'survey.cohortEntry', dynamic({"featureArea":"connection"}), dynamic({}),
   datetime(2026-09-30T09:00:01Z), 'recent', 'r1', '1', 'survey.eligibility', dynamic({"trigger":"sessionStart","overall":"blocked","firstBlockingGate":"activeDays","gate_sampling":"passed","gate_activeDays":"blocked","gate_cooldown":"notEvaluated","gate_sessionSuppression":"notEvaluated"}), dynamic({}),
   datetime(2026-09-01T09:00:00Z), '', 'missing-machine', '1', 'survey.cohortEntry', dynamic({"featureArea":"connection"}), dynamic({}),
   datetime(2026-09-01T09:00:00Z), 'missing-session', '', '1', 'survey.cohortEntry', dynamic({"featureArea":"connection"}), dynamic({})
]
| project timestamp, name = strcat('documentDB/', event),
   customDimensions = bag_merge(details, bag_pack(
      'VSCodeMachineId', machine, 'VSCodeSessionId', session,
      'surveyCampaignId', 'documentdb-satisfaction-1', 'surveyPolicyVersion', policy,
      'result', 'Succeeded')),
   customMeasurements = bag_merge(customMeasurements, dynamic({"duration":0.001}));
let AsOf = datetime(2026-10-07T00:00:00Z);
let EnrollmentStart = datetime(2026-09-01T00:00:00Z);
let EnrollmentEnd = datetime(2026-10-01T00:00:00Z);
let FollowUp = 14d;
let Source = FixtureEvents;
let Events = materialize(Source
   | where timestamp <= AsOf
   | extend event = extract(@"(survey\.[^/]+)$", 1, name), dimensions = customDimensions
   | where event in ('survey.cohortEntry', 'survey.eligibility', 'survey.presentationDeferred',
      'survey.invitationShown', 'survey.openForm', 'survey.invitationResolved')
   | extend machine = tostring(dimensions.VSCodeMachineId), session = tostring(dimensions.VSCodeSessionId),
      campaign = tostring(dimensions.surveyCampaignId), policy = tostring(dimensions.surveyPolicyVersion),
      invitation = tostring(dimensions.invitationSessionId)
   | where isnotempty(machine) and isnotempty(session) and isnotempty(campaign) and isnotempty(policy));
let Enrollments = materialize(Events
   | where event == 'survey.cohortEntry'
   | summarize enrolledAt = min(timestamp) by machine, campaign, policy
   | where enrolledAt >= EnrollmentStart and enrolledAt < EnrollmentEnd
   | extend cohort = startofday(enrolledAt), mature = enrolledAt + FollowUp <= AsOf);
let WindowEvents = materialize(Events
   | join kind=inner Enrollments on machine, campaign, policy
   | where timestamp >= enrolledAt and timestamp <= enrolledAt + FollowUp);
```

### Report 1: Gate Attribution

```kql
WindowEvents
| where event == 'survey.eligibility'
| mv-expand gate = dynamic(['sampling', 'activeDays', 'cooldown', 'sessionSuppression']) to typeof(string)
| extend status = tostring(dimensions[strcat('gate_', gate)])
| summarize reached = countif(status in ('passed', 'blocked')) > 0,
   passed = countif(status == 'passed') > 0, blocked = countif(status == 'blocked') > 0,
   untested = countif(status == 'notEvaluated') > 0,
   firstBlock = countif(status == 'blocked' and tostring(dimensions.firstBlockingGate) == gate) > 0,
   blockedSessions = make_set_if(session, status == 'blocked'),
   blockedDays = make_set_if(startofday(timestamp), status == 'blocked')
   by cohort, campaign, policy, mature, machine, gate
| summarize reaching = countif(reached), passing = countif(passed), blocking = countif(blocked),
   notEvaluated = countif(untested), firstBlocking = countif(firstBlock),
   observedBlockedSessions = sum(array_length(blockedSessions)),
   observedBlockedDays = sum(array_length(blockedDays))
   by cohort, campaign, policy, mature, gate
| extend passRate = iff(reaching == 0, real(null), todouble(passing) / reaching)
| order by cohort asc, policy asc, gate asc
```

### Report 2: Presentation and Outcomes

`occurrences` counts events for reasons, outcomes and opening attempts, but invitation lifetimes
for unresolved/shown invitations. `installations` always counts distinct machines in each group.
An ignored invitation means shown without observed resolution **within this window**, not proof
of intentional ignoring. Delivery loss and permission withdrawal can produce the same pattern.
Latest gate state distinguishes not-yet-qualified and cooldown from permanent opt-out. A single
observed session is reported explicitly; missing later observations have no inferred cause.

```kql
let InvitationCounts = WindowEvents
   | where isnotempty(invitation)
   | summarize shown = countif(event == 'survey.invitationShown'),
      resolved = countif(event == 'survey.invitationResolved')
      by cohort, campaign, policy, mature, machine, invitation
   | summarize shownInvitations = countif(shown > 0),
      unresolvedInvitations = countif(shown > 0 and resolved == 0)
      by cohort, campaign, policy, mature, machine;
let LatestGate = WindowEvents
   | where event == 'survey.eligibility'
   | summarize arg_max(timestamp, dimensions) by machine, campaign, policy
   | project machine, campaign, policy, lastBlock = tostring(dimensions.firstBlockingGate);
let Stages = WindowEvents
   | summarize eligible = countif(event == 'survey.eligibility' and tostring(dimensions.overall) == 'eligible'),
      sessions = make_set(session) by cohort, campaign, policy, mature, machine
   | join kind=leftouter InvitationCounts on cohort, campaign, policy, mature, machine
   | join kind=leftouter LatestGate on machine, campaign, policy
   | extend shownInvitations = coalesce(shownInvitations, 0), unresolvedInvitations = coalesce(unresolvedInvitations, 0)
   | extend metrics = bag_pack('enrolled', 1, 'eligible', tolong(eligible > 0),
      'shown', shownInvitations, 'eligibleButNotShown', tolong(eligible > 0 and shownInvitations == 0),
      'shownWithoutResolved', unresolvedInvitations,
      'latestNotYetQualified', tolong(lastBlock == 'activeDays'),
      'latestCooldown', tolong(lastBlock == 'cooldown'),
      'noReturnSessionObserved', tolong(array_length(sessions) == 1))
   | mv-expand metric = bag_keys(metrics) to typeof(string)
   | project cohort, campaign, policy, mature, machine, report = 'stage', metric, occurrences = tolong(metrics[metric]);
let Actions = WindowEvents
   | where event in ('survey.presentationDeferred', 'survey.invitationResolved', 'survey.openForm')
   | extend report = case(event == 'survey.presentationDeferred', 'deferral',
      event == 'survey.invitationResolved', 'outcome', 'openForm'),
      metric = case(event == 'survey.presentationDeferred', tostring(dimensions.reason),
      event == 'survey.invitationResolved', tostring(dimensions.outcome),
      strcat(tostring(dimensions.trigger), '/', tostring(dimensions.openResult)))
   | summarize occurrences = count() by cohort, campaign, policy, mature, machine, report, metric;
union Stages, Actions
| summarize installations = countif(occurrences > 0), occurrences = sum(occurrences)
   by cohort, campaign, policy, mature, report, metric
| order by cohort asc, report asc, metric asc
```

### Report 3: Time to Next Stage

Only forward observations count. An eligible installation is the denominator for eligible-to-shown,
not every enrolled installation. Opened here requires successful **invitation** navigation, not a
manual command and not form submission. Delays describe observed converters only; unobserved
targets and censored source installations remain visible beside them, without imputed delays.

```kql
let FirstShown = WindowEvents
   | where event == 'survey.invitationShown' and isnotempty(invitation)
   | summarize arg_min(timestamp, invitation) by machine, campaign, policy
   | project machine, campaign, policy, shown = timestamp, firstInvitation = invitation;
let Starts = WindowEvents
   | summarize enrolled = min(enrolledAt),
      eligible = minif(timestamp, event == 'survey.eligibility' and tostring(dimensions.overall) == 'eligible')
      by cohort, campaign, policy, mature, machine
   | join kind=leftouter FirstShown on machine, campaign, policy
   | extend starts = bag_pack('enrolledToEligible', enrolled, 'eligibleToShown', eligible,
      'shownToOpened', shown, 'shownToResolved', shown)
   | mv-expand transition = bag_keys(starts) to typeof(string)
   | extend fromAt = todatetime(starts[transition])
   | where isnotnull(fromAt)
   | project cohort, campaign, policy, mature, machine, transition, fromAt, firstInvitation;
Starts
| join kind=inner WindowEvents on machine, campaign, policy
| extend target = case(
   transition == 'enrolledToEligible', event == 'survey.eligibility' and tostring(dimensions.overall) == 'eligible',
   transition == 'eligibleToShown', event == 'survey.invitationShown',
   transition == 'shownToOpened', event == 'survey.openForm' and invitation == firstInvitation and tostring(dimensions.trigger) == 'invitation' and tostring(dimensions.openResult) == 'success',
   event == 'survey.invitationResolved' and invitation == firstInvitation)
| summarize nextAt = minif(timestamp, target and timestamp >= fromAt)
   by cohort, campaign, policy, mature, machine, transition, fromAt
| extend hours = (nextAt - fromAt) / 1h
| summarize reaching = count(), converted = countif(isnotnull(nextAt)),
   targetNotObserved = countif(isnull(nextAt)), meanHours = avg(hours),
   p50Hours = percentile(hours, 50), p90Hours = percentile(hours, 90)
   by cohort, campaign, policy, mature, transition
| extend censored = iff(mature, 0, reaching)
| order by cohort asc, transition asc
```

### Expected Fixture Results and Verification

These are hand-derived acceptance expectations, **not engine results**. As of 2026-10-07,
Kusto tools are advertised as deferred, but this session has no tool-loading capability to make
them callable. No usable Kusto engine was available; all three reports remain unverified against
a live engine. Event prefix, table and warehouse dimension names also remain explicitly unverified
against real emitted Application Insights events. Local schema matching is not live verification.

Local checks on 2026-10-07 parsed all 45 fixture rows, checked the source event/field vocabularies,
gate order and UUID/attempt shapes, and calculated the expected enrollment, gate, lifecycle and
timing observations below. They found 11 installations, 10 mature and 1 censored. A TypeScript
AST check confirmed all 26 English invitation strings are quoted in the packet. These checks
validate fixture construction and hand-derived expectations, not the KQL engine or its syntax.

| Cohort / policy                       | Report 1 attribution                                                                                                                                                        | Report 2 attribution                                                                                   | Report 3 attribution                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sep 1 / `2`, 4 mature installations   | `activeDays`: reaching 4, passing 1, blocking/firstBlocking 3, pass rate 0.25; 4 blocked sessions and 4 observed machine-days. Cooldown: reaching/passing 1, notEvaluated 3 | eligible/shown/opened 1; invitation failure 1 then success 1; eligibleButNotShown 0                    | enrolledToEligible: reaching 4, converted 1, unobserved 3; converter 1 second. eligibleToShown 1/1, 59 seconds; shownToOpened 1/1, 2 minutes; shownToResolved 1/1, 121 seconds |
| Sep 2 / `1`, 2 mature returners       | cooldown: reaching/passing/blocking 2, firstBlocking 2; sessionSuppression notEvaluated 2. Both previously passed cooldown, so its any-observed pass rate is 1.0            | askLater 1, dismissed 1; latestCooldown 2; no unresolved invitations                                   | eligibleToShown 2/2, 59 seconds; shownToResolved 2/2, 1 minute; shownToOpened 0/2                                                                                              |
| Sep 3 / `1`, 2 mature installations   | all four gates reaching/passing 2; no blocked gate                                                                                                                          | eligibleButNotShown 2; presenterUnavailable 1, presentationFailed 1; shown 0                           | eligibleToShown reaching 2, converted 0, targetNotObserved 2: presentation is the missing stage                                                                                |
| Sep 4 / `1`, 1 mature installation    | cooldown firstBlocking 1 on return; sessionSuppression notEvaluated 1                                                                                                       | shownWithoutResolved 1; no dismissed/askLater event; latestCooldown 1                                  | eligibleToShown 1/1; shownToOpened and shownToResolved each 0/1: unresolved visibility, not a recorded choice                                                                  |
| Sep 5 / `1`, 1 mature installation    | all gates pass                                                                                                                                                              | neverAgain 1, shownWithoutResolved 0; future precondition suppression is not a repeated gate rejection | shownToResolved 1/1, 1 minute; shownToOpened 0/1                                                                                                                               |
| Sep 30 / `1`, 1 censored installation | activeDays blocked 1 in the partial window                                                                                                                                  | enrolled 1 with mature=false, not pooled with mature drop-offs                                         | enrolledToEligible reaching 1, targetNotObserved 1, censored 1; no delay imputed                                                                                               |

There are 11 enrolled installations total (10 mature, 1 censored); neither missing-ID row enrolls.
The Sep 2 example deliberately demonstrates why any-observed pass rates cannot diagnose returning
cooldown alone: firstBlocking and latestCooldown must be read alongside them. Separate submission
totals from the external form remain unjoined. No event identifies permission withdrawal,
uninstall, transmission loss or why an installation stopped returning.

## Privacy Review Packet

**Status: awaiting operator review, not approved.** This inventories the implemented schema and
copy, not a new consent mechanism. Events and the closed survey vocabularies are enforced in
`surveyTelemetry.ts`; identifiers/configuration values are not answer fields. The Event Schema
tables above supply the bounds. No extra click/RPC instrumentation is attached to the invitation.

**D0023 update:** this packet now includes an optional satisfaction answer, `selectedRating`,
on invitation opening telemetry. The visible notice explicitly describes that collection.
It is linkable through the framework's existing identifiers; do not describe it as anonymous.
An operator request to implement collection is not a claim of independent privacy approval.

### Survey-Owned Fields

| Event suffix                  | Properties (all strings) and closed vocabulary                                                                                                                                                                                                                                                                | Measurements                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every event                   | `surveyCampaignId`: currently `documentdb-satisfaction-1`; `surveyPolicyVersion`: currently `1`, changed explicitly with policy. Configuration categories, not user input                                                                                                                                     | None common to the survey                                                                                                                        |
| `survey.cohortEntry`          | `featureArea`: `connection`, `dataBrowsing`, `queryPlayground`, `interactiveShell`, `dataManagement`, `queryInsights`, `clusterDashboard`                                                                                                                                                                     | None                                                                                                                                             |
| `survey.eligibility`          | `gate_sampling`, `gate_activeDays`, `gate_cooldown`, `gate_sessionSuppression`: each `passed`, `blocked`, `notEvaluated`; `overall`: `eligible`, `blocked`; `firstBlockingGate`: `sampling`, `activeDays`, `cooldown`, `sessionSuppression`, `none`; `trigger`: `sessionStart`, `newActiveDay`, `stateChange` | None                                                                                                                                             |
| `survey.presentationDeferred` | `reason`: `presenterUnavailable`, `presentationFailed`                                                                                                                                                                                                                                                        | None                                                                                                                                             |
| `survey.invitationShown`      | `invitationSessionId`: random UUID per invitation, not a closed category; `isReminder`: `true`, `false`                                                                                                                                                                                                       | None                                                                                                                                             |
| `survey.openForm`             | `trigger`: `invitation`, `command`; `openResult`: `success`, `failure`; `invitationSessionId`: UUID only for `invitation`, absent for `command`                                                                                                                                                               | `attempt`: integer 1, 2 or 3; optional `selectedRating`: integer 1-5, only for an invitation with a chosen rating. Both are numeric measurements |
| `survey.invitationResolved`   | `invitationSessionId`: same invitation UUID; `outcome`: `opened`, `askLater`, `dismissed`, `neverAgain`; `wasVisible`: `true`, `false`                                                                                                                                                                        | None                                                                                                                                             |

`openResult=failure` normally has framework `result=Succeeded`: the wrapper emits an already
classified outcome rather than throwing a browser error. `opened` means the browser API returned
success, never that the user answered or submitted. Visibility alone records no outcome (D0019).

### Framework and Transport Fields

Not all framework fields have closed vocabularies. Do not claim identifiers or version strings
are finite categories. The installed azext wrapper and extension-telemetry reporter were inspected
locally; warehouse names, transformations and actual delivered fields still need live confirmation.

| Field / identifier                                                                                                                  | Value and purpose                                                                                                                                                                                  | Review boundary                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VSCodeMachineId`, `VSCodeSessionId`                                                                                                | README/skill warehouse convention for installation and host-session joins                                                                                                                          | Stable machine ID is linkable; session ID is not an invitation. Live dimension mapping unverified                                                                        |
| `common.vscodemachineid`, `common.vscodesessionid`                                                                                  | Reporter-documented common machine/session fields                                                                                                                                                  | Do not silently substitute these into KQL before confirming the warehouse mapping                                                                                        |
| `common.extname`, `common.extversion`                                                                                               | Extension identity/version                                                                                                                                                                         | Rollout metadata, not answers; versions are open strings                                                                                                                 |
| `common.vscodeversion`, `common.vscodecommithash`, `common.product`, `common.uikind`, `common.remotename`, `common.isnewappinstall` | VS Code build/product/UI/remote/install metadata supplied by the core logger                                                                                                                       | System metadata; exact values/availability require live verification                                                                                                     |
| `common.os`, `common.nodeArch`, `common.platformversion`, `common.telemetryclientversion`                                           | Reporter OS/architecture/version/client metadata                                                                                                                                                   | System metadata, not a user profile supplied by this feature                                                                                                             |
| `result`, `isActivationEvent`, `lastStep`, `error`, `errorMessage`, `stack`                                                         | Wrapper initializes `Succeeded`, `false`, and empty step/error/stack strings. General result vocabulary: `Succeeded`, `Failed`, `Canceled`; failures can add `errorMessageV2`, `suppressTelemetry` | Normal survey emission callback copies only approved fields. Error details are not passed from browser navigation; unexpected framework failures remain a review concern |
| `duration`                                                                                                                          | Numeric wrapper duration; installed azext implementation uses seconds                                                                                                                              | Measures the telemetry callback, not invitation dwell time or stage delay; KQL uses event timestamps                                                                     |
| `name`, `timestamp`, transport envelope                                                                                             | Framework/core event prefix and service timestamp/context                                                                                                                                          | Suffix normalization tolerates a prefix. No survey-specific context tags or additional correlation IDs are added; verify envelope metadata with real events              |

### Exclusions and Permission

| Boundary                 | Implemented behavior                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted rating         | Optional integer 1-5 on an explicit invitation opening, subject to permission and event bounds. No default/zero, no emission on selection alone, no local-state persistence or trace output                                              |
| Never sent by the survey | Hover, clicked-element identity, keyboard key, external-form answers, name, form URL, exact active-day count/history/dates, sampling value, database/collection names, query text, credentials or connection strings                     |
| Local only               | Active-day count and dates, opt-out/cooldown state, sampling calculation, eligibility explanation. Event timestamps are transport metadata, not submitted local usage dates                                                              |
| Permission               | Fresh `telemetry.telemetryLevel === 'all'`, fail closed for `error`, `crash`, `off`, missing/unrecognized values and read failures. Gates activity collection, events and automatic presentation; rechecked before invitation navigation |
| Withdrawal               | Cancels pending work, silently closes visible invitation, emits no resolution/outcome after withdrawal. Persisted Never again still applies even if its event is lost                                                                    |
| Other preconditions      | `SURVEY_ENABLED=true` in all modes (D0021); no enablement launch override. Permanent opt-out stops automatic tracking and invitations before cohort entry                                                                                |
| Manual command exception | Give Feedback opens the fixed form on explicit request even after opt-out, with the switch off or without telemetry permission; survey events still require enabled/permitted. Never clears opt-out                                      |
| External navigation      | Only the primary button sends `openForm`, with optional `selectedRating`. Stars select locally. Neither URL gains machine/session/campaign IDs, rating or tracking query parameters. Privacy clicks are unrecorded                       |
| No answer linkage        | No completion callback, tracking pixel, response event or join to external submissions. The external form owns its consent and answers                                                                                                   |

### Actual English Invitation Copy

Quoted from `getSurveyInvitationStrings()` in `SurveyInvitationView.ts`, including accessible
names and status strings. `{0}` is replaced with the actual local usage count; none of this count
is sent. This packet does not change the copy or claim that the external form is live.

| Surface                      | Exact strings                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                        | "DocumentDB for VS Code"                                                                                                                                                                                                                           |
| Question                     | "How satisfied are you with DocumentDB for VS Code?"                                                                                                                                                                                               |
| Star accessible names        | "1 very dissatisfied"; "2 dissatisfied"; "3 neutral"; "4 satisfied"; "5 very satisfied"                                                                                                                                                            |
| Endpoints / primary action   | "1 very dissatisfied"; "5 very satisfied"; "Continue to survey"                                                                                                                                                                                    |
| Browser / language notes     | "Pick a rating (optional), then finish the short survey in your browser."; "The survey is in English."                                                                                                                                             |
| Choices                      | "Remind me later"; "Don't ask again"                                                                                                                                                                                                               |
| Disclosure / usage           | "Why am I seeing this?"; "You've used DocumentDB for VS Code on {0} days, so we'd love to hear how it's going. This count stays on your device."                                                                                                   |
| Returning after opening      | "It's been a while since you last opened the survey, so we're checking in again."                                                                                                                                                                  |
| Returning after Ask me later | "You asked us to remind you later, so here we are."                                                                                                                                                                                                |
| Returning after dismissal    | "You closed this invitation a while ago, so we are asking once more."                                                                                                                                                                              |
| Telemetry                    | "To improve these invitations, we record whether you qualified, whether the invitation was shown, what you chose, and any rating selected when you open the survey. We don't record your name, answers in the external form, or your usage count." |
| Privacy link                 | "Privacy Statement"                                                                                                                                                                                                                                |
| Failure / blocked (modal)    | "We couldn't open the survey in your browser. Please try again."; "Sorry, the survey can't be opened from here right now."                                                                                                                         |
| Opt-out save failure (modal) | "Saving your choice not to be asked for feedback again failed. It still applies until VS Code restarts."                                                                                                                                           |

| External destination        | Fixed URL                                        | Handling                                                                             |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Survey form                 | `https://aka.ms/DocumentDBSurvey`                | Host `vscode.env.openExternal`; unchanged by selection and shared with Give Feedback |
| Microsoft Privacy Statement | `https://go.microsoft.com/fwlink/?LinkId=521839` | Host `vscode.env.openExternal`, no click telemetry                                   |

**D0017 rationale:** longitudinal cohorts need the stable machine ID, making events linkable per
installation. The operator rejected "anonymized", jargon such as "pseudonymous" in invitation
copy, and stripping identifiers (which would break observability). The copy describes exclusions
and links the existing Microsoft Privacy Statement. There is no consent checkbox because the
invitation collects no answer and the external form owns its consent. The operator must return
the privacy review outcome and record it in `decisions.md` before enabling; this packet is not
that outcome and does not resolve any reviewer objection on the operator's behalf.
