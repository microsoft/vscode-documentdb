/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { EJSON, ObjectId } from 'bson';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../DocumentDBExperiences';
import { type ClustersClient } from '../../../documentdb/ClustersClient';

const mocks = vi.hoisted(() => ({
    getClient: vi.fn(),
    recordSurveyActivity: vi.fn(),
    showConfirmationAsInSettings: vi.fn(),
}));

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));

vi.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: mocks.getClient },
}));

vi.mock('../../../services/survey/SurveyService', () => ({
    recordSurveyActivity: mocks.recordSurveyActivity,
}));

vi.mock('../../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: mocks.showConfirmationAsInSettings,
}));

vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await vi.importActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedureWithTelemetry: trpc.publicProcedure,
        router: trpc.router,
    };
});

import { createCallerFactory } from '../../_integration/trpc';
import { documentsViewRouter, type RouterContext } from './documentsViewRouter';

interface SavedDocumentResult {
    documentId: unknown;
    document: { _id: unknown; value: string };
}

type UpsertDocumentMock = (...args: Parameters<ClustersClient['upsertDocument']>) => Promise<SavedDocumentResult>;

function createContext(): RouterContext {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'documentView',
        clusterId: 'cluster-id',
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        documentId: '',
        viewPanelTitleSetter: vi.fn(),
    };
}

describe('documentsViewRouter saveDocument', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['zero', 0],
        ['false', false],
        ['empty string', ''],
        ['null', null],
    ])('preserves a falsy %s _id for an existing document', async (_label, id) => {
        const upsertDocument = vi
            .fn<UpsertDocumentMock>()
            .mockResolvedValue({ documentId: id, document: { _id: id, value: 'updated' } });
        mocks.getClient.mockResolvedValue({ upsertDocument });
        const context = createContext();

        const result = await createCallerFactory(documentsViewRouter)(context).saveDocument({
            documentContent: EJSON.stringify({ _id: id, value: 'updated' }),
        });

        expect(upsertDocument).toHaveBeenCalledTimes(1);
        expect(upsertDocument.mock.calls[0][2]).toBe(EJSON.stringify(id));
        expect(result.documentId).toBe(EJSON.stringify(id));
    });

    it('uses the empty sentinel when adding a document without an _id', async () => {
        const generatedId = new ObjectId('000000000000000000000010');
        const upsertDocument = vi
            .fn<UpsertDocumentMock>()
            .mockResolvedValue({ documentId: generatedId, document: { _id: generatedId, value: 'new' } });
        mocks.getClient.mockResolvedValue({ upsertDocument });

        await createCallerFactory(documentsViewRouter)(createContext()).saveDocument({
            documentContent: EJSON.stringify({ value: 'new' }),
        });

        expect(upsertDocument.mock.calls[0][2]).toBe('');
    });

    it('preserves an ObjectId _id for an existing document', async () => {
        const id = new ObjectId('000000000000000000000020');
        const upsertDocument = vi
            .fn<UpsertDocumentMock>()
            .mockResolvedValue({ documentId: id, document: { _id: id, value: 'updated' } });
        mocks.getClient.mockResolvedValue({ upsertDocument });

        await createCallerFactory(documentsViewRouter)(createContext()).saveDocument({
            documentContent: EJSON.stringify({ _id: id, value: 'updated' }),
        });

        expect(upsertDocument.mock.calls[0][2]).toBe(EJSON.stringify(id));
    });
});
