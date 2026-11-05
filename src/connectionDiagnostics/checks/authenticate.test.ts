/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DiagnosticsCancelledError,
    runDiagnostics,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type CheckStepResult,
    type DiagnosticsEvent,
    type DiagnosticsRun,
    type DiagnosticsTimeouts,
    type ProbeTarget,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import {
    MongoClient,
    MongoNetworkError,
    MongoNetworkTimeoutError,
    MongoServerError,
    MongoServerSelectionError,
    type MongoClientOptions,
    type OIDCCallbackParams,
    type TopologyDescription,
} from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import type * as documentdbTokenResource from '../../documentdb/auth/documentdbTokenResource';
import { type TokenResourceResolverDeps } from '../../documentdb/auth/documentdbTokenResource';
import type * as entraTokenFailures from '../../documentdb/auth/entraErrors/entraTokenFailures';
import {
    clearEntraTokenFailure,
    recordEntraTokenFailure,
    resetEntraTokenFailuresForTests,
} from '../../documentdb/auth/entraErrors/entraTokenFailures';
import { getTokenResourceForCloud } from '../../documentdb/auth/entraScopes';
import { CredentialCache, type CachedClusterCredentials } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { createRunOwnedClient, type RunOwnedClient } from '../auth/runOwnedClient';
import { type DiagnosticsSetup } from '../input';
import { DiagnosticsOutputTrace } from '../outputTrace';
import { type DiagnosticsTarget, type FindingCode } from '../types';
import { createAuthenticateCheck, type AuthenticateCheckDeps } from './authenticate';

const mocks = vi.hoisted(() => ({
    resolverDeps: undefined as unknown,
    getSessionFromVSCode: vi.fn(),
    getManagedIdentityAccessToken: vi.fn(),
    getClient: vi.fn(),
}));

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), trace: vi.fn(), debug: vi.fn() } },
}));
vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]): unknown => mocks.getSessionFromVSCode(...args),
}));
vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    appendExtensionUserAgent: vi.fn((): string => 'documentdb-test-agent'),
}));
vi.mock('../../documentdb/auth/documentdbTokenResource', async (importOriginal) => {
    const actual = await importOriginal<typeof documentdbTokenResource>();
    return {
        ...actual,
        resolveInteractiveTokenResource: vi.fn((connectionString: string) =>
            actual.resolveInteractiveTokenResource(connectionString, mocks.resolverDeps as TokenResourceResolverDeps),
        ),
        resolveManagedIdentityTokenResource: vi.fn((connectionString: string) =>
            actual.resolveManagedIdentityTokenResource(
                connectionString,
                mocks.resolverDeps as TokenResourceResolverDeps,
            ),
        ),
    };
});
vi.mock('../../documentdb/auth/managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: (...args: unknown[]): unknown => mocks.getManagedIdentityAccessToken(...args),
}));
vi.mock('../../documentdb/auth/entraErrors/entraTokenFailures', async (importOriginal) => {
    const actual = await importOriginal<typeof entraTokenFailures>();
    return {
        ...actual,
        recordEntraTokenFailure: vi.fn(actual.recordEntraTokenFailure),
        clearEntraTokenFailure: vi.fn(actual.clearEntraTokenFailure),
    };
});
vi.mock('../../documentdb/ClustersClient', () => ({ ClustersClient: { getClient: mocks.getClient } }));

const clusterId = 'stable-cluster-id';
const runId = '6f1c1d2e-0000-4000-8000-000000000001';
const publicHost = 'fixture.mongocluster.cosmos.azure.com';
const governmentHost = 'fixture.mongocluster.cosmos.azure.us';
const privateHost = 'cluster.private.example.com';
const publicResource = getTokenResourceForCloud('AzureCloud');
const governmentResource = getTokenResourceForCloud('AzureUSGovernment');
const tenant = '11111111-2222-3333-4444-555555555555';
const user = 'fixture-user';
const password = 'P@ss-SECRET-word:1';
const errorSentinel = 'ERRMSG-SENTINEL-c0ffee';
const claimSentinel = 'CLAIM-SENTINEL-beef';
const vscodeClientId = 'aebc6443-996d-45c2-90f0-388ff96faa56';
const target: DiagnosticsTarget = {
    clusterId,
    displayName: 'Fixture',
    sourceView: 'connections',
    getCredentials: (): never => {
        throw new Error('Not used');
    },
};

function encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwt(claims: Readonly<Record<string, unknown>>): string {
    return `${encode({ alg: 'RS256' })}.${encode({ name: `${claimSentinel} Name`, upn: `${claimSentinel}@contoso.example`, oid: claimSentinel, ...claims })}.c2lnbmF0dXJl`;
}

function entraToken(claims: Readonly<Record<string, unknown>> = {}): string {
    return jwt({
        aud: publicResource,
        iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
        tid: tenant,
        ver: '2.0',
        azp: vscodeClientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...claims,
    });
}

function createResolverDeps(): TokenResourceResolverDeps {
    return {
        getConfiguredCloud: vi.fn(() => ({ name: 'AzureCloud', isCustomCloud: false })),
        getCustomEnvironment: vi.fn(() => ({})),
        getCustomHostnameSuffixSource: vi.fn((): 'none' => 'none'),
        fetchArmMetadata: vi.fn().mockResolvedValue(undefined),
        readImdsAzEnvironment: vi.fn().mockResolvedValue(undefined),
        getSignInEnvironment: vi.fn(() => ({ authProvider: 'microsoft', brokerImplementation: undefined })),
        warn: vi.fn(),
    };
}

function resolverDeps(): TokenResourceResolverDeps {
    return mocks.resolverDeps as TokenResourceResolverDeps;
}

function setupFor(
    method: AuthMethodId | undefined,
    host: string,
    credentials: Partial<CachedClusterCredentials> = {},
    credentialState: DiagnosticsSetup['credentialState'] = method === undefined ? 'noMethod' : 'available',
): DiagnosticsSetup {
    const connectionString = `mongodb://${host}:10260/`;
    return {
        input: { connectionString },
        chosenAuthMethod: method,
        credentialState,
        connectionProperties: undefined,
        transientCredentials:
            method === undefined
                ? undefined
                : {
                      clusterId,
                      connectionString,
                      connectionStringWithPassword:
                          method === AuthMethodId.NativeAuth
                              ? `mongodb://${user}:${encodeURIComponent(password)}@${host}:10260/`
                              : connectionString,
                      authMechanism: method,
                      ...(method === AuthMethodId.NativeAuth
                          ? { nativeAuthConfig: { connectionUser: user, connectionPassword: password } }
                          : {}),
                      ...credentials,
                  },
    };
}

interface FakeClient {
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly connect: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
}

let connectBehavior: (client: FakeClient) => Promise<void>;
let clients: FakeClient[];
let tick: number;

function fakeDeps(): AuthenticateCheckDeps & { createClient: ReturnType<typeof vi.fn> } {
    const base = Date.now();
    return {
        createClient: vi.fn((connectionString: string, options: MongoClientOptions): MongoClient => {
            const client: FakeClient = {
                connectionString,
                options,
                connect: vi.fn((): Promise<void> => connectBehavior(client)),
                close: vi.fn((): Promise<void> => Promise.resolve()),
            };
            clients.push(client);
            return client as unknown as MongoClient;
        }),
        now: (): number => base + (tick += 5),
    };
}

interface AuthRun {
    readonly run: DiagnosticsRun<FindingCode>;
    readonly result: CheckResult<FindingCode>;
    readonly holder: RunOwnedClient;
    readonly telemetry: Record<string, string | undefined>;
    readonly events: DiagnosticsEvent<FindingCode>[];
}

async function runAuth(
    setup: DiagnosticsSetup,
    options: {
        readonly deps?: AuthenticateCheckDeps;
        readonly timeouts?: Partial<DiagnosticsTimeouts>;
        readonly signal?: AbortSignal;
        readonly targets?: readonly ProbeTarget[];
    } = {},
): Promise<AuthRun> {
    const holder = createRunOwnedClient();
    const telemetry: Record<string, string | undefined> = {};
    const events: DiagnosticsEvent<FindingCode>[] = [];
    const trace = new DiagnosticsOutputTrace(runId);
    const host = new URL(setup.input.connectionString).hostname;
    const stubs: Check<RunContext, FindingCode>[] = [
        {
            id: 'connectionString',
            scope: 'run',
            async run(context): Promise<CheckOutcome<FindingCode>> {
                context.setTargets(options.targets ?? [{ host, port: 10260, source: 'uri' }]);
                return { status: 'pass', facts: {}, findings: [] };
            },
        },
        {
            id: 'prepare',
            scope: 'run',
            async run(): Promise<CheckOutcome<FindingCode>> {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, facts: {}, findings: [] };
            },
        },
    ];
    const check = createAuthenticateCheck(
        target,
        () => setup,
        () => telemetry,
        () => holder,
        options.deps ?? fakeDeps(),
    );
    const run: DiagnosticsRun<FindingCode> = await runDiagnostics<FindingCode>({
        runId,
        input: setup.input,
        checks: [...stubs, check],
        ...(options.timeouts ? { timeouts: options.timeouts } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onEvent(event): void {
            events.push(event);
            trace.onEvent(event);
        },
    });
    const result = run.results.find((entry): boolean => entry.checkId === 'authenticate');
    if (!result) {
        throw new Error('Missing authenticate result');
    }
    return { run, result, holder, telemetry, events };
}

function step(result: CheckResult<FindingCode>, stepId: string): CheckStepResult<FindingCode> {
    const found = result.steps?.find((entry): boolean => entry.stepId === stepId);
    if (!found) {
        throw new Error(`Missing step ${stepId}`);
    }
    return found;
}

function codes(result: CheckResult<FindingCode> | CheckStepResult<FindingCode>): string[] {
    return result.findings.map((finding): string => finding.code);
}

function allFindings(result: CheckResult<FindingCode>): CheckResult<FindingCode>['findings'] {
    return [
        ...result.findings,
        ...(result.steps ?? []).flatMap((entry): CheckStepResult<FindingCode>['findings'] => entry.findings),
    ];
}

function outputLines(): string[] {
    const channel = ext.outputChannel as unknown as Record<string, ReturnType<typeof vi.fn>>;
    return ['info', 'error', 'warn', 'trace', 'debug'].flatMap((level): string[] =>
        channel[level].mock.calls.map((args): string => String(args[0])),
    );
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, 0);
    });
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve: (value: T) => void = (): void => undefined;
    let reject: (error: unknown) => void = (): void => undefined;
    const promise = new Promise<T>((res, rej): void => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function selectionError(servers: readonly (readonly [string, Error | null])[]): MongoServerSelectionError {
    const description = {
        servers: new Map(servers.map(([address, error]) => [address, { address, error }])),
    } as unknown as TopologyDescription;
    return new MongoServerSelectionError(`Server selection timed out ${errorSentinel}`, description);
}

const credentialSetters = [
    'setCredentials',
    'setAuthCredentials',
    'setFromConnectionItem',
    'deleteCredentials',
] as const;

describe('createAuthenticateCheck', (): void => {
    beforeEach(async (): Promise<void> => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        const { resetTokenResourceCacheForTests } = await import('../../documentdb/auth/documentdbTokenResource');
        resetTokenResourceCacheForTests();
        mocks.resolverDeps = createResolverDeps();
        mocks.getSessionFromVSCode.mockResolvedValue({
            accessToken: entraToken(),
            account: { label: 'alice@contoso.example', id: 'account-id' },
        });
        mocks.getManagedIdentityAccessToken.mockResolvedValue({
            accessToken: jwt({
                aud: publicResource,
                xms_mirid: '/subscriptions/x/identity',
                idtyp: 'app',
                exp: Math.floor(Date.now() / 1000) + 600,
            }),
            expiresOnTimestamp: Date.now() + 600_000,
        });
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        connectBehavior = (): Promise<void> => Promise.resolve();
        clients = [];
        tick = 0;
        for (const setter of credentialSetters) {
            vi.spyOn(CredentialCache, setter);
        }
    });

    afterEach((): void => {
        vi.restoreAllMocks();
        resetEntraTokenFailuresForTests();
    });

    it('is a run check that depends on the connection string and preparation, not the probes', (): void => {
        const check = createAuthenticateCheck(
            target,
            (): never => {
                throw new Error('unused');
            },
            (): never => {
                throw new Error('unused');
            },
            (): never => {
                throw new Error('unused');
            },
        );
        expect(check).toMatchObject({
            id: 'authenticate',
            scope: 'run',
            dependsOn: ['connectionString', 'prepare'],
            timeout: 'authentication',
        });
    });

    describe('skips only where a real connect would prompt', (): void => {
        it.each([
            ['no chosen method', setupFor(undefined, publicHost), 'method', undefined],
            [
                'native without a stored password',
                setupFor(
                    AuthMethodId.NativeAuth,
                    privateHost,
                    { nativeAuthConfig: { connectionUser: user, connectionPassword: '' } },
                    'passwordMissing',
                ),
                'password',
                AuthMethodId.NativeAuth,
            ],
        ] as const)('%s', async (_label, setup, missing, authMethod): Promise<void> => {
            const deps = fakeDeps();
            const { result, holder } = await runAuth(setup, { deps });
            expect(holder.authError).toBeUndefined();
            expect(result).toMatchObject({ status: 'skipped', skippedBecause: { reason: 'inputUnavailable' } });
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.credentialsUnavailable',
                    data: { missing, ...(authMethod === undefined ? {} : { authMethod }) },
                }),
            ]);
            expect(deps.createClient).not.toHaveBeenCalled();
            expect(mocks.getSessionFromVSCode).not.toHaveBeenCalled();
        });

        it('skips Microsoft Entra ID without a silent session and records no token failure', async (): Promise<void> => {
            mocks.getSessionFromVSCode.mockResolvedValue(undefined);
            const deps = fakeDeps();
            const { result, holder } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost), { deps });
            expect(holder.authError).toBeUndefined();
            expect(result).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
                facts: {
                    authMethod: AuthMethodId.MicrosoftEntraID,
                    signInLimitation: 'silentLookupCannotDistinguishConsent',
                    authenticated: false,
                },
            });
            expect(result.facts.earlierInSession).toBeUndefined();
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.credentialsUnavailable',
                    data: { missing: 'entraSession', authMethod: AuthMethodId.MicrosoftEntraID },
                }),
            ]);
            expect(step(result, 'auth.signInConfiguration').status).toBe('pass');
            expect(step(result, 'auth.token')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'inputUnavailable' },
            });
            expect(step(result, 'auth.serverAuthentication')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencySkipped', stepId: 'auth.token' },
            });
            expect(recordEntraTokenFailure).not.toHaveBeenCalled();
            expect(clearEntraTokenFailure).not.toHaveBeenCalled();
            expect(deps.createClient).not.toHaveBeenCalled();
        });

        it('shows a recent recorded token failure as earlier in this session without changing the outcome', async (): Promise<void> => {
            recordEntraTokenFailure(clusterId, {
                cloudCategory: 'usgov',
                authMethod: 'interactive',
                ruleId: 'firstPartyPreauthorization',
            });
            vi.mocked(recordEntraTokenFailure).mockClear();
            mocks.getSessionFromVSCode.mockResolvedValue(undefined);
            const { result } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
            expect(result.status).toBe('skipped');
            expect(result.facts.earlierInSession).toEqual({
                ageSeconds: 0,
                cloudCategory: 'usgov',
                ruleId: 'firstPartyPreauthorization',
            });
            expect(recordEntraTokenFailure).not.toHaveBeenCalled();
        });
    });

    describe('fails where a real connect fails', (): void => {
        it('retains the original configuration error only in the host holder', async (): Promise<void> => {
            const resolver = await import('../../documentdb/auth/documentdbTokenResource');
            const original = new Error(errorSentinel);
            vi.mocked(resolver.resolveInteractiveTokenResource).mockImplementationOnce((): never => {
                throw original;
            });
            const { result, holder } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
            expect(holder.authError).toBe(original);
            expect(result.status).toBe('fail');
            expect(JSON.stringify(result)).not.toContain(errorSentinel);
        });

        it('fails a cloud mismatch before any token request', async (): Promise<void> => {
            const deps = fakeDeps();
            const { result } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, governmentHost), { deps });
            expect(result.status).toBe('fail');
            const signIn = step(result, 'auth.signInConfiguration');
            expect(signIn).toMatchObject({
                status: 'fail',
                facts: {
                    configuredCloud: 'AzureCloud',
                    hostCloud: 'AzureUSGovernment',
                    errorKind: 'cloudMismatch',
                    tokenResource: 'AzureCloud',
                },
            });
            expect(signIn.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.cloudMismatch',
                    severity: 'error',
                    data: { configuredCloud: 'AzureCloud', hostCloud: 'AzureUSGovernment' },
                }),
            ]);
            expect(step(result, 'auth.token')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', stepId: 'auth.signInConfiguration' },
            });
            expect(step(result, 'auth.serverAuthentication').status).toBe('skipped');
            expect(mocks.getSessionFromVSCode).not.toHaveBeenCalled();
            expect(deps.createClient).not.toHaveBeenCalled();
        });

        it.each([
            [
                'an invalid ossrdbmsEndpoint override',
                AuthMethodId.MicrosoftEntraID,
                privateHost,
                'invalidCustomOverride',
                (deps: TokenResourceResolverDeps): void => {
                    vi.mocked(deps.getConfiguredCloud).mockReturnValue({
                        name: 'custom',
                        isCustomCloud: true,
                        activeDirectoryEndpointUrl: 'https://login.example.com/',
                    });
                    vi.mocked(deps.getCustomEnvironment).mockReturnValue({
                        ossrdbmsEndpoint: 'http://not-https.example/path',
                    });
                },
            ],
            [
                'an unreadable custom cloud definition',
                AuthMethodId.MicrosoftEntraID,
                privateHost,
                'customCloudDefinitionInvalid',
                (deps: TokenResourceResolverDeps): void => {
                    vi.mocked(deps.getConfiguredCloud).mockImplementation(() => {
                        throw new Error('custom cloud unreadable');
                    });
                },
            ],
            [
                'a custom cloud without a resolvable resource',
                AuthMethodId.MicrosoftEntraID,
                privateHost,
                'customCloudUnresolved',
                (deps: TokenResourceResolverDeps): void => {
                    vi.mocked(deps.getConfiguredCloud).mockReturnValue({
                        name: 'custom',
                        isCustomCloud: true,
                        activeDirectoryEndpointUrl: 'https://login.example.com/',
                        resourceManagerEndpointUrl: 'https://management.example.com/',
                    });
                },
            ],
            [
                'managed identity with an unknown cloud',
                AuthMethodId.ManagedIdentity,
                privateHost,
                'managedIdentityCloudUnknown',
                (): void => undefined,
            ],
        ] as const)('fails %s with the resolver kind', async (_label, method, host, kind, configure): Promise<void> => {
            configure(resolverDeps());
            const deps = fakeDeps();
            const { result } = await runAuth(
                setupFor(method, host, method === AuthMethodId.ManagedIdentity ? { managedIdentityConfig: {} } : {}),
                { deps },
            );
            expect(result.status).toBe('fail');
            expect(step(result, 'auth.signInConfiguration')).toMatchObject({
                status: 'fail',
                facts: { errorKind: kind },
            });
            expect(allFindings(result)).toEqual([
                expect.objectContaining({ code: 'auth.tokenResourceUnresolved', data: { kind } }),
            ]);
            expect(mocks.getSessionFromVSCode).not.toHaveBeenCalled();
            expect(mocks.getManagedIdentityAccessToken).not.toHaveBeenCalled();
            expect(deps.createClient).not.toHaveBeenCalled();
        });

        it('fails a host outside the OIDC allowlist, as the real driver rejects it, without sending a token', async (): Promise<void> => {
            const created: MongoClient[] = [];
            const deps: AuthenticateCheckDeps = {
                createClient: (connectionString, options): MongoClient => {
                    const client = new MongoClient(connectionString, options);
                    created.push(client);
                    return client;
                },
                now: (): number => Date.now(),
            };
            const { result } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, privateHost), { deps });
            expect(result.status).toBe('fail');
            const signIn = step(result, 'auth.signInConfiguration');
            expect(signIn).toMatchObject({
                status: 'fail',
                facts: { allHostsAllowed: false, allowedHostPatterns: ['*.azure.com'] },
            });
            expect(codes(signIn)).toEqual(['auth.oidcHostNotAllowed']);
            expect(step(result, 'auth.serverAuthentication')).toMatchObject({
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', stepId: 'auth.signInConfiguration' },
            });
            expect(created).toHaveLength(1);
            expect(JSON.stringify(result)).not.toContain(privateHost);
        });

        it.each([
            [
                'the AADSTS65002 preauthorization failure',
                `AADSTS65002: Consent between first party application and first party resource must be configured via preauthorization ${errorSentinel}`,
                'firstPartyPreauthorization',
                '65002',
            ],
            [
                'the opaque broker error',
                `platform_broker_error: an error occurred ${errorSentinel}`,
                'brokerOpaque',
                undefined,
            ],
        ] as const)(
            'fails a token request that throws with %s',
            async (_label, message, ruleId, aadstsCode): Promise<void> => {
                const original = new Error(message);
                mocks.getSessionFromVSCode.mockRejectedValue(original);
                const deps = fakeDeps();
                const { result, holder } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost), { deps });
                expect(result.status).toBe('fail');
                expect(holder.authError).toBe(original);
                const token = step(result, 'auth.token');
                expect(token).toMatchObject({ status: 'fail', facts: { errorName: 'Error', ruleId } });
                expect(token.findings).toEqual([
                    expect.objectContaining({
                        code: 'auth.entraTokenFailed',
                        data: { ruleId, ...(aadstsCode === undefined ? {} : { aadstsCode }) },
                    }),
                ]);
                expect(step(result, 'auth.serverAuthentication')).toMatchObject({
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencyFailed', stepId: 'auth.token' },
                });
                expect(recordEntraTokenFailure).toHaveBeenCalledWith(clusterId, {
                    cloudCategory: 'public',
                    authMethod: 'interactive',
                    ruleId,
                });
                expect(deps.createClient).not.toHaveBeenCalled();
                expect(JSON.stringify(result)).not.toContain(errorSentinel);
            },
        );

        it('fails server code 18 as an authentication rejection for native authentication', async (): Promise<void> => {
            const original = new MongoServerError({
                ok: 0,
                code: 18,
                codeName: 'AuthenticationFailed',
                errmsg: `Authentication failed ${errorSentinel}`,
            });
            connectBehavior = (): Promise<void> => Promise.reject(original);
            const { result, holder } = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(result).toMatchObject({
                status: 'fail',
                facts: {
                    authMethod: AuthMethodId.NativeAuth,
                    mechanism: 'DEFAULT',
                    userName: user,
                    authenticated: false,
                    errorName: 'MongoServerError',
                    errorCode: 18,
                    serverCodeName: 'AuthenticationFailed',
                },
            });
            expect(result.steps).toBeUndefined();
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.failed',
                    data: {
                        authMethod: AuthMethodId.NativeAuth,
                        serverCode: 18,
                        serverCodeName: 'AuthenticationFailed',
                    },
                }),
            ]);
            expect(holder.client).toBeUndefined();
            expect(holder.authError).toBe(original);
        });

        it('classifies an unavailable mechanism by its server code', async (): Promise<void> => {
            connectBehavior = (): Promise<void> =>
                Promise.reject(
                    new MongoServerError({ ok: 0, code: 334, codeName: 'MechanismUnavailable', errmsg: errorSentinel }),
                );
            const { result } = await runAuth(
                setupFor(AuthMethodId.NativeAuth, privateHost, {
                    connectionString: `mongodb://${privateHost}:10260/?authMechanism=SCRAM-SHA-1`,
                }),
            );
            expect(result.status).toBe('fail');
            expect(result.findings).toEqual([
                expect.objectContaining({ code: 'auth.mechanismMismatch', data: { requested: 'SCRAM-SHA-1' } }),
            ]);
        });

        it('reports server selection with per-server errors and advertised members only for non-seeds', async (): Promise<void> => {
            const refused = new MongoNetworkError(`connect ECONNREFUSED ${errorSentinel}`, {
                cause: Object.assign(new Error(errorSentinel), { code: 'ECONNREFUSED' }),
            });
            connectBehavior = (): Promise<void> =>
                Promise.reject(
                    selectionError([
                        [`${privateHost}:10260`, refused],
                        ['internal-member-1:27017', new MongoNetworkTimeoutError(`timed out ${errorSentinel}`)],
                        ['internal-member-2:27017', null],
                    ]),
                );
            const { result } = await runAuth(
                setupFor(AuthMethodId.NativeAuth, privateHost, {
                    emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: false },
                }),
            );
            expect(result.status).toBe('fail');
            expect(result.facts.serverErrors).toEqual([
                { address: `${privateHost}:10260`, errorName: 'MongoNetworkError', errorCode: 'ECONNREFUSED' },
                { address: 'internal-member-1:27017', errorName: 'MongoNetworkTimeoutError' },
            ]);
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.serverSelectionTimeout',
                    data: { timeoutMs: 4000, timeoutSource: 'extensionPolicy', serverErrorCount: 2 },
                }),
                expect.objectContaining({
                    code: 'hello.advertisedMembersUnreachable',
                    severity: 'warning',
                    data: { unreachableCount: 1 },
                }),
            ]);
            expect(JSON.stringify(result)).not.toContain(errorSentinel);
        });

        it('R3: labels where the driver selection limit came from, without a runner connection timeout', async (): Promise<void> => {
            connectBehavior = (): Promise<void> =>
                Promise.reject(selectionError([[`${privateHost}:10260`, new MongoNetworkTimeoutError('timed out')]]));
            const policy = await runAuth(
                setupFor(AuthMethodId.NativeAuth, privateHost, {
                    emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: false },
                }),
            );
            expect(policy.result.findings[0]).toMatchObject({
                code: 'auth.serverSelectionTimeout',
                data: { timeoutMs: 4000, timeoutSource: 'extensionPolicy' },
            });
            expect(policy.run.coverage.timedOut).toEqual([]);

            const uriSetup = setupFor(AuthMethodId.NativeAuth, privateHost);
            const uri = `mongodb://${privateHost}:10260/?serverSelectionTimeoutMS=2500`;
            const fromUri = await runAuth({
                ...uriSetup,
                input: { connectionString: uri },
                transientCredentials: uriSetup.transientCredentials && {
                    ...uriSetup.transientCredentials,
                    connectionString: uri,
                    connectionStringWithPassword: `mongodb://${user}:${encodeURIComponent(password)}@${privateHost}:10260/?serverSelectionTimeoutMS=2500`,
                },
            });
            expect(fromUri.result.findings[0]?.data).toMatchObject({ timeoutSource: 'connection' });

            const byDefault = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(byDefault.result.findings[0]?.data).toMatchObject({ timeoutSource: 'driverDefault' });
        });

        it('does not raise advertised members when only seeds failed', async (): Promise<void> => {
            connectBehavior = (): Promise<void> =>
                Promise.reject(
                    selectionError([[`${privateHost.toUpperCase()}:10260`, new MongoNetworkTimeoutError('timed out')]]),
                );
            const { result } = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(codes(result)).toEqual(['auth.serverSelectionTimeout']);
        });

        it('S5: fails any other error with its name and a safe fallback finding', async (): Promise<void> => {
            connectBehavior = (): Promise<void> => Promise.reject(new Error(errorSentinel));
            const { result } = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(result).toMatchObject({
                status: 'fail',
                findings: [
                    { code: 'auth.connectFailed', severity: 'error', data: { errorName: 'Error', phase: 'connect' } },
                ],
                facts: { errorName: 'Error', authenticated: false },
            });
            expect(JSON.stringify(result)).not.toContain(errorSentinel);
        });

        it('S5: an option value the real driver rejects yields a driver-options finding without its message', async (): Promise<void> => {
            const uri = `mongodb://${privateHost}:10260/?retryWrites=not-a-boolean`;
            const base = setupFor(AuthMethodId.NoAuth, privateHost);
            const { result } = await runAuth(
                {
                    ...base,
                    input: { connectionString: uri },
                    transientCredentials: base.transientCredentials && {
                        ...base.transientCredentials,
                        connectionString: uri,
                        connectionStringWithPassword: uri,
                    },
                },
                {
                    deps: {
                        createClient: (connectionString, options): MongoClient =>
                            new MongoClient(connectionString, options),
                        now: Date.now,
                    },
                },
            );
            expect(result.status).toBe('fail');
            expect(result.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.driverOptionsRejected',
                    severity: 'error',
                    data: { errorName: 'MongoParseError' },
                }),
            ]);
            expect(JSON.stringify(result)).not.toContain('not-a-boolean');
        });
    });

    describe('Microsoft Entra ID and managed identity phases', (): void => {
        it('records three passing phases, the claim summary and the facts for a successful Entra ID sign-in', async (): Promise<void> => {
            const deps = fakeDeps();
            const { result, holder, telemetry } = await runAuth(
                setupFor(AuthMethodId.MicrosoftEntraID, publicHost, { entraIdConfig: { tenantId: tenant } }),
                { deps },
            );
            expect(result).toMatchObject({
                status: 'pass',
                findings: [],
                facts: {
                    authMethod: AuthMethodId.MicrosoftEntraID,
                    mechanism: 'MONGODB-OIDC',
                    account: 'alice@contoso.example',
                    tenantConfigured: true,
                    authenticated: true,
                },
            });
            expect(typeof result.facts.tokenMs).toBe('number');
            expect(typeof result.facts.connectMs).toBe('number');
            expect(step(result, 'auth.signInConfiguration')).toMatchObject({
                status: 'pass',
                facts: {
                    configuredCloud: 'AzureCloud',
                    hostCloud: 'AzureCloud',
                    cloudCategory: 'public',
                    tokenResource: 'AzureCloud',
                    tokenResourceReason: 'setting',
                    allowedHostPatterns: ['*.azure.com'],
                    allHostsAllowed: true,
                },
            });
            expect(step(result, 'auth.token')).toMatchObject({
                status: 'pass',
                facts: {
                    claims: {
                        available: true,
                        audience: 'match',
                        issuerCloud: 'public',
                        tokenVersion: '2.0',
                        clientCategory: 'vscode',
                        tenantPresent: true,
                        tenantMatch: 'match',
                        expired: false,
                    },
                },
            });
            expect(step(result, 'auth.serverAuthentication').status).toBe('pass');
            expect(holder.client).toBe(clients[0]);
            expect(clients[0].options.appName).toBe('documentdb-test-agent');
            expect(clients[0].options.authMechanism).toBe('MONGODB-OIDC');
            expect(clearEntraTokenFailure).toHaveBeenCalledWith(clusterId);
            expect(telemetry).toMatchObject({
                cloudCategory: 'public',
                tokenResourceReason: 'setting',
                configuredCloud: 'AzureCloud',
                hostCloud: 'AzureCloud',
                errorKind: 'none',
            });
            expect(mocks.getSessionFromVSCode).toHaveBeenCalledWith([`${publicResource}/.default`], tenant, {
                silent: true,
            });
            for (const call of mocks.getSessionFromVSCode.mock.calls) {
                expect(JSON.stringify(call[2])).not.toMatch(/createIfNone|forceNewSession/);
            }
        });

        it('keeps audience and tenant mismatches as warnings that never fail the check by themselves', async (): Promise<void> => {
            mocks.getSessionFromVSCode.mockResolvedValue({
                accessToken: entraToken({ aud: governmentResource, tid: '99999999-2222-3333-4444-555555555555' }),
            });
            const { result } = await runAuth(
                setupFor(AuthMethodId.MicrosoftEntraID, publicHost, { entraIdConfig: { tenantId: tenant } }),
            );
            expect(result.status).toBe('warning');
            const token = step(result, 'auth.token');
            expect(token.status).toBe('warning');
            expect(token.findings.map((finding): string => `${finding.code}:${finding.severity}`)).toEqual([
                'auth.entraAudienceMismatch:warning',
                'auth.entraTenantMismatch:warning',
            ]);
            expect(result.facts.authenticated).toBe(true);
        });

        it('never claims acceptance when the token succeeds and the server rejects it', async (): Promise<void> => {
            connectBehavior = (): Promise<void> =>
                Promise.reject(
                    new MongoServerError({ ok: 0, code: 18, codeName: 'AuthenticationFailed', errmsg: errorSentinel }),
                );
            const { result, holder } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
            expect(result).toMatchObject({ status: 'fail', facts: { authenticated: false } });
            expect(step(result, 'auth.token').status).toBe('pass');
            const server = step(result, 'auth.serverAuthentication');
            expect(server).toMatchObject({
                status: 'fail',
                facts: { errorName: 'MongoServerError', errorCode: 18, serverCodeName: 'AuthenticationFailed' },
            });
            expect(server.findings).toEqual([
                expect.objectContaining({
                    code: 'auth.failed',
                    data: {
                        authMethod: AuthMethodId.MicrosoftEntraID,
                        serverCode: 18,
                        serverCodeName: 'AuthenticationFailed',
                    },
                }),
            ]);
            expect(holder.client).toBeUndefined();
        });

        it('never claims acceptance when the token succeeds and the connection times out', async (): Promise<void> => {
            connectBehavior = (): Promise<void> => new Promise<void>((): void => undefined);
            const { result, holder } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost), {
                timeouts: { authenticationTimeoutMs: 30 },
            });
            expect(result).toMatchObject({ status: 'fail', facts: {} });
            expect(codes(result)).toEqual(['check.timeout']);
            expect(result.facts.authenticated).toBeUndefined();
            expect(holder.client).toBeUndefined();
            expect(clients[0].close).toHaveBeenCalled();
        });

        it('completes the managed identity token phase during server authentication', async (): Promise<void> => {
            let connecting = false;
            mocks.getManagedIdentityAccessToken.mockImplementation(async () => {
                expect(connecting).toBe(true);
                return {
                    accessToken: jwt({
                        aud: publicResource,
                        xms_mirid: '/subscriptions/x',
                        idtyp: 'app',
                        tid: tenant,
                        exp: Math.floor(Date.now() / 1000) + 600,
                    }),
                    expiresOnTimestamp: Date.now() + 600_000,
                };
            });
            connectBehavior = async (client): Promise<void> => {
                connecting = true;
                const callback = client.options.authMechanismProperties?.OIDC_CALLBACK;
                if (!callback) {
                    throw new Error('Missing OIDC callback');
                }
                await callback({
                    version: 1,
                    timeoutContext: new AbortController().signal,
                } as unknown as OIDCCallbackParams);
            };
            const { result } = await runAuth(
                setupFor(AuthMethodId.ManagedIdentity, publicHost, {
                    managedIdentityConfig: { clientId: 'mi-client-id', tenantId: tenant },
                }),
            );
            expect(result).toMatchObject({
                status: 'pass',
                facts: {
                    managedIdentityKind: 'userAssigned',
                    tenantConfigured: true,
                    authenticated: true,
                    mechanism: 'MONGODB-OIDC',
                },
            });
            const token = step(result, 'auth.token');
            const server = step(result, 'auth.serverAuthentication');
            const offset = (entry: CheckStepResult<FindingCode>): number => entry.facts.startOffsetMs as number;
            expect(offset(token)).toBeGreaterThan(offset(server));
            expect(offset(token) + token.durationMs).toBeLessThanOrEqual(offset(server) + server.durationMs);
            expect(token.facts.claims).toMatchObject({ clientCategory: 'managedIdentity', tenantMatch: 'match' });
            expect(JSON.stringify(result)).not.toContain('mi-client-id');
        });

        it('fails a managed identity token failure inside the driver callback in the token phase', async (): Promise<void> => {
            mocks.getManagedIdentityAccessToken.mockRejectedValue(
                Object.assign(new Error(`ManagedIdentityCredential failed ${errorSentinel}`), {
                    name: 'CredentialUnavailableError',
                }),
            );
            connectBehavior = async (client): Promise<void> => {
                const callback = client.options.authMechanismProperties?.OIDC_CALLBACK;
                if (!callback) {
                    throw new Error('Missing OIDC callback');
                }
                await callback({ version: 1 } as unknown as OIDCCallbackParams);
            };
            const { result } = await runAuth(
                setupFor(AuthMethodId.ManagedIdentity, publicHost, { managedIdentityConfig: {} }),
            );
            expect(result.status).toBe('fail');
            expect(step(result, 'auth.token')).toMatchObject({
                status: 'fail',
                facts: { errorName: 'CredentialUnavailableError', ruleId: 'unclassified' },
            });
            expect(codes(step(result, 'auth.token'))).toEqual(['auth.entraTokenFailed']);
            expect(step(result, 'auth.serverAuthentication').status).toBe('fail');
            expect(recordEntraTokenFailure).toHaveBeenCalledWith(clusterId, {
                cloudCategory: 'public',
                authMethod: 'managedIdentity',
            });
            expect(JSON.stringify(result)).not.toContain(errorSentinel);
        });
    });

    describe('No Authentication and native', (): void => {
        it('passes No Authentication without calling it authenticated', async (): Promise<void> => {
            const { result, holder } = await runAuth(setupFor(AuthMethodId.NoAuth, privateHost));
            expect(result).toMatchObject({
                status: 'pass',
                findings: [],
                facts: { authMethod: AuthMethodId.NoAuth, mechanism: 'none', authenticated: false },
            });
            expect(result.steps).toBeUndefined();
            expect(holder.client).toBe(clients[0]);
        });

        it('passes native authentication on a new run-owned client without the user agent for a private host', async (): Promise<void> => {
            const { result, holder, run } = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(result).toMatchObject({
                status: 'pass',
                facts: { authMethod: AuthMethodId.NativeAuth, userName: user, authenticated: true },
            });
            expect(holder.client).toBe(clients[0]);
            expect(clients[0].options.appName).toBeUndefined();
            expect(clients[0].connectionString).toContain(encodeURIComponent(password));
            // The run's cleanup closes the owned client once the run has ended.
            expect(clients[0].close).toHaveBeenCalledTimes(1);
            expect(run.results.map((entry): string => entry.checkId)).toEqual([
                'connectionString',
                'prepare',
                'authenticate',
            ]);
        });
    });

    describe('owned client lifetime', (): void => {
        it('closes a client that finishes connecting after the run timed out, and never publishes it', async (): Promise<void> => {
            const connection = pending<void>();
            connectBehavior = (): Promise<void> => connection.promise;
            const { result, holder } = await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost), {
                timeouts: { authenticationTimeoutMs: 30 },
            });
            expect(codes(result)).toEqual(['check.timeout']);
            const closesAtTimeout = clients[0].close.mock.calls.length;
            expect(closesAtTimeout).toBeGreaterThanOrEqual(1);
            connection.resolve();
            await flush();
            expect(clients[0].close.mock.calls.length).toBeGreaterThan(closesAtTimeout);
            expect(holder.client).toBeUndefined();
        });

        it('closes the client when the run is cancelled during connect', async (): Promise<void> => {
            const controller = new AbortController();
            const connecting = pending<void>();
            connectBehavior = (): Promise<void> => {
                connecting.resolve();
                return new Promise<void>((): void => undefined);
            };
            const running = runAuth(setupFor(AuthMethodId.NativeAuth, privateHost), { signal: controller.signal });
            await connecting.promise;
            controller.abort();
            await expect(running).rejects.toBeInstanceOf(DiagnosticsCancelledError);
            expect(clients[0].close).toHaveBeenCalled();
        });

        it('never creates a client when sign-in finishes after the run timed out', async (): Promise<void> => {
            const session = pending<unknown>();
            mocks.getSessionFromVSCode.mockReturnValue(session.promise);
            const deps = fakeDeps();
            const { result } = await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost), {
                deps,
                timeouts: { authenticationTimeoutMs: 30 },
            });
            expect(codes(result)).toEqual(['check.timeout']);
            session.resolve({ accessToken: entraToken() });
            await flush();
            expect(deps.createClient).not.toHaveBeenCalled();
        });
    });

    describe('side effects and secrets', (): void => {
        it('never uses ClustersClient, never writes CredentialCache and traces with the run ID', async (): Promise<void> => {
            await runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
            await runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
            expect(mocks.getClient).not.toHaveBeenCalled();
            for (const setter of credentialSetters) {
                expect(CredentialCache[setter]).not.toHaveBeenCalled();
            }
            const authLines = outputLines().filter((line): boolean => line.includes('[Authentication]'));
            expect(authLines.length).toBeGreaterThan(0);
            for (const line of authLines) {
                expect(line).toContain(`startup=${runId} surface=connectionDiagnostics`);
            }
        });

        it('keeps passwords, tokens and error messages out of results, events, Output lines and telemetry', async (): Promise<void> => {
            const token = entraToken();
            const scenarios: (() => Promise<AuthRun>)[] = [
                (): Promise<AuthRun> => runAuth(setupFor(AuthMethodId.NativeAuth, privateHost)),
                (): Promise<AuthRun> => {
                    connectBehavior = (): Promise<void> =>
                        Promise.reject(
                            new MongoServerError({ ok: 0, code: 18, errmsg: `${errorSentinel} ${password}` }),
                        );
                    return runAuth(setupFor(AuthMethodId.NativeAuth, privateHost));
                },
                (): Promise<AuthRun> => {
                    connectBehavior = (): Promise<void> => Promise.resolve();
                    mocks.getSessionFromVSCode.mockResolvedValue({
                        accessToken: token,
                        account: { label: 'alice@contoso.example', id: 'account-id' },
                    });
                    return runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
                },
                (): Promise<AuthRun> => {
                    mocks.getSessionFromVSCode.mockRejectedValue(new Error(`AADSTS50020 ${errorSentinel}`));
                    return runAuth(setupFor(AuthMethodId.MicrosoftEntraID, publicHost));
                },
            ];
            for (const scenario of scenarios) {
                const { result, events, telemetry, run } = await scenario();
                const serialized = [
                    JSON.stringify(result),
                    JSON.stringify(run),
                    JSON.stringify(events),
                    JSON.stringify(telemetry),
                    outputLines().join('\n'),
                ];
                for (const text of serialized) {
                    for (const secret of [
                        password,
                        encodeURIComponent(password),
                        token,
                        token.split('.')[1],
                        claimSentinel,
                        errorSentinel,
                        'account-id',
                    ]) {
                        expect(text).not.toContain(secret);
                    }
                }
            }
            expect(
                outputLines().some((line): boolean =>
                    line.startsWith(`[Connection diagnosis] run=${runId} check=authenticate`),
                ),
            ).toBe(true);
        });
    });
});
