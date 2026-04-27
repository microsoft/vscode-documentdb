/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ENABLED_CONTEXTS_KEY, FILTERED_NAMESPACES_KEY, HIDDEN_CONTEXTS_KEY } from '../config';
import { configureKubernetesFilter } from './configureKubernetesFilter';
import { FilterContextsStep } from './FilterContextsStep';
import { type KubernetesFilterWizardContext } from './KubernetesFilterWizardContext';

const mockGlobalStateGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
const mockGlobalStateUpdate = jest.fn((_key: string, _value: unknown) => Promise.resolve());
const mockAppendLine = jest.fn();
const mockLoadConfiguredKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListNamespaces = jest.fn();
const mockAzureWizardPrompt = jest.fn((_context?: KubernetesFilterWizardContext) => Promise.resolve());
let mockLatestWizardContext: KubernetesFilterWizardContext | undefined;

jest.mock('@microsoft/vscode-azext-utils', () => {
    class MockAzureWizardPromptStep {}
    class MockAzureWizard {
        constructor(context: unknown) {
            mockLatestWizardContext = context as KubernetesFilterWizardContext;
        }

        public async prompt(): Promise<void> {
            await mockAzureWizardPrompt(mockLatestWizardContext);
        }
    }

    return {
        AzureWizard: MockAzureWizard,
        AzureWizardPromptStep: MockAzureWizardPromptStep,
    };
});

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    window: {
        showWarningMessage: jest.fn(),
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
        outputChannel: {
            appendLine: (...args: unknown[]) => mockAppendLine(...args),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    listNamespaces: (...args: unknown[]) => mockListNamespaces(...args),
}));

function createActionContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {},
        valuesToMask: [],
    } as unknown as IActionContext;
}

describe('configureKubernetesFilter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLatestWizardContext = undefined;
        mockGlobalStateGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);
        mockLoadConfiguredKubeConfig.mockResolvedValue({});
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
        mockAzureWizardPrompt.mockImplementation(async (wizardContext?: KubernetesFilterWizardContext) => {
            if (!wizardContext) {
                throw new Error('Expected Kubernetes filter wizard context.');
            }

            wizardContext.visibleContextNames = ['ctx-a'];
        });
    });

    it('persists hidden contexts without modifying enabled contexts and clears stale namespace filters', async () => {
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === ENABLED_CONTEXTS_KEY) {
                return ['ctx-a', 'ctx-b'];
            }
            if (key === HIDDEN_CONTEXTS_KEY) {
                return ['ctx-b'];
            }
            if (key === FILTERED_NAMESPACES_KEY) {
                return { 'ctx-a': ['default'] };
            }

            return defaultValue;
        });

        const context = createActionContext();

        await configureKubernetesFilter(context);

        expect(mockLatestWizardContext).toMatchObject({
            enabledContextNames: ['ctx-a', 'ctx-b'],
            visibleContextNames: ['ctx-a'],
        });
        expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, ['ctx-b']);
        expect(mockGlobalStateUpdate).toHaveBeenCalledWith(FILTERED_NAMESPACES_KEY, {});
        const updatedKeys = (mockGlobalStateUpdate.mock.calls as Array<[string, unknown]>).map(([key]) => key);
        expect(updatedKeys).not.toContain(ENABLED_CONTEXTS_KEY);
        expect(mockAppendLine).toHaveBeenCalledWith('Kubernetes discovery filters updated.');
    });

    it('treats unconfigured enabled contexts as all kubeconfig contexts for filtering', async () => {
        const context = createActionContext();

        await configureKubernetesFilter(context);

        expect(mockLatestWizardContext?.enabledContextNames).toEqual(['ctx-a', 'ctx-b']);
        expect(mockGlobalStateUpdate).toHaveBeenCalledWith(HIDDEN_CONTEXTS_KEY, ['ctx-b']);
    });

    it('preselects all enabled contexts when no filter has been saved', async () => {
        let initialVisibleContextNames: string[] | undefined;
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === ENABLED_CONTEXTS_KEY) {
                return ['ctx-a', 'ctx-b'];
            }

            return defaultValue;
        });
        mockAzureWizardPrompt.mockImplementationOnce(async (wizardContext?: KubernetesFilterWizardContext) => {
            if (!wizardContext) {
                throw new Error('Expected Kubernetes filter wizard context.');
            }

            initialVisibleContextNames = [...wizardContext.visibleContextNames];
            wizardContext.visibleContextNames = ['ctx-a'];
        });

        const context = createActionContext();

        await configureKubernetesFilter(context);

        expect(mockLatestWizardContext).toMatchObject({
            enabledContextNames: ['ctx-a', 'ctx-b'],
            visibleContextNames: ['ctx-a'],
        });
        expect(initialVisibleContextNames).toEqual(['ctx-a', 'ctx-b']);
    });

    it('preselects currently visible contexts when reopening an existing filter', async () => {
        let initialVisibleContextNames: string[] | undefined;
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === ENABLED_CONTEXTS_KEY) {
                return ['ctx-a', 'ctx-b'];
            }
            if (key === HIDDEN_CONTEXTS_KEY) {
                return ['ctx-b'];
            }

            return defaultValue;
        });
        mockAzureWizardPrompt.mockImplementationOnce(async (wizardContext?: KubernetesFilterWizardContext) => {
            if (!wizardContext) {
                throw new Error('Expected Kubernetes filter wizard context.');
            }

            initialVisibleContextNames = [...wizardContext.visibleContextNames];
            wizardContext.visibleContextNames = ['ctx-a'];
        });

        const context = createActionContext();

        await configureKubernetesFilter(context);

        expect(mockLatestWizardContext).toMatchObject({
            enabledContextNames: ['ctx-a', 'ctx-b'],
            visibleContextNames: ['ctx-a'],
        });
        expect(initialVisibleContextNames).toEqual(['ctx-a']);
    });
});

describe('FilterContextsStep', () => {
    it('uses isPickSelected so the Azure wizard multi-select honors visible contexts', async () => {
        const step = new FilterContextsStep();
        const showQuickPick = jest.fn(
            async (picks: unknown[], options: { isPickSelected: (pick: unknown) => boolean }) => {
                const selected = picks.filter((pick) => options.isPickSelected(pick));
                expect(selected).toMatchObject([{ data: 'ctx-a' }]);
                return selected;
            },
        );
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: { issueProperties: {} },
            ui: { showQuickPick },
            valuesToMask: [],
            enabledContextNames: ['ctx-a', 'ctx-b'],
            visibleContextNames: ['ctx-a'],
        } as unknown as KubernetesFilterWizardContext;

        await step.prompt(context);

        expect(showQuickPick).toHaveBeenCalledWith(
            [
                { label: 'ctx-a', data: 'ctx-a' },
                { label: 'ctx-b', data: 'ctx-b' },
            ],
            expect.objectContaining({
                canPickMany: true,
                suppressPersistence: true,
                isPickSelected: expect.any(Function),
            }),
        );
        expect(context.visibleContextNames).toEqual(['ctx-a']);
    });
});
