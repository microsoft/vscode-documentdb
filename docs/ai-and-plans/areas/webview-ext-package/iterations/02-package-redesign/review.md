---
area: webview-ext-package
kind: review
status: historical
prs: [766]
created: 2026-07-02
---
# PR 766 Review: webview API redesign

Date: 2026-07-02
Branch: `dev/tnaum/webview-api-refinements`
PR: https://github.com/microsoft/vscode-documentdb/pull/766

## Scope

Reviewed the redesigned `@microsoft/vscode-ext-webview` package, its migration docs, and the local DocumentDB integration with two goals:

- Find code/API correctness issues, classified by severity.
- Second-guess the exposed API for simplification and onboarding, especially for new projects and coding agents.
- Merge in Copilot reviewer comments from GitHub, preserving review-thread references for follow-up.

The original review and second pass (below) made no code changes. **Iteration 1
(2026-07-03) then implemented most findings** as individual commits on the PR
branch — see the [change protocol](#iteration-1--change-protocol-2026-07-03).
Deferred items and answers to open questions are in
[Iteration 2](#iteration-2--open-items--answers). **Iteration 3 (2026-07-05)**
implemented the one item Iteration 2 held back (R766-N05, event-observer
isolation). **Iteration 4 (2026-07-05)** triages the GitHub Copilot reviewer's
second automated pass and analyzes each comment. **Iteration 5 (2026-07-05)**
steps back from correctness and looks at package consumer ergonomics and
onboarding friction. **Iteration 6 (2026-07-05)** fixes a runtime regression
(R766-07): the webview failed to load in the standard bundled-development flow
because the source layout was keyed off the extension mode instead of the bundle
flag. **Iteration 7 (2026-07-05)** tidies the reference `_integration` folder:
groups the observability sinks into a subfolder and brings the folder README
back in sync. **Iteration 8 (2026-07-06)** is an analysis pass (no code): it
traces the webview open/load and message-processing paths for latency and
load-time degradation and finds the load path neutral-to-better, with one
recurring per-RPC host-side cost (the dispatch logger) flagged as a follow-up.
**Iteration 9 (2026-07-06)** implements R766-P05 part 1: gates the per-op host
`console.log` behind `extensionMode !== Production` so shipped builds never pay
for it. **Iteration 10 (2026-07-06)** implements R766-P05 part 2: the
`callWithAccumulatingTelemetry` accumulate/flush redesign (Option 1) — the
per-call path is now cheap in-memory work and the telemetry pipeline is entered
only on flush, with all callers migrated to the new sample-bag callback.
**Iteration 11 (2026-07-06)** renames that helper to `accumulateTelemetry`
(+ `flushAccumulatedTelemetry`, file → `accumulatingTelemetry.ts`) so the name no
longer implies the full-context scoped call of the `callWith…` convention, and
files the "wrap an action" variant (`runWithAccumulatingTelemetry`) as a tracked
enhancement issue rather than building it now.

## Summary

The main architectural decision looks right: splitting the old bundled package into `.` shared, `./host`, `./webview`, and `./react` gives the package a usable primitive layer without taking away the greenfield `openWebview` path. The public verb system (`init`, `open`, `attach`, `connect`, `use`) is coherent and should be easier for humans and agents to discover than the previous package.

The main concern is that two implementation details still assume the package is mostly self-owned: `attachTrpc` does not tolerate unrelated messages on an existing panel, and `WebviewController.dispose()` does not close the panel even though `dispose` is advertised on the public handle. Those are fixable without revisiting the broader design.

Copilot reviewer left three unresolved GitHub review threads. I agree with the two `AsyncIterator.return()` comments as a low-severity cleanup, and partially agree with the `openDocumentWebview` comment as a low-severity API-shape issue rather than a proven strict-mode failure.

## Iteration 1 — change protocol (2026-07-03)

> This section is the **protocol of changes** for iteration 1: what shipped, why,
> and the commit that carries it. Each fix is an individual commit on the PR
> branch, pushed to `dev/tnaum/webview-api-refinements`, and acknowledged on the
> PR — a general comment, or a reply on the originating Copilot review thread
> (which was also resolved). Items deferred to a second pass are marked
> **⏭ Moved to Iteration 2** in their sections below and consolidated in
> [Iteration 2 — open items & answers](#iteration-2--open-items--answers).

**Post-change validation (all green):** `npm run l10n` (no drift) · `prettier` (no
drift) · `eslint --quiet` (clean) · `jest` (2648 passed / 157 suites) · `tsc`
build across all workspaces (clean).

| ID       | Commit     | What changed                                                                                                                                     | Why (motivation)                                                                                                                                                                           |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R766-06  | `0292780`  | `attachTrpc` calls `iterator.return?.()` with **no argument** at both sites                                                                      | The parameter is a _return value_, not an `IteratorResult`; `{ value, done }` was misleading and could leak as a custom iterator's final value. Copilot threads answered + resolved.       |
| R766-N04 | `0bd16afa` | `AttachTrpcResult` exposes `activeOperations` / `activeSubscriptions` as `ReadonlyMap`                                                           | Returning the live mutable `Map`s let a consumer corrupt the dispatcher's in-flight/cancellation bookkeeping; observation preserved, mutation removed.                                     |
| R766-05  | `c5662718` | `openDocumentWebview` returns a local `const controller`                                                                                         | The return no longer flows through the optional `handle.controller?` slot, so it can't read as nullable. Copilot thread answered + resolved.                                               |
| R766-02  | `76172cd2` | `WebviewController.dispose()` now closes the panel (`_panelDisposed` guard) + 2 tests                                                            | A public handle whose `dispose()` leaves the tab open is surprising; the old "recursion" rationale was already neutralised by the `_isDisposed` guard.                                     |
| R766-N07 | `9a758cc5` | `useConfiguration` parses `__initialData` in `try/catch`, falls back to `{}` + logs                                                              | A malformed payload threw during render and white-screened the webview; degrade gracefully instead.                                                                                        |
| R766-N08 | `76f99484` | Renamed the host dispatch-logger option `telemetry` → `logger`; added README **Observability** chapter                                           | `telemetry` (a `ProcedureLogger`) collided with the analytics path and misled readers. No deprecated alias kept (preview).                                                                 |
| R766-S02 | `6363a6f2` | Webview `loggerLink` is now **opt-in** (`connectTrpc({ logger })` / `<WithWebviewContext enableRpcLogging>`)                                     | Always-on logging is noise for production consumers; defaults should be quiet. README documents the rich console experience and how to open the webview devtools console.                  |
| R766-S03 | `32859afc` | Shipped generic `WithTelemetry<TContext, TTelemetry>` from `./host`; ADVANCED.md pattern; DocumentDB now specializes it; README telemetry recipe | Reading `ctx.telemetry` needed ad-hoc casts, and the DocumentDB comment referenced a package helper that didn't exist. Telemetry is now discoverable from the README (azext).              |
| R766-S04 | `de27b507` | Reworded README shared-client note; dropped the "single `message` listener" claim                                                                | The client is shared per webview (true), but the transport registers one listener _per in-flight op_; the claim described a wrong, changeable internal. (Design pros/cons in Iteration 2.) |
| R766-04  | `61a01033` | ADVANCED.md: subscriptions are **not** on the event channel                                                                                      | The doc contradicted `eventLink` (which excludes subscriptions) and the `useRpcEvents` doc.                                                                                                |
| R766-03  | `46296ce4` | Ship `ADVANCED.md` + a package-local `LICENSE` in `files`                                                                                        | README linked ADVANCED.md ~10× but it wasn't in the tarball, and no license text shipped. Verified with `npm pack --dry-run`.                                                              |

**Deferred to Iteration 2 (no code this pass):** R766-01 (foreign-message guard),
R766-N01 (webview inbound guard — depends on R766-01), R766-N02 (caller-factory
ergonomics), R766-N03 (inline-script hardening, option B), R766-N05 (observer
exceptions → telemetry), R766-N06 (create-or-reveal). R766-S01 stands as agreed
(keep the three tiers; no change).

## Findings

### R766-01: High - `attachTrpc` cannot safely attach to panels with existing `postMessage` traffic

> ⏭ **Moved to Iteration 2** (skipped this pass, as requested). It affects only
> bring-your-own-panel embedders of `attachTrpc`; the panel-owning `openWebview` /
> `WebviewController` path used by DocumentDB never carries foreign traffic, so
> current consumers pay nothing today. The Iteration 2 chapter re-analyses options
> A/B/C and the side effects on existing projects.

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L331-L348)

`attachTrpc` registers a webview message listener and immediately reads `message.op.type`. Any panel that already uses `postMessage` for a non-tRPC message will send an object without `op`, which causes the handler to throw before the message can be ignored.

This cuts against the central reason `attachTrpc` exists: bring-your-own-panel adopters, including migrations from legacy `postMessage` channels, are exactly the consumers most likely to have unrelated traffic on the same VS Code webview bus. The design notes explicitly mention that the Cosmos-derived primitive guarded non-tRPC messages for this reason.

Suggested fix: add a small runtime guard before the `switch`, for example checking that the message is an object with an `op` object whose `type` is one of the supported transport operation types. Unknown messages should be ignored, optionally with debug logging only when a logger/debug option is supplied. Add a unit test that sends an unrelated message and then verifies a later tRPC query still works.

### R766-02: Medium - Public `WebviewController.dispose()` leaves the webview panel open

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L311-L338)

The README advertises the `openWebview` return value as a handle with `dispose`, but `dispose()` only marks the controller disposed, fires `onDisposed`, and disposes registered listeners. It deliberately does not call `this._panel.dispose()`, based on the internal assumption that only the panel owns the controller lifecycle.

As a public package API, that assumption is too narrow. A consumer holding the returned controller can reasonably call `controller.dispose()` expecting the tab to close. Instead, the visible webview remains open while its controller is marked disposed and its tRPC listener has been torn down. That is a confusing state for new projects and agents because the obvious cleanup method only half-disposes the object graph.

Suggested fix: split disposal into two paths. Public `dispose()` should close the panel when the panel is not already disposing, while the `onDidDispose` callback should call a private teardown method that only disposes controller resources. Keep the idempotency guard to avoid recursion. Add an `openWebview` test asserting that `controller.dispose()` calls the mock panel's `dispose()`.

### R766-03: Medium - `ADVANCED.md` is referenced but excluded from the npm package

References: [packages/vscode-ext-webview/package.json](../../../../../../packages/vscode-ext-webview/package.json#L38-L41), [packages/vscode-ext-webview/README.md](../../../../../../packages/vscode-ext-webview/README.md#L216-L238)

The package whitelist ships only `dist` and `README.md`, but the README repeatedly sends advanced users to `ADVANCED.md`. Consumers installing the package from npm will not get that file in the tarball.

This matters because the opened-up API intentionally relies on advanced docs for `attachTrpc`, `connectTrpc`, telemetry adapters, event channels, and the host/browser import boundary. Without the file in the package, the lower-level surface is harder to adopt and the README contains broken local links.

Suggested fix: include `ADVANCED.md` in the package `files` array. Consider also including license metadata if the eventual published tarball does not already include it through npm defaults.

### R766-04: Low - `ADVANCED.md` contradicts the implementation for subscription errors

References: [packages/vscode-ext-webview/ADVANCED.md](../../../../../../packages/vscode-ext-webview/ADVANCED.md#L195-L199), [packages/vscode-ext-webview/src/webview/errorLink.ts](../../../../../../packages/vscode-ext-webview/src/webview/errorLink.ts#L55-L88), [packages/vscode-ext-webview/src/react/useRpcEvents.ts](../../../../../../packages/vscode-ext-webview/src/react/useRpcEvents.ts#L16-L23)

The advanced manual says subscription errors are surfaced through the global event channel as well as each subscription's `.subscribe({ onError })` handler. The implementation intentionally excludes subscriptions from `eventLink`, and the hook docs say subscriptions are excluded to avoid surfacing them twice.

Suggested fix: update `ADVANCED.md` to match the implementation: query and mutation outcomes go through `RpcEventChannel`; subscription outcomes should be observed through the subscription callback.

### R766-05: Low - `openDocumentWebview` uses an optional handle for a value it returns as required

GitHub review thread: `PRRT_kwDOODtcO86OCV7g` (Copilot reviewer, unresolved, can resolve)

Reference: [src/webviews/documentdb/documentView/documentsViewController.ts](../../../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L41-L73)

Copilot flagged that `openDocumentWebview` declares a non-optional return type but stores the controller in `handle.controller?: AppWebviewController<...>` and then returns `handle.controller`.

I would classify this as low severity. The assignment happens immediately before the return, so this is unlikely to be a runtime bug, and TypeScript may narrow the property after direct assignment. Still, the optional property makes the code harder for humans and agents to reason about, and it creates an unnecessary question about whether `undefined` can escape.

Suggested fix: avoid returning through the optional property. Store the result in a local `const controller = openAppWebview(...)`, assign `handle.controller = controller` for the title setter closure, and return `controller`. That keeps the deferred setter pattern without making the function's return path look nullable.

### R766-06: Low - `AsyncIterator.return()` is called with an `IteratorResult`-shaped value

GitHub review threads: `PRRT_kwDOODtcO86OCV77` and `PRRT_kwDOODtcO86OCV8H` (Copilot reviewer, both unresolved, both can resolve)

References: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L250-L260), [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L366-L375)

Copilot flagged both calls to `iterator.return?.({ value: undefined, done: true })`. The comment is valid: `AsyncIterator.return(value?)` accepts the return value, not an `IteratorResult` object. Passing `{ value, done }` is misleading and can leak that object as the iterator's final return value for custom iterators.

I would classify this as low severity because the current code uses the call mainly to unblock a parked subscription and does not consume the return value. It is still worth fixing because this package is a reusable transport primitive and should model iterator semantics accurately.

Suggested fix: call `iterator.return?.()` with no argument in both locations. If a domain return value is ever needed, pass that domain value directly, not an `IteratorResult` shape. Keep the existing rejection swallowing and subscription cleanup behavior.

## API simplification notes

### R766-S01: Keep `openWebview`, `WebviewController`, and `attachTrpc` as separate tiers

I would not collapse the three host tiers. The factory is useful for greenfield consumers, the class is useful for stateful panels, and `attachTrpc` is the adoption primitive for existing panel frameworks. The important part is that `attachTrpc` must behave like a true guest on a panel it does not own, which is why R766-01 is the key fix.

### R766-S02: Consider making production logging opt-in or mode-aware

Reference: [packages/vscode-ext-webview/src/webview/connectTrpc.ts](../../../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L105-L107)

`connectTrpc` always inserts tRPC's `loggerLink()`. That is friendly while developing a starter project, but it may surprise production consumers by logging every RPC call from the webview side. Since `WebviewController` already has explicit telemetry/logging options on the host side, the client side would be more predictable if logging were controlled by a `logger` / `loggerLink` / `enableLogger` option, or omitted by default in production-oriented helpers.

This is not a correctness bug, but it is worth second-guessing before the preview API spreads. New projects and coding agents usually accept defaults; defaults should be quiet unless observability is explicitly requested.

### R766-S03: The telemetry middleware is flexible, but the common `WithTelemetry<T>` cast deserves a first-class docs pattern

The decision to ship middleware bodies instead of a package-owned telemetry procedure is sound. It keeps the package instance-agnostic and avoids baking in Azure telemetry policy.

The cost is that consumers need a local `WithTelemetry<T>` helper or a similar narrowing pattern when procedure code reads `ctx.telemetry`. DocumentDB already has that helper in [src/webviews/\_integration/trpc.ts](../../../../../../src/webviews/_integration/trpc.ts#L58-L64). Add that pattern to `ADVANCED.md` so agents have a copyable way to do the right thing instead of inventing ad hoc casts at every procedure.

### R766-S04: The README should avoid promising a single message listener

Reference: [packages/vscode-ext-webview/README.md](../../../../../../packages/vscode-ext-webview/README.md#L202-L208)

The README says every component receives the same client and "the same single `message` listener." The shared-client part is true, but the transport currently registers per-operation `message` listeners under `vscodeLink`. The claim is not important to the API contract and can be softened to avoid describing internals that may change.

## Bottom line

I would keep the redesigned package shape. It is meaningfully simpler than the old bundled API for greenfield users, while still exposing the lower layer needed by existing webview frameworks.

Before merging, I would address R766-01 and R766-02 as the blocking API-behavior issues, and R766-03 as a package publishing issue. R766-04 and the simplification notes can be handled as follow-ups if necessary, but they are cheap enough to fix before the preview goes out.

---

# Independent second review (Reviewer 2)

Added 2026-07-03. This is a fresh pass over the same PR with three goals: (1)
re-check every finding above against the actual code and re-assess its severity
independently (the first pass could contain false alarms), (2) add findings the
first pass missed (`R766-N*`), and (3) give every discovery an
options/pros-cons/recommendation block so a follow-up discussion can be focused
by ID.

I also read the locked design (`docs/ai-and-plans/areas/webview-ext-package/design.md`,
§13 "Decisions summary"). **Bottom line up front: the implementation faithfully
matches the locked design** — the four subpaths, the `open`/`attach`/`connect`
verb system, `initWebviewTrpc`, middleware bodies + adapters, and the
`useTrpcClient`/`useRpcEvents` split are all present and shaped as decided. Every
finding below is hardening or polish, **not** an architectural miss. The two
findings that actually cut against the stated north star ("simple for the 90%,
pluggable for embedders") are R766-N02 (the simple path is taxed by an extra,
mismatch-prone `createCallerFactory` wire) and R766-01 (the embedder path is
under-hardened against foreign panel traffic). Those two are where I would spend
the effort.

## Verification of the existing findings

| ID       | 1st-pass severity | Verified in code? | My severity | Verdict                                                                                                                                       |
| -------- | ----------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R766-01  | High              | ✅ Yes            | **Medium**  | Real defect, but I downgrade High → Medium. See reasoning below. Still the highest-priority functional fix.                                   |
| R766-02  | Medium            | ✅ Yes            | Medium      | Confirmed. The doc-comment's "circular call chain" justification is itself partly wrong (the `_isDisposed` guard already prevents recursion). |
| R766-03  | Medium            | ✅ Yes            | Medium      | Confirmed. Broaden it: no `LICENSE` file ships either.                                                                                        |
| R766-04  | Low               | ✅ Yes            | Low         | Confirmed doc/impl contradiction.                                                                                                             |
| R766-05  | Low               | ✅ Yes            | Low         | Confirmed. Compiles only because TS narrows the property after direct assignment; not a runtime bug.                                          |
| R766-06  | Low               | ✅ Yes            | Low         | Confirmed at both sites.                                                                                                                      |
| R766-S01 | note              | n/a               | Info        | Agree — three tiers are implemented as designed.                                                                                              |
| R766-S02 | note              | ✅ Yes            | Low         | Confirmed `loggerLink()` is unconditional.                                                                                                    |
| R766-S03 | note              | ✅ Yes            | Low         | Confirmed; and the DocumentDB comment references a package `WithTelemetry` helper that does **not** exist.                                    |
| R766-S04 | note              | ✅ Yes            | Low         | Confirmed — the transport registers a `window` `message` listener per in-flight operation.                                                    |

No finding in the first pass was a false alarm. The only correction is the
severity of R766-01 and two rationale/scope refinements (R766-02, R766-03).

### R766-01 severity: why Medium, not High

> ⏭ **Moved to Iteration 2.** Options A/B/C are re-examined in the Iteration 2
> chapter, together with the side-effect analysis for existing projects.

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L331-L333)

The defect is real and verified: the listener callback is `async` and its first
act is `switch (message.op.type)`, with no guard. A foreign `postMessage` whose
payload has no `op` (or is `null`) throws a `TypeError`.

What tempers the severity is the _blast radius_:

- The throw happens **inside an `async` listener**, so it becomes an _unhandled
  promise rejection_, not a synchronous throw. VS Code's event emitter does not
  catch it (nothing is thrown synchronously), and the extension host does not
  abort on unhandled rejections by default — it logs. So the observable effect
  is log/telemetry noise plus a dropped foreign message, **not** a crash.
- It does **not** corrupt the tRPC channel: each message is a fresh listener
  invocation, so subsequent tRPC calls still dispatch correctly.
- It does **not** break the embedder's _own_ `onDidReceiveMessage` listener —
  VS Code fans a message out to every registered listener independently, so the
  consumer's own protocol handler still receives the message.

So the true impact is "the BYO-panel primitive is noisy and leaks unhandled
rejections whenever the panel also carries non-tRPC traffic" — which is exactly
the scenario `attachTrpc` was extracted to serve (design §3.1 notes the
Cosmos-derived primitive kept a defensive guard for precisely this). That makes
it the **top-priority functional fix**, but Medium is the honest severity: it
degrades a first-class use case rather than corrupting data or crashing.

**Options**

- **A — Guard before the switch.** Ignore any message that is not an object
  carrying an `op` object whose `type` is a known transport op; optionally emit
  one debug line through the already-present `ProcedureLogger`.
  - Pros: ~5 lines; matches the proven Cosmos guard; restores the primitive's
    stated purpose; trivially unit-testable (send junk, then assert a later
    query still resolves).
  - Cons: silent-ignore can mask a genuinely malformed tRPC message unless you
    add the debug log.
- **B — Also make the top-level listener throw-safe.** Keep the guard, and wrap
  the dispatch so a handler throw can never escape as an unhandled rejection
  (defence in depth for the whole class of bug).
  - Pros: eliminates the unhandled-rejection category, not just this instance.
  - Cons: slightly larger; still needs A for the actual routing decision.
- **C — Namespace the wire protocol.** Wrap every framework message in a
  discriminator (e.g. `{ __vscodeExtWebview: 1, … }`) so foreign traffic is
  unambiguous.
  - Pros: robust and future-proof if the panel ever multiplexes channels.
  - Cons: **breaking** wire change touching `vscodeLink` + host; violates the
    "wire protocol deliberately unchanged" line in the design's anti-churn
    ledger (§12.7). Overkill for preview.

**Recommendation: A now, plus B as cheap hardening.** Log ignored messages
through the optional logger so nothing is masked. Reject C for the preview —
revisit only if real channel-multiplexing demand appears.

### R766-02 — refinement

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L323-L338)

Confirmed. One correction to the code's own reasoning: the doc comment says the
panel is not closed to avoid a "circular call chain
(`dispose → panel.dispose → onDidDispose → dispose`)", but `dispose()` sets
`_isDisposed = true` _before_ doing anything else, so a re-entrant call already
returns immediately. The recursion the comment fears cannot happen — which means
the stated reason for the current behavior does not hold, and closing the panel
is safe.

Corroborating evidence that this is a latent (not yet triggered) issue: a repo
search shows DocumentDB never calls `controller.dispose()` or
`revealToForeground()` on these controllers, and the `openWebview` test only
asserts `isDisposed`/`onDisposed` — never that the panel closed
([openWebview.test.ts](../../../../../../packages/vscode-ext-webview/src/host/openWebview.test.ts#L84-L92)).
The handle method is essentially untested and unused in-repo, which is why the
gap survived.

**Options**

- **A — `dispose()` closes the panel.** Add `this._panel.dispose()` at the end
  of `dispose()`, guarded by a private `_panelClosing` flag so the
  `onDidDispose → dispose()` path does not attempt a second close.
  - Pros: makes the handle behave the way every consumer (and the README) will
    assume; smallest change; recursion already prevented.
  - Cons: must confirm double `panel.dispose()` is a no-op (VS Code disposables
    are idempotent; the flag makes it explicit).
- **B — Two verbs: `close()` (disposes the panel) vs `dispose()` (resources
  only).**
  - Pros: explicit about intent.
  - Cons: two things to learn; fights the README, which already advertises
    `dispose` as _the_ cleanup method; more surface for the "simple" audience.
- **C — Keep behavior, document it, add a `closePanel` option.**
  - Pros: zero behavior change.
  - Cons: least intuitive; directly contradicts the north star.

**Recommendation: A.** Close the panel from `dispose()`, add the `_panelClosing`
guard, correct the doc comment, and extend the `openWebview` test to assert the
mock panel's `dispose()` was called.

### R766-03 — broaden to include the license

References: [package.json](../../../../../../packages/vscode-ext-webview/package.json#L38-L41), [README.md](../../../../../../packages/vscode-ext-webview/README.md#L334-L336)

Confirmed: `files` is `["dist", "README.md"]`, so `ADVANCED.md` (linked ~10×
from the README) is not in the tarball. Additionally, the README's License
section links to `../../LICENSE.md` (repo root) and `package.json` sets
`"license": "MIT"`, but there is **no `LICENSE` file in the package directory**,
so npm ships no license text with the package — a compliance gap for a public
MIT package.

**Options**

- **A — Add `ADVANCED.md` and a package-local `LICENSE` to `files`.**
  - Pros: trivial; fixes the dead links, ships the advanced manual, and closes
    the license gap in one edit.
  - Cons: none. (A short `LICENSE` that references the repo root is fine, or copy
    the MIT text.)
- **B — Fold ADVANCED.md into README.**
  - Pros: one document.
  - Cons: bloats the README; worse for humans and agents scanning the quick
    start; still needs the license fix.

**Recommendation: A.**

### R766-04 — align the doc down to the implementation

References: [ADVANCED.md](../../../../../../packages/vscode-ext-webview/ADVANCED.md#L197-L199), [errorLink.ts](../../../../../../packages/vscode-ext-webview/src/webview/errorLink.ts#L71-L82), [useRpcEvents.ts](../../../../../../packages/vscode-ext-webview/src/react/useRpcEvents.ts#L20-L21)

Confirmed contradiction. `eventLink` guards `if (op.type !== 'subscription')` on
both `next` and `error`, and the `useRpcEvents` doc comment says subscriptions
are intentionally excluded — but ADVANCED.md L197-199 says subscription errors
_are_ surfaced on `onError`.

**Options**

- **A — Fix the doc** to state subscription outcomes are observed via
  `.subscribe({ onError })`, not the channel.
  - Pros: matches deliberate, code-documented behavior; one-paragraph edit.
  - Cons: none.
- **B — Change the impl** to publish subscription outcomes to the channel.
  - Pros: makes the doc true as written.
  - Cons: re-introduces the double-surfacing the code comment explicitly avoids;
    worse ergonomics.

**Recommendation: A.**

### R766-05 — store in a local, return the local

Reference: [documentsViewController.ts](../../../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L41-L73)

Confirmed low. It type-checks because TS narrows `handle.controller` to
non-`undefined` right after the direct assignment (no intervening call), so no
runtime bug. It is purely a readability/robustness nit.

**Options**

- **A — `const controller = openAppWebview(...); handle.controller = controller; return controller;`.**
  - Pros: return path is obviously non-nullable; keeps the deferred title-setter
    closure working.
  - Cons: none.
- **B — Remove the deferred setter entirely** (e.g. set the title after open, or
  pass a getter).
  - Pros: drops the `handle` indirection.
  - Cons: larger change for no functional gain.

**Recommendation: A.**

### R766-06 — call `return()` with no argument

References: [attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L259), [attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L374)

Confirmed at both sites. `AsyncIterator.return(value?)` takes the _return value_,
not an `IteratorResult`; passing `{ value: undefined, done: true }` sets that
object as the generator's final return value. Harmless today (nobody reads it),
but wrong modelling for a reusable transport.

**Recommendation:** call `iterator.return?.()` with no argument at both sites;
keep the existing rejection-swallowing. (No competing option worth listing.)

### R766-S02 / S03 / S04 — recommendations

- **R766-S02** (`loggerLink()` always on — [connectTrpc.ts](../../../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L106)):
  add `ConnectTrpcOptions.logger?: boolean` (default `false`); the facade and
  hooks stay quiet unless observability is requested. Reject an env-based
  default — webview bundles have no reliable `NODE_ENV`. **Recommend: opt-in
  logger, off by default.**
- **R766-S03** (document the telemetry-narrowing pattern): add the
  `WithTelemetry<T>` recipe to ADVANCED.md and optionally ship a generic
  `type WithTelemetry<TCtx, TTelemetry>` from `./host`; also fix the stale
  DocumentDB comment ([trpc.ts](../../../../../../src/webviews/_integration/trpc.ts#L60-L67))
  that calls itself a "replacement for the package's `WithTelemetry` helper"
  when the package exports none. **Recommend: document + ship a tiny generic
  helper.**
- **R766-S04** (README "single message listener" — [README.md](../../../../../../packages/vscode-ext-webview/README.md#L207-L211)):
  soften to "a shared client per webview"; drop the "single `message` listener"
  claim, which is false (one listener per in-flight op). **Recommend: reword.**

## New findings (deeper review)

### R766-N01: Medium - Webview-side inbound message guard throws on `null` / non-object `event.data`

> ⏭ **Moved to Iteration 2**, bundled with R766-01 — both transport edges (host
> `attachTrpc` and webview `onReceive`) should be guarded together.

Reference: [packages/vscode-ext-webview/src/webview/connectTrpc.ts](../../../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L92-L100)

This is the webview-side mirror of R766-01. `onReceive` registers a `window`
`message` listener whose guard is `if ((event.data as VsCodeLinkResponseMessage).id)`.
A webview's `window` receives `message` events from many sources (the VS Code
host shell, dev-server/HMR clients, embedded iframes). When `event.data` is
`null` or `undefined`, `(event.data as …).id` throws a `TypeError` inside the
listener. Non-object primitives (a bare string) are falsy-safe, so the failure
is specifically the `null`/`undefined` case.

Severity Medium because, unlike the host side, this throw is **synchronous**
inside a `window` event listener; it surfaces as an uncaught error in the webview
console on every such message and can fire repeatedly (e.g. an HMR client that
posts `null` pings).

**Options**

- **A — Structural guard:** `const data = event.data; if (data && typeof data === 'object' && 'id' in data && (data as …).id) { … }`.
  - Pros: robust; ~2 lines; symmetric with the R766-01 host fix.
  - Cons: none.
- **B — try/catch around the forward.**
  - Pros: catches everything.
  - Cons: hides real bugs; less precise than A.

**Recommendation: A** (and ship it together with R766-01 so both transport
edges reject foreign traffic consistently).

### R766-N02: Medium - The happy path is taxed by a separate, mismatch-prone `createCallerFactory` wire

> ⏭ **Moved to Iteration 2.** The Iteration 2 chapter shows consumer code for
> options A and B side by side with today's usage.

References: [initWebviewTrpc.ts](../../../../../../packages/vscode-ext-webview/src/shared/initWebviewTrpc.ts#L57-L64), [attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L134-L139), [ADVANCED.md](../../../../../../packages/vscode-ext-webview/ADVANCED.md#L88-L89)

This is the finding most in tension with the "simple for the 90%" north star. To
get a typed context (the whole point of `initWebviewTrpc<Ctx>()`), the greenfield
consumer must:

1. `const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<Ctx>()`;
2. **re-export** `createCallerFactory`; and
3. pass **both** `router` and `createCallerFactory` to `openWebview`.

If step 2/3 is forgotten, `attachTrpc` silently falls back to
`defaultCreateCallerFactory` (bound to a _different_ tRPC instance). ADVANCED.md
warns this "works only when your router is built with the package's default
`router`/`publicProcedure`" — i.e. the mismatch is **silent** and only sometimes
correct. That is exactly the class of footgun a coding agent hits: three
coordinated steps, one of them easy to drop, failure mode non-obvious.

**Options**

- **A — Accept the whole `WebviewTrpc<Ctx>` (or a `{ router, createCallerFactory }`
  pair) as one option.** One value that cannot be mismatched.
  - Pros: eliminates the re-export and the mismatch; small, explicit.
  - Cons: consumers pass an object instead of two fields.
- **B — Stamp the caller factory onto the router in `initWebviewTrpc`.** Have the
  returned `router` builder tag routers with their originating factory; the
  dispatcher reads `router.__callerFactory ?? default`. The `createCallerFactory`
  option disappears from the happy path entirely.
  - Pros: best ergonomics — the simple user passes only `router`, and a
    mismatch is structurally impossible; matches "least code that can possibly
    work."
  - Cons: a touch of "magic" (a non-enumerable property on the router); needs a
    typed accessor; still allow an explicit override for embedders.
- **C — Remove the silent default; require `createCallerFactory` (fail fast)**
  whenever the router is not the `.`-exported default.
  - Pros: no silent wrong-instance dispatch.
  - Cons: hard to detect "is this the default router" reliably; risks throwing
    on currently-working setups.
- **D — Dev-mode runtime check** comparing router/factory instance identity and
  warning on mismatch.
  - Pros: keeps the API; surfaces the footgun.
  - Cons: instance identity is not cleanly exposed by tRPC; heuristic.

**Recommendation: A** (decided in Iteration 2 — see the
[R766-N02 discussion](#r766-n02--consumer-code-today-vs-option-a-vs-option-b)).
B's zero-argument magic was rejected because its hidden router property is least
reliable for the tRPC-only, bring-your-own-router consumers the package also
serves; C's fail-fast can still be layered as a safety net for the non-default
case. This is the single highest-leverage simplification in the PR for humans and
agents: it removes an entire coordinated step from the documented quick start.

### R766-N03: Low - Inline-script interpolation in the panel HTML is not escaped for script-context breakout

> ⏭ **Moved to Iteration 2.** Option B (a non-executed `application/json` data
> block) and its consumer side effects are analysed in the Iteration 2 chapter.

References: [WebviewController.ts](../../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L267), [WebviewController.ts](../../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L272-L276)

`getDocumentTemplate` builds inline `<script>` blocks by string interpolation:

- `globalThis.l10n_bundle = ${JSON.stringify(vscode.l10n.bundle ?? {})}` — plain
  `JSON.stringify` does **not** escape `</script>`, `U+2028`, or `U+2029`, any of
  which can break out of an inline script context.
- `render('${this._options.viewType}', …)` — `viewType` is interpolated raw
  inside single quotes; a quote or `');…` in it breaks the statement.
- `__initialData` is the one field that _is_ protected (via `encodeURIComponent`).

All inputs here are developer-controlled (the extension's own l10n bundle and its
own `viewType`), and a CSP nonce is applied, so real-world risk is low — hence
Low. But this is a _reusable, published_ package: a coding agent may feed a
dynamic `viewType`, and l10n bundles can contain arbitrary translated text. A
transport library should not have a latent HTML-injection edge.

**Options**

- **A — Escape inline JSON and encode `viewType`.** Add a `safeJsonForScript()`
  that escapes `<`, `>`, `&`, `U+2028`, `U+2029`; pass `viewType` via
  `JSON.stringify` instead of raw single quotes.
  - Pros: cheap; removes the breakout edge; no API change.
  - Cons: a small helper to maintain.
- **B — Deliver l10n + config via a non-executed `<script type="application/json">`
  block** and parse it in the webview boot.
  - Pros: content in a data block cannot break the script context at all;
    cleanest.
  - Cons: touches the webview boot contract (`window.config`, `l10n_bundle`).
- **C — Push initial data over `postMessage` after load** (Cosmos's convention).
  - Pros: no inline data injection at all.
  - Cons: adds a round-trip and a "loading" state to the _simple_ path; a
    regression for the north-star audience.

**Recommendation: A now** (removes the edge with no contract change); note **B**
as the cleaner long-term shape. Reject C for the facade.

### R766-N04: Low - `AttachTrpcResult` leaks live mutable internal `Map`s

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L64-L68)

`attachTrpc` returns its internal `activeOperations` and `activeSubscriptions`
`Map`s directly (documented as "live map"). A consumer can `.clear()`,
`.delete()`, or overwrite entries and silently corrupt in-flight dispatch and
cancellation bookkeeping. The intent is observation, but the type invites
mutation.

**Options**

- **A — Type them as `ReadonlyMap<…>` in `AttachTrpcResult`** (internal code keeps
  the mutable reference; cast at the boundary).
  - Pros: preserves observability (size, iteration); removes the mutation
    footgun; zero runtime cost.
  - Cons: none material.
- **B — Expose only derived read-only accessors** (e.g. `activeOperationCount`).
  - Pros: smallest surface.
  - Cons: drops the ability to inspect ids; more API churn.
- **C — Leave as-is** (documented "live").
  - Pros: no change.
  - Cons: keeps the footgun in a _primitive_ meant for embedders.

**Recommendation: A.**

### R766-N05: Low - A throwing event-channel observer breaks tRPC dispatch

> ⏭ **Moved to Iteration 2.** Options for surfacing observer exceptions to
> telemetry (not just the console) are explored in the Iteration 2 chapter; not
> implemented this pass, per request.

Reference: [packages/vscode-ext-webview/src/webview/events.ts](../../../../../../packages/vscode-ext-webview/src/webview/events.ts#L110-L129)

`emitSuccess`/`emitError`/`emitAborted` invoke handlers synchronously inside the
`eventLink` `next`/`error` callbacks. The channel's own contract says it is
"observer-only" and cannot affect the value — but if an observer _throws_, the
exception propagates into the link chain and disrupts the very call it was only
supposed to observe. Snapshotting the handler set (already done) protects
iteration, not the caller.

**Options**

- **A — Isolate handler exceptions:** wrap each handler call in try/catch and
  route to `console.error`.
  - Pros: upholds the "cannot affect the value" contract; one small change.
  - Cons: swallows observer bugs (acceptable — that is what observation means).
- **B — Document that handlers must not throw.**
  - Pros: no code change.
  - Cons: relies on every consumer/agent reading and obeying the note.

**Recommendation: A.**

### R766-N06: Info - No create-or-reveal / single-instance helper in the front door

> ⏭ **Moved to Iteration 2** (unchanged recommendation: document the pattern,
> don't build it into the package yet).

References: [openWebview.ts](../../../../../../packages/vscode-ext-webview/src/host/openWebview.ts#L42-L50), [documentsViewController.ts](../../../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L29-L73)

Every `openWebview` / `openAppWebview` call creates a **new** panel. DocumentDB
does not dedupe (opening the same document twice yields two tabs); Cosmos solves
this with `static openTabs` / `instances` registries in their `BaseTab`. This is
arguably consumer scope, but the north star is "best experience ever," and
create-or-reveal is the single most common panel pattern in real extensions.

**Options**

- **A — Ship an optional create-or-reveal helper** keyed by `viewType` + a
  consumer-supplied key (returns the existing controller and reveals it if one is
  open).
  - Pros: removes boilerplate every consumer otherwise reinvents; great DX.
  - Cons: adds panel-registry state to the package; lifecycle edge cases
    (dispose eviction) to get right; scope creep for a transport package.
- **B — Leave to consumers, document the pattern** in ADVANCED.md.
  - Pros: keeps the package small and unopinionated ("pluggable, not bloated").
  - Cons: everyone reimplements it.

**Recommendation: B for the preview** (document it), and revisit A only if
multiple consumers converge on the same reimplementation. Keeping the package
lean is more aligned with the design's stated scope than pre-emptively owning
panel-registry state.

### R766-N07: Low - `useConfiguration` can crash the webview on malformed initial data

Reference: [packages/vscode-ext-webview/src/react/useConfiguration.ts](../../../../../../packages/vscode-ext-webview/src/react/useConfiguration.ts#L23-L29)

`JSON.parse(decodeURIComponent(window.config?.__initialData ?? '{}'))` runs in a
`useState` initializer. If `__initialData` is malformed (a consumer hand-rolling
the HTML, or the R766-N03 escaping edge), the parse throws _during render_ and
the webview white-screens with no guidance. The host normally controls the
encoding, so risk is low.

**Options**

- **A — Defensive parse:** try/catch, return a typed default (`{} as T`) and
  `console.error` on failure.
  - Pros: a bad payload degrades to empty config instead of a blank webview.
  - Cons: masks a malformed payload (mitigated by the logged error).
- **B — Leave (host-controlled).**
  - Pros: no change.
  - Cons: a single bad byte from a non-facade consumer bricks the view.

**Recommendation: A.**

### R766-N08: Low - The `telemetry` controller option is actually a dispatch _logger_, overloading the word

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L92-L99)

`WebviewControllerOptions.telemetry?: ProcedureLogger` is the zero-config console
_logging_ sink. But ADVANCED.md uses "telemetry" for the _analytics_ path
(`telemetryMiddlewareBody` + `TelemetryRunner`), which is a different mechanism
wired onto procedures. Naming the logger option `telemetry` collides with the
analytics vocabulary and will mislead agents into thinking they wire Application
Insights here.

**Options**

- **A — Rename the option to `logger`** (or `dispatchLogger`); keep `telemetry`
  as a deprecated alias for the preview window.
  - Pros: aligns with `ProcedureLogger` / `consoleProcedureLogger`; removes the
    collision; preview is explicitly free to rename.
  - Cons: one rename across the facade + docs + the DocumentDB consumer.
- **B — Keep the name, clarify the docs.**
  - Pros: no code churn.
  - Cons: the type says `ProcedureLogger` but the key says `telemetry`; the
    collision remains.

**Recommendation: A** (rename to `logger`) while still in preview.

## Consolidated priority & decisions

Severity legend: **Med** = fix before preview goes wider; **Low** = cheap
follow-up; **Info** = judgment call. **Status** column added after Iteration 1
(commit for shipped fixes; see the [change protocol](#iteration-1--change-protocol-2026-07-03)).

| ID       | Severity | Area               | Recommended option                            | Status                                   |
| -------- | -------- | ------------------ | --------------------------------------------- | ---------------------------------------- |
| R766-01  | Med      | host transport     | A (guard) + B (throw-safe)                    | ✅ `ade2ce61` (Iteration 2)              |
| R766-N02 | Med      | happy-path API     | A (pass `WebviewTrpc` instance)               | ✅ `21b0a2f7` (Iteration 2)              |
| R766-02  | Med      | host lifecycle     | A (`dispose()` closes panel + guard)          | ✅ `76172cd2`                            |
| R766-03  | Med      | packaging          | A (ship `ADVANCED.md` + `LICENSE`)            | ✅ `46296ce4`                            |
| R766-N01 | Med      | webview transport  | A (structural guard)                          | ✅ `ade2ce61` (Iteration 2)              |
| R766-S02 | Low      | webview logging    | A (opt-in logger, off by default)             | ✅ `6363a6f2`                            |
| R766-N04 | Low      | host primitive     | A (`ReadonlyMap`)                             | ✅ `0bd16afa`                            |
| R766-N05 | Low      | event channel      | isolate throws + `onObserverError` (option 1) | ✅ `76227034` (Iteration 2)              |
| R766-N03 | Low      | security hardening | B (JSON data block, per request)              | ✅ `d5748abe` (Iteration 2)              |
| R766-N08 | Low      | naming             | A (rename `telemetry` → `logger`)             | ✅ `76f99484`                            |
| R766-04  | Low      | docs               | A (fix ADVANCED.md)                           | ✅ `61a01033`                            |
| R766-05  | Low      | consumer code      | A (local const)                               | ✅ `c5662718`                            |
| R766-06  | Low      | host transport     | A (`return()` no arg)                         | ✅ `0292780`                             |
| R766-S03 | Low      | docs + helper      | A (document + ship generic)                   | ✅ `32859afc`                            |
| R766-S04 | Low      | docs + instrument  | A (reword) + concurrency signal               | ✅ `de27b507` + `dbbf9969` (Iteration 2) |
| R766-N07 | Low      | webview config     | A (defensive parse)                           | ✅ `9a758cc5`                            |
| R766-S01 | Info     | architecture       | keep three tiers                              | ✅ Agreed (no change)                    |
| R766-N06 | Info     | front-door scope   | B (document, don't build yet)                 | ✅ `b603affd` (Iteration 2)              |

### Suggested batching

1. **Transport hardening (one PR):** R766-01, R766-N01, R766-06, R766-N04,
   R766-N05 — all in `attachTrpc.ts` / `connectTrpc.ts` / `events.ts`, with the
   foreign-message tests.
2. **API ergonomics (one PR, discuss first):** R766-N02 (the caller-factory
   simplification) + R766-N08 rename. This is the one that may bend the public
   surface, so agree the shape before coding.
3. **Lifecycle + packaging (one PR):** R766-02, R766-03.
4. **Docs + polish (one PR):** R766-04, R766-05, R766-S02, R766-S03, R766-S04,
   R766-N03, R766-N07.

Only batches 1–3 are worth treating as preview blockers; batch 4 can trail.

---

# Iteration 2 — open items & answers

Added 2026-07-03, after the Iteration 1 commits. This chapter collects everything
still open, and answers the specific questions raised while triaging iteration 1.
Nothing here is implemented yet — these are decisions and analyses to act on in a
follow-up pass.

## Still open

| ID       | Title                                 | Why it is here                                                                                                                                                                                                                            |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R766-01  | `attachTrpc` foreign-message guard    | ✅ Implemented in Iteration 2 (structural guard + throw-safe listener + foreign-message test).                                                                                                                                            |
| R766-N01 | Webview inbound `event.data` guard    | ✅ Implemented in Iteration 2 (structural `onReceive` guard + test).                                                                                                                                                                      |
| R766-N02 | `createCallerFactory` ergonomics      | ✅ Implemented in Iteration 2 (option A: `trpc` instance option; consumer adopted; `createCallerFactory` deprecated).                                                                                                                     |
| R766-N03 | Inline-script hardening               | ✅ Implemented in Iteration 2 (option B: inert `application/json` data block + nonce'd boot parser).                                                                                                                                      |
| R766-N05 | Event-observer isolation & visibility | ✅ Implemented in **Iteration 3** (option 1: always-on observer isolation + opt-in `onObserverError` sink; DocumentDB opts in via `reportObserverError`). See the [Iteration 3](#iteration-3--event-observer-isolation-r766-n05) chapter. |
| R766-N06 | Create-or-reveal helper               | ✅ Documented in Iteration 2 (ADVANCED.md pattern; no package code).                                                                                                                                                                      |
| R766-S04 | Per-operation listener design         | ✅ Instrumented in Iteration 2 (concurrency gauge: `ProcedureLogger.concurrent` + accumulating telemetry).                                                                                                                                |

## Iteration 2 — change protocol (2026-07-03)

> Protocol of changes for iteration 2: what shipped, why, and the commit that
> carries it. Each fix is an individual commit on `dev/tnaum/webview-api-refinements`,
> pushed and acknowledged with a PR comment. No Copilot review threads applied to
> these items (the two that had threads, R766-05 / R766-06, were resolved in
> Iteration 1).

**Post-change validation (all green):** `npm run l10n` (no drift) · `prettier`
(applied) · `eslint --quiet` (clean) · `jest` (2655 passed / 158 suites) · `tsc`
build across all workspaces (clean).

| ID       | Commit     | What changed                                                                                                                                                            | Why (motivation)                                                                                                                                                  |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R766-01  | `ade2ce61` | `attachTrpc` guards inbound messages (`isTransportRequestMessage`) and wraps dispatch in `try/catch`                                                                    | As the bring-your-own-panel primitive it may share a bus with non-tRPC traffic; a foreign message (no `op`) threw as an unhandled rejection. Ships options A + B. |
| R766-N01 | `ade2ce61` | `connectTrpc` `onReceive` guards `event.data` before reading `.id`                                                                                                      | Webview mirror of R766-01: a `null` / foreign `window` message threw. Shipped in the same commit so both transport edges reject foreign traffic together.         |
| R766-N02 | `21b0a2f7` | `openWebview` / `WebviewController` accept a `trpc` option; standalone `createCallerFactory` deprecated; consumer + README + ADVANCED updated                           | Removes the re-export + silent-fallback footgun on the happy path (option A). `attachTrpc` keeps its explicit factory for embedders.                              |
| R766-N03 | `d5748abe` | Initial data delivered in an inert `application/json` block + nonce'd boot parser; `serializeInertJson` escapes `<`                                                     | Removes the inline-script break-out class by construction (option B). `__initialData` stays encoded, so `useConfiguration` is unchanged.                          |
| R766-N06 | `b603affd` | ADVANCED.md documents the create-or-reveal pattern (consumer-side `Map` + `revealToForeground` + `onDisposed`)                                                          | Keeps the panel registry in consumer space; the package stays a transport library. Documented, not built.                                                         |
| R766-S04 | `dbbf9969` | `ProcedureLogEntry.concurrent` stamped by `attachTrpc`; DocumentDB `rpcConcurrencyLogger` → accumulating-telemetry `concurrentRpcOps` distribution + `dispatch` counter | Turns “revisit only on evidence” into a real concurrency signal (peak / average in-flight ops) to judge the per-operation listener.                               |

**Iteration 2 wrap-up:** every item batched for Iteration 2 is addressed. The one
remaining deferral, R766-N05, was implemented separately as
[Iteration 3](#iteration-3--event-observer-isolation-r766-n05); the Copilot
reviewer's 2026-07-05 pass is triaged in
[Iteration 4](#iteration-4--copilot-reviewer-feedback-2026-07-05).

## R766-01 — side effects on existing projects, and A/B/C re-analysis

> ✅ **Implemented in Iteration 2** [R766-01]. Shipped **A + B** together in
> `attachTrpc`: a structural `isTransportRequestMessage` guard drops any inbound
> payload that is not a well-formed transport request (a non-null object with an
> `id` string and an `op` object whose `type` is a string), and the top-level
> `async` listener now wraps dispatch in `try/catch` so no handler throw can
> escape as an unhandled rejection. Added a foreign-message unit test (send junk /
> `null` → ignored and nothing posted; a later query still resolves). The analysis
> below is retained as the rationale.

**Does skipping this hurt existing projects? No.** R766-01 is entirely inside
`attachTrpc`, the _bring-your-own-panel_ primitive. Today the only consumer
(DocumentDB) never calls `attachTrpc` directly — it goes through `openWebview` /
`WebviewController`, which **create and own** the panel. A framework-owned panel
carries **only** tRPC traffic, so `message.op` is always present and the missing
guard is never reached. The defect is latent until someone attaches tRPC to a
panel that _also_ carries their own `postMessage` protocol (a legacy-migration
embedder such as Cosmos). So your read is correct: it is hidden behind the API,
and there is **no real cost to current consumers** — which is exactly why it is
safe to defer.

When it _is_ reached, the blast radius is still bounded: the throw happens inside
an `async` listener, so it becomes an unhandled rejection (log noise) rather than
a crash, it does not corrupt the tRPC channel, and it does not break the
embedder's own separate listener (VS Code fans each message out independently).
That is why the severity is Medium, not High.

Re-analysis of the three options:

- **A — runtime guard before the `switch`** (ignore anything that is not an
  object with an `op` of a known transport type; optionally debug-log via the
  existing `ProcedureLogger`).
  - Pros: ~5 lines; mirrors the proven Cosmos guard; unblocks the embedder use
    case; trivially unit-testable (send junk, assert a later query still
    resolves).
  - Cons: silent-ignore could mask a genuinely malformed tRPC message unless the
    debug log is wired.
  - Verdict: **still the primary fix.**
- **B — make the top-level listener throw-safe** (wrap dispatch so a handler
  throw cannot escape as an unhandled rejection).
  - Pros: eliminates the entire unhandled-rejection class, not just this
    instance; cheap.
  - Cons: needs A for the actual routing decision; on its own it only hides
    symptoms.
  - Verdict: **do it together with A** as defence-in-depth.
- **C — namespace the wire protocol** (wrap every framework message in a
  discriminator).
  - Pros: unambiguous; future-proof if a panel ever multiplexes channels.
  - Cons: **breaking wire change** across `vscodeLink` + host; violates the
    "wire protocol deliberately unchanged" anti-churn line; overkill for preview.
  - Verdict: **reject for preview**; revisit only if real multiplexing appears.

**Iteration 2 plan:** ship **A + B** together (with the foreign-message test)
when the first bring-your-own-panel embedder is on the horizon, or proactively
before `attachTrpc` is advertised widely — whichever comes first.

## R766-N01 — bundle with R766-01

> ✅ **Implemented in Iteration 2** [R766-N01]. `connectTrpc`'s `onReceive` now
> guards `event.data` (`data !== null && typeof data === 'object' && 'id' in
data`) before forwarding, so a `null` / primitive / foreign `window` message can
> no longer throw. Covered by a new test that delivers `null` / a string / an
> `id`-less object mid-flight and asserts no throw and that the real response
> still resolves.

Same shape on the webview side: `connectTrpc`'s `onReceive` reads
`(event.data as …).id` and throws if `event.data` is `null`/`undefined`. Same
"no current cost" reasoning (DocumentDB's webviews do not receive non-tRPC
`window` messages in production), and the same fix window. Ship the structural
guard (`data && typeof data === 'object' && 'id' in data`) **in the same pass as
R766-01** so both transport edges reject foreign traffic consistently.

## R766-N02 — consumer code: today vs option A vs option B

> ✅ **Implemented in Iteration 2** [R766-N02]. `openWebview` / `WebviewController`
> gained a `trpc` option; the dispatcher reads `trpc.createCallerFactory` off it.
> The standalone `createCallerFactory` option is now `@deprecated` (still honored),
> and the low-level `attachTrpc` primitive keeps its explicit `callerFactory`
> argument for embedders. DocumentDB's `openAppWebview` now passes `trpc` instead
> of re-exporting `createCallerFactory`. Added an `openWebview` test that wires the
> factory purely from the `trpc` option; README + ADVANCED.md updated.
>
> **Minor deviation from the literal `trpc: WebviewTrpc<Ctx>` plan** (confidence
>
> > 80%, verified by a clean consumer typecheck): the option is typed
> > `Pick<WebviewTrpc<TContext>, 'createCallerFactory'>`. The reference consumer
> > builds procedures on a _base-context_ instance and narrows `ctx` per call, so
> > its instance context is a base of the controller `TContext`; a strict
> > `WebviewTrpc<TContext>` would reject it. The controller only ever reads
> > `createCallerFactory`, and the `Pick` accepts that instance by parameter
> > contravariance — no cast, and the mismatch-proofing is unchanged.

**Decision: option A** (accept the `WebviewTrpc` instance). Rationale below,
including why A and B look identical at the call site but are not, and what each
means for consumers who want the tRPC transport only, without the package's
webview scaffolding.

### What N02 is actually solving

The host dispatcher needs **two** things from the consumer, not one: the
`router` (what procedures exist) and a `createCallerFactory` (how to invoke a
procedure against a context). In tRPC, `createCallerFactory` is bound to the
_instance_ returned by `initTRPC.context<T>().create()` — the router object does
**not** carry a reference back to its own factory. So today the consumer has to
route that factory by hand, and if they don't, `attachTrpc` silently falls back
to `defaultCreateCallerFactory` (the factory of a _different_, bare
`BaseRouterContext` instance). That "works" for vanilla configs but is
type-unsound and misbehaves the moment the two instances differ (transformers,
error formatters). **That silent fallback is the footgun — not the verbosity.**

**Today** (three coordinated steps; the footgun is forgetting step 2/3):

```ts
// appRouter.ts
const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<RouterContext>();
export const appRouter = router({
  /* … */
});
export { createCallerFactory }; // (1) must remember to re-export

// open site
openWebview(ctx, {
  router: appRouter,
  createCallerFactory, // (2) must remember to pass it, and (3) it must match appRouter's instance
  context,
  config,
  sourceLayout,
});
```

**Option A — pass the typed tRPC instance; the factory rides along.** One import
(`trpc`), no separate factory export, and the factory cannot be mismatched
because it is read off the same instance the router was built from:

```ts
// appRouter.ts
export const trpc = initWebviewTrpc<RouterContext>();
export const appRouter = trpc.router({
  /* … */
});

// open site — no `createCallerFactory` anywhere
openWebview(ctx, {
  trpc, // openWebview reads trpc.createCallerFactory internally
  router: appRouter,
  context,
  config,
  sourceLayout,
});
```

**Option B — stamp the factory onto the router; the simplest possible call.**
`initWebviewTrpc().router(...)` tags the built router with its own caller factory
(a non-enumerable symbol), and `openWebview` / `attachTrpc` read
`router[callerFactory] ?? default`. The consumer never sees `createCallerFactory`
at all:

```ts
// appRouter.ts
const { router, publicProcedure } = initWebviewTrpc<RouterContext>();
export const appRouter = router({
  /* … */
}); // router silently carries its caller factory

// open site — one thing, impossible to mismatch, no footgun
openWebview(ctx, {
  router: appRouter,
  context,
  config,
  sourceLayout,
});
```

### Why A and B look similar — and where they diverge

Both delete the re-export and the separate `createCallerFactory` argument, so at
the `openWebview` call site they read almost identically. The real difference is
the **source of truth** for the factory and **what mismatch remains possible**:

|           | Where the factory lives           | Passed to `openWebview`          | Can it still be mismatched?                                                                                             | Cost                                               |
| --------- | --------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Today** | free-floating value               | `router` + `createCallerFactory` | Yes — forget it / pass the wrong one → silent wrong default                                                             | ceremony + footgun                                 |
| **A**     | on the **instance** (`trpc`)      | `router` + `trpc`                | Only if you pass a `router` built from a _different_ instance than `trpc` (unlikely, but still two things kept in sync) | one meaningful import; explicit; no magic          |
| **B**     | on the **router** (hidden symbol) | `router` only                    | No — the router _is_ the source of truth; impossible for a simple router                                                | zero ceremony; relies on a non-enumerable property |

So A is a _modest_ step past today (you still hand over two coordinated things —
`trpc` and `router` — you have just swapped a loose function for the instance it
came from and dropped the dedicated re-export). B is a _qualitative_ step (one
thing, mismatch structurally impossible) at the cost of "magic": a non-enumerable
symbol stamped on the router by `initWebviewTrpc().router(...)`.

### What each means for tRPC-only consumers (bring-your-own webview)

This is the deciding lens. Consider a consumer who uses only the transport
primitives (`attachTrpc` on the host, `connectTrpc` in the webview) and brings
their own UI / bundling / React — not `openWebview` / `WebviewController` / the
React `render` scaffold. They split further on whether they build their tRPC root
with the package's `initWebviewTrpc()` or with raw `@trpc/server` `initTRPC()`.

- **Option A does essentially nothing for them.** A is sugar on the `openWebview`
  front door they are not using. They call
  `attachTrpc(panel, ctx, router, callerFactory)` directly, and `attachTrpc`
  keeps its explicit `callerFactory` parameter. The factory stays a visible
  argument; nothing regresses, nothing is hidden.
- **Option B helps them only if they adopt `initWebviewTrpc().router`.** If they
  build with the stamped `.router`, the factory rides on the router into
  `attachTrpc` and the low-level call needs no factory argument. But if they use
  **raw `initTRPC()`** — a perfectly reasonable stance for a "just the transport,
  no dependency on your wrapper" consumer — the router has no stamp and they must
  pass `callerFactory` explicitly (identical to today). Worse, B introduces a
  **hidden-property convention**, and this cohort (advanced tRPC users) is the
  most likely to hit the cases that _drop_ it: `mergeRouters`, object
  spreads/clones, or wrapping the router through their own machinery can strip a
  non-enumerable symbol, silently reinstating the default factory — the exact
  footgun, now invisible. B's "impossible to mismatch" guarantee holds for the
  greenfield router but **weakens precisely for the compose-your-own-router power
  user.**

For the bring-your-own-UI audience, then, B's implicit magic is a liability and
A's explicitness is a _feature_: composition-proof, nothing to lose, visible at
the call site.

### Recommendation: A

Choose **A** — accept the `WebviewTrpc<Ctx>` instance on `openWebview` /
`WebviewController`, read `trpc.createCallerFactory` internally, and **keep
`attachTrpc`'s explicit `callerFactory` parameter** for embedders. This removes
the re-export and the silent-fallback footgun for the greenfield path without
introducing a hidden property that can be silently dropped by router
composition. B is rejected not because its call site is worse — it is marginally
nicer — but because its one advantage (zero-argument magic) is bought with an
implicit convention that is least reliable for exactly the tRPC-only,
bring-your-own-router consumers this package also serves. `attachTrpc` continues
to accept an explicit `callerFactory` for embedders who bring their own tRPC
instance.

Concretely, A means: `openWebview` / `WebviewController` gain an optional
`trpc: WebviewTrpc<Ctx>` option; when present the dispatcher uses
`trpc.createCallerFactory`; the standalone `createCallerFactory` option is
deprecated on the happy path, while `attachTrpc` still accepts an explicit
`callerFactory` positional for raw-tRPC embedders. No wire change, no hidden
state.

## R766-N03 — option B (JSON data block): consumer side effects

> ✅ **Implemented in Iteration 2** [R766-N03]. `WebviewController.getDocumentTemplate`
> now emits the initial data (encoded config, l10n bundle, viewType) in an inert
> `<script type="application/json" id="vscode-ext-webview-initial-data">` block and
> reads it from a nonce'd module boot script (`JSON.parse(el.textContent)` →
> `globalThis.l10n_bundle` / `window.config.__initialData` / `render(viewType)`).
> A `serializeInertJson` helper escapes `<` (plus U+2028 / U+2029) so the block
> cannot break out of its `</script>`. `__initialData` stays
> `encodeURIComponent`'d, so `useConfiguration` is unchanged. Added a regression
> test asserting an injected `</script>` in `viewType` is escaped to `\u003c`.
> Standard-template consumers (all of them, via `WebviewController`) are
> unaffected.

**Option B** replaces the executable inline-script injection with a non-executed
data block:

```html
<!-- instead of: <script>window.config = { __initialData: '…' }; l10n_bundle = {…}</script> -->
<script type="application/json" id="vscode-ext-webview-initial-data">
  { "config": …, "l10n": … }
</script>
```

…and a tiny nonce'd boot script that `JSON.parse`s that element into
`window.config` / `globalThis.l10n_bundle` before calling `render(...)`.

**Side effects on consumers — essentially none for the standard path:**

- `useConfiguration` still reads `window.config.__initialData`; the standard
  `render(viewType, vscodeApi)` scaffold is unchanged. Consumers using the
  package's HTML template (all of them today, via `WebviewController`) see **no
  API change**.
- The only consumers affected are those who **hand-roll their own HTML** instead
  of the template — they would adopt the data-block convention. We own the
  template and the one consumer (DocumentDB), and the API is unshipped, so the
  blast radius is effectively zero.
- CSP: the JSON block is inert (`type="application/json"` is not executed), so it
  needs no `script-src` entry; only the small parser boot script needs the
  existing nonce. Net CSP change is negligible.
- Payoff: the `</script>` / `U+2028` / quote break-out edge in R766-N03
  disappears by construction, and it composes well with the already-shipped
  defensive parse (R766-N07).

**Recommendation:** adopt **B** in iteration 2. Because we can update our own
consumers and the standard path is untouched, B is cleaner than option A's
manual escaping and removes the vulnerability class rather than patching it.

## R766-N05 — options to make observer exceptions visible to telemetry

> ✅ **Implemented in Iteration 3** [R766-N05]. Both parts shipped together: the
> **correctness fix** (a throwing observer is now isolated so it can no longer
> break the tRPC call it only observes) and the **visibility hook** — **option 1**,
> an opt-in `onObserverError` sink defaulting to `console.error`. It stays off
> beyond that console default in the happy path; DocumentDB opts in via
> `reportObserverError`, which also elevates to the browser `reportError()` global
> (**option 5**). See the
> [Iteration 3](#iteration-3--event-observer-isolation-r766-n05) chapter for the
> change protocol and rationale; the option analysis below is retained as the
> record of why option 1 was chosen.

Goal: when a consumer's event-channel handler throws, it must (a) not corrupt tRPC
dispatch and (b) be _observable_ — ideally routable to telemetry, not just
`console.error`. Options (not implemented; for discussion):

- **Option 1 — an `onObserverError` sink.** `createEventChannel({ onError })` /
  `connectTrpc(api, { onObserverError })`; the channel try/catches each handler
  and calls the sink with `(error, info)`. Consumers forward it to their
  telemetry. _Pros:_ explicit, structured (keeps `CallInfo`), testable, isolates
  the throw. _Cons:_ one more option.
- **Option 2 — a channel `onInternalError` event.** Add it to `RpcEventChannel`.
  _Cons:_ its own handlers can throw (recursion) — needs a hard guard; muddies the
  "observe query/mutation outcomes" contract.
- **Option 3 — synthesize an `emitError` with a marker path** (e.g. `$observer`).
  _Cons:_ pollutes the normal error stream; confusing to consumers.
- **Option 4 — round-trip to the host** so host-side telemetry records it.
  _Cons:_ heavy; couples webview observer bugs to host telemetry; lossy/ordered.
- **Option 5 — `reportError(err)` (the browser global).** Wrap handler calls so a
  throw is reported; surfaces in devtools and is catchable by a consumer's global
  handler. _Pros:_ zero API surface; standard mechanism. _Cons:_ unstructured (no
  `CallInfo`).

**Leaning:** **Option 1** as the structured, opt-in hook (default it to
`console.error` so it also fixes the dispatch-corruption in R766-N05), optionally
combined with **Option 5** as the always-on default so a throw is at least
visible without wiring. Decide in iteration 2.

## R766-S04 — pros & cons of the per-operation `message` listener (shipped: doc reword only)

> ✅ **Instrumented in Iteration 2** [R766-S04]. The design is unchanged (still the
> per-operation listener), but it is now measured. `attachTrpc` stamps every
> dispatch log entry with `concurrent` (in-flight ops at completion), and
> DocumentDB's `rpcConcurrencyLogger` feeds it into
> `callWithAccumulatingTelemetry('documentDB.webview.rpcConcurrency', …)` as a
> `concurrentRpcOps` distribution plus a `dispatch` counter (batched, so volume is
> negligible). The revisit thresholds are in the “Instrument it” subsection below.
> This turns “revisit only on evidence” into an actual signal — and, if peak `N`
> stays tiny, the evidence to _retire_ S04.

The transport (`vscodeLink` → `connectTrpc`'s `onReceive`) registers a **new
`window` `message` listener per in-flight operation**, each filtering by
`operationId` and removed on completion, rather than one central listener with an
`id → observer` map. The README reword (R766-S04) stopped _advertising_ this
internal; here is why the design itself is reasonable and when to revisit it.

**Pros**

- **Simplicity & correctness by construction.** Each operation's observable owns
  its listener and its teardown, so add-on-subscribe / remove-on-unsubscribe is
  local and hard to get wrong. No shared routing table to keep in sync.
- **Isolation.** No central mutable map that a bug (or a consumer, cf. R766-N04)
  can corrupt; one operation cannot disturb another's routing.
- **Leak-resistant.** Cleanup is tied to observable teardown; unsubscribing an
  operation removes exactly its listener.

**Cons**

- **O(N) fan-out.** Every inbound message is delivered to all N current listeners,
  each doing an id check — O(N) per message, O(N·M) for M messages. For a webview
  with many concurrent in-flight operations this is wasteful.
- **Listener churn.** Rapid `addEventListener` / `removeEventListener` cycles for
  short operations.
- **Repeated guard.** The `event.data` guard (R766-N01) runs in every listener.

**Assessment.** For this package's domain — interactive VS Code webviews with a
handful of concurrent RPCs — the per-operation listener is a sound
simplicity-over-throughput trade, and the source comment already says as much. A
single multiplexing listener + `Map<id, observer>` is the O(1)-per-message
"textbook" alternative and would be worth adopting **only** if the fan-out is
shown to matter under real concurrency. **Recommendation: keep as is, but
instrument it so the "revisit" trigger is data, not a hunch.** The README reword
already shipped; the concurrency signal below is the Iteration 2 ask.

### Instrument it — a concurrency signal to decide on evidence

The fan-out cost is `O(N)` per message, where `N` is the number of **concurrent
in-flight operations** (each one owns a `window` `message` listener). `N` is the
single variable that decides whether the per-operation design ever matters, so
that is what we measure: its **peak** and **average**, plus the dispatch volume
that multiplies it.

**Where to sample it (for free).** The host already tracks every in-flight
operation in [`AttachTrpcResult.activeOperations` + `.activeSubscriptions`](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L55-L78)
(exposed read-only in R766-N04). Their combined size _is_ `N`. Because each
in-flight operation is exactly one host map entry **and** one webview listener,
the host-side count is a faithful, zero-cost proxy for the webview fan-out — no
webview→host round-trip needed.

**How to emit it — reuse the accumulating telemetry.**
[`callWithAccumulatingTelemetry`](../../../../../../src/utils/accumulatingTelemetry.ts)
already reduces a `distributions` gauge to `min / max / sum / count` across a
batch and sums plain `measurements`, so one call per dispatched operation gives
us the whole picture without per-op event spam:

```ts
// host side, once per dispatched operation — given the AttachTrpcResult handle
// (or, cleaner, the ProcedureLogger `concurrent` field proposed below)
void callWithAccumulatingTelemetry('documentDB.webview.rpcConcurrency', (ctx) => {
  const n = handle.activeOperations.size + handle.activeSubscriptions.size;
  (ctx.telemetry as TelemetryWithDistributions).distributions.concurrentRpcOps = n; // gauge → min/max/sum/count
  ctx.telemetry.measurements.dispatch = 1; // summed → total ops per flush window
});
```

Optional tiny package hook to make this first-class instead of reaching into the
maps: add a `concurrent` field to the `ProcedureLogger` log record (=
`activeOperations.size + activeSubscriptions.size` at log time) — a natural
extension of R766-N04's "expose for observation." Any consumer's logger can then
forward it into their own telemetry.

**Fields emitted** (batched — default 20 calls / 30 s):

- `dist_concurrentRpcOps_max` — **peak concurrency; the number that matters** (the
  high-water mark of simultaneous listeners).
- `dist_concurrentRpcOps_sum` / `_count` — average concurrency = `sum / count`.
- `dispatch` — total operations per flush window (volume / a rough rate over ~30 s).
- `dist_auto_duration_ms_*` — per-op latency, recorded for free by the wrapper.

**Guidelines — what reading sends us back to this.** The thresholds follow
directly from the `O(N)` model: at small `N` the per-message work is a few
id-string comparisons; the multiplexer's extra complexity — a shared routing
table with the very corruption surface R766-N04 guards against — only pays off
once `N` is routinely large or sustained-high **and** the message rate is high
(the `O(N·M)` term bites).

| Reading                                                                                                                                                   | Interpretation                                  | Verdict                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `dist_concurrentRpcOps_max` ≤ 8 in ~all sessions                                                                                                          | fan-out is a handful of comparisons per message | **Keep — and consider _retiring_ S04**: the concern is disproven         |
| occasional `_max` in 8–32                                                                                                                                 | spikes, not sustained                           | keep as is; leave the signal on                                          |
| `_max` ≥ 32 in ≳ 1 % of webview sessions, **or** average (`_sum / _count`) ≥ 8 sustained — especially if `dispatch`/window is also high (heavy streaming) | genuine, sustained fan-out                      | **Revisit**: build the single-listener + `Map<id, observer>` multiplexer |

The signal is designed as much to **retire** S04 as to trigger work: if peak `N`
stays tiny across the fleet (the expected outcome for interactive webviews), we
close S04 permanently instead of carrying it as a perennial "maybe." Keep the
event cheap — it is a gauge sample, so do **not** `suppressIfSuccessful` (we need
the successful samples), and let the 20-call / 30-second batching keep the volume
negligible.

## R766-N06 — create-or-reveal (unchanged)

> ✅ **Documented in Iteration 2** [R766-N06]. Added a "Create-or-reveal
> (single-instance panels)" section to ADVANCED.md showing the consumer-side
> `Map<key, controller>` + `revealToForeground()` + `onDisposed()` eviction
> pattern. No package code — the registry stays in consumer space, per the
> recommendation below.

No change from the first pass: **document** the create-or-reveal pattern in
ADVANCED.md rather than building a panel registry into the package. Revisit only
if multiple consumers reimplement it. Keeping the package lean is more aligned
with its stated scope than owning panel-lifecycle state.

# Iteration 3 — event-observer isolation (R766-N05)

Added 2026-07-05. This chapter records the one item Iteration 2 deferred: the
implementation of **R766-N05**. Interim edits had folded it into the Iteration 2
protocol; it is a distinct pass and is documented here as its own iteration.

## What shipped

R766-N05 bundled a **correctness fix** and a **visibility hook**; Iteration 3
shipped them together, adopting **option 1** from the
[R766-N05 option analysis](#r766-n05--options-to-make-observer-exceptions-visible-to-telemetry).

- **Always-on isolation (correctness).** `createEventChannel` now wraps every
  `onSuccess` / `onError` / `onAborted` observer so a throwing observer can no
  longer break the tRPC call it was only _observing_. This upholds the
  observer-only contract regardless of consumer configuration — it is not opt-in.
- **Opt-in `onObserverError` sink (visibility).** The isolated error is routed to
  an `onObserverError(error, { info, phase })` sink that **defaults to
  `console.error`**, threaded through `connectTrpc` and the React
  `WithWebviewContext` / hooks. Beyond that console default the happy path stays
  quiet — a generic consumer is not opted into telemetry or events it may not
  want.
- **DocumentDB opts in for itself.**
  [`reportObserverError`](../../../../../../src/webviews/_integration/observability/reportObserverError.ts)
  keeps the structured `console.error` (path + phase) and additionally elevates
  the error to the webview's browser `reportError()` global — the "general
  observability" of option 5 — without re-entering the tRPC channel, so a throwing
  observer cannot cause a report loop.

## Change protocol (2026-07-05)

> Each change is an individual commit on `dev/tnaum/webview-api-refinements`,
> pushed and acknowledged with a PR comment. No Copilot review thread applied
> (R766-N05 was a Reviewer-2 finding, not a Copilot one).

**Post-change validation (all green):** `prettier` (applied) · `eslint --quiet`
(clean) · `jest` (2661 passed / 159 suites) · `tsc` build across all workspaces
(clean).

| Commit     | What changed                                                                                                                                                                                                                                                                    | Why (motivation)                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `76227034` | `createEventChannel` isolates throwing observers and routes them to an `onObserverError` sink (default `console.error`); threaded through `connectTrpc` and `WithWebviewContext` / the hooks; adds `ObserverErrorPhase` / `ObserverErrorContext` / `ObserverErrorHandler` types | A throwing observer previously broke the tRPC call it observed. Option 1: an always-on correctness fix plus an opt-in structured sink. |
| `559a9af1` | Recorded the R766-N05 implementation in this review doc                                                                                                                                                                                                                         | Traceability.                                                                                                                          |
| `f7c96564` | `reportObserverError` calls the typed `globalThis.reportError` behind a `typeof` guard instead of a `(globalThis as { reportError?: … })` cast                                                                                                                                  | `reportError` is declared in `lib.dom` (the webview tsconfig includes `dom`), so the cast was unnecessary. No behavior change.         |

## `reportError` naming: the DOM global, not the app-router mutation

DocumentDB's app router also exposes a `reportError` **tRPC mutation** (webview →
host telemetry). The sink's `globalThis.reportError` is the unrelated **browser
DOM global** ([`reportError()`](https://developer.mozilla.org/docs/Web/API/reportError),
which dispatches an `ErrorEvent` on `window`). The shared name is a coincidence:
the sink never calls the tRPC mutation, which is exactly why it is loop-safe —
elevating an observer error to the DOM error stream cannot re-enter the tRPC event
channel that produced it.

## Deferred: routing observer errors to host telemetry

If DocumentDB later wants observer errors in **host** telemetry (not just the DOM
error stream), the route is the app router's `reportEvent` / `reportError`
mutation, but it needs two guards:

- **Path-guard against recursion.** Sending an observer error through a tRPC
  mutation re-enters the same event channel; if that mutation's own observer
  throws, it loops. Skip the `reportEvent` / `reportError` paths, or use a
  separate, un-observed client whose links are `vscodeLink` only (no `eventLink`).
- **Dedupe / throttle.** Key on `path|phase|message` so a hot, repeatedly-throwing
  observer cannot flood telemetry.

This is intentionally **not** implemented; the console + `reportError()` sink is
the current floor.

# Iteration 4 — Copilot reviewer feedback (2026-07-05)

Added 2026-07-05. On this date the GitHub Copilot PR reviewer ran a second
automated pass (review `4630986353`): it reviewed 92 of 99 changed files and left
**3 inline comments** plus **1 low-confidence comment it self-suppressed**. This
chapter captures each, assigns a tracking ID (`R766-Cnn`, `C` for Copilot-sourced),
and analyzes the options. **All four items were implemented in this iteration**
(change protocol below); the per-finding analyses are retained as the rationale.

## Overview

| ID       | Source                                                                                                          | Sev. | Title                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| R766-C01 | [`telemetryMiddlewareBody`](../../../../../../packages/vscode-ext-webview/src/host/middleware/telemetry.ts#L119-L153) | Low  | Telemetry middleware records error details for aborted calls        |
| R766-C02 | [`documentDbTelemetryRunner`](../../../../../../src/webviews/_integration/trpc.ts#L90-L118)                           | Low  | DocumentDB runner overwrites error fields for canceled ops          |
| R766-C03 | [`connectTrpc.onReceive`](../../../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L109-L123)         | Low  | Webview `onReceive` guard accepts any `id` (prototype / non-string) |
| R766-C04 | [`useTrpcClient`](../../../../../../src/webviews/_integration/useTrpcClient.ts#L18-L20)                               | Info | `useTrpcClient` wrapper lacks an explicit return type (suppressed)  |

**Themes.** C01 + C02 are the same defect on two layers — canceled operations get
tagged with error fields — and must be fixed together (C02 would otherwise undo
C01). C03 tightens a guard shipped in Iteration 2 (R766-N01) so the webview edge
matches the host. C04 is a typing nicety that aligns with this repo's own "always
specify return types" rule.

## Iteration 4 — change protocol (2026-07-05)

> Each fix is an individual commit on `dev/tnaum/webview-api-refinements`, pushed
> and acknowledged on the PR — a reply on the originating Copilot review thread
> (C01–C03, all resolved) or a general comment (C04, which had no thread). C01 and
> C02 shipped in one commit because C02's enrichment would otherwise undo C01.

**Post-change validation (all green):** `npm run l10n` (no drift) · `prettier`
(clean) · `eslint --quiet` (clean) · `jest` (2662 passed / 159 suites) · `tsc`
build across all workspaces (clean).

| ID       | Commit     | What changed                                                                                                                                          | Why (motivation)                                                                                                                                                                     |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R766-C01 | `553bf4e8` | `telemetryMiddlewareBody` gates the whole error-recording block on `!aborted`; `getInvocationSignal` is exported from `./host`; regression test added | An aborted call that surfaced as a rejected result was tagged `Canceled` yet still stamped `error` / `errorMessage`, so a cancellation looked like a failure on the error dimension. |
| R766-C02 | `553bf4e8` | `documentDbTelemetryRunner` reads `getInvocationSignal` and skips its `parseError` enrichment when the call was aborted                               | The enrichment ran after the body on the same telemetry bag and re-stamped `error*` for canceled ops, undoing C01. Shipped in the same commit.                                       |
| R766-C03 | `3301a709` | Shared `isTransportResponseMessage` guard (own string `id`) in `wireProtocol.ts`, used by `connectTrpc`'s `onReceive`; the R766-N01 test was extended | The webview guard forwarded any object with an `id` (inherited or non-string) — looser than the host guard; tightened for host/webview symmetry.                                     |
| R766-C04 | `19b99cbf` | `useTrpcClient` wrapper return type annotated as `TrpcClient<AppRouter>`                                                                              | Locks the public surface / avoids type widening and matches the repo's explicit-return-type rule (Copilot's suppressed low-confidence note).                                         |

## R766-C01 — telemetry middleware records error details for aborted calls

> ✅ **Implemented in Iteration 4** [R766-C01] (option A). `telemetryMiddlewareBody`
> now gates the whole error-recording block on `!aborted`, so an aborted call is
> recorded only as `Canceled` (with `aborted='true'`) and never carries `error` /
> `errorMessage`. A regression test drives an aborted invocation that also throws
> and asserts no `error*` fields are stamped. The analysis below is retained as the
> rationale.

**Copilot:** `telemetryMiddlewareBody` records `error` / `errorMessage` even when
the invocation was aborted, which makes canceled operations look like failures and
contradicts the nearby "recorded as `Canceled`" comment. Only record error details
when `!aborted`.

**Current state — the classification is already correct; the error _fields_ are
not.**
[`telemetryMiddlewareBody`](../../../../../../packages/vscode-ext-webview/src/host/middleware/telemetry.ts#L119-L153)
sets `result = 'Failed'` only when `!aborted`, so an aborted call is already
labeled `Canceled`. What still leaks is the error **name and message**, because
that block sits under `if (!result.ok)` but not under `if (!aborted)`:

```ts
if (aborted) {
  telemetry.properties.aborted = 'true';
  telemetry.properties.result = 'Canceled';
}
if (!result.ok) {
  if (!aborted) {
    telemetry.properties.result = 'Failed';
  }
  if (result.error?.name) telemetry.properties.error = result.error.name; // ← still runs when aborted
  if (result.error?.message) telemetry.properties.errorMessage = result.error.message; // ← still runs when aborted
}
```

A cancellation that surfaces as a rejected result (the awaited work throws an
`AbortError` when the signal fires) is therefore tagged `result=Canceled` **and**
`error=AbortError` — indistinguishable from a real failure on the error dimension.

**Options.**

- **Option A — move the two `error*` writes under `!aborted`.** Aborted calls then
  record only `result=Canceled` + `aborted=true`. Minimal, matches Copilot, and
  matches the existing `result` handling. _Con:_ if an operation is aborted **and**
  fails for an unrelated reason (a genuine bug racing with cancellation), the error
  name is dropped.
- **Option B — record the aborted error under a distinct key** (e.g.
  `properties.abortError`), keeping a breadcrumb without polluting the primary
  `error` dimension used for failure analytics. _Con:_ one more property to define
  and document.
- **Option C — suppress only the cancellation error itself** — record error details
  unless the error _is_ the abort (`error.name === 'AbortError'` / matches the abort
  cause). Most precise, but the generic middleware would have to recognize a
  cancellation error shape, which varies by producer.

**Recommendation: Option A in the package.** Smallest change, restores the
`Canceled` contract, and keeps the generic middleware free of error-shape
heuristics (Option C is really consumer policy). Ship it in the **same commit as
C02**.

## R766-C02 — DocumentDB runner overwrites error fields for canceled ops

> ✅ **Implemented in Iteration 4** [R766-C02] (option B). `getInvocationSignal` is
> now exported from `@microsoft/vscode-ext-webview/host`, and
> `documentDbTelemetryRunner` reads it to skip its `parseError` enrichment (`error`
> / `errorMessage` / `errorStack` / `errorCause`) when the call was aborted — so it
> no longer undoes R766-C01. Shipped in the same commit as C01. The analysis below
> is retained as the rationale.

**Copilot:** `documentDbTelemetryRunner` enriches and **overwrites** telemetry
error fields for any `!result.ok`, even when canceled; guard the enrichment when
`invocation.ctx.signal?.aborted` is true.

**Why this pairs with C01 (and why C01 alone is not enough).** The runner's
enrichment runs _after_ the middleware body, on the **same** telemetry bag
([`documentDbTelemetryRunner`](../../../../../../src/webviews/_integration/trpc.ts#L90-L118)):

```ts
const result = await execute(context.telemetry as …); // the body runs here (C01)
if (!result.ok && result.error) {
    // ← no abort check
    const parsed = parseError(result.error);
    context.telemetry.properties.error = parsed.errorType; // re-stamps, overwriting C01
    context.telemetry.properties.errorMessage = parsed.message;
    context.telemetry.properties.errorStack = (result.error as { stack?: string }).stack ?? '';
    if (result.error.cause) context.telemetry.properties.errorCause = parseError(result.error.cause).message;
}
```

Even after C01 stops the body from writing `error*` on an aborted call, this block
**re-stamps** `error`, `errorMessage`, `errorStack`, and `errorCause`. A C01-only
fix is silently undone for DocumentDB, so the two must land together.

**Options for reading the abort state.**

- **Option A — inline read.**
  `const aborted = (invocation.ctx as { signal?: AbortSignal }).signal?.aborted ?? false;`
  then gate the block with `&& !aborted`. Zero new public surface. _Con:_
  duplicates the abort-reading logic the package already has, so the two can drift.
- **Option B — export and reuse `getInvocationSignal`.** The package has
  [`getInvocationSignal(ctx)`](../../../../../../packages/vscode-ext-webview/src/host/middleware/types.ts#L68-L70)
  but does not export it from `./host`. Export it and call
  `getInvocationSignal(invocation.ctx)?.aborted`, so body and runner share one
  abort check. _Con:_ a small public-API addition.
- **Option C — reuse the body's decision.** The body already wrote
  `result === 'Canceled'`; the runner could skip enrichment when that is set.
  _Con:_ couples the consumer to a magic string and to ordering; brittle.

**Recommendation: Option B** — export `getInvocationSignal` and gate the whole
enrichment block (including `errorStack` / `errorCause`) on `!aborted`, so both
telemetry layers read the abort state from one helper and cannot drift. Option A
is an acceptable zero-surface fallback. Land with C01, with a test asserting an
aborted call records `result=Canceled` and **no** `error*` fields.

## R766-C03 — tighten the webview `onReceive` guard to an own, string `id`

> ✅ **Implemented in Iteration 4** [R766-C03] (option C). Added a shared
> `isTransportResponseMessage` guard to `shared/wireProtocol.ts` (non-null object
> with its **own** string `id`, via `Object.hasOwn` + `typeof`), mirroring the
> host-side `isTransportRequestMessage`, and `connectTrpc`'s `onReceive` now uses
> it. The R766-N01 test was extended with a numeric-`id` case and an
> inherited-`id` case (whose `id` equals the pending request id, so the old
> `'id' in data` guard would have wrongly resolved the query with `undefined`).
> The analysis below is retained as the rationale.

**Copilot:** the `onReceive` window-message guard forwards any object with an `id`
property (including prototype properties) into the tRPC response path; require an
**own** `id` field with a **string** value.

**Context — this refines R766-N01.** Iteration 2 added the webview-side guard;
Copilot notes it is looser than its host-side sibling:

```ts
// webview — connectTrpc.onReceive (R766-N01, shipped)
if (data !== null && typeof data === 'object' && 'id' in data) {
  /* … */
}
// host — isTransportRequestMessage (R766-01) already checks the TYPE
typeof (message as { id?: unknown }).id === 'string'; /* …plus op shape… */
```

[`VsCodeLinkResponseMessage.id`](../../../../../../packages/vscode-ext-webview/src/shared/wireProtocol.ts#L51-L64)
is typed `string`, yet `'id' in data` is true for an **inherited** `id` and never
checks the **value type** — so the webview edge is weaker than both the wire type
and the
[host guard](../../../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L134-L149).

**Options.**

- **Option A — minimal type tightening.** Replace `'id' in data` with
  `typeof (data as { id?: unknown }).id === 'string'`. Rejects non-string and
  missing ids (a missing prop reads `undefined`), matches the host guard's rigor,
  one line. _Con:_ an inherited **string** `id` would still pass — contrived for
  structured-clone'd `postMessage` data.
- **Option B — own + string (Copilot verbatim).**
  `Object.hasOwn(data, 'id') && typeof (data as { id: unknown }).id === 'string'`.
  `Object.hasOwn` is available (tsconfig `lib` is ES2023). Most defensive; handles
  the prototype case explicitly.
- **Option C — a shared `isTransportResponseMessage` guard** in
  `shared/wireProtocol.ts`, mirroring `isTransportRequestMessage`, called from
  `onReceive`. Best symmetry and a single source of truth for the response shape.
  Keep it to "own string `id`"; do **not** also require `result` / `error` /
  `complete` (a bare `{ id, complete }` ack is valid), which would over-tighten.

**Recommendation: Option C** using Option B's "own string `id`" predicate — it
restores host/webview symmetry (each edge validates through one structural guard)
and gives the response shape a home. If minimizing churn is preferred, **Option B
inline** is a faithful one-liner. Either way, extend the R766-N01 test with
inherited-`id` and numeric-`id` cases. Resolves the Copilot thread on
`connectTrpc.ts`.

## R766-C04 — explicit return type on the `useTrpcClient` wrapper (suppressed)

> ✅ **Implemented in Iteration 4** [R766-C04] (option A). The DocumentDB wrapper
> now declares its return type as `TrpcClient<AppRouter>` (imported from
> `@microsoft/vscode-ext-webview/react`), locking the public surface and matching
> the repo's "always specify return types" rule. The analysis below is retained as
> the rationale.

**Copilot (self-suppressed, low confidence):** giving the shared `useTrpcClient`
helper an explicit return type makes the public surface clearer and avoids
accidental type widening if the framework hook signature changes.

Copilot suppressed this itself, but it matches this repo's TypeScript guideline
("**Always specify return types** for functions"). The wrapper
([`useTrpcClient`](../../../../../../src/webviews/_integration/useTrpcClient.ts#L18-L20))
is a one-line pass-through with an inferred return.

**Options.**

- **Option A — name the concrete type.** Annotate the return as the framework
  client type (e.g. `TRPCClient<AppRouter>` / whatever the framework hook returns).
  Explicit, locks the public surface, honors the repo rule. _Con:_ couples to the
  framework client type name; needs an import.
- **Option B — `ReturnType<typeof useFrameworkTrpcClient<AppRouter>>`.** Always
  tracks the source, but reads awkwardly and still depends on the generic-call
  syntax.
- **Option C — leave inferred.** Accept the self-suppression: a one-line
  pass-through has a stable inferred type. _Con:_ diverges from the repo's
  explicit-return-type convention.

**Recommendation: Option A** — a one-line annotation that satisfies the repo
convention and the reviewer's intent. **Low priority**; batch with C03 (same
webview area) or take standalone.

## Suggested batching

- **Batch 1 — cancellation telemetry (C01 + C02), one commit.** Gate error
  recording on `!aborted` in the package body _and_ the DocumentDB runner (export
  `getInvocationSignal` for a shared check); add a test asserting an aborted call
  records `result=Canceled` with no `error*` fields. Resolves both telemetry
  comments.
- **Batch 2 — transport-guard symmetry (C03).** Own string `id` (ideally a shared
  `isTransportResponseMessage`); extend the R766-N01 test. Resolves the
  `connectTrpc.ts` comment.
- **Batch 3 — typing nicety (C04), optional / low priority.** Explicit return type
  on `useTrpcClient`.

Each batch was shipped under the established protocol: one commit on
`dev/tnaum/webview-api-refinements`, pushed, with a PR acknowledgment referencing
the SHA (and, for C01–C03, resolving the Copilot thread).

## Iteration 4 — done

All four Copilot findings from the 2026-07-05 review (`4630986353`) are
implemented, verified, and acknowledged on the PR. Steps performed:

1. **Triaged** the review into R766-C01–C04 with options and recommendations (this
   chapter).
2. **Batch 1 — C01 + C02** (`553bf4e8`): gated the telemetry body's error recording
   on `!aborted`, exported `getInvocationSignal`, and made `documentDbTelemetryRunner`
   skip its enrichment when aborted; added a package regression test. Replied to and
   resolved the C01 and C02 Copilot threads.
3. **Batch 2 — C03** (`3301a709`): added the shared `isTransportResponseMessage` guard
   (own string `id`) and wired it into `connectTrpc`'s `onReceive`; extended the
   R766-N01 test with numeric-`id` / inherited-`id` cases. Replied to and resolved the
   C03 Copilot thread.
4. **Batch 3 — C04** (`19b99cbf`): annotated the `useTrpcClient` wrapper return type as
   `TrpcClient<AppRouter>`. No thread (self-suppressed); covered by the wrap-up PR
   comment.
5. **Finalized** the doc (`cb9cd3b2`): the change protocol above plus statuses.
6. **Validated — all green:** `npm run l10n` (no drift) · `prettier` · `eslint --quiet`
   · `jest` (2662 passed / 159 suites) · `tsc` build across all workspaces.

✅ **Iteration 4 is complete.** The three inline Copilot threads (C01 / C02 / C03)
are resolved, C04 (suppressed) is addressed, and the PR branch is green — nothing
from the 2026-07-05 review remains open.

# Iteration 5 — consumer ergonomics & onboarding (2026-07-05)

Added 2026-07-05. Iterations 1–4 focused mostly on correctness, guardrails, and
review-thread cleanup. This pass steps back and asks a different question: once
this package works, how easy is it for a first-time consumer or a coding agent to
adopt it correctly with the least possible boilerplate?

## Overview

| ID       | Severity | Title                                                           | Why it matters                                                                                                                                |
| -------- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R766-E01 | Medium   | Greenfield adoption still requires too many moving parts        | New consumers must connect router, context, config, and render bootstrap by hand, even though the package's pitch is “make webview RPC easy.” |
| R766-E02 | Low      | `viewType` is duplicated across host and webview registration   | The same string must be kept in sync in two places, which is easy to get wrong and hard to debug when it drifts.                              |
| R766-E03 | Low      | The common bootstrap still feels more ceremonial than it should | The happy path is correct, but it still asks the consumer to thread `vscodeApi` and the render entrypoint together by hand.                   |

## R766-E01 — the greenfield path still feels “wiring-heavy” for a first-time consumer

> ✅ **Decision (2026-07-05): Option B — document the pattern, do not add a helper
> to the library.** The pattern E01 asks for already exists in consumer space as
> DocumentDB's [`openAppWebview`](../../../../../../src/webviews/_integration/openAppWebview.ts)
> (a ~15-line preset that binds the fixed wiring — `router`, `trpc`,
> `sourceLayout`, `logger` — so each per-view factory states only what is unique
> to its view). It is a proven reference implementation of E01 Option A, but kept
> where it belongs: in the consumer, not the transport package. **Action:**
> document the `openAppWebview`-style "integration preset" pattern in ADVANCED.md
> (alongside the create-or-reveal pattern from R766-N06) so new consumers can copy
> it, and **do not** ship a `createWebviewApp` / `createWebviewController` helper
> in the package. This keeps the package a lean transport library, consistent with
> the R766-N06 decision to keep panel-registry state in consumer space. The
> `trpc`/`router` mismatch footgun — the only _sharp_ edge on this path — was
> already removed in R766-N02.

The package already has a good one-call front door, but the current happy path
still asks a consumer to connect several concepts that are logically part of a
single feature:

1. define the router and the typed `trpc` instance;
2. pass `router` + `trpc` (plus context, config, and source layout) into
   `openWebview`;
3. register the same `viewType` in the webview render registry;
4. wrap the webview root with `WithWebviewContext` and then call
   `useTrpcClient` / `useConfiguration`.

That is not a bug, but it is still a noticeable amount of “framework plumbing”
for a package whose pitch is to make webview RPC easy. The cost is not in the
API shape itself; it is in the number of steps a new consumer or coding agent
has to remember in order to make the package work end to end.

**Options**

- **A — add a small higher-level helper** such as `createWebviewApp`,
  `createWebviewController`, or `createWebviewBootstrap` that takes the router,
  context, config, and component registry and wires the host-side panel plus the
  webview bootstrap in one place.
- **B — keep the current primitives and add a single copy-paste “minimal full
  example”** to the README / ADVANCED.md with the host and webview side in one
  file.
- **C — leave the current shape and rely on the starter kit.**

**Recommendation:** Option A if the goal is to make the preview package feel
truly beginner-friendly; Option B is the low-risk immediate step. The package
already has the right primitives, but the “glue” between them is still too
manual for a first-time consumer.

## R766-E02 — `viewType` is a shared key, but the package does not help keep it in sync

> ✅ **Decision (2026-07-05): non-issue — no action.** DocumentDB already solves
> this at compile time: [`WebviewRegistry`](../../../../../../src/webviews/_integration/WebviewRegistry.ts)
> derives `type WebviewName = keyof typeof WebviewRegistry`, and both the host
> (`openAppWebview` / `OpenAppWebviewOptions.webviewName`) and the webview
> (`render(key, …)` in [index.tsx](../../../../../../src/webviews/index.tsx)) are typed
> to that union — so a drifted / mistyped `viewType` is a **compile error**, not a
> blank panel. The coupling E02 worries about is already enforced by the type
> system in the reference consumer. Nothing to do in the package; the
> registry-as-single-source-of-truth pattern is covered by the E01 documentation
> action above.

The host-side `openWebview` call and the webview-side `render(viewType, vscodeApi)`
registry both depend on the same `viewType` string. That is the right design (the
string is the feature’s identity), but it is also one of the easiest things for a
new consumer to get wrong. A drift between the two means the wrong component
renders or nothing renders at all, and the debugging cost is high because the
failure is indirect.

**Options**

- **A — provide a tiny helper** that registers a component and binds a local
  `viewType` in one place, rather than leaving the string as an external
  convention.
- **B — document a single-source-of-truth pattern** in the README and the
  starter kit (for example, centralize the map in one module and import it from
  both sides).
- **C — leave it as-is.**

**Recommendation:** Option B right away, Option A if the package wants to make
this path feel more guided. The issue is not the concept of `viewType`; it is
that the package currently makes the consumer remember the coupling rather than
helping them preserve it.

## R766-E03 — the common bootstrap still feels more ceremonial than it should

> ✅ **Decision (2026-07-05): no work to be done.** The webview bootstrap is
> already a single shared `render(key, vscodeApi)` entrypoint
> ([index.tsx](../../../../../../src/webviews/index.tsx)) that looks up the component in
> `WebviewRegistry` and wraps it in `WithWebviewContext` once; per-view code adds
> nothing to the bootstrap. Making `WithWebviewContext` default to
> `acquireVsCodeApi()` was considered and rejected: passing `vscodeApi` explicitly
> keeps the singleton `acquireVsCodeApi()` call in the consumer's control (it can
> only be called once per webview) and keeps the provider testable. The residual
> ceremony is minimal and intentional. No change.

The webview side is already straightforward, but the current bootstrap still asks
the consumer to thread `vscodeApi` through `WithWebviewContext` explicitly and to
keep the `render(viewType, vscodeApi)` entrypoint and the React root in sync.
That is not a blocker, but it is the sort of ceremony that makes a package feel
less “just works” than the README promises.

**Options**

- **A — provide a small helper** such as `bootstrapWebviewApp({ registry,
getVscodeApi })` or an overload of `WithWebviewContext` that defaults to
  `acquireVsCodeApi()` when no prop is provided.
- **B — keep the explicit API and document the common bootstrap pattern more
  fully.**
- **C — leave it as-is and rely on the starter kit.**

**Recommendation:** Option A or B depending on how much the package wants to own
the webview bootstrap. The current API is flexible, but the happy path still has
a little more glue than a new consumer would expect.

## Decisions summary

| ID       | Severity | Decision (2026-07-05)                                                       | Action                                                                                         |
| -------- | -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R766-E01 | Medium   | **Option B** — document the pattern; do **not** add a helper to the library | Document the `openAppWebview`-style integration-preset pattern in ADVANCED.md; no package code |
| R766-E02 | Low      | **Non-issue** — already enforced at compile time by `WebviewRegistry`       | No action (covered by the E01 registry-pattern documentation)                                  |
| R766-E03 | Low      | **No work** — the shared `render(...)` bootstrap is already minimal         | No change                                                                                      |

The common thread: the DocumentDB consumer already implements every ergonomics
win E01–E03 reach for (`openAppWebview` as the integration preset, `WebviewRegistry`
as the typed `viewType` source of truth, a single `render` bootstrap), so the
correct move is to **document those consumer-side patterns**, not to grow the
transport package's API surface. This keeps the package lean and is consistent
with the R766-N06 decision to keep panel-registry state in consumer space.

## Iteration 5 — done

The review has a second pass focused on adoption rather than correctness, and all
three findings are decided:

- **R766-E01 — Option B (docs only).** The `openAppWebview` integration-preset
  pattern is the reference implementation; document it in ADVANCED.md rather than
  shipping a `createWebviewApp` helper. The only sharp edge on this path (the
  `trpc`/`router` mismatch) was already removed in R766-N02.
- **R766-E02 — non-issue.** `WebviewRegistry` + the `WebviewName` union already
  make a drifted `viewType` a compile error in the reference consumer.
- **R766-E03 — no work.** The shared `render(key, vscodeApi)` bootstrap is already
  minimal; the explicit `vscodeApi` hand-off is intentional.

Net: **one documentation action** (the E01 integration-preset pattern in
ADVANCED.md, which also covers E02's registry pattern) and **no new package API**.

## Iteration 6 — change protocol (2026-07-05)

> This iteration fixes a **runtime regression** found while dogfooding the
> migrated extension: opening a webview (e.g. the collection view) rendered the
> panel chrome but never loaded the web app. The extension host reported the RPC
> command succeeding, but the webview devtools showed
> `localhost:18080/index.js` returning **404**.

**Root cause (R766-07).** The redesigned `WebviewController` chose the
bundled-vs-dev source layout from `extensionContext.extensionMode === Production`.
The old package chose it from a dedicated `isBundled` option that the consumer
fed from `ext.isBundle` (the webpack `IS_BUNDLE` define). Those are different
axes: the normal F5 dev flow runs a **webpack bundle** (`IS_BUNDLE=true`) in
**Development** mode with `DEVSERVER=true`. The webpack dev server (`webpack
serve`) emits the *bundled* asset name (`views.js`, from `entry: { views }`), so
keying the layout off the mode picked the `dev` (tsc) file `index.js` and
requested `http://localhost:18080/index.js`, which the dev server does not serve
(confirmed: `/views.js` → 200, `/index.js` → 404). The result was a blank
webview with no extension-host output.

**Post-change validation (all green):** `prettier` (no drift) · `eslint --quiet`
(clean) · `jest` (full suite, 2664 passed / 159 suites) · `tsc` build across all
workspaces (clean). No user-facing strings changed, so `l10n` was skipped.

| ID       | Commit     | What changed                                                                                                                                             | Why (motivation)                                                                                                                                                                                                            |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R766-07  | `2c2e4f30` | `WebviewController` selects the source layout from a **required** `isBundled` option (restored from the old package); `extensionMode` stays CSP-only. The DocumentDB consumer passes `isBundled: !!ext.isBundle`. Docs + 3 regression tests added. | Keying the layout off `extensionMode` 404'd the dev-server script in the standard bundled-development flow. Bundle-ness (which asset name) and production-ness (CSP hardening) are independent; conflating them broke local dev. |

## Iteration 7 — reference-implementation tidy-up (2026-07-05)

> Iteration 5 declared the `_integration` folder the **reference implementation**
> for adopting the package. Iteration 7 acts on that: the folder had grown to a
> flat list where the newer observability adapters were easy to miss and the
> folder README had fallen behind. This is documentation-and-layout only; no
> package API and no runtime behavior change.

**Findings and actions:**

- **R766-I01 — group the observability sinks.** The flat folder mixed the
  router/transport wiring (`configuration`, `trpc`, `appRouter`,
  `openAppWebview`, `WebviewRegistry`, `useTrpcClient`) with two cross-cutting
  observability adapters (`rpcConcurrencyLogger`, host; `reportObserverError`,
  webview) and their tests. Moved the two adapters and their tests into a new
  `observability/` subfolder (via `git mv`, history preserved) and fixed the
  relative imports and the two external importers (`openAppWebview.ts`,
  `src/webviews/index.tsx`).
- **R766-I02 — README lagged the surface.** The `_integration/README.md` file
  table pre-dated the observability adapters and never listed them. Added the
  `observability/` row to the file table and two rows to the "When you want to X"
  map, refreshed the closing note, and added a dedicated
  `observability/README.md` describing each file, its side (host/webview), and
  where it is wired.
- **R766-I03 — comments.** Confirmed the moved files keep their thorough
  header comments (the R766-S04 / R766-N05 rationale) and that the reorg did not
  strand any doc cross-reference.

**Post-change validation (all green):** `prettier` · `eslint --quiet` · `jest`
(full suite) · `tsc` build. No user-facing strings, so `l10n` skipped.

| ID       | What changed                                                                                                                                  | Why (motivation)                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R766-I01 | New `_integration/observability/` subfolder holds `rpcConcurrencyLogger` + `reportObserverError` (and tests); imports/importers updated       | A flat folder buried the two cross-cutting sinks among the router/transport wiring; grouping them makes the reference layout easier to scan. |
| R766-I02 | `_integration/README.md` now lists every file including the observability subfolder; added `observability/README.md`                          | The folder README is the on-ramp for adopters and coding agents; it must describe what each file does, and the newer sinks were missing.   |

---

# Iteration 8 — latency & load-time analysis (2026-07-06)

> This iteration is an **analysis pass**, not a code change. The question posed:
> does this PR introduce any latency or load-time degradation in webview
> rendering and message processing — especially the time to open a webview —
> through new loops, extra steps, or lookup abstractions that individually look
> cheap but add up? Findings below; no files were modified in this iteration.

## Method

Traced the full webview lifecycle end to end and diffed each stage against
`main`:

- **Open/load path:** panel creation → `getDocumentTemplate` HTML →
  webview boot script → React mount → client bootstrap.
- **Message path:** webview `client.*` call → link chain → `postMessage` →
  host dispatch pump (`attachTrpc`) → procedure → response → per-op logging.

Compared against the pre-PR implementations: `WebviewController.ts` and
`useTrpcClient.ts` from `packages/vscode-ext-react-webview` (both removed by this
PR).

## Findings

### Load time (opening a webview) — neutral to slightly *better*

- **R766-P01 (improvement) — client is now a per-webview singleton.** The old
  `useTrpcClient` built a **separate** tRPC client per React component (`useMemo`
  per component, each with its own link chain and its own per-operation `window`
  `message` listeners). The new `getWebviewConnection`
  (`react/connection.ts`) memoizes one `{ client, events }` per `vscodeApi` in a
  `WeakMap`, so every component shares one client. Fewer clients, fewer link
  chains, fewer listeners established at mount. Net reduction in load-time setup.
- **R766-P02 (improvement) — `loggerLink` dropped from the default chain.** The
  old client unconditionally prepended tRPC's `loggerLink()` (per-op console
  logging + an extra observable wrapper on every call). The new `connectTrpc`
  makes it opt-in (`options.logger`) and substitutes the lighter `eventLink`.
- **R766-P03 (info, one-time) — inert JSON block adds a bounded boot cost.**
  `getDocumentTemplate` → `serializeInertJson` makes 3 linear regex passes over
  the serialized `{ config + l10n bundle + viewType }`, and the boot script does
  one extra `JSON.parse` of that wrapper (R766-N03 hardening). The l10n bundle
  can be tens of KB, but this is sub-millisecond and runs **once per open**. Not
  a concern.
- **R766-P04 (info) — controllers refactored class→factory with no added work.**
  `openCollectionWebview` / `openDocumentWebview` do the same settings reads and
  config assembly as the former `WebviewControllerBase` subclasses.

The panel-creation core (`createWebviewPanel` → set `html` → attach one message
listener) is unchanged in cost.

### Message processing — one genuine new per-RPC cost (host side)

- **R766-P05 (watch) — new host-side dispatch logger fires on every completed
  op.** The old `WebviewController.setupTrpc` had **no** per-operation logging.
  The new `attachTrpc` calls `logProcedure` on every completed query / mutation /
  subscription, and in production that logger is `rpcConcurrencyLogger`, which per
  op does:
  1. `consoleProcedureLogger.log(entry)` → a **`console.log` on every completed
     RPC** on the extension host (string-format cost + console noise);
  2. `callWithAccumulatingTelemetry(...)` → and although the telemetry **emit**
     is batched (20 calls / 30 s), `callWithAccumulatingTelemetry` invokes
     `callWithTelemetryAndErrorHandling` **on every call** — allocating an
     `IActionContext`, an async wrapper, error-handling setup, and `Object.entries`
     loops over measurements / properties / distributions. Batching suppresses the
     _emit_, not the wrapper machinery.

  Because procedures declared with `publicProcedureWithTelemetry` already run
  `callWithTelemetryAndErrorHandling` once via `telemetryMiddlewareBody`, a tracked
  RPC now pays **two** `callWithTelemetryAndErrorHandling` invocations per call
  (procedure middleware + dispatch logger) — roughly doubling the telemetry-wrapper
  overhead per RPC.

  **Mitigating facts:** the logger runs **after** `safePostMessage` posts the
  result (so it does not delay the response), and it is `void`-ed
  (fire-and-forget, does not block the handler's return). But its synchronous
  portion still runs on the host event loop per RPC, so under high-frequency RPC
  (grid paging, rapid scroll, many parallel queries) it competes with subsequent
  message processing. This is exactly the "individually cheap, adds up" case.

### Confirmed NOT regressions

- **R766-P06 — caller factory per operation.** `callerFactory(router)(opContext)`
  in `attachTrpc` existed identically in the old `WebviewController`. Not new.
- **R766-P07 — O(N) `window` listener fan-out per message** on the webview client
  (`vscodeLink`) is a **pre-existing** design, not introduced here. The R766-S04
  concurrency gauge exists precisely to decide (on evidence) whether it ever needs
  a single-listener multiplexer.
- **R766-P08 — structural transport guards** (`isTransportRequestMessage` /
  `isTransportResponseMessage`) are new but O(1) per message. Trivial.
- **R766-P09 — `eventLink` always in the chain** replaces the previously
  always-on `loggerLink`; net neutral (and `eventLink` is lighter).

## Recommendation

The **load path is not degraded** — no new loops or heavy lookups when a webview
opens, and two changes (R766-P01, R766-P02) make it slightly cheaper. The single
recurring new cost is the **per-RPC dispatch logger** (R766-P05), which matters
only under high message volume. Two follow-ups worth considering (see the
in-chat discussion accompanying this iteration for full option analysis):

1. **Gate the per-op `console.log`** so it is dev/`ExtensionMode`-only; the
   concurrency telemetry is the real goal and does not need the console line in
   production.
2. **Cheaper concurrency sampling** that avoids running the full
   `callWithTelemetryAndErrorHandling` wrapper on every op (e.g. sample 1/N, or
   accumulate into a plain module-level counter and only enter the telemetry
   wrapper on flush) — a small redesign of `callWithAccumulatingTelemetry`'s
   per-call path.

### Decisions (2026-07-06)

- **Follow-up 2 — Option 1 selected, implemented in Iteration 10.** The chosen
  direction was to split the helper's cheap _accumulate_ path (pure in-memory
  arithmetic, no `IActionContext`, no `await`) from the heavy _flush_ path (the
  single `callWithTelemetryAndErrorHandling` that emits the rolled-up `dist_*`
  fields), migrating existing callers in the same change. This is the only option
  that makes the helper's per-call path match its "accumulating" promise, fixes the
  cost for every consumer, and keeps the concurrency gauge accurate (no sampling
  bias). Shipped as R766-P05b — see the [Iteration 10](#iteration-10--accumulating-telemetry-per-call-cost-2026-07-06) change protocol.
- **Follow-up 1 — resolved, implemented in Iteration 9.** Decided to gate the
  per-op console line on `extensionMode !== Production` inside the DocumentDB
  adapter (`rpcConcurrencyLogger`), leaving the framework's `consoleProcedureLogger`
  untouched as the neutral, opt-in sink. The rejected in-chat alternative
  (make `rpcConcurrencyLogger` a pure telemetry sink and rely purely on the
  opt-in `ProcedureLogger` seam for console output) was cleaner in the abstract,
  but the console line is a DocumentDB area of concern: keeping it automatic in
  dev/F5 (no manual wiring while debugging) and dead-code on a shipped build is
  the pragmatic fit. See the [Iteration 9](#iteration-9--console-gate-r766-p05-part-1-2026-07-06) change protocol.

| ID       | Finding                                                                    | Severity     | Disposition                                     |
| -------- | -------------------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| R766-P01 | Per-webview singleton client (was per-component)                           | Improvement  | Shipped by PR; no action                        |
| R766-P02 | `loggerLink` now opt-in (was always-on)                                    | Improvement  | Shipped by PR; no action                        |
| R766-P03 | Inert JSON block: 3 regex passes + 1 `JSON.parse` at boot                  | Info         | One-time, sub-ms; no action                     |
| R766-P04 | Controllers class→factory                                                  | Info         | No cost change; no action                       |
| R766-P05 | Per-op host dispatch logger (`console.log` + `callWithAccumulatingTelemetry`) | Watch     | Part 1 (console) ✅ Iteration 9; Part 2 (accumulate/flush) ✅ Iteration 10 |
| R766-P06 | Caller factory per op                                                      | Not a regression | Pre-existing; no action                     |
| R766-P07 | O(N) `window` listener fan-out per message                                 | Not a regression | Pre-existing; measured via R766-S04         |
| R766-P08 | New structural transport guards                                            | Not a regression | O(1) per message; no action                 |
| R766-P09 | `eventLink` always-on (replaces always-on `loggerLink`)                    | Not a regression | Net neutral; no action                      |

---

# Iteration 9 — console gate (R766-P05 part 1) (2026-07-06)

> Implements the first half of the R766-P05 follow-up from Iteration 8: stop the
> per-op `console.log` on the extension host from executing on shipped, installed
> builds, while keeping it automatic when debugging. The concurrency **telemetry**
> gauge is untouched and still records in every mode (production included). The
> heavier per-op telemetry-wrapper cost (part 2) is deferred to Iteration 10.

## What changed

- **R766-P05a — gate the console line on `extensionMode`.** In
  `rpcConcurrencyLogger.log`, the delegation to the framework's
  `consoleProcedureLogger.log(entry)` is now wrapped in
  `if (ext.context.extensionMode !== vscode.ExtensionMode.Production)`. Non-production
  modes (`Development` from F5 / "Run Extension", and `Test`) still emit the line;
  a packaged extension in `Production` never executes it (no string formatting, no
  host-console I/O). The mode is read **per call** — `ext.context` is always
  populated by the time an RPC fires (the webview is open ⇒ the extension has
  activated), and the comparison is O(1), so no module-load ordering risk and no
  measurable added cost.
- **Framework untouched.** `consoleProcedureLogger` in
  `@microsoft/vscode-ext-webview` stays the neutral, always-available opt-in sink.
  The gating decision lives entirely in the DocumentDB adapter, preserving the
  package/consumer boundary.
- **Tests.** `rpcConcurrencyLogger.test.ts` now stubs `ext.context.extensionMode`
  per case: existing "delegates to console + records gauge" and "no telemetry
  without a concurrent count" cases run under `Development`; added a `Test`-mode
  case (console still logs) and a **`Production`** case asserting the console line
  is **not** emitted while the concurrency gauge **is** still recorded.

## Why this shape

The console line is a DocumentDB area of concern (the adapter chose to include it),
so DocumentDB owns when it fires. Tying it to the local/production mode means the
maintainer keeps zero-friction console visibility while debugging and shipped users
never pay for it — matching how telemetry is already an opt-in, separate path.

## Post-change validation (all green)

`jest` (rpcConcurrencyLogger suite, 4/4) · `eslint` (both files, clean) ·
`tsc`/type-check (no errors) · `prettier` (unchanged — already formatted). No
user-facing strings, so `l10n` not required.

| ID        | What changed                                                                                          | Why (motivation)                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R766-P05a | `rpcConcurrencyLogger` gates `consoleProcedureLogger.log` behind `extensionMode !== Production`; tests cover both paths | The per-op host `console.log` is useful when debugging but dead weight on a shipped build; telemetry gauge stays on everywhere. |

---

# Iteration 10 — accumulating-telemetry per-call cost (2026-07-06)

> Implements the second half of the R766-P05 follow-up (Follow-up 2, Option 1
> selected in Iteration 8): the `callWithAccumulatingTelemetry` accumulate/flush
> split, so the per-call path is cheap in-memory work and the Azure telemetry
> pipeline is entered only on flush. This is the cost that ran in production (the
> concurrency gauge is meant to keep recording), so unlike the Iteration 9 console
> gate it is a real per-op saving on shipped builds.

## Problem restated

`callWithAccumulatingTelemetry` batched the telemetry **emit** (default 20 calls /
30 s) but still ran the full `callWithTelemetryAndErrorHandling` wrapper —
`IActionContext` allocation, error-handling wiring, `performance.now()`, three
`Object.entries` copy loops, an `await` — on **every** call. For a per-RPC caller
like `rpcConcurrencyLogger` (and every other high-frequency consumer) that per-call
machinery was the cost that adds up.

## What changed

- **R766-P05b — accumulate (cheap) / flush (heavy) split.** The per-call path now
  runs the populator synchronously against a plain `TelemetrySample` bag and folds
  the values into module-level batch totals. **No** `IActionContext`, **no**
  `await`, **no** `callWithTelemetryAndErrorHandling` on the happy path. The Azure
  pipeline is entered exactly once, on flush, with the rolled-up event.
- **Callback contract changed** from `(context: IActionContext) => T | PromiseLike<T>`
  (returning the value, `Promise<T | undefined>`) to
  `(sample: TelemetrySample) => void` (synchronous, `void` return). `TelemetrySample`
  is a plain `{ measurements; properties; distributions }` bag — this also retires
  the `TelemetryWithDistributions` cast (`distributions` is now a first-class field,
  no `ctx.telemetry as …`). Every existing call site already `void`-ed the result
  and used a synchronous callback, so no caller relied on the promise or the return
  value.
- **Populator-throw semantics preserved.** "Errors never accumulate": if the
  populator throws, the (partial) sample is discarded and the error is reported once
  through `callWithTelemetryAndErrorHandling` under the same `callbackId` — the only
  path that still pays the heavy wrapper cost, and it is rare.
- **Defensive finite guard added.** `accumulate` now skips non-finite numbers so a
  stray `NaN` / `Infinity` from a caller cannot poison a sum or a min/max reduction
  (the old code filtered on capture; the new bag is written directly, so the guard
  moved into `accumulate`).
- **Unchanged behavior:** auto-duration distribution (`auto_duration_ms`, now the
  populator's synchronous duration), `dist_*_min/max/sum/count` rollup keys,
  batch-size / `minFlushIntervalMs` throttle, `flushAccumulatingTelemetry`, flushed
  event name equals `callbackId`.

## Callers migrated (all direct `callWithAccumulatingTelemetry` sites + shorthand)

- `src/utils/callWithAccumulatingTelemetry.ts` — `meterSilentCatch` shorthand.
- `src/documentdb/ClustersExtension.ts` — `completion.accepted`.
- `src/documentdb/shell/DocumentDBShellPty.ts` — six completion / closing-bracket
  trackers.
- `src/webviews/documentdb/collectionView/collectionViewRouter.ts` — `completion.accepted.cv`.
- `src/webviews/_integration/observability/rpcConcurrencyLogger.ts` — the
  concurrency gauge (also drops the `TelemetryWithDistributions` cast).
- `meterSilentCatch` callers (schema store, mongo connection strings, playground
  evaluator, tree items, etc.) needed **no** change — they use the shorthand, whose
  signature is unchanged.

## Tests

- `callWithAccumulatingTelemetry.test.ts` — rewritten for the synchronous
  sample-bag API; added a **finite-guard** case and a **"per-call path never enters
  the telemetry pipeline, only flush does"** case (the redesign's core guarantee),
  and the error case now also asserts the throw is reported exactly once under the
  event id.
- `rpcConcurrencyLogger.test.ts` — the captured callback is now invoked with a
  sample bag directly instead of a `{ telemetry }` context stub.

## Docs / skills

- All doc comments in `callWithAccumulatingTelemetry.ts` updated to the sample-bag
  model (module type doc, `AUTO_DURATION_DISTRIBUTION_KEY`, the main function's
  "cheap per call, heavy only on flush" contract, `accumulate`).
- The `telemetry-instrumentation` skill was reviewed: it documents
  `callWithTelemetryAndErrorHandling` and `publicProcedureWithTelemetry` but does
  **not** describe `callWithAccumulatingTelemetry`'s callback shape, so no skill
  edit was required. (If a future task adds an accumulating-telemetry section to the
  skill, it should show the `(sample) => { sample.measurements.x = 1 }` form.)

## Post-change validation (all green)

`jest` (full suite, 2668/2668) · `eslint` (touched files, 0 errors; 2 pre-existing
unrelated `require-await` warnings in `DocumentDBShellPty.ts` at lines 226/462) ·
`tsc` (project-wide `--noEmit`, clean) · `npm run build` (all packages + extension)
· `prettier` (unchanged — already formatted). No user-facing strings, so `l10n` not
required.

| ID        | What changed                                                                                                                            | Why (motivation)                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| R766-P05b | `callWithAccumulatingTelemetry` split into cheap synchronous accumulate + heavy flush; callback takes a `TelemetrySample` bag (was `IActionContext`); all callers migrated | The per-call `callWithTelemetryAndErrorHandling` wrapper ran on every call and added up on hot paths (per-RPC); now it runs once per flush. |

---

# Iteration 11 — accumulating-telemetry rename (R766-P06) (2026-07-06)

> Naming follow-up to Iteration 10. After the accumulate/flush split, the helper's
> `callWith…` name was actively misleading: the `callWith…` convention in
> `@microsoft/vscode-azext-utils` promises "run my work inside a managed scope that
> hands me a full `IActionContext` (telemetry **+** errorHandling **+** ui **+**
> valuesToMask) and auto-records duration/result/errors for it." The redesigned
> helper does none of that on the per-call path — it just fills a plain sample bag,
> synchronously, and returns `void`. This iteration renames it so the name stops
> promising a scoped call. Behavior is unchanged; this is a rename + file move only.

## What changed

- **Symbol rename** (language-server-safe, all call sites updated):
  - `callWithAccumulatingTelemetry` → **`accumulateTelemetry`** — verb `accumulate`
    (not `call`) signals "record a data point into a batch," and drops the false
    "your work runs in a scope" cue.
  - `flushAccumulatingTelemetry` → **`flushAccumulatedTelemetry`** (reads as "flush
    what was accumulated").
  - `AccumulatingTelemetryOptions` → **`AccumulateTelemetryOptions`**.
  - Unchanged: `TelemetrySample`, `AUTO_DURATION_DISTRIBUTION_KEY`, `meterSilentCatch`
    (its `meter` verb is already correct for a pure counter shorthand).
- **File rename** (via `git mv`, history preserved):
  `src/utils/callWithAccumulatingTelemetry.ts` → `src/utils/accumulatingTelemetry.ts`
  (+ its `.test.ts`), so the filename no longer names a function that no longer
  exists. Updated the import path in **all** importers, including the ~7
  `meterSilentCatch`-only consumers and the two `jest.mock('…')` paths.
- **Callers migrated:** `ClustersExtension`, `DocumentDBShellPty` (×6),
  `collectionViewRouter`, `rpcConcurrencyLogger` (call sites → `accumulateTelemetry`);
  `extension.ts` (deactivation flush → `flushAccumulatedTelemetry`); `configuration.ts`
  and `rpcConcurrencyLogger.ts` doc-comment references. `meterSilentCatch` consumers
  needed only the import-path change (the shorthand name is unchanged).
- **Docs:** all `{@link}` / prose references in the helper updated; the stale
  Iteration-2 file link in this review doc repointed to the renamed path (older
  change-protocol *bodies* are left intact as an accurate record of the name in
  force at the time).

## Why this name (the teachable distinction)

The verb now encodes **whether your callback is executed**:

- `accumulateTelemetry(id, (sample) => …)` — your callback only *fills a sample*; no
  work is run in a scope, no `ctx`.
- a future `runWithAccumulatingTelemetry(id, (sample) => action)` — genuinely *runs*
  your action, so a `runWith…` name would be honest there (tracked as R766-P07 /
  GitHub enhancement issue, not built in this iteration).

Naming the `sample` parameter (instead of `ctx`) reinforces it at every call site:
`sample.measurements` visibly lacks `sample.ui` / `sample.errorHandling`.

## Telemetry skill

Reviewed `.github/skills/telemetry-instrumentation`: it documents
`callWithTelemetryAndErrorHandling` and `publicProcedureWithTelemetry` but does
**not** mention the accumulating helper by any name, so no skill edit was required.
(If a future task adds an accumulating-telemetry section, it should show the
`accumulateTelemetry('event', (sample) => { sample.measurements.x = 1 })` form.)

## Post-change validation (all green)

`jest` (full suite, 2668/2668) · `eslint` (touched files, 0 errors; 4 pre-existing
unrelated `require-await` warnings) · `tsc` (project-wide `--noEmit`, clean) ·
`npm run build` · `prettier`. No user-facing strings, so `l10n` not required.

| ID       | What changed                                                                                                   | Why (motivation)                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| R766-P06 | Renamed `callWithAccumulatingTelemetry`→`accumulateTelemetry`, `flushAccumulatingTelemetry`→`flushAccumulatedTelemetry`, `AccumulatingTelemetryOptions`→`AccumulateTelemetryOptions`; file → `accumulatingTelemetry.ts`; all callers migrated | The `callWith…` name promised a full-context scoped call the redesigned helper no longer provides; the new names match what it actually does. |

## Deferred — `runWithAccumulatingTelemetry` (R766-P07, tracked as a GitHub issue)

The "wrap an action" variant (runs the action, batches successes, emits failures
immediately, rethrows) is **not** built here. It was specced and filed as
[microsoft/vscode-documentdb#777](https://github.com/microsoft/vscode-documentdb/issues/777)
(`enhancement`, `[telemetry]` in the title) so it can be picked up when demand for
richer hot-path telemetry arises. Key design points captured in the issue: success
→ accumulate; error/cancel → immediate full emit; rethrow to keep the wrapper
transparent; reuse the Iteration 10 internals.
