/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ENABLED_CONTEXTS_KEY, HIDDEN_CONTEXTS_KEY } from '../config';
import { type KubeContextInfo, type KubeServiceInfo } from '../kubernetesClient';
import { KubernetesWizardProperties, SelectContextStep } from './SelectContextStep';
import { SelectServiceStep } from './SelectServiceStep';

const mockShowWarningMessage = jest.fn();
const mockGlobalStateGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
const mockLoadConfiguredKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListNamespaces = jest.fn();
const mockListDocumentDBServices = jest.fn();
const mockOutputChannelWarn = jest.fn();

jest.mock('@microsoft/vscode-azext-utils', () => {
    class MockAzureWizardPromptStep {}
    class MockUserCancelledError extends Error {}

    return {
        AzureWizardPromptStep: MockAzureWizardPromptStep,
        UserCancelledError: MockUserCancelledError,
    };
});

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
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
            },
        },
        outputChannel: {
            warn: (...args: unknown[]) => mockOutputChannelWarn(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    listNamespaces: (...args: unknown[]) => mockListNamespaces(...args),
    listDocumentDBServices: (...args: unknown[]) => mockListDocumentDBServices(...args),
}));

interface MockUi {
    showQuickPick: jest.Mock;
    showInputBox: jest.Mock;
    onDidFinishPrompt: jest.Mock;
    showWarningMessage: jest.Mock;
    showOpenDialog: jest.Mock;
    showWorkspaceFolderPick: jest.Mock;
}

interface QuickPickItem<T> {
    readonly label: string;
    readonly data: T;
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

function createWizardContext(properties: Record<string, unknown> = {}): NewConnectionWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: createUi(),
        valuesToMask: [],
        parentId: 'connections',
        properties,
    } as unknown as NewConnectionWizardContext;
}

function getShownQuickPickItems<T>(ui: MockUi): QuickPickItem<T>[] {
    const [items] = ui.showQuickPick.mock.calls[0] as [QuickPickItem<T>[], unknown];
    return items;
}

describe('Kubernetes discovery wizard filter consistency', () => {
    const contextA: KubeContextInfo = {
        name: 'ctx-a',
        cluster: 'cluster-a',
        user: 'user-a',
        server: 'https://ctx-a.example.com',
    };
    const contextB: KubeContextInfo = {
        name: 'ctx-b',
        cluster: 'cluster-b',
        user: 'user-b',
        server: 'https://ctx-b.example.com',
    };
    const hiddenContext: KubeContextInfo = {
        name: 'ctx-hidden',
        cluster: 'cluster-hidden',
        user: 'user-hidden',
        server: 'https://ctx-hidden.example.com',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalStateGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
        mockGetContexts.mockReturnValue([contextA, contextB, hiddenContext]);
        mockCreateCoreApi.mockResolvedValue({});
        mockListDocumentDBServices.mockResolvedValue([]);
    });

    describe('SelectContextStep', () => {
        it('offers only enabled contexts that are not hidden', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === ENABLED_CONTEXTS_KEY) {
                    return [contextA.name, hiddenContext.name];
                }
                if (key === HIDDEN_CONTEXTS_KEY) {
                    return [hiddenContext.name];
                }

                return defaultValue;
            });

            const step = new SelectContextStep();
            const context = createWizardContext();
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: contextA });

            await step.prompt(context);

            const shownContexts = getShownQuickPickItems<KubeContextInfo>(ui).map((item) => item.data.name);
            expect(shownContexts).toEqual([contextA.name]);
            expect(context.properties[KubernetesWizardProperties.SelectedContext]).toBe(contextA);
        });

        it('treats unconfigured enabled contexts as all kubeconfig contexts while still excluding hidden contexts', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === HIDDEN_CONTEXTS_KEY) {
                    return [hiddenContext.name];
                }

                return defaultValue;
            });

            const step = new SelectContextStep();
            const context = createWizardContext();
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: contextA });

            await step.prompt(context);

            const shownContexts = getShownQuickPickItems<KubeContextInfo>(ui).map((item) => item.data.name);
            expect(shownContexts).toEqual([contextA.name, contextB.name]);
        });

        it('shows localized guidance when no visible contexts remain', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === ENABLED_CONTEXTS_KEY) {
                    return [contextA.name];
                }
                if (key === HIDDEN_CONTEXTS_KEY) {
                    return [contextA.name];
                }

                return defaultValue;
            });

            const step = new SelectContextStep();
            const context = createWizardContext();
            const ui = context.ui as MockUi;

            await expect(step.prompt(context)).rejects.toBeInstanceOf(UserCancelledError);

            expect(ui.showQuickPick).not.toHaveBeenCalled();
            expect(mockShowWarningMessage).toHaveBeenCalledWith(
                'No visible Kubernetes contexts remain. Use Filter to show hidden contexts or Manage Credentials to enable contexts.',
            );
        });
    });

    describe('SelectServiceStep', () => {
        function createService(overrides: Partial<KubeServiceInfo> = {}): KubeServiceInfo {
            return {
                sourceKind: 'dko',
                name: 'documentdb-service-orders',
                displayName: 'orders',
                serviceName: 'documentdb-service-orders',
                namespace: 'production',
                type: 'LoadBalancer',
                port: 10260,
                externalAddress: '10.0.0.5',
                ...overrides,
            };
        }

        it('scans all namespaces and offers discovered services directly', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'production']);
            const productionService = createService();
            mockListDocumentDBServices.mockImplementation(async (_coreApi: unknown, namespace: string) =>
                namespace === 'production' ? [productionService] : [],
            );

            const step = new SelectServiceStep();
            const context = createWizardContext({
                [KubernetesWizardProperties.SelectedContext]: contextA,
            });
            const ui = context.ui as MockUi;
            ui.showQuickPick.mockResolvedValue({ data: productionService });

            await step.prompt(context);

            expect(mockListDocumentDBServices).toHaveBeenCalledWith({}, 'default', {});
            expect(mockListDocumentDBServices).toHaveBeenCalledWith({}, 'production', {});
            const shownServices = getShownQuickPickItems<KubeServiceInfo>(ui).map((item) => item.data);
            expect(shownServices).toEqual([productionService]);
            expect(context.properties[KubernetesWizardProperties.SelectedService]).toBe(productionService);
        });

        it('shows localized guidance when no namespaces exist', async () => {
            mockListNamespaces.mockResolvedValue([]);
            const step = new SelectServiceStep();
            const context = createWizardContext({
                [KubernetesWizardProperties.SelectedContext]: contextA,
            });
            const ui = context.ui as MockUi;

            await expect(step.prompt(context)).rejects.toBeInstanceOf(UserCancelledError);

            expect(ui.showQuickPick).not.toHaveBeenCalled();
            expect(mockShowWarningMessage).toHaveBeenCalledWith('No namespaces found in context "ctx-a".');
        });

        it('shows localized guidance when no services are discovered in any namespace', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'production']);
            const step = new SelectServiceStep();
            const context = createWizardContext({
                [KubernetesWizardProperties.SelectedContext]: contextA,
            });
            const ui = context.ui as MockUi;

            await expect(step.prompt(context)).rejects.toBeInstanceOf(UserCancelledError);

            expect(ui.showQuickPick).not.toHaveBeenCalled();
            expect(mockShowWarningMessage).toHaveBeenCalledWith(
                'No DocumentDB targets were found in context "ctx-a". DKO resources are preferred, and generic fallback currently looks for DocumentDB gateway services.',
            );
        });
    });
});
