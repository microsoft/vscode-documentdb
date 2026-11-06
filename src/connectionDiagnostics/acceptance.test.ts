/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    builtInFindingCodes,
    DEFAULT_TIMEOUTS,
    renderMarkdown,
    type CheckResult,
    type DiagnosticsEvent,
    type DiagnosticsIo,
    type DiagnosticsRun,
    type Finding,
    type TimeoutProfile,
} from '@documentdb-js/connection-diagnostics';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type initWebviewTrpc } from '@microsoft/vscode-ext-webview';
import type * as MongoDB from 'mongodb';
import {
    MongoServerError,
    MongoServerSelectionError,
    type MongoClientOptions,
    type TopologyDescription,
} from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import type * as tokenResource from '../documentdb/auth/documentdbTokenResource';
import {
    resetTokenResourceCacheForTests,
    type TokenResourceResolverDeps,
} from '../documentdb/auth/documentdbTokenResource';
import { resetEntraTokenFailuresForTests } from '../documentdb/auth/entraErrors/entraTokenFailures';
import { CredentialCache } from '../documentdb/CredentialCache';
import { API } from '../DocumentDBExperiences';
import { ConnectionReachabilityService } from '../services/connectionReachabilityService';
import { ErrorExplanationService } from '../services/errorExplanationService';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import { readOnlyJsonDocumentProvider } from '../utils/readOnlyJsonDocumentProvider';
import { createCallerFactory } from '../webviews/_integration/trpc';
import {
    connectionDiagnosticsRouter,
    type RouterContext,
} from '../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsRouter';
import { type RunUpdate } from '../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsTypes';
import { DiagnosticsPanelSession } from '../webviews/documentdb/connectionDiagnostics/diagnosticsPanelSession';
import { formatEvidence } from '../webviews/documentdb/connectionDiagnostics/formatEvidence';
import { type PanelRow } from '../webviews/documentdb/connectionDiagnostics/panelTypes';
import { describeFinding } from './findingMessages';
import { withRowDetails } from './panelDetails';
import { createExtensionReportText, renderExtensionReportFooter } from './reportText';
import type * as Diagnostics from './runConnectionDiagnostics';
import { getPlannedDiagnosticsChecks, type RunConnectionDiagnosticsOptions } from './runConnectionDiagnostics';
import { deferred, detailSentinel, gatewayReply, host, offlineIo, outputs, socketError } from './test/fixtures';
import { extensionFindingCodes, type FindingCode } from './types';

interface CapturedRun {
    readonly run: DiagnosticsRun<FindingCode>;
    readonly events: DiagnosticsEvent<FindingCode>[];
}
interface FakeClient {
    readonly options: MongoClientOptions;
    readonly close: ReturnType<typeof vi.fn>;
}
const bridge = vi.hoisted(() => ({
    io: undefined as Partial<DiagnosticsIo> | undefined,
    runs: [] as CapturedRun[],
    events: [] as DiagnosticsEvent<FindingCode>[],
    observe: undefined as ((event: DiagnosticsEvent<FindingCode>) => void) | undefined,
    resolverDeps: undefined as unknown,
    getSessionFromVSCode: vi.fn(),
    getManagedIdentityAccessToken: vi.fn(),
    connect: vi.fn(),
    command: vi.fn(),
    clients: [] as FakeClient[],
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    appendExtensionUserAgent: (): string => 'documentdb-acceptance',
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
vi.mock('../extensionVariables', () => ({
    ext: {
        context: { extensionMode: 1, extension: { packageJSON: { version: '1.0.0' } } },
        outputChannel: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), trace: vi.fn(), debug: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]): unknown => bridge.getSessionFromVSCode(...args),
}));
vi.mock('../documentdb/auth/managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: (...args: unknown[]): unknown => bridge.getManagedIdentityAccessToken(...args),
}));
vi.mock('../documentdb/auth/documentdbTokenResource', async (importOriginal) => {
    const actual = await importOriginal<typeof tokenResource>();
    return {
        ...actual,
        resolveInteractiveTokenResource: (uri: string): ReturnType<typeof actual.resolveInteractiveTokenResource> =>
            actual.resolveInteractiveTokenResource(uri, bridge.resolverDeps as TokenResourceResolverDeps),
        resolveManagedIdentityTokenResource: (
            uri: string,
        ): ReturnType<typeof actual.resolveManagedIdentityTokenResource> =>
            actual.resolveManagedIdentityTokenResource(uri, bridge.resolverDeps as TokenResourceResolverDeps),
        describeEntraSignInEnvironment: (): object => ({ configuredCloud: 'AzureCloud' }),
    };
});
// Same owned-driver fake as runConnectionDiagnostics.test.ts; probes still execute the real package checks.
vi.mock('mongodb', async (importOriginal) => {
    const actual = await importOriginal<typeof MongoDB>();
    class FakeMongoClient {
        public readonly close = vi.fn(async (): Promise<void> => undefined);
        public constructor(
            public readonly connectionString: string,
            public readonly options: MongoClientOptions,
        ) {
            bridge.clients.push(this);
        }
        /** One known server, as the driver reports it after connecting, so the answering host is observed. */
        public get topology(): { description: { servers: Map<string, { address: string; type: string }> } } {
            const url = new URL(this.connectionString);
            const address = `${url.hostname}:${url.port || '27017'}`;
            return { description: { servers: new Map([[address, { address, type: 'Mongos' }]]) } };
        }
        public async connect(): Promise<this> {
            await bridge.connect(this);
            return this;
        }
        public db(): { command: (document: Record<string, unknown>) => Promise<Record<string, unknown>> } {
            return {
                command: (document): Promise<Record<string, unknown>> =>
                    bridge.command(document) as Promise<Record<string, unknown>>,
            };
        }
    }
    return { ...actual, MongoClient: FakeMongoClient };
});
vi.mock('./runConnectionDiagnostics', async (importOriginal) => {
    const actual = await importOriginal<typeof Diagnostics>();
    return {
        ...actual,
        runConnectionDiagnostics: async (
            options: RunConnectionDiagnosticsOptions,
        ): Promise<DiagnosticsRun<FindingCode>> => {
            const events: DiagnosticsEvent<FindingCode>[] = [];
            bridge.events = events;
            const run = await actual.runConnectionDiagnostics({
                ...options,
                io: bridge.io,
                onEvent(event): void {
                    events.push(event);
                    bridge.observe?.(event);
                    options.onEvent?.(event);
                },
            });
            bridge.runs.push({ run, events });
            return run;
        },
    };
});
vi.mock('../webviews/_integration/trpc', async () => {
    const { initWebviewTrpc: init } = await vi.importActual<{ initWebviewTrpc: typeof initWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = init();
    return {
        ...trpc,
        publicProcedureWithTelemetry: trpc.publicProcedure.use(async ({ next }) =>
            next({
                ctx: {
                    actionContext: {
                        telemetry: { properties: {}, measurements: {} },
                        errorHandling: {},
                        valuesToMask: [],
                    } as unknown as IActionContext,
                },
            }),
        ),
    };
});
vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index): string => result.replace(`{${index}}`, String(value)), message),
}));

const createCaller = createCallerFactory(connectionDiagnosticsRouter);
let fixture: ReturnType<typeof offlineIo>;
const sessions: DiagnosticsPanelSession[] = [];
const firewall =
    'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.';

function resolverDeps(): TokenResourceResolverDeps {
    return bridge.resolverDeps as TokenResourceResolverDeps;
}

function context(
    method = AuthMethodId.NativeAuth,
    uri = `mongodb://${host}/`,
    password = 'stored-password',
): RouterContext {
    const credentials: EphemeralClusterCredentials = {
        connectionString: uri,
        selectedAuthMethod: method,
        availableAuthMethods: [method],
        nativeAuthConfig: { connectionUser: 'alice', connectionPassword: password },
        ...(method === AuthMethodId.ManagedIdentity ? { managedIdentityAuthConfig: {} } : {}),
    };
    const session = new DiagnosticsPanelSession('acceptance-session');
    sessions.push(session);
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'connectionDiagnostics',
        entryPoint: 'contextMenu',
        session,
        target: {
            clusterId: 'acceptance-cluster',
            displayName: 'Acceptance fixture',
            sourceView: 'connections',
            getCredentials: vi.fn(async (): Promise<EphemeralClusterCredentials> => credentials),
        },
    };
}

function withoutDetails(row: PanelRow): PanelRow {
    return {
        id: row.id,
        status: row.status,
        segments: row.segments,
        ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
    };
}

/** WI-18: a warning or error row always explains itself in its details; pending rows offer none. */
function expectDetailsExplainStatus(rows: readonly PanelRow[]): void {
    for (const row of rows) {
        if (row.status === 'warning' || row.status === 'error') {
            expect(
                row.details?.findings.some((finding): boolean => finding.severity !== 'info'),
                `${row.id} (${row.status}) explains its status`,
            ).toBe(true);
        }
        if (row.status === 'pending' || row.status === 'active') {
            expect(row.details, `${row.id} (${row.status}) offers no details`).toBeUndefined();
        }
    }
}

async function collect(stream: AsyncIterable<RunUpdate>): Promise<RunUpdate[]> {
    const updates: RunUpdate[] = [];
    for await (const update of stream) {
        updates.push(update);
    }
    return updates;
}

async function finish(
    ctx = context(),
    profile: TimeoutProfile = 'default',
): Promise<
    ReturnType<typeof outputs> &
        CapturedRun & {
            ctx: RouterContext;
            updates: RunUpdate[];
            finished: Extract<RunUpdate, { type: 'finished' }>;
        }
> {
    const updates = await collect(
        await createCaller(ctx).run({
            timeoutProfile: profile,
            trigger: ctx.session.runIndex ? 'rerun' : 'initial',
            requestId: `acceptance-${ctx.session.runIndex}`,
        }),
    );
    const finished = updates.at(-1);
    expect(finished?.type).toBe('finished');
    if (finished?.type !== 'finished') {
        throw new Error(`Unexpected terminal update: ${JSON.stringify(finished)}`);
    }
    const captured = bridge.runs.at(-1);
    if (!captured || captured.run.runId !== finished.runId) {
        throw new Error('Missing real run');
    }
    const view = outputs(captured.run, captured.events, ctx.session.completedRun?.report.summary);
    expect(view.projector.rows()).toEqual(finished.rows.map(withoutDetails));
    expectDetailsExplainStatus(finished.rows);
    for (const update of updates) {
        if (update.type !== 'failed') {
            expectDetailsExplainStatus(update.rows);
        }
    }
    expect(view.result.outcome).toBe(finished.outcome);
    expect(JSON.parse(view.json)).toMatchObject({
        runId: captured.run.runId,
        summary: { outcome: finished.outcome },
        coverage: captured.run.coverage,
    });
    expect(view.markdown).toContain('# Connection diagnostics');
    expect(view.markdown).toContain(
        { connected: 'Connection successful', failed: 'Connection failed', notTested: 'Connection not tested' }[
            finished.outcome
        ],
    );
    return { ctx, updates, finished, ...captured, ...view };
}

function result(run: DiagnosticsRun<FindingCode>, checkId: string): CheckResult<FindingCode> {
    const value = run.results.find((item): boolean => item.checkId === checkId);
    if (!value) {
        throw new Error(`Missing ${checkId}`);
    }
    return value;
}

function rowText(view: ReturnType<typeof outputs>, id: string): string {
    return formatEvidence(view.projector.rows().find((row): boolean => row.id === id)?.segments ?? []) ?? '';
}

function rejection(): MongoServerError {
    return new MongoServerError({ message: 'Rejected credentials', code: 18, codeName: 'AuthenticationFailed' });
}

function selectionFailure(): MongoServerSelectionError {
    return new MongoServerSelectionError('Selection timed out', {
        servers: new Map([
            [
                `${host}:27017`,
                {
                    address: `${host}:27017`,
                    error: socketError('ETIMEDOUT'),
                },
            ],
        ]),
    } as unknown as TopologyDescription);
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve): void => {
        setImmediate(resolve);
    });
}

beforeEach((): void => {
    vi.clearAllMocks();
    bridge.runs.length = 0;
    bridge.clients.length = 0;
    bridge.events = [];
    bridge.observe = undefined;
    resetTokenResourceCacheForTests();
    resetEntraTokenFailuresForTests();
    fixture = offlineIo();
    bridge.io = fixture.io;
    bridge.resolverDeps = {
        getConfiguredCloud: vi.fn(() => ({ name: 'AzureCloud', isCustomCloud: false })),
        getCustomEnvironment: vi.fn(() => ({})),
        getCustomHostnameSuffixSource: vi.fn((): 'none' => 'none'),
        fetchArmMetadata: vi.fn().mockResolvedValue(undefined),
        readImdsAzEnvironment: vi.fn().mockResolvedValue(undefined),
        getSignInEnvironment: vi.fn(() => ({ authProvider: 'microsoft', brokerImplementation: undefined })),
        warn: vi.fn(),
    } satisfies TokenResourceResolverDeps;
    bridge.connect.mockResolvedValue(undefined);
    bridge.command.mockImplementation(async (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
        if (command.hello) {
            return fixture.controls.reply as Record<string, unknown>;
        }
        if (command.buildInfo) {
            return { ok: 1, version: '7.0.12' };
        }
        if (command.listDatabases) {
            return { ok: 1, databases: [{ name: 'fixture' }] };
        }
        return { ok: 1 };
    });
    bridge.getSessionFromVSCode.mockResolvedValue({
        accessToken: 'opaque-token',
        account: { label: 'alice@contoso.com', id: 'account-id' },
    });
    bridge.getManagedIdentityAccessToken.mockResolvedValue({
        accessToken: 'opaque-token',
        expiresOnTimestamp: Date.now() + 600000,
    });
    vi.spyOn(CredentialCache, 'getCredentials').mockReturnValue(undefined);
    vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue(undefined);
    vi.spyOn(readOnlyJsonDocumentProvider, 'openMarkdownDocument').mockResolvedValue(
        vscode.Uri.parse('documentdb-readonly-json:/report.md'),
    );
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
    } as unknown as vscode.WorkspaceConfiguration);
    Object.defineProperty(vscode.env, 'remoteName', { value: undefined, configurable: true });
    Object.defineProperty(vscode.env, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
    });
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('acceptance-report.md'));
    vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);
    vi.stubEnv('WSL_DISTRO_NAME', '');
    vi.stubEnv('WSL_INTEROP', '');
});
afterEach((): void => {
    for (const session of sessions.splice(0)) {
        session.dispose();
    }
    fixture.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    ConnectionReachabilityService.resetForTests();
    resetEntraTokenFailuresForTests();
});

describe('Acceptance (design §8.1)', (): void => {
    it('1. working connection has a server line and Show, Copy and Save render the same snapshot', async (): Promise<void> => {
        const view = await finish();
        expect(view.result).toMatchObject({
            outcome: 'connected',
            authenticated: true,
            serverLine: { engineVersion: '0.107.0', apiVersion: '7.0.12', host },
        });
        // The fake server answers the ping at once, which the panel formats as "< 1 ms" (decision 0050).
        expect(rowText(view, 'databaseAccess')).toMatch(/Ping (?:< )?\d+ ms · 1 database visible/);
        expect(view.run.results.map((item): string => item.checkId)).toEqual(
            getPlannedDiagnosticsChecks().map((check): string => check.id),
        );
        const snapshot = view.ctx.session.completedRun?.report;
        if (!snapshot) {
            throw new Error('Missing snapshot');
        }
        const render = (): string =>
            renderMarkdown(snapshot, {
                text: { ...createExtensionReportText(), title: `Connection diagnostics – ${snapshot.connectionName}` },
                redact: false,
            });
        expect(render()).toBe(render());
        const reads = vi.mocked(view.ctx.target.getCredentials).mock.calls.length;
        const connects = bridge.connect.mock.calls.length;
        const probes = fixture.requests.length;
        const dnsLookups = vi.mocked(fixture.dns.lookup).mock.calls.length;
        const net = fixture.io.net;
        if (!net) {
            throw new Error('Missing fake sockets');
        }
        const socketConnections = vi.mocked(net.connect).mock.calls.length;
        const tlsConnections = vi.mocked(net.connectTls).mock.calls.length;
        const caller = createCaller(view.ctx);
        const input = { runId: view.run.runId, hideIdentifiers: false };
        await caller.showDiagnostics(input);
        await caller.copyReport(input);
        await caller.saveReport(input);
        const shown = vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls.at(-1)?.[1];
        const copied = vi.mocked(vscode.env.clipboard.writeText).mock.calls.at(-1)?.[0];
        const saved = vi.mocked(vscode.workspace.fs.writeFile).mock.calls.at(-1)?.[1];
        expect(shown).toBe(`${render().trimEnd()}\n\n${renderExtensionReportFooter()}\n`);
        expect(copied).toBe(shown);
        expect(saved && Buffer.from(saved).toString('utf8')).toBe(shown);
        expect(vi.mocked(view.ctx.target.getCredentials).mock.calls).toHaveLength(reads);
        expect(bridge.connect.mock.calls).toHaveLength(connects);
        expect(fixture.requests).toHaveLength(probes);
        expect(vi.mocked(fixture.dns.lookup).mock.calls).toHaveLength(dnsLookups);
        expect(vi.mocked(net.connect).mock.calls).toHaveLength(socketConnections);
        expect(vi.mocked(net.connectTls).mock.calls).toHaveLength(tlsConnections);
        expect(bridge.getSessionFromVSCode).not.toHaveBeenCalled();
        expect(bridge.clients).toHaveLength(1);
        expect(bridge.clients[0].close).toHaveBeenCalled();
    });

    it('2. retains a dead seed as evidence, but a reachable member and its auth rejection decide the outcome', async (): Promise<void> => {
        fixture.controls.deadAddresses.add('203.0.113.5');
        const uri = `mongodb://dead.example,${host}/`;
        const connected = await finish(context(AuthMethodId.NativeAuth, uri));
        expect(connected.result.outcome).toBe('connected');
        expect(connected.markdown.replace(/\\/g, '')).toContain('tcp.refused');
        expect(connected.json).toContain('dead.example:27017');
        expect(rowText(connected, 'networkConnection')).toContain('1 of 2');
        bridge.connect.mockRejectedValue(rejection());
        const failed = await finish(context(AuthMethodId.NativeAuth, uri));
        expect(failed.result).toMatchObject({
            outcome: 'failed',
            headline: { code: 'auth.failed' },
            firewallHint: false,
        });
        expect(failed.markdown.replace(/\\/g, '')).toContain('auth.failed');
        expect(failed.markdown.replace(/\\/g, '')).toContain('tcp.refused');
        expect(rowText(failed, 'authentication')).toContain('Username and password');
    });

    it('3. missing stored passwords and silent sessions are not tested without prompting or claiming authentication', async (): Promise<void> => {
        const passwordMissing = await finish(context(AuthMethodId.NativeAuth, `mongodb://${host}/`, ''));
        expect(passwordMissing.result).toMatchObject({
            outcome: 'notTested',
            authenticated: false,
            headline: { code: 'auth.credentialsUnavailable' },
        });
        expect(result(passwordMissing.run, 'hello').status).toBe('pass');
        expect(bridge.connect).not.toHaveBeenCalled();
        bridge.getSessionFromVSCode.mockResolvedValue(undefined);
        const sessionMissing = await finish(context(AuthMethodId.MicrosoftEntraID));
        expect(sessionMissing.result).toMatchObject({ outcome: 'notTested', authenticated: false });
        expect(rowText(sessionMissing, 'authentication')).toContain('No sign-in available without a prompt');
        expect(bridge.getSessionFromVSCode).toHaveBeenCalledTimes(1);
        expect(bridge.getSessionFromVSCode.mock.calls[0][2]).toEqual({ silent: true });
        expect(vscode.window.showInputBox).not.toHaveBeenCalled();
        for (const view of [passwordMissing, sessionMissing]) {
            expect(view.markdown).toContain('Connection not tested');
            expect(view.markdown).not.toMatch(/\bauthenticated\b[^\n]*\btrue\b/i);
            expect(result(view.run, 'connectionAccess').status).toBe('skipped');
        }
    });

    it('4. cloud mismatch and missing custom cloud resource fail with the setting before requesting a token', async (): Promise<void> => {
        const mismatch = await finish(
            context(AuthMethodId.MicrosoftEntraID, 'mongodb://fixture.mongocluster.cosmos.azure.us/'),
        );
        expect(mismatch.result).toMatchObject({ outcome: 'failed', headline: { code: 'auth.cloudMismatch' } });
        expect(mismatch.result.headline?.nextStep).toContain('microsoft-sovereign-cloud.environment');
        expect(rowText(mismatch, 'authentication')).toContain('Cluster in Azure US Government');
        vi.mocked(resolverDeps().getConfiguredCloud).mockReturnValue({
            name: 'custom',
            isCustomCloud: true,
            activeDirectoryEndpointUrl: 'https://login.example.com/',
            resourceManagerEndpointUrl: 'https://management.example.com/',
        });
        const custom = await finish(context(AuthMethodId.MicrosoftEntraID, 'mongodb://cluster.private.example/'));
        expect(custom.result).toMatchObject({ outcome: 'failed', headline: { code: 'auth.tokenResourceUnresolved' } });
        expect(custom.result.headline?.nextStep).toContain('documentDB.customEnvironment.ossrdbmsEndpoint');
        expect(custom.json).toContain('customCloudUnresolved');
        for (const view of [mismatch, custom]) {
            expect(view.markdown.replace(/\\/g, '')).toContain(view.result.headline?.code);
        }
        expect(bridge.getSessionFromVSCode).not.toHaveBeenCalled();
        expect(bridge.getManagedIdentityAccessToken).not.toHaveBeenCalled();
        expect(bridge.connect).not.toHaveBeenCalled();
    });

    it('5. denied database listing or version metadata does not overturn Connected and names the denied command', async (): Promise<void> => {
        for (const denied of ['listDatabases', 'buildInfo']) {
            bridge.command.mockImplementation(
                async (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
                    if (command[denied]) {
                        throw new MongoServerError({
                            message: 'Permission denied',
                            code: 13,
                            codeName: 'Unauthorized',
                        });
                    }
                    return command.hello
                        ? gatewayReply
                        : command.listDatabases
                          ? { databases: [{ name: 'fixture' }] }
                          : { ok: 1 };
                },
            );
            const view = await finish();
            expect(view.result.outcome).toBe('connected');
            expect(view.markdown).toContain(denied);
            expect(view.markdown).toMatch(/denied/i);
            expect(view.json).toContain('denied');
            expect(
                view.run.results.flatMap((item): unknown[] =>
                    Array.isArray(item.facts.commands) ? item.facts.commands : [],
                ),
            ).toContainEqual(expect.objectContaining({ command: denied, outcome: 'denied' }));
            if (denied === 'listDatabases') {
                expect(rowText(view, 'databaseAccess')).toContain('Listing databases denied');
            }
        }
    });

    it('6. the real driver attempt outranks both failing probes and passing probes', async (): Promise<void> => {
        fixture.controls.connectError = 'ECONNREFUSED';
        const connected = await finish();
        expect(result(connected.run, 'tcp').status).toBe('fail');
        expect(connected.result.outcome).toBe('connected');
        expect(connected.markdown.replace(/\\/g, '')).toContain('tcp.refused');
        fixture.controls.connectError = undefined;
        bridge.connect.mockRejectedValue(selectionFailure());
        const failed = await finish();
        expect(result(failed.run, 'hello').status).toBe('pass');
        expect(failed.result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'authentication',
            headline: { code: 'auth.serverSelectionTimeout' },
        });
        expect(failed.json).toContain('ETIMEDOUT');
        expect(failed.markdown.replace(/\\/g, '')).toContain('auth.serverSelectionTimeout');
        // WI-27: the row says what happened to the attempt, not a title that reads like a credential problem.
        expect(rowText(failed, 'authentication')).toBe(
            'Username and password · Could not reach a server · Sign-in not tested',
        );
        expect(failed.finished.result.headline?.title).toBe('No server selected');
        expect(failed.finished.result.supporting).toBeUndefined();
    });

    it('7. cancellation creates no summary/report, timeout does, and late work cannot alter either', async (): Promise<void> => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        const pending = deferred<readonly { address: string; family: 4 | 6 }[]>();
        vi.mocked(fixture.dns.lookup).mockReturnValue(pending.promise);
        const ctx = context();
        const caller = createCaller(ctx);
        const stream = (
            await caller.run({ timeoutProfile: 'default', trigger: 'initial', requestId: 'acceptance-cancel' })
        )[Symbol.asyncIterator]();
        const started = await stream.next();
        expect(started.value?.type).toBe('started');
        await flush();
        expect(fixture.dns.lookup).toHaveBeenCalled();
        await caller.cancel({ requestId: 'acceptance-cancel' });
        const cancelled: RunUpdate[] = [];
        for (;;) {
            const update = await stream.next();
            if (update.done) {
                break;
            }
            cancelled.push(update.value);
        }
        expect(cancelled.at(-1)?.type).toBe('cancelled');
        expect(cancelled.some((update): boolean => update.type === 'finished')).toBe(false);
        expect(bridge.events.some((event): boolean => event.type === 'runFinished')).toBe(false);
        expect(ctx.session.completedRun).toBeUndefined();
        const runId = ctx.session.runId ?? 'missing';
        for (const action of [caller.showDiagnostics, caller.copyReport, caller.saveReport]) {
            await expect(action({ runId, hideIdentifiers: false })).rejects.toThrow('report is no longer available');
        }
        const count = bridge.events.length;
        pending.resolve([{ address: '203.0.113.4', family: 4 }]);
        await flush();
        expect(bridge.events).toHaveLength(count);
        expect(ctx.session.completedRun).toBeUndefined();

        const late = deferred<readonly { address: string; family: 4 | 6 }[]>();
        vi.mocked(fixture.dns.lookup).mockReturnValue(late.promise);
        const finishing = finish();
        await flush();
        await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUTS.probeTimeoutMs ?? 0);
        const limited = await finishing;
        expect(limited.finished.coverage.limited).toBe(true);
        expect(limited.json).toContain('check.timeout');
        expect(limited.markdown).toContain('Coverage');
        const before = JSON.stringify(limited.ctx.session.completedRun);
        const eventsBefore = bridge.events.length;
        late.resolve([{ address: '203.0.113.4', family: 4 }]);
        await flush();
        expect(bridge.events).toHaveLength(eventsBefore);
        expect(JSON.stringify(limited.ctx.session.completedRun)).toBe(before);
    });

    it('8. seven-second probes pass by default; whole-run expiry before authentication is not tested, with independent retries', async (): Promise<void> => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.mocked(fixture.dns.lookup).mockImplementation(async (): Promise<{ address: string; family: 4 | 6 }[]> => {
            await new Promise<void>((resolve): void => {
                setTimeout(resolve, 7000);
            });
            return [{ address: '203.0.113.4', family: 4 }];
        });
        fixture.controls.replyDelayMs = 7000;
        const running = finish();
        await flush();
        await vi.advanceTimersByTimeAsync(5000);
        expect(bridge.runs).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(9000);
        const slow = await running;
        expect(result(slow.run, 'dns')).toMatchObject({ status: 'pass', durationMs: 7000 });
        expect(result(slow.run, 'hello')).toMatchObject({ status: 'pass', durationMs: 7000 });
        expect(slow.finished.coverage.limited).toBe(false);
        vi.mocked(fixture.dns.lookup).mockResolvedValue([{ address: '203.0.113.4', family: 4 }]);
        fixture.controls.replyDelayMs = 0;
        // Simulate host work consuming the remaining budget between the final probe and authentication.
        bridge.observe = (event): void => {
            if (event.type === 'checkFinished' && event.result.checkId === 'hello') {
                fixture.elapse(DEFAULT_TIMEOUTS.runTimeoutMs ?? 0);
            }
        };
        const connectsBeforeExpiry = bridge.connect.mock.calls.length;
        const ctx = context();
        const expired = await finish(ctx);
        expect(bridge.connect.mock.calls).toHaveLength(connectsBeforeExpiry);
        expect(expired.result).toMatchObject({
            outcome: 'notTested',
            runTimeoutBeforeAttempt: true,
            firewallHint: false,
        });
        expect(result(expired.run, 'authenticate')).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'runTimeoutExceeded' },
        });
        expect(expired.markdown).toContain('before the connection was attempted');
        expect(expired.result.headline).toBeUndefined();
        const snapshot = ctx.session.completedRun?.report;
        if (!snapshot) {
            throw new Error('Missing timeout snapshot');
        }
        const original = JSON.stringify(snapshot);
        const markdown = renderMarkdown(snapshot, { text: createExtensionReportText(), redact: false });
        bridge.observe = undefined;
        for (const profile of ['longer', 'noDiagnosticTimeouts'] as const) {
            const retry = await finish(ctx, profile);
            expect(retry.result.outcome).toBe('connected');
            expect(retry.run.runId).not.toBe(expired.run.runId);
            expect(retry.run.timeoutProfile).toBe(profile);
            expect(retry.run.timeouts.probeTimeoutMs).toBe(profile === 'longer' ? 20000 : null);
            expect(JSON.stringify(snapshot)).toBe(original);
            expect(renderMarkdown(snapshot, { text: createExtensionReportText(), redact: false })).toBe(markdown);
        }
        expect(new Set(bridge.runs.map((entry): string => entry.run.runId)).size).toBe(bridge.runs.length);
    });

    it('9. a blocked connection suggests firewall/IP allowlist checks on the actual extension host', async (): Promise<void> => {
        Object.defineProperty(vscode.env, 'remoteName', { value: 'ssh-remote', configurable: true });
        fixture.controls.connectError = 'ETIMEDOUT';
        bridge.connect.mockRejectedValue(selectionFailure());
        const view = await finish();
        expect(view.result).toMatchObject({ outcome: 'failed', firewallHint: true });
        expect(view.finished.result.headline?.nextStep).toContain(firewall);
        expect(view.ctx.session.completedRun?.report.summary?.nextSteps).toContainEqual(
            expect.stringContaining(firewall),
        );
        expect(view.ctx.session.completedRun?.report.summary?.location).toBe(
            'Checks ran on the remote host (ssh), not this computer.',
        );
        expect(view.markdown.replace(/\\/g, '')).toContain(firewall);
        expect(rowText(view, 'setup')).toContain('remote host SSH, not this computer');
        expect(view.json).toContain('ETIMEDOUT');
    });

    it('10. stable codes and tagged English details are API data, never the source of panel/card/Markdown wording', async (): Promise<void> => {
        fixture.controls.connectError = 'ETIMEDOUT';
        bridge.connect.mockRejectedValue(rejection());
        const view = await finish(context(AuthMethodId.NativeAuth, `mongodb://${host}/?compressors=snappy`));
        const findings = view.run.results.flatMap((item): Finding<FindingCode>[] => [
            ...item.findings,
            ...(item.steps ?? []).flatMap((step): readonly Finding<FindingCode>[] => step.findings),
        ]);
        expect(findings.length).toBeGreaterThan(0);
        const codes = [...builtInFindingCodes, ...extensionFindingCodes];
        for (const item of findings) {
            expect(codes).toContain(item.code);
            expect(item.detail).toMatchObject({ language: 'en', text: expect.any(String) });
            expect(item.detail.text.length).toBeGreaterThan(0);
        }
        const replace = (item: CheckResult<FindingCode>): CheckResult<FindingCode> => ({
            ...item,
            findings: item.findings.map(
                (value): Finding<FindingCode> => ({ ...value, detail: { language: 'en', text: detailSentinel } }),
            ),
            steps: item.steps?.map((step): NonNullable<CheckResult<FindingCode>['steps']>[number] => ({
                ...step,
                findings: step.findings.map(
                    (value): Finding<FindingCode> => ({ ...value, detail: { language: 'en', text: detailSentinel } }),
                ),
            })),
        });
        const run = { ...view.run, results: view.run.results.map(replace) };
        const events = view.events.map(
            (event): DiagnosticsEvent<FindingCode> =>
                event.type === 'checkFinished'
                    ? { ...event, result: replace(event.result) }
                    : event.type === 'runFinished'
                      ? { ...event, run }
                      : event,
        );
        const changed = outputs(run, events, view.ctx.session.completedRun?.report.summary);
        expect(changed.projector.rows()).toEqual(view.projector.rows());
        expect(changed.result).toEqual(view.result);
        expect(changed.markdown).toBe(view.markdown);
        expect(JSON.stringify(changed.projector.rows())).not.toContain(detailSentinel);
        const changedDetails = withRowDetails(changed.projector.rows(), run.results, describeFinding);
        expect(changedDetails.some((row): boolean => row.details !== undefined)).toBe(true);
        expect(JSON.stringify(changedDetails)).not.toContain(detailSentinel);
        expect(JSON.stringify(changed.result)).not.toContain(detailSentinel);
        expect(changed.markdown).not.toContain(detailSentinel);
        expect(changed.json).toContain(detailSentinel);
    });

    it('11. negotiated unavailable snappy is flagged before sign-in and explains Database access failure, but a gateway still connects', async (): Promise<void> => {
        fixture.controls.reply = { ok: 1, isWritablePrimary: true, setName: 'rs0', compression: ['snappy'] };
        bridge.command.mockImplementation(
            async (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
                if (command.ping) {
                    throw new Error('Optional module `snappy` not found');
                }
                return command.hello ? (fixture.controls.reply as Record<string, unknown>) : { ok: 1 };
            },
        );
        const ctx = context(AuthMethodId.NativeAuth, `mongodb://${host}/?compressors=snappy`);
        const view = await finish(ctx);
        expect(result(view.run, 'hello').findings).toContainEqual(
            expect.objectContaining({ code: 'hello.compressorUnavailable' }),
        );
        const helloIndex = view.events.findIndex(
            (event): boolean => event.type === 'checkFinished' && event.result.checkId === 'hello',
        );
        const authIndex = view.events.findIndex(
            (event): boolean => event.type === 'checkStarted' && event.checkId === 'authenticate',
        );
        expect(helloIndex).toBeLessThan(authIndex);
        expect(bridge.connect).toHaveBeenCalled();
        expect(rowText(view, 'serverResponse')).toContain('Compressor unavailable');
        expect(view.result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'databaseAccess',
            headline: { code: 'hello.compressorUnavailable' },
        });
        expect(view.result.headline?.nextStep).toContain('put zlib first');
        expect(view.result.headline?.explanation).toContain('snappy');
        expect(JSON.stringify(view.finished.result)).not.toContain('Optional module');
        expect(view.markdown.replace(/\\/g, '')).toContain('hello.compressorUnavailable');
        fixture.controls.reply = gatewayReply;
        bridge.command.mockImplementation(
            async (command: Record<string, unknown>): Promise<Record<string, unknown>> =>
                command.hello ? gatewayReply : { ok: 1, databases: [{ name: 'fixture' }] },
        );
        const gateway = await finish(ctx);
        expect(gateway.result).toMatchObject({ outcome: 'connected' });
        expect(
            gateway.finished.rows.filter((row): boolean => row.status === 'warning').map((row): string => row.id),
        ).toEqual(['connectionSettings']);
        expect(result(gateway.run, 'hello').findings).not.toContainEqual(
            expect.objectContaining({ code: 'hello.compressorUnavailable' }),
        );
        expect(gateway.markdown.replace(/\\/g, '')).toContain('cs.compressorUnavailable');
    });

    it('12. DocumentDB reads gateway, and clock skew supports token failures without failing a connection on its own', async (): Promise<void> => {
        fixture.controls.reply = { ...gatewayReply, localTime: new Date(Date.now() + 7 * 60000) };
        const connected = await finish();
        expect(connected.result.outcome).toBe('connected');
        expect(result(connected.run, 'hello').status).toBe('pass');
        expect(rowText(connected, 'serverResponse')).toContain('DocumentDB gateway');
        expect(rowText(connected, 'serverResponse')).not.toMatch(/replica set|sharded/i);
        expect(rowText(connected, 'serverResponse')).toContain('Clock 7 min behind the server');
        expect(connected.markdown.replace(/\\/g, '')).toContain('hello.clockOffset');
        bridge.getSessionFromVSCode.mockRejectedValue(new Error('AADSTS53003: blocked by conditional access'));
        const failed = await finish(context(AuthMethodId.MicrosoftEntraID));
        expect(failed.result).toMatchObject({ outcome: 'failed', headline: { code: 'auth.entraTokenFailed' } });
        expect(rowText(failed, 'serverResponse')).toContain('Clock 7 min behind the server');
        expect(rowText(failed, 'authentication')).toContain('Sign-in failed');
        expect(failed.markdown.replace(/\\/g, '')).toContain('hello.clockOffset');
        expect(failed.markdown.replace(/\\/g, '')).toContain('auth.entraTokenFailed');
        expect(failed.json).toContain('53003');
    });

    describe('WI-27: unreachable host reports the root cause (decision 0047)', (): void => {
        it('13. TCP fails on every host and the driver times out: the card stops at Network connection', async (): Promise<void> => {
            vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
            const net = fixture.io.net;
            if (!net) {
                throw new Error('Missing fake sockets');
            }
            // The operator's run: the TCP probe never connects, so the diagnostic time limit ends it.
            vi.mocked(net.connect).mockImplementation(async (): Promise<never> => new Promise<never>(() => undefined));
            bridge.connect.mockRejectedValue(selectionFailure());
            const running = finish(context(AuthMethodId.NoAuth));
            await flush();
            await vi.advanceTimersByTimeAsync((DEFAULT_TIMEOUTS.probeTimeoutMs ?? 0) + 1000);
            const view = await running;
            expect(result(view.run, 'tcp').findings).toContainEqual(
                expect.objectContaining({ code: 'check.timeout', data: expect.objectContaining({ operation: 'tcp' }) }),
            );
            expect(result(view.run, 'authenticate').findings).toContainEqual(
                expect.objectContaining({ code: 'auth.serverSelectionTimeout' }),
            );
            expect(view.result).toMatchObject({
                outcome: 'failed',
                stoppedAtRow: 'networkConnection',
                headline: { checkId: 'tcp', code: 'check.timeout', target: `${host}:27017` },
                supporting: { corroboration: 'serverSelection' },
                firewallHint: true,
            });
            expect(view.finished.result.headline).toMatchObject({
                title: 'Network connection timed out',
                explanation:
                    'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
            });
            expect(view.finished.result.headline?.nextStep).toContain(firewall);
            expect(rowText(view, 'networkConnection')).toBe(
                `Network connection timed out (${host}) · 0 of 1 hosts reachable · Port 27017`,
            );
            expect(rowText(view, 'authentication')).toBe('No authentication · Could not reach a server');
            const authentication = view.finished.rows.find((row): boolean => row.id === 'authentication');
            expect(authentication?.status).toBe('error');
            expect(JSON.stringify(view.finished.rows)).not.toContain('Did not finish in time');
            expect(JSON.stringify(view.finished.result)).not.toContain('Step timed out');
            // The report keeps both codes and leads with the probe.
            expect(view.markdown.replace(/\\/g, '')).toContain('Connection failed** · Network connection (TCP)');
            expect(view.markdown.replace(/\\/g, '')).toContain('auth.serverSelectionTimeout');
        });

        it('14. a refused TCP probe with a driver timeout leads with the refusal; a driver that connects anyway is connected', async (): Promise<void> => {
            fixture.controls.connectError = 'ECONNREFUSED';
            bridge.connect.mockRejectedValue(selectionFailure());
            const failed = await finish();
            expect(failed.result).toMatchObject({
                outcome: 'failed',
                stoppedAtRow: 'networkConnection',
                headline: { code: 'tcp.refused' },
                supporting: { corroboration: 'serverSelection' },
            });
            // Authenticate stays independent of the probes: the driver can still succeed when they fail.
            bridge.connect.mockResolvedValue(undefined);
            const connected = await finish();
            expect(result(connected.run, 'tcp').status).toBe('fail');
            expect(connected.result.outcome).toBe('connected');
            expect(connected.result.headline).toBeUndefined();
        });

        it('15. passing probes and a rejected sign-in stay at Authentication', async (): Promise<void> => {
            bridge.connect.mockRejectedValue(rejection());
            const view = await finish();
            expect(view.result).toMatchObject({
                outcome: 'failed',
                stoppedAtRow: 'authentication',
                headline: { code: 'auth.failed' },
            });
            expect(view.result.supporting).toBeUndefined();
            expect(rowText(view, 'authentication')).not.toContain('Could not reach a server');
        });
    });

    describe('WI-27: No authentication that the server refuses to serve (decision 0048)', (): void => {
        const gatewayRefusal = 'Command listDatabases is not allowed as the connection is not authenticated yet.';

        function refuseUntilSignIn(code: number, codeName: string): void {
            bridge.command.mockImplementation(
                async (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
                    if (command.hello) {
                        return gatewayReply;
                    }
                    if (command.ping) {
                        return { ok: 1 };
                    }
                    if (command.buildInfo) {
                        return { ok: 1, version: '7.0.12' };
                    }
                    const name = Object.keys(command)[0];
                    throw new MongoServerError({
                        message: gatewayRefusal.replace('listDatabases', name),
                        code,
                        codeName,
                    });
                },
            );
        }

        it.each([
            [13, 'Unauthorized'],
            [115, 'CommandNotSupported'],
        ])(
            '16. the gateway refusal (%s %s) with No authentication is connected, but sign-in is required',
            async (code, codeName): Promise<void> => {
                refuseUntilSignIn(code, codeName);
                const view = await finish(context(AuthMethodId.NoAuth));
                expect(view.result).toMatchObject({
                    outcome: 'connected',
                    signInRequired: true,
                    authenticated: false,
                    headline: { code: 'access.signInRequired' },
                });
                expect(view.finished.result).toMatchObject({
                    signInRequired: true,
                    headline: {
                        title: 'Sign-in required to use this connection',
                        explanation:
                            'The server answered, but it requires sign-in to list or read databases. This connection is set to No authentication.',
                        nextStep:
                            'Use Update Credentials to choose an authentication method for this connection, then run the diagnosis again.',
                    },
                });
                const access = view.finished.rows.find((row): boolean => row.id === 'databaseAccess');
                expect(access?.status).toBe('warning');
                expect(rowText(view, 'databaseAccess')).toMatch(
                    /^Ping (?:< )?\d+ ms · Listing databases needs sign-in$/,
                );
                expect(access?.details?.findings[0]).toMatchObject({
                    severity: 'warning',
                    title: 'Sign-in required to use this connection',
                });
                const evidence = access?.details?.evidence.find((item) => item.kind === 'access');
                expect(evidence).toMatchObject({
                    commands: expect.arrayContaining([
                        { command: 'ping', outcome: 'ok' },
                        { command: 'connectionStatus', outcome: 'signInRequired' },
                        { command: 'listDatabases', outcome: 'signInRequired' },
                    ]),
                });
                // Codes and the server's message stay out of the panel; the report keeps the code name.
                expect(JSON.stringify(view.finished)).not.toContain(codeName);
                expect(JSON.stringify(view.finished)).not.toContain('not authenticated yet');
                expect(view.json).toContain(codeName);
                expect(view.markdown).not.toContain('not authenticated yet');
                expect(view.ctx.session.completedRun?.report.summary?.nextSteps).toContain(
                    'Use Update Credentials to choose an authentication method for this connection, then run the diagnosis again.',
                );
            },
        );

        it('17. the same refusal with a signed-in method keeps the listing-denied path', async (): Promise<void> => {
            refuseUntilSignIn(13, 'Unauthorized');
            const view = await finish();
            expect(view.result.outcome).toBe('connected');
            expect(view.result.signInRequired).toBeUndefined();
            expect(view.result.headline).toBeUndefined();
            expect(rowText(view, 'databaseAccess')).toBe('Connected · Listing databases denied');
            const evidence = view.finished.rows
                .find((row): boolean => row.id === 'databaseAccess')
                ?.details?.evidence.find((item) => item.kind === 'access');
            expect(evidence).toMatchObject({
                commands: expect.arrayContaining([{ command: 'listDatabases', outcome: 'denied' }]),
            });
        });

        it('18. No authentication with listing allowed is a clean success', async (): Promise<void> => {
            const view = await finish(context(AuthMethodId.NoAuth));
            expect(view.result).toMatchObject({ outcome: 'connected', authenticated: false });
            expect(view.result.signInRequired).toBeUndefined();
            expect(view.result.headline).toBeUndefined();
            expect(rowText(view, 'databaseAccess')).toMatch(/^Ping (?:< )?\d+ ms · 1 database visible$/);
        });

        it('19. an unsupported command stays "not supported", not a sign-in requirement', async (): Promise<void> => {
            bridge.command.mockImplementation(
                async (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
                    if (command.connectionStatus) {
                        throw new MongoServerError({
                            message: 'no such command: connectionStatus',
                            code: 59,
                            codeName: 'CommandNotFound',
                        });
                    }
                    if (command.hello) {
                        return gatewayReply;
                    }
                    return command.listDatabases ? { ok: 1, databases: [{ name: 'fixture' }] } : { ok: 1 };
                },
            );
            const view = await finish(context(AuthMethodId.NoAuth));
            expect(view.result.signInRequired).toBeUndefined();
            const evidence = view.finished.rows
                .find((row): boolean => row.id === 'databaseAccess')
                ?.details?.evidence.find((item) => item.kind === 'access');
            expect(evidence).toMatchObject({
                commands: expect.arrayContaining([{ command: 'connectionStatus', outcome: 'unsupported' }]),
            });
        });
    });
});
