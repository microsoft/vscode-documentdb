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
}

function createClient(indexes: MockIndex[], createIndex: jest.Mock = jest.fn()): ClustersClient {
    return {
        getCollection: jest.fn().mockReturnValue({
            indexes: jest.fn().mockResolvedValue(indexes),
            createIndex,
        }),
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
        const createIndex = jest.fn().mockResolvedValue('email_1');
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'email_1', v: 2, unique: true }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(createClient([], createIndex), 'targetDb', 'targetCollection');

        const result = await source.copyIndexesTo(target);

        expect(createIndex).toHaveBeenCalledWith({ email: 1 }, { name: 'email_1', unique: true });
        expect(result).toEqual({
            sourceIndexCount: 1,
            createdCount: 1,
            skippedCount: 0,
            renamedCount: 0,
            cancelled: false,
        });
    });

    it('adds a suffix when an index name collides with a different definition', async () => {
        const createIndex = jest.fn().mockResolvedValue('shared_copy_2');
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

        expect(createIndex).toHaveBeenCalledWith({ email: 1 }, { name: 'shared_copy_2' });
        expect(result.renamedCount).toBe(1);
    });

    it('propagates index creation failures', async () => {
        const source = new DocumentDbIndexService(
            createClient([{ key: { email: 1 }, name: 'email_1' }]),
            'sourceDb',
            'sourceCollection',
        );
        const target = new DocumentDbIndexService(
            createClient([], jest.fn().mockRejectedValue(new Error('creation failed'))),
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
