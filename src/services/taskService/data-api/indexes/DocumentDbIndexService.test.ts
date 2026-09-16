/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { DocumentDbIndexService } from './DocumentDbIndexService';

jest.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: { trace: jest.fn(), debug: jest.fn(), error: jest.fn() },
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

describe('DocumentDbIndexService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('counts only indexes that can be copied', async () => {
        const service = new DocumentDbIndexService(
            createClient([
                { key: { _id: 1 }, name: '_id_' },
                { key: { email: 1 }, name: 'email_1', unique: true },
            ]),
            'sourceDb',
            'sourceCollection',
        );

        await expect(service.countCopyableIndexes()).resolves.toBe(1);
    });

    it('skips equivalent definitions even when names differ', async () => {
        const createIndex = jest.fn();
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'source_name', v: 2, unique: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'target_name', v: 1, unique: true }], createIndex),
            'targetDb',
            'targetCollection',
        );

        await expect(source.copyIndexesTo(target)).resolves.toEqual({
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
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'email_1', v: 2, unique: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(createClient([], createIndex), 'targetDb', 'targetCollection');

        const result = await source.copyIndexesTo(target, { onStart });

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
        const source = new DocumentDbIndexService(
            createClient([
                {
                    key: { embedding: 'cosmosSearch' },
                    name: 'bookEmbeddingIndex',
                    cosmosSearchOptions,
                },
            ]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(createClient([], createIndex), 'targetDb', 'targetCollection');

        await source.copyIndexesTo(target);

        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { embedding: 'cosmosSearch' },
            name: 'bookEmbeddingIndex',
            cosmosSearchOptions,
        });
    });

    it('requests background creation even when the source reports foreground creation', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'email_1', background: false }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(createClient([], createIndex), 'targetDb', 'targetCollection');

        await source.copyIndexesTo(target);

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
        const source = new DocumentDbIndexService(
            createClient([{ key: { addedAt: -1 }, name: 'addedAt_-1', hidden: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient([], createIndex, hideIndex),
            'targetDb',
            'targetCollection',
        );

        await source.copyIndexesTo(target);

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
        const source = new DocumentDbIndexService(
            createClient([{ key: { addedAt: -1 }, name: 'source_name', hidden: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient([{ key: { addedAt: -1 }, name: 'target_name' }], createIndex, hideIndex),
            'targetDb',
            'targetCollection',
        );

        const result = await source.copyIndexesTo(target);

        expect(result.skippedCount).toBe(1);
        expect(createIndex).not.toHaveBeenCalled();
        expect(hideIndex).not.toHaveBeenCalled();
    });

    it('fails when a newly created index cannot be hidden', async () => {
        const source = new DocumentDbIndexService(
            createClient([{ key: { addedAt: -1 }, name: 'addedAt_-1', hidden: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient(
                [],
                jest.fn().mockResolvedValue({ ok: 1 }),
                jest.fn().mockResolvedValue({ ok: 0, errmsg: 'hide failed' }),
            ),
            'targetDb',
            'targetCollection',
        );

        await expect(source.copyIndexesTo(target)).rejects.toThrow(
            'Index "addedAt_-1" was created but could not be hidden: hide failed',
        );
    });

    it('adds a suffix when an index name collides with a different definition', async () => {
        const createIndex = jest.fn().mockResolvedValue({ ok: 1 });
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'shared' }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient(
                [
                    { key: { status: 1 }, name: 'shared' },
                    { key: { createdAt: 1 }, name: 'shared_copy' },
                ],
                createIndex,
            ),
            'targetDb',
            'targetCollection',
        );

        const result = await source.copyIndexesTo(target);

        expect(createIndex).toHaveBeenCalledWith('targetDb', 'targetCollection', {
            background: true,
            key: { email: 1 },
            name: 'shared_copy_2',
        });
        expect(result.renamedCount).toBe(1);
    });

    it('propagates index creation failures', async () => {
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'email_1' }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient([], jest.fn().mockResolvedValue({ ok: 0, note: 'creation failed' })),
            'targetDb',
            'targetCollection',
        );

        await expect(source.copyIndexesTo(target)).rejects.toThrow('creation failed');
        expect(ext.outputChannel.error).toHaveBeenCalled();
    });

    it('stops after the current index when cancelled', async () => {
        const controller = new AbortController();
        const createIndex = jest.fn().mockImplementation(async () => {
            controller.abort();
            return { ok: 1 };
        });
        const source = new DocumentDbIndexService(
            createClient([
                { key: { email: 1 }, name: 'email_1' },
                { key: { status: 1 }, name: 'status_1' },
            ]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(createClient([], createIndex), 'targetDb', 'targetCollection');

        const result = await source.copyIndexesTo(target, { signal: controller.signal });

        expect(createIndex).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ createdCount: 1, cancelled: true });
    });
});
