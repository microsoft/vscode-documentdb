/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from 'react';
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
export interface QueryInsightsState {
    stage1Data: QueryInsightsStage1Response | null;
    stage1Loading: boolean;
    stage1Error: string | null;
    stage1Promise: Promise<QueryInsightsStage1Response> | null;

    stage2Data: QueryInsightsStage2Response | null;
    stage2Loading: boolean;
    stage2Error: string | null;
    stage2Promise: Promise<QueryInsightsStage2Response> | null;

    stage3Data: QueryInsightsStage3Response | null;
    stage3Loading: boolean;
    stage3Error: string | null;
    stage3Promise: Promise<QueryInsightsStage3Response> | null;
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
        setJsonSchema(schema: object): Promise<void>; //monacoEditor.languages.json.DiagnosticsOptions, but we don't want to import monacoEditor here
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
        stage1Data: null,
        stage1Loading: false,
        stage1Error: null,
        stage1Promise: null,

        stage2Data: null,
        stage2Loading: false,
        stage2Error: null,
        stage2Promise: null,

        stage3Data: null,
        stage3Loading: false,
        stage3Error: null,
        stage3Promise: null,
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
