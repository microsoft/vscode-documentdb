/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopyPasteBufferService, type CopiedIndexScope, type CopiedIndexSelection } from './CopyPasteBufferService';

jest.mock('vscode', () => ({
    commands: { executeCommand: jest.fn().mockResolvedValue(undefined) },
}));

function createSelection(scope: CopiedIndexScope): CopiedIndexSelection {
    return {
        source: {
            clusterId: 'cluster',
            databaseName: 'database',
            collectionName: 'collection',
        },
        sourceConnectionName: 'Connection',
        scope,
    };
}

describe('CopyPasteBufferService', () => {
    beforeEach(async () => {
        await CopyPasteBufferService.resetForTests();
        jest.mocked(vscode.commands.executeCommand).mockClear();
    });

    afterEach(async () => {
        await CopyPasteBufferService.resetForTests();
    });

    it('stores immutable snapshots on set and get', async () => {
        const selection = createSelection({ kind: 'index', indexName: 'email_1' });
        await CopyPasteBufferService.setIndexes(selection);

        (selection.source as { databaseName: string }).databaseName = 'changed';
        const firstRead = CopyPasteBufferService.getIndexes();
        expect(firstRead?.source.databaseName).toBe('database');

        (firstRead?.source as { collectionName: string }).collectionName = 'changed';
        expect(CopyPasteBufferService.getIndexes()?.source.collectionName).toBe('collection');
    });

    it.each<CopiedIndexScope>([
        { kind: 'index', indexName: 'email_1' },
        { kind: 'indexes', indexNames: ['email_1', 'region_1'] },
        { kind: 'allIndexes' },
    ])('round-trips $kind scope and sets the context key', async (scope) => {
        await CopyPasteBufferService.setIndexes(createSelection(scope));

        expect(CopyPasteBufferService.getIndexes()?.scope).toEqual(scope);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'documentdb.hasCopiedIndexes', true);
    });

    it('clones selected index name arrays on set and get', async () => {
        const indexNames = ['email_1', 'region_1'];
        await CopyPasteBufferService.setIndexes(createSelection({ kind: 'indexes', indexNames }));

        indexNames.push('changed_1');
        const firstRead = CopyPasteBufferService.getIndexes();
        if (firstRead?.scope.kind !== 'indexes') {
            throw new Error('Expected a copied indexes scope.');
        }
        expect(firstRead.scope.indexNames).toEqual(['email_1', 'region_1']);

        (firstRead.scope.indexNames as string[]).push('changed_2');
        expect(CopyPasteBufferService.getIndexes()?.scope).toEqual({
            kind: 'indexes',
            indexNames: ['email_1', 'region_1'],
        });
    });

    it('replaces the previous index selection', async () => {
        await CopyPasteBufferService.setIndexes(createSelection({ kind: 'index', indexName: 'email_1' }));
        await CopyPasteBufferService.setIndexes(createSelection({ kind: 'allIndexes' }));

        expect(CopyPasteBufferService.getIndexes()?.scope).toEqual({ kind: 'allIndexes' });
    });

    it('clears the selection and context key', async () => {
        await CopyPasteBufferService.setIndexes(createSelection({ kind: 'allIndexes' }));

        await CopyPasteBufferService.clearIndexes();

        expect(CopyPasteBufferService.getIndexes()).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
            'setContext',
            'documentdb.hasCopiedIndexes',
            false,
        );
    });

    it('resets the selection and context key for tests', async () => {
        await CopyPasteBufferService.setIndexes(createSelection({ kind: 'allIndexes' }));

        await CopyPasteBufferService.resetForTests();

        expect(CopyPasteBufferService.getIndexes()).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
            'setContext',
            'documentdb.hasCopiedIndexes',
            false,
        );
    });
});
