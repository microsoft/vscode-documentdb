# PR #876 review — "Keep DocumentDB Local state in sync and explain infrastructure-caused failures"

- Base: `release/0.10.0`, head: `dev/tnaum/quickstart-improvements`
- Scope reviewed: 44 files, +2186/-1017 (diff against the PR base, not `main`)
- Reviewer: agent-assisted code review, 2026-08-09

## Resolution status

All High and Medium findings were fixed on this branch, one commit each, plus the low items that
were genuine defects.

| Finding | Status | Commit subject |
| --- | --- | --- |
| H1 | Fixed | `fix(quickstart): keep Quick Start reachable when Docker is unavailable` |
| H2 | Fixed | `fix(diagnostics): never translate a cancellation into an infrastructure failure` |
| M1 | Fixed | `fix(quickstart): tell a stopped Docker daemon apart from a removed container` |
| M2 | Fixed | `refactor(quickstart): give diagnostics a genuinely read-only preflight` |
| M3 | Fixed | `fix(atlas): keep the TLS diagnosis to one paragraph` |
| M4 | Fixed | `fix(tree): stop dropping the raw error on the non-modal diagnosis path` |
| M5 | Fixed | `fix(shell): redact cached credentials before logging a connect failure` |
| M6, M7 | Fixed | `fix(quickstart): answer a failed preflight with tree rows, not a modal` |
| M8 | Fixed | `perf(diagnostics): budget the whole explain call, not each provider` |
| L2 | Fixed | folded into the M6/M7 commit (the prompt singleton is gone) |
| L3, L8 | Fixed | `fix(quickstart): show display labels in the managed-instance tooltip` |
| L4 | Fixed | `fix(commands): keep argument unwrapping inside the guarded block` |
| L5 | Fixed | `docs(diagnostics): note that the error is a bare string on the webview path` |
| L7 | Fixed | `fix(quickstart): show progress during an explicit deep refresh` |
| L1 | Open, by choice | Collapsing the root is what makes hydration lazy. Left as a UX decision to confirm, not a defect. |
| L6 | Open, by choice | Deliberate: the provider's premise is that the error shape does not matter. One `docker inspect` per foreground failure is the accepted cost. |
| L9 | Verified | The removed `running` / `stopped` strings have no remaining callers. |

The test gaps listed at the end are covered by the commits above, except the ones tied to L1 and L6.

## Summary

Two independent changes ride in one PR:

1. **Quick Start state accuracy** — activation-time `reconcile()` becomes demand-driven
   `ensureHydrated()`, the root row is now collapsed, expanding the managed cluster preflights the
   container, and the tooltip carries Docker host facts.
2. **`ConnectionDiagnosticsService`** — a translation-only provider registry wired into the tree
   base class, `ClusterItemBase`, the shell, the playground, tree-node commands and (via
   `common.explainOperationFailure`) every webview.

The second half is well designed: the "providers translate, never act" rule is stated in the code,
in the skill, and enforced by tests; the "never touch the error" analysis is correct and the
identity-check inventory is accurate. The registry, the deadline, the throwing-provider skip and
the untouched-error guarantee are all covered by tests.

The first half is where the risk sits. Making hydration lazy also made it **fatal**, and the
preflight cannot tell "container removed" from "Docker is not running".

Findings below are ordered by severity. Line references are to the head of the branch.

---

## High

### H1 — Quick Start becomes unreachable when Docker is absent or stopped

`performReconciliation()` dropped both safety nets that the old `reconcile()` had:

- the outer `try { … } catch { /* best-effort; never block activation */ }`
- the per-call `listByLabel(…).catch(() => [])`

`ContainerRuntime.listByLabel` has no internal error handling (unlike `inspectContainer`), so with
no `docker` binary, or a stopped daemon, it rejects. That rejection now propagates through
`reconcile()` → `ensureHydrated()` into two unguarded call sites:

- [src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts](src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts) — `getChildren()` awaits `ensureHydrated()` with no `try`. `ConnectionsBranchDataProvider.getChildren` runs inside `callWithTelemetryAndErrorHandling`, so the user gets an error toast and an **empty** Quick Start node.
- [src/commands/localQuickStart/openLocalQuickStart.ts](src/commands/localQuickStart/openLocalQuickStart.ts) — the command awaits `ensureHydrated()` **before** `openLocalQuickStartWebview()`, so the webview never opens.

Net effect: the users who most need Quick Start (no Docker yet) lose both entry points into it.
The existing test `ensureHydrated() remains retryable when Docker discovery fails` pins the
rejection as intended service behaviour, so this has to be fixed at the call sites.

**Suggested fix.** Keep `ensureHydrated()` rejecting (retry semantics are good), but make both
consumers tolerant:

```ts
// LocalQuickStartItem.getChildren
try {
    await QuickStartService.ensureHydrated();
} catch {
    // Docker may not be installed yet; render the NotInstalled row so Quick Start stays reachable.
}
```

```ts
// openLocalQuickStart — the webview is the place that diagnoses Docker, so never gate it on Docker
await QuickStartService.ensureHydrated().catch(() => undefined);
```

Add regression tests for both (neither path is covered today).

### H2 — `UserCancelledError` gets translated into a modal "DocumentDB Local is not running"

[src/utils/commandErrorHandling.ts](src/utils/commandErrorHandling.ts) calls `explain()` for every
error that is not a `UserFacingError`. `UserCancelledError` is not filtered.

Two providers do not look at the error at all before answering:

- `QuickStartDiagnosticsProvider.explain()` deliberately ignores the error shape ("The error shape
  does not matter here").
- `KubernetesDiagnosticsProvider.explain()` ignores it whenever the tunnel is down.

So: user opens *Create Database* on a Quick Start cluster whose container is stopped, presses Esc →
`UserCancelledError` → **modal** dialog "DocumentDB Local does not appear to be running." The same
applies to `fetchChildrenWithDiagnostics` in
[src/tree/BaseExtendedTreeDataProvider.ts](src/tree/BaseExtendedTreeDataProvider.ts).

**Suggested fix.** One central guard, since the PR's own thesis is "there is exactly one rule to
remember":

```ts
// connectionDiagnosticsService.ts
public async explain(request: ConnectionDiagnosticsRequest): Promise<ConnectionDiagnosis | undefined> {
    // A cancelled operation is not a failure; nothing to explain.
    if (request.error instanceof UserCancelledError) {
        return undefined;
    }
    …
```

This also protects future call sites and belongs in the skill's "Adding a call site" section.

---

## Medium

### M1 — "The container was very likely removed" is asserted when Docker itself is down

`ContainerRuntime.inspectContainer` swallows **every** failure and returns `undefined`. So when the
daemon is stopped, `QuickStartServiceImpl.prepareForConnection` sees `!inspected`, sets
`entry.missing = true`, and returns `'missing'`. The provider then says:

> We cannot find the DocumentDB Local container. It was very likely removed outside VS Code. You
> can recreate it from the Connections view, which reuses the existing data volume.

That is exactly the assertion the PR's own message-style section forbids, and the suggested
recovery (recreate) is the wrong action. Stopping Docker Desktop is at least as common as removing
a container by hand.

**Suggested fix.** Distinguish the two before concluding `missing`, e.g. let `inspectContainer`
report "not found" separately from "could not ask" (or consult
`QuickStartService.getDockerReadinessSnapshot()` / a cheap `isDockerReady()` on the `!inspected`
branch) and map daemon-unreachable to the existing `'unavailable'` wording.

### M2 — Providers mutate state and fire the status emitter, contradicting the stated contract

`QuickStartDiagnosticsProvider.explain()` → `prepareForConnection()` → `setStatus()` /
`entry.missing = true` / `statusEmitter.fire()` → `ext.connectionsBranchDataProvider.refresh()`.

The service header and the skill both say providers "never repair state" and "never show UI". A
tree redraw triggered from a translation call is an observable UI side effect, and on a background
failure it would repaint the tree for a user who is not watching. The `silent: true` option is a
signal that `prepareForConnection` is not really a read-only probe.

**Suggested fix.** Either split a genuinely read-only `inspectManagedInstance()` out of
`prepareForConnection` and have the provider use that, or amend the documented rule to "no UI, no
recovery, state correction allowed" and say so explicitly in the skill. The current wording and the
implementation disagree.

### M3 — Atlas explanation is promoted from `detail` to the modal's main message

`describeAtlasTlsHandshakeRejection()` returns four lines including a bullet list. In
`AtlasClusterItem` it is still passed as `detail` (correct). Through the new generic path it becomes
the **message**:

```ts
void vscode.window.showErrorMessage(diagnosis?.message ?? …, { modal: true, detail: errorMessage });
```

VS Code renders `message` as the large bold heading of a modal, so the user gets a multi-paragraph
bold block and a one-line detail. In the webview non-modal path, `displayErrorMessage` concatenates
`message + " (" + cause + ")"`, producing a very long toast.

**Suggested fix.** Make `ConnectionDiagnosis` carry `{ summary, detail? }` and let call sites place
each half correctly, or constrain provider messages to a single sentence and keep the elaboration in
`AtlasClusterItem`.

### M4 — `detail` is silently dropped in the tree base class

```ts
void vscode.window.showErrorMessage(diagnosis.message, {
    modal: false,
    detail: error instanceof Error ? error.message : String(error),
});
```

`MessageOptions.detail` is only rendered for modal messages — the repo already documents this in
[src/webviews/_integration/appRouter.ts](src/webviews/_integration/appRouter.ts) ("The content of
the 'detail' field is only shown when modal is true"). Combined with
`context.errorHandling.suppressDisplay = true`, the raw driver error now disappears from this
surface entirely, which is the opposite of the PR's "keep the raw text as detail" rule.

**Suggested fix.** Mirror `displayErrorMessage`: append the cause to the message for non-modal, or
log it to `ext.outputChannel`.

### M5 — Raw driver text logged to a shared output channel without masking

```ts
ext.outputChannel.error(
    `[Shell] Failed to connect to "${…}": ${rawMessage}` + (diagnosis ? ` (${diagnosis.providerId}: ${diagnosis.message})` : ''),
);
```

The PR description explicitly positions this channel as something users share for remote diagnosis.
Driver errors can embed the connection string (`MongoParseError: Invalid connection string:
mongodb://user:pass@…`), and Quick Start credentials are auto-generated and live in that string. The
repo already has masking helpers (`maskSecrets` in `ContainerRuntime.ts`,
[src/services/localQuickStart/outputMasking.ts](src/services/localQuickStart/outputMasking.ts)).

**Suggested fix.** Mask before logging, and add a test that a URI-with-credentials never reaches the
channel.

### M6 — Modal dialog fired from a tree-expand gesture, and awaited inside `getChildren()`

`offerToStartStoppedInstance()` shows `showInformationMessage(…, { modal: true }, 'Start')` and
`QuickStartClusterItem.getChildren()` awaits it. The node spins until the user answers a **modal**,
then renders empty; the Start command is fired with `void`, so nothing is shown until the status
event lands and the user expands again.

Elsewhere the codebase uses actionable error-recovery child nodes for exactly this
(`createGenericElementWithContext` with a `commandId`), which is both non-blocking and discoverable.

**Suggested fix.** Return a child node ("Click here to start DocumentDB Local") instead of a modal,
or at minimum make the notification non-modal and do not await it.

### M7 — `unavailable` / `missing` / `foreign` render as a silently empty node

`QuickStartClusterItem.getChildren()` returns `[]` for every non-`ready` verdict. Only `stopped`
produces feedback. For `missing` and `unavailable` the user expands and gets nothing — no toast, no
row, no log line.

**Suggested fix.** Return the corresponding explanation as an error-recovery child (the provider
already has the exact wording; reuse it rather than duplicating).

### M8 — The 5-second deadline is per provider, not per call

`explain()` loops providers sequentially, each wrapped in its own `EXPLAIN_DEADLINE_MS` race. Three
registered providers means up to 15 s before the user sees any error message — on the connect path
that is on top of the driver's own server-selection timeout.

**Suggested fix.** One deadline for the whole loop, or drop the per-provider budget to ~1.5 s.

---

## Low / polish

| # | Finding | Where |
| --- | --- | --- |
| L1 | Root row changed from `Expanded` to `Collapsed`. Deliberate (it is what makes hydration lazy), but on a fresh install the primary onboarding affordance now sits behind a chevron. Worth a UX sign-off, and worth calling out in the release notes. | [LocalQuickStartItem.ts](src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts) |
| L2 | `stoppedInstancePrompt` is a module-level singleton with no alias key, and the Start command takes no alias. Harmless today (single instance), but the file elsewhere is careful about the multi-instance seam. Key it by alias. | same |
| L3 | Tooltip shows raw identifiers to users: `status.state` (`NotInstalled`, `CredentialsMissing`), `readiness.endpointKind` (`unixSocket`), `readiness.osType` (`linux`). The file already has `dockerProviderLabel` / `executionTargetLabel` for exactly this. | same |
| L4 | `unwrapArgs()` moved outside the `try`, so a throw from unwrapping now bypasses the `UserFacingError` handling. Keep it inside with a `let`. | [commandErrorHandling.ts](src/utils/commandErrorHandling.ts) |
| L5 | `explainOperationFailure` passes a bare `string` as `error`. Documented, but the parameter is typed `unknown`, so nothing stops a future provider from doing `instanceof` and silently never matching from webviews. Consider a distinct `message` field on the request. | [appRouter.ts](src/webviews/_integration/appRouter.ts) |
| L6 | Because `QuickStartDiagnosticsProvider` ignores the error, **every** webview failure on the Quick Start cluster (including a bad query) triggers a `docker inspect`. Cheap, but it contradicts "answer the cheap question first". | [QuickStartDiagnosticsProvider.ts](src/services/localQuickStart/QuickStartDiagnosticsProvider.ts) |
| L7 | `refreshHydratedState()` runs a full Docker reconciliation from a context-menu click with no progress indication and rethrows into the generic handler. Consider `withProgress` on the tree item. | [LocalQuickStartItem.ts](src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts) |
| L8 | `escapeMarkdown` escapes `-` and `.`, so tests assert on `documentdb\-local` and `28\.1\.1`. Narrowing the character class would keep the tests readable. | same |
| L9 | Removing the "changed in another window" notification for `start()`/`stop()` drift is a good call, but the two removed l10n strings (`running`, `stopped`) suggest checking no other surface still relies on them. | [QuickStartService.ts](src/services/localQuickStart/QuickStartService.ts) |

---

## Test gaps

Existing coverage is strong for the new service and providers. Missing:

1. `LocalQuickStartItem.getChildren()` when `ensureHydrated()` rejects (H1).
2. `openLocalQuickStart()` when `ensureHydrated()` rejects (H1).
3. `registerCommandWithTreeNodeUnwrappingAndModalErrors` with a `UserCancelledError` on a cluster
   node — asserting no dialog (H2).
4. `prepareForConnection()` when the Docker daemon is unreachable — asserting it does not report
   `missing` (M1).
5. Shell connect-failure logging with a credential-bearing driver message (M5).

## What is good

- The "never touch the error" rationale is correct and the identity-check inventory
  (`errorCodeExtractor` fixed depth, `extractErrorCode` prefix parsing, tRPC error rebuild) is
  accurate; the guard tests pin it.
- One catch in `BaseExtendedTreeDataProvider` covering all four views is the right seam, and the
  regression test that background count paths never invoke it is exactly the test that matters.
- The shell no longer disposing the terminal on a failed connect, and reusing
  `ShellSessionManager.evaluate()`'s re-initialize as the retry, is an elegant fix to a real bug.
- The `clusterId`-only identity choice, and the three documented ways a provider recognises its own
  clusters, keep the design free of a central origin registry.
- `ensureHydrated()` sharing in-flight work with `refreshHydratedState()` and staying retryable
  after a failure is the right shape — the problem is only that callers treat rejection as fatal.

## Recommendation

Request changes on **H1** and **H2** (both are user-visible regressions with small fixes), and on
**M1** (a message that asserts a wrong cause and recommends the wrong recovery, which the PR's own
style rules forbid). The rest can land as follow-ups.

Consider splitting the Quick Start lifecycle change from the error-translation framework: they have
different blast radii, and the framework half is ready.
