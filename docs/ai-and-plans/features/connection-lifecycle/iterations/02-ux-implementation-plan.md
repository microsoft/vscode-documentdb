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

> **Baseline verified; live evidence pending (2026-11-27):** advisor
> `claude-opus-5.5` revalidated the relevant current source against `dd11ca7d3`.
> The operator explicitly decided F1/F4/F5 and approved the model mapping.
> The connected context tag still requires a cached client without a lifecycle hold;
> credential-save completion releases the update hold. Source inspection did not
> establish an F7 defect and is not a reproduction. The operator selected **Leave
> pending for operator testing; no speculative fix**. WI-0 is not claimed fully
> verified until that live evidence is supplied.

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

> **Done (2026-11-27), WI-1b commit `57f96b23b`:** explicit cluster-associated
> tree-command failures use one modal with an explained/localized heading and separate
> error detail. The Diagnostics wrapper was changed in place; command registrations and
> webview/no-cluster feedback are unchanged. Decisions: operator, explicit tree-origin
> policy; advised (`claude-opus-5.5`), 90% approval of the exact implementation after
> checking callers, cancellation, original error identity and single-feedback ownership.
> The worker (`gpt-6.1-sol`, as recommended) verified the installed azext runtime at
> 99% confidence. Fourteen focused tests were added and passed. Batch 1
> `npm run build` passed; seven touched test files passed (67 tests). No Case 2 checks ran.
> The initial wrapper-selection blocker was resolved by preserving registrations and
> changing Diagnostics itself; no public argument contract changed. F5/WI-1c remains open.

> **Done (2026-11-27), WI-1c-tree commit `c77ba2115`:** supported explicit stale recovery
> actions refresh first, then show one accurate removed/changed modal. Other stale states
> refresh quietly; a connection disconnected during sign-in retains the existing closed
> explanation. Worker sign-in entry points, identity checks, key/latch mutations and unsupported
> Azure Workspace guards are unchanged. Decisions: operator, explicit F5 option C; advised
> (`claude-opus-5.5`), 85% approval of the exact revision. Actual/recommended model:
> `gpt-6.1-sol`; the worker verified preserved invariants at 97%. Forty-four focused cases
> were added across the three command test files; 73 tests passed. Epoch-only presentation
> assertions intentionally became quiet, retaining no-auth-start assertions. No helper export
> or helper expansion was added. Worker notification handling remains a separate follow-up.

> **Done (2026-11-27), WI-1c-worker commit `0a01a24e4`:** an explicit stale sign-in click
> gets existing Shell/Playground-specific removed/changed guidance only when the terminal/file
> still exists and the current typed latch proves that failure. Cancellation, closed work,
> already-reported revisions, epoch-only and no-latch cases stay quiet. No worker is reset,
> stopped, restarted or rebound by these stale callbacks. Decisions: operator, explicit F5
> worker-surface policy; advised (`claude-opus-5.5`), 85% approval; actual/recommended
> `gpt-6.1-sol`. The leader's initial helper-name error was corrected before edits to reuse
> `handleWorkerFailure` and `getPlaygroundRecovery`. Thirty-eight focused cases were added;
> 163 tests passed. Existing ownership assertions are unchanged; the telemetry mock suppresses
> only the production fire-and-forget sign-in action. Final batch verification remains pending.

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

> **Execution split (2026-11-27):** WI-2a implements the approved, unit-testable F2 guidance
> first (`mai-code-2`, substituted for the advisor's Terra recommendation). WI-2b implements
> F8 system-output/input handling last, after other Shell changes, because terminal timing
> also needs a live workbench check. This is a coordination split, not additional scope;
> the accepted work-item count remains seven, plus conditional WI-7. No Shell-writing workers
> run concurrently.

> **Done (2026-11-27), WI-2a commit `a2eba522a`:** Shell and Playground now give the approved
> reason-specific recovery guidance. Unchanged Disconnect asks for tree reconnect and a new
> run in the existing terminal/file; removed and changed bindings keep their stricter guidance.
> Decisions: operator, explicit approval of the reason-specific copy; leader, 99% confidence
> after reviewing the message-selector diff and direct-latch reuse that execution guards and
> no-replay behavior are unchanged. Advised (`claude-opus-5.5`); recommended Terra, actual
> `mai-code-2` per the approved substitution. Eighteen focused cases were added across the
> existing two tests, retaining no-start/no-replay assertions; 118 tests passed. The new
> asynchronous Shell assertions use `vi.waitFor`, not a fixed sleep. Batch build/localization
> remain pending. WI-2b/F8 output is not implemented.

> **Done (2026-11-27), WI-2b commit `9d434732d`:** Disconnected is system output on its own
> line. Idle single-line input is preserved and visibly restored; partial multiline and queued
> evaluating input are cleared as approved. Wrapped input moves its caret to the end before the
> newline, preventing old input tails from appearing beside the status. Decisions: operator,
> explicit input-state policy; advised (`claude-opus-5.5`), 88% final approval. Recommended
> Terra, actual `mai-code-2` per the approved substitution. Five focused output cases were added;
> 134 Shell tests passed. Final build passed after the wrapped-cursor fix. Real terminal behavior
> still needs the operator check below; no live workbench verification is claimed.

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

> **Review correction pending (2026-11-27):** the first `mai-code-2` implementation passed
> 19 focused tests and type-checking, but advisor `claude-opus-5.5` (80%) found that a Retry
> reply can disclose a new irrecoverable reason. Keeping the old reason hides actual
> removal/settings/identity state. The operator selected adopting truthful current reasons,
> with the explicit constraint that an already-visible Retry button must not disappear after
> Retry or runtime state changes. This is not permission to change identity or bypass a hold.
> The corrected UI contract is pending; the initial implementation is not marked done.

> **Scope confirmed (2026-11-27):** the operator selected **1A**: retained Retry availability
> lasts for the current unavailable episode, including dialog dismissal/reopening. Successful
> recovery ends the episode; a later initially Close-only episode does not inherit Retry.
> New terminal reasons remain truthful, but cannot remove Retry already offered in that episode.

> **Done (2026-11-27), commit `6d2e10715`:** failed Retry feedback stays in the existing dialog.
> The current unavailable reason updates when the host reports a different reason/action; a
> separate bounded alert announces every failed attempt. Retry, once offered, remains through
> failures, runtime updates and dismissal/reopening of the same unavailable episode. Successful
> recovery resets availability for a later episode. Retained Retry explicitly dispatches `retry`,
> never `close`, and no original operation is replayed. Decisions: operator, explicit 2.A
> qualification and 1A episode scope; advised (`claude-opus-5.5`), 88% approval of the exact
> corrected revision. Recommended Terra, actual `mai-code-2` per the approved substitution.
> Eight focused tests were added across the two existing files; 23 tests passed. The interim
> type-check encountered concurrent WI-6 edits; WI-6 subsequently reported a successful root
> type-check. Final batch build and browser scenarios remain pending.

> **Browser fixture follow-up (2026-11-27), commit `039c1cbd8`:** real Document View lifecycle
> scenarios failed because the existing fixture did not acknowledge the void `reportDirty`
> mutation. The shared fixture now returns transport-compatible `null`; application code and
> scenario behavior are unchanged. Model `mai-code-2`; leader, 99% confidence after checking
> the actual host/link void-result contract. Static browser scenario tests passed (47).
> The nine Document View routes are being rerun; the earlier Collection View/Dashboard runs
> passed. This is a required validation-fixture repair, not a new product behavior.

> **Browser verification update (2026-11-27):** all 24 unique source routes passed:
> Collection View 9, Document View 9 and Dashboard 6, across dark, light and high contrast.
> No page/CSP/unknown-RPC or assertion failures remained. The `reportDirty` mutation was
> exercised successfully. Static scenario tests passed (47). Only owned watch servers were
> started/stopped; no background verification server was left running. These are source
> browser checks, not a live extension-host or screen-reader verification.

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

> **Verification update (2026-11-27):** Batch 1 build and focused tests passed. Localization
> generation will run once after all string-changing items. Live presentation remains pending.

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

> **Verification update (2026-11-27):** Batch 1 `npm run build` passed; both stats files were
> included in the seven-file focused test run (67 tests total).

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

> **Gate resolved (2026-11-27):** the worker stopped before edits because URI parser errors
> can contain credentials. Advisor `claude-opus-5.5` approved a constructor-only bounded
> replacement at 90%, and removing every mixed-case credential-key spelling at 95%.
> The operator selected **1.A**: **Invalid connection string.**, with the unsafe parser
> error/cause discarded entirely. WI-6 implementation resumed with the previously approved
> zero-cache, endpoint, trust and lifecycle constraints.

> **Completion scope approved (2026-11-27):** the operator questioned blanket removal of
> working suggestions, then agreed to an internal `includeClusterMetadata` flag that preserves
> local completion/ghost behavior but excludes authenticated shared metadata from the new
> anonymous diagnostic path. The completion provider and its existing tests are directly
> dependent owned files. Normal Shell behavior is unchanged; no fake IDs, new setting or
> blanket completion disablement is authorized. Implementation is in progress, not complete.

> **Done (2026-11-27), commit `aea08108a`:** the failure-row Shell is a separate NoAuth entry
> with a sanitized, re-read endpoint and epoch/latch guards. It does not read `CredentialCache`,
> alter saved credentials/clients, use shared authenticated metadata, pin an authenticated
> identity, create a token relay, fall back to saved authentication or replay operations.
> Local completion/history/bracket behavior and normal Shell startup are preserved. Constructor
> parser errors become the approved bounded message without an unsafe cause. Pre-terminal
> failures use one modal; later driver failures stay in the terminal.
> Decisions: operator, explicit F1 authentication/endpoint/parser/metadata boundaries; advised
> (`claude-opus-5.5`), 88% full-path approval and 90% approval of the final pre-terminal hunk.
> Actual/recommended model: `gpt-6.1-sol`. Seventy-two cases were added across the existing/new
> test files; the initial eight-suite run passed 392 tests without TDD failures, the final
> command suite passed 29 and the strengthened Shell suite passed 111. Root type-check passed;
> final build/localization remain pending. No public command contract or manifest entry was added.

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

> **Deferred, escalated (2026-11-27), operator decision:** leave F7 pending live testing
> with no speculative implementation. On the current build, try failed saved-password
> connection → Update Credentials → **Yes, reconnect now** → databases appear →
> right-click the refreshed cluster. Capture whether **Disconnect** is present, the cached
> client/held state from **Show Connection Stats**, and whether collapse/expand or Refresh
> changes the menu. Record the actual build/commit and state; do not label a source-only
> check **not reproducible**.

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

| WI   | Status                                                      | Outcome / decision / verification                                 |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| WI-0 | Gates approved; F7 live evidence pending                    | Current-code baseline checked; no live reproduction claim         |
| WI-1 | Implemented and locally verified; expansion deferred        | `57f96b23b`, `c77ba2115`, `0a01a24e4`; F3 expansion follows #1143 |
| WI-2 | Implemented and locally verified; terminal check pending    | `a2eba522a`, `9d434732d`; final Shell suite 134 passed            |
| WI-3 | Implemented and locally verified                            | `6d2e10715`, fixture `039c1cbd8`; 24 source routes passed         |
| WI-4 | Implemented and locally verified; live presentation pending | `5d00558cb`; generated localization current                       |
| WI-5 | Implemented and locally verified                            | `e4a6ad337`; Batch 1 build/tests passed                           |
| WI-6 | Implemented and locally verified                            | `aea08108a`; full-path approval 88%, final hunk 90%               |
| WI-7 | Deferred pending operator reproduction                      | No speculative code change; exact live sequence recorded          |

## Outcome

**Endpoint: local work, committed and Case 1 verified.** No push or review handoff was requested.
The only external edit was the operator-requested enhancement issue
[#1143](https://github.com/microsoft/vscode-documentdb/issues/1143). No CI run for a pushed head
is claimed. Case 2 (including `prettier-fix`, lint, strict package-test type-check, full runtime
suite and packaging) was not run and remains deferred until review handoff.

### Unverified workbench checks

1. **Shell output:** disconnect while idle, with partial single-line input, with a long wrapped
   input whose caret was moved Home, in multiline mode and while evaluating. Verify a separate
   system status line, preserved visible single-line input, cleared multiline/queued input and
   no stale output or replay. Try this before pushing.
2. **F7:** run the recorded failed-password → Update Credentials → reconnect → refreshed
   Disconnect-menu sequence on the current build. Capture client/held state; do not infer a
   regression from source or label it not reproducible without the live run.
3. **Presentation/accessibility:** inspect the Keep open/decoded-password/X copy in the workbench
   and verify a real screen reader notices each failed Retry. Source browser and ARIA tests are
   not a screen-reader or installed-extension check.

### Verification

- `npm run l10n`: passed; generated bundle committed separately as `6959c70f5`.
- `npm run build`: passed in the final batch and again after the last wrapped-cursor fix.
- Focused runtime batch: **18 files, 583 tests passed** (11.33 s).
- After the last added regression: the unchanged earlier files retain that result; the final
  Shell suite was rerun separately and **134 tests passed** (11.36 s). No combined 584-test
  invocation is claimed.
- Browser manifest/route tests: **47 passed** with the browser-specific Vitest config.
- Real source browser helpers: **24 unique routes ready** across all three themes:
  Collection View 9, Document View 9, Dashboard 6. A missing void-mutation fixture caused six
  initial Document View failures and was repaired in `039c1cbd8`; the rerun passed.
- No TDD contract failures. One interim root type-check saw concurrent unfinished NoAuth edits;
  the later root type-check and final builds passed.
- All owned browser/watch helpers were stopped. No dependency installation was required.
- Unrelated untracked `.copilot-connection-relays/` and `.copilot-connection-telemetry/` were
  left untouched.

### Decisions, review and model plan

Operator decisions are recorded in 0022–0025 and inline above. Retry availability is sticky only
within its unavailable episode; successful recovery resets it. The anonymous path isolates
authenticated metadata while preserving local completion behavior. Descendant expansion is
explicitly deferred to #1143, and F7 is pending operator evidence. No identity/latch guard was
weakened. The unsupported/no-latch cases stay quiet instead of receiving speculative explanations.

Thirty substantive advisory packets ran across six `claude-opus-5.5` agents. Exact code revisions
received their required logic reviews. The operator's sticky Retry direction superseded the initial
remove-Retry recommendation, and metadata isolation replaced the rejected blanket-completion and
fake-ID proposals. The leader's F10-copy and worker-helper-name mistakes were corrected before their
code commits. There were no coding-model authorization substitutions; Terra recommendations used
`mai-code-2`, mechanical WI-4 used `gpt-6-luna`, lifecycle/authentication used `gpt-6.1-sol`, and
checks used `mai-code-2-flash`, as approved.

### Usage: cumulative run

Start **2026-11-27 11:06:38 UTC**, snapshot **14:23 UTC**: approximately 196 minutes wall-clock.
Model-request spans below sum to 162m20s; overlapping model/tool/check spans are not additive.
Build and localization durations were not separately reported. The final response and subsequent
progress-record writes are excluded from this snapshot. AIU are not dollars.

| Model            | Role    | Requests | Summed model time |    AIU | Share |
| ---------------- | ------- | -------: | ----------------: | -----: | ----: |
| claude-opus-5.5  | advisor |      146 |            21m16s | 1277.8 | 47.6% |
| gpt-6-luna       | coding  |       13 |             1m13s |    2.0 |  0.1% |
| gpt-6.1-sol      | leader  |      135 |            95m58s | 1019.3 | 37.9% |
| gpt-6.1-sol      | coding  |      123 |            23m46s |  321.0 | 11.9% |
| mai-code-2       | coding  |       89 |            16m13s |   64.5 |  2.4% |
| mai-code-2-flash | checks  |       41 |             3m54s |    1.7 |  0.1% |

| Role    | Requests | Summed model time |    AIU | Share |
| ------- | -------: | ----------------: | -----: | ----: |
| leader  |      135 |            95m58s | 1019.3 | 37.9% |
| coding  |      225 |            41m12s |  387.5 | 14.4% |
| advisor |      146 |            21m16s | 1277.8 | 47.6% |
| checks  |       41 |             3m54s |    1.7 |  0.1% |

**Totals:** leader 1019.3 AIU; subagents 1667.0 AIU; run 2686.3 AIU.

| Model / role              |      Input |  Output | Cache read | Cache write | Reasoning |
| ------------------------- | ---------: | ------: | ---------: | ----------: | --------: |
| claude-opus-5.5 / advisor | 11,507,254 | 125,393 |  9,846,990 |   1,659,908 |    66,048 |
| gpt-6-luna / coding       |    723,017 |   9,623 |    653,250 |      69,728 |     6,183 |
| gpt-6.1-sol / leader      | 30,887,461 | 244,993 | 30,106,530 |     780,526 |   174,956 |
| gpt-6.1-sol / coding      | 10,009,918 |  77,779 |  9,413,490 |     596,059 |    27,223 |
| mai-code-2 / coding       |  5,329,087 |  47,245 |  4,499,968 |           0 |    20,975 |
| mai-code-2-flash / checks |    923,922 |   9,468 |    708,096 |           0 |     4,554 |

Cache/reasoning fields may overlap input/output; do not sum them into a purported token total.

### Usage: resumed work

Separate window **12:37:15–14:24 UTC**, approximately 107 minutes wall-clock, following the
operator-reported authentication restoration. The original blocked edit succeeded on retry;
no alternative access route was used while it was denied. This window is a subset of the
cumulative run, not an additional charge to add to it.

| Model            | Role    | Requests | Summed model time |   AIU | Share |
| ---------------- | ------- | -------: | ----------------: | ----: | ----: |
| claude-opus-5.5  | advisor |       47 |             6m25s | 503.8 | 30.8% |
| gpt-6.1-sol      | leader  |       72 |            72m44s | 849.7 | 52.0% |
| gpt-6.1-sol      | coding  |       89 |            18m37s | 250.9 | 15.4% |
| mai-code-2       | coding  |       45 |             6m34s |  28.6 |  1.7% |
| mai-code-2-flash | checks  |       36 |             3m36s |   1.4 |  0.1% |

| Role    | Requests | Summed model time |   AIU | Share |
| ------- | -------: | ----------------: | ----: | ----: |
| leader  |       72 |            72m44s | 849.7 | 52.0% |
| coding  |      134 |            25m11s | 279.5 | 17.1% |
| advisor |       47 |             6m25s | 503.8 | 30.8% |
| checks  |       36 |             3m36s |   1.4 |  0.1% |

**Resumed totals:** leader 849.7 AIU; subagents 784.7 AIU; run 1634.4 AIU.

| Model / role              |      Input |  Output | Cache read | Cache write | Reasoning |
| ------------------------- | ---------: | ------: | ---------: | ----------: | --------: |
| claude-opus-5.5 / advisor |  3,209,592 |  37,413 |  2,449,519 |     759,947 |    19,439 |
| gpt-6.1-sol / leader      | 23,416,229 | 178,087 | 22,779,798 |     636,215 |   147,875 |
| gpt-6.1-sol / coding      |  7,974,254 |  62,647 |  7,521,903 |     452,084 |    21,678 |
| mai-code-2 / coding       |  2,962,098 |  17,172 |  2,607,104 |           0 |     7,978 |
| mai-code-2-flash / checks |    836,803 |   9,122 |    674,304 |           0 |     4,476 |

**Optimization:** advising was the largest cumulative category (47.6%); leading was the largest
resumed category (52.0%). Repeated contract clarification, broad initial reading and long leader
turns were substantial overhead compared with coding/checks. For a future run, consolidate UX and
ownership gates into one compact packet, correct exact interfaces before dispatch, and keep leader
handoffs short. Preserve the approved model plan; these unlike tasks do not establish a model-quality
ranking.

## Case 2 follow-up (2026-11-27)

The operator requested committing the work, running the full Case 2 list, addressing failures,
then pushing once. A dedicated draft head, `dev/tnaum/connection-lifecycle-ux`, targets
`feature/connection-lifecycle`; the milestone is 1.2.0. The earlier local-only outcome above is
the record of the preceding endpoint, not the current publishing authorization.

| Command                   | Result                                                |
| ------------------------- | ----------------------------------------------------- |
| `npm run l10n`            | Passed                                                |
| `npm run prettier-fix`    | Passed; 18 formatted files committed as `6a8ad8756`   |
| `npm run l10n:check`      | Passed                                                |
| `npm run lint`            | Passed with the default heap after the fixes below    |
| `npm run build`           | Passed; rerun after the scoped lint fixes             |
| `npm run typecheck:tests` | Passed (exact strict package-test script)             |
| `npx vitest run`          | 449 files passed; 10,205 tests passed, 1 skipped      |
| `npm run package`         | Passed; rerun after fixes, producing the current VSIX |

The first lint run exhausted the default Node heap. The operator identified the main-branch
worktree exclusion fix, which was ported from `f38e0282f` as `9553a3810`, without merging unrelated
main changes. Its regression test passed, and lint no longer required an increased heap.
The now-completing lint run exposed 20 diagnostics in seven changed files; `mai-code-2` corrected
only type-visible comparisons, mock/error typing, synchronous awaits and log inspection.
All existing assertions, unknown-error coverage, error identity, view identifiers and redaction
coverage were retained. Those fixes are committed as `feb640c3f`; targeted lint and 63 focused
tests passed. Final default-heap lint, build and packaging passed after targeted formatting.
The added worktree regression passed; its three ported files passed the formatting check.

Readiness remains separate from publishing: there is no committed Section 6 AI pre-review file
for this UX round. The dedicated PR stays draft. The live workbench/F7/screen-reader checks and
the explicit #1143 deferral remain as recorded above; no human-review readiness is claimed.
No unrelated untracked `.copilot-connection-*` directories were changed.
