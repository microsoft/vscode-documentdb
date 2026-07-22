/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { CreateIndexDrawer } from './components/CreateIndexDrawer';
import { IndexList } from './components/indexList';
import { IndexManagementToolbar } from './components/IndexManagementToolbar';
import { IndexMetricsRow } from './components/IndexMetricsRow';
import './indexView.scss';
import { type CreateIndexInput, type FieldIndexType, type IndexRow } from './types';
import { formatBytes, formatOps } from './utils/format';

/** How often to re-poll while at least one index is building or being created. */
const BUILD_POLL_INTERVAL_MS = 5000;

/**
 * Minimum time a row's action highlight (deleting / hiding / unhiding) stays
 * visible before we refresh, so a quick server operation is still perceptible.
 */
const MIN_ACTION_VISIBLE_MS = 2000;

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An optimistic, client-only pending index shown while a create is in flight. */
interface PendingCreate {
    name: string;
    key: ReadonlyArray<{ field: string; direction: number | string }>;
    unique: boolean;
    sparse: boolean;
    expireAfterSeconds?: number;
    hasPartialFilter: boolean;
    hasCollation: boolean;
}

/** Map a per-field index type onto its wire-level key value (mirrors the router). */
function keyDirection(type: FieldIndexType): number | string {
    if (type === 'asc') {
        return 1;
    }
    if (type === 'desc') {
        return -1;
    }
    return type;
}

/**
 * Derive the optimistic pending row from the submitted input. Uses the provided
 * name when set, otherwise the driver's default `field_dir_field_dir` naming so
 * the placeholder row matches the index the server will report.
 */
function pendingCreateFromInput(input: CreateIndexInput): PendingCreate {
    const key = input.fields.map((f) => ({ field: f.field, direction: keyDirection(f.type) }));
    const name =
        input.name && input.name.trim() !== ''
            ? input.name.trim()
            : input.fields.map((f) => `${f.field}_${keyDirection(f.type)}`).join('_');
    return {
        name,
        key,
        unique: input.unique ?? false,
        sparse: input.sparse ?? false,
        expireAfterSeconds: input.expireAfterSeconds,
        hasPartialFilter: input.partialFilterExpression !== undefined,
        hasCollation: input.collation !== undefined,
    };
}

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
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number>();
    const hasLoadedRef = useRef(false);
    const refreshGenerationRef = useRef(0);
    const [modal, setModal] = useState<ModalState>({ kind: 'none' });

    // Optimistic "Creating…" rows: shown the instant a create is submitted and
    // dropped once the real index appears in a later fetch. Merged into the
    // displayed list below.
    const [pendingCreates, setPendingCreates] = useState<ReadonlyArray<PendingCreate>>([]);

    // Bumped after a successful create to clear the drawer's form. A failed
    // create leaves it untouched so re-opening the drawer pre-populates it.
    const [createResetSignal, setCreateResetSignal] = useState(0);

    // Whether the next time the create drawer opens it should KEEP the current
    // form (rather than start fresh). Set when the user cancels (an accidental
    // close should not lose work) or when a create fails (so they can retry).
    // A successful create leaves it false, so the next open is a clean slate.
    const preserveFormRef = useRef(false);

    // Names of rows with an action in flight (delete / hide / unhide): shown
    // with a spinner instead of the ready check. The one name to scroll into
    // view when it appears is tracked separately.
    const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(() => new Set());
    const [scrollToName, setScrollToName] = useState<string | undefined>(undefined);

    const addBusy = useCallback((name: string): void => {
        setBusyNames((prev) => {
            const next = new Set(prev);
            next.add(name);
            return next;
        });
    }, []);

    const removeBusy = useCallback((name: string): void => {
        setBusyNames((prev) => {
            if (!prev.has(name)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(name);
            return next;
        });
    }, []);

    // Field suggestions (from SchemaStore) and the collection's document
    // count drive the Create Index dialog. They are pre-fetched when the
    // dialog opens and intentionally left stale afterwards.
    const [fieldSuggestions, setFieldSuggestions] = useState<ReadonlyArray<string>>([]);
    const [documentCount, setDocumentCount] = useState<number>(0);
    const [pollGeneration, setPollGeneration] = useState(0);

    /** Surface an error for a failed tRPC call, as a toast or (opt-in) a modal. */
    const showError = useCallback(
        (message: string, error: unknown, opts?: { modal?: boolean }): void => {
            const cause = error instanceof Error ? error.message : String(error);
            void trpcClient.common.displayErrorMessage.mutate({ message, modal: opts?.modal ?? false, cause });
        },
        [trpcClient],
    );

    /** Fetch the index list. Initial and manual loads show a table skeleton;
     * background reconciliation keeps the current rows visible. */
    const refresh = useCallback(
        async (source: 'background' | 'manual' = 'background'): Promise<void> => {
            const generation = ++refreshGenerationRef.current;
            const initial = !hasLoadedRef.current;
            if (initial) {
                // Clear so the skeleton (rather than stale data) shows on first load.
                setIsInitialLoading(true);
                setIndexes([]);
            } else {
                setIsRefreshing(true);
                setIsManualRefreshing(source === 'manual');
            }
            try {
                const rows = await trpcClient.mongoClusters.indexView.listIndexes.query();
                if (generation !== refreshGenerationRef.current) {
                    return;
                }
                setIndexes(rows);
                setLastUpdatedAt(Date.now());
                hasLoadedRef.current = true;
            } catch (error) {
                if (generation === refreshGenerationRef.current) {
                    showError(l10n.t('Failed to load indexes.'), error);
                }
            } finally {
                if (generation === refreshGenerationRef.current) {
                    if (initial) {
                        setIsInitialLoading(false);
                    } else {
                        setIsRefreshing(false);
                        setIsManualRefreshing(false);
                    }
                }
            }
        },
        [trpcClient, showError],
    );

    // Initial load. `refresh` is stable across renders because its only
    // dependencies (trpcClient, showError) are themselves memoised.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    /**
     * Open the Create dialog immediately, then settle its two optional
     * enhancements independently.
     *
     * Index creation NEVER depends on these prerequisites, so we must not block
     * the drawer on them:
     *  - field suggestions (autocomplete) come from the in-process SchemaStore
     *    and legitimately return an EMPTY list when sampling hasn't populated it
     *    yet — that is expected, not an error, and simply means no autocomplete.
     *  - the document count only decides whether to show the large-collection
     *    warning; it already resolves to 0 on failure.
     *
     * Settling them separately (rather than one `Promise.all` gate) means a slow
     * or failed request for one never blocks the drawer or discards the other's
     * result.
     */
    const openCreateDialog = useCallback((): void => {
        // Start each create session from a clean form unless the previous close
        // asked to preserve it (an accidental cancel, or a failed submit the
        // user can retry). A successful create leaves the flag clear, so the
        // next open is empty.
        if (!preserveFormRef.current) {
            setCreateResetSignal((n) => n + 1);
        }
        preserveFormRef.current = false;
        setModal({ kind: 'create' });
        void trpcClient.mongoClusters.indexView.getFieldSuggestions
            .query()
            .then(setFieldSuggestions)
            .catch(() => setFieldSuggestions([]));
        void trpcClient.mongoClusters.indexView.getCollectionDocumentCount
            .query()
            .then(setDocumentCount)
            .catch(() => setDocumentCount(0));
    }, [trpcClient]);

    // The list shown to the user = the real indexes plus any optimistic
    // "Creating…" rows whose index has not yet appeared in a fetch. IndexTable
    // is the sole owner of display ordering and applies whichever sort is active.
    const displayIndexes = useMemo<ReadonlyArray<IndexRow>>(() => {
        const existing = new Set(indexes.map((i) => i.name));
        const creatingRows: IndexRow[] = pendingCreates
            .filter((p) => !existing.has(p.name))
            .map((p) => ({
                name: p.name,
                key: p.key,
                hidden: false,
                unique: p.unique,
                sparse: p.sparse,
                expireAfterSeconds: p.expireAfterSeconds,
                partialFilterExpression: p.hasPartialFilter ? {} : undefined,
                collation: p.hasCollation ? {} : undefined,
                usageOps: 0,
                isDefault: false,
                statsAvailable: false,
                state: 'creating',
            }));
        return creatingRows.length > 0 ? [...indexes, ...creatingRows] : indexes;
    }, [indexes, pendingCreates]);

    // Drop optimistic rows once the real index shows up in a fetch.
    useEffect(() => {
        if (pendingCreates.length === 0) {
            return;
        }
        const existing = new Set(indexes.map((i) => i.name));
        setPendingCreates((prev) => prev.filter((p) => !existing.has(p.name)));
    }, [indexes, pendingCreates.length]);

    // While anything is building or being created, re-poll on an interval so a
    // build resolves to "ready" without the user hitting refresh. The effect
    // re-arms after each fetch and stops as soon as nothing is active.
    useEffect(() => {
        const active = displayIndexes.some((i) => i.state === 'building' || i.state === 'creating');
        if (!active) {
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            void refresh().finally(() => {
                if (!cancelled) {
                    setPollGeneration((generation) => generation + 1);
                }
            });
        }, BUILD_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [displayIndexes, pollGeneration, refresh]);

    /**
     * Submit handler for the Create Index dialog.
     *
     * The drawer closes immediately on submit — a foreground build can outlast
     * any reasonable hold, and the optimistic "Creating…" row already reflects
     * the in-flight create. The final result is handled in the background — a
     * success toast, or a modal error dialog while the form data is preserved so
     * re-opening the drawer pre-populates it.
     */
    const handleCreateSubmit = useCallback(
        async (input: CreateIndexInput): Promise<void> => {
            // Show an optimistic "Creating…" row immediately so the action feels
            // responsive while the server builds the index.
            const pending = pendingCreateFromInput(input);
            setPendingCreates((prev) => [...prev.filter((p) => p.name !== pending.name), pending]);

            const mutation = trpcClient.mongoClusters.indexView.createIndex.mutate(input);

            // Handle the eventual result independently of the drawer, which we
            // close right away below.
            void mutation.then(
                (result) => {
                    const finalName = result.indexName ?? pending.name;
                    if (result.indexName && result.indexName !== pending.name) {
                        setPendingCreates((prev) =>
                            prev.map((p) => (p.name === pending.name ? { ...p, name: result.indexName as string } : p)),
                        );
                    }
                    void trpcClient.common.displayInformationMessage.mutate({
                        message: result.indexName
                            ? l10n.t('Index "{0}" created.', result.indexName)
                            : l10n.t('Index created.'),
                    });
                    // Scroll the new index into view (if off-screen) so the user
                    // can spot it under the active sort. We do NOT refresh here
                    // — the build poll refreshes after ~5s, so the "Creating…"
                    // spinner stays visible even for a fast build, which is what
                    // actually draws the eye to the new row.
                    setScrollToName(finalName);
                    // A successful create means the next open starts fresh.
                    preserveFormRef.current = false;
                },
                (error) => {
                    // Drop the optimistic row and surface the failure in a modal.
                    // The drawer keeps its form data, so the next open is pre-filled.
                    preserveFormRef.current = true;
                    setPendingCreates((prev) => prev.filter((p) => p.name !== pending.name));
                    void refresh();
                    showError(l10n.t('Failed to create index.'), error, { modal: true });
                },
            );

            // Close the drawer immediately; the create continues in the background.
            setModal({ kind: 'none' });
        },
        [trpcClient, refresh, showError],
    );

    /** Delete an index. Confirmation happens on the extension host (modal). */
    const handleDelete = useCallback(
        async (index: IndexRow): Promise<void> => {
            const indexName = index.name;
            try {
                const result = await trpcClient.mongoClusters.indexView.dropIndex.mutate({
                    indexName,
                    sizeText: formatBytes(index.sizeBytes),
                    usageText: formatOps(index.usageOps),
                });
                if (result.cancelled) {
                    return;
                }
                // Deleting is quick; show a spinner on the doomed row and hold it
                // for a minimum window so the user registers which one is going.
                addBusy(indexName);
                await delay(MIN_ACTION_VISIBLE_MS);
                void trpcClient.common.displayInformationMessage.mutate({
                    message: l10n.t('Index "{0}" deleted.', indexName),
                });
                await refresh();
                removeBusy(indexName);
            } catch (error) {
                removeBusy(indexName);
                showError(l10n.t('Failed to delete index "{0}".', indexName), error);
            }
        },
        [trpcClient, refresh, showError, addBusy, removeBusy],
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
                // Show a spinner on the affected row and hold it for a minimum
                // window so the toggle is perceptible before the list refreshes.
                addBusy(index.name);
                await delay(MIN_ACTION_VISIBLE_MS);
                await refresh();
                removeBusy(index.name);
            } catch (error) {
                removeBusy(index.name);
                showError(
                    index.hidden
                        ? l10n.t('Failed to unhide index "{0}".', index.name)
                        : l10n.t('Failed to hide index "{0}".', index.name),
                    error,
                );
            }
        },
        [trpcClient, refresh, showError, addBusy, removeBusy],
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
                <ProgressBar thickness="large" shape="square" className="progressBar" aria-hidden={true} />
            )}

            <IndexManagementToolbar
                onCreateIndex={() => void openCreateDialog()}
                onRefreshIndexes={() => void refresh('manual')}
            />

            {/* First row: summary metric cards (mirrors the Query Insights layout). */}
            <div className="indexMetricsRowContainer">
                <IndexMetricsRow indexes={isInitialLoading || isRefreshing ? undefined : displayIndexes} />
            </div>

            {/* Filter row + details table, wrapped as a self-contained component.
                Initial and toolbar refreshes show a skeleton; background mutation
                reconciliation keeps the existing rows visible. */}
            <IndexList
                indexes={displayIndexes}
                lastUpdatedAt={lastUpdatedAt}
                isLoading={isInitialLoading || isManualRefreshing}
                busyNames={busyNames}
                scrollToName={scrollToName}
                onDelete={(idx) => void handleDelete(idx)}
                onToggleHidden={(idx) => void handleToggleHidden(idx)}
            />

            <CreateIndexDrawer
                open={modal.kind === 'create'}
                fieldSuggestions={fieldSuggestions}
                documentCount={documentCount}
                onCancel={() => {
                    // Closing without submitting preserves the form so an
                    // accidental close does not lose work; the next open keeps it.
                    preserveFormRef.current = true;
                    setModal({ kind: 'none' });
                }}
                onSubmit={handleCreateSubmit}
                onPrepareInTarget={handlePrepareInTarget}
                resetSignal={createResetSignal}
            />
        </div>
    );
};
