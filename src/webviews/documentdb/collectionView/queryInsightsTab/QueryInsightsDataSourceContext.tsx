/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import { createContext, useCallback, useContext, useMemo, type JSX, type ReactNode } from 'react';
import type { CommandType } from '../../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { CollectionViewContext, type QueryInsightsState } from '../collectionViewContext';
import type { CollectionViewWebviewConfigurationType } from '../collectionViewController';
import type { QueryInsightsStage1Response, QueryInsightsStage2Response } from '../types/queryInsights';
import type { QueryInsightsStreamEvent } from '../types/queryInsightsStream';

export interface Stage3Callbacks {
    onData: (event: QueryInsightsStreamEvent) => void;
    onError: (error: unknown) => void;
    onComplete: () => void;
}

export interface QueryInsightsDataSource {
    pipeline: QueryInsightsState;
    dispatch: (transition: (previous: QueryInsightsState) => QueryInsightsState) => void;
    identity: { clusterId?: string; databaseName: string; collectionName: string };
    actionsEnabled: boolean;
    isQueryLoading: boolean;
    autoStartStage3?: boolean;
    commandType?: CommandType;
    getStage1: () => Promise<QueryInsightsStage1Response>;
    getStage2: () => Promise<QueryInsightsStage2Response>;
    streamStage3: (requestKey: string, callbacks: Stage3Callbacks, modelId?: string) => { unsubscribe: () => void };
    executeAction: (actionId: string, payload: unknown) => Promise<{ success: boolean; message?: string }>;
    explore?: () => Promise<void>;
    viewRawExplain?: () => Promise<void>;
}

export const QueryInsightsDataSourceContext = createContext<QueryInsightsDataSource | undefined>(undefined);

function useCollectionDataSource(): QueryInsightsDataSource {
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();
    const client = useTrpcClient();
    const [state, setState] = useContext(CollectionViewContext);
    const dispatch = useCallback<QueryInsightsDataSource['dispatch']>(
        (transition) => setState((previous) => ({ ...previous, queryInsights: transition(previous.queryInsights) })),
        [setState],
    );
    return useMemo<QueryInsightsDataSource>(() => ({
        pipeline: state.queryInsights,
        dispatch,
        identity: configuration,
        actionsEnabled: true,
        isQueryLoading: state.isLoading,
        getStage1: () => client.mongoClusters.collectionView.queryInsights.getQueryInsightsStage1.query(),
        getStage2: () => client.mongoClusters.collectionView.queryInsights.getQueryInsightsStage2.query(),
        streamStage3: (requestKey, callbacks) =>
            client.mongoClusters.collectionView.queryInsights.streamStage3.subscribe({ requestKey }, callbacks),
        executeAction: (actionId, payload) =>
            client.mongoClusters.collectionView.queryInsights.executeQueryInsightsAction.mutate({ actionId, payload }),
        explore: async (): Promise<void> => {
            const prefill = await client.mongoClusters.collectionView.queryInsights.getExplorePrefill.query();
            await client.queryInsightsStandalone.openExplorer.mutate(prefill);
        },
    }), [state.queryInsights, state.isLoading, dispatch, configuration, client]);
}

export function CollectionQueryInsightsProvider({ children }: { children: ReactNode }): JSX.Element {
    const source = useCollectionDataSource();
    return <QueryInsightsDataSourceContext.Provider value={source}>{children}</QueryInsightsDataSourceContext.Provider>;
}

export function useQueryInsightsDataSource(): QueryInsightsDataSource {
    const source = useContext(QueryInsightsDataSourceContext);
    if (!source) {
        throw new Error('Query Insights requires a data-source provider.');
    }
    return source;
}
