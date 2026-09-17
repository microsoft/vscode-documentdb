/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { DocumentDbCollectionIndexCopier } from './DocumentDbCollectionIndexCopier';

jest.mock('../../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: { trace: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    },
}));

jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: string[]): string =>
            args.reduce((result, value, index) => result.replace(`{${index}}`, value), message),
    },
}));

interface MockIndex {
    key: Record<string, number | string>;
    name: string;
    v?: number;
    unique?: boolean;
    expireAfterSeconds?: number;
    background?: boolean;
    hidden?: boolean;
    cosmosSearchOptions?: Record<string, unknown>;
}

function createClient(
    indexes: MockIndex[],
    createIndex: jest.Mock = jest.fn(),
    hideIndex: jest.Mock = jest.fn(),
): ClustersClient {
    return {
        getCollection: jest.fn().mockReturnValue({
            indexes: jest.fn().mockResolvedValue(indexes),
        }),
        createIndex,
        hideIndex,
    } as unknown as ClustersClient;
}

const source = { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' };
const target = { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' };

function createCopier(
    sourceClient: ClustersClient,
    targetClient: ClustersClient = createClient([]),
): DocumentDbCollectionIndexCopier {
    jest.mocked(ClustersClient.getClient).mockImplementation(async (clusterId) =>
        clusterId === source.clusterId ? sourceClient : targetClient,
    );
    return new DocumentDbCollectionIndexCopier(source, target);
}

describe('DocumentDbCollectionIndexCopier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('summarizes copyable source indexes and their document-affecting options', async () => {
        const indexes = jest.fn().mockResolvedValue([
            { key: { _id: 1 }, name: '_id_' },
            { key: { email: 1 }, name: 'email_1', unique: true },
            { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 },
        ]);
        const sourceClient = {
            getCollection: jest.fn().mockReturnValue({ indexes }),
        } as unknown as ClustersClient;
        const copier = createCopier(sourceClient);
        const signal = new AbortController().signal;

        const summary = await copier.getSourceIndexSummary(signal);

        expect(summary).toEqual({
            count: 2,
            uniqueIndexNames: ['email_1'],
            ttlIndexNames: ['expiresAt_1'],
        });
        expect(ClustersClient.getClient).toHaveBeenCalledWith('source', signal);
        expect(ClustersClient.getClient).not.toHaveBeenCalledWith('target');
        expect(indexes).toHaveBeenCalledWith();
    });

    it('stops waiting for source indexes when counting is cancelled', async () => {
        const controller = new AbortController();
        const indexes = jest.fn().mockReturnValue(new Promise(() => undefined));
        const sourceClient = {
            getCollection: jest.fn().mockReturnValue({ indexes }),
        } as unknown as ClustersClient;
        const copier = createCopier(sourceClient);
        const countPromise = copier.getSourceIndexSummary(controller.signal);

        controller.abort();

        await expect(countPromise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it.each(['source', 'target'] as const)('stops waiting for %s indexes when copying is cancelled', async (side) => {
        const controller = new AbortController();
        const pendingIndexes = jest.fn().mockReturnValue(new Promise(() => undefined));
        const pendingClient = {
            getCollection: jest.fn().mockReturnValue({ indexes: pendingIndexes }),
        } as unknown as ClustersClient;
        const sourceClient = side === 'source' ? pendingClient : createClient([]);
        const targetClient = side === 'target' ? pendingClient : createClient([]);
        const copier = createCopier(sourceClient, targetClient);
        const copyPromise = copier.copyIndexes({ signal: controller.signal });

        expect(ClustersClient.getClient).toHaveBeenCalledWith('source', controller.signal);
        expect(ClustersClient.getClient).toHaveBeenCalledWith('target', controller.signal);

        controller.abort();

        await expect(copyPromise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('skips equivalent definitions even when names differ', async () => {
        const createIndex = jest.fn();
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'source_name', v: 2, unique: true }]),
            createClient([{ key: { email: 1 }, name: 'target_name', v: 1, unique: true }], createIndex),
        );

        await expect(copier.copyIndexes()).resolves.toEqual({
            sourceIndexCount: 1,
            createdCount: 0,
            skippedCount: 1,
            renamedCount: 0,
            cancelled: false,
        });
        expect(createIndex).not.toHaveBeenCalled();
    });

    it('preserves the name and options when no collision exists', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const onStart = jest.fn();
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'email_1', v: 2, unique: true }]),
            createClient([], createIndex),
        );

        const result = await copier.copyIndexes({ onStart });

        expect(onStart).toHaveBeenCalledWith(1);
        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { email: 1 },
            name: 'email_1',
            unique: true,
        });
        expect(result).toEqual({
            sourceIndexCount: 1,
            createdCount: 1,
            skippedCount: 0,
            renamedCount: 0,
            cancelled: false,
        });
    });

    it('preserves DocumentDB-specific options when creating a vector index', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const cosmosSearchOptions = {
            kind: 'vector-hnsw',
            m: 16,
            efConstruction: 64,
            similarity: 'COS',
            dimensions: 1536,
        };
        const copier = createCopier(
            createClient([
                {
                    key: { embedding: 'cosmosSearch' },
                    name: 'bookEmbeddingIndex',
                    cosmosSearchOptions,
                },
            ]),
            createClient([], createIndex),
        );

        await copier.copyIndexes();

        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { embedding: 'cosmosSearch' },
            name: 'bookEmbeddingIndex',
            cosmosSearchOptions,
        });
    });

    it('requests background creation even when the source reports foreground creation', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'email_1', background: false }]),
            createClient([], createIndex),
        );

        await copier.copyIndexes();

        expect(createIndex).toHaveBeenCalledWith(
            'targetDb',
            'targetCollection',
            expect.objectContaining({ background: true }),
        );
    });

    it('creates a hidden index before hiding it', async () => {
        const calls: string[] = [];
        const createIndex = jest.fn().mockImplementation(async () => {
            calls.push('create');
            return { ok: 1 };
        });
        const hideIndex = jest.fn().mockImplementation(async () => {
            calls.push('hide');
            return { ok: 1 };
        });
        const copier = createCopier(
            createClient([{ key: { addedAt: -1 }, name: 'addedAt_-1', hidden: true }]),
            createClient([], createIndex, hideIndex),
        );

        await copier.copyIndexes();

        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { addedAt: -1 },
            name: 'addedAt_-1',
        });
        expect(hideIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', 'addedAt_-1');
        expect(calls).toEqual(['create', 'hide']);
    });

    it('skips an equivalent target index without changing its visibility', async () => {
        const createIndex = jest.fn();
        const hideIndex = jest.fn();
        const copier = createCopier(
            createClient([{ key: { addedAt: -1 }, name: 'source_name', hidden: true }]),
            createClient([{ key: { addedAt: -1 }, name: 'target_name' }], createIndex, hideIndex),
        );

        const result = await copier.copyIndexes();

        expect(result.skippedCount).toBe(1);
        expect(createIndex).not.toHaveBeenCalled();
        expect(hideIndex).not.toHaveBeenCalled();
    });

    it('fails when a newly created index cannot be hidden', async () => {
        const copier = createCopier(
            createClient([{ key: { addedAt: -1 }, name: 'addedAt_-1', hidden: true }]),
            createClient(
                [],
                jest.fn().mockResolvedValue({ ok: 1 }),
                jest.fn().mockResolvedValue({ ok: 0, errmsg: 'hide failed' }),
            ),
        );

        await expect(copier.copyIndexes()).rejects.toThrow(
            'Index "addedAt_-1" was created but could not be hidden: hide failed',
        );
    });

    it('adds a suffix when an index name collides with a different definition', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'shared' }]),
            createClient(
                [
                    { key: { status: 1 }, name: 'shared' },
                    { key: { createdAt: 1 }, name: 'shared_copy' },
                ],
                createIndex,
            ),
        );

        const result = await copier.copyIndexes();

        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { email: 1 },
            name: 'shared_copy_2',
        });
        expect(result.renamedCount).toBe(1);
    });

    it('propagates index creation failures', async () => {
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'email_1' }]),
            createClient([], jest.fn().mockResolvedValue({ ok: 0, note: 'creation failed' })),
        );

        await expect(copier.copyIndexes()).rejects.toThrow('Failed to copy index "email_1": creation failed');
        expect(ext.outputChannel.error).toHaveBeenCalled();
    });

    it('logs a successful createIndexes note without treating it as a failure', async () => {
        const copier = createCopier(
            createClient([{ key: { email: 1 }, name: 'email_1' }]),
            createClient([], jest.fn().mockResolvedValue({ ok: 1, note: 'all indexes already exist' })),
        );

        await expect(copier.copyIndexes()).resolves.toMatchObject({ createdCount: 1 });
        expect(ext.outputChannel.warn).toHaveBeenCalledWith('[IndexCopy] Index "email_1": all indexes already exist');
    });

    it('stops after the current index when cancelled', async () => {
        const controller = new AbortController();
        const createIndex = jest.fn().mockImplementation(async () => {
            controller.abort();
            return { ok: 1 };
        });
        const copier = createCopier(
            createClient([
                { key: { email: 1 }, name: 'email_1' },
                { key: { status: 1 }, name: 'status_1' },
            ]),
            createClient([], createIndex),
        );

        const result = await copier.copyIndexes({ signal: controller.signal });

        expect(createIndex).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ createdCount: 1, cancelled: true });
    });
});
