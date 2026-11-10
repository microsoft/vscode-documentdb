/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API } from '../../DocumentDBExperiences';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import type * as storageModule from '../../services/connectionStorageService';
import {
    ConnectionStorageService,
    ConnectionType,
    ItemType,
    type ConnectionItem,
} from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { ExecuteStep } from './ExecuteStep';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: vi.fn(), save: vi.fn() },
}));
vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { error: vi.fn() } },
}));
vi.mock('../../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));

const approved = 'mongodb://old.mongocluster.cosmos.azure.com/';
const approvedMethods = [
    AuthMethodId.NativeAuth,
    AuthMethodId.MicrosoftEntraID,
    AuthMethodId.ManagedIdentity,
    AuthMethodId.NoAuth,
];

function makeConnection(selectedAuthMethod?: AuthMethodId): ConnectionItem {
    return {
        id: 'stable-id',
        name: 'Saved connection',
        properties: { type: ItemType.Connection, api: API.DocumentDB, availableAuthMethods: [], selectedAuthMethod },
        secrets: {
            connectionString: approved,
            nativeAuthConfig: { connectionUser: 'user', connectionPassword: 'password' },
            managedIdentityAuthConfig: {},
            entraIdAuthConfig: { tenantId: 'tenant', subscriptionId: 'subscription' },
        },
    };
}

function makeContext(newConnectionString: string): UpdateCSWizardContext {
    return {
        storageId: 'stable-id',
        storageZone: ConnectionType.Clusters,
        isEmulator: false,
        originalConnectionString: approved,
        newConnectionString,
        connectionStringSaved: false,
    } as UpdateCSWizardContext;
}

describe('updateConnectionString destination policy', () => {
    beforeEach((): void => {
        vi.clearAllMocks();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration);
        vi.mocked(ConnectionStorageService.save).mockResolvedValue(undefined);
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'saves a rejected destination, clears selected %s, and explains the next connection',
        async (method): Promise<void> => {
            const connection = makeConnection(method);
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);

            await new ExecuteStep().execute(makeContext('mongodb://other.example.com/'));

            expect(ConnectionStorageService.save).toHaveBeenCalledExactlyOnceWith(
                ConnectionType.Clusters,
                connection,
                true,
            );
            expect(connection.secrets.connectionString).toBe('mongodb://other.example.com/');
            expect(connection.properties.selectedAuthMethod).toBeUndefined();
            expect(connection.properties.availableAuthMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
            expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
                "Connection updated. Microsoft Entra ID isn't available for the new server, so choose another method when you connect.",
            );
            expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
            expect(connection.secrets.managedIdentityAuthConfig).toEqual({});
        },
    );

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'retains %s between approved destinations and uses the usual confirmation',
        async (method): Promise<void> => {
            const connection = makeConnection(method);
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);

            await new ExecuteStep().execute(makeContext('mongodb://new.mongocluster.cosmos.azure.us/'));

            expect(connection.properties.selectedAuthMethod).toBe(method);
            expect(connection.properties.availableAuthMethods).toEqual(approvedMethods);
            expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith('Connection updated successfully.');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        },
    );

    it.each([AuthMethodId.NativeAuth, AuthMethodId.NoAuth, undefined])(
        'recomputes rejected-host methods without changing the existing %s selection',
        async (method): Promise<void> => {
            const connection = makeConnection(method);
            connection.properties.availableAuthMethods = approvedMethods;
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);

            await new ExecuteStep().execute(makeContext('mongodb://other.example.com/'));

            expect(connection.properties.selectedAuthMethod).toBe(method);
            expect(connection.properties.availableAuthMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
            expect(connection.secrets.nativeAuthConfig).toEqual({
                connectionUser: 'user',
                connectionPassword: 'password',
            });
            expect(showConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith('Connection updated successfully.');
        },
    );

    it('recomputes methods from the new host even when the previous methods were empty', async (): Promise<void> => {
        const connection = makeConnection(AuthMethodId.NativeAuth);
        connection.secrets.connectionString = 'mongodb://other.example.com/';
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);

        await new ExecuteStep().execute(makeContext(approved));

        expect(connection.properties.availableAuthMethods).toEqual(approvedMethods);
        expect(connection.properties.selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
    });

    it('uses the existing machine custom suffix when recomputing the new destination', async (): Promise<void> => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn().mockReturnValue({ globalValue: { hostnameSuffix: 'trusted.example.com' } }),
        } as unknown as vscode.WorkspaceConfiguration);
        const connection = makeConnection(AuthMethodId.MicrosoftEntraID);
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);

        await new ExecuteStep().execute(makeContext('mongodb://new.trusted.example.com/'));

        expect(connection.properties.availableAuthMethods).toEqual(approvedMethods);
        expect(connection.properties.selectedAuthMethod).toBe(AuthMethodId.MicrosoftEntraID);
    });

    it('marks the string saved only after storage succeeds', async (): Promise<void> => {
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(makeConnection(AuthMethodId.ManagedIdentity));
        let finishSave!: () => void;
        vi.mocked(ConnectionStorageService.save).mockReturnValue(
            new Promise<void>((resolve) => {
                finishSave = resolve;
            }),
        );
        const context = makeContext('mongodb://new.mongocluster.cosmos.azure.com/');
        const pending = new ExecuteStep().execute(context);
        await vi.waitFor(() => expect(ConnectionStorageService.save).toHaveBeenCalledOnce());
        expect(context.connectionStringSaved).toBe(false);

        finishSave();
        await pending;

        expect(context.connectionStringSaved).toBe(true);
    });

    it.each(['missing connection', 'missing string'])(
        'does not mark the string saved for %s',
        async (missing): Promise<void> => {
            const connection = makeConnection();
            connection.secrets.connectionString = '';
            vi.mocked(ConnectionStorageService.get).mockResolvedValue(
                missing === 'missing connection' ? undefined : connection,
            );
            const context = makeContext('mongodb://new.mongocluster.cosmos.azure.com/');

            await new ExecuteStep().execute(context);

            expect(context.connectionStringSaved).toBe(false);
            expect(ConnectionStorageService.save).not.toHaveBeenCalled();
        },
    );

    it('does not mark the string saved when storage fails', async (): Promise<void> => {
        vi.mocked(ConnectionStorageService.get).mockResolvedValue(makeConnection());
        vi.mocked(ConnectionStorageService.save).mockRejectedValue(new Error('save failed'));
        const context = makeContext('mongodb://new.mongocluster.cosmos.azure.com/');

        await expect(new ExecuteStep().execute(context)).resolves.toBeUndefined();

        expect(context.connectionStringSaved).toBe(false);
        expect(ConnectionStorageService.save).toHaveBeenCalledOnce();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Failed to update the connection.');
    });

    it.each(['', approved])('does not execute or mark an unchanged string saved: %s', (value): void => {
        const context = makeContext(value);

        expect(new ExecuteStep().shouldExecute(context)).toBe(false);
        expect(context.connectionStringSaved).toBe(false);
        expect(ConnectionStorageService.save).not.toHaveBeenCalled();
    });
});
