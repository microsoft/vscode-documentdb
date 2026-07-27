/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';

export interface StorageTabProps {
    storageStats: ClusterStorageStats | null;
    isRefreshing: boolean;
    onRefresh: () => void;
}

export const StorageTab = ({ storageStats, isRefreshing, onRefresh }: StorageTabProps): JSX.Element => {
    if (storageStats === null) {
        return (
            <div className="tabPanel">
                <Spinner size="small" label={l10n.t('Loading storage statistics…')} />
            </div>
        );
    }

    // The relative bar is scaled against the largest database so small ones stay visible.
    const largestDatabaseBytes = storageStats.databases.reduce(
        (largest, database) => Math.max(largest, database.sizeOnDiskBytes ?? 0),
        0,
    );

    return (
        <div className="tabPanel">
            <div className="tabToolbar">
                <Button
                    appearance="subtle"
                    icon={<ArrowClockwiseRegular />}
                    disabled={isRefreshing}
                    onClick={onRefresh}
                    aria-label={l10n.t('Refresh storage statistics')}
                >
                    {l10n.t('Refresh')}
                </Button>
                {isRefreshing && <Spinner size="tiny" aria-label={l10n.t('Refreshing…')} />}
            </div>

            {storageStats.databases.length === 0 ? (
                <div className="emptyState">{l10n.t('No user databases were reported for this cluster.')}</div>
            ) : (
                <Table size="small" aria-label={l10n.t('Storage per database')}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell>{l10n.t('Database')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Size on disk')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Data')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Indexes')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Collections')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Documents')}</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {storageStats.databases.map((database) => {
                            const sizePercentage =
                                largestDatabaseBytes > 0
                                    ? ((database.sizeOnDiskBytes ?? 0) / largestDatabaseBytes) * 100
                                    : 0;

                            return (
                                <TableRow key={database.name}>
                                    <TableCell>{database.name}</TableCell>
                                    <TableCell>
                                        <div className="storageSizeCell">
                                            <span>{formatBytes(database.sizeOnDiskBytes)}</span>
                                            <div className="storageBarTrack" aria-hidden="true">
                                                <div
                                                    className="storageBarFill"
                                                    style={{ width: `${sizePercentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatBytes(database.dataSizeBytes)}</TableCell>
                                    <TableCell>{formatBytes(database.indexSizeBytes)}</TableCell>
                                    <TableCell>
                                        {database.collections === null ? '—' : formatCount(database.collections)}
                                    </TableCell>
                                    <TableCell>
                                        {database.objects === null ? '—' : formatCount(database.objects)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        <TableRow className="storageTotalRow">
                            <TableCell>{l10n.t('Total')}</TableCell>
                            <TableCell>{formatBytes(storageStats.totalSizeBytes)}</TableCell>
                            <TableCell />
                            <TableCell />
                            <TableCell />
                            <TableCell />
                        </TableRow>
                    </TableBody>
                </Table>
            )}
        </div>
    );
};
