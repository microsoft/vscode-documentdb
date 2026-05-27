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
const mockResolveKubeconfigPath = jest.fn(() => '/home/test/.kube/config');
const mockLoadKubeConfig = jest.fn();
const mockGetContexts = jest.fn((): { name: string }[] => []);
const mockAddDefaultSource = jest.fn();
const mockAddFileSource = jest.fn();
const mockAddInlineSource = jest.fn();
const mockExistsSync = jest.fn();
const mockHomedir = jest.fn(() => '/home/test');
const mockRefreshKubernetesRoot = jest.fn();
const mockRevealKubernetesSource = jest.fn();

jest.mock('vscode', () => ({
    Uri: {
        file: jest.fn((fsPath: string) => ({ fsPath, scheme: 'file' })),
    },
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

jest.mock('fs', () => ({
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

jest.mock('os', () => ({
    homedir: () => mockHomedir(),
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
    resolveKubeconfigPath: () => mockResolveKubeconfigPath(),
    loadKubeConfig: (...args: unknown[]) => mockLoadKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...(args as [])),
}));

jest.mock('../sources/sourceStore', () => ({
    addDefaultSource: () => mockAddDefaultSource(),
    addFileSource: (...args: unknown[]) => mockAddFileSource(...args),
    addInlineSource: (...args: unknown[]) => mockAddInlineSource(...args),
}));

jest.mock('./refreshKubernetesRoot', () => ({
    refreshKubernetesRoot: () => mockRefreshKubernetesRoot(),
    revealKubernetesSource: (...args: unknown[]) => mockRevealKubernetesSource(...args),
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
    mockResolveKubeconfigPath.mockReturnValue('/home/test/.kube/config');
    mockHomedir.mockReturnValue('/home/test');
    mockExistsSync.mockReturnValue(false);
    mockShowOpenDialog.mockResolvedValue(undefined);
    mockRevealKubernetesSource.mockResolvedValue(undefined);
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

function createFileSelectingUi(): MockUi {
    return {
        showQuickPick: jest.fn((picks: IAzureQuickPickItem<AddBranch>[]) => {
            const fileItem = picks.find((p: IAzureQuickPickItem<AddBranch>) => p.data === 'file');
            return fileItem;
        }),
    };
}

function createDefaultSelectingUi(): MockUi {
    return {
        showQuickPick: jest.fn((picks: IAzureQuickPickItem<AddBranch>[]) => {
            const defaultItem = picks.find((p: IAzureQuickPickItem<AddBranch>) => p.data === 'default');
            return defaultItem;
        }),
    };
}

interface OpenDialogOptionsWithDefaultUri {
    readonly defaultUri?: { readonly fsPath: string };
}

function getOpenDialogOptions(): OpenDialogOptionsWithDefaultUri {
    return mockShowOpenDialog.mock.calls[0]?.[0] as OpenDialogOptionsWithDefaultUri;
}

function setExistingPaths(paths: readonly string[]): void {
    mockExistsSync.mockImplementation((candidate: string) => paths.includes(candidate));
}

describe('addKubeconfigSource file branch open dialog defaultUri', () => {
    it('starts at the resolved kubeconfig file when it exists', async () => {
        mockResolveKubeconfigPath.mockReturnValue('/home/test/.kube/config');
        setExistingPaths(['/home/test/.kube/config']);
        const context = makeContext(createFileSelectingUi());

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(getOpenDialogOptions().defaultUri?.fsPath).toBe('/home/test/.kube/config');
    });

    it('starts at the kubeconfig directory when the file is missing but the directory exists', async () => {
        mockResolveKubeconfigPath.mockReturnValue('/home/test/.kube/config');
        setExistingPaths(['/home/test/.kube']);
        const context = makeContext(createFileSelectingUi());

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(getOpenDialogOptions().defaultUri?.fsPath).toBe('/home/test/.kube');
    });

    it('starts at the user home directory when no kubeconfig path exists', async () => {
        mockResolveKubeconfigPath.mockReturnValue('/home/test/.kube/config');
        mockHomedir.mockReturnValue('/home/test');
        setExistingPaths([]);
        const context = makeContext(createFileSelectingUi());

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(getOpenDialogOptions().defaultUri?.fsPath).toBe('/home/test');
    });

    it('honors an existing KUBECONFIG-resolved file path', async () => {
        mockResolveKubeconfigPath.mockReturnValue('/work/kube/team.yaml');
        setExistingPaths(['/work/kube/team.yaml']);
        const context = makeContext(createFileSelectingUi());

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(getOpenDialogOptions().defaultUri?.fsPath).toBe('/work/kube/team.yaml');
    });
});

describe('addKubeconfigSource default branch validation', () => {
    it('adds default source only after validation succeeds', async () => {
        const context = makeContext(createDefaultSelectingUi());
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'kind-documentdb-dev' }]);
        mockAddDefaultSource.mockResolvedValue({ id: 'default', label: 'Default kubeconfig', kind: 'default' });

        await addKubeconfigSource(context);

        expect(mockAddDefaultSource).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('added');
        expect(mockShowInformationMessage).toHaveBeenCalledWith('Added kubeconfig source "Default kubeconfig".');
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('default');
    });

    it('does not add default source when the default kubeconfig cannot be loaded', async () => {
        const context = makeContext(createDefaultSelectingUi());
        mockLoadKubeConfig.mockRejectedValue(new Error('ENOENT: no such file or directory'));

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(mockAddDefaultSource).not.toHaveBeenCalled();
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
        expect(mockRevealKubernetesSource).not.toHaveBeenCalled();
        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            'Default kubeconfig could not be loaded: ENOENT: no such file or directory. Fix the kubeconfig and try again.',
        );
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('invalidDefault');
    });

    it('does not add default source when the default kubeconfig has no contexts', async () => {
        const context = makeContext(createDefaultSelectingUi());
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([]);

        await expect(addKubeconfigSource(context)).rejects.toThrow(UserCancelledError);

        expect(mockAddDefaultSource).not.toHaveBeenCalled();
        expect(mockShowInformationMessage).not.toHaveBeenCalled();
        expect(mockRefreshKubernetesRoot).not.toHaveBeenCalled();
        expect(mockRevealKubernetesSource).not.toHaveBeenCalled();
        expect(mockShowWarningMessage).toHaveBeenCalledWith(
            'No Kubernetes contexts were found in the default kubeconfig (KUBECONFIG environment variable or Kubernetes default kubeconfig path). Fix the kubeconfig and try again.',
        );
        expect(context.telemetry.properties.kubeconfigSourceResult).toBe('noContexts');
    });
});

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
        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('inline-1');
    });

    it('does not fail add source when reveal fails', async () => {
        const ui = createInlineSelectingUi();
        const context = makeContext(ui);
        mockShowWarningMessage.mockResolvedValue('Continue');
        mockReadText.mockResolvedValue('apiVersion: v1\nkind: Config\ncontexts:\n- name: test');
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([{ name: 'test' }]);
        mockAddInlineSource.mockResolvedValue({ id: 'inline-1', label: 'Pasted YAML 1', kind: 'inline' });
        mockRevealKubernetesSource.mockRejectedValue(new Error('Tree not ready'));

        await expect(addKubeconfigSource(context)).resolves.toEqual({
            id: 'inline-1',
            label: 'Pasted YAML 1',
            kind: 'inline',
        });

        expect(mockRefreshKubernetesRoot).toHaveBeenCalledTimes(1);
        expect(mockRevealKubernetesSource).toHaveBeenCalledWith('inline-1');
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
