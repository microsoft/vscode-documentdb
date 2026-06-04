/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryInsightsStage3Streaming, type QueryInsightsState } from './collectionViewContext';
import { type QueryInsightsStage1Response, type QueryInsightsStage2Response } from './types/queryInsights';
import { type QueryInsightsStreamEvent } from './types/queryInsightsStream';

// ============================================================================
// Query Insights reducer
// ============================================================================
//
// Pure transition helpers for the {@link QueryInsightsState} discriminated
// union defined in `./collectionViewContext.ts`. Each helper:
//   - takes the current state and any event payload,
//   - returns the next state (no side effects, no mutation),
//   - is typed so the source variant is provable by the caller, when feasible
//     (the loose ones take the full union and silently no-op on illegal
//     calls — see the per-helper notes).
//
// They slot straight into the existing
//   `setQueryInsightsStateHelper((prev) => helper(prev, …))`
// updater pattern in `QueryInsightsTab.tsx` and `CollectionView.tsx`. They
// replace the old imperative `transitionToStage(phase, status)` reducer.
//
// ----------------------------------------------------------------------------
// Transition map (single source of truth for what's legal)
// ----------------------------------------------------------------------------
//
//   startStage1Load   :  *                              → s1Loading      (also: full reset of any prior stages — fresh query)
//   stage1Succeeded   :  s1Loading                      → s2Loading      (auto-chains; stage1 data is carried forward)
//   stage1Failed      :  s1Loading                      → s1Error
//
//   stage2Succeeded   :  s2Loading                      → s3Idle         (now showing the "Get AI" button)
//   stage2Failed      :  s2Loading                      → s2Error
//
//   startStage3Load   :  s3Idle | s3Error | s3Cancelled → s3Loading      (mint new requestKey, drop prior streaming)
//   applyStage3Event  :  s3Loading [matching requestKey] → s3Loading | s3Success
//   failStage3        :  s3Loading [matching requestKey] → s3Error
//   cancelStage3      :  s3Loading                      → s3Cancelled
//
// Calls into the reducer from an invalid source variant return the input
// state unchanged (a logged no-op when DEBUG_QUERY_INSIGHTS is on). This
// mirrors the "NULL action means invalid transition, silently ignored"
// pattern from the AvianGPS FSM (FSM.h): we trust the caller's structure
// rather than throwing, since these are pure data transformations and a
// thrown error inside a setState updater is much worse than a logged no-op.
//
// ----------------------------------------------------------------------------
// Adding a new transition
// ----------------------------------------------------------------------------
//   1. Update the transition map comment above so the spec stays in one
//      place (mirrors the role of the AvianGPS FSM transitions table).
//   2. Add a helper here. Wrap its return in `trace('helperName', prev, next)`
//      so the debug log captures it like every other transition.
//   3. The TYPE checker will then guide you to every consumer that needs
//      updating (because the union changed) — that's the whole point of
//      the discriminated-union shape.
//
// ----------------------------------------------------------------------------
// Debug tracing
// ----------------------------------------------------------------------------
// Flip {@link DEBUG_QUERY_INSIGHTS} to `true` locally to log every transition
// to the WEBVIEW DevTools console (Command Palette → "Developer: Open
// Webview Developer Tools"). The host (extension) side has no notion of
// this state machine — only the webview applies events to state — so this
// is the only place worth tracing. Mirrors the spirit of `DEBUG_FSM_ENABLED`
// in the AvianGPS FSM: one toggle, one place, every transition logged.

const DEBUG_QUERY_INSIGHTS = false;

/**
 * Wraps a transition: when {@link DEBUG_QUERY_INSIGHTS} is enabled, logs
 * `(label, prev → next)` with a compact discriminant summary plus the full
 * snapshots on a follow-up line for drill-down. Always returns `next`.
 *
 * Skips logging when the transition is a reference-equal no-op (e.g.
 * `applyStage3Event` called with a stale `requestKey`). This keeps the log
 * focused on actual state changes.
 */
function trace(label: string, prev: QueryInsightsState, next: QueryInsightsState): QueryInsightsState {
    if (DEBUG_QUERY_INSIGHTS && prev !== next) {
        // eslint-disable-next-line no-console -- intentional dev-only tracing
        console.debug(`[QueryInsights] ${label}: ${prev.kind} → ${next.kind}`, { prev, next });
    }
    return next;
}

const EMPTY_STREAMING: QueryInsightsStage3Streaming = {
    summary: null,
    educational: null,
    recommendations: [],
};

// ============================================================================
// Stage 1
// ============================================================================

/**
 * Begin a Stage 1 load. Legal from ANY variant — this is the "fresh query"
 * entry point, so it discards anything from the previous query (Stage 2
 * data, Stage 3 streaming, errors, cancels).
 *
 * Used by:
 *   - The prefetch in `CollectionView.tsx` (fires right after a query is
 *     executed, before the user even switches to the Query Insights tab).
 *   - The fallback fetch in `QueryInsightsTab.tsx` (fires when the user is
 *     already on the tab and the prefetch hasn't started yet).
 * The two are deduped by checking `s.kind === 's1Loading'` on entry — if
 * one has already started the load, the other observes `s1Loading` and
 * bails. Setting `s1Loading` is therefore the in-flight signal that the
 * old `stage1InFlight` boolean used to carry.
 */
export function startStage1Load(prev: QueryInsightsState): QueryInsightsState {
    return trace('startStage1Load', prev, { kind: 's1Loading' });
}

/**
 * Stage 1 succeeded → auto-chain into `s2Loading` so the Stage 2 fetch
 * effect picks it up on the next render. Stage 1's result data is
 * carried forward onto the `s2Loading` variant by type.
 *
 * No-op if called from a state other than `s1Loading` (late callback from
 * a superseded request after a fresh `startStage1Load` reset the pipeline).
 */
export function stage1Succeeded(prev: QueryInsightsState, data: QueryInsightsStage1Response): QueryInsightsState {
    if (prev.kind !== 's1Loading') {
        return trace('stage1Succeeded[ignored]', prev, prev);
    }
    return trace('stage1Succeeded', prev, { kind: 's2Loading', stage1: data });
}

/**
 * Stage 1 failed. No-op if called from a state other than `s1Loading`.
 */
export function stage1Failed(prev: QueryInsightsState, message: string, code: string | null): QueryInsightsState {
    if (prev.kind !== 's1Loading') {
        return trace('stage1Failed[ignored]', prev, prev);
    }
    return trace('stage1Failed', prev, { kind: 's1Error', message, code });
}

// ============================================================================
// Stage 2
// ============================================================================

/**
 * Stage 2 succeeded → settle into `s3Idle`. The "Get AI Performance
 * Insights" button is now active and the system is doing nothing in the
 * background. Stage 1's and Stage 2's results are carried forward.
 *
 * No-op if called from a state other than `s2Loading`.
 */
export function stage2Succeeded(prev: QueryInsightsState, data: QueryInsightsStage2Response): QueryInsightsState {
    if (prev.kind !== 's2Loading') {
        return trace('stage2Succeeded[ignored]', prev, prev);
    }
    return trace('stage2Succeeded', prev, { kind: 's3Idle', stage1: prev.stage1, stage2: data });
}

/**
 * Stage 2 failed. No-op if called from a state other than `s2Loading`.
 */
export function stage2Failed(prev: QueryInsightsState, message: string, code: string | null): QueryInsightsState {
    if (prev.kind !== 's2Loading') {
        return trace('stage2Failed[ignored]', prev, prev);
    }
    return trace('stage2Failed', prev, { kind: 's2Error', stage1: prev.stage1, message, code });
}

// ============================================================================
// Stage 3
// ============================================================================

/**
 * Begin a new Stage 3 (AI) request. Legal from `s3Idle`, `s3Error`, or
 * `s3Cancelled` — i.e. once Stage 2 has produced data and the user has
 * either never requested AI yet, or wants to retry. No-op from anywhere
 * else (silently dropped — the UI couldn't have surfaced the button in
 * those states anyway).
 *
 * Mints the `requestKey` staleness token here; the caller passes it back
 * into `applyStage3Event` / `failStage3` so late callbacks from a
 * superseded subscription can be discarded. Replaces any prior streaming
 * snapshot with an empty buffer so the progressive render starts clean.
 */
export function startStage3Load(prev: QueryInsightsState, requestKey: string): QueryInsightsState {
    if (prev.kind !== 's3Idle' && prev.kind !== 's3Error' && prev.kind !== 's3Cancelled') {
        return trace('startStage3Load[ignored]', prev, prev);
    }
    return trace('startStage3Load', prev, {
        kind: 's3Loading',
        stage1: prev.stage1,
        stage2: prev.stage2,
        requestKey,
        streaming: { ...EMPTY_STREAMING },
    });
}

/**
 * Apply a streaming event from the `streamStage3` subscription.
 *
 * The `requestKey` staleness guard keeps the tRPC unsubscribe race quiet:
 * when the user cancels and immediately re-requests, the host may flush
 * one or two trailing callbacks from the *old* subscription. Those carry
 * the previous `requestKey` and arrive while the pipeline is either no
 * longer in `s3Loading` or already loading a newer request, so the guard
 * silently discards them. DO NOT REMOVE the guard "because the framework
 * promises cleanup" — it does not.
 *
 * On the terminal `complete` event this transitions `s3Loading → s3Success`
 * in a single step, folding the final streaming buffer and the model
 * metadata onto the `s3Success` variant. `requestKey` is carried across on
 * purpose — see the comment on the `s3Success` variant in
 * `collectionViewContext.ts` for why that matters.
 */
export function applyStage3Event(
    prev: QueryInsightsState,
    requestKey: string,
    event: QueryInsightsStreamEvent,
): QueryInsightsState {
    if (prev.kind !== 's3Loading' || prev.requestKey !== requestKey) {
        // Request was cancelled or superseded by a newer request.
        return trace('applyStage3Event[stale]', prev, prev);
    }

    const streaming = prev.streaming;

    switch (event.type) {
        case 'status':
            // Coarse progress only; nothing to store. The client-side stepper
            // in GetPerformanceInsightsCard covers perceived progress.
            return trace('applyStage3Event[status]', prev, prev);

        case 'summary':
            return trace('applyStage3Event[summary]', prev, {
                ...prev,
                streaming: {
                    ...streaming,
                    summary: { markdown: event.markdown, complete: event.complete },
                },
            });

        case 'educational':
            return trace('applyStage3Event[educational]', prev, {
                ...prev,
                streaming: {
                    ...streaming,
                    educational: { markdown: event.markdown, complete: event.complete },
                },
            });

        case 'recommendationStarted': {
            const recommendations = streaming.recommendations.slice();
            while (recommendations.length <= event.index) {
                recommendations.push(null);
            }
            return trace('applyStage3Event[recStarted]', prev, {
                ...prev,
                streaming: { ...streaming, recommendations },
            });
        }

        case 'recommendation': {
            const recommendations = streaming.recommendations.slice();
            while (recommendations.length <= event.index) {
                recommendations.push(null);
            }
            recommendations[event.index] = event.recommendation;
            return trace('applyStage3Event[rec]', prev, {
                ...prev,
                streaming: { ...streaming, recommendations },
            });
        }

        case 'complete':
            // Drive the success transition in the SAME commit that captures
            // the final streaming buffer + model metadata. Both facts live
            // on the one `s3Success` variant, so they cannot be split across
            // two setState calls (the documented `wasAccepted` batched-
            // updater footgun that previously left the lifecycle stuck at
            // `loading`).
            return trace('applyStage3Event[complete]', prev, {
                kind: 's3Success',
                stage1: prev.stage1,
                stage2: prev.stage2,
                requestKey: prev.requestKey,
                streaming,
                model: {
                    modelDisplayName: event.modelDisplayName,
                    modelId: event.modelId,
                    modelFamily: event.modelFamily,
                    usage: event.usage,
                },
            });

        default:
            // Exhaustiveness: the switch must cover every event kind.
            // Cast-to-never trick gives a compile error if a new event type
            // is added to QueryInsightsStreamEvent without a case here.
            return assertNever(event, prev);
    }
}

/**
 * Helper to enforce exhaustive `switch` over discriminated unions. If a
 * new event variant is added to `QueryInsightsStreamEvent` without a
 * matching `case` in the caller, the type of `value` will not be `never`
 * and the assignment below will fail at compile time.
 */
function assertNever<T>(value: never, fallback: T): T {
    void value;
    return fallback;
}

/**
 * Apply a Stage 3 stream error. Same `requestKey` staleness guard as
 * {@link applyStage3Event}: a late `onError` from a superseded
 * subscription is silently discarded.
 */
export function failStage3(
    prev: QueryInsightsState,
    requestKey: string,
    message: string,
    code: string | null,
): QueryInsightsState {
    if (prev.kind !== 's3Loading' || prev.requestKey !== requestKey) {
        return trace('failStage3[stale]', prev, prev);
    }
    return trace('failStage3', prev, {
        kind: 's3Error',
        stage1: prev.stage1,
        stage2: prev.stage2,
        message,
        code,
    });
}

/**
 * Cancel an in-flight Stage 3 request (or the post-success collapse window
 * if called from the unmount cleanup right after `complete` landed but
 * before React processed the success render — see the unmount note in
 * `QueryInsightsTab.tsx`). Drops any partial streaming output and any
 * prior success / model metadata.
 *
 * No-op when called from a state where there's nothing to cancel —
 * specifically, only `s3Loading` is in-flight. The unmount path also
 * passes through here so callers don't have to special-case states where
 * cancel is meaningless.
 */
export function cancelStage3(prev: QueryInsightsState): QueryInsightsState {
    if (prev.kind !== 's3Loading') {
        return trace('cancelStage3[ignored]', prev, prev);
    }
    return trace('cancelStage3', prev, {
        kind: 's3Cancelled',
        stage1: prev.stage1,
        stage2: prev.stage2,
    });
}
