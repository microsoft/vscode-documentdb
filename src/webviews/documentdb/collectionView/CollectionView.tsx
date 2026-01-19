/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, ProgressBar, Tab, TabList } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useRef, useState } from 'react';
import { type TableDataEntry } from '../../../documentdb/ClusterSession';
import { UsageImpact } from '../../../utils/surveyTypes';
import { Announcer } from '../../api/webview-client/accessibility';
import { useConfiguration } from '../../api/webview-client/useConfiguration';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import { useSelectiveContextMenuPrevention } from '../../api/webview-client/utils/useSelectiveContextMenuPrevention';
import './collectionView.scss';
import {
    CollectionViewContext,
    type CollectionViewContextType,
    DefaultCollectionViewContext,
    Views,
} from './collectionViewContext';
import { type CollectionViewWebviewConfigurationType } from './collectionViewController';
import { QueryEditor } from './components/queryEditor/QueryEditor';
import { QueryInsightsMain } from './components/queryInsightsTab/QueryInsightsTab';
import { DataViewPanelJSON } from './components/resultsTab/DataViewPanelJSON';
import { DataViewPanelTable } from './components/resultsTab/DataViewPanelTable';
import { DataViewPanelTree } from './components/resultsTab/DataViewPanelTree';
import { ToolbarDocumentManipulation } from './components/toolbar/ToolbarDocumentManipulation';
import { ToolbarMainView } from './components/toolbar/ToolbarMainView';
import { ToolbarTableNavigation } from './components/toolbar/ToolbarTableNavigation';
import { ToolbarViewNavigation } from './components/toolbar/ToolbarViewNavigation';
import { ViewSwitcher } from './components/toolbar/ViewSwitcher';
import { extractErrorCode } from './utils/errorCodeExtractor';

interface QueryResults {
    tableHeaders?: string[];
    tableData?: TableDataEntry[]; // 'x-objectid': string;
    tableCurrentPath?: string[];

    treeData?: { [key: string]: unknown }[];

    jsonDocuments?: string[];

    /** Number of documents returned by the query (for screen reader announcements) */
    documentCount?: number;
}

export const CollectionView = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const { trpcClient } = useTrpcClient();

    /**
     * Please note: using the context and states inside of closures can lead to stale data.
     *
     * Closures capture state at the time of the closure creation, and do not update when the state changes.
     * This can lead to unexpected and surprising bugs where the state is not updated as expected (or rather 'assumed').
     *
     * There are two ways I know to work around this:
     * 1. Use the useRef hook to store the state and access it in the closure.
     * 2. Define the closure inside the useEffect hook, so it captures the state at the time of the effect.
     *
     * We can't use 2 in this case, because we need to define the handleMessage function outside of the useEffect hook.
     * As it could happen that the message arrives while we're reconfiguring the event listener.
     *
     * We're using the useRef hook to store the state and access it in the closure.
     */

    // that's our current global context of the view
    const [currentContext, setCurrentContext] = useState<CollectionViewContextType>(() => ({
        ...DefaultCollectionViewContext,
        activeQuery: {
            ...DefaultCollectionViewContext.activeQuery,
            pageSize: configuration.defaultPageSize,
        },
    }));

    useSelectiveContextMenuPrevention();

    // that's the local view of query results
    // TODO: it's a potential data duplication in the end, consider moving it into the global context of the view
    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();

    // Track which tab is currently active
    const [selectedTab, setSelectedTab] = useState<'tab_result' | 'tab_queryInsights'>('tab_result');

    // keep Refs updated with the current state
    const currentQueryResultsRef = useRef(currentQueryResults);
    const currentContextRef = useRef(currentContext);

    useEffect(() => {
        currentQueryResultsRef.current = currentQueryResults;
        currentContextRef.current = currentContext;
    }, [currentQueryResults, currentContext]);

    /**
     * Reset query insights when query changes (not on pagination)
     * Only reset when executionIntent is 'initial' or 'refresh'
     * On 'pagination', preserve Query Insights data since the query hasn't changed
     */
    useEffect(() => {
        const intent = currentContext.activeQuery.executionIntent;

        // Only reset on actual query changes, not pagination
        if (intent === 'initial' || intent === 'refresh') {
            console.trace('[CollectionView] Query changed (intent: {0}), resetting Query Insights', intent);
            setCurrentContext((prev) => ({
                ...prev,
                queryInsights: DefaultCollectionViewContext.queryInsights,
            }));
        }
        // On 'pagination' → preserve existing Query Insights state
    }, [currentContext.activeQuery]);

    /**
     * Non-blocking Stage 1 prefetch after query execution
     * Populates ClusterSession cache so data is ready when user switches to Query Insights tab
     * Uses promise tracking to prevent duplicate requests
     */
    const prefetchQueryInsights = (): void => {
        // Check if already loaded or in-flight promise
        // Don't check status === 'loading' because we just reset to that state before calling this
        if (currentContext.queryInsights.stage1Data || currentContext.queryInsights.stage1Promise) {
            return; // Already handled
        }

        // Query parameters are now retrieved from ClusterSession - no need to pass them
        const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage1.query();

        // Track the promise immediately
        setCurrentContext((prev) => ({
            ...prev,
            queryInsights: {
                ...prev.queryInsights,
                stage1Promise: promise,
            },
        }));

        // Handle completion
        void promise
            .then((stage1Data) => {
                // Update state with data and mark stage as successful
                // This prevents redundant fetch when user switches to Query Insights tab
                setCurrentContext((prev) => ({
                    ...prev,
                    queryInsights: {
                        ...prev.queryInsights,
                        currentStage: { phase: 1, status: 'success' },
                        stage1Data: stage1Data,
                        stage1Promise: null,
                    },
                }));
                console.debug('Stage 1 data prefetched:', stage1Data);
            })
            .catch((error) => {
                // Extract error code by traversing the cause chain using the helper function
                const errorCode = extractErrorCode(error);

                // Mark stage as failed to prevent redundant fetch on tab switch
                // Store both error message and code for UI pattern matching
                setCurrentContext((prev) => ({
                    ...prev,
                    queryInsights: {
                        ...prev.queryInsights,
                        currentStage: { phase: 1, status: 'error' },
                        stage1ErrorMessage: error instanceof Error ? error.message : String(error),
                        stage1ErrorCode: errorCode,
                        stage1Promise: null,
                    },
                }));
                console.warn('Stage 1 prefetch failed:', error);
            });
    };

    /**
     * This is used to run the query. We control it by setting the query configuration
     * in the currentContext state. Whenever the query configuration changes,
     * we run the query.
     *
     * It helps us manage the query runs as the configuration changes from
     * within various controls (query panel, paging, etc.).
     */
    useEffect(() => {
        setCurrentContext((prev) => ({ ...prev, isLoading: true }));

        // 1. Run the query, this operation only acknowledges the request.
        //    Next we need to load the ones we need.
        trpcClient.mongoClusters.collectionView.runFindQuery
            .query({
                filter: currentContext.activeQuery.filter,
                project: currentContext.activeQuery.project,
                sort: currentContext.activeQuery.sort,
                skip: currentContext.activeQuery.skip,
                limit: currentContext.activeQuery.limit,
                pageNumber: currentContext.activeQuery.pageNumber,
                pageSize: currentContext.activeQuery.pageSize,
                executionIntent: currentContext.activeQuery.executionIntent ?? 'pagination',
            })
            .then((response) => {
                // Store document count for screen reader announcements (skip pagination)
                if (currentContext.activeQuery.executionIntent !== 'pagination') {
                    setCurrentQueryResults((prev) => ({ ...prev, documentCount: response.documentCount }));
                }

                // 2. This is the time to update the auto-completion data
                //    Since now we do know more about the data returned from the query
                updateAutoCompletionData();

                // 3. Load the data for the current view
                getDataForView(currentContext.currentView);

                // 4. Non-blocking Stage 1 prefetch to populate cache
                //    This runs in background and doesn't block results display
                prefetchQueryInsights();

                setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error while running the query'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
            });
    }, [currentContext.activeQuery]);

    useEffect(() => {
        if (currentContext.currentView === Views.TABLE && currentContext.currentViewState?.currentPath) {
            getDataForView(currentContext.currentView);
        }
    }, [currentContext.currentViewState?.currentPath]);

    const handleViewChanged = (_optionValue: string) => {
        let selection: Views;

        switch (_optionValue) {
            case 'Table View':
                selection = Views.TABLE;
                break;
            case 'Tree View':
                selection = Views.TREE;
                break;
            case 'JSON View':
                selection = Views.JSON;
                break;
            default:
                selection = Views.TABLE;
                break;
        }

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'viewChanged',
                properties: {
                    view: selection,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });

        setCurrentContext((prev) => ({ ...prev, currentView: selection }));
        getDataForView(selection);

        trpcClient.common.surveyPing.mutate({ usageImpact: UsageImpact.Medium }).catch(() => {});
    };

    function getDataForView(selectedView: Views): void {
        switch (selectedView) {
            case Views.TABLE: {
                const path = currentContext.currentViewState?.currentPath ?? [];

                trpcClient.mongoClusters.collectionView.getCurrentPageAsTable
                    .query(path)
                    .then((result) => {
                        let tableHeaders: string[];

                        /*
                         * If the _id is not in the headers, we add it as the first column.
                         * This is a presentation detail, not a data detail, that's why it's done
                         * here, in the view, not in the controller.
                         */
                        if (result.headers.find((header) => header === '_id') === undefined) {
                            tableHeaders = ['_id', ...result.headers];
                        } else {
                            tableHeaders = result.headers ?? [];
                        }

                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            tableHeaders: tableHeaders,
                            tableData: (result.data as TableDataEntry[]) ?? [],
                        }));
                    })
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: l10n.t('Error while loading the data'),
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
                    });
                break;
            }
            case Views.TREE:
                trpcClient.mongoClusters.collectionView.getCurrentPageAsTree
                    .query()
                    .then((result) => {
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            treeData: result,
                        }));
                    })
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: l10n.t('Error while loading the data'),
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
                    });
                break;
            case Views.JSON:
                trpcClient.mongoClusters.collectionView.getCurrentPageAsJson
                    .query()
                    .then((result) => {
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            jsonDocuments: result,
                        }));
                    })
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: l10n.t('Error while loading the data'),
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
                    });
                break;
            default:
                break;
        }
    }

    function updateAutoCompletionData(): void {
        trpcClient.mongoClusters.collectionView.getAutocompletionSchema
            .query()
            .then(async (schema) => {
                void (await currentContextRef.current.queryEditor?.setJsonSchema(schema));
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error while loading the autocompletion data'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleDeleteDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.deleteDocumentsById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds)
            .then((acknowledged) => {
                if (!acknowledged) {
                    return;
                }

                /**
                 * The data on the server has been deleted and our extension code has updated its
                 * cache as well. Now we need to update the view locally, so that the user sees
                 * the changes immediately without potential focus/table resizing issues etc.
                 */

                setCurrentQueryResults((prev) => ({
                    ...prev,
                    tableData: prev?.tableData?.filter(
                        (row) =>
                            !currentContextRef.current.dataSelection.selectedDocumentObjectIds.includes(
                                row['x-objectid'] ?? '',
                            ),
                    ),
                }));

                setCurrentContext((prev) => ({
                    ...prev,
                    dataSelection: {
                        selectedDocumentIndexes: [],
                        selectedDocumentObjectIds: [],
                    },
                }));
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error deleting selected documents'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleViewDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.viewDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error opening the document view'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleEditDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.editDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error opening the document view'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleAddDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.addDocument.mutate().catch((error) => {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Error opening the document view'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        });
    }

    function handleStepInRequest(row: number, cell: number): void {
        // Always use the ref to access latest data
        const queryResults = currentQueryResultsRef.current;

        const activeDocument: TableDataEntry = queryResults?.tableData?.[row] ?? {};
        const activeColumn: string = queryResults?.tableHeaders?.[cell] ?? '';

        // Add proper property existence check
        if (!(activeColumn in activeDocument)) {
            console.debug('Column does not exist in document:', activeColumn);
            return;
        }

        const activeCell = activeDocument[activeColumn];

        // Add proper null check
        if (activeCell === undefined || activeCell === null) {
            console.debug('Cell value is undefined for column:', activeColumn);
            return;
        }

        console.debug('Step-in requested on cell', activeCell, 'in row', row, 'column', cell);

        if (activeColumn === '_id') {
            console.debug('Cell is an _id, skipping step-in');
            return;
        }

        // Type guard for safer property access
        if (
            typeof activeCell !== 'object' ||
            activeCell === null ||
            !('type' in activeCell) ||
            activeCell.type !== 'object'
        ) {
            console.debug('Cell is not an object, skipping step-in');
            return;
        }

        const newPath = [...(currentContextRef.current.currentViewState?.currentPath ?? []), activeColumn];

        setCurrentContext((prev) => ({
            ...prev,
            currentViewState: {
                currentPath: newPath,
            },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'stepIn',
                properties: {
                    source: 'step-in-button',
                },
                measurements: {
                    depth: newPath.length ?? 0,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    return (
        <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
            <div className="collectionView">
                {currentContext.isLoading && (
                    <ProgressBar thickness="large" shape="square" className="progressBar" aria-hidden={true} />
                )}

                {/* Screen reader announcement when query completes */}
                <Announcer
                    when={!currentContext.isLoading && currentQueryResults?.documentCount !== undefined}
                    message={
                        (currentQueryResults?.documentCount ?? 0) > 0
                            ? l10n.t('Results found')
                            : l10n.t('No results found')
                    }
                />

                <div className="toolbarMainView">
                    <ToolbarMainView />
                </div>

                <QueryEditor
                    onExecuteRequest={() => {
                        // Get all query values from the editor at once
                        const query = currentContext.queryEditor?.getCurrentQuery() ?? {
                            filter: '{  }',
                            project: '{  }',
                            sort: '{  }',
                            skip: 0,
                            limit: 0,
                        };

                        setCurrentContext((prev) => ({
                            ...prev,
                            activeQuery: {
                                ...prev.activeQuery,
                                queryText: query.filter, // deprecated: kept in sync with filter
                                filter: query.filter,
                                project: query.project,
                                sort: query.sort,
                                skip: query.skip,
                                limit: query.limit,
                                pageNumber: 1,
                                executionIntent: 'initial',
                            },
                        }));

                        trpcClient.common.reportEvent
                            .mutate({
                                eventName: 'executeQuery',
                                properties: {
                                    ui: 'shortcut',
                                },
                                measurements: {
                                    queryLenth: query.filter.length,
                                },
                            })
                            .catch((error) => {
                                console.debug('Failed to report an event:', error);
                            });
                    }}
                />

                <TabList
                    selectedValue={selectedTab}
                    onTabSelect={(_event, data) => {
                        const newTab = data.value as 'tab_result' | 'tab_queryInsights';

                        // Report tab switching telemetry
                        trpcClient.common.reportEvent
                            .mutate({
                                eventName: 'tabChanged',
                                properties: {
                                    previousTab: selectedTab,
                                    newTab: newTab,
                                },
                            })
                            .catch((error) => {
                                console.debug('Failed to report tab change:', error);
                            });

                        setSelectedTab(newTab);
                    }}
                    style={{ marginTop: '-10px' }}
                >
                    <Tab id="tab.results" value="tab_result">
                        Results
                    </Tab>
                    <Tab id="tab.queryInsights" value="tab_queryInsights">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            Query Insights
                            <Badge appearance="tint" size="small" shape="rounded" color="brand">
                                PREVIEW
                            </Badge>
                        </div>
                    </Tab>
                </TabList>

                {selectedTab === 'tab_result' && (
                    <>
                        <div className="resultsActionBar">
                            <ToolbarViewNavigation />
                            <ToolbarDocumentManipulation
                                onDeleteClick={handleDeleteDocumentRequest}
                                onEditClick={handleEditDocumentRequest}
                                onViewClick={handleViewDocumentRequest}
                                onAddClick={handleAddDocumentRequest}
                            />
                            <ViewSwitcher onViewChanged={handleViewChanged} />
                        </div>

                        <div className="resultsDisplayArea" id="resultsDisplayAreaId">
                            {
                                {
                                    'Table View': (
                                        <DataViewPanelTable
                                            liveHeaders={currentQueryResults?.tableHeaders ?? []}
                                            liveData={currentQueryResults?.tableData ?? []}
                                            handleStepIn={handleStepInRequest}
                                        />
                                    ),
                                    'Tree View': <DataViewPanelTree liveData={currentQueryResults?.treeData ?? []} />,
                                    'JSON View': <DataViewPanelJSON value={currentQueryResults?.jsonDocuments ?? []} />,
                                    default: <div>error '{currentContext.currentView}'</div>,
                                }[currentContext.currentView] // switch-statement
                            }
                        </div>

                        {currentContext.currentView === Views.TABLE && (
                            <div className="toolbarTableNavigation">
                                <ToolbarTableNavigation />
                            </div>
                        )}
                    </>
                )}

                {selectedTab === 'tab_queryInsights' && <QueryInsightsMain />}
            </div>
        </CollectionViewContext.Provider>
    );
};
