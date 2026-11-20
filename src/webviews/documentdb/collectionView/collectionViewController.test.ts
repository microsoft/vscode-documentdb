/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentViewMode } from '../../../documentdb/DocumentViewMode';
import { LiveConfigService } from '../../../services/LiveConfigService';
import { openAppWebview } from '../../_integration/openAppWebview';
import { openCollectionWebview } from './collectionViewController';

const state = vi.hoisted(() => new Map<string, unknown>());

vi.mock('vscode', () => ({
    ViewColumn: { One: 1 },
    Uri: { joinPath: vi.fn() },
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (key: string) => state.get(key),
                update: async (key: string, value: unknown) => {
                    state.set(key, value);
                },
            },
        },
    },
}));
vi.mock('../../../services/SettingsService', () => ({
    SettingsService: { getSetting: vi.fn() },
}));
vi.mock('../../_integration/openAppWebview', () => ({ openAppWebview: vi.fn() }));

function open(collectionName: string): void {
    openCollectionWebview({
        sessionId: 'session',
        clusterId: 'cluster',
        clusterDisplayName: 'Cluster',
        viewId: 'connectionsView',
        databaseName: 'test',
        collectionName,
    });
}

describe('remembered Collection View layout', () => {
    beforeEach(() => {
        state.clear();
        vi.clearAllMocks();
    });

    it('defaults to Table and uses the latest choice when opening or reopening a collection', async () => {
        open('first');
        await LiveConfigService.setCollectionDocumentView(DocumentViewMode.TREE);
        open('second');
        await LiveConfigService.setCollectionDocumentView(DocumentViewMode.JSON);
        open('first');
        await LiveConfigService.setCollectionDocumentView(DocumentViewMode.TABLE);
        open('second');

        expect(vi.mocked(openAppWebview).mock.calls.map(([options]) => options.config)).toEqual([
            expect.objectContaining({ collectionName: 'first', initialDocumentView: DocumentViewMode.TABLE }),
            expect.objectContaining({ collectionName: 'second', initialDocumentView: DocumentViewMode.TREE }),
            expect.objectContaining({ collectionName: 'first', initialDocumentView: DocumentViewMode.JSON }),
            expect.objectContaining({ collectionName: 'second', initialDocumentView: DocumentViewMode.TABLE }),
        ]);
    });
});
