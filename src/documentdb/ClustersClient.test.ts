/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ITelemetryContext, UserCancelledError } from '@microsoft/vscode-azext-utils';
import type * as Mongodb from 'mongodb';
import { MongoClient } from 'mongodb';
import { ext } from '../extensionVariables';
import { AuthMethodId } from './auth/AuthMethod';
import { ManagedIdentityAuthHandler } from './auth/ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './auth/MicrosoftEntraIDAuthHandler';
import { NativeAuthHandler } from './auth/NativeAuthHandler';
import { NoAuthHandler } from './auth/NoAuthHandler';
import { ClustersClient, getIndexExclusionReason, type IndexItemModel } from './ClustersClient';
import { CredentialCache } from './CredentialCache';

interface RecordedTelemetry {
    readonly eventName: string;
    readonly telemetry: ITelemetryContext;
    error?: unknown;
}

const mockTelemetryEvents: RecordedTelemetry[] = [];

jest.mock('@microsoft/vscode-azext-utils', () => {
    const actual = jest.requireActual<{ UserCancelledError: typeof UserCancelledError }>(
        '@microsoft/vscode-azext-utils',
    );
    return {
        ...actual,
        parseError: (error: unknown): { message: string } => ({
            message: error instanceof Error ? error.message : String(error),
        }),
        callWithTelemetryAndErrorHandling: jest.fn(
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

jest.mock('mongodb', () => {
    const actual = jest.requireActual<typeof Mongodb>('mongodb');
    return { ...actual, MongoClient: jest.fn() };
});

jest.mock('../extensionVariables', () => ({
    ext: { outputChannel: { trace: jest.fn(), error: jest.fn(), debug: jest.fn() } },
}));

jest.mock('./utils/getClusterMetadata', () => ({
    getClusterMetadata: jest.fn().mockResolvedValue({}),
    getDomainMetadata: jest.fn().mockReturnValue({}),
}));

jest.mock('./LlmEnhancedFeatureApis', () => ({ llmEnhancedFeatureApis: jest.fn() }));
jest.mock('./client/QueryInsightsApis', () => ({ QueryInsightsApis: jest.fn() }));

describe('ClustersClient', () => {
    it('should be defined', () => {
        expect(ClustersClient).toBeDefined();
    });
});

describe('regular connection startup diagnostics', () => {
    const clusterId = 'private-cluster';
    const mockConnect = jest.fn();
    const mockClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockTelemetryEvents.length = 0;
        ClustersClient._clients.clear();
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.MicrosoftEntraID, 'mongodb://private-host:27017');
        mockConnect.mockImplementation(async (): Promise<void> => {
            jest.advanceTimersByTime(30);
        });
        mockClose.mockResolvedValue(undefined);
        jest.mocked(MongoClient).mockImplementation(
            () => ({ connect: mockConnect, close: mockClose }) as unknown as MongoClient,
        );
        for (const handler of [
            MicrosoftEntraIDAuthHandler,
            ManagedIdentityAuthHandler,
            NativeAuthHandler,
            NoAuthHandler,
        ]) {
            jest.spyOn(handler.prototype, 'configureAuth').mockImplementation(async () => {
                jest.advanceTimersByTime(20);
                return { connectionString: 'mongodb://private-host:27017', options: {} };
            });
        }
    });

    afterEach(() => {
        CredentialCache.deleteCredentials(clusterId);
        ClustersClient._clients.clear();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    function startupEvent(): RecordedTelemetry {
        const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
        expect(events).toHaveLength(1);
        return events[0];
    }

    it.each([
        AuthMethodId.MicrosoftEntraID,
        AuthMethodId.ManagedIdentity,
        AuthMethodId.NativeAuth,
        AuthMethodId.NoAuth,
    ])('summarizes a fresh %s connection with numbered stage timings', async (authMethod) => {
        CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://private-host:27017');
        const client = await ClustersClient.getClient(clusterId);

        expect(startupEvent().telemetry).toMatchObject({
            maskEntireErrorMessage: true,
            properties: {
                connectionCorrelationId: client.connectionCorrelationId,
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
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
        expect(jest.mocked(ext.outputChannel.trace).mock.calls.flat().join('\n')).not.toContain('private-');
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
        expect(jest.mocked(MongoClient)).toHaveBeenCalledTimes(1);
    });

    it('preserves auth failures and records their partial stage without private error data', async () => {
        const originalError = new Error('private-token private-account');
        jest.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(async () => {
            jest.advanceTimersByTime(15);
            throw originalError;
        });

        await expect(ClustersClient.getClient(clusterId)).rejects.toBe(originalError);
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
        expect(jest.mocked(MongoClient)).not.toHaveBeenCalled();
    });

    it('bundles an early Entra provider wait without subtracting it from later database work', async () => {
        jest.mocked(MicrosoftEntraIDAuthHandler.prototype.configureAuth).mockImplementationOnce(async (timings) => {
            const stop = timings?.startTokenAcquire();
            jest.advanceTimersByTime(20);
            stop?.();
            return { connectionString: 'mongodb://private-host:27017', options: {} };
        });
        await ClustersClient.getClient(clusterId);
        expect(startupEvent().telemetry.measurements).toMatchObject({
            tokenAcquireDurationMs: 20,
            databaseConnectDurationMs: 30,
        });
        expect(startupEvent().telemetry.measurements.tokenRelayDurationMs).toBeUndefined();
        expect(ext.outputChannel.trace).toHaveBeenCalledTimes(1);
    });

    it('excludes a managed-identity provider wait during database connection', async () => {
        CredentialCache.setAuthCredentials(clusterId, AuthMethodId.ManagedIdentity, 'mongodb://private-host:27017');
        jest.mocked(ManagedIdentityAuthHandler.prototype.configureAuth).mockImplementationOnce(async (timings) => {
            mockConnect.mockImplementationOnce(async (): Promise<void> => {
                jest.advanceTimersByTime(10);
                const stop = timings?.startTokenAcquire();
                jest.advanceTimersByTime(20);
                stop?.();
                jest.advanceTimersByTime(10);
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
        await expect(ClustersClient.getClient(clusterId)).rejects.toBe(originalError);
        const firstEvent = startupEvent();
        expect(firstEvent.telemetry.properties.lastStage).toBe('stage04ConnectingAndAuthenticating');
        expect(JSON.stringify(firstEvent)).not.toContain('private-');
        expect(mockClose).toHaveBeenCalled();

        const client = await ClustersClient.getClient(clusterId);
        const events = mockTelemetryEvents.filter((event) => event.eventName === 'connect.startup');
        expect(events).toHaveLength(2);
        expect(client.connectionCorrelationId).not.toBe(firstEvent.telemetry.properties.connectionCorrelationId);
    });

    it('reports cancellation without swallowing the caller cancellation error', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(ClustersClient.getClient(clusterId, controller.signal)).rejects.toBeInstanceOf(UserCancelledError);
        expect(startupEvent().telemetry.properties).toMatchObject({ result: 'Canceled', startupOutcome: 'canceled' });
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
        expect(mockConnect).not.toHaveBeenCalled();
    });

    it('records cancellation during the driver handshake and retains cleanup', async () => {
        const controller = new AbortController();
        mockConnect.mockImplementationOnce(async (): Promise<void> => {
            jest.advanceTimersByTime(25);
            controller.abort();
            throw new Error('private-driver-abort');
        });

        await expect(ClustersClient.getClient(clusterId, controller.signal)).rejects.toBeInstanceOf(UserCancelledError);
        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Canceled',
            startupOutcome: 'canceled',
            lastStage: 'stage04ConnectingAndAuthenticating',
        });
        expect(startupEvent().telemetry.measurements.stage04ConnectingAndAuthenticatingDurationMs).toBe(25);
        expect(mockClose).toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
        expect(ClustersClient._clients.has(clusterId)).toBe(false);
    });

    it('records a credentials failure before auth configuration', async () => {
        CredentialCache.deleteCredentials(clusterId);
        await expect(ClustersClient.getClient(clusterId)).rejects.toThrow('No credentials found');
        expect(startupEvent().telemetry.properties).toMatchObject({
            result: 'Failed',
            lastStage: 'stage01PreparingCredentials',
        });
        expect(startupEvent().telemetry.properties.connectionCorrelationId).toEqual(expect.any(String));
        expect(startupEvent().telemetry.measurements.stage02ConfiguringAuthDurationMs).toBeUndefined();
        expect(JSON.stringify(startupEvent())).not.toContain('private-');
        expect(jest.mocked(MongoClient)).not.toHaveBeenCalled();
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
