/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    MessageBar,
    MessageBarBody,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Tooltip,
} from '@fluentui/react-components';
import { OpenRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useState, type JSX } from 'react';

import { type DatabaseCollectionsResult } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { formatCount } from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';
import { RelativeSize } from './RelativeSize';

export interface CollectionsPanelProps {
    databaseName: string;
}

/**
 * The collections inside one database, loaded when its row is expanded.
 *
 * This is the answer to "how do I learn more about a database?": the storage table names
 * databases and stops, which leaves the reader with a number and nowhere to go. Every row
 * here opens the Collection View for that namespace, so the dashboard hands off to the tool
 * that already exists for reading data instead of growing a second one.
 *
 * Loaded on expand rather than with the storage stats: `collStats` is one round trip per
 * collection, and paying for every database's collections up front would make the dashboard's
 * first paint hostage to the largest cluster it is pointed at.
 */
export const CollectionsPanel = ({ databaseName }: CollectionsPanelProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const [result, setResult] = useState<DatabaseCollectionsResult | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // No state reset on the way in: the panel is mounted inside a row keyed by the database
    // name, so an instance sees exactly one `databaseName` for its whole life. Clearing the
    // previous result here would only be a cascading render.
    useEffect(() => {
        let disposed = false;

        trpcClient.clusterDashboard.getDatabaseCollections
            .query({ databaseName })
            .then((collections) => {
                if (!disposed) {
                    setResult(collections);
                }
            })
            .catch((error: unknown) => {
                if (!disposed) {
                    setLoadError(error instanceof Error ? error.message : String(error));
                }
            });

        return () => {
            disposed = true;
        };
    }, [databaseName, trpcClient]);

    const openCollection = (collectionName: string): void => {
        void trpcClient.clusterDashboard.openNamespace
            .mutate({ namespace: `${databaseName}.${collectionName}` })
            .catch((error: unknown) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to open the collection view.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    };

    if (loadError !== null) {
        return (
            <Card className="collectionsPanel" appearance="subtle">
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('Could not list the collections of "{database}": {reason}', {
                            database: databaseName,
                            reason: loadError,
                        })}
                    </MessageBarBody>
                </MessageBar>
            </Card>
        );
    }

    if (result === null) {
        return (
            <Card className="collectionsPanel" appearance="subtle">
                <Spinner size="tiny" label={l10n.t('Loading collections…')} />
            </Card>
        );
    }

    // Scaled against the largest collection in *this* database, not the cluster: the bar
    // answers "which collection dominates this database", which is the question a reader who
    // just expanded one row is asking.
    const largestBytes = result.collections.reduce(
        (largest, collection) => Math.max(largest, collection.storageSizeBytes ?? collection.dataSizeBytes ?? 0),
        0,
    );

    return (
        <Card className="collectionsPanel" appearance="subtle">
            {result.errors.length > 0 && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('Some collection statistics could not be read: {reason}', {
                            reason: result.errors.join('; '),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {result.omittedCollectionCount > 0 && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        {l10n.t('Showing the first {shown} collections; {omitted} more are not listed.', {
                            shown: String(result.collections.length),
                            omitted: String(result.omittedCollectionCount),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {result.collections.length === 0 ? (
                <div className="emptyState">
                    {l10n.t('"{database}" holds no collections.', { database: databaseName })}
                </div>
            ) : (
                <div className="tableScroller">
                    <Table
                        size="extra-small"
                        className="collectionsTable"
                        aria-label={l10n.t('Collections in {database}', { database: databaseName })}
                    >
                        {/* Same fixed-width discipline as the databases table above it: only the
                        collection name absorbs slack, and it clips rather than overrunning
                        the figures beside it. */}
                        <colgroup>
                            <col className="colCollectionName" />
                            <col className="colSize" />
                            <col className="colNumber" />
                            <col className="colIndexes" />
                            <col className="colOpen" />
                        </colgroup>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{l10n.t('Collection')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Size')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Documents')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Indexes / Size')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Open')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {result.collections.map((collection) => {
                                const sizeBytes = collection.storageSizeBytes ?? collection.dataSizeBytes;
                                const isView = collection.type === 'view';

                                return (
                                    <TableRow key={collection.name}>
                                        <TableCell>
                                            <TableCellLayout truncate title={collection.name}>
                                                {collection.name}
                                            </TableCellLayout>
                                        </TableCell>
                                        <TableCell>
                                            {isView ? (
                                                // A view stores nothing; the dash is the honest figure.
                                                <span className="mutedCell">{l10n.t('View')}</span>
                                            ) : (
                                                <RelativeSize value={sizeBytes} maximum={largestBytes} />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className="numberCell">
                                                {collection.documents === null
                                                    ? '—'
                                                    : formatCount(collection.documents)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="numberCell">
                                                {collection.indexes === null
                                                    ? '—'
                                                    : l10n.t('{count} / {size}', {
                                                          count: String(collection.indexes),
                                                          size: formatBytes(collection.indexSizeBytes),
                                                      })}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip
                                                content={l10n.t('Open {database}.{collection}', {
                                                    database: databaseName,
                                                    collection: collection.name,
                                                })}
                                                relationship="description"
                                                withArrow
                                            >
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<OpenRegular />}
                                                    aria-label={l10n.t('Open {database}.{collection}', {
                                                        database: databaseName,
                                                        collection: collection.name,
                                                    })}
                                                    onClick={() => openCollection(collection.name)}
                                                />
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </Card>
    );
};
