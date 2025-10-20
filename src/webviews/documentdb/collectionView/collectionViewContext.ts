/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from 'react';

export enum Views {
    TABLE = 'Table View',
    TREE = 'Tree View',
    JSON = 'JSON View',
}

export type CollectionViewContextType = {
    isLoading: boolean; // this is a concious decision to use 'isLoading' instead of <Suspense> tags. It's not only the data display component that is supposed to react to the lading state but also some input fields, buttons, etc.
    isFirstTimeLoad: boolean; // this will be set to true during the first data fetch, here we need more time and add more loading animations, but only on the first load
    currentView: Views;
    currentViewState?: TableViewState; // | TreeViewConfiguration |  other views can get config over time
    activeQuery: {
        // The last executed query (used for export, pagination, display)
        queryText: string; // deprecated: use filter instead
        filter: string; // MongoDB find filter (same as queryText for backward compatibility)
        project: string; // MongoDB projection
        sort: string; // MongoDB sort specification
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
};

export type TableViewState = {
    currentPath: string[];
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
