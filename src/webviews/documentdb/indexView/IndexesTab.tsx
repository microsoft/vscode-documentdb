/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { ConfirmDialog } from './components/ConfirmDialog';
import { CreateIndexDialog } from './components/CreateIndexDialog';
import { IndexFooterBar } from './components/IndexFooterBar';
import { IndexTable } from './components/IndexTable';
import { OPEN_CREATE_INDEX_EVENT } from './constants';
import './indexView.scss';
import { type CreateIndexInput, type IndexRow } from './types';

/**
 * Discriminated union describing which dialog (if any) is currently open
 * and what target row it acts on. Keeping all dialog state in a single
 * variable avoids three otherwise-correlated boolean flags drifting out
 * of sync.
 */
type ModalState = { kind: 'none' } | { kind: 'create' } | { kind: 'delete'; index: IndexRow };

export interface IndexesTabProps {
    /** Display name shown in dialog copy and used to scope tRPC calls server-side. */
    collectionName: string;
}

/**
 * Index Management panel rendered inside the CollectionView's tab strip
 * (between "Results" and "Query Insights"). Talks to the shared
 * `mongoClusters.indexView.*` tRPC router — the procedures pick up the
 * cluster / db / collection coordinates from the CollectionView's
 * router context, so this component only needs the collection name for
 * UI copy.
 */
export const IndexesTab = ({ collectionName }: IndexesTabProps): JSX.Element => {
    const { trpcClient } = useTrpcClient();

    // Index list, loading state, and the unified dialog state. Dialog
    // operations also expose a separate `modalBusy` flag so the dialog
    // can disable its buttons while a mutation is in flight.
    const [indexes, setIndexes] = useState<ReadonlyArray<IndexRow>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [modal, setModal] = useState<ModalState>({ kind: 'none' });
    const [modalBusy, setModalBusy] = useState(false);

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

    /** Fetch the merged real + simulated index list and update state. */
    const refresh = useCallback(async (): Promise<void> => {
        setIsLoading(true);
        try {
            const rows = await trpcClient.mongoClusters.indexView.listIndexes.query();
            setIndexes(rows);
        } catch (error) {
            showError(l10n.t('Failed to load indexes.'), error);
        } finally {
            setIsLoading(false);
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

    /** Submit handler for the Create Index dialog. Re-throws so the dialog can stay open on error. */
    const handleCreateSubmit = useCallback(
        async (input: CreateIndexInput): Promise<void> => {
            setModalBusy(true);
            try {
                await trpcClient.mongoClusters.indexView.createIndex.mutate(input);
                setModal({ kind: 'none' });
                await refresh();
            } catch (error) {
                showError(l10n.t('Failed to create index.'), error);
                throw error;
            } finally {
                setModalBusy(false);
            }
        },
        [trpcClient, refresh, showError],
    );

    /** Final step of the delete-confirm flow. */
    const handleDeleteConfirm = useCallback(async (): Promise<void> => {
        if (modal.kind !== 'delete') {
            return;
        }
        const indexName = modal.index.name;
        setModalBusy(true);
        try {
            await trpcClient.mongoClusters.indexView.dropIndex.mutate({ indexName });
            setModal({ kind: 'none' });
            await refresh();
        } catch (error) {
            showError(l10n.t('Failed to delete index "{0}".', indexName), error);
        } finally {
            setModalBusy(false);
        }
    }, [modal, trpcClient, refresh, showError]);

    /** Hide / unhide toggle. The router decides which mutation to invoke. */
    const handleToggleHidden = useCallback(
        async (index: IndexRow): Promise<void> => {
            try {
                if (index.hidden) {
                    await trpcClient.mongoClusters.indexView.unhideIndex.mutate({ indexName: index.name });
                } else {
                    await trpcClient.mongoClusters.indexView.hideIndex.mutate({ indexName: index.name });
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

    return (
        <div className="indexView">
            {isLoading && <ProgressBar thickness="large" shape="square" className="progressBar" />}

            <div className="indexTableContainer">
                <IndexTable
                    indexes={indexes}
                    onDelete={(idx) => setModal({ kind: 'delete', index: idx })}
                    onToggleHidden={(idx) => void handleToggleHidden(idx)}
                />
            </div>

            <IndexFooterBar indexes={indexes} />

            <CreateIndexDialog
                open={modal.kind === 'create'}
                fieldSuggestions={fieldSuggestions}
                documentCount={documentCount}
                onCancel={() => setModal({ kind: 'none' })}
                onSubmit={handleCreateSubmit}
            />

            <ConfirmDialog
                open={modal.kind === 'delete'}
                title={l10n.t('Delete index?')}
                body={
                    modal.kind === 'delete'
                        ? l10n.t(
                              'Delete index "{0}" from collection "{1}"? This cannot be undone.',
                              modal.index.name,
                              collectionName,
                          )
                        : ''
                }
                confirmLabel={l10n.t('Delete')}
                destructive
                busy={modalBusy}
                onConfirm={() => void handleDeleteConfirm()}
                onCancel={() => setModal({ kind: 'none' })}
            />
        </div>
    );
};
