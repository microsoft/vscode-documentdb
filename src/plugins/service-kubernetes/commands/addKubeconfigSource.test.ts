/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';

const mockShowWarningMessage = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockShowOpenDialog = jest.fn();
const mockReadText = jest.fn(async (): Promise<string> => '');
const mockDescribeDefaultKubeconfigPath = jest.fn(() => '~/.kube/config');
const mockLoadKubeConfig = jest.fn();
const mockGetContexts = jest.fn(() => []);
const mockAddDefaultSource = jest.fn();
const mockAddFileSource = jest.fn();
const mockAddInlineSource = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...values: string[]) =>
            values.reduce<string>((acc, v, i) => acc.replace(`{${String(i)}}`, v), message),
        ),
    },
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
        showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
    },
    env: {
        clipboard: {
            readText: () => mockReadText(),
        },
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    describeDefaultKubeconfigPath: () => mockDescribeDefaultKubeconfigPath(),
    loadKubeConfig: (...args: unknown[]) => mockLoadKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...(args as [])),
}));

jest.mock('../sources/sourceStore', () => ({
    addDefaultSource: () => mockAddDefaultSource(),
    addFileSource: (...args: unknown[]) => mockAddFileSource(...args),
    addInlineSource: (...args: unknown[]) => mockAddInlineSource(...args),
}));

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { addKubeconfigSource } from './addKubeconfigSource';

type AddBranch = 'default' | 'file' | 'inline';

interface MockUi {
    readonly showQuickPick: jest.Mock;
}

function makeContext(ui: MockUi): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        errorHandling: {},
        ui,
    } as unknown as IActionContext;
}

let capturedPicks: IAzureQuickPickItem<AddBranch>[] = [];

function createCapturingUi(): MockUi {
    return {
        showQuickPick: jest.fn((picks: IAzureQuickPickItem<AddBranch>[]) => {
            capturedPicks = picks;
            throw new UserCancelledError();
        }),
    };
}

beforeEach(() => {
    capturedPicks = [];
    jest.clearAllMocks();
    mockDescribeDefaultKubeconfigPath.mockReturnValue('~/.kube/config');
});

describe('addKubeconfigSource pickBranch picker items', () => {
    it('presents exactly 3 items', async () => {
        const ui = createCapturingUi();
        const context = makeContext(ui);

        await expect(addKubeconfigSource(context)).rejects.toThrow();

        expect(capturedPicks).toHaveLength(3);
    });

    it('uses detail (not description) for explanatory text on every item', async () => {
        const ui = createCapturingUi();
        const context = makeContext(ui);

        await expect(addKubeconfigSource(context)).rejects.toThrow();

        for (const item of capturedPicks) {
            expect(item).toHaveProperty('detail');
            expect(typeof item.detail).toBe('string');
            expect(item).not.toHaveProperty('description');
        }
    });

    it('sets iconPath on every picker item', async () => {
        const ui = createCapturingUi();
        const context = makeContext(ui);

        await expect(addKubeconfigSource(context)).rejects.toThrow();

        for (const item of capturedPicks) {
            expect(item.iconPath).toBeDefined();
            expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
        }
    });

    it('uses the correct icon for each source type', async () => {
        const ui = createCapturingUi();
        const context = makeContext(ui);

        await expect(addKubeconfigSource(context)).rejects.toThrow();

        const iconById = Object.fromEntries(capturedPicks.map((p) => [p.data, (p.iconPath as vscode.ThemeIcon).id]));

        expect(iconById['default']).toBe('key');
        expect(iconById['file']).toBe('file');
        expect(iconById['inline']).toBe('clippy');
    });

    it('includes the default kubeconfig path in the default item label', async () => {
        mockDescribeDefaultKubeconfigPath.mockReturnValue('/custom/.kube/config');
        const ui = createCapturingUi();
        const context = makeContext(ui);

        await expect(addKubeconfigSource(context)).rejects.toThrow();

        const defaultItem = capturedPicks.find((p) => p.data === 'default');
        expect(defaultItem?.label).toContain('/custom/.kube/config');
    });
});
