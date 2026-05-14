/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';

const mockShowWarningMessage = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockShowErrorMessage = jest.fn();
const mockShowOpenDialog = jest.fn();
const mockShowTextDocument = jest.fn();
const mockOpenTextDocument = jest.fn();
const mockReadText = jest.fn(async (): Promise<string> => '');
const mockDescribeDefaultKubeconfigPath = jest.fn(() => '~/.kube/config');
const mockLoadKubeConfig = jest.fn();
const mockGetContexts = jest.fn((): { name: string }[] => []);
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
        showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
        showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
        showTextDocument: (...args: unknown[]) => mockShowTextDocument(...args),
    },
    workspace: {
        openTextDocument: (...args: unknown[]) => mockOpenTextDocument(...args),
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

        expect(iconById['default']).toBe('home');
        expect(iconById['file']).toBe('folder-opened');
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

function createInlineSelectingUi(): MockUi {
    return {
        showQuickPick: jest.fn((picks: IAzureQuickPickItem<AddBranch>[]) => {
            const inlineItem = picks.find((p: IAzureQuickPickItem<AddBranch>) => p.data === 'inline');
            return inlineItem;
        }),
    };
}

describe('addKubeconfigSource inline branch modal confirmation', () => {
    it('aborts without reading clipboard when user dismisses the modal', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        mockShowWarningMessage.mockResolvedValue(undefined);

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('clipboard'),
            { modal: true },
            expect.any(String),
            expect.any(String),
        );
        expect(mockReadText).not.toHaveBeenCalled();
        expect(mockAddInlineSource).not.toHaveBeenCalled();
    });

    it('opens preview editor without storing when user clicks Preview', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        mockShowWarningMessage.mockResolvedValue('Preview Clipboard');
        mockReadText.mockResolvedValue('apiVersion: v1\nkind: Config');
        const mockDoc = { uri: 'untitled:1' };
        mockOpenTextDocument.mockResolvedValue(mockDoc);

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(mockReadText).toHaveBeenCalledTimes(1);
        expect(mockOpenTextDocument).toHaveBeenCalledWith({
            content: 'apiVersion: v1\nkind: Config',
            language: 'yaml',
        });
        expect(mockShowTextDocument).toHaveBeenCalledWith(mockDoc, { preview: true });
        expect(mockAddInlineSource).not.toHaveBeenCalled();
    });

    it('reads clipboard and stores after user clicks Continue', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        const yamlContent = 'apiVersion: v1\nkind: Config\ncontexts:\n- name: test';
        mockShowWarningMessage.mockResolvedValue('Continue');
        mockReadText.mockResolvedValue(yamlContent);
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'test' }]);
        mockAddInlineSource.mockResolvedValue({ id: 'inline-1', label: 'Pasted YAML 1', kind: 'inline' });

        await addKubeconfigSource(context);

        expect(mockReadText).toHaveBeenCalled();
        expect(mockAddInlineSource).toHaveBeenCalledWith(yamlContent);
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('added');
    });

    it('shows error and aborts when clipboard is empty after Continue', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        mockShowWarningMessage.mockResolvedValue('Continue');
        mockReadText.mockResolvedValue('   ');

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('emptyClipboard');
        expect(mockAddInlineSource).not.toHaveBeenCalled();
    });

    it('shows error when pasted YAML has no contexts after Continue', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        mockShowWarningMessage.mockResolvedValue('Continue');
        mockReadText.mockResolvedValue('apiVersion: v1\nkind: Config');
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([]);

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('noContexts');
        expect(mockAddInlineSource).not.toHaveBeenCalled();
    });
});
