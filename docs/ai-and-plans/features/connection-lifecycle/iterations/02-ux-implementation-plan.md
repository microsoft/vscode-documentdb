---
feature: connection-lifecycle
kind: plan
status: draft
created: 2026-11-27
code:
    - src/tree/documentdb/ClusterItemBase.ts
    - src/tree/documentdb/DatabaseItem.ts
    - src/tree/documentdb/IndexesItem.ts
    - src/tree/BaseExtendedTreeDataProvider.ts
    - src/commands/openInteractiveShell/openInteractiveShell.ts
    - src/documentdb/shell/ShellSessionManager.ts
    - src/documentdb/shell/DocumentDBShellPty.ts
    - src/commands/playground/executePlaygroundCode.ts
    - src/webviews/documentdb/useBoundViewRecovery.ts
    - src/webviews/components/DisconnectedOverlay.tsx
    - src/documentdb/connectionTeardown.ts
    - src/tree/connections-view/DocumentDBClusterItem.ts
    - src/commands/showConnectionStats/showConnectionStats.ts
    - src/commands/showWorkerStats/showWorkerStats.ts
---

# Iteration 2: implement the connection-lifecycle UX review findings

> **Purpose:** translate the open findings in the
> [PR #1136 UX review](./01-pr1136-ux-review.md) into bounded implementation work for
> review, then execution by the `lead` skill. This plan is not approval to implement
> unresolved recommendations.

**Source of truth:** the review records the observed behavior, operator decisions,
recommendations and remaining uncertainty. Existing feature intent and accepted
constraints remain in the [feature overview](../README.md) and
[decisions](../decisions.md). If current code differs from the review's cited snapshot,
verify the current behavior before changing it; do not treat snapshot references as proof
that a reported issue still reproduces.

## Goal and scope

Implement the review's open, actionable user-experience findings while preserving the
connection-lifecycle safety rules: never change the identity bound to a retained view,
never replay a failed database operation, retain action-only tree recovery rows, and keep
worker/webview feedback on its intended surface.

In scope: F1–F5 and F7–F12 from the review. F6 is closed as accepted-as-is; Q1 is answered
without an extension change; the Dashboard diagnostics link is tracked in #1141. Do not
expand this work into broader network resilience, account sign-out handling, telemetry
redesign, or unrelated error-message cleanup.

## Authority and decision gates

1. Approved directions in the UX review are constraints: F2's rerun guidance, F3's
   tree-action modal policy, F8's separate Shell system-output line, F9's “Keep open”
   label, F10's explicit saved-password explanation, F11's accessible name, and F12's
   human-readable shared debug format.
2. The review's recommendations for F1, F4 and F5 are **not all final decisions**.
   Before implementing each item, confirm its unresolved behavior or exact wording with
   the operator. In particular:
   - F1 leans toward an unauthenticated Shell from error rows, but final label and
     behavior are still open.
   - F4's recommended in-dialog Retry failure treatment is not approved.
   - F5's recommended stale-explicit-click handling is not approved.
3. F7 is a reproduction gate, not a confirmed regression. Reproduce the exact credential
   repair sequence on the current build before changing menu eligibility. If it does not
   reproduce, record the evidence and close it without a speculative code change.
4. Do not append a decision to `decisions.md` for a recommendation merely because this
   plan records it. Once the operator confirms a significant new behavior, record that
   decision with their rationale before or alongside implementation.
5. Recheck affected source, related tests, and current localization patterns at execution
   time. Keep changes in the existing command/tree/webview surfaces; avoid new lifecycle
   abstractions unless current code demonstrates they are necessary.

### Execution authorization (2026-11-27)

The operator invoked `/lead` to process this plan, then explicitly approved the item/model
mapping and the remaining F1/F4/F5/F3 choices. The endpoint is **local work and commits**:
no push, external edits or Case 2 handoff was requested.

- Advisor: `claude-opus-5.5`.
- WI-1 expansion, WI-2, WI-3 and WI-5: `mai-code-2`, substituted for the advisor's
  `gpt-6.1-terra` recommendations at the operator's request.
- WI-4: `gpt-6-luna`, the advisor's mechanical-copy recommendation.
- WI-1 stale recovery and WI-6: `gpt-6.1-sol`, retained for lifecycle/authentication logic.
- Tests, builds and other tool-running agents: `mai-code-2-flash`.
- F1: replace the error-row action with **Open shell without authentication**, using the
  bounded authentication/endpoint policy in [decision 0022](../decisions.md#0022-offer-a-separately-unauthenticated-shell-from-failure-rows-only).
- F4: option B, with the bounded copy and in-view announcement in
  [decision 0023](../decisions.md#0023-keep-retained-view-retry-failure-feedback-inside-the-unavailable-dialog).
- F5: option C, with the explicit-click and quiet-background policy in
  [decision 0024](../decisions.md#0024-classify-explicit-stale-recovery-clicks-and-explain-only-failed-actions).
- F3: explicit tree-origin commands are included; webview-origin feedback is unchanged
  ([decision 0025](../decisions.md#0025-tree-origin-failures-use-modals-webview-origin-command-feedback-stays-unchanged)).
- WI-2: the operator requested proposed copy for other unavailable reasons before editing;
  the subsequent reason-specific Shell/Playground proposals were approved. Changed
  identity/settings and sign-in messages remain unchanged. Single-line partial Shell input
  is preserved; partial multi-line and queued evaluation input are cleared, as approved.
- WI-4: F10 changes explanatory copy only; the opt-in credential-save branch is unchanged.
  The final approved wording retains the cluster and successful decoded-password context:
  **Connected to "{cluster}" using the decoded password. Would you like to update your
  saved credentials with the correctly formatted password?**
- F3 expansion: the operator selected extension-owned TreeViews only. Azure Resources
  remains unchanged, with enhancement [#1143](https://github.com/microsoft/vscode-documentdb/issues/1143)
  created at their request. Foreground-origin/event-order verification is still required
  before implementing owned-view expansion.
- F7: current source inspection has not established a defect. A live reproduction is
  still pending; no speculative menu change is authorized.

Unrelated untracked `.copilot-connection-relays/` and `.copilot-connection-telemetry/`
directories were present at intake and are left untouched.

## Workstream order and dependencies

```text
WI-0: Revalidate findings and settle gates
  ├── WI-1: Tree feedback and explicit stale tree actions (F3; F5 decision-gated)
  ├── WI-2: Worker recovery wording and Shell output line (F2, F8)
  ├── WI-3: Retained-view Retry failure feedback (F4)
  ├── WI-4: Teardown, decoded-password, and overlay wording (F9–F11)
  ├── WI-5: Human-readable connection and worker stats (F12)
  ├── WI-6: Unauthenticated Shell from connection failure rows (F1)
  └── WI-7: Investigate F7 only if it reproduces
```

WI-1 through WI-6 are independent after WI-0 except:

- WI-1's stale-action behavior depends on the operator choosing an F5 option.
- WI-3 depends on the operator choosing an F4 option.
- WI-6 depends on the operator confirming F1's behavior and label.
- F7 is included in WI-0; only a reproducible defect creates a small implementation
  follow-up, which must be reviewed as a separate scoped change.

Workstreams may be grouped into reviewable PRs by surface, but keep distinct behavior
changes and their tests independently reviewable. Do not combine unrelated changes just
to reduce the number of PRs.

## WI-0: Revalidate findings and settle decision gates

**Review items:** F1, F4, F5, F7  
**Depends on:** none  
**Deliverable:** verified current-code baseline and explicit operator answers for the
behavior gates.

1. Check the current branch/build against the review's evidence; inspect the current
   implementations and tests named in the relevant F sections.
2. Reproduce F7 in the current build: failed connection → Update Credentials → choose
   reconnect with fresh credentials → inspect the cluster context menu after refresh.
   Capture whether a client exists, whether a latch applies, and the refreshed tree
   context tag. Do not infer the cause from a restart.
3. Present the operator the options and trade-offs in O2 and O3 and ask for a decision
   before coding F4 or F5.
4. Confirm F1's error-row Shell behavior and user-facing label. Keep normal context-menu
   Shell startup authenticated unless explicitly changed by a decision.
5. Record what was confirmed, rejected, or not reproducible in the progress notes for
   this plan. No code change is required for a non-reproducible F7.

**Done when:** current behavior is verified; F4/F5/F1 are either explicitly decided or
marked blocked; F7 has reproduction evidence and a disposition. Do not silently resolve
any of these gates in implementation.

## WI-1: Align tree-action failures and stale explicit recovery (F3, F5)

**Depends on:** WI-0 for F5; F3's tree-modal direction is already approved.  
**Likely areas:** `BaseExtendedTreeDataProvider`, database/index expansion providers,
tree recovery commands, and their existing tests.

- Use modal feedback for failures caused by tree actions, including descendant tree
  expansion and explicit tree commands, consistent with the cluster-expansion pattern
  and error-translation guidance.
- Present a translated heading and separate error detail. Avoid duplicate modals for one
  action, raw error paragraphs in tree children, or changing recovery children from
  actions into status text.
- Apply the chosen F5 policy only to an explicit click on a still-visible stale action:
  re-check state, refresh/reveal current tree state where appropriate, and explain an
  actually failed action using the selected behavior. Keep cancellation, disposed work,
  obsolete background replies, and already-completed recovery quiet.
- Never connect a different identity or restart work for a removed/disposed target just
  to make the stale action appear successful.

**Acceptance:**

- A failed database or index expansion gives one modal with the actionable explanation;
  no second notification/modal is emitted for the same failure.
- Tree items still expose recovery actions only.
- An explicit stale action follows the operator-approved outcome; cancellation and stale
  background work remain silent.
- The result does not bypass existing identity, epoch, or latch guards.

**Tests:** focused provider/command tests for modal feedback, one-error/one-feedback
behavior, current-state refresh, and quiet cancellation/background paths. Use existing
tree/error-translation helpers and assert the translated-message contract rather than
duplicating framework behavior.

> **Deferred, escalated (2026-11-27), WI-1a/F3 descendant expansion:** the advisor
> (`claude-opus-5.5`, 40% confidence in origin attribution) found no documented ordering
> between `onDidExpandElement` and the first failing `getChildren`. Options were modals
> for all owned-view failures including background refresh, a workbench event-order probe
> without an API guarantee, or deferral. The operator explicitly chose to ship
> tree-command alignment and defer descendant expansion to
> [#1143](https://github.com/microsoft/vscode-documentdb/issues/1143) until foreground
> attribution is supported. No expansion code was changed. The issue records Azure
> scenarios, benefits, background-noise risks and host-coordination trade-offs.

## WI-2: Correct worker recovery guidance and Shell status output (F2, F8)

**Depends on:** none.  
**Likely areas:** `DocumentDBShellPty`, `executePlaygroundCode`, their tests, and the
connection-lifecycle user manual.

- For an unchanged disconnected connection, tell the user to reconnect from the tree and
  run the command/script again in the existing Shell/Playground. Do not request a new
  Shell or a new connection pick when the retained binding can recover in place.
- Preserve stricter guidance for a removed connection or changed host/identity. Do not
  promise worker-local variables survive when a worker must restart.
- Emit Shell “Disconnected” as system output on a separate line from the interactive
  prompt. Handle idle, partially typed, and evaluating states deliberately; preserve
  user input when possible rather than applying a newline blindly.
- Localize changed/new user-facing copy and update the manual's disconnect/reconnect
  guidance so it matches the implemented behavior.

**Acceptance:**

- Same-identity Disconnect → Reconnect guidance allows a retained Shell and Playground
  to retry without reopening/re-picking.
- Changed or removed bindings retain their accurate non-recovery guidance.
- “Disconnected” cannot be mistaken for text typed at the Shell prompt, including when
  emitted during partial input or evaluation.

**Tests:** focused Shell output tests for idle/partial/evaluating states; Playground
message tests for unchanged versus changed/removed bindings; relevant manual link/content
check if available.

## WI-3: Keep failed retained-view Retry feedback in context (F4)

**Depends on:** WI-0 operator decision.  
**Likely areas:** `useBoundViewRecovery`, `DisconnectedOverlay`, and the three retained
view recovery tests/scenarios.

Implement only the operator-selected O2 option. If the recommended in-dialog option is
selected:

- Keep the persistent unavailable reason distinct from the latest Retry failure.
- Show a concise, bounded failure explanation in the existing dialog; do not replace the
  original reason with unsupported network/server assumptions or expose a raw stack.
- Make Retry, Close view, and X behavior available again after failure. Ensure an
  assistive-technology user is notified of the new failure.
- Do not add a host modal, replay the failed database operation, or change the retained
  content/copy behavior.

**Acceptance:** a typed unavailable result and an unclassified thrown exception both
leave the user with one coherent in-view explanation and usable recovery/close controls;
failure does not execute the original operation again.

**Tests:** focused hook/component tests for typed and thrown Retry failures, restored
controls, announcement, and no operation replay. Exercise Collection View, Document View,
and Dashboard if their shared integration wiring differs.

## WI-4: Clarify teardown and retained-content wording (F9–F11)

**Depends on:** none.  
**Likely areas:** `connectionTeardown`, `DocumentDBClusterItem`, `DisconnectedOverlay`,
related tests, and localization.

- Change the retained-view choice label from “Keep open (disabled)” to “Keep open”.
  Preserve the disabled-operation behavior and existing help that explains the resulting
  state.
- In the decoded-password confirmation, say that the correctly formatted password will
  be saved into the connection's saved credentials. Preserve the existing explicit
  opt-in action and never include the secret value.
- Change the overlay X accessible name to “Dismiss dialog to access view contents”.
  Preserve the existing behavior: dismissing exposes retained contents for inspection
  and copying but does not restore database operations.
- Update localized strings using the repository localization workflow when implementing.

**Acceptance:**

- The teardown option is “Keep open” and does not change teardown semantics.
- The password confirmation communicates what is saved without revealing the password
  or changing the save action.
- The accessible name describes content access, and dismissing still leaves database
  operations blocked.

**Tests:** focused existing component/command tests for the rendered label, confirmation
copy and action, accessible name, and blocked-operation behavior.

> **Done (2026-11-27), commit `5d00558cb`:** F9 now says **Keep open**; F10 retains the
> successful decoded-password/cluster context and explicitly names the correctly formatted
> password saved in credentials; F11 names access to retained contents. The save branch,
> teardown settings and blocked-operation behavior are unchanged. Decisions: operator,
> explicit approval of the exact copy; leader, 99% confidence after reviewing the
> mechanical source diff that the action/save semantics were preserved. Advised
> (`claude-opus-5.5`) during WI-0; its `gpt-6-luna` recommendation was used. One added
> decoded-password workflow test proves dismissal does not save. The three focused
> Vitest files passed (26 tests), including after the operator-driven F10 correction.
> The original generic F10 prompt was a leader error, corrected before commit.
> Batch build/localization and live workbench presentation checks remain pending.

## WI-5: Unify human-readable debug-stat formatting (F12)

**Depends on:** none.  
**Likely areas:** `showConnectionStats`, `showWorkerStats`, their tests.

- Use multiline labeled records for both commands, with consistent headings, indentation,
  units, and a single explicit missing-value convention. Do not use decorative rulers.
- Preserve each command's existing facts and availability, including worker/session
  counts, held/pending states, Entra expiry, session identifiers, and init-duration facts
  where currently available.
- Keep state descriptions truthful: a cached client is not a successful ping; pending
  startup is not a live connection. Preserve redaction boundaries and do not add
  credential values or new identifying information.
- Keep host-client and worker/session data distinct; formatting consistency does not
  imply they measure the same thing.

**Acceptance:** both commands use the same readable record conventions without losing
existing fields, inventing values, or disclosing sensitive data.

**Tests:** focused output tests for headings, field labels/units, missing values, and
redaction-safe output. Assert representative formatting without overfitting whitespace
that is not user-visible.

> **Done (2026-11-27), commit `e4a6ad337`:** both stats commands now use labeled
> multiline records, explicit units and **(not available)** for missing values, preserving
> existing host-client, pending/held, worker/session, expiry and username facts.
> Decisions: operator, explicit F12/model approval; leader, 99% confidence after comparing
> the mechanical output diff that existing values/redaction boundaries were retained.
> Advised (`claude-opus-5.5`); recommended `gpt-6.1-terra`, actual `mai-code-2` per the
> approved substitution. Five tests were added across the two stats test files; all
> nine focused tests passed. Review replaced an `as never` evaluator fixture with a real,
> typed evaluator using a mocked worker. Batch build remains pending.

## WI-6: Offer an unauthenticated Shell from connection failure rows (F1)

**Depends on:** WI-0 operator confirmation of behavior and label.  
**Likely areas:** `ClusterItemBase`, `openInteractiveShell`, Shell startup options, and
focused command/tree tests.

- Add a distinct error-row entry path that starts a Shell without attempting the failed
  saved authentication. Do not change ordinary authenticated Shell startup from the
  cluster context menu.
- Keep saved credentials, `CredentialCache`, connection identity, and existing clients
  unchanged. Do not silently fall back to saved authentication after anonymous database
  operations are rejected.
- Make clear in the final, operator-approved label that this Shell starts without
  authentication. Opening it does not promise that database commands are authorized.
- Preserve existing error-row recovery behavior and action ordering.

**Acceptance:**

- Error-row Shell startup does not read/use cached credentials or make an authenticated
  startup attempt.
- Normal context-menu Shell startup remains authenticated and unchanged.
- Anonymous command failure is surfaced honestly; no credential state is modified.

**Tests:** focused command tests contrasting error-row and normal entry, proving no
credential use or mutation on the former and preserving the latter's existing startup
path. Test the anonymous command failure feedback.

## WI-7: Investigate F7 only if WI-0 reproduces it

**Depends on:** WI-0 evidence.  
**Likely areas if confirmed:** credential repair refresh path, connected context-tag
calculation, Disconnect menu condition.

Do not pre-emptively alter command visibility. If reproduced, identify and fix the
smallest stale-state or refresh defect supported by evidence; preserve the rule that
Disconnect is available only for a currently connected eligible tree item. If not
reproduced, record the tested build and state checks in this plan and close the finding
without a code change.

**Acceptance if fixed:** after successful credential repair and reconnect, the refreshed
connected cluster item exposes Disconnect; disconnected/error items do not.

**Tests if fixed:** regression test the exact state transition and ensure the menu remains
hidden when no connected client is present or a latch applies.

## Cross-workstream verification

For code changes, follow the repository's Case 1 checks while implementation is in
progress: `npm run build` and `npx vitest run <touched test paths>`. Run `npm run l10n`
only if localized strings change. Do not claim the full handoff suite passed unless it
was actually run; if this work is later prepared for review, follow the repository's
Case 2 requirements.

Before calling this iteration complete:

- Verify all new/changed strings use `vscode.l10n.t()` where required and generated
  localization output is current.
- Verify tree recovery remains action-only and connection/view identity safety is
  unchanged.
- Run the focused regression tests for every implemented workstream; run relevant webview
  scenarios for changed retained-view behavior.
- Update the user manual only where the implemented recovery guidance changes.
- Record each operator decision, deviation, test result, and any non-reproduced finding
  in the corresponding workstream progress record. Do not mark an unimplemented finding
  fixed.

## Progress

| WI | Status | Outcome / decision / verification |
| --- | --- | --- |
| WI-0 | Pending operator review | |
| WI-1 | Commands/stale actions in progress; expansion deferred | F3 expansion follows #1143, operator decision |
| WI-2 | Pending | |
| WI-3 | Pending operator decision | |
| WI-4 | Implemented; batch/live checks pending | `5d00558cb`; 26 focused tests passed |
| WI-5 | Implemented; batch checks pending | `e4a6ad337`; nine focused tests passed |
| WI-6 | Pending operator decision | |
| WI-7 | Conditional on reproduction | |
