# PR #676: Webview API package preview hardening and consumer reshape

**Branch:** `dev/tnaum/webview-api-package`
**Base:** `main`
**Date:** 2026-05-22
**Commits:** 34 on top of `1fba8a78`

## Why

The webview transport code that powers the DocumentDB extension grew up inside `src/webviews/api/` as a mix of framework concerns (tRPC over `postMessage`, the `WebviewController` lifecycle) and consumer concerns (DocumentDB telemetry sink, bundle layout, configuration knobs). Two things were on the table:

1. **Publish a reusable preview package.** The transport is generic enough to belong in `@microsoft/vscode-ext-react-webview`, separate from the extension. The starter kit at [tnaum-ms/vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit) already shows external interest. The package needed a sharp, strict-transport scope and a documented surface before it can go to npm.
2. **Reshape the consumer-side glue.** The local `src/webviews/api/` folder mixed naming conventions, split one logical unit (telemetry middleware) across two files, hid customization knobs across several modules, and shadowed the framework's `WebviewController` class with an identically-named local subclass.

This PR delivers both: the package gets a few proactively-added features that we identified are valuable through reviewing the partner [vscode-cosmosdb](https://github.com/microsoft/vscode-cosmosdb) extension's post-tRPC-migration architecture (which forked from us before the extraction), and the consumer folder is reshaped into a small, sortable, documented layer at `src/webviews/_integration/`.

## What was done

### Package side (`packages/vscode-ext-react-webview/`)

- **`TypedEventSink<T>`** added under the `/server` entry. Typed async-iterable for bridging push-style domain events (event emitters, driver callbacks) into tRPC subscriptions. Single-consumer, with two `emit` overloads (full event object or `(type, payload)`) and `close()` to terminate the iterator on panel disposal. 7-case Jest suite. Iterator implements `return()` so `break` inside a `for await` over a sink releases the parked promise per the JS iterator protocol with no producer cooperation.
- **`errorLink`** added under the default (webview-client) entry. Optional tRPC link that forwards query and mutation errors to a consumer-supplied handler without preventing the normal error flow. Subscription errors are intentionally not forwarded (they have their own per-call `onError` hook).
- **`useTrpcClient(options?)`** gained an optional `onError` callback; passing it installs `errorLink` automatically. Zero-arg call sites unchanged.
- **`safePostMessage` guard** in the framework `WebviewController` message dispatcher. All six `postMessage` call sites now route through a single helper that early-returns when the controller is disposed and wraps the underlying call in `try/catch` plus a no-op Thenable catch. Prevents noise from late-yield subscription values racing against panel disposal.
- **Subscription lifecycle hardening.** `WebviewController` now tracks both the `AbortController` and the live `AsyncIterator` per subscription. `handleSubscriptionStopMessage` and `dispose()` now abort *and* call `iterator.return()`, propagating cleanup through the procedure's async generator into any inner `for await`. `_activeSubscriptions.set` is deferred until after the iterator is in hand so early failures do not leave stale map entries. `_onDisposed` emitter registered in `_disposables` so it is torn down on panel dispose.
- **README expansion.** New Quick start section with a four-file minimal example (router, controller, webview entry, view component). New "Starter kit and reference consumers" section linking the starter kit prominently and describing the consumer-side `_integration/` layout convention. Two more Advanced subsections (push events, type-only import rule). All em-dashes removed; the README is plain ASCII for these characters.

### Consumer side (`src/webviews/_integration/`)

- **Folder renamed** twice: `api/` -> `webviewIntegration/` -> `_integration/`. The underscore prefix sorts the folder above feature folders in the file explorer (restoring the at-a-glance "this is plumbing, not feature code" affordance the old `api/` had by alphabetical accident), and shorter than `webviewIntegration/`.
- **`trpc.ts` merged into `appRouter.ts`.** Telemetry middleware, `publicProcedureWithTelemetry`, and the `WithTelemetry` helper now live in the same file as the router tree. Five files became four; the lowercase outlier filename is gone.
- **`BaseRouterContext` intersects the framework type** instead of redeclaring `telemetry?` / `signal?`. Future framework fields land automatically.
- **`WebviewController` renamed to `WebviewControllerBase`.** Removes the same-name shadow against the framework class, which was confusing in stack traces and Ctrl+Click navigation. Two view controllers updated.
- **`configuration.ts` added** as the single home for consumer-owned knobs: telemetry namespace and prefixes, bundle layout, dev-server host. The three telemetry prefixes are derived from one constant, so renaming the namespace is a one-line change.
- **README signpost added** at the folder root with a "When you want to X, edit Y" table and the per-view router convention paragraph.
- **Skill docs updated**: `webview-trpc-messaging`, `react-webview-architecture`, and the reference guidelines now match the new folder shape and class name.

## Key decisions and rationale

### Keep the package as a strict transport, not a UX kit

Earlier in the branch we explicitly tightened the package surface (commit `feat(packages)!: tighten vscode-ext-react-webview to pure transport`). Accessibility helpers (`Announcer`, `useSelectiveContextMenuPrevention`) were re-homed to the extension's `src/webviews/components/`, not the package. This PR keeps that boundary: every package addition (`TypedEventSink`, `errorLink`, `safePostMessage`) is either pure transport plumbing or a strictly composable utility that does not import a UI library or take a UX policy. UX helpers stay in the starter kit and in consumer code.

The reason: a UX kit grows fast and accumulates opinions that not every consumer shares. A transport package is easy to maintain, easy to review, and easy to adopt. The starter kit is the place where opinions live.

### Pick `_integration/` for the consumer folder, not `webviewIntegration/`

Both candidates beat `api/`, which is too generic in this repo (could mean the extension's public API, a REST/data API layer, or the package API). Between the two, `_integration/` won because:

- It sorts first under `src/webviews/` (VS Code's file explorer treats the `_` prefix as "infrastructure"); `webviewIntegration/` sorted last among siblings.
- It is shorter; we are already inside `webviews/`, so the `webview` prefix is redundant.
- The underscore prefix is the conventional "infrastructure, not feature code" signal in JavaScript monorepos.

Cost: another mechanical rename + 16 import lines rewritten, plus updating the starter-kit issues that referenced the previous name. The team explicitly decided this cost was worth paying before the package ships rather than living with two churned renames in two consumers later.

### Keep `appRouter.ts` filename, not `webviewRouter.ts`

`appRouter` is the idiomatic tRPC vocabulary. Both humans and coding agents trained on tRPC docs pattern-match on the name immediately. A proposed `baseAppRouter.ts` rename was rejected because the file is the concrete root router, not an abstract base class; the `Base` suffix would imply a non-existent inheritance hierarchy.

### Keep `useTrpcClient.ts` as its own file, do not inline into `appRouter.ts`

An earlier draft of the consumer reshape proposed merging the 6-line `useTrpcClient.ts` into `appRouter.ts`. Rejected: the `useX` filename matches the React-hook naming every React developer recognizes, and keeping it separate preserves a clean line between host-side router code and browser-side glue. The cost of the standalone file is one extra import line per consumer; the benefit is a clearer boundary.

### Drop the proposed sentinel banner comments (R3)

An earlier draft proposed adding "configure here" sentinel banner comments around customization knobs. Rejected once `configuration.ts` was accepted: that file _is_ the "customize here" signpost. Banner comments inside other files would just be another place to drift out of sync.

### `commonRouter` keeps using raw `publicProcedure`, not `publicProcedureWithTelemetry`

The `reportEvent` and `reportError` procedures fire their own named telemetry events inside the handler. Wrapping them in `publicProcedureWithTelemetry` would emit a generic `documentDB.rpc.mutation.common.reportError` envelope in addition to the meaningful `documentDB.webview.error.{webviewName}` event. The envelope adds volume without signal, so the choice was preserved. Verified that no double-reporting bug existed pre-merge.

### Per-panel tRPC instances (Cosmos DB's choice) not adopted

The partner extension uses one tRPC instance per panel type (`QueryEditor`, `Document`, `Migration`), each typed to its exact `RouterContext`. This eliminates the `ctx as RouterContext` cast at every procedure handler. Considered, rejected: the boilerplate cost (per-instance middleware rebinds, per-instance `buildCommonRouter` factory, per-panel hook types) is real, and our `WithTelemetry` intersection covers the practical part of the type-safety win. Worth revisiting only if a future consumer requests it.

### Type-only `AppRouter` import documented, no `types.ts` boundary file added

Cosmos DB carries a `src/webviews/api/types.ts` that re-exports server-side router types for webview-side import. Rejected for our shape: the host-vs-client boundary is already visible by import path (`/server` vs default entry), and pure type-only imports are erased at compile time. The rule is documented in the package README (Advanced subsection: "Importing the router type into webview code") and that is enough.

### Centralised routers/schemas folders (Cosmos DB's choice) not adopted

Cosmos DB centralises all routers under `panels/trpc/routers/` and all schemas under `panels/trpc/schemas/`. Rejected: we explicitly prefer co-location with the view (per-view router files live next to their views). The centralised pattern wins for codebases with many shared schemas; we have none yet. If shared shapes emerge, lifting them later is a small refactor.

### Generic command-dispatch procedure (Cosmos DB's migration shortcut) not adopted

Cosmos DB's `MigrationAssistantTab` exposes a single `command({commandName, params})` mutation that dispatches to a host-side switch. It is an explicit transition tool from the legacy channel-based protocol; throws away tRPC's type safety. We have no legacy channel code to migrate from, so this pattern would only dilute the package's value proposition. Documented as anti-pattern in the analysis notes; not exposed via the package.

### Six commits, atomic and reviewable

The consumer reshape was decomposed into six independently green commits (signpost README, merge trpc.ts, extend `BaseRouterContext`, rename to `WebviewControllerBase`, add `configuration.ts`, rename folder to `_integration/`). Each commit kept all five PR checklist steps (`npm run l10n`, `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage`, `npm run build`) green. Reviewers can walk the history step by step; reverting any single commit is safe.

### Package additions decoupled from the reshape

The four package additions (`TypedEventSink`, `errorLink`, `safePostMessage` guard, README quick start) were landed as separate follow-up commits _after_ the consumer reshape. The reshape is purely mechanical and could ship on its own; the package additions are additive features that the preview-stage package is willing to take. This decoupling means each can be reverted independently if it bakes poorly during the preview window.

## Verification

Final PR checklist before opening this PR, all green:

- `npm run l10n` no-op.
- `npm run prettier-fix` no rewrites.
- `npm run lint` clean (only the pre-existing `webpack.config.views.js` ESLint env warning).
- `npx jest --no-coverage` 96 suites, 1952 tests, 4 snapshots.
- `npm run build` clean across all workspaces.

## Follow-up

Tracked outside this PR:

- **Starter kit migration**: five issues opened in [tnaum-ms/vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit/issues) (#2 through #6) covering install, reshape, docs refresh, accessibility documentation, and the migration guide for existing starter-kit users. A sixth issue (#7) tracks adding a `TypedEventSink` example to the demo view.
- **Cosmos DB analysis**: a local analysis doc at `docs/analysis/vscode-cosmosdb-webview-divergences.md` (gitignored) walks 11 divergences with adopt-now / defer / never recommendations. Useful background if Cosmos DB later asks for a migration plan.
- **npm publish**: still preview (`0.8.0-preview`). The package has never been published. Publishing is gated on at least the starter kit catching up (issues 1 to 5) and one external smoke test.
- **Optional consumer cleanup**: a small follow-up could move the two `commonRouter` procedures without their own telemetry events (`displayErrorMessage`, `openUrl`) onto `publicProcedureWithTelemetry` to get baseline rpc-level traces. Not done in this PR to keep the scope tight.

## File layout (end state)

```
packages/vscode-ext-react-webview/
  README.md                                    quick start + advanced
  src/
    extension-server/
      BaseRouterContext.ts
      TypedEventSink.ts                        NEW
      TypedEventSink.test.ts                   NEW
      WebviewController.ts                     safePostMessage added
      index.ts
      trpc.ts
    webview-client/
      WebviewContext.tsx
      errorLink.ts                             NEW
      errorLink.test.ts                        NEW
      index.ts
      useConfiguration.ts
      useTrpcClient.ts                         onError option added
      vscodeLink.test.ts
      vscodeLink.ts

src/webviews/_integration/
  README.md                                    signpost
  WebviewControllerBase.ts                     renamed from WebviewController
  WebviewRegistry.ts
  appRouter.ts                                 trpc.ts merged in
  configuration.ts                             NEW
  useTrpcClient.ts
```
