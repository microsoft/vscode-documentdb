---
feature: connection-lifecycle
kind: review
status: active
prs: [1146]
created: 2026-11-27
verified: 2026-11-27
---

# PR #1146: Copilot comment validation

## Scope and review policy

Reviewed [the refinement PR](https://github.com/microsoft/vscode-documentdb/pull/1146) at
`dec9ac64cbdb18f295fb0f05a7ebe12955703c47`, against `feature/connection-lifecycle`.
The [Copilot review](https://github.com/microsoft/vscode-documentdb/pull/1146#pullrequestreview-6090776593)
contains 12 inline comments; all 12 were unresolved and current when retrieved.
The PR is now non-draft; that is an externally changed status, not a readiness decision made here.

The leader verified the claims against source and focused behavioral probes, then consulted
**Claude Opus 5.5** as the read-only advisor. The operator selected the actions recorded below on
2026-11-27. The initial validation pass made no production changes, commits, pushes, GitHub replies,
or thread resolutions. The lead implementation run is recorded separately below.

The operator's priorities for this review:

- Standard workflows should work without elaborate machinery for implausible races.
- Edge cases must not permit data loss, wrong-target execution, or automatic replay.
- A **won't fix** recommendation is legitimate when safety is preserved and the benefit is small.
- Separate a real behavior defect from an overstated severity or unnecessarily broad solution.

Severity: **High** breaks a central supported workflow; **Medium** materially disrupts routine
actions or has a concrete wrong-target/input/write-outcome risk; **Low** is bounded feedback or
ergonomic degradation. Severity and disposition are separate: a low-frequency wrong-target defect
still warrants a fix. None of these findings proves that database data was actually lost.

## Operator-selected disposition

The operator directed **"c10, ignore/wont fix."** and selected the recommended actions for every
other item. This selects nine fixes and three won't-fix/defer outcomes (C05, C10, C12).
No additional rationale was supplied; the review's option analysis is preserved below rather
than attributing new reasoning to the operator. Selection is not implementation.

| Item | Copilot severity | Validity | Assessed severity | Selected action |
| --- | --- | --- | --- | --- |
| [C01](#c01-diagnostic-worker-startup-rejects-authentication-holds) | High | Confirmed | High | Fix: explicit diagnostic startup capability |
| [C02](#c02-vm-diagnostic-shell-can-use-the-wrong-port) | High | Confirmed | Medium | Fix: retain attempted endpoint; fail closed when unknown |
| [C03](#c03-stale-diagnostic-shell-click-has-generic-feedback) | Medium | Confirmed, stale-node claim qualified | Low | Fix: supported-view refresh and typed stale feedback |
| [C04](#c04-old-playground-sign-in-can-warn-a-new-connection) | Medium | Confirmed | Low | Fix: two connection-ownership checks |
| [C05](#c05-completed-edit-can-silently-supersede-tree-sign-in) | Medium | Confirmed | Low | Won't fix / defer richer change attribution |
| [C06](#c06-genuine-sign-in-dismissal-can-show-a-stale-modal) | Medium | Confirmed | Low | Fix: distinguish genuine dismissal from stale cancellation |
| [C07](#c07-disconnect-restores-text-but-not-the-cursor) | Medium | Confirmed | Low | Fix with C09: restore text and cursor |
| [C08](#c08-anonymous-startup-failure-also-notifies-the-host) | Medium | Confirmed | Low | Fix: anonymous-only notification guard |
| [C09](#c09-late-shell-sign-in-output-corrupts-the-visible-prompt) | Medium | Confirmed | Medium | Fix: bounded asynchronous output handling |
| [C10](#c10-anonymous-command-result-is-discarded-on-host-client-churn) | Medium | Confirmed; guard is intentional | Medium for write-outcome feedback | Won't fix: operator override; no guard or message changes |
| [C11](#c11-index-failures-can-show-two-tree-modals) | Medium | Confirmed | Medium | Fix: explicit feedback ownership, not suppressDisplay |
| [C12](#c12-host-side-stale-retry-cancellation-becomes-an-alert) | Medium | Confirmed | Low | Won't fix / defer typed cancellation outcome |

Suggested implementation order for this run: C01, C02, C11; then the shared C07/C09 input work;
then cheap C04/C08/C06/C03 feedback refinements. C05 and C12 need no new architecture this round.
C10 is excluded from implementation. The operator withdrew the initial C01/C02 deferral.
All nine accepted fixes are in scope for this run; all remain unimplemented at intake.

### Lead run intake (2026-11-27, 17:17 UTC)

The operator requested committing this plan and implementing it as a lead with an advisor,
initially with **"we skip work items 1 and 2 for now."** Before coding, the operator corrected
this as a different-project instruction: **"here we don't skip 1 and 2"**, then confirmed
**"we work on all decided/accepted work items."** C01 and C02 are included; the initial
deferral is superseded. C05, C10 and C12 retain their selected won't-fix/defer outcomes.

The operator confirmed the model assignments: **claude-opus-5.5** advisor;
**mai-code-2** for smaller coding items, **gpt-6.1-sol** for lifecycle/concurrency work;
**mai-code-2-flash** for checks. The advisor supplies the implementation mapping and technical
decisions within the accepted scope before coding.

Endpoint: local implementation and separate item commits, with Case 1 build and focused tests.
No push, PR-status change, or thread resolution is authorized by this run. Full Case 2 is not
part of this ongoing-work endpoint.

The operator authorized a summary **in each item's Copilot review thread**, explaining what
changed and why, with a commit reference when available: **"always in the thread, no one
multi-comment."** Do not post an omnibus PR comment. Any local-only commit reference must be
identified as not yet pushed rather than linked as though available on GitHub.

### Advisor implementation mapping

**Advised (claude-opus-5.5, 2026-11-27):** all nine selected fixes fit the existing code.
No new user-facing strings or changed authentication identity rules are planned. Each item gets
its own code commit; C07 precedes C09, and C01 precedes C03. Items sharing the PTY run sequentially.
Tests use the root Vitest configuration with `--maxWorkers=2`.

| Item | Advisor-recommended / assigned model | Owned implementation and test scope | Confidence |
| --- | --- | --- | --- |
| C01 | gpt-6.1-sol | ConnectionUnavailableError; WorkerSessionManager; ShellSessionManager; openInteractiveShell; dependent tests | 85% |
| C02 | gpt-6.1-sol | AzureVMResourceItem and its focused new test | 80% |
| C03 | mai-code-2 | openInteractiveShell and its test, after C01 | 85% |
| C04 | mai-code-2 | executePlaygroundCode and its test | 95% |
| C06 | gpt-6.1-sol | signInAgain and its test; final cross-surface checks after other edits | 80% |
| C07 | mai-code-2 | ShellInputHandler and DocumentDBShellPty with their tests, after C08 | 90% |
| C08 | mai-code-2 | DocumentDBShellPty and its test | 95% |
| C09 | gpt-6.1-sol | DocumentDBShellPty and tests, using C07's input restore method | 85% |
| C11 | mai-code-2 | commandErrorHandling; three index callbacks; wrapper and focused index tests | 90% |

Approved implementation interfaces supplied by the advisor:

- C01: `isDiagnosticAuthenticationHold(reason: ConnectionUnavailableReason | undefined): boolean`,
  with an explicit host-only `allowDiagnosticAuthenticationHold = false` startup parameter passed
  through worker startup. Shell passes it only for the separate diagnostic path; no wire-message flag.
- C07: `ShellInputHandler.restoreLine(text: string, cursor: number): void`, clamping the cursor
  and using the existing renderer without clearing multiline/history state or firing buffer callbacks.
- C09: private PTY `writeAsyncFeedback(line: string): void`, with queued feedback during evaluation
  or disabled input, flushed at the next safe prompt. Disconnect clears obsolete queued feedback.
- C11: `markCommandErrorPresented(context: IActionContext, error: unknown): void`, with exact
  invocation/error ownership. Skip only additional tree UI, preserving webview behavior, explanation
  telemetry and presentation for a different cleanup error.

The leader accepts this mapping within the already approved solutions; material deviations still
return to the advisor/operator. Existing exact-output tests may change only where the accepted
cursor restoration changes their actual behavior, not merely to make a failing test pass.
Live checks remain pending: C09 installed-terminal redraw and C02 provider node lifetime/refresh.

## C01. Diagnostic worker startup rejects authentication holds

**Comment:** [Copilot C01](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515405).

**Evidence and impact.** The command and
[Shell latch filter](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/ShellSessionManager.ts#L462)
allow diagnostic startup through three authentication holds. However,
[WorkerSessionManager's startup assertion](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/playground/WorkerSessionManager.ts#L351)
rejects every latch. Its repeated checks include the boundary before worker construction.
A real ShellSessionManager calling the real WorkerSessionManager rejected all three probe cases
before spawning, while leaving the latch intact.

The existing Shell tests mock WorkerSessionManager, so their passing bypass tests do not verify
this integration. `credentialsRejected` is a concrete production path; the other two cases also
test the intended capability boundary. This fails safely, but defeats the recovery action precisely
when rejected authentication made it useful. **High; fix.**

**Options.**

- **Recommended:** pass a host-only diagnostic capability into worker startup and share the narrow
  authentication-hold predicate. **Pros:** fixes the actual boundary; preserves shared state;
  ordinary Shell/Playground checks stay strict. **Cons:** one startup API change and dependent tests.
- Infer the bypass from `authMechanism === 'NoAuth'`. **Pros:** fewer parameters.
  **Cons:** also affects ordinary saved NoAuth sessions; rejected.
- Won't fix. **Pros:** no changes. **Cons:** leaves the accepted diagnostic workflow broken; not recommended.

**Acceptance:** real Shell-to-worker startup under each allowed hold; ordinary NoAuth remains
blocked; Disconnect, removal, updates, aborts and superseding epochs remain blocked. No credentials,
token relay, shared-client mutation, or automatic authenticated fallback.

**Author decision (2026-11-27):** selected the recommended explicit diagnostic startup capability
and shared narrow authentication-hold predicate. Implementation pending.

**Deferred by operator (2026-11-27):** skip C01 for this lead run. The accepted fix remains pending.

**Deferral withdrawn by operator (2026-11-27):** the skip instruction was for a different
project. C01's accepted fix is included in this lead run; implementation pending.

## C02. VM diagnostic Shell can use the wrong port

**Comment:** [Copilot C02](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515477).

**Evidence and impact.**
[VM discovery](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/plugins/service-azure-vm/discovery-tree/AzureSubscriptionItem.ts#L105)
seeds `host:27017`.
[The VM credentials path](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/plugins/service-azure-vm/discovery-tree/vm/AzureVMResourceItem.ts#L123)
asks for a port and builds a different URI without updating that model.
The inherited diagnostic endpoint still returns the model URI. Credential-cache recovery is both
unreliable after failure and forbidden on this anonymous path.

Default-port users are unaffected. Custom-port users usually get a misleading refusal; if another
anonymous-capable server listens at 27017, arbitrary Shell commands can target it instead.
The banner exposes the port, but that is not an adequate correctness guard. **Medium; fix required.**
There is no evidence that a destructive command was actually executed against another server.

**Options.**

- **Recommended:** retain the credential-free endpoint actually attempted on that VM node and
  override its endpoint reader. Record it on the connection-attempt path, not from a diagnostics-only
  port prompt. **Pros:** preserves the feature and correct port, with small node-local state.
  **Cons:** a recreated node has no trustworthy attempted endpoint and must report unavailable.
  Re-reading must observe a later attempt with a different port rather than returning a frozen URI.
- Always return unavailable for VM diagnostic endpoints. **Pros:** smallest fail-closed fix;
  eliminates wrong-target risk. **Cons:** loses the diagnostic Shell even for default-port VMs.
- Prompt or fetch credentials during endpoint re-read. **Pros:** can recover the port.
  **Cons:** violates the approved no-authentication/no-ARM path and can repeatedly prompt; rejected.

**Acceptance:** failed attempts on default and custom ports, cache eviction, another attempt on a
different port, and node recreation. Unknown endpoint must never silently fall back to 27017.

**Author decision (2026-11-27):** selected retaining the credential-free attempted VM endpoint
with an overridden reader that fails closed when the endpoint is unknown. Implementation pending.

**Deferred by operator (2026-11-27):** skip C02 for this lead run. The accepted fix remains pending.

**Deferral withdrawn by operator (2026-11-27):** the skip instruction was for a different
project. C02's accepted fix is included in this lead run; implementation pending.

## C03. Stale diagnostic Shell click has generic feedback

**Comment:** [Copilot C03](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515571).

**Evidence and impact.**
[The command](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/openInteractiveShell/openInteractiveShell.ts#L105)
correctly blocks lifecycle holds, but its catch shows a generic modal without the supported-node
refresh used by other recovery commands. A bare epoch mismatch also maps to `credentialsChanged`.
Removal or update may already refresh the provider, so "leaves the old node visible" is not universal.
No unsafe connection starts. **Low.**

**Options.**

- **Recommended cheap fix:** reuse supported-view refresh routing and existing removed/changed
  wording only when the current typed latch proves that cause. **Pros:** consistent actionable UX.
  **Cons:** a few routing guards; unsupported Workspace branches must remain unchanged.
- Won't fix. **Pros:** safe existing behavior and narrow stale-click window.
  **Cons:** less useful explanation and possibly stale recovery rows.

Do not infer an actual settings change from an epoch mismatch alone, or create a new provenance
tracker just for this command. **Acceptance:** removed/changed supported nodes, unsupported nodes,
cancelled work, and epoch-only supersession without a false "connection changed" claim.

**Author decision (2026-11-27):** selected the recommended supported-view refresh and typed
removed/changed feedback, without speculative epoch attribution. Implementation pending.

## C04. Old Playground sign-in can warn a new connection

**Comment:** [Copilot C04](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515627).

**Evidence and impact.**
[Both stale-feedback branches](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/playground/executePlaygroundCode.ts#L414)
check that the document is open but omit its current connection ownership.
Probes re-picked A to healthy B and then removed A, before the click and during sign-in:
both produced A's removal warning against the document now using B. The newer evaluator was
not disposed and no operation was replayed. Existing "re-picked healthy" tests omit A's removal
latch, which is why they miss this combination. **Low; cheap fix.**

**Options.**

- **Recommended:** require `service.getConnection(documentUri) === connection` in both feedback
  branches. **Pros:** two local checks; preserves legitimate removal feedback for the same document.
  **Cons:** requires focused race tests.
- Reuse the whole `stillOwnsAction()` predicate. **Pros:** existing helper.
  **Cons:** suppresses legitimate feedback when removal has disposed the old evaluator; rejected.
- Won't fix. **Pros:** state remains safe. **Cons:** a straightforward ownership defect remains.

**Author decision (2026-11-27):** selected the two document-connection ownership checks in the
stale-feedback branches, not the full evaluator-ownership predicate.

**Done (2026-11-27), commit `1fdcfd43d` (local, not pushed):** mai-code-2 added both ownership
guards and four stale-feedback race cases. Same-document feedback and evaluator state are preserved;
no reset or replay. Advised (claude-opus-5.5): approved at 90% confidence after verifying the stored
connection object identity and both async branches. Focused Playground suite: 38 passed.
Final batch build remains pending. [Thread reply](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4722213773).

## C05. Completed edit can silently supersede tree sign-in

**Comment:** [Copilot C05](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515692).

**Evidence and impact.**
[The save helper](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/saveConnectionEdit.ts#L120)
can clear the update latch after the changed settings persist.
[The sign-in currentness check](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/signInAgain/signInAgain.ts#L146)
still rejects the old epoch/credentials, but `reportClosed()` then has no typed change reason.
A probe replacing credentials and clearing the latch during acquisition confirmed refresh without
a modal or client startup. This probe models the completed-edit outcome, not a real storage write.
Safety is intact; only feedback is missing in a two-action overlap. **Low.**

**Options.**

- **Recommended won't fix / defer:** keep quiet supersession and refreshed tree state.
  **Pros:** no new history, storage reads, secret comparisons or ambiguous attribution.
  **Cons:** the older sign-in action can end without explaining why.
- Capture authoritative saved settings and compare later. **Pros:** can identify some completed edits.
  **Cons:** asynchronous storage/error handling and sensitive in-memory comparison for a small benefit;
  cache object inequality or epoch alone is not proof of an edit.
- Add a bounded change-version token. **Pros:** precise if lifecycle-wide semantics are well-defined.
  **Cons:** new state and call-site responsibilities; disproportionate for this round.

Do not relax the stale credential/epoch guard. A future fix must distinguish real edits from Retry,
Disconnect/reconnect, and concurrent successful sign-in without guessing.

**Author decision (2026-11-27):** selected the recommended won't-fix/defer outcome: retain quiet
supersession and refreshed tree state; do not add richer completed-edit attribution this round.

## C06. Genuine sign-in dismissal can show a stale modal

**Comment:** [Copilot C06](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515749).

**Evidence and impact.**
[The catch order](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/signInAgain/signInAgain.ts#L211)
checks stale acquisition before genuine dismissal. A probe rejecting acquisition with
`User did not consent to login.` after removal showed a modal and started no client.
Internal stale-acquisition checks also use UserCancelledError, so blindly moving the cancellation
check first loses intentional feedback for genuine stale actions. **Low.**

**Options.**

- **Recommended bounded fix:** distinguish actual dismissal at the session-acquisition boundary
  from internally generated stale cancellation, then keep genuine dismissal quiet.
  **Pros:** matches the approved cancellation UX with local control flow.
  **Cons:** needs two clearly distinguished outcomes and tests; avoid broad message heuristics.
- Won't fix / defer. **Pros:** the modal is truthful and only appears in the overlapping tree path.
  **Cons:** contradicts the quiet-user-cancellation policy.

**Acceptance:** dismissal after removal/update is quiet; accepted sign-in superseded by removal
still explains; worker-origin recovery remains quiet; no client starts for either stale case.

**Author decision (2026-11-27):** selected distinguishing actual session-acquisition dismissal
from internally generated stale cancellation, keeping genuine dismissal quiet.

**Done (2026-11-27), commit `2688f86ca` (local, not pushed):** gpt-6.1-sol captures genuine
acquisition dismissal and handles it before stale-action presentation. Successful stale acquisition,
worker quietness and identity/provider/epoch guards are preserved. Added 13 focused cases;
sign-in suite: 41 passed. Advised (claude-opus-5.5): approved at 90% confidence, including exact
error identity through the acquisition handler. Final batch build remains pending.
[Thread reply](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4722213722).

## C07. Disconnect restores text but not the cursor

**Comment:** [Copilot C07](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515827).

**Evidence and impact.**
[Disconnect](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/DocumentDBShellPty.ts#L282)
captures the partial buffer, moves to End, and restores text with the cursor at its end.
The actual PTY probe typed `abcdef`, moved to position 2, disconnected, inserted `X`, and submitted:
evaluation received `abcdefX`, not `abXcdef`.
Nothing executes automatically, and the relocated cursor is visible. **Low**, rather than
claiming this alone causes database loss; nonetheless preserve editing intent with a small fix.

**Options.**

- **Recommended with C09:** capture logical cursor position and use an input-handler
  text-and-cursor restore operation backed by the existing wrap-aware renderer.
  **Pros:** predictable editing; reusable for asynchronous feedback.
  **Cons:** a small input API addition and wrapped-line tests.
- Won't fix. **Pros:** visible End placement is understandable after explicit Disconnect.
  **Cons:** breaks the "keep typing where I was" expectation for retained drafts.
- Restore through repeated synthetic arrow keys. **Pros:** no new method.
  **Cons:** couples to escape parsing, Unicode movement and repeated rendering; not recommended.

Do not change the separately approved behavior that drops incomplete multiline/queued executing
input on Disconnect. No reconnect or replay is part of this restoration.

**Author decision (2026-11-27):** selected restoring the partial input's logical cursor together
with its text through the wrap-aware renderer, shared with C09. Implementation pending.

## C08. Anonymous startup failure also notifies the host

**Comment:** [Copilot C08](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515913).

**Evidence and impact.**
[The ordinary startup catch](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/DocumentDBShellPty.ts#L673)
skips the credential-backed explanation for anonymous sessions but still sends the host notification.
A probe confirmed terminal output plus `showErrorMessage`. **Low; trivial policy fix.**

**Options.**

- **Recommended:** guard only the host notification with `!this._unauthenticated`.
  **Pros:** matches the diagnostic terminal-only policy; no normal Shell behavior change.
  **Cons:** a background diagnostic terminal will not additionally notify the host.
- Won't fix and explicitly change the policy. **Pros:** retains normal Shell's background visibility.
  **Cons:** conflicts with [current feature intent](../README.md#intent) and
  [the error-translation skill](../../../../../.github/skills/error-translation/SKILL.md).

**Advisor disagreement:** the advisor considered the existing notification a reasonable won't-fix
and said no decision required quiet feedback. The leader did not adopt that conclusion:
current feature intent expressly says later failures stay in the terminal. Do not silently
reinterpret the approved boundary just because normal Shells deliberately notify.

**Author decision (2026-11-27):** selected the anonymous-only host-notification guard, retaining
normal Shell notifications and terminal feedback. Implementation pending.

## C09. Late Shell sign-in output corrupts the visible prompt

**Comment:** [Copilot C09](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721515975).

**Evidence and impact.**
[Late sign-in feedback](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/DocumentDBShellPty.ts#L1007)
calls `handleWorkerFailure()` at the live cursor without separating output or redrawing input.
The success text has the same pattern. The PTY probe typed a partial command, moved Home,
then accepted a stale notification: output was only the error plus CRLF, with no prompt/input redraw.
[writeLine](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/DocumentDBShellPty.ts#L1200)
does not manage input state.

The logical buffer is retained, but the displayed command can be overwritten or split across
incorrect rows. Later edits/Enter may operate on text the user cannot accurately see.
No automatic replay or database loss was observed. **Medium** because visual/logical command
divergence has a plausible destructive-command consequence, not just a missing empty prompt.

**Options.**

- **Recommended:** one bounded asynchronous-output helper using C07's restore primitive.
  When idle, move past the rendered input, separate the message, and redraw the current prompt,
  current line and cursor. Preserve accumulated multiline state; do not call `showPrompt()`
  and erase it. When evaluating, defer the message to the next safe prompt boundary instead
  of injecting a second prompt. Apply to failure and success callbacks.
  **Pros:** correct visible command; shared fix for realistic asynchronous arrivals.
  **Cons:** a small queued-feedback path plus idle/evaluating/multiline tests.
- Queue every message until the user submits. **Pros:** simpler live-rendering handling.
  **Cons:** hides explicit recovery feedback indefinitely while an idle user waits.
- Won't fix. **Pros:** no input changes.
  **Cons:** invisible buffered command text is an avoidable safety/UX defect; not recommended.

**Advisor disagreement:** Opus rated this upper-Low because empty prompts are common and the
buffer remains intact. The leader retains Medium for the populated-prompt consequence.
The advisor's suggested `showPrompt()`-then-restore must be qualified: that method resets
multiline state. The helper must preserve it, not reconstruct only the current line.

**Acceptance:** empty prompt, populated mid-line and wrapped cursor, continuation/multiline state,
evaluation in progress, delayed success, delayed failure, and closed/disconnected terminals.
Assert both visible redraw and the exact next submitted command, with no automatic evaluation.

**Author decision (2026-11-27):** selected the bounded asynchronous-output helper using C07's
restore primitive, preserving multiline state and deferring output during evaluation to a safe
prompt boundary. Apply to delayed success and failure feedback. Implementation pending.

## C10. Anonymous command result is discarded on host-client churn

**Comment:** [Copilot C10](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721516027).

**Evidence and impact.**
[Anonymous evaluation](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/shell/ShellSessionManager.ts#L399)
maps any intervening epoch change to `credentialsChanged`, after awaiting the worker response.
[Host client deletion](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/ClustersClient.ts#L1252)
advances that epoch even when the diagnostic endpoint has not changed.
Initialization also checks this conservative fence.

The important distinction: a submitted command **may already have completed on the server**
before its reply is rejected. The extension does not replay it, but "open a new Shell" is not
an accurate account of benign client churn and can encourage a manual rerun.
**Medium for post-command outcome messaging; Low for the rare concurrency inconvenience.**
No mutation was executed during this review.

**Options.**

- **Recommended:** keep epoch/latch guards, but distinguish an epoch-only stale *evaluation reply*
  from a proven settings change when presenting it. Proposed bounded copy:
  **"This command may have completed, but its result is no longer current. Check the database
  before running it again."**
  Do not use this completion warning for startup, which has not evaluated a command.
  **Pros:** honest outcome and less rerun risk; no safety relaxation.
  **Cons:** a small host-local outcome distinction and dependent PTY tests/localization.
- Won't fix epoch tolerance. **Pros:** preserves the existing conservative fence.
  **Cons:** benign host churn can still discard a useful reply; acceptable alongside the message fix.
- Accept replies whenever the current endpoint matches. **Pros:** fewer discarded results.
  **Cons:** cannot rule out Disconnect/update that occurred and cleared during the operation;
  equality now is not lifecycle history. Rejected without a justified stronger invariant.

Do not add a second epoch/state machine for this edge case, replay any operation, claim rollback,
or treat a warm worker's current model URI as proof that a previous reply is safe.

**Author decision (2026-11-27):** **won't fix / ignore**, overriding the message-change
recommendation. Operator instruction: **"c10, ignore/wont fix."** No C10 guard, classification,
or message changes are selected. The existing behavior and safety fences remain unchanged.
No additional rationale was supplied.

## C11. Index failures can show two tree modals

**Comment:** [Copilot C11](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721516084).

**Evidence and impact.**
[hideIndex](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/index.hideIndex/hideIndex.ts#L74)
and its drop/unhide peers show a modal, set `suppressDisplay`, and rethrow.
[Their registration](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/documentdb/ClustersExtension.ts#L1087)
uses the diagnostics wrapper, which then shows another modal.
A callback-owned-modal probe confirmed two presentations with the same original error.
**Medium; fix this routine failure regression.**

**Important correction:** `suppressDisplay` is **not** an "already presented" flag.
[rethrowBoundCommandUnavailable](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/commands/rethrowBoundCommandUnavailable.ts#L9)
sets it without showing anything. Honoring it blindly would make other tree failures silent.

**Options.**

- **Recommended:** explicitly mark feedback ownership for the particular error/invocation when
  an index catch actually presents it; the tree wrapper skips additional UI only for that marker.
  Use a narrow shared helper rather than mutating/wrapping errors or changing the SDK flag's meaning.
  **Pros:** preserves original errors, telemetry, early validation failures and webview behavior.
  **Cons:** small ownership bookkeeping at the three existing catches and the wrapper.
  Unknown/non-Error throws must still work; a different error thrown by cleanup must not be
  hidden merely because an earlier error was presented. No extra explanation notification.
- Consolidate tree index feedback into the wrapper while retaining callback feedback for webview
  invocations. **Pros:** one owner and no sidecar marker.
  **Cons:** requires reliable invocation-origin plumbing and preserving index-specific headings.
- Declare the entire index callback presentation-owned at registration. **Pros:** simple option.
  **Cons:** validation errors thrown before the callback's catch have no owner; unsafe unless those
  paths are also covered.
- Won't fix. **Pros:** errors remain visible. **Cons:** two modal interruptions for normal failures;
  not recommended.

The advisor correctly identified the `suppressDisplay` counterexample. Its error-marker idea is
useful, but restoring an additional explanation notification would still duplicate feedback;
the final proposal keeps one presentation. **Acceptance:** exactly one modal for each index action,
early validation still visible, suppression-only bound errors still visible, original error
identity/telemetry retained, and webview behavior unchanged.

**Author decision (2026-11-27):** selected explicit feedback ownership for the particular
error/invocation when an index catch presents it, with one presentation and no generic
`suppressDisplay` shortcut. Implementation pending.

## C12. Host-side stale Retry cancellation becomes an alert

**Comment:** [Copilot C12](https://github.com/microsoft/vscode-documentdb/pull/1146#discussion_r4721516133).

**Evidence and impact.**
[The bound-view guard](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/webviews/documentdb/boundViewOperations.ts#L55)
can throw `UserCancelledError('staleBoundViewOperation')` without a new unavailable event.
[The Retry catch](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/webviews/documentdb/useBoundViewRecovery.ts#L150)
shows a generic failure when its local revision has not changed.
[The telemetry runner](https://github.com/microsoft/vscode-documentdb/blob/dec9ac64cbdb18f295fb0f05a7ebe12955703c47/src/webviews/_integration/trpc.ts#L149)
recognizes cancellation, but does not provide a client-side cancellation discriminator.
The transport wraps errors; frontend `instanceof UserCancelledError` is not a reliable solution.

A client-shaped stale rejection probe confirmed the alert, with Retry retained and recovery reset.
This was a hook probe plus source tracing, **not an end-to-end transport reproduction**.
Normal successful Retry is unaffected; concurrent epoch changes are required.
The view stays blocked, its contents remain, and no database operation is replayed. **Low.**

**Options.**

- **Recommended won't fix / defer:** keep the bounded "Try Retry again" feedback.
  **Pros:** safe and actionable; no cross-router protocol work for a rare superseded attempt.
  **Cons:** an obsolete host attempt is announced as a failure rather than staying quiet.
  This is an explicit tradeoff for the author, not a claim that cancellation is already filtered.
- Add a distinct typed cancellation result to bound-view recovery and consume it in the shared hook.
  **Pros:** precise quiet handling without raw error inspection.
  **Cons:** host result contract, three bound-view integrations and transport tests must stay aligned.
- Match cancellation strings or treat every INTERNAL_SERVER_ERROR as cancellation.
  **Pros:** little code. **Cons:** hides genuine failures and depends on transport details; rejected.

If the author prioritizes exact quiet-obsolete-attempt semantics, select the typed option.
Do not return a recovered/success-shaped result for cancelled work or remove the episode's Retry.

**Author decision (2026-11-27):** selected the recommended won't-fix/defer outcome: retain the
bounded Retry-failure feedback and do not introduce a typed cancellation protocol this round.

## Verification and outcome

- GitHub REST and GraphQL retrieval confirmed the same HEAD and all 12 current unresolved threads;
  there was no additional human review request or substantive timeline feedback to assess.
  The active-PR tool returned an unrelated cached merged PR, so this review used explicit #1146
  retrieval rather than that cached result.
- Source/control-flow verification covered all 12 comments. A narrow advisor sweep also checked
  feedback-ownership counterexamples and unavailable provider endpoints; this was not a broad audit.
- **Run 1:** nine focused existing test files, **428 tests passed**, including **8 temporary probes**.
  Run by MAI Code 2 Flash.
- **Run 2:** three of those files after four further probes, **72 tests passed**.
  Counts overlap; they are not 500 unique tests. Across the runs there were **12 distinct probes**.
- No TDD-prefixed contract failed. The probes intentionally asserted observed defective behavior
  to establish evidence; their passing does **not** mean the proposed fixes exist.
- Temporary probe edits were removed. The deliverable is this report only; proposed permanent
  regression coverage is listed with the relevant findings.

Commands used:

```bash
npx vitest run \
  src/documentdb/playground/WorkerSessionManager.test.ts \
  src/documentdb/shell/ShellSessionManager.test.ts \
  src/documentdb/shell/DocumentDBShellPty.test.ts \
  src/commands/signInAgain/signInAgain.test.ts \
  src/commands/playground/executePlaygroundCode.test.ts \
  src/commands/openInteractiveShell/openInteractiveShell.test.ts \
  src/utils/commandErrorHandling.test.ts \
  src/webviews/documentdb/useBoundViewRecovery.test.tsx \
  src/webviews/documentdb/documentView/documentsViewRouter.test.ts \
  --maxWorkers=2

npx vitest run \
  src/utils/commandErrorHandling.test.ts \
  src/webviews/documentdb/useBoundViewRecovery.test.tsx \
  src/commands/playground/executePlaygroundCode.test.ts \
  --maxWorkers=2
```

Not verified here: actual server mutations, real VM custom-port connectivity, installed-workbench
terminal rendering, live account dialogs, screen-reader behavior, or complete RPC transport
cancellation. No shared accounts, services or database contents were altered.
Build, lint, packaging and the full Case 2 suite were not rerun for this documentation-only review.

This is comment validation with an advisor, not a completed replacement for every
[CONTRIBUTING section 6 stage](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow).
Author decisions are recorded inline above. At lead-run intake the nine selected fixes were
unimplemented; all nine are in scope after the operator's correction. Subsequent commits and
verification belong in the corresponding item's progress note. No GitHub thread was resolved
by recording these selections.
