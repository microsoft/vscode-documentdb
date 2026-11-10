/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
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
import { ConnectionStorageService, ItemType, StorageZone, type ConnectionItem } from '../../services/connectionStorageService';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';

const { prompt, wizardCreated, showQuickPick } = vi.hoisted(() => ({
    prompt: vi.fn<(context: AuthenticateWizardContext) => Promise<void>>(),
    wizardCreated: vi.fn(),
    showQuickPick: vi.fn(),
}));

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
        _name: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
            ui: { showQuickPick },
        } as unknown as IActionContext;
        try {
            return await callback(context);
        } catch {
            return undefined;
        }
    },
}));
vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: vi.fn(), save: vi.fn() },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), deleteClient: vi.fn(), exists: vi.fn() },
}));
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: vi.fn(), setAuthCredentials: vi.fn(), deleteCredentials: vi.fn() },
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
        vi.mocked(ClustersClient.getClient).mockResolvedValue({ connectionCorrelationId: 'attempt' } as ClustersClient);
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
            vi.mocked(ClustersClient.getClient).mockRejectedValue(
                new EntraDestinationRejectedError(evaluateEntraDestination(connection.secrets.connectionString)),
            );
            const item = makeItem();

            await expect(item.connect()).resolves.toBeNull();

            expect(wizardCreated).not.toHaveBeenCalled();
            expect(prompt).not.toHaveBeenCalled();
            expect(showQuickPick).not.toHaveBeenCalled();
            expect(ClustersClient.getClient).toHaveBeenCalledTimes(1);
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
