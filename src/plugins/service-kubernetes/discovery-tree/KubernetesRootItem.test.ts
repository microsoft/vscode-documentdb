/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_SOURCE_ID, type KubeconfigSourceRecord } from '../config';

const mockEnsureMigration = jest.fn(async () => undefined);
const mockReadSources = jest.fn<Promise<readonly KubeconfigSourceRecord[]>, []>();

// --- Telemetry mock context ---
const telemetryContextMock = {
    telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
    errorHandling: { issueProperties: {} },
    valuesToMask: [],
};

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
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) => callback(telemetryContextMock),
    ),
}));

jest.mock('../sources/migrationV2', () => ({
    ensureMigration: () => mockEnsureMigration(),
}));

jest.mock('../sources/sourceStore', () => ({
    readSources: () => mockReadSources(),
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
        telemetryContextMock.telemetry.properties = {};
        telemetryContextMock.telemetry.measurements = {};
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

    it('returns only add-source action when no sources are configured', async () => {
        mockReadSources.mockResolvedValue([]);

        const root = new KubernetesRootItem('discoveryView');
        const children = await root.getChildren();

        expect(children).toHaveLength(1);
        const labels = children.map((c) => (c as unknown as { label?: string }).label);
        expect(labels).toEqual(['Add Kubeconfig\u2026']);
    });

    it('exposes a tree item with the Kubernetes Clusters label, layers icon, and collapsed state', () => {
        const treeItem = new KubernetesRootItem('discoveryView').getTreeItem();
        expect(treeItem.label).toBe('Kubernetes Clusters');
        expect((treeItem.iconPath as { id: string }).id).toBe('layers');
        expect(treeItem.collapsibleState).toBe(1);
    });

    it('does not expose enableManageCredentialsCommand in the contextValue', () => {
        const root = new KubernetesRootItem('discoveryView');
        expect(root.contextValue).not.toContain('enableManageCredentialsCommand');
        expect(root.contextValue).not.toContain('enableFilterCommand');
        expect(root.contextValue).toContain('enableLearnMoreCommand');
        expect(root.contextValue).toContain('enableAddKubernetesSourceCommand');
    });

    it('records how many kubeconfig sources exist, split by kind', async () => {
        const sources: KubeconfigSourceRecord[] = [
            { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
            { id: 'f-1', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
            { id: 'f-2', kind: 'file', label: 'prod.yaml', path: '/abs/prod.yaml' },
            { id: 'i-1', kind: 'inline', label: 'Pasted YAML 1' },
        ];
        mockReadSources.mockResolvedValue(sources);

        await new KubernetesRootItem('discoveryView').getChildren();

        const { measurements, properties } = telemetryContextMock.telemetry;
        expect(measurements.sourcesCount).toBe(4);
        expect(measurements.fileSourcesCount).toBe(2);
        expect(measurements.inlineSourcesCount).toBe(1);
        expect(measurements.defaultSourcesCount).toBe(1);
        expect(properties.hasSources).toBe('true');
    });

    it('records hasSources=false and a zero source count when empty', async () => {
        mockReadSources.mockResolvedValue([]);

        await new KubernetesRootItem('discoveryView').getChildren();

        const { measurements, properties } = telemetryContextMock.telemetry;
        expect(measurements.sourcesCount).toBe(0);
        expect(properties.hasSources).toBe('false');
    });

    it('shows all sources without hidden-source filtering', async () => {
        const sources: KubeconfigSourceRecord[] = [
            { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
            { id: 'visible-1', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
            { id: 'other-1', kind: 'inline', label: 'Pasted YAML 1' },
        ];
        mockReadSources.mockResolvedValue(sources);

        const children = await new KubernetesRootItem('discoveryView').getChildren();
        const labels = children.map((c) => (c as unknown as { source?: KubeconfigSourceRecord }).source?.label);
        expect(labels).toEqual(['Default kubeconfig', 'team.yaml', 'Pasted YAML 1']);
    });
});
