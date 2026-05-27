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

describe('KubernetesKubeconfigSourceItem', () => {
    describe('getTreeItem icon', () => {
        it.each(['default', 'file', 'inline'] as const)('renders the unified plug icon for %s sources', (kind) => {
            const source = makeSource(kind);
            const item = new KubernetesKubeconfigSourceItem('discoveryView/kubernetes-discovery', source);
            const icon = item.getTreeItem().iconPath as vscode.ThemeIcon;
            expect(icon.id).toBe('plug');
        });
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
});
