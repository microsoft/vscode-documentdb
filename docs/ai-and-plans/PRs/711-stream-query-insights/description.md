# PR #711: Streaming UX for Stage 3 AI recommendations

**Branch:** `dev/tnaum/stream-query-insights`
**Base:** `main`
**Date:** 2026-06-01
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/711
**Commits:** 44 on top of `main` (+5603 / −1712 lines, 34 files)
**Companion document:** [original-plan.md](./original-plan.md) — the 11-work-item plan that drove implementation, preserved as-is.

---

## Why

After PR #690 shipped AI-powered Query Insights, the dominant complaint was the
**~15 second blank wait**: the user clicked "Get AI Performance Insights",
watched a single spinner, and after ~15 s the entire result appeared in one
drop. Even when the underlying LLM call was healthy, the UX felt broken,
because the user had no signal that anything was happening past the first
second.

Diagnostics on top of the buffered call confirmed it: time-to-first-token from
the model was ~3 s, the LLM kept streaming for ~10–12 s, and we held all of it
until the very end before parsing once and rendering. We were strictly worse
than what the model was already producing.

The goal of this PR was to **fix the perceived progress** end-to-end:

1. Stream the LLM response from the host to the webview progressively.
2. Parse it incrementally so cards can render as data arrives.
3. Choreograph the cards so the user understands what is happening and
   layout never reorders.
4. Keep telemetry parity with the buffered procedure so we do not regress any
   dashboards.

There was **no goal** to do token-by-token rendering (that style was explicitly
rejected — too noisy for this content shape).

A separate but adjacent goal: clean up the bugs the streaming refactor
revealed in surrounding code (animations that never played, dead code paths,
ambiguous dual-source render logic).

---

## What was done

The work landed in four phases, each scoped tightly enough to ship and review
independently. See [original-plan.md](./original-plan.md)
for the original 11-work-item plan ("WI-1" through "WI-11").

### Phase 1 — Plumb the stream

A new `CopilotService.streamMessage` exposes the LLM response as an
`AsyncIterable<string>` of fragments plus a `completion` promise sibling
(`CopilotStreamHandle`). The existing buffered `sendMessage` stays for any
non-streaming caller; both share a private `streamToModel` primitive so the
two paths cannot drift apart. `optimizeQueryStreaming` and
`QueryInsightsAIService.getOptimizationRecommendationsStreaming` thread the
iterable through the orchestration layer; the final `JSON.parse` happens once
on `completion`. AbortSignal → CancellationTokenSource bridging is preserved.

A new sub-router `collectionView.queryInsights.*` carries the Stage 3
procedures (split out of `collectionsViewRouter` so the parent does not keep
growing). Push-style procedures live in a sibling
`queryInsightsEventsRouter.ts` per the package README convention and are
spread into the main sub-router so the webview-visible paths stay flat:
`collectionView.queryInsights.streamStage3`.

`streamStage3` is the first real consumer of the framework's tRPC
subscription transport in `src/`. It is implemented as an `async function*`
that iterates `streamHandle.fragments` directly and `yield`s domain events
— **not** via `TypedEventSink`. The rejected-option rationale is recorded in
the plan (D12): for one-request → one-stream → one-consumer, a generator
gives automatic backpressure, a single linear data path, natural error
propagation, and one-path cancellation; `TypedEventSink` is the right tool
only when a second push-based source must be merged into the stream.

### Phase 2 — Tolerant incremental parser

`StreamingResponseParser` is a pure char-by-char state machine that consumes
the cumulative JSON buffer and emits domain events as soon as it can prove
them complete:

- `summary` / `educational` events with cumulative markdown, emitted on every
  newline boundary (`\n`) until the value's closing quote is observed.
- `recommendationStarted{index}` on each `improvements[]` element open, and
  `recommendation{index, …}` on each element close. String/escape-aware
  brace counting so braces inside `shellCommand` / `justification` / `risks`
  do not miscount.
- `verification{items[]}` is sourced from the canonical `JSON.parse` on
  `finalize()` rather than streamed per-item — items don't benefit from
  progressive reveal and reconciliation avoids any partial-string risk
  (Deviation #1 in the plan; 90% confidence, no user consult needed).

`finalize()` always runs the canonical `JSON.parse` over the full buffer; if
the streamed events disagree with the reconciled parse, the reconciled
result wins. The buffered path is therefore impossible to regress
structurally: in the worst case (malformed mid-stream), the final view is
byte-identical to what the old buffered procedure produced.

The parser ships with 25 unit tests covering: byte-at-a-time feeding,
escape boundaries split across fragments, multiple improvements,
zero improvements, truncated stream, malformed JSON fallback, double-finalize
guards, and out-of-order keys.

### Phase 3 — Progressive rendering

The webview swaps from `.query()` to `.subscribe()` and routes each
structured event into per-stream state on `collectionViewContext`:

- A per-stream `QueryInsightsStreamingState` mirrors a strict subset of the
  event union (summary, educational, recommendations[]). It is the SOLE
  source of truth for the Stage-3 cards.
- On terminal `complete`, a `synthesizeStage3Data()` helper materialises
  the equivalent fully-formed snapshot into `stage3Data` for the model
  byline and the `GetPerformanceInsightsCard` collapse sentinel — the
  only two readers of the snapshot left.
- The card render path is gated on
  `phase === 3 && (status === 'loading' || streaming)`. All three Stage-3
  slots (Analysis → Recommendations → Educational) are reserved from the
  moment the user clicks "Get AI Performance Insights"; each slot starts
  with a spinner-bearing placeholder and is replaced in place by its
  filled counterpart when the matching event arrives. Layout never
  reorders.

`AnimatedCardList` was extended with a `pendingEnter` two-step
(`visible=false` first render → flip to `true` on the next
`requestAnimationFrame`) so Fluent's presence components actually play
their enter motion — see decision below. Per-item `inFlight` flag picks
`Fade` (no `maxHeight`/`overflow:hidden` clipping) over `CollapseRelaxed`
for streaming cards so the markdown grows visibly as chunks arrive.

The recommendation slot uses a single `ImprovementCardShell` with a
`mode: 'loading' | 'empty'` prop so the pending placeholder, the
shell-while-drafting, and the "no recommendations" empty state all share
the same React key (`rec-0`) and the same outer Card frame — only the
icon, title, and body swap.

### Phase 4 — Telemetry preservation + closeout

`documentDB.queryInsights.stage3.completed` is a new dedicated completion
event flushed from the subscription's `finally` block via
`callWithTelemetryAndErrorHandling`. It carries the same 17 properties /
measurements the buffered procedure used to record on its rpc event, plus
`durationMs` (wall-clock from request to flush) and `aborted`
(`'true'` / `'false'`).

The new event is necessary because `trpcToTelemetry` wraps `opts.next()`
which, for a subscription, resolves at generator-creation time
(milliseconds). Anything measured during iteration is lost on the auto rpc
event. The auto event still fires for subscription-create-rate metrics, but
the new event is the canonical source for Stage 3 telemetry on the
streaming path. The old→new mapping table lives in WI-10 of the plan; copy
it into the PR description before merge.

---

## Post-implementation: cleanup, fixes, UX polish

After the 11-WI plan landed, two rounds of post-merge-style work happened on
this branch:

### Investigation-driven cleanup (7 commits)

Triggered by a "what is still open?" review pass:

- Removed the dead buffered `getQueryInsightsStage3` procedure and its
  500-line `transformAIResponseForUI` family (no callers since WI-6;
  −392 LoC).
- Removed the `stage3Promise` field — always written as `null` along the
  streaming path, never read.
- Dropped the unused `verification` accumulator from `QueryInsightsStreamingState`
  (the parser still emits the event; the UI just doesn't surface it).
- Card render now reads exclusively from `streaming` (no
  `streaming OR stage3Data` fallback ambiguity).
- Four `docs(...)` commits leaving long inline comments for the
  load-bearing-but-non-obvious patterns future maintainers might
  "simplify": the `pendingEnter` rAF flip, the requestKey staleness
  guard, the byte-identical `createImprovementCard` single-source-of-truth
  contract, the telemetry delivery guarantees, and the post-cleanup
  comment refresh in `queryInsightsEventsRouter.ts`.

### UX polish (12 commits)

Triggered by hands-on testing of the streaming UX:

- Built `StreamingInlineProgress` (Spinner + label) and replaced the
  shimmer-lines that `MarkdownCard` and `ImprovementCardShell` used —
  the shimmer competed with the streamed markdown for attention and
  did not read as "still working".
- Removed the "DocumentDB Performance Tips" stalling card entirely
  (existed only to entertain during the buffered 15 s wait;
  −238 LoC).
- **Option A layout**: pre-reserve all three Stage 3 slots in canonical
  order as soon as the user clicks "Get AI Performance Insights"
  instead of waiting for the first structured event (~3 s of TTFT).
  Eliminates the "stuff appearing in random places" effect.
- **In-place empty state**: the "No index changes recommended" card
  reuses the recommendation slot's React key (`rec-0`) via
  `ImprovementCardShell mode='empty'` — only icon/title/body swap.
- **Disclaimer on every state**: `ImprovementCardShell` now shows the
  "AI responses may be inaccurate" footer in both `loading` and
  `empty` modes, matching `ImprovementCard`.
- **Plan B (drop redundant spinner)**: `GetPerformanceInsightsCard`
  no longer renders its own "Spinner + AI is analyzing…" row during
  loading. The three slot spinners below it carry the "working"
  message. The card keeps only the Cancel button during loading.
- **Card-key cascade fix**: the reducer no longer clears
  `stage3RequestKey` on the `complete` event. Card keys
  (`${stage3RequestKey ?? ''}-analysis-card`, etc.) used to flip from
  `${uuid}-…` to `…` in the same React commit, which `AnimatedCardList`
  saw as "all old keys gone, all new keys arrived" and animated a full
  exit + enter cascade — visible as a flash on remote-desktop sessions.
- **`unmountOnExit`** on the `GetPerformanceInsightsCard` collapse so
  it leaves the DOM entirely once collapsed; the next regenerate gets
  a fresh mount + enter animation.
- **Faded byline**: the post-response "Powered by …" byline is wrapped
  in `Fade` with the same `pendingEnter` two-step so it glides in over
  the same window the card collapses out, instead of popping.

### Cancel-UX finalization (supersedes "Plan B" above)

Hands-on testing of the loading state showed the thinned-out
`GetPerformanceInsightsCard` (Cancel button + disclosure, no spinner —
"Plan B") still read as a large, mostly-empty card sitting above the three
working slots. The final iteration replaces it during loading with a
dedicated slim affordance:

- **`Stage3AnalyzingCard`** (new): a one-line brand-tinted card —
  `Spinner size="tiny"` + "AI is analyzing…" + an `outline` **Cancel**
  button. Rendered as a **plain conditional on `isStage3Loading`** (no
  motion wrapper). During loading the full `GetPerformanceInsightsCard`
  collapses out entirely and this slim row is the only Stage-3 control.
- **Two independent elements, not one shared wrapper.** The request card
  keeps its own `CollapseRelaxed` (visible only when
  `phase >= 2 && !stage3Data && !isStage3Loading`); the slim row is a bare
  conditional. An earlier attempt to merge both into a single
  `CollapseRelaxed` whose content swapped between the two reintroduced a
  lingering-card bug: `stage3Data` stays truthy after completion, and the
  content-swap at the wrapper's exit edge stopped it from unmounting, so
  the slim row stuck on screen. A plain conditional is deterministic —
  the instant `isStage3Loading` is false the row leaves the DOM, so it can
  neither flash nor get stuck.
- **Cancel semantics:** "Cancel" (not "Abort"/"Stop") — platform-standard,
  low-anxiety, and pairs with a full state revert so the request can be
  re-issued. `handleCancelAI` does one race-free reducer commit
  (`currentStage → cancelled`, all Stage-3 stream/data/error fields → null),
  which drops the slim row and animates the request card back in.
- **No resize-in-place motion.** Fluent ships no built-in component that
  animates between two non-zero heights (verified against
  `@fluentui/react-components@9.73.3` and
  `@fluentui/react-motion-components-preview@0.15.4` — all presence
  components animate only on the `visible` boolean). The request-card ↔
  slim-row swap is therefore an instant height change by design; building
  a custom `createMotionComponent` resize wrapper was scoped out as polish
  not worth the complexity.

The `complete`/`error`/`cancel` reducer transitions all set `currentStage`
in the **same commit** that materialises (or clears) `stage3Data`, so
`isStage3Loading` and the card visibility flip atomically — no batched-flag
staleness, no intermediate frame where both cards or neither card shows.

---

## Key decisions and rationale

### Why streaming and not just a real progress indicator

Considered: the buffered call survives, plus a sub-second progress indicator
that animates while we wait. Rejected: the progress would be entirely fake
(no real signal from the LLM until completion). Users notice. The architecture
to fix this properly (streaming + incremental parse) was straightforward, and
the buffered path is preserved in spirit by the canonical `JSON.parse`
reconciliation on `finalize()`. Strictly better outcome, modest
architecture cost.

### Why a generator subscription, not `TypedEventSink`

Recorded as decision D12 in the plan. Stage 3 is one request → one pull-based
LLM stream → one consumer. A generator subscription gives:

- **Automatic backpressure**: the LLM source is pulled only when the
  generator is ready to yield. No unbounded buffer.
- **Single linear data path**: producer and consumer are the same loop.
  Event ordering and completion are inherent.
- **Natural error propagation**: a throw in the LLM iteration becomes a
  normal tRPC error.
- **One-path cancellation**: `ctx.signal?.aborted` polling + the
  framework's `iterator.return()` propagate straight into the loop.

`TypedEventSink` (the push→pull adapter the framework also ships) is the
right tool when a generator must merge a second push-based source it cannot
`await` — a VS Code event emitter, a parallel task, a mid-stream
notification. None of those apply here. If a future change interleaves a
second push source, that is the point to revisit `TypedEventSink` — log it
as a deviation and consult.

### Why a dedicated completion telemetry event, not the auto rpc event

`trpcToTelemetry` wraps `opts.next()` in
`callWithTelemetryAndErrorHandling`. For a subscription, `opts.next()`
resolves at **generator-creation** time, not at completion. Any
measurement set during iteration is therefore lost on the auto rpc event.
The new `documentDB.queryInsights.stage3.completed` event is fired from
the subscription's `finally` block, so it captures the final values plus
the `aborted` flag and the wall-clock `durationMs` regardless of how the
stream ended.

The new event is fire-and-forget (`void callWithTelemetryAndErrorHandling(...)`).
The flushCompletionEvent comment block in
`queryInsightsEventsRouter.ts` documents the exact delivery
guarantees: reaches the wire on Cancel / panel close / regenerate, usually
reaches it on normal VS Code shutdown, may not reach it on force-quit /
OS kill / extension host crash. Acceptable for our analytics use case.
Should not be promoted to at-least-once without a backing store + dedupe key.

### Why `verification` is reconciled, not streamed

Plan deviation #1. Verification items are a short prose list that always
arrives at the end of the response and is rendered all-at-once or not at
all. Streaming them would add state-machine complexity for zero user-visible
benefit, and the canonical `JSON.parse` source rules out any
mid-stream truncation risk. The event is still emitted from `finalize()`
so a future card that wants the items can subscribe without renegotiating
the protocol.

### Why progressive markdown emission triggers on `\n`, not on `\n\n` / `###`

Plan deviation #2 (originally `\n\n`, later relaxed to `\n`). Real LLM
output sends multi-paragraph chunks; per-`\n\n` emission left the user
staring at half-rendered paragraphs for whole seconds. Per-`\n` emission
makes the markdown grow continuously without any structural risk
(ReactMarkdown handles partial paragraph endings fine). `###` detection
mid-stream would require 3-char lookbehind for negligible additional
benefit; in practice the LLM always puts `\n\n` before `### Heading`, so
the simpler trigger covers the same boundaries.

### Why the Stage 3 cards are pre-reserved on click ("Option A")

Earlier behaviour: cards appeared in **LLM emission order**
(`educationalContent` first, then `analysis`, then `improvements`), which
on screen looked like new cards landing in arbitrary positions and pushing
the existing ones down. Three other options were evaluated:

| Option                                                                    | Trade-off                                                                   | Verdict                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **B**: render in canonical order, hide each slot until its data exists    | Order is correct but late slots still pop in suddenly                       | Worse than A                                                         |
| **C**: render in arrival order, animate position swap when analysis lands | Visible re-order draws attention; looks clever, risks looking like a glitch | Rejected                                                             |
| **D**: keep status quo, accept one shift                                  | Cheap but jumpy                                                             | Rejected once Option A's implementation cost turned out to be modest |
| **A**: pre-reserve all three slots in canonical order at click time       | Layout is final from t=0; cards fill in place                               | Adopted                                                              |

Option A required only a gate change on the existing render code plus
`MarkdownCard` accepting empty `content=""` (which `ReactMarkdown` renders
as nothing), so no new card shape was introduced.

### Why "Plan B" (drop the inner spinner) over "collapse the card on loading"

Once Option A was in place there were **four spinners** on screen during
Stage 3 loading: one inside `GetPerformanceInsightsCard` ("AI is analyzing…")
plus one in each of the three pre-reserved slots. Two reasonable fixes:

- **Plan A**: collapse the GetPerformanceInsightsCard card the moment
  loading starts (today it collapses on `complete`). The slots take over
  completely. Cancel button needs a new home (toolbar above slots, or a
  floating button).
- **Plan B**: keep the card visible but drop its internal spinner +
  "AI is analyzing…" text. The card becomes a thin control bar carrying
  only the Cancel button + cost-neutral disclosure during loading.

Plan B was picked because (a) the Cancel button is already in a familiar
location and moving it would be an unrelated UX change, (b) the
cost-neutral disclosure row stays visible alongside the slots which
matched the "always show the disclaimer" intent that drove a related
sibling commit, and (c) it required less code.

> **Superseded.** Later testing showed the thinned card still read as a
> large empty box above the slots. The final design collapses it during
> loading and shows the slim `Stage3AnalyzingCard` instead — see
> "Cancel-UX finalization" under _Post-implementation_ above.

### Why the card-key cascade fix lives in the reducer, not in `AnimatedCardList`

The `keyPrefix` was being recomputed from `stage3RequestKey` and applied to
every card. Two ways to avoid the cascade:

- **Reducer fix**: keep `stage3RequestKey` set across the success
  boundary, only clear it on lifecycle transitions that warrant a fresh
  remount (phase 1/2/3 reset, cancel, error). One-line behaviour change.
- **Render-path fix**: drop `keyPrefix` entirely; rely on
  `transitionToStage(3, 'loading')` clearing `stage3Streaming` to force
  remount via the "items in source" diff. Larger surface area; would
  also need to verify the existing post-success snapshot render path
  was not relying on the keyPrefix for any subtle reason.

Reducer fix is the smaller change and the right place for the
intent ("request is still considered current after `complete` until a
new one starts"). Documented inline with the 20-line comment so the
next person to wonder "why is requestKey still set after complete?" has
the answer without `git blame`.

### Why `unmountOnExit` on the GetPerformanceInsightsCard collapse

Before this prop, the card sat in the DOM at `max-height: 0` between
requests. On regenerate the enter animation expanded that already-mounted
element, which carried its previous render state (focus, internal
button-disabled timing, etc.) across the boundary. With `unmountOnExit`
the post-success DOM is one tree smaller, the next regenerate gets a
fresh mount with a clean enter animation, and the implicit
"this card has lifecycle" mental model is honest about it.

### Why `pendingEnter` instead of `appear={true}`

Fluent's `createPresenceComponent` defaults `appear={false}`. New items
mounted with `visible={true}` straight away → framework treats first mount
as "already in" → enter animation silently skipped. The natural-looking
fix is `appear={true}`, but the items here are added from a parent reducer
that re-renders the list synchronously: by the time Fluent's presence
component effect runs, `visible={true}` is already the initial value, and
the framework only animates on a subsequent `visible` change. The
two-step (`visible=false` on first render → flip on rAF) gives the
component the real `false → true` transition it needs.

A doc-only commit added a "do NOT replace with `appear={true}`" warning
inline on the `pendingEnter` field, so a future maintainer doesn't burn
half an afternoon trying to simplify away a workaround that exists for a
reason.

### Why labels read "Analyzing… / Drafting… / Explaining…"

Sets of candidate copy were proposed (professional, slightly warmer,
domain-flavoured, playful). The settled style is **professional and
calm, present continuous, uniform length** — three different verbs
that map cleanly to what each card is producing. Calm copy reads
deliberate and trustworthy next to the "AI responses may be inaccurate"
disclosure; playful copy risked undercutting trust.

### Why dual-source render was simplified to streaming-only

After WI-6 the buffered query had no caller; the
`streaming OR stage3Data?.improvementCards` fallback was dead. Removing
it dropped ~94 LoC and clarified that `stage3Data` has exactly two
legitimate readers post-cleanup: (a) the
`GetPerformanceInsightsCard` collapse gate (`!stage3Data` as a
"has succeeded at least once" sentinel), and (b) the byline / model
disclosure (`stage3Data.modelDisplayName`). Both are documented in the
render block; both would migrate cleanly if `stage3Data` were ever
deleted entirely.

---

## What is intentionally NOT in this PR

- **Status events surfacing in the UI** during the ~3 s TTFT window
  (the server emits `status{connecting|receiving|parsing}` with
  `elapsedMs` and `charsReceived`; the webview reducer currently ignores
  them). The pre-content phase still shows just a spinner. Deferred —
  see "Future work" below.
- **Multi-recommendation visual order**: when the LLM emits N>1
  recommendations they currently insert below the previous shell with
  `CollapseRelaxed`, which is smooth but pushes everything below them.
  Acceptable today; would be addressed if the recommendation count grows.
- **Min-display-time for shells**: very fast `recommendationStarted` →
  `recommendation` transitions can cause a sub-frame shell flash. Not
  observed in practice with current LLM latencies, deferred.
- **Live token / usage display**: tokens are in telemetry only (decided
  by PR #690; unchanged here).

---

## Future work

- **Surface `status` events in the UI** during TTFT. The data is on the
  wire (`elapsedMs`, `charsReceived`); the webview reducer just needs a
  case for it and a small "contacting the model…" affordance.
- **Animated min-visible time** for shells (if rapid-fire fast models
  ever cause the sub-frame flash).
- **Consider Stagger for the initial slot-reveal**: Fluent's
  `@fluentui/react-motion-components-preview/Stagger` could choreograph
  the three slots appearing on click instead of all-at-once. Out of
  scope for this PR; the Motion Sandbox webview (added then reverted in
  this branch, see commits `d4979c5c` and `6862999f`) was used to
  evaluate it.

---

## Files changed (significant)

| File                                                                                      | Change                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/services/copilotService.ts`                                                          | `streamMessage` async-iterable API; private `streamToModel` primitive shared with buffered path; `CopilotStreamHandle` |
| `src/services/copilotService.test.ts`                                                     | New unit tests for streaming + abort + no-model paths                                                                  |
| `src/services/ai/QueryInsightsAIService.ts`                                               | `getOptimizationRecommendationsStreaming` + handle type                                                                |
| `src/services/ai/QueryInsightsAIService.streaming.test.ts`                                | End-to-end streaming integration test                                                                                  |
| `src/commands/llmEnhancedCommands/indexAdvisorCommands.ts`                                | `optimizeQueryStreaming` + shared `prepareOptimizationRequest` / `finalizeOptimizationResponse` helpers                |
| `src/documentdb/queryInsights/streamingResponseParser.ts`                                 | New tolerant incremental parser (state machine; string-aware brace counting; reconciliation on `finalize()`)           |
| `src/documentdb/queryInsights/streamingResponseParser.test.ts`                            | 25 unit tests covering happy path, fragment boundaries, escapes, malformed input, truncation, etc.                     |
| `src/documentdb/queryInsights/transformations.ts`                                         | Dead `transformAIResponseForUI` + helpers removed (cleanup)                                                            |
| `src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts`             | New sub-router (Stage 1/2/3 + action handler relocated from `collectionViewRouter.ts`)                                 |
| `src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts`       | New push-style router carrying `streamStage3` subscription + completion telemetry                                      |
| `src/webviews/documentdb/collectionView/collectionViewRouter.ts`                          | Stage 3 procedures relocated; sub-router mounted                                                                       |
| `src/webviews/documentdb/collectionView/types/queryInsightsStream.ts`                     | Discriminated union for the wire-format streaming events                                                               |
| `src/webviews/documentdb/collectionView/utils/createImprovementCard.ts`                   | Webview-side per-recommendation transform (sole source of truth post-cleanup)                                          |
| `src/webviews/documentdb/collectionView/collectionViewContext.ts`                         | `QueryInsightsStreamingState` + `stage3Streaming` slot; `stage3Promise` removed                                        |
| `src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx` | Subscription wiring, reducer for structured events, render rewrite for pre-reserved slots, byline fade                 |
| `.../components/animatedCardList/AnimatedCardList.tsx`                                    | `pendingEnter` two-step + per-item `inFlight` motion picker (Fade vs CollapseRelaxed)                                  |
| `.../components/optimizationCards/MarkdownCard.tsx`                                       | `inFlight` + `inFlightLabel` props; shimmer dropped                                                                    |
| `.../components/optimizationCards/ImprovementCardShell.tsx`                               | `mode: 'loading' \| 'empty'` shared shell                                                                              |
| `.../components/optimizationCards/TipsCard.tsx + .scss`                                   | Removed (no longer needed)                                                                                             |
| `.../components/streamingPlaceholder/StreamingInlineProgress.tsx`                         | New Spinner + label primitive                                                                                          |
| `.../components/optimizationCards/custom/GetPerformanceInsightsCard.tsx`                  | Drop inner spinner during loading; collapses out entirely while loading                                                |
| `.../components/optimizationCards/custom/Stage3AnalyzingCard.tsx`                         | New slim loading affordance (Spinner + "AI is analyzing…" + Cancel) shown during Stage 3 streaming                     |
| `l10n/bundle.l10n.json`                                                                   | Regenerated                                                                                                            |

---

## Telemetry mapping

| Old event/key                                                | New event/key                                                                                                                                   | Notes                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `documentDB.rpc.query.collectionView.getQueryInsightsStage3` | `documentDB.rpc.query.collectionView.queryInsights.getQueryInsightsStage3` (path moved by WI-4) → **removed entirely** by buffered-path cleanup | Stage 3 webview path is now exclusively `streamStage3` |
| `…getQueryInsightsStage3 → properties.platform`              | `documentDB.queryInsights.stage3.completed → properties.platform`                                                                               | Identical population                                   |
| ↑ `properties.hasStaticAnalysisSummary`                      | ↑ `properties.hasStaticAnalysisSummary`                                                                                                         | Identical                                              |
| ↑ `properties.staticAnalysisSummaryError`                    | ↑ `properties.staticAnalysisSummaryError`                                                                                                       | Identical                                              |
| ↑ `properties.staticAnalysisSummaryErrorKind`                | ↑ `properties.staticAnalysisSummaryErrorKind`                                                                                                   | Identical                                              |
| ↑ `properties.hasCachedExecutionPlan`                        | ↑ `properties.hasCachedExecutionPlan`                                                                                                           | Identical                                              |
| ↑ `properties.aiModelDisclosed`                              | ↑ `properties.aiModelDisclosed`                                                                                                                 | Identical                                              |
| ↑ `properties.aiModelFamily`                                 | ↑ `properties.aiModelFamily`                                                                                                                    | Identical                                              |
| ↑ `measurements.staticAnalysisSummaryLength`                 | ↑ `measurements.staticAnalysisSummaryLength`                                                                                                    | Identical                                              |
| ↑ `measurements.recommendationCount`                         | ↑ `measurements.recommendationCount`                                                                                                            | Identical                                              |
| ↑ `measurements.actionableRecommendationCount`               | ↑ `measurements.actionableRecommendationCount`                                                                                                  | Identical                                              |
| ↑ `measurements.createRecommendationCount`                   | ↑ `measurements.createRecommendationCount`                                                                                                      | Identical                                              |
| ↑ `measurements.dropRecommendationCount`                     | ↑ `measurements.dropRecommendationCount`                                                                                                        | Identical                                              |
| ↑ `measurements.modifyRecommendationCount`                   | ↑ `measurements.modifyRecommendationCount`                                                                                                      | Identical                                              |
| ↑ `measurements.promptTokens`                                | ↑ `measurements.promptTokens`                                                                                                                   | Identical                                              |
| ↑ `measurements.responseTokens`                              | ↑ `measurements.responseTokens`                                                                                                                 | Identical                                              |
| ↑ `measurements.totalTokens`                                 | ↑ `measurements.totalTokens`                                                                                                                    | Identical                                              |
| ↑ `measurements.maxInputTokens`                              | ↑ `measurements.maxInputTokens`                                                                                                                 | Identical                                              |
| ↑ `measurements.promptUtilizationPct`                        | ↑ `measurements.promptUtilizationPct`                                                                                                           | Identical                                              |
| _(none)_                                                     | `documentDB.queryInsights.stage3.completed → measurements.durationMs`                                                                           | New: wall-clock subscription duration                  |
| _(none)_                                                     | ↑ `properties.aborted` (`'true'` / `'false'`)                                                                                                   | New: terminal abort state                              |

The auto rpc event `documentDB.rpc.subscription.collectionView.queryInsights.streamStage3`
still fires for every subscription, but carries ~0 duration and no custom
properties/measurements. Telemetry queries that target Stage 3 should switch
to `documentDB.queryInsights.stage3.completed` as the canonical source for
the streaming path; the old rpc event remains useful only for
subscription create-rate metrics. **No data lost.**

---

## Related issues and references

- **Plan**: [original-plan.md](./original-plan.md) — full 11-WI plan with per-WI outcome blocks and deviation log.
- **PR #690** (`dev/tnaum/query-insights-model-transparency`) — added the model byline and the cost-neutral disclosure that this PR's UX choreography integrates with.
- **PR #676** (`dev/tnaum/webview-api-package`) — established the tRPC subscription transport that `streamStage3` is the first real consumer of in `src/`.
- **Tracking issue**: #665.
