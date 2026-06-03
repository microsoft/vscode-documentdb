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

/**
 * Query Insights State - Tracks the three-stage progressive loading of query insights
 * - Stage 1: Query planner data (lightweight, from explain("queryPlanner"))
 * - Stage 2: Execution statistics (from explain("executionStats"))
 * - Stage 3: AI-powered recommendations (opt-in, requires external AI service call)
 *
 * Promise tracking prevents duplicate requests during rapid tab switching.
 */

export type QueryInsightsStageStatus = 'loading' | 'success' | 'error' | 'cancelled';

export interface QueryInsightsCurrentStage {
    phase: 1 | 2 | 3;
    status: QueryInsightsStageStatus;
}

export interface QueryInsightsState {
    // Explicit stage tracking for clear state transitions
    currentStage: QueryInsightsCurrentStage;

    stage1Data: QueryInsightsStage1Response | null;
    stage1ErrorMessage: string | null;
    stage1ErrorCode: string | null; // Error code for UI pattern matching (e.g., 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU')
    /**
     * True while a Stage 1 fetch is in flight. Used to dedupe between the
     * background prefetch (kicked off by `runQuery` in CollectionView) and
     * the fallback fetch in QueryInsightsTab when the user is already on
     * the tab. Previously this field stored the Promise itself, but only
     * its null/non-null check was ever read — storing Promises in React
     * state is also a known anti-pattern (StrictMode double-invoke etc.).
     */
    stage1InFlight: boolean;

    stage2Data: QueryInsightsStage2Response | null;
    stage2ErrorMessage: string | null;
    stage2ErrorCode: string | null; // Error code for UI pattern matching
    /** See {@link stage1InFlight}. */
    stage2InFlight: boolean;

    stage3ErrorMessage: string | null;
    stage3ErrorCode: string | null; // Error code for UI pattern matching
    stage3RequestKey: string | null; // Unique key to track if the response is still valid

    /**
     * Progressive state populated by the `collectionView.queryInsights.streamStage3`
     * subscription. Sole source of truth for Stage 3:
     *  - During streaming: `summary`/`educational`/`recommendations` slots
     *    drive the in-flight render path (analysis card, shells, etc.).
     *  - On the terminal `complete` event: `completed` is flipped to true
     *    and model metadata is filled in. Render code uses `completed` as
     *    the "has succeeded at least once" sentinel (e.g. gating the
     *    post-response "Powered by ..." byline and the empty-state card)
     *    instead of a separate `stage3Data` snapshot.
     *
     * `null` whenever no Stage 3 stream is in flight (initial, post-cancel).
     */
    stage3Streaming: QueryInsightsStreamingState | null;

    // NOTE: error-toast dedupe used to live here as `displayedErrors: string[]`.
    // It never drove a re-render, so it was moved to a component-local
    // `useRef<Set<string>>` in QueryInsightsTab. Don't reintroduce it here.

    // NOTE: `stage3Data: QueryInsightsStage3Response | null` used to live
    // here as a parallel success snapshot synthesised from the stream on
    // `complete`. It was only consumed for (a) a `!stage3Data` "completed"
    // sentinel and (b) the `modelDisplayName` byline. Both moved onto
    // `stage3Streaming.completed` / `.modelDisplayName` in this commit.
    // Don't reintroduce it; one source of truth per stream is the point.
}

/**
 * Per-stream progressive state. Carries the structured slots populated
 * during streaming (`summary`, `educational`, `recommendations`) plus the
 * terminal-event slots populated on `complete` (`completed`,
 * `modelDisplayName`, etc.). Resets to `null` whenever a new Stage 3
 * request starts so nothing from a previous run leaks across.
 */
export interface QueryInsightsStreamingState {
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
    /**
     * Flipped to `true` when the terminal `complete` event lands. Used as
     * the "Stage 3 has finished at least once" sentinel by render code:
     *  - gates the post-response "Powered by ..." byline,
     *  - gates the "no recommendations needed" empty-state card.
     * Remains `true` until a new Stage 3 request resets `stage3Streaming`.
     */
    completed: boolean;
    /** Model metadata populated by the `complete` event (success only). */
    modelDisplayName?: string;
    modelId?: string;
    modelFamily?: string;
    usage?: QueryInsightsStreamUsage;
}

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
    queryInsights: QueryInsightsState; // Query insights state for progressive loading
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
    queryInsights: {
        currentStage: { phase: 1, status: 'loading' },

        stage1Data: null,
        stage1ErrorMessage: null,
        stage1ErrorCode: null,
        stage1InFlight: false,

        stage2Data: null,
        stage2ErrorMessage: null,
        stage2ErrorCode: null,
        stage2InFlight: false,

        stage3ErrorMessage: null,
        stage3ErrorCode: null,
        stage3RequestKey: null,
        stage3Streaming: null,
    },
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
