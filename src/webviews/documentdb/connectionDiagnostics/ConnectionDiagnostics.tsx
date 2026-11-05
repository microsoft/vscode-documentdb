/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Link,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    DismissRegular,
    EmojiRegular,
    ErrorCircleFilled,
    NetworkCheckRegular,
} from '@fluentui/react-icons';
import { Collapse } from '@fluentui/react-motion-components-preview';
import {
    Container,
    ContainerBody,
    ContainerFooter,
    ContainerHeader,
    ContainerMain,
    ContainerSection,
    StatusList,
    StatusListItem,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefCallback, type RefObject } from 'react';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import { Announcer } from '../../components/accessibility/Announcer';
import './connectionDiagnostics.scss';
import {
    type ConnectionDiagnosticsConfiguration,
    type PanelEvent,
    type RunUpdate,
    type TimeoutProfile,
} from './connectionDiagnosticsTypes';
import { DiagnosticsResultCard, resultCardTitle } from './DiagnosticsResultCard';
import { detailsDescription, DiagnosticsRowDetails } from './DiagnosticsRowDetails';
import { applyRunUpdate, cancelRun, failRun, startingState, type DiagnosticsViewState } from './diagnosticsViewState';
import {
    formatDuration,
    formatEvidence,
    isSettled,
    rowLabels,
    statusWords,
    toStatusListStatus,
} from './formatEvidence';
import { panelRowIds, type PanelRow, type PanelRowId } from './panelTypes';
import { usePacedRunEvents } from './usePacedRunEvents';

type ReportAction = 'showDiagnostics' | 'copyReport' | 'saveReport';
type ShareAction = Exclude<ReportAction, 'showDiagnostics'>;

interface Unsubscribable {
    unsubscribe(): void;
}

export const CHECKS_LIST_ID = 'connectivity-checks';
export const RESULT_CARD_ID = 'connectivity-result';
const IDENTIFIERS_NOTE_ID = 'connectivity-identifiers-note';

/** The content width Local Quick Start and Atlas Credentials use, so the surfaces line up. */
const CONTENT_MAX_WIDTH = '760px';

const useStyles = makeStyles({
    // A single screen, so no step indicator: drop the empty `nav` row and the gap it would leave.
    body: { '& > div': { gridTemplateAreas: '"header" "main"' } },
    identifiersLink: { fontSize: 'inherit' },
    // Digits keep their width, so durations in the right-hand column line up.
    duration: { fontVariantNumeric: 'tabular-nums', fontWeight: tokens.fontWeightRegular },
});

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function checkedText(finishedAt: number, now: number): string {
    const seconds = Math.max(0, Math.floor((now - finishedAt) / 1_000));
    if (seconds < 30) {
        return l10n.t('Checked a few seconds ago');
    }
    if (seconds < 60) {
        return l10n.t('Checked less than a minute ago');
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return minutes === 1 ? l10n.t('Checked 1 minute ago') : l10n.t('Checked {0} minutes ago', minutes);
    }
    // A panel can stay open for hours or days; counting minutes would stop being readable.
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return hours === 1 ? l10n.t('Checked 1 hour ago') : l10n.t('Checked {0} hours ago', hours);
    }
    return l10n.t('Checked on {0}', new Date(finishedAt).toLocaleString());
}

function runStatusText(view: DiagnosticsViewState, now: number): string {
    switch (view.phase) {
        case 'running':
            return l10n.t('Checking the connection…');
        case 'finished':
            return checkedText(view.finishedAt ?? now, now);
        case 'cancelled':
            return l10n.t('Diagnosis cancelled');
        case 'failed':
            return l10n.t('Diagnosis did not finish');
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * A dismissed save dialog rejects with `UserCancelledError`. Across the webview boundary it is the
 * `cause` of the transported tRPC error, and only its own enumerable marker survives serialization.
 */
function isUserCancelledError(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && isObject(current); depth++) {
        if (current._isUserCancelledError === true) {
            return true;
        }
        current = current.cause;
    }
    return false;
}

function reportErrorText(action: ReportAction, message: string): string {
    switch (action) {
        case 'showDiagnostics':
            return l10n.t('Could not show the report: {0}', message);
        case 'copyReport':
            return l10n.t('Could not copy the report: {0}', message);
        case 'saveReport':
            return l10n.t('Could not save the report: {0}', message);
    }
}

/**
 * Returns a ref for one control or region that can unmount while it holds keyboard focus. React
 * detaches refs before it removes the element, so focus that is still inside it moves to `fallback`
 * instead of falling back to the document body. Focus elsewhere is never moved. Use one per element:
 * a detach reports no element, and Fluent's merged refs drop React 19 ref cleanups.
 */
function useFocusFallback(fallback: RefObject<HTMLElement | null>): RefCallback<HTMLElement> {
    const attachedRef = useRef<HTMLElement | null>(null);
    return useCallback(
        (element: HTMLElement | null): void => {
            const previous = attachedRef.current;
            attachedRef.current = element;
            if (!element && previous?.contains(previous.ownerDocument.activeElement)) {
                fallback.current?.focus();
            }
        },
        [fallback],
    );
}

interface CheckRowProps {
    readonly id: PanelRowId;
    readonly row: PanelRow | undefined;
    readonly label: string;
    readonly expanded: boolean;
    readonly onExpandedChange: (id: PanelRowId, expanded: boolean) => void;
    readonly focusFallback: RefObject<HTMLElement | null>;
}

/**
 * One fixed row. A settled row with details gets a disclosure (WI-18 prototype); a pending or active
 * row never does. The toggle ends the row's evidence line, so the label stays a plain heading (WI-19).
 * It unmounts when a new run resets the row, so it has its own focus fallback. The details always
 * show full identifiers: Hide identifiers applies to the report only (decision 0040). A settled row
 * that ran shows its real duration in a squared badge at the end of its label line (decision 0050).
 */
const CheckRow = ({ id, row, label, expanded, onExpandedChange, focusFallback }: CheckRowProps): JSX.Element => {
    const styles = useStyles();
    const toggleRef = useFocusFallback(focusFallback);
    const handleExpandedChange = useCallback(
        (next: boolean): void => onExpandedChange(id, next),
        [id, onExpandedChange],
    );
    const status = row?.status ?? 'pending';
    const details = isSettled(status) ? row?.details : undefined;
    const durationMs = isSettled(status) && status !== 'skipped' ? row?.durationMs : undefined;
    return (
        <StatusListItem
            id={`${CHECKS_LIST_ID}-${id}`}
            data-row-id={id}
            data-status={status}
            label={label}
            status={toStatusListStatus(status)}
            detail={row ? formatEvidence(row.segments) : undefined}
            reserveDetailSpace
            aside={
                durationMs === undefined ? undefined : (
                    <Badge
                        appearance="outline"
                        shape="rounded"
                        size="small"
                        color="informative"
                        className={styles.duration}
                    >
                        {formatDuration(durationMs)}
                    </Badge>
                )
            }
            disclosure={
                details
                    ? {
                          content: <DiagnosticsRowDetails details={details} />,
                          toggleText: l10n.t('Details'),
                          toggleLabel: l10n.t('Details for {0}', label),
                          toggleDescription: detailsDescription(details),
                          expanded,
                          onExpandedChange: handleExpandedChange,
                          toggleRef,
                          placement: 'detail',
                      }
                    : undefined
            }
        />
    );
};

export const ConnectionDiagnostics = (): JSX.Element => {
    const trpcClient = useTrpcClient();
    const configuration = useConfiguration<ConnectionDiagnosticsConfiguration>();
    const styles = useStyles();
    const labels = useMemo(() => rowLabels(), []);
    const words = useMemo(() => statusWords(), []);

    const [view, setView] = useState<DiagnosticsViewState>(() => startingState(0, Date.now()));
    const [now, setNow] = useState<number>(() => Date.now());
    const [hideIdentifiers, setHideIdentifiers] = useState(false);
    const [offerRerun, setOfferRerun] = useState(false);
    const [reportError, setReportError] = useState<string | undefined>(undefined);
    // Counts successful copies; each one remounts the announcer so a repeated copy is announced again.
    const [copiedCount, setCopiedCount] = useState(0);
    // Rows whose details are open. A new run collapses them all: its rows start again from pending.
    const [expandedRows, setExpandedRows] = useState<ReadonlySet<PanelRowId>>(() => new Set());
    const handleExpandedChange = useCallback((id: PanelRowId, expanded: boolean): void => {
        setExpandedRows((previous) => {
            const next = new Set(previous);
            if (expanded) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

    // Read by subscription callbacks, which outlive the render that created them.
    const viewRef = useRef(view);
    useEffect(() => {
        viewRef.current = view;
    }, [view]);
    const pendingIdentifiersRef = useRef(false);
    const refreshReportIdentifiers = useCallback(
        (runId: string, hide: boolean): void => {
            trpcClient.connectionDiagnostics.setReportIdentifiers
                .mutate({ runId, hideIdentifiers: hide })
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    setReportError(reportErrorText('showDiagnostics', message));
                });
        },
        [trpcClient],
    );
    useEffect(() => {
        // A toggle can precede the host's started event, especially when starting a re-run.
        if (pendingIdentifiersRef.current && view.runId !== undefined) {
            pendingIdentifiersRef.current = false;
            refreshReportIdentifiers(view.runId, hideIdentifiers);
        }
    }, [view.runId, hideIdentifiers, refreshReportIdentifiers]);
    const sequenceRef = useRef(0);
    // Names the latest run subscription; Cancel sends it so the host never cancels a replacement run.
    const requestIdRef = useRef<string | undefined>(undefined);
    const subscriptionsRef = useRef(new Set<Unsubscribable>());
    // The primary action stays mounted as it changes between Cancel and Re-run.
    const primaryButtonRef = useRef<HTMLButtonElement>(null);
    const offerFocusRef = useFocusFallback(primaryButtonRef);
    const cardFocusRef = useFocusFallback(primaryButtonRef);
    const reportErrorFocusRef = useFocusFallback(primaryButtonRef);

    // `running` follows the paced view, so Cancel stays and the report actions wait for the paced card.
    const running = view.phase === 'running';

    const showUpdate = useCallback((update: RunUpdate): void => {
        if (update.type === 'finished') {
            setNow(Date.now());
        }
        setView((previous) => applyRunUpdate(previous, update));
    }, []);
    // Paces settled rows and the card for the eye only (decision 0043); see `defaultStepPacing`.
    const pacer = usePacedRunEvents(showUpdate, { pacing: configuration.stepPacing });

    const subscribeRun = useCallback(
        (sequence: number, timeoutProfile: TimeoutProfile, trigger: 'initial' | 'rerun'): void => {
            const isCurrent = (): boolean => sequence === sequenceRef.current;
            const requestId = crypto.randomUUID();
            requestIdRef.current = requestId;
            pacer.start(sequence);
            const subscription = trpcClient.connectionDiagnostics.run.subscribe(
                { timeoutProfile, trigger, requestId },
                {
                    onData(update: RunUpdate): void {
                        if (isCurrent()) {
                            pacer.push(sequence, update);
                        }
                    },
                    onError(): void {
                        if (isCurrent()) {
                            pacer.flush(sequence);
                            setView(failRun);
                        }
                    },
                },
            );
            subscriptionsRef.current.add(subscription);
        },
        [trpcClient, pacer],
    );

    useEffect(() => {
        const subscriptions = subscriptionsRef.current;
        subscribeRun(sequenceRef.current, 'default', 'initial');
        const events = trpcClient.connectionDiagnostics.panelEvents.subscribe(undefined, {
            onData(event: PanelEvent): void {
                // An offer arriving mid-run would push the rows down; the run already answers it.
                if (event.type === 'offerRerun' && viewRef.current.phase !== 'running') {
                    setOfferRerun(true);
                }
            },
        });
        return () => {
            sequenceRef.current++;
            events.unsubscribe();
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
            subscriptions.clear();
        };
    }, [trpcClient, subscribeRun]);

    const finishedAt = view.phase === 'finished' ? view.finishedAt : undefined;
    useEffect(() => {
        if (finishedAt === undefined) {
            return undefined;
        }
        const elapsedMs = Math.max(0, Date.now() - finishedAt);
        if (elapsedMs >= DAY_MS) {
            return undefined; // The text is an absolute date from here on.
        }
        const nextUpdateMs =
            elapsedMs < 30_000
                ? 30_000 - elapsedMs
                : elapsedMs < 60_000
                  ? 60_000 - elapsedMs
                  : elapsedMs < HOUR_MS
                    ? 60_000 - (elapsedMs % 60_000)
                    : HOUR_MS - (elapsedMs % HOUR_MS);
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextUpdateMs));
        return () => clearTimeout(timer);
    }, [finishedAt, now]);

    const startRun = useCallback(
        (timeoutProfile: TimeoutProfile): void => {
            const sequence = ++sequenceRef.current;
            const startedAt = Date.now();
            setReportError(undefined);
            setCopiedCount(0);
            setOfferRerun(false);
            setExpandedRows(new Set());
            setNow(startedAt);
            setView(startingState(sequence, startedAt));
            // The host replaces the previous run; its subscription then completes on its own.
            subscribeRun(sequence, timeoutProfile, 'rerun');
        },
        [subscribeRun],
    );

    const handleRerun = useCallback((): void => startRun('default'), [startRun]);

    const handleCancel = useCallback((): void => {
        const requestId = requestIdRef.current;
        // Cancel never waits for pacing: rows that already settled show at once, as they really are.
        // If the run had already ended, its result shows instead and there is nothing to cancel.
        const ended = pacer.flush(sequenceRef.current);
        setView(cancelRun);
        if (ended || requestId === undefined) {
            return;
        }
        trpcClient.connectionDiagnostics.cancel.mutate({ requestId }).catch(() => {
            // The panel already shows the run as cancelled and ignores its late updates.
        });
    }, [trpcClient, pacer]);

    /**
     * Before a report with identifiers leaves the user, a modal warning offers to stop (decision 0040).
     * Resolves to `undefined` when it does not apply. A cancelled warning changes nothing in the view.
     */
    const confirmShare = useCallback(
        async (action: ShareAction): Promise<'continued' | 'cancelled' | undefined> => {
            if (hideIdentifiers) {
                return undefined;
            }
            const { confirmed } = await trpcClient.common.confirm.mutate({
                message: l10n.t('This report includes host and identity details.'),
                detail: l10n.t(
                    'Host names, addresses and the user name are not hidden. To hide them, cancel, select Hide identifiers in the report, and then share again.',
                ),
                confirmLabel: action === 'copyReport' ? l10n.t('Copy report') : l10n.t('Save report'),
                severity: 'warning',
            });
            return confirmed ? 'continued' : 'cancelled';
        },
        [trpcClient, hideIdentifiers],
    );

    const runReportAction = useCallback(
        async (action: ReportAction): Promise<void> => {
            const runId = viewRef.current.completedRunId;
            if (runId === undefined) {
                return;
            }
            try {
                if (action === 'showDiagnostics') {
                    setReportError(undefined);
                    await trpcClient.connectionDiagnostics.showDiagnostics.mutate({ runId, hideIdentifiers });
                    return;
                }
                const shareWarningOutcome = await confirmShare(action);
                if (shareWarningOutcome === 'cancelled') {
                    // Only records the outcome; the host shares nothing and the view stays as it was.
                    trpcClient.connectionDiagnostics[action]
                        .mutate({ runId, hideIdentifiers, shareWarningOutcome })
                        .catch(() => {
                            // Telemetry only; nothing to tell the user.
                        });
                    return;
                }
                setReportError(undefined);
                await trpcClient.connectionDiagnostics[action].mutate({
                    runId,
                    hideIdentifiers,
                    ...(shareWarningOutcome ? { shareWarningOutcome } : {}),
                });
                if (action === 'copyReport') {
                    setCopiedCount((count) => count + 1);
                }
            } catch (error) {
                if (!isUserCancelledError(error)) {
                    const message = error instanceof Error ? error.message : String(error);
                    setReportError(reportErrorText(action, message));
                }
            }
        },
        [trpcClient, hideIdentifiers, confirmShare],
    );

    const handleShowDiagnostics = useCallback((): void => void runReportAction('showDiagnostics'), [runReportAction]);
    const handleCopyReport = useCallback((): void => void runReportAction('copyReport'), [runReportAction]);
    const handleSaveReport = useCallback((): void => void runReportAction('saveReport'), [runReportAction]);

    const reportReady = view.phase === 'finished' && view.completedRunId !== undefined;
    // The panel always shows identifiers; the choice applies to the report only (decision 0040).
    const identifiersNote = hideIdentifiers
        ? l10n.t('The report will replace host and identity details with placeholders.')
        : l10n.t('The report will include host and identity details.');

    return (
        <Container>
            {panelRowIds.map((id) => {
                const row = view.rows.find((candidate) => candidate.id === id);
                return (
                    <Announcer
                        key={`${view.sequence}-${id}`}
                        when={view.announcedRows.includes(id)}
                        message={l10n.t('{0}, {1}', labels[id], words[row?.status ?? 'pending'])}
                    />
                );
            })}
            <Announcer
                key={`${view.sequence}-result`}
                when={view.result !== undefined}
                message={view.result ? resultCardTitle(view.result, view.rows) : ''}
            />
            <Announcer key={`copied-${copiedCount}`} when={copiedCount > 0} message={l10n.t('Report copied')} />
            <ContainerBody className={styles.body} contentMaxWidth={CONTENT_MAX_WIDTH}>
                <ContainerHeader
                    media={<NetworkCheckRegular aria-hidden />}
                    title={l10n.t('Connection Diagnostics')}
                    subtitle={l10n.t('Check a connection step by step and review the results.')}
                    action={
                        configuration.feedbackPermitted === true ? (
                            <Button
                                appearance="secondary"
                                icon={<EmojiRegular />}
                                onClick={() => {
                                    trpcClient.common.openFeedback.mutate({}).catch(() => {
                                        // The host reports its own failures to open the feedback view.
                                    });
                                }}
                            >
                                {l10n.t('Give Feedback')}
                            </Button>
                        ) : undefined
                    }
                />
                <ContainerMain>
                    {offerRerun && !running && (
                        <MessageBar intent="info" ref={offerFocusRef}>
                            <MessageBarBody>
                                {l10n.t('This diagnostic page was already open. Run the check again?')}
                            </MessageBarBody>
                            <MessageBarActions
                                containerAction={
                                    <Button
                                        appearance="transparent"
                                        aria-label={l10n.t('Dismiss')}
                                        icon={<DismissRegular />}
                                        onClick={() => setOfferRerun(false)}
                                    />
                                }
                            >
                                <Button onClick={handleRerun}>{l10n.t('Re-run')}</Button>
                            </MessageBarActions>
                        </MessageBar>
                    )}
                    <ContainerSection title={configuration.connectionName} subtitle={runStatusText(view, now)}>
                        <StatusList
                            id={CHECKS_LIST_ID}
                            ariaLabel={l10n.t('Connection checks')}
                            statusLabels={words}
                            highlightRowsOnHover
                        >
                            {panelRowIds.map((id) => (
                                <CheckRow
                                    key={id}
                                    id={id}
                                    row={view.rows.find((candidate) => candidate.id === id)}
                                    label={labels[id]}
                                    expanded={expandedRows.has(id)}
                                    onExpandedChange={handleExpandedChange}
                                    focusFallback={primaryButtonRef}
                                />
                            ))}
                        </StatusList>
                        <Collapse visible={view.result !== undefined} unmountOnExit>
                            <div id={RESULT_CARD_ID}>
                                {/* Unmounts with the card, before the collapse finishes, so a retry keeps focus. */}
                                {view.result && (
                                    <div ref={cardFocusRef}>
                                        <DiagnosticsResultCard
                                            result={view.result}
                                            rows={view.rows}
                                            onRetry={startRun}
                                        />
                                    </div>
                                )}
                            </div>
                        </Collapse>
                        {reportError !== undefined && (
                            <MessageBar intent="error" icon={<ErrorCircleFilled />} ref={reportErrorFocusRef}>
                                <MessageBarBody>{reportError}</MessageBarBody>
                                <MessageBarActions
                                    containerAction={
                                        <Button
                                            appearance="transparent"
                                            aria-label={l10n.t('Dismiss')}
                                            icon={<DismissRegular />}
                                            onClick={() => setReportError(undefined)}
                                        />
                                    }
                                />
                            </MessageBar>
                        )}
                    </ContainerSection>
                </ContainerMain>
            </ContainerBody>
            <ContainerFooter
                note={
                    <>
                        <span id={IDENTIFIERS_NOTE_ID}>{identifiersNote}</span>{' '}
                        <Link
                            as="button"
                            className={styles.identifiersLink}
                            aria-describedby={IDENTIFIERS_NOTE_ID}
                            onClick={() => {
                                const next = !hideIdentifiers;
                                setHideIdentifiers(next);
                                const runId = viewRef.current.runId;
                                pendingIdentifiersRef.current = runId === undefined;
                                if (runId !== undefined) {
                                    refreshReportIdentifiers(runId, next);
                                }
                            }}
                        >
                            {hideIdentifiers
                                ? l10n.t('Show identifiers in the report')
                                : l10n.t('Hide identifiers in the report')}
                        </Link>
                        {'. '}
                        {l10n.t('Review the report before sharing.')}
                    </>
                }
            >
                <Button
                    ref={primaryButtonRef}
                    appearance="primary"
                    icon={running ? undefined : <ArrowClockwiseRegular />}
                    onClick={running ? handleCancel : handleRerun}
                >
                    {running ? l10n.t('Cancel') : l10n.t('Re-run')}
                </Button>
                {reportReady && (
                    <>
                        <Button onClick={handleShowDiagnostics}>{l10n.t('Show report')}</Button>
                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <Button>{l10n.t('Share report')}</Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem onClick={handleCopyReport}>{l10n.t('Copy report to clipboard')}</MenuItem>
                                    <MenuItem onClick={handleSaveReport}>{l10n.t('Save report to file…')}</MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </>
                )}
            </ContainerFooter>
        </Container>
    );
};
