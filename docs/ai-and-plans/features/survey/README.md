---
feature: survey
kind: overview
status: active
created: 2026-10-07
code:
  - src/services/survey/**
  - src/commands/giveFeedback/**
  - src/debug/**
  - src/utils/feedbackPermission.ts
---

# Survey Refresh

The refresh is implemented in draft [PR #992](https://github.com/microsoft/vscode-documentdb/pull/992);
automatic invitations are enabled in all modes, subject to normal eligibility and feedback
permission (D0021). The manual Give Feedback command and development preview are available.
Read [design.md](./design.md) for the implemented
architecture and [decisions.md](./decisions.md) for binding operator choices.

The original requirements, legacy behavior, and proposals below are retained as research
context, not a description of today's implementation. Accepted decisions supersede those
proposals. In particular, the old scoring implementation and event names have been removed.

## Review and validation

- [PR review and prepared UX walkthrough](./iterations/03-pr-review-and-ux-preparation.md):
  severity-ranked findings, interaction map, test evidence, and pending workbench checks.
  Operator triage accepts R1/R4 as edge cases. Iteration 3 implements R2 unrestricted user
  retries, R3 a privacy-link failure notification, and R5 local survey tracing, with 390
  targeted tests passing and a successful build after a test-only typing repair.
  Iteration 4 removes the enablement launch override, enables the shared code switch for
  production/development, and aligns the invitation header/content styling with the dashboard.
  D0023 adds optional local star selection: only Open survey navigates, and its permitted
  telemetry includes `selectedRating` (1-5) only when a rating was selected. Selection alone
  sends nothing; the external form is not prefilled.
  D0024 completes the original hierarchy/spacing and secondary-action pass: the question
  replaces the promotional heading, stars are smaller with visual-only hover preview, and
  repeating the selected star clears the optional rating.
  An earlier copy refinement restored "Your Feedback Matters" and labels the hovered or
  selected rating description (also available on keyboard focus).
  D0025 applies the rendering review: the line is removed again, the rating is a compact
  left-aligned group close to "Open survey", secondary actions are natural-width VS Code
  secondary buttons ("Remind me later" / "Don't ask again"), helper text is one 12 px size,
  and the logo has a dark-theme variant. D0026 replaces the invitation's Retry UI and the
  Give Feedback retry loop with a single modal error. D0027 centers smaller 20 px stars with
  equal space above and below, stretches the secondary buttons to the primary's box, renames
  the primary to "Continue to survey", drops the opt-out note, uses SVG logos for both
  themes, and reports a failed opt-out save in a modal without Retry.
- [Implementation history](./iterations/01-implementation-plan.md): completed stages,
  earlier checks, and remaining privacy/form/enablement gates.
- [Privacy packet and draft KQL](./design.md#privacy-review-packet): not yet approved or
  validated against the live telemetry engine.

## Operator Requirements

- Restore survey invitations and simplify the existing counter and eligibility logic.
- Keep one external survey, with no NoSQL or other product-specific variants.
- Apply the same feedback permission rule as Query Insights: show a survey invitation
  only when `telemetry.telemetryLevel === 'all'`. Other values and settings read failures
  must hide it. This gates presentation, not just telemetry transmission.
- Preserve cohort observability through activity, each eligibility gate, invitation, and
  participation outcome. KQL must reveal gates that block too many installations, not
  just count invitations that made it through. Reducing activity noise must not remove this.
- Include newer features that currently do not contribute survey activity.
- Track a few meaningful usage milestones, not every action or button. Reduce survey
  instrumentation and event noise rather than extending the current per-click model.
- Replace the notification with a more inviting, narrow, vertically oriented surface.
  Explore an editor group at the far right and other VS Code destinations.
- Explore lightweight HTML and VS Code-native alternatives to avoid React startup.
- Preview the first survey question: "Overall, how satisfied are you with DocumentDB
  for VS Code?" Show five stars, with 1 meaning very dissatisfied and 5 very satisfied.
  D0023 supersedes the original no-answer requirement: a local rating is optional and is
  recorded with permitted opening telemetry, not forwarded to the external form.
- Choosing a rating only selects locally. Open survey opens the fixed external URL; without
  a selected rating, omit the telemetry field rather than sending zero.
- Include a "Why am I seeing this?" section explaining the actual eligibility reasons,
  the locally measured usage, what telemetry is sent, and why a deferred invitation returned.
- Offer "Ask me later" and "Never again" as distinct choices. "Never again" is permanent
  for the stored installation preference, including across releases and survey campaigns.

The operator has confirmed that cohort progression telemetry is required. Keep operational
stage/outcome telemetry distinct from the external survey's answers. D0023 expressly permits
one selected satisfaction rating on invitation opening events; no selection/hover event,
external-form answer, or submission inference is added. The updated schema still needs privacy
review; collection is disclosed in the invitation.

## Legacy Behavior (before the refresh)

The former implementation was `src/utils/survey.ts` (removed by the refresh). Surveys were
disabled by a hard-coded flag. Scored activity calls still emit `survey.measure-score`,
but return before updating scores or evaluating eligibility. The
[v0.6.1 release notes](../../../release-notes/0.6.md) record the disabling change.

The survey code does not currently check VS Code telemetry enablement:
`getIsSurveyDisabledGlobally()` returns only the hard-coded survey flag. Suppressing
event transmission is not a substitute for gating the invitation itself. The refresh
must add this explicit eligibility gate before surveys are re-enabled.

### Verified Query Insights Feedback Gate

[openCollectionView.ts](../../../../src/commands/openCollectionView/openCollectionView.ts)
reads `workspace.getConfiguration('telemetry').get<string>('telemetryLevel')` and passes
`feedbackSignalsEnabled = telemetryLevel === 'all'` to the webview. A read failure sets
the flag to false. Missing or unrecognized values also fail the equality check.

[QueryInsightsTab.tsx](../../../../src/webviews/documentdb/collectionView/queryInsightsTab/QueryInsightsTab.tsx)
renders the feedback card only when `configuration.feedbackSignalsEnabled` is true and
`stage1ErrorCode !== 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU'`.
[openClusterDashboard.ts](../../../../src/commands/openClusterDashboard/openClusterDashboard.ts)
independently implements the same telemetry-level gate for its feedback card.

| Effective Telemetry Level                  | Feedback/Survey Permission                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `all`                                      | Permitted, subject to the survey kill switch and eligibility rules |
| `error`, `crash`, or `off`                 | Hidden                                                             |
| Missing/unrecognized value or read failure | Hidden; fail closed                                                |

Reuse this telemetry permission policy for the survey. A generic "telemetry enabled"
boolean alone is not the verified rule: diagnostic-only levels must not permit feedback.
The RU error exclusion is specific to Query Insights availability, not a survey audience
restriction. Do not reintroduce product variants or require Query Insights usage.

The inspected Query Insights flow passes a snapshot when opening the view; it does not
establish live permission updates. For the survey, recheck permission before presenting
a queued invitation and before opening the external form. Cancel pending invitations and
dispose an existing invitation if permission is withdrawn. Do not record that closure as
a user opt-out or send an event after permission has been withdrawn. Consider a small shared
host helper to keep these matching permission checks consistent, not a new consent system.

### Existing Survey Flow

There is already one URL: `https://aka.ms/DocumentDBSurvey`. There are no survey variants
or per-product scores. The optional machine-ID sampling selects an audience, not a form.

When enabled:

1. Selected actions add points to one in-memory extension-host score.
2. At 100 points, eligibility is initialized lazily and cached for the host session.
3. Eligibility checks locale, version suppression, recent acceptance, recent opt-out,
   today's prior check, counted sessions, and audience sampling, in that order.
4. A candidate receives an information notification. A noncandidate also disarms further
   attempts for that host session, despite not having seen an invitation.
5. Accepting opens the external form and records it as "taken," without verifying either
   browser-opening success or submission. Dismissal has the reminder behavior.

Persisted state has five keys: session count, last session date, skip version, survey
taken date, and opt-out date, under `ms-azuretools.vscode-documentdb.survey`.
The score and candidate flag are not persisted.

### Why the Counter Feels Complex

The arithmetic is simple. Complexity comes from the surrounding lifecycle:

- "Session" means a threshold-triggered eligibility check, at most once per calendar day,
  not an extension activation or an ordinary usage session.
- A daily check writes the date even when there is no invitation.
- Version and 90-day cooldown rules overlap. Acceptance and opt-out can rearm only after
  both the cooldown and a major/minor release change.
- "Don't Ask Again" is not permanent because opt-outs are configured to rearm.
- Two audience controls coexist: deterministic sampling and random probability.
- Call sites provide weights without activity names. Navigation and the resulting query
  can both contribute points to a single interaction.
- Async eligibility initialization has no shared in-flight promise. Concurrent calls
  can evaluate and update the same state before the candidate flag is cached. Include a
  concurrency regression test rather than relying on call timing.

## Existing Telemetry and Cohorts

The [telemetry skill](../../../../.github/skills/telemetry-instrumentation/SKILL.md)
documents framework-provided `VSCodeMachineId`, `VSCodeSessionId`, extension metadata,
result, and duration. Existing survey events have no dedicated campaign or invitation ID.

| Event                  | Existing Data                                                                                                               | What It Actually Establishes                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `survey.measure-score` | Action score, disabled flag, disarmed flag; accumulated score and threshold flag when counting; candidate flag at threshold | An instrumented activity attempt and, when enabled, progress toward the threshold                         |
| `survey.init`          | Candidate flag, first rejection reason, selected contextual values                                                          | Eligibility evaluation, not all gates traversed                                                           |
| `survey.prompt`        | Candidate flag, `userAsked`, acceptance/reminder/opt-out flags                                                              | A prompt attempt; noncandidates emit this too. For candidates it finishes after the notification resolves |
| `survey.open`          | Candidate flag, optional trigger action                                                                                     | A browser-opening request, not successful opening or form completion                                      |

Current callers omit `triggerAction`, so it cannot identify the feature that contributed
activity. The common `surveyPing` RPC is not itself telemetry-wrapped.
The unused `surveyOpen` RPC would allow manual opening, but still respects the disable flag.

### What KQL Can Recover Today

Use distinct machine IDs for longitudinal installation cohorts and machine/session pairs
for per-session funnels. Machine IDs are not people, and session IDs are not invitations.
Use extension version as a rollout dimension. Exclude missing IDs instead of grouping
all unidentified events into one installation.

Historical data can answer: instrumented activity observed, enabled counting observed,
threshold reached, candidate selected, notification resolved, and opening requested.
It cannot reliably answer: exact first-visible time, invitations abandoned while open,
successful browser opening, or external form completion. `userAsked=true` is set after
resolution, so it is not an independent shown event. Dismissal and explicit reminder
are indistinguishable. Rejection reasons report only the first failing gate.

While disabled, there is no downstream survey funnel to analyze. A disabled activity
event still supplies a useful denominator of instrumented sessions, not all active users.
KQL cannot reconstruct absent stages or turn that denominator into extension-wide coverage.

This is an illustrative session-level query, not a query validated against live telemetry.
Confirm table, event prefix, and identifier dimension names in the actual workspace first.
The repository contains a `customEvents` example using the `documentDB/` prefix; normalize
the survey suffix here to tolerate such a prefix.

```kql
let SurveyEvents = materialize(
    customEvents
    | where timestamp between (ago(30d) .. now())
    | extend event = extract(@"(survey\.[^/]+)$", 1, name)
    | where isnotempty(event)
    | extend machine = tostring(customDimensions.VSCodeMachineId),
             session = tostring(customDimensions.VSCodeSessionId)
    | where isnotempty(machine) and isnotempty(session)
);
SurveyEvents
| summarize
    activityEvents = countif(event == "survey.measure-score"),
    enabledEvents = countif(event == "survey.measure-score"
        and tostring(customDimensions.isSurveyDisabledGlobally) == "false"
        and tostring(customDimensions.wasPromptedInSession) == "false"),
    thresholdEvents = countif(event == "survey.measure-score"
        and tostring(customDimensions.scoreTargetReached) == "true"),
    candidateEvents = countif(event == "survey.init"
        and tostring(customDimensions.isCandidate) == "true"),
    resolvedEvents = countif(event == "survey.prompt"
        and tostring(customDimensions.isCandidate) == "true"
        and tostring(customDimensions.userAsked) == "true"),
    openRequests = countif(event == "survey.open")
    by machine, session
| summarize
    activitySessions = countif(activityEvents > 0),
    enabledSessions = countif(enabledEvents > 0),
    thresholdSessions = countif(thresholdEvents > 0),
    candidateSessions = countif(candidateEvents > 0),
    resolvedSessions = countif(resolvedEvents > 0),
    openRequestSessions = countif(openRequests > 0)
```

These are observed stage counts, not proof of ordered conversion. Wrapper events finish
at different times, especially the notification event. For longitudinal conversion,
anchor each installation to its first observed activity in a defined enrollment window,
follow it for a fixed duration, and report incomplete follow-up separately. Do not label
the last few days' unconverted installations as drop-offs. Distinguish permanent opt-out,
temporary deferral, policy suppression, and not-yet-qualified activity.

### Required Cohort Telemetry, Proposed Contract

The existing survey telemetry is not evaluated by anyone, so the refresh starts fresh: delete
the old events, design new names and fields freely, and write KQL only against the new schema.
No old-to-new mapping, dual emission, or historical continuity is required. Persisted user
state is not telemetry: legacy opt-outs still migrate. The fields below remain subject to
privacy/schema review.

Standard machine/session IDs support longitudinal installation cohorts. A `surveyCampaignId`
identifies the invitation rollout, `surveyPolicyVersion` identifies the gate configuration,
and `invitationSessionId` joins one surface lifetime. None is an answer or is sent to the form.
Do not reuse tree lineage IDs. Do not mix policy versions when diagnosing a restrictive gate.

| Stage/Event               | Required Observation                                                                                                              | Frequency Bound                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Meaningful usage observed | Entry into the measurable survey cohort, including installations not yet qualified                                                | Once per host session on meaningful usage, before campaign/active-day/cooldown rejection                                         |
| Eligibility evaluated     | Each reached gate's `passed` or `blocked` result; later gates explicitly `notEvaluated`; overall result and first blocking reason | Initial evaluation per qualifying host session; reevaluate on a new active day or relevant policy/state change, not every action |
| Presentation deferred     | Eligible but waiting for a safe pause or available destination; finite reason code                                                | Once per changed deferral state                                                                                                  |
| Invitation visible        | Content ready and actually visible, separate from constructing the panel                                                          | Once per invitation instance                                                                                                     |
| Opening requested/result  | External-form action and browser API success/failure; D0023 adds optional numeric `selectedRating` on invitation attempts         | First three reported attempts; unlimited explicit navigation retries; no clicked-element identity                                |
| Invitation resolved       | `askLater`, `neverAgain`, `dismissed`, or `opened`; distinguish explicit choice from closing                                      | Once per invitation instance; state whether it was ever visible                                                                  |

Do not wait until eligibility succeeds to record cohort entry or a blocked decision. Check
feedback permission and the survey kill switch first; no telemetry-disabled installation
may be enrolled by this feature. Permanent opt-out stops future survey tracking/invitations;
its explicit choice is a terminal outcome, not a repeatedly emitted rejection on every launch.
Persist that preference independently of whether its one-time outcome event is delivered.

Gate fields should describe the actual ordered evaluation, not infer passage from missing
events. Relevant gates include campaign/sampling if retained, active-day requirement,
reminder/acceptance cooldown, and session invitation suppression. A skipped gate is neither
a pass nor a failure. Include finite policy configuration identifiers, not database names,
query text, per-action histories, exact usage dates, or the user's exact active-day count.
The count shown in the invitation remains local. Gate outcomes still disclose coarse
eligibility information; describe that honestly in the invitation.

Bounded does not mean success-only or transition-only: a new host session can provide one
fresh blocked snapshot so repeated inability to pass a gate remains visible. Repeated
callbacks with unchanged state in the same session must not emit more snapshots.

### KQL Acceptance Criteria

For each enrollment cohort and policy version, report distinct installations that reached,
passed, or were blocked at each gate; the pass rate uses installations reaching that gate
as its denominator. Show first blocking reasons separately from later untested gates.
Also report time to next stage, observed sessions/days spent blocked, eligible-but-not-visible
invitations, explicit deferrals, permanent opt-outs, and browser-opening failures.

Use a defined enrollment and follow-up window. Separate not-yet-qualified installations,
temporary cooldown, terminal opt-out, and no further observations. Absence of later telemetry
does not prove rejection or abandonment: permission changes, uninstall, and event delivery
loss can also end observation. External submission totals remain separate and unjoined.
Sessions/days observed by KQL are telemetry observations, not the exact local active-day count.

Test queries against fixture journeys where a deliberately high day threshold blocks most
installations, a cooldown blocks returning installations, and a presentation delay hides
otherwise eligible invitations. The report must identify the responsible gate/stage without
requiring additional button instrumentation or deployment just to diagnose the loss.

### Telemetry Privacy Boundary

- D0023 permits optional numeric `selectedRating` (integers 1-5) only on invitation
  `survey.openForm` events. Omit it when unselected or opening via Give Feedback.
- Do not send hovered stars, element ID, keyboard key, external answer text, per-rating URL,
  or differentiated star-action events. Selection alone sends no message or telemetry.
- Do not use automatic RPC/click telemetry around the invitation's interaction handler.
  Emit only the approved lifecycle/outcome events and the selected-rating measurement above.
- Never append machine/session IDs, campaign IDs, or the choice to the external URL.
- Do not add a completion callback, tracking pixel, or survey-response telemetry.
- Apply the verified Query Insights permission gate to survey activity collection, survey
  events, and invitation eligibility: only telemetry level `all` permits participation.
  Do not accumulate survey activity or emit survey events at other levels. These excluded
  installations are outside the measurable cohort, not observable funnel drop-offs.
- Do not claim external survey completion from a click or successful browser opening.
  If privacy review rejects a required field/event, resolve that conflict before rollout
  rather than silently removing cohort observability or collecting unapproved data.

## Simplified Policy Proposal

Separate a small eligibility policy from activity collection and presentation. Keep one
host-side entry point such as `recordSurveyActivity(featureArea)` with a small bounded
vocabulary. The proposed replacement is a qualifying active-day counter, not weighted
points per action. Do not build a new analytics or plugin framework for this.

Recommended starting policy, with values still to choose:

- Apply the verified Query Insights permission gate before collecting survey activity or
  evaluating eligibility, and recheck before presentation and external navigation. Cancel
  pending/visible invitations when permission is withdrawn, without recording an opt-out.
- One campaign, one URL, one enable flag. Remove product routing and redundant probability
  controls; retain at most one deterministic sampling fraction if rollout requires it.
- Record one qualifying active day when any covered feature reaches a meaningful successful
  milestone. More buttons, operations, or feature areas on that day do not increase eligibility.
  A frequent user of one feature should qualify without visiting several features.
- Remove the weighted score, impact levels, and button/navigation pings rather than merely
  reducing their weights. Deduplicate centrally and keep persistent writes to the active-day
  transition. Specify day boundaries and the required number of days before implementation.
- Keep cohort observability separate from counting: one first-use event and initial gate
  snapshot per host session, plus relevant state changes and presentation outcomes, not
  one event per usage callback. Retain failed gate snapshots as well as successful stages.
- Use time-based `nextEligibleAt` after dismissal/acceptance instead of stacking version
  and time gates. "Ask me later" defers to an agreed cooldown; "Never again" is a required
  permanent opt-out, not campaign-scoped consent. Neither a release/campaign change nor
  elapsed time may clear it. Only an explicit user reset may re-enable invitations.
- Reserve the invitation before async work; ensure only one evaluation/panel can be in flight.
- Qualify on successful activity, but present at a safe pause rather than while an operation,
  wizard, modal, or terminal interaction is active. Do not steal editor or terminal focus.

Superseded by [D0011](./decisions.md#0011-legacy-survey-state-is-forgotten): all legacy survey
state is dropped, including legacy opt-outs, and the old keys are deleted.

Migration must treat any recorded legacy "Don't Ask Again" opt-out as permanent, even if
its old 90-day rearm period has elapsed. Conservatively map existing acceptance dates to
cooldowns and define how old version/session keys retire. Do not wipe state to make rollout
numbers look healthier. Persistence survives extension/VS Code updates; it cannot promise
cross-device suppression or survive deliberate removal of extension storage without an
additional agreed storage/sync design.

## Broader Activity Coverage

The current 5-point hooks cover view switching, next/previous page, nested-data navigation,
and document refresh. Collection find queries and document saves add 20 points.
Definitions also include 1 and 50, but neither currently has activity callers.

Replace that model with a small set of feature-level success boundaries. The table is a
coverage map, not a requirement to instrument every operation within each area. Prefer one
shared completion boundary per area; only add another when an otherwise unrepresented usage
path needs it. Do not wrap every command or add a survey event to every existing feature event.

| Feature Area                  | Representative Milestone                                             | Coverage and Exclusions                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connection/setup              | First successful user-initiated connection or Quick Start completion | Covers connection sources without scoring discovery refreshes, polling, or reconnection loops                                                                |
| Data browsing/editing         | First successful useful data load or save                            | Covers Collection/Document Views; remove paging, breadcrumb, view-switch, and refresh-button pings                                                           |
| Query Playground              | First completed user execution                                       | Shared `executePlaygroundCode.ts` path for Run All/Selected; no statement-by-statement scoring                                                               |
| Interactive Shell             | First successful user-command evaluation                             | Shared evaluation completion in `DocumentDBShellPty.ts`; not keystrokes, completion requests, or startup                                                     |
| Data/index management         | First completed user-requested management task                       | Covers indexes, database/collection changes, imports/exports, and collection/index paste at suitable shared completion boundaries; not each step or document |
| Query Insights/AI             | First completed user-requested analysis                              | Completion boundary, not pipeline stages, streamed chunks, or automatic reanalysis                                                                           |
| Cluster Dashboard, if shipped | First useful user-requested inventory load                           | No health polling; the feature index marks this as a POC, so it is not a release dependency                                                                  |

Any one area can mark the day active; feature diversity is not a prerequisite. Once the
session's initial observation/evaluation and day's count are recorded, repeated completion
callbacks with unchanged state are cheap no-ops without additional survey events or writes.
Relevant eligibility/presentation changes still produce the required bounded stage events.
Preserve independent existing feature telemetry: this simplification removes survey-specific
per-action noise, not cohort visibility or the product's other instrumentation.

Validate the active-day model against both occasional and intensive users before settling
the threshold. If a single trivial success qualifies too readily, first strengthen the
milestone definition rather than rebuilding a weighted click counter.

## Invitation Surface

### Stage 2 Implementation

The lightweight Secondary Sidebar webview and "DocumentDB: Give Feedback" command are
implemented. The shared code switch is enabled (D0021). Binding choices include D0021/D0022, not
the historical prototype alternatives below. The current lifecycle is documented in
[design.md](./design.md#invitation-surface); tests, width screenshots, deviations, and pending
operator verification are recorded under Stage 2 Progress in the
[implementation plan](./iterations/01-implementation-plan.md#stage-2-invitation-surface).

Developer-only simulation and reset commands are available in the Extension Development
Host. Normal survey behavior is enabled through the same code switch in all modes, with all
ordinary eligibility and permission gates still applied (D0021); no launch setting is required.
Set `DOCUMENTDB_DEBUG_SURVEY_ALWAYS_INVITE=true` in the selected launch configuration
to show the real invitation on the next milestone, regardless of local eligibility or
feedback permission. This forced-preview override does not apply in Production or Test,
and telemetry permission is never bypassed.
See [design.md](./design.md#evaluation-flow) for the developer reset boundary.

### Recommended Prototype

A dedicated lightweight webview using HTML, CSS, native buttons, and a small message handler.
Use VS Code theme variables and packaged DocumentDB artwork, no remote resources or React
bundle. A webview is still a browser surface: avoiding React does not remove webview startup.
Reuse suitable host lifecycle/security helpers without importing the full application shell
or adding tRPC solely for a handful of local commands.

Layout: visible DocumentDB identity, compact invitation, the sample question, a fixed row of
five native radio choices with outline/filled star artwork, dissatisfied/satisfied endpoint labels, a "Why am I seeing this?" section,
and clearly distinct "Ask me later" and "Never again" actions.
Stars select locally without navigation. Open survey is the one navigation action; it also
records the optional rating in permitted opening telemetry (D0023). Explain that the external
form will not be prefilled and its answers must be entered there. Never claim the external
survey has been submitted merely because its browser URL opened.

Use a narrow unframed layout, theme/high-contrast support, keyboard focus indicators, and
accessible radio names, native keyboard navigation, and an explicit opening button. No hover telemetry.
Test at approximately 240, 320, and 480 pixels wide, with zoom and long localized strings.

### Why Am I Seeing This?

Generate the explanation from the same local eligibility result used to show the invitation,
not a second hard-coded account of the policy. Show the actual number of qualifying active
days and define it as days with meaningful extension use, not days since installation.
The exact count and activity history remain local; stage/gate telemetry is still transmitted
under the permission rule. Do not say "no data was transmitted."

Draft copy, to adapt to the agreed policy and approved telemetry schema:

> You've used DocumentDB for VS Code on {activeDays} days. That's why we're inviting you
> to share your experience. This usage count is stored on your device and isn't sent to us.
> We send limited, anonymized telemetry about eligibility and whether the invitation is
> shown, opened, deferred, or declined. Your rating isn't recorded here; you'll answer in
> the external form.

Resolved by [D0017](./decisions.md#0017-telemetry-wording-in-the-invitation): the copy states
what is not sent and links the Privacy Statement instead of claiming anonymity. D0023 further
supersedes this historical draft's no-rating claim: the current copy discloses selected-rating
telemetry on opening and makes clear it does not prefill the external form.

The operator requested "anonymized" in this draft. Verify that claim before shipping:
stable machine/session identifiers used for cohort correlation may make the data
pseudonymous rather than anonymous. Review the actual identifiers, collection, and handling
with the privacy owner. If anonymity cannot be substantiated, agree on accurate replacement
copy rather than presenting this draft claim as verified or silently removing cohort tracking.

If this is a release-specific campaign, add the actual release reason, such as "We're
gathering feedback on version {version}." Only describe it as a major update when that is
true. The operator gave a major update as an example, not an agreed new version gate.
Whether to run release-specific campaigns and which days their counters cover remains open.
Do not reintroduce version-based rearming just to fit the copy.

If the invitation returns after "Ask me later," explain that the reminder period has
passed. It must never return after "Never again." Keep the opt-out meaning visible rather
than burying it in the explanation; an expandable native disclosure can hold longer details.

### Reminder and Opt-Out Behavior

| Action                            | Required Meaning                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select a star / Open survey       | Selection stays local until Open survey; that action sends optional `selectedRating` telemetry and opens the unchanged external URL. Success is not survey completion |
| Ask me later                      | Close now and suppress invitations until the agreed reminder cooldown ends; normal eligibility still applies afterward                                                |
| Never again                       | Persist permanent suppression before closing; no reminders, version resets, campaign resets, or timed rearming                                                        |
| Close the invite without a choice | Proposed: temporary deferral, never permanent opt-out; record `dismissed` separately from `askLater`                                                                  |

Use explicit finite cooldowns for reminders and acceptance; durations and dismissal policy
still need agreement. Do not redisplay a failed-to-persist opt-out as though it succeeded:
honor it in memory immediately and report the failed save (D0027: a modal, no retry).

### Destinations to Explore

| Destination                       | Advantage                                                     | Constraint                                                                                                              |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Editor-group webview panel        | Straightforward standalone invite with a tab and close action | `ViewColumn.Beside` means beside the active group, not guaranteed far right; inspect existing groups and focus behavior |
| Secondary Sidebar webview view    | Naturally narrow and tall; does not split the editor          | Contributed view/container placement, default location, user relocation, visibility, and focus need a prototype         |
| Existing extension Sidebar view   | Discoverable without creating an editor group                 | Can displace connection tools and may be hidden during terminal/editor work                                             |
| Native notification or Quick Pick | No webview bundle                                             | Cannot provide the persistent illustrated star invitation; a Quick Pick interrupts workflow                             |
| Native welcome content            | Lightweight declarative links                                 | Limited styling and dynamic content; not an equivalent rating preview                                                   |

Do not assume an API can enforce a narrow editor group or pin a view permanently to the
right. Test existing multi-group layouts, left/right sidebar settings, remote windows,
small screens, hidden views, and panel restore behavior. Reuse one invitation instance.
Default automatic invitations should not restore at startup or steal focus.

## Execution Planning Handoff

The execution plan is [iterations/01-implementation-plan.md](./iterations/01-implementation-plan.md).
Operator decisions in [decisions.md](./decisions.md) refine or override this README, including
the policy values, the Secondary Sidebar destination, and presenting right after the milestone.

The next step is an execution plan, not further requirements discovery or immediate coding.
Use the confirmed operator requirements as constraints and propose concrete files, success
boundaries, state/migration design, telemetry schema and KQL, UI prototype tasks, dependency
order, and focused tests in a survey iteration plan. Explicitly identify the remaining
choices: active-day counting/threshold, cooldowns and dismissal behavior, sampling/campaign
scope, invitation destination, and privacy-approved telemetry terminology. Bring decisions
that need operator approval back before implementation; do not silently choose policy values.

## Work Sequence and Acceptance Checks

1. Finalize the required cohort schema/privacy review, active-day threshold and milestones,
   cooldown durations, sampling, release-campaign scope, and legacy-state migration details.
   Permanent opt-out, honest eligibility explanation, and cohort visibility are confirmed
   requirements. Record their rationale in a survey `decisions.md` if the operator agrees.
2. Prototype editor-group and sidebar placement with the same lightweight invitation.
   Measure render/startup behavior and inspect keyboard, focus, localization, and themes.
3. Implement the small policy and one activity entry point with concurrency and migration
   tests. Preserve privacy boundaries before expanding coverage.
4. Replace old button pings with a few feature-level success hooks in small batches. Test
   that repeated use and overlapping paths do not add active days or duplicate survey events.
5. Add required gate/lifecycle telemetry and validate KQL against the real event schema and
   restrictive-gate fixtures. Check denominators, gate pass/block rates, follow-up censoring,
   outcome distinctions, and visibility versus merely constructing a hidden panel.
6. Re-enable only after the URL and external form are confirmed active and policy/privacy
   review is complete. Keep a kill switch and a conservative initial rollout if needed.

Tests must cover the survey kill switch independently of feedback permission; telemetry
levels `all`, `error`, `crash`, and `off`; missing/unrecognized settings and read failures;
and permission withdrawal while an invitation is pending or visible and before navigation.
Also cover active-day threshold/day boundaries, single-feature-only users, unchanged repeated
usage without extra writes/events, blocked as well as passed gate snapshots, explicit skipped
gates, failures and cancellations, concurrent qualification, cooldown, and hidden/shown/closed
lifecycle. Test permanent opt-out across restart, major/minor/patch updates, campaign changes,
arbitrary elapsed time, migration of old opt-outs, and persistence failure. Verify that the
Query Insights RU-specific exclusion does not become a survey gate.
Test explanation text against the actual local count/reason, reminder expiry, optional release
context, and telemetry schema. Verify stars select without host messages, opening without a
rating omits `selectedRating`, and opening with a rating reports it without changing the URL,
no answer/element data leaks through generic wrappers, and only approved generic outcomes
are sent. If opening fails, report it in a modal error (D0026) and do not record survey completion or consume
acceptance cooldown as though navigation succeeded.

Use repository Case 1 checks during implementation and Case 2 only at review handoff.
Planning-only changes need document/link validation, not a production build.

## Research Outcome

Inspected survey implementation, its three test suites, all current survey call sites,
telemetry conventions, the feature index, playground telemetry, shared panel creation,
and the Query Insights and Cluster Dashboard feedback permission gates.
Existing tests could not run because `@swc/jest` is missing in this worktree. No live KQL
query or UI placement prototype has run. Privacy approval, exact policy values, feature
hook details, and destination choice remain open.
