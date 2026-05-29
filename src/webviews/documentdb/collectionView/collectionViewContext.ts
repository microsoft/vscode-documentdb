/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from 'react';
import { type AIIndexRecommendation } from '../../../services/ai/types';
import {
    type QueryInsightsStage1Response,
    type QueryInsightsStage2Response,
    type QueryInsightsStage3Response,
} from './types/queryInsights';

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
    stage1Promise: Promise<QueryInsightsStage1Response> | null;

    stage2Data: QueryInsightsStage2Response | null;
    stage2ErrorMessage: string | null;
    stage2ErrorCode: string | null; // Error code for UI pattern matching
    stage2Promise: Promise<QueryInsightsStage2Response> | null;

    stage3Data: QueryInsightsStage3Response | null;
    stage3ErrorMessage: string | null;
    stage3ErrorCode: string | null; // Error code for UI pattern matching
    stage3Promise: Promise<QueryInsightsStage3Response> | null;
    stage3RequestKey: string | null; // Unique key to track if the response is still valid

    /**
     * Progressive state populated by the `collectionView.queryInsights.streamStage3`
     * subscription (WI-8 emits structured events that this state mirrors).
     * Render code consumes this during Stage-3 loading; on the terminal
     * `complete` event the equivalent fully-formed snapshot is materialized
     * into {@link stage3Data} so byline / collapse code paths that look at
     * `stage3Data` keep working unchanged. `null` whenever no Stage-3 stream
     * is in flight (initial, post-cancel, or post-success-snapshot-only).
     */
    stage3Streaming: QueryInsightsStreamingState | null;

    // Track which errors have been displayed to the user (to prevent duplicate toasts)
    displayedErrors: string[]; // Array of error keys that have been shown
}

/**
 * Per-stream progressive state. Mirrors a strict subset of the
 * `QueryInsightsStreamEvent` union (structured events only — `status` and
 * `complete` drive UI lifecycle elsewhere). Resets to `null` whenever a new
 * Stage 3 request starts.
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
    /** Reconciled verification items, populated on the terminal `verification` event. */
    verification: string[] | null;
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
        stage1Promise: null,

        stage2Data: null,
        stage2ErrorMessage: null,
        stage2ErrorCode: null,
        stage2Promise: null,

        stage3Data: null,
        stage3ErrorMessage: null,
        stage3ErrorCode: null,
        stage3Promise: null,
        stage3RequestKey: null,
        stage3Streaming: null,

        displayedErrors: [],
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
