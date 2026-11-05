/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from '@fluentui/react-components';
import {
    StatusListDetailsFacts,
    StatusListDetailsMessage,
    StatusListDetailsSection,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode } from 'react';
import {
    apiCompatibilityText,
    formatDate,
    formatDuration,
    locationText,
    platformText,
    tlsProtocolText,
    topologyText,
} from './formatEvidence';
import {
    type PanelAddress,
    type PanelAuthStage,
    type PanelCommandOutcome,
    type PanelEvidenceDetail,
    type PanelFindingDetail,
    type PanelFindingSeverity,
    type PanelRowDetails,
} from './panelTypes';

// The frame and the type scale come from `StatusListItem`'s disclosure and the details building blocks;
// see "Details content" in the StatusList README. Only the content's own layout is styled here.
const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
    findings: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        margin: 0,
        padding: 0,
        listStyleType: 'none',
    },
    values: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' },
    muted: { color: tokens.colorNeutralForeground2 },
    lead: { margin: 0 },
});

type Styles = ReturnType<typeof useStyles>;

export function severityWord(severity: PanelFindingSeverity): string {
    switch (severity) {
        case 'error':
            return l10n.t('Error');
        case 'warning':
            return l10n.t('Warning');
        case 'info':
            return l10n.t('Information');
    }
}

/** The toggle's accessible description: the most severe finding, so the reason is heard on the row. */
export function detailsDescription(details: PanelRowDetails): string | undefined {
    const first = details.findings[0];
    if (!first) {
        return undefined;
    }
    const more = details.findings.length - 1;
    const lead = l10n.t('{0}: {1}', severityWord(first.severity), first.title);
    return more > 0 ? l10n.t('{0}, and {1} more', lead, more) : lead;
}

function addressClassText(address: PanelAddress): string {
    const family = address.family === 6 ? l10n.t('IPv6') : l10n.t('IPv4');
    switch (address.addressClass) {
        case 'public':
            return l10n.t('{0}, public', family);
        case 'private':
            return l10n.t('{0}, private', family);
        case 'loopback':
            return l10n.t('{0}, loopback', family);
        case 'linkLocal':
            return l10n.t('{0}, link-local', family);
    }
}

function commandOutcomeText(outcome: PanelCommandOutcome): string {
    switch (outcome) {
        case 'ok':
            return l10n.t('succeeded');
        case 'denied':
            return l10n.t('not allowed');
        case 'signInRequired':
            return l10n.t('requires sign-in');
        case 'unsupported':
            return l10n.t('not supported');
        case 'timedOut':
            return l10n.t('did not finish in time');
        case 'failed':
            return l10n.t('failed');
    }
}

function authStageText(stage: PanelAuthStage['stage']): string {
    switch (stage) {
        case 'sendPassword':
            return l10n.t('Send user name and password to the cluster');
        case 'prepareSignIn':
            return l10n.t('Prepare Microsoft Entra ID sign-in');
        case 'getToken':
            return l10n.t('Get a token from Microsoft Entra ID');
        case 'sendToken':
            return l10n.t('Give the token to the cluster');
    }
}

function authStageOutcomeText(outcome: PanelAuthStage['outcome']): string {
    switch (outcome) {
        case 'done':
            return l10n.t('done');
        case 'rejected':
            return l10n.t('rejected');
        case 'failed':
            return l10n.t('failed');
        case 'notRun':
            return l10n.t('not run');
    }
}

function authMethodText(method: NonNullable<Extract<PanelEvidenceDetail, { kind: 'auth' }>['method']>): string {
    switch (method) {
        case 'native':
            return l10n.t('Username and password');
        case 'entraId':
            return l10n.t('Microsoft Entra ID');
        case 'managedIdentity':
            return l10n.t('Managed identity');
        case 'none':
            return l10n.t('No authentication');
    }
}

function authSourceNote(
    origin: NonNullable<Extract<PanelEvidenceDetail, { kind: 'connectionSettings' }>['authSource']>['origin'],
): string | undefined {
    switch (origin) {
        case 'uri':
            return undefined;
        case 'dns':
            return l10n.t('(from DNS TXT record)');
        case 'path':
            return l10n.t('(from the database in the connection string)');
        case 'default':
            return l10n.t('(default)');
    }
}

function withPort(address: string, port: number | undefined): string {
    if (port === undefined) {
        return address;
    }
    return address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`;
}

/** Code-like text: host names, addresses, users, options. The details region sets its typeface. */
function code(value: string): JSX.Element {
    return <code>{value}</code>;
}

function ValueList({ values, styles }: { values: readonly ReactNode[]; styles: Styles }): JSX.Element {
    if (values.length === 1) {
        return <>{values[0]}</>;
    }
    return (
        <ul className={styles.values}>
            {values.map((value, index) => (
                <li key={index}>{value}</li>
            ))}
        </ul>
    );
}

/**
 * How long a host's check took. The host sends it only when the row has two or more host sections;
 * with one, it would repeat the row's badge (decision 0050). No rating.
 */
function tookFact(durationMs: number | undefined): { term: string; value: string } | false {
    return durationMs !== undefined && { term: l10n.t('Took'), value: formatDuration(durationMs) };
}

/**
 * An address, with its TCP connect time when the host sent one (two or more attempts, decision 0050):
 * "203.0.113.10:27017 in 23 ms" when it connected, "… after 3 s" when the attempt failed.
 */
function addressAttempt(address: string, connectMs: number | undefined, connected: boolean, styles: Styles): ReactNode {
    return (
        <>
            {code(address)}
            {connectMs !== undefined && (
                <span className={styles.muted}>
                    {' '}
                    {connected
                        ? l10n.t('in {0}', formatDuration(connectMs))
                        : l10n.t('after {0}', formatDuration(connectMs))}
                </span>
            )}
        </>
    );
}

function addressList(list: readonly PanelAddress[], styles: Styles): ReactNode {
    return (
        <ValueList
            styles={styles}
            values={list.map((address) => (
                <>
                    {code(address.address)} <span className={styles.muted}>({addressClassText(address)})</span>
                </>
            ))}
        />
    );
}

function EvidenceView({ evidence, styles }: { evidence: PanelEvidenceDetail; styles: Styles }): JSX.Element {
    const noAnswer = <span className={styles.muted}>{l10n.t('No answer')}</span>;
    switch (evidence.kind) {
        case 'connectionSettings': {
            const hiddenValue = <span className={styles.muted}>{l10n.t('(hidden)')}</span>;
            const sourceNote = evidence.authSource && authSourceNote(evidence.authSource.origin);
            return (
                <StatusListDetailsFacts
                    items={[
                        evidence.scheme !== undefined && { term: l10n.t('Scheme'), value: evidence.scheme, mono: true },
                        evidence.hosts.length > 0 && {
                            term: evidence.hosts.length === 1 ? l10n.t('Host') : l10n.t('Hosts'),
                            value: <ValueList styles={styles} values={evidence.hosts.map(code)} />,
                        },
                        evidence.user !== undefined && { term: l10n.t('User'), value: evidence.user, mono: true },
                        evidence.passwordPresent && { term: l10n.t('Password'), value: hiddenValue },
                        evidence.authMethod !== undefined && {
                            term: l10n.t('Authentication method'),
                            value: authMethodText(evidence.authMethod),
                        },
                        evidence.authSource !== undefined && {
                            term: l10n.t('Authentication database'),
                            value: (
                                <>
                                    {code(evidence.authSource.value)}
                                    {sourceNote && <span className={styles.muted}> {sourceNote}</span>}
                                </>
                            ),
                        },
                        {
                            term: l10n.t('Options'),
                            value:
                                evidence.options.length > 0 ? (
                                    <ValueList
                                        styles={styles}
                                        values={evidence.options.map((option) => (
                                            <>
                                                {code(`${option.name} = `)}
                                                {option.hidden || option.value === undefined
                                                    ? hiddenValue
                                                    : code(option.value)}
                                                {option.source === 'dns' && (
                                                    <span className={styles.muted}>
                                                        {' '}
                                                        {l10n.t('(from DNS TXT record)')}
                                                    </span>
                                                )}
                                            </>
                                        ))}
                                    />
                                ) : (
                                    <span className={styles.muted}>{l10n.t('None')}</span>
                                ),
                        },
                    ]}
                />
            );
        }
        case 'setup':
            return (
                <StatusListDetailsFacts
                    items={[
                        evidence.remoteKind !== undefined && {
                            term: l10n.t('Checks ran'),
                            value: locationText(evidence.remoteKind),
                        },
                        evidence.platform !== undefined && {
                            term: l10n.t('Operating system'),
                            value: evidence.release
                                ? l10n.t('{0} {1}', platformText(evidence.platform), evidence.release)
                                : platformText(evidence.platform),
                        },
                        evidence.arch !== undefined && { term: l10n.t('Architecture'), value: evidence.arch },
                    ]}
                />
            );
        case 'srv':
            return (
                <StatusListDetailsSection title={l10n.t('Service record (SRV)')}>
                    <StatusListDetailsFacts
                        items={[
                            evidence.query !== undefined && {
                                term: l10n.t('Query'),
                                value: evidence.query,
                                mono: true,
                            },
                            {
                                term: l10n.t('Hosts listed'),
                                value:
                                    evidence.targets.length > 0 ? (
                                        <ValueList styles={styles} values={evidence.targets.map(code)} />
                                    ) : (
                                        noAnswer
                                    ),
                            },
                            evidence.omittedTargets > 0 && {
                                term: l10n.t('Not shown'),
                                value: l10n.t('{0} more hosts', evidence.omittedTargets),
                            },
                            evidence.txtOptions.length > 0 && {
                                term: l10n.t('TXT options'),
                                value: code(
                                    evidence.txtOptions.map((option) => `${option.name}=${option.value}`).join('&'),
                                ),
                            },
                            // Only worth a line when the extension had to read the SRV reply itself.
                            evidence.resolver === 'fallback' && {
                                term: l10n.t('Lookup'),
                                value: l10n.t("Read with the extension's DNS workaround"),
                            },
                            evidence.dnsServers.length > 0 && {
                                term: l10n.t('DNS servers'),
                                value: <ValueList styles={styles} values={evidence.dnsServers.map(code)} />,
                            },
                        ]}
                    />
                </StatusListDetailsSection>
            );
        case 'dnsHost':
            return (
                <StatusListDetailsSection title={code(evidence.host)}>
                    <StatusListDetailsFacts
                        items={[
                            evidence.cnameChain.length > 0 && {
                                term: l10n.t('Alias chain (CNAME)'),
                                value: <ValueList styles={styles} values={evidence.cnameChain.map(code)} />,
                            },
                            // Agreeing lookups are one answer; the two are named only when they differ.
                            ...(evidence.agree
                                ? [{ term: l10n.t('Addresses'), value: addressList(evidence.system, styles) }]
                                : [
                                      {
                                          term: l10n.t("Your system's lookup"),
                                          value:
                                              evidence.systemFailed || evidence.system.length === 0
                                                  ? noAnswer
                                                  : addressList(evidence.system, styles),
                                      },
                                      {
                                          term: l10n.t('Direct DNS query'),
                                          value:
                                              evidence.directFailed || evidence.direct.length === 0
                                                  ? noAnswer
                                                  : addressList(evidence.direct, styles),
                                      },
                                  ]),
                            tookFact(evidence.durationMs),
                        ]}
                    />
                </StatusListDetailsSection>
            );
        case 'tcpHost':
            return (
                <StatusListDetailsSection title={code(withPort(evidence.host, evidence.port))}>
                    <StatusListDetailsFacts
                        items={[
                            {
                                term: l10n.t('Connected to'),
                                value:
                                    evidence.connectedAddress !== undefined ? (
                                        addressAttempt(
                                            withPort(evidence.connectedAddress, evidence.port),
                                            evidence.connectMs,
                                            true,
                                            styles,
                                        )
                                    ) : (
                                        <span className={styles.muted}>{l10n.t('No address accepted')}</span>
                                    ),
                            },
                            evidence.failedAddresses.length > 0 && {
                                term: l10n.t('Could not connect to'),
                                value: (
                                    <ValueList
                                        styles={styles}
                                        values={evidence.failedAddresses.map((attempt) =>
                                            addressAttempt(
                                                withPort(attempt.address, evidence.port),
                                                attempt.connectMs,
                                                false,
                                                styles,
                                            ),
                                        )}
                                    />
                                ),
                            },
                            tookFact(evidence.durationMs),
                        ]}
                    />
                </StatusListDetailsSection>
            );
        case 'tlsHost': {
            const validTo = evidence.validTo === undefined ? undefined : formatDate(evidence.validTo);
            return (
                <StatusListDetailsSection title={code(evidence.host)}>
                    <StatusListDetailsFacts
                        items={[
                            evidence.protocol !== undefined && {
                                term: l10n.t('Protocol'),
                                value: tlsProtocolText(evidence.protocol),
                            },
                            evidence.subject !== undefined && {
                                term: l10n.t('Certificate for'),
                                value: evidence.subject,
                                mono: true,
                            },
                            evidence.issuer !== undefined && { term: l10n.t('Issued by'), value: evidence.issuer },
                            validTo !== undefined && { term: l10n.t('Valid until'), value: validTo },
                            evidence.hostNameMatched !== undefined && {
                                term: l10n.t('Host name'),
                                value: evidence.hostNameMatched
                                    ? l10n.t('Matches the certificate')
                                    : l10n.t('Does not match the certificate'),
                            },
                            {
                                term: l10n.t('Certificate'),
                                value: evidence.trusted ? l10n.t('Trusted') : l10n.t('Not verified as trusted'),
                            },
                            tookFact(evidence.durationMs),
                        ]}
                    />
                </StatusListDetailsSection>
            );
        }
        case 'serverHost':
            return (
                <StatusListDetailsSection title={code(evidence.host)}>
                    <StatusListDetailsFacts
                        items={[
                            evidence.command !== undefined && {
                                term: l10n.t('Commands run'),
                                value: (
                                    <>
                                        {code(evidence.command)}{' '}
                                        <span className={styles.muted}>{l10n.t('answered without sign-in')}</span>
                                    </>
                                ),
                            },
                            evidence.topology !== undefined && {
                                term: l10n.t('Server type'),
                                value: topologyText(evidence.topology, undefined) ?? evidence.topology,
                            },
                            evidence.setName !== undefined && {
                                term: l10n.t('Replica set'),
                                value: evidence.setName,
                                mono: true,
                            },
                            evidence.role !== undefined && {
                                term: l10n.t('Member role'),
                                value: evidence.role === 'primary' ? l10n.t('Primary') : l10n.t('Not the primary'),
                            },
                            evidence.documentdbVersion !== undefined && {
                                term: l10n.t('DocumentDB version'),
                                value: evidence.documentdbVersion,
                            },
                            evidence.maxWireVersion !== undefined && {
                                term: l10n.t('API compatibility'),
                                value: apiCompatibilityText(evidence.maxWireVersion),
                            },
                            evidence.passwordMechanisms.length > 0 && {
                                term: l10n.t('Password sign-in offered'),
                                value: <ValueList styles={styles} values={evidence.passwordMechanisms.map(code)} />,
                            },
                            tookFact(evidence.durationMs),
                        ]}
                    />
                </StatusListDetailsSection>
            );
        case 'auth': {
            const signedIn = evidence.method === 'entraId' || evidence.method === 'managedIdentity';
            const sourceNote = evidence.authSource && authSourceNote(evidence.authSource.origin);
            return (
                <StatusListDetailsFacts
                    items={[
                        evidence.method !== undefined && {
                            term: l10n.t('Method'),
                            value: authMethodText(evidence.method),
                        },
                        evidence.mechanism !== undefined && {
                            term: l10n.t('Mechanism'),
                            value: (
                                <>
                                    {code(evidence.mechanism)}
                                    {evidence.mechanismNegotiated && (
                                        <span className={styles.muted}> {l10n.t('(negotiated)')}</span>
                                    )}
                                </>
                            ),
                        },
                        evidence.user !== undefined && {
                            term: signedIn ? l10n.t('Signed in as') : l10n.t('User'),
                            value: evidence.user,
                            mono: true,
                        },
                        evidence.authSource !== undefined && {
                            term: l10n.t('Authentication database'),
                            value: (
                                <>
                                    {code(evidence.authSource.value)}
                                    {sourceNote && <span className={styles.muted}> {sourceNote}</span>}
                                </>
                            ),
                        },
                        evidence.stages.length > 0 && {
                            term: l10n.t('Steps'),
                            value: (
                                <ValueList
                                    styles={styles}
                                    values={evidence.stages.map((stage) => (
                                        <>
                                            {authStageText(stage.stage)}{' '}
                                            <span className={styles.muted}>{authStageOutcomeText(stage.outcome)}</span>
                                        </>
                                    ))}
                                />
                            ),
                        },
                    ]}
                />
            );
        }
        case 'access':
            return (
                <StatusListDetailsFacts
                    items={[
                        {
                            term: l10n.t('Commands run'),
                            value: (
                                <ValueList
                                    styles={styles}
                                    values={evidence.commands.map((command) => (
                                        <>
                                            {code(command.command)}{' '}
                                            <span className={styles.muted}>{commandOutcomeText(command.outcome)}</span>
                                        </>
                                    ))}
                                />
                            ),
                        },
                        evidence.pingMs !== undefined && {
                            term: l10n.t('Ping'),
                            value: formatDuration(evidence.pingMs),
                        },
                        evidence.databaseCount !== undefined && {
                            term: l10n.t('Databases visible'),
                            value: String(evidence.databaseCount),
                        },
                        evidence.serverVersion !== undefined && {
                            term: l10n.t('Server version'),
                            value: evidence.serverVersion,
                        },
                        evidence.answeredBy !== undefined && {
                            term: l10n.t('Answered by'),
                            value: evidence.answeredBy,
                            mono: true,
                        },
                    ]}
                />
            );
    }
}

function FindingView({ finding }: { finding: PanelFindingDetail }): JSX.Element {
    return (
        <li>
            <StatusListDetailsMessage
                severity={finding.severity}
                severityLabel={l10n.t('{0}:', severityWord(finding.severity))}
                title={
                    <>
                        {finding.title}
                        {finding.targets && finding.targets.length > 0 && (
                            <> {code(`(${finding.targets.join(', ')})`)}</>
                        )}
                    </>
                }
                nextStep={finding.nextStep && l10n.t('Next: {0}', finding.nextStep)}
            >
                {finding.explanation}
            </StatusListDetailsMessage>
        </li>
    );
}

/** The content of one row's disclosure: findings first, by severity, then the evidence. */
export const TroubleshooterRowDetails = ({ details }: { details: PanelRowDetails }): JSX.Element => {
    const styles = useStyles();
    return (
        <div className={styles.root}>
            {details.findings.length > 0 && (
                <ul className={styles.findings} aria-label={l10n.t('Findings')}>
                    {details.findings.map((finding, index) => (
                        <FindingView key={index} finding={finding} />
                    ))}
                </ul>
            )}
            {details.evidence.some((evidence) => evidence.kind === 'serverHost' && evidence.command !== undefined) && (
                <p className={styles.lead}>
                    {l10n.t('The server answered before sign-in. No password or token was sent.')}
                </p>
            )}
            {details.evidence.map((evidence, index) => (
                <EvidenceView key={index} evidence={evidence} styles={styles} />
            ))}
        </div>
    );
};
