/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockOutputError = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockOpenTextDocument = vi.fn();
const mockShowTextDocument = vi.fn();
const mockResolveExistingDefaultKubeconfigPath = vi.fn();
const mockDescribeDefaultKubeconfigPath = vi.fn();

vi.mock('fs', () => ({
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('vscode', () => ({
    Uri: {
        file: (p: string) => ({ scheme: 'file', fsPath: p }),
    },
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
        showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
        showTextDocument: (...args: unknown[]) => mockShowTextDocument(...args),
    },
    workspace: {
        openTextDocument: (...args: unknown[]) => mockOpenTextDocument(...args),
    },
    l10n: {
        t: vi.fn((message: string, ...args: string[]) =>
            args.reduce<string>((acc, value, index) => acc.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

vi.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: (...args: unknown[]) => mockOutputError(...args),
        },
    },
}));

vi.mock('../config', () => ({
    DISCOVERY_PROVIDER_ID: 'kubernetes-discovery',
}));

vi.mock('../kubernetesClient', () => ({
    resolveExistingDefaultKubeconfigPath: (...args: unknown[]) => mockResolveExistingDefaultKubeconfigPath(...args),
    describeDefaultKubeconfigPath: (...args: unknown[]) => mockDescribeDefaultKubeconfigPath(...args),
}));

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { editKubeconfig } from './editKubeconfig';

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {} as never,
        valuesToMask: [],
    } as unknown as IActionContext;
}

function makeNode(source: Record<string, unknown>): { source: Record<string, unknown> } {
    return { source } as never;
}

describe('editKubeconfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDescribeDefaultKubeconfigPath.mockReturnValue('~/.kube/config');
    });

    it('opens a file source in the editor', async () => {
        mockExistsSync.mockReturnValue(true);
        mockOpenTextDocument.mockResolvedValue({});

        const context = makeContext();
        await editKubeconfig(context, makeNode({ kind: 'file', path: '/home/user/config.yaml' }) as never);

        expect(mockOpenTextDocument).toHaveBeenCalledWith(
            expect.objectContaining({ fsPath: '/home/user/config.yaml' }),
        );
        expect(mockShowTextDocument).toHaveBeenCalled();
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('opened');
        expect(context.telemetry.properties.kubeconfigSourceKind).toBe('file');
    });

    it('opens the resolved default kubeconfig when one exists', async () => {
        mockResolveExistingDefaultKubeconfigPath.mockReturnValue('/home/user/.kube/config');
        mockExistsSync.mockReturnValue(true);
        mockOpenTextDocument.mockResolvedValue({});

        const context = makeContext();
        await editKubeconfig(context, makeNode({ kind: 'default' }) as never);

        expect(mockOpenTextDocument).toHaveBeenCalledWith(
            expect.objectContaining({ fsPath: '/home/user/.kube/config' }),
        );
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('opened');
        expect(context.telemetry.properties.kubeconfigSourceKind).toBe('default');
    });

    it('shows a modal error (not a toast) when the default kubeconfig is missing', async () => {
        mockResolveExistingDefaultKubeconfigPath.mockReturnValue(undefined);

        const context = makeContext();
        await editKubeconfig(context, makeNode({ kind: 'default' }) as never);

        expect(mockOpenTextDocument).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowErrorMessage.mock.calls[0] as [string, { modal?: boolean }];
        expect(options.modal).toBe(true);
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('defaultPathMissing');
    });

    it('shows a modal error when a file source path no longer exists', async () => {
        mockExistsSync.mockReturnValue(false);

        const context = makeContext();
        await editKubeconfig(context, makeNode({ kind: 'file', path: '/gone/config.yaml' }) as never);

        expect(mockOpenTextDocument).not.toHaveBeenCalled();
        expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowErrorMessage.mock.calls[0] as [string, { modal?: boolean }];
        expect(options.modal).toBe(true);
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('fileMissing');
    });

    it('refuses inline sources with a modal warning', async () => {
        const context = makeContext();
        await editKubeconfig(context, makeNode({ kind: 'inline' }) as never);

        expect(mockOpenTextDocument).not.toHaveBeenCalled();
        expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
        const [, options] = mockShowWarningMessage.mock.calls[0] as [string, { modal?: boolean }];
        expect(options.modal).toBe(true);
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('notAFileSource');
    });
});
