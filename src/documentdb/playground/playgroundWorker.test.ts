/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { type PeerCertificate } from 'tls';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraDestinationRejectedError } from '../auth/oidcAllowedHosts';
import { type MainToWorkerMessage, type WorkerToMainMessage } from './workerTypes';

const transport = vi.hoisted(() => ({ on: vi.fn(), postMessage: vi.fn() }));
const driver = vi.hoisted(() => ({
    construct: vi.fn(),
    connect: vi.fn(),
}));

vi.mock('worker_threads', () => ({ parentPort: transport }));
vi.mock('mongodb', () => ({
    MongoClient: vi.fn().mockImplementation(function (connectionString: string, options: MongoClientOptions) {
        driver.construct(connectionString, options);
        return { connect: driver.connect };
    }),
}));
vi.mock('@documentdb-js/shell-runtime', () => ({
    DocumentDBShellRuntime: vi.fn().mockImplementation(function () {
        return {};
    }),
}));

describe('playground worker OIDC configuration at the driver boundary', () => {
    let receive: (message: MainToWorkerMessage) => void;
    const originalUncaught = process.listeners('uncaughtException');
    const originalRejections = process.listeners('unhandledRejection');

    beforeAll(async (): Promise<void> => {
        await import('./playgroundWorker');
        receive = transport.on.mock.calls.find((call) => call[0] === 'message')?.[1] as typeof receive;
    });

    afterAll((): void => {
        for (const listener of process.listeners('uncaughtException')) {
            if (!originalUncaught.includes(listener)) {
                process.removeListener('uncaughtException', listener);
            }
        }
        for (const listener of process.listeners('unhandledRejection')) {
            if (!originalRejections.includes(listener)) {
                process.removeListener('unhandledRejection', listener);
            }
        }
    });

    beforeEach((): void => {
        vi.clearAllMocks();
        driver.connect.mockResolvedValue(undefined);
    });

    function init(overrides: Partial<Extract<MainToWorkerMessage, { type: 'init' }>> = {}): void {
        receive({
            type: 'init',
            requestId: 'init-request',
            databaseName: 'test',
            connectionString: 'mongodb://resolved.mongocluster.cosmos.azure.com:10260/',
            authMechanism: 'MicrosoftEntraID',
            clientOptions: {},
            ...overrides,
        });
    }

    async function waitForInit(): Promise<void> {
        await vi.waitFor(() =>
            expect(transport.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'initResult', requestId: 'init-request' }),
            ),
        );
    }

    it.each(['MicrosoftEntraID', 'ManagedIdentity'] as const)(
        'builds secure %s options from the prepared destination, strips bypasses and relays its callback',
        async (authMechanism): Promise<void> => {
            init({
                authMechanism,
                connectionString:
                    'mongodb://user:password@resolved.mongocluster.cosmos.azure.us:10260/?TLS=false&tlsInsecure=true&authMechanismProperties=ENVIRONMENT:azure',
                clientOptions: { tlsAllowInvalidCertificates: true, serverSelectionTimeoutMS: 1234 },
            });
            await waitForInit();
            expect(driver.construct).toHaveBeenCalledTimes(1);
            const [connectionString, options] = driver.construct.mock.calls[0] as [string, MongoClientOptions];
            expect(connectionString).not.toMatch(/user|password|tls|authMechanism|ENVIRONMENT/i);
            expect(options).toMatchObject({
                tls: true,
                rejectUnauthorized: true,
                checkServerIdentity: expect.any(Function),
                serverSelectionTimeoutMS: 1234,
                authMechanism: 'MONGODB-OIDC',
                authMechanismProperties: { ALLOWED_HOSTS: ['*.mongocluster.cosmos.azure.us'] },
            });
            expect(options.tlsAllowInvalidCertificates).toBeUndefined();
            expect(options.authMechanismProperties?.ENVIRONMENT).toBeUndefined();
            expect(options.checkServerIdentity?.('attacker.cloudapp.azure.com', {} as PeerCertificate)).toBeInstanceOf(
                EntraDestinationRejectedError,
            );
            expect(transport.postMessage).toHaveBeenCalledWith({
                type: 'log',
                level: 'info',
                message: '[Auth] TLS validation bypass parameters are ignored for Microsoft Entra ID connections.',
            });
            const callback = options.authMechanismProperties?.OIDC_CALLBACK;
            if (!callback) {
                throw new Error('Expected the OIDC callback');
            }
            const token = callback({ version: 1, timeoutContext: new AbortController().signal });
            const request = transport.postMessage.mock.calls
                .map((call) => call[0] as WorkerToMainMessage)
                .find((message) => message.type === 'tokenRequest');
            expect(request).toBeDefined();
            receive({ type: 'tokenResponse', requestId: request!.requestId, accessToken: 'dummy-token' });
            await expect(token).resolves.toMatchObject({ accessToken: 'dummy-token' });
        },
    );

    it.each(['com', 'us', 'cn'])('narrows the actual prepared azure.%s driver hosts', async (suffix): Promise<void> => {
        init({ connectionString: `mongodb://resolved.mongocluster.cosmos.azure.${suffix}:10260/` });
        await waitForInit();
        const options = driver.construct.mock.calls[0][1] as MongoClientOptions;
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual([`*.mongocluster.cosmos.azure.${suffix}`]);
    });

    it('rebuilds custom-suffix options after preparation without accepting a broad host list', async (): Promise<void> => {
        init({
            connectionString: 'mongodb://resolved.database.example.com:10260/',
            oidcCustomHostnameSuffix: 'database.example.com',
        });
        await waitForInit();
        const options = driver.construct.mock.calls[0][1] as MongoClientOptions;
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.database.example.com']);
    });

    it('preserves a rejected relay error through worker initialization', async (): Promise<void> => {
        driver.connect.mockImplementationOnce(async (): Promise<void> => {
            const options = driver.construct.mock.calls[0][1] as MongoClientOptions;
            const callback = options.authMechanismProperties?.OIDC_CALLBACK;
            if (!callback) {
                throw new Error('Expected the OIDC callback');
            }
            const pending = callback({ version: 1, timeoutContext: new AbortController().signal });
            const request = transport.postMessage.mock.calls
                .map((call) => call[0] as WorkerToMainMessage)
                .find((message) => message.type === 'tokenRequest');
            receive({
                type: 'tokenError',
                requestId: request!.requestId,
                error: "Microsoft Entra ID isn't allowed for this server.",
                errorName: 'EntraDestinationRejectedError',
            });
            await pending;
        });
        init();
        await waitForInit();
        expect(transport.postMessage).toHaveBeenCalledWith({
            type: 'initResult',
            requestId: 'init-request',
            success: false,
            error: "Microsoft Entra ID isn't allowed for this server.",
            errorName: 'EntraDestinationRejectedError',
        });
    });

    it.each([
        'mongodb://attacker.cloudapp.azure.com/',
        'mongodb://resolved.mongocluster.cosmos.azure.com,attacker.example.com/',
        'mongodb://localhost:27017/',
    ])(
        'rejects prepared %s before client construction or any token request',
        async (connectionString): Promise<void> => {
            init({ connectionString });
            await waitForInit();
            expect(driver.construct).not.toHaveBeenCalled();
            expect(driver.connect).not.toHaveBeenCalled();
            expect(transport.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenRequest' }));
            expect(transport.postMessage).toHaveBeenCalledWith({
                type: 'initResult',
                requestId: 'init-request',
                success: false,
                error: "Microsoft Entra ID isn't allowed for this server.",
                errorName: 'EntraDestinationRejectedError',
            });
        },
    );

    it.each(['NativeAuth', 'NoAuth'] as const)(
        'leaves non-OIDC %s options unchanged',
        async (authMechanism): Promise<void> => {
            const connectionString = 'mongodb://localhost:27017/?tlsInsecure=true';
            const clientOptions = { tlsAllowInvalidCertificates: true };
            init({ authMechanism, connectionString, clientOptions });
            await waitForInit();
            expect(driver.construct).toHaveBeenCalledExactlyOnceWith(connectionString, clientOptions);
        },
    );
});
