/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const globalStateBacking = new Map<string, unknown>();
const secretStorageBacking = new Map<string, string>();

class MarkdownStringMock {
    public value = '';
    public isTrusted = false;
    public appendMarkdown(text: string): this {
        this.value += text;
        return this;
    }
}

jest.mock('vscode', () => ({
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    MarkdownString: MarkdownStringMock,
    window: { showErrorMessage: jest.fn(), showWarningMessage: jest.fn() },
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            extension: { id: 'test-extension' },
            subscriptions: { push: (): void => {} },
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => {
                    const value = globalStateBacking.has(key) ? (globalStateBacking.get(key) as T) : undefined;
                    return value === undefined ? defaultValue : value;
                },
                update: async (key: string, value: unknown): Promise<void> => {
                    if (value === undefined) {
                        globalStateBacking.delete(key);
                    } else {
                        globalStateBacking.set(key, value);
                    }
                },
                keys: () => Array.from(globalStateBacking.keys()),
            },
        },
        secretStorage: {
            get: async (key: string): Promise<string | undefined> =>
                secretStorageBacking.has(key) ? secretStorageBacking.get(key) : undefined,
            store: async (key: string, value: string): Promise<void> => {
                secretStorageBacking.set(key, value);
            },
            delete: async (key: string): Promise<void> => {
                secretStorageBacking.delete(key);
            },
            onDidChange: (): { dispose: () => void } => ({ dispose: (): void => {} }),
        },
        discoveryBranchDataProvider: { refresh: jest.fn(), resetNodeErrorState: jest.fn() },
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
    },
}));

jest.mock('./AtlasClusterItem', () => ({
    AtlasClusterItem: class AtlasClusterItem {
        constructor(
            public readonly journeyCorrelationId: string,
            public readonly cluster: { name: string },
            public readonly contextDescription?: string,
        ) {}
    },
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((options: Record<string, unknown>) => ({ ...options })),
}));

// The azext-utils entry point evaluates VS Code APIs at module load time, so the whole package is
// stubbed here (matching the other tree-item test suites) instead of widening the `vscode` mock.
jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (values: string[]) => Array.from(new Set(values)).sort().join(';'),
}));

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { StorageService } from '../../../services/storageService';
import {
    resetAtlasCredentialStoreCache,
    updateAtlasCredentialMetadata,
    upsertAtlasCredential,
} from '../credentials/atlasCredentialStore';
import { type AtlasDiscoveryService, type AtlasDiscoverySnapshot } from '../discovery/AtlasDiscoveryService';
import { type AtlasCluster, type AtlasOrganization, type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasClusterItem } from './AtlasClusterItem';
import { AtlasOrganizationItem } from './AtlasOrganizationItem';
import { AtlasServiceRootItem } from './AtlasServiceRootItem';

const VIEW_MODE_KEY = 'atlas-mongodb-discovery.viewMode';

function cluster(name: string, groupId: string): AtlasCluster {
    return {
        id: `cluster-${name}`,
        name,
        groupId,
        mongoDBVersion: '7.0',
        connectionStrings: { standardSrv: `mongodb+srv://${name}.example.invalid` },
        stateName: 'IDLE',
        clusterType: 'REPLICASET',
    };
}

function org(id: string, name: string): AtlasOrganization {
    return { id, name };
}

function project(id: string, name: string, orgId: string): AtlasProject {
    return { id, name, orgId, clusterCount: 1, created: '2026-01-01T00:00:00Z' };
}

function snapshotOf(overrides: Partial<AtlasDiscoverySnapshot> = {}): AtlasDiscoverySnapshot {
    return {
        organizations: [],
        projects: [],
        clusters: [],
        credentialErrors: [],
        projectErrors: [],
        credentialsQueried: 0,
        clustersIncluded: false,
        ...overrides,
    };
}

function serviceStub(snapshot: AtlasDiscoverySnapshot): AtlasDiscoveryService {
    return {
        listAll: jest.fn().mockResolvedValue(snapshot),
        refreshAll: jest.fn().mockResolvedValue(snapshot),
        invalidate: jest.fn(),
        reset: jest.fn(),
        retryCredential: jest.fn(),
        sessionRegistry: {
            getSession: jest.fn(),
            refresherFor: jest.fn(),
            invalidate: jest.fn(),
            refreshSession: jest.fn(),
        },
    } as unknown as AtlasDiscoveryService;
}

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    StorageService._resetForTests();
    resetAtlasCredentialStoreCache();
});

describe('AtlasServiceRootItem', () => {
    it('offers a sign-in row when no credentials are stored', async () => {
        const root = new AtlasServiceRootItem(serviceStub(snapshotOf()), 'discoveryView');

        const children = (await root.getChildren()) as Array<{ id: string }>;

        expect(children).toHaveLength(1);
        expect(children[0].id).toContain('/sign-in');
    });

    it('renders a quiet organization tree with no descriptions on the happy path', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const service = serviceStub(
            snapshotOf({
                organizations: [
                    { organization: org('org-1', 'Acme Corp'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                    { organization: org('org-2', 'Beta Ltd'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                ],
            }),
        );

        const root = new AtlasServiceRootItem(service, 'discoveryView');
        const children = await root.getChildren();

        expect(children).toHaveLength(2);
        expect(children.every((child) => child instanceof AtlasOrganizationItem)).toBe(true);
        expect(root.getTreeItem().description).toBeUndefined();
    });

    it('adds exactly one recovery row no matter how many credentials failed', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const service = serviceStub(
            snapshotOf({
                organizations: [
                    { organization: org('org-1', 'Acme Corp'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                ],
                credentialErrors: [
                    { credentialId: 'c2', label: 'Beta', kind: 'auth', message: 'session expired', retryable: true },
                    {
                        credentialId: 'c3',
                        label: 'Gamma',
                        kind: 'forbidden',
                        message: 'access denied',
                        retryable: true,
                    },
                ],
            }),
        );

        const root = new AtlasServiceRootItem(service, 'discoveryView');
        const children = (await root.getChildren()) as Array<{ id: string; label?: string; tooltip?: string }>;

        const recoveryRows = children.filter((child) => child.id.endsWith('/revisit-credentials'));
        expect(recoveryRows).toHaveLength(1);
        expect(recoveryRows[0].label).toBe('Click here to revisit credentials');
        expect(recoveryRows[0].tooltip).toContain('Beta: session expired');
        expect(recoveryRows[0].tooltip).toContain('Gamma: access denied');
        // Healthy data is still rendered next to the recovery row.
        expect(children.some((child) => child instanceof AtlasOrganizationItem)).toBe(true);
    });

    it('flags an organization whose other credential failed, keeping its healthy projects', async () => {
        const healthy = await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const broken = await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-2', privateKey: 'priv-2' });
        await updateAtlasCredentialMetadata(broken.record.id, { orgId: 'org-1', orgName: 'Acme Corp' });

        const service = serviceStub(
            snapshotOf({
                organizations: [
                    {
                        organization: org('org-1', 'Acme Corp'),
                        credentialIds: [healthy.record.id],
                        ownerCredentialId: healthy.record.id,
                    },
                ],
                credentialErrors: [
                    {
                        credentialId: broken.record.id,
                        label: 'Acme Corp',
                        kind: 'forbidden',
                        message: 'access denied',
                        retryable: true,
                    },
                ],
            }),
        );

        const root = new AtlasServiceRootItem(service, 'discoveryView');
        const children = await root.getChildren();
        const orgItem = children.find((child) => child instanceof AtlasOrganizationItem) as AtlasOrganizationItem;

        expect((orgItem.getTreeItem().iconPath as { id: string }).id).toBe('warning');
    });

    it('shows the standard empty placeholder when a healthy credential sees nothing', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const root = new AtlasServiceRootItem(serviceStub(snapshotOf()), 'discoveryView');

        const children = (await root.getChildren()) as Array<{ id: string; label?: string; iconPath?: { id: string } }>;

        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('empty');
        expect(children[0].iconPath?.id).toBe('indent');
        // A healthy empty result is an authoritative answer, so it must not offer a retry.
        expect(children[0].id).not.toContain('retry');
    });

    it('re-queries every credential with a fresh session on an explicit refresh', async () => {
        const service = serviceStub(snapshotOf());
        const root = new AtlasServiceRootItem(service, 'discoveryView');

        await root.refresh({} as IActionContext);

        // refreshAll re-derives every session, which is what makes a role change in Atlas visible
        // instead of reusing a Service Account token minted with the old scope.
        expect(service.refreshAll).toHaveBeenCalledWith({ includeClusters: false });
    });

    it('marks the current view mode in the context value so the toggle can be gated', () => {
        const root = new AtlasServiceRootItem(serviceStub(snapshotOf()), 'discoveryView');
        expect(root.getTreeItem().contextValue).toContain('discoveryAtlasViewModeTree');

        globalStateBacking.set(VIEW_MODE_KEY, 'list');
        expect(root.getTreeItem().contextValue).toContain('discoveryAtlasViewModeList');
    });

    it('keeps contextValue writable so the tree data provider can append its own markers', () => {
        const root = new AtlasServiceRootItem(serviceStub(snapshotOf()), 'discoveryView');

        expect(() => {
            root.contextValue = `${root.contextValue};rootItem`;
        }).not.toThrow();
        expect(root.getTreeItem().contextValue).toContain('rootItem');
    });
});

describe('AtlasServiceRootItem in List mode', () => {
    beforeEach(() => {
        globalStateBacking.set(VIEW_MODE_KEY, 'list');
    });

    it('renders a flat deduplicated cluster list with organization and project context', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const service = serviceStub(
            snapshotOf({
                clustersIncluded: true,
                organizations: [
                    { organization: org('org-1', 'Acme Corp'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                ],
                clusters: [
                    {
                        cluster: cluster('payments-prod', 'p1'),
                        projectId: 'p1',
                        projectName: 'Payments',
                        orgId: 'org-1',
                        credentialIds: ['c1', 'c2'],
                        ownerCredentialId: 'c1',
                    },
                ],
            }),
        );

        const root = new AtlasServiceRootItem(service, 'discoveryView');
        const children = await root.getChildren();

        expect(service.listAll).toHaveBeenCalledWith({ includeClusters: true });
        expect(children).toHaveLength(1);
        const row = children[0] as unknown as { contextDescription?: string };
        expect(children[0]).toBeInstanceOf(AtlasClusterItem);
        expect(row.contextDescription).toBe('Acme Corp · Payments');
    });

    it('keeps the same recovery row in List mode without switching views', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        const service = serviceStub(
            snapshotOf({
                clustersIncluded: true,
                organizations: [
                    { organization: org('org-1', 'Acme Corp'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                ],
                clusters: [
                    {
                        cluster: cluster('payments-prod', 'p1'),
                        projectId: 'p1',
                        projectName: 'Payments',
                        orgId: 'org-1',
                        credentialIds: ['c1'],
                        ownerCredentialId: 'c1',
                    },
                ],
                credentialErrors: [
                    { credentialId: 'c2', label: 'Beta', kind: 'auth', message: 'session expired', retryable: true },
                ],
            }),
        );

        const root = new AtlasServiceRootItem(service, 'discoveryView');
        const children = (await root.getChildren()) as Array<{ id?: string; label?: string }>;

        expect(children[0].id).toContain('/revisit-credentials');
        expect(children).toHaveLength(2);
        // The healthy cluster is still listed next to the recovery row.
        expect(children[1]).toBeInstanceOf(AtlasClusterItem);
    });
});

describe('AtlasOrganizationItem', () => {
    it('lists the union of projects for its organization', async () => {
        const snapshot = snapshotOf({
            projects: [
                { project: project('p1', 'Payments', 'org-1'), credentialIds: ['c1'], ownerCredentialId: 'c1' },
                { project: project('p2', 'Web', 'org-2'), credentialIds: ['c2'], ownerCredentialId: 'c2' },
                { project: project('p3', 'Analytics', 'org-1'), credentialIds: ['c2'], ownerCredentialId: 'c2' },
            ],
        });

        const item = new AtlasOrganizationItem('root', org('org-1', 'Acme Corp'), serviceStub(snapshot));
        const children = (await item.getChildren()) as Array<{ id: string }>;

        expect(children).toHaveLength(2);
        expect(children.map((child) => child.id)).toEqual(['root/org-1/p1', 'root/org-1/p3']);
    });

    it('shows the empty placeholder when the organization has no visible projects', async () => {
        const item = new AtlasOrganizationItem('root', org('org-1', 'Acme Corp'), serviceStub(snapshotOf()));
        const children = (await item.getChildren()) as Array<{ label?: string; tooltip?: string }>;

        expect(children).toHaveLength(1);
        expect(children[0].label).toBe('empty');
        expect(children[0].tooltip).toContain('project access');
    });

    it('stays quiet on the happy path and escapes Atlas-provided text in its tooltip', () => {
        const item = new AtlasOrganizationItem('root', org('org-1', '**Acme**'), serviceStub(snapshotOf()));
        const treeItem = item.getTreeItem();

        expect(treeItem.description).toBeUndefined();
        expect((treeItem.iconPath as { id: string }).id).toBe('organization');
        expect((treeItem.tooltip as unknown as MarkdownStringMock).value).toContain('\\*\\*Acme\\*\\*');
    });

    it('re-queries the fleet when the organization itself is refreshed', async () => {
        // Regression: the organization's children come from the shared snapshot, so without its own
        // refresh hook the generic path just re-read the cache. A user who widened a credential's
        // roles in Atlas and refreshed the organization kept seeing the stale `empty` placeholder.
        const service = serviceStub(snapshotOf());
        const item = new AtlasOrganizationItem('root', org('org-1', 'Acme Corp'), service);

        await item.refresh({} as IActionContext);

        expect(service.refreshAll).toHaveBeenCalled();
    });
});
