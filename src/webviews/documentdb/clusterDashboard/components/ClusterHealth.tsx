/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner } from '@fluentui/react-components';
import {
    CheckmarkCircleRegular,
    ErrorCircleRegular,
    EyeRegular,
    InfoRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, type JSX } from 'react';

import {
    collectClusterFindings,
    countRunChecks,
    describeCoverage,
    type ClusterFinding,
    type ClusterHealthInput,
    type FindingSeverity,
} from './clusterHealthModel';

const severityLabels = (): Record<FindingSeverity, string> => ({
    critical: l10n.t('Critical'),
    warning: l10n.t('Warning'),
    informational: l10n.t('Info'),
});

const SeverityIcon = ({ severity }: { severity: FindingSeverity }): JSX.Element =>
    severity === 'critical' ? (
        <ErrorCircleRegular aria-hidden={true} />
    ) : severity === 'warning' ? (
        <WarningRegular aria-hidden={true} />
    ) : (
        <InfoRegular aria-hidden={true} />
    );

export interface ClusterHealthProps extends ClusterHealthInput {
    onShowRawDiagnostics: () => void;
    isExportingDiagnostics: boolean;
}

/**
 * Problem-first summary: the cluster-level findings, then the coverage behind them.
 *
 * Severity is carried by an icon and a word, never by color alone.
 */
export const ClusterHealth = ({
    onShowRawDiagnostics,
    isExportingDiagnostics,
    ...input
}: ClusterHealthProps): JSX.Element => {
    const headingId = useId();
    const findings = collectClusterFindings(input);
    const coverage = describeCoverage(input);
    const checks = countRunChecks(input);
    const labels = severityLabels();

    const isLoading = input.clusterInfo === null && input.clusterInfoError === null;
    const status = isLoading
        ? l10n.t('Checking cluster health…')
        : findings.length > 0
          ? l10n.t('{findings} of {checks} checks reported an issue.', {
                findings: String(findings.length),
                checks: String(checks),
            })
          : l10n.t('{checks} checks ran; none reported an issue.', { checks: String(checks) });

    const renderFinding = (finding: ClusterFinding): JSX.Element => (
        <li key={finding.id} className="healthFinding">
            <div className="healthFindingMeta">
                <span className={`healthSeverity healthSeverity-${finding.severity}`}>
                    <SeverityIcon severity={finding.severity} />
                    {labels[finding.severity]}
                </span>
                <span className="healthSource">{finding.source}</span>
            </div>
            <div className="healthFindingBody">
                <h3 className="healthFindingTitle">{finding.title}</h3>
                <p className="healthFindingEvidence">{finding.evidence}</p>
            </div>
        </li>
    );

    return (
        <section className="dashboardSection" aria-labelledby={headingId}>
            <div className="dashboardSectionHeading">
                <h2 id={headingId} className="dashboardSectionTitle">
                    {l10n.t('Cluster health')}
                </h2>
                <Button
                    appearance="subtle"
                    size="small"
                    className="dashboardLinkButton"
                    icon={<EyeRegular />}
                    disabled={isExportingDiagnostics}
                    onClick={onShowRawDiagnostics}
                >
                    {l10n.t('View Raw Diagnostics')}
                </Button>
            </div>
            <p className="dashboardSectionSubtitle">{status}</p>

            <ul className="healthList">
                {findings.length > 0 ? (
                    findings.map(renderFinding)
                ) : (
                    <li className="healthFinding">
                        <div className="healthFindingMeta">
                            {isLoading ? (
                                <span className="healthSeverity healthSeverity-informational">
                                    <Spinner size="extra-tiny" aria-hidden={true} />
                                    {l10n.t('Checking')}
                                </span>
                            ) : (
                                <span className="healthSeverity healthSeverity-ok">
                                    <CheckmarkCircleRegular aria-hidden={true} />
                                    {l10n.t('No issues')}
                                </span>
                            )}
                        </div>
                        <div className="healthFindingBody">
                            <p className="healthFindingEvidence">
                                {l10n.t(
                                    'Connection, write access and, for Azure clusters, high availability are checked. Checks that could not run are listed under Diagnostic coverage.',
                                )}
                            </p>
                        </div>
                    </li>
                )}
            </ul>

            <details className="healthCoverage">
                <summary>{l10n.t('Diagnostic coverage')}</summary>
                <dl className="healthCoverageList">
                    {coverage.map((entry) => (
                        <div key={entry.id} className="healthCoverageEntry">
                            <dt>{entry.label}</dt>
                            <dd>{entry.status}</dd>
                        </div>
                    ))}
                </dl>
            </details>
        </section>
    );
};
