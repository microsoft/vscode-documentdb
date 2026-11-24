/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClustersClient, type ConnectionBinding } from '../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { importDocuments } from './importDocuments';

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), resolveBoundClient: vi.fn() },
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

it('does not import using a different identity selected while the file picker was open', async (): Promise<void> => {
    const binding: ConnectionBinding = { clusterId: 'cluster', fingerprint: 'original', generation: 1 };
    const insertDocuments = vi.fn();
    const replacement = { insertDocuments, getConnectionString: () => 'mongodb://example.test' };
    vi.mocked(ClustersClient.getClient).mockResolvedValue(replacement as unknown as ClustersClient);

    const source = new CollectionItem(
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
    const showOpenDialog = vi.fn(async () => {
        vi.mocked(ClustersClient.resolveBoundClient).mockRejectedValueOnce(
            new ConnectionUnavailableError('identityChanged'),
        );
        return [vscode.Uri.file('/fixture/documents.json')];
    });
    const context: IActionContext = {
        ui: { showOpenDialog },
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
    } as unknown as IActionContext;
    vi.mocked(vscode.window.withProgress).mockImplementationOnce((_options, task) =>
        task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
    );

    await expect(importDocuments(context, source, undefined, { binding })).rejects.toMatchObject({
        reason: 'credentialsChanged',
    });
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, undefined);
    expect(ClustersClient.getClient).not.toHaveBeenCalled();
    expect(insertDocuments).not.toHaveBeenCalled();
});
