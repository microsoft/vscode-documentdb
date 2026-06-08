/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from 'react';
import { type AIIndexRecommendation } from '../../../services/ai/types';
import { type QueryInsightsStage1Response, type QueryInsightsStage2Response } from './types/queryInsights';
import { type QueryInsightsStreamUsage } from './types/queryInsightsStream';

export enum Views {
    TABLE = 'Table View',
    TREE = 'Tree View',
    JSON = 'JSON View',
}

// ============================================================================
// Query Insights pipeline state
// ============================================================================
//
// The query-insights feature runs a three-stage progressive pipeline against
// the result of a user query:
//
//   Stage 1 — queryPlanner explain (cheap, no execution). Auto-runs after a
//             query; may be background-prefetched by CollectionView.
//   Stage 2 — executionStats explain (runs the query). Auto-runs after Stage 1
//             success. Produces metrics + performance rating.
//   Stage 3 — AI-powered recommendations via a tRPC subscription (streaming).
//             OPT-IN: only fires when the user clicks "Get AI Performance
//             Insights". Cancellable. Can be re-run after success/error/cancel.
//
// This pipeline is modelled as ONE discriminated union (`QueryInsightsState`)
// rather than three independent per-stage fields. The discriminant is `kind`.
//
// ----------------------------------------------------------------------------
// Why ONE union, not three fields per stage
// ----------------------------------------------------------------------------
//
// Earlier versions of this file used a flat record with a shared
// `currentStage: { phase, status }` tuple plus parallel `stageNData` /
// `stageNError*` / `stageNInFlight` fields. That shape produced two recurring
// bug classes:
//
//   1. `status === 'success'` meant THREE different things depending on
//      `phase` (Stage 1 cached / Stage 2 idle-waiting-for-AI-click / Stage 3
//      AI stream done). A bare `status === 'success'` check at a render site
//      would silently match the wrong stage. That's exactly how the
//      "AI is analyzing…" affordance briefly flashed the instant Stage 2
//      finished (fixed in commit f9af8979 by scoping every check to
//      `phase === 3`).
//   2. The sequencing invariant (Stage 3 cannot start before Stage 2
//      succeeded) lived only inside the reducer functions as convention.
//      Nothing in the type system prevented `{currentStage: {3,'loading'},
//      stage1Data: null, stage2Data: null}` from being constructed.
//
// With a single discriminated union, both classes are STRUCTURALLY
// impossible:
//
//   - Each variant has its own `kind` value. A check on `kind === 's3Idle'`
//     cannot accidentally match a Stage 2 variant.
//   - Later-stage variants carry the earlier stages' result data on them
//     directly. You cannot construct `{ kind: 's3Loading' }` without
//     `stage1: S1` and `stage2: S2` — the compiler refuses. Sequencing is
//     enforced at every call site, not just inside one reducer.
//
// The downside is that earlier-stage data is duplicated across later-stage
// variants in the TYPE definition. We mitigate this with the `WithStage1`
// and `WithStage12` intersection helpers below so each variant stays one
// short line. At runtime each pipeline state is one object — the data is
// carried forward by reference on each transition, not copied.
//
// ----------------------------------------------------------------------------
// How to work with `QueryInsightsState`
// ----------------------------------------------------------------------------
//
// READING from a render site or effect:
//
//   const s = currentContext.queryInsights;
//   if (s.kind === 's3Loading' || s.kind === 's3Success') { … }   // narrows
//   if (s.kind === 's2Loading' || s.kind === 's2Error') {
//     // here `s.stage1` is guaranteed present (carried by the variant).
//     console.log(s.stage1.queryPlan);
//   }
//
// Use the small derived helpers near the bottom of this file
// (`hasStage1Data`, `hasStage2Data`, `isStage3Active`) when a render site
// just wants "do we have stage N data?" without listing every variant.
//
// WRITING (transitions) — do NOT mutate, do NOT spread into the wrong
// variant. Instead, call one of the pure helpers in
// `./queryInsightsReducer.ts`:
//
//   setQueryInsightsStateHelper((prev) => stage1Succeeded(prev, data));
//   setQueryInsightsStateHelper((prev) => startStage3Load(prev, requestKey));
//
// The reducer functions encode the transition rules (which previous
// variants are valid sources for which target) and the data-carry-forward
// (Stage 1's data flows into the `s2Loading` variant, both flow into
// `s3Loading`, etc.). They also log transitions when DEBUG_QUERY_INSIGHTS
// is enabled in the reducer module — flip that constant locally to trace
// every transition in the webview DevTools console.
//
// EXTENDING — when you need to add a new state or carry a new piece of
// data, change the union here first. TypeScript will then point you at
// every consumer that needs updating, which is the whole point of this
// shape.
//
// DO NOT reintroduce flat parallel fields like `stage1Data` / `stage3Loading`
// at the top of the union. Earlier-stage data already lives on the
// later-stage variants; an additional flat field would just reintroduce
// the drift bug class this refactor was designed to eliminate.

/** Error payload shared by every `*Error` variant. `code` drives UI pattern matching (e.g. `'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU'`). */
type ErrorInfo = { message: string; code: string | null };

/** Carries Stage 1's result onto later variants. */
type WithStage1 = { stage1: QueryInsightsStage1Response };

/** Carries Stage 1's and Stage 2's results onto Stage-3 variants. */
type WithStage12 = WithStage1 & { stage2: QueryInsightsStage2Response };

/**
 * Coarse, monotonic phase of an in-flight Stage 3 stream, used purely to
 * label the slim "analyzing" affordance ({@link Stage3AnalyzingCard}) as the
 * request progresses. It only ever advances
 * (`connecting → submitted → receiving`), never regresses.
 *
 *   - `connecting` — the host is building the request context (query params,
 *                    static-analysis summary, cluster metadata) before the
 *                    LLM call is dispatched. Usually brief.
 *   - `submitted`  — the request has been sent to the model and we are
 *                    awaiting its first token (time-to-first-token, typically
 *                    the longest wait — the model is "thinking" and producing
 *                    no output yet). The card shows a live elapsed-time
 *                    counter during this phase so the wait never looks frozen.
 *   - `receiving`  — the model has started producing output. Set on the first
 *                    character received (a `receiving` status with
 *                    `charsReceived > 0`, or the first structured content
 *                    event — whichever lands first).
 */
export type QueryInsightsStage3Phase = 'connecting' | 'submitted' | 'receiving';

/**
 * Per-stream progressive state for Stage 3. Carries only the structured
 * slots populated by the `streamStage3` subscription's events. The
 * "has terminal-complete landed?" fact is NOT stored here — it is the
 * `kind === 's3Success'` discriminant on the pipeline state. Model
 * metadata likewise lives on the `s3Success` variant, not here.
 */
export interface QueryInsightsStage3Streaming {
    /**
     * Monotonic progress phase driving the in-flight label only (review item
     * L1). Advanced by `applyStage3Event`; see {@link QueryInsightsStage3Phase}.
     */
    phase: QueryInsightsStage3Phase;
    /** Cumulative markdown from `summary` events (the AI `analysis` JSON key). */
    summary: { markdown: string; complete: boolean } | null;
    /** Cumulative markdown from `educational` events (the AI `educationalContent` key). */
    educational: { markdown: string; complete: boolean } | null;
    /**
     * Sparse-by-index list of streamed improvements. `null` means the
     * `recommendationStarted` event has arrived (render a shell); a value
     * means the matching `recommendation` event has arrived (render the
     * filled card). Indexed by `event.index` (0-based, monotonic per stream).
     */
    recommendations: Array<AIIndexRecommendation | null>;
}

/** Model metadata populated by the terminal `complete` event of a Stage 3 stream. */
export interface QueryInsightsStage3Model {
    modelDisplayName?: string;
    modelId?: string;
    modelFamily?: string;
    usage?: QueryInsightsStreamUsage;
    /**
     * Total wall-clock duration of the Stage 3 stream, in milliseconds.
     * Surfaced (in seconds) in the post-response "Powered by …" byline.
     */
    durationMs?: number;
}

/**
 * The single discriminated union describing the entire query-insights
 * pipeline at any point in time. See the long-form notes above for the
 * design rationale and the usage rules.
 *
 * Discriminants:
 *   - `idle`         — no query has been run yet (pre-fetch resting state).
 *   - `s1Loading`    — Stage 1 fetch in flight (dedupe signal for prefetch
 *                       vs. tab-fallback fetch).
 *   - `s1Error`      — Stage 1 fetch failed.
 *   - `s2Loading`    — Stage 2 fetch in flight. Carries Stage 1's result.
 *   - `s2Error`      — Stage 2 fetch failed.
 *   - `s3Idle`       — Stage 2 succeeded; user is looking at the
 *                       "Get AI Performance Insights" button. The system is
 *                       *not* doing anything in the background.
 *   - `s3Loading`    — Stage 3 AI subscription open. `requestKey` is the
 *                       staleness token that gates late callbacks from a
 *                       superseded subscription (see the unsubscribe-race
 *                       note in QueryInsightsTab.tsx).
 *   - `s3Success`    — Stage 3 stream completed (`complete` event landed).
 *                       Carries the final `streaming` slots plus `model`
 *                       metadata.
 *   - `s3Error`      — Stream failed.
 *   - `s3Cancelled`  — User cancelled, or the tab unmounted mid-stream.
 *
 * `requestKey` is INTENTIONALLY carried across the `s3Loading → s3Success`
 * transition. The render path derives a `keyPrefix` from `requestKey` and
 * uses it on every Stage 3 card key. If it changed (or went `null`) on the
 * same commit that flips to `s3Success`, every card key would change in a
 * single React render and AnimatedCardList would play a full exit+enter
 * cascade — visible as a flash when the "Get AI" card collapses (PR #711).
 */
export type QueryInsightsState =
    | { kind: 'idle' }
    | { kind: 's1Loading' }
    | ({ kind: 's1Error' } & ErrorInfo)
    | ({ kind: 's2Loading' } & WithStage1)
    | ({ kind: 's2Error' } & WithStage1 & ErrorInfo)
    | ({ kind: 's3Idle' } & WithStage12)
    | ({ kind: 's3Loading' } & WithStage12 & { requestKey: string; streaming: QueryInsightsStage3Streaming })
    | ({ kind: 's3Success' } & WithStage12 & {
              requestKey: string;
              streaming: QueryInsightsStage3Streaming;
              model: QueryInsightsStage3Model;
          })
    | ({ kind: 's3Error' } & WithStage12 & ErrorInfo)
    | ({ kind: 's3Cancelled' } & WithStage12);

// --- Derived helpers ---------------------------------------------------------
//
// Small, reference-equality-safe predicates the render code can use when it
// only cares about "do we have stage N data?" without listing every variant.
// They are derived from the discriminant only, so they remain correct
// regardless of how the union evolves later.

/** Variant kinds that DO NOT carry Stage 1 data. */
export type QueryInsightsKindWithoutStage1 = 'idle' | 's1Loading' | 's1Error';

/** Variant kinds that DO carry Stage 1 data (`stage1` field present). */
export type QueryInsightsKindWithStage1 = Exclude<QueryInsightsState['kind'], QueryInsightsKindWithoutStage1>;

/** Variant kinds that DO carry Stage 2 data (`stage1` AND `stage2` fields present). */
export type QueryInsightsKindWithStage12 = Extract<
    QueryInsightsState['kind'],
    's3Idle' | 's3Loading' | 's3Success' | 's3Error' | 's3Cancelled'
>;

export function hasStage1Data(
    s: QueryInsightsState,
): s is Extract<QueryInsightsState, { stage1: QueryInsightsStage1Response }> {
    return s.kind !== 'idle' && s.kind !== 's1Loading' && s.kind !== 's1Error';
}

export function hasStage2Data(
    s: QueryInsightsState,
): s is Extract<QueryInsightsState, { stage2: QueryInsightsStage2Response }> {
    return (
        s.kind === 's3Idle' ||
        s.kind === 's3Loading' ||
        s.kind === 's3Success' ||
        s.kind === 's3Error' ||
        s.kind === 's3Cancelled'
    );
}

/** True while a Stage 3 AI request is open (i.e. the LLM call is in flight). */
export function isStage3Loading(s: QueryInsightsState): s is Extract<QueryInsightsState, { kind: 's3Loading' }> {
    return s.kind === 's3Loading';
}

// ============================================================================
// Other context state (unchanged by the pipeline refactor)
// ============================================================================

export type TableViewState = {
    currentPath: string[];
};

export type CollectionViewContextType = {
    isLoading: boolean; // this is a concious decision to use 'isLoading' instead of <Suspense> tags. It's not only the data display component that is supposed to react to the lading state but also some input fields, buttons, etc.
    isFirstTimeLoad: boolean; // this will be set to true during the first data fetch, here we need more time and add more loading animations, but only on the first load
    currentView: Views;
    currentViewState?: TableViewState; // | TreeViewConfiguration |  other views can get config over time
    activeQuery: {
        // The last executed query (used for export, pagination, display)
        queryText: string; // deprecated: use filter instead
        filter: string; // MongoDB API find filter (same as queryText for backward compatibility)
        project: string; // MongoDB API projection
        sort: string; // MongoDB API sort specification
        skip: number; // Number of documents to skip
        limit: number; // Maximum number of documents to return
        pageNumber: number;
        pageSize: number;
        executionIntent?: 'initial' | 'refresh' | 'pagination'; // Intent of the query execution
    };
    commands: {
        disableAddDocument: boolean;
        disableViewDocument: boolean;
        disableEditDocument: boolean;
        disableDeleteDocument: boolean;
    };
    dataSelection: {
        // real document _id values, for easier lookup
        selectedDocumentObjectIds: string[];
        // actual index in the current snapshot of the data, for easier lookup
        selectedDocumentIndexes: number[];
    };
    queryEditor?: {
        getCurrentQuery: () => {
            filter: string;
            project: string;
            sort: string;
            skip: number;
            limit: number;
        };
    };
    /**
     * When set, the QueryEditor should apply these values to its editors
     * and then clear this field. Used by the "Paste Query" feature.
     */
    pendingPaste?: {
        filter?: string;
        project?: string;
        sort?: string;
        skip?: number;
        limit?: number;
    };
    isAiRowVisible: boolean; // Controls visibility of the AI prompt row in QueryEditor
    /** See {@link QueryInsightsState} for the pipeline shape and usage rules. */
    queryInsights: QueryInsightsState;
};

export const DefaultCollectionViewContext: CollectionViewContextType = {
    isLoading: false,
    isFirstTimeLoad: true,
    currentView: Views.TABLE,
    activeQuery: {
        queryText: '{  }', // deprecated: use filter instead
        filter: '{  }',
        project: '{  }',
        sort: '{  }',
        skip: 0,
        limit: 0,
        pageNumber: 1,
        pageSize: 10,
    },
    commands: {
        disableAddDocument: false,
        disableViewDocument: true,
        disableEditDocument: true,
        disableDeleteDocument: true,
    },
    dataSelection: {
        selectedDocumentObjectIds: [],
        selectedDocumentIndexes: [],
    },
    isAiRowVisible: false,
    // `idle` is the pre-first-query resting state. The prefetch in
    // CollectionView flips it to `s1Loading` as soon as the user runs a
    // query; flipping `s1Loading` again from elsewhere is the dedupe
    // signal the QueryInsightsTab fallback fetch uses to short-circuit.
    queryInsights: { kind: 'idle' },
};

export const CollectionViewContext = createContext<
    [CollectionViewContextType, React.Dispatch<React.SetStateAction<CollectionViewContextType>>]
>([
    DefaultCollectionViewContext,
    (_param: CollectionViewContextType): void => {
        // just a dummy placeholder for scenarios where the context is not set
        return;
    },
] as const);
