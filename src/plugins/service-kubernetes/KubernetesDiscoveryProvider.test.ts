/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DISCOVERY_PROVIDER_ID } from './config';
import { KubernetesRootItem } from './discovery-tree/KubernetesRootItem';
import { KubernetesDiscoveryProvider } from './KubernetesDiscoveryProvider';

const mockConfigureKubernetesCredentials = jest.fn();
const mockStopAll = jest.fn();

// Mock extensionVariables
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
        },
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            trace: jest.fn(),
        },
    },
}));

jest.mock('./credentials/configureKubernetesCredentials', () => ({
    configureKubernetesCredentials: (...args: unknown[]) => mockConfigureKubernetesCredentials(...args),
}));

jest.mock('./portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: jest.fn(() => ({
            stopAll: mockStopAll,
        })),
    },
}));

describe('KubernetesDiscoveryProvider', () => {
    let provider: KubernetesDiscoveryProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigureKubernetesCredentials.mockResolvedValue({ kubeconfigChanged: false });
        provider = new KubernetesDiscoveryProvider();
    });

    it('should have the correct provider ID', () => {
        expect(provider.id).toBe(DISCOVERY_PROVIDER_ID);
        expect(provider.id).toBe('kubernetes-discovery');
    });

    it('should have a label and description', () => {
        expect(provider.label).toBeTruthy();
        expect(provider.description).toBeTruthy();
    });

    it('should have an icon path', () => {
        expect(provider.iconPath).toBeDefined();
    });

    it('should prompt for kubeconfig selection during provider activation', () => {
        expect(provider.configureCredentialsOnActivation).toBe(true);
    });

    it('should return a KubernetesRootItem from getDiscoveryTreeRootItem', () => {
        const rootItem = provider.getDiscoveryTreeRootItem('discoveryView');
        expect(rootItem).toBeInstanceOf(KubernetesRootItem);
        expect(rootItem.id).toBe('discoveryView/kubernetes-discovery');
    });

    it('should return a learn more URL', () => {
        const url = provider.getLearnMoreUrl();
        expect(url).toBe('https://documentdb.io/documentdb-kubernetes-operator/latest/preview/');
    });

    it('should return wizard options with prompt and execute steps', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wizardOptions = provider.getDiscoveryWizard({} as any);
        expect(wizardOptions.promptSteps).toBeDefined();
        expect(wizardOptions.promptSteps!.length).toBeGreaterThan(0);
        expect(wizardOptions.executeSteps).toBeDefined();
        expect(wizardOptions.executeSteps!.length).toBeGreaterThan(0);
    });

    it('preserves filters from the tree key action and keeps tunnels when kubeconfig is unchanged', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;
        const node = new KubernetesRootItem('discoveryView');

        await provider.configureCredentials(context, node);

        expect(mockStopAll).not.toHaveBeenCalled();
        expect(mockConfigureKubernetesCredentials).toHaveBeenCalledWith(context, { resetFilters: false });
    });

    it('resets stale filters during provider activation without stopping unchanged tunnels', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;

        await provider.configureCredentials(context);

        expect(mockStopAll).not.toHaveBeenCalled();
        expect(mockConfigureKubernetesCredentials).toHaveBeenCalledWith(context, { resetFilters: true });
    });

    it('stops tunnels after successful kubeconfig changes', async () => {
        mockConfigureKubernetesCredentials.mockResolvedValue({ kubeconfigChanged: true });
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;

        await provider.configureCredentials(context);

        expect(mockConfigureKubernetesCredentials).toHaveBeenCalledTimes(1);
        expect(mockStopAll).toHaveBeenCalledTimes(1);
    });

    it('does not stop tunnels when credential configuration fails', async () => {
        mockConfigureKubernetesCredentials.mockRejectedValue(new Error('cancelled'));
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;

        await expect(provider.configureCredentials(context)).rejects.toThrow('cancelled');

        expect(mockStopAll).not.toHaveBeenCalled();
    });

    it('stops tunnels when provider is deactivated', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as unknown as IActionContext;

        await provider.deactivate(context);

        expect(mockStopAll).toHaveBeenCalledTimes(1);
    });
});
