/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_SOURCE_ID, type KubeconfigSourceRecord } from '../config';

const mockEnsureMigration = jest.fn(async () => undefined);
const mockReadSources = jest.fn<Promise<readonly KubeconfigSourceRecord[]>, []>();
const mockReadHiddenSourceIds = jest.fn<readonly string[], []>(() => []);

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    MarkdownString: class MarkdownString {
        constructor(public readonly value?: string) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    l10n: {
        t: jest.fn((message: string) => message),
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
}));

jest.mock('../sources/migrationV2', () => ({
    ensureMigration: () => mockEnsureMigration(),
}));

jest.mock('../sources/sourceStore', () => ({
    readSources: () => mockReadSources(),
    readHiddenSourceIds: () => mockReadHiddenSourceIds(),
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
        contextValue: opts.contextValue,
        commandId: opts.commandId,
    })),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: jest.fn(),
            warn: jest.fn(),
            appendLine: jest.fn(),
        },
        discoveryBranchDataProvider: {
            refresh: jest.fn(),
        },
    },
}));

import { KubernetesRootItem } from './KubernetesRootItem';

describe('KubernetesRootItem (v2 multi-source)', () => {
    beforeEach(() => {
        mockEnsureMigration.mockClear();
        mockReadSources.mockReset();
        mockReadHiddenSourceIds.mockReset();
        mockReadHiddenSourceIds.mockReturnValue([]);
    });

    it('runs the v2 migration and renders one source per stored entry', async () => {
        const sources: KubeconfigSourceRecord[] = [
            { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
            { id: 'abc-123', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
            {
                id: 'xyz-789',
                kind: 'inline',
                label: 'Pasted YAML 1',
            },
        ];
        mockReadSources.mockResolvedValue(sources);

        const root = new KubernetesRootItem('discoveryView');
        const children = await root.getChildren();

        expect(mockEnsureMigration).toHaveBeenCalledTimes(1);
        expect(children).toHaveLength(3);
        const labels = children.map((c) => (c as unknown as { source?: KubeconfigSourceRecord }).source?.label);
        expect(labels).toEqual(['Default kubeconfig', 'team.yaml', 'Pasted YAML 1']);
    });

    it('returns recovery actions when readSources unexpectedly returns an empty list', async () => {
        mockReadSources.mockResolvedValue([]);

        const root = new KubernetesRootItem('discoveryView');
        const children = await root.getChildren();

        expect(children.length).toBeGreaterThanOrEqual(2);
        const labels = children.map((c) => (c as unknown as { label?: string }).label);
        expect(labels).toEqual(
            expect.arrayContaining(['No kubeconfig sources are configured.', 'Add kubeconfig source\u2026', 'Retry']),
        );
    });

    it('exposes a tree item with the Kubernetes label and collapsed state', () => {
        const treeItem = new KubernetesRootItem('discoveryView').getTreeItem();
        expect(treeItem.label).toBe('Kubernetes');
        expect(treeItem.collapsibleState).toBe(1);
    });

    it('drops enableFilterCommand from the contextValue and includes the add-source marker', () => {
        const root = new KubernetesRootItem('discoveryView');
        expect(root.contextValue).not.toContain('enableFilterCommand');
        expect(root.contextValue).toContain('enableManageCredentialsCommand');
        expect(root.contextValue).toContain('enableLearnMoreCommand');
        expect(root.contextValue).toContain('enableAddKubernetesSourceCommand');
    });

    it('hides sources whose id appears in readHiddenSourceIds', async () => {
        const sources: KubeconfigSourceRecord[] = [
            { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
            { id: 'visible-1', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
            {
                id: 'hidden-1',
                kind: 'inline',
                label: 'Pasted YAML 1',
            },
        ];
        mockReadSources.mockResolvedValue(sources);
        mockReadHiddenSourceIds.mockReturnValue(['hidden-1']);

        const children = await new KubernetesRootItem('discoveryView').getChildren();
        const labels = children.map((c) => (c as unknown as { source?: KubeconfigSourceRecord }).source?.label);
        expect(labels).toEqual(['Default kubeconfig', 'team.yaml']);
    });
});
