# PR6a pre-review: Shell and Playground token relays

[PR #1133](https://github.com/microsoft/vscode-documentdb/pull/1133) · WI-2 · reviewed head `8c2ca3fdc`

Claude Opus 5.5 performed the first pass. OpenAI GPT-5.6-Luna validated both findings and
independently found two more. There were no GitHub Copilot review threads on the draft at this
head. Findings are based on code inspection; the initial Case 1 build and 310 focused tests
passed, but those tests did not exercise the failing cases below.

## F1. Successful Sign in again does not restart the worker (high)

[`signInAgain`](../../../../../src/commands/signInAgain/signInAgain.ts#L172) replaces the host
client and advances its epoch. Both [Shell](../../../../../src/documentdb/shell/DocumentDBShellPty.ts#L950)
and [Playground](../../../../../src/commands/playground/executePlaygroundCode.ts#L401) reject this
successful result because it does not match the epoch captured before sign-in. The worker then
remains blocked and offers the same action again.

**Recommendation:** Before opening sign-in, confirm the notification still belongs to the
same shell revision or document binding. After sign-in, check that the exact epoch returned
by that sign-in is still current and that the same surface owns the action. Do not accept
arbitrary newer epochs or remove the fence. Test a successful epoch change and a superseding
invalidation without replaying the old operation.

**Author decision:** Approved as recommended. Use the confirmed post-sign-in epoch without
loosening the ownership checks or replaying the operation.

**Fixed:** [`8faa1ba8f`](https://github.com/microsoft/vscode-documentdb/commit/8faa1ba8f).
Shell and Playground use the confirmed epoch and reject stale or superseded recovery
actions. The two surface suites passed 99 tests, including no replay.

## F2. Re-picking a Playground connection leaves Run blocked (medium)

The [connection picker](../../../../../src/commands/playground/connectDatabase.ts#L120) updates
the document binding, but the [evaluator](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts#L194)
keeps the previous worker's authentication failure for the whole cluster. The next Run can
reject before it checks the new binding.

**Recommendation:** Let an explicit re-pick advance past that failed worker on the next
deliberate Run, after the existing identity and execution checks. Do not stop an evaluator
from the picker: another document may be using it. Separate failure tracking for every
document would be more complex without removing the need to replace the failed worker.
Test successful re-pick and Run, preservation of the old binding's identity, and a second
document's in-flight run.

**Author decision:** Approved as recommended. Apply the explicit re-pick on the next Run
without interrupting another document.

**Fixed:** [`f5b79a3e9`](https://github.com/microsoft/vscode-documentdb/commit/f5b79a3e9).
The re-pick is scoped to that document and used on its next Run. The picker never stops
an active worker, and other documents cannot inherit the new binding. The two focused
Playground suites passed 51 tests.

## F3. A no-op saved edit can discard healthy Shell state (medium)

The [Shell manager](../../../../../src/documentdb/shell/ShellSessionManager.ts#L227) kills a
healthy worker when the host epoch changes. [Saving unchanged settings](../../../../../src/commands/saveConnectionEdit.ts#L54)
can advance the host epoch even though the Shell remains connected and the identity has not
changed. The next command then loses the Shell's variables and cursors.

**Recommendation:** Keep the healthy Shell worker across a host-only epoch change. Keep the
epoch fence for startup and token replies, and keep the latch and fingerprint checks before
respawn. Do not add a separate epoch counter. Test that a no-op edit does not respawn the
healthy worker, while explicit Disconnect still stops it.

**Author decision:** Approved as recommended. Preserve healthy Shell state on an unchanged save.

**Fixed:** [`72fb52da6`](https://github.com/microsoft/vscode-documentdb/commit/72fb52da6).
A host-only invalidation no longer restarts a healthy Shell. The startup, latch and
explicit Disconnect checks remain in effect.

## F4. A stale token request can hang a worker that is still attached (medium)

The [host relay](../../../../../src/documentdb/auth/WorkerTokenRelay.ts#L71) drops the token reply
when the host epoch changes, even if the worker is still attached. The worker is awaiting
that reply and a warm evaluation has no IPC timeout. The existing late-reply test only
covers a worker that has been terminated.

**Recommendation:** Keep ignoring detached workers. Settle an obsolete request on a worker
that is still attached with a bounded lifecycle cancellation. Do not send the stale token,
update diagnostics, or replay the evaluation. Adding a timeout alone would leave the
request running until the timeout and would not express why it was interrupted. Test
invalidation with an attached worker and no stale token or diagnostics.

**Author decision:** Approved as recommended. Cancel the obsolete request without returning a
stale token or recording a stale failure.

**Fixed:** [`25e686f93`](https://github.com/microsoft/vscode-documentdb/commit/25e686f93).
The supervisor cancels an obsolete operation and discards its attached worker. Detached
replies remain ignored. The combined F3 and F4 focused suites passed 114 tests.

## Scope clarification

[Decision 0018](../decisions.md#0018-saved-connection-edits-permanently-lock-existing-views)
retires registered webviews after a saved settings change. It does not make Shell terminals
or Playground documents Close-only. WI-2 and
[D12](../../sovereign-clouds/decisions.md#d12-open-sessions-keep-what-they-started-with)
allow a needed same-identity respawn after a password-only edit, but do not require a healthy
Shell worker to restart.

## Verification after the fixes

Case 1 passed on `f5b79a3e9`: `npm run build` and 534 focused tests across 18 suites.
Case 2 is deferred until formal handoff. The packaged live checks remain at OP-6.
