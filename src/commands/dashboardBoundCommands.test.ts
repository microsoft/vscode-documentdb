/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzExtInputBoxOptions, type IActionContext } from '@microsoft/vscode-azext-utils';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../documentdb/auth/AuthMethodId';
import { ClustersClient, type ConnectionBinding } from '../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../documentdb/CredentialCache';
import { DocumentDBExperience } from '../DocumentDBExperiences';
import { type ClusterItemBase } from '../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../tree/documentdb/DatabaseItem';
import { getConfirmationAsInSettings } from '../utils/dialogs/getConfirmation';
import { createCollection } from './createCollection/createCollection';
import { createDatabase } from './createDatabase/createDatabase';
import { deleteCollection } from './deleteCollection/deleteCollection';
import { deleteAzureDatabase } from './deleteDatabase/deleteDatabase';
import { exportEntireCollection } from './exportDocuments/exportDocuments';

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    AzureWizard: class {
        constructor(
            private readonly context: IActionContext,
            private readonly options: {
                promptSteps: { prompt: (context: IActionContext) => Promise<void> }[];
                executeSteps: { execute: (context: IActionContext) => Promise<void> }[];
            },
        ) {}

        async prompt(): Promise<void> {
            await this.options.promptSteps[0].prompt(this.context);
        }

        async execute(): Promise<void> {
            await this.options.executeSteps[0].execute(this.context);
        }
    },
}));
vi.mock('../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), resolveBoundClient: vi.fn(), reportFailure: vi.fn() },
}));
vi.mock('../documentdb/CredentialCache', () => ({
    CredentialCache: { getCredentials: vi.fn(), hasCredentials: vi.fn(() => true) },
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: { error: vi.fn() },
        state: {
            showDeleting: async (_id: string, callback: () => Promise<void>) => callback(),
            showCreatingChild: async (_id: string, _message: string, callback: () => Promise<void>) => callback(),
            notifyChildrenChanged: vi.fn(),
        },
    },
}));
vi.mock('../services/taskService/resourceUsageHelper', () => ({ checkCanProceedAndInformUser: vi.fn(() => true) }));
vi.mock('../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: vi.fn() }));
vi.mock('../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('../utils/workspacUtils', () => ({ getRootPath: vi.fn() }));

const binding: ConnectionBinding = { clusterId: 'cluster', fingerprint: 'original', generation: 1 };
const cluster = { clusterId: 'cluster', name: 'Cluster', viewId: 'connectionsView' };
const clusterNode = { id: 'cluster', experience: DocumentDBExperience, cluster } as ClusterItemBase;
const database = {
    id: 'cluster/database',
    experience: DocumentDBExperience,
    cluster,
    databaseInfo: { name: 'database' },
} as DatabaseItem;
const collection = {
    ...database,
    id: 'cluster/database/collection',
    collectionInfo: { name: 'collection' },
} as CollectionItem;
const replacement = {
    dropDatabase: vi.fn(),
    dropCollection: vi.fn(),
    streamDocumentsWithQuery: vi.fn(),
    listDatabases: vi.fn(),
    listCollections: vi.fn(),
    createDatabase: vi.fn(),
    createCollection: vi.fn(),
};

function createContext(showInputBox = vi.fn()): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
        ui: { showInputBox },
    } as unknown as IActionContext;
}

function changeIdentity(): void {
    vi.mocked(ClustersClient.resolveBoundClient).mockRejectedValue(new ConnectionUnavailableError('identityChanged'));
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(ClustersClient.getClient).mockResolvedValue(replacement as unknown as ClustersClient);
});

it.each([
    ['database', (context: IActionContext) => deleteAzureDatabase(context, database, undefined, { binding })],
    ['collection', (context: IActionContext) => deleteCollection(context, collection, undefined, { binding })],
] as const)('does not drop a %s after the connection identity changes during confirmation', async (_name, drop) => {
    vi.mocked(getConfirmationAsInSettings).mockImplementationOnce(async () => {
        changeIdentity();
        return true;
    });
    const context = createContext();

    await expect(drop(context)).rejects.toMatchObject({ reason: 'credentialsChanged' });

    expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, undefined);
    expect(context.errorHandling).toMatchObject({ rethrow: true, suppressDisplay: true });
    expect(ClustersClient.getClient).not.toHaveBeenCalled();
    expect(replacement.dropDatabase).not.toHaveBeenCalled();
    expect(replacement.dropCollection).not.toHaveBeenCalled();
});

it('does not export with a different connection after the save dialog', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockImplementationOnce(async () => {
        changeIdentity();
        return vscode.Uri.file('/fixture/export.json');
    });
    const context = createContext();

    await expect(exportEntireCollection(context, collection, undefined, { binding })).rejects.toMatchObject({
        reason: 'credentialsChanged',
    });

    expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, undefined);
    expect(context.errorHandling).toMatchObject({ rethrow: true, suppressDisplay: true });
    expect(ClustersClient.getClient).not.toHaveBeenCalled();
    expect(replacement.streamDocumentsWithQuery).not.toHaveBeenCalled();
});

it('reports a rejected export startup as unavailable', async () => {
    vi.mocked(CredentialCache.getCredentials).mockReturnValueOnce({
        clusterId: binding.clusterId,
        authMechanism: AuthMethodId.NativeAuth,
        connectionString: 'mongodb://localhost/',
        connectionStringWithPassword: 'mongodb://localhost/',
    });
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/fixture/export.json'));
    vi.mocked(ClustersClient.resolveBoundClient).mockRejectedValue(
        new MongoServerError({ code: 18, errmsg: 'Authentication failed' }),
    );

    await expect(exportEntireCollection(createContext(), collection, undefined, { binding })).rejects.toMatchObject({
        reason: 'credentialsRejected',
    });
    expect(replacement.streamDocumentsWithQuery).not.toHaveBeenCalled();
});

it.each([
    ['database', (context: IActionContext) => createDatabase(context, clusterNode, undefined, { binding })],
    ['collection', (context: IActionContext) => createCollection(context, database, undefined, { binding })],
] as const)(
    'surfaces unavailable, not a %s name error, when the bound validation read fails',
    async (_name, create) => {
        const listNames = vi.fn(async () => {
            throw new MongoNetworkError('fixture connection lost');
        });
        vi.mocked(ClustersClient.resolveBoundClient).mockResolvedValue({
            binding,
            listDatabases: listNames,
            listCollections: listNames,
        } as unknown as ClustersClient);
        const context = createContext(
            vi.fn(async ({ asyncValidationTask }: AzExtInputBoxOptions) => {
                try {
                    await asyncValidationTask?.('newName');
                } catch (error) {
                    // The Azure input box wraps the error and closes instead of showing a validation message.
                    throw new Error('fixture validation failure', { cause: error });
                }
                return 'newName';
            }),
        );

        await expect(create(context)).rejects.toMatchObject({ reason: 'unreachable' });

        expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, {
            trigger: 'clusterDashboard',
        });
        expect(listNames).toHaveBeenCalledOnce();
        expect(context.errorHandling).toMatchObject({ rethrow: true, suppressDisplay: true });
        expect(ClustersClient.getClient).not.toHaveBeenCalled();
    },
);

it('resolves the original binding again immediately before creating a collection', async () => {
    vi.mocked(ClustersClient.resolveBoundClient).mockResolvedValueOnce({
        binding,
        listCollections: vi.fn(async () => []),
    } as unknown as ClustersClient);
    const context = createContext(
        vi.fn(async ({ asyncValidationTask }: AzExtInputBoxOptions) => {
            expect(await asyncValidationTask?.('newName')).toBeUndefined();
            return 'newName';
        }),
    );

    await expect(
        createCollection(context, database, undefined, { binding, onNameResolved: async () => changeIdentity() }),
    ).rejects.toMatchObject({ reason: 'identityChanged' });

    expect(ClustersClient.resolveBoundClient).toHaveBeenCalledTimes(2);
    expect(ClustersClient.getClient).not.toHaveBeenCalled();
    expect(replacement.createCollection).not.toHaveBeenCalled();
});
