# Continue tomorrow — Stage 3 cancel-UX card

**Branch:** `dev/tnaum/stream-query-insights` · **PR:** #711
**Last touched:** 2026-06-01

## Where we are

The Stage 3 "Get AI Performance Insights" affordance is rendered as **one**
`CollapseRelaxed` whose content swaps **in place** between:

- the full **request card** (`GetPerformanceInsightsCard`), and
- the slim **analyzing row** (`Stage3AnalyzingCard` — Spinner + "AI is analyzing…" + Cancel).

File: `src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx`
(search for `Stage 3 affordance — ONE CollapseRelaxed`).

Key gating logic:

```tsx
<CollapseRelaxed
    visible={currentStage.phase >= 2 && currentStage.status !== 'success'}
    unmountOnExit
>
    {isStage3Loading || currentStage.status === 'success' ? (
        <Stage3AnalyzingCard onCancel={handleCancelAI} />
    ) : (
        <GetPerformanceInsightsCard … />
    )}
</CollapseRelaxed>
```

- **Visibility** keys off `status !== 'success'` (NOT `!stage3Data`). The status enum
  flips in the SAME reducer commit as the success transition, so the card hides reliably.
- **Content** stays on the analyzing row while `isStage3Loading || status === 'success'`
  so the request card never flashes back during the success collapse.
- `Stage3AnalyzingCard` lives at
  `…/components/optimizationCards/custom/Stage3AnalyzingCard.tsx` (exported from `custom/index.ts`).

## Bug history (so we don't go in circles)

1. **Card not disposed on complete** — fixed by setting `currentStage` in the SAME
   reducer commit as `stage3Data` (the old `wasAccepted` closure flag was read after a
   batched updater and was unreliable). Done.
2. **Ghost analyzing card** — a motion wrapper that started unmounted skipped Fluent's
   enter transition (`appear` defaults false) and never collapsed. Avoided by the
   single-wrapper approach.
3. **Stuck analyzing card after completion** — the combined wrapper gated on `!stage3Data`
   plus content-swap-at-exit-edge stopped it unmounting. Fixed by gating on
   `status !== 'success'`.
4. **Two-card regression (entry overlap + vanish-with-layout-shift)** — caused by using
   two separate elements (request card collapse + plain conditional analyzing row).
   Reverted to the single wrapper above.

## Known/accepted limitation

- The request-card ↔ analyzing-row swap is an **instant height change** (a "jump"), because
  Fluent ships **no resize-in-place motion**. Verified against `@fluentui/react-components@9.73.3`
  and `@fluentui/react-motion-components-preview@0.15.4` — all presence components animate only
  on the `visible` boolean (enter/exit), none animate between two non-zero heights.
- If we want to smooth that jump later: build a small custom wrapper on
  `createMotionComponent` + `AtomMotionFn` (read `element.scrollHeight`) +
  `motionTokens.curveEasyEase` at `durationNormal` (200ms), with `overflow:hidden` and
  reset-to-`auto` on finish. Scoped out for now as polish.

## TODO tomorrow

1. **Verify the UX in the running webview** — confirm:
   - On "Get AI": content swaps in place, no second card animating in over the first.
   - On completion: the analyzing row collapses away smoothly (no vanish/layout shift) and the
     result cards grow in below.
   - On Cancel: request card animates back in; can re-request immediately.
2. **Run the full PR checklist** before pushing further / marking ready:
   - `npm run l10n` (only if user-facing strings changed)
   - `npm run prettier-fix`
   - `npm run lint`
   - `npx jest --no-coverage`
   - `npm run build`
3. If the jump bothers in testing, decide whether to build the custom resize wrapper (above).
4. Flip PR #711 out of WIP / draft when satisfied.

## Relevant reducer locations (QueryInsightsTab.tsx)

- `handleGetAISuggestions` (~L554) → `transitionToStage(3, 'loading')`
- `complete` case (~L693) → sets `stage3Data` + `currentStage: {3,'success'}` in one commit
- `onError` (~L770) → `currentStage: {3,'error'}` in one commit
- `handleCancelAI` (~L800) → single race-free reset to `{3,'cancelled'}` + null Stage-3 fields
- `isStage3Loading` (~L931) = `phase === 3 && status === 'loading'`
