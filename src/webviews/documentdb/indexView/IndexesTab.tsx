/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { CreateIndexDrawer } from './components/CreateIndexDrawer';
import { IndexList } from './components/indexList';
import { IndexMetricsRow } from './components/IndexMetricsRow';
import { OPEN_CREATE_INDEX_EVENT, REFRESH_INDEXES_EVENT } from './constants';
import './indexView.scss';
import { type CreateIndexInput, type IndexRow } from './types';
import { formatBytes, formatOps } from './utils/format';

/**
 * Discriminated union describing which dialog (if any) is currently open
 * and what target row it acts on. Keeping all dialog state in a single
 * variable avoids three otherwise-correlated boolean flags drifting out
 * of sync.
 */
type ModalState = { kind: 'none' } | { kind: 'create' };

/**
 * Index Management panel rendered inside the CollectionView's tab strip
 * (between "Results" and "Query Insights"). Talks to the shared
 * `mongoClusters.indexView.*` tRPC router — the procedures pick up the
 * cluster / db / collection coordinates from the CollectionView's
 * router context, so this component needs no props of its own.
 */
export const IndexesTab = (): JSX.Element => {
    const trpcClient = useTrpcClient();

    // Index list, loading state, and the unified dialog state. We distinguish
    // the *first* load (which shows skeletons) from later refreshes/mutations
    // (which keep the existing rows visible and only show a thin progress bar) —
    // reloading the whole list into a skeleton on every hide/delete/create is
    // too noisy, the same lesson learned for the CollectionView data grid.
    const [indexes, setIndexes] = useState<ReadonlyArray<IndexRow>>([]);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const hasLoadedRef = useRef(false);
    const [modal, setModal] = useState<ModalState>({ kind: 'none' });

    // Field suggestions (from SchemaStore) and the collection's document
    // count drive the Create Index dialog. They are pre-fetched when the
    // dialog opens and intentionally left stale afterwards.
    const [fieldSuggestions, setFieldSuggestions] = useState<ReadonlyArray<string>>([]);
    const [documentCount, setDocumentCount] = useState<number>(0);

    /** Surface a non-modal error toast for any failed tRPC call. */
    const showError = useCallback(
        (message: string, error: unknown): void => {
            const cause = error instanceof Error ? error.message : String(error);
            void trpcClient.common.displayErrorMessage.mutate({ message, modal: false, cause });
        },
        [trpcClient],
    );

    /** Fetch the index list. The first load shows a skeleton; later refreshes
     * keep the current rows on screen and only surface a thin progress bar. */
    const refresh = useCallback(async (): Promise<void> => {
        const initial = !hasLoadedRef.current;
        if (initial) {
            // Clear so the skeleton (rather than stale data) shows on first load.
            setIsInitialLoading(true);
            setIndexes([]);
        } else {
            setIsRefreshing(true);
        }
        try {
            const rows = await trpcClient.mongoClusters.indexView.listIndexes.query();
            setIndexes(rows);
            hasLoadedRef.current = true;
        } catch (error) {
            showError(l10n.t('Failed to load indexes.'), error);
        } finally {
            if (initial) {
                setIsInitialLoading(false);
            } else {
                setIsRefreshing(false);
            }
        }
    }, [trpcClient, showError]);

    // Initial load. `refresh` is stable across renders because its only
    // dependencies (trpcClient, showError) are themselves memoised.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    /**
     * Pre-fetch the data the Create dialog needs (field suggestions +
     * approximate document count for the large-collection warning),
     * then open the dialog. Failures are swallowed so the dialog still
     * opens with whatever data was retrievable.
     */
    const openCreateDialog = useCallback(async (): Promise<void> => {
        try {
            const [suggestions, count] = await Promise.all([
                trpcClient.mongoClusters.indexView.getFieldSuggestions.query(),
                trpcClient.mongoClusters.indexView.getCollectionDocumentCount.query(),
            ]);
            setFieldSuggestions(suggestions);
            setDocumentCount(count);
        } catch {
            setFieldSuggestions([]);
            setDocumentCount(0);
        }
        setModal({ kind: 'create' });
    }, [trpcClient]);

    // Listen for the toolbar-driven "Create Index" event so the primary
    // CollectionView toolbar can open this tab's create dialog.
    useEffect(() => {
        const handler = (): void => {
            void openCreateDialog();
        };
        window.addEventListener(OPEN_CREATE_INDEX_EVENT, handler);
        return () => window.removeEventListener(OPEN_CREATE_INDEX_EVENT, handler);
    }, [openCreateDialog]);

    // Listen for the toolbar-driven "Refresh" event so the primary CollectionView
    // toolbar refreshes this tab's index list when it is the active tab.
    useEffect(() => {
        const handler = (): void => {
            void refresh();
        };
        window.addEventListener(REFRESH_INDEXES_EVENT, handler);
        return () => window.removeEventListener(REFRESH_INDEXES_EVENT, handler);
    }, [refresh]);

    /** Submit handler for the Create Index dialog. Re-throws so the dialog can stay open on error. */
    const handleCreateSubmit = useCallback(
        async (input: CreateIndexInput): Promise<void> => {
            try {
                const result = await trpcClient.mongoClusters.indexView.createIndex.mutate(input);
                setModal({ kind: 'none' });
                void trpcClient.common.displayInformationMessage.mutate({
                    message: result.indexName
                        ? l10n.t('Index "{0}" created.', result.indexName)
                        : l10n.t('Index created.'),
                });
                await refresh();
            } catch (error) {
                showError(l10n.t('Failed to create index.'), error);
                throw error;
            }
        },
        [trpcClient, refresh, showError],
    );

    /** Delete an index. Confirmation happens on the extension host (modal). */
    const handleDelete = useCallback(
        async (index: IndexRow): Promise<void> => {
            const indexName = index.name;
            try {
                const result = await trpcClient.mongoClusters.indexView.dropIndex.mutate({ indexName });
                if (result.cancelled) {
                    return;
                }
                void trpcClient.common.displayInformationMessage.mutate({
                    message: l10n.t('Index "{0}" deleted.', indexName),
                });
                await refresh();
            } catch (error) {
                showError(l10n.t('Failed to delete index "{0}".', indexName), error);
            }
        },
        [trpcClient, refresh, showError],
    );

    /** Hide / unhide toggle. Confirmation happens on the extension host (modal). */
    const handleToggleHidden = useCallback(
        async (index: IndexRow): Promise<void> => {
            const details = { sizeText: formatBytes(index.sizeBytes), usageText: formatOps(index.usageOps) };
            try {
                const result = index.hidden
                    ? await trpcClient.mongoClusters.indexView.unhideIndex.mutate({
                          indexName: index.name,
                          ...details,
                      })
                    : await trpcClient.mongoClusters.indexView.hideIndex.mutate({
                          indexName: index.name,
                          ...details,
                      });
                if (result.cancelled) {
                    return;
                }
                await refresh();
            } catch (error) {
                showError(
                    index.hidden
                        ? l10n.t('Failed to unhide index "{0}".', index.name)
                        : l10n.t('Failed to hide index "{0}".', index.name),
                    error,
                );
            }
        },
        [trpcClient, refresh, showError],
    );

    /**
     * Prepare the create-index command in a playground or interactive shell.
     * The command is built server-side from the same input as a direct create;
     * on success the drawer closes since the task is handed off elsewhere.
     */
    const handlePrepareInTarget = useCallback(
        async (target: 'playground' | 'shell', input: CreateIndexInput): Promise<void> => {
            try {
                if (target === 'playground') {
                    await trpcClient.mongoClusters.indexView.openCreateInPlayground.mutate(input);
                } else {
                    await trpcClient.mongoClusters.indexView.openCreateInShell.mutate(input);
                }
                setModal({ kind: 'none' });
            } catch (error) {
                showError(l10n.t('Failed to prepare the index command.'), error);
                throw error;
            }
        },
        [trpcClient, showError],
    );

    return (
        <div className="indexView">
            {(isInitialLoading || isRefreshing) && (
                <ProgressBar thickness="large" shape="square" className="progressBar" />
            )}

            {/* First row: summary metric cards (mirrors the Query Insights layout). */}
            <div className="indexMetricsRowContainer">
                <IndexMetricsRow indexes={indexes} isLoading={isInitialLoading} />
            </div>

            {/* Filter row + details table, wrapped as a self-contained component.
                The list skeleton is reserved for the first load; later refreshes
                and mutations update the rows in place without flashing a skeleton. */}
            <IndexList
                indexes={indexes}
                isLoading={isInitialLoading}
                onDelete={(idx) => void handleDelete(idx)}
                onToggleHidden={(idx) => void handleToggleHidden(idx)}
            />

            <CreateIndexDrawer
                open={modal.kind === 'create'}
                fieldSuggestions={fieldSuggestions}
                documentCount={documentCount}
                onCancel={() => setModal({ kind: 'none' })}
                onSubmit={handleCreateSubmit}
                onPrepareInTarget={handlePrepareInTarget}
            />
        </div>
    );
};
