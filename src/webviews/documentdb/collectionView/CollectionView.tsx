/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, ProgressBar, Tab, TabList } from '@fluentui/react-components';
import { EmojiRegular } from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type JSX, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
    type ColumnKey,
    fieldFromColumnKey,
    getCell,
    type TablePage,
    type TreeNode,
} from '../../../utils/documentGrid/types';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { useViewLoadTelemetry } from '../../_integration/useViewLoadTelemetry';
import { Announcer } from '../../components/accessibility';
import { useSelectiveContextMenuPrevention } from '../../components/useSelectiveContextMenuPrevention';
import { setCompletionContext } from '../../query-language-support';
import './collectionView.scss';
import {
    CollectionViewContext,
    type CollectionViewContextType,
    DefaultCollectionViewContext,
    type DocumentTarget,
    resolveDocumentTargets,
    Views,
} from './collectionViewContext';
import { type CollectionViewWebviewConfigurationType } from './collectionViewController';
import { QueryEditor } from './components/queryEditor/QueryEditor';
import { DataViewPanelJSON } from './components/resultsTab/DataViewPanelJSON';
import {
    DataViewPanelTable,
    type DataViewPanelTableFocusRequest,
} from './components/resultsTab/DataViewPanelTable';
import { DataViewPanelTree } from './components/resultsTab/DataViewPanelTree';
import { CollectionQueryActionBar } from './components/toolbar/CollectionQueryActionBar';
import { ToolbarDocumentManipulation } from './components/toolbar/ToolbarDocumentManipulation';
import { ToolbarTableNavigation } from './components/toolbar/ToolbarTableNavigation';
import { ToolbarViewNavigation } from './components/toolbar/ToolbarViewNavigation';
import { ViewSwitcher } from './components/toolbar/ViewSwitcher';
import { IndexesTab } from './indexesTab/IndexesTab';
import { stage1Failed, stage1Succeeded, startStage1Load } from './queryInsightsReducer';
import { QueryInsightsMain } from './queryInsightsTab/QueryInsightsTab';
import { extractErrorCode } from './utils/errorCodeExtractor';

interface QueryResults {
    tablePage?: TablePage;
    treeNodes?: TreeNode[];
    jsonDocuments?: string[];

    /** Number of documents returned by the query (for screen reader announcements) */
    documentCount?: number;
}

interface PendingTableFocusIntent {
    readonly rowKey: string;
    readonly activeQuery: CollectionViewContextType['activeQuery'];
    readonly destinationPath: string[];
    request?: number;
    readonly dispose: () => void;
}

function commandsFor(
    targets: readonly DocumentTarget[] | undefined,
): CollectionViewContextType['commands'] {
    return {
        disableAddDocument: false,
        disableViewDocument: targets?.length !== 1,
        disableEditDocument: targets?.length !== 1,
        disableDeleteDocument: !targets?.length,
    };
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
    const trpcClient = useTrpcClient();

    const viewLoad = useViewLoadTelemetry();
    /**
     * When the view's first query was sent (webview clock), or `undefined` once that load was
     * reported. Only the first query's chain (run the query, then fetch the page for the
     * current view) is load time; every later query, page or view switch is not.
     */
    const firstLoadStartedAtRef = useRef<number | undefined>(undefined);
    const firstLoadClaimedRef = useRef(false);
    const firstLoadDocumentCountRef = useRef<number | undefined>(undefined);

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
        currentView: configuration.initialDocumentView,
        activeQuery: {
            ...DefaultCollectionViewContext.activeQuery,
            pageSize: configuration.defaultPageSize,
        },
    }));

    useSelectiveContextMenuPrevention();

    // Apply initial query from cross-feature navigation (e.g., Playground → Collection View)
    useEffect(() => {
        if (configuration.initialQuery) {
            const iq = configuration.initialQuery;

            // Populate the query editors with the initial values
            setCurrentContext((prev) => ({
                ...prev,
                pendingPaste: {
                    filter: iq.filter,
                    project: iq.project,
                    sort: iq.sort,
                    skip: iq.skip,
                    limit: iq.limit,
                },
                // Execute the query immediately
                activeQuery: {
                    ...prev.activeQuery,
                    queryText: iq.filter ?? prev.activeQuery.queryText,
                    filter: iq.filter ?? prev.activeQuery.filter,
                    project: iq.project ?? prev.activeQuery.project,
                    sort: iq.sort ?? prev.activeQuery.sort,
                    skip: iq.skip ?? prev.activeQuery.skip,
                    limit: iq.limit ?? prev.activeQuery.limit,
                    pageNumber: 1,
                    executionIntent: 'initial',
                },
            }));
        }
        // Only run on mount — configuration is stable after creation
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // that's the local view of query results
    // TODO: it's a potential data duplication in the end, consider moving it into the global context of the view
    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();
    const [tableFocusRequest, setTableFocusRequest] = useState<DataViewPanelTableFocusRequest | undefined>();
    const viewPickerRef = useRef<HTMLButtonElement>(null);
    const resultsDisplayAreaRef = useRef<HTMLDivElement>(null);
    const pendingTableFocusIntentRef = useRef<PendingTableFocusIntent | undefined>(undefined);

    // Track which tab is currently active. Honors `configuration.initialTab`
    // so an external caller (e.g. the "Indexes" tree node) can open the view
    // pre-pinned to the Index Management tab.
    const [selectedTab, setSelectedTab] = useState<'tab_result' | 'tab_indexes' | 'tab_queryInsights'>(
        () => configuration.initialTab ?? 'tab_result',
    );
    const feedbackTab = {
        tab_result: 'documents',
        tab_indexes: 'indexes',
        tab_queryInsights: 'queryInsights',
    } as const;
    const selectedTabId = {
        tab_result: 'tab.results',
        tab_indexes: 'tab.indexes',
        tab_queryInsights: 'tab.queryInsights',
    }[selectedTab];
    const selectedTabPanelId = {
        tab_result: 'tabpanel.results',
        tab_indexes: 'tabpanel.indexes',
        tab_queryInsights: 'tabpanel.queryInsights',
    }[selectedTab];

    // keep Refs updated with the current state
    const currentQueryResultsRef = useRef(currentQueryResults);
    const currentContextRef = useRef(currentContext);
    const dataRequestRef = useRef(0);
    const cachedQueryRef = useRef<CollectionViewContextType['activeQuery'] | undefined>(undefined);
    const tablePageRequestRef = useRef<number | undefined>(undefined);
    currentQueryResultsRef.current = currentQueryResults;
    currentContextRef.current = currentContext;

    function disposePendingTableFocusIntent(): void {
        const intent = pendingTableFocusIntentRef.current;
        if (intent !== undefined) {
            intent.dispose();
            pendingTableFocusIntentRef.current = undefined;
        }
    }

    function cancelPendingTableFocusIntent(): void {
        disposePendingTableFocusIntent();
        setTableFocusRequest(undefined);
    }

    useEffect(
        () => (): void => {
            disposePendingTableFocusIntent();
        },
        [],
    );

    const isCurrentTablePage = useCallback((context: CollectionViewContextType): boolean => {
        const page = currentQueryResultsRef.current?.tablePage;
        return (
            !context.isLoading &&
            context.currentView === Views.TABLE &&
            page !== undefined &&
            tablePageRequestRef.current === dataRequestRef.current &&
            JSON.stringify(page.path) === JSON.stringify(context.currentViewState?.currentPath ?? [])
        );
    }, []);

    const getSelectedTargets = useCallback(
        (context: CollectionViewContextType): DocumentTarget[] | undefined =>
            isCurrentTablePage(context)
                ? resolveDocumentTargets(currentQueryResultsRef.current?.tablePage, context.dataSelection.selectedRowKeys)
                : undefined,
        [isCurrentTablePage],
    );

    const handleSelectedRowKeysChange = useCallback(
        (selectedRowKeys: readonly string[]): void => {
            setCurrentContext((prev) => {
                const isCurrentPage = isCurrentTablePage(prev);
                const nextRowKeys = isCurrentPage ? [...selectedRowKeys] : [];
                const next = {
                    ...prev,
                    dataSelection: { selectedRowKeys: nextRowKeys },
                };
                const withSelection = { ...next, commands: commandsFor(getSelectedTargets(next)) };
                currentContextRef.current = withSelection;
                return withSelection;
            });
        },
        [getSelectedTargets, isCurrentTablePage],
    );

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
     * Non-blocking Stage 1 prefetch after query execution. Populates the
     * ClusterSession cache so data is ready when the user switches to the
     * Query Insights tab. Called only for a fresh query (`initial`/`refresh`)
     * — see the intent gate at the call site.
     *
     * Dedupe contract (shared with the fallback fetch in
     * QueryInsightsTab.tsx): the claim below flips the pipeline to
     * `s1Loading`, so whichever of the two paths gets there first "claims"
     * the load and the other observes `kind === 's1Loading'` and bails. See
     * `startStage1Load` in `queryInsightsReducer.ts`.
     */
    const prefetchQueryInsights = (): void => {
        // Claim the Stage 1 load from inside the functional updater so the
        // gate reads React's latest queued state via `prev`, never the render
        // closure or a ref. The reset effect's `queryInsights → idle` is
        // queued synchronously in the same effect phase, strictly before this
        // promise microtask, so it is already composed into `prev`: on a fresh
        // query `prev.queryInsights` is `idle` here. This is what makes the
        // stale pre-reset read (F2) structurally impossible rather than merely
        // unlikely — a closure read saw the previous run's terminal state and
        // a ref lags by one commit. If the tab fallback already claimed the
        // load, `prev` is `s1Loading`/later and we leave it untouched.
        setCurrentContext((prev) => {
            if (prev.queryInsights.kind !== 'idle') {
                return prev;
            }
            return { ...prev, queryInsights: startStage1Load(prev.queryInsights) };
        });

        // Fire the warm-up request. In the rare both-paths race the fallback
        // fetches too; the F8 guards below drop whichever result lands second,
        // and `getQueryInsightsStage1` is an idempotent cache read.
        // Query parameters are now retrieved from ClusterSession - no need to pass them
        void trpcClient.mongoClusters.collectionView.queryInsights.getQueryInsightsStage1
            .query()
            .then((stage1Data) => {
                // The reducer auto-chains `s1Loading → s2Loading` so the
                // Stage 2 fetch effect in QueryInsightsTab picks up
                // immediately when the user lands on the tab.
                setCurrentContext((prev) => {
                    // F8 guard (mirror of the .catch guard below): if the
                    // pipeline has moved past `s1Loading` (typically because
                    // the user kicked off a newer query / reset), the
                    // resolved payload is stale — drop it rather than
                    // clobber the live state.
                    if (prev.queryInsights.kind !== 's1Loading') {
                        return prev;
                    }
                    return {
                        ...prev,
                        queryInsights: stage1Succeeded(prev.queryInsights, stage1Data),
                    };
                });
                console.debug('Stage 1 data prefetched:', stage1Data);
            })
            .catch((error) => {
                const errorCode = extractErrorCode(error);
                const message = error instanceof Error ? error.message : String(error);
                setCurrentContext((prev) => {
                    // F8: only fold the failure into the state machine if
                    // the current pipeline is still the one we kicked off.
                    // Stage 1 is short-lived and the only way to leave
                    // `s1Loading` is for our `.then`/`.catch` to fire or
                    // for a query reset/new run to start a fresh pipeline —
                    // in the latter case the stale failure must not
                    // overwrite the new state. Note: doesn't fully cover a
                    // second `s1Loading` racing the first (would need a
                    // requestKey, like Stage 3); accepted as Low risk
                    // because Stage 1 typically completes in well under
                    // the time it takes a user to retrigger.
                    if (prev.queryInsights.kind !== 's1Loading') {
                        return prev;
                    }
                    return {
                        ...prev,
                        queryInsights: stage1Failed(prev.queryInsights, message, errorCode),
                    };
                });
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

    function settleFirstLoad(outcome: 'dataShown' | 'empty' | 'failed'): void {
        const startedAt = firstLoadStartedAtRef.current;
        if (startedAt === undefined) {
            return;
        }
        firstLoadStartedAtRef.current = undefined;
        viewLoad.reportFirstData(outcome, performance.now() - startedAt);
    }

    function getDataForView(selectedView: Views): void {
        if (cachedQueryRef.current !== currentContextRef.current.activeQuery) {
            return;
        }
        const request = ++dataRequestRef.current;
        handleSelectedRowKeysChange([]);
        const path = [...(currentContextRef.current.currentViewState?.currentPath ?? [])];
        const pendingFocusIntent = pendingTableFocusIntentRef.current;
        if (pendingFocusIntent !== undefined) {
            const claimFocusRequest =
                selectedView === Views.TABLE &&
                pendingFocusIntent.request === undefined &&
                pendingFocusIntent.activeQuery === currentContextRef.current.activeQuery &&
                pendingFocusIntent.destinationPath.length === path.length &&
                pendingFocusIntent.destinationPath.every((segment, index) => segment === path[index]);
            if (claimFocusRequest) {
                pendingFocusIntent.request = request;
            } else {
                cancelPendingTableFocusIntent();
            }
        }
        const isCurrentRequest = (): boolean => request === dataRequestRef.current;
        switch (selectedView) {
            case Views.TABLE: {
                trpcClient.mongoClusters.collectionView.getCurrentPageAsTable
                    .query(path)
                    .then((result) => {
                        if (!isCurrentRequest()) {
                            return;
                        }
                        const claimedFocusIntent = pendingTableFocusIntentRef.current;
                        const currentPath = currentContextRef.current.currentViewState?.currentPath ?? [];
                        const completesFocusRequest =
                            claimedFocusIntent?.request === request &&
                            claimedFocusIntent.activeQuery === currentContextRef.current.activeQuery &&
                            claimedFocusIntent.destinationPath.length === currentPath.length &&
                            claimedFocusIntent.destinationPath.every(
                                (segment, index) => segment === currentPath[index],
                            ) &&
                            claimedFocusIntent.destinationPath.length === result.path.length &&
                            claimedFocusIntent.destinationPath.every(
                                (segment, index) => segment === result.path[index],
                            );
                        if (claimedFocusIntent?.request === request) {
                            disposePendingTableFocusIntent();
                        }
                        tablePageRequestRef.current = request;
                        currentQueryResultsRef.current = { ...currentQueryResultsRef.current, tablePage: result };
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            tablePage: result,
                        }));
                        if (completesFocusRequest && claimedFocusIntent !== undefined) {
                            setTableFocusRequest({ page: result, rowKey: claimedFocusIntent.rowKey });
                        }
                        handleSelectedRowKeysChange([]);
                        settleFirstLoad(firstLoadDocumentCountRef.current === 0 ? 'empty' : 'dataShown');
                    })
                    .catch((error) => {
                        if (!isCurrentRequest()) {
                            return;
                        }
                        if (pendingTableFocusIntentRef.current?.request === request) {
                            cancelPendingTableFocusIntent();
                        }
                        settleFirstLoad('failed');
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
                        if (!isCurrentRequest()) {
                            return;
                        }
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            treeNodes: result,
                        }));
                        settleFirstLoad(firstLoadDocumentCountRef.current === 0 ? 'empty' : 'dataShown');
                    })
                    .catch((error) => {
                        if (!isCurrentRequest()) {
                            return;
                        }
                        settleFirstLoad('failed');
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
                        if (!isCurrentRequest()) {
                            return;
                        }
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            jsonDocuments: result,
                        }));
                        settleFirstLoad(firstLoadDocumentCountRef.current === 0 ? 'empty' : 'dataShown');
                    })
                    .catch((error) => {
                        if (!isCurrentRequest()) {
                            return;
                        }
                        settleFirstLoad('failed');
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: l10n.t('Error while loading the data'),
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
                    });
                break;
            default:
                settleFirstLoad(firstLoadDocumentCountRef.current === 0 ? 'empty' : 'dataShown');
                break;
        }
    }

    function updateAutoCompletionData(): void {
        trpcClient.mongoClusters.collectionView.getFieldCompletionData
            .query()
            .then((fields) => {
                setCompletionContext(configuration.sessionId, { fields });
            })
            .catch((error) => {
                console.debug('Failed to update field completion data:', error);
                // Non-blocking — completion will work without fields
                trpcClient.common.reportEvent
                    .mutate({
                        eventName: 'fieldCompletionDataFetchFailed',
                        properties: {
                            error: error instanceof Error ? error.message : String(error),
                        },
                    })
                    .catch(() => {
                        // best-effort telemetry, swallow errors
                    });
            });
    }

    useEffect(() => {
        let cancelled = false;
        cancelPendingTableFocusIntent();
        cachedQueryRef.current = undefined;
        ++dataRequestRef.current;
        setCurrentContext((prev) => ({
            ...prev,
            isLoading: true,
            dataSelection: { selectedRowKeys: [] },
            commands: {
                ...prev.commands,
                disableViewDocument: true,
                disableEditDocument: true,
                disableDeleteDocument: true,
            },
        }));

        const isFirstLoad = !firstLoadClaimedRef.current;
        if (isFirstLoad) {
            firstLoadClaimedRef.current = true;
            firstLoadStartedAtRef.current = performance.now();
        }
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
                if (cancelled || currentContext.activeQuery !== currentContextRef.current.activeQuery) {
                    return;
                }
                cachedQueryRef.current = currentContext.activeQuery;
                firstLoadDocumentCountRef.current = response.documentCount;
                // Store document count for screen reader announcements (skip pagination)
                if (currentContext.activeQuery.executionIntent !== 'pagination') {
                    setCurrentQueryResults((prev) => ({ ...prev, documentCount: response.documentCount }));
                }

                // 2. This is the time to update the auto-completion data
                //    Since now we do know more about the data returned from the query
                updateAutoCompletionData();

                // 3. Load the data for the current view
                getDataForView(currentContextRef.current.currentView);

                // 4. Non-blocking Stage 1 prefetch to populate cache. Only on a
                //    fresh query (initial/refresh): pagination keeps the same
                //    query, so the existing Query Insights pipeline (and any
                //    Stage 1+ data) stays valid and must not be reset. This
                //    mirrors the reset effect's own intent gate, so the prefetch
                //    fires exactly when the pipeline is being reset to `idle`.
                const prefetchIntent = currentContext.activeQuery.executionIntent;
                if (prefetchIntent === 'initial' || prefetchIntent === 'refresh') {
                    prefetchQueryInsights();
                }

                setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
            })
            .catch(async (error) => {
                if (cancelled || currentContext.activeQuery !== currentContextRef.current.activeQuery) {
                    return;
                }
                settleFirstLoad('failed');
                const cause = error instanceof Error ? error.message : String(error);
                const explained = await trpcClient.common.explainOperationFailure.query({ message: cause });
                if (cancelled || currentContext.activeQuery !== currentContextRef.current.activeQuery) {
                    return;
                }
                void trpcClient.common.displayErrorMessage.mutate({
                    message: explained ?? l10n.t('Error while running the query'),
                    modal: true,
                    cause,
                });
            })
            .finally(() => {
                if (!cancelled && currentContext.activeQuery === currentContextRef.current.activeQuery) {
                    setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
                }
            });
        return (): void => {
            cancelled = true;
            ++dataRequestRef.current;
        };
    }, [currentContext.activeQuery]);

    useEffect(() => {
        if (currentContext.currentView === Views.TABLE && currentContext.currentViewState?.currentPath) {
            getDataForView(currentContext.currentView);
        }
    }, [currentContext.currentViewState?.currentPath]);

    const handleViewChanged = (selection: Views): void => {
        cancelPendingTableFocusIntent();
        void trpcClient.mongoClusters.collectionView.setCollectionDocumentView.mutate(selection).catch((error) => {
            console.warn('Failed to remember the document view:', error);
        });

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

        handleSelectedRowKeysChange([]);
        currentContextRef.current = { ...currentContextRef.current, currentView: selection };
        setCurrentContext((prev) => ({ ...prev, currentView: selection }));
        getDataForView(selection);
    };

    function handleDeleteDocumentRequest(): void {
        const targets = getSelectedTargets(currentContextRef.current);
        if (!targets?.length) {
            return;
        }
        const requestedIds = targets.map((target) => target.documentId);
        const requestedIdSet = new Set(requestedIds);
        trpcClient.mongoClusters.collectionView.deleteDocumentsById
            .mutate(requestedIds)
            .then((acknowledged) => {
                if (!acknowledged) {
                    return;
                }

                /**
                 * The data on the server has been deleted and our extension code has updated its
                 * cache as well. Now we need to update the view locally, so that the user sees
                 * the changes immediately without potential focus/table resizing issues etc.
                 */

                const page = currentQueryResultsRef.current?.tablePage;
                if (!page) {
                    return;
                }
                const removedKeys = new Set(
                    page.rows
                        .filter((row) => row.documentId !== undefined && requestedIdSet.has(row.documentId))
                        .map((row) => row.rowKey),
                );
                const nextPage = { ...page, rows: page.rows.filter((row) => !removedKeys.has(row.rowKey)) };
                currentQueryResultsRef.current = { ...currentQueryResultsRef.current, tablePage: nextPage };
                setCurrentQueryResults((prev) => ({ ...prev, tablePage: nextPage }));
                setCurrentContext((prev) => {
                    const selectedRowKeys = prev.dataSelection.selectedRowKeys.filter((key) => !removedKeys.has(key));
                    const next = {
                        ...prev,
                        dataSelection: { selectedRowKeys },
                    };
                    const withSelection = { ...next, commands: commandsFor(getSelectedTargets(next)) };
                    currentContextRef.current = withSelection;
                    return withSelection;
                });
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error deleting selected documents'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function openSelectedDocument(open: (documentId: string) => Promise<unknown>): void {
        const targets = getSelectedTargets(currentContextRef.current);
        if (targets?.length !== 1) {
            return;
        }
        open(targets[0].documentId).catch((error) => {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Error opening the document view'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        });
    }

    function handleViewDocumentRequest(): void {
        openSelectedDocument((documentId) =>
            trpcClient.mongoClusters.collectionView.viewDocumentById.mutate(documentId),
        );
    }

    function handleEditDocumentRequest(): void {
        openSelectedDocument((documentId) =>
            trpcClient.mongoClusters.collectionView.editDocumentById.mutate(documentId),
        );
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

    function handleStepInRequest(
        rowKey: string,
        columnKey: ColumnKey,
        gesture: 'keyboard' | 'pointer',
    ): void {
        const page = currentQueryResultsRef.current?.tablePage;
        const context = currentContextRef.current;
        const path = context.currentViewState?.currentPath ?? [];
        const row = page?.rows.find((candidate) => candidate.rowKey === rowKey);
        const field = fieldFromColumnKey(columnKey);
        if (
            !page ||
            !row ||
            !isCurrentTablePage(context) ||
            field === undefined ||
            // O1 keeps nested _id fields hidden; only the root ID column is shown.
            field === '_id' ||
            getCell(row, columnKey)?.type !== 'object'
        ) {
            return;
        }

        const newPath = [...path, field];

        if (gesture === 'keyboard') {
            cancelPendingTableFocusIntent();
            const initiatingArea = resultsDisplayAreaRef.current;
            if (initiatingArea !== undefined && initiatingArea !== null) {
                let listening = true;
                let intent: PendingTableFocusIntent;
                const dispose = (): void => {
                    if (listening) {
                        document.removeEventListener('focusin', onFocusIn, true);
                        listening = false;
                    }
                };
                const onFocusIn = (event: FocusEvent): void => {
                    if (
                        pendingTableFocusIntentRef.current === intent &&
                        event.target instanceof Node &&
                        !initiatingArea.contains(event.target)
                    ) {
                        cancelPendingTableFocusIntent();
                    }
                };
                intent = {
                    rowKey,
                    activeQuery: context.activeQuery,
                    destinationPath: newPath,
                    dispose,
                };
                pendingTableFocusIntentRef.current = intent;
                document.addEventListener('focusin', onFocusIn, true);
            }
        }

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

    function handleResultsKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        const picker = viewPickerRef.current;
        if (
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !(event.target instanceof HTMLElement) ||
            !event.target.matches('[role="gridcell"], [role="columnheader"]') ||
            !event.target.closest('[role="grid"], [role="treegrid"]') ||
            !picker ||
            picker.disabled
        ) {
            return;
        }
        // Bubble after cell/popup handlers; only grid cells can request this exit.
        event.preventDefault();
        event.stopPropagation();
        if (currentContext.currentView === Views.TABLE) {
            // A held Escape must not clear selection and then leave the grid.
            if (event.repeat) {
                return;
            }
            if (currentContext.dataSelection.selectedRowKeys.length > 0) {
                handleSelectedRowKeysChange([]);
                return;
            }
        }
        picker.focus();
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
                    politeness="assertive"
                    message={
                        (currentQueryResults?.documentCount ?? 0) > 0
                            ? l10n.t('Results found')
                            : l10n.t('No results found')
                    }
                />

                <div className="collectionTabHeader">
                    <TabList
                        aria-label={l10n.t('Collection views')}
                        className="collectionTabList"
                        selectedValue={selectedTab}
                        onTabSelect={(_event, data) => {
                            const newTab = data.value as 'tab_result' | 'tab_indexes' | 'tab_queryInsights';
                            cancelPendingTableFocusIntent();

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
                    >
                        <Tab id="tab.results" value="tab_result" aria-controls="tabpanel.results">
                            {l10n.t('Documents')}
                        </Tab>
                        <Tab id="tab.indexes" value="tab_indexes" aria-controls="tabpanel.indexes">
                            {l10n.t('Indexes')}
                        </Tab>
                        <Tab id="tab.queryInsights" value="tab_queryInsights" aria-controls="tabpanel.queryInsights">
                            <span className="queryInsightsTabLabel">{l10n.t('Query Insights')}</span>
                        </Tab>
                    </TabList>
                    {configuration.feedbackPermitted === true && (
                        <Button
                            appearance="transparent"
                            size="small"
                            icon={<EmojiRegular />}
                            onClick={() =>
                                void trpcClient.common.openFeedback.mutate({
                                    collectionTab: feedbackTab[selectedTab],
                                })
                            }
                        >
                            {l10n.t('Give Feedback')}
                        </Button>
                    )}
                </div>

                <div
                    id={selectedTabPanelId}
                    className="collectionTabPanel"
                    role="tabpanel"
                    aria-labelledby={selectedTabId}
                >
                    {selectedTab !== 'tab_indexes' && (
                        <div className="primaryActionBar collectionQueryActionBar">
                            <CollectionQueryActionBar
                                variant={selectedTab === 'tab_result' ? 'documents' : 'queryInsights'}
                            />
                        </div>
                    )}

                    {selectedTab !== 'tab_indexes' && (
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
                    )}

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
                                <ViewSwitcher onViewChanged={handleViewChanged} focusTargetRef={viewPickerRef} />
                            </div>

                            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Delegates Escape from focused RDG cells/headers; the wrapper is not independently interactive. */}
                            <div
                                className="resultsDisplayArea"
                                ref={resultsDisplayAreaRef}
                                id="resultsDisplayAreaId"
                                data-tabster={
                                    // RDG owns cell Tab order, not Tabster's DOM-order traversal.
                                    currentContext.currentView === Views.TABLE ||
                                    currentContext.currentView === Views.TREE
                                        ? JSON.stringify({ focusable: { ignoreKeydown: { Tab: true } } })
                                        : undefined
                                }
                                onKeyDown={handleResultsKeyDown}
                            >
                                {
                                    {
                                        'Table View': (
                                            <DataViewPanelTable
                                                page={currentQueryResults?.tablePage}
                                                selectedRowKeys={currentContext.dataSelection.selectedRowKeys}
                                                onSelectedRowKeysChange={handleSelectedRowKeysChange}
                                                onStepIn={handleStepInRequest}
                                                focusRequest={tableFocusRequest}
                                            />
                                        ),
                                        'Tree View': <DataViewPanelTree nodes={currentQueryResults?.treeNodes ?? []} />,
                                        'JSON View': (
                                            <DataViewPanelJSON value={currentQueryResults?.jsonDocuments ?? []} />
                                        ),
                                        default: <div>error &apos;{currentContext.currentView}&apos;</div>,
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

                    {selectedTab === 'tab_indexes' && <IndexesTab />}

                    {selectedTab === 'tab_queryInsights' && <QueryInsightsMain />}
                </div>
            </div>
        </CollectionViewContext.Provider>
    );
};
