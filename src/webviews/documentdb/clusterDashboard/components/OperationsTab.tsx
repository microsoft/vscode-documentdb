/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
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
import {
    ArrowClockwiseRegular,
    CopyRegular,
    DeleteRegular,
    DismissCircleRegular,
    OpenRegular,
    SparkleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { type CurrentOpEntry, type CurrentOpScope } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { Announcer } from '../../../components/accessibility';
import { type KillOperationResult } from '../clusterDashboardRouter';
import { type IdentifiedOperation, type ObservedOperation } from '../operationHistory';

export interface OperationsTabProps {
    /** Polling cadence inherited from the panel configuration. */
    refreshIntervalMs: number;
}

/** `true` when a namespace names a collection, i.e. can be opened. */
function isCollectionNamespace(namespace: string): boolean {
    const separatorIndex = namespace.indexOf('.');

    return separatorIndex > 0 && separatorIndex < namespace.length - 1;
}

/**
 * A cell whose value is truncated on screen but must stay reachable.
 *
 * The tooltip is anchored on a focusable element: a tooltip on a plain `<span>` renders on
 * hover only, so keyboard and screen-reader users get no route to text the ellipsis has
 * hidden. `tabIndex={0}` puts it in the tab order and makes the Fluent tooltip open on focus
 * as well as hover.
 *
 * The tooltip's `relationship` is chosen from what the tooltip actually carries, because the
 * two cases need different accessible names:
 *
 * - When the tooltip only reveals the value the ellipsis clipped (or the visible text is a
 *   placeholder), it *is* the cell's name, so `label` is correct.
 * - When it adds separate information — the Namespace cell anchors the command preview — it
 *   must not replace the name, or the cell announces the command instead of the namespace.
 *   `description` keeps the visible text as the accessible name and offers the preview after
 *   it.
 *
 * The element deliberately carries no `role`: it is focusable so the tooltip can be reached,
 * not actionable, and claiming `button` would promise assistive-technology users an action
 * that does not exist.
 */
function TruncatedCell({
    value,
    tooltip,
    className,
    emptyPlaceholder = '—',
}: {
    value: string;
    /** Tooltip text; defaults to the value itself. */
    tooltip?: string;
    className: string;
    emptyPlaceholder?: string;
}): JSX.Element {
    if (value === '' && tooltip === undefined) {
        return <span className={className}>{emptyPlaceholder}</span>;
    }

    const content = tooltip ?? value;
    const tooltipIsTheName = value === '' || tooltip === undefined || tooltip === value;

    return (
        <Tooltip content={content} relationship={tooltipIsTheName ? 'label' : 'description'} withArrow>
            {/* Focusable so the tooltip is reachable without a pointer, but not actionable, so it
                carries no role. Matches the Query Insights summary card, which suppresses the same
                rule for the same reason (`summaryCard/CellBase.tsx`). */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <span className={className} tabIndex={0}>
                {value === '' ? emptyPlaceholder : value}
            </span>
        </Tooltip>
    );
}

/**
 * Renders an operation id, truncated with the full value reachable.
 *
 * Azure DocumentDB (vCore) reports ids like `10000053116:1785197164497492` — 28 characters
 * that, in a `flex: 1` table cell, push every following column off its heading. Monospaced
 * so the digits line up down the column.
 */
function OperationIdCell({ opid }: { opid: string }): JSX.Element {
    if (opid === '') {
        return <span className="opidValue">—</span>;
    }

    return <TruncatedCell value={opid} className="opidValue" />;
}

/** Renders a `lastSeenMs` timestamp as a short "how long ago" label. */
function formatSeenAgo(lastSeenMs: number, nowMs: number): string {
    const secondsAgo = Math.max(0, Math.round((nowMs - lastSeenMs) / 1000));

    if (secondsAgo < 60) {
        return l10n.t('{seconds}s ago', { seconds: secondsAgo });
    }

    return l10n.t('{minutes}m ago', { minutes: Math.round(secondsAgo / 60) });
}

/**
 * The screen-reader announcement for a kill attempt.
 *
 * Every outcome gets its own sentence: the announcement is the only feedback a screen-reader
 * user gets for a destructive action, so "could not confirm" must not be read out as "the
 * server refused" — one says nothing happened and why, the other says the server rejected it.
 */
function describeKillOutcome(outcome: KillOperationResult['outcome'], opid: string): string {
    switch (outcome) {
        case 'requested':
            return l10n.t('Kill request sent for operation {opid}.', { opid });
        case 'gone':
            return l10n.t('Operation {opid} is no longer running.', { opid });
        case 'unverified':
            return l10n.t('Could not confirm that operation {opid} is still running. Nothing was killed.', { opid });
        default:
            return l10n.t('The server did not accept the request to kill operation {opid}.', { opid });
    }
}

export const OperationsTab = ({ refreshIntervalMs }: OperationsTabProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const [operations, setOperations] = useState<IdentifiedOperation[] | null>(null);
    const [history, setHistory] = useState<ObservedOperation[]>([]);
    /**
     * Reference point for the history's "seen N ago" column, refreshed with each poll.
     * Host and webview run on the same machine, so the host-stamped `lastSeenMs` values are
     * directly comparable to this.
     */
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const [scope, setScope] = useState<CurrentOpScope>('all');
    const [serverErrors, setServerErrors] = useState<string[]>([]);
    /** `null` until known, and left `null` when the server does not report privileges. */
    const [canKillOperations, setCanKillOperations] = useState<boolean | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [killingOpid, setKillingOpid] = useState<string | null>(null);
    /**
     * Outcome of the last row action, announced to assistive technology.
     *
     * Kill and Clear history change the table but say nothing a screen reader can hear —
     * the confirmation toast is a host notification outside this document.
     */
    const [actionAnnouncement, setActionAnnouncement] = useState<string>('');

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
            setHistory(result.history);
            setNowMs(Date.now());
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
        async (operation: IdentifiedOperation): Promise<void> => {
            setKillingOpid(operation.opid);
            try {
                const result = await trpcClient.clusterDashboard.killOperation.mutate({
                    opid: operation.opid,
                    opidIsNumeric: operation.opidIsNumeric,
                    namespace: operation.namespace,
                    occurrenceId: operation.occurrenceId,
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
                    setActionAnnouncement(describeKillOutcome(result.outcome, operation.opid));
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

    const handleCopyCommand = useCallback(
        async (operation: CurrentOpEntry | ObservedOperation): Promise<void> => {
            try {
                await trpcClient.clusterDashboard.copyCommand.mutate({ command: operation.commandPreview });
            } catch (error) {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to copy the command.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [trpcClient],
    );

    const handleOpenNamespace = useCallback(
        async (namespace: string): Promise<void> => {
            try {
                await trpcClient.clusterDashboard.openNamespace.mutate({ namespace });
            } catch (error) {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to open the collection.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [trpcClient],
    );

    const handleAskCopilot = useCallback(
        async (operation: CurrentOpEntry | ObservedOperation): Promise<void> => {
            // Live rows and history rows carry their runtime under different names; the
            // prompt only cares about the longest figure either can offer.
            const isHistoryEntry = 'longestSecsRunning' in operation;
            try {
                await trpcClient.clusterDashboard.askCopilotAboutOperation.mutate({
                    opid: operation.opid,
                    type: operation.type,
                    namespace: operation.namespace,
                    commandPreview: operation.commandPreview,
                    secsRunning: isHistoryEntry ? operation.longestSecsRunning : operation.secsRunning,
                    clientDescription: operation.clientDescription,
                    ended: isHistoryEntry ? operation.ended : false,
                });
            } catch (error) {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to ask Copilot about the operation.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [trpcClient],
    );

    const handleClearHistory = useCallback(async (): Promise<void> => {
        try {
            await trpcClient.clusterDashboard.clearOperationHistory.mutate();
            if (!disposedRef.current) {
                setHistory([]);
                setActionAnnouncement(l10n.t('Operation history cleared.'));
            }
        } catch (error) {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to clear the operation history.'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
    }, [trpcClient]);

    /**
     * Per-row action menu.
     *
     * The reason Kill is unavailable is put in the item's own label rather than a tooltip:
     * a disabled menu item emits no pointer events, so an attached tooltip would be
     * unreachable — and an unexplained disabled action is worse than no action.
     */
    const renderRowActions = useCallback(
        (operation: IdentifiedOperation): JSX.Element => {
            const missingPrivilege = canKillOperations === false;

            return (
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <MenuButton
                            appearance="subtle"
                            size="small"
                            aria-label={l10n.t('Actions for operation {opid}', { opid: operation.opid || '—' })}
                        >
                            {l10n.t('Actions')}
                        </MenuButton>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem
                                icon={<DismissCircleRegular />}
                                disabled={operation.opid === '' || killingOpid !== null || missingPrivilege}
                                onClick={() => void handleKill(operation)}
                            >
                                {missingPrivilege
                                    ? l10n.t('Kill (requires the "killOp" privilege)')
                                    : l10n.t('Kill operation')}
                            </MenuItem>
                            <MenuItem icon={<SparkleRegular />} onClick={() => void handleAskCopilot(operation)}>
                                {l10n.t('Ask Copilot')}
                            </MenuItem>
                            <MenuItem
                                icon={<CopyRegular />}
                                disabled={operation.commandPreview === ''}
                                onClick={() => void handleCopyCommand(operation)}
                            >
                                {l10n.t('Copy command')}
                            </MenuItem>
                            <MenuItem
                                icon={<OpenRegular />}
                                disabled={!isCollectionNamespace(operation.namespace)}
                                onClick={() => void handleOpenNamespace(operation.namespace)}
                            >
                                {l10n.t('Open collection')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            );
        },
        [canKillOperations, handleAskCopilot, handleCopyCommand, handleKill, handleOpenNamespace, killingOpid],
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

            {/* Kill and Clear history are otherwise silent: their confirmation toast is a
                host notification, outside this document and unreachable from here. */}
            <Announcer when={actionAnnouncement !== ''} message={actionAnnouncement} />

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
                <Table size="small" className="operationsTable" aria-label={l10n.t('Running operations')}>
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell className="opidColumn">{l10n.t('Operation ID')}</TableHeaderCell>
                            <TableHeaderCell className="narrowColumn">{l10n.t('Type')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Namespace')}</TableHeaderCell>
                            <TableHeaderCell className="narrowColumn">{l10n.t('Running (s)')}</TableHeaderCell>
                            <TableHeaderCell className="narrowColumn">{l10n.t('Active')}</TableHeaderCell>
                            <TableHeaderCell>{l10n.t('Client')}</TableHeaderCell>
                            <TableHeaderCell className="actionsColumn">{l10n.t('Actions')}</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {operations.map((operation, index) => (
                            // Keyed by the host-assigned occurrence, not by opid. A stable key
                            // keeps a row's identity across the 5 s re-render, which is what
                            // stops an open Actions menu snapping shut — but keying on opid
                            // made that a liability: when the server reissued an id, React
                            // kept the row and its open menu and quietly repointed the kill
                            // action at a different operation. The occurrence changes when the
                            // id is reused, so the row remounts and the menu closes, which is
                            // the correct outcome. The index remains the fallback for rows the
                            // server did not identify at all.
                            <TableRow
                                key={operation.occurrenceId === '' ? `unidentified:${index}` : operation.occurrenceId}
                            >
                                <TableCell className="opidColumn">
                                    <OperationIdCell opid={operation.opid} />
                                </TableCell>
                                <TableCell className="narrowColumn">{operation.type}</TableCell>
                                <TableCell>
                                    <TruncatedCell
                                        value={operation.namespace}
                                        tooltip={operation.commandPreview || l10n.t('No command details reported.')}
                                        className="truncatedValue"
                                    />
                                </TableCell>
                                <TableCell className="narrowColumn">{operation.secsRunning ?? '—'}</TableCell>
                                <TableCell className="narrowColumn">
                                    {operation.active ? l10n.t('Yes') : l10n.t('No')}
                                </TableCell>
                                <TableCell>
                                    <TruncatedCell
                                        value={operation.clientDescription ?? ''}
                                        className="truncatedValue"
                                    />
                                </TableCell>
                                <TableCell className="actionsColumn">{renderRowActions(operation)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}

            {history.length > 0 && (
                // Collapsed by default: the running table answers the primary question, and
                // this answers the one people ask second — "what has run since I opened
                // this?" — which a snapshot alone cannot.
                <Accordion collapsible className="operationHistory">
                    <AccordionItem value="history">
                        <AccordionHeader>
                            {l10n.t('Recently seen operations ({count})', { count: history.length })}
                        </AccordionHeader>
                        <AccordionPanel>
                            <div className="tabToolbar">
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<DeleteRegular />}
                                    onClick={() => void handleClearHistory()}
                                >
                                    {l10n.t('Clear history')}
                                </Button>
                            </div>

                            <MessageBar intent="info">
                                <MessageBarBody>
                                    {l10n.t(
                                        'Operations seen by this dashboard since it was opened. Anything that started and finished between two refreshes never appears here.',
                                    )}
                                </MessageBarBody>
                            </MessageBar>

                            <Table
                                size="small"
                                className="operationsTable"
                                aria-label={l10n.t('Recently seen operations')}
                            >
                                <TableHeader>
                                    <TableRow>
                                        <TableHeaderCell className="opidColumn">
                                            {l10n.t('Operation ID')}
                                        </TableHeaderCell>
                                        <TableHeaderCell className="narrowColumn">{l10n.t('Type')}</TableHeaderCell>
                                        <TableHeaderCell>{l10n.t('Namespace')}</TableHeaderCell>
                                        <TableHeaderCell className="narrowColumn">
                                            {l10n.t('Longest (s)')}
                                        </TableHeaderCell>
                                        <TableHeaderCell className="narrowColumn">{l10n.t('Seen')}</TableHeaderCell>
                                        <TableHeaderCell className="narrowColumn">{l10n.t('Status')}</TableHeaderCell>
                                        <TableHeaderCell className="actionsColumn">{l10n.t('Actions')}</TableHeaderCell>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map((entry) => (
                                        // No index in the key: the list re-sorts by last
                                        // sighting on every poll, so an index component
                                        // would remount rows and close any open menu.
                                        // opid + namespace + firstSeen is unique — two
                                        // sightings that share all three were merged into
                                        // one entry by `recordObservedOperations`.
                                        <TableRow key={`${entry.opid}:${entry.namespace}:${entry.firstSeenMs}`}>
                                            <TableCell className="opidColumn">
                                                <OperationIdCell opid={entry.opid} />
                                            </TableCell>
                                            <TableCell className="narrowColumn">{entry.type}</TableCell>
                                            <TableCell>
                                                <TruncatedCell
                                                    value={entry.namespace}
                                                    tooltip={
                                                        entry.commandPreview || l10n.t('No command details reported.')
                                                    }
                                                    className="truncatedValue"
                                                />
                                            </TableCell>
                                            <TableCell className="narrowColumn">
                                                {entry.longestSecsRunning ?? '—'}
                                            </TableCell>
                                            <TableCell className="narrowColumn">
                                                {formatSeenAgo(entry.lastSeenMs, nowMs)}
                                            </TableCell>
                                            <TableCell className="narrowColumn">
                                                <Badge
                                                    appearance="tint"
                                                    color={entry.ended ? 'informative' : 'success'}
                                                >
                                                    {entry.ended ? l10n.t('Ended') : l10n.t('Running')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="actionsColumn">
                                                <Menu>
                                                    <MenuTrigger disableButtonEnhancement>
                                                        <MenuButton
                                                            appearance="subtle"
                                                            size="small"
                                                            aria-label={l10n.t('Actions for operation {opid}', {
                                                                opid: entry.opid,
                                                            })}
                                                        >
                                                            {l10n.t('Actions')}
                                                        </MenuButton>
                                                    </MenuTrigger>
                                                    <MenuPopover>
                                                        <MenuList>
                                                            <MenuItem
                                                                icon={<SparkleRegular />}
                                                                onClick={() => void handleAskCopilot(entry)}
                                                            >
                                                                {l10n.t('Ask Copilot')}
                                                            </MenuItem>
                                                            <MenuItem
                                                                icon={<CopyRegular />}
                                                                disabled={entry.commandPreview === ''}
                                                                onClick={() => void handleCopyCommand(entry)}
                                                            >
                                                                {l10n.t('Copy command')}
                                                            </MenuItem>
                                                            <MenuItem
                                                                icon={<OpenRegular />}
                                                                disabled={!isCollectionNamespace(entry.namespace)}
                                                                onClick={() =>
                                                                    void handleOpenNamespace(entry.namespace)
                                                                }
                                                            >
                                                                {l10n.t('Open collection')}
                                                            </MenuItem>
                                                        </MenuList>
                                                    </MenuPopover>
                                                </Menu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            )}
        </div>
    );
};
