/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as wizardUtils from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { SelectEntraTokenSourceStep } from '../../documentdb/wizards/authenticate/SelectEntraTokenSourceStep';
import { API } from '../../DocumentDBExperiences';
import type * as storageModule from '../../services/connectionStorageService';
import { ItemType } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { updateCredentials } from './updateCredentials';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

const capturedContexts: UpdateCredentialsWizardContext[] = [];
const mockGet = vi.fn();
const mockDeleteClient = vi.fn();
const mockDeleteCredentials = vi.fn();

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof wizardUtils>()),
    AzureWizard: class {
        constructor(context: UpdateCredentialsWizardContext) {
            capturedContexts.push(context);
        }
        public prompt(): Promise<void> {
            return Promise.resolve();
        }
        public execute(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: (...args: unknown[]): unknown => mockGet(...args) },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { deleteClient: (...args: unknown[]): unknown => mockDeleteClient(...args) },
}));
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { deleteCredentials: (...args: unknown[]): unknown => mockDeleteCredentials(...args) },
}));
vi.mock('../refreshView/refreshView', () => ({ refreshView: vi.fn() }));
vi.mock('../../extensionVariables', () => ({
    ext: { connectionsBranchDataProvider: { hasNodeErrorState: vi.fn(() => false) } },
}));

beforeEach(() => {
    vi.clearAllMocks();
    capturedContexts.length = 0;
});

async function inferMethods(
    host: string,
    suffix?: string,
    storedMethods: AuthMethodId[] = [AuthMethodId.NativeAuth, AuthMethodId.NoAuth],
): Promise<UpdateCredentialsWizardContext> {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue({ mongoClusterHostnameSuffix: suffix }),
    } as unknown as vscode.WorkspaceConfiguration);
    mockGet.mockResolvedValue({
        id: 'stable-cluster-id',
        name: 'cluster',
        properties: {
            type: ItemType.Connection,
            api: API.DocumentDB,
            availableAuthMethods: storedMethods,
            selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
        },
        secrets: { connectionString: `mongodb://${host}:10255/` },
    });
    const context = {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
    } as unknown as IActionContext;
    const node = {
        id: 'folder/current-tree-path',
        storageId: 'stable-cluster-id',
        cluster: { clusterId: 'stable-cluster-id', treeId: 'folder/current-tree-path' },
    } as unknown as DocumentDBClusterItem;
    await updateCredentials(context, node);
    expect(mockDeleteClient).toHaveBeenCalledWith('stable-cluster-id');
    expect(mockDeleteCredentials).toHaveBeenCalledWith('stable-cluster-id');
    const captured = capturedContexts[0];
    if (!captured) {
        throw new Error('Update Credentials did not construct its wizard');
    }
    return captured;
}

describe('updateCredentials host inference', () => {
    it.each(['com', 'us', 'cn'])('offers managed identity for azure.%s DocumentDB hosts', async (tld) => {
        const context = await inferMethods(`CLUSTER.global.mongocluster.cosmos.azure.${tld}`);
        expect(context.availableAuthenticationMethods).toEqual([
            AuthMethodId.NativeAuth,
            AuthMethodId.NoAuth,
            AuthMethodId.MicrosoftEntraID,
            AuthMethodId.ManagedIdentity,
        ]);
        const sourceStep = new SelectEntraTokenSourceStep<UpdateCredentialsWizardContext>(
            (wizardContext) => wizardContext.selectedAuthenticationMethod,
            (wizardContext, method) => {
                wizardContext.selectedAuthenticationMethod = method;
            },
        );
        expect(sourceStep.shouldPrompt(context)).toBe(true);
    });

    it('recognizes a configured service suffix without duplicating existing methods', async () => {
        const methods = [
            AuthMethodId.NativeAuth,
            AuthMethodId.NoAuth,
            AuthMethodId.MicrosoftEntraID,
            AuthMethodId.ManagedIdentity,
        ];
        const context = await inferMethods('cluster.database.example.com', ' .DATABASE.EXAMPLE.COM ', methods);
        expect(context.availableAuthenticationMethods).toEqual(methods);
    });

    it.each([
        ['cluster.mongocluster.cosmos.azure.us.evil.com', undefined],
        ['xmongocluster.cosmos.azure.com', undefined],
        ['cluster.mongo.cosmos.azure.com', undefined],
        ['notdatabase.example.com', '.database.example.com'],
        ['cluster.database.example.com.evil.com', '.database.example.com'],
        ['attacker.com.cn', '.com.cn'],
    ])('does not add Entra methods for lookalike, RU, or rejected custom host %s', async (host, suffix) => {
        const context = await inferMethods(host, suffix);
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
    });
});
