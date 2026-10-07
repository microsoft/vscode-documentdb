/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';

const mockShowInputBox = vi.fn();
const mockAliasFor = vi.fn(async (): Promise<string | undefined> => undefined);
const mockSetAlias = vi.fn(async (): Promise<void> => undefined);
const mockReadAliases = vi.fn(async (): Promise<unknown[]> => []);
const mockRefreshKubernetesRoot = vi.fn();

vi.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: vi.fn((message: string, ...values: string[]) =>
            values.reduce<string>((acc, v, i) => acc.replace(`{${String(i)}}`, v), message),
        ),
    },
    window: {
        showInputBox: (...args: unknown[]) => mockShowInputBox(...args),
    },
}));

vi.mock('@microsoft/vscode-azext-utils', () => {
    class UserCancelledError extends Error {
        constructor() {
            super('User cancelled');
            this.name = 'UserCancelledError';
        }
    }
    return { UserCancelledError };
});

vi.mock('../sources/aliasStore', () => ({
    aliasFor: (...args: unknown[]) => mockAliasFor(...(args as [])),
    setAlias: (...args: unknown[]) => mockSetAlias(...(args as [])),
    readAliases: (...args: unknown[]) => mockReadAliases(...(args as [])),
}));

vi.mock('./refreshKubernetesRoot', () => ({
    refreshKubernetesRoot: () => mockRefreshKubernetesRoot(),
}));

import { renameKubernetesContext } from './renameKubernetesContext';

interface MockNode {
    sourceId: string;
    contextInfo: { name: string; cluster: string };
}

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        ui: {} as IActionContext['ui'],
        errorHandling: { issueProperties: {} },
    } as IActionContext;
}

function makeNode(overrides: Partial<MockNode> = {}): MockNode {
    return {
        sourceId: 'source-1',
        contextInfo: { name: 'my-context', cluster: 'my-cluster' },
        ...overrides,
    };
}

beforeEach(() => {
    mockShowInputBox.mockReset();
    mockAliasFor.mockReset();
    mockAliasFor.mockResolvedValue(undefined);
    mockSetAlias.mockReset();
    mockSetAlias.mockResolvedValue(undefined);
    mockReadAliases.mockReset();
    mockReadAliases.mockResolvedValue([]);
    mockRefreshKubernetesRoot.mockReset();
});

describe('renameKubernetesContext', () => {
    it('persists a new alias when the user submits a non-empty value', async () => {
        mockShowInputBox.mockResolvedValue('Prod AKS');
        const ctx = makeContext();
        const node = makeNode();

        await renameKubernetesContext(ctx, node as any);

        expect(mockSetAlias).toHaveBeenCalledWith('source-1', 'my-context', 'Prod AKS');
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(ctx.telemetry.properties.kubernetesContextResult).toBe('renamed');
    });

    it('clears the alias when the user submits an empty value', async () => {
        mockShowInputBox.mockResolvedValue('   ');
        mockAliasFor.mockResolvedValue('Old name');
        const ctx = makeContext();
        const node = makeNode();

        await renameKubernetesContext(ctx, node as any);

        expect(mockSetAlias).toHaveBeenCalledWith('source-1', 'my-context', undefined);
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(ctx.telemetry.properties.kubernetesContextResult).toBe('cleared');
    });

    it('throws UserCancelledError when the input box is dismissed', async () => {
        mockShowInputBox.mockResolvedValue(undefined);
        const ctx = makeContext();
        const node = makeNode();

        await expect(renameKubernetesContext(ctx, node as any)).rejects.toBeInstanceOf(UserCancelledError);

        expect(mockSetAlias).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
    });

    it('uses the current alias as the default value when prompting', async () => {
        mockShowInputBox.mockResolvedValue('Renamed');
        mockAliasFor.mockResolvedValue('Existing alias');
        const ctx = makeContext();
        const node = makeNode();

        await renameKubernetesContext(ctx, node as any);

        const inputArgs = mockShowInputBox.mock.calls[0][0] as { value?: string };
        expect(inputArgs.value).toBe('Existing alias');
    });

    it('throws a hard error when the node has no contextInfo', async () => {
        const ctx = makeContext();

        await expect(renameKubernetesContext(ctx, undefined as any)).rejects.toThrow('No Kubernetes context selected.');

        expect(mockShowInputBox).not.toHaveBeenCalled();
    });
});
