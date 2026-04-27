/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import {
    CUSTOM_KUBECONFIG_PATH_KEY,
    ENABLED_CONTEXTS_KEY,
    FILTERED_NAMESPACES_KEY,
    HIDDEN_CONTEXTS_KEY,
    INLINE_KUBECONFIG_SECRET_KEY,
    KUBECONFIG_SOURCE_KEY,
    type KubeconfigSource,
} from '../config';
import { configureKubernetesCredentials } from './configureKubernetesCredentials';
import { ExecuteStep } from './ExecuteStep';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';
import { SelectKubeconfigSourceStep } from './SelectKubeconfigSourceStep';

const mockShowOpenDialog = jest.fn();
const mockShowWarningMessage = jest.fn();
const mockShowInformationMessage = jest.fn();
const mockClipboardReadText = jest.fn();
const mockGlobalStateGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
const mockGlobalStateUpdate = jest.fn((_key?: string, _value?: unknown) => Promise.resolve());
const mockSecretGet = jest.fn();
const mockSecretStore = jest.fn((_key?: string, _value?: string) => Promise.resolve());
const mockSecretDelete = jest.fn((_key?: string) => Promise.resolve());
const mockLoadKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockAppendLine = jest.fn();
const mockAzureWizardPrompt = jest.fn(() => Promise.resolve());
const mockAzureWizardExecute = jest.fn(() => Promise.resolve());
let latestAzureWizardOptions: unknown;

jest.mock('@microsoft/vscode-azext-utils', () => {
    class MockAzureWizardPromptStep {}
    class MockAzureWizardExecuteStep {}
    class MockUserCancelledError extends Error {}
    class MockAzureWizard {
        constructor(_context: unknown, options: unknown) {
            latestAzureWizardOptions = options;
        }

        public async prompt(): Promise<void> {
            await mockAzureWizardPrompt();
        }

        public async execute(): Promise<void> {
            await mockAzureWizardExecute();
        }
    }

    return {
        AzureWizard: MockAzureWizard,
        AzureWizardPromptStep: MockAzureWizardPromptStep,
        AzureWizardExecuteStep: MockAzureWizardExecuteStep,
        UserCancelledError: MockUserCancelledError,
    };
});

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    window: {
        showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
        showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    },
    env: {
        clipboard: {
            readText: (...args: unknown[]) => mockClipboardReadText(...args),
        },
    },
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (key: string, defaultValue?: unknown) => mockGlobalStateGet(key, defaultValue),
                update: (key: string, value: unknown) => mockGlobalStateUpdate(key, value),
            },
        },
        secretStorage: {
            get: (key: string) => mockSecretGet(key),
            store: (key: string, value: string) => mockSecretStore(key, value),
            delete: (key: string) => mockSecretDelete(key),
        },
        outputChannel: {
            appendLine: (...args: unknown[]) => mockAppendLine(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadKubeConfig: (...args: unknown[]) => mockLoadKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
}));

interface MockUi {
    showQuickPick: jest.Mock;
    showInputBox: jest.Mock;
    onDidFinishPrompt: jest.Mock;
    showWarningMessage: jest.Mock;
    showOpenDialog: jest.Mock;
    showWorkspaceFolderPick: jest.Mock;
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

function createWizardContext(
    overrides: Partial<KubernetesCredentialsWizardContext> = {},
): KubernetesCredentialsWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: createUi(),
        valuesToMask: [],
        availableContexts: [],
        // undefined = never explicitly configured (default: show all)
        selectedContextNames: undefined,
        customKubeconfigPath: '',
        kubeconfigSource: 'default',
        inlineKubeconfigYaml: '',
        resetFilters: false,
        kubeconfigChanged: false,
        ...overrides,
    } as unknown as KubernetesCredentialsWizardContext;
}

describe('Kubernetes credential wizard steps', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalStateGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);
        mockSecretGet.mockResolvedValue(undefined);
        mockLoadKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([
            {
                name: 'ctx-a',
                cluster: 'cluster-a',
                user: 'user-a',
                server: 'https://ctx-a.example.com',
            },
            {
                name: 'ctx-b',
                cluster: 'cluster-b',
                user: 'user-b',
                server: 'https://ctx-b.example.com',
            },
        ]);
        latestAzureWizardOptions = undefined;
    });

    describe('configureKubernetesCredentials', () => {
        it('includes only kubeconfig source selection by default', async () => {
            const context = createWizardContext();

            const result = await configureKubernetesCredentials(context);

            expect(mockAzureWizardPrompt).toHaveBeenCalledTimes(1);
            expect(mockAzureWizardExecute).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ kubeconfigChanged: false });
            expect(latestAzureWizardOptions).toMatchObject({
                promptSteps: [expect.any(SelectKubeconfigSourceStep)],
                executeSteps: [expect.any(ExecuteStep)],
            });
        });
    });

    describe('SelectKubeconfigSourceStep', () => {
        it('stores kubeconfig YAML copied to the clipboard without loading contexts', async () => {
            const step = new SelectKubeconfigSourceStep();
            const context = createWizardContext();
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: 'inline' satisfies KubeconfigSource });

            mockClipboardReadText.mockResolvedValue('apiVersion: v1');

            await step.prompt(context);

            expect(context.kubeconfigSource).toBe('inline');
            expect(context.inlineKubeconfigYaml).toBe('apiVersion: v1');
            expect(context.availableContexts).toHaveLength(0);
            expect(mockLoadKubeConfig).not.toHaveBeenCalled();
            expect(mockGetContexts).not.toHaveBeenCalled();
        });

        it('cancels when the clipboard does not contain kubeconfig YAML', async () => {
            const step = new SelectKubeconfigSourceStep();
            const context = createWizardContext();
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: 'inline' satisfies KubeconfigSource });

            mockClipboardReadText.mockResolvedValue('   ');

            await expect(step.prompt(context)).rejects.toBeInstanceOf(UserCancelledError);
            expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);
            expect(mockLoadKubeConfig).not.toHaveBeenCalled();
        });

        it('reuses stored inline kubeconfig YAML when clipboard text is empty', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) {
                    return 'inline';
                }

                return defaultValue;
            });
            mockSecretGet.mockResolvedValue('apiVersion: v1');

            const step = new SelectKubeconfigSourceStep();
            const context = createWizardContext({
                kubeconfigSource: 'inline',
            });
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: 'inline' satisfies KubeconfigSource });

            mockClipboardReadText.mockResolvedValue('');

            await step.prompt(context);

            expect(context.inlineKubeconfigYaml).toBe('apiVersion: v1');
            expect(mockSecretGet).toHaveBeenCalledWith(INLINE_KUBECONFIG_SECRET_KEY);
            expect(mockLoadKubeConfig).not.toHaveBeenCalled();
            expect(mockGetContexts).not.toHaveBeenCalled();
        });
    });

    describe('ExecuteStep', () => {
        it('stores inline kubeconfig YAML in secure storage', async () => {
            const step = new ExecuteStep();
            const context = createWizardContext({
                selectedContextNames: ['ctx-a'],
                kubeconfigSource: 'inline',
                inlineKubeconfigYaml: 'apiVersion: v1',
            });

            await step.execute(context);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(ENABLED_CONTEXTS_KEY, ['ctx-a']);
            // Source changed (default → inline) → filters reset
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(KUBECONFIG_SOURCE_KEY, 'inline');
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(CUSTOM_KUBECONFIG_PATH_KEY, undefined);
            expect(mockSecretStore).toHaveBeenCalledWith(INLINE_KUBECONFIG_SECRET_KEY, 'apiVersion: v1');
            expect(mockSecretDelete).not.toHaveBeenCalled();
            expect(context.kubeconfigChanged).toBe(true);
            expect(context.availableContexts).toHaveLength(2);
            expect(context.telemetry.measurements.kubeconfigContextsCount).toBe(2);
            expect(context.telemetry.properties.credentialsManagementResult).toBe('Succeeded');
            expect(mockShowInformationMessage).toHaveBeenCalledWith(
                'Kubernetes discovery configured. Found 2 context(s) in the selected kubeconfig.',
            );
        });

        it('validates default kubeconfig before storing settings', async () => {
            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'default',
            });

            await step.execute(context);

            expect(mockLoadKubeConfig).toHaveBeenCalledWith();
            expect(mockGetContexts).toHaveBeenCalledWith({});
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(ENABLED_CONTEXTS_KEY, undefined);
        });

        it('validates custom kubeconfig before storing settings', async () => {
            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'customFile',
                customKubeconfigPath: '/home/user/.kube/documentdb',
            });

            await step.execute(context);

            expect(mockLoadKubeConfig).toHaveBeenCalledWith('/home/user/.kube/documentdb');
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(KUBECONFIG_SOURCE_KEY, 'customFile');
        });

        it('does not persist settings when kubeconfig validation fails', async () => {
            mockLoadKubeConfig.mockRejectedValue(new Error('No Kubernetes kubeconfig was found.'));
            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'default',
            });

            await expect(step.execute(context)).rejects.toThrow('No Kubernetes kubeconfig was found.');

            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockSecretStore).not.toHaveBeenCalled();
            expect(mockSecretDelete).not.toHaveBeenCalled();
            expect(context.telemetry.properties.credentialsManagementResult).toBe('FailedValidation');
        });

        it('does not persist settings when the selected kubeconfig has no contexts', async () => {
            mockGetContexts.mockReturnValue([]);
            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'inline',
                inlineKubeconfigYaml: 'apiVersion: v1',
            });

            await expect(step.execute(context)).rejects.toThrow(
                'No Kubernetes contexts were found in the selected kubeconfig. Choose a different kubeconfig source or update the file and try again.',
            );

            expect(mockLoadKubeConfig).toHaveBeenCalledWith(undefined, 'apiVersion: v1');
            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockSecretStore).not.toHaveBeenCalled();
            expect(context.telemetry.properties.credentialsManagementResult).toBe('FailedValidation');
        });

        it('stores empty context list when user explicitly selects zero contexts', async () => {
            const step = new ExecuteStep();
            const context = createWizardContext({
                selectedContextNames: [],
                kubeconfigSource: 'default',
            });

            await step.execute(context);

            // [] means "all disabled" — stored as-is, not converted to undefined
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(ENABLED_CONTEXTS_KEY, []);
            // Source unchanged (default → default) → filters NOT reset
            expect(mockGlobalStateUpdate).not.toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).not.toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
            expect(mockAppendLine).toHaveBeenCalledWith(
                'Kubernetes discovery configured with no contexts enabled. Discovery is effectively disabled.',
            );
        });

        it('stores undefined when selectedContextNames was never set (default all)', async () => {
            const step = new ExecuteStep();
            // selectedContextNames: undefined in createWizardContext default
            const context = createWizardContext({
                kubeconfigSource: 'default',
            });

            await step.execute(context);

            // undefined = "never configured" → resolveEnabledContextNames falls back to all
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(ENABLED_CONTEXTS_KEY, undefined);
            expect(mockAppendLine).toHaveBeenCalledWith(
                'Kubernetes discovery configured. All contexts from the selected kubeconfig are enabled by default.',
            );
            expect(context.kubeconfigChanged).toBe(false);
        });

        it('clears stored inline kubeconfig YAML when switching back to non-inline sources', async () => {
            const step = new ExecuteStep();
            const context = createWizardContext({
                selectedContextNames: ['ctx-a'],
                kubeconfigSource: 'default',
            });

            await step.execute(context);

            expect(mockSecretDelete).toHaveBeenCalledWith(INLINE_KUBECONFIG_SECRET_KEY);
        });

        it('resets filters when kubeconfig source changes', async () => {
            // Simulate previously stored source = 'default'; new selection = 'customFile'
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) return 'default';
                return defaultValue;
            });

            const step = new ExecuteStep();
            const context = createWizardContext({
                selectedContextNames: ['ctx-a'],
                kubeconfigSource: 'customFile',
                customKubeconfigPath: '/home/user/.kube/my-config',
            });

            await step.execute(context);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
        });

        it('resets filters when custom kubeconfig path changes', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) return 'customFile';
                if (key === CUSTOM_KUBECONFIG_PATH_KEY) return '/home/user/.kube/old-config';
                return defaultValue;
            });

            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'customFile',
                customKubeconfigPath: '/home/user/.kube/new-config',
            });

            await step.execute(context);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
        });

        it('resets filters when requested even if kubeconfig source is unchanged', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) return 'default';
                return defaultValue;
            });

            const step = new ExecuteStep();
            const context = createWizardContext({
                kubeconfigSource: 'default',
                resetFilters: true,
            });

            await step.execute(context);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
        });

        it('preserves filters when kubeconfig source is unchanged', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) return 'default';
                return defaultValue;
            });

            const step = new ExecuteStep();
            const context = createWizardContext({
                selectedContextNames: ['ctx-a'],
                kubeconfigSource: 'default', // same as stored
            });

            await step.execute(context);

            expect(mockGlobalStateUpdate).not.toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, []);
            expect(mockGlobalStateUpdate).not.toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
        });
    });
});
