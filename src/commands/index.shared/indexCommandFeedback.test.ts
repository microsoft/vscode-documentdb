/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTestActionContext,
    registerCommand,
    type IActionContext,
    type TreeNodeCommandCallback,
} from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { ErrorExplanationService } from '../../services/errorExplanationService';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { registerCommandWithTreeNodeUnwrappingAndDiagnostics } from '../../utils/commandErrorHandling';
import { confirmIndexAction } from '../../utils/dialogs/confirmIndexAction';
import { dropIndex } from '../index.dropIndex/dropIndex';
import { hideIndex } from '../index.hideIndex/hideIndex';
import { unhideIndex } from '../index.unhideIndex/unhideIndex';
import { getIndexConfirmationStats } from './getIndexConfirmationStats';

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, registerCommand: vi.fn() };
});

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown> & { default: Record<string, unknown> }>();
    class CancellationError extends Error {}
    actual.default.CancellationError = CancellationError;
    return { ...actual, CancellationError };
});

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn() },
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            runWithTemporaryDescription: vi.fn(
                async (_id: string, _description: string, callback: () => Promise<void>) => callback(),
            ),
            showDeleting: vi.fn(async (_id: string, callback: () => Promise<void>) => callback()),
            notifyChildrenChanged: vi.fn(),
        },
    },
}));

vi.mock('../../services/errorExplanationService', () => ({
    ErrorExplanationService: { explain: vi.fn() },
}));

vi.mock('../../utils/dialogs/confirmIndexAction', () => ({
    confirmIndexAction: vi.fn(),
}));

vi.mock('../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: vi.fn(),
}));

vi.mock('./getIndexConfirmationStats', () => ({
    getIndexConfirmationStats: vi.fn(),
}));

const explanation = { providerId: 'test-provider', message: 'Check the connection infrastructure.' };

function createIndexNode(overrides: Partial<IndexItem['indexInfo']> = {}): IndexItem {
    return {
        id: 'folder/cluster/database/collection/indexes/example_1',
        cluster: { clusterId: 'stable-cluster' },
        databaseInfo: { name: 'database' },
        collectionInfo: { name: 'collection' },
        indexInfo: { name: 'example_1', type: 'traditional', key: { example: 1 }, ...overrides },
        experience: { api: 'documentdb' },
    } as unknown as IndexItem;
}

function registerHandler(
    handler: TreeNodeCommandCallback<IndexItem>,
): (context: IActionContext, ...args: unknown[]) => unknown {
    registerCommandWithTreeNodeUnwrappingAndDiagnostics('test.indexAction', handler);
    const callback = vi.mocked(registerCommand).mock.calls.at(-1)?.[1];
    if (!callback) {
        throw new Error('Command was not registered.');
    }
    return callback;
}

interface ActionCase {
    readonly name: string;
    readonly callback: TreeNodeCommandCallback<IndexItem>;
    readonly method: 'dropIndex' | 'hideIndex' | 'unhideIndex';
    readonly telemetryAction: 'drop' | 'hide' | 'unhide';
    readonly heading: string;
    readonly error: unknown;
    readonly node?: IndexItem;
}

const actionCases: ActionCase[] = [
    {
        name: 'hide',
        callback: hideIndex,
        method: 'hideIndex',
        telemetryAction: 'hide',
        heading: 'Failed to hide index "example_1".',
        error: new Error('Hide failure'),
    },
    {
        name: 'unhide',
        callback: unhideIndex,
        method: 'unhideIndex',
        telemetryAction: 'unhide',
        heading: 'Failed to unhide index "example_1".',
        error: 'Unhide primitive failure',
        node: createIndexNode({ hidden: true }),
    },
    {
        name: 'delete',
        callback: dropIndex,
        method: 'dropIndex',
        telemetryAction: 'drop',
        heading: 'Failed to delete index "example_1".',
        error: Object.freeze(new Error('Delete failure')),
    },
];

describe('tree index command feedback', () => {
    let context: IActionContext;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(confirmIndexAction).mockResolvedValue(true);
        vi.mocked(getIndexConfirmationStats).mockResolvedValue({});
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);
        vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
        context = await createTestActionContext();
        context.errorHandling.rethrow = true;
        context.errorHandling.suppressDisplay = false;
    });

    it.each(actionCases)('shows exactly one callback modal for a failed $name action', async (action) => {
        const operation = vi.fn().mockRejectedValue(action.error);
        vi.mocked(ClustersClient.getClient).mockResolvedValue({
            [action.method]: operation,
        } as unknown as ClustersClient);
        const command = registerHandler(action.callback);
        const node = action.node ?? createIndexNode();

        await expect(command(context, node, [node])).rejects.toBe(action.error);

        expect(operation).toHaveBeenCalledExactlyOnceWith('database', 'collection', 'example_1');
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(action.heading, {
            modal: true,
            detail: String(action.error instanceof Error ? action.error.message : action.error),
        });
        expect(ErrorExplanationService.explain).toHaveBeenCalledExactlyOnceWith({
            clusterId: 'stable-cluster',
            error: action.error,
        });
        expect(context.telemetry.properties).toMatchObject({
            experience: 'documentdb',
            actionType: action.telemetryAction,
            userCancelled: 'false',
            explanationProviderId: explanation.providerId,
        });
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.errorHandling.rethrow).toBe(true);
    });

    it.each([
        {
            name: 'hide',
            callback: hideIndex,
            node: createIndexNode({ name: '_id_', key: { _id: 1 } }),
            message: 'The "_id_" index cannot be hidden.',
        },
        {
            name: 'unhide',
            callback: unhideIndex,
            node: createIndexNode({ hidden: false }),
            message: 'Index "example_1" is not hidden.',
        },
        {
            name: 'delete',
            callback: dropIndex,
            node: createIndexNode({ name: '_id_', key: { _id: 1 } }),
            message: 'The "_id_" index cannot be deleted.',
        },
    ] as const)('keeps $name validation failures on the wrapper display path', async ({ callback, node, message }) => {
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);
        const command = registerHandler(callback);

        const result = command(context, node, [node]);

        await expect(result).rejects.toThrow(message);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Unable to complete this tree action.', {
            modal: true,
            detail: message,
        });
        expect(confirmIndexAction).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(true);
    });

    it('shows a different refresh error after the operation modal was presented', async () => {
        const operationError = new Error('Hide failure');
        const refreshError = new Error('Refresh failure');
        vi.mocked(ClustersClient.getClient).mockResolvedValue({
            hideIndex: vi.fn().mockRejectedValue(operationError),
        } as unknown as ClustersClient);
        vi.mocked(ext.state.notifyChildrenChanged).mockImplementationOnce(() => {
            throw refreshError;
        });
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);
        const command = registerHandler(hideIndex);
        const node = createIndexNode();

        await expect(command(context, node, [node])).rejects.toBe(refreshError);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(2);
        expect(vscode.window.showErrorMessage).toHaveBeenNthCalledWith(2, 'Unable to complete this tree action.', {
            modal: true,
            detail: refreshError.message,
        });
    });
});
