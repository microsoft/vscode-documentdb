/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    DEFAULT_TIMEOUTS,
    type CheckResult,
    type DiagnosticsReport,
    type Finding,
} from '@documentdb-js/connection-diagnostics';
import * as vscode from 'vscode';
import {
    type PanelAddress,
    type PanelAddressAttempt,
    type PanelAddressClass,
    type PanelAuthMethod,
    type PanelAuthSource,
    type PanelAuthStage,
    type PanelCloud,
    type PanelCommandOutcome,
    type PanelConnectionOption,
    type PanelEvidenceDetail,
    type PanelFindingDetail,
    type PanelRow,
    type PanelRowDetails,
    type PanelRowId,
    type PanelRowStatus,
} from '../webviews/documentdb/connectionDiagnostics/panelTypes';
import { authMechanismOf, knownAuthMethod } from './authMechanism';
import { type FindingMessage } from './findingMessages';
import { diagnosticsIdentifierKeys } from './identifierKeys';
import { rowForCheck } from './panelRows';
import { type FindingCode } from './types';

/*
 * Prototype (WI-18): expandable row details. What each row offers, and why:
 *
 * - Every row lists its findings (error, warning and information), so a warning or error row always
 *   explains itself. A warning or error with no finding of that severity gets a generic line that
 *   points to Show report, rather than no explanation at all.
 * - Diagnosis setup adds nothing beyond its evidence line when healthy; it offers details only with
 *   findings, and then also says where the checks ran.
 * - Connection settings: what "2 options" means. The scheme, hosts, user, authentication method and
 *   source, and every URI option as name = value, with TXT-record options marked as coming from DNS.
 *   Secret-bearing and unknown options keep their name only: the package never records their value.
 * - Server address (DNS): the SRV query and its targets, then each host's CNAME chain and addresses,
 *   with both lookups' answers only when they differ. This is what the evidence line cannot say, and
 *   what a private endpoint diagnosis needs.
 * - Network connection (TCP): which address connected for each host, and which addresses failed.
 *   Each attempt's connect time only when the host had two or more attempts (WI-33).
 * - Secure connection (TLS): protocol, certificate subject, issuer and expiry, and the host name match.
 * - Server greeting (hello): the unauthenticated greeting that ran, and what answered (server type,
 *   DocumentDB version, API compatibility, password mechanisms offered, and a replica set member's
 *   role). Whether a router or gateway is "writable" is always yes there, so it is not shown.
 * - Authentication: the method, mechanism (negotiated for username and password), user,
 *   authentication database, and each sign-in stage with its outcome, in one layout for every method.
 * - Database access: which commands ran and how each ended, the ping and the server version.
 *
 * - Each per-host section (DNS, TCP, TLS, greeting) says how long that host's check took, but only
 *   when the row has two or more hosts: with one, the row's badge already says it (WI-33).
 *
 * The timings are the ping, each host check's time and each TCP attempt's connect time (decision
 * 0050), as numbers the view formats. Codes, raw errors and English package details never appear.
 */

type Describe = (finding: Finding<FindingCode>) => FindingMessage;

const severityOrder: Readonly<Record<PanelFindingDetail['severity'], number>> = { error: 0, warning: 1, info: 2 };

/** Rows whose evidence repeats the evidence line; they offer details only with findings. */
const findingsOnlyRows: ReadonlySet<PanelRowId> = new Set(['setup']);

function text(facts: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = facts[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finiteNumber(facts: Readonly<Record<string, unknown>>, key: string): number | undefined {
    const value = facts[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
}

function list(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? (value as unknown[]) : [];
}

function strings(value: unknown): string[] {
    return list(value).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function splitTarget(target: string): { host: string; port?: number } {
    const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(target);
    if (!match) {
        return { host: target };
    }
    const port = Number(match[3]);
    return { host: match[1] ?? match[2], ...(Number.isInteger(port) ? { port } : {}) };
}

function isSettled(status: PanelRowStatus): boolean {
    return status === 'done' || status === 'warning' || status === 'error' || status === 'skipped';
}

function addresses(value: unknown): PanelAddress[] {
    const classes: readonly PanelAddressClass[] = ['public', 'private', 'loopback', 'linkLocal'];
    return list(value).flatMap((entry): PanelAddress[] => {
        const fact = record(entry);
        const address = text(fact, 'address');
        const family = fact.family === 6 ? 6 : 4;
        const addressClass = classes.find((candidate): boolean => candidate === fact.class);
        return address && addressClass ? [{ address, family, addressClass }] : [];
    });
}

function sameAddresses(left: readonly PanelAddress[], right: readonly PanelAddress[]): boolean {
    const a = new Set(left.map((entry): string => entry.address.toLowerCase()));
    const b = new Set(right.map((entry): string => entry.address.toLowerCase()));
    return a.size === b.size && [...a].every((entry): boolean => b.has(entry));
}

function allFindings(result: CheckResult<FindingCode>): readonly Finding<FindingCode>[] {
    return [
        ...result.findings,
        ...(result.steps ?? []).flatMap((step): readonly Finding<FindingCode>[] => step.findings),
    ];
}

/** Findings about the connection's whole host list; they sit on one host's result but name no host. */
const connectionWideFindings: ReadonlySet<FindingCode> = new Set(['dns.mixedHostDomains']);

function findings(results: readonly CheckResult<FindingCode>[], describe: Describe): PanelFindingDetail[] {
    const merged: { key: string; detail: PanelFindingDetail; targets: string[] }[] = [];
    for (const result of results) {
        for (const finding of allFindings(result)) {
            let message: FindingMessage;
            try {
                message = describe(finding);
            } catch {
                // An unknown code has no localized message; the report still lists it.
                continue;
            }
            const detail: PanelFindingDetail = {
                severity: finding.severity,
                title: message.title,
                explanation: message.explanation,
                ...(message.nextStep ? { nextStep: message.nextStep } : {}),
            };
            const key = JSON.stringify(detail);
            const host =
                result.target === undefined || connectionWideFindings.has(finding.code)
                    ? undefined
                    : splitTarget(result.target).host;
            const entry = merged.find((candidate): boolean => candidate.key === key);
            if (entry) {
                if (host !== undefined && !entry.targets.includes(host)) {
                    entry.targets.push(host);
                }
            } else {
                merged.push({ key, detail, targets: host === undefined ? [] : [host] });
            }
        }
    }
    return merged
        .map(({ detail, targets }): PanelFindingDetail => (targets.length > 0 ? { ...detail, targets } : detail))
        .sort((left, right): number => severityOrder[left.severity] - severityOrder[right.severity]);
}

/** Says why a row is a warning or an error when no finding of that severity does. */
function fallbackFinding(status: 'warning' | 'error'): PanelFindingDetail {
    return status === 'error'
        ? {
              severity: 'error',
              title: vscode.l10n.t('This check did not succeed'),
              explanation: vscode.l10n.t('No further explanation is available here.'),
              nextStep: vscode.l10n.t(
                  'Run the diagnosis to the end, then choose Show report for the technical details.',
              ),
          }
        : {
              severity: 'warning',
              title: vscode.l10n.t('This check reported a warning'),
              explanation: vscode.l10n.t('No further explanation is available here.'),
              nextStep: vscode.l10n.t(
                  'Run the diagnosis to the end, then choose Show report for the technical details.',
              ),
          };
}

function ran(result: CheckResult<FindingCode>): boolean {
    return result.status !== 'skipped';
}

/**
 * How long one host's check took, for its Details section (decision 0050). Only when the row has two
 * or more hosts; with one, it would repeat the row's badge (WI-33).
 */
function hostDuration(result: CheckResult<FindingCode>, timed: boolean): { durationMs?: number } {
    return timed && Number.isFinite(result.durationMs) && result.durationMs >= 0
        ? { durationMs: result.durationMs }
        : {};
}

function srvEvidence(result: CheckResult<FindingCode>): PanelEvidenceDetail {
    const facts = result.facts;
    const targets = list(facts.records).flatMap((entry): string[] => {
        const srvRecord = record(entry);
        const name = text(srvRecord, 'name');
        const port = finiteNumber(srvRecord, 'port');
        return name ? [port === undefined ? name : `${name}:${port}`] : [];
    });
    const query = text(facts, 'srvQueryName');
    return {
        kind: 'srv',
        ...(query ? { query } : {}),
        targets,
        omittedTargets: finiteNumber(facts, 'omittedRecordCount') ?? 0,
        resolver: facts.resolutionPath === 'fallback' ? 'fallback' : 'system',
        dnsServers: strings(facts.dnsServers),
        txtOptions: list(facts.txtOptions).flatMap((entry): { name: string; value: string }[] => {
            const option = record(entry);
            const name = text(option, 'name');
            const value = text(option, 'value');
            return name && value ? [{ name, value }] : [];
        }),
        failed: result.status === 'fail',
    };
}

function dnsEvidence(result: CheckResult<FindingCode>, target: string, timed: boolean): PanelEvidenceDetail {
    const facts = result.facts;
    const system = addresses(facts.osAddresses);
    const direct = addresses(facts.caresAddresses);
    const systemFailed = facts.osErrorCode !== null && facts.osErrorCode !== undefined;
    const directFailed = facts.caresErrorCode !== null && facts.caresErrorCode !== undefined;
    return {
        kind: 'dnsHost',
        host: splitTarget(target).host,
        cnameChain: strings(facts.cnameChain),
        system,
        direct,
        systemFailed,
        directFailed,
        agree: !systemFailed && !directFailed && sameAddresses(system, direct),
        ...hostDuration(result, timed),
    };
}

function tcpEvidence(result: CheckResult<FindingCode>, target: string, timed: boolean): PanelEvidenceDetail {
    const { host, port } = splitTarget(target);
    const connectedAddress = text(record(result.facts.connectedAddress), 'address');
    const attempts = list(result.facts.attempts).map(record);
    const connectMs = attempts
        .filter((attempt): boolean => attempt.outcome === 'connected' && text(attempt, 'address') === connectedAddress)
        .map((attempt): number | undefined => finiteNumber(attempt, 'latencyMs'))
        .find((latency): boolean => latency !== undefined);
    const failedAddresses: PanelAddressAttempt[] = [];
    for (const attempt of attempts) {
        const address = text(attempt, 'address');
        if (attempt.outcome !== 'failed' || !address || failedAddresses.some((entry) => entry.address === address)) {
            continue;
        }
        const latency = finiteNumber(attempt, 'latencyMs');
        failedAddresses.push(latency === undefined ? { address } : { address, connectMs: latency });
    }
    // A single attempt's connect time is all but the host's own time; it is shown only to compare attempts.
    const compared = (connectedAddress ? 1 : 0) + failedAddresses.length >= 2;
    return {
        kind: 'tcpHost',
        host,
        ...(port === undefined ? {} : { port }),
        ...(connectedAddress ? { connectedAddress } : {}),
        ...(compared && connectedAddress && connectMs !== undefined ? { connectMs } : {}),
        failedAddresses: compared ? failedAddresses : failedAddresses.map(({ address }) => ({ address })),
        ...hostDuration(result, timed),
    };
}

function certificateName(value: unknown): string | undefined {
    const name = record(value);
    return text(name, 'CN') ?? text(name, 'O');
}

function tlsEvidence(result: CheckResult<FindingCode>, target: string, timed: boolean): PanelEvidenceDetail {
    const facts = result.facts;
    const certificate = record(facts.certificate);
    const subject = certificateName(certificate.subject);
    const issuer = certificateName(list(certificate.issuerChain)[0]);
    const validTo = text(certificate, 'validTo');
    const protocol = text(facts, 'protocol');
    const mismatch =
        facts.verificationErrorCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
        result.findings.some((finding): boolean => finding.code === 'tls.hostnameMismatch');
    let hostNameMatched: boolean | undefined;
    if (mismatch) {
        hostNameMatched = false;
    } else if (result.status === 'pass') {
        hostNameMatched = true;
    }
    return {
        kind: 'tlsHost',
        host: splitTarget(target).host,
        ...(protocol ? { protocol } : {}),
        ...(subject ? { subject } : {}),
        ...(issuer ? { issuer } : {}),
        ...(validTo && Number.isFinite(Date.parse(validTo)) ? { validTo: new Date(validTo).toISOString() } : {}),
        trusted: result.status === 'pass',
        ...(hostNameMatched === undefined ? {} : { hostNameMatched }),
        ...hostDuration(result, timed),
    };
}

function helloEvidence(result: CheckResult<FindingCode>, target: string, timed: boolean): PanelEvidenceDetail {
    const facts = result.facts;
    const topology = text(facts, 'topology');
    const setName = text(facts, 'setName');
    const documentdbVersion = strings(facts.documentdbVersions)[0];
    const maxWireVersion = finiteNumber(facts, 'maxWireVersion');
    let command: 'hello' | 'isMaster' | undefined;
    if (facts.handshake === 'opMsg') {
        command = 'hello';
    } else if (facts.handshake === 'opQuery') {
        command = 'isMaster';
    }
    // Only a replica set member's primary flag tells the user something; routers and gateways always say yes.
    let role: 'primary' | 'notPrimary' | undefined;
    if (topology === 'replicaSet' && typeof facts.isWritablePrimary === 'boolean') {
        role = facts.isWritablePrimary ? 'primary' : 'notPrimary';
    }
    return {
        kind: 'serverHost',
        host: splitTarget(target).host,
        ...(command ? { command } : {}),
        ...(topology ? { topology } : {}),
        ...(setName ? { setName } : {}),
        ...(documentdbVersion ? { documentdbVersion } : {}),
        ...(maxWireVersion === undefined ? {} : { maxWireVersion }),
        passwordMechanisms: strings(facts.saslSupportedMechs),
        ...(role ? { role } : {}),
        ...hostDuration(result, timed),
    };
}

/** URI options as parsed by the package, then TXT options from the SRV lookup. */
function connectionOptions(
    parsed: CheckResult<FindingCode>,
    context: readonly CheckResult<FindingCode>[],
): PanelConnectionOption[] {
    const uriOptions = list(parsed.facts.options).flatMap((entry): PanelConnectionOption[] => {
        const option = record(entry);
        const name = text(option, 'name');
        if (!name) {
            return [];
        }
        const value = typeof option.value === 'string' ? option.value : undefined;
        const hidden = option.sensitive !== false || option.known !== true || value === undefined;
        return [hidden ? { name, hidden: true, source: 'uri' } : { name, value, hidden: false, source: 'uri' }];
    });
    const srv = context.find((result): boolean => result.checkId === 'srv' && ran(result));
    const dnsOptions = list(srv?.facts.txtOptions).flatMap((entry): PanelConnectionOption[] => {
        const option = record(entry);
        const name = text(option, 'name');
        const value = text(option, 'value');
        return name && value ? [{ name, value, hidden: false, source: 'dns' }] : [];
    });
    return [...uriOptions, ...dnsOptions];
}

/** The database authentication looks up the user in: `authSource`, else the path, else `admin`. */
function authSourceOf(parsed: CheckResult<FindingCode>, options: readonly PanelConnectionOption[]): PanelAuthSource {
    const explicitSource = options.find(
        (option): boolean => option.name.toLowerCase() === 'authsource' && !option.hidden,
    );
    const database = text(parsed.facts, 'database');
    if (explicitSource?.value !== undefined) {
        return { value: explicitSource.value, origin: explicitSource.source };
    }
    if (database) {
        return { value: database, origin: 'path' };
    }
    return { value: 'admin', origin: 'default' };
}

/**
 * The connection string as parsed by the package, plus TXT options from SRV (a later row) and the
 * chosen authentication method. Option values come only from options the package marks as not
 * sensitive; everything else, and the password, is named but never shown.
 */
function connectionSettingsEvidence(
    results: readonly CheckResult<FindingCode>[],
    context: readonly CheckResult<FindingCode>[],
): PanelEvidenceDetail[] {
    const parsed = results.find((result): boolean => result.checkId === 'connectionString');
    if (!parsed || !ran(parsed)) {
        return [];
    }
    const facts = parsed.facts;
    const scheme = facts.scheme === 'mongodb' || facts.scheme === 'mongodb+srv' ? facts.scheme : undefined;
    const hosts = list(facts.hosts).flatMap((entry): string[] => {
        const host = text(record(entry), 'host');
        const port = finiteNumber(record(entry), 'port');
        if (!host) {
            return [];
        }
        const shown = host.includes(':') ? `[${host}]` : host;
        return [port === undefined ? shown : `${shown}:${port}`];
    });
    const options = connectionOptions(parsed, context);
    const authSource = authSourceOf(parsed, options);
    const credentials = results.find((result): boolean => result.checkId === 'credentials');
    const authMethod = knownAuthMethod(credentials?.facts.authMethod);
    const user = text(facts, 'userName');
    return [
        {
            kind: 'connectionSettings',
            ...(scheme ? { scheme } : {}),
            hosts,
            ...(user ? { user } : {}),
            passwordPresent: facts.passwordPresent === true,
            ...(authMethod ? { authMethod } : {}),
            // Authentication without credentials has no source to look the user up in.
            ...(authMethod === 'none' ? {} : { authSource }),
            options,
        },
    ];
}

function stageOutcome(status: CheckResult<FindingCode>['status'], rejected: boolean): PanelAuthStage['outcome'] {
    switch (status) {
        case 'pass':
        case 'warning':
            return 'done';
        case 'fail':
            return rejected ? 'rejected' : 'failed';
        default:
            return 'notRun';
    }
}

function rejectedIn(findingsToSearch: readonly Finding<FindingCode>[]): boolean {
    return findingsToSearch.some((finding): boolean => finding.code === 'auth.failed');
}

/** Username and password is one stage; Entra ID and managed identity get a token, then present it. */
function authStages(result: CheckResult<FindingCode>, method: PanelAuthMethod | undefined): PanelAuthStage[] {
    if (method === 'native') {
        return [{ stage: 'sendPassword', outcome: stageOutcome(result.status, rejectedIn(result.findings)) }];
    }
    const steps = result.steps ?? [];
    const stageIds = [
        ['auth.signInConfiguration', 'prepareSignIn'],
        ['auth.token', 'getToken'],
        ['auth.serverAuthentication', 'sendToken'],
    ] as const;
    return stageIds.flatMap(([stepId, stage]): PanelAuthStage[] => {
        const step = steps.find((candidate): boolean => candidate.stepId === stepId);
        if (!step) {
            return [];
        }
        const outcome = stageOutcome(step.status, rejectedIn(step.findings));
        // Preparing sign-in is internal; it is worth a line only when it is where sign-in stopped.
        if (stage === 'prepareSignIn' && outcome !== 'failed') {
            return [];
        }
        return [{ stage, outcome }];
    });
}

function authEvidence(
    result: CheckResult<FindingCode>,
    context: readonly CheckResult<FindingCode>[],
): PanelEvidenceDetail[] {
    const facts = result.facts;
    const known = knownAuthMethod(facts.authMethod);
    const mechanism = authMechanismOf(result, context);
    const user = text(facts, 'userName') ?? text(facts, 'account');
    const parsed = context.find((entry): boolean => entry.checkId === 'connectionString' && ran(entry));
    const authSource =
        known === 'native' && parsed ? authSourceOf(parsed, connectionOptions(parsed, context)) : undefined;
    const stages = known === 'none' ? [] : authStages(result, known);
    const configuration =
        result.steps?.find((step): boolean => step.stepId === 'auth.signInConfiguration')?.facts ?? {};
    const mismatch = allFindings(result).find((finding): boolean => finding.code === 'auth.cloudMismatch')?.data ?? {};
    const azureClouds: readonly Exclude<PanelCloud, 'custom'>[] = [
        'AzureCloud',
        'AzureUSGovernment',
        'AzureChinaCloud',
    ];
    const clusterCloud =
        known === 'entraId' || known === 'managedIdentity'
            ? azureClouds.find((cloud): boolean => cloud === (configuration.hostCloud ?? mismatch.hostCloud))
            : undefined;
    const configuredCloud = configuration.configuredCloud ?? mismatch.configuredCloud;
    const cloudCategory = configuration.cloudCategory ?? mismatch.cloudCategory;
    let signInCloud: PanelCloud | undefined;
    if (known === 'entraId') {
        signInCloud = [...azureClouds, 'custom' as const].find((cloud): boolean => cloud === configuredCloud);
    } else if (known === 'managedIdentity') {
        signInCloud = (
            [
                ['public', 'AzureCloud'],
                ['usgov', 'AzureUSGovernment'],
                ['china', 'AzureChinaCloud'],
                ['custom', 'custom'],
            ] as const
        ).find(([category]): boolean => category === cloudCategory)?.[1];
    }
    if (!known && !mechanism && !user) {
        return [];
    }
    return [
        {
            kind: 'auth',
            ...(known ? { method: known } : {}),
            ...(mechanism ? { mechanism: mechanism.mechanism } : {}),
            ...(mechanism?.negotiated ? { mechanismNegotiated: true } : {}),
            ...(user ? { user } : {}),
            ...(authSource ? { authSource } : {}),
            ...(signInCloud ? { signInCloud } : {}),
            ...(clusterCloud ? { clusterCloud } : {}),
            stages,
        },
    ];
}

const commandOutcomes: readonly PanelCommandOutcome[] = [
    'ok',
    'denied',
    'signInRequired',
    'unsupported',
    'timedOut',
    'failed',
];

function accessEvidence(results: readonly CheckResult<FindingCode>[]): PanelEvidenceDetail[] {
    const access = results.find((result): boolean => result.checkId === 'connectionAccess');
    const server = results.find((result): boolean => result.checkId === 'serverFacts');
    const commands = [...(access ? list(access.facts.commands) : []), ...(server ? list(server.facts.commands) : [])]
        .map(record)
        .flatMap((command): { command: string; outcome: PanelCommandOutcome }[] => {
            const name = text(command, 'command');
            const outcome = commandOutcomes.find((candidate): boolean => candidate === command.outcome);
            return name && outcome ? [{ command: name, outcome }] : [];
        });
    if (commands.length === 0) {
        return [];
    }
    const pingMs = access ? finiteNumber(access.facts, 'pingMs') : undefined;
    const databaseCount = access ? finiteNumber(access.facts, 'databaseCount') : undefined;
    const serverVersion = server ? text(server.facts, 'serverVersion') : undefined;
    const answeredBy = server ? text(server.facts, 'answeredBy') : undefined;
    return [
        {
            kind: 'access',
            commands,
            ...(pingMs === undefined ? {} : { pingMs: Math.round(pingMs) }),
            ...(databaseCount === undefined ? {} : { databaseCount }),
            ...(serverVersion ? { serverVersion } : {}),
            ...(answeredBy ? { answeredBy } : {}),
        },
    ];
}

/** One section per host; each says how long it took only when there are two or more to compare. */
function perHost(
    results: readonly CheckResult<FindingCode>[],
    checkId: string,
    build: (result: CheckResult<FindingCode>, target: string, timed: boolean) => PanelEvidenceDetail,
): PanelEvidenceDetail[] {
    const hosts = results.filter(
        (result): result is CheckResult<FindingCode> & { target: string } =>
            result.checkId === checkId && result.target !== undefined && ran(result),
    );
    return hosts.map((result): PanelEvidenceDetail => build(result, result.target, hosts.length >= 2));
}

function evidence(
    id: PanelRowId,
    results: readonly CheckResult<FindingCode>[],
    context: readonly CheckResult<FindingCode>[],
): PanelEvidenceDetail[] {
    switch (id) {
        case 'setup': {
            const environment = results.find((result): boolean => result.checkId === 'environment')?.facts ?? {};
            const extension = results.find((result): boolean => result.checkId === 'extensionEnvironment')?.facts ?? {};
            const remoteKind = text(extension, 'remoteKind');
            const platform = text(environment, 'platform');
            const release = text(environment, 'release');
            const arch = text(environment, 'arch');
            return remoteKind || platform || arch
                ? [
                      {
                          kind: 'setup',
                          ...(remoteKind ? { remoteKind } : {}),
                          ...(platform ? { platform } : {}),
                          ...(release ? { release } : {}),
                          ...(arch ? { arch } : {}),
                      },
                  ]
                : [];
        }
        case 'connectionSettings':
            return connectionSettingsEvidence(results, context);
        case 'serverAddress': {
            const srv = results.find((result): boolean => result.checkId === 'srv' && ran(result));
            return [...(srv ? [srvEvidence(srv)] : []), ...perHost(results, 'dns', dnsEvidence)];
        }
        case 'networkConnection':
            return perHost(results, 'tcp', tcpEvidence);
        case 'secureConnection':
            return perHost(results, 'tls', tlsEvidence);
        case 'serverResponse':
            return perHost(results, 'hello', helloEvidence);
        case 'authentication': {
            const auth = results.find((result): boolean => result.checkId === 'authenticate' && ran(result));
            return auth ? authEvidence(auth, context) : [];
        }
        case 'databaseAccess':
            return accessEvidence(results.filter(ran));
    }
}

/**
 * The details for one settled row, or `undefined` when it has nothing worth showing. A warning or
 * error row always gets details that explain its status.
 */
export function buildRowDetails(
    id: PanelRowId,
    status: PanelRowStatus,
    results: readonly CheckResult<FindingCode>[],
    describe: Describe,
    /** Every result so far, for evidence another row's check holds (TXT options for Connection settings). */
    context: readonly CheckResult<FindingCode>[] = results,
): PanelRowDetails | undefined {
    if (!isSettled(status)) {
        return undefined;
    }
    const rowFindings = findings(results, describe);
    if (status === 'error' && !rowFindings.some((finding): boolean => finding.severity === 'error')) {
        rowFindings.unshift(fallbackFinding('error'));
    } else if (status === 'warning' && !rowFindings.some((finding): boolean => finding.severity !== 'info')) {
        rowFindings.unshift(fallbackFinding('warning'));
    }
    const rowEvidence = findingsOnlyRows.has(id) && rowFindings.length === 0 ? [] : evidence(id, results, context);
    if (rowFindings.length === 0 && rowEvidence.length === 0) {
        return undefined;
    }
    return { findings: rowFindings, evidence: rowEvidence };
}

/** A results-only report, so a live run shows the same sanitized results as the finished report. */
function partialReport(results: readonly CheckResult<FindingCode>[]): DiagnosticsReport<FindingCode> {
    return buildReport(
        {
            runId: 'live',
            startedAt: 0,
            finishedAt: 0,
            durationMs: 0,
            timeoutProfile: 'default',
            timeouts: DEFAULT_TIMEOUTS,
            targets: [],
            results,
            coverage: {
                limited: false,
                timedOut: [],
                notStartedCount: 0,
                omittedTargetCount: 0,
                retryWouldHelp: false,
            },
        },
        { identifierKeys: diagnosticsIdentifierKeys },
    );
}

/**
 * Adds `details` to every settled row, from the report's results. Pass the finished run's report
 * once it exists; until then, the results so far. The details always show full identifiers: Hide
 * identifiers applies to the report only (decision 0040).
 */
export function withRowDetails(
    rows: readonly PanelRow[],
    source: DiagnosticsReport<FindingCode> | readonly CheckResult<FindingCode>[],
    describe: Describe,
): PanelRow[] {
    const report = Array.isArray(source)
        ? partialReport(source as readonly CheckResult<FindingCode>[])
        : (source as DiagnosticsReport<FindingCode>);
    return rows.map((row): PanelRow => {
        const plain: PanelRow = {
            id: row.id,
            status: row.status,
            segments: row.segments,
            ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
        };
        if (!isSettled(row.status)) {
            return plain;
        }
        const inRow = (result: CheckResult<FindingCode>): boolean => rowForCheck(result.checkId) === row.id;
        const details = buildRowDetails(row.id, row.status, report.results.filter(inRow), describe, report.results);
        return details ? { ...plain, details } : plain;
    });
}
