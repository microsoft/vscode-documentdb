---
feature: survey
kind: decisions
status: active
created: 2026-10-07
---

# Survey: Decisions

> Policy values and scope choices for the survey refresh, made by the operator during Stage 0 of
> [the implementation plan](./iterations/01-implementation-plan.md). Where a decision overrides
> the [README](./README.md), this file wins for intent.

| #    | Decision                                                     | Status              | Changed from the proposal?                                                                                     | Date       | PR   |
| ---- | ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| 0001 | Survey telemetry starts fresh, no legacy event mapping       | Accepted            | Operator correction to the README                                                                              | 2026-10-07 | -    |
| 0002 | Requirements confirmed before planning                       | Accepted (modified) | Rating exclusion superseded by D0023; other requirements retained                                              | 2026-10-07 | -    |
| 0003 | An active day is the local calendar day                      | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0004 | Eligibility after 3 active days                              | Accepted (modified) | Proposal was 5                                                                                                 | 2026-10-07 | -    |
| 0005 | "Ask me later" cooldown is 14 days                           | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0006 | Cooldown after opening the form is 180 days                  | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0007 | Closing without a choice waits as long as "Ask me later"     | Accepted (modified) | Proposal was a shorter, 7-day cooldown                                                                         | 2026-10-07 | -    |
| 0008 | No sampling at launch, fraction kept at 1.0                  | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0009 | One long-lived campaign ID                                   | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0010 | No locale gate; the invitation says the survey is in English | Accepted            | Accepted as proposed; operator confirmed English-only form                                                     | 2026-10-07 | -    |
| 0011 | Legacy survey state is forgotten                             | Accepted (modified) | Proposal was to migrate; legacy opt-outs ignored too                                                           | 2026-10-07 | -    |
| 0012 | Present the invitation right after the milestone             | Accepted (modified) | Proposal was a delayed safe pause                                                                              | 2026-10-07 | -    |
| 0013 | The invitation lives in the Secondary Sidebar only           | Accepted (modified) | Proposal was to prototype two destinations                                                                     | 2026-10-07 | -    |
| 0014 | A plain "Open survey" button sits next to the stars          | Accepted (modified) | D0023 replaces star navigation and identical-message rule                                                      | 2026-10-07 | -    |
| 0015 | A "Give Feedback" command, no reset command                  | Accepted            | Accepted as proposed                                                                                           | 2026-10-07 | -    |
| 0016 | Kill switch is a code constant with a development override   | Superseded by D0020 | Development override removed; production code switch retained                                                  | 2026-10-07 | -    |
| 0017 | Telemetry wording in the invitation                          | Accepted (modified) | No anonymity claim; D0023 further replaces the no-rating/answer claim                                          | 2026-10-07 | -    |
| 0018 | Raise the minimum VS Code version to 1.106.0                 | Accepted            | Raised by the Stage 2 blocker                                                                                  | 2026-10-07 | -    |
| 0019 | The cooldown starts when the invitation is first visible     | Accepted            | Raised by the Stage 2 review                                                                                   | 2026-10-07 | -    |
| 0020 | Normal survey behavior works automatically in development    | Superseded by D0021 | Conservative development-only interpretation corrected before validation                                       | 2026-10-08 | #992 |
| 0021 | Re-enable surveys in production and development              | Accepted (modified) | One enabled code switch for all modes; no enablement environment override                                      | 2026-10-08 | #992 |
| 0022 | Match the dashboard header and content surfaces              | Accepted            | Smaller identity row, shaded full-width header, editor-background body                                         | 2026-10-08 | #992 |
| 0023 | Optional local rating, recorded when opening the survey      | Accepted (modified) | Reverses the no-rating telemetry boundary; only Open survey navigates                                          | 2026-10-09 | #992 |
| 0024 | Complete the task-led UX pass and make rating resettable     | Accepted (modified) | Finish R7/R9; smaller stars with local hover preview and toggle-to-clear; layout/Retry revised by D0025/D0026  | 2026-10-09 | #992 |
| 0025 | Apply the rendering review to the invitation layout          | Accepted (modified) | Compact left-aligned rating, secondary buttons, one helper size, dark logo; centering/stretch revised by D0027 | 2026-10-09 | #992 |
| 0026 | Report open failures in a modal; remove Retry UI             | Accepted (modified) | Replaces the Open→Retry relabel, status line, and command retry loop; D0027 extends it to opt-out save         | 2026-10-09 | #992 |
| 0027 | Centered smaller rating, stretched actions, no save Retry    | Accepted            | 20 px centered stars, symmetric spacing, "Continue to survey", modal opt-out save failure                      | 2026-10-09 | #992 |

> Entries are semantically immutable: append new entries rather than rewriting old ones, and record
> reversals as a new entry plus a status change above.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001: Survey telemetry starts fresh, no legacy event mapping

**Decision:** Delete `survey.measure-score`, `survey.init`, `survey.prompt`, and `survey.open`.
Design new event names and fields freely and write KQL only against the new schema. No aliases,
dual emission, mapping table, or historical comparison.

**Reasoning (operator):** the existing survey telemetry is not evaluated, so there is no reporting
to keep continuous. The README's requirement to ship an old-to-new mapping was an omission.

**Still binding:** privacy boundary, the `telemetryLevel === 'all'` permission gate, bounded
emission, and gate-level cohort observability.

## 0002: Requirements confirmed before planning

Recorded so they are not reopened: one survey URL with no variants; the `telemetryLevel === 'all'`
gate applies to collection, events, and presentation; "Never again" is permanent across releases,
campaigns, and elapsed time; "Why am I seeing this?" is generated from the real local eligibility
result; cohort observability through every gate is required; the rating is never transmitted.

## 0003: An active day is the local calendar day

**Decision:** a qualifying day is the extension host's local calendar date.

**Reasoning:** accepted recommendation; matches how users read "you've used it on N days". A time
zone change can occasionally merge or split a day; that is harmless.

**Rejected:** UTC day (an evening session can span two days); rolling 24 hours (hard to explain).

## 0004: Eligibility after 3 active days

**Decision:** 3 qualifying active days. Tunable later by bumping `surveyPolicyVersion`; the Stage 4
KQL shows how many installations the gate blocks.

**Reasoning:** operator chose the larger, faster cohort over the recommended 5.

**Rejected:** 5 (recommended; excludes brief evaluators better), 10 (small, slow cohort).

## 0005: "Ask me later" cooldown is 14 days

**Decision:** 14 days. **Rejected:** 7 (naggy), 30 (loses users who meant "not now").

## 0006: Cooldown after opening the form is 180 days

**Decision:** 180 days after the form is opened. Opening is not proof of submission, so this also
covers users who opened and left.

**Rejected:** 90 days (frequent for respondents), only-on-new-campaign (depends on manual campaigns).

## 0007: Closing without a choice waits as long as "Ask me later"

**Decision:** closing the invitation without choosing is a temporary deferral, never an opt-out.
It uses its own named constant whose value equals the "Ask me later" cooldown (14 days), and it is
recorded as `dismissed`, distinct from `askLater`.

**Reasoning (operator):** "we need to know that people were closing", but the wait should be the
same as "Ask me later".

**Rejected:** a shorter 7-day dismissal cooldown (proposal); showing again next session (naggy).

## 0008: No sampling at launch, fraction kept at 1.0

**Decision:** keep one deterministic sampling fraction in code, set to 1.0, as an emergency
throttle. It stays a gate in the eligibility snapshot.

**Rejected:** 25% ramp (slower data); no sampling code (only an all-or-nothing kill switch).

## 0009: One long-lived campaign ID

**Decision:** a single `surveyCampaignId`, changed manually when the form changes. Active days
carry over. No release-specific campaigns, so the invitation copy has no release sentence.

**Rejected:** per-minor-release campaigns (counter reset rules; risks version rearming).

## 0010: No locale gate; the invitation says the survey is in English

**Decision:** show to every permitted installation regardless of UI language. The invitation
includes a localized line stating that the survey is in English.

**Reasoning (operator):** the form is only in English.

**Rejected:** English UI only (excludes much of the audience); no note (surprises localized users).

## 0011: Legacy survey state is forgotten

**Status:** Accepted (modified).

**Decision so far (operator):** "forget old survey state". The legacy session count, last session
date, skip version, and survey-taken date are not carried over.

**Open question:** whether "forget" also covers legacy "Don't Ask Again" opt-outs, which the README
requires to become permanent, and whether the legacy `globalState` keys are deleted or just ignored.

**Update 2026-10-07 (operator):** legacy keys are deleted once the new state is saved. The opt-out
part is still being confirmed: the operator answered option a (old opt-outs become permanent) with
the words "let's just ask them again", which reads like option b (re-invite them).

**Resolution 2026-10-07 (operator):** drop everything from the old survey, including legacy
"Don't Ask Again" opt-outs. Those users are treated like everyone else and may be invited again.
The new state starts empty and the legacy keys under `ms-azuretools.vscode-documentdb.survey/*`
are deleted once it is saved. The operator explicitly accepts responsibility for re-inviting
users who opted out under the old survey: "we ignore their choice and it's on me".

**Supersedes:** the README requirement that legacy opt-outs become permanent. New "Never again"
choices remain permanent (D0002).

**Rejected:** carrying legacy opt-outs over as permanent (recommended; honors the old button
label); keeping the legacy keys read-only.

## 0012: Present the invitation right after the milestone

**Decision:** once eligible, the invitation appears right after the successful milestone that made
the evaluation pass. No delayed safe-pause queue. It must still not take focus from the editor or
terminal; if the destination cannot be revealed without taking focus, Stage 2 stops and reports.

**Reasoning:** operator choice; the milestone is already a completed success, so it is a natural
pause, and it removes the in-flight tracker and timer.

**Supersedes:** the README "present at a safe pause" bullet.

**Rejected:** delayed safe pause (recommended; more machinery); next window start (busy, conflicts
with no-restore-at-startup).

## 0013: The invitation lives in the Secondary Sidebar only

**Decision:** one destination, a webview view in the Secondary Sidebar. No editor-group prototype.

**Reasoning:** operator choice; naturally narrow and tall, does not split the editor.

**Risk to verify in Stage 2:** contributing a view container to the Secondary Sidebar on the
extension's minimum `engines.vscode`, revealing it without focus, and behavior when the user has
moved or hidden it.

**Rejected:** editor-group panel; prototyping both.

## 0014: A plain "Open survey" button sits next to the stars

**Decision:** stars plus an "Open survey" button, all posting the identical message.
**Rejected:** stars only (users may think a star submits a rating).

## 0015: A "Give Feedback" command, no reset command

**Decision:** add a "DocumentDB: Give Feedback" command that opens the form at any time, including
after "Never again", because the user explicitly asked. No "Reset Survey Preferences" command, so
"Never again" has no in-product reset.

**Proposed detail, review in Stage 1:** the command emits `survey.openForm` with a manual trigger
when permitted and applies the 180-day cooldown; it never clears "Never again".

## 0016: Kill switch is a code constant with a development override

**Decision:** a code constant enables or disables the survey. An override for testing is honored
only when `ExtensionMode` is `Development`. **Rejected:** constant only (testing needs code edits);
remote experimentation flag (new infrastructure for one flag).

## 0017: Telemetry wording in the invitation

**Status:** Accepted (modified).

**Decision so far (operator):** keep the "anonymized" draft wording until the Stage 4 privacy review.
The operator considers the data anonymous; the agent raised that stable machine IDs used for cohort
joins may make it pseudonymous. Discussion pending; the outcome is recorded here.

**Resolution 2026-10-07 (operator):** do not claim "anonymized". Describe what is not sent instead,
and link the Microsoft Privacy Statement already used by the Query Insights feedback dialog
(`https://go.microsoft.com/fwlink/?LinkId=521839`, see `FeedbackDialog.tsx`). Draft:

> We send limited telemetry about your eligibility and whether this invitation is shown, opened,
> deferred, or declined. It doesn't include your name, your answers, or your usage count.
> [Privacy Statement]

The link opens through the host with `openExternal`, like the survey URL, and its clicks are not
recorded. No consent checkbox: the invitation collects nothing, and the external form owns its own
consent. The Stage 4 privacy review still checks the event schema and this copy.

**Reasoning:** the cohort analysis depends on the stable machine ID, so the data is linkable per
installation. Saying what is excluded stays accurate whatever the review decides.

**Rejected:** "anonymized" (likely challenged, could block shipping late); "pseudonymous"
(jargon); stripping machine/session IDs (breaks required cohort tracking).

## 0018: Raise the minimum VS Code version to 1.106.0

**Decision (operator):** set `engines.vscode` to `^1.106.0` and `@types/vscode` to `~1.106.0`.

**Reasoning:** at 1.105.0, `viewsContainers.secondarySidebar` requires the proposed API
`contribSecondarySidebar`, which Marketplace extensions must not use. From the 1.106.0 source
it is a stable contribution point, so D0013 can stand. Users on VS Code 1.105 stop receiving
extension updates.

**Rejected:** the extension's own Activity Bar sidebar (rejected in D0013); an editor-group panel
(splits the editor); a proposed-API prototype (not publishable).

## 0019: The cooldown starts when the invitation is first visible

**Problem (Stage 2 review):** an invitation that is shown and then ignored (sidebar closed, other
view selected) records nothing, so it returned after the first milestone of every new session.
D0007 rejected that behavior.

**Decision (operator):** when the invitation first becomes visible, start the "Ask me later"
cooldown (14 days). An explicit choice then replaces it: opening the form sets 180 days, and
"Never again" is permanent. When two cooldowns apply, the later end date wins, so a later "Ask me later"
cannot shorten the 180 days set by opening the form (for example through Give Feedback).

**Consequence:** an ignored invitation is not recorded as `dismissed`; KQL sees it as
`invitationShown` without `invitationResolved`.

**Rejected:** recording `dismissed` at shutdown (unreliable writes; programmatic close must stay
silent); accepting a return every session (contradicts D0007).

## 0020: Normal survey behavior works automatically in development

**Decision:** remove `DOCUMENTDB_DEBUG_SURVEY_ENABLED` from the launch configurations and
runtime reader, together with its override resolver. Normal survey behavior is enabled
automatically in `ExtensionMode.Development`; Production and Test continue to use the code
kill switch, which remains false. Activity thresholds, cooldowns, opt-out, and feedback
permission still apply. Show Invitation and the separate always-invite preview remain available.

**Reasoning (operator):** "remove this setting, not really relevant, it should always just
work. I don't see its value now." Requiring a launch-variable toggle adds no value to the
normal development workflow.

**Implementation boundary:** automatic enablement is limited to development so removing the
toggle does not release the survey before its privacy/form/enablement gates. This is the
implementation's conservative interpretation of "just work", not approval to enable production.

**Supersedes:** D0016's environment-override mechanism. Its production code kill switch remains.
Removing only the empty launch entry would leave a hidden dependency on the same override;
the runtime path is removed as well.

## 0021: Re-enable surveys in production and development

**Decision (operator):** this PR reintroduces the survey for users. Set `SURVEY_ENABLED = true`
and use that same code switch in every extension mode. Remove the enablement environment
override and any development-only enablement rule. Normal activity thresholds, cooldowns,
opt-out, and telemetry permission remain enforced.

**Reasoning (operator):** "production will have the survey too, we're reintroducing it in this
PR, so just enable it in code for all debug and prod."

**Supersedes:** D0020's conservative development-only interpretation, which was corrected
before its validation/commit. The switch remains a code-level emergency disable mechanism,
not a launch setting. The separate always-invite preview still bypasses presentation gates
only in development and does not bypass telemetry permission.

**Verification boundary:** this is authorization to enable the feature in this PR, not evidence
that the external form, privacy packet, or real telemetry queries have been independently verified.

## 0022: Match the dashboard header and content surfaces

**Decision (operator):** make the survey's icon/title scale, header spacing, and background split
consistent with the Cluster Dashboard shown beside it.

**Reasoning (operator):** the screenshot's left-side dashboard is the visual reference: the
identity header should end with similar spacing, followed by the editor-colored content area.

**Implementation:** use a 36 px non-shrinking icon, 18 px/24 px semibold title, 12 px identity gap,
8 px vertical header padding, and aligned 14 px horizontal gutters. Use the dashboard's
`colorNeutralBackground2`/`colorNeutralStroke2` VS Code token mappings for the full-width header;
the body uses `vscode.editor.background`. Keep native HTML, not a new React/Fluent bundle,
and let long titles wrap rather than clip in narrow sidebars. No invitation copy or action changes.

## 0023: Optional local rating, recorded when opening the survey

**Decision (operator):** allow choosing a 1-5 rating in the invitation, then explicitly opening
the external survey. Stars select locally; they do not navigate. Send the selected rating in
telemetry for that opening action. Choosing a rating is optional: omit the field when no rating
is selected rather than inventing a zero or preselected answer.

**Reasoning (operator):** tying a gold effect to the button could suggest that the extension
preselected an answer. The operator prefers actual local selection followed by opening the form,
and accepts that the selection will not transfer and that users may drop off after seeing the
external survey's questions.

**Reversal:** supersedes the no-rating-collection/transmission portions of D0002, the
star-click navigation/identical-message portions of D0014, and D0017's claim that no answers
are recorded. Their other constraints remain: one fixed URL, explicit primary action,
feedback permission, bounded events, and no automatic forwarding to the external form.

**Implementation contract:** an optional numeric `selectedRating` measurement on invitation
`survey.openForm` events, restricted to integers 1-5. No rating in command-triggered openings,
selection-only messages, URLs, local persisted state, traces, or other events. Keep the existing
three-reported-attempt limit separate from unlimited explicit navigation attempts. Explain in
the visible copy that opening records the selected rating with extension telemetry, and that
the external form will not be prefilled. The schema/copy privacy packet must reflect this new
collection; this decision is not a claim of independent privacy approval.

## 0024: Complete the task-led UX pass and make rating resettable

**Decision (operator):** finish the original UX recommendations rather than leaving the
hierarchy/spacing and secondary-action work behind the newer star changes. Remove the
promotional heading, promote the question, use an 8/16/24 spacing rhythm, and make the
secondary controls/disclosure quieter without hiding opt-out. Keep the accepted smaller
helper text, dashboard identity header, optional rating, and single Open/Retry action.

**Rating behavior:** reduce the star glyph from 30 px to 24 px without shrinking its 40 px
hit area. Preview the hovered count locally and restore the committed selection on leave.
Activating the already-selected star clears the rating immediately, including keyboard
activation; subsequent opening omits `selectedRating`. Hover/reset/selection alone emit nothing.

**Reasoning (operator):** users currently cannot reset their selected rating, the stars should
be slightly smaller, and the earlier agreed whitespace/heading/secondary-control improvements
still had not been implemented. The operator reiterated the original assessment to make the
whole scope clear. "Hover tracking" is implemented as visual feedback, not new hover telemetry.

**Unchanged:** D0023 collection happens only on explicit opening under existing telemetry
permission/reporting bounds. An uncommitted hover is never submitted as a rating.

## 0025: Apply the rendering review to the invitation layout

**Decision (operator):** accept all observations and proposed changes from the rendering review
([iteration 3 log, Iteration 9](./iterations/03-pr-review-and-ux-preparation.md#iteration-9---rendering-review-and-modal-failures)).
Remove "Your Feedback Matters"; make the rating a compact, left-aligned group (36 px cells,
4 px gaps) with its description left-aligned below and "Open survey" 16 px after it; show
"Remind me later" / "Don't ask again" as left-aligned, natural-width VS Code secondary
buttons; use one 12 px helper size (no fractional `em` scaling, disclosure text muted); rewrite
the helper as "Optional: pick a rating, then finish the short survey in your browser."; and
show a light-glyph logo in dark and high-contrast dark themes.

**Reasoning (operator):** the spacing and rendering felt off without an obvious cause. The
rendered review located it — chiefly a 50 px gap between the stars and their action, stars
spread across the width, centered elements in a left-aligned layout, label-like secondary
actions, six text sizes, and a logo that disappeared on dark backgrounds — and the operator
agreed with every observation and proposed fix.

**Changes from earlier decisions:** reverses the restored "Your Feedback Matters" line and the
accepted smaller helper size (R8). D0022's editor-background surfaces are unchanged.
The dark logo is derived from the repository's vector logo; it matches the documentdb.io mark.

## 0026: Report open failures in a modal; remove Retry UI

**Decision (operator):** when opening the survey fails, show a modal error and nothing else. The
invitation no longer relabels "Open survey" as Retry or shows a status line; the host re-enables
the controls and shows the modal, and the user can choose "Open survey" again. The Give
Feedback command makes one attempt and shows the same modal, without a Retry action or loop.

**Reasoning (operator):** "we don't need that extra UI for 'retry', just a modal error dialog and
we're good" — the retry code was obsolete and too much code to maintain and test.

**Unchanged:** a failed attempt still records no outcome or acceptance cooldown; attempts are
still unlimited and only the first three invitation attempts emit `survey.openForm`. The
separate "Retry" on a failed opt-out _save_ is not part of this decision and remains.

## 0027: Centered smaller rating, stretched actions, no save Retry

**Decision (operator):** after reviewing D0025 in the browser:

- Helper copy: "Pick a rating (optional), then finish the short survey in your browser."
- Stars one default size smaller (24 → 20 px glyphs, 32 px cells) and centered, with the
  description centered below.
- The space above the stars equals the existing space below them to the primary button
  (ignoring the description text), so the stars sit visually centered.
- Remove the "Don't ask again" explanation line.
- Stretch "Remind me later" / "Don't ask again" to share the primary button's box.
- Rename "Open survey" to "Continue to survey".
- Use SVG logos for both light and dark themes.
- A failed opt-out save shows a modal stating that saving failed, with no Retry.

**Reasoning (operator):** refinements after seeing the D0025 render; centering suits the
smaller rating once the buttons below stretch to the same box. The failed opt-out save "is
really an edge case", so a modal is enough, in line with D0026's goal of less retry code to
maintain and test.

**Accepted consequence:** without a Retry, a failed opt-out save applies only until VS Code
restarts; nothing else writes after opt-out, so the user may be invited again later.
`SurveyStateStore.retrySave` is removed.
