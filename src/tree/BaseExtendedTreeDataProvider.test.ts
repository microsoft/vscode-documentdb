/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ConnectionDiagnosticsService } from '../services/connectionDiagnosticsService';
import { BaseExtendedTreeDataProvider } from './BaseExtendedTreeDataProvider';
import { type TreeElement } from './TreeElement';

jest.mock('../extensionVariables', () => ({
    ext: {
        state: { wrapItemInStateHandling: (item: unknown) => item },
    },
}));

/** Minimal concrete provider: the behaviour under test lives entirely in the base class. */
class TestProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    getChildren(): Promise<TreeElement[] | null | undefined> {
        return Promise.resolve([]);
    }
    getTreeItem(): Promise<vscode.TreeItem> {
        return Promise.resolve({});
    }
    public fetch(
        element: TreeElement,
        context: IActionContext,
        fetchFunc: () => Promise<TreeElement[] | null | undefined>,
    ): Promise<TreeElement[] | null | undefined> {
        return this.wrapGetChildrenWithErrorAndStateHandling(element, context, fetchFunc);
    }
}

function actionContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: undefined,
    } as unknown as IActionContext;
}

const clusterElement = { id: 'view/cluster/db', cluster: { clusterId: 'cluster-1' } } as unknown as TreeElement;

describe('BaseExtendedTreeDataProvider error translation', () => {
    let showErrorMessage: jest.SpyInstance;

    beforeEach(() => {
        ConnectionDiagnosticsService.resetForTests();
        // The vscode mock exposes showErrorMessage as a shared jest.fn(), so its call history
        // survives restoreAllMocks and has to be cleared explicitly.
        showErrorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        showErrorMessage.mockClear();
    });

    afterEach(() => {
        ConnectionDiagnosticsService.resetForTests();
        jest.restoreAllMocks();
    });

    it('shows the explanation and suppresses the default notification', async () => {
        ConnectionDiagnosticsService.registerProvider({
            id: 'test',
            explain: () => Promise.resolve('DocumentDB Local does not appear to be running.'),
        });
        const context = actionContext();
        const failure = new Error('connect ECONNREFUSED 127.0.0.1:10260');

        await expect(new TestProvider().fetch(clusterElement, context, () => Promise.reject(failure))).rejects.toBe(
            failure,
        );

        expect(showErrorMessage).toHaveBeenCalledWith(
            'DocumentDB Local does not appear to be running. (connect ECONNREFUSED 127.0.0.1:10260)',
        );
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.telemetry.properties.diagnosisProviderId).toBe('test');
    });

    it('rethrows the original error object untouched', async () => {
        ConnectionDiagnosticsService.registerProvider({ id: 'test', explain: () => Promise.resolve('explained') });

        class CustomError extends Error {
            public readonly code = 'ECONNREFUSED';
        }
        const failure = new CustomError('raw driver text');

        await expect(
            new TestProvider().fetch(clusterElement, actionContext(), () => Promise.reject(failure)),
        ).rejects.toBe(failure);

        expect(failure.message).toBe('raw driver text');
        expect(failure).toBeInstanceOf(CustomError);
        expect(failure.code).toBe('ECONNREFUSED');
    });

    it('leaves the default notification alone when no provider explains the failure', async () => {
        const context = actionContext();

        await expect(
            new TestProvider().fetch(clusterElement, context, () => Promise.reject(new Error('boom'))),
        ).rejects.toThrow('boom');

        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBeUndefined();
    });

    it('does not consult providers for an element that has no cluster', async () => {
        const explain = jest.fn().mockResolvedValue('should not be used');
        ConnectionDiagnosticsService.registerProvider({ id: 'test', explain });

        await expect(
            new TestProvider().fetch({ id: 'view/folder' } as TreeElement, actionContext(), () =>
                Promise.reject(new Error('boom')),
            ),
        ).rejects.toThrow('boom');

        expect(explain).not.toHaveBeenCalled();
    });
});
