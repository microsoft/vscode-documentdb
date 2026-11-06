/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, Link, makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular, WarningRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode } from 'react';
import { MessageBlock } from '../../components/MessageBlock';
import { type ResultCardData, type RunUpdate, type TimeoutProfile } from './connectionDiagnosticsTypes';
import { rowLabels } from './formatEvidence';
import { panelRowIds, type PanelRow, type PanelRowId } from './panelTypes';

type FinishedUpdate = Extract<RunUpdate, { type: 'finished' }>;

/** How the run ended; the card exists only for an ended run. */
export type RunResult =
    | {
          readonly kind: 'finished';
          readonly outcome: FinishedUpdate['outcome'];
          readonly card: ResultCardData;
          readonly coverage: FinishedUpdate['coverage'];
      }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'failed'; readonly reason: Extract<RunUpdate, { type: 'failed' }>['reason'] };

/** A row that ended in a warning or an error, named on a successful connection's card (review R6). */
export interface CardIssue {
    readonly row: PanelRowId;
    readonly severity: 'warning' | 'error';
    /** The row's most severe finding, as its Details show it. */
    readonly title?: string;
}

/** The rows a successful connection's card names, in list order; errors and warnings alike. */
export function cardIssues(rows: readonly PanelRow[]): CardIssue[] {
    return panelRowIds.flatMap((id): CardIssue[] => {
        const row = rows.find((candidate): boolean => candidate.id === id);
        if (row?.status !== 'warning' && row?.status !== 'error') {
            return [];
        }
        const severity = row.status;
        const findings = row.details?.findings ?? [];
        const title = (findings.find((finding): boolean => finding.severity === severity) ?? findings[0])?.title;
        return [{ row: id, severity, ...(title === undefined ? {} : { title }) }];
    });
}

function successTitle(issues: readonly CardIssue[]): string {
    const errors = issues.filter((issue): boolean => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    if (errors > 0 && warnings > 0) {
        return l10n.t('Connection successful, but {0} checks need attention', issues.length);
    }
    if (errors > 0) {
        return errors === 1
            ? l10n.t('Connection successful, but 1 check failed')
            : l10n.t('Connection successful, but {0} checks failed', errors);
    }
    if (warnings > 0) {
        return warnings === 1
            ? l10n.t('Connection successful, but 1 check needs attention')
            : l10n.t('Connection successful, but {0} checks need attention', warnings);
    }
    return l10n.t('Connection successful');
}

/**
 * The card's headline, also what the panel announces when the run ends. It reads as the outcome of
 * "Connection Diagnostics": whether the connection succeeded, where it failed, or why the diagnosis
 * stopped without an answer.
 */
export function resultCardTitle(result: RunResult, rows: readonly PanelRow[]): string {
    switch (result.kind) {
        case 'cancelled':
            return l10n.t('Diagnosis cancelled');
        case 'failed':
            return l10n.t('Diagnosis did not finish');
        case 'finished':
            switch (result.outcome) {
                case 'connected':
                    // It connects, but the extension cannot list anything without sign-in (decision 0048).
                    return result.card.signInRequired
                        ? l10n.t('Connection works, but sign-in is required')
                        : successTitle(cardIssues(rows));
                case 'failed':
                    return result.card.stoppedAtRow
                        ? l10n.t('Connection failed at {0}', rowLabels()[result.card.stoppedAtRow])
                        : l10n.t('Connection failed');
                case 'notTested':
                    return result.card.runTimeoutBeforeAttempt
                        ? l10n.t('Diagnosis stopped at the time limit')
                        : l10n.t('Connection not tested');
            }
    }
}

const useStyles = makeStyles({
    // MessageBarTitle is body-sized; the headline is one step larger so it leads the card.
    headline: {
        fontSize: tokens.fontSizeBase400,
        lineHeight: tokens.lineHeightBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    cause: { fontWeight: tokens.fontWeightSemibold },
    label: { color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold },
    secondary: { color: tokens.colorNeutralForeground2 },
    caption: {
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    issues: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        margin: 0,
        padding: 0,
        listStyleType: 'none',
    },
    issue: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'flex-start' },
    issueIcon: { flexShrink: 0, fontSize: '16px', marginTop: '2px' },
    error: { color: tokens.colorPaletteRedForeground1 },
    warning: { color: tokens.colorStatusWarningForeground1 },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
    },
});

type Styles = ReturnType<typeof useStyles>;

function firewallSentence(): string {
    return l10n.t(
        'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.',
    );
}

/** "Next: …" with the label subdued, so the label never reads as part of the advice. */
function Labelled({ label, children, styles }: { label: string; children: ReactNode; styles: Styles }): JSX.Element {
    return (
        <Text>
            <span className={styles.label}>{label}</span> {children}
        </Text>
    );
}

/** The last line of a card without a successful connection, after any retry notes. */
function supportLines(): JSX.Element[] {
    return [
        <Divider key="supportDivider" />,
        <Text key="support">
            {l10n.t('Contacting support? Use Share report at the bottom of the page to copy or save the report.')}
        </Text>,
    ];
}

/** What failed, why, and what to do next, for a run that did not connect (design 4.13). */
function notConnectedLines(
    card: ResultCardData,
    styles: Styles,
    onOpenUrl?: (url: string) => void,
): JSX.Element[] {
    const lines: JSX.Element[] = [];
    const { headline, supporting, learnMore } = card;
    if (headline) {
        lines.push(
            <Text key="cause" className={styles.cause}>
                {headline.target === undefined ? headline.title : l10n.t('{0} ({1})', headline.title, headline.target)}
            </Text>,
        );
        lines.push(<Text key="why">{headline.explanation}</Text>);
        if (headline.nextStep) {
            lines.push(
                <Labelled key="next" label={l10n.t('Next:')} styles={styles}>
                    {headline.nextStep}
                </Labelled>,
            );
        }
    }
    if (supporting?.corroboration) {
        // The driver's own attempt agrees with the headline; it is not a second problem (decision 0047).
        lines.push(
            <Text key="supporting">
                {supporting.corroboration === 'serverSelection'
                    ? l10n.t('The driver also could not reach a server.')
                    : l10n.t("The driver's connection attempt also did not finish in time.")}
            </Text>,
        );
    } else if (supporting) {
        lines.push(
            <Labelled key="supporting" label={l10n.t('Also detected:')} styles={styles}>
                {supporting.target === undefined
                    ? supporting.title
                    : l10n.t('{0} ({1})', supporting.title, supporting.target)}
            </Labelled>,
        );
    }
    if (card.providerHint) {
        lines.push(<Text key="provider">{card.providerHint}</Text>);
    }
    if (learnMore && onOpenUrl) {
        lines.push(
            <Link key="learnMore" onClick={(): void => onOpenUrl(learnMore.url)}>
                {learnMore.topic === 'sovereignClouds'
                    ? l10n.t('Sovereign Clouds (Azure Government, Azure China)')
                    : l10n.t('Troubleshoot SRV DNS Lookups (querySrv EBADRESP)')}
            </Link>,
        );
    }
    const firewall = firewallSentence();
    // Network next steps from the host already end with this sentence; say it once, as the report does.
    const firewallShown = [headline?.nextStep, card.providerHint].some((text): boolean => !!text?.includes(firewall));
    if (card.firewallHint && !firewallShown) {
        lines.push(<Text key="firewall">{firewall}</Text>);
    }
    if (card.runTimeoutBeforeAttempt) {
        lines.push(
            <Text key="runTimeout">
                {l10n.t(
                    'The time limit was reached before sign-in was attempted. This does not show that the server is unreachable.',
                )}
            </Text>,
        );
    }
    if (card.earlierSignInFailure) {
        lines.push(
            <Text key="earlier">
                {l10n.t('A sign-in for this connection failed earlier. Show report has the details.')}
            </Text>,
        );
    }
    return lines;
}

/**
 * One sentence, and the rows that need attention. Server version, API version, ping and the
 * answering host live in the Server greeting and Database access details (decision 0041).
 */
function connectedLines(
    card: ResultCardData,
    issues: readonly CardIssue[],
    rows: readonly PanelRow[],
    styles: Styles,
): JSX.Element[] {
    if (issues.length === 0) {
        const skipped = rows.some((row): boolean => row.status === 'skipped');
        let summary: string;
        if (card.authenticated) {
            summary = skipped
                ? l10n.t('All applicable checks passed. Sign-in succeeded and the database answered.')
                : l10n.t('All checks passed. Sign-in succeeded and the database answered.');
        } else {
            summary = skipped
                ? l10n.t('All applicable checks passed. The database answered.')
                : l10n.t('All checks passed. The database answered.');
        }
        return [<Text key="summary">{summary}</Text>];
    }
    return [
        <Text key="summary">{l10n.t('The connection works, but these checks need attention:')}</Text>,
        issueList(issues, styles),
        detailsPointer(styles),
    ];
}

/**
 * Connected with No authentication, but the server will not list databases without sign-in
 * (decision 0048): why, and what to do. Other rows that need attention follow; Database access is
 * the headline, so it is not listed again.
 */
function signInRequiredLines(card: ResultCardData, issues: readonly CardIssue[], styles: Styles): JSX.Element[] {
    const lines: JSX.Element[] = [];
    if (card.headline) {
        lines.push(<Text key="why">{card.headline.explanation}</Text>);
        if (card.headline.nextStep) {
            lines.push(
                <Labelled key="next" label={l10n.t('Next:')} styles={styles}>
                    {card.headline.nextStep}
                </Labelled>,
            );
        }
    }
    const others = issues.filter((issue): boolean => issue.row !== 'databaseAccess');
    if (others.length > 0) {
        lines.push(
            <Text key="others">{l10n.t('These checks also need attention:')}</Text>,
            issueList(others, styles),
            detailsPointer(styles),
        );
    }
    return lines;
}

function detailsPointer(styles: Styles): JSX.Element {
    return (
        <Text key="details" className={styles.caption}>
            {l10n.t('Select Details on a row to see why and what to do.')}
        </Text>
    );
}

/** Each row that needs attention, with its most severe finding and its glyph. */
function issueList(issues: readonly CardIssue[], styles: Styles): JSX.Element {
    const labels = rowLabels();
    return (
        <ul key="issues" className={styles.issues}>
            {issues.map((issue) => {
                const Icon = issue.severity === 'error' ? ErrorCircleRegular : WarningRegular;
                return (
                    <li key={issue.row} className={styles.issue}>
                        <Icon aria-hidden className={mergeClasses(styles.issueIcon, styles[issue.severity])} />
                        <Text>
                            <span className={styles.srOnly}>
                                {`${issue.severity === 'error' ? l10n.t('Failed:') : l10n.t('Warning:')} `}
                            </span>
                            {issue.title === undefined ? (
                                labels[issue.row]
                            ) : (
                                <>
                                    {issue.title}
                                    <span className={styles.secondary}>{` · ${labels[issue.row]}`}</span>
                                </>
                            )}
                        </Text>
                    </li>
                );
            })}
        </ul>
    );
}

export interface DiagnosticsResultCardProps {
    readonly result: RunResult;
    /** The settled rows; a successful connection's card names those that need attention. */
    readonly rows: readonly PanelRow[];
    readonly onRetry: (profile: TimeoutProfile) => void;
    readonly onOpenUrl?: (url: string) => void;
}

const UNBOUNDED_RETRY_NOTE_ID = 'connectivity-result-unbounded-retry-note';

/**
 * The outcome card below the fixed list (design 4.13, decisions 0029 and 0041): a short summary of
 * the diagnosis, with the facts left to each row's Details. It renders only the host's
 * `ResultCardData` and the rows, and performs no I/O; finding codes and timings never reach it.
 */
export function DiagnosticsResultCard({
    result,
    rows,
    onRetry,
    onOpenUrl,
}: DiagnosticsResultCardProps): JSX.Element {
    const styles = useStyles();
    const title = (
        // The card sits in the connection's section (h2), so its headline is the next level down.
        <span role="heading" aria-level={3} className={styles.headline}>
            {resultCardTitle(result, rows)}
        </span>
    );

    if (result.kind === 'cancelled') {
        return (
            <MessageBlock intent="info" title={title}>
                <Text>{l10n.t('You cancelled the diagnosis. The results so far are kept.')}</Text>
            </MessageBlock>
        );
    }

    if (result.kind === 'failed') {
        return (
            <MessageBlock intent="error" title={title}>
                <Text>{l10n.t('Something went wrong while running the checks. Re-run to try again.')}</Text>
            </MessageBlock>
        );
    }

    const { outcome, card, coverage } = result;
    const issues = outcome === 'connected' ? cardIssues(rows) : [];
    const signInRequired = outcome === 'connected' && card.signInRequired === true;
    let lines: JSX.Element[];
    if (signInRequired) {
        lines = signInRequiredLines(card, issues, styles);
    } else {
        lines =
            outcome === 'connected'
                ? connectedLines(card, issues, rows, styles)
                : notConnectedLines(card, styles, onOpenUrl);
    }
    if (coverage.retryWouldHelp) {
        lines.push(
            <Text key="unbounded" id={UNBOUNDED_RETRY_NOTE_ID}>
                {l10n.t(
                    'Retry without diagnostic timeouts removes the diagnosis time limits. This may wait until you cancel it.',
                )}
            </Text>,
        );
    }
    if (coverage.connectionTimeoutLimited) {
        lines.push(
            <Text key="connectionTimeout">
                {l10n.t(
                    'A timeout configured on the connection limited this check. Change that connection setting to allow more time.',
                )}
            </Text>,
        );
    }

    const actions = coverage.retryWouldHelp ? (
        <>
            <Button appearance="secondary" onClick={(): void => onRetry('longer')}>
                {l10n.t('Retry with longer timeouts')}
            </Button>
            <Button
                appearance="secondary"
                aria-describedby={UNBOUNDED_RETRY_NOTE_ID}
                onClick={(): void => onRetry('noDiagnosticTimeouts')}
            >
                {l10n.t('Retry without diagnostic timeouts')}
            </Button>
        </>
    ) : undefined;

    if (outcome !== 'connected') {
        lines.push(...supportLines());
    }

    // The outcome sets the intent; the listed rows carry their own warning and error glyphs. A
    // connection that needs sign-in works, but is not usable yet: attention, not success or failure.
    let intent: 'success' | 'error' | 'warning' = 'warning';
    if (outcome === 'connected' && !signInRequired) {
        intent = 'success';
    } else if (outcome === 'failed') {
        intent = 'error';
    }
    return (
        <MessageBlock intent={intent} title={title} actions={actions}>
            {lines}
        </MessageBlock>
    );
}
