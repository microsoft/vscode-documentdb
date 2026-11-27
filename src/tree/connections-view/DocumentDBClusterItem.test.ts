/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    UserCancelledError,
    type AzureWizard,
    type callWithTelemetryAndErrorHandling,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { EntraDestinationRejectedError, evaluateEntraDestination } from '../../documentdb/auth/oidcAllowedHosts';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ChooseAuthMethodStep } from '../../documentdb/wizards/authenticate/ChooseAuthMethodStep';
import { API, DocumentDBExperience } from '../../DocumentDBExperiences';
import { ConnectionReachabilityService } from '../../services/connectionReachabilityService';
import type * as storageModule from '../../services/connectionStorageService';
import {
    ConnectionStorageService,
    ItemType,
    StorageZone,
    type ConnectionItem,
} from '../../services/connectionStorageService';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';

const { prompt, wizardCreated, showQuickPick, showErrorMessage, telemetryEvents } = vi.hoisted(() => ({
    prompt: vi.fn<(context: AuthenticateWizardContext) => Promise<void>>(),
    wizardCreated: vi.fn(),
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
    telemetryEvents: [] as Array<{ name: string; properties: Record<string, string | undefined> }>,
}));

vi.mock('vscode', async (importOriginal) => {
    const original = await importOriginal<typeof vscode>();
    return {
        ...original,
        window: { ...original.window, showErrorMessage },
        env: { ...original.env, openExternal: vi.fn() },
    };
});

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{
        AzureWizard: typeof AzureWizard;
        callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling;
    }>()),
    AzureWizard: class {
        constructor(private readonly context: AuthenticateWizardContext) {
            wizardCreated(context);
        }
        public async prompt(): Promise<void> {
            await prompt(this.context);
        }
    },
    callWithTelemetryAndErrorHandling: async (
        name: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
            ui: { showQuickPick },
        } as unknown as IActionContext;
        telemetryEvents.push({
            name,
            properties: context.telemetry.properties as Record<string, string | undefined>,
        });
        try {
            return await callback(context);
        } catch (error) {
            if (error instanceof UserCancelledError) {
                context.telemetry.properties.result = 'Canceled';
            }
            return undefined;
        }
    },
}));
vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: vi.fn(), save: vi.fn() },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    addEstablishedConnectionContext: vi.fn(),
    ClustersClient: {
        connectInteractive: vi.fn(),
        deleteClient: vi.fn(),
        exists: vi.fn(),
        getEpoch: vi.fn(() => 0),
        getLatchReason: vi.fn(),
    },
}));
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: vi.fn(),
        setAuthCredentials: vi.fn(),
        deleteCredentials: vi.fn(),
        getCredentials: vi.fn(),
    },
}));
vi.mock('../../services/connectionReachabilityService', () => ({
    ConnectionReachabilityService: { ensureReachable: vi.fn() },
}));
vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { appendLine: vi.fn(), append: vi.fn(), debug: vi.fn(), info: vi.fn() } },
}));

function makeConnection(connectionString: string, selectedAuthMethod?: AuthMethodId): ConnectionItem {
    return {
        id: 'stable-id',
        name: 'Saved connection',
        properties: { type: ItemType.Connection, api: API.DocumentDB, availableAuthMethods: [], selectedAuthMethod },
        secrets: { connectionString, managedIdentityAuthConfig: {} },
    };
}

function makeItem(): DocumentDBClusterItem {
    return new DocumentDBClusterItem({
        treeId: 'connectionsView/folder/stable-id',
        clusterId: 'stable-id',
        storageId: 'stable-id',
        name: 'Saved connection',
        dbExperience: DocumentDBExperience,
        viewId: Views.ConnectionsView,
    });
}

describe('saved connection destination authentication', () => {
    beforeEach((): void => {
        vi.clearAllMocks();
        vi.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
        vi.mocked(ClustersClient.connectInteractive).mockResolvedValue({
            connectionCorrelationId: 'attempt',
        } as ClustersClient);
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration);
        prompt.mockImplementation(async (context): Promise<void> => {
            await new ChooseAuthMethodStep().prompt(context);
        });
        showQuickPick.mockImplementation(async (items: Array<{ authMethod?: AuthMethodId }>) =>
            items.find((item) => item.authMethod === AuthMethodId.NoAuth),
        );
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'reports a forced saved %s rejection without opening a picker or falling back',
        async (method): Promise<void> => {
            const connection = makeConnection('mongodb://other.example.com/', method);
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);
            vi.mocked(ClustersClient.connectInteractive).mockRejectedValue(
                new EntraDestinationRejectedError(evaluateEntraDestination(connection.secrets.connectionString)),
            );
            const item = makeItem();

            await expect(item.connect()).resolves.toBeNull();

            expect(wizardCreated).not.toHaveBeenCalled();
            expect(prompt).not.toHaveBeenCalled();
            expect(showQuickPick).not.toHaveBeenCalled();
            expect(ClustersClient.connectInteractive).toHaveBeenCalledTimes(1);
            expect(CredentialCache.setAuthCredentials).toHaveBeenCalledWith(
                'stable-id',
                method,
                connection.secrets.connectionString,
                undefined,
                undefined,
                undefined,
                {},
            );
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
                "Microsoft Entra ID isn't allowed for this server.",
                expect.objectContaining({ modal: true }),
                'Learn More',
            );
            expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
            expect(ConnectionStorageService.save).not.toHaveBeenCalled();
            expect(ClustersClient.deleteClient).toHaveBeenCalledWith('stable-id');
            expect(CredentialCache.deleteCredentials).toHaveBeenCalledWith('stable-id');
        },
    );

    it.each([
        ['mongodb://other.example.com/', false],
        ['mongodb://cluster.mongocluster.cosmos.azure.com/', true],
    ] as const)(
        'passes current destination %s and policy into the first-open empty-method picker',
        async (connectionString, allowed): Promise<void> => {
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(makeConnection(connectionString));
            const item = makeItem();

            await expect(item.connect()).resolves.toMatchObject({ connectionCorrelationId: 'attempt' });

            expect(wizardCreated).toHaveBeenCalledWith(
                expect.objectContaining({
                    connectionString,
                    entraDestinationAllowed: allowed,
                }),
            );
            const items = showQuickPick.mock.calls[0][0] as Array<{
                authMethod?: AuthMethodId;
                entraUnavailable?: boolean;
            }>;
            expect(items.filter((entry) => entry.authMethod).map((entry) => entry.authMethod)).toEqual(
                allowed
                    ? [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID, AuthMethodId.NoAuth]
                    : [AuthMethodId.NativeAuth, AuthMethodId.NoAuth],
            );
            expect(items.some((entry) => entry.entraUnavailable)).toBe(!allowed);
            expect(CredentialCache.setAuthCredentials).toHaveBeenCalledWith(
                'stable-id',
                AuthMethodId.NoAuth,
                connectionString,
                undefined,
                undefined,
                undefined,
                undefined,
            );
        },
    );

    it.each(['false', 'rejection'])(
        'cleans up the original failed connection after browser %s',
        async (outcome): Promise<void> => {
            const connection = makeConnection('mongodb://other.example.com/', AuthMethodId.MicrosoftEntraID);
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);
            const error = new EntraDestinationRejectedError(
                evaluateEntraDestination(connection.secrets.connectionString),
            );
            vi.mocked(ClustersClient.connectInteractive).mockRejectedValue(error);
            showErrorMessage.mockResolvedValueOnce('Learn More');
            if (outcome === 'false') {
                vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
            } else {
                vi.mocked(vscode.env.openExternal).mockRejectedValueOnce(new Error('browser failed'));
            }
            vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(new Promise(() => {}));
            const item = makeItem();

            await expect(item.connect()).resolves.toBeNull();

            expect(vscode.window.showWarningMessage).toHaveBeenCalledExactlyOnceWith("We couldn't open this link.");
            expect(item.lastConnectionOutcome).toBe('failed');
            expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
            expect(ClustersClient.deleteClient).toHaveBeenCalledExactlyOnceWith('stable-id');
            expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith('stable-id');
            expect(vi.mocked(vscode.window.showErrorMessage).mock.invocationCallOrder[0]).toBeLessThan(
                vi.mocked(ClustersClient.deleteClient).mock.invocationCallOrder[0],
            );
            expect(vi.mocked(vscode.window.showWarningMessage).mock.invocationCallOrder[0]).toBeLessThan(
                vi.mocked(ClustersClient.deleteClient).mock.invocationCallOrder[0],
            );
        },
    );
});

describe('connect request telemetry', () => {
    beforeEach((): void => {
        vi.clearAllMocks();
        telemetryEvents.length = 0;
        vi.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(
            makeConnection('mongodb://localhost:27017/', AuthMethodId.NoAuth),
        );
    });

    const connectEvent = (): Record<string, string | undefined> | undefined =>
        telemetryEvents.find((event) => event.name === 'connect')?.properties;

    // The request returns no client after a failed connection, which the wrapper reports as
    // Succeeded; the outcome and the failed attempt's ID must be explicit.
    it('reports a failed connection with the ID of the attempt that failed', async (): Promise<void> => {
        vi.mocked(ClustersClient.connectInteractive).mockImplementation(async (_clusterId, _signal, onStartup) => {
            onStartup?.('failed-attempt');
            throw new Error('Authentication failed.');
        });

        await expect(makeItem().connect()).resolves.toBeNull();

        expect(connectEvent()).toMatchObject({ connectionResult: 'failed', connectionCorrelationId: 'failed-attempt' });
    });

    it('cancels the decoded-password retry without reporting another failure or clearing shared state', async (): Promise<void> => {
        const connection = makeConnection('mongodb://localhost:27017/', AuthMethodId.NativeAuth);
        connection.secrets.nativeAuthConfig = { connectionUser: 'test-user', connectionPassword: 'test%40password' };
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);
        const connectInteractive = vi.mocked(ClustersClient.connectInteractive);
        connectInteractive
            .mockRejectedValueOnce(new Error('Authentication failed.'))
            .mockRejectedValueOnce(new UserCancelledError());
        showErrorMessage.mockResolvedValueOnce('Try with decoded password');
        const item = makeItem();

        await expect(item.connect()).resolves.toBeNull();

        expect(connectInteractive).toHaveBeenCalledTimes(2);
        expect(showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            expect.any(String),
            expect.objectContaining({ modal: true }),
            'Try with decoded password',
        );
        const deleteClient = vi.mocked(ClustersClient.deleteClient);
        expect(deleteClient).toHaveBeenCalledExactlyOnceWith('stable-id');
        expect(deleteClient.mock.invocationCallOrder[0]).toBeLessThan(connectInteractive.mock.invocationCallOrder[1]);
        expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
        expect(item.lastConnectionOutcome).toBe('canceled');
        expect(connectEvent()).toMatchObject({
            result: 'Canceled',
            connectionResult: 'cancelled',
            urlDecodePasswordResult: 'cancelled',
        });
    });

    it('does not save the decoded password when the saved-credentials offer is dismissed', async (): Promise<void> => {
        const connection = makeConnection('mongodb://localhost:27017/', AuthMethodId.NativeAuth);
        connection.secrets.nativeAuthConfig = { connectionUser: 'test-user', connectionPassword: 'test%40password' };
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);
        vi.mocked(ClustersClient.connectInteractive)
            .mockRejectedValueOnce(new Error('Authentication failed.'))
            .mockResolvedValueOnce({ connectionCorrelationId: 'retry' } as ClustersClient);
        showErrorMessage.mockResolvedValueOnce('Try with decoded password');
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(undefined);

        await expect(makeItem().connect()).resolves.toMatchObject({ connectionCorrelationId: 'retry' });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            'Connected to "Saved connection" using the decoded password. Would you like to update your saved credentials with the correctly formatted password?',
            { modal: false },
            'Update saved password',
        );
        expect(ConnectionStorageService.save).not.toHaveBeenCalled();
    });

    it('reports a successful connection with its connection ID', async (): Promise<void> => {
        vi.mocked(ClustersClient.connectInteractive).mockResolvedValue({
            connectionCorrelationId: 'attempt',
        } as ClustersClient);

        await expect(makeItem().connect()).resolves.toMatchObject({ connectionCorrelationId: 'attempt' });

        expect(connectEvent()).toMatchObject({ connectionResult: 'success', connectionCorrelationId: 'attempt' });
    });

    it('does not drop startup settings for a transient connection error', async (): Promise<void> => {
        vi.mocked(ClustersClient.connectInteractive).mockRejectedValue(
            Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
        );
        await expect(makeItem().connect()).resolves.toBeNull();
        expect(ClustersClient.deleteClient).toHaveBeenCalledExactlyOnceWith('stable-id');
        expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
        expect(connectEvent()).toMatchObject({ connectionFailureKind: 'transient' });
    });
});

describe('DocumentDBClusterItem credential reachability', (): void => {
    const stored: ConnectionItem = {
        id: 'stable-id',
        name: 'Test connection',
        properties: {
            type: ItemType.Connection,
            api: API.DocumentDB,
            availableAuthMethods: [AuthMethodId.NoAuth],
            selectedAuthMethod: AuthMethodId.NoAuth,
        },
        secrets: { connectionString: 'mongodb://localhost:27017/db' },
    };

    beforeEach((): void => {
        vi.clearAllMocks();
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(stored);
        vi.mocked(ConnectionReachabilityService.ensureReachable).mockResolvedValue(undefined);
    });

    it('still ensures reachability by default for existing callers', async (): Promise<void> => {
        const credentials = await makeItem().getCredentials();
        expect(ConnectionStorageService.get).toHaveBeenCalledExactlyOnceWith('stable-id', StorageZone.Clusters);
        expect(ConnectionReachabilityService.ensureReachable).toHaveBeenCalledExactlyOnceWith(
            stored.properties,
            'stable-id',
        );
        expect(credentials).toMatchObject({
            connectionString: stored.secrets.connectionString,
            connectionProperties: stored.properties,
        });
    });

    it('can read stored credentials without preparing the endpoint', async (): Promise<void> => {
        const credentials = await makeItem().getCredentials({ ensureReachable: false });
        expect(credentials).toMatchObject({
            connectionString: stored.secrets.connectionString,
            connectionProperties: stored.properties,
        });
        expect(ConnectionReachabilityService.ensureReachable).not.toHaveBeenCalled();
    });
});
