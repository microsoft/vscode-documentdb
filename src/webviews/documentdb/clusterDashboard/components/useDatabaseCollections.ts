/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';

import { type DatabaseCollectionsResult } from '../../../../documentdb/utils/getClusterHealth';
import {
    type ConnectionUnavailableDetails,
    isConnectionUnavailableResponse,
} from '../../../_integration/connectionUnavailable';
import { useTrpcClient } from '../../../_integration/useTrpcClient';

export interface DatabaseCollectionsState {
    /** `null` while the request for the current database is still outstanding. */
    result: DatabaseCollectionsResult | null;
    /** Time when the current database's collections were last read successfully. */
    lastUpdatedAt?: number;
    isLoading: boolean;
    /** True only when the table should be replaced by its skeleton. */
    isTableLoading: boolean;
    error: string | null;
    reload: (source?: 'background' | 'manual') => void;
}

/**
 * The collections of the database the inventory has drilled into, or nothing at the top level.
 *
 * Loaded on drill-in rather than with the storage stats: `collStats` is one round trip per
 * collection, and paying for every database's collections up front would make the dashboard's
 * first paint hostage to the largest cluster it is pointed at.
 *
 * Not cached across visits. A second look at a database is usually a second look *because*
 * something changed, and a cache would answer it with the figures from the first.
 */
export function useDatabaseCollections(
    databaseName: string | null,
    isSubmissionBlocked: () => boolean,
    startOperation: () => number | undefined,
    isOperationCurrent: (revision: number) => boolean,
    onUnavailable: (unavailable: ConnectionUnavailableDetails) => void,
): DatabaseCollectionsState {
    // Bumped by `reload` so a refresh re-runs the effect for the same database. Background
    // reconciliation preserves the current rows; an explicit manual refresh shows a skeleton.
    const [request, setRequest] = useState<{ attempt: number; source: 'background' | 'manual' }>({
        attempt: 0,
        source: 'background',
    });
    const [entry, setEntry] = useState<{
        key: string;
        databaseName: string;
        result: DatabaseCollectionsResult | null;
        lastUpdatedAt?: number;
        error: string | null;
    } | null>(null);

    const trpcClient = useTrpcClient();
    const key = `${request.attempt}\u0000${databaseName ?? ''}`;
    const abandonedKeys = useRef(new Set<string>());
    const blocked = isSubmissionBlocked();
    if (blocked) {
        abandonedKeys.current.add(key);
    }

    useEffect(() => {
        const revision = startOperation();
        if (databaseName === null || revision === undefined) {
            return;
        }

        let disposed = false;

        // State is written only from the callbacks: `isLoading` below is derived from the key
        // instead, so entering a database does not cost a render just to raise a flag.
        trpcClient.clusterDashboard.getDatabaseCollections
            .query({ databaseName, loadReason: request.source })
            .then((result) => {
                if (!disposed && isOperationCurrent(revision)) {
                    if (isConnectionUnavailableResponse(result)) {
                        onUnavailable(result.unavailable);
                        return;
                    }
                    setEntry({ key, databaseName, result, lastUpdatedAt: Date.now(), error: null });
                }
            })
            .catch((reason: unknown) => {
                if (!disposed && isOperationCurrent(revision)) {
                    setEntry((current) => ({
                        key,
                        databaseName,
                        result: current?.databaseName === databaseName ? current.result : null,
                        lastUpdatedAt: current?.databaseName === databaseName ? current.lastUpdatedAt : undefined,
                        error: reason instanceof Error ? reason.message : String(reason),
                    }));
                }
            });

        return () => {
            // Leaving a database abandons its answer rather than letting it land in the next
            // one's table.
            disposed = true;
        };
    }, [databaseName, isOperationCurrent, key, onUnavailable, request.source, startOperation, trpcClient]);

    const reload = useCallback((source: 'background' | 'manual' = 'background'): void => {
        if (isSubmissionBlocked()) {
            return;
        }
        setRequest((current) => ({ attempt: current.attempt + 1, source }));
    }, [isSubmissionBlocked]);

    const isCurrent = entry !== null && entry.key === key;
    const isSameDatabase = entry !== null && entry.databaseName === databaseName;
    const isLoading = databaseName !== null && !isCurrent && !abandonedKeys.current.has(key);
    const wasAbandoned = abandonedKeys.current.has(key);

    return {
        result: isSameDatabase ? entry.result : null,
        lastUpdatedAt: isSameDatabase ? entry.lastUpdatedAt : undefined,
        isLoading,
        isTableLoading:
            databaseName !== null &&
            ((!isSameDatabase && !wasAbandoned) || (isLoading && request.source === 'manual')),
        error: isCurrent ? entry.error : null,
        reload,
    };
}
