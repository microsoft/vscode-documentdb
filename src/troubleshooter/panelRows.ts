/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult, type Finding, type TroubleshooterEvent } from '@documentdb-js/connectivity-troubleshooter';
import {
    panelRowIds,
    type EvidenceSegment,
    type PanelRow,
    type PanelRowId,
    type PanelRowStatus,
} from '../webviews/documentdb/connectivityTroubleshooter/panelTypes';
import { hasSpecificTimeoutWording } from './findingMessages';
import { type FindingCode } from './types';

interface PlannedCheck {
    readonly id: string;
    readonly scope: 'run' | 'host';
}

interface CheckState {
    readonly plan: PlannedCheck;
    readonly results: Map<string | undefined, CheckResult<FindingCode>>;
    targets?: readonly (string | undefined)[];
}

const checkRows: Readonly<Record<string, PanelRowId | undefined>> = {
    environment: 'setup',
    extensionEnvironment: 'setup',
    resolveTarget: 'connectionSettings',
    connectionString: 'connectionSettings',
    credentials: 'connectionSettings',
    prepare: 'connectionSettings',
    srv: 'serverAddress',
    dns: 'serverAddress',
    tcp: 'networkConnection',
    tls: 'secureConnection',
    hello: 'serverResponse',
    authenticate: 'authentication',
    connectionAccess: 'databaseAccess',
    serverFacts: 'databaseAccess',
};

export function rowForCheck(checkId: string): PanelRowId | undefined {
    return Object.hasOwn(checkRows, checkId) ? checkRows[checkId] : undefined;
}

function text(facts: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = facts[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
}

function host(target: string): string {
    const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(target);
    return match ? (match[1] ?? match[2]) : target;
}

function port(target: string | undefined): number | undefined {
    const match = target?.match(/:(\d+)$/);
    if (!match) {
        return undefined;
    }
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined;
}

function allNotApplicable(results: readonly CheckResult<FindingCode>[]): boolean {
    return (
        results.length > 0 &&
        results.every(
            (result): boolean => result.status === 'skipped' && result.skippedBecause?.reason === 'notApplicable',
        )
    );
}

function settledStatus(results: readonly CheckResult<FindingCode>[]): PanelRowStatus {
    if (results.some((result): boolean => result.status === 'fail')) {
        return 'error';
    }
    if (results.some((result): boolean => result.status === 'warning')) {
        return 'warning';
    }
    if (results.every((result): boolean => result.status === 'skipped')) {
        return 'skipped';
    }
    return 'done';
}

export class PanelRowProjector {
    private readonly checks: readonly CheckState[];
    private readonly startedRows = new Set<PanelRowId>();
    private readonly settledRows = new Map<PanelRowId, PanelRow>();
    private shownRows: readonly PanelRow[] = panelRowIds.map(
        (id): PanelRow => ({ id, status: 'pending', segments: [] }),
    );
    private runId: string | undefined;
    private stopped = false;

    public constructor(
        private readonly describe: (finding: Finding<FindingCode>) => { title: string },
        plannedChecks: readonly PlannedCheck[],
    ) {
        this.checks = plannedChecks.map(
            (plan): CheckState => ({
                plan: { ...plan },
                results: new Map(),
                ...(plan.scope === 'run' ? { targets: [undefined] } : {}),
            }),
        );
    }

    public apply(event: TroubleshooterEvent<FindingCode>): void {
        if (this.stopped || (this.runId !== undefined && event.runId !== this.runId)) {
            return;
        }
        this.runId ??= event.runId;
        if (event.type === 'runFinished') {
            this.finish();
            return;
        }
        if (event.type === 'hostPhaseStarted') {
            for (const check of this.checks) {
                if (
                    check.plan.scope === 'host' &&
                    event.checkIds.includes(check.plan.id) &&
                    check.targets === undefined
                ) {
                    check.targets = event.targets.length > 0 ? [...event.targets] : [undefined];
                }
            }
        } else {
            const id = event.type === 'checkStarted' ? event.checkId : event.result.checkId;
            const check = this.checks.find((state): boolean => state.plan.id === id);
            const rowId = rowForCheck(id);
            if (!check || !rowId || this.settledRows.has(rowId)) {
                return;
            }
            if (event.type === 'checkStarted') {
                this.startedRows.add(rowId);
            } else if (!check.results.has(event.result.target)) {
                check.results.set(event.result.target, event.result);
            }
        }
        for (const id of panelRowIds) {
            if (this.settledRows.has(id)) {
                continue;
            }
            const checks = this.checks.filter((check): boolean => rowForCheck(check.plan.id) === id);
            if (
                checks.length > 0 &&
                checks.every(
                    (check): boolean =>
                        check.targets !== undefined &&
                        check.targets.every((target): boolean => check.results.has(target)),
                )
            ) {
                this.settledRows.set(id, this.settle(id));
            }
        }
        this.project();
    }

    public rows(): readonly PanelRow[] {
        return this.shownRows;
    }

    public finish(): void {
        if (this.stopped) {
            return;
        }
        for (const id of panelRowIds) {
            if (!this.settledRows.has(id)) {
                this.settledRows.set(id, this.settle(id));
            }
        }
        this.project();
        this.stopped = true;
    }

    public cancel(): void {
        if (this.stopped) {
            return;
        }
        this.shownRows = this.shownRows.map(
            (row): PanelRow => (row.status === 'active' ? { id: row.id, status: 'pending', segments: [] } : row),
        );
        this.stopped = true;
    }

    private project(): void {
        let blocked = false;
        this.shownRows = panelRowIds.map((id): PanelRow => {
            if (!blocked) {
                const settled = this.settledRows.get(id);
                if (settled) {
                    return settled;
                }
                blocked = true;
                if (this.startedRows.has(id)) {
                    return { id, status: 'active', segments: [{ kind: 'checking' }] };
                }
            }
            return { id, status: 'pending', segments: [] };
        });
    }

    private results(id: PanelRowId): readonly CheckResult<FindingCode>[] {
        return this.checks
            .filter((check): boolean => rowForCheck(check.plan.id) === id)
            .flatMap((check): CheckResult<FindingCode>[] =>
                check.targets === undefined
                    ? [...check.results.values()]
                    : check.targets.flatMap((target): CheckResult<FindingCode>[] => {
                          const result = check.results.get(target);
                          return result ? [result] : [];
                      }),
            );
    }

    private settle(id: PanelRowId): PanelRow {
        const results = this.results(id);
        if (results.length === 0) {
            return { id, status: 'skipped', segments: [{ kind: 'notChecked', reason: 'notRun' }] };
        }
        const status = settledStatus(results);
        if (
            results.every(
                (result): boolean =>
                    result.status === 'skipped' &&
                    result.skippedBecause !== undefined &&
                    result.skippedBecause.reason !== 'notApplicable',
            )
        ) {
            const skip = results[0].skippedBecause;
            if (
                skip &&
                skip.reason !== 'notApplicable' &&
                !(id === 'authentication' && skip.reason === 'inputUnavailable')
            ) {
                const becauseRow = skip.checkId === undefined ? undefined : rowForCheck(skip.checkId);
                return {
                    id,
                    status,
                    segments: [{ kind: 'notChecked', reason: skip.reason, ...(becauseRow ? { becauseRow } : {}) }],
                };
            }
        }
        const segments = this.evidence(id, results, status);
        // A timeout with its probe's own wording is already the row's finding (WI-27).
        if (
            results.some((result): boolean =>
                result.findings.some(
                    (finding): boolean => finding.code === 'check.timeout' && !hasSpecificTimeoutWording(finding),
                ),
            )
        ) {
            segments.unshift({ kind: 'timedOut' });
        }
        if (segments.length === 0 && allNotApplicable(results)) {
            segments.push({ kind: 'notApplicable', reason: 'other' });
        }
        return { id, status, segments: segments.slice(0, 4) };
    }

    private finding(
        results: readonly CheckResult<FindingCode>[],
        severity: 'error' | 'warning',
        withTarget = false,
    ): EvidenceSegment[] {
        for (const result of results) {
            const finding = result.findings.find(
                (item): boolean =>
                    item.severity === severity && (item.code !== 'check.timeout' || hasSpecificTimeoutWording(item)),
            );
            if (finding) {
                return [
                    {
                        kind: 'finding',
                        title: this.describe(finding).title,
                        ...(withTarget && result.target !== undefined ? { target: host(result.target) } : {}),
                    },
                ];
            }
        }
        return [];
    }

    private evidence(
        id: PanelRowId,
        results: readonly CheckResult<FindingCode>[],
        status: PanelRowStatus,
    ): EvidenceSegment[] {
        const checkResults = (checkId: string): readonly CheckResult<FindingCode>[] =>
            results.filter((result): boolean => result.checkId === checkId);
        switch (id) {
            case 'setup': {
                const environment = checkResults('environment')[0]?.facts ?? {};
                const extension = checkResults('extensionEnvironment')[0]?.facts ?? {};
                const segments: EvidenceSegment[] = [];
                const remoteKind = text(extension, 'remoteKind');
                if (remoteKind) {
                    segments.push({ kind: 'location', remoteKind });
                }
                const platform = text(environment, 'platform');
                const release = text(environment, 'release');
                const arch = text(environment, 'arch');
                if (platform) {
                    segments.push({ kind: 'platform', platform, ...(release ? { release } : {}) });
                }
                if (arch) {
                    segments.push({ kind: 'arch', arch });
                }
                return segments;
            }
            case 'connectionSettings': {
                const prepare = checkResults('prepare')[0];
                const providerId = text(prepare?.facts ?? {}, 'providerId');
                if (status === 'error') {
                    const segments = this.finding(results, 'error');
                    if (prepare?.status === 'fail' && providerId) {
                        segments.push({ kind: 'preparationFailed', providerId });
                    }
                    if (segments.length > 0) {
                        return segments;
                    }
                }
                const facts = checkResults('connectionString')[0]?.facts ?? {};
                const segments: EvidenceSegment[] = [];
                if (facts.scheme === 'mongodb' || facts.scheme === 'mongodb+srv') {
                    segments.push({ kind: 'scheme', scheme: facts.scheme });
                }
                const userName = text(facts, 'userName');
                if (userName) {
                    segments.push({ kind: 'user', userName });
                }
                if (Array.isArray(facts.options)) {
                    segments.push({ kind: 'optionCount', count: facts.options.length });
                }
                if (prepare?.status === 'pass' && providerId) {
                    segments.push({ kind: 'preparedBy', providerId });
                }
                return segments;
            }
            case 'serverAddress': {
                const dns = checkResults('dns');
                const srv = checkResults('srv')[0];
                if (allNotApplicable(dns) && srv?.skippedBecause?.reason === 'notApplicable') {
                    return [{ kind: 'notApplicable', reason: 'ipAddress' }];
                }
                const segments = status === 'error' ? this.finding(results, 'error', true) : [];
                if (srv?.status === 'pass' && Array.isArray(srv.facts.records)) {
                    segments.push({ kind: 'srvHosts', count: srv.facts.records.length });
                }
                const targetedDns = dns.filter((result): boolean => result.target !== undefined);
                if (targetedDns.length > 0) {
                    const resolved = targetedDns.filter(
                        (result): boolean =>
                            result.status === 'pass' ||
                            result.status === 'warning' ||
                            result.skippedBecause?.reason === 'notApplicable',
                    );
                    segments.push({ kind: 'resolved', resolved: resolved.length, total: targetedDns.length });
                }
                if (
                    dns.some((result): boolean =>
                        result.findings.some((finding): boolean => finding.code === 'dns.privateEndpoint'),
                    )
                ) {
                    segments.push({ kind: 'privateEndpoint' });
                }
                return segments;
            }
            case 'networkConnection': {
                const tcp = checkResults('tcp');
                const segments =
                    status === 'error'
                        ? this.finding(
                              tcp.filter((result): boolean => result.status === 'fail'),
                              'error',
                              true,
                          )
                        : [];
                segments.push({
                    kind: 'reachable',
                    reachable: tcp.filter((result): boolean => result.status === 'pass').length,
                    total: tcp.length,
                });
                const commonPort = port(tcp[0]?.target);
                if (commonPort !== undefined && tcp.every((result): boolean => port(result.target) === commonPort)) {
                    segments.push({ kind: 'port', port: commonPort });
                }
                return segments;
            }
            case 'secureConnection': {
                const tls = checkResults('tls');
                if (allNotApplicable(tls)) {
                    return [{ kind: 'notApplicable', reason: 'tlsOff' }];
                }
                const passed = tls.find((result): boolean => result.status === 'pass');
                const protocol = text(
                    (passed ?? tls.find((result): boolean => text(result.facts, 'protocol') !== undefined))?.facts ??
                        {},
                    'protocol',
                );
                if (status === 'error') {
                    const segments = this.finding(tls, 'error', true);
                    if (segments.length > 0) {
                        return segments;
                    }
                }
                if (status === 'warning') {
                    const segments = this.finding(tls, 'warning');
                    if (protocol) {
                        segments.push({ kind: 'tlsProtocol', protocol });
                    }
                    return segments;
                }
                const segments: EvidenceSegment[] = [];
                if (protocol) {
                    segments.push({ kind: 'tlsProtocol', protocol });
                }
                if (passed) {
                    segments.push({ kind: 'certificateTrusted' });
                    const date = text(record(passed.facts.certificate), 'validTo');
                    if (date && Number.isFinite(Date.parse(date))) {
                        segments.push({ kind: 'validUntil', date: new Date(date).toISOString() });
                    }
                }
                return segments;
            }
            case 'serverResponse': {
                const hello = checkResults('hello');
                const facts = hello.find((result): boolean => result.status === 'pass')?.facts ?? {};
                const segments = status === 'error' ? this.finding(hello, 'error', true) : [];
                const topology = text(facts, 'topology');
                const setName = text(facts, 'setName');
                if (topology) {
                    segments.push({
                        kind: 'topology',
                        topology,
                        ...(topology === 'replicaSet' && setName ? { setName } : {}),
                    });
                }
                if (topology === 'replicaSet' && (facts.isWritablePrimary === true || text(facts, 'primary'))) {
                    segments.push({ kind: 'primaryFound' });
                }
                // Not on an error line, where the finding needs the room (four segments at most).
                if (status !== 'error' && hello.some((result): boolean => result.status === 'pass')) {
                    segments.push({ kind: 'answeredBeforeSignIn' });
                }
                const clock = hello
                    .flatMap((result): readonly Finding<FindingCode>[] => result.findings)
                    .find((finding): boolean => finding.code === 'hello.clockOffset');
                const offsetMs = clock?.data?.offsetMs;
                if (typeof offsetMs === 'number' && Number.isFinite(offsetMs)) {
                    segments.push({ kind: 'clockOffset', offsetMs });
                }
                return segments;
            }
            case 'authentication': {
                const auth = checkResults('authenticate')[0];
                if (!auth) {
                    return [];
                }
                const methods = {
                    NativeAuth: 'native',
                    MicrosoftEntraID: 'entraId',
                    ManagedIdentity: 'managedIdentity',
                    NoAuth: 'none',
                } as const;
                const method = text(auth.facts, 'authMethod');
                const knownMethod =
                    method && Object.hasOwn(methods, method) ? methods[method as keyof typeof methods] : undefined;
                const segments: EvidenceSegment[] = knownMethod ? [{ kind: 'authMethod', method: knownMethod }] : [];
                const findings = [
                    ...auth.findings,
                    ...(auth.steps ?? []).flatMap((step): readonly Finding<FindingCode>[] => step.findings),
                ];
                const configuration =
                    auth.steps?.find((step): boolean => step.stepId === 'auth.signInConfiguration')?.facts ?? {};
                const mismatch = findings.find((finding): boolean => finding.code === 'auth.cloudMismatch');
                if (mismatch) {
                    const clusterCloud = text(mismatch.data ?? {}, 'hostCloud');
                    const signedInCloud = text(mismatch.data ?? {}, 'configuredCloud');
                    if (clusterCloud) {
                        segments.push({ kind: 'clusterCloud', cloud: clusterCloud });
                    }
                    if (signedInCloud) {
                        segments.push({ kind: 'signedInCloud', cloud: signedInCloud });
                    }
                    return segments;
                }
                if (
                    findings.some(
                        (finding): boolean =>
                            finding.code === 'auth.credentialsUnavailable' && finding.data?.missing === 'entraSession',
                    )
                ) {
                    return [...segments, { kind: 'noSilentSignIn' }];
                }
                if (findings.some((finding): boolean => finding.code === 'auth.entraTokenFailed')) {
                    return [...segments, { kind: 'signInFailed' }];
                }
                if (
                    (knownMethod === 'entraId' || knownMethod === 'managedIdentity') &&
                    findings.some((finding): boolean => finding.code === 'auth.failed')
                ) {
                    return [...segments, { kind: 'signedInNotAccepted' }];
                }
                if (knownMethod === 'native' && findings.some((finding): boolean => finding.code === 'auth.failed')) {
                    return [...segments, { kind: 'credentialsRejected' }];
                }
                // The driver reached no server: say so, rather than a title that reads like a credential problem.
                if (
                    status === 'error' &&
                    findings.some((finding): boolean => finding.code === 'auth.serverSelectionTimeout')
                ) {
                    return [
                        ...segments,
                        { kind: 'serverNotReached' },
                        ...(knownMethod === 'none' ? [] : [{ kind: 'signInNotTested' } as const]),
                    ];
                }
                if (status === 'error' || status === 'skipped') {
                    const finding = findings.find(
                        (item): boolean =>
                            (item.severity === 'error' && item.code !== 'check.timeout') ||
                            item.code === 'auth.credentialsUnavailable',
                    );
                    if (finding) {
                        segments.push({ kind: 'finding', title: this.describe(finding).title });
                    }
                    return segments;
                }
                const account = text(auth.facts, 'account') ?? text(auth.facts, 'userName');
                if (account) {
                    segments.push({ kind: 'account', label: account });
                }
                if (
                    auth.facts.managedIdentityKind === 'systemAssigned' ||
                    auth.facts.managedIdentityKind === 'userAssigned'
                ) {
                    segments.push({ kind: 'managedIdentityKind', identityKind: auth.facts.managedIdentityKind });
                }
                const cloud = configuration.configuredCloud;
                if (knownMethod === 'entraId' && cloud === 'AzureUSGovernment') {
                    segments.push({ kind: 'cloud', cloud: 'usGovernment' });
                }
                if (knownMethod === 'entraId' && cloud === 'AzureChinaCloud') {
                    segments.push({ kind: 'cloud', cloud: 'china' });
                }
                if (knownMethod === 'entraId' && cloud === 'custom') {
                    segments.push({ kind: 'cloud', cloud: 'custom' });
                }
                return segments;
            }
            case 'databaseAccess': {
                const access = checkResults('connectionAccess')[0];
                if (access?.status === 'fail') {
                    return this.finding([access], 'error');
                }
                const denied = access?.findings.find(
                    (finding): boolean => finding.code === 'access.listDatabasesDenied',
                );
                if (denied) {
                    return [{ kind: 'connected' }, { kind: 'finding', title: this.describe(denied).title }];
                }
                const segments: EvidenceSegment[] = [];
                const pingMs = access?.facts.pingMs;
                if (typeof pingMs === 'number' && Number.isFinite(pingMs)) {
                    segments.push({ kind: 'ping', ms: pingMs });
                }
                if (access?.findings.some((finding): boolean => finding.code === 'access.signInRequired')) {
                    return segments.length > 0
                        ? [...segments, { kind: 'listingNeedsSignIn' }]
                        : [{ kind: 'connected' }, { kind: 'listingNeedsSignIn' }];
                }
                const count = access?.facts.databaseCount;
                if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
                    segments.push({ kind: 'databasesVisible', count });
                }
                if (status === 'warning') {
                    segments.push(...this.finding(results, 'warning'));
                }
                return segments;
            }
        }
    }
}
