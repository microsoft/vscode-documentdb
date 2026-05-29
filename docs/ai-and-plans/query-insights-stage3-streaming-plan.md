# Query Insights Stage 3 — Progressive Streaming — IMPLEMENTATION PLAN

> Tracking issue: [#665](https://github.com/microsoft/vscode-documentdb/issues/665)
> Audience: an **Opus-class implementation agent**.
> Status: **Approved for implementation, not started.**

---

## 0. How the implementing agent must work (process contract)

Read this section first and follow it for the whole task.

1. **Work item by work item.** The plan is split into numbered **Work Items (WI-n)**. Do
   **one** at a time. Do **not** produce one giant changeset.
2. **Commit per work item.** After a work item is complete and its acceptance checks pass,
   make a focused git commit scoped to that item (conventional message, e.g.
   `feat(query-insights): add streaming onChunk to CopilotService (WI-2)`). Do not bundle
   unrelated changes.
3. **Report status while working.** Before starting each WI, post a short "starting WI-n"
   note; after finishing, post a "completed WI-n" note with what changed and check results.
4. **Keep this plan as the source of truth.** After completing each WI, edit this file:
   set the WI's checkbox to `[x]` and append a one-line outcome under it.
5. **Document deviations in this plan.** If implementation diverges from the plan, record the
   deviation in the **Deviation Log** (bottom of this file) with rationale.
6. **Confidence gate.** If your confidence in a deviation (or any non-obvious decision) is
   **< 80%**, **stop and consult the user** before proceeding. Do not silently guess.
7. **Phase gating.** Phases are ordered. Phase 0 is independently shippable. Do not start a
   later phase before the earlier one's acceptance checks pass, unless the user says so.
8. **PR checklist before declaring a phase done:** `npm run l10n` (if user-facing strings
   changed), `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage`, `npm run build`.
   All must pass.
9. **Terminology:** "DocumentDB" for the service; "MongoDB API"/"DocumentDB API" for the
   wire protocol. Never "MongoDB" alone. Use `vscode.l10n.t()` for user-facing strings.

---

## 1. Goal

Today the AI index-recommendation result (Stage 3) is shown only after the **entire** LLM
response arrives (~15s, no visible progress). Make it **progressive**: the user sees value
within ~1–2s and watches the analysis build up, with no card ever appearing "after a phase
of nothing."

Non-goal (explicitly out of scope): ChatGPT-style token-by-token rendering.

---

## 2. Confirmed design decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **R1 — decouple generation order from display order.** Do **not** reorder the LLM's output to avoid hurting answer quality (the `educationalContent`-first order doubles as reasoning scaffolding). Stream whatever the model produces into fixed UI slots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D2  | **Markdown content (educational, analysis): progressive paragraph/section reveal** (split on `###` headings / blank-line boundaries). Not token-by-token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D3  | **Recommendation items: generic shell, then fill.** On detecting a new recommendation starting in the stream, render a generic placeholder immediately, then fill header → body → actions. (Option "a".)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D4  | **No up-front fixed skeleton set** (item count unknown).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D5  | **No card ever appears after "a phase of nothing"** — everything enters as a shell/shimmer and grows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D6  | **Parser: tolerant incremental parser over the current single JSON object** (no prompt-format change), with a full `JSON.parse` reconciliation on completion for zero regression.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D7  | **tRPC ↔ webview contract is UI-agnostic.** The stream speaks in **domain terms** (`status`, `summary`, `recommendation`, `educational`, `complete`) — **never** "cards". The webview maps domain events to UI elements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | **Add a dedicated `collectionView.queryInsights` sub-router** so the main `collectionViewRouter` does not get messier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D9  | **Preserve Stage 3 telemetry via a dedicated completion event** (see §7). A new event name is acceptable; losing data is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D10 | **A single shared "progress placeholder" component** is used for both the pre-first-block indicator and the in-item shimmer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D11 | **Placeholders carry their final card-type icon from creation.** The webview already uses dedicated icons per card type (summary/educational/info → `SparkleRegular`; recommendation → `ArrowTrendingSparkleRegular`, rendered inside `ImprovementCard` itself; error → `WarningRegular`; feedback → `ChatMailRegular`). A shell must show the **same icon** it will have once filled, so a card never changes identity when content arrives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D12 | **Stream via a pull-based async-iterable, `yield`ing directly from the subscription generator (Option A).** `CopilotService` exposes the LLM response as an `AsyncIterable<string>`; the Stage-3 subscription is `for await (const fragment of copilotService.stream(...)) { … yield … }`. We do **not** use `TypedEventSink` for this feature: the LLM is a single pull-based source, so a generator gives automatic backpressure, one linear data path, natural error propagation, and one-path cancellation (`ctx.signal?.aborted` + framework `iterator.return()`). The push-style `TypedEventSink` adapter remains available and is the right tool **only if** a second push-based source ever has to be merged into this stream (see §3 for the A-vs-B rationale and the rejected Option B). Subscription procedures still live in a sibling `<view>EventsRouter.ts` merged into the view's main router; and **subscription errors are not** forwarded to the client `useTrpcClient({onError})` option — use the per-call `.subscribe({ onError })` hook. |

### Still open (decide during the relevant phase; consult user if confidence < 80%)

- **OPEN-1 (layout jump):** under R1 the educational block fills first but sits in the
  bottom slot, so it shifts down when summary/recommendations insert above it. Options:
  accept one downward shift / reserve a fixed top region / keep educational rendered last
  until siblings arrive. Decide in Phase 3.

---

## 3. Verified current architecture (May 2026)

| Concern       | Where                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM call      | `CopilotService.sendToModel` — [src/services/copilotService.ts](../../src/services/copilotService.ts) (~L339)                                                                               | Already iterates `for await (const fragment of chatResponse.text)` but **buffers** into `fullResponse`. AbortSignal→CancellationToken bridge present. Returns `{text, durationMs, usage}`. For Option A, expose the same loop as an `AsyncIterable<string>` of fragments (WI-2) while still computing usage/`durationMs` for the buffered path. |
| Public entry  | `CopilotService.sendMessage` + `CopilotMessageOptions`                                                                                                                                      | Options carry `signal`, `preferredFamily`, `fallbackFamilies`, `modelOptions`. Add a streaming variant that returns `AsyncIterable<string>` (Option A; see D12).                                                                                                                                                                                |
| Orchestration | `optimizeQuery` — [src/commands/llmEnhancedCommands/indexAdvisorCommands.ts](../../src/commands/llmEnhancedCommands/indexAdvisorCommands.ts) (~L356–650)                                    | Builds 3 user messages, calls `CopilotService.sendMessage`, returns text. Wrapped in its own `callWithTelemetryAndErrorHandling` (carries `copilotDurationMs`, model props, etc. — **keep as-is**).                                                                                                                                             |
| Parse         | `QueryInsightsAIService.parseAIResponse` — [src/services/ai/QueryInsightsAIService.ts](../../src/services/ai/QueryInsightsAIService.ts) (~L173)                                             | `JSON.parse` → `AIOptimizationResponse {analysis, improvements[], verification[], educationalContent}`.                                                                                                                                                                                                                                         |
| Transport     | `getQueryInsightsStage3` — [src/webviews/documentdb/collectionView/collectionViewRouter.ts](../../src/webviews/documentdb/collectionView/collectionViewRouter.ts) (~L867)                   | A tRPC `.query()`. Records counts + token usage onto `ctx.telemetry` at the end. Returns `QueryInsightsStage3Response`.                                                                                                                                                                                                                         |
| Transform     | `transformAIResponseForUI` — [src/documentdb/queryInsights/transformations.ts](../../src/documentdb/queryInsights/transformations.ts) (~L41)                                                | → `analysisCard` + `improvementCards[]` + `educationalContent`.                                                                                                                                                                                                                                                                                 |
| Webview       | `QueryInsightsTab.tsx` (~L490–600, render ~L693–770)                                                                                                                                        | Calls `.query({requestKey},{signal})`, single `.then()` sets `stage3Data`. Has AbortController (`stage3AbortControllerRef`), requestKey staleness guard, 1s-delayed tips/error card, `transitionToStage` states. Builds `insightCards: AnimatedCardItem[]` in canonical order.                                                                  |
| Card list     | `AnimatedCardList` — [.../animatedCardList/AnimatedCardList.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/animatedCardList/AnimatedCardList.tsx) | `AnimatedCardItem = { key, component }`. **No priority field.** Renders in **source-array order**, animates inserts via `CollapseRelaxed`.                                                                                                                                                                                                      |
| Types         | [.../types/queryInsights.ts](../../src/webviews/documentdb/collectionView/types/queryInsights.ts)                                                                                           | `AnalysisCard` (L227), `ImprovementCard` (L235), `QueryInsightsStage3Response` (L272).                                                                                                                                                                                                                                                          |

### Critical framework facts

1. **Subscription infra exists but is unused in `src/`.** The tRPC subscription transport
   (`WebviewController.handleSubscriptionMessage` + client `.subscribe({onData,onComplete,onError})`)
   and the `TypedEventSink` push→pull adapter
   ([.../extension-server/TypedEventSink.ts](../../packages/vscode-ext-react-webview/src/extension-server/TypedEventSink.ts))
   are implemented and tested. Stage 3 will be the **first real consumer** — no in-repo
   reference to copy. Read the framework sources **and the package README's "Push events
   from the extension host to the webview" section** before writing the subscription.

   **Chosen approach — Option A (pull-based generator), drives D12.** The subscription is an
   `async function*` that iterates an `AsyncIterable<string>` exposed by `CopilotService` and
   `yield`s domain events directly:

   ```ts
   streamStage3: publicProcedureWithTelemetry.subscription(async function* ({ ctx, input }) {
     for await (const fragment of copilotService.stream(messages, { signal: ctx.signal })) {
       if (ctx.signal?.aborted) return;
       // feed the incremental parser; yield summary/educational/recommendation* events
     }
     // final reconcile + yield { type: 'complete', ... }
   });
   ```

   Why A over B for this feature:
   - **Single linear data path** — producer and consumer are the same loop; ordering and
     completion are inherent in the language construct.
   - **Automatic backpressure** — the LLM source is only pulled when the generator is ready
     to yield; no unbounded buffer.
   - **Natural error propagation** — a throw in the LLM iteration surfaces as a normal
     exception on the standard tRPC error path.
   - **One-path cancellation** — `ctx.signal?.aborted` check plus the framework's
     `iterator.return()` propagate straight into the one loop; nothing parked on `emit`.
   - **Best fit for the shape** — one request → one stream → one consumer is exactly what
     async generators are for.

   **Rejected: Option B (`TypedEventSink` fed by an `onChunk` callback).** The sink is the
   right tool when a generator must **merge a push-based source it cannot `await`** (a VS Code
   event emitter, a parallel task, a mid-stream notification) — this is how vscode-cosmosdb uses
   it for its long-lived migration/query-editor event buses. Stage 3 has a single pull-based
   source, so B would add manual lifecycle (`close()`, single-consumer guard, drop-after-close),
   unbounded buffering, and awkward error handling for no benefit. **If a future change needs to
   interleave a second push source into this stream, revisit B** — that is a deviation worth
   logging and (if confidence < 80%) consulting the user.

   Shared facts regardless of A/B:
   - The framework cleans up iteration on `unsubscribe()` / panel dispose via
     `iterator.return()`; still poll `ctx.signal?.aborted` between yields.
   - **Subscription errors do not flow to the client `onError` option** — handle them in the
     per-call `.subscribe({ onError })`.
   - Recommended layout: a sibling `<view>EventsRouter.ts` merged into the view router.

2. **Telemetry timing trap (drives D9).** `trpcToTelemetry`
   ([src/webviews/\_integration/trpc.ts](../../src/webviews/_integration/trpc.ts)) wraps
   `opts.next()` in `callWithTelemetryAndErrorHandling`. For a subscription, `opts.next()`
   resolves when the **generator object is created**, not when streaming finishes. Any
   measurement set **during** iteration is therefore lost on the auto rpc event. ⇒ We must
   emit our own explicit completion event from inside the generator (§7).
3. **UI ordering is already handled by source-array order:** populating partial data
   incrementally lets each card animate into its canonical slot regardless of arrival order.
   A numeric priority field is **not** required.
4. **Output shape:** single JSON object, keys emitted in order `educationalContent` →
   `analysis` → `improvements[]` → `verification[]`. Large markdown strings with escaped
   quotes/newlines.

---

## 4. Target contract (UI-agnostic stream) — D7

Define a discriminated-union event type in **domain language** (no "card"):

```ts
// src/webviews/documentdb/collectionView/types/queryInsightsStream.ts (new)
export type QueryInsightsStreamEvent =
  | { type: 'status'; phase: 'connecting' | 'receiving' | 'parsing'; elapsedMs: number; charsReceived?: number }
  | { type: 'summary'; markdown: string; complete: boolean } // the "analysis" section, grows over time
  | { type: 'educational'; markdown: string; complete: boolean } // the "Understanding..." section, grows over time
  | { type: 'recommendationStarted'; index: number } // a new improvement object opened in the stream
  | { type: 'recommendation'; index: number; recommendation: AIRecommendation } // a completed improvement
  | { type: 'verification'; items: string[] } // optional, on completion
  | { type: 'complete'; modelDisplayName?: string; modelId?: string; usage?: CopilotTokenUsage };
```

- `summary`/`educational` carry **cumulative markdown** + a `complete` flag (progressive
  paragraph reveal lives in the parser; the UI just renders the latest markdown).
- `recommendationStarted` carries only the index → UI renders the **shell**, already using
  the recommendation card's own icon (`ArrowTrendingSparkleRegular`) per D11 (D3/D5).
- `recommendation` carries the fully-parsed domain object → UI fills the shell.
- `AIRecommendation` is the existing domain shape (action/indexSpec/indexName/shellCommand/
  justification/priority/risks) — reuse from `AIOptimizationResponse.improvements[]`; do
  **not** invent a UI type here. The webview maps domain data → its card components.

> The transform-to-UI step (`transformAIResponseForUI`) either moves to the webview side or
> is applied **per-recommendation** server-side while still emitting domain data. Decide in
> WI-7; default: keep transform server-side but emit it per-recommendation as domain data,
> letting the webview own card-component choice. If confidence < 80% on this split, consult
> the user.

---

## 5. Shared progress placeholder component — D10

Create one reusable component used in two places:

```
src/webviews/documentdb/collectionView/components/queryInsightsTab/components/
  streamingPlaceholder/StreamingPlaceholder.tsx
```

Responsibilities:

- A compact shimmer/indeterminate row with an optional label and optional elapsed-time /
  char counter, e.g. `▰▰▰▱▱▱  {label} · {elapsed}s`.
- Variants via props: `variant="standalone"` (pre-first-block "Generating AI analysis…")
  and `variant="inline"` (tail of an item currently streaming, and body of a recommendation
  shell awaiting fill).
- **Accepts an `icon` prop (D11).** The placeholder must render the **same icon** the final
  card will use, so a shell never changes identity when filled: summary/educational/info →
  `SparkleRegular`; recommendation → `ArrowTrendingSparkleRegular` (the recommendation shell
  should reuse `ImprovementCard`'s own icon — see WI-9); error → `WarningRegular`. The
  caller (webview, per domain-event type) passes the correct icon when creating the shell.
- Accessibility: `role="status"` + `aria-live="polite"` so screen readers announce progress
  (see the accessibility-aria-expert skill). Localize all labels with `vscode.l10n.t()`.

This component is introduced in **Phase 0** and reused in Phases 1–3.

---

## 6. UI reveal sequence (reference, ASCII)

```
t≈0s  ┌ Generating AI analysis… ▰▰▰▱▱▱ 0.8s ┐        (StreamingPlaceholder, standalone)

t≈2-8 ✨ Understanding Your Query Execution Plan      (educational fills paragraph by paragraph)
      ### Query Execution Overview … (done)
      ### Execution Stages Breakdown … ▰▰▰▱ writing…

t≈9s  ✨ Query Performance Analysis   ◀ inserts ABOVE  (summary; OPEN-1 layout jump here)
      ──────────────
      ✨ Understanding Your Query Execution Plan (pushed ↓)

t≈10  🔧 Recommendation  ▰▰▰▱ preparing…  ◀ shell      (recommendationStarted)
t≈11  🔧 [HIGH] Create index {status:1,date:-1}        (recommendation → shell filled)
      [ Create Index ] [ Learn More ]

t≈13  💡 DocumentDB Performance Tips   done ✓           (complete)
```

---

## 7. Telemetry preservation — D9 (must-have)

The current rpc event records these onto `ctx.telemetry` and **must not be lost**:

- **properties:** `platform`, `hasStaticAnalysisSummary`, `staticAnalysisSummaryError`,
  `staticAnalysisSummaryErrorKind`, `hasCachedExecutionPlan`, `aiModelDisclosed`,
  `aiModelFamily`.
- **measurements:** `staticAnalysisSummaryLength`, `recommendationCount`,
  `actionableRecommendationCount`, `createRecommendationCount`, `dropRecommendationCount`,
  `modifyRecommendationCount`, `promptTokens`, `responseTokens`, `totalTokens`,
  `maxInputTokens`, `promptUtilizationPct`.
- The **LLM call duration** (`copilotDurationMs` and friends) is recorded by
  `optimizeQuery` / `CopilotService` in their **own** telemetry events — those are unchanged
  by this work. Verify during WI-10 that they still fire.

**Plan:** emit a dedicated completion event from inside the subscription generator's
completion path (success and, where meaningful, abort), e.g.:

```
documentDB.queryInsights.stage3.completed
```

using a direct `callWithTelemetryAndErrorHandling` so its lifetime spans the whole stream
and carries **all** the keys above plus a `durationMs` (wall-clock from request to complete)
and `aborted` flag. This is robust to the subscription middleware timing trap (§3.2).

> The auto rpc event (`documentDB.rpc.subscription.…queryInsights.<proc>`) will still fire
> but with ~0 duration and no custom measurements — that is expected; the dedicated event is
> the canonical source. Document the new event name + key list in the PR description so the
> user can update their telemetry queries.

**Acceptance:** a table in the PR description mapping every old key → new event/key, with an
explicit "no data lost" confirmation. If any key cannot be carried, list it and consult user.

---

## 8. Work items

### Phase 0 — Perceived progress (client-only, independently shippable)

- [x] **WI-1 — `StreamingPlaceholder` component + stepper.** Build the shared placeholder
      (§5). Replace the current 1s spinner gap in `QueryInsightsTab` Stage-3 loading with a
      stepper/checklist ("Analyzing plan → Identifying issues → Generating recommendations →
      Finalizing") + elapsed timer, driven by a client-side timer (no backend change). Keep
      existing tips/error card behavior.
  - _Acceptance:_ on Stage 3 request, visible animated progress within <1s; no regression in
    final rendered content; lint/jest/build pass. Suitable for a Sonnet-class agent.
  - _Outcome:_ Added `StreamingPlaceholder` (shared shimmer row with `role="status"` /
    `aria-live="polite"`, icon, label, elapsed/chars meta, standalone/inline variants) and
    `StreamingProgressStepper` (client-side timer, 4 sticky steps using `StreamingPlaceholder`
    on the active step) under `.../components/streamingPlaceholder/`. Wired the stepper into
    `GetPerformanceInsightsCard` in place of the previous `Spinner`+"AI is analyzing…" row,
    keeping the Cancel button anchored on the right. Loading announcer preserved.
    l10n / prettier / lint / jest (1984 ✓) / build all pass.

### Phase 1 — Plumb the stream end-to-end (coarse progress)

- [x] **WI-2 — Async-iterable streaming in CopilotService (Option A).** Add a streaming
      variant that exposes the LLM response as an `AsyncIterable<string>` of fragments (e.g.
      `async *streamMessage(...)` / `stream(...)`), built on the existing
      `for await (const fragment of chatResponse.text)` loop. Each fragment is `yield`ed;
      keep accumulating internally so usage/`durationMs` are still computed and exposed on
      completion (e.g. a trailing result or a sibling accessor). The existing buffering
      `sendMessage`/`sendToModel` stays for non-streaming callers. Preserve the
      AbortSignal→CancellationToken bridge so aborting the iterator stops the model call.
  - _Acceptance:_ existing callers unaffected; unit test that the iterable yields fragments
    in order and that aborting the signal ends iteration; usage/duration still available.
  - _Outcome:_ Added `CopilotStreamHandle` (sibling-accessor pattern: `fragments` async
    iterable + `completion` promise) and `CopilotService.streamMessage(...)` under
    `vscode-documentdb.copilot.streamMessage` telemetry. Extracted the model iteration
    loop into a private `streamToModel(...)` primitive shared by `streamMessage` and the
    existing `sendToModel` (no-op fragment sink for the buffered path) so the two paths
    cannot drift apart. Producer runs in the background, pushes into a private
    `FragmentChannel` (pull-based, single-consumer, supports `return()` for early break).
    AbortSignal → `CancellationTokenSource` bridge preserved. Added
    `src/services/copilotService.test.ts` with three Jest cases (fragments in order +
    usage/duration on completion, mid-stream abort rejects with `UserCancelledError`, no
    suitable model rejects with explanatory error). l10n / prettier / lint / jest
    (1987 ✓) / build all pass.
- [x] **WI-3 — Thread the async-iterable through orchestration.** Expose the streaming
      iterable from `optimizeQuery` → `getOptimizationRecommendations` so a caller can
      `for await` the fragments end-to-end. No parsing yet. Keep the existing buffered path
      working for any non-streaming caller.
  - _Acceptance:_ a caller can iterate streamed fragments end-to-end (test); the buffered
    path still returns the full text + usage as before.
  - _Outcome:_ Added `OptimizationStreamHandle` + `optimizeQueryStreaming(...)` in
    `indexAdvisorCommands.ts` (extracted a shared `prepareOptimizationRequest` helper plus
    a `finalizeOptimizationResponse` helper so the buffered `optimizeQuery` and the new
    streaming variant cannot drift apart — only the LLM-call line differs:
    `CopilotService.sendMessage` vs. `CopilotService.streamMessage`). Added
    `AIOptimizationStreamHandle` + `QueryInsightsAIService.getOptimizationRecommendationsStreaming(...)`
    under `vscode-documentdb.queryInsights.getOptimizationRecommendationsStreaming`
    telemetry; the final `JSON.parse` still runs once on completion (WI-7/WI-8 will
    introduce incremental parsing). Added a Jest test covering end-to-end fragment
    iteration + parsed completion and malformed-JSON rejection. Existing buffered callers
    untouched (still call `optimizeQuery` / `getOptimizationRecommendations`). l10n /
    prettier / lint / jest (1989 ✓) / build all pass.
- [x] **WI-4 — Dedicated `queryInsights` sub-router (D8).** Create
      `src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts` exporting a
      `queryInsightsRouter`; mount it under `collectionView.queryInsights`. Move the existing
      `getQueryInsightsStage3` (and any closely related Stage-3 procedures) into it **unchanged**
      first (pure relocation). Per D12 / the package README convention, the **subscription**
      (push) procedure added in WI-5 should live in a sibling `queryInsightsEventsRouter.ts`
      merged into `queryInsightsRouter` — keeping "things the webview calls" (queries/mutations)
      separate from "things the host pushes" (subscriptions).
  - _Acceptance:_ webview still works via the new path; old call sites updated; build/jest pass.
  - _Note:_ this changes the rpc event name/path — call it out for the user (telemetry).
  - _Outcome:_ Created `queryInsightsRouter` and moved Stage 1/2/3 + `executeQueryInsightsAction`
    procedures and the `readQueryInsightsDebugFile` helper into it (pure relocation, bodies
    unchanged). Mounted under `collectionView.queryInsights`. Updated all four webview call
    sites (`QueryInsightsTab.tsx`, `CollectionView.tsx`) to the new
    `collectionView.queryInsights.*` paths. Removed now-unused imports
    (`Document`/`fs`/`path`/`Explain*`/`StagePropertyExtractor`/`buildStaticAnalysisSummary`/
    `transformations`/`QueryInsightsAIService`/`QueryInsightsStage3Response`/`QueryObject`)
    from `collectionViewRouter.ts`. ⚠️ **Telemetry path change:** rpc events for these four
    procedures now carry a `queryInsights` segment (e.g.
    `documentDB.rpc.query.collectionView.queryInsights.getQueryInsightsStage3` —
    previously `…collectionView.getQueryInsightsStage3`). Telemetry queries that hard-coded
    the old path must be updated. l10n / prettier / lint / jest (1989 ✓) / build all pass.
- [x] **WI-5 — Convert Stage 3 to a subscription with coarse `status` events (Option A).** Add
      `streamStage3` `.subscription(async function* …)` to `queryInsightsEventsRouter`. The
      generator iterates the `CopilotService` async-iterable directly
      (`for await (const fragment of copilotService.stream(...)) { … }`) — **no `TypedEventSink`**
      (see D12 / §3). Emit `status` events (`receiving`, charsReceived, elapsedMs) as fragments
      arrive. On completion, run the **existing** full parse + transform and `yield` the final
      data as today (one payload for now). Wire cancellation via `ctx.signal` (poll
      `ctx.signal?.aborted` between yields; the framework's `iterator.return()` ends the loop on
      `subscription.stop` / dispose). If a future need to merge a second push source appears,
      that is the point to revisit Option B — log it as a deviation and consult the user if
      confidence < 80%.
  - _Acceptance:_ webview subscribes, shows live "receiving…" status, then the same final
    result as today; cancel mid-stream stops the LLM call and clears partial UI.
  - _Outcome:_ Added `QueryInsightsStreamEvent` discriminated union in
    `types/queryInsightsStream.ts` (coarse subset for WI-5: `status` + `result`; WI-8
    extends with per-domain events). Added `queryInsightsEventsRouter.ts` exporting a
    `queryInsightsEventsRoutes` record (procedures spread into `queryInsightsRouter` rather
    than nesting under a sub-namespace, so paths stay flat —
    `collectionView.queryInsights.streamStage3`). The `streamStage3` subscription is an
    `async function*` that: (1) yields `status: connecting`, (2) builds queryContext +
    staticAnalysisSummary like the buffered procedure, (3) calls
    `getOptimizationRecommendationsStreaming` (Option A — no `TypedEventSink`),
    (4) iterates `fragments` emitting throttled (250ms) `status: receiving`
    with `elapsedMs`+`charsReceived`, (5) yields `status: parsing` then awaits the parsed
    completion, (6) yields a single `result` carrying today's `QueryInsightsStage3Response`.
    Per-subscription `AbortController` forwards `ctx.signal` aborts down to the LLM call;
    `finally` aborts on `iterator.return()` (panel dispose / `subscription.stop`).
    Webview migration is deferred to WI-6. l10n / prettier / lint / jest (1989 ✓) / build
    all pass.
- [x] **WI-6 — Webview `.subscribe()` migration.** Convert `QueryInsightsTab` from `.query()`
      to `.subscribe({onData,onComplete,onError})`. Preserve requestKey staleness guard; cancel
      via `sub.unsubscribe()`; keep error/tips behavior.
  - _Acceptance:_ full Stage-3 flow works via subscription; abort + stale-request handling
    verified; no regression in final UI.
  - _Outcome:_ Replaced `stage3AbortControllerRef` with `stage3SubscriptionRef`
    (`{ unsubscribe(): void } | null`) and swapped the
    `collectionView.queryInsights.getQueryInsightsStage3.query({...}, {signal})` call for
    `collectionView.queryInsights.streamStage3.subscribe({requestKey}, {onData,onComplete,onError})`.
    `onData` routes only the terminal `type: 'result'` event to the existing requestKey-guarded
    success path (writing `stage3Data` + `transitionToStage(3, 'success')`); coarse
    `type: 'status'` events are intentionally ignored in WI-6 and will be wired up by WI-9.
    `onError` reuses the existing extractErrorCode / `displayedErrors` flow; `onComplete`
    only clears the ref (no UI state, since `result` already drove success). `handleCancelAI`
    now calls `unsubscribe()` (which sends `subscription.stop` → server AbortController abort +
    `iterator.return()` on the generator per the package README) and clears
    `stage3RequestKey`; the requestKey guard silently discards any racing late callbacks from
    the framework's unsubscribe path. Unmount cleanup uses `unsubscribe()` for the same reason.
    `stage3Promise` field kept as `null` everywhere (no longer assigned a real Promise; it was
    write-only state — never read — and removing it would be a wider refactor). l10n /
    prettier / lint / jest (1989 ✓) / build all pass.

### Phase 2 — Tolerant incremental parser (the real win)

- [x] **WI-7 — Streaming parser module.** New module (e.g.
      `src/documentdb/queryInsights/streamingResponseParser.ts`) that consumes the growing buffer
      and produces `QueryInsightsStreamEvent`s:
  - Extract the **growing string value** of `analysis` → emit `summary` events with cumulative
    markdown + completed-block detection (split on `###` / blank line), `complete:false` until
    the value's closing quote.
  - Same for `educationalContent` → `educational` events.
  - Track **brace depth inside `improvements`**: emit `recommendationStarted` on object open,
    `recommendation` (parsed domain object) on object close. Handle string/escape state so
    braces inside strings don't miscount.
  - On stream end: reconcile with full `JSON.parse`; the reconciled result wins (no
    regression). If incremental parsing failed entirely, fall back silently to the full parse.
  - Pure, framework-free, **heavily unit-tested** (highest-risk code).
  - _Acceptance:_ unit tests covering: growing-string extraction, escaped quotes/braces in
    markdown, multiple improvements, zero improvements, truncated/aborted buffer, malformed
    JSON fallback. `npx jest` green.
  - _Outcome:_ Added `StreamingResponseParser` in
    `src/documentdb/queryInsights/streamingResponseParser.ts` plus 25 Jest cases in
    `streamingResponseParser.test.ts` (covers basic happy path; byte-at-a-time feeding;
    progressive emission at `\n\n` boundaries; simple + `\uXXXX` escapes incl. fragment
    boundaries between `\\` and the escaped char and inside the 4 hex digits; multiple
    improvements with stream-order indices; braces / brackets inside `shellCommand` /
    `justification` / `risks` strings (no false-positive item boundary); nested arrays in
    `indexOptions`; empty improvements; verification reconciliation; unknown top-level keys
    incl. nested object, negative number, bool, null, array; truncation tolerance; malformed
    / empty / whitespace-only buffer; double-finalize + post-finalize-feed guards;
    out-of-order keys both ways). Implementation is a pure char-by-char state-machine
    tokenizer with string-aware brace counting; `feed()` returns events incrementally and
    `finalize()` returns `{events, parsed, parseError}` where `parsed` is the canonical
    `JSON.parse` reconciliation (always wins per plan §3 / D6). Decision deviating from
    plan §4: the `verification` event is sourced **only** from the reconciled
    `JSON.parse` on `finalize()` rather than emitted streaming-side — items don't benefit
    from progressive reveal in the UI, and reconciliation avoids any risk of partial-string
    truncation mid-stream (confidence ≥ 80%, no user consult needed; documented in
    Deviation Log). Also: progressive markdown emission triggers on `\n\n` only, not on
    `###` separately — `###` headings always follow a `\n\n` paragraph break in practice,
    so a single trigger covers both. Also extended `QueryInsightsStreamEvent` union with
    the structured `summary` / `educational` / `recommendationStarted` / `recommendation`
    / `verification` / `complete` variants (kept the WI-5 transitional `result` as
    `@deprecated`; WI-8 will remove it from the subscription path). l10n / prettier /
    lint / jest (2014 ✓, +25 new) / build all pass.
- [ ] **WI-8 — Emit structured events from the subscription.** Replace WI-5's coarse-only
      output: feed each fragment from the async-iterable into the parser and `yield` the resulting domain events
      (`summary`/`educational`/`recommendationStarted`/`recommendation`/`verification`), then a
      final `complete`. Keep `status` events for the pre-summary window.
  - _Acceptance:_ events arrive in stream order; final reconstructed state equals today's.

### Phase 3 — Progressive UI rendering

- [ ] **WI-9 — Progressive rendering in `QueryInsightsTab`.** Maintain streaming state from
      events. Render: `summary` and `educational` markdown cards that grow paragraph-by-paragraph;
      recommendation **shell** on `recommendationStarted`, filled on `recommendation`. No up-front
      skeletons. **Per-type icons (D11):** every shell must already carry the icon its filled card
      will use — `summary`/`educational`/info shells pass `SparkleRegular` to `StreamingPlaceholder`;
      the recommendation shell should use `ImprovementCard`'s own `ArrowTrendingSparkleRegular` (prefer
      rendering a real `ImprovementCard` in a loading/partial state over a separate placeholder, so the
      icon and layout are identical before/after fill); error → `WarningRegular`. A card must never
      change icon when content arrives. Resolve **OPEN-1** (layout jump) — pick a mitigation and record
      it in the Deviation Log if it differs from "accept one shift". Clear loading on `complete`.
  - _Acceptance:_ matches §6 sequence; no card appears fully-formed out of nowhere; each shell's
    icon matches its final card; final UI identical to today; a11y live regions announce progress.
- [ ] **WI-10 — Telemetry completion event (§7).** Emit
      `documentDB.queryInsights.stage3.completed` from the generator with all preserved keys +
      `durationMs` + `aborted`. Verify `optimizeQuery`/`CopilotService` duration events still fire.
      Produce the old→new key mapping table for the PR.
  - _Acceptance:_ event fires once per completed/aborted stream with correct values; mapping
    table complete; "no data lost" confirmed (or gaps escalated to user).

### Closeout

- [ ] **WI-11 — Full PR checklist + manual verification.** Run l10n, prettier-fix, lint, jest,
      build. Manually verify on a slow query: progress < 2s, paragraphs stream, shells fill,
      cancel works, final state unchanged. Update this plan (all boxes, Deviation Log) and write
      the PR description (including telemetry mapping + new event/rpc-path names).

---

## 9. Relevant files

- [src/services/copilotService.ts](../../src/services/copilotService.ts) — `onChunk` (WI-2).
- [src/commands/llmEnhancedCommands/indexAdvisorCommands.ts](../../src/commands/llmEnhancedCommands/indexAdvisorCommands.ts) — thread `onChunk` (WI-3).
- [src/services/ai/QueryInsightsAIService.ts](../../src/services/ai/QueryInsightsAIService.ts) — streaming entry + `parseAIResponse` fallback (WI-3/WI-8).
- `src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts` — **new** sub-router (WI-4/5/8/10).
- `src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts` — **new** push/subscription router per D12 convention (WI-4/5/8).
- [src/webviews/documentdb/collectionView/collectionViewRouter.ts](../../src/webviews/documentdb/collectionView/collectionViewRouter.ts) — mount sub-router; relocate Stage 3 (WI-4).
- `src/documentdb/queryInsights/streamingResponseParser.ts` — **new** parser (WI-7).
- [src/documentdb/queryInsights/transformations.ts](../../src/documentdb/queryInsights/transformations.ts) — per-recommendation transform (WI-7/8).
- `src/webviews/documentdb/collectionView/types/queryInsightsStream.ts` — **new** event union (WI-5).
- [.../types/queryInsights.ts](../../src/webviews/documentdb/collectionView/types/queryInsights.ts) — existing types (reference).
- `.../queryInsightsTab/QueryInsightsTab.tsx` — subscribe + progressive render (WI-6/9).
- `.../queryInsightsTab/components/streamingPlaceholder/StreamingPlaceholder.tsx` — **new** shared element (WI-1).
- [.../queryInsightsTab/components/optimizationCards/ImprovementCard.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/ImprovementCard.tsx) — recommendation card; owns `ArrowTrendingSparkleRegular` icon; render in partial state for the shell (D11/WI-9).
- [.../queryInsightsTab/QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx) — per-type icon usage (`SparkleRegular`/`WarningRegular`) to mirror in shells (D11/WI-9).
- [src/webviews/\_integration/trpc.ts](../../src/webviews/_integration/trpc.ts) — telemetry middleware (reference for §7).
- `packages/vscode-ext-react-webview` — `TypedEventSink`, `WebviewController`, and the README's **"Push events from the extension host to the webview"** section (the authoritative streaming/subscription reference; no change expected).

---

## 10. Verification strategy

- **Unit:** streaming parser (WI-7 — exhaustive), `onChunk` propagation, transform.
- **Integration/manual:** slow query → progress <2s, paragraph reveal, shell→fill,
  mid-stream cancel clears partial UI, **final state identical to today**.
- **Telemetry:** dedicated completion event fires with all keys; LLM-duration events intact.
- **PR checklist:** `npm run l10n`, `npm run prettier-fix`, `npm run lint`,
  `npx jest --no-coverage`, `npm run build` — all green.

---

## 11. Risk register

| Risk                                                        | Mitigation                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Streaming JSON parser subtly wrong (escapes, nested braces) | Pure module + exhaustive unit tests (WI-7); full `JSON.parse` reconciliation on completion guarantees no regression.                                                                                                                                                                             |
| First-ever subscription consumer, no in-repo reference      | Read `WebviewController.handleSubscriptionMessage` before WI-5 and follow the webview-trpc-messaging skill's subscription example. Option A keeps the surface small (a generator + `for await`); `TypedEventSink` is **not** used (D12), so its semantics need not be mastered for this feature. |
| Telemetry data loss on subscription                         | Dedicated completion event (§7), not the auto rpc event.                                                                                                                                                                                                                                         |
| R1 front-loads least-valuable block first                   | Accepted per D1; paragraph reveal keeps it engaging; revisit (R2/R3) only if user dislikes.                                                                                                                                                                                                      |
| Layout jump (OPEN-1)                                        | Resolve in WI-9; document choice.                                                                                                                                                                                                                                                                |
| Cancellation leaves partial UI                              | Explicit clear on unsubscribe/abort; covered by WI-6 acceptance.                                                                                                                                                                                                                                 |

---

## 12. Deviation Log

> Append an entry whenever implementation diverges from this plan. Format:
> `YYYY-MM-DD — WI-n — <what changed> — <why> — <confidence%> — <user consulted? y/n>`

**Decision record (pre-implementation):** Streaming uses **Option A** (CopilotService exposes
an `AsyncIterable<string>`; the subscription `yield`s fragments directly — no `TypedEventSink`).
**Option B** (`onChunk` callback bridged into a `TypedEventSink`) was deliberately rejected:
Stage 3 is one request → one pull-based LLM stream → one consumer, where a generator gives
automatic backpressure, a single linear data path, natural error propagation, and one-path
cancellation. `TypedEventSink` is reserved for a future need to merge a **second push-based
source** into the stream; reintroducing it is a deviation worth logging (and consulting the user
if confidence < 80%).

_(none yet)_

2026-05-29 — WI-7 — `verification` items are sourced from the reconciled `JSON.parse` on
`finalize()` rather than streamed per-item — Items don't benefit from progressive reveal
(short text, all-or-nothing list at the end of the UI flow), and the reconciled source
avoids any risk of partial-string truncation mid-stream. Streaming-side extraction would
have added meaningful state-machine complexity for zero user-visible win. — 90% — n.

2026-05-29 — WI-7 — Progressive markdown emission triggers on `\n\n` only (not separately
on `###` as plan §4/WI-7 lists "split on `###` / blank line") — In practice the LLM always
puts a blank line before `### Heading`, so `\n\n` detection covers the same boundaries.
Detecting `\n###` mid-stream would require 3-char lookbehind for negligible additional UX
benefit. — 85% — n.
