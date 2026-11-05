/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as ConnectionDiagnostics from '@documentdb-js/connection-diagnostics';
import {
    createBuiltInChecks,
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type DiagnosticsEvent,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as MongoDB from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API, DocumentDBExperience } from '../DocumentDBExperiences';
import { diagnoseConnection } from '../commands/diagnoseConnection/diagnoseConnection';
import { ClustersClient } from '../documentdb/ClustersClient';
import { CredentialCache } from '../documentdb/CredentialCache';
import { Views } from '../documentdb/Views';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { ext } from '../extensionVariables';
import { ConnectionReachabilityService } from '../services/connectionReachabilityService';
import { ConnectionStorageService, ItemType } from '../services/connectionStorageService';
import { DocumentDBClusterItem } from '../tree/connections-view/DocumentDBClusterItem';
import {
    ConnectionEndpointUnavailableError,
    ConnectionInputCancelledError,
    ConnectionSourceUnavailableError,
} from '../tree/documentdb/diagnosticCredentialRead';
import { openConnectionDiagnostics } from '../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController';
import { runConnectionDiagnostics, type RunConnectionDiagnosticsOptions } from './runConnectionDiagnostics';
import { type FindingCode } from './types';

interface RecordedEvent {
    readonly name: string;
    readonly context: IActionContext;
    error?: unknown;
}
const events: RecordedEvent[] = [];
vi.mock('@microsoft/vscode-azext-utils', async () => {
    const actual = await vi.importActual<{ UserCancelledError: typeof UserCancelledError }>(
        '@microsoft/vscode-azext-utils',
    );
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: vi.fn(
            async <T>(name: string, callback: (context: IActionContext) => Promise<T>): Promise<T | undefined> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: {},
                    valuesToMask: [],
                } as unknown as IActionContext;
                const event: RecordedEvent = { name, context };
                events.push(event);
                try {
                    const result = await callback(context);
                    context.telemetry.properties.result = 'Succeeded';
                    return result;
                } catch (error) {
                    event.error = error;
                    context.telemetry.properties.result =
                        error instanceof actual.UserCancelledError ? 'Canceled' : 'Failed';
                    if (context.errorHandling.rethrow) {
                        throw error;
                    }
                    return undefined;
                }
            },
        ),
    };
});
vi.mock('@documentdb-js/connection-diagnostics', async () => ({
    ...(await vi.importActual<typeof ConnectionDiagnostics>('@documentdb-js/connection-diagnostics')),
    createBuiltInChecks: vi.fn(),
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: { info: vi.fn() },
        context: { extensionMode: 1, extension: { packageJSON: { version: '1.2.3' } } },
    },
}));
vi.mock('../documentdb/auth/documentdbTokenResource', () => ({
    describeEntraSignInEnvironment: vi.fn(() => ({ configuredCloud: 'AzureCloud' })),
}));
// The authenticate check creates its own driver client; it never contacts a server in these tests.
const mongo = vi.hoisted(() => ({
    clients: [] as { readonly connectionString: string; readonly close: () => Promise<void> }[],
}));
vi.mock('mongodb', async (importOriginal) => {
    const actual = await importOriginal<typeof MongoDB>();
    class FakeMongoClient {
        public readonly close = vi.fn(async (): Promise<void> => undefined);
        constructor(public readonly connectionString: string) {
            mongo.clients.push(this);
        }
        public async connect(): Promise<this> {
            return this;
        }
        public db(): { command: (document: Record<string, unknown>) => Promise<Record<string, unknown>> } {
            return {
                command: async (document): Promise<Record<string, unknown>> =>
                    document.listDatabases ? { databases: [{ name: 'fixture-db' }] } : { ok: 1 },
            };
        }
    }
    return { ...actual, MongoClient: FakeMongoClient };
});

vi.mock('../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController', () => ({
    openConnectionDiagnostics: vi.fn(),
}));

const host = 'fixture-private.example';
const user = 'fixture-user';
const password = 'fixture-password:@';
const orderedIds = [
    'environment',
    'extensionEnvironment',
    'resolveTarget',
    'connectionString',
    'credentials',
    'prepare',
    'srv',
    'dns',
    'tcp',
    'tls',
    'hello',
    'authenticate',
    'connectionAccess',
    'serverFacts',
    'contextHints',
];

function options(overrides: Partial<RunConnectionDiagnosticsOptions> = {}): RunConnectionDiagnosticsOptions {
    return {
        target: {
            clusterId: 'stable-id',
            displayName: 'Private fixture',
            sourceView: 'connections',
            getCredentials: vi.fn().mockResolvedValue({
                connectionString: `mongodb://${host}/`,
                availableAuthMethods: ['NativeAuth'],
                selectedAuthMethod: 'NativeAuth',
                nativeAuthConfig: { connectionUser: user, connectionPassword: password },
            }),
        },
        entryPoint: 'contextMenu',
        runTrigger: 'initial',
        runIndex: 1,
        diagnosticsSessionId: 'panel-session-id',
        timeoutProfile: 'default',
        signal: new AbortController().signal,
        ...overrides,
    };
}

function builtIns(): Check<RunContext, BuiltInFindingCode>[] {
    return ['environment', 'connectionString', 'srv', 'dns', 'tcp', 'tls', 'hello'].map(
        (id): Check<RunContext, BuiltInFindingCode> => ({
            id,
            scope: ['dns', 'tcp', 'tls', 'hello'].includes(id) ? 'host' : 'run',
            async run(context): Promise<CheckOutcome<BuiltInFindingCode>> {
                if (id === 'connectionString') {
                    context.setTargets([{ host, port: 27017, source: 'uri' }]);
                }
                return { status: 'pass', facts: { host, user }, findings: [] };
            },
        }),
    );
}

function outputLines(): string[] {
    return vi.mocked(ext.outputChannel.info).mock.calls.map((args): string => String(args[0]));
}

function terminalContext(): IActionContext {
    const event = events.find((event): boolean => event.name === 'diagnoseConnection.run');
    if (!event) {
        throw new Error('Missing run event');
    }
    return event.context;
}

describe('runConnectionDiagnostics', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        events.length = 0;
        mongo.clients.length = 0;
        vi.spyOn(CredentialCache, 'getCredentials').mockReturnValue(undefined);
        vi.mocked(createBuiltInChecks).mockReturnValue(builtIns());
        Object.defineProperty(vscode.env, 'remoteName', { value: undefined, configurable: true });
        vi.stubEnv('WSL_DISTRO_NAME', '');
        vi.stubEnv('WSL_INTEROP', '');
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(''),
        } as unknown as vscode.WorkspaceConfiguration);
    });
    afterEach((): void => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.useRealTimers();
        ConnectionReachabilityService.resetForTests();
    });

    it('inserts the extension checks in order and appends consumer checks', async (): Promise<void> => {
        const observed: DiagnosticsEvent<FindingCode>[] = [];
        const extra: Check<RunContext, FindingCode> = {
            id: 'laterPhase',
            scope: 'run',
            run: async (): Promise<CheckOutcome<FindingCode>> => ({ status: 'pass', facts: {}, findings: [] }),
        };
        const run = await runConnectionDiagnostics(
            options({
                extraChecks: [extra],
                onEvent: (event): void => {
                    observed.push(event);
                },
            }),
        );
        expect(run.results.map((result): string => result.checkId)).toEqual([...orderedIds, 'laterPhase']);
        expect(
            observed
                .filter((event): boolean => event.type === 'checkFinished')
                .map((event): string => (event.type === 'checkFinished' ? event.result.checkId : '')),
        ).toEqual([...orderedIds, 'laterPhase']);
        expect(run.results.find((result): boolean => result.checkId === 'prepare')).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'notApplicable' },
        });
    });

    it('uses the supplied run ID in events, Output trace and telemetry', async (): Promise<void> => {
        const observed: DiagnosticsEvent<FindingCode>[] = [];
        const runId = 'caller-generated-run-id';
        const run = await runConnectionDiagnostics(
            options({
                runId,
                onEvent: (event): void => {
                    observed.push(event);
                },
            }),
        );
        expect(run.runId).toBe(runId);
        expect(observed.length).toBeGreaterThan(0);
        expect(observed.every((event): boolean => event.runId === runId)).toBe(true);
        expect(outputLines().length).toBeGreaterThan(0);
        expect(outputLines().every((line): boolean => line.includes(`run=${runId} `))).toBe(true);
        expect(events).toHaveLength(2);
        for (const event of events) {
            expect(event.context.telemetry.properties.diagnosticsRunCorrelationId).toBe(runId);
        }
    });

    it('sends accepted then terminal telemetry with bounded fields, counts and no connection-identifying values', async (): Promise<void> => {
        const run = await runConnectionDiagnostics(
            options({ runIndex: 2, runTrigger: 'rerun', timeoutProfile: 'longer' }),
        );
        expect(events.map((event): string => event.name)).toEqual([
            'diagnoseConnection.runStarted',
            'diagnoseConnection.run',
        ]);
        for (const event of events) {
            expect(event.context.telemetry.maskEntireErrorMessage).toBe(true);
            expect(event.context.telemetry.suppressIfSuccessful).not.toBe(true);
            expect(event.context.telemetry.properties).toMatchObject({
                diagnosticsSessionId: 'panel-session-id',
                diagnosticsRunCorrelationId: run.runId,
                entryPoint: 'contextMenu',
                runTrigger: 'rerun',
                timeoutProfile: 'longer',
            });
            expect(event.context.telemetry.measurements.runIndex).toBe(2);
            const serialized = JSON.stringify(event.context.telemetry);
            for (const secret of [host, user, password, encodeURIComponent(password), 'Private fixture', 'stable-id']) {
                expect(serialized).not.toContain(secret);
            }
        }
        const context = terminalContext();
        expect(context.telemetry.properties).toMatchObject({
            authMethod: 'NativeAuth',
            authSkipReason: 'none',
            remoteKind: 'local',
            connectionOutcome: 'connected',
            firstBlockingCheck: 'none',
            findingCodes: '',
            coverageLimited: 'false',
            result: 'Succeeded',
        });
        expect(context.telemetry.measurements).toMatchObject({
            hostCount: 1,
            passCount: 13,
            warningCount: 0,
            failCount: 0,
            skippedCount: 2,
            dnsFailCount: 0,
            dnsMaxDurationMs: expect.any(Number),
            tcpFailCount: 0,
            tcpMaxDurationMs: expect.any(Number),
            tlsFailCount: 0,
            tlsMaxDurationMs: expect.any(Number),
            helloFailCount: 0,
            helloMaxDurationMs: expect.any(Number),
        });
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([`mongodb://${host}/`, password, encodeURIComponent(password), user]),
        );
        for (const line of outputLines()) {
            expect(line).toContain(`[Connection diagnosis] run=${run.runId} `);
        }
        expect(outputLines()[0]).toBe(
            `[Connection diagnosis] run=${run.runId} started entry=contextMenu trigger=rerun profile=longer`,
        );
        expect(
            outputLines().some((line): boolean =>
                /check=prepare status=skipped skip=notApplicable durationMs=\d+ codes=-$/.test(line),
            ),
        ).toBe(true);
        expect(
            outputLines().some((line): boolean => /check=dns target=#1 status=pass durationMs=\d+ codes=-$/.test(line)),
        ).toBe(true);
        expect(outputLines().at(-1)).toBe(`[Connection diagnosis] run=${run.runId} finished outcome=connected`);
        for (const secret of [host, user, password, encodeURIComponent(password)]) {
            expect(outputLines().join('\n')).not.toContain(secret);
        }
        expect(JSON.stringify(run)).not.toMatch(
            /transientCredentials|connectionStringWithPassword|nativeAuthConfig|authError/,
        );
        expect(JSON.stringify(run)).not.toContain(password);
        expect(JSON.stringify(run)).not.toContain(encodeURIComponent(password));
    });

    it('authenticates with the chosen method on a run-owned client after hello and closes it when the run ends', async (): Promise<void> => {
        const getClient = vi.spyOn(ClustersClient, 'getClient');
        const run = await runConnectionDiagnostics(options());
        expect(run.results.find((result): boolean => result.checkId === 'authenticate')).toMatchObject({
            status: 'pass',
            facts: { authMethod: 'NativeAuth', userName: user, authenticated: true },
        });
        expect(mongo.clients).toHaveLength(1);
        expect(mongo.clients[0].connectionString).toContain(encodeURIComponent(password));
        expect(mongo.clients[0].close).toHaveBeenCalledTimes(1);
        expect(getClient).not.toHaveBeenCalled();
        expect(terminalContext().telemetry.properties.connectionOutcome).toBe('connected');
        expect(
            outputLines().some((line): boolean => /check=authenticate status=pass durationMs=\d+ codes=-$/.test(line)),
        ).toBe(true);
    });

    it('warns once in the DNS step about mixed Entra ID host domains without host names in telemetry or the trace', async (): Promise<void> => {
        const govHost = 'fixture.mongocluster.cosmos.azure.us';
        const checks = builtIns();
        const cs = checks.find((check): boolean => check.id === 'connectionString');
        if (!cs) {
            throw new Error('Missing fixture check');
        }
        cs.run = async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
            context.setTargets([
                { host: govHost, port: 10260, source: 'uri' },
                { host, port: 10260, source: 'uri' },
            ]);
            return { status: 'pass', facts: {}, findings: [] };
        };
        vi.mocked(createBuiltInChecks).mockReturnValue(checks);
        const request = options();
        const run = await runConnectionDiagnostics({
            ...request,
            target: {
                ...request.target,
                getCredentials: vi.fn().mockResolvedValue({
                    connectionString: `mongodb://${govHost}:10260,${host}:10260/`,
                    availableAuthMethods: [AuthMethodId.MicrosoftEntraID],
                    selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
                }),
            },
        });
        const dns = run.results.filter((result): boolean => result.checkId === 'dns');
        expect(dns.map((result): string => result.status)).toEqual(['warning', 'pass']);
        expect(dns[0].findings).toEqual([
            expect.objectContaining({
                code: 'dns.mixedHostDomains',
                severity: 'warning',
                data: {
                    kind: 'unrecognizedHosts',
                    clouds: ['AzureUSGovernment'],
                    builtInHostCount: 1,
                    customHostCount: 0,
                    otherHostCount: 1,
                    customSuffixConfigured: false,
                },
            }),
        ]);
        const context = terminalContext();
        expect(context.telemetry.properties.findingCodes).toContain('dns.mixedHostDomains');
        for (const name of [govHost, host]) {
            expect(JSON.stringify(dns[0].findings)).not.toContain(name);
            expect(JSON.stringify(context.telemetry)).not.toContain(name);
            expect(outputLines().join('\n')).not.toContain(name);
        }
    });

    it('masks before sensitive setup parsing or I/O, including passwords available only in the session cache', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue({
            clusterId: 'stable-id',
            connectionString: `mongodb://${host}/`,
            authMechanism: undefined,
            nativeAuthConfig: { connectionUser: user, connectionPassword: 'cache-password' },
        });
        const request = options();
        const getCredentials = vi.fn(async (): Promise<undefined> => {
            expect(terminalContext().telemetry.maskEntireErrorMessage).toBe(true);
            return undefined;
        });
        const run = await runConnectionDiagnostics({ ...request, target: { ...request.target, getCredentials } });
        expect(terminalContext().valuesToMask).toContain('cache-password');
        // A deleted connection is a finished run with a typed finding, not a failed diagnosis run (R2).
        expect(run.results.find((result): boolean => result.checkId === 'resolveTarget')).toMatchObject({
            status: 'fail',
            findings: [expect.objectContaining({ code: 'target.notFound', data: { source: 'savedConnection' } })],
        });
        expect(outputLines().at(-1)).toBe(`[Connection diagnosis] run=${run.runId} finished outcome=failed`);
    });

    it('reports a connection-string failure as a failed connection, not a failed diagnosis run', async (): Promise<void> => {
        const checks = builtIns();
        const cs = checks.find((check): boolean => check.id === 'connectionString');
        if (!cs) {
            throw new Error('Missing fixture check');
        }
        cs.run = async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({
            status: 'fail',
            facts: {},
            findings: [
                {
                    code: 'cs.unparseable',
                    severity: 'error',
                    detail: { language: 'en', text: 'Invalid connection string.' },
                },
            ],
        });
        vi.mocked(createBuiltInChecks).mockReturnValue(checks);
        const run = await runConnectionDiagnostics(options());
        expect(terminalContext().telemetry.properties).toMatchObject({
            result: 'Succeeded',
            connectionOutcome: 'failed',
            firstBlockingCheck: 'connectionString',
            findingCodes: 'cs.unparseable',
        });
        expect(outputLines().at(-1)).toBe(`[Connection diagnosis] run=${run.runId} finished outcome=failed`);
    });

    it('aggregates host failures and known codes from checks and steps, sorted and deduplicated', async (): Promise<void> => {
        const checks = builtIns();
        const dns = checks.find((check): boolean => check.id === 'dns');
        if (!dns) {
            throw new Error('Missing fixture check');
        }
        dns.run = async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({
            status: 'warning',
            facts: {},
            findings: [
                {
                    code: 'dns.resolversDisagree',
                    severity: 'warning',
                    detail: { language: 'en', text: 'Different resolvers.' },
                },
            ],
        });
        const tcp = checks.find((check): boolean => check.id === 'tcp');
        if (!tcp) {
            throw new Error('Missing fixture check');
        }
        tcp.run = async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({
            status: 'fail',
            facts: {},
            findings: [{ code: 'tcp.refused', severity: 'error', detail: { language: 'en', text: 'Refused.' } }],
            steps: [
                {
                    stepId: 'tcp.attempt',
                    status: 'fail',
                    durationMs: 5,
                    facts: { host, user },
                    findings: [
                        { code: 'tcp.refused', severity: 'error', detail: { language: 'en', text: 'Refused.' } },
                    ],
                },
            ],
        });
        vi.mocked(createBuiltInChecks).mockReturnValue(checks);
        await runConnectionDiagnostics(options());
        expect(terminalContext().telemetry.properties.findingCodes).toBe('dns.resolversDisagree,tcp.refused');
        expect(terminalContext().telemetry.properties.firstBlockingCheck).toBe('tcp');
        expect(terminalContext().telemetry.measurements).toMatchObject({
            tcpFailCount: 1,
            dnsFailCount: 0,
            warningCount: 1,
            failCount: 1,
        });
        expect(
            outputLines().some((line): boolean =>
                /step=tcp.attempt target=#1 status=fail durationMs=5 codes=tcp.refused$/.test(line),
            ),
        ).toBe(true);
    });

    it('reports a saved connection provider failure in prepare, not as an unexpected run failure', async (): Promise<void> => {
        const actual = await vi.importActual<typeof ConnectionDiagnostics>('@documentdb-js/connection-diagnostics');
        const probes = actual.createBuiltInChecks();
        const probeRuns = probes
            .filter((check): boolean => ['srv', 'dns', 'tcp', 'tls', 'hello'].includes(check.id))
            .map((check) => vi.spyOn(check, 'run'));
        vi.mocked(createBuiltInChecks).mockReturnValue(probes);
        vi.spyOn(ConnectionStorageService, 'get').mockResolvedValue({
            id: 'stable-id',
            name: 'Test connection',
            properties: { type: ItemType.Connection, api: API.DocumentDB, availableAuthMethods: [], tunnel: true },
            secrets: { connectionString: `mongodb://${host}/` },
        });
        const ensureReachable = vi.fn(async (): Promise<void> => {
            throw new Error(`Password ${password} for ${host}`);
        });
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable,
        });
        vi.mocked(openConnectionDiagnostics).mockReturnValue({
            panelAction: 'created',
            diagnosticsSessionId: 'panel-session-id',
        });
        const node = new DocumentDBClusterItem({
            treeId: 'connectionsView/folder/stable-id',
            clusterId: 'stable-id',
            storageId: 'stable-id',
            name: 'Test connection',
            dbExperience: DocumentDBExperience,
            viewId: Views.ConnectionsView,
        });
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as unknown as IActionContext;
        await diagnoseConnection(context, node);
        const { target } = vi.mocked(openConnectionDiagnostics).mock.calls[0][0];
        const observed: DiagnosticsEvent<FindingCode>[] = [];
        const run = await runConnectionDiagnostics(
            options({
                target,
                onEvent: (event): void => {
                    observed.push(event);
                },
            }),
        );
        expect(ensureReachable).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ tunnel: true }),
            'stable-id',
            {
                interactive: false,
                signal: expect.any(AbortSignal),
            },
        );
        expect(run.results.find((result): boolean => result.checkId === 'prepare')).toMatchObject({
            status: 'fail',
            facts: { providerId: 'tunnel', errorName: 'Error' },
        });
        for (const id of ['srv', 'dns']) {
            expect(run.results.find((result): boolean => result.checkId === id)).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' },
            });
        }
        expect(run.timeouts.preparationTimeoutMs).toBe(15_000);
        expect(
            observed.some(
                (event): boolean =>
                    event.type === 'checkFinished' &&
                    event.result.checkId === 'prepare' &&
                    event.result.status === 'fail',
            ),
        ).toBe(true);
        expect(probeRuns.every((probe): boolean => probe.mock.calls.length === 0)).toBe(true);
        expect(terminalContext().telemetry.properties.result).toBe('Succeeded');
        expect(events.every((event): boolean => event.error === undefined)).toBe(true);
        expect(JSON.stringify(run)).not.toContain(password);
    });

    it('does not probe an endpoint whose preparation failed', async (): Promise<void> => {
        ConnectionReachabilityService.registerProvider({
            id: 'tunnel',
            appliesTo: (): boolean => true,
            ensureReachable: async (): Promise<void> => {
                throw new Error(`Password ${password} for ${host}`);
            },
        });
        const request = options();
        vi.mocked(request.target.getCredentials).mockResolvedValue({
            connectionString: `mongodb://${host}/`,
            availableAuthMethods: [],
            connectionProperties: { tunnel: true },
        });
        const run = await runConnectionDiagnostics(request);
        expect(run.results.find((result): boolean => result.checkId === 'prepare')?.status).toBe('fail');
        for (const id of ['srv', 'dns']) {
            expect(run.results.find((result): boolean => result.checkId === id)).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' },
            });
        }
        expect(JSON.stringify(run)).not.toContain(password);
    });

    it.each(['cancelButton', 'panelClosed', 'rerun', 'subscriptionClosed'] as const)(
        'cancels as UserCancelledError (%s), records active IDs and ignores late completion',
        async (cancelReason): Promise<void> => {
            const controller = new AbortController();
            let settle: (value: CheckOutcome<FindingCode>) => void = (): void => {};
            let started: () => void = (): void => {};
            const isStarted = new Promise<void>((resolve): void => {
                started = resolve;
            });
            const check: Check<RunContext, FindingCode> = {
                id: 'laterPhase',
                scope: 'run',
                run: (): Promise<CheckOutcome<FindingCode>> =>
                    new Promise((resolve): void => {
                        settle = resolve;
                        started();
                    }),
            };
            const pending = runConnectionDiagnostics(
                options({
                    signal: controller.signal,
                    cancelReason: (): typeof cancelReason => cancelReason,
                    extraChecks: [check],
                }),
            );
            await isStarted;
            controller.abort();
            await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
            const properties = terminalContext().telemetry.properties;
            expect(properties).toMatchObject({ cancelReason, activeChecks: 'laterPhase', result: 'Canceled' });
            // The authenticate check's run-owned client is closed when the run ends, cancelled or not.
            expect(mongo.clients).toHaveLength(1);
            expect(mongo.clients[0].close).toHaveBeenCalled();
            expect(properties.connectionOutcome).toBeUndefined();
            expect(outputLines().at(-1)).toMatch(/ cancelled$/);
            expect(outputLines().some((line): boolean => line.includes('finished'))).toBe(false);
            const lines = [...outputLines()];
            settle({ status: 'pass', facts: {}, findings: [] });
            await Promise.resolve();
            await Promise.resolve();
            expect(outputLines()).toEqual(lines);
            expect(events).toHaveLength(2);
        },
    );

    it('cancels promptly while non-interactive credential resolution is pending', async (): Promise<void> => {
        const controller = new AbortController();
        const request = options({ signal: controller.signal });
        let started: () => void = (): void => {};
        const resolving = new Promise<void>((resolve): void => {
            started = resolve;
        });
        let settle: () => void = (): void => {};
        vi.mocked(request.target.getCredentials).mockImplementation(async (): Promise<undefined> => {
            started();
            await new Promise<void>((resolve): void => {
                settle = resolve;
            });
            return undefined;
        });
        const pending = runConnectionDiagnostics(request);
        await resolving;
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
        expect(terminalContext().telemetry.properties).toMatchObject({
            cancelReason: 'subscriptionClosed',
            activeChecks: 'resolveTarget',
            result: 'Canceled',
        });
        settle();
        await Promise.resolve();
        await Promise.resolve();
        expect(outputLines().at(-1)).toMatch(/ cancelled$/);
        expect(events).toHaveLength(2);
    });

    it('uses the real built-in connection-string diagnostic without a network operation for malformed input', async (): Promise<void> => {
        const actual = await vi.importActual<typeof ConnectionDiagnostics>('@documentdb-js/connection-diagnostics');
        vi.mocked(createBuiltInChecks).mockReturnValue(actual.createBuiltInChecks());
        const request = options();
        vi.mocked(request.target.getCredentials).mockResolvedValue({
            connectionString: 'not-a-valid-uri',
            availableAuthMethods: [],
        });
        const run = await runConnectionDiagnostics(request);
        expect(run.results.find((result): boolean => result.checkId === 'connectionString')).toMatchObject({
            status: 'fail',
            findings: [expect.objectContaining({ code: 'cs.unparseable' })],
        });
        expect(terminalContext().telemetry.properties.connectionOutcome).toBe('failed');
    });

    it.each(['noMethod', 'passwordMissing'] as const)(
        'records the %s authentication-skip reason without preventing probes',
        async (credentialState): Promise<void> => {
            const request = options();
            vi.mocked(request.target.getCredentials).mockResolvedValue({
                connectionString: `mongodb://${host}/`,
                availableAuthMethods: [],
                ...(credentialState === 'passwordMissing' ? { selectedAuthMethod: AuthMethodId.NativeAuth } : {}),
            });
            Object.defineProperty(vscode.env, 'remoteName', { value: 'ssh-remote', configurable: true });
            const run = await runConnectionDiagnostics(request);
            expect(terminalContext().telemetry.properties).toMatchObject({
                authSkipReason: credentialState === 'noMethod' ? 'method' : 'password',
                remoteKind: 'ssh',
                authMethod: credentialState === 'noMethod' ? 'none' : 'NativeAuth',
            });
            expect(run.results.find((result): boolean => result.checkId === 'hello')?.status).toBe('pass');
            expect(run.results.find((result): boolean => result.checkId === 'authenticate')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
                findings: [
                    expect.objectContaining({
                        code: 'auth.credentialsUnavailable',
                        data: expect.objectContaining({
                            missing: credentialState === 'noMethod' ? 'method' : 'password',
                        }),
                    }),
                ],
            });
            expect(mongo.clients).toHaveLength(0);
            expect(terminalContext().telemetry.properties.findingCodes).toBe(
                'auth.credentialsUnavailable,cs.credentialsMissing,env.remoteExtensionHost',
            );
        },
    );

    it('records limited coverage and timeout aggregates without claiming a connection failure', async (): Promise<void> => {
        vi.useFakeTimers();
        let started: () => void = (): void => {};
        const isStarted = new Promise<void>((resolve): void => {
            started = resolve;
        });
        const check: Check<RunContext, FindingCode> = {
            id: 'consumerFacts',
            scope: 'run',
            timeout: 'postConnect',
            run: (): Promise<CheckOutcome<FindingCode>> =>
                new Promise((): void => {
                    started();
                }),
        };
        const pending = runConnectionDiagnostics(options({ extraChecks: [check] }));
        await isStarted;
        await vi.advanceTimersByTimeAsync(5000);
        const run = await pending;
        expect(run.coverage.limited).toBe(true);
        expect(terminalContext().telemetry.properties).toMatchObject({
            result: 'Succeeded',
            connectionOutcome: 'connected',
            coverageLimited: 'true',
            findingCodes: 'check.timeout',
            firstBlockingCheck: 'consumerFacts',
        });
    });

    it('does not lose an active check ID when the same check has finished for another host', async (): Promise<void> => {
        const controller = new AbortController();
        const checks = builtIns();
        const cs = checks.find((check): boolean => check.id === 'connectionString');
        const dns = checks.find((check): boolean => check.id === 'dns');
        if (!cs || !dns) {
            throw new Error('Missing fixture check');
        }
        cs.run = async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
            context.setTargets([
                { host, port: 27017, source: 'uri' },
                { host: 'second-private.example', port: 27017, source: 'uri' },
            ]);
            return { status: 'pass', facts: {}, findings: [] };
        };
        let secondStarted: () => void = (): void => {};
        const waiting = new Promise<void>((resolve): void => {
            secondStarted = resolve;
        });
        dns.run = async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
            if (context.target?.host !== host) {
                secondStarted();
                await new Promise<void>(() => {});
            }
            return { status: 'pass', facts: {}, findings: [] };
        };
        vi.mocked(createBuiltInChecks).mockReturnValue(checks);
        const pending = runConnectionDiagnostics(options({ signal: controller.signal }));
        await waiting;
        await Promise.resolve();
        await Promise.resolve();
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
        const activeChecks = terminalContext().telemetry.properties.activeChecks;
        if (typeof activeChecks !== 'string') throw new Error('Missing active checks telemetry');
        expect(activeChecks.split(',')).toContain('dns');
    });

    it('handles a signal aborted inside credential retrieval without an unhandled setup rejection', async (): Promise<void> => {
        const controller = new AbortController();
        const request = options({ signal: controller.signal });
        vi.mocked(request.target.getCredentials).mockImplementation(async (): Promise<undefined> => {
            controller.abort();
            return undefined;
        });
        await expect(runConnectionDiagnostics(request)).rejects.toBeInstanceOf(UserCancelledError);
        await Promise.resolve();
        expect(terminalContext().telemetry.properties.result).toBe('Canceled');
    });

    it('does not read credentials for an already cancelled run', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort();
        const request = options({ signal: controller.signal });
        await expect(runConnectionDiagnostics(request)).rejects.toBeInstanceOf(UserCancelledError);
        expect(request.target.getCredentials).not.toHaveBeenCalled();
        expect(terminalContext().telemetry.properties.activeChecks).toBe('');
    });

    it('ignores subscriber errors without losing a successful run', async (): Promise<void> => {
        const run = await runConnectionDiagnostics(
            options({
                onEvent: (): never => {
                    throw new Error('Subscriber failed');
                },
            }),
        );
        expect(run.results).toHaveLength(orderedIds.length);
        expect(terminalContext().telemetry.properties.result).toBe('Succeeded');
    });

    describe('target resolution inside the run (review R1/R2, option A)', (): void => {
        it('reads the target inside the run, after the clock starts, with the run signal', async (): Promise<void> => {
            const observed: DiagnosticsEvent<FindingCode>[] = [];
            const request = options({ onEvent: (event): void => void observed.push(event) });
            const run = await runConnectionDiagnostics(request);
            const started = observed.findIndex(
                (event): boolean => event.type === 'checkStarted' && event.checkId === 'resolveTarget',
            );
            expect(started).toBeGreaterThan(0);
            expect(request.target.getCredentials).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(AbortSignal) });
            expect(run.results.find((result): boolean => result.checkId === 'connectionString')?.status).toBe('pass');
        });

        it('bounds a hanging read with the whole-run timeout and abandons it', async (): Promise<void> => {
            vi.useFakeTimers();
            const request = options();
            let readSignal: AbortSignal | undefined;
            vi.mocked(request.target.getCredentials).mockImplementation(async (read): Promise<undefined> => {
                readSignal = read.signal;
                return new Promise<undefined>((): void => {});
            });
            const pending = runConnectionDiagnostics(request);
            await vi.advanceTimersByTimeAsync(300_000);
            const run = await pending;
            expect(readSignal?.aborted).toBe(true);
            expect(run.results.find((result): boolean => result.checkId === 'resolveTarget')).toMatchObject({
                status: 'fail',
                findings: [
                    expect.objectContaining({
                        code: 'check.timeout',
                        data: expect.objectContaining({ source: 'run' }),
                    }),
                ],
            });
            expect(run.coverage.timedOut).toEqual([
                expect.objectContaining({ checkId: 'resolveTarget', timeoutMs: 300_000, source: 'run' }),
            ]);
            expect(run.results.find((result): boolean => result.checkId === 'connectionString')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'resolveTarget' },
            });
        });

        it('aborts the read signal on cancel and discards a late resolution without preparing', async (): Promise<void> => {
            const controller = new AbortController();
            const request = options({ signal: controller.signal });
            const ensureReachable = vi.fn();
            ConnectionReachabilityService.registerProvider({
                id: 'kubernetes-port-forward',
                appliesTo: (): boolean => true,
                ensureReachable,
            });
            let readSignal: AbortSignal | undefined;
            let settle: () => void = (): void => {};
            let started: () => void = (): void => {};
            const reading = new Promise<void>((resolve): void => {
                started = resolve;
            });
            vi.mocked(request.target.getCredentials).mockImplementation(async (read) => {
                readSignal = read.signal;
                started();
                await new Promise<void>((resolve): void => {
                    settle = resolve;
                });
                return {
                    connectionString: `mongodb://${host}/`,
                    availableAuthMethods: [],
                    connectionProperties: { kubernetesPortForward: true },
                };
            });
            const pending = runConnectionDiagnostics(request);
            await reading;
            controller.abort();
            await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
            expect(readSignal?.aborted).toBe(true);
            const lines = [...outputLines()];
            settle();
            await new Promise<void>((resolve): void => void setTimeout(resolve, 0));
            expect(ensureReachable).not.toHaveBeenCalled();
            expect(outputLines()).toEqual(lines);
            expect(terminalContext().telemetry.properties.authMethod).toBe('none');
        });

        it.each([
            [new ConnectionInputCancelledError('port'), 'target.inputCancelled', { input: 'port' }, 'notTested'],
            [
                new ConnectionEndpointUnavailableError('kubernetes', 'pending'),
                'target.endpointMissing',
                { source: 'kubernetes', reason: 'pending' },
                'failed',
            ],
            [
                new ConnectionSourceUnavailableError(
                    'azure',
                    Object.assign(new Error('secret /subscriptions/x'), { name: 'RestError', statusCode: 403 }),
                ),
                'target.sourceInaccessible',
                { source: 'azure', reason: 'accessDenied', errorName: 'RestError', statusCode: 403 },
                'failed',
            ],
            [
                new ConnectionSourceUnavailableError('azure', Object.assign(new Error('secret'), { statusCode: 404 })),
                'target.notFound',
                { source: 'azure', errorName: 'Error', statusCode: 404 },
                'failed',
            ],
        ] as const)(
            'maps %s to %s on the Connection settings row without probing',
            async (error, code, data, outcome): Promise<void> => {
                const request = options();
                vi.mocked(request.target.getCredentials).mockRejectedValue(error);
                const run = await runConnectionDiagnostics(request);
                expect(run.results.find((result): boolean => result.checkId === 'resolveTarget')).toMatchObject({
                    status: 'fail',
                    findings: [{ code, severity: 'error', data }],
                });
                for (const id of ['connectionString', 'credentials', 'prepare', 'authenticate']) {
                    expect(run.results.find((result): boolean => result.checkId === id)?.status).toBe('skipped');
                }
                expect(terminalContext().telemetry.properties).toMatchObject({
                    result: 'Succeeded',
                    connectionOutcome: outcome,
                    firstBlockingCheck: 'resolveTarget',
                    findingCodes: code,
                });
                expect(JSON.stringify(run)).not.toContain('secret');
                expect(events.every((event): boolean => event.error === undefined)).toBe(true);
            },
        );
    });
});
