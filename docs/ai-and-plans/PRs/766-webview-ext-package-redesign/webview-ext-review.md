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
[Iteration 2](#iteration-2--open-items--answers).

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

| ID | Commit | What changed | Why (motivation) |
| --- | --- | --- | --- |
| R766-06 | `0292780` | `attachTrpc` calls `iterator.return?.()` with **no argument** at both sites | The parameter is a *return value*, not an `IteratorResult`; `{ value, done }` was misleading and could leak as a custom iterator's final value. Copilot threads answered + resolved. |
| R766-N04 | `0bd16afa` | `AttachTrpcResult` exposes `activeOperations` / `activeSubscriptions` as `ReadonlyMap` | Returning the live mutable `Map`s let a consumer corrupt the dispatcher's in-flight/cancellation bookkeeping; observation preserved, mutation removed. |
| R766-05 | `c5662718` | `openDocumentWebview` returns a local `const controller` | The return no longer flows through the optional `handle.controller?` slot, so it can't read as nullable. Copilot thread answered + resolved. |
| R766-02 | `76172cd2` | `WebviewController.dispose()` now closes the panel (`_panelDisposed` guard) + 2 tests | A public handle whose `dispose()` leaves the tab open is surprising; the old "recursion" rationale was already neutralised by the `_isDisposed` guard. |
| R766-N07 | `9a758cc5` | `useConfiguration` parses `__initialData` in `try/catch`, falls back to `{}` + logs | A malformed payload threw during render and white-screened the webview; degrade gracefully instead. |
| R766-N08 | `76f99484` | Renamed the host dispatch-logger option `telemetry` → `logger`; added README **Observability** chapter | `telemetry` (a `ProcedureLogger`) collided with the analytics path and misled readers. No deprecated alias kept (preview). |
| R766-S02 | `6363a6f2` | Webview `loggerLink` is now **opt-in** (`connectTrpc({ logger })` / `<WithWebviewContext enableRpcLogging>`) | Always-on logging is noise for production consumers; defaults should be quiet. README documents the rich console experience and how to open the webview devtools console. |
| R766-S03 | `32859afc` | Shipped generic `WithTelemetry<TContext, TTelemetry>` from `./host`; ADVANCED.md pattern; DocumentDB now specializes it; README telemetry recipe | Reading `ctx.telemetry` needed ad-hoc casts, and the DocumentDB comment referenced a package helper that didn't exist. Telemetry is now discoverable from the README (azext). |
| R766-S04 | `de27b507` | Reworded README shared-client note; dropped the "single `message` listener" claim | The client is shared per webview (true), but the transport registers one listener *per in-flight op*; the claim described a wrong, changeable internal. (Design pros/cons in Iteration 2.) |
| R766-04 | `61a01033` | ADVANCED.md: subscriptions are **not** on the event channel | The doc contradicted `eventLink` (which excludes subscriptions) and the `useRpcEvents` doc. |
| R766-03 | `46296ce4` | Ship `ADVANCED.md` + a package-local `LICENSE` in `files` | README linked ADVANCED.md ~10× but it wasn't in the tarball, and no license text shipped. Verified with `npm pack --dry-run`. |

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

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L331-L348)

`attachTrpc` registers a webview message listener and immediately reads `message.op.type`. Any panel that already uses `postMessage` for a non-tRPC message will send an object without `op`, which causes the handler to throw before the message can be ignored.

This cuts against the central reason `attachTrpc` exists: bring-your-own-panel adopters, including migrations from legacy `postMessage` channels, are exactly the consumers most likely to have unrelated traffic on the same VS Code webview bus. The design notes explicitly mention that the Cosmos-derived primitive guarded non-tRPC messages for this reason.

Suggested fix: add a small runtime guard before the `switch`, for example checking that the message is an object with an `op` object whose `type` is one of the supported transport operation types. Unknown messages should be ignored, optionally with debug logging only when a logger/debug option is supplied. Add a unit test that sends an unrelated message and then verifies a later tRPC query still works.

### R766-02: Medium - Public `WebviewController.dispose()` leaves the webview panel open

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L311-L338)

The README advertises the `openWebview` return value as a handle with `dispose`, but `dispose()` only marks the controller disposed, fires `onDisposed`, and disposes registered listeners. It deliberately does not call `this._panel.dispose()`, based on the internal assumption that only the panel owns the controller lifecycle.

As a public package API, that assumption is too narrow. A consumer holding the returned controller can reasonably call `controller.dispose()` expecting the tab to close. Instead, the visible webview remains open while its controller is marked disposed and its tRPC listener has been torn down. That is a confusing state for new projects and agents because the obvious cleanup method only half-disposes the object graph.

Suggested fix: split disposal into two paths. Public `dispose()` should close the panel when the panel is not already disposing, while the `onDidDispose` callback should call a private teardown method that only disposes controller resources. Keep the idempotency guard to avoid recursion. Add an `openWebview` test asserting that `controller.dispose()` calls the mock panel's `dispose()`.

### R766-03: Medium - `ADVANCED.md` is referenced but excluded from the npm package

References: [packages/vscode-ext-webview/package.json](../../../../packages/vscode-ext-webview/package.json#L38-L41), [packages/vscode-ext-webview/README.md](../../../../packages/vscode-ext-webview/README.md#L216-L238)

The package whitelist ships only `dist` and `README.md`, but the README repeatedly sends advanced users to `ADVANCED.md`. Consumers installing the package from npm will not get that file in the tarball.

This matters because the opened-up API intentionally relies on advanced docs for `attachTrpc`, `connectTrpc`, telemetry adapters, event channels, and the host/browser import boundary. Without the file in the package, the lower-level surface is harder to adopt and the README contains broken local links.

Suggested fix: include `ADVANCED.md` in the package `files` array. Consider also including license metadata if the eventual published tarball does not already include it through npm defaults.

### R766-04: Low - `ADVANCED.md` contradicts the implementation for subscription errors

References: [packages/vscode-ext-webview/ADVANCED.md](../../../../packages/vscode-ext-webview/ADVANCED.md#L195-L199), [packages/vscode-ext-webview/src/webview/errorLink.ts](../../../../packages/vscode-ext-webview/src/webview/errorLink.ts#L55-L88), [packages/vscode-ext-webview/src/react/useRpcEvents.ts](../../../../packages/vscode-ext-webview/src/react/useRpcEvents.ts#L16-L23)

The advanced manual says subscription errors are surfaced through the global event channel as well as each subscription's `.subscribe({ onError })` handler. The implementation intentionally excludes subscriptions from `eventLink`, and the hook docs say subscriptions are excluded to avoid surfacing them twice.

Suggested fix: update `ADVANCED.md` to match the implementation: query and mutation outcomes go through `RpcEventChannel`; subscription outcomes should be observed through the subscription callback.

### R766-05: Low - `openDocumentWebview` uses an optional handle for a value it returns as required

GitHub review thread: `PRRT_kwDOODtcO86OCV7g` (Copilot reviewer, unresolved, can resolve)

Reference: [src/webviews/documentdb/documentView/documentsViewController.ts](../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L41-L73)

Copilot flagged that `openDocumentWebview` declares a non-optional return type but stores the controller in `handle.controller?: AppWebviewController<...>` and then returns `handle.controller`.

I would classify this as low severity. The assignment happens immediately before the return, so this is unlikely to be a runtime bug, and TypeScript may narrow the property after direct assignment. Still, the optional property makes the code harder for humans and agents to reason about, and it creates an unnecessary question about whether `undefined` can escape.

Suggested fix: avoid returning through the optional property. Store the result in a local `const controller = openAppWebview(...)`, assign `handle.controller = controller` for the title setter closure, and return `controller`. That keeps the deferred setter pattern without making the function's return path look nullable.

### R766-06: Low - `AsyncIterator.return()` is called with an `IteratorResult`-shaped value

GitHub review threads: `PRRT_kwDOODtcO86OCV77` and `PRRT_kwDOODtcO86OCV8H` (Copilot reviewer, both unresolved, both can resolve)

References: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L250-L260), [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L366-L375)

Copilot flagged both calls to `iterator.return?.({ value: undefined, done: true })`. The comment is valid: `AsyncIterator.return(value?)` accepts the return value, not an `IteratorResult` object. Passing `{ value, done }` is misleading and can leak that object as the iterator's final return value for custom iterators.

I would classify this as low severity because the current code uses the call mainly to unblock a parked subscription and does not consume the return value. It is still worth fixing because this package is a reusable transport primitive and should model iterator semantics accurately.

Suggested fix: call `iterator.return?.()` with no argument in both locations. If a domain return value is ever needed, pass that domain value directly, not an `IteratorResult` shape. Keep the existing rejection swallowing and subscription cleanup behavior.

## API simplification notes

### R766-S01: Keep `openWebview`, `WebviewController`, and `attachTrpc` as separate tiers

I would not collapse the three host tiers. The factory is useful for greenfield consumers, the class is useful for stateful panels, and `attachTrpc` is the adoption primitive for existing panel frameworks. The important part is that `attachTrpc` must behave like a true guest on a panel it does not own, which is why R766-01 is the key fix.

### R766-S02: Consider making production logging opt-in or mode-aware

Reference: [packages/vscode-ext-webview/src/webview/connectTrpc.ts](../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L105-L107)

`connectTrpc` always inserts tRPC's `loggerLink()`. That is friendly while developing a starter project, but it may surprise production consumers by logging every RPC call from the webview side. Since `WebviewController` already has explicit telemetry/logging options on the host side, the client side would be more predictable if logging were controlled by a `logger` / `loggerLink` / `enableLogger` option, or omitted by default in production-oriented helpers.

This is not a correctness bug, but it is worth second-guessing before the preview API spreads. New projects and coding agents usually accept defaults; defaults should be quiet unless observability is explicitly requested.

### R766-S03: The telemetry middleware is flexible, but the common `WithTelemetry<T>` cast deserves a first-class docs pattern

The decision to ship middleware bodies instead of a package-owned telemetry procedure is sound. It keeps the package instance-agnostic and avoids baking in Azure telemetry policy.

The cost is that consumers need a local `WithTelemetry<T>` helper or a similar narrowing pattern when procedure code reads `ctx.telemetry`. DocumentDB already has that helper in [src/webviews/_integration/trpc.ts](../../../../src/webviews/_integration/trpc.ts#L58-L64). Add that pattern to `ADVANCED.md` so agents have a copyable way to do the right thing instead of inventing ad hoc casts at every procedure.

### R766-S04: The README should avoid promising a single message listener

Reference: [packages/vscode-ext-webview/README.md](../../../../packages/vscode-ext-webview/README.md#L202-L208)

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

I also read the locked design (`docs/ai-and-plans/PRs/766-webview-ext-package-redesign/webview-rpc-package-decoupling-design.md`,
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

| ID | 1st-pass severity | Verified in code? | My severity | Verdict |
| --- | --- | --- | --- | --- |
| R766-01 | High | ✅ Yes | **Medium** | Real defect, but I downgrade High → Medium. See reasoning below. Still the highest-priority functional fix. |
| R766-02 | Medium | ✅ Yes | Medium | Confirmed. The doc-comment's "circular call chain" justification is itself partly wrong (the `_isDisposed` guard already prevents recursion). |
| R766-03 | Medium | ✅ Yes | Medium | Confirmed. Broaden it: no `LICENSE` file ships either. |
| R766-04 | Low | ✅ Yes | Low | Confirmed doc/impl contradiction. |
| R766-05 | Low | ✅ Yes | Low | Confirmed. Compiles only because TS narrows the property after direct assignment; not a runtime bug. |
| R766-06 | Low | ✅ Yes | Low | Confirmed at both sites. |
| R766-S01 | note | n/a | Info | Agree — three tiers are implemented as designed. |
| R766-S02 | note | ✅ Yes | Low | Confirmed `loggerLink()` is unconditional. |
| R766-S03 | note | ✅ Yes | Low | Confirmed; and the DocumentDB comment references a package `WithTelemetry` helper that does **not** exist. |
| R766-S04 | note | ✅ Yes | Low | Confirmed — the transport registers a `window` `message` listener per in-flight operation. |

No finding in the first pass was a false alarm. The only correction is the
severity of R766-01 and two rationale/scope refinements (R766-02, R766-03).

### R766-01 severity: why Medium, not High

> ⏭ **Moved to Iteration 2.** Options A/B/C are re-examined in the Iteration 2
> chapter, together with the side-effect analysis for existing projects.

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L331-L333)

The defect is real and verified: the listener callback is `async` and its first
act is `switch (message.op.type)`, with no guard. A foreign `postMessage` whose
payload has no `op` (or is `null`) throws a `TypeError`.

What tempers the severity is the *blast radius*:

- The throw happens **inside an `async` listener**, so it becomes an *unhandled
  promise rejection*, not a synchronous throw. VS Code's event emitter does not
  catch it (nothing is thrown synchronously), and the extension host does not
  abort on unhandled rejections by default — it logs. So the observable effect
  is log/telemetry noise plus a dropped foreign message, **not** a crash.
- It does **not** corrupt the tRPC channel: each message is a fresh listener
  invocation, so subsequent tRPC calls still dispatch correctly.
- It does **not** break the embedder's *own* `onDidReceiveMessage` listener —
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

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L323-L338)

Confirmed. One correction to the code's own reasoning: the doc comment says the
panel is not closed to avoid a "circular call chain
(`dispose → panel.dispose → onDidDispose → dispose`)", but `dispose()` sets
`_isDisposed = true` *before* doing anything else, so a re-entrant call already
returns immediately. The recursion the comment fears cannot happen — which means
the stated reason for the current behavior does not hold, and closing the panel
is safe.

Corroborating evidence that this is a latent (not yet triggered) issue: a repo
search shows DocumentDB never calls `controller.dispose()` or
`revealToForeground()` on these controllers, and the `openWebview` test only
asserts `isDisposed`/`onDisposed` — never that the panel closed
([openWebview.test.ts](../../../../packages/vscode-ext-webview/src/host/openWebview.test.ts#L84-L92)).
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
    `dispose` as *the* cleanup method; more surface for the "simple" audience.
- **C — Keep behavior, document it, add a `closePanel` option.**
  - Pros: zero behavior change.
  - Cons: least intuitive; directly contradicts the north star.

**Recommendation: A.** Close the panel from `dispose()`, add the `_panelClosing`
guard, correct the doc comment, and extend the `openWebview` test to assert the
mock panel's `dispose()` was called.

### R766-03 — broaden to include the license

References: [package.json](../../../../packages/vscode-ext-webview/package.json#L38-L41), [README.md](../../../../packages/vscode-ext-webview/README.md#L334-L336)

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

References: [ADVANCED.md](../../../../packages/vscode-ext-webview/ADVANCED.md#L197-L199), [errorLink.ts](../../../../packages/vscode-ext-webview/src/webview/errorLink.ts#L71-L82), [useRpcEvents.ts](../../../../packages/vscode-ext-webview/src/react/useRpcEvents.ts#L20-L21)

Confirmed contradiction. `eventLink` guards `if (op.type !== 'subscription')` on
both `next` and `error`, and the `useRpcEvents` doc comment says subscriptions
are intentionally excluded — but ADVANCED.md L197-199 says subscription errors
*are* surfaced on `onError`.

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

Reference: [documentsViewController.ts](../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L41-L73)

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

References: [attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L259), [attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L374)

Confirmed at both sites. `AsyncIterator.return(value?)` takes the *return value*,
not an `IteratorResult`; passing `{ value: undefined, done: true }` sets that
object as the generator's final return value. Harmless today (nobody reads it),
but wrong modelling for a reusable transport.

**Recommendation:** call `iterator.return?.()` with no argument at both sites;
keep the existing rejection-swallowing. (No competing option worth listing.)

### R766-S02 / S03 / S04 — recommendations

- **R766-S02** (`loggerLink()` always on — [connectTrpc.ts](../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L106)):
  add `ConnectTrpcOptions.logger?: boolean` (default `false`); the facade and
  hooks stay quiet unless observability is requested. Reject an env-based
  default — webview bundles have no reliable `NODE_ENV`. **Recommend: opt-in
  logger, off by default.**
- **R766-S03** (document the telemetry-narrowing pattern): add the
  `WithTelemetry<T>` recipe to ADVANCED.md and optionally ship a generic
  `type WithTelemetry<TCtx, TTelemetry>` from `./host`; also fix the stale
  DocumentDB comment ([trpc.ts](../../../../src/webviews/_integration/trpc.ts#L60-L67))
  that calls itself a "replacement for the package's `WithTelemetry` helper"
  when the package exports none. **Recommend: document + ship a tiny generic
  helper.**
- **R766-S04** (README "single message listener" — [README.md](../../../../packages/vscode-ext-webview/README.md#L207-L211)):
  soften to "a shared client per webview"; drop the "single `message` listener"
  claim, which is false (one listener per in-flight op). **Recommend: reword.**

## New findings (deeper review)

### R766-N01: Medium - Webview-side inbound message guard throws on `null` / non-object `event.data`

> ⏭ **Moved to Iteration 2**, bundled with R766-01 — both transport edges (host
> `attachTrpc` and webview `onReceive`) should be guarded together.

Reference: [packages/vscode-ext-webview/src/webview/connectTrpc.ts](../../../../packages/vscode-ext-webview/src/webview/connectTrpc.ts#L92-L100)

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

References: [initWebviewTrpc.ts](../../../../packages/vscode-ext-webview/src/shared/initWebviewTrpc.ts#L57-L64), [attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L134-L139), [ADVANCED.md](../../../../packages/vscode-ext-webview/ADVANCED.md#L88-L89)

This is the finding most in tension with the "simple for the 90%" north star. To
get a typed context (the whole point of `initWebviewTrpc<Ctx>()`), the greenfield
consumer must:

1. `const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<Ctx>()`;
2. **re-export** `createCallerFactory`; and
3. pass **both** `router` and `createCallerFactory` to `openWebview`.

If step 2/3 is forgotten, `attachTrpc` silently falls back to
`defaultCreateCallerFactory` (bound to a *different* tRPC instance). ADVANCED.md
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

References: [WebviewController.ts](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L267), [WebviewController.ts](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L272-L276)

`getDocumentTemplate` builds inline `<script>` blocks by string interpolation:

- `globalThis.l10n_bundle = ${JSON.stringify(vscode.l10n.bundle ?? {})}` — plain
  `JSON.stringify` does **not** escape `</script>`, `U+2028`, or `U+2029`, any of
  which can break out of an inline script context.
- `render('${this._options.viewType}', …)` — `viewType` is interpolated raw
  inside single quotes; a quote or `');…` in it breaks the statement.
- `__initialData` is the one field that *is* protected (via `encodeURIComponent`).

All inputs here are developer-controlled (the extension's own l10n bundle and its
own `viewType`), and a CSP nonce is applied, so real-world risk is low — hence
Low. But this is a *reusable, published* package: a coding agent may feed a
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
  - Cons: adds a round-trip and a "loading" state to the *simple* path; a
    regression for the north-star audience.

**Recommendation: A now** (removes the edge with no contract change); note **B**
as the cleaner long-term shape. Reject C for the facade.

### R766-N04: Low - `AttachTrpcResult` leaks live mutable internal `Map`s

Reference: [packages/vscode-ext-webview/src/host/attachTrpc.ts](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L64-L68)

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
  - Cons: keeps the footgun in a *primitive* meant for embedders.

**Recommendation: A.**

### R766-N05: Low - A throwing event-channel observer breaks tRPC dispatch

> ⏭ **Moved to Iteration 2.** Options for surfacing observer exceptions to
> telemetry (not just the console) are explored in the Iteration 2 chapter; not
> implemented this pass, per request.

Reference: [packages/vscode-ext-webview/src/webview/events.ts](../../../../packages/vscode-ext-webview/src/webview/events.ts#L110-L129)

`emitSuccess`/`emitError`/`emitAborted` invoke handlers synchronously inside the
`eventLink` `next`/`error` callbacks. The channel's own contract says it is
"observer-only" and cannot affect the value — but if an observer *throws*, the
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

References: [openWebview.ts](../../../../packages/vscode-ext-webview/src/host/openWebview.ts#L42-L50), [documentsViewController.ts](../../../../src/webviews/documentdb/documentView/documentsViewController.ts#L29-L73)

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

Reference: [packages/vscode-ext-webview/src/react/useConfiguration.ts](../../../../packages/vscode-ext-webview/src/react/useConfiguration.ts#L23-L29)

`JSON.parse(decodeURIComponent(window.config?.__initialData ?? '{}'))` runs in a
`useState` initializer. If `__initialData` is malformed (a consumer hand-rolling
the HTML, or the R766-N03 escaping edge), the parse throws *during render* and
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

### R766-N08: Low - The `telemetry` controller option is actually a dispatch *logger*, overloading the word

Reference: [packages/vscode-ext-webview/src/host/WebviewController.ts](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L92-L99)

`WebviewControllerOptions.telemetry?: ProcedureLogger` is the zero-config console
*logging* sink. But ADVANCED.md uses "telemetry" for the *analytics* path
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

| ID | Severity | Area | Recommended option | Iteration 1 status |
| --- | --- | --- | --- | --- |
| R766-01 | Med | host transport | A (guard) + B (throw-safe) | ⏭ Iteration 2 (no consumer cost today) |
| R766-N02 | Med | happy-path API | A (pass `WebviewTrpc` instance) | ⏭ Iteration 2 (decided: A) |
| R766-02 | Med | host lifecycle | A (`dispose()` closes panel + guard) | ✅ `76172cd2` |
| R766-03 | Med | packaging | A (ship `ADVANCED.md` + `LICENSE`) | ✅ `46296ce4` |
| R766-N01 | Med | webview transport | A (structural guard) | ⏭ Iteration 2 (bundle with R766-01) |
| R766-S02 | Low | webview logging | A (opt-in logger, off by default) | ✅ `6363a6f2` |
| R766-N04 | Low | host primitive | A (`ReadonlyMap`) | ✅ `0bd16afa` |
| R766-N05 | Low | event channel | isolate throws + telemetry hook | ⏭ Iteration 2 (options only) |
| R766-N03 | Low | security hardening | B (JSON data block, per request) | ⏭ Iteration 2 |
| R766-N08 | Low | naming | A (rename `telemetry` → `logger`) | ✅ `76f99484` |
| R766-04 | Low | docs | A (fix ADVANCED.md) | ✅ `61a01033` |
| R766-05 | Low | consumer code | A (local const) | ✅ `c5662718` |
| R766-06 | Low | host transport | A (`return()` no arg) | ✅ `0292780` |
| R766-S03 | Low | docs + helper | A (document + ship generic) | ✅ `32859afc` |
| R766-S04 | Low | docs | A (reword README) | ✅ `de27b507` |
| R766-N07 | Low | webview config | A (defensive parse) | ✅ `9a758cc5` |
| R766-S01 | Info | architecture | keep three tiers | ✅ Agreed (no change) |
| R766-N06 | Info | front-door scope | B (document, don't build yet) | ⏭ Iteration 2 |

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

| ID | Title | Why it is here |
| --- | --- | --- |
| R766-01 | `attachTrpc` foreign-message guard | ✅ Implemented in Iteration 2 (structural guard + throw-safe listener + foreign-message test). |
| R766-N01 | Webview inbound `event.data` guard | ✅ Implemented in Iteration 2 (structural `onReceive` guard + test). |
| R766-N02 | `createCallerFactory` ergonomics | ✅ Implemented in Iteration 2 (option A: `trpc` instance option; consumer adopted; `createCallerFactory` deprecated). |
| R766-N03 | Inline-script hardening | ✅ Implemented in Iteration 2 (option B: inert `application/json` data block + nonce'd boot parser). |
| R766-N05 | Observer exceptions → telemetry | Options only, per request; not implemented. |
| R766-N06 | Create-or-reveal helper | ✅ Documented in Iteration 2 (ADVANCED.md pattern; no package code). |
| R766-S04 | Per-operation listener design | ✅ Instrumented in Iteration 2 (concurrency gauge: `ProcedureLogger.concurrent` + accumulating telemetry). |

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
`attachTrpc`, the *bring-your-own-panel* primitive. Today the only consumer
(DocumentDB) never calls `attachTrpc` directly — it goes through `openWebview` /
`WebviewController`, which **create and own** the panel. A framework-owned panel
carries **only** tRPC traffic, so `message.op` is always present and the missing
guard is never reached. The defect is latent until someone attaches tRPC to a
panel that *also* carries their own `postMessage` protocol (a legacy-migration
embedder such as Cosmos). So your read is correct: it is hidden behind the API,
and there is **no real cost to current consumers** — which is exactly why it is
safe to defer.

When it *is* reached, the blast radius is still bounded: the throw happens inside
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
> data`) before forwarding, so a `null` / primitive / foreign `window` message can
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
> > 80%, verified by a clean consumer typecheck): the option is typed
> `Pick<WebviewTrpc<TContext>, 'createCallerFactory'>`. The reference consumer
> builds procedures on a *base-context* instance and narrows `ctx` per call, so
> its instance context is a base of the controller `TContext`; a strict
> `WebviewTrpc<TContext>` would reject it. The controller only ever reads
> `createCallerFactory`, and the `Pick` accepts that instance by parameter
> contravariance — no cast, and the mismatch-proofing is unchanged.

**Decision: option A** (accept the `WebviewTrpc` instance). Rationale below,
including why A and B look identical at the call site but are not, and what each
means for consumers who want the tRPC transport only, without the package's
webview scaffolding.

### What N02 is actually solving

The host dispatcher needs **two** things from the consumer, not one: the
`router` (what procedures exist) and a `createCallerFactory` (how to invoke a
procedure against a context). In tRPC, `createCallerFactory` is bound to the
*instance* returned by `initTRPC.context<T>().create()` — the router object does
**not** carry a reference back to its own factory. So today the consumer has to
route that factory by hand, and if they don't, `attachTrpc` silently falls back
to `defaultCreateCallerFactory` (the factory of a *different*, bare
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

| | Where the factory lives | Passed to `openWebview` | Can it still be mismatched? | Cost |
| --- | --- | --- | --- | --- |
| **Today** | free-floating value | `router` + `createCallerFactory` | Yes — forget it / pass the wrong one → silent wrong default | ceremony + footgun |
| **A** | on the **instance** (`trpc`) | `router` + `trpc` | Only if you pass a `router` built from a *different* instance than `trpc` (unlikely, but still two things kept in sync) | one meaningful import; explicit; no magic |
| **B** | on the **router** (hidden symbol) | `router` only | No — the router *is* the source of truth; impossible for a simple router | zero ceremony; relies on a non-enumerable property |

So A is a *modest* step past today (you still hand over two coordinated things —
`trpc` and `router` — you have just swapped a loose function for the instance it
came from and dropped the dedicated re-export). B is a *qualitative* step (one
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
  most likely to hit the cases that *drop* it: `mergeRouters`, object
  spreads/clones, or wrapping the router through their own machinery can strip a
  non-enumerable symbol, silently reinstating the default factory — the exact
  footgun, now invisible. B's "impossible to mismatch" guarantee holds for the
  greenfield router but **weakens precisely for the compose-your-own-router power
  user.**

For the bring-your-own-UI audience, then, B's implicit magic is a liability and
A's explicitness is a *feature*: composition-proof, nothing to lose, visible at
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
<script type="application/json" id="vscode-ext-webview-initial-data">{ "config": …, "l10n": … }</script>
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

Goal: when a consumer's event-channel handler throws, it must (a) not corrupt tRPC
dispatch and (b) be *observable* — ideally routable to telemetry, not just
`console.error`. Options (not implemented; for discussion):

- **Option 1 — an `onObserverError` sink.** `createEventChannel({ onError })` /
  `connectTrpc(api, { onObserverError })`; the channel try/catches each handler
  and calls the sink with `(error, info)`. Consumers forward it to their
  telemetry. *Pros:* explicit, structured (keeps `CallInfo`), testable, isolates
  the throw. *Cons:* one more option.
- **Option 2 — a channel `onInternalError` event.** Add it to `RpcEventChannel`.
  *Cons:* its own handlers can throw (recursion) — needs a hard guard; muddies the
  "observe query/mutation outcomes" contract.
- **Option 3 — synthesize an `emitError` with a marker path** (e.g. `$observer`).
  *Cons:* pollutes the normal error stream; confusing to consumers.
- **Option 4 — round-trip to the host** so host-side telemetry records it.
  *Cons:* heavy; couples webview observer bugs to host telemetry; lossy/ordered.
- **Option 5 — `reportError(err)` (the browser global).** Wrap handler calls so a
  throw is reported; surfaces in devtools and is catchable by a consumer's global
  handler. *Pros:* zero API surface; standard mechanism. *Cons:* unstructured (no
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
> stays tiny, the evidence to *retire* S04.

The transport (`vscodeLink` → `connectTrpc`'s `onReceive`) registers a **new
`window` `message` listener per in-flight operation**, each filtering by
`operationId` and removed on completion, rather than one central listener with an
`id → observer` map. The README reword (R766-S04) stopped *advertising* this
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
operation in [`AttachTrpcResult.activeOperations` + `.activeSubscriptions`](../../../../packages/vscode-ext-webview/src/host/attachTrpc.ts#L55-L78)
(exposed read-only in R766-N04). Their combined size *is* `N`. Because each
in-flight operation is exactly one host map entry **and** one webview listener,
the host-side count is a faithful, zero-cost proxy for the webview fan-out — no
webview→host round-trip needed.

**How to emit it — reuse the accumulating telemetry.**
[`callWithAccumulatingTelemetry`](../../../../src/utils/callWithAccumulatingTelemetry.ts#L96-L134)
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

| Reading | Interpretation | Verdict |
| --- | --- | --- |
| `dist_concurrentRpcOps_max` ≤ 8 in ~all sessions | fan-out is a handful of comparisons per message | **Keep — and consider _retiring_ S04**: the concern is disproven |
| occasional `_max` in 8–32 | spikes, not sustained | keep as is; leave the signal on |
| `_max` ≥ 32 in ≳ 1 % of webview sessions, **or** average (`_sum / _count`) ≥ 8 sustained — especially if `dispatch`/window is also high (heavy streaming) | genuine, sustained fan-out | **Revisit**: build the single-listener + `Map<id, observer>` multiplexer |

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
