/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { readFile } from 'node:fs/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClustersClient, type ConnectionBinding } from '../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { TaskService } from '../../services/taskService/taskService';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { exportQueryResults } from '../exportDocuments/exportDocuments';
import { importDocuments } from './importDocuments';

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), getLatchReason: vi.fn(), resolveBoundClient: vi.fn(), reportFailure: vi.fn() },
    isBulkWriteError: vi.fn(() => false),
}));
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn(async () => '[{"name":"new document"}]'),
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { info: vi.fn(), trace: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() },
        state: {
            runWithTemporaryDescription: async (_id: string, _description: string, task: () => Promise<void>) => task(),
            notifyChildrenChanged: vi.fn(),
        },
    },
}));
vi.mock('../../utils/workspacUtils', () => ({ getRootPath: vi.fn() }));
vi.mock('../../utils/fs/appendToFile', () => ({ appendToFile: vi.fn() }));

const binding: ConnectionBinding = { clusterId: 'cluster', fingerprint: 'original', generation: 1 };

function createSource(): CollectionItem {
    return new CollectionItem(
        {
            clusterId: 'cluster',
            treeId: 'folder/cluster',
            viewId: 'connectionsView',
            name: 'Cluster',
            dbExperience: DocumentDBExperience,
        },
        { name: 'database' },
        { name: 'collection' },
    );
}

function createContext(showOpenDialog: () => Promise<vscode.Uri[]> = async () => []): IActionContext {
    return {
        ui: { showOpenDialog },
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
    } as unknown as IActionContext;
}
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ClustersClient.getClient).mockReset();
    vi.mocked(ClustersClient.resolveBoundClient).mockReset();
    vi.mocked(ClustersClient.getLatchReason).mockReset().mockReturnValue(undefined);
    vi.mocked(vscode.window.withProgress).mockImplementation((_options, task) =>
        task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
    );
    vi.mocked(vscode.window.showSaveDialog).mockReset();
});

it('does not import using a different identity selected while the file picker was open', async (): Promise<void> => {
    const insertDocuments = vi.fn();
    const replacement = { insertDocuments, getConnectionString: () => 'mongodb://example.test' };
    vi.mocked(ClustersClient.getClient).mockResolvedValue(replacement as unknown as ClustersClient);
    const showOpenDialog = vi.fn(async () => {
        vi.mocked(ClustersClient.resolveBoundClient).mockRejectedValueOnce(
            new ConnectionUnavailableError('identityChanged'),
        );
        return [vscode.Uri.file('/fixture/documents.json')];
    });
    await expect(
        importDocuments(createContext(showOpenDialog), createSource(), undefined, { binding }),
    ).rejects.toMatchObject({ reason: 'credentialsChanged' });
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, undefined);
    expect(ClustersClient.getClient).not.toHaveBeenCalled();
    expect(insertDocuments).not.toHaveBeenCalled();
});

it('holds an import lease through client resolution and the final flush', async (): Promise<void> => {
    let resolveClient!: (client: ClustersClient) => void;
    const clientResolution = new Promise<ClustersClient>((resolve) => {
        resolveClient = resolve;
    });
    let resolveInsert!: (result: { insertedCount: number }) => void;
    const insertDocuments = vi.fn(
        () =>
            new Promise<{ insertedCount: number }>((resolve) => {
                resolveInsert = resolve;
            }),
    );
    vi.mocked(ClustersClient.getClient).mockReturnValue(clientResolution);

    const importOperation = importDocuments(createContext(), createSource(), [
        vscode.Uri.file('/fixture/documents.json'),
    ]);

    await vi.waitFor(() => {
        expect(ClustersClient.getClient).toHaveBeenCalledWith('cluster');
    });

    expect(TaskService.getConflictingTasks({ clusterId: 'cluster' })).toEqual([
        expect.objectContaining({ taskName: 'Import documents' }),
    ]);
    expect(
        TaskService.getConflictingTasks({
            clusterId: 'cluster',
            databaseName: 'database',
            collectionName: 'collection',
        }),
    ).toHaveLength(1);
    expect(TaskService.getConflictingTasks({ clusterId: 'unrelated' })).toEqual([]);

    resolveClient({
        getConnectionString: () => 'mongodb://example.test',
        insertDocuments,
    } as unknown as ClustersClient);
    await vi.waitFor(() => {
        expect(insertDocuments).toHaveBeenCalledOnce();
    });
    expect(TaskService.getConflictingTasks({ clusterId: 'cluster' })).toHaveLength(1);

    resolveInsert({ insertedCount: 1 });
    await importOperation;
    expect(TaskService.getConflictingTasks({ clusterId: 'cluster' })).toEqual([]);
});

it('holds an export lease before client resolution and releases it on failure', async (): Promise<void> => {
    let rejectClient!: (error: Error) => void;
    const clientResolution = new Promise<ClustersClient>((_resolve, reject) => {
        rejectClient = reject;
    });
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/fixture/export.json'));
    vi.mocked(ClustersClient.getClient).mockReturnValue(clientResolution);

    const exportOperation = exportQueryResults(createContext(), createSource());

    await vi.waitFor(() => {
        expect(ClustersClient.getClient).toHaveBeenCalledWith('cluster');
    });

    expect(TaskService.getConflictingTasks({ clusterId: 'cluster' })).toEqual([
        expect.objectContaining({ taskName: 'Export documents' }),
    ]);
    expect(
        TaskService.getConflictingTasks({
            clusterId: 'cluster',
            databaseName: 'database',
            collectionName: 'collection',
        }),
    ).toHaveLength(1);
    expect(TaskService.getConflictingTasks({ clusterId: 'unrelated' })).toEqual([]);

    rejectClient(new Error('client resolution failed'));
    await expect(exportOperation).rejects.toThrow('client resolution failed');
    expect(TaskService.getConflictingTasks({ clusterId: 'cluster' })).toEqual([]);
});

it('stops a bound import after rejection and reports only confirmed inserts', async (): Promise<void> => {
    const failure = new Error('Rejected fixture credentials');
    const insertDocuments = vi.fn().mockResolvedValueOnce({ insertedCount: 1 }).mockRejectedValueOnce(failure);
    const client = {
        binding: { ...binding, generation: 2 },
        insertDocuments,
        getConnectionString: () => 'mongodb://fixture.mongo.cosmos.azure.com',
    };
    vi.mocked(readFile).mockResolvedValueOnce('[{"n":1},{"n":2},{"n":3},{"n":4}]');
    vi.mocked(ClustersClient.resolveBoundClient).mockResolvedValueOnce(client as unknown as ClustersClient);
    vi.mocked(ClustersClient.reportFailure).mockReturnValueOnce('credentialsRejected');
    const context = createContext(async () => [vscode.Uri.file('/fixture/documents.json')]);

    await expect(importDocuments(context, createSource(), undefined, { binding })).rejects.toMatchObject({
        reason: 'credentialsRejected',
    });
    expect(insertDocuments).toHaveBeenCalledTimes(2);
    expect(ClustersClient.reportFailure).toHaveBeenCalledExactlyOnceWith(client.binding, failure);
    expect(ext.outputChannel.warn).toHaveBeenCalledWith('Inserted 1 document(s).');
    expect(TaskService.getConflictingTasks({ clusterId: binding.clusterId })).toEqual([]);
});
