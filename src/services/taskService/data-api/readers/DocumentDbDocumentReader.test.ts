/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { type ClustersClient } from '../../../../documentdb/ClustersClient';
import { DocumentDbDocumentReader } from './DocumentDbDocumentReader';

vi.mock('../../extension/extensionDataTransferOptions', () => ({
    createExtensionDataTransferOptions: () => ({
        logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        strings: {},
    }),
}));

function createClient(documents: unknown[] = []): ClustersClient {
    return {
        estimateDocumentCount: vi.fn().mockResolvedValue(documents.length),
        streamDocumentsWithQuery: vi.fn(async function* () {
            yield* documents;
        }),
    } as unknown as ClustersClient;
}

describe('DocumentDbDocumentReader', () => {
    it('does not resolve the client at construction time', () => {
        const getClient = vi.fn().mockResolvedValue(createClient());

        new DocumentDbDocumentReader(getClient, 'db', 'coll');

        expect(getClient).not.toHaveBeenCalled();
    });

    it('counts and streams through the provided client', async () => {
        const client = createClient([{ _id: 1, a: 1 }, { _id: 2 }]);
        const getClient = vi.fn().mockResolvedValue(client);
        const reader = new DocumentDbDocumentReader(getClient, 'db', 'coll');

        await expect(reader.countDocuments()).resolves.toBe(2);

        const ids: unknown[] = [];
        for await (const doc of reader.streamDocuments()) {
            ids.push(doc.id);
        }

        expect(ids).toEqual([1, 2]);
        expect(client.estimateDocumentCount).toHaveBeenCalledWith('db', 'coll');
        expect(getClient).toHaveBeenCalledTimes(2);
    });

    it('surfaces a provider failure when the reader is used, not before', async () => {
        const getClient = vi.fn().mockRejectedValue(new Error('not connected'));
        const reader = new DocumentDbDocumentReader(getClient, 'db', 'coll');

        await expect(reader.countDocuments()).rejects.toThrow('not connected');
    });
});
