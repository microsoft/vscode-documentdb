/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    MessageBar,
    MessageBarBody,
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

import { type CurrentOpEntry, type CurrentOpScope } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { Announcer } from '../../../components/accessibility';

export interface OperationsTabProps {
    /** Polling cadence inherited from the panel configuration. */
    refreshIntervalMs: number;
}

/**
 * Renders the per-row Kill button, explaining any reason it is unavailable.
 *
 * A disabled Fluent button emits no pointer events, so the tooltip is anchored on a
 * wrapping span — without it the explanation would be unreachable, which is the whole point
 * of showing one.
 *
 * `canKillOperations` is deliberately three-valued: `false` disables with an explanation,
 * while `null` (the server did not report privileges) leaves the button enabled and lets
 * the server refuse. Disabling on "unknown" would block an action that works.
 */
function renderKillButton(
    operation: CurrentOpEntry,
    killingOpid: string | null,
    canKillOperations: boolean | null,
    onKill: () => void,
): JSX.Element {
    const missingPrivilege = canKillOperations === false;
    const button = (
        <Button
            appearance="subtle"
            size="small"
            icon={<DismissCircleRegular />}
            disabled={operation.opid === '' || killingOpid !== null || missingPrivilege}
            onClick={onKill}
            aria-label={l10n.t('Kill operation {opid}', { opid: operation.opid })}
        >
            {l10n.t('Kill')}
        </Button>
    );

    if (!missingPrivilege) {
        return button;
    }

    return (
        <Tooltip
            content={l10n.t('Terminating operations requires the "killOp" privilege, which this account lacks.')}
            relationship="description"
        >
            <span>{button}</span>
        </Tooltip>
    );
}

export const OperationsTab = ({ refreshIntervalMs }: OperationsTabProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const [operations, setOperations] = useState<CurrentOpEntry[] | null>(null);
    const [scope, setScope] = useState<CurrentOpScope>('all');
    const [serverErrors, setServerErrors] = useState<string[]>([]);
    /** `null` until known, and left `null` when the server does not report privileges. */
    const [canKillOperations, setCanKillOperations] = useState<boolean | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [killingOpid, setKillingOpid] = useState<string | null>(null);

    const disposedRef = useRef(false);
    /**
     * Prevents overlapping polls. A slow or unreachable cluster can take far longer to
     * answer than the refresh interval, and without this the interval stacks requests
     * faster than they drain.
     */
    const inFlightRef = useRef(false);

    const loadOperations = useCallback(async (): Promise<void> => {
        if (inFlightRef.current) {
            return;
        }
        inFlightRef.current = true;

        try {
            const result = await trpcClient.clusterDashboard.getCurrentOperations.query();
            if (disposedRef.current) {
                return;
            }
            setOperations(result.operations);
            setScope(result.scope);
            setServerErrors(result.errors);
            setLoadError(null);
        } catch (error) {
            if (!disposedRef.current) {
                // Surface the failure instead of leaving the first load stuck on a spinner
                // with the Refresh button unreachable.
                setLoadError(error instanceof Error ? error.message : String(error));
                setOperations((previous) => previous ?? []);
            }
        } finally {
            inFlightRef.current = false;
        }
    }, [trpcClient]);

    useEffect(() => {
        // Read once per mount rather than on the poll: privileges do not change within a
        // session, and a failure here must not disturb the operations list.
        void trpcClient.clusterDashboard.getPrivileges
            .query()
            .then((privileges) => {
                if (!disposedRef.current) {
                    setCanKillOperations(privileges.canKillOperations);
                }
            })
            .catch(() => {
                // Deliberately silent, and deliberately leaves the state `null`: an
                // unanswered privilege probe means "unknown", so Kill stays enabled and the
                // server gets to decide.
            });
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
                    opidIsNumeric: operation.opidIsNumeric,
                    namespace: operation.namespace,
                });

                if (result.outcome === 'failed') {
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('The server did not accept the request to kill operation "{opid}".', {
                            opid: operation.opid,
                        }),
                        modal: false,
                        cause: '',
                    });
                }

                if (result.outcome !== 'cancelled') {
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

    const toolbar = (
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
    );

    if (operations === null) {
        return (
            <div className="tabPanel">
                {toolbar}
                <Spinner size="small" label={l10n.t('Loading operations…')} />
            </div>
        );
    }

    return (
        <div className="tabPanel">
            <Announcer
                when={operations.length > 0}
                message={
                    operations.length === 1
                        ? l10n.t('{countOne} operation is running.', { countOne: operations.length })
                        : l10n.t('{countMany} operations are running.', { countMany: operations.length })
                }
            />

            {toolbar}

            {loadError !== null && (
                <MessageBar intent="error">
                    <MessageBarBody>
                        {l10n.t('Could not read running operations: {reason}', { reason: loadError })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {scope === 'own' && (
                // The list is real but partial: without the `inprog` privilege the server
                // only reports the signed-in user's operations. Saying so is the difference
                // between a narrowed list and a wrong one.
                <MessageBar intent="info">
                    <MessageBarBody>
                        {l10n.t(
                            'Showing only your own operations. Listing every user’s operations requires the "inprog" privilege on this cluster.',
                        )}
                    </MessageBarBody>
                </MessageBar>
            )}

            {operations.length === 0 ? (
                <div className="emptyState">
                    {serverErrors.length > 0
                        ? l10n.t(
                              'Running operations could not be read from this cluster ({reason}). The signed-in user may lack the permission required to list operations.',
                              { reason: serverErrors.join('; ') },
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
                        {operations.map((operation, index) => (
                            // `opid` alone is not a safe key: `mapCurrentOp` yields '' for
                            // any entry whose opid the server omitted, which collides.
                            <TableRow key={`${operation.opid}:${index}`}>
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
                                    {renderKillButton(
                                        operation,
                                        killingOpid,
                                        canKillOperations,
                                        () => void handleKill(operation),
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
};
