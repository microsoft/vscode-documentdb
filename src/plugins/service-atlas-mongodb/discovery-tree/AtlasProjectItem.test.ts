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
    AtlasClusterItem: class AtlasClusterItem {},
}));

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
