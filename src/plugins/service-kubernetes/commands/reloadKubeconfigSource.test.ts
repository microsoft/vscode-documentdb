/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockResetNodeErrorState = jest.fn();
const mockRefresh = jest.fn();
const mockOutputError = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockLoadConfiguredKubeConfig = jest.fn();
const mockGetContexts = jest.fn();

jest.mock('vscode', () => ({
    ProgressLocation: { Window: 10 },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    window: {
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
        withProgress: async <T>(_options: unknown, task: () => Promise<T>): Promise<T> => task(),
    },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((acc, value, index) => acc.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        discoveryBranchDataProvider: {
            resetNodeErrorState: (...args: unknown[]) => mockResetNodeErrorState(...args),
            refresh: (...args: unknown[]) => mockRefresh(...args),
        },
        outputChannel: {
            error: (...args: unknown[]) => mockOutputError(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
}));

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { reloadKubeconfigSource } from './reloadKubeconfigSource';

function makeContext(): IActionContext {
    return {
        telemetry: {
            properties: {},
            measurements: {},
        },
        errorHandling: { issueProperties: {} },
        ui: {} as never,
        valuesToMask: [],
    } as unknown as IActionContext;
}

function makeNode(overrides: Record<string, unknown> = {}): {
    id: string;
    source: { id: string; label: string; kind: string };
} {
    return {
        id: 'discoveryView/kubernetes-discovery/source-1',
        source: { id: 'source-1', label: 'my-config', kind: 'file' },
        ...overrides,
    } as never;
}

describe('reloadKubeconfigSource', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('clears the cached error state and refreshes the tree on success', async () => {
        mockLoadConfiguredKubeConfig.mockResolvedValueOnce({});
        mockGetContexts.mockReturnValueOnce([{ name: 'a' }, { name: 'b' }]);
        const context = makeContext();
        const node = makeNode();

        await reloadKubeconfigSource(context, node as never);

        expect(mockLoadConfiguredKubeConfig).toHaveBeenCalledWith('source-1');
        expect(mockResetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(mockRefresh).toHaveBeenCalledWith(node);
        expect(context.telemetry.properties.kubeconfigSourceAction).toBe('reload');
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('reloaded');
        expect(context.telemetry.measurements.contextCount).toBe(2);

        // Order matters: wrapGetChildrenWithErrorAndStateHandling short-circuits
        // on a cached failedChildrenCache entry, so the cache MUST be cleared
        // before refresh fires the change event. Lock this contract in the test.
        const resetOrder = mockResetNodeErrorState.mock.invocationCallOrder[0];
        const refreshOrder = mockRefresh.mock.invocationCallOrder[0];
        expect(resetOrder).toBeLessThan(refreshOrder);
    });

    it('shows a success toast that mentions the source label and context count', async () => {
        mockLoadConfiguredKubeConfig.mockResolvedValueOnce({});
        mockGetContexts.mockReturnValueOnce([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

        await reloadKubeconfigSource(makeContext(), makeNode() as never);

        expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
        const message = mockShowInformationMessage.mock.calls[0][0] as string;
        expect(message).toContain('my-config');
        expect(message).toContain('3');
    });

    it('does not show a success toast when zero contexts are returned', async () => {
        mockLoadConfiguredKubeConfig.mockResolvedValueOnce({});
        mockGetContexts.mockReturnValueOnce([]);
        const context = makeContext();

        await reloadKubeconfigSource(context, makeNode() as never);

        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('reloadedEmpty');
        expect(context.telemetry.measurements.contextCount).toBe(0);
        // Tree is still refreshed so createKubeconfigRecoveryChildren can render
        // the dedicated "No contexts" warning toast on the next getChildren call.
        expect(mockResetNodeErrorState).toHaveBeenCalled();
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('swallows load failures, logs them, and still refreshes the tree', async () => {
        mockLoadConfiguredKubeConfig.mockRejectedValueOnce(new Error('boom'));
        const context = makeContext();
        const node = makeNode();

        await expect(reloadKubeconfigSource(context, node as never)).resolves.toBeUndefined();

        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('failed');
        expect(context.telemetry.measurements.contextCount).toBe(0);
        expect(mockOutputError).toHaveBeenCalledTimes(1);
        const logMessage = mockOutputError.mock.calls[0][0] as string;
        expect(logMessage).toContain('my-config');
        expect(logMessage).toContain('boom');
        expect(mockResetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(mockRefresh).toHaveBeenCalledWith(node);

        // Same cache-invalidation-before-refresh contract as the success path.
        const resetOrder = mockResetNodeErrorState.mock.invocationCallOrder[0];
        const refreshOrder = mockRefresh.mock.invocationCallOrder[0];
        expect(resetOrder).toBeLessThan(refreshOrder);
    });

    it('throws when called without a source on the node', async () => {
        const context = makeContext();
        const node = { id: 'discoveryView/kubernetes-discovery/orphan' } as unknown as Parameters<
            typeof reloadKubeconfigSource
        >[1];

        await expect(reloadKubeconfigSource(context, node)).rejects.toThrow(/No kubeconfig source selected/);
        expect(mockLoadConfiguredKubeConfig).not.toHaveBeenCalled();
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});
