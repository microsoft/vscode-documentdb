/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as ConnectivityTroubleshooter from '@documentdb-js/connectivity-troubleshooter';
import {
    createBuiltInChecks,
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type Finding,
    type RunContext,
    type TroubleshooterEvent,
} from '@documentdb-js/connectivity-troubleshooter';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import {
    panelRowIds,
    type PanelRow,
    type PanelRowId,
} from '../webviews/documentdb/connectivityTroubleshooter/panelTypes';
import { describeFinding } from './findingMessages';
import { PanelRowProjector } from './panelRows';
import { getPlannedTroubleshooterChecks, runConnectivityTroubleshooter } from './runTroubleshooter';
import { type FindingCode } from './types';

vi.mock('@microsoft/vscode-azext-utils', async () => ({
    ...(await vi.importActual<Record<string, unknown>>('@microsoft/vscode-azext-utils')),
    callWithTelemetryAndErrorHandling: async <T>(
        _name: string,
        callback: (context: IActionContext) => Promise<T>,
    ): Promise<T> =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
        } as unknown as IActionContext),
}));
vi.mock('@documentdb-js/connectivity-troubleshooter', async () => ({
    ...(await vi.importActual<typeof ConnectivityTroubleshooter>('@documentdb-js/connectivity-troubleshooter')),
    createBuiltInChecks: vi.fn(),
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: { info: vi.fn() },
        context: { extensionMode: 1, extension: { packageJSON: { version: '1.2.3' } } },
    },
}));
vi.mock('../documentdb/auth/documentdbTokenResource', () => ({ describeEntraSignInEnvironment: (): object => ({}) }));

const planned = [
    { id: 'environment', scope: 'run' },
    { id: 'extensionEnvironment', scope: 'run' },
    { id: 'connectionString', scope: 'run' },
    { id: 'credentials', scope: 'run' },
    { id: 'prepare', scope: 'run' },
    { id: 'srv', scope: 'run' },
    { id: 'dns', scope: 'host' },
    { id: 'tcp', scope: 'host' },
    { id: 'tls', scope: 'host' },
    { id: 'hello', scope: 'host' },
    { id: 'authenticate', scope: 'run' },
    { id: 'connectionAccess', scope: 'run' },
    { id: 'serverFacts', scope: 'run' },
] as const;
const targets = ['a.test:27017', 'b.test:27017', 'c.test:27017'];

function finding(
    code: FindingCode,
    severity: 'info' | 'warning' | 'error' = 'error',
    data?: Readonly<Record<string, unknown>>,
): Finding<FindingCode> {
    return {
        code,
        severity,
        data,
        detail: { language: 'en', text: 'Do not display: AADSTS http://private.example rule-id 123 ms' },
    };
}

function result(checkId: string, options: Partial<CheckResult<FindingCode>> = {}): CheckResult<FindingCode> {
    return { checkId, status: 'pass', durationMs: 12345, findings: [], facts: {}, ...options };
}

function complete(
    projector: PanelRowProjector,
    checkId: string,
    options: Partial<CheckResult<FindingCode>> = {},
    runId = 'run',
): void {
    projector.apply({ type: 'checkFinished', runId, at: 98765, result: result(checkId, options) });
}

function start(projector: PanelRowProjector, checkId: string, target?: string): void {
    projector.apply({ type: 'checkStarted', runId: 'run', checkId, target, at: 98765 });
}

function phase(
    projector: PanelRowProjector,
    phaseTargets: readonly string[] = targets,
    checkIds: readonly string[] = ['dns', 'tcp', 'tls', 'hello'],
): void {
    projector.apply({ type: 'hostPhaseStarted', runId: 'run', checkIds, targets: phaseTargets, at: 98765 });
}

function row(projector: PanelRowProjector, id: PanelRowId): PanelRow {
    const value = projector.rows().find((item): boolean => item.id === id);
    if (!value) {
        throw new Error('Missing panel row');
    }
    return value;
}

function setup(projector: PanelRowProjector): void {
    complete(projector, 'environment', {
        facts: { platform: 'linux', release: '6.8', arch: 'x64', nodeVersion: '22', localTime: '2026-10-29' },
    });
    complete(projector, 'extensionEnvironment', { facts: { remoteKind: 'ssh' } });
}

function settings(projector: PanelRowProjector): void {
    complete(projector, 'connectionString', {
        facts: { scheme: 'mongodb', userName: 'alice', options: [{ name: 'tls' }, { name: 'replicaSet' }] },
    });
    complete(projector, 'credentials');
    complete(projector, 'prepare', { facts: { providerId: 'kubernetes' } });
}

function ready(projector: PanelRowProjector): void {
    setup(projector);
    settings(projector);
    complete(projector, 'srv', { status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
    phase(projector);
}

function hostResults(
    projector: PanelRowProjector,
    checkId: string,
    options: Partial<CheckResult<FindingCode>> = {},
): void {
    for (const target of targets) {
        complete(projector, checkId, { ...options, target });
    }
}

afterEach((): void => {
    vi.restoreAllMocks();
});

describe('PanelRowProjector', (): void => {
    it('always starts with the same eight pending rows, even with no planned checks', (): void => {
        for (const checks of [planned, []]) {
            const projector = new PanelRowProjector(describeFinding, checks);
            expect(projector.rows()).toEqual(
                panelRowIds.map((id): PanelRow => ({ id, status: 'pending', segments: [] })),
            );
        }
    });

    it('buffers concurrent host results top to bottom and one event can reveal several settled rows', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        ready(projector);
        complete(projector, 'dns', { target: targets[1] });
        complete(projector, 'tcp', { target: targets[1] });
        start(projector, 'dns', targets[0]);
        start(projector, 'tls', targets[1]);
        expect(row(projector, 'serverAddress')).toMatchObject({ status: 'active', segments: [{ kind: 'checking' }] });
        expect(
            projector
                .rows()
                .slice(3)
                .every((item): boolean => item.status === 'pending' && item.segments.length === 0),
        ).toBe(true);
        // TCP and TLS can already have results buffered while the final DNS result is outstanding.
        for (const target of [targets[0], targets[2]]) {
            complete(projector, 'tcp', { target });
        }
        hostResults(projector, 'tls', { status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        complete(projector, 'dns', { target: targets[2] });
        expect(row(projector, 'networkConnection').status).toBe('pending');
        complete(projector, 'dns', { target: targets[0] });
        expect(
            projector
                .rows()
                .slice(2, 5)
                .map((item): string => item.status),
        ).toEqual(['done', 'done', 'skipped']);
        expect(row(projector, 'networkConnection').segments).toEqual([
            { kind: 'reachable', reachable: 3, total: 3 },
            { kind: 'port', port: 27017 },
        ]);
    });

    it('waits for all planned connection checks and emits four secret-free settings segments', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        setup(projector);
        expect(row(projector, 'setup').segments).toEqual([
            { kind: 'location', remoteKind: 'ssh' },
            { kind: 'platform', platform: 'linux', release: '6.8' },
            { kind: 'arch', arch: 'x64' },
        ]);
        start(projector, 'connectionString');
        complete(projector, 'connectionString', {
            facts: { scheme: 'mongodb+srv', userName: 'alice', options: [{}, {}], password: 'never-output' },
        });
        expect(row(projector, 'connectionSettings').status).toBe('active');
        complete(projector, 'credentials');
        expect(row(projector, 'connectionSettings').status).toBe('active');
        complete(projector, 'prepare', { facts: { providerId: 'kubernetes' } });
        expect(row(projector, 'connectionSettings')).toEqual({
            id: 'connectionSettings',
            status: 'done',
            segments: [
                { kind: 'scheme', scheme: 'mongodb+srv' },
                { kind: 'user', userName: 'alice' },
                { kind: 'optionCount', count: 2 },
                { kind: 'preparedBy', providerId: 'kubernetes' },
            ],
        });
    });

    it('identifies local execution only when the environment check establishes it', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        complete(projector, 'environment', { facts: { platform: 'win32', arch: 'x64' } });
        complete(projector, 'extensionEnvironment', { facts: { remoteKind: 'local' } });
        expect(row(projector, 'setup').segments).toEqual([
            { kind: 'location', remoteKind: 'local' },
            { kind: 'platform', platform: 'win32' },
            { kind: 'arch', arch: 'x64' },
        ]);
    });

    it('shows connection errors as localized titles and preparation failures semantically', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        setup(projector);
        complete(projector, 'connectionString', { status: 'fail', findings: [finding('cs.unparseable')] });
        complete(projector, 'credentials', {
            status: 'skipped',
            skippedBecause: { reason: 'dependencyFailed', checkId: 'connectionString' },
        });
        complete(projector, 'prepare', { status: 'fail', facts: { providerId: 'kubernetes', elapsedMs: 999 } });
        expect(row(projector, 'connectionSettings').segments).toEqual([
            { kind: 'finding', title: describeFinding(finding('cs.unparseable')).title },
            { kind: 'preparationFailed', providerId: 'kubernetes' },
        ]);
    });

    it('keeps IP address DNS and disabled TLS rows as explained skips', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        ready(projector);
        hostResults(projector, 'dns', { status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(row(projector, 'serverAddress')).toMatchObject({
            status: 'skipped',
            segments: [{ kind: 'notApplicable', reason: 'ipAddress' }],
        });
        hostResults(projector, 'tcp');
        hostResults(projector, 'tls', { status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(row(projector, 'secureConnection')).toMatchObject({
            status: 'skipped',
            segments: [{ kind: 'notApplicable', reason: 'tlsOff' }],
        });
    });

    it('aggregates a DNS failure among three hosts and leaves the other two reachable', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        ready(projector);
        complete(projector, 'dns', { target: targets[2], status: 'fail', findings: [finding('dns.notFound')] });
        complete(projector, 'dns', { target: targets[1], findings: [finding('dns.privateEndpoint', 'info')] });
        complete(projector, 'dns', { target: targets[0] });
        expect(row(projector, 'serverAddress')).toMatchObject({
            status: 'error',
            segments: [
                { kind: 'finding', title: describeFinding(finding('dns.notFound')).title, target: 'c.test' },
                { kind: 'resolved', resolved: 2, total: 3 },
                { kind: 'privateEndpoint' },
            ],
        });
        complete(projector, 'tcp', {
            target: targets[2],
            status: 'skipped',
            skippedBecause: { reason: 'dependencyFailed', checkId: 'dns' },
        });
        complete(projector, 'tcp', { target: targets[1] });
        complete(projector, 'tcp', { target: targets[0] });
        expect(row(projector, 'networkConnection')).toMatchObject({
            status: 'done',
            segments: [
                { kind: 'reachable', reachable: 2, total: 3 },
                { kind: 'port', port: 27017 },
            ],
        });
    });

    it('uses planned target order rather than completion order for the first failure and handles IPv6 hosts', (): void => {
        const projector = new PanelRowProjector(describeFinding, [{ id: 'tcp', scope: 'host' }]);
        phase(projector, ['[::1]:10260', 'b.test:10260'], ['tcp']);
        complete(projector, 'tcp', { target: 'b.test:10260', status: 'fail', findings: [finding('tcp.unreachable')] });
        complete(projector, 'tcp', { target: '[::1]:10260', status: 'fail', findings: [finding('tcp.refused')] });
        projector.finish();
        expect(row(projector, 'networkConnection').segments).toEqual([
            { kind: 'finding', title: describeFinding(finding('tcp.refused')).title, target: '::1' },
            { kind: 'reachable', reachable: 0, total: 2 },
            { kind: 'port', port: 10260 },
        ]);
    });

    it('reports SRV, resolved and IP-literal hosts without exposing records', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        setup(projector);
        settings(projector);
        complete(projector, 'srv', {
            facts: { records: [{ name: 'a.test' }, { name: 'b.test' }, { name: 'c.test' }] },
        });
        phase(projector);
        complete(projector, 'dns', { target: targets[0] });
        complete(projector, 'dns', { target: targets[1], status: 'warning' });
        complete(projector, 'dns', {
            target: targets[2],
            status: 'skipped',
            skippedBecause: { reason: 'notApplicable' },
        });
        expect(row(projector, 'serverAddress')).toMatchObject({
            status: 'warning',
            segments: [
                { kind: 'srvHosts', count: 3 },
                { kind: 'resolved', resolved: 3, total: 3 },
            ],
        });
    });

    it.each(['pass', 'warning', 'fail'] as const)(
        'projects TLS %s evidence, with trust only on a pass',
        (status): void => {
            const projector = new PanelRowProjector(describeFinding, planned);
            ready(projector);
            hostResults(projector, 'dns');
            hostResults(projector, 'tcp');
            hostResults(projector, 'tls', {
                status,
                facts: { protocol: 'TLSv1.3', certificate: { validTo: '2027-03-01T00:00:00.000Z' } },
                findings: status === 'pass' ? [] : [finding('tls.expired', status === 'warning' ? 'warning' : 'error')],
            });
            const segments = row(projector, 'secureConnection').segments;
            if (status === 'pass') {
                expect(segments).toEqual([
                    { kind: 'tlsProtocol', protocol: 'TLSv1.3' },
                    { kind: 'certificateTrusted' },
                    { kind: 'validUntil', date: '2027-03-01T00:00:00.000Z' },
                ]);
            } else {
                expect(segments[0]).toEqual({
                    kind: 'finding',
                    title: describeFinding(finding('tls.expired')).title,
                    ...(status === 'fail' ? { target: 'a.test' } : {}),
                });
                expect(segments.some((segment): boolean => segment.kind === 'certificateTrusted')).toBe(false);
                if (status === 'warning') {
                    expect(segments[1]).toEqual({ kind: 'tlsProtocol', protocol: 'TLSv1.3' });
                }
            }
        },
    );

    it.each(['documentdbGateway', 'replicaSet', 'standalone'])(
        'projects %s hello and a clock offset only when diagnosed',
        (topology): void => {
            const projector = new PanelRowProjector(describeFinding, planned);
            ready(projector);
            hostResults(projector, 'dns');
            hostResults(projector, 'tcp');
            hostResults(projector, 'tls');
            hostResults(projector, 'hello', {
                facts: { topology, setName: 'rs0', isWritablePrimary: true, clockOffsetMs: 999, roundTripMs: 123 },
                findings: [finding('hello.clockOffset', 'info', { offsetMs: -720000, uncertaintyMs: 42 })],
            });
            expect(row(projector, 'serverResponse').segments).toEqual([
                { kind: 'topology', topology, ...(topology === 'replicaSet' ? { setName: 'rs0' } : {}) },
                ...(topology === 'replicaSet' ? [{ kind: 'primaryFound' }] : []),
                { kind: 'answeredBeforeSignIn' },
                { kind: 'clockOffset', offsetMs: -720000 },
            ]);
        },
    );

    it.each(['dependencyFailed', 'dependencySkipped', 'inputUnavailable', 'runTimeoutExceeded'] as const)(
        'explains %s skips with an originating row when known',
        (reason): void => {
            const projector = new PanelRowProjector(describeFinding, planned);
            ready(projector);
            hostResults(projector, 'dns');
            hostResults(projector, 'tcp', {
                status: 'skipped',
                skippedBecause: { reason, ...(reason.startsWith('dependency') ? { checkId: 'dns' } : {}) },
            });
            expect(row(projector, 'networkConnection')).toMatchObject({
                status: 'skipped',
                segments: [
                    {
                        kind: 'notChecked',
                        reason,
                        ...(reason.startsWith('dependency') ? { becauseRow: 'serverAddress' } : {}),
                    },
                ],
            });
        },
    );

    it('settles an empty-target phase from one untargeted result per planned check', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        setup(projector);
        settings(projector);
        complete(projector, 'srv', { status: 'fail', findings: [finding('srv.notFound')] });
        phase(projector, []);
        complete(projector, 'dns', { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' } });
        expect(row(projector, 'serverAddress').status).toBe('error');
        for (const checkId of ['tcp', 'tls', 'hello']) {
            complete(projector, checkId, { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' } });
        }
        expect(row(projector, 'serverResponse').status).toBe('skipped');
    });

    it("uses each host phase's own target list, not the targets of an earlier phase", (): void => {
        const projector = new PanelRowProjector(describeFinding, [
            { id: 'environment', scope: 'run' },
            { id: 'connectionString', scope: 'run' },
            { id: 'dns', scope: 'host' },
            { id: 'tcp', scope: 'host' },
        ]);
        complete(projector, 'environment');
        complete(projector, 'connectionString');
        phase(projector, ['first.test:27017'], ['dns']);
        complete(projector, 'dns', { target: 'first.test:27017' });
        expect(row(projector, 'serverAddress').status).toBe('done');
        phase(projector, ['second.test:27018', 'third.test:27018'], ['tcp']);
        complete(projector, 'tcp', { target: 'second.test:27018' });
        expect(row(projector, 'networkConnection').status).toBe('pending');
        complete(projector, 'tcp', { target: 'third.test:27018' });
        expect(row(projector, 'networkConnection')).toMatchObject({
            status: 'done',
            segments: [
                { kind: 'reachable', reachable: 2, total: 2 },
                { kind: 'port', port: 27018 },
            ],
        });
    });

    it('shows timeouts semantically, retaining partial evidence and at most four segments', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        setup(projector);
        complete(projector, 'connectionString', { facts: { scheme: 'mongodb', userName: 'alice', options: [{}, {}] } });
        complete(projector, 'credentials');
        complete(projector, 'prepare', {
            status: 'fail',
            findings: [finding('check.timeout', 'error', { timeoutMs: 15000, operation: 'prepare' })],
        });
        expect(row(projector, 'connectionSettings').segments).toEqual([
            { kind: 'timedOut' },
            { kind: 'scheme', scheme: 'mongodb' },
            { kind: 'user', userName: 'alice' },
            { kind: 'optionCount', count: 2 },
        ]);
    });

    it('finishes absent authentication and database checks as not run and never regresses a settled row', (): void => {
        const projector = new PanelRowProjector(
            describeFinding,
            planned.filter(
                (check): boolean =>
                    check.id !== 'authenticate' && check.id !== 'connectionAccess' && check.id !== 'serverFacts',
            ),
        );
        ready(projector);
        hostResults(projector, 'dns');
        hostResults(projector, 'tcp');
        hostResults(projector, 'tls');
        hostResults(projector, 'hello');
        const before = row(projector, 'setup');
        complete(projector, 'environment', { status: 'fail' });
        expect(row(projector, 'setup')).toBe(before);
        expect(row(projector, 'authentication').status).toBe('pending');
        projector.finish();
        for (const id of ['authentication', 'databaseAccess'] as const) {
            expect(row(projector, id)).toEqual({
                id,
                status: 'skipped',
                segments: [{ kind: 'notChecked', reason: 'notRun' }],
            });
        }
        const snapshot = projector.rows();
        projector.finish();
        projector.cancel();
        complete(projector, 'authenticate');
        expect(projector.rows()).toBe(snapshot);
    });

    it('keeps shown settled rows on cancellation, resets active to pending and discards buffered and later results', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        ready(projector);
        start(projector, 'dns', targets[0]);
        hostResults(projector, 'tcp');
        const settled = projector.rows().slice(0, 2);
        projector.cancel();
        expect(projector.rows().slice(0, 2)).toEqual(settled);
        expect(
            projector
                .rows()
                .slice(2)
                .every((item): boolean => item.status === 'pending' && item.segments.length === 0),
        ).toBe(true);
        const snapshot = projector.rows();
        hostResults(projector, 'dns');
        phase(projector, []);
        projector.finish();
        projector.cancel();
        expect(projector.rows()).toBe(snapshot);
    });

    it('ignores all foreign-run events, including host phases and completion', (): void => {
        const projector = new PanelRowProjector(describeFinding, planned);
        start(projector, 'environment');
        complete(projector, 'environment', {}, 'foreign');
        projector.apply({ type: 'hostPhaseStarted', runId: 'foreign', checkIds: ['dns'], targets: [], at: 0 });
        expect(row(projector, 'setup').status).toBe('active');
        setup(projector);
        settings(projector);
        complete(projector, 'srv', { status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        complete(projector, 'dns');
        expect(row(projector, 'serverAddress').status).toBe('pending');
    });

    it('ignores unknown checks, caps evidence and never projects codes, English details, URIs or timings', (): void => {
        const projector = new PanelRowProjector(describeFinding, [
            ...planned,
            { id: 'contextHints', scope: 'run' },
            { id: 'toString', scope: 'run' },
        ]);
        ready(projector);
        hostResults(projector, 'dns');
        hostResults(projector, 'tcp');
        hostResults(projector, 'tls');
        hostResults(projector, 'hello', {
            facts: {
                topology: 'documentdbGateway',
                isWritablePrimary: true,
                resource: 'http://private',
                ruleId: 'hidden',
                durationMs: 12345,
            },
            findings: [finding('hello.clockOffset', 'info', { offsetMs: 720000 })],
        });
        complete(projector, 'authenticate', {
            status: 'fail',
            findings: [finding('auth.failed', 'error', { code: 'AADSTS123', resource: 'http://private' })],
        });
        complete(projector, 'connectionAccess', {
            status: 'warning',
            findings: [finding('access.noDatabasesVisible', 'warning')],
        });
        complete(projector, 'serverFacts');
        complete(projector, 'contextHints', { status: 'fail' });
        complete(projector, 'toString', { status: 'fail' });
        projector.finish();
        expect(row(projector, 'authentication').segments).toEqual([
            { kind: 'finding', title: describeFinding(finding('auth.failed')).title },
        ]);
        expect(row(projector, 'databaseAccess').status).toBe('warning');
        const serialized = JSON.stringify(projector.rows());
        for (const forbidden of [
            'hello.clockOffset',
            'auth.failed',
            'access.noDatabasesVisible',
            'AADSTS',
            'http',
            '12345',
            '98765',
            'ruleId',
            'durationMs',
            'Do not display',
        ]) {
            expect(serialized).not.toContain(forbidden);
        }
        expect(projector.rows()).toHaveLength(8);
        expect(projector.rows().every((item): boolean => item.segments.length <= 4)).toBe(true);
    });
});

describe('planned troubleshooter checks', (): void => {
    it.each([false, true])(
        'matches ordered IDs and scopes actually executed, with extra checks: %s',
        async (withExtra): Promise<void> => {
            const builtIns: Check<RunContext, BuiltInFindingCode>[] = [
                'environment',
                'connectionString',
                'srv',
                'dns',
                'tcp',
                'tls',
                'hello',
            ].map(
                (id): Check<RunContext, BuiltInFindingCode> => ({
                    id,
                    scope: ['dns', 'tcp', 'tls', 'hello'].includes(id) ? 'host' : 'run',
                    async run(context): Promise<CheckOutcome<BuiltInFindingCode>> {
                        if (id === 'connectionString') {
                            context.setTargets([
                                { host: 'a.test', port: 27017, source: 'uri' },
                                { host: 'b.test', port: 27017, source: 'uri' },
                            ]);
                        }
                        return { status: 'pass', facts: {}, findings: [] };
                    },
                }),
            );
            vi.mocked(createBuiltInChecks).mockReturnValue(builtIns);
            const extra: readonly Check<RunContext, FindingCode>[] | undefined = withExtra
                ? [
                      {
                          id: 'consumerCheck',
                          scope: 'run',
                          async run(): Promise<CheckOutcome<FindingCode>> {
                              return { status: 'pass', facts: {}, findings: [] };
                          },
                      },
                  ]
                : undefined;
            const plan = getPlannedTroubleshooterChecks(extra);
            // Authentication is part of the default plan, so the Authentication row always has a check.
            expect(plan.slice(-(withExtra ? 5 : 4), withExtra ? -1 : undefined)).toEqual([
                { id: 'authenticate', scope: 'run' },
                { id: 'connectionAccess', scope: 'run' },
                { id: 'serverFacts', scope: 'run' },
                { id: 'contextHints', scope: 'run' },
            ]);
            const observed: TroubleshooterEvent<FindingCode>[] = [];
            const projector = new PanelRowProjector(describeFinding, plan);
            const foreign = new PanelRowProjector(describeFinding, plan);
            start(foreign, 'environment');
            const foreignSnapshot = foreign.rows();
            const run = await runConnectivityTroubleshooter({
                target: {
                    clusterId: 'fixture',
                    displayName: 'fixture',
                    sourceView: 'connections',
                    async getCredentials(): Promise<EphemeralClusterCredentials> {
                        return { connectionString: 'mongodb://a.test', availableAuthMethods: [] };
                    },
                },
                entryPoint: 'contextMenu',
                runTrigger: 'initial',
                runIndex: 1,
                troubleshooterSessionId: 'fixture',
                timeoutProfile: 'default',
                signal: new AbortController().signal,
                extraChecks: extra,
                onEvent: (event): void => {
                    observed.push(event);
                    projector.apply(event);
                    foreign.apply(event);
                },
            });
            const executed = new Map(
                run.results.map((entry): [string, { id: string; scope: 'run' | 'host' }] => [
                    entry.checkId,
                    { id: entry.checkId, scope: entry.target === undefined ? 'run' : 'host' },
                ]),
            );
            expect(plan).toEqual([...executed.values()]);
            expect(foreign.rows()).toBe(foreignSnapshot);
            expect(
                projector.rows().every((item): boolean => item.status !== 'pending' && item.status !== 'active'),
            ).toBe(true);
            expect(
                new Set(
                    observed
                        .filter((event): boolean => event.type === 'checkFinished')
                        .map((event): string => (event.type === 'checkFinished' ? event.result.checkId : '')),
                ),
            ).toEqual(new Set(plan.map((check): string => check.id)));
        },
    );
});

describe('Authentication and Database access evidence', (): void => {
    function authentication(options: Partial<CheckResult<FindingCode>>): PanelRow {
        const projector = new PanelRowProjector(describeFinding, [{ id: 'authenticate', scope: 'run' }]);
        complete(projector, 'authenticate', options);
        projector.finish();
        return row(projector, 'authentication');
    }

    function databaseAccess(
        options: Partial<CheckResult<FindingCode>>,
        server: Partial<CheckResult<FindingCode>> = {},
    ): PanelRow {
        const projector = new PanelRowProjector(describeFinding, [
            { id: 'connectionAccess', scope: 'run' },
            { id: 'serverFacts', scope: 'run' },
        ]);
        complete(projector, 'connectionAccess', options);
        complete(projector, 'serverFacts', server);
        projector.finish();
        return row(projector, 'databaseAccess');
    }

    function configuration(facts: Readonly<Record<string, unknown>>): NonNullable<CheckResult<FindingCode>['steps']> {
        return [{ stepId: 'auth.signInConfiguration', status: 'pass', durationMs: 1, facts, findings: [] }];
    }

    it('shows native method and user, and No Authentication without an authenticated claim', (): void => {
        expect(authentication({ facts: { authMethod: 'NativeAuth', userName: 'alice' } }).segments).toEqual([
            { kind: 'authMethod', method: 'native' },
            { kind: 'account', label: 'alice' },
        ]);
        expect(authentication({ facts: { authMethod: 'NoAuth', authenticated: false } }).segments).toEqual([
            { kind: 'authMethod', method: 'none' },
        ]);
    });

    it.each([
        ['AzureCloud', undefined],
        ['AzureUSGovernment', 'usGovernment'],
        ['AzureChinaCloud', 'china'],
        ['custom', 'custom'],
    ] as const)(
        'shows the signed-in account and only non-public cloud evidence for %s',
        (configuredCloud, cloud): void => {
            expect(
                authentication({
                    facts: { authMethod: 'MicrosoftEntraID', account: 'alice@contoso.com' },
                    steps: configuration({ configuredCloud }),
                }).segments,
            ).toEqual([
                { kind: 'authMethod', method: 'entraId' },
                { kind: 'account', label: 'alice@contoso.com' },
                ...(cloud ? [{ kind: 'cloud', cloud }] : []),
            ]);
        },
    );

    it.each(['systemAssigned', 'userAssigned'] as const)('shows managed identity kind %s', (identityKind): void => {
        expect(
            authentication({ facts: { authMethod: 'ManagedIdentity', managedIdentityKind: identityKind } }).segments,
        ).toEqual([
            { kind: 'authMethod', method: 'managedIdentity' },
            { kind: 'managedIdentityKind', identityKind },
        ]);
    });

    it('shows the interactive sign-in cloud even when a custom cloud explicitly uses a public audience', (): void => {
        expect(
            authentication({
                facts: { authMethod: 'MicrosoftEntraID', account: 'alice@contoso.com' },
                steps: configuration({ configuredCloud: 'custom', tokenResource: 'AzureCloud' }),
            }).segments,
        ).toEqual([
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'account', label: 'alice@contoso.com' },
            { kind: 'cloud', cloud: 'custom' },
        ]);
    });

    it('keeps managed identity evidence to its identity kind, not the interactive cloud setting', (): void => {
        expect(
            authentication({
                facts: { authMethod: 'ManagedIdentity', managedIdentityKind: 'userAssigned' },
                steps: configuration({ configuredCloud: 'AzureUSGovernment' }),
            }).segments,
        ).toEqual([
            { kind: 'authMethod', method: 'managedIdentity' },
            { kind: 'managedIdentityKind', identityKind: 'userAssigned' },
        ]);
    });

    it('formats an authentication timeout only once', (): void => {
        expect(authentication({ status: 'fail', findings: [finding('check.timeout')] }).segments).toEqual([
            { kind: 'timedOut' },
        ]);
    });

    it('explains no silent sign-in in the Authentication row instead of a generic skipped message', (): void => {
        expect(
            authentication({
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
                facts: { authMethod: 'MicrosoftEntraID' },
                findings: [finding('auth.credentialsUnavailable', 'info', { missing: 'entraSession' })],
            }),
        ).toMatchObject({
            status: 'skipped',
            segments: [{ kind: 'authMethod', method: 'entraId' }, { kind: 'noSilentSignIn' }],
        });
    });

    it.each(['method', 'password'] as const)(
        'names the unavailable %s without claiming sign-in succeeded',
        (missing): void => {
            const unavailable = finding('auth.credentialsUnavailable', 'info', { missing });
            const projected = authentication({
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
                findings: [unavailable],
                facts: { authMethod: 'NativeAuth' },
            });
            expect(projected.segments).toEqual([
                { kind: 'authMethod', method: 'native' },
                { kind: 'finding', title: describeFinding(unavailable).title },
            ]);
        },
    );

    it('shows a token failure without exposing classifier details', (): void => {
        const token = finding('auth.entraTokenFailed', 'error', {
            ruleId: 'firstPartyPreauthorization',
            aadstsCode: '65002',
            resource: 'https://private.test',
        });
        expect(
            authentication({
                status: 'fail',
                facts: { authMethod: 'MicrosoftEntraID' },
                steps: [{ stepId: 'auth.token', status: 'fail', durationMs: 12345, facts: {}, findings: [token] }],
            }).segments,
        ).toEqual([{ kind: 'authMethod', method: 'entraId' }, { kind: 'signInFailed' }]);
    });

    it.each(['MicrosoftEntraID', 'ManagedIdentity'] as const)(
        'shows %s token accepted by sign-in but rejected by the cluster',
        (authMethod): void => {
            expect(
                authentication({
                    status: 'fail',
                    facts: { authMethod },
                    steps: [
                        {
                            stepId: 'auth.serverAuthentication',
                            status: 'fail',
                            durationMs: 1,
                            facts: {},
                            findings: [finding('auth.failed')],
                        },
                    ],
                }).segments,
            ).toEqual([
                { kind: 'authMethod', method: authMethod === 'MicrosoftEntraID' ? 'entraId' : 'managedIdentity' },
                { kind: 'signedInNotAccepted' },
            ]);
        },
    );

    it('names both clouds on mismatch, not a resource URI or rule ID', (): void => {
        expect(
            authentication({
                status: 'fail',
                facts: { authMethod: 'MicrosoftEntraID' },
                steps: [
                    {
                        stepId: 'auth.signInConfiguration',
                        status: 'fail',
                        durationMs: 1,
                        facts: {},
                        findings: [
                            finding('auth.cloudMismatch', 'error', {
                                hostCloud: 'AzureUSGovernment',
                                configuredCloud: 'AzureCloud',
                            }),
                        ],
                    },
                ],
            }).segments,
        ).toEqual([
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'clusterCloud', cloud: 'AzureUSGovernment' },
            { kind: 'signedInCloud', cloud: 'AzureCloud' },
        ]);
    });

    it('names a custom resource setting failure via the localized finding title', (): void => {
        const unresolved = finding('auth.tokenResourceUnresolved', 'error', { kind: 'customCloudUnresolved' });
        expect(
            authentication({
                status: 'fail',
                facts: { authMethod: 'MicrosoftEntraID' },
                steps: [
                    {
                        stepId: 'auth.signInConfiguration',
                        status: 'fail',
                        durationMs: 1,
                        facts: {},
                        findings: [unresolved],
                    },
                ],
            }).segments,
        ).toEqual([
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'finding', title: describeFinding(unresolved).title },
        ]);
    });

    it('shows ping and database count, including zero and no denied-list claim', (): void => {
        expect(databaseAccess({ facts: { pingMs: 12, databaseCount: 5 } }).segments).toEqual([
            { kind: 'ping', ms: 12 },
            { kind: 'databasesVisible', count: 5 },
        ]);
        expect(databaseAccess({ facts: { pingMs: 0, databaseCount: 0 } }).segments).toEqual([
            { kind: 'ping', ms: 0 },
            { kind: 'databasesVisible', count: 0 },
        ]);
    });

    it('keeps Connected when listing is denied and names the denied command', (): void => {
        const denied = finding('access.listDatabasesDenied', 'warning');
        expect(databaseAccess({ status: 'warning', findings: [denied], facts: { pingMs: 12 } })).toMatchObject({
            status: 'warning',
            segments: [{ kind: 'connected' }, { kind: 'finding', title: describeFinding(denied).title }],
        });
    });

    it('names a ping failure and retains metadata-denied warnings after successful ping', (): void => {
        const timeout = finding('check.timeout', 'warning');
        expect(
            databaseAccess({ status: 'fail', facts: { command: 'ping' }, findings: [finding('tcp.reset')] }).segments,
        ).toEqual([{ kind: 'finding', title: describeFinding(finding('tcp.reset')).title }]);
        const metadata = finding('access.listDatabasesDenied', 'warning');
        expect(databaseAccess({ facts: { pingMs: 12 } }, { status: 'warning', findings: [metadata] }).segments).toEqual(
            [
                { kind: 'ping', ms: 12 },
                { kind: 'finding', title: describeFinding(metadata).title },
            ],
        );
        expect(databaseAccess({ status: 'warning', findings: [timeout] }).segments).toEqual([{ kind: 'timedOut' }]);
    });

    it('keeps dependency and whole-run-timeout evidence when no authentication was attempted', (): void => {
        expect(
            authentication({ status: 'skipped', skippedBecause: { reason: 'runTimeoutExceeded' } }).segments,
        ).toEqual([{ kind: 'notChecked', reason: 'runTimeoutExceeded' }]);
        expect(
            databaseAccess(
                { status: 'skipped', skippedBecause: { reason: 'dependencySkipped', checkId: 'authenticate' } },
                { status: 'skipped', skippedBecause: { reason: 'dependencySkipped', checkId: 'authenticate' } },
            ).segments,
        ).toEqual([{ kind: 'notChecked', reason: 'dependencySkipped', becauseRow: 'authentication' }]);
    });
});
