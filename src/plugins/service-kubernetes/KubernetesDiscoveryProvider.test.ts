/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

const mockStopAll = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string) => message),
    },
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn().mockReturnValue([]),
                update: jest.fn(),
            },
            extensionUri: {},
        },
        discoveryBranchDataProvider: {
            refresh: jest.fn(),
            resetNodeErrorState: jest.fn(),
        },
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            trace: jest.fn(),
            warn: jest.fn(),
        },
        secretStorage: {
            get: jest.fn(),
            store: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
    AzureWizardPromptStep: class AzureWizardPromptStep<T> {
        public async prompt(_context: T): Promise<void> {}
        public shouldPrompt(): boolean {
            return true;
        }
    },
    AzureWizardExecuteStep: class AzureWizardExecuteStep<T> {
        public async execute(_context: T): Promise<void> {}
        public shouldExecute(): boolean {
            return true;
        }
    },
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('./sources/migrationV2', () => ({
    ensureMigration: jest.fn(async () => undefined),
}));

jest.mock('./portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: jest.fn(() => ({
            stopAll: mockStopAll,
        })),
    },
}));

import { DISCOVERY_PROVIDER_ID } from './config';
import { KubernetesRootItem } from './discovery-tree/KubernetesRootItem';
import { KubernetesDiscoveryProvider } from './KubernetesDiscoveryProvider';

describe('KubernetesDiscoveryProvider (v2)', () => {
    let provider: KubernetesDiscoveryProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new KubernetesDiscoveryProvider();
    });

    it('exposes the canonical provider id', () => {
        expect(provider.id).toBe(DISCOVERY_PROVIDER_ID);
        expect(provider.id).toBe('kubernetes-discovery');
    });

    it('does not request credential configuration on activation in v2', () => {
        expect(provider.configureCredentialsOnActivation).toBe(false);
    });

    it('does not implement configureCredentials', () => {
        // configureCredentials is an optional method on DiscoveryProvider;
        // the Kubernetes plugin should not define it.
        expect('configureCredentials' in provider).toBe(false);
    });

    it('returns a KubernetesRootItem with the standard tree id', () => {
        const rootItem = provider.getDiscoveryTreeRootItem('discoveryView');
        expect(rootItem).toBeInstanceOf(KubernetesRootItem);
        expect(rootItem.id).toBe('discoveryView/kubernetes-discovery');
    });

    it('returns wizard options with prompt and execute steps', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wizardOptions = provider.getDiscoveryWizard({} as any);
        expect(wizardOptions.promptSteps).toBeDefined();
        expect(wizardOptions.promptSteps!.length).toBeGreaterThan(0);
        expect(wizardOptions.executeSteps).toBeDefined();
        expect(wizardOptions.executeSteps!.length).toBeGreaterThan(0);
    });

    it('stops port-forward tunnels when the provider is deactivated', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;

        await provider.deactivate(context);
        expect(mockStopAll).toHaveBeenCalledTimes(1);
    });
});
