/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ProgressLocation: { Notification: 15 },
    ThemeIcon: class ThemeIcon { constructor(public readonly id: string) {} },
    MarkdownString: class MarkdownString {
        public value = '';
        public appendText(value: string): this { this.value += value; return this; }
    },
    Disposable: class Disposable { public dispose(): void {} },
    EventEmitter: class EventEmitter {
        public event = jest.fn();
        public fire(): void {}
        public dispose(): void {}
    },
    l10n: {
        t: (template: string, ...args: unknown[]): string =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
    },
    window: { showErrorMessage: jest.fn(), showWarningMessage: jest.fn() },
}));
jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (values: string[]): string => values.join(';'),
    UserCancelledError: class UserCancelledError extends Error {},
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    callWithTelemetryAndErrorHandling: async (_name: string, callback: (context: unknown) => Promise<unknown>): Promise<unknown> => {
        const context = {
            telemetry: { properties: {}, measurements: {} }, valuesToMask: [],
            errorHandling: {} as { rethrow?: boolean },
        };
        try {
            return await callback(context);
        } catch (error) {
            if (context.errorHandling.rethrow) {
                throw error;
            }
            return undefined;
        }
    },
}));
const state = new Map<string, unknown>();
jest.mock('../../../extensionVariables', () => ({ ext: {
    context: { globalState: {
        get: (key: string, fallback: unknown): unknown => state.get(key) ?? fallback,
        update: async (key: string, value: unknown): Promise<void> => { state.set(key, value); },
    } },
    state: { wrapItemInStateHandling: (item: unknown): unknown => item },
    outputChannel: { trace: jest.fn(), warn: jest.fn(), debug: jest.fn(), appendLine: jest.fn() },
} }));
jest.mock('../../../services/discoveryServices', () => ({
    DiscoveryService: { listProviders: jest.fn(), getProvider: jest.fn() },
}));
jest.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: { exists: jest.fn().mockReturnValue(true), getClient: jest.fn(), deleteClient: jest.fn() },
}));
jest.mock('../../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: jest.fn().mockReturnValue(true), getNativeAuthConfig: jest.fn(),
        getCredentials: jest.fn(), setAuthCredentials: jest.fn(), deleteCredentials: jest.fn(),
    },
}));
jest.mock('../../../services/SettingsService', () => ({ SettingsService: { getSetting: jest.fn() } }));
jest.mock('../../../services/connectionDiagnosticsService', () => ({
    ConnectionDiagnosticsService: { explain: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../utils/withProgress', () => ({
    withDelayedProgress: <T>(promise: Promise<T>): Promise<T> => promise,
}));
jest.mock('../connect/awsConnection', () => ({
    prepareAwsConnection: jest.fn().mockResolvedValue('mongodb://cluster.invalid/?tls=true&tlsCAFile=C%3A%5Cca.pem'),
}));
const collectionNodes = new Map<string, { id: string; getTreeItem: () => { label: string } }>();
jest.mock('../../../tree/documentdb/DatabaseItem', () => ({
    DatabaseItem: class DatabaseItem {
        public readonly id: string;
        private readonly collections: Array<{ id: string; getTreeItem: () => { label: string } }>;
        constructor(cluster: { treeId: string }, database: { name: string }) {
            this.id = `${cluster.treeId}/${database.name}`;
            const id = `${this.id}/items`;
            let collection = collectionNodes.get(id);
            if (!collection) {
                collection = { id, getTreeItem: () => ({ label: 'items' }) };
                collectionNodes.set(id, collection);
            }
            this.collections = [collection];
        }
        public getTreeItem(): { label: string } { return { label: 'database' }; }
        public loadCollectionCount(): void {}
        public getChildren(): Array<{ id: string; getTreeItem: () => { label: string } }> {
            return this.collections;
        }
    },
}));

import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { resetDiscoveryProviderVisibilityCacheForTests } from '../../../services/discoveryProviderVisibility';
import { DiscoveryService } from '../../../services/discoveryServices';
import { DiscoveryBranchDataProvider } from '../../../tree/discovery-view/DiscoveryBranchDataProvider';
import { ClusterItemBase } from '../../../tree/documentdb/ClusterItemBase';
import { AWS_DISCOVERY_PROVIDER_ID, AWS_VIEW_MODE_KEY } from '../config';
import { type AwsDiscoverySnapshot } from '../types';
import { createAwsClusterModel } from '../models/AwsClusterModel';
import { AwsClusterItem } from './AwsClusterItem';
import { AwsServiceRootItem } from './AwsServiceRootItem';

const snapshot: AwsDiscoverySnapshot = {
    clusters: [{
        id: 'resource', arn: 'arn:aws:rds:us-east-1:123456789012:cluster:example',
        name: 'example', accountId: '123456789012', region: 'us-east-1', port: 27017,
        endpoint: 'cluster.invalid', status: 'available', ownerCredentialId: 'credential',
        vpcInfo: {
            vpcId: 'vpc-123', subnetGroupName: 'docdb-subnets',
            subnets: [{ id: 'subnet-abc', availabilityZone: 'us-east-1a', status: 'Active' }],
            securityGroups: [{ id: 'sg-123', status: 'active' }],
            availabilityZones: ['us-east-1a'], networkType: 'IPV4',
        },
    }],
    errors: [],
};
const service = {
    listCredentials: jest.fn().mockResolvedValue([{ id: 'credential' }]),
    listAll: jest.fn().mockResolvedValue(snapshot),
    invalidate: jest.fn(),
};

describe('AWS native discovery tree', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        state.clear();
        collectionNodes.clear();
        resetDiscoveryProviderVisibilityCacheForTests();
        service.listCredentials.mockResolvedValue([{ id: 'credential' }]);
        service.listAll.mockResolvedValue(snapshot);
        jest.mocked(ClustersClient.getClient).mockImplementation(jest.fn().mockResolvedValue({
            listDatabases: jest.fn().mockResolvedValue([{ name: 'database' }]),
        }));
        jest.mocked(DiscoveryService.listProviders).mockReturnValue([{
            id: AWS_DISCOVERY_PROVIDER_ID, label: 'AWS DocumentDB', description: '',
        }]);
        jest.mocked(DiscoveryService.getProvider).mockReturnValue({
            id: AWS_DISCOVERY_PROVIDER_ID, label: 'AWS DocumentDB', description: '',
            getDiscoveryTreeRootItem: (parentId: string) => new AwsServiceRootItem(service, parentId),
            getDiscoveryWizard: () => ({ promptSteps: [] }),
        });
    });

    it.each(['tree', 'list'])('round-trips real %s rendering into cluster and collection lookup', async (mode) => {
        state.set(AWS_VIEW_MODE_KEY, mode);
        const provider = new DiscoveryBranchDataProvider();
        const roots = await provider.getChildren(undefined as never);
        expect(roots).toHaveLength(1);
        let rows = await provider.getChildren(roots![0]);
        if (mode === 'tree') {
            rows = await provider.getChildren(rows![0]);
            rows = await provider.getChildren(rows![0]);
        }
        const cluster = rows![0];
        expect(cluster).toBeInstanceOf(AwsClusterItem);
        expect(cluster).toBeInstanceOf(ClusterItemBase);
        if (!(cluster instanceof AwsClusterItem)) {
            throw new Error('Expected real AWS cluster');
        }
        expect(cluster.contextValue).toContain('treeItem_documentdbcluster');
        expect(cluster.contextValue).toContain('enableAddToConnectionsCommand');
        expect((cluster.getTreeItem().tooltip as { value: string }).value).toContain('VPC: vpc-123');
        expect((cluster.getTreeItem().tooltip as { value: string }).value).toContain('subnet-abc (us-east-1a)');
        expect((cluster.getTreeItem().tooltip as { value: string }).value).toContain('sg-123 (active)');
        expect(cluster.cluster.clusterId).not.toContain('/');
        expect(cluster.id).toBe(
            `discoveryView/${AWS_DISCOVERY_PROVIDER_ID}/${mode === 'tree' ? '123456789012/us-east-1/' : ''}${cluster.cluster.clusterId.split('_')[1]}`,
        );
        expect(await provider.findClusterNodeByClusterId(cluster.cluster.clusterId)).toBe(cluster);
        const databases = await provider.getChildren(cluster);
        const collections = await provider.getChildren(databases![0]);
        expect(await provider.findCollectionByClusterId(cluster.cluster.clusterId, 'database', 'items')).toBe(collections![0]);
        expect(ClustersClient.getClient).toHaveBeenCalledWith(cluster.cluster.clusterId, expect.any(AbortSignal));
        expect(CredentialCache.hasCredentials).toHaveBeenCalledWith(cluster.cluster.clusterId);
        expect(await cluster.getCredentials()).toMatchObject({
            connectionString: expect.stringContaining('tlsCAFile='),
            connectionProperties: { awsDocumentDBArn: snapshot.clusters[0].arn },
        });
    });

    it('shows the same sign-in, recovery and empty row shapes as Atlas', async () => {
        const root = new AwsServiceRootItem(service, 'discoveryView');
        service.listCredentials.mockResolvedValueOnce([]);
        const signIn = await root.getChildren();
        expect(await signIn[0].getTreeItem()).toMatchObject({ command: { command: expect.stringContaining('aws.addCredential') } });
        service.listAll.mockResolvedValueOnce({
            clusters: [], errors: [{ credentialId: 'credential', region: 'us-east-1', message: 'Access denied', kind: 'permission' }],
        });
        const failures = await root.getChildren();
        expect(root.hasRetryNode(failures)).toBe(true);
        expect(await failures[0].getTreeItem()).toMatchObject({
            command: { command: 'vscode-documentdb.command.discoveryView.manageCredentials' },
            tooltip: expect.stringContaining('Access denied'),
        });
        service.listAll.mockResolvedValueOnce({ clusters: [], errors: [] });
        expect(await (await root.getChildren())[0].getTreeItem()).toMatchObject({ label: 'empty' });
    });

    it('retains shared retry and shell recovery after database listing fails', async () => {
        jest.mocked(ClustersClient.getClient).mockImplementation(jest.fn().mockResolvedValue({
            listDatabases: jest.fn().mockRejectedValue(new Error('not authorized')),
        }));
        const cluster = new AwsClusterItem(createAwsClusterModel(snapshot.clusters[0], 'discoveryView/aws-documentdb-discovery'), 'journey');
        const children = await cluster.getChildren();
        expect(cluster.hasRetryNode(children)).toBe(true);
        expect(children.map((child) => child.id)).toContain(`${cluster.id}/retry`);
        expect(children.length).toBeGreaterThan(1);
    });
});
