/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DISCOVERY_PROVIDER_ID } from './config';
import { KubernetesRootItem } from './discovery-tree/KubernetesRootItem';
import { KubernetesDiscoveryProvider } from './KubernetesDiscoveryProvider';

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

describe('KubernetesDiscoveryProvider', () => {
    let provider: KubernetesDiscoveryProvider;

    beforeEach(() => {
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

    it('should return a KubernetesRootItem from getDiscoveryTreeRootItem', () => {
        const rootItem = provider.getDiscoveryTreeRootItem('discoveryView');
        expect(rootItem).toBeInstanceOf(KubernetesRootItem);
        expect(rootItem.id).toBe('discoveryView/kubernetes-discovery');
    });

    it('should return a learn more URL', () => {
        const url = provider.getLearnMoreUrl();
        expect(url).toBeDefined();
        expect(url).toContain('https://');
    });

    it('should return wizard options with prompt and execute steps', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wizardOptions = provider.getDiscoveryWizard({} as any);
        expect(wizardOptions.promptSteps).toBeDefined();
        expect(wizardOptions.promptSteps!.length).toBeGreaterThan(0);
        expect(wizardOptions.executeSteps).toBeDefined();
        expect(wizardOptions.executeSteps!.length).toBeGreaterThan(0);
    });
});
