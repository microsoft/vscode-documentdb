/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ConnectionUnavailableError } from '../../../documentdb/ConnectionUnavailableError';
import { DocumentViewMode } from '../../../documentdb/DocumentViewMode';
import { API } from '../../../DocumentDBExperiences';
import { createCallerFactory } from '../../_integration/trpc';
import { collectionsViewRouter, type RouterContext } from './collectionViewRouter';

const mocks = vi.hoisted(() => ({
    getBinding: vi.fn(),
    getEpoch: vi.fn(),
    assertCurrent: vi.fn(),
    runFindQueryWithCache: vi.fn(),
    findCollection: vi.fn(),
    updateGlobalState: vi.fn(),
}));

vi.mock('../../../documentdb/ClusterSession', () => ({
    ClusterSession: {
        getSession: () => ({
            getBinding: mocks.getBinding,
            getEpoch: mocks.getEpoch,
            assertCurrent: mocks.assertCurrent,
            runFindQueryWithCache: mocks.runFindQueryWithCache,
        }),
    },
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: { globalState: { update: mocks.updateGlobalState } },
        connectionsBranchDataProvider: { findCollectionByClusterId: mocks.findCollection },
        discoveryBranchDataProvider: { findCollectionByClusterId: vi.fn() },
        azureResourcesVCoreBranchDataProvider: { findCollectionByClusterId: vi.fn() },
        azureResourcesRUBranchDataProvider: { findCollectionByClusterId: vi.fn() },
        outputChannel: { appendLog: vi.fn(), error: vi.fn(), trace: vi.fn(), warn: vi.fn() },
    },
}));
vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const { createCallerFactory, publicProcedure, router, mergeRouters } = initWebviewTrpc();
    return {
        createCallerFactory,
        mergeRouters,
        publicProcedure,
        publicProcedureWithTelemetry: publicProcedure,
        router,
    };
});

const binding = { clusterId: 'cluster', fingerprint: 'host-only-fingerprint', generation: 1 };
const describeUnavailable = vi.fn((reason: ConnectionUnavailableError['reason']) => ({
    unavailable: { reason, title: 'Connection unavailable', detail: 'Close this view.', action: 'close' as const },
}));
const callCollectionView = createCallerFactory(collectionsViewRouter);

function createCaller(): ReturnType<typeof callCollectionView> {
    const context: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'collectionView',
        sessionId: 'session',
        clusterId: binding.clusterId,
        clusterDisplayName: 'Cluster',
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        describeUnavailable,
        recoverUnavailable: vi.fn(),
    };
    return callCollectionView(context);
}

beforeEach((): void => {
    vi.resetAllMocks();
    describeUnavailable.mockImplementation((reason: ConnectionUnavailableError['reason']) => ({
        unavailable: { reason, title: 'Connection unavailable', detail: 'Close this view.', action: 'close' as const },
    }));
    mocks.getBinding.mockReturnValue(binding);
    mocks.getEpoch.mockReturnValue(1);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
});

it('returns structured unavailability from a Collection View query', async (): Promise<void> => {
    mocks.runFindQueryWithCache.mockRejectedValueOnce(new ConnectionUnavailableError('credentialsRejected'));

    await expect(
        createCaller().runFindQuery({
            filter: '{}',
            pageNumber: 1,
            pageSize: 50,
            executionIntent: 'initial',
        }),
    ).resolves.toEqual({
        unavailable: {
            reason: 'credentialsRejected',
            title: 'Connection unavailable',
            detail: 'Close this view.',
            action: 'close',
        },
    });
    expect(mocks.runFindQueryWithCache).toHaveBeenCalledOnce();
});

it('persists the selected document view without resolving a connection', async (): Promise<void> => {
    await createCaller().setCollectionDocumentView(DocumentViewMode.TREE);

    expect(mocks.updateGlobalState).toHaveBeenCalledWith(expect.any(String), DocumentViewMode.TREE);
    expect(mocks.getBinding).not.toHaveBeenCalled();
});

it('captures the transfer binding before asynchronous collection lookup', async (): Promise<void> => {
    let releaseLookup: ((node: unknown) => void) | undefined;
    mocks.findCollection.mockReturnValueOnce(
        new Promise<unknown>((resolve) => {
            releaseLookup = resolve;
        }),
    );
    const request = createCaller().exportDocuments({ filter: '{}' });
    await vi.waitFor(() => expect(mocks.findCollection).toHaveBeenCalledOnce());
    mocks.getBinding.mockReturnValue({ ...binding, fingerprint: 'identity-b', generation: 2 });
    releaseLookup?.({ id: 'collection-node' });
    await request;

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode-documentdb.command.internal.exportDocuments',
        { id: 'collection-node' },
        {
            queryParams: {
                filter: '{}',
                project: undefined,
                sort: undefined,
                skip: undefined,
                limit: undefined,
            },
            source: 'webview;collectionView',
            binding,
        },
    );
});
