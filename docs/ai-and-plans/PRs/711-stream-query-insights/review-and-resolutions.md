# PR #711 — Review and Resolutions (Streaming Stage 3 UX)

**PR:** [WIP] feat(query-insights): streaming UX for Stage 3 AI recommendations
**Branch:** `dev/tnaum/stream-query-insights` → `main`
**PR goal (the lens for every recommendation below):** improve *perceived*
responsiveness — keep the UI alive and informative while the user waits for AI
recommendations, instead of a ~15 s blank spinner. Issues are weighed by how much
they hurt or help that goal.

**What this document is:** a single, severity-sorted, **re-verified** rewrite of the
earlier manual review (findings 1–12) and the Copilot reviewer pass (C1–C5), now
serving as the **living resolutions tracker** for the fixes. Every item below was
re-checked against the current source on this branch. Where the original review was
wrong, overstated, or stale, that is called out explicitly under *Verification*. As
each item is fixed, a **`> ✅ RESOLVED`** (or `> ⏸️ POSTPONED` / `> ✋ NO CODE
CHANGE`) note is added inline under that item recording what was done, the decision
taken, and the commit.

> Relocated from `docs/analysis/` (gitignored) into this PR docs folder on
> 2026-06-05 so the resolutions are tracked alongside the PR documentation.

---

## Operator decisions (2026-06-05) driving these resolutions

These are the choices made by the operator for each finding; the inline `RESOLVED`
notes below implement them.

| Item | Decision |
| ---- | -------- |
| H1 | **Option B** — reducer-only safety net (drop `null` rec slots / hide empty fields on `complete`). Explicitly NOT a second parser. "Paint over the issue, save maintenance." Telemetry must be preserved; removing any data point requires sign-off. Update PR description + log decision. |
| H2 | Same mechanism as H1. Keep pre-reserving slots during loading; hide a card only if its content never arrives. |
| M1 | A — clear the error-dedupe set on a fresh load. |
| M2 | A — effect-based unsubscribe when leaving `s3Loading` for a non-terminal reason (reset). |
| M3 | A — clear the tips timer + `showErrorCard` on reset (same effect as M2). |
| M4 | A — make `Stage3AnalyzingCard` a polite live region. |
| M5 | A — memoize `insightCards` (`useMemo`). |
| M6 | A — `instanceof Error` guard in the debug-file catch. |
| M7 | A — standardize on the Unicode `…`; refresh l10n. |
| M8 | Non-issue → simplest thing (document the precondition; no behavioural change). |
| M9 | Keep current behaviour (re-run the query to unlock a fresh Stage 3). No code change. |
| L1 | **LAST, interactive.** Phase the analyzer card label (Initializing → Analyzing → Generating) driven by `status` events; build with the operator, may need extra logging. |
| L2 | Accept — lines are short in our scenario. No code change. |
| L3 | A — fix the `\n` vs `\n\n` doc drift. |
| L4 | A — hide Cancel once `s3Success`. |
| L5 | A — delete the dead `StreamingPlaceholder`. |
| L6 | A — correct the debug-activation comment. |

---

## How verification was done

Each finding was traced to the actual code paths that produce the behaviour:

- Stream production — [queryInsightsEventsRouter.ts](../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts)
- State reduction — [queryInsightsReducer.ts](../../src/webviews/documentdb/collectionView/queryInsightsReducer.ts)
- Render/lifecycle — [QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
- Parser — [streamingResponseParser.ts](../../src/documentdb/queryInsights/streamingResponseParser.ts)
- Reset path — [CollectionView.tsx](../../src/webviews/documentdb/collectionView/CollectionView.tsx)

**Important:** the PR *description* claims a `synthesizeStage3Data()` helper and a
"reconciled result wins on `finalize()`" contract on the render path. **That contract
is not present in the shipped reducer/router.** The description is stale on this point,
and that staleness is the root of the two High-severity issues. (The user flagged the
description may be out of date — confirmed here.)

---

## Verdict table (severity-sorted)

| # | Orig. ID | Finding | Verified? | Severity |
| - | -------- | ------- | --------- | -------- |
| H1 | #1 | Canonical reconciled parse never reaches the webview → slots can hang in a terminal "loading" state forever | ✅ Confirmed | **High** |
| H2 | #2 | Omitted optional `educationalContent` → permanent "Explaining…" spinner | ✅ Confirmed | **High** |
| M1 | #3 | `displayedErrorsRef` never cleared → retry of an identical error shows no toast | ✅ Confirmed | **Medium** |
| M2 | #11 | Query reset doesn't unsubscribe an in-flight Stage 3 stream → hidden LLM call + lost Cancel | ✅ Confirmed | **Medium** |
| M3 | #12 | `showErrorCard` / tips timer leak across a query reset → stale "Query Execution Failed" card | ✅ Confirmed | **Medium** |
| M4 | #9 | Screen-reader "AI is analyzing" announcement is effectively dead during streaming (regression of #380) | ✅ Confirmed (stronger than original) | **Medium** |
| M5 | C1 | `CardStack` `setState` during render → extra render churn during streaming | ⚠️ Confirmed, but Copilot's "infinite loop" framing is a **false alarm** | **Medium** |
| M6 | C2 | Unsafe `(error as Error).message` in the debug-file catch | ✅ Confirmed | **Medium** |
| M7 | C3 | ASCII `...` vs Unicode `…` → duplicate l10n keys for the same message | ✅ Confirmed | **Medium** |
| M8 | #4 | `streamStage3` subscription opens even when the reducer no-ops the transition | ⚠️ Confirmed but **latent** (not reachable via current UI) | **Low–Medium** |
| M9 | #5 | No way to re-run Stage 3 after success without re-running the query | ✅ Confirmed (product decision) | **Medium** |
| L1 | #6 | `status` events produced + throttled + sent, consumed by nothing | ✅ Confirmed | **Low** |
| L2 | #7 | Single-line `analysis`/`educational` values get no progressive reveal | ✅ Confirmed | **Low** |
| L3 | #8 | Doc drift: code emits per `\n`, type/JSDoc still say `\n\n` | ✅ Confirmed | **Low** |
| L4 | #10 | Cancel button is visible-but-inert during the success-collapse window | ✅ Confirmed | **Low** |
| L5 | C4 | `StreamingPlaceholder` is dead code (a11y bug only if revived) | ✅ Confirmed unused | **Low / cleanup** |
| L6 | C5 | Debug-override activation comment doesn't match the `_debug_active` guard | ✅ Confirmed | **Low** |

### Corrections / false alarms vs. the original review

- **M5 / C1** — Copilot called this a *"Too many re-renders" infinite loop*. **That is
  overstated.** The `setLastNonEmpty(items)` call is guarded (`items.length > 0 && items
  !== lastNonEmpty`) and converges: the setState re-renders `CardStack` with the **same**
  `items` prop reference, so the guard is false on the immediate re-render and the loop
  terminates. The real cost is **one extra `CardStack` render per parent render** — which
  still matters on a streaming surface that re-renders often, but it is not a crash.
- **M8 / #4** — real as an invariant gap, but **not currently triggerable**: the only
  caller (`handleGetAISuggestions`) is reachable solely from the states where
  `startStage3Load` *does* transition (button is hidden otherwise). Treat as hardening,
  not a live bug.
- **H1/H2 root cause** — the PR description's "reconciled result wins" guarantee is **not
  wired on the render path**; only the best-effort streamed events drive the cards. This
  is a stale-description problem, not just a code bug.

---

## High severity

### H1 — The canonical reconciled parse is never delivered to the webview (orig. #1)

**Where:**
[queryInsightsEventsRouter.ts](../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts)
(terminal `complete` event) and
[queryInsightsReducer.ts](../../src/webviews/documentdb/collectionView/queryInsightsReducer.ts)
(`applyStage3Event` `complete` case).

**Verification — Confirmed.**

- The terminal `complete` event is built with **model metadata only**:
  `{ type: 'complete', modelDisplayName, modelId, modelFamily, usage }`. No
  `improvements`, no `analysis`, no `educationalContent`.
- `streamHandle.completion` (`aiResponse`) and `parser.finalize().parsed` are computed,
  but used **only for telemetry**. `finalize().parsed` (the canonical reconciled object)
  is discarded.
- `parser.finalize()` only emits *trailing* events for a string value **still open** at
  end-of-stream. It does **not** emit events for a recommendation slot whose per-item
  `JSON.parse` failed, nor for a field that never streamed.
- The reducer's `complete` case folds **only `streaming`** (the best-effort buffer) onto
  `s3Success`, and its defensive `complete: true` flip only touches **non-null**
  `summary` / `educational`. A `null` slot stays `null`; a `null` recommendation entry
  stays a loading shell.

**Concrete failure mode:** `recommendationStarted{index}` reserves a `null` slot; if the
matching item's `JSON.parse` is swallowed in `tryEmitRecommendation`, the slot is never
filled. At success, `hasStartedRecs` is true, so the render loop emits
`<ImprovementCardShell />` ("Generating recommendation…") for that `null` — **in the
terminal success state, indefinitely.**

**Why it matters for the PR goal:** a hung spinner in the *success* state is the exact
"the UX feels broken" perception this PR set out to kill — and it is now *harder* to
notice because everything else looks finished.

**Solutions:**

- **A. Carry the reconciled snapshot on `complete` and reconcile in the reducer** (fill
  unfilled slots from `finalize().parsed` / `aiResponse`, and **drop** slots the
  canonical result proves empty).
  - Pros: makes the documented "reconciled result wins" invariant actually true; fixes
    H1 *and* H2 with one mechanism; no card can outlive the stream.
  - Cons: enlarges the `complete` event payload (re-sends data already streamed);
    reducer must diff/merge streamed vs. reconciled; small risk of a late visual "pop"
    if reconciled content differs from streamed.
- **B. Reducer-only safety net (no payload change):** on `complete`, drop any `null`
  recommendation slots and hide (not spin) any `null` summary/educational.
  - Pros: smallest change; no protocol/payload churn; kills the infinite spinner.
  - Cons: silently *loses* content the model actually produced but the streamer missed
    (recommendation shown nowhere) — papers over H1 instead of honoring the reconciled
    result; weaker than the stated design contract.
- **C. Send only the *missing* pieces on `complete`** (a sparse "fill-ins" map computed
  host-side by diffing streamed vs. reconciled).
  - Pros: minimal payload; honors reconciled-wins; avoids re-sending everything.
  - Cons: most complex host logic; the host must track exactly what it streamed to
    compute the delta.

> Recommendation: **A** (it is what the description already promises and resolves both
> High issues), with **B** as the minimal fallback if payload size is a concern.

---

### H2 — Omitted optional `educationalContent` → permanent "Explaining…" spinner (orig. #2)

**Where:** [types.ts](../../src/services/ai/types.ts)
(`educationalContent?: string` — explicitly optional) +
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
(educational card rendered unconditionally under `stage3CardsActive`, with
`inFlight={!educationalSource?.complete}`).

**Verification — Confirmed.** This is the most realistic concrete instance of H1 and
stands alone because the field is optional by contract:

- If the model returns valid JSON **without** `educationalContent`, the parser emits no
  `educational` event, so `streaming.educational` stays `null`.
- The card still renders (gated only on `stage3CardsActive`), and
  `inFlight = !null?.complete = !undefined = true` → empty body + "Explaining…" spinner
  **permanently** in the success state.
- The same applies to `analysis` if ever absent (less likely — it's required and
  `finalize()` even defaults it to `'No analysis provided.'`, but that default lives in
  the discarded `parsed` object, so it never reaches the UI; see H1).

**Repro:** mock a Stage 3 response = valid JSON with `analysis` + one `improvements`
item, **no** `educationalContent`. Expected: educational card hidden / gracefully
skipped. Actual: stuck spinner.

**Solutions:**

- **A. Gate the educational card on "loading OR reconciled content exists."** Don't
  pre-reserve a slot the terminal result proves empty (pairs naturally with H1-A).
  - Pros: correct end state; no empty card; no stuck spinner; cheap.
  - Cons: needs the reconciled result on `complete` (depends on H1-A/C), or at minimum a
    "this field is done and absent" signal.
- **B. On `complete`, treat a still-`null` educational/summary as "complete-and-empty"**
  and render nothing for it.
  - Pros: reducer-local; no payload change; immediately unblocks the spinner.
  - Cons: can't distinguish "model omitted it" from "streamer missed it" (acceptable for
    an optional field, riskier for `analysis`).
- **C. Always emit a terminal `educational`/`summary` event** (with `complete: true`,
  possibly empty markdown) from the host even when the field is absent.
  - Pros: keeps the reducer dumb; explicit "this slot is finished" signal per field.
  - Cons: empty markdown still needs a render-side "hide if empty" rule, so it doesn't
    fully stand alone.

> Recommendation: **A**, sharing the H1 reconciliation. **B** is the safe minimal patch
> if H1 is deferred.

---

## Medium severity

### M1 — `displayedErrorsRef` is never cleared (comment says otherwise) (orig. #3)

**Where:** [QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
— `displayedErrorsRef` is only ever read (`.has()`) and written (`.add()`); there is no
`.clear()` / `.delete()` anywhere. Its JSDoc claims *"Cleared whenever a fresh load
starts."*

**Verification — Confirmed** (grep: only `.has` + `.add`, never cleared).

**Effect:** Stage 3 fails with e.g. "network error" → toast shown, key
`stage3-network error` recorded. User retries, identical failure →
`displayStageError` early-returns → **no notification on the retry** (and every
subsequent identical failure). Same for repeated Stage 1/2 errors with identical
messages. The user gets silence exactly when they're actively retrying.

**Solutions:**

- **A. Clear the set when a fresh attempt starts** (`startStage3Load` /
  `startStage1Load` paths).
  - Pros: matches the documented intent; each genuine retry surfaces its toast.
  - Cons: a true re-render storm on one stuck error could re-toast — but only after an
    explicit fresh load, which is the desired behaviour.
- **B. Key the dedupe by `requestKey`** (`${requestKey}-stage3-${msg}`).
  - Pros: automatically distinguishes attempts without manual clearing; robust against
    future callers.
  - Cons: Stage 1/2 have no `requestKey`; needs a parallel token or a different key
    scheme for those stages.
- **C. Delete just the relevant key on each fresh load** instead of clearing all.
  - Pros: preserves dedupe for unrelated stages.
  - Cons: more bookkeeping; marginal benefit over A.

> Recommendation: **A**, with **B** for Stage 3 specifically if you want it
> caller-proof.

---

### M2 — Query reset doesn't unsubscribe an in-flight Stage 3 stream (orig. #11)

**Where:** [CollectionView.tsx](../../src/webviews/documentdb/collectionView/CollectionView.tsx)
resets `queryInsights` to `DefaultCollectionViewContext.queryInsights` on a query change
(`intent === 'initial' | 'refresh'`). The Stage 3 subscription handle
(`stage3SubscriptionRef`) lives in the still-mounted
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx);
the reset never touches it.

**Verification — Confirmed.** The only unsubscribe paths are explicit Cancel, starting
another Stage 3 request, or unmounting the tab. Editing/running a new query while the
tab stays mounted leaves the old `streamStage3` running.

**Effect:** the old AI request keeps streaming invisibly; late events are dropped by the
`requestKey` guard (pipeline left `s3Loading`), but the user has **lost the Cancel
affordance** and the extension keeps spending model time on stale work.

**Solutions:**

- **A. Effect in `QueryInsightsTab` keyed on `pipeline.kind` / `stage3RequestKey`** that
  unsubscribes whenever the pipeline leaves `s3Loading` for a reason other than the
  terminal `complete` it handles itself.
  - Pros: co-locates cleanup with the ref that owns the subscription; covers reset,
    external transitions, and future callers.
  - Cons: must carefully exclude the normal `s3Loading → s3Success` path so it doesn't
    cancel a just-completed stream.
- **B. Lift the subscription handle into context** and unsubscribe in the
  CollectionView reset effect.
  - Pros: reset becomes the single authority for teardown.
  - Cons: leaks a webview-message concern into shared context; larger refactor.
- **C. Expose a cancel/teardown callback** from `QueryInsightsTab` that the reset
  invokes.
  - Pros: explicit, testable seam.
  - Cons: parent→child imperative wiring (ref handle / callback registration) is awkward
    in this codebase's context-driven style.

> Recommendation: **A** — pair it with M3 (same effect can clear the timer and local
> error-card state).

---

### M3 — `showErrorCard` / tips timer leak across a query reset (orig. #12)

**Where:** `showErrorCard` (local state) + `stage3TipsTimerRef` (local timer) in
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx).
Both are cleared on Cancel/unmount but **not** when
[CollectionView.tsx](../../src/webviews/documentdb/collectionView/CollectionView.tsx)
resets `queryInsights` for a new query.

**Verification — Confirmed.** `showErrorCard` is component-local and outside the reset
pipeline.

**Effect:** previous query sets `showErrorCard = true`; user runs a new query; once the
new Stage 2 data arrives, `showErrorCard && stage2Data?.concerns` can render the "Query
Execution Failed" card immediately — without the user having clicked Stage 3 for the new
query. A still-pending 1 s timer can also fire after the reset and re-set the stale
state.

**Solutions:**

- **A. Clear `stage3TipsTimerRef` + `setShowErrorCard(false)` whenever the active query
  resets** (same effect as M2-A, keyed on a reset signal / `pipeline.kind` returning to
  `idle`).
  - Pros: one cleanup site for both M2 and M3; deterministic.
  - Cons: needs a reliable "reset happened" signal in the child (e.g. observing
    `pipeline.kind === 'idle'` after having been past it).
- **B. Fold `showErrorCard` into the pipeline state** so the reducer reset clears it
  automatically.
  - Pros: removes the out-of-band local state entirely; reset is authoritative.
  - Cons: adds a presentation-only flag to the discriminated union (slight scope creep);
    more reducer surface.

> Recommendation: **A** now (bundled with M2); consider **B** if more local Stage 3 UI
> flags accumulate.

---

### M4 — Screen-reader "AI is analyzing" announcement is dead during streaming (orig. #9, upgraded)

**Where:** the `Announcer` (`l10n.t('AI is analyzing...')`, `politeness="assertive"`)
lives in
[GetPerformanceInsightsCard.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.tsx),
fired by `when={isLoading}`. The slim loading affordance
[Stage3AnalyzingCard.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/Stage3AnalyzingCard.tsx)
is a plain `Card` with an `aria-hidden` spinner and static text — **no** `role="status"`
/ `aria-live`.

**Verification — Confirmed, and stronger than the original review stated.** During
`s3Loading` the `GetPerformanceInsightsCard` is **not rendered** (the ternary shows
`Stage3AnalyzingCard` instead), and it is passed `isLoading={false}` regardless. So the
`when={isLoading}` announcer **never fires** during the streaming flow. Net effect: the
"AI is analyzing" announcement that shipped for issue #380 (0.7) is now effectively a
**regression** — non-sighted users get no signal that the request started or that Cancel
exists.

**Solutions:**

- **A. Make `Stage3AnalyzingCard` a polite live region** (`role="status"` +
  `aria-live="polite"` on the label) announcing "AI is analyzing…" on mount.
  - Pros: restores the announcement exactly where the loading UI now lives; minimal,
    self-contained.
  - Cons: must announce once (not on every render) — keep meta/rapid-updating text out
    of the live region (see L5).
- **B. Reuse `StreamingInlineProgress`** (already `role="status"` + `aria-live="polite"`)
  inside `Stage3AnalyzingCard`.
  - Pros: single source of truth for the "working" affordance; consistent semantics.
  - Cons: visual restyle to fit the slim card; slight coupling.
- **C. Move the existing `Announcer` to the loading branch** and drive it from
  `isStage3Loading`.
  - Pros: reuses the proven #380 component.
  - Cons: announcer placement vs. the actual rendered card must be kept in sync — the
    very drift that caused this regression.

> Recommendation: **A** or **B**. (Upgraded to Medium because it is an a11y *regression*
> of a previously shipped, tracked fix.)

---

### M5 — `CardStack` updates state during render → extra render churn (orig. C1)

**Where:** [CardStack.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/cardStack/CardStack.tsx)
— `if (items.length > 0 && items !== lastNonEmpty) setLastNonEmpty(items);` during
render. `insightCards` in
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
is rebuilt as a **new array** every parent render.

**Verification — Confirmed as render churn; Copilot's "infinite loop" claim is a FALSE
ALARM.** The guarded "store-derived-state" pattern converges: `setLastNonEmpty(items)`
re-renders `CardStack` with the *same* `items` reference, so `items !== lastNonEmpty` is
false on that immediate re-render and it stops. There is **no** "Too many re-renders"
loop. The real cost: because the parent hands a fresh `items` array on every render,
`CardStack` does **one extra render per parent render** — and the parent re-renders
frequently while streaming, which is the animation-sensitive moment.

**Solutions:**

- **A. `useMemo` `insightCards` in the parent** so the array identity is stable across
  renders that don't change the cards.
  - Pros: removes the churn at the source; benefits any consumer of `insightCards`.
  - Cons: must list correct deps (streaming snapshot, keys, `showErrorCard`, …); a
    missed dep causes stale cards.
- **B. Move the snapshot into an effect (or a ref updated in an effect)** in `CardStack`.
  - Pros: no setState during render at all; idiomatic.
  - Cons: one frame of lag for the "retain last items during fade-out" snapshot — needs
    a check that the group fade-out still has content on the exit commit.
- **C. Compare by content, not reference** (only `setLastNonEmpty` when keys actually
  change).
  - Pros: eliminates churn even if the parent keeps allocating new arrays.
  - Cons: per-render key diffing cost; still a setState-during-render shape.

> Recommendation: **A** (cheapest, fixes it at the source). Keep the existing guard.
> Downgrade mental model: this is render efficiency, not a crash.

---

### M6 — Unsafe `(error as Error).message` in the debug-file catch (orig. C2)

**Where:** [queryInsightsRouter.ts](../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts)
— `readQueryInsightsDebugFile` catch logs `${(error as Error).message}`.

**Verification — Confirmed.** Violates the repo guideline (no direct `.message`;
`error instanceof Error ? error.message : String(error)`). A non-`Error` throw (e.g. a
string) yields `undefined` in the log.

**Solutions:**

- **A. Apply the standard guard** `const msg = error instanceof Error ? error.message :
  String(error);`.
  - Pros: one-liner; matches repo policy; passes lint.
  - Cons: none.

> Recommendation: **A**. Trivial. (Note: it's in a dev-only debug helper, so user impact
> is nil — but it's a clean lint/guideline fix.)

---

### M7 — ASCII `...` vs Unicode `…` → duplicate l10n keys (orig. C3)

**Where:**
[GetPerformanceInsightsCard.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.tsx)
uses `l10n.t('AI is analyzing...')` (ASCII), while
[Stage3AnalyzingCard.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/Stage3AnalyzingCard.tsx)
uses `l10n.t('AI is analyzing…')` (Unicode).

**Verification — Confirmed.** `l10n/bundle.l10n.json` contains **both** keys (`"AI is
analyzing..."` and `"AI is analyzing…"`), proving the duplication is live. Translators
get two entries for one message; locales can render inconsistently.

**Solutions:**

- **A. Standardize on the Unicode `…`** everywhere and run `npm run l10n` to drop the
  stale ASCII key.
  - Pros: single key; consistent UI; matches the dominant Stage 3 style.
  - Cons: must touch the `Announcer` string too (and confirm no other ASCII usages).
- **B. Standardize on ASCII `...`.**
  - Pros: also collapses to one key.
  - Cons: regresses typography vs. the rest of the streaming UX (which uses `…`).

> Recommendation: **A**. (Also resolves the M4 announcer string at the same site.)

---

### M8 — Subscription opens even when the reducer no-ops the transition (orig. #4)

**Where:** `handleGetAISuggestions` in
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
dispatches `startStage3Load` then opens the subscription **unconditionally**.

**Verification — Confirmed as an invariant gap, but LATENT.** `startStage3Load` is a
no-op from any state other than `s3Idle`/`s3Error`/`s3Cancelled` (keeps the old
`requestKey`), yet the subscription opens with the new `requestKey`. Today the "Get AI"
trigger is only reachable from those valid states, so it can't actually fire from an
invalid one — but a future programmatic/keyboard/test caller would inherit a live LLM
stream whose every event is dropped by the staleness guard (silent stuck stream).

**Solutions:**

- **A. Open the subscription only if the dispatch produced `s3Loading` with this
  `requestKey`** (read back the next state, or have `startStage3Load` signal
  acceptance).
  - Pros: enforces "I only stream when I actually entered `s3Loading`"; future-proofs new
    callers.
  - Cons: needs the reducer to report acceptance, or a post-dispatch state read (slightly
    against the fire-and-forget dispatch style here).
- **B. Leave as-is and document the precondition** (caller must be in a valid state).
  - Pros: zero code change; honest about current safety.
  - Cons: relies on every future caller reading the comment; no enforcement.

> Recommendation: **A** if cheap; otherwise **B** is defensible given it's not currently
> reachable. Low urgency.

---

### M9 — No way to re-run Stage 3 after success (orig. #5)

**Where:** the affordance `CollapseRelaxed` `visible` set in
[QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
**excludes** `s3Success`; there is no "Regenerate" control.

**Verification — Confirmed.** After a successful run the request card collapses out and
never returns; the only way to get a fresh analysis is to re-run the whole query (which
resets Stage 1/2/3).

**This is a product decision, not necessarily a bug** — but it should be a conscious
choice, not a side effect of state-gating.

**Solutions:**

- **A. Add a "Regenerate" affordance in `s3Success`** that calls `startStage3Load`
  again (mints a new `requestKey`).
  - Pros: removes the dead-end; supports "the model was vague, try again"; consistent
    with chat-style AI UX.
  - Cons: extra cost/credits per regenerate; needs a confirm or subtle styling so it's
    not clicked accidentally; more UI surface.
- **B. Keep the current behaviour, intentionally** (re-run the query to refresh).
  - Pros: simplest; one clear path; no extra spend.
  - Cons: heavyweight to refresh AI alone; surprising dead-end after success.

> Recommendation: **confirm with the product owner.** If "responsive, iterative AI" is
> the theme, **A** aligns; if cost-control dominates, **B** is fine but should be stated.

---

## Low severity

### L1 — `status` events produced but consumed by nothing (orig. #6)

**Where:** [queryInsightsEventsRouter.ts](../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsEventsRouter.ts)
computes `connecting`/`receiving`/`parsing` with `elapsedMs` + `charsReceived`,
throttled to 250 ms; the reducer's `status` case is an explicit no-op and no component
reads it. (The reducer comment even points at the `GetPerformanceInsightsCard` stepper,
which is no longer rendered during loading.)

**Verification — Confirmed.** Dead data on the wire.

**Solutions:**

- **A. Surface them** — e.g. live "received N chars… · {elapsed}s" in the
  `Stage3AnalyzingCard`.
  - Pros: directly advances the PR goal (real, not fake, progress signal); data already
    flows.
  - Cons: rapid updates need a11y care (debounce; keep out of live region — see L5).
- **B. Stop emitting them** — remove the `status` production + throttling.
  - Pros: less channel traffic; deletes unused code.
  - Cons: throws away a cheap, *real* progress signal that fits the PR's theme.

> Recommendation: lean **A** (it's the cheapest "more responsive" win available), with a
> debounced, aria-safe presentation. **B** only if product doesn't want the meta text.

---

### L2 — Single-line markdown values get no progressive reveal (orig. #7)

**Where:** `maybeEmitProgressive` in
[streamingResponseParser.ts](../../src/documentdb/queryInsights/streamingResponseParser.ts)
emits only when the most recent decoded char is `\n`.

**Verification — Confirmed.** A value with no newline produces **zero** progressive
events; the card sits on the spinner until the closing `"`, then drops the full content
at once — defeating "progressive reveal" for short values.

**Solutions:**

- **A. Also emit on a char-count threshold** (e.g. every N decoded chars) as a fallback.
  - Pros: guarantees motion even for newline-free values; small change.
  - Cons: picking N (too small = churn, too big = no help); cumulative re-render cost.
- **B. Emit on a time interval** while the value grows.
  - Pros: smooth regardless of content shape.
  - Cons: adds a timer to a currently pure parser (breaks its "pure" design property).
- **C. Accept it** — most `analysis`/`educational` values are multi-line in practice.
  - Pros: zero change; keeps the parser pure.
  - Cons: occasional short value still feels like the old blank wait.

> Recommendation: **A** (keeps the parser pure; cheap insurance for the PR's core
> promise).

---

### L3 — Doc drift: `\n` vs `\n\n` emission granularity (orig. #8)

**Where:** JSDoc in
[queryInsightsStream.ts](../../src/webviews/documentdb/collectionView/types/queryInsightsStream.ts)
(`summary` and `educational` say *"Emitted at paragraph boundaries (`\n\n`)"*) and the
header of [streamingResponseParser.ts](../../src/documentdb/queryInsights/streamingResponseParser.ts).
The implementation emits per single `\n`.

**Verification — Confirmed.** Behaviour is fine (cumulative + `complete:false`); the
comments are stale and will mislead the next maintainer.

**Solutions:**

- **A. Update both JSDoc blocks to "per `\n`"** (and note the prior `\n\n` decision in
  the description's rationale).
  - Pros: docs match reality; one small edit.
  - Cons: none.

> Recommendation: **A**.

---

### L4 — Cancel is visible-but-inert during the success-collapse window (orig. #10)

**Where:** `Stage3AnalyzingCard` renders during **both** `s3Loading` and `s3Success`
(the collapsing element is the slim row by design). `handleCancelAI → cancelStage3` is a
no-op outside `s3Loading`.

**Verification — Confirmed.** During the `s3Success` collapse the Cancel button is
visible but clicking it does nothing (harmless, brief).

**Solutions:**

- **A. Hide/disable Cancel once `isStage3Success`** (pass a `canCancel`/`disabled` prop).
  - Pros: no visible control without effect; tiny change.
  - Cons: an extra prop threaded into the slim card.
- **B. Accept it** (sub-second window, harmless).
  - Pros: zero change.
  - Cons: a momentarily inert control is a small polish miss on a UX-focused PR.

> Recommendation: **A** (cheap polish that fits the PR's intent).

---

### L5 — `StreamingPlaceholder` is dead code (orig. C4)

**Where:** [StreamingPlaceholder.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/streamingPlaceholder/StreamingPlaceholder.tsx)
+ its SCSS + barrel export.

**Verification — Confirmed unused.** Grep shows the component is referenced only by its
own file; the live cards import the *sibling* `StreamingInlineProgress`, not
`StreamingPlaceholder`. The Copilot a11y concern (a `role="status"` live region with
rapidly-updating `{elapsed}s · {chars} chars`) is **only** a problem if the component is
revived.

**Solutions:**

- **A. Delete `StreamingPlaceholder.tsx`, its SCSS, and the barrel re-export.**
  - Pros: removes dead code and a latent a11y bug; smaller surface.
  - Cons: loses a "future-ready" component (recoverable from git if needed).
- **B. Keep it but fix the a11y now** — wrap only the human label in the live region;
  `aria-hidden="true"` on the elapsed/chars span.
  - Pros: preserves the component for later.
  - Cons: maintaining unused code; the a11y fix is speculative.

> Recommendation: **A** (delete). If L1-A (surface status) is pursued, build that on
> `StreamingInlineProgress`, not this.

---

### L6 — Debug-override activation comment doesn't match the guard (orig. C5)

**Where:** [queryInsightsRouter.ts](../../src/webviews/documentdb/collectionView/queryInsights/queryInsightsRouter.ts)
— the `readQueryInsightsDebugFile` doc comment says *"To activate: Remove the
'_comment' field…"* but the code activates only when `parsed._debug_active` is truthy.

**Verification — Confirmed.** Misleads anyone trying to use the debug files.

**Solutions:**

- **A. Correct the comment to describe the `_debug_active` flag.**
  - Pros: accurate dev docs; one-line edit.
  - Cons: none.

> Recommendation: **A**.

---

## Recommended sequencing (for discussion — no code yet)

1. **Fix the two High issues together (H1 + H2)** via reconciliation on `complete`
   (H1-A). This is the core of the PR's promise and the only class of bug that can leave
   a *success*-state spinner hung — the worst outcome for a "responsive UX" PR.
2. **Lifecycle cleanup bundle (M2 + M3)** in one `QueryInsightsTab` effect keyed on the
   reset/`pipeline.kind`, plus **M1** (clear the error-ref on fresh load).
3. **Accessibility (M4)** — restore the streaming announcement on the card that's
   actually rendered; resolve the **M7** ellipsis at the same site.
4. **Cheap correctness/lint (M6)** and **render churn (M5-A)**.
5. **Product call on M9** (regenerate after success) and **M8** (latent — harden if
   cheap, else document).
6. **Low-severity polish/cleanup (L1–L6)** as a follow-up pass; L1 (surface real
   `status` progress) is the highest-value Low because it directly reinforces the PR's
   responsiveness theme.

Nothing above has been changed in code — this is review + recommendations only.
