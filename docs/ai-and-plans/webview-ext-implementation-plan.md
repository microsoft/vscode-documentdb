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

### WI-A0 - Preflight: start from the latest `main`  (2026-06-30)

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

### WI-A1 - Copy the package into the new folder  (2026-06-30)

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

### WI-A2 - Rebrand package metadata  (2026-06-30)

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
