# PR #795: Thin telemetry middleware and generic TelemetryRunner

**PR:** [microsoft/vscode-documentdb#795](https://github.com/microsoft/vscode-documentdb/pull/795)
**Branch:** `dev/tnaum/webview-ext-thin-telemetry`
**Base:** `main`
**Author:** `tnaum-ms` (same repository)
**Reviewed:** 2026-07-14
**Scope:** 28 files, +712/-400, 7 commits
**State:** Open, non-draft, mergeable, blocked on review; all reported CI checks pass

## Verdict

**Request changes.** The architecture is coherent and the extension migration is mostly complete, but the package currently publishes source-breaking API changes as a patch release. A normal `^0.9.1` dependency accepts `0.9.2`, so existing consumers can receive compilation failures without opting into the breaking change. The dispatch-level logger also accepts the expanded `ProcedureLogger` contract without invoking its new `onStart` hook.

The two Copilot comments are included below with stable references. One is a valid low-severity typing concern. The other is not reproducible: tRPC v11 merges middleware context overrides with the existing context.

> **Second-pass reviewer verification (2026-07-14, independent re-review against the working tree).**
> Every factual claim in this document was re-checked against source. All four findings (F1–F3, C1) are **confirmed accurate**. Two nuances and two _new_ documentation defects the original review did not surface are recorded inline below and consolidated in the new "Documentation coverage audit" section. Net recommendation is unchanged (**Request changes**), but the scope of required doc updates is larger than the original review implied: the PR updated the package's own `README.md` / `MIGRATION.md` / `ADVANCED.md` and `src/webviews/_integration/README.md`, but left the repository's `.github/skills/` guides pointing at APIs this PR deleted.

## Severity scale

| Severity | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| High     | Release-blocking compatibility or correctness risk for consumers        |
| Medium   | User-visible or public-contract defect with a bounded workaround        |
| Low      | Maintainability or type-safety issue with no current behavioral failure |
| None     | Reviewed concern that is not an issue in the current implementation     |

## Findings

### F1 - High - Breaking APIs are shipped in a patch version

**Source:** Independent review
**Locations:** [`packages/vscode-ext-webview/package.json`](../../../packages/vscode-ext-webview/package.json), [`packages/vscode-ext-webview/MIGRATION.md`](../../../packages/vscode-ext-webview/MIGRATION.md)

The package version changes from `0.9.1` to `0.9.2`, while the PR intentionally makes several source-breaking changes:

- `TelemetryRunner` becomes generic and its `run` signature changes.
- `telemetryMiddlewareBody` changes argument order and becomes curried.
- `WithTelemetry` is removed.
- `ProcedureLogger.log` is removed in favor of `onStart?` / `onEnd?`.

For a pre-1.0 package, npm still treats patch releases within the same minor line as compatible for caret ranges: `0.9.2` satisfies `^0.9.1` (`>=0.9.1 <0.10.0`). Consumers using the common caret range can therefore receive this release on a clean install and fail to compile without changing their manifest.

**Recommendation:** Publish these changes as `0.10.0`, or preserve the `0.9.1` API through deprecated compatibility overloads/aliases in `0.9.2`. The migration guide should describe `0.9.1 -> 0.10.0` if the breaking API is retained.

> **Verified — confirmed accurate, with one mitigating nuance.**
>
> - Version bump confirmed: [`package.json`](../../../packages/vscode-ext-webview/package.json) is `0.9.2`.
> - All four breaking changes are real in the working tree: `telemetryMiddlewareBody` is now curried (`(runner, options) => middleware`) and `TelemetryRunner<TEnrichment>` is generic ([`telemetry.ts`](../../../packages/vscode-ext-webview/src/host/middleware/telemetry.ts)); `ProcedureLogger.log` is gone, replaced by `onStart?`/`onEnd?` ([`logging.ts`](../../../packages/vscode-ext-webview/src/host/middleware/logging.ts)); `WithTelemetry` no longer exists in `src/webviews/_integration/` (replaced by the `RpcEnrichment` interface + `ctx.actionContext`).
> - Semver claim confirmed empirically in this workspace: `semver.satisfies('0.9.2','^0.9.1') === true`, range resolves to `>=0.9.1 <0.10.0-0`.
> - **Nuance the original review omits:** [`MIGRATION.md`](../../../packages/vscode-ext-webview/MIGRATION.md) opens with an explicit policy statement — _"This package is pre-1.0, so minor/patch bumps may carry breaking changes"_ — and documents the change under a `0.9.1 → 0.9.2` heading. So the patch-level break is a deliberate, documented author decision, not an oversight. That does not remove the caret-range hazard for consumers (F1 stands), but the fix could equally be to keep `0.9.2` **and** narrow the documented/consumed dependency to a tilde/exact range (`~0.9.1` / `0.9.x` pinned) rather than forcing a `0.10.0` bump. Recommend calling that alternative out explicitly.

### F2 - Medium - Dispatch logging never calls `ProcedureLogger.onStart`

**Source:** Independent review
**Locations:** [`packages/vscode-ext-webview/src/host/attachTrpc.ts`](../../../packages/vscode-ext-webview/src/host/attachTrpc.ts), [`packages/vscode-ext-webview/src/host/middleware/logging.ts`](../../../packages/vscode-ext-webview/src/host/middleware/logging.ts), [`packages/vscode-ext-webview/ADVANCED.md`](../../../packages/vscode-ext-webview/ADVANCED.md)

`ProcedureLogger` now advertises symmetric optional `onStart` and `onEnd` hooks. `loggingMiddlewareBody` invokes both, but the dispatch path used by `attachTrpc`, `WebviewController`, and `openWebview` only invokes `onEnd`. A consumer can pass an `onStart`-only logger through the documented panel option and receive no events at all. This also conflicts with the PR summary's claim that `ProcedureLogger` gains symmetric hooks.

**Recommendation:** Call `logger?.onStart?.({ type, path })` at the dispatch boundary before starting each query, mutation, or subscription. Add transport tests for `onStart` ordering and exactly-once delivery on success, failure, cancellation, and early subscription setup failure. If start events are intentionally middleware-only, split the interfaces or document that restriction and reject/omit `onStart` from the dispatch logger type.

> **Verified — confirmed accurate.**
>
> - `onStart` is referenced in exactly two places in `src/`: the middleware body ([`logging.ts` line 109](../../../packages/vscode-ext-webview/src/host/middleware/logging.ts)) and its unit test. It appears nowhere in the transport.
> - [`attachTrpc.ts`](../../../packages/vscode-ext-webview/src/host/attachTrpc.ts) accepts `logger?: ProcedureLogger` (the full expanded interface) but its `logProcedure` helper calls `logger?.onEnd?.(...)` only (line 206). A consumer passing an `onStart`-only logger through the panel option receives nothing.
> - Supporting evidence for the "intentionally middleware-only" branch of the recommendation: the package's own [`README.md`](../../../packages/vscode-ext-webview/README.md) dispatch-logger example (≈line 320) demonstrates `onEnd` only. So there is a plausible design intent that `onStart` is a middleware-only concern — which makes the **type contract**, not the runtime, the real defect. I lean toward the review's second option: keep dispatch `onEnd`-only but narrow the dispatch logger parameter type (e.g. `Pick<ProcedureLogger, 'onEnd'>`) so the compiler rejects an `onStart`-only logger at the panel boundary, rather than adding an `onStart` dispatch event that has no timing home. Either fix closes the finding; the type-narrowing one is lower risk.

### F3 - Low - `getInfo` asserts telemetry enrichment that is not present

**Source:** Copilot reviewer
**Copilot reference:** [discussion_r3581536213](https://github.com/microsoft/vscode-documentdb/pull/795#discussion_r3581536213), thread `PRRT_kwDOODtcO86Q2l0P`, comment `3581536213`
**Location:** [`src/webviews/documentdb/documentView/documentsViewRouter.ts`](../../../src/webviews/documentdb/documentView/documentsViewRouter.ts)

`RouterContext.actionContext` is required, but `getInfo` uses the uninstrumented `publicProcedure`. Its `ctx as RouterContext` assertion therefore claims that `actionContext` exists even though the telemetry runner did not inject it. The current handler only serializes the context, so this does not cause a present runtime failure, but the assertion makes a later `myCtx.actionContext` access appear safe when it is not.

**Recommendation:** Type the local value as `Omit<RouterContext, 'actionContext'>`, avoid the cast by exposing an appropriate root context type, or instrument `getInfo` if it should have telemetry.

> **Verified — confirmed accurate.**
> [`documentsViewRouter.ts` line 51](../../../src/webviews/documentdb/documentView/documentsViewRouter.ts) defines `getInfo: publicProcedure.query(({ ctx }) => { const myCtx = ctx as RouterContext; ... })`. `publicProcedure` is the uninstrumented base, so no runner injects `actionContext`, yet the cast asserts `RouterContext` (which declares `actionContext: IActionContext` as required). The handler body only does `JSON.stringify(myCtx)`, so there is no present runtime failure — the defect is purely the unsound assertion, exactly as stated. `Omit<RouterContext, 'actionContext'>` is the cleanest fix and keeps the sibling instrumented procedures (which legitimately read `myCtx.actionContext.telemetry`) honest.

## Copilot comment disposition

### C1 - None - Claimed context loss is disproven by tRPC v11

**Copilot reference:** [discussion_r3581536170](https://github.com/microsoft/vscode-documentdb/pull/795#discussion_r3581536170), thread `PRRT_kwDOODtcO86Q2lz2`, comment `3581536170`
**Location:** [`packages/vscode-ext-webview/src/host/middleware/telemetry.ts`](../../../packages/vscode-ext-webview/src/host/middleware/telemetry.ts)

Copilot reported that `invocation.next({ ctx: enrichment })` replaces the existing router context and drops fields such as `signal`, `sessionId`, and `clusterId`.

That is not how the installed tRPC v11 dispatcher behaves. In `@trpc/server/src/unstable-core-do-not-import/procedureBuilder.ts`, `next()` recurses with:

```ts
ctx: nextOpts?.ctx ? { ...opts.ctx, ...nextOpts.ctx } : opts.ctx;
```

The enrichment is therefore shallow-merged over the existing context, preserving base fields unless the enrichment deliberately uses the same key. This also matches tRPC's middleware context-extension model.

**Disposition:** Reply with the upstream implementation reference and resolve the thread. No product-code change is required. A regression test that starts with a non-empty base context and asserts both base and enrichment fields would make this dependency behavior explicit and prevent the concern from recurring.

> **Verified — Copilot's concern is disproven; the review's disposition is correct.**
> Installed version is `@trpc/server@11.10.0`. The compiled dispatcher at `node_modules/@trpc/server/dist/initTRPC-RoZMIBeA.mjs` line 263 recurses with `ctx: nextOpts?.ctx ? { ...opts.ctx, ...nextOpts.ctx } : opts.ctx`, i.e. a shallow merge of the enrichment over the existing context. Base fields (`signal`, `sessionId`, `clusterId`, …) are preserved unless the enrichment reuses a key. The review's cited source line matches the installed behavior exactly.

### C2 - Low - Unsound `getInfo` context assertion

**Copilot reference:** [discussion_r3581536213](https://github.com/microsoft/vscode-documentdb/pull/795#discussion_r3581536213), thread `PRRT_kwDOODtcO86Q2l0P`, comment `3581536213`

**Disposition:** Valid and tracked as F3. It is a type-safety issue rather than a current runtime defect because `getInfo` does not access `actionContext`.

## Documentation coverage audit (second-pass, beyond the original review)

The original review inspected only the package's own docs (`README.md`, `MIGRATION.md`, `ADVANCED.md`) and `src/webviews/_integration/README.md`, all of which the PR touched. It did **not** audit the repository's `.github/skills/` guides, which are the day-to-day authoring references for contributors. Those guides still document APIs this PR removed, so they now teach code that will not compile.

### F4 - Medium - Skill guides reference removed `WithTelemetry` / `ctx.telemetry` / `trpcToTelemetry`

**Source:** Independent review (documentation)
**Locations:** [`.github/skills/webview-trpc-messaging/SKILL.md`](../../../.github/skills/webview-trpc-messaging/SKILL.md), [`.github/skills/telemetry-instrumentation/SKILL.md`](../../../.github/skills/telemetry-instrumentation/SKILL.md)

`WithTelemetry` was deleted (F1) and replaced by the `RpcEnrichment` interface plus a `ctx.actionContext` slot; procedures now read `ctx.actionContext.telemetry`, and the DocumentDB middleware is `telemetryMiddlewareBody` + `documentDbTelemetryRunner`, not a helper named `trpcToTelemetry`. The skill guides were not updated with the PR and are now stale:

- `webview-trpc-messaging/SKILL.md`:
  - Key-files table (lines 27-29) lists `WithTelemetry` as an export of `trpc.ts` and `ProcedureLogger`/`TelemetryRunner` without the new curried/generic shape.
  - Example imports and casts use `type WithTelemetry` and `ctx as WithTelemetry<RouterContext>` (lines 60, 65, 169, 200, 239) — none of these compile against the current code.
  - The "Telemetry" section (lines 157-171) attributes wiring to `trpcToTelemetry` (file-local) and reads `ctx.telemetry`; current code injects `ctx.actionContext` and reads `ctx.actionContext.telemetry`.
  - The anti-pattern checklist (line 282) recommends `WithTelemetry<RouterContext>` as the correct cast — now actively wrong guidance.
- `telemetry-instrumentation/SKILL.md`: the webview example (lines 76-81) and lines 341-345 read/write `ctx.telemetry.properties/measurements` for a `publicProcedureWithTelemetry` procedure; the correct path is `ctx.actionContext.telemetry.*` (verified against [`queryInsightsRouter.ts`](../../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts), e.g. `myCtx.actionContext.telemetry.properties.platform`).

**Impact:** A contributor (or an AI agent following these skills, which the repo instructions direct it to do) will produce code that fails to compile or silently uses the wrong context shape. This is user-facing for maintainers even though it is not shipped in the extension bundle.

**Recommendation:** Update both skill guides in this PR to the new surface: replace `WithTelemetry<RouterContext>` casts with `ctx as RouterContext` reading `ctx.actionContext.telemetry`; drop `WithTelemetry` from the export table; rename the `trpcToTelemetry` narrative to `telemetryMiddlewareBody` + the DocumentDB `TelemetryRunner`; and add the `ProcedureLogger` `onStart?`/`onEnd?` split. Because these are the canonical authoring references, keeping them in lockstep with the API is arguably higher-value than the package-internal `ADVANCED.md`.

### F5 - Low - Stale `trpcToTelemetry` references in shipped code comments

**Source:** Independent review (documentation)
**Location:** [`src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts`](../../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts)

Explanatory comments at lines ~47, ~62, and ~160 still describe the telemetry path as `trpcToTelemetry wraps opts.next()`. That helper name no longer exists after this PR's reshape (the equivalent is `telemetryMiddlewareBody` delegating to the DocumentDB `TelemetryRunner`). The comments are now misleading about how the surrounding subscription-completion event relates to middleware timing.

**Recommendation:** Refresh these comments to reference the current `telemetryMiddlewareBody` / runner delegation model. No behavioral change.

## Additional observations

- The new `mergeRouters` export is additive and has a focused caller test covering flat procedure paths.
- The DocumentDB runner preserves the prior cancellation-versus-failure classification and delegates total duration to `callWithTelemetryAndErrorHandling`, avoiding duplicate duration measurements.
- Query Insights subscription completion telemetry remains a dedicated event because middleware completion occurs when the generator is created, not when streaming finishes. This behavior predates the API reshape and the migration does not introduce a new defect there.
- The seven commits are logically separated and have clean subjects. If the findings are fixed, preserving them with rebase is defensible, although the repository's external-PR workflow defaults to squash for more than three commits.

## Verification performed

- Reviewed the full `main...HEAD` diff and all 28 changed files through the PR payload.
- Inspected the telemetry, logging, router-context, consumer migration, documentation, and related tests locally.
- Verified `semver.satisfies('0.9.2', '^0.9.1') === true`; the resolved range is `>=0.9.1 <0.10.0-0`.
- Verified tRPC v11's middleware context merge in the installed `@trpc/server` source.
- Pulled and reconciled both unresolved Copilot inline review comments.
- GitHub reports all CI, integration, packaging, CodeQL, and CLA checks passing; one approval is still required.
- **Second pass (2026-07-14):** re-verified F1–F3 and C1 line-by-line against the working tree; confirmed `@trpc/server@11.10.0` context merge in installed dist; audited every in-repo doc that mentions the changed APIs (`.github/skills/*`, both package and integration READMEs) for staleness, surfacing F4 and F5.

## Suggested review outcome

Submit **Request changes** for F1 and F2. Resolve C1 after replying with the tRPC merge implementation. Address C2 in the same PR because the correction is small and keeps the context model honest.

**Second-pass addendum:** also block on F4 — the `.github/skills/` guides ship compile-breaking `WithTelemetry` / `ctx.telemetry` examples and should be updated in this PR since it is the change that invalidated them. F5 (stale code comments) is a nice-to-have that can ride along with the F4 doc pass.
