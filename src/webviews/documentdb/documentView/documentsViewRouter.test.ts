/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { EJSON, ObjectId } from 'bson';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClustersClient } from '../../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../../documentdb/ConnectionUnavailableError';
import { API } from '../../../DocumentDBExperiences';
import { recordSurveyActivity } from '../../../services/survey/SurveyService';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { createCallerFactory } from '../../_integration/trpc';
import { documentsViewRouter, type RouterContext } from './documentsViewRouter';

const mocks = vi.hoisted(() => ({
    resolveBoundClient: vi.fn(),
    getBinding: vi.fn(),
    getEpoch: vi.fn(),
    getLatchReason: vi.fn(),
    reportFailure: vi.fn(),
}));
vi.mock('../../../documentdb/ClustersClient', () => ({ ClustersClient: mocks }));
vi.mock('../../../documentdb/CredentialCache', () => ({ CredentialCache: { getCredentials: vi.fn() } }));
vi.mock('../../../services/survey/SurveyService', () => ({ recordSurveyActivity: vi.fn() }));
vi.mock('../../../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc } = await import('@microsoft/vscode-ext-webview');
    const { createCallerFactory, publicProcedure, router } = initWebviewTrpc();
    return { createCallerFactory, publicProcedureWithTelemetry: publicProcedure, router };
});

const binding = { clusterId: 'cluster', fingerprint: 'host-only-fingerprint', generation: 1 };
const newerBinding = { ...binding, generation: 2 };
const upsertDocument = vi.fn<ClustersClient['upsertDocument']>();
const pointRead = vi.fn<ClustersClient['pointRead']>();
const viewPanelTitleSetter = vi.fn();
const describeUnavailable = vi.fn((reason: ConnectionUnavailableError['reason']) => ({
    unavailable: { reason, text: 'Connection unavailable.', action: 'close' as const },
}));
const recoverUnavailable = vi.fn();
const id = new ObjectId('000000000000000000000001');
const document = { _id: id, field: 'value' };
const serializedId = EJSON.stringify(id);
const input = { documentContent: EJSON.stringify(document) };

const callDocumentView = createCallerFactory(documentsViewRouter);

function createCaller(signal?: AbortSignal): ReturnType<typeof callDocumentView> {
    const context: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'documentView',
        clusterId: binding.clusterId,
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        documentId: 'id',
        binding: { current: binding },
        describeUnavailable,
        recoverUnavailable,
        signal,
        viewPanelTitleSetter,
    };
    return callDocumentView(context);
}

describe('Document View bound operations', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        describeUnavailable.mockImplementation((reason: ConnectionUnavailableError['reason']) => ({
            unavailable: { reason, text: 'Connection unavailable.', action: 'close' as const },
        }));
        mocks.getBinding.mockReturnValue(newerBinding);
        mocks.getEpoch.mockReturnValue(3);
        mocks.resolveBoundClient.mockResolvedValue({ binding: newerBinding, upsertDocument, pointRead });
    });

    it('does not expose the binding through the info procedure', async () => {
        const info = await createCaller().getInfo();
        expect(info).toContain('"clusterId":"cluster"');
        expect(info).not.toContain('binding');
        expect(info).not.toContain(binding.fingerprint);
    });

    it('uses the captured identity and preserves the successful save and read shapes', async () => {
        pointRead.mockResolvedValue(document);
        upsertDocument.mockResolvedValue({ documentId: id, document });
        const caller = createCaller();

        expect(await caller.getDocumentById(serializedId)).toBe(EJSON.stringify(document, undefined, 4));
        expect(await caller.saveDocument(input)).toEqual({
            documentId: serializedId,
            documentStringified: EJSON.stringify(document, undefined, 4),
        });
        expect(mocks.resolveBoundClient).toHaveBeenNthCalledWith(2, binding, { trigger: 'documentView' });
        expect(upsertDocument).toHaveBeenCalledExactlyOnceWith('database', 'collection', serializedId, document);
        expect(viewPanelTitleSetter).toHaveBeenCalledWith(`database/collection/${serializedId}`);
        expect(showConfirmationAsInSettings).toHaveBeenCalledOnce();
    });

    it('drops a save reply after a same-identity reconnect without replay or host updates', async () => {
        upsertDocument.mockImplementationOnce(async () => {
            mocks.getEpoch.mockReturnValue(4);
            return { documentId: id, document };
        });

        await expect(createCaller().saveDocument(input)).rejects.toMatchObject({
            cause: expect.any(UserCancelledError),
        });
        expect(upsertDocument).toHaveBeenCalledOnce();
        expect(viewPanelTitleSetter).not.toHaveBeenCalled();
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
        expect(recordSurveyActivity).not.toHaveBeenCalled();
    });

    it('rejects a changed identity before calling the driver', async () => {
        const unavailable = new ConnectionUnavailableError('identityChanged');
        mocks.resolveBoundClient.mockRejectedValueOnce(unavailable);
        await expect(createCaller().saveDocument(input)).resolves.toEqual({
            unavailable: { reason: 'identityChanged', text: 'Connection unavailable.', action: 'close' },
        });
        expect(upsertDocument).not.toHaveBeenCalled();
    });

    it('reports a terminal write failure on the generation that ran once', async () => {
        const failure = new Error('test server failure');
        upsertDocument.mockRejectedValueOnce(failure);
        mocks.reportFailure.mockReturnValueOnce('credentialsRejected');

        await expect(createCaller().saveDocument(input)).resolves.toEqual({
            unavailable: { reason: 'credentialsRejected', text: 'Connection unavailable.', action: 'close' },
        });
        expect(mocks.reportFailure).toHaveBeenCalledExactlyOnceWith(newerBinding, failure);
        expect(upsertDocument).toHaveBeenCalledOnce();
        expect(showConfirmationAsInSettings).not.toHaveBeenCalled();
    });

    it('returns structured read unavailability without reclassifying it', async (): Promise<void> => {
        pointRead.mockRejectedValueOnce(new ConnectionUnavailableError('signInRequired'));
        mocks.reportFailure.mockReturnValueOnce('signInRequired');

        await expect(createCaller().getDocumentById(serializedId)).resolves.toEqual({
            unavailable: { reason: 'signInRequired', text: 'Connection unavailable.', action: 'close' },
        });
    });

    it('returns save unavailability before attempting unrelated document validation', async (): Promise<void> => {
        mocks.resolveBoundClient.mockRejectedValueOnce(new ConnectionUnavailableError('userDisconnected'));

        await expect(
            createCaller().saveDocument({ documentContent: '{"invalid"' }),
        ).resolves.toEqual({
            unavailable: { reason: 'userDisconnected', text: 'Connection unavailable.', action: 'close' },
        });
        expect(upsertDocument).not.toHaveBeenCalled();
    });

    it('routes save retries through the preallocated identity so one insert target is reused', async (): Promise<void> => {
        const preallocatedId = '{"$oid":"000000000000000000000099"}';
        upsertDocument.mockResolvedValue({ documentId: id, document });

        await createCaller().saveDocument({ documentContent: EJSON.stringify({ field: 'value' }), documentId: preallocatedId });

        expect(upsertDocument).toHaveBeenCalledExactlyOnceWith(
            'database',
            'collection',
            preallocatedId,
            { field: 'value' },
        );
    });

    it('does not turn a nonterminal write failure into unavailability', async () => {
        const failure = new Error('test write error');
        upsertDocument.mockRejectedValueOnce(failure);
        await expect(createCaller().saveDocument(input)).rejects.toMatchObject({ cause: failure });
        expect(upsertDocument).toHaveBeenCalledOnce();
    });
});
