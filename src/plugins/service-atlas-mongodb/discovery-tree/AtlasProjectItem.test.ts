/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
    window: { showErrorMessage: jest.fn() },
}));

jest.mock('./AtlasClusterItem', () => ({
    AtlasClusterItem: class AtlasClusterItem {
        constructor(
            _journeyCorrelationId: string,
            public readonly cluster: { clusterId: string; treeId: string },
        ) {}
    },
}));

const mockListClusters = jest.fn();

jest.mock('../api/AtlasApiClient', () => ({
    AtlasApiError: class AtlasApiError extends Error {
        constructor(
            message: string,
            public readonly statusCode: number,
        ) {
            super(message);
        }
    },
    AtlasApiClient: class AtlasApiClientMock {
        constructor(
            public readonly session: unknown,
            public readonly refresher: unknown,
        ) {}
        listClusters = (...args: unknown[]) => mockListClusters(...args) as unknown;
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
        discoveryBranchDataProvider: { resetNodeErrorState: jest.fn(), refresh: jest.fn() },
    },
}));

import { window } from 'vscode';
import { type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasProjectItem } from './AtlasProjectItem';

const discoveryServiceStub = {} as AtlasDiscoveryService;

function buildProject(overrides: Partial<AtlasProject> = {}): AtlasProject {
    return {
        id: '5f1a2b3c4d5e6f7a8b9c0d1e',
        name: 'Payments',
        orgId: 'org-1',
        clusterCount: 2,
        created: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

function tooltipValue(project: AtlasProject, orgName?: string): string {
    const item = new AtlasProjectItem('parent', project, discoveryServiceStub, 'credential-1', orgName);
    const tooltip = item.getTreeItem().tooltip as unknown as MarkdownStringMock;
    return tooltip.value;
}

describe('AtlasProjectItem tooltip', () => {
    it('renders plain names unchanged apart from Markdown escaping', () => {
        const value = tooltipValue(buildProject(), 'Acme Corp');

        expect(value).toContain('**Payments**');
        expect(value).toContain('Acme Corp');
        expect(value).toContain('**Clusters:** 2');
    });

    it('escapes Markdown emphasis in the project name', () => {
        const value = tooltipValue(buildProject({ name: '**not bold**' }));

        expect(value).toContain('\\*\\*not bold\\*\\*');
        expect(value).not.toContain('***not bold***');
    });

    it('escapes link-like organization names so they cannot render as links', () => {
        const value = tooltipValue(buildProject(), '[click me](https://example.invalid)');

        expect(value).toContain('\\[click me\\]\\(https://example\\.invalid\\)');
        expect(value).not.toContain('](https://example.invalid)');
    });

    it('escapes Markdown punctuation in the project id', () => {
        const value = tooltipValue(buildProject({ id: 'id_with_underscores' }));

        expect(value).toContain('id\\_with\\_underscores');
    });

    it('keeps the tooltip untrusted', () => {
        const item = new AtlasProjectItem('parent', buildProject(), discoveryServiceStub, 'credential-1');
        const tooltip = item.getTreeItem().tooltip as unknown as MarkdownStringMock;

        expect(tooltip.isTrusted).toBe(false);
    });
});

describe('AtlasProjectItem getChildren failure handling (NEW-3)', () => {
    const showErrorMessage = window.showErrorMessage as jest.Mock;
    const mockGetSession = jest.fn();
    const mockRefreshSession = jest.fn();

    function makeService(): AtlasDiscoveryService {
        return {
            sessionRegistry: {
                getSession: mockGetSession,
                refreshSession: mockRefreshSession,
                refresherFor: () => ({ tryRefreshIfPossible: jest.fn() }),
            },
        } as unknown as AtlasDiscoveryService;
    }

    beforeEach(() => {
        showErrorMessage.mockReset();
        mockListClusters.mockReset();
        mockGetSession.mockReset();
        mockRefreshSession.mockReset();
        mockGetSession.mockResolvedValue({ type: 'apikey', publicKey: 'p', privateKey: 's' });
    });

    it('uses the stable unprefixed cluster suffix as the tree leaf', async () => {
        mockListClusters.mockResolvedValue([
            {
                id: 'cluster-1',
                name: 'Cluster0',
                mongoDBVersion: '7.0',
                stateName: 'IDLE',
                clusterType: 'REPLICASET',
            },
        ]);
        const project = buildProject({ id: 'p1' });
        const item = new AtlasProjectItem('parent/org-1', project, makeService(), 'credential-1');

        const children = (await item.getChildren()) as unknown as Array<{
            cluster: { clusterId: string; treeId: string };
        }>;

        expect(children[0].cluster.clusterId).toBe('atlas-mongodb-discovery_p1_Cluster0');
        expect(children[0].cluster.treeId).toBe('parent/org-1/p1/p1_Cluster0');
    });

    it('shows a modal once on a plain expansion failure and returns the retry node', async () => {
        mockListClusters.mockRejectedValue(new TypeError('fetch failed'));
        const item = new AtlasProjectItem('parent', buildProject(), makeService(), 'credential-1');

        const children = await item.getChildren();

        expect(showErrorMessage).toHaveBeenCalledTimes(1);
        expect(children).toHaveLength(1);
    });

    it('classifies a network failure with retry wording, not credential-blaming wording', async () => {
        mockListClusters.mockRejectedValue(new TypeError('fetch failed'));
        const item = new AtlasProjectItem('parent', buildProject(), makeService(), 'credential-1');

        await item.getChildren();

        const detail = (showErrorMessage.mock.calls[0][1] as { detail: string }).detail;
        expect(detail).toContain('could not be reached');
        expect(detail).not.toContain('rejected');
    });

    it('suppresses the modal on the expansion that immediately follows a refresh', async () => {
        mockListClusters.mockRejectedValue(new TypeError('fetch failed'));
        mockRefreshSession.mockResolvedValue(undefined);
        const item = new AtlasProjectItem('parent', buildProject(), makeService(), 'credential-1');

        await item.refresh({} as never);
        const children = await item.getChildren();

        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(children).toHaveLength(1);
    });

    it('shows the modal again on a second expansion after a single refresh', async () => {
        mockListClusters.mockRejectedValue(new TypeError('fetch failed'));
        mockRefreshSession.mockResolvedValue(undefined);
        const item = new AtlasProjectItem('parent', buildProject(), makeService(), 'credential-1');

        await item.refresh({} as never);
        await item.getChildren(); // quiet
        await item.getChildren(); // must show

        expect(showErrorMessage).toHaveBeenCalledTimes(1);
    });
});
