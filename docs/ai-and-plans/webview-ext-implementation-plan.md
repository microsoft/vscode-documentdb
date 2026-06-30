# Implementation plan: `@microsoft/vscode-ext-webview` redesign + migration

**Audience:** an autonomous coding agent.
**Source of truth for the API:** [webview-rpc-package-decoupling-design.md](./webview-rpc-package-decoupling-design.md) **§13 (Decisions summary)**. Where this plan and §13 disagree, **§13 wins**; stop and flag the conflict.
**Date:** 2026-06-29.

This plan reshapes the preview webview package into the layered design locked in
§13, renames it, and migrates the `vscode-documentdb` extension onto it. The old
package is deleted only after the migration is green.

---

## 0. How to use this plan

- Execute phases **A → G in order**. Within a phase, execute work items (WI-xx)
  in listed order.
- Each work item is **one commit** (plus follow-up commits for fixes; see rules).
- Every work item has a **"Done when"** checkpoint list. Do not start the next
  work item until the current one's checkpoints all pass.
- The API names, subpaths, and tiers are fixed by §13.4. Do not invent names.
- **Before any work:** run the preflight sync with `main` (WI-A0).
- **After every work item:** append a progress-log entry (§8) and include it in
  that work item's commit. This is the resume trail if the session dies (§1.7).
- **Delegate context-heavy work to subagents** per §1.6.

---

## 1. Operating rules (mandatory)

### 1.1 Persistence and the confidence gate

- **Do not abort.** Keep working until every checkpoint in the Definition of
  Done (§Definition of Done) is reached.
- **Stop and ask the operator only when your confidence in the next action is
  below 80%**, specifically when:
  - the design intent is ambiguous and §13 does not resolve it;
  - a checkpoint fails and you cannot fix it in a bounded follow-up commit;
  - an action is destructive or irreversible beyond what this plan authorises;
  - a test whose name starts with `TDD:` fails (repo rule: never auto-fix a
    `TDD:` contract; ask);
  - the migration appears to require changes an order of magnitude larger than
    this plan estimates.
- When you stop, post: what you were doing, the failing checkpoint or ambiguity,
  options considered, and your recommended next step.

### 1.2 Commits (review-friendly, no mega-commit)

- **One work item = one commit.** Never bundle multiple work items into a single
  commit. Never make one big commit with everything.
- Use Conventional Commit messages scoped to the package or consumer, e.g.
  `refactor(webview-ext): extract attachTrpc dispatcher`,
  `feat(webview-ext): add openWebview factory`,
  `docs(webview-ext): quick-start README`,
  `chore(documentdb): migrate _integration to @microsoft/vscode-ext-webview`.
- Commit only after that work item's **per-commit verification** (§1.4) passes.

### 1.3 Fixes are follow-up commits (no rewrites)

- When an error or a failing checkpoint is found **after** a commit, fix it in a
  **new follow-up commit** (e.g. `fix(webview-ext): correct ./react export map`).
- **Never** `git commit --amend`, **never** rebase/squash/rewrite history,
  **never** force-push. The history is the review trail.

### 1.4 Tiered verification (fast commits, full checks at milestones)

Running the whole PR checklist on every commit is too slow. Use two tiers.

**Per commit (fast, every commit):**

- `npm run lint` on every commit. Lint plays the same correctness role as the
  build but is cheap, so it is the standing per-commit gate (the heavy repo-wide
  build is deferred to milestones). "Lint is like build, run it often."
- **Scoped tests only.** Run Jest limited to the files or folder you touched,
  e.g. `npx jest <path/to/area>` (or the `runTests` files filter). Do **not**
  run the full suite on every commit.
- For a commit that touches the package, the **local** `tsc` typecheck
  (`npm run build` inside `packages/vscode-ext-webview/`, which is fast) is fine
  to confirm the package still compiles. The **repo-wide** build stays a
  milestone check.

**At milestones and before declaring Done (full):**

- `npm run build` (full repo build, all workspaces).
- `npx jest --no-coverage` (full suite).
- `npm run prettier-fix`.
- `npm run l10n` (only if user-facing strings changed; otherwise skip).

**Milestones** (run the full set):

- end of **Phase C** and **Phase D** ("the new webview API package is ready");
- end of **Phase E** (extension migration complete);
- immediately **before and after Phase F** (the deletion);
- the final **Definition of Done** gate.

If a milestone full-run surfaces an error, fix it in a **follow-up commit**
(never an amend) and re-run that milestone's full set until green.

> Throughout the per-work-item "Done when" checkpoints below, phrases like
> "build + tests green" mean the **per-commit tier** (lint + scoped tests +
> the fast local package compile). The full repo build and full suite are owed
> only at the milestones above.

### 1.5 Git safety

- Work on the current feature branch (or a dedicated branch off it). **Never
  commit to `main`.**
- **Never** `git add -f`. If `git add` reports a path is ignored
  (`docs/plan/`, `docs/analysis/`, build output), stop and report; do not force.
- Do not push, open PRs, or delete branches unless the operator asks.
- Terminology: **DocumentDB**, never "MongoDB" alone (repo rule), in any new
  strings, comments, or docs.
- Documentation style: **no em dashes (`—`) and no en dashes (`–`)** in any docs
  you author (package `README.md`, `ADVANCED.md`, the migration manual). Use
  plain ASCII punctuation only (commas, parentheses, colons; the word "to" for
  ranges).

### 1.6 Subagents (keep the main context clean)

Subagents run with an **isolated context** and return only a concise summary.
Use them for **read-heavy or output-heavy, self-contained** tasks so their
transient detail (file dumps, multi-thousand-line build/test output, doc diffs)
never enters and bloats the main thread. A bloated main context degrades
long-horizon coherence across 20+ commits, so this is a correctness measure, not
just tidiness.

Rules:

- Give a subagent a **complete, self-contained prompt** (it cannot see this
  conversation) and ask for a **short structured summary**.
- Prefer the read-only **Explore** agent for pure research/inspection; use a
  general subagent for tasks that also run commands.
- Keep **public-API design and cross-cutting implementation in the main agent**:
  the evolving API shape (names, generics, exports) must stay in the main
  context to remain coherent between work items.

Recommended split:

| Task                                                                  | Subagent?     | Why                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory every consumer call site before Phase E                     | Yes (Explore) | Many file reads; only a concise call-site list returns.                                                                                                                             |
| Milestone full verification (full build + full jest) + failure triage | Yes           | Output is thousands of lines; subagent returns pass/fail plus a short failure digest.                                                                                               |
| Documentation parity audit (old README vs new README + `ADVANCED.md`) | Yes (Explore) | Reads two large docs to diff topic coverage; returns a gap list only.                                                                                                               |
| Final Definition-of-Done audit (greps, parity, checklist)             | Yes           | Bundles many read-only checks into one pass/fail report.                                                                                                                            |
| External research (re-checking Cosmos patterns, tRPC docs)            | Yes (Explore) | Web/repo reading; a summary suffices.                                                                                                                                               |
| Implementing a Phase C API module                                     | Main agent    | API coherence must live in the main thread. A subagent is allowed only if the module is fully specified by §13, and the main agent then reads the produced files before continuing. |
| README / `ADVANCED.md` prose                                          | Main agent    | Needs the evolving API in working memory and must hit the parity bar (Phase D).                                                                                                     |
| Per-commit scoped tests                                               | Main agent    | Fast; the result is needed inline.                                                                                                                                                  |

Record each subagent's outcome in the relevant work item's progress-log entry.

### 1.7 Progress log and resumability

After **every** work item, before moving on:

1. Append an entry to the **Progress log (§8)** using the template there: WI id,
   status, a one-to-three line summary of what was done, the checks that ran,
   and a **Deviations** field.
2. If you deviated from this plan in any way, the Deviations field must record
   **what** changed, **why**, **which alternatives** you considered, and **why**
   you chose this one. If there was no deviation, write "None."
3. **Include the progress-log edit in that work item's commit** (each commit
   carries its own journal entry; no separate commit, no amend). The only
   exception is the WI-A0 merge commit, which cannot carry file edits: fold its
   entry into WI-A1's commit.

**Resuming after a failure or in a new session:** (a) run the preflight sync
(WI-A0); (b) read §8 and `git --no-pager log --oneline` to find the last
completed work item; (c) confirm the working tree is clean and that work item's
checks are green; (d) continue from the next work item. The progress log plus
the commit history are the single source of "where we are."

---

## 2. Strategy: build beside, migrate, then delete

To keep the extension building at all times:

1. **Phases A–D** build the new package at `packages/vscode-ext-webview/` as a
   **copy-and-evolve** of the old one. The old `packages/vscode-ext-react-webview/`
   stays untouched and the extension keeps importing it.
2. **Phase E** migrates the extension to the new package and names.
3. **Phase F** deletes the old package once everything is green.
4. **Phase G** drafts the internal migration manual.

At no point between phases should the extension be unbuildable.

---

## 3. Phases and work items

> Legend for each WI: **Goal**, **Steps**, **Commit**, **Done when** (checkpoints).

### Phase A — Scaffold the new package

**WI-A0 — Preflight: start from the latest `main`.**

- Goal: begin on top of the newest `main` so the rework does not diverge from a
  stale base.
- Steps: ensure you are on the working branch that contains this plan and the
  design doc. `git fetch origin`, then **merge** `origin/main` into the working
  branch (`git merge origin/main`); do **not** rebase or rewrite history.
  Resolve any conflicts (favouring the design/plan docs in `docs/ai-and-plans/`).
  Run `npm install`.
- Commit: the merge commit produced by `git merge origin/main` (no separate code
  commit). If the branch is already current with `origin/main`, no merge commit
  is created, which is fine.
- Done when: the branch contains the latest `origin/main`; `npm install`
  succeeds; the repo builds and lints clean on the synced base (full milestone
  verification, §1.4); §8 has a WI-A0 entry (folded into WI-A1's commit).

**WI-A1 — Copy the package into the new folder.**

- Goal: a building copy at `packages/vscode-ext-webview/`, old package still intact.
- Steps: copy `packages/vscode-ext-react-webview/` to `packages/vscode-ext-webview/`
  with `git mv`-style copy (use `cp -R` then `git add`, since the original must
  remain). Ensure the workspace globber in the root `package.json` picks it up
  (it should via `packages/*`); run `npm install` so the workspace symlink is created.
- Commit: `chore(webview-ext): scaffold vscode-ext-webview as a copy`.
- Done when: `npm install` succeeds; old package builds; new package builds
  (`npm run build` in the new folder); extension still builds against the old one.

**WI-A2 — Rebrand package metadata.**

- Goal: new identity and version, no behavior change.
- Steps: in `packages/vscode-ext-webview/package.json` set `name` to
  `@microsoft/vscode-ext-webview`, `version` to `0.9.0-preview`, update
  `repository.directory` to `packages/vscode-ext-webview`, and update the
  `description` to reflect "transport + optional panel facade" (drop the
  React-centric wording). Leave `exports` for the next WI.
- Commit: `chore(webview-ext): rename package to @microsoft/vscode-ext-webview@0.9.0-preview`.
- Done when: new package builds; `npm ls @microsoft/vscode-ext-webview` resolves
  in the workspace; old package and extension still build.

### Phase B — Restructure to the four-subpath layout

Target source layout (folders map to subpaths per §13.2):

```
packages/vscode-ext-webview/src/
  index.ts      -> "."        shared
  host.ts       -> "./host"
  webview.ts    -> "./webview"
  react.ts      -> "./react"
  shared/       wire types, TypedEventSink, BaseRouterContext, initWebviewTrpc, tRPC re-exports
  host/         attachTrpc, WebviewController, openWebview, middleware/ (bodies + adapters)
  webview/      connectTrpc, events (createEventChannel/RpcEventChannel), vscodeLink, errorLink
  react/        useTrpcClient, useRpcEvents, WebviewContext, useConfiguration
```

**WI-B1 — Create the shared entry and move shared code.**

- Goal: `./` is side-agnostic (no `vscode`, no React).
- Steps: create `src/shared/`. Move `BaseRouterContext.ts` and `TypedEventSink.ts`
  there. Extract the wire-protocol types (`VsCodeLinkRequestMessage`,
  `VsCodeLinkResponseMessage`, `StopOperation`, etc.) out of `vscodeLink.ts` into
  `src/shared/wireProtocol.ts`. Create `src/index.ts` re-exporting the shared
  surface. Fix imports across the package.
- Commit: `refactor(webview-ext): introduce shared entry (wire types, TypedEventSink, BaseRouterContext)`.
- Done when: package builds; `import {} from '.'` exposes only side-agnostic
  symbols; no `vscode`/`react` import is reachable from `src/index.ts`
  (verify by grep on the shared subtree).

**WI-B2 — Create the host entry and move host code.**

- Goal: `./host` holds extension-host code.
- Steps: create `src/host/`. Move `WebviewController.ts` and `trpc.ts` here as a
  starting point (they get reshaped in Phase C). Create `src/host.ts` re-exporting
  the host surface. Fix imports.
- Commit: `refactor(webview-ext): introduce host entry`.
- Done when: package builds; tests pass; `./host` resolves.

**WI-B3 — Create the webview + react entries and split React out.**

- Goal: `./webview` is framework-agnostic; `./react` is the only React importer.
- Steps: create `src/webview/` (move `vscodeLink.ts`, `errorLink.ts`) and
  `src/react/` (move `WebviewContext.tsx`, `useConfiguration.ts`, `useTrpcClient.ts`).
  Create `src/webview.ts` and `src/react.ts` entries. Fix imports.
- Commit: `refactor(webview-ext): split framework-agnostic webview entry from react entry`.
- Done when: package builds; `./webview` has no `react` import (grep);
  `./react` compiles.

**WI-B4 — Wire the exports map and optional React peer.**

- Goal: package.json reflects the four subpaths.
- Steps: set `exports` for `.`, `./host`, `./webview`, `./react` (each with
  `types` + `default` pointing at `dist/*.js` / `dist/*.d.ts`); update
  `typesVersions`; mark `react` as `optional` in `peerDependenciesMeta`; keep
  `@trpc/*` peers and `vscode-webview` optional peer.
- Commit: `chore(webview-ext): export ./host, ./webview, ./react subpaths`.
- Done when: `npm run build` emits all four entry `.js` + `.d.ts`; a scratch
  type-only import of each subpath compiles; old package and extension still build.

### Phase C — Implement the new API (one work item per capability)

> Each WI here changes/adds public API per §13.4 and ships/updates Jest tests.
> Retire old symbols in the same WI that replaces them.

**WI-C1 — `initWebviewTrpc<TContext>()` typed init (shared).**

- Goal: consumer-owned, context-typed tRPC root that removes the `ctx as T` cast.
- Steps: add `src/shared/initWebviewTrpc.ts` returning
  `{ router, publicProcedure, createCallerFactory }` (and any helpers §13.6
  implies) bound to `TContext extends BaseRouterContext`. Re-export `router` /
  `publicProcedure` from `.`. Add tests.
- Commit: `feat(webview-ext): add initWebviewTrpc typed-init helper`.
- Done when: a test router built via `initWebviewTrpc<Ctx>()` infers `ctx` with
  no cast; package build + tests green.

**WI-C2 — Telemetry: middleware bodies + adapters (host); retire old model.**

- Goal: instance-agnostic telemetry per §13.5.
- Steps: add `src/host/middleware/` with `types.ts`
  (`ProcedureInvocation`, `ProcedureType`, `MiddlewareResultLike`),
  `loggingMiddleware.ts` (`ProcedureLogger`, `loggingMiddlewareBody`,
  `consoleProcedureLogger`), `telemetryMiddleware.ts` (`TelemetryRunner`,
  `telemetryMiddlewareBody`). **Remove** `createMiddleware`,
  `publicProcedureWithTelemetry`, and the `TelemetryContext` type from the
  package. Add tests for both bodies (success / error / aborted paths).
- Commit: `feat(webview-ext)!: replace bound telemetry with middleware bodies + adapters`.
- Done when: tests cover logger + runner; no reference to the removed symbols
  remains in the package (grep); build + tests green.

**WI-C3 — Extract `attachTrpc` (host primitive).**

- Goal: a free `attachTrpc(panel, ctx, router, createCallerFactory)` that owns
  the dispatch pump; `WebviewController` calls it.
- Steps: move the message-pump logic (the four handlers, `safePostMessage`,
  `toAsyncIterator`, abort/subscription lifecycle) out of `WebviewController`
  into `src/host/attachTrpc.ts`, returning
  `{ disposable, activeOperations, activeSubscriptions }`. Refactor
  `WebviewController.setupTrpc()` to call `attachTrpc` and register the
  disposable. Accept a consumer `createCallerFactory` (default to the one from
  an internal `initWebviewTrpc` instance when omitted). Port/extend the existing
  dispatch tests to target `attachTrpc` directly.
- Commit: `refactor(webview-ext): extract attachTrpc dispatcher from WebviewController`.
- Done when: `attachTrpc` has direct unit tests; `WebviewController` behavior is
  unchanged (existing tests green); build green.

**WI-C4 — Event channel + `errorLink` shim (webview).**

- Goal: `createEventChannel()` / `RpcEventChannel` (`onSuccess`/`onError`/`onAborted`).
- Steps: add `src/webview/events.ts` (`createEventChannel`, `RpcEventChannel`,
  `RpcEventEmitter`, handler types). Refactor `errorLink` into a thin shim that
  publishes into a channel. Add tests (snapshot-iteration safety, abort vs error
  separation).
- Commit: `feat(webview-ext): add createEventChannel and refit errorLink as a shim`.
- Done when: channel tests green; `errorLink` still satisfies its existing tests;
  build green.

**WI-C5 — `connectTrpc` (webview primitive).**

- Goal: `connectTrpc(vscodeApi, options?) -> { client, events }` bundling
  `createEventChannel` + `vscodeLink` + `errorLink` + the default
  `send`/`onReceive` wiring.
- Steps: add `src/webview/connectTrpc.ts`. Add tests (client wired, events
  surfaced, abort path).
- Commit: `feat(webview-ext): add connectTrpc webview client factory`.
- Done when: a test drives a query through `connectTrpc` and observes a channel
  event; build + tests green.

**WI-C6 — Split hooks (react), built on `connectTrpc`.**

- Goal: `useTrpcClient()` returns the client; `useRpcEvents()` returns the
  channel; one memoised instance per webview.
- Steps: refactor `react/useTrpcClient.ts` to return the client only; add
  `react/useRpcEvents.ts`; both read from a single per-`vscodeApi` memoised
  `connectTrpc` result. Update/replace hook tests.
- Commit: `feat(webview-ext)!: split useTrpcClient (client) and useRpcEvents (channel)`.
- Done when: both hooks return values from the same instance (test asserts
  identity stability); build + tests green.

**WI-C7 — Factory `openWebview` + options-bag constructor (host).**

- Goal: the greenfield front door returning a `WebviewController` instance;
  modernise the class constructor to a single options object.
- Steps: change `WebviewController`'s constructor to accept one options object
  (`{ extensionContext, title, viewType, router, createCallerFactory, context,
config, sourceLayout, devServerHost, telemetry?, icon?, viewColumn? }`). Add
  `src/host/openWebview.ts` implemented as `return new WebviewController(...)`.
  Default `telemetry` to `consoleProcedureLogger`. Add tests for the factory and
  the new constructor shape.
- Commit: `feat(webview-ext)!: add openWebview factory and options-bag WebviewController`.
- Done when: factory opens a panel and returns a handle exposing `panel`,
  `onDisposed`, `revealToForeground`, `dispose`, `isDisposed`; build + tests green.

### Phase D — Documentation

> **Documentation bar (no regression).** The new package docs must be **at least
> as detailed as the current `packages/vscode-ext-react-webview/README.md`**, and
> may exceed it. Treat that file as the floor: every topic it covers
> (architecture, quick start, entry points, peer dependencies, scope, and each
> Advanced subsection: sharing a single client, the webview-side error/event
> observer, push events with `TypedEventSink`, and the type-only router import
> rule) must survive into the new `README.md` and/or `ADVANCED.md`, updated to
> the new names, subpaths, and the factory front door. Reorganise freely, but do
> not lose depth.
>
> **Style.** No em dashes (`—`) and no en dashes (`–`) anywhere in the package
> docs; plain ASCII punctuation only.

**WI-D1 — README: quick path + behind-the-scenes (SEO) + advanced link.**

- Goal: a README that leads with the simplest path and is discoverable.
- Steps: rewrite `packages/vscode-ext-webview/README.md`:
  - **Quick start (the quick path):** the factory `openWebview` four-file
    example (router via `initWebviewTrpc`, open the panel, render with
    `WithWebviewContext`, call `useTrpcClient`).
  - **Behind the scenes (advanced, optional):** a short section that _names_ the
    primitive/embedding capabilities for searchability — bring-your-own-panel,
    `attachTrpc`, `connectTrpc`, framework-agnostic `./webview` client, pluggable
    telemetry via `TelemetryRunner`/`ProcedureLogger`, push events via
    `TypedEventSink` — each one sentence, then a prominent link to
    `ADVANCED.md`.
  - Entry-points table for `.`, `./host`, `./webview`, `./react`. Plain ASCII:
    no em dashes and no en dashes.
- Commit: `docs(webview-ext): quick-start README with advanced signpost`.
- Done when: README compiles in a markdown linter if one runs; the quick-start
  snippets reference only real, shipped symbols (cross-check against §13.4); the
  README plus `ADVANCED.md` together cover every topic in the old
  `vscode-ext-react-webview/README.md` with no loss of detail; a grep of the
  file for `—` and `–` finds nothing.

**WI-D2 — `ADVANCED.md`: the behind-the-scenes manual.**

- Goal: the deep documentation the README links to.
- Steps: add `packages/vscode-ext-webview/ADVANCED.md` covering: the three tiers
  and when to use each; bring-your-own-panel with `attachTrpc`; consumer-owned
  tRPC instance and `createCallerFactory`; telemetry adapters with a worked
  `TelemetryRunner`; the event channel; push events with `TypedEventSink`; the
  framework-agnostic `connectTrpc` path; the type-only `AppRouter` import rule.
- Commit: `docs(webview-ext): add ADVANCED.md`.
- Done when: every symbol referenced exists in the package; links resolve; the
  Advanced topics from the old README (share-a-single-client, error/event
  observer, push events, type-only import) are all present at equal or greater
  depth; a grep for `—` and `–` finds nothing.

### Phase E — Migrate `vscode-documentdb` onto the new package

**WI-E1 — Migrate the `_integration/` layer.**

- Goal: `src/webviews/_integration/` uses the new package + names.
- Steps: update `appRouter.ts` and `trpc.ts` to build the router via
  `initWebviewTrpc<BaseRouterContext>()` and wire telemetry through
  `telemetryMiddlewareBody` + a DocumentDB `TelemetryRunner` adapter (wrapping
  `callWithTelemetryAndErrorHandling`) instead of `createMiddleware` /
  `publicProcedureWithTelemetry`. Update `WebviewControllerBase.ts` to extend the
  new `WebviewController` (options-bag constructor) imported from
  `@microsoft/vscode-ext-webview/host`. This is the **class-first** step (the
  smallest, safest diff onto the new package); the factory adoption follows in
  WI-E4.
- Commit: `chore(documentdb): migrate _integration to @microsoft/vscode-ext-webview`.
- Done when: extension builds; webviews still open and round-trip a tRPC call in
  a manual smoke (or existing integration tests pass).

**WI-E2 — Migrate consumer imports and hooks.**

- Goal: all component/entry imports use the new subpaths and split hooks.
- Steps: update `src/webviews/index.tsx` and the `useConfiguration` /
  `WithWebviewContext` imports from `.` to `./react`. Update any
  `useTrpcClient` consumers to the client-first shape; add `useRpcEvents` where a
  central error/observer existed. Update `src/webviews/_integration/useTrpcClient.ts`.
- Commit: `chore(documentdb): point webview consumers at ./react and split hooks`.
- Done when: extension builds; lint + jest green; grep for the old subpath
  imports returns nothing.

**WI-E3 — Flip the dependency.**

- Goal: the extension depends on the new package only.
- Steps: in the root `package.json`, replace the `@microsoft/vscode-ext-react-webview`
  dependency with `@microsoft/vscode-ext-webview`; `npm install`; ensure webpack
  resolves it. Grep the whole `src/` for the old specifier and fix any stragglers.
- Commit: `chore(documentdb): depend on @microsoft/vscode-ext-webview`.
- Done when: full milestone verification (§1.4) green; `grep -r "vscode-ext-react-webview" src/`
  is empty.

**WI-E4 — Adopt the `openWebview` factory for panel controllers.**

- Goal: the extension dogfoods the greenfield factory; construction-only
  controllers become factory calls (the class path was just the safe landing).
- Steps:
  - Add a consumer preset `src/webviews/_integration/openAppWebview.ts` (the
    factory equivalent of `WebviewControllerBase`): a thin function that calls
    `openWebview(...)` pre-filling the DocumentDB router, `createCallerFactory`,
    the `TelemetryRunner`, and the bundle / dev-server layout, and returns the
    `WebviewController` handle.
  - For each panel controller that is **construction-only** (no instance state,
    no externally-called methods beyond `panel` / `onDisposed` /
    `revealToForeground` / `dispose` / `isDisposed`), replace
    `class X extends WebviewControllerBase` with a factory function (e.g.
    `openCollectionViewPanel(...)`) that derives config + context and calls
    `openAppWebview(...)`. Update call sites (`new X(...)` becomes `openX(...)`);
    the returned handle keeps `onDisposed` / `revealToForeground` working.
  - Leave any genuinely **stateful / method-rich** controller on the class path
    (extending the new `WebviewController`); that is a supported outcome, not a
    failure.
  - If nothing still extends `WebviewControllerBase` after conversion, delete
    `WebviewControllerBase.ts`; otherwise keep it for the stateful controllers.
- Commit: `chore(documentdb): adopt openWebview factory for panel controllers`.
- Done when: each converted view opens and round-trips a tRPC call; call sites
  use the factory; `grep` for `extends WebviewControllerBase` matches only
  intentionally-stateful controllers (or nothing); scoped tests + lint green.

### Phase F — Delete the old package

**WI-F1 — Remove `vscode-ext-react-webview`.**

- Goal: the old package is gone with zero dangling references.
- Steps: delete `packages/vscode-ext-react-webview/`. Remove any explicit
  workspace/tsconfig path references. `npm install`. Grep the entire repo
  (excluding this plan, the design doc, and the migration manual) for both the
  package name and the old folder path; resolve any hits.
- Commit: `chore: remove deprecated @microsoft/vscode-ext-react-webview package`.
- Done when: full milestone verification (§1.4) green; `grep -rn "vscode-ext-react-webview" .`
  returns only historical mentions in `docs/ai-and-plans/`; no build/test
  references the old package. (Not yet published, so no npm delisting needed.)

### Phase G — Internal migration manual

**WI-G1 — Draft the migration manual (unlinked, internal).**

- Goal: a reusable record of the before/after for our team and as a template for
  the Cosmos PR.
- Steps: create `docs/ai-and-plans/webview-ext-migration-manual.md`. Include:
  the old-to-new **rename map** (package, folder, subpaths, symbols); the
  telemetry-model migration (bound middleware to `TelemetryRunner` adapter); the
  hook split with before/after call sites; and **two migration paths for a
  panel-owning consumer**, each with before/after code:
  - **Path A (class):** point at the new package and have the controller extend
    the new `WebviewController` (options-bag constructor). Lowest churn; keeps
    stateful / method-rich controllers as classes.
  - **Path B (factory):** replace a construction-only controller with
    `openWebview(...)` via a consumer preset (`openAppWebview`); show the
    `new X()` to `openX(...)` call-site change and that the returned handle
    preserves `onDisposed` / `revealToForeground`.
    Document that A and B can be **sequenced** (land A first for a safe, minimal
    diff, then convert to B, as this plan does) or done in one step, and how to
    choose (construction-only goes to B; stateful stays on A). Add a short
    **embedders** note pointing at the `attachTrpc` bring-your-own-panel path for
    consumers like vscode-cosmosdb. Do **not** link it from any index, README, or
    the design doc; it is internal.
- Commit: `docs: add internal webview-ext migration manual`.
- Done when: the file exists, is self-contained, covers both paths, and is not
  referenced by any other tracked file (grep for its filename returns only
  itself).

---

## 4. Definition of Done (final checklist the agent must verify)

Declare completion only when **all** of the following hold:

1. `packages/vscode-ext-webview/` exists; `package.json` `name` is
   `@microsoft/vscode-ext-webview`, `version` is `0.9.0-preview`.
2. The package exposes exactly the subpaths `.`, `./host`, `./webview`, `./react`,
   and the public names match **§13.4** exactly (factory `openWebview`, class
   `WebviewController`, `attachTrpc`, `connectTrpc`, `createEventChannel`/
   `RpcEventChannel`, `initWebviewTrpc`, `vscodeLink`, `errorLink`,
   `loggingMiddlewareBody`/`telemetryMiddlewareBody`/`ProcedureLogger`/
   `TelemetryRunner`, `useTrpcClient`/`useRpcEvents`).
3. Retired symbols (`createMiddleware`, `publicProcedureWithTelemetry`,
   `TelemetryContext`, the old `useTrpcClient` tuple return) appear nowhere.
4. `./` imports no `vscode` and no `react`; `./webview` imports no `react`.
5. The package builds (`tsc`) and all package tests pass.
6. `packages/vscode-ext-react-webview/` is deleted; repo-wide grep for the old
   name yields only historical `docs/ai-and-plans/` mentions.
7. The extension is fully migrated; `grep -rn "vscode-ext-react-webview" src/`
   is empty. Construction-only panel controllers use the `openWebview` factory;
   any controller kept as a class is intentionally stateful.
8. Final full verification green (§1.4 milestone set): `npm run l10n` (if
   strings changed), `npm run prettier-fix`, `npm run lint`,
   `npx jest --no-coverage`, `npm run build`.
9. Package `README.md` (quick path + behind-the-scenes + ADVANCED link) and
   `ADVANCED.md` exist, reference only shipped symbols, together cover every
   topic in the old `vscode-ext-react-webview/README.md` at equal or greater
   detail, and contain no em dashes or en dashes.
10. `docs/ai-and-plans/webview-ext-migration-manual.md` exists, internal/unlinked.
11. Every work item is its own commit; all fixes are follow-up commits; no
    amends, no force-push, no history rewrite.
12. No `TDD:` test was modified to pass; if any `TDD:` test failed, the operator
    was consulted.
13. The Progress log (§8) has one entry per completed work item, each with a
    summary, the checks that ran, and a Deviations field ("None" or a documented
    deviation with alternatives and rationale).

If any item cannot be reached and your confidence in resolving it is below 80%,
**stop and request an operator decision** rather than aborting or forcing.

---

## 5. Commit ledger (expected order)

```
(preflight) merge origin/main into the working branch
chore(webview-ext): scaffold vscode-ext-webview as a copy
chore(webview-ext): rename package to @microsoft/vscode-ext-webview@0.9.0-preview
refactor(webview-ext): introduce shared entry (wire types, TypedEventSink, BaseRouterContext)
refactor(webview-ext): introduce host entry
refactor(webview-ext): split framework-agnostic webview entry from react entry
chore(webview-ext): export ./host, ./webview, ./react subpaths
feat(webview-ext): add initWebviewTrpc typed-init helper
feat(webview-ext)!: replace bound telemetry with middleware bodies + adapters
refactor(webview-ext): extract attachTrpc dispatcher from WebviewController
feat(webview-ext): add createEventChannel and refit errorLink as a shim
feat(webview-ext): add connectTrpc webview client factory
feat(webview-ext)!: split useTrpcClient (client) and useRpcEvents (channel)
feat(webview-ext)!: add openWebview factory and options-bag WebviewController
docs(webview-ext): quick-start README with advanced signpost
docs(webview-ext): add ADVANCED.md
chore(documentdb): migrate _integration to @microsoft/vscode-ext-webview
chore(documentdb): point webview consumers at ./react and split hooks
chore(documentdb): depend on @microsoft/vscode-ext-webview
chore(documentdb): adopt openWebview factory for panel controllers
chore: remove deprecated @microsoft/vscode-ext-react-webview package
docs: add internal webview-ext migration manual
```

Follow-up fix commits (`fix(...)`) are inserted as needed; they are never folded
back into the commits above.

---

## 6. Appendix A — file mapping (old to new)

| Old (`vscode-ext-react-webview/src`)             | New (`vscode-ext-webview/src`)                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `extension-server/BaseRouterContext.ts`          | `shared/BaseRouterContext.ts`                                                |
| `extension-server/TypedEventSink.ts`             | `shared/TypedEventSink.ts`                                                   |
| wire types inside `webview-client/vscodeLink.ts` | `shared/wireProtocol.ts`                                                     |
| `extension-server/trpc.ts`                       | split: `shared/initWebviewTrpc.ts` + `host/middleware/*`                     |
| `extension-server/WebviewController.ts`          | `host/WebviewController.ts` + `host/attachTrpc.ts` + `host/openWebview.ts`   |
| `webview-client/vscodeLink.ts`                   | `webview/vscodeLink.ts`                                                      |
| `webview-client/errorLink.ts`                    | `webview/errorLink.ts` (+ `webview/events.ts`, `webview/connectTrpc.ts` new) |
| `webview-client/WebviewContext.tsx`              | `react/WebviewContext.tsx`                                                   |
| `webview-client/useConfiguration.ts`             | `react/useConfiguration.ts`                                                  |
| `webview-client/useTrpcClient.ts`                | `react/useTrpcClient.ts` + `react/useRpcEvents.ts`                           |
| `src/index.ts`, `src/server.ts`                  | `src/index.ts`, `src/host.ts`, `src/webview.ts`, `src/react.ts`              |

## 7. Appendix B — operator-gate triggers (confidence < 80%)

Stop and ask when: a `TDD:` test fails; the telemetry adapter cannot wrap
`callWithTelemetryAndErrorHandling` without changing event-name semantics; a
subpath split forces a `vscode` or `react` import into a side-agnostic entry that
you cannot resolve; the extension fails a manual webview smoke after E1/E2/E4; or any
checkpoint in §Definition of Done remains red after one bounded follow-up commit.

---

## 8. Progress log (resumability journal)

Append one entry per work item, in order, as you complete it (§1.7). Include the
entry in that work item's commit. On restart, this section plus
`git --no-pager log --oneline` tell you exactly where to resume.

**Entry template:**

```
### WI-<id> - <title>  (<YYYY-MM-DD>)
- Status: done | partial (<reason>)
- Summary: <1 to 3 lines on what was implemented or changed>
- Checks: <what ran, e.g. lint + scoped tests green; or milestone full run green>
- Deviations: None.
  (If any: what changed vs the plan; why; alternatives considered; why this one.)
- Subagent: none | <task delegated and the one-line result>
```

**Entries (append below this line):**

<!-- WI-A0 onward -->

### WI-A0 - Preflight: start from the latest `main` (2026-06-30)

- Status: done
- Summary: Fetched origin and merged `origin/main` into the working branch
  `dev/tnaum/webview-api-refinements` (fast-forward, branch was 88 behind / 0
  ahead, so no merge commit). Ran `npm install`.
- Checks: `npm install` ok; `npm run lint` clean (only the pre-existing
  `webpack.config.views.js` eslint-env warning); `npm run build` green on the
  synced base. Base equals `origin/main`, already CI-green, so the full Jest
  suite was not re-run here.
- Deviations: None. (Fast-forward produced no merge commit, which the plan
  explicitly allows; this WI-A0 entry is folded into WI-A1's commit per
  the plan's exception.)
- Subagent: none.

### WI-A1 - Copy the package into the new folder (2026-06-30)

- Status: done
- Summary: Copied `packages/vscode-ext-react-webview/` to
  `packages/vscode-ext-webview/` (source only; `dist/` and
  `tsconfig.tsbuildinfo` dropped from the copy). The old package is untouched.
- Checks: `npm install` ok (both packages linked); new package `npm run build`
  green; full repo `npm run build` green (extension still builds against the
  old package); new package Jest 35/35 green; `npm run lint` clean.
- Deviations: Set the new package's `name` to the final
  `@microsoft/vscode-ext-webview` in this WI instead of waiting for WI-A2.
  Why: npm rejects two workspaces with the same name (`EDUPLICATEWORKSPACE`),
  so the copy cannot install (an explicit WI-A1 "Done when") while it shares
  the old name. Alternatives considered: (a) a throwaway placeholder name in
  WI-A1 then rename in WI-A2 - rejected as needless churn since the final name
  is known and stable; (b) merging WI-A1 and WI-A2 - rejected to preserve the
  one-WI-one-commit rule. WI-A2 still performs the rest of the rebrand
  (version, description, `repository.directory`).
- Subagent: none.

### WI-A2 - Rebrand package metadata (2026-06-30)

- Status: done
- Summary: Set `version` to `0.9.0-preview`, updated `repository.directory` to
  `packages/vscode-ext-webview`, and rewrote `description` to reflect the
  layered "transport + optional panel facade + framework-agnostic webview
  client + optional React hooks" shape (dropped the React-centric wording).
  `name` was already finalized in WI-A1. `exports` left for WI-B4.
- Checks: `npm install` ok; `npm ls @microsoft/vscode-ext-webview` resolves to
  `0.9.0-preview`; new package `npm run build` green; new package Jest 35/35;
  `npm run lint` clean; full repo `npm run build` green (old package and
  extension still build).
- Deviations: None.
- Subagent: none.

### WI-B1 - Create the shared entry and move shared code (2026-06-30)

- Status: done
- Summary: Created `src/shared/` and moved `BaseRouterContext.ts`,
  `TypedEventSink.ts`, and `TypedEventSink.test.ts` there (via `git mv`).
  Extracted the wire-protocol types (`StopOperation`,
  `VsCodeLinkRequestMessage`, `VsCodeLinkResponseMessage`) from `vscodeLink.ts`
  into `src/shared/wireProtocol.ts`. Added `src/shared/index.ts` and repointed
  `src/index.ts` (the `.` entry) at the shared surface. Fixed imports in
  `vscodeLink.ts` (imports + re-exports the wire types from shared),
  `WebviewController.ts`, `extension-server/trpc.ts`, and
  `extension-server/index.ts`.
- Checks: new package `npm run build` green; new package Jest 35/35 green;
  `npm run lint` clean; grep confirms no `vscode`/`react`/host imports in the
  `src/shared/` subtree and `src/index.ts` only re-exports `./shared`.
- Deviations: Relocated the `TelemetryContext` type definition from
  `extension-server/trpc.ts` into `shared/BaseRouterContext.ts` (its only shared
  consumer), so `trpc.ts` now imports it from shared. Why: `BaseRouterContext`
  (shared) carries a `telemetry?: TelemetryContext` field; keeping the type in
  `trpc.ts` would force a shared->host import once `trpc.ts` moves to `host/` in
  WI-B2. Co-locating it in shared keeps the dependency direction correct
  (host -> shared) and is consistent with the plan's "move shared code" intent.
  Alternative considered: leave the type in `trpc.ts` and accept a transitional
  reverse import - rejected as architecturally backwards even temporarily.
  `TelemetryContext` is still slated for retirement in WI-C2.
- Subagent: none.

### WI-B2 - Create the host entry and move host code (2026-06-30)

- Status: done
- Summary: Created `src/host/` and moved `WebviewController.ts` and `trpc.ts`
  there (via `git mv`; their `../shared/...` and `./trpc` imports stayed valid
  since `host/` sits at the same depth as the old `extension-server/`). Added
  `src/host/index.ts` (host barrel) and `src/host.ts` (the `./host` entry).
  Fully dissolved `src/extension-server/` (its `index.ts` removed; the folder is
  gone). Converted `src/server.ts` into a transitional shim re-exporting
  `./host` + `./shared` so the legacy `./server` export keeps resolving until
  WI-B4 rewires the exports map.
- Checks: new package `npm run build` green (`dist/host.js` + `dist/host.d.ts`
  emitted, so the `./host` entry compiles and resolves at the file level); new
  package Jest 35/35 green; `npm run lint` clean.
- Deviations: Kept `src/server.ts` as a temporary compatibility shim rather than
  deleting it now. Why: the package.json `exports` map still points `./server`
  at `dist/server.js` until WI-B4; deleting `server.ts` in this WI would leave a
  dangling export target. The shim is removed in WI-B4 with the exports rewire.
  Alternative considered: rewire `exports` early here - rejected because the plan
  explicitly reserves the exports map for WI-B4.
- Subagent: none.

### WI-B3 - Split framework-agnostic webview entry from react entry (2026-06-30)

- Status: done
- Summary: Created `src/webview/` (moved `vscodeLink.ts`/`errorLink.ts` and their
  tests) and `src/react/` (moved `WebviewContext.tsx`, `useConfiguration.ts`,
  `useTrpcClient.ts`) via `git mv`. Dissolved `src/webview-client/`. Added
  `src/webview/index.ts` + `src/react/index.ts` barrels and the `src/webview.ts`
  - `src/react.ts` entries. Repointed `react/useTrpcClient.ts` at
    `../webview/errorLink`, `../webview/vscodeLink`, and the wire types from
    `../shared/wireProtocol`.
- Checks: new package `npm run build` green (all four entry `.js` emitted:
  `index`, `host`, `webview`, `react`); grep confirms no `react`/`react-dom`/
  `vscode-webview` imports in `src/webview/`; new package Jest 35/35 green;
  `npm run lint` clean.
- Deviations: None.
- Subagent: none.

### WI-B4 - Wire the exports map and optional React peer (2026-06-30)

- Status: done
- Summary: Rewrote `exports` for the four subpaths (`.`, `./host`, `./webview`,
  `./react`), each with `types` + `default` pointing at `dist/*.{d.ts,js}`.
  Updated `typesVersions` for `host`/`webview`/`react`. Marked `react` as an
  optional peer in `peerDependenciesMeta` (kept `@trpc/*` peers and the optional
  `vscode-webview` peer). Removed the legacy `./server` export and deleted the
  `src/server.ts` shim.
- Checks: clean `npm run build` emits all four entry `.js` + `.d.ts`; a scratch
  type-only import of each subpath compiles under `module commonjs` /
  `moduleResolution node` (the resolution the extension uses); new package Jest
  35/35 green; `npm run lint` clean; full repo `npm run build` green (old
  package and extension still build).
- Deviations: Changed the four entry files to re-export `./<folder>/index`
  explicitly (e.g. `export * from './host/index'`) instead of `./<folder>`. Why:
  the emitted `dist/host.d.ts` (entry) is a sibling of the `dist/host/` folder,
  and node10 resolution resolves a bare `./host` to the sibling FILE
  (`host.d.ts`, i.e. itself) rather than the directory's `index.d.ts`, so every
  subpath re-export resolved to an empty self-reference and exposed no members
  (caught by the scratch-import check). The explicit `/index` disambiguates to
  the folder barrel. Alternative considered: rename the impl folders to avoid the
  file/dir name clash - rejected because the plan fixes the folder names
  (`host/`, `webview/`, `react/`). This is part of WI-B4's "subpaths resolve"
  goal, so it is not a separate follow-up commit.
- Subagent: none.

### WI-C1 - initWebviewTrpc typed-init helper (2026-06-30)

- Status: done
- Summary: Added `src/shared/initWebviewTrpc.ts`: a generic
  `initWebviewTrpc<TContext extends BaseRouterContext>()` returning
  `{ router, publicProcedure, createCallerFactory, middleware }` bound to the
  consumer's context type (via `initTRPC.context<TContext>().create()`), plus a
  default `BaseRouterContext` instance backing convenience `router` /
  `publicProcedure` / `createCallerFactory` re-exports. Exported
  `initWebviewTrpc`, `router`, `publicProcedure` (and the `WebviewTrpc` type)
  from the shared `.` barrel. Added `initWebviewTrpc.test.ts`.
- Checks: new package `npm run build` green; Jest 38/38 (3 new) green - the
  typed-init test reads `ctx.workspaceRoot` / `ctx.requestCount` with NO cast
  and compiles under ts-jest, proving context inference; grep confirms shared
  stays side-agnostic; `npm run lint` clean.
- Deviations: Left `host/trpc.ts` untouched, so the package transitionally holds
  two default tRPC instances (the new shared default and the legacy one in
  `host/trpc.ts`). Why: WI-C1's scope is strictly "add initWebviewTrpc + re-export
  router/publicProcedure + tests"; the legacy `host/trpc.ts` is retired/reshaped
  in WI-C2 (telemetry) and WI-C3 (attachTrpc default caller factory), at which
  point the host re-points to the single shared default instance and drops its
  duplicate `router`/`publicProcedure`. No consumer uses the new package's
  router builders yet, so the transient duplication is inert. Alternative
  considered: re-point `host/trpc.ts` now - rejected as WI-C2/C3 scope and it
  would entangle the (about-to-be-deleted) legacy telemetry middleware.
- Subagent: none.

### WI-C2 - Telemetry middleware bodies + adapters; retire old model (2026-06-30)

- Status: done
- Summary: Added `src/host/middleware/` with `types.ts` (`ProcedureType`,
  `MiddlewareResultLike`, `ProcedureErrorLike`, `ProcedureInvocation`,
  `getInvocationSignal`), `loggingMiddleware.ts` (`ProcedureLogger`,
  `ProcedureLogEntry`, `consoleProcedureLogger`, `loggingMiddlewareBody`),
  `telemetryMiddleware.ts` (`ProcedureTelemetry`, `TelemetryRunner`,
  `telemetryMiddlewareBody`), and an `index.ts` barrel. Removed the retired
  telemetry model: deleted `host/trpc.ts` (split per the appendix into
  `shared/initWebviewTrpc.ts` + `host/middleware/*`), dropped `createMiddleware`,
  `publicProcedureWithTelemetry`, `defaultTrpcToTelemetry`, the package
  `WithTelemetry` type, and the named `TelemetryContext` type (its shape is now
  inline on `BaseRouterContext.telemetry`). Re-pointed `WebviewController` and
  `host/index.ts` at the shared default tRPC instance (unifying the two default
  instances from WI-C1). Added body tests wired onto a real `initWebviewTrpc`
  instance.
- Checks: build green; Jest 44/44 (6 new) green - the bodies are exercised via a
  real `publicProcedure.use(...)` over success / error / aborted paths, proving
  instance-agnosticism and structural type compatibility with tRPC; word-boundary
  grep confirms no `createMiddleware` / `publicProcedureWithTelemetry` /
  `TelemetryContext` / `WithTelemetry` symbols remain in `src/`; `npm run lint`
  clean.
- Deviations: (1) The telemetry/logging split keeps the reusable orchestration
  (timing, abort detection, standard result properties) in the package bodies and
  the integration-specific scope in the consumer's `TelemetryRunner` (which wraps
  `callWithTelemetryAndErrorHandling`); the body injects the runner's bag as
  `ctx.telemetry`. This realizes "middleware bodies + adapters" from the plan; the
  exact runner signature (`run(invocation, execute)`) is an implementation choice
  the plan left open. (2) `BaseRouterContext.telemetry` keeps an inline
  `{ properties; measurements }` shape (no named `TelemetryContext` export) rather
  than being removed, to preserve the documented field shape and minimize the
  E1 migration delta; the consumer still re-types it. (3) Two doc comments
  reference `callWithTelemetryAndErrorHandling` / `ITelemetryContext` (azext-utils
  identifiers) which contain the substrings "WithTelemetry"/"TelemetryContext";
  a word-boundary grep is required to audit retired symbols. Alternatives
  considered: removing the `telemetry` field entirely - deferred since the
  consumer overrides its type anyway and removal adds migration churn.
- Subagent: none.

### WI-C3 - Extract attachTrpc dispatcher from WebviewController (2026-06-30)

- Status: done
- Summary: Added `src/host/attachTrpc.ts` exporting
  `attachTrpc(panel, context, router, callerFactory = defaultCreateCallerFactory)`
  which returns `{ disposable, activeOperations, activeSubscriptions }`. It owns
  the full webview message dispatch that previously lived inside
  `WebviewController`: `handleDefaultMessage` (query/mutation), the per-operation
  `AbortController` tracking in `activeOperations`, subscription streaming via
  `handleSubscriptionMessage` + module-level `toAsyncIterator`, `subscription.stop`
  via `handleSubscriptionStopMessage`, `abort` via `handleAbortMessage`, the
  disposed-guarded `safePostMessage`, and `wrapInTrpcErrorMessage`. It also exports
  `ActiveSubscription`, `WebviewCallerFactory`, and `AttachTrpcResult`. The module
  imports `Disposable` / `WebviewPanel` from `vscode` as TYPE-only, so it carries
  no runtime `vscode` dependency and runs under the node/jsdom jest env. Slimmed
  `WebviewController`: `setupTrpc(context)` now just calls
  `attachTrpc(this._panel, context, this._options.appRouter)` and registers the
  returned disposable; removed the `_activeOperations` / `_activeSubscriptions`
  fields and all per-message handler methods; `dispose()` fires `onDisposed` and
  disposes registered disposables (attachTrpc's disposable aborts in-flight ops and
  aborts/returns subscriptions). `host/index.ts` now re-exports `attachTrpc` + its
  types and `AnyRouter` (from `@trpc/server`). Added `src/host/attachTrpc.test.ts`
  (9 tests) driving a stub `WebviewPanel`.
- Checks: `npm run lint` clean (added the missing
  `@typescript-eslint/no-unsafe-assignment` to the two dispatcher procedure-lookup
  disable comments that were carried over verbatim from the original controller);
  Jest 53/53 (9 new) green; package `tsc --noEmit` clean; retired-symbol
  word-boundary grep (`createMiddleware` / `publicProcedureWithTelemetry` /
  `TelemetryContext`) clean; `npm run build` previously green for this refactor.
- Deviations: (1) The `subscription.stop` test asserts the reliable synchronous
  facts (the `activeSubscriptions` entry is removed and the per-operation
  `AbortController` is aborted) rather than asserting that `iterator.return()`
  releases a consumer parked in `for await`. An empirical Node probe confirmed that
  an async generator's `return()` does NOT propagate into a generator parked at its
  inner `await sink.next()`; the parked consumer is actually released when the
  producer calls `sink.close()`. That reliable path is covered by the separate
  "completes a subscription when its event sink closes" test. This matches the
  pre-existing `WebviewController` behavior, so there is no behavior change.
  (2) The two leaf test resolvers that read `ctx.signal` annotate their opts as
  `{ ctx: BaseRouterContext }` to keep typed-linting stable across the per-file and
  whole-repo ESLint programs (the `vscode` type-only import in the test can degrade
  cross-file inference); this does not affect production routers.
- Subagent: none.

### WI-C4 - Event channel + errorLink shim (2026-06-30)

- Status: done
- Summary: Added `src/webview/events.ts`. `createEventChannel()` returns an
  `EventChannel` that implements both the observe side (`RpcEventChannel`:
  `onSuccess` / `onError` / `onAborted`) and the publish side (`RpcEventEmitter`:
  `emitSuccess` / `emitError` / `emitAborted`), plus `CallInfo`, the handler types
  (`SuccessHandler` / `ErrorEventHandler` / `AbortedHandler`), and `Unsubscribe`.
  Dispatch is snapshot-safe: each `emit*` iterates over a copy of its handler set,
  so subscribing or unsubscribing during dispatch never corrupts the in-flight
  iteration. Refit `errorLink`: factored out a general publishing link
  `eventLink(emitter)` that publishes query/mutation outcomes
  (`emitSuccess` on next; `emitAborted` when `op.signal.aborted`, else `emitError`
  on error), skips subscriptions, and re-emits value/error/complete down the chain
  unchanged. `errorLink(onError)` is now a thin shim: it owns a private channel,
  bridges that channel's `onError` to the callback, and returns `eventLink(channel)`.
  Exported the channel primitive from the `./webview` barrel. Added
  `events.test.ts`.
- Checks: Jest 59/59 (7 new in `events.test.ts`) green; `errorLink`'s 7 existing
  tests unchanged and green (the refit preserves query/mutation error forwarding,
  subscription skipping, non-`Error` normalization, and success/complete
  pass-through); package `tsc --noEmit` clean; `npm run lint` clean.
- Deviations: (1) §13 lists only `vscodeLink` / `errorLink` / `createEventChannel`
  on `./webview`, so the general publisher `eventLink(emitter)` is exported from the
  `errorLink` module but NOT re-exported from the `./webview` barrel; `connectTrpc`
  (WI-C5) consumes it directly. This keeps the public subpath surface equal to the
  design's set. (2) Abort vs error classification uses `op.signal?.aborted` (true at
  error time means a cancel) rather than sniffing the tRPC error shape; this
  realizes the design's "aborts separated from errors" while keeping `errorLink`'s
  existing tests green (their ops use `signal: null`, so they classify as errors).
  (3) `errorLink`'s pre-existing "does not surface subscription errors" behavior is
  preserved inside `eventLink`, consistent with the design framing that the channel
  observes query/mutation outcomes.
- Subagent: none.

### WI-C5 - connectTrpc webview client factory (2026-06-30)

- Status: done
- Summary: Added `src/webview/connectTrpc.ts`.
  `connectTrpc<TRouter>(vscodeApi, options?)` creates an event channel, wires the
  default transport (`send` via `vscodeApi.postMessage`; `onReceive` via
  `window.addEventListener('message', ...)` with the `id` type-guard, lifted from
  the React hook), assembles a tRPC client with
  `[loggerLink(), eventLink(channel), vscodeLink({ send, onReceive })]`, and returns
  `{ client, events }` where `events` is the observe-only `RpcEventChannel`.
  `options.onError` subscribes to `channel.onError`. Added the supporting types
  `VsCodeApiLike` (structural `{ postMessage }`), `ConnectTrpcOptions`, and
  `ConnectTrpcResult`. Exported `connectTrpc` + its types from the `./webview`
  barrel. Added `connectTrpc.test.ts`.
- Checks: Jest 63/63 (4 new) green - a query is driven end-to-end through
  `connectTrpc` and observed via `events.onSuccess`; the error path surfaces
  `events.onError` and the `onError` option; an already-aborted signal surfaces
  `events.onAborted` (and not `onError`); package `tsc --noEmit` clean;
  `npm run lint` clean.
- Deviations: (1) `connectTrpc` composes `eventLink(channel)` (the full publisher
  from WI-C4), not `errorLink`, so the returned channel surfaces success / error /
  aborted (`errorLink` only bridges errors). The plan named "errorLink" loosely;
  `eventLink` is what realizes `{ client, events }` per §13. (2) The package jest env
  is `node` (no DOM) and `jest-environment-jsdom` is not installed at the repo root,
  so `connectTrpc.test.ts` installs a minimal `window` stub
  (`addEventListener` / `removeEventListener` for `'message'`) plus an echoing fake
  `vscodeApi` that replies with the request's own id; this exercises the real
  `vscodeLink` round-trip without jsdom. (3) `loggerLink` stays in the default link
  chain to preserve the prior React-hook behavior; it logs the error/abort cases to
  the console during those tests (expected, non-failing).
- Subagent: none.

### WI-C6 split useTrpcClient (client) and useRpcEvents (channel)

- Commit: `feat(webview-ext)!: split useTrpcClient (client) and useRpcEvents (channel)`.
- What: split the single React hook into two, both backed by one memoised
  connection per webview. Added `react/connection.ts` (React-free) exporting
  `getWebviewConnection(vscodeApi)`, which lazily builds and caches a
  `connectTrpc(vscodeApi)` result in a module-level `WeakMap` keyed by the
  `vscodeApi` object. Rewrote `react/useTrpcClient.ts` so `useTrpcClient()` now
  returns the client directly (was `{ trpcClient }`); dropped the `onError`
  option and the `UseTrpcClientOptions` type. Added `react/useRpcEvents.ts`
  exporting `useRpcEvents()`, returning the shared channel
  (`onSuccess` / `onError` / `onAborted`). Updated the `./react` barrel to export
  `useRpcEvents` and to stop exporting `UseTrpcClientOptions`. Added
  `react/connection.test.ts`.
- Breaking: `useTrpcClient()` return shape changed (client, not `{ trpcClient }`)
  and its `onError` option is gone; per-call error observation moves to
  `useRpcEvents().onError`. The two hooks now share one connection per webview
  rather than each component holding its own client (§13.4).
- Verification: both hooks resolve through `getWebviewConnection`, so the new
  test asserts identity stability - two calls with the same `vscodeApi` return
  the same `{ client, events }` (and the same `.client` / `.events`), while
  distinct `vscodeApi` objects get independent connections. Package suite 65
  tests across 10 suites green; package `tsc --noEmit` clean; whole-repo
  `npm run lint` clean.
- Deviations: the hooks themselves are not unit-tested directly - they cannot
  run outside React in the package's `node` jest env (no RTL/jsdom), so the
  identity-stability contract is verified against the React-free
  `getWebviewConnection` helper the hooks delegate to. Each hook body is a thin
  `useContext` + delegate wrapper.
- Subagent: none.

### WI-C7 - Factory openWebview + options-bag WebviewController  (2026-06-30)

- Status: done (Phase C milestone).
- Summary: reshaped `WebviewController` to a single options-bag constructor
  (`new WebviewController({ extensionContext, title, viewType, router,
  createCallerFactory?, context, config, sourceLayout, devServerHost?,
  telemetry?, icon?, viewColumn? })`) and added `host/openWebview.ts` -
  `openWebview(extensionContext, options)` returns `new WebviewController({
  extensionContext, ...options })`. The constructor now wires tRPC itself
  (`setupTrpc(options.context)` calls `attachTrpc` with the injected
  `createCallerFactory` and the dispatch logger). To deliver "console telemetry
  for free", `attachTrpc` gained an optional `logger?: ProcedureLogger` that
  logs one structured entry per completed query, mutation, and subscription;
  the controller defaults it to `consoleProcedureLogger`. Exported `openWebview`
  from the `./host` barrel. Added `host/openWebview.test.ts` (6 tests) and 4 new
  `attachTrpc.test.ts` logging tests. Added a runtime `vscode` stub at
  `src/testing/vscodeStub.ts` wired via the package jest `moduleNameMapper`
  (type-checking still uses `@types/vscode`).
- Checks: full milestone run green - package `tsc --noEmit` clean; package Jest
  75/75 across 11 suites; whole-repo `npm run lint` clean; whole-repo
  `npx jest --no-coverage` 2606/2606 across 149 suites; `npm run build` green.
  `npm run l10n` not run: no user-facing localized strings were added or changed
  (the controller HTML and dispatch logs are not localized).
- Deviations:
  (1) Telemetry wiring - chose active dispatch-level logging (extend
  `attachTrpc` with an optional `ProcedureLogger`) over a store-only seam. Why:
  the design doc's "console telemetry for free" / "wires the default console
  logger" promise requires the controller to actually log; a defaulted
  `telemetry` option that did nothing would be a dead option. The dispatch
  logger is a separate sink from the middleware-body telemetry (Phase E analytics
  via `telemetryMiddlewareBody`), so the two do not double-count. The plan's
  WI-C7 steps did not enumerate touching `attachTrpc`; this is the minimal way to
  honor the documented behavior, and the WI-C3 dispatch logic is otherwise
  unchanged (logging is purely additive and gated on a provided logger).
  (2) Dropped `isBundled` from the options bag (the plan's listed fields omit
  it); the bundled-vs-dev layout is now derived from
  `extensionContext.extensionMode === vscode.ExtensionMode.Production`, matching
  the `isProduction` value the HTML template already computed.
  (3) Testing the host facade needs a runtime `vscode`; added a stub under
  `src/testing/` (NOT `src/__mocks__/`) deliberately - a `__mocks__/vscode`
  file is registered as a global jest manual mock and collided with the
  extension's own vscode mock in the root multi-project run (surfaced as
  `vscode.l10n.t is not a function` across 37 extension suites). Keeping the stub
  outside `__mocks__/` and resolving it only through the package-scoped
  `moduleNameMapper` isolates it to this package's jest project.
- Subagent: none.

### WI-D1 - README: quick-start + behind-the-scenes signpost  (2026-06-30)

- Status: done.
- Summary: rewrote `packages/vscode-ext-webview/README.md` from the old
  copied-over `vscode-ext-react-webview` README to the new package. Leads with a
  factory-first four-file quick start (`initWebviewTrpc` router, `openWebview`
  to open the panel, `WithWebviewContext` to render, `useTrpcClient` returning
  the client directly). Updated the architecture diagram to ASCII and to the new
  names (`openWebview` / `attachTrpc` / subpaths). Added a "Behind the scenes
  (advanced, optional)" section that names the primitives for searchability
  (`attachTrpc` bring-your-own-panel, `connectTrpc` + `createEventChannel`
  framework-agnostic client, `errorLink` observer, `telemetryMiddlewareBody` +
  `TelemetryRunner` / `loggingMiddlewareBody` + `ProcedureLogger` telemetry,
  `TypedEventSink` push events, type-only `AppRouter` import) with prominent
  links to `ADVANCED.md`. Added a four-row entry-points table for `.`, `./host`,
  `./webview`, `./react` with side, imports, and key exports, plus an import
  cheat-sheet. Refreshed "What's inside", peer-deps (React noted as only for
  `./react`), scope, starter-kit, and status (`0.9.0-preview`). The deep Advanced
  subsections and FAQ from the old README move to `ADVANCED.md` in WI-D2; the
  README signposts them.
- Deviations: forward-links to `ADVANCED.md` which is authored next in WI-D2
  (same phase) - the link resolves once D2 lands. Diagram and tables use plain
  ASCII (`+ - | < >`) rather than box-drawing characters to honor the "plain
  ASCII punctuation only" documentation bar.
- Checks: cross-checked every referenced symbol against the shipped barrels
  (`shared/host/webview/react` index files) and §13.4 - all real; no retired
  symbol (`createMiddleware`, `publicProcedureWithTelemetry`, `TelemetryContext`)
  present; no `vscode-ext-react-webview` / `./server` references (only
  `@trpc/server` the npm package); `grep -nP "[\x{2013}\x{2014}]"` finds no
  em/en dashes; whole-repo `npm run lint` clean (docs-only change). Full milestone
  build + jest deferred to the end of Phase D (after WI-D2).
- Subagent: none.
