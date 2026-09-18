/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { CopyPasteBufferService, type CopiedIndexScope } from '../../services/CopyPasteBufferService';
import { type CollectionIndexCopier } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { LoadSourceIndexesStep } from './LoadSourceIndexesStep';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

jest.mock('../../documentdb/ClustersClient', () => {
    const actual = jest.requireActual('../../documentdb/ClustersClient');
    return { ...actual, ClustersClient: { getClient: jest.fn() } };
});

jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: jest.fn() },
}));

jest.mock('../../services/CopyPasteBufferService', () => ({
    CopyPasteBufferService: { clearIndexes: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { error: jest.fn() } },
}));

function createContext(scope: CopiedIndexScope, indexCopier: CollectionIndexCopier): PasteIndexesWizardContext {
    return {
        source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
        target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
        sourceConnectionName: 'Source',
        targetConnectionName: 'Target',
        targetIndexesId: 'target/indexes',
        scope,
        copyOperationCorrelationId: 'operation-id',
        indexCopier,
        sourceIndexNames: scope.kind === 'index' ? [scope.indexName] : undefined,
        catalogCount: 0,
        copyableCount: 0,
        copyableIndexNames: [],
        excluded: [],
        uniqueIndexNames: [],
        ttlIndexNames: [],
        telemetry: { properties: {}, measurements: {} },
        ui: { showQuickPick: jest.fn().mockImplementation(async (items: Promise<never>) => items) },
    } as unknown as PasteIndexesWizardContext;
}

describe('LoadSourceIndexesStep', () => {
    const listIndexes = jest.fn();
    const listSearchIndexesForAtlas = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(CredentialCache.hasCredentials).mockReturnValue(true);
        jest.mocked(ClustersClient.getClient).mockResolvedValue({
            listCollections: jest.fn().mockResolvedValue([{ name: 'sourceCollection' }]),
            listIndexes,
            listSearchIndexesForAtlas,
        } as unknown as ClustersClient);
        listIndexes.mockResolvedValue([
            { name: '_id_', type: 'traditional', key: { _id: 1 } },
            { name: 'email_1', type: 'traditional', key: { email: 1 }, unique: true },
        ]);
        listSearchIndexesForAtlas.mockResolvedValue([{ name: 'search', type: 'search' }]);
    });

    it('classifies the full parent catalog and scopes copier summary arguments', async () => {
        const getSourceIndexSummary = jest.fn().mockResolvedValue({
            count: 2,
            uniqueIndexNames: ['email_1'],
            ttlIndexNames: [],
        });
        const context = createContext({ kind: 'allIndexes' }, {
            getSourceIndexSummary,
        } as unknown as CollectionIndexCopier);

        await new LoadSourceIndexesStep().prompt(context);

        expect(context.catalogCount).toBe(3);
        expect(context.copyableCount).toBe(1);
        expect(context.copyableIndexNames).toEqual(['email_1']);
        expect(context.excluded).toEqual([
            { name: '_id_', type: 'traditional', reason: 'builtInId' },
            { name: 'search', type: 'search', reason: 'notCopyable' },
        ]);
        expect(context.sourceIndexNames).toEqual(['email_1']);
        expect(getSourceIndexSummary).toHaveBeenCalledWith({
            sourceIndexNames: ['email_1'],
            signal: expect.any(AbortSignal),
        });
        expect(context.telemetry.measurements).toMatchObject({
            catalogIndexCount: 3,
            copyableIndexCount: 1,
            excludedIndexCount: 2,
            selectedIndexCount: 1,
        });
        expect(context.telemetry.properties.copyScope).toBe('allIndexes');
    });

    it('retains ordinary counts and _id exclusion when the advisory search read fails', async () => {
        listSearchIndexesForAtlas.mockRejectedValue(new Error('unsupported'));
        const getSourceIndexSummary = jest
            .fn()
            .mockResolvedValue({ count: 2, uniqueIndexNames: [], ttlIndexNames: [] });
        const context = createContext({ kind: 'allIndexes' }, {
            getSourceIndexSummary,
        } as unknown as CollectionIndexCopier);

        await new LoadSourceIndexesStep().prompt(context);

        expect(context.catalogCount).toBe(2);
        expect(context.copyableCount).toBe(1);
        expect(context.excluded).toEqual([{ name: '_id_', type: 'traditional', reason: 'builtInId' }]);
    });

    it('reports a keyless selected index as unsupported and clears stale state', async () => {
        const context = createContext({ kind: 'index', indexName: 'search' }, {
            getSourceIndexSummary: jest.fn(),
        } as unknown as CollectionIndexCopier);

        await expect(new LoadSourceIndexesStep().prompt(context)).rejects.toThrow(
            'index "search" is no longer supported',
        );
        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
    });

    it('passes one validated selected name to the summary', async () => {
        const getSourceIndexSummary = jest.fn().mockResolvedValue({
            count: 2,
            uniqueIndexNames: ['email_1'],
            ttlIndexNames: [],
        });
        const context = createContext({ kind: 'index', indexName: 'email_1' }, {
            getSourceIndexSummary,
        } as unknown as CollectionIndexCopier);

        await new LoadSourceIndexesStep().prompt(context);

        expect(context.sourceIndexNames).toEqual(['email_1']);
        expect(getSourceIndexSummary).toHaveBeenCalledWith({
            sourceIndexNames: ['email_1'],
            signal: expect.any(AbortSignal),
        });
    });

    it('passes every validated selected name to the summary', async () => {
        listIndexes.mockResolvedValue([
            { name: '_id_', type: 'traditional', key: { _id: 1 } },
            { name: 'email_1', type: 'traditional', key: { email: 1 }, unique: true },
            { name: 'region_1', type: 'traditional', key: { region: 1 } },
        ]);
        const getSourceIndexSummary = jest.fn().mockResolvedValue({
            count: 3,
            uniqueIndexNames: ['email_1'],
            ttlIndexNames: [],
        });
        const context = createContext({ kind: 'indexes', indexNames: ['email_1', 'region_1'] }, {
            getSourceIndexSummary,
        } as unknown as CollectionIndexCopier);

        await new LoadSourceIndexesStep().prompt(context);

        expect(context.sourceIndexNames).toEqual(['email_1', 'region_1']);
        expect(getSourceIndexSummary).toHaveBeenCalledWith({
            sourceIndexNames: ['email_1', 'region_1'],
            signal: expect.any(AbortSignal),
        });
    });

    it('clears a subset when any selected index is missing', async () => {
        const context = createContext({ kind: 'indexes', indexNames: ['email_1', 'missing_1'] }, {
            getSourceIndexSummary: jest.fn(),
        } as unknown as CollectionIndexCopier);

        await expect(new LoadSourceIndexesStep().prompt(context)).rejects.toThrow('"missing_1"');
        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
    });

    it('reports a deleted selected index as missing and clears stale state', async () => {
        const context = createContext({ kind: 'index', indexName: 'missing' }, {
            getSourceIndexSummary: jest.fn(),
        } as unknown as CollectionIndexCopier);

        await expect(new LoadSourceIndexesStep().prompt(context)).rejects.toThrow('index "missing" no longer exists');
        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
    });

    it('clears stale state when the source collection no longer exists', async () => {
        jest.mocked(ClustersClient.getClient).mockResolvedValue({
            listCollections: jest.fn().mockResolvedValue([]),
        } as unknown as ClustersClient);
        const context = createContext({ kind: 'allIndexes' }, {
            getSourceIndexSummary: jest.fn(),
        } as unknown as CollectionIndexCopier);

        await expect(new LoadSourceIndexesStep().prompt(context)).rejects.toThrow('source collection');
        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
    });
});
