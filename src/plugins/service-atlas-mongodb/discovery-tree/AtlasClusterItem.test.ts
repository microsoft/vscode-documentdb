/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { type AtlasClusterModel } from '../models/AtlasClusterModel';
import { AtlasClusterItem } from './AtlasClusterItem';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, values?: Record<string, string>) => {
        if (!values) {
            return message;
        }

        return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), message);
    }),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    Uri: {
        file: (p: string) => ({ scheme: 'file', path: p, fsPath: p, toString: () => p }),
        parse: (value: string) => ({ toString: () => value }),
    },
    MarkdownString: class MarkdownString {
        public isTrusted = false;
        private readonly chunks: string[] = [];

        constructor(initialValue?: string) {
            if (initialValue) {
                this.chunks.push(initialValue);
            }
        }

        public appendMarkdown(value: string): void {
            this.chunks.push(value);
        }

        public toString(): string {
            return this.chunks.join('');
        }
    },
    l10n: {
        t: jest.fn((message: string) => message),
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    ProgressLocation: {
        Notification: 15,
    },
    env: {
        openExternal: jest.fn(),
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) =>
            await callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: {},
                valuesToMask: [],
            }),
    ),
    AzureWizard: class AzureWizard {
        constructor(_context: unknown, _options: unknown) {}
        public async prompt(): Promise<void> {}
    },
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            append: jest.fn(),
            appendLine: jest.fn(),
            debug: jest.fn(),
        },
        state: {
            notifyChildrenChanged: jest.fn(),
        },
    },
}));

jest.mock('../../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: jest.fn(),
        deleteCredentials: jest.fn(),
        setAuthCredentials: jest.fn(),
    },
}));

jest.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: jest.fn(),
        deleteClient: jest.fn(),
    },
}));

function createTreeCluster(): TreeCluster<AtlasClusterModel> {
    return {
        name: 'Cluster0',
        connectionString: 'mongodb+srv://cluster0.example.mongodb.net',
        dbExperience: DocumentDBExperience,
        clusterId: 'atlas-mongodb-discovery_cluster0',
        treeId: 'atlas/org/project/Cluster0',
        viewId: Views.DiscoveryView,
        projectId: '507f1f77bcf86cd799439011',
        projectName: 'Project 0',
        stateName: 'IDLE',
        clusterType: 'REPLICASET',
        providerName: 'AWS',
        regionName: 'US_EAST_1',
        instanceSizeName: 'M10',
        mongoDBVersion: '7.0.0',
    };
}

describe('AtlasClusterItem icon', () => {
    it('uses the neutral server-environment codicon', () => {
        const item = new AtlasClusterItem('', createTreeCluster());

        expect((item.getTreeItem().iconPath as { id: string }).id).toBe('server-environment');
    });

    it('does not brand an Atlas cluster with the DocumentDB product logo', () => {
        // `vscode-documentdb-cluster-{light,dark}-themes.svg` are byte-identical copies of the
        // DocumentDB product logo. The Kubernetes plugin uses them because it discovers real
        // DocumentDB deployments; Atlas clusters are somebody else's managed service, so the
        // brand mark must not leak into this tree.
        const iconPath = new AtlasClusterItem('', createTreeCluster()).getTreeItem().iconPath;

        expect(JSON.stringify(iconPath)).not.toContain('vscode-documentdb');
    });
});
