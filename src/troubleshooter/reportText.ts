/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReportLabelKey, type ReportSectionId, type ReportText } from '@documentdb-js/connectivity-troubleshooter';
import * as os from 'os';
import * as vscode from 'vscode';
import { escapeMarkdown } from '../webviews/utils/escapeMarkdown';
import { getExtensionMetadata } from './checks/extensionEnvironment';
import { describeFindingForReport } from './findingMessages';
import { type FindingCode } from './types';

interface ReportAttribution {
    readonly description: string;
    readonly marketplaceUrl: string;
    readonly extensionVersion: string;
    readonly extensionChannel: string;
    readonly vscodeVersion: string;
    readonly nodeVersion: string;
    readonly osInfo: string;
}

export function createExtensionReportAttribution(): ReportAttribution {
    return {
        description: vscode.l10n.t(
            'This report was generated using the DocumentDB extension for Visual Studio Code.',
        ),
        marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb',
        ...getExtensionMetadata(),
        vscodeVersion: vscode.version,
        nodeVersion: process.version,
        osInfo: `${os.type()} ${os.arch()} ${os.release()}`,
    };
}

export function renderExtensionReportFooter(): string {
    const attribution = createExtensionReportAttribution();
    return [
        `## ${escapeMarkdown(vscode.l10n.t('About this report'))}`,
        escapeMarkdown(attribution.description),
        `[${escapeMarkdown(vscode.l10n.t('Get the extension on Visual Studio Marketplace'))}](${attribution.marketplaceUrl})`,
        [
            `- ${escapeMarkdown(vscode.l10n.t('Extension version: {0}', attribution.extensionVersion))}`,
            `- ${escapeMarkdown(vscode.l10n.t('Extension channel: {0}', attribution.extensionChannel))}`,
            `- ${escapeMarkdown(vscode.l10n.t('VS Code version: {0}', attribution.vscodeVersion))}`,
            `- ${escapeMarkdown(vscode.l10n.t('Node.js: {0}', attribution.nodeVersion))}`,
            `- ${escapeMarkdown(vscode.l10n.t('OS: {0}', attribution.osInfo))}`,
        ].join('\n'),
    ].join('\n\n');
}

export function createExtensionReportText(): ReportText<FindingCode> {
    const dateTimeOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'long' };
    let dateTimeFormat: Intl.DateTimeFormat;
    try {
        dateTimeFormat = new Intl.DateTimeFormat(vscode.env.language, dateTimeOptions);
    } catch {
        dateTimeFormat = new Intl.DateTimeFormat(undefined, dateTimeOptions);
    }
    const sections: Readonly<Record<ReportSectionId, string>> = {
        summary: vscode.l10n.t('Summary'),
        nextSteps: vscode.l10n.t('Next steps'),
        coverage: vscode.l10n.t('Coverage and limits'),
        environment: vscode.l10n.t('Environment'),
        connectionConfiguration: vscode.l10n.t('Connection configuration'),
        preparation: vscode.l10n.t('Preparation'),
        nameResolution: vscode.l10n.t('Name resolution'),
        transport: vscode.l10n.t('Transport'),
        wireProtocol: vscode.l10n.t('Wire protocol'),
        authentication: vscode.l10n.t('Authentication'),
        serverAndAccess: vscode.l10n.t('Server and access'),
        additionalChecks: vscode.l10n.t('Additional checks'),
        findings: vscode.l10n.t('Findings'),
        timings: vscode.l10n.t('Timings'),
        trace: vscode.l10n.t('Trace'),
    };
    const labels: Readonly<Record<ReportLabelKey, string>> = {
        check: vscode.l10n.t('Check'),
        target: vscode.l10n.t('Target'),
        status: vscode.l10n.t('Status'),
        duration: vscode.l10n.t('Duration'),
        reason: vscode.l10n.t('Reason'),
        code: vscode.l10n.t('Code'),
        severity: vscode.l10n.t('Severity'),
        title: vscode.l10n.t('Title'),
        field: vscode.l10n.t('Field'),
        value: vscode.l10n.t('Value'),
        runId: vscode.l10n.t('Run ID'),
        startedAt: vscode.l10n.t('Started at'),
        finishedAt: vscode.l10n.t('Finished at'),
        location: vscode.l10n.t('Location'),
        timeoutProfile: vscode.l10n.t('Timeout profile'),
        timeout: vscode.l10n.t('Timeout'),
        configuredTimeout: vscode.l10n.t('Configured timeout'),
        source: vscode.l10n.t('Source'),
        omittedTargets: vscode.l10n.t('Omitted targets'),
        notStarted: vscode.l10n.t('Not started'),
        timedOut: vscode.l10n.t('Timed-out operations'),
        explanation: vscode.l10n.t('Explanation'),
        nextStep: vscode.l10n.t('Next step'),
        clockOffset: vscode.l10n.t('Clock offset'),
        uncertainty: vscode.l10n.t('Uncertainty'),
        none: vscode.l10n.t('None'),
        milliseconds: vscode.l10n.t('ms'),
        runTimeoutMs: vscode.l10n.t('Whole run'),
        preparationTimeoutMs: vscode.l10n.t('Preparation'),
        srvTimeoutMs: vscode.l10n.t('SRV/TXT resolution'),
        probeTimeoutMs: vscode.l10n.t('Each network probe'),
        authenticationTimeoutMs: vscode.l10n.t('Authentication'),
        postConnectTimeoutMs: vscode.l10n.t('Each post-connect command'),
        info: vscode.l10n.t('Info'),
        warning: vscode.l10n.t('Warning'),
        error: vscode.l10n.t('Error'),
        checkTimeoutSource: vscode.l10n.t('Check'),
        runTimeoutSource: vscode.l10n.t('Whole run'),
        connectionTimeoutSource: vscode.l10n.t('Connection'),
    };
    const checks: Readonly<Record<string, string>> = {
        environment: vscode.l10n.t('Diagnosis setup'),
        extensionEnvironment: vscode.l10n.t('Diagnosis setup'),
        resolveTarget: vscode.l10n.t('Connection settings'),
        connectionString: vscode.l10n.t('Connection settings'),
        credentials: vscode.l10n.t('Connection settings'),
        prepare: vscode.l10n.t('Connection settings'),
        srv: vscode.l10n.t('Server address (DNS)'),
        dns: vscode.l10n.t('Server address (DNS)'),
        tcp: vscode.l10n.t('Network connection (TCP)'),
        tls: vscode.l10n.t('Secure connection (TLS)'),
        hello: vscode.l10n.t('Server greeting'),
        authenticate: vscode.l10n.t('Authentication'),
        connectionAccess: vscode.l10n.t('Database access'),
        serverFacts: vscode.l10n.t('Database access'),
        contextHints: vscode.l10n.t('Context hints'),
    };
    return {
        title: vscode.l10n.t('Connection diagnostics'),
        formatTimestamp: (timestamp): string => {
            const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
            return `${dateTimeFormat.format(date)} (${date.toISOString()})`;
        },
        sectionTitle: (section): string => sections[section],
        label: (key): string => labels[key],
        checkLabel: (checkId): string => (Object.hasOwn(checks, checkId) ? checks[checkId] : checkId),
        statusLabel: (status): string =>
            ({
                pass: vscode.l10n.t('Pass'),
                warning: vscode.l10n.t('Warning'),
                fail: vscode.l10n.t('Fail'),
                skipped: vscode.l10n.t('Skipped'),
            })[status],
        skipReasonLabel: (reason): string =>
            ({
                notApplicable: vscode.l10n.t('Not applicable'),
                inputUnavailable: vscode.l10n.t('Input unavailable'),
                dependencyFailed: vscode.l10n.t('Dependency failed'),
                dependencySkipped: vscode.l10n.t('Dependency skipped'),
                runTimeoutExceeded: vscode.l10n.t('Whole-run timeout exceeded'),
            })[reason],
        outcomeLabel: (outcome): string =>
            ({
                connected: vscode.l10n.t('Connection successful'),
                failed: vscode.l10n.t('Connection failed'),
                notTested: vscode.l10n.t('Connection not tested'),
            })[outcome],
        timeoutProfileLabel: (profile): string =>
            ({
                default: vscode.l10n.t('Default'),
                longer: vscode.l10n.t('Longer timeouts'),
                noDiagnosticTimeouts: vscode.l10n.t('No diagnostic timeouts'),
            })[profile],
        describeFinding: describeFindingForReport,
        omitted: (count): string => vscode.l10n.t('{0} more omitted', count),
        retryAdvice: (coverage): string | undefined => {
            const connectionLimited = coverage.timedOut.some((operation): boolean => operation.source === 'connection');
            if (coverage.retryWouldHelp) {
                const advice = vscode.l10n.t(
                    'Choose Retry with longer timeouts or Retry without diagnostic timeouts to start a fresh run. Retry without diagnostic timeouts may wait until cancelled. Neither option changes connection-configured timeouts or safety limits. No retry happens automatically.',
                );
                return connectionLimited
                    ? `${advice} ${vscode.l10n.t('A connection-configured timeout limited this run. Change that connection setting before a longer retry can help.')}`
                    : advice;
            }
            return connectionLimited
                ? vscode.l10n.t(
                      'A connection-configured timeout limited this run. Change that connection setting before a longer retry can help.',
                  )
                : undefined;
        },
        traceNote: (runId): string =>
            vscode.l10n.t('The DocumentDB output channel lines for this run carry run ID {0}.', runId),
    };
}
