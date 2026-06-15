/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    MarkdownString: class MarkdownString {
        constructor(public readonly value?: string) {}

        public toString(): string {
            return this.value ?? '';
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((acc, v, i) => acc.replace(`{${String(i)}}`, v), message),
        ),
    },
    window: {
        showWarningMessage: jest.fn(),
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
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: jest.fn(),
            warn: jest.fn(),
            appendLine: jest.fn(),
        },
    },
}));

jest.mock('../kubernetesClient', () => ({
    describeDefaultKubeconfigPath: jest.fn(() => '~/.kube/config'),
    loadConfiguredKubeConfig: jest.fn(),
    getContexts: jest.fn(() => []),
}));

jest.mock('../sources/aliasStore', () => ({
    aliasMapForSource: jest.fn(async () => new Map()),
    pruneAliasesForSource: jest.fn(async () => undefined),
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((opts: Record<string, unknown>) => opts),
}));

import type * as vscode from 'vscode';
import { type TreeElement } from '../../../tree/TreeElement';
import { type KubeconfigSourceRecord } from '../config';
import { KubernetesKubeconfigSourceItem } from './KubernetesKubeconfigSourceItem';

function makeSource(kind: 'default' | 'file' | 'inline'): KubeconfigSourceRecord {
    return {
        id: `${kind}-id`,
        kind,
        label: `${kind} source`,
        ...(kind === 'file' ? { path: '/some/path' } : {}),
    };
}

function makeRecoveryChild(id: string): TreeElement & { contextValue: string } {
    return {
        id,
        contextValue: 'error',
        getTreeItem: () => ({ id }),
    };
}

function tooltipText(tooltip: unknown): string {
    return (tooltip as { toString(): string }).toString();
}

describe('KubernetesKubeconfigSourceItem', () => {
    describe('getTreeItem icon', () => {
        it.each(['default', 'file', 'inline'] as const)(
            'renders the unified group-by-ref-type icon for %s sources',
            (kind) => {
                const source = makeSource(kind);
                const item = new KubernetesKubeconfigSourceItem('discoveryView/kubernetes-discovery', source);
                const icon = item.getTreeItem().iconPath as vscode.ThemeIcon;
                expect(icon.id).toBe('group-by-ref-type');
            },
        );
    });

    describe('getTreeItem description', () => {
        it('shows no description for default sources', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', makeSource('default'));
            expect(item.getTreeItem().description).toBeUndefined();
        });

        it('shows file path for file sources', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', {
                id: 'f1',
                kind: 'file',
                label: 'my-config',
                path: '/some/path',
            });
            expect(item.getTreeItem().description).toBe('(file: /some/path)');
        });

        it('shows no description for inline sources', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', makeSource('inline'));
            expect(item.getTreeItem().description).toBeUndefined();
        });
    });

    describe('getTreeItem tooltip', () => {
        it('wraps default source path in inline code so Windows backslashes are preserved', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', makeSource('default'));

            expect(tooltipText(item.getTreeItem().tooltip)).toContain('**Path:** `~/.kube/config`');
        });

        it('wraps file source path in inline code', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', {
                id: 'f1',
                kind: 'file',
                label: 'my-config',
                path: 'C:\\Users\\me\\.kube\\config',
            });

            expect(tooltipText(item.getTreeItem().tooltip)).toContain('**Path:** `C:\\Users\\me\\.kube\\config`');
        });
    });

    describe('hasRetryNode', () => {
        it('detects retry recovery children', () => {
            const item = new KubernetesKubeconfigSourceItem('parent', makeSource('inline'));
            expect(
                item.hasRetryNode([
                    makeRecoveryChild('parent/inline-id/open-docs'),
                    makeRecoveryChild('parent/inline-id/retry'),
                ]),
            ).toBe(true);
        });
    });

    describe('contextValue', () => {
        it('adds the file marker only for file sources', () => {
            const fileItem = new KubernetesKubeconfigSourceItem('parent', makeSource('file'));
            expect(fileItem.contextValue).toContain('discovery.kubernetesSourceFile');

            const defaultItem = new KubernetesKubeconfigSourceItem('parent', makeSource('default'));
            expect(defaultItem.contextValue).not.toContain('discovery.kubernetesSourceFile');

            const inlineItem = new KubernetesKubeconfigSourceItem('parent', makeSource('inline'));
            expect(inlineItem.contextValue).not.toContain('discovery.kubernetesSourceFile');
        });

        it('adds the inline marker only for inline sources', () => {
            const inlineItem = new KubernetesKubeconfigSourceItem('parent', makeSource('inline'));
            expect(inlineItem.contextValue).toContain('discovery.kubernetesSourceInline');

            const fileItem = new KubernetesKubeconfigSourceItem('parent', makeSource('file'));
            expect(fileItem.contextValue).not.toContain('discovery.kubernetesSourceInline');

            const defaultItem = new KubernetesKubeconfigSourceItem('parent', makeSource('default'));
            expect(defaultItem.contextValue).not.toContain('discovery.kubernetesSourceInline');
        });
    });

    describe('recovery children', () => {
        async function recoveryChildIds(source: KubeconfigSourceRecord): Promise<string[]> {
            const item = new KubernetesKubeconfigSourceItem('parent', source);
            const children = (await item.getChildren()) as Array<{ id: string }>;
            return children.map((child) => child.id);
        }

        it('offers "Edit Kubeconfig" only for file sources', async () => {
            const fileIds = await recoveryChildIds(makeSource('file'));
            expect(fileIds).toContain('parent/file-id/edit');

            const defaultIds = await recoveryChildIds(makeSource('default'));
            expect(defaultIds).not.toContain('parent/default-id/edit');

            const inlineIds = await recoveryChildIds(makeSource('inline'));
            expect(inlineIds).not.toContain('parent/inline-id/edit');
        });

        it('offers "View Kubeconfig" only for inline sources', async () => {
            const inlineIds = await recoveryChildIds(makeSource('inline'));
            expect(inlineIds).toContain('parent/inline-id/view');

            const fileIds = await recoveryChildIds(makeSource('file'));
            expect(fileIds).not.toContain('parent/file-id/view');

            const defaultIds = await recoveryChildIds(makeSource('default'));
            expect(defaultIds).not.toContain('parent/default-id/view');
        });
    });
});
