/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { type KubeconfigSourceRecord } from '../config';
import { type KubeContextInfo } from '../kubernetesClient';
import { KubernetesWizardProperties } from './SelectContextStep';

const mockReadSources = jest.fn<Promise<KubeconfigSourceRecord[]>, []>();
const mockLoadConfiguredKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockAliasMapForSource = jest.fn();
const mockAddKubeconfigSource = jest.fn();
const mockShowInformationMessage = jest.fn();

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardExecuteStep: class AzureWizardExecuteStep {},
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    UserCancelledError: class UserCancelledError extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'UserCancelledError';
        }
    },
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: 1 },
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
    window: {
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    },
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

jest.mock('../sources/sourceStore', () => ({
    readSources: () => mockReadSources(),
}));

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
}));

jest.mock('../sources/aliasStore', () => ({
    aliasMapForSource: (...args: unknown[]) => mockAliasMapForSource(...args),
}));

jest.mock('../commands/addKubeconfigSource', () => ({
    addKubeconfigSource: (...args: unknown[]) => mockAddKubeconfigSource(...args),
}));

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { SelectContextStep } from './SelectContextStep';

interface CapturedPick {
    label: string;
    detail?: string;
    description?: string;
    data: unknown;
    kind?: number;
    iconPath?: unknown;
    alwaysShow?: boolean;
}

interface MockUi {
    readonly showQuickPick: jest.Mock;
    readonly showInputBox: jest.Mock;
    readonly onDidFinishPrompt: jest.Mock;
    readonly showWarningMessage: jest.Mock;
    readonly showOpenDialog: jest.Mock;
    readonly showWorkspaceFolderPick: jest.Mock;
}

function createUi(): MockUi {
    return {
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        onDidFinishPrompt: jest.fn(),
        showWarningMessage: jest.fn(),
        showOpenDialog: jest.fn(),
        showWorkspaceFolderPick: jest.fn(),
    };
}

function createWizardContext(): NewConnectionWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: createUi(),
        valuesToMask: [],
        parentId: '',
        properties: {},
    } as unknown as NewConnectionWizardContext;
}

const testSource: KubeconfigSourceRecord = {
    id: 'src-1',
    kind: 'file',
    label: 'team.yaml',
    path: '/abs/team.yaml',
};

const testContext: KubeContextInfo = {
    name: 'kind-dev',
    cluster: 'kind-dev',
    user: 'kind-dev-user',
    server: 'https://127.0.0.1:6443',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockAliasMapForSource.mockResolvedValue(new Map());
});

describe('SelectContextStep', () => {
    it('"Add source" action is always the first non-separator item', async () => {
        mockReadSources.mockResolvedValue([testSource]);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([testContext]);

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        // Simulate selecting the real context so the step completes normally
        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const contextPick = picks.find((p) => typeof p.data !== 'string');
            return Promise.resolve(contextPick);
        });

        await new SelectContextStep().prompt(context);

        const picks: CapturedPick[] = ui.showQuickPick.mock.calls[0][0] as CapturedPick[];
        expect(picks[0].data).toBe('addSource');
        expect(picks[0].label).toBe('Add Kubeconfig\u2026');
        expect(picks[0].alwaysShow).toBe(true);
    });

    it('"Add source" action present when zero sources', async () => {
        mockReadSources.mockResolvedValue([]);

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        // Simulate selecting the add-source action
        mockAddKubeconfigSource.mockResolvedValue(undefined);
        mockShowInformationMessage.mockResolvedValue(undefined);
        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const addPick = picks.find((p) => p.data === 'addSource' && p.kind === undefined);
            return Promise.resolve(addPick);
        });

        await expect(new SelectContextStep().prompt(context)).rejects.toThrow(UserCancelledError);

        const picks: CapturedPick[] = ui.showQuickPick.mock.calls[0][0] as CapturedPick[];
        expect(picks.some((p) => p.data === 'addSource' && p.kind === undefined)).toBe(true);
        expect(ui.showQuickPick).toHaveBeenCalled();
    });

    it('"Add source" action present when all sources fail to load', async () => {
        mockReadSources.mockResolvedValue([testSource]);
        mockLoadConfiguredKubeConfig.mockRejectedValue(new Error('load failed'));

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        mockAddKubeconfigSource.mockResolvedValue(undefined);
        mockShowInformationMessage.mockResolvedValue(undefined);
        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const addPick = picks.find((p) => p.data === 'addSource' && p.kind === undefined);
            return Promise.resolve(addPick);
        });

        await expect(new SelectContextStep().prompt(context)).rejects.toThrow(UserCancelledError);

        const picks: CapturedPick[] = ui.showQuickPick.mock.calls[0][0] as CapturedPick[];
        // Only the action item and separator should be present (no context items)
        expect(picks).toHaveLength(2);
        expect(picks[0].data).toBe('addSource');
        expect(picks[0].label).toBe('Add Kubeconfig\u2026');
    });

    it('selecting "Add source" runs addKubeconfigSource', async () => {
        mockReadSources.mockResolvedValue([testSource]);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([testContext]);

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        mockAddKubeconfigSource.mockResolvedValue(undefined);
        mockShowInformationMessage.mockResolvedValue(undefined);
        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const addPick = picks.find((p) => p.data === 'addSource' && p.kind === undefined);
            return Promise.resolve(addPick);
        });

        await expect(new SelectContextStep().prompt(context)).rejects.toThrow(UserCancelledError);

        expect(mockAddKubeconfigSource).toHaveBeenCalledWith(context);
        expect(mockShowInformationMessage).toHaveBeenCalled();
    });

    it('selecting a real context sets wizard properties correctly', async () => {
        mockReadSources.mockResolvedValue([testSource]);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([testContext]);

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const contextPick = picks.find((p) => typeof p.data !== 'string');
            return Promise.resolve(contextPick);
        });

        await new SelectContextStep().prompt(context);

        expect(context.properties[KubernetesWizardProperties.SelectedSourceId]).toBe(testSource.id);
        expect(context.properties[KubernetesWizardProperties.SelectedSourceLabel]).toBe(testSource.label);
        expect(context.properties[KubernetesWizardProperties.SelectedContext]).toBe(testContext);
    });

    it('separator appears between action and context items', async () => {
        mockReadSources.mockResolvedValue([testSource]);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([testContext]);

        const context = createWizardContext();
        const ui = context.ui as unknown as MockUi;

        ui.showQuickPick.mockImplementation((picks: CapturedPick[]) => {
            const contextPick = picks.find((p) => typeof p.data !== 'string');
            return Promise.resolve(contextPick);
        });

        await new SelectContextStep().prompt(context);

        const picks: CapturedPick[] = ui.showQuickPick.mock.calls[0][0] as CapturedPick[];
        // QuickPickItemKind.Separator = 1
        expect(picks[1].kind).toBe(1);
        expect(picks[1].label).toBe('');
    });
});
