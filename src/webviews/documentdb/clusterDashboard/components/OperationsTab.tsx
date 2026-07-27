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
    Tooltip,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, DismissCircleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { type CurrentOpEntry } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { Announcer } from '../../../components/accessibility';

export interface OperationsTabProps {
    /** Polling cadence inherited from the panel configuration. */
    refreshIntervalMs: number;
}

export const OperationsTab = ({ refreshIntervalMs }: OperationsTabProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const [operations, setOperations] = useState<CurrentOpEntry[] | null>(null);
    const [unsupported, setUnsupported] = useState(false);
    const [killingOpid, setKillingOpid] = useState<string | null>(null);

    // The polling loop lives in a ref-guarded closure so a refresh triggered by the Kill
    // button and the interval tick can never both write a stale result after unmount.
    const disposedRef = useRef(false);

    const loadOperations = useCallback(async (): Promise<void> => {
        try {
            const result = await trpcClient.clusterDashboard.getCurrentOperations.query();
            if (disposedRef.current) {
                return;
            }
            setOperations(result.operations);
            setUnsupported(result.errors.length > 0);
        } catch {
            // Polling failures are silent by design: the table keeps the last known rows.
        }
    }, [trpcClient]);

    useEffect(() => {
        disposedRef.current = false;
        void loadOperations();

        const intervalId = setInterval(() => void loadOperations(), refreshIntervalMs);

        return () => {
            disposedRef.current = true;
            clearInterval(intervalId);
        };
    }, [loadOperations, refreshIntervalMs]);

    const handleKill = useCallback(
        async (operation: CurrentOpEntry): Promise<void> => {
            setKillingOpid(operation.opid);
            try {
                const result = await trpcClient.clusterDashboard.killOperation.mutate({
                    opid: operation.opid,
                    namespace: operation.namespace,
                });

                if (result.killed) {
                    await loadOperations();
                }
            } catch (error) {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to kill the operation.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            } finally {
                setKillingOpid(null);
            }
        },
        [loadOperations, trpcClient],
    );

    if (operations === null) {
        return (
            <div className="tabPanel">
                <Spinner size="small" label={l10n.t('Loading operations…')} />
            </div>
        );
    }

    return (
        <div className="tabPanel">
            <Announcer
                when={operations.length > 0}
                message={l10n.t('{count} operations are running.', { count: operations.length })}
            />

            <div className="tabToolbar">
                <Button
                    appearance="subtle"
                    icon={<ArrowClockwiseRegular />}
                    onClick={() => void loadOperations()}
                    aria-label={l10n.t('Refresh the list of running operations')}
                >
                    {l10n.t('Refresh')}
                </Button>
            </div>

            {operations.length === 0 ? (
                <div className="emptyState">
                    {unsupported
                        ? l10n.t(
                              'Running operations could not be read from this cluster. The signed-in user may lack the permission required to list operations.',
                          )
                        : l10n.t('No operations are currently running.')}
                </div>
            ) : (
                <Table size="small" aria-label={l10n.t('Running operations')}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell>{l10n.t('Operation ID')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Type')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Namespace')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Running (s)')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Active')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Client')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Actions')}</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {operations.map((operation) => (
                            <TableRow key={operation.opid}>
                                <TableCell>{operation.opid || '—'}</TableCell>
                                <TableCell>{operation.type}</TableCell>
                                <TableCell>
                                    <Tooltip
                                        content={operation.commandPreview || l10n.t('No command details reported.')}
                                        relationship="description"
                                    >
                                        <span>{operation.namespace || '—'}</span>
                                    </Tooltip>
                                </TableCell>
                                <TableCell>{operation.secsRunning ?? '—'}</TableCell>
                                <TableCell>{operation.active ? l10n.t('Yes') : l10n.t('No')}</TableCell>
                                <TableCell>{operation.clientDescription ?? '—'}</TableCell>
                                <TableCell>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<DismissCircleRegular />}
                                        disabled={operation.opid === '' || killingOpid !== null}
                                        onClick={() => void handleKill(operation)}
                                        aria-label={l10n.t('Kill operation {opid}', { opid: operation.opid })}
                                    >
                                        {l10n.t('Kill')}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
};
