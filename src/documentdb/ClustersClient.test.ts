/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserCancelledError, type IActionContext, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { EventEmitter } from 'events';
import type * as Mongodb from 'mongodb';
import {
    MongoClient,
    MongoNetworkError,
    MongoNotConnectedError,
    MongoServerError,
    type MongoClientOptions,
} from 'mongodb';
import { ext } from '../extensionVariables';
import { traceAuthFlow, type AuthTraceContext } from '../utils/authTrace';
import { type VerifiedEntraIdentity } from './auth/AuthHandler';
import { AuthMethodId } from './auth/AuthMethod';
import * as authHandlerFactory from './auth/createAuthHandler';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
    TokenCallbackError,
} from './auth/entraErrors/entraCallbackErrors';
import { ManagedIdentityAuthHandler } from './auth/ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './auth/MicrosoftEntraIDAuthHandler';
import { NativeAuthHandler } from './auth/NativeAuthHandler';
import { NoAuthHandler } from './auth/NoAuthHandler';
import { ClusterSession } from './ClusterSession';
import {
    addEstablishedConnectionContext,
    ClustersClient,
    getIndexExclusionReason,
    type IndexItemModel,
} from './ClustersClient';
import { computeConnectionFingerprint } from './connectionFingerprint';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';
import { CredentialCache } from './CredentialCache';
import { runWithClient } from './runWithClient';
import { SchemaStore } from './SchemaStore';
import { prepareDriverConnectionString } from './srv/prepareDriverConnectionString';
import { type SrvResolutionSummary } from './srv/srvResolutionSummary';
import { getClusterMetadata, getDomainMetadata } from './utils/getClusterMetadata';
import * as tlsException from './utils/tlsException';

interface RecordedTelemetry {
    readonly eventName: string;
    readonly telemetry: ITelemetryContext;
    error?: unknown;
}

const mockTelemetryEvents: RecordedTelemetry[] = [];

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

vi.mock('@microsoft/vscode-azext-utils', async () => {
    const actual = await vi.importActual<{ UserCancelledError: typeof UserCancelledError }>(
        '@microsoft/vscode-azext-utils',
    );
    return {
        ...actual,
        appendExtensionUserAgent: vi.fn().mockReturnValue('test-extension'),
        // Mirrors the real `parseError` type rule: a `code` wins over the class name.
        parseError: (error: unknown): { message: string; errorType: string } => ({
            message: error instanceof Error ? error.message : String(error),
            errorType:
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (typeof error.code === 'string' || typeof error.code === 'number')
                    ? String(error.code)
                    : error instanceof Error
                      ? error.constructor.name
                      : typeof error,
        }),
        callWithTelemetryAndErrorHandling: vi.fn(
            async (eventName: string, callback: (context: IActionContext) => Promise<unknown>): Promise<unknown> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: { issueProperties: {} },
                    valuesToMask: [],
                } as unknown as IActionContext;
                const event: RecordedTelemetry = { eventName, telemetry: context.telemetry };
                const startedAt = Date.now();
                try {
                    const result = await callback(context);
                    context.telemetry.properties.result = 'Succeeded';
                    return result;
                } catch (error) {
                    event.error = error;
                    if (error instanceof actual.UserCancelledError) {
                        context.telemetry.properties.result = 'Canceled';
                        return undefined;
                    }
                    context.telemetry.properties.result = 'Failed';
                    if (context.errorHandling.rethrow) {
                        throw error;
                    }
                    return undefined;
                } finally {
                    context.telemetry.measurements.duration = (Date.now() - startedAt) / 1000;
                    mockTelemetryEvents.push(event);
                }
            },
        ),
    };
});

vi.mock('mongodb', async () => {
    const actual = await vi.importActual<typeof Mongodb>('mongodb');
    return { ...actual, MongoClient: vi.fn() };
});

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { trace: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() } },
}));

vi.mock('./utils/getClusterMetadata', () => ({
    getClusterMetadata: vi.fn().mockResolvedValue({}),
    getDomainMetadata: vi.fn().mockReturnValue({}),
}));

vi.mock('./LlmEnhancedFeatureApis', () => ({ llmEnhancedFeatureApis: vi.fn() }));
vi.mock('./client/QueryInsightsApis', () => ({
    QueryInsightsApis: vi.fn(function () {
        return { explainFind: vi.fn() };
    }),
}));
vi.mock('./srv/prepareDriverConnectionString', () => ({ prepareDriverConnectionString: vi.fn() }));
vi.mock('./auth/createAuthHandler', async () => {
    const actual = await vi.importActual<typeof authHandlerFactory>('./auth/createAuthHandler');
    return { ...actual, createAuthHandler: vi.fn(actual.createAuthHandler) };
});
vi.mock('./utils/tlsException', async () => {
    const actual = await vi.importActual<typeof tlsException>('./utils/tlsException');
    return { ...actual, resolveAllowInvalidCertificates: vi.fn(actual.resolveAllowInvalidCertificates) };
});

describe('ClustersClient', () => {
    it('should be defined', () => {
        expect(ClustersClient).toBeDefined();
    });
});

describe('regular connection startup diagnostics', () => {
    let clusterId: string;
    let clusterNumber = 0;
    const verifiedIdentity: VerifiedEntraIdentity = {
        kind: 'entra',
        providerId: 'microsoft',
        accountId: 'private-test-account-id',
        accountLabel: 'private-test-account-label',
        tenantId: 'private-test-tenant',
    };
    const mockConnect = vi.fn();
    const mockClose = vi.fn();
    const mockListDatabases = vi.fn<() => Promise<Mongodb.ListDatabasesResult>>();
    const mockFind = vi.fn();
    const mockToArray = vi.fn<() => Promise<Mongodb.WithId<Mongodb.Document & { _id: string }>[]>>();
    const mockDeleteMany = vi.fn<() => Promise<Mongodb.DeleteResult>>();
    let poolEvents: EventEmitter;

    function pauseNextConnect(): { started: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
        const started = deferred();
        const finish = deferred();
        mockConnect.mockImplementationOnce(() => {
            started.resolve();
            return finish.promise;
        });
        return { started: started.promise, resolve: finish.resolve, reject: finish.reject };
    }

    beforeEach(() => {
        clusterId = `private-cluster-${++clusterNumber}`;
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockTelemetryEvents.length = 0;
        ClustersClient._clients.clear();
        ClustersClient._lastFailedStartups.clear();
        vi.mocked(prepareDriverConnectionString)
            .mockReset()
            .mockImplementation(async (input) => {
                if (input.startupTelemetry) {
                    input.startupTelemetry.properties.srvResolution = 'notSrv';
                }
                return { connectionString: input.connectionString, options: input.options, srvResolution: 'notSrv' };
            });
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, 'mongodb://private-host:27017');
        mockConnect.mockReset().mockImplementation(async (): Promise<void> => {
            vi.advanceTimersByTime(30);
        });
        mockClose.mockResolvedValue(undefined);
        mockListDatabases.mockReset();
        mockFind.mockReset().mockReturnValue({ toArray: mockToArray });
        mockToArray.mockReset();
        mockDeleteMany.mockReset();
        vi.mocked(MongoClient).mockImplementation(function () {
            poolEvents = new EventEmitter();
            return Object.assign(poolEvents, {
                connect: mockConnect,
                close: mockClose,
                db: () => ({
                    admin: () => ({ listDatabases: mockListDatabases }),
                    collection: () => ({ find: mockFind, deleteMany: mockDeleteMany }),
                }),
            }) as unknown as MongoClient;
        });
        for (const handler of [
            MicrosoftEntraIDAuthHandler,
            ManagedIdentityAuthHandler,
            NativeAuthHandler,
            NoAuthHandler,
        ]) {
            vi.spyOn(handler.prototype, 'configureAuth').mockImplementation(async () => {
                vi.advanceTimersByTime(20);
                return {
                    connectionString: 'mongodb://private-host:27017',
                    options: {},
                    ...(handler === MicrosoftEntraIDAuthHandler ? { verifiedIdentity } : {}),
                };
            });
        }
    });

    it('publishes a new binding only on successful establishment and advances generations across deletion', async () => {
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        const first = await ClustersClient.connectInteractive(clusterId);
        expect(first.binding).toEqual({ clusterId, fingerprint: first.fingerprint, generation: first.generation });
        expect(first.createdAt).toBe(Date.now());
        expect(await ClustersClient.getClient(clusterId)).toBe(first);
        expect(ClustersClient.getBinding(clusterId)).toBe(first.binding);

        await ClustersClient.deleteClient(clusterId);
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        mockConnect.mockRejectedValueOnce(new Error('driver failure'));
        await expect(ClustersClient.getClient(clusterId)).rejects.toThrow('driver failure');
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();

        const second = await ClustersClient.getClient(clusterId);
        expect(ClustersClient.getBinding(clusterId)).toBe(second.binding);
        expect(second.generation).toBe(first.generation + 1);
        expect(second.fingerprint).toBe(first.fingerprint);
        expect(second.createdAt).toBeGreaterThan(first.createdAt);
    });

    it('reports read-only client diagnostics without connection or identity details', async (): Promise<void> => {
        const client = await ClustersClient.connectInteractive(clusterId);
        vi.advanceTimersByTime(2_000);

        const snapshot = ClustersClient.getDiagnosticsSnapshot();
        const entry = snapshot.find(({ client: row }) => row?.startupId === client.connectionCorrelationId);

        expect(entry?.client).toEqual({
            generation: client.generation,
            ageMs: 2_000,
            authMethod: AuthMethodId.MicrosoftEntraID,
            startupId: client.connectionCorrelationId,
            state: 'cached',
            socketTrace: true,
            lastEntraTokenExpiresAt: undefined,
        });
        const output = JSON.stringify(snapshot);
        for (const value of [
            clusterId,
            client.fingerprint,
            verifiedIdentity.accountId,
            verifiedIdentity.accountLabel,
            verifiedIdentity.tenantId,
            'private-host',
        ]) {
            expect(output).not.toContain(value);
        }
        expect(await ClustersClient.getClient(clusterId)).toBe(client);
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(mockClose).not.toHaveBeenCalled();
    });

    it('lets a surface follow a same-identity generation but does not redial while latched', async (): Promise<void> => {
        const client = await ClustersClient.connectInteractive(clusterId);
        await ClustersClient.deleteClient(clusterId);
        const replacement = await ClustersClient.resolveBoundClient(client.binding);
        expect(replacement.binding).toEqual({ ...client.binding, generation: client.generation + 1 });
        expect(mockConnect).toHaveBeenCalledTimes(2);

        ClustersClient.latch(clusterId, 'userDisconnected');
        try {
            await expect(ClustersClient.resolveBoundClient(client.binding)).rejects.toMatchObject({
                reason: 'userDisconnected',
            });
            expect(mockConnect).toHaveBeenCalledTimes(2);
        } finally {
            ClustersClient.unlatch(clusterId);
        }
    });

    it('does not open a changed connection for an old surface, even with no cached client', async (): Promise<void> => {
        const client = await ClustersClient.connectInteractive(clusterId);
        await ClustersClient.deleteClient(clusterId);
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, 'mongodb://different.test/');

        await expect(ClustersClient.resolveBoundClient(client.binding)).rejects.toMatchObject({
            reason: 'identityChanged',
        });
        expect(MongoClient).toHaveBeenCalledOnce();
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();

        const current = await ClustersClient.getClient(clusterId);
        await expect(ClustersClient.resolveBoundClient(client.binding)).rejects.toMatchObject({
            reason: 'identityChanged',
        });
        expect(ClustersClient.getBinding(clusterId)).toBe(current.binding);
    });

    it('keeps session paging and schema accumulation on a same-identity replacement', async (): Promise<void> => {
        const original = await ClustersClient.connectInteractive(clusterId);
        const session = ClusterSession.getSession(await ClusterSession.initNewSession(clusterId));
        const query = { filter: '{}', skip: 2, limit: 3 };
        mockToArray.mockResolvedValueOnce([{ _id: 'first', previousField: true }]);
        await session.runFindQueryWithCache('db', 'items', query, 1, 2);

        ClustersClient.reportFailure(original.binding, new MongoNotConnectedError('idle connection closed'));
        const replacement = await session.getClient();
        expect(replacement.generation).toBe(original.generation + 1);
        expect(replacement.fingerprint).toBe(original.fingerprint);
        const runFind = vi.spyOn(replacement, 'runFindQuery');

        mockToArray.mockResolvedValueOnce([{ _id: 'last', nextField: true }]);
        await expect(session.runFindQueryWithCache('db', 'items', query, 2, 2)).resolves.toBe(1);
        expect(runFind).toHaveBeenCalledExactlyOnceWith('db', 'items', { ...query, skip: 4, limit: 1 });
        expect(session.getCurrentPageAsJson().map((page) => JSON.parse(page) as unknown)).toEqual([
            { _id: 'last', nextField: true },
        ]);
        expect(SchemaStore.getInstance().getDocumentCount(clusterId, 'db', 'items')).toBe(2);
        await expect(session.runFindQueryWithCache('db', 'items', query, 3, 2)).resolves.toBe(0);
        expect(session.getCurrentPageAsJson()).toEqual([]);
        expect(runFind).toHaveBeenCalledOnce();
    });

    it('rejects a changed identity before a session can submit a write', async (): Promise<void> => {
        await ClustersClient.connectInteractive(clusterId);
        const session = ClusterSession.getSession(await ClusterSession.initNewSession(clusterId));
        await ClustersClient.deleteClient(clusterId);
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, 'mongodb://different.test/');
        await ClustersClient.getClient(clusterId);

        await expect(session.getClient()).rejects.toMatchObject({ reason: 'identityChanged' });
        await expect(session.deleteDocuments('db', 'items', ['"one"'])).rejects.toMatchObject({
            reason: 'identityChanged',
        });
        expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('drops a find completed after reconnect without changing the query, page, or schema', async (): Promise<void> => {
        await ClustersClient.connectInteractive(clusterId);
        const session = ClusterSession.getSession(await ClusterSession.initNewSession(clusterId));
        const query = { filter: '{}' };
        mockToArray.mockResolvedValueOnce([{ _id: 'current' }]);
        await session.runFindQueryWithCache('db', 'items', query, 1, 10);
        const page = session.getCurrentPageAsJson();

        const started = deferred();
        const finish = deferred();
        mockToArray.mockImplementationOnce(async () => {
            started.resolve();
            await finish.promise;
            return [{ _id: 'stale', staleField: true }];
        });
        const pending = session.runFindQueryWithCache('db', 'items', { filter: '{ staleField: true }' }, 1, 10);
        await started.promise;
        ClustersClient.latch(clusterId, 'userDisconnected');
        await ClustersClient.deleteClient(clusterId);
        ClustersClient.unlatch(clusterId);
        await session.getClient();
        finish.resolve();

        await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
        expect(session.getCurrentFindQueryParams()).toEqual(query);
        expect(session.getCurrentPageAsJson()).toEqual(page);
        expect(SchemaStore.getInstance().getDocumentCount(clusterId, 'db', 'items')).toBe(0);
    });

    it('does not cache execution stats that complete while the session is latched', async (): Promise<void> => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const session = ClusterSession.getSession(await ClusterSession.initNewSession(clusterId));
        const started = deferred();
        const finish = deferred();
        vi.spyOn(client.queryInsightsApis, 'explainFind').mockImplementationOnce(async () => {
            started.resolve();
            await finish.promise;
            return { executionStats: { nReturned: 1 } };
        });
        const pending = session.runWithClient((resolved, epoch) =>
            session.getExecutionStats(resolved, epoch, 'db', 'items', {}),
        );
        await started.promise;
        ClustersClient.latch(clusterId, 'userDisconnected');
        finish.resolve();

        await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
        expect(session.getRawExplainOutput('db', 'items')).toBeNull();
    });

    it('does not replay a failed delete or remove the cached document', async (): Promise<void> => {
        await ClustersClient.connectInteractive(clusterId);
        const session = ClusterSession.getSession(await ClusterSession.initNewSession(clusterId));
        mockToArray.mockResolvedValueOnce([{ _id: 'one' }]);
        await session.runFindQueryWithCache('db', 'items', {}, 1, 10);
        const page = session.getCurrentPageAsJson();
        const failure = new MongoNotConnectedError('connection closed during delete');
        mockDeleteMany.mockRejectedValueOnce(failure);

        await expect(session.deleteDocuments('db', 'items', ['"one"'])).rejects.toBe(failure);
        expect(mockDeleteMany).toHaveBeenCalledExactlyOnceWith({ _id: { $in: ['one'] } });
        expect(session.getCurrentPageAsJson()).toEqual(page);
        expect(mockConnect).toHaveBeenCalledOnce();
    });

    it('reports only the expiry of the last Entra token supplied to the driver', async (): Promise<void> => {
        const firstExpiry = 1_800_000_000;
        const renewedExpiry = firstExpiry + 3600;
        const tokenAt = (exp: number): string =>
            `test.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
        const first = { accessToken: tokenAt(firstExpiry) };
        const renewed = { accessToken: tokenAt(renewedExpiry) };
        const missingSession = new EntraSignInRequiredError('noSession');
        const callback = vi
            .fn<Mongodb.OIDCCallbackFunction>()
            .mockResolvedValueOnce(first)
            .mockRejectedValueOnce(missingSession)
            .mockResolvedValueOnce(renewed)
            .mockResolvedValueOnce({ accessToken: 'opaque-test-token' });
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: 'mongodb://private-host:27017',
            options: { authMechanismProperties: { OIDC_CALLBACK: callback } },
            verifiedIdentity,
        });
        const client = await ClustersClient.connectInteractive(clusterId);
        const driverCallback = vi.mocked(MongoClient).mock.calls[0][1]?.authMechanismProperties?.OIDC_CALLBACK;
        const params: Mongodb.OIDCCallbackParams = { version: 1, timeoutContext: new AbortController().signal };
        const expiry = (): string | undefined =>
            ClustersClient.getDiagnosticsSnapshot().find(
                ({ client: row }) => row?.startupId === client.connectionCorrelationId,
            )?.client?.lastEntraTokenExpiresAt;

        expect(expiry()).toBeUndefined();
        await expect(driverCallback!(params)).resolves.toBe(first);
        expect(expiry()).toBe(new Date(firstExpiry * 1000).toISOString());
        expect(JSON.stringify(ClustersClient.getDiagnosticsSnapshot())).not.toContain(first.accessToken);
        await expect(driverCallback!(params)).rejects.toBe(missingSession);
        expect(expiry()).toBe(new Date(firstExpiry * 1000).toISOString());
        await expect(driverCallback!(params)).resolves.toBe(renewed);
        expect(expiry()).toBe(new Date(renewedExpiry * 1000).toISOString());
        await driverCallback!(params);
        expect(expiry()).toBeUndefined();
    });

    it('shows a superseded startup and a hold even without a cached client', async (): Promise<void> => {
        const handshake = pauseNextConnect();
        const onStartup = vi.fn<(id: string) => void>();
        const opening = ClustersClient.connectInteractive(clusterId, undefined, onStartup);
        await handshake.started;
        const startupId = onStartup.mock.calls[0][0];
        const findPending = () =>
            ClustersClient.getDiagnosticsSnapshot().find(({ pending }) => pending?.startupId === startupId);
        expect(findPending()).toMatchObject({ client: undefined, pending: { superseded: false } });

        ClustersClient.latch(clusterId, 'userDisconnected');
        expect(findPending()).toMatchObject({
            client: undefined,
            pending: { superseded: true },
            held: 'userDisconnected',
        });

        handshake.resolve();
        await expect(opening).rejects.toMatchObject({ reason: 'userDisconnected' });
        ClustersClient.unlatch(clusterId);
    });

    it('never hydrates unpinned Entra silently, even after a native connection', async () => {
        const expectNoSession = async (): Promise<void> => {
            await expect(
                ClustersClient.getClient(clusterId, undefined, undefined, 'treeConnect'),
            ).rejects.toMatchObject({
                name: 'EntraSignInRequiredError',
                reason: 'noSession',
            });
        };
        await expectNoSession();
        expect(authHandlerFactory.createAuthHandler).not.toHaveBeenCalled();

        const uri = 'mongodb://private-user@private-host:27017';
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, uri);
        vi.mocked(NativeAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: uri,
            options: {},
        });
        await ClustersClient.getClient(clusterId);
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toEqual({ kind: 'native', username: 'private-user' });
        await ClustersClient.deleteClient(clusterId);

        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, 'mongodb://private-host:27017');
        await expectNoSession();
        expect(MicrosoftEntraIDAuthHandler.prototype.configureAuth).not.toHaveBeenCalled();
        await ClustersClient.connectInteractive(clusterId);
        expect(authHandlerFactory.createAuthHandler).toHaveBeenLastCalledWith(
            AuthMethodId.MicrosoftEntraID,
            expect.objectContaining({ clusterId }),
            { interactive: true },
        );
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toEqual(verifiedIdentity);
    });

    it('records only the current publication and retains its pin across eviction and reconnect', async () => {
        const staleHandshake = pauseNextConnect();
        const staleWaiter = ClustersClient.connectInteractive(clusterId);
        await staleHandshake.started;
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBeUndefined();
        await ClustersClient.deleteClient(clusterId);
        const currentIdentity = { ...verifiedIdentity, accountId: 'private-current-account' };
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: 'mongodb://private-host:27017',
            options: {},
            verifiedIdentity: currentIdentity,
        });
        const current = await ClustersClient.connectInteractive(clusterId);
        const published = ClustersClient.getLastVerifiedIdentity(clusterId);
        expect(published).toEqual(currentIdentity);
        staleHandshake.resolve();
        await expect(staleWaiter).resolves.toBe(current);
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBe(published);

        await ClustersClient.deleteClient(clusterId);
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBe(published);
        const configureAuth = vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth);
        for (const connect of [ClustersClient.getClient, ClustersClient.connectInteractive]) {
            configureAuth.mockRejectedValueOnce(new Error('pinned startup failed'));
            await expect(connect(clusterId)).rejects.toThrow('pinned startup failed');
            expect(authHandlerFactory.createAuthHandler).toHaveBeenLastCalledWith(
                AuthMethodId.MicrosoftEntraID,
                expect.objectContaining({ clusterId }),
                { interactive: false, pinnedEntraIdentity: currentIdentity },
            );
            expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBe(published);
        }
    });

    it('rechecks silent authorization using the credentials cloned during initialization', async () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://private-host:27017');
        const waiter = ClustersClient.getClient(clusterId, undefined, () => {
            CredentialCache.setAuthCredentials(
                clusterId,
                AuthMethodId.MicrosoftEntraID,
                'mongodb://private-host:27017',
            );
        });
        await expect(waiter).rejects.toMatchObject({ name: 'EntraSignInRequiredError', reason: 'noSession' });
        expect(authHandlerFactory.createAuthHandler).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
    });

    it('background calls never start a client, but can reuse a cached one', async () => {
        const onStartup = vi.fn();
        const background = (): Promise<ClustersClient> =>
            ClustersClient.getClient(clusterId, undefined, onStartup, 'clusterDashboardPoll', { background: true });

        await expect(background()).rejects.toMatchObject({ name: 'ConnectionUnavailableError', reason: 'unreachable' });
        CredentialCache.deleteCredentials(clusterId);
        await expect(background()).rejects.toMatchObject({
            name: 'ConnectionUnavailableError',
            reason: 'credentialsMissing',
        });
        ClustersClient.latch(clusterId, 'userDisconnected');
        await expect(background()).rejects.toMatchObject({
            name: 'ConnectionUnavailableError',
            reason: 'userDisconnected',
        });
        expect(onStartup).not.toHaveBeenCalled();
        expect(authHandlerFactory.createAuthHandler).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
        expect(mockTelemetryEvents).toHaveLength(0);

        ClustersClient.unlatch(clusterId);
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://private-host:27017');
        const client = await ClustersClient.getClient(clusterId);
        await expect(background()).resolves.toBe(client);
        expect(onStartup).toHaveBeenCalledExactlyOnceWith(client.connectionCorrelationId);
        expect(MongoClient).toHaveBeenCalledOnce();
        expect(mockConnect).toHaveBeenCalledOnce();
    });

    it('rechecks cancellation and the latch after a cached reuse callback', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const controller = new AbortController();
        const abort = vi.fn(() => controller.abort());
        await expect(ClustersClient.getClient(clusterId, controller.signal, abort)).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(abort).toHaveBeenCalledExactlyOnceWith(client.connectionCorrelationId);

        const latchedController = new AbortController();
        const latch = vi.fn(() => {
            ClustersClient.latch(clusterId, 'userDisconnected');
            latchedController.abort();
        });
        await expect(ClustersClient.getClient(clusterId, latchedController.signal, latch)).rejects.toMatchObject({
            name: 'ConnectionUnavailableError',
            reason: 'userDisconnected',
        });
        expect(latch).toHaveBeenCalledExactlyOnceWith(client.connectionCorrelationId);
        expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(mockClose).not.toHaveBeenCalled();
    });

    it('retries instead of returning a cached client evicted by the startup callback', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const onStartup = vi.fn().mockImplementationOnce((): void => {
            void ClustersClient.deleteClient(clusterId);
        });
        const next = await ClustersClient.getClient(clusterId, undefined, onStartup);
        expect(next.generation).toBe(client.generation + 1);
        expect(onStartup.mock.calls).toEqual([[client.connectionCorrelationId], [next.connectionCorrelationId]]);
        expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('shares one same-identity replacement after topology closure, including a background joiner', async () => {
        const old = await ClustersClient.connectInteractive(clusterId);
        const epoch = ClustersClient.getEpoch(clusterId);
        poolEvents.emit('topologyClosed');
        const onBackground = vi.fn();
        const background = (): Promise<ClustersClient> =>
            ClustersClient.getClient(clusterId, undefined, onBackground, 'clusterDashboardPoll', { background: true });

        await expect(background()).rejects.toMatchObject({ name: 'ConnectionUnavailableError', reason: 'unreachable' });
        expect(onBackground).not.toHaveBeenCalled();
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(MongoClient).toHaveBeenCalledOnce();
        expect(ClustersClient.getBinding(clusterId)).toBe(old.binding);

        const handshake = pauseNextConnect();
        const onForeground = vi.fn();
        const first = ClustersClient.getClient(clusterId, undefined, onForeground);
        await handshake.started;
        const second = ClustersClient.getClient(clusterId);
        const joined = background();
        expect(ClustersClient.getBinding(clusterId)).toBe(old.binding);
        handshake.resolve();
        const [replacement, other, polled] = await Promise.all([first, second, joined]);
        expect(other).toBe(replacement);
        expect(polled).toBe(replacement);
        expect(replacement.generation).toBe(old.generation + 1);
        expect(replacement.fingerprint).toBe(old.fingerprint);
        expect(replacement.connectionCorrelationId).not.toBe(old.connectionCorrelationId);
        expect(onForeground).toHaveBeenCalledExactlyOnceWith(replacement.connectionCorrelationId);
        expect(onBackground).toHaveBeenCalledExactlyOnceWith(replacement.connectionCorrelationId);
        expect(ClustersClient.getBinding(clusterId)).toBe(replacement.binding);
        expect(ClustersClient.getEpoch(clusterId)).toBe(epoch);
        expect(mockConnect).toHaveBeenCalledTimes(2);
        expect(MongoClient).toHaveBeenCalledTimes(2);
    });

    it('keeps the closed binding when repeated replacements would change identity', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const epoch = ClustersClient.getEpoch(clusterId);
        poolEvents.emit('topologyClosed');
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValue({
            connectionString: 'mongodb://private-host:27017',
            options: {},
            verifiedIdentity: { ...verifiedIdentity, accountId: 'private-different-account' },
        });

        for (let attempt = 0; attempt < 2; attempt++) {
            await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({
                name: 'ConnectionUnavailableError',
                reason: 'identityChanged',
            });
            expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);
            expect(ClustersClient.getEpoch(clusterId)).toBe(epoch);
        }
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toEqual(verifiedIdentity);
        expect(MongoClient).toHaveBeenCalledOnce();
        expect(mockConnect).toHaveBeenCalledOnce();
    });

    it.each([
        ['transient', new TokenCallbackError(new Error('IMDS unavailable'), AuthMethodId.ManagedIdentity)],
        ['clientClosed', new MongoNotConnectedError('driver closed')],
    ] as const)('reports %s and replaces once on foreground, fencing late failures and close', async (kind, error) => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.ManagedIdentity, 'mongodb://private-host:27017');
        const old = await ClustersClient.getClient(clusterId);
        const background = (): Promise<ClustersClient> =>
            ClustersClient.getClient(clusterId, undefined, undefined, 'clusterDashboardPoll', { background: true });

        expect(ClustersClient.reportFailure(old.binding, error)).toBe(kind);
        await expect(background()).rejects.toMatchObject({ reason: 'unreachable' });
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(mockClose).not.toHaveBeenCalled();

        const closing = deferred();
        mockClose.mockReturnValueOnce(closing.promise);
        const foreground = ClustersClient.getClient(clusterId);
        const [replacement, joined] = await Promise.all([foreground, background()]);
        expect(joined).toBe(replacement);
        expect(replacement.binding).toEqual({ ...old.binding, generation: old.generation + 1 });
        expect(mockConnect).toHaveBeenCalledTimes(2);
        expect(mockClose).toHaveBeenCalledExactlyOnceWith(true);
        expect(mockClose.mock.contexts[0]).toBe(old.getMongoClient());

        expect(ClustersClient.reportFailure(old.binding, new EntraIdentityMismatchError())).toBeUndefined();
        expect(
            ClustersClient.reportFailure({ ...replacement.binding, fingerprint: 'unmatched' }, error),
        ).toBeUndefined();
        expect(ClustersClient.reportFailure(replacement.binding, new ConnectionUnavailableError('unreachable'))).toBe(
            'other',
        );
        closing.reject(new Error('old close failed'));
        await expect(background()).resolves.toBe(replacement);
    });

    it('holds a rejected Entra replacement without retrying its cached settings', async (): Promise<void> => {
        await ClustersClient.connectInteractive(clusterId);
        const credentials = CredentialCache.getCredentials(clusterId);
        poolEvents.emit('topologyClosed');
        mockConnect.mockRejectedValueOnce(new MongoServerError({ code: 18 }));

        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'credentialsRejected' });
        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'credentialsRejected' });
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(CredentialCache.getCredentials(clusterId)).toBe(credentials);
        expect(MongoClient).toHaveBeenCalledTimes(2);
    });

    it('holds a sign-in miss for explicit recovery and does not let a pending replacement bypass it', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const pin = ClustersClient.getLastVerifiedIdentity(clusterId);
        const credentials = CredentialCache.getCredentials(clusterId);
        ClustersClient.reportFailure(client.binding, new MongoNotConnectedError('driver closed'));
        const handshake = pauseNextConnect();
        const pending = ClustersClient.getClient(clusterId);
        await handshake.started;

        expect(ClustersClient.reportFailure(client.binding, new EntraSignInRequiredError('noSession'))).toBe(
            'signInRequired',
        );
        handshake.resolve();
        await expect(pending).rejects.toMatchObject({ reason: 'signInRequired' });
        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'signInRequired' });
        expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBe(pin);
        expect(CredentialCache.getCredentials(clusterId)).toBe(credentials);
        expect(mockConnect).toHaveBeenCalledTimes(2);

        await ClustersClient.deleteClient(clusterId);
        const recovered = await ClustersClient.getClient(clusterId);
        expect(recovered.binding).toEqual({ ...client.binding, generation: client.generation + 1 });
    });

    it('evicts rejected clients without silently retrying or losing the verified Entra settings', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const settings = CredentialCache.getCredentials(clusterId);
        const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
        const error = new MongoServerError({ code: 18 });

        expect(ClustersClient.reportFailure(client.binding, error)).toBe('credentialsRejected');
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(mockClose).toHaveBeenCalledExactlyOnceWith(true);
        expect(CredentialCache.getCredentials(clusterId)).toBe(settings);
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toBe(identity);
        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'credentialsRejected' });
        await expect(
            ClustersClient.getClient(clusterId, undefined, undefined, 'treeChildren', {
                background: true,
            }),
        ).rejects.toMatchObject({ reason: 'credentialsRejected' });
        expect(MongoClient).toHaveBeenCalledOnce();

        expect(ClustersClient.clearCredentialRejection(clusterId, ClustersClient.getEpoch(clusterId))).toBe(true);
        const recovered = await ClustersClient.getClient(clusterId);
        expect(recovered.binding).toEqual({ ...client.binding, generation: client.generation + 1 });
        expect(ClustersClient.reportFailure(client.binding, error)).toBeUndefined();
        expect(ClustersClient.getBinding(clusterId)).toBe(recovered.binding);
    });

    it('does not let recovery from a credential rejection clear a newer Disconnect', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        ClustersClient.reportFailure(client.binding, new MongoServerError({ code: 18 }));
        const epoch = ClustersClient.getEpoch(clusterId);
        ClustersClient.latch(clusterId, 'userDisconnected');

        expect(ClustersClient.clearCredentialRejection(clusterId, epoch)).toBe(false);
        expect(ClustersClient.clearCredentialRejection(clusterId, ClustersClient.getEpoch(clusterId))).toBe(false);
        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'userDisconnected' });
        expect(MongoClient).toHaveBeenCalledOnce();
    });

    it('does not publish an explicitly selected account when Disconnect wins the startup race', async (): Promise<void> => {
        const client = await ClustersClient.connectInteractive(clusterId);
        ClustersClient.reportFailure(client.binding, new MongoServerError({ code: 18 }));
        const connection = pauseNextConnect();
        const startup = ClustersClient.startAfterSignIn(
            clusterId,
            ClustersClient.getEpoch(clusterId),
            CredentialCache.getCredentials(clusterId)!,
            {
                connectionString: 'mongodb://private-host:27017',
                options: {},
                verifiedIdentity: { ...verifiedIdentity, accountId: 'other-account' },
            },
        );
        await connection.started;
        ClustersClient.latch(clusterId, 'userDisconnected');
        connection.resolve();

        await expect(startup).resolves.toBeUndefined();
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(ClustersClient.getLastVerifiedIdentity(clusterId)).toEqual(verifiedIdentity);
        await expect(ClustersClient.getClient(clusterId)).rejects.toMatchObject({ reason: 'userDisconnected' });
    });

    it('uses the resolved binding, preserves nonterminal errors and returns terminal unavailability without replay', async () => {
        const old = await ClustersClient.connectInteractive(clusterId);
        poolEvents.emit('topologyClosed');
        const network = Object.freeze(new MongoNetworkError('tunnel refused'));
        const op = vi.fn<() => Promise<never>>().mockRejectedValueOnce(network);
        await expect(runWithClient(old.binding, op, { background: true })).resolves.toEqual({
            unavailable: { reason: 'unreachable' },
        });
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(op).not.toHaveBeenCalled();

        const client = await ClustersClient.getClient(clusterId);
        await expect(runWithClient(old.binding, op, { background: true })).rejects.toBe(network);
        expect(op).toHaveBeenCalledExactlyOnceWith(client);
        expect(await ClustersClient.getClient(clusterId)).toBe(client);

        op.mockRejectedValueOnce(new EntraIdentityMismatchError());
        await expect(runWithClient(old.binding, op)).resolves.toEqual({
            unavailable: { reason: 'identityChanged' },
        });
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(op).toHaveBeenCalledTimes(2);
    });

    it('reports a startup credential rejection without submitting the bound operation', async (): Promise<void> => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://private-host:27017');
        const client = await ClustersClient.getClient(clusterId);
        await ClustersClient.deleteClient(clusterId);
        mockConnect.mockRejectedValueOnce(new MongoServerError({ code: 18 }));
        const op = vi.fn<() => Promise<void>>();

        await expect(runWithClient(client.binding, op)).resolves.toEqual({
            unavailable: { reason: 'credentialsRejected' },
        });
        expect(mockConnect).toHaveBeenCalledTimes(2);
        expect(op).not.toHaveBeenCalled();
    });

    it('binds Entra to the original cached URI and the verified identity, even if credentials change during startup', async () => {
        const originalUri = 'mongodb+srv://original.example.com/database?authSource=admin';
        const driverUri = 'mongodb://localhost:27018/database';
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, originalUri);
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(async () => {
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://replacement.example.com');
            return {
                connectionString: `${originalUri}&authMechanism=MONGODB-OIDC`,
                options: {},
                verifiedIdentity,
            };
        });
        vi.mocked(prepareDriverConnectionString).mockResolvedValueOnce({
            connectionString: driverUri,
            options: {},
            srvResolution: 'fallback',
        });

        const client = await ClustersClient.connectInteractive(clusterId);
        expect(MongoClient).toHaveBeenCalledWith(driverUri, {});
        expect(client.fingerprint).toBe(
            computeConnectionFingerprint({ connectionString: originalUri, principal: verifiedIdentity }),
        );
        expect(CredentialCache.getCredentials(clusterId)?.authMechanism).toBe(AuthMethodId.NoAuth);
        expect(client.authMethod).toBe(AuthMethodId.MicrosoftEntraID);
    });

    it('does not publish an Entra binding when auth does not return a verified identity', async () => {
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: 'mongodb://private-host:27017',
            options: {},
        });

        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toThrow('verifiedIdentity');
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(MongoClient).not.toHaveBeenCalled();
    });

    it('aborts only one waiter while both are waiting for the same replacement', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        poolEvents.emit('topologyClosed');
        const handshake = pauseNextConnect();
        const controller = new AbortController();
        const cancelled = ClustersClient.getClient(clusterId, controller.signal);
        const other = ClustersClient.getClient(clusterId, new AbortController().signal);
        await handshake.started;
        expect(mockConnect).toHaveBeenCalledTimes(2);

        controller.abort();
        await expect(cancelled).rejects.toBeInstanceOf(UserCancelledError);
        expect(mockClose).not.toHaveBeenCalled();
        expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);

        handshake.resolve();
        const replacement = await other;
        expect(replacement.generation).toBe(client.generation + 1);
        expect(ClustersClient.getBinding(clusterId)).toBe(replacement.binding);
        expect(mockClose).not.toHaveBeenCalled();
    });

    it('shares one cold startup even with a caller re-entering from onStartup', async () => {
        const onJoin = vi.fn();
        let joined!: Promise<ClustersClient>;
        const onStart = vi.fn(() => {
            joined = ClustersClient.getClient(clusterId, undefined, onJoin);
        });
        const first = ClustersClient.connectInteractive(clusterId, undefined, onStart);
        const [client, same] = await Promise.all([first, joined]);
        expect(same).toBe(client);
        expect(onStart).toHaveBeenCalledExactlyOnceWith(client.connectionCorrelationId);
        expect(onJoin).toHaveBeenCalledExactlyOnceWith(client.connectionCorrelationId);
        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(getClusterMetadata).toHaveBeenCalledTimes(1);
        expect(startupEvent().telemetry.properties.startupTrigger).toBe('treeConnect');
    });

    it.each([0, 1])('canceling cold waiter %i leaves the other waiter connected', async (index) => {
        const handshake = pauseNextConnect();
        const controllers = [new AbortController(), new AbortController()];
        const waits = [
            ClustersClient.connectInteractive(clusterId, controllers[0].signal),
            ClustersClient.getClient(clusterId, controllers[1].signal, undefined, 'clusterDashboardPoll', {
                background: true,
            }),
        ];
        await handshake.started;
        controllers[index].abort();
        await expect(waits[index]).rejects.toBeInstanceOf(UserCancelledError);
        expect(vi.mocked(prepareDriverConnectionString).mock.calls[0][0].abortSignal).toBeUndefined();
        expect(mockClose).not.toHaveBeenCalled();
        handshake.resolve();
        const client = await waits[1 - index];
        expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);
        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(mockClose).not.toHaveBeenCalled();
    });

    it('closes the superseded driver without publishing it or removing the newer pending startup', async () => {
        const baseline = await ClustersClient.connectInteractive(clusterId);
        await ClustersClient.deleteClient(clusterId);
        mockClose.mockClear();
        const closing = deferred();
        mockClose.mockReturnValueOnce(closing.promise);

        const first = pauseNextConnect();
        const retried = deferred();
        const onStartup = vi
            .fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(retried.resolve);
        const waiter = ClustersClient.getClient(clusterId, undefined, onStartup);
        await first.started;
        await ClustersClient.deleteClient(clusterId);
        const second = pauseNextConnect();
        const replacement = ClustersClient.getClient(clusterId);
        await second.started;

        first.resolve();
        await retried.promise;
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect(mockClose.mock.contexts[0]).toBe(mockConnect.mock.contexts[1]);
        second.resolve();
        const client = await replacement;
        await expect(waiter).resolves.toBe(client);
        expect(onStartup.mock.calls[0][0]).not.toBe(client.connectionCorrelationId);
        expect(onStartup.mock.calls[1][0]).toBe(client.connectionCorrelationId);
        expect(client.generation).toBe(baseline.generation + 1);
        expect(ClustersClient.getBinding(clusterId)).toBe(client.binding);
        expect(mockConnect).toHaveBeenCalledTimes(3);
        closing.reject(new Error('private cleanup detail'));
        await Promise.resolve();
        expect(ext.outputChannel.debug).toHaveBeenCalledWith(
            `[ClustersClient] startup=${onStartup.mock.calls[0][0]} superseded client cleanup failed surface=extension`,
        );
    });

    it('reports the latch instead of a failed superseded handshake', async () => {
        const handshake = pauseNextConnect();
        const waiter = ClustersClient.connectInteractive(clusterId);
        await handshake.started;
        ClustersClient.latch(clusterId, 'userDisconnected');
        handshake.reject(new Error('superseded failure'));

        await expect(waiter).rejects.toMatchObject({ name: 'ConnectionUnavailableError', reason: 'userDisconnected' });
        expect(mockConnect).toHaveBeenCalledOnce();
        expect(mockClose).toHaveBeenCalledOnce();
        expect(ClustersClient.getExistingClient(clusterId)).toBeUndefined();
    });

    it('a stale driver failure does not replace the correlation ID of a newer failure', async () => {
        const stale = pauseNextConnect();
        const waiter = ClustersClient.connectInteractive(clusterId);
        await stale.started;
        ClustersClient.invalidate(clusterId);
        mockConnect.mockRejectedValueOnce(new Error('current failure'));
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toThrow('current failure');
        const failedId = startupEvent().telemetry.properties.startupCorrelationId;
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBe(failedId);
        stale.reject(new Error('superseded failure'));
        const client = await waiter;
        const retry = mockTelemetryEvents.find(
            (event) =>
                event.eventName === 'connect.startup' &&
                event.telemetry.properties.startupCorrelationId === client.connectionCorrelationId,
        );
        expect(retry?.telemetry.properties.previousFailedStartupCorrelationId).toBe(failedId);
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBeUndefined();
    });

    it('removes the cached entry before closing and leaves a racing replacement alone', async () => {
        const old = await ClustersClient.connectInteractive(clusterId);
        const epoch = ClustersClient.getEpoch(clusterId);
        const closing = deferred();
        mockClose.mockReturnValueOnce(closing.promise);
        const deletion = ClustersClient.deleteClient(clusterId);
        expect(ClustersClient.getEpoch(clusterId)).toBe(epoch + 1);
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        const replacement = await ClustersClient.getClient(clusterId);
        closing.resolve();
        await deletion;
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect(mockClose.mock.contexts[0]).toBe(old.getMongoClient());
        expect(ClustersClient.getBinding(clusterId)).toBe(replacement.binding);
    });

    it.each([false, true])('a stale replacement waiter has only one retry (latched: %s)', async (latch) => {
        const cached = await ClustersClient.connectInteractive(clusterId);
        poolEvents.emit('topologyClosed');
        const replacement = pauseNextConnect();
        const onStartup = vi.fn();
        const waiter = ClustersClient.getClient(clusterId, undefined, onStartup);
        await replacement.started;
        await ClustersClient.deleteClient(clusterId);
        const retry = pauseNextConnect();
        replacement.reject(new Error('superseded replacement failed'));
        await retry.started;
        if (latch) {
            ClustersClient.latch(clusterId, 'connectionRemoved');
        } else {
            ClustersClient.invalidate(clusterId);
        }
        retry.resolve();
        if (latch) {
            await expect(waiter).rejects.toMatchObject({
                name: 'ConnectionUnavailableError',
                reason: 'connectionRemoved',
            });
        } else {
            await expect(waiter).rejects.toMatchObject({
                constructor: Error,
                message: 'The connection changed while it was opening. Try again.',
            });
        }
        expect(onStartup).toHaveBeenCalledTimes(2);
        expect(onStartup.mock.calls[0][0]).not.toBe(cached.connectionCorrelationId);
        expect(onStartup.mock.calls[1][0]).not.toBe(cached.connectionCorrelationId);
        expect(onStartup.mock.calls[1][0]).not.toBe(onStartup.mock.calls[0][0]);
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(MongoClient).toHaveBeenCalledTimes(3);
        expect(mockClose).toHaveBeenCalledTimes(3);
        expect(mockClose.mock.contexts[1]).toBe(mockConnect.mock.contexts[1]);
        expect(mockClose.mock.contexts[2]).toBe(mockConnect.mock.contexts[2]);
    });

    it('latch blocks cold and cached calls before startup or driver reuse', async () => {
        const epoch = ClustersClient.getEpoch(clusterId);
        ClustersClient.latch(clusterId, 'userDisconnected');
        expect(ClustersClient.getEpoch(clusterId)).toBe(epoch + 1);
        expect(ClustersClient.getLatchReason(clusterId)).toBe('userDisconnected');
        const onStartup = vi.fn();
        await expect(ClustersClient.getClient(clusterId, undefined, onStartup)).rejects.toMatchObject({
            name: 'ConnectionUnavailableError',
            reason: 'userDisconnected',
            message: 'The connection is unavailable.',
        });
        expect(MongoClient).not.toHaveBeenCalled();
        ClustersClient.unlatch(clusterId);
        expect(ClustersClient.getEpoch(clusterId)).toBe(epoch + 2);
        expect(ClustersClient.getLatchReason(clusterId)).toBeUndefined();

        await ClustersClient.connectInteractive(clusterId);
        ClustersClient.latch(clusterId, 'credentialsChanged');
        await expect(ClustersClient.getClient(clusterId, undefined, onStartup)).rejects.toMatchObject({
            reason: 'credentialsChanged',
        });
        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(onStartup).not.toHaveBeenCalled();
    });

    it('adds only bounded established-connection context by ID or client and does nothing without one', async () => {
        const context: ITelemetryContext = { properties: { existing: 'kept' }, measurements: { existing: 1 } };
        addEstablishedConnectionContext(context, clusterId);
        expect(context).toEqual({ properties: { existing: 'kept' }, measurements: { existing: 1 } });

        const client = await ClustersClient.connectInteractive(clusterId);
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NoAuth, 'mongodb://replacement.example.com');
        vi.advanceTimersByTime(125);
        addEstablishedConnectionContext(context, clusterId);
        expect(context).toEqual({
            properties: {
                existing: 'kept',
                authMethod: AuthMethodId.MicrosoftEntraID,
                connectionCorrelationId: client.connectionCorrelationId,
            },
            measurements: { existing: 1, connectionAgeMs: 125, clientGeneration: client.generation },
        });
        expect(JSON.stringify(context)).not.toContain(client.fingerprint);
        expect(JSON.stringify(context)).not.toContain('private-');

        vi.advanceTimersByTime(25);
        addEstablishedConnectionContext(context, client);
        expect(context.measurements.connectionAgeMs).toBe(150);
        await ClustersClient.deleteClient(clusterId);
        vi.advanceTimersByTime(25);
        addEstablishedConnectionContext(context, client);
        expect(context.measurements.connectionAgeMs).toBe(150);
    });

    afterEach(() => {
        ClusterSession._sessions.clear();
        SchemaStore.getInstance().clearCluster(clusterId);
        if (ClustersClient.getLatchReason(clusterId)) {
            ClustersClient.unlatch(clusterId);
        }
        ClustersClient['_pendingStartups'].clear();
        CredentialCache.deleteCredentials(clusterId);
        ClustersClient._clients.clear();
        ClustersClient._lastFailedStartups.clear();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('records only allowed pool fields at Debug under the Entra startup ID, starting before connect', async () => {
        const privateFields = { address: 'private-host:27017', error: new Error('private-error') };
        mockConnect.mockImplementationOnce(async (): Promise<void> => {
            poolEvents.emit('connectionCreated', { connectionId: 7, ...privateFields });
            poolEvents.emit('connectionReady', { connectionId: 7, ...privateFields });
        });
        const client = await ClustersClient.connectInteractive(clusterId);
        poolEvents.emit('connectionClosed', { connectionId: 7, reason: 'idle', ...privateFields });
        poolEvents.emit('connectionCheckOutFailed', { reason: 'connectionError', ...privateFields });
        poolEvents.emit('connectionClosed', { connectionId: '<monitor>', reason: 'private-reason', ...privateFields });
        poolEvents.emit('connectionCheckOutFailed', { reason: 'private-reason', ...privateFields });

        const prefix = `[ClustersClient] startup=${client.connectionCorrelationId}`;
        expect(vi.mocked(ext.outputChannel.debug).mock.calls).toEqual([
            [`${prefix} connectionCreated connectionId=7`],
            [`${prefix} connectionReady connectionId=7`],
            [`${prefix} connectionClosed connectionId=7 reason=idle`],
            [`${prefix} connectionCheckOutFailed reason=connectionError`],
            [`${prefix} connectionClosed`],
            [`${prefix} connectionCheckOutFailed`],
        ]);
    });

    it('logs only bounded listDatabases error details for Entra and rethrows each original error', async () => {
        const client = await ClustersClient.connectInteractive(clusterId);
        const serverError = new MongoServerError({ code: 18, errmsg: 'private-server-message' });
        const networkError = new MongoNetworkError('private-network-message');
        networkError.code = 'private-code';
        const otherError = new Error('private-other-message');
        otherError.name = 'private-name';
        mockListDatabases
            .mockRejectedValueOnce(serverError)
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(otherError);

        await expect(client.listDatabases()).rejects.toBe(serverError);
        await expect(client.listDatabases()).rejects.toBe(networkError);
        await expect(client.listDatabases()).rejects.toBe(otherError);

        const prefix = `[ClustersClient] startup=${client.connectionCorrelationId} listDatabases.failed`;
        expect(vi.mocked(ext.outputChannel.debug).mock.calls).toEqual([
            [`${prefix} kind=MongoServerError code=18`],
            [`${prefix} kind=MongoNetworkError`],
            [`${prefix} kind=other`],
        ]);
    });

    it('does not attach pool diagnostics or log listDatabases failures for native auth', async () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://private-host:27017');
        const client = await ClustersClient.getClient(clusterId);
        const error = new MongoServerError({ code: 18, errmsg: 'private-server-message' });
        mockListDatabases.mockRejectedValueOnce(error);

        expect(poolEvents.eventNames()).toEqual(['topologyClosed']);
        await expect(client.listDatabases()).rejects.toBe(error);
        expect(ext.outputChannel.debug).not.toHaveBeenCalled();
    });

    function startupEvent(): RecordedTelemetry {
        const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
        expect(events).toHaveLength(1);
        return events[0];
    }

    it.each([
        ['cluster.mongocluster.cosmos.azure.com', 'test-extension'],
        ['cluster.mongocluster.cosmos.azure.us:10255', 'test-extension'],
        ['CLUSTER.mongocluster.cosmos.azure.cn:10255', 'test-extension'],
        ['cluster.other.azure.us', 'test-extension'],
        ['cluster.azure.cn.evil.com', undefined],
        ['cluster.notazure.us', undefined],
        ['cluster.notazure.com', undefined],
        ['cluster.azure.tk', undefined],
        ['cluster.example.com', undefined],
        ['localhost:27017', undefined],
    ])('sets the same Azure appName only for a known cloud domain: %s', async (host, appName) => {
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: `mongodb://${host}/`,
            options: {},
            verifiedIdentity,
        });
        await ClustersClient.connectInteractive(clusterId);
        expect(vi.mocked(MongoClient).mock.calls[0]?.[1]?.appName).toBe(appName);
    });

    it.each([
        ['us', '8bafc480', 'f3e87358'],
        ['cn', '6a619114', '49133d63'],
    ])('preserves historical domain telemetry hashes for azure.%s', async (tld, level2, level3) => {
        const actual = await vi.importActual<{ getDomainMetadata: typeof getDomainMetadata }>(
            './utils/getClusterMetadata',
        );
        expect(actual.getDomainMetadata([`cluster.mongocluster.cosmos.azure.${tld}`])).toMatchObject({
            domainInfo_isAzure: 'false',
            domainInfo_domain_l2: level2,
            domainInfo_domain_l3: level3,
        });
    });

    it.each([
        AuthMethodId.MicrosoftEntraID,
        AuthMethodId.ManagedIdentity,
        AuthMethodId.NativeAuth,
        AuthMethodId.NoAuth,
    ])('summarizes a fresh %s connection with numbered stage timings', async (authMethod) => {
        CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://private-host:27017');
        const client = await ClustersClient.connectInteractive(clusterId, undefined, undefined, 'other');

        expect(startupEvent().telemetry).toMatchObject({
            maskEntireErrorMessage: true,
            properties: {
                connectionCorrelationId: client.connectionCorrelationId,
                startupCorrelationId: client.connectionCorrelationId,
                surface: 'extension',
                authMethod,
                lastStage: 'stage05InitializingApis',
                startupOutcome: 'succeeded',
                result: 'Succeeded',
            },
            measurements: {
                stage01PreparingCredentialsDurationMs: 0,
                stage02ConfiguringAuthDurationMs: 20,
                stage03PreparingClientDurationMs: 0,
                stage04ConnectingAndAuthenticatingDurationMs: 30,
                stage05InitializingApisDurationMs: 0,
                databaseConnectDurationMs: 30,
                duration: 0.05,
            },
        });
        expect(ext.outputChannel.trace).toHaveBeenCalledTimes(1);
        expect(ext.outputChannel.trace).toHaveBeenCalledWith(
            expect.stringContaining(
                'stageDurationsMs={"stage01PreparingCredentials":0,"stage02ConfiguringAuth":20,"stage03PreparingClient":0,"stage04ConnectingAndAuthenticating":30,"stage05InitializingApis":0}',
            ),
        );
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
        expect(prepareDriverConnectionString).toHaveBeenCalledWith(
            expect.objectContaining({
                correlation: {
                    startupCorrelationId: client.connectionCorrelationId,
                    connectionCorrelationId: client.connectionCorrelationId,
                },
            }),
        );
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
        expect(vi.mocked(ext.outputChannel.trace).mock.calls.flat().join('\n')).not.toContain('private-');
        expect(
            Object.keys(startupEvent().telemetry.measurements)
                .filter((name) => name.startsWith('stage'))
                .sort(),
        ).toEqual([
            'stage01PreparingCredentialsDurationMs',
            'stage02ConfiguringAuthDurationMs',
            'stage03PreparingClientDurationMs',
            'stage04ConnectingAndAuthenticatingDurationMs',
            'stage05InitializingApisDurationMs',
        ]);

        await expect(ClustersClient.getClient(clusterId)).resolves.toBe(client);
        startupEvent();
        expect(ext.outputChannel.trace).toHaveBeenCalledTimes(1);
        expect(vi.mocked(MongoClient)).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])(
        'marks whether the client is the Local Quick Start instance on every connection event (%s)',
        async (localQuickStartInstance): Promise<void> => {
            CredentialCache.setAuthCredentials(
                clusterId,
                AuthMethodId.NativeAuth,
                'mongodb://private-host:27017',
                undefined,
                undefined,
                undefined,
                undefined,
                { localQuickStartInstance },
            );
            await ClustersClient.connectInteractive(clusterId);
            await vi.dynamicImportSettled();
            await vi.waitFor(() =>
                expect(mockTelemetryEvents.map((event) => event.eventName)).toEqual(
                    expect.arrayContaining(['connect.startup', 'connect.staticmetadata', 'connect.getmetadata']),
                ),
            );

            const expected = localQuickStartInstance ? 'true' : 'false';
            for (const eventName of ['connect.startup', 'connect.staticmetadata', 'connect.getmetadata']) {
                const event = mockTelemetryEvents.find((recorded) => recorded.eventName === eventName);
                expect(event?.telemetry.properties.localQuickStartInstance).toBe(expected);
            }
        },
    );

    it.each([
        [AuthMethodId.MicrosoftEntraID, MicrosoftEntraIDAuthHandler],
        [AuthMethodId.ManagedIdentity, ManagedIdentityAuthHandler],
        [AuthMethodId.NativeAuth, NativeAuthHandler],
        [AuthMethodId.NoAuth, NoAuthHandler],
    ] as const)(
        'constructs the %s handler through the factory with the caller policy',
        async (authMethod, handlerClass): Promise<void> => {
            CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://private-host:27017');
            const interactive = authMethod === AuthMethodId.MicrosoftEntraID;
            if (interactive) {
                await ClustersClient.connectInteractive(clusterId);
            } else {
                await ClustersClient.getClient(clusterId);
            }

            const factory = vi.mocked(authHandlerFactory.createAuthHandler);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledWith(authMethod, expect.objectContaining({ clusterId }), {
                interactive,
            });
            const handler = factory.mock.results[0]?.value as unknown;
            expect(handler).toBeInstanceOf(handlerClass);
            expect(handler).toHaveProperty('policy', { interactive });
            expect(handlerClass.prototype.configureAuth).toHaveBeenCalledTimes(1);
        },
    );

    it('passes its startup ID to auth configuration', async (): Promise<void> => {
        let traceContext: AuthTraceContext | undefined;
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(
            async (_timings, context) => {
                traceContext = context;
                return { connectionString: 'mongodb://private-host:27017', options: {}, verifiedIdentity };
            },
        );
        const client = await ClustersClient.connectInteractive(clusterId);
        expect(traceContext).toEqual({
            startupCorrelationId: client.connectionCorrelationId,
            surface: 'extension',
            startupProperties: startupEvent().telemetry.properties,
        });
    });

    it('links a retry to the failed startup it follows, and forgets it once a startup succeeds', async () => {
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockRejectedValueOnce(
            new Error('private-failure'),
        );
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toThrow('private-failure');
        const failedId = startupEvent().telemetry.properties.startupCorrelationId;
        expect(failedId).toEqual(expect.any(String));
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBe(failedId);

        const client = await ClustersClient.connectInteractive(clusterId);
        const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
        expect(events[0].telemetry.properties.previousFailedStartupCorrelationId).toBeUndefined();
        expect(events[1].telemetry.properties).toMatchObject({
            startupCorrelationId: client.connectionCorrelationId,
            previousFailedStartupCorrelationId: failedId,
        });
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBeUndefined();
    });

    it('does not record a cancelled startup as a failure to follow up on', async () => {
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockRejectedValueOnce(new UserCancelledError());
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toBeInstanceOf(UserCancelledError);
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBeUndefined();
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'isolates %s cloud telemetry from the next attempt on the same cluster',
        async (authMethod) => {
            CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://private-host:27017');
            const handler =
                authMethod === AuthMethodId.ManagedIdentity ? ManagedIdentityAuthHandler : MicrosoftEntraIDAuthHandler;
            vi.mocked(handler.prototype.configureAuth).mockImplementationOnce(async (_timings, context) => {
                traceAuthFlow(
                    'entraCloud.unresolved',
                    {
                        cloudCategory: 'usgov',
                        reason: 'host',
                        configuredCloud: 'custom',
                        hostCloud: 'AzureUSGovernment',
                        errorKind: 'cloudMismatch',
                        tokenResource: 'private-resource',
                    },
                    undefined,
                    context,
                );
                throw new Error('private-resolution-failure');
            });
            await expect(ClustersClient.connectInteractive(clusterId)).rejects.toThrow('private-resolution-failure');
            const failedProperties = { ...startupEvent().telemetry.properties };
            await ClustersClient.connectInteractive(clusterId);
            const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
            expect(events[0].telemetry.properties).toEqual(failedProperties);
            expect(failedProperties).toMatchObject({
                cloudCategory: 'usgov',
                tokenResourceReason: 'host',
                configuredCloud: 'custom',
                hostCloud: 'AzureUSGovernment',
                entraFailureKind: 'cloudMismatch',
            });
            expect(events[1].telemetry.properties.cloudCategory).toBeUndefined();
            expect(JSON.stringify(events)).not.toContain('private-');
        },
    );

    it('preserves auth failures and records their partial stage without private error data', async () => {
        const originalError = new Error('private-token private-account');
        const onStartup = vi.fn<(id: string) => void>();
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(async () => {
            vi.advanceTimersByTime(15);
            throw originalError;
        });

        await expect(ClustersClient.connectInteractive(clusterId, undefined, onStartup)).rejects.toBe(originalError);
        expect(onStartup).toHaveBeenCalledExactlyOnceWith(startupEvent().telemetry.properties.connectionCorrelationId);
        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Failed',
            startupOutcome: 'failed',
            lastStage: 'stage02ConfiguringAuth',
        });
        expect(startupEvent().telemetry.measurements.stage02ConfiguringAuthDurationMs).toBe(15);
        expect(startupEvent().telemetry.measurements.stage04ConnectingAndAuthenticatingDurationMs).toBeUndefined();
        expect(startupEvent().error).toMatchObject({ message: 'Connection startup failed', stack: undefined });
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
        expect(ext.outputChannel.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(MongoClient)).not.toHaveBeenCalled();
    });

    it('bundles an early Entra provider wait without subtracting it from later database work', async () => {
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(async (timings) => {
            const stop = timings?.startTokenAcquire();
            vi.advanceTimersByTime(20);
            stop?.();
            return { connectionString: 'mongodb://private-host:27017', options: {}, verifiedIdentity };
        });
        await ClustersClient.connectInteractive(clusterId);
        expect(startupEvent().telemetry.measurements).toMatchObject({
            tokenAcquireDurationMs: 20,
            databaseConnectDurationMs: 30,
        });
        expect(startupEvent().telemetry.measurements.tokenRelayDurationMs).toBeUndefined();
        expect(ext.outputChannel.trace).toHaveBeenCalledTimes(1);
    });

    it('excludes a managed-identity provider wait during database connection', async () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.ManagedIdentity, 'mongodb://private-host:27017');
        vi.mocked(ManagedIdentityAuthHandler.prototype.configureAuth).mockImplementationOnce(async (timings) => {
            mockConnect.mockImplementationOnce(async (): Promise<void> => {
                vi.advanceTimersByTime(10);
                const stop = timings?.startTokenAcquire();
                vi.advanceTimersByTime(20);
                stop?.();
                vi.advanceTimersByTime(10);
            });
            return { connectionString: 'mongodb://private-host:27017', options: {} };
        });
        await ClustersClient.getClient(clusterId);
        expect(startupEvent().telemetry.measurements).toMatchObject({
            tokenAcquireDurationMs: 20,
            databaseConnectDurationMs: 20,
        });
        expect(ext.outputChannel.trace).toHaveBeenCalledTimes(1);
    });

    it('preserves driver failures and gives the retry a new correlation ID', async () => {
        const originalError = new Error('private-driver-error');
        mockConnect.mockRejectedValueOnce(originalError);
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toBe(originalError);
        const firstEvent = startupEvent();
        expect(firstEvent.telemetry.properties.lastStage).toBe('stage04ConnectingAndAuthenticating');
        expect(JSON.stringify(firstEvent)).not.toContain('private-');
        expect(mockClose).toHaveBeenCalled();

        const client = await ClustersClient.connectInteractive(clusterId);
        const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
        expect(events).toHaveLength(2);
        expect(client.connectionCorrelationId).not.toBe(firstEvent.telemetry.properties.connectionCorrelationId);
    });

    it('does not start a connection for an already canceled waiter', async () => {
        const controller = new AbortController();
        controller.abort();

        const onStartup = vi.fn();
        await expect(ClustersClient.getClient(clusterId, controller.signal, onStartup)).rejects.toBeInstanceOf(
            UserCancelledError,
        );
        expect(onStartup).not.toHaveBeenCalled();
        expect(mockTelemetryEvents.filter((e) => e.eventName === 'connect.startup')).toHaveLength(0);
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
        expect(mockConnect).not.toHaveBeenCalled();
    });

    it('records a canceled wait during the handshake but publishes the abandoned successful startup', async () => {
        const controller = new AbortController();
        const handshake = pauseNextConnect();
        const waiter = ClustersClient.connectInteractive(clusterId, controller.signal);
        await handshake.started;
        vi.advanceTimersByTime(25);
        controller.abort();
        await expect(waiter).rejects.toBeInstanceOf(UserCancelledError);
        handshake.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Succeeded',
            startupOutcome: 'succeeded',
            lastStage: 'stage05InitializingApis',
        });
        expect(startupEvent().telemetry.measurements.stage04ConnectingAndAuthenticatingDurationMs).toBe(25);
        expect(mockClose).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
        const startupId = startupEvent().telemetry.properties.startupCorrelationId as string;
        expect(ClustersClient.getExistingClient(clusterId)?.connectionCorrelationId).toBe(startupId);
        expect(startupId).toMatch(/^[0-9a-f-]{36}$/);
        expect(ext.outputChannel.debug).toHaveBeenCalledWith(
            `[ClustersClient] startup=${startupId} wait canceled by user surface=extension`,
        );
    });

    it('reports and cleans up a genuine driver failure after both cold waiters leave', async () => {
        const handshake = pauseNextConnect();
        const controllers = [new AbortController(), new AbortController()];
        const waits = [
            ClustersClient.connectInteractive(clusterId, controllers[0].signal),
            ClustersClient.getClient(clusterId, controllers[1].signal),
        ];
        await handshake.started;
        controllers.forEach((controller) => controller.abort());
        await Promise.all(waits.map((wait) => expect(wait).rejects.toBeInstanceOf(UserCancelledError)));
        expect(mockClose).not.toHaveBeenCalled();
        handshake.reject(new MongoNetworkError('private-driver-failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Failed',
            startupOutcome: 'failed',
            startupFailureCategory: 'network',
            lastStage: 'stage04ConnectingAndAuthenticating',
        });
        const failedId = startupEvent().telemetry.properties.startupCorrelationId;
        expect(ClustersClient.getLastFailedStartupCorrelationId(clusterId)).toBe(failedId);
        expect(ClustersClient.getBinding(clusterId)).toBeUndefined();
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect((await ClustersClient.connectInteractive(clusterId)).connectionCorrelationId).not.toBe(failedId);
    });

    it('records a credentials failure before auth configuration', async () => {
        CredentialCache.deleteCredentials(clusterId);
        const waiter = ClustersClient.getClient(clusterId);
        await expect(waiter).rejects.toBeInstanceOf(ConnectionUnavailableError);
        await expect(waiter).rejects.toMatchObject({
            name: 'ConnectionUnavailableError',
            reason: 'credentialsMissing',
            message: 'No credentials found.',
        });
        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Failed',
            lastStage: 'stage01PreparingCredentials',
            startupFailureType: 'ConnectionUnavailableError',
            startupFailureCategory: 'credentialsUnavailable',
            startupTrigger: 'other',
        });
        expect(startupEvent().telemetry.properties.connectionCorrelationId).toEqual(expect.any(String));
        expect(startupEvent().telemetry.measurements.stage02ConfiguringAuthDurationMs).toBeUndefined();
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
        expect(vi.mocked(MongoClient)).not.toHaveBeenCalled();
    });

    it('records the original failure type, category and trigger under names whole-error masking keeps', async () => {
        const serverError = new MongoServerError({ message: 'private-user authentication failed', code: 18 });
        mockConnect.mockRejectedValueOnce(serverError);

        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toBe(serverError);
        const properties = startupEvent().telemetry.properties;
        expect(properties).toMatchObject({
            startupFailureType: '18',
            startupFailureCategory: 'authentication',
            startupTrigger: 'treeConnect',
        });
        // azext redacts every property named like an error when `maskEntireErrorMessage` is set.
        expect(
            ['startupFailureType', 'startupFailureCategory', 'startupTrigger'].filter((key) =>
                /(error|exception)/i.test(key),
            ),
        ).toEqual([]);
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
    });

    it('records no failure properties on success and no startup event for pre-cancellation', async () => {
        await ClustersClient.connectInteractive(clusterId, undefined, undefined, 'clusterDashboardPoll');
        expect(startupEvent().telemetry.properties).toMatchObject({ startupTrigger: 'clusterDashboardPoll' });
        expect(startupEvent().telemetry.properties.startupFailureType).toBeUndefined();
        expect(startupEvent().telemetry.properties.startupFailureCategory).toBeUndefined();

        ClustersClient._clients.clear();
        mockTelemetryEvents.length = 0;
        const controller = new AbortController();
        controller.abort();
        await expect(ClustersClient.getClient(clusterId, controller.signal)).rejects.toBeInstanceOf(UserCancelledError);
        expect(mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup')).toHaveLength(0);
    });

    it('hands the transient URI to the driver while metadata and credentials keep the original', async () => {
        const original = 'mongodb+srv://original.global.mongocluster.cosmos.azure.com/';
        const rewritten = 'mongodb://resolved.example.com:27017/?tls=true';
        const preparedOptions: MongoClientOptions = { tls: true };
        const summary: SrvResolutionSummary = { path: 'fallback', nodeErrorCode: 'EBADRESP', resolvedAt: 1 };
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, original);
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: original,
            options: {},
            verifiedIdentity,
        });
        vi.mocked(prepareDriverConnectionString).mockResolvedValueOnce({
            connectionString: rewritten,
            options: preparedOptions,
            srvResolution: 'fallback',
            summary,
        });
        const client = await ClustersClient.connectInteractive(clusterId);
        expect(MongoClient).toHaveBeenCalledWith(rewritten, preparedOptions);
        expect(CredentialCache.getCredentials(clusterId)?.connectionString).toBe(original);
        const hosts = ['original.global.mongocluster.cosmos.azure.com'];
        // The static-metadata event loads its helper with a dynamic import, which takes more ticks under Vitest.
        await vi.waitFor(() => expect(getDomainMetadata).toHaveBeenCalledWith(hosts));
        expect(getClusterMetadata).toHaveBeenCalledWith(client.getMongoClient(), hosts);
        expect(ClustersClient.getSrvResolution(clusterId)).toBe(summary);
        await ClustersClient.deleteClient(clusterId);
        expect(ClustersClient.getSrvResolution(clusterId)).toBeUndefined();
    });

    it('evaluates the TLS exception policy against the original SRV URI on driver failure', async () => {
        const original = 'mongodb+srv://original.example.com/';
        const policy = vi.mocked(tlsException.resolveAllowInvalidCertificates).mockReturnValueOnce(undefined);
        vi.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockResolvedValueOnce({
            connectionString: original,
            options: {},
            verifiedIdentity,
        });
        vi.mocked(prepareDriverConnectionString).mockResolvedValueOnce({
            connectionString: 'mongodb://resolved.example.com/',
            options: {},
            srvResolution: 'fallback',
        });
        const failure = new Error('ECONNREFUSED');
        mockConnect.mockRejectedValueOnce(failure);
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toBe(failure);
        expect(policy).toHaveBeenCalledWith(undefined, original);
    });

    it('rethrows an SRV preparation failure without constructing a driver', async (): Promise<void> => {
        const failure = new Error('original resolution failure');
        vi.mocked(prepareDriverConnectionString).mockRejectedValueOnce(failure);
        await expect(ClustersClient.connectInteractive(clusterId)).rejects.toBe(failure);
        expect(MongoClient).not.toHaveBeenCalled();
        expect(startupEvent().telemetry.properties).toMatchObject({
            startupOutcome: 'failed',
            lastStage: 'stage03PreparingClient',
        });
    });
});

describe('getIndexExclusionReason', () => {
    it('classifies the built-in _id index', () => {
        expect(getIndexExclusionReason(createIndex({ key: { _id: 1 } }))).toBe('builtInId');
    });

    it('classifies a keyless vector search index as not copyable', () => {
        expect(getIndexExclusionReason(createIndex({ type: 'vectorSearch', key: undefined }))).toBe('notCopyable');
    });

    it('allows an ordinary DocumentDB vector index', () => {
        expect(
            getIndexExclusionReason(
                createIndex({
                    key: { embedding: 'cosmosSearch' },
                    cosmosSearchOptions: { kind: 'vector-ivf' },
                }),
            ),
        ).toBeUndefined();
    });

    it('allows a hidden ordinary index', () => {
        expect(getIndexExclusionReason(createIndex({ key: { customerId: 1 }, hidden: true }))).toBeUndefined();
    });
});

function createIndex(overrides: Partial<IndexItemModel>): IndexItemModel {
    return {
        name: 'test_index',
        type: 'traditional',
        ...overrides,
    };
}
