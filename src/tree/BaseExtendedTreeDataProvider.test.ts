/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../documentdb/ClustersClient';
import { notifySrvResolutionChanged } from '../documentdb/srv/srvResolutionSummary';
import { type Experience } from '../DocumentDBExperiences';
import { ConnectionDiagnosticsService } from '../services/connectionDiagnosticsService';
import { BaseExtendedTreeDataProvider } from './BaseExtendedTreeDataProvider';
import { ClusterItemBase, type EphemeralClusterCredentials } from './documentdb/ClusterItemBase';
import { type BaseClusterModel, type TreeCluster } from './models/BaseClusterModel';
import { type TreeElement } from './TreeElement';

jest.mock('vscode', () => ({
    ...jest.requireActual<typeof vscode>('../__mocks__/vscode.js'),
    MarkdownString: class MarkdownString {
        #delegate: Pick<vscode.MarkdownString, 'value' | 'isTrusted' | 'supportThemeIcons' | 'supportHtml' | 'baseUri'>;

        constructor(value = '', supportThemeIcons = false) {
            this.#delegate = { value, supportThemeIcons };
        }

        get value(): string {
            return this.#delegate.value;
        }
        set value(value: string) {
            this.#delegate.value = value;
        }
        get isTrusted(): vscode.MarkdownString['isTrusted'] {
            return this.#delegate.isTrusted;
        }
        set isTrusted(value: vscode.MarkdownString['isTrusted']) {
            this.#delegate.isTrusted = value;
        }
        get supportThemeIcons(): boolean | undefined {
            return this.#delegate.supportThemeIcons;
        }
        set supportThemeIcons(value: boolean | undefined) {
            this.#delegate.supportThemeIcons = value;
        }
        get supportHtml(): boolean | undefined {
            return this.#delegate.supportHtml;
        }
        set supportHtml(value: boolean | undefined) {
            this.#delegate.supportHtml = value;
        }
        get baseUri(): vscode.Uri | undefined {
            return this.#delegate.baseUri;
        }
        set baseUri(value: vscode.Uri | undefined) {
            this.#delegate.baseUri = value;
        }

        appendMarkdown(value: string): this {
            this.#delegate.value += value;
            return this;
        }

        appendText(value: string): this {
            this.#delegate.value += value.replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&');
            return this;
        }
    },
}));

jest.mock('../extensionVariables', () => ({
    ext: {
        state: { wrapItemInStateHandling: (item: unknown) => item },
    },
}));

/** Minimal concrete provider: the behaviour under test lives entirely in the base class. */
class TestProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    getChildren(): Promise<TreeElement[] | null | undefined> {
        return Promise.resolve([]);
    }
    public fetch(
        element: TreeElement,
        context: IActionContext,
        fetchFunc: () => Promise<TreeElement[] | null | undefined>,
    ): Promise<TreeElement[] | null | undefined> {
        return this.wrapGetChildrenWithErrorAndStateHandling(element, context, fetchFunc);
    }
}

function actionContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: undefined,
    } as unknown as IActionContext;
}

const clusterElement = { id: 'view/cluster/db', cluster: { clusterId: 'cluster-1' } } as unknown as TreeElement;

class TooltipClusterItem extends ClusterItemBase {
    public constructor(treeId = 'folder/stable-cluster', clusterId = 'stable-cluster') {
        super({
            treeId,
            clusterId,
            name: 'Cluster',
            dbExperience: { api: 'MongoDB' } as unknown as Experience,
        } as TreeCluster<BaseClusterModel>);
    }

    protected authenticateAndConnect(): Promise<ClustersClient | null> {
        return Promise.resolve(null);
    }

    public getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return Promise.resolve(undefined);
    }

    public override getTreeItem(): vscode.TreeItem {
        // Simulates discovery subclasses that replace, rather than call, the base tooltip.
        return { id: this.id, tooltip: new vscode.MarkdownString('Discovery override') };
    }
}

describe('fallback tooltip row refresh', (): void => {
    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it('refreshes each rendered row of the cluster once without refreshing other clusters', async (): Promise<void> => {
        const provider = new TestProvider();
        const first = new TooltipClusterItem();
        const second = new TooltipClusterItem('another-folder/stable-cluster');
        const other = new TooltipClusterItem('folder/other-cluster', 'other-cluster');
        const summary = jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(undefined);
        const changed = jest.fn();
        const listener = provider.onDidChangeTreeData(changed);
        try {
            for (const item of [first, second, other]) {
                expect((await provider.getTreeItem(item)).tooltip).toHaveProperty('value', 'Discovery override');
            }
            await provider.getTreeItem(first);
            summary.mockReturnValue({ path: 'fallback', nodeErrorCode: 'EBADRESP', resolvedAt: 1 });
            notifySrvResolutionChanged('stable-cluster');
            expect(changed.mock.calls).toEqual([[first], [second]]);
            const tooltip = (await provider.getTreeItem(first)).tooltip as vscode.MarkdownString;
            expect(tooltip.value).toContain('Discovery override');
            expect(tooltip.value).toContain('**DNS:**');
            expect(tooltip.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
            expect(changed).toHaveBeenCalledTimes(2);
        } finally {
            listener.dispose();
            provider.dispose();
        }
    });

    it('ignores other clusters and removes its subscription when disposed', async (): Promise<void> => {
        const provider = new TestProvider();
        const item = new TooltipClusterItem();
        const changed = jest.fn();
        provider.onDidChangeTreeData(changed);
        await provider.getTreeItem(item);
        notifySrvResolutionChanged('other-cluster');
        expect(changed).not.toHaveBeenCalled();
        provider.dispose();
        notifySrvResolutionChanged('stable-cluster');
        expect(changed).not.toHaveBeenCalled();
    });

    it('updates a collapsed row and omits the flag on the next render after the client is removed', async (): Promise<void> => {
        const provider = new TestProvider();
        const item = new TooltipClusterItem();
        const summary = jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue(undefined);
        const changed = jest.fn();
        provider.onDidChangeTreeData(changed);
        try {
            await provider.getTreeItem(item);
            summary.mockReturnValue({ path: 'fallback', resolvedAt: 1 });
            notifySrvResolutionChanged('stable-cluster');
            expect(changed).toHaveBeenCalledTimes(1);
            expect(((await provider.getTreeItem(item)).tooltip as vscode.MarkdownString).value).toContain('**DNS:**');
            summary.mockReturnValue(undefined);
            expect(((await provider.getTreeItem(item)).tooltip as vscode.MarkdownString).value).not.toContain('DNS');
            expect(changed).toHaveBeenCalledTimes(1);
        } finally {
            provider.dispose();
        }
    });

    it('does not refresh stale cluster rows removed by a parent refresh', async (): Promise<void> => {
        const provider = new TestProvider();
        const changed = jest.fn();
        provider.onDidChangeTreeData(changed);
        try {
            await provider.getTreeItem(new TooltipClusterItem());
            provider.refresh({ id: 'folder', getTreeItem: (): vscode.TreeItem => ({}) });
            await Promise.resolve();
            changed.mockClear();
            notifySrvResolutionChanged('stable-cluster');
            expect(changed).not.toHaveBeenCalled();
        } finally {
            provider.dispose();
        }
    });

    it('fetches fresh children on the next expansion after a collapsed row refresh', async (): Promise<void> => {
        const provider = new TestProvider();
        const item = new TooltipClusterItem();
        const oldChildren = [{ id: `${item.id}/old`, getTreeItem: (): vscode.TreeItem => ({}) }];
        const newChildren = [{ id: `${item.id}/new`, getTreeItem: (): vscode.TreeItem => ({}) }];
        const listDatabases = jest.fn().mockResolvedValueOnce(oldChildren).mockResolvedValueOnce(newChildren);
        try {
            await provider.getTreeItem(item);
            await expect(provider.fetch(item, actionContext(), listDatabases)).resolves.toBe(oldChildren);
            notifySrvResolutionChanged('stable-cluster');
            await expect(provider.fetch(item, actionContext(), listDatabases)).resolves.toBe(newChildren);
            expect(listDatabases).toHaveBeenCalledTimes(2);
        } finally {
            provider.dispose();
        }
    });

    it('preserves a stored override through the base item and provider tooltip passes', async (): Promise<void> => {
        const provider = new TestProvider();
        jest.spyOn(ClustersClient, 'getSrvResolution').mockReturnValue({
            path: 'fallback',
            nodeErrorCode: 'EBADRESP',
            resolvedAt: 1,
        });
        const content = '### Cluster heading\n\n⚠️ **Security:** TLS/SSL Disabled';
        const original = new vscode.MarkdownString(content, true);
        original.isTrusted = false;
        class StoredOverrideCluster extends TooltipClusterItem {
            public constructor() {
                super();
                this.tooltipOverride = original;
            }

            public override getTreeItem(): vscode.TreeItem {
                return ClusterItemBase.prototype.getTreeItem.call(this);
            }
        }
        const item = new StoredOverrideCluster();
        try {
            expect(Object.keys(original)).toEqual([]);
            for (let render = 0; render < 2; render++) {
                const tooltip = (await provider.getTreeItem(item)).tooltip as vscode.MarkdownString;
                expect(tooltip.value).toContain(content);
                expect(tooltip.value.match(/\*\*DNS:\*\*/g)).toHaveLength(1);
                expect(tooltip.isTrusted).toBe(false);
                expect(tooltip.supportThemeIcons).toBe(true);
            }
            expect(original.value).toBe(content);
        } finally {
            provider.dispose();
        }
    });
});

describe('BaseExtendedTreeDataProvider error translation', () => {
    let showErrorMessage: jest.SpyInstance;

    beforeEach(() => {
        ConnectionDiagnosticsService.resetForTests();
        // The vscode mock exposes showErrorMessage as a shared jest.fn(), so its call history
        // survives restoreAllMocks and has to be cleared explicitly.
        showErrorMessage = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        showErrorMessage.mockClear();
    });

    afterEach(() => {
        ConnectionDiagnosticsService.resetForTests();
        jest.restoreAllMocks();
    });

    it('shows the explanation and suppresses the default notification', async () => {
        ConnectionDiagnosticsService.registerProvider({
            id: 'test',
            explain: () => Promise.resolve('DocumentDB Local does not appear to be running.'),
        });
        const context = actionContext();
        const failure = new Error('connect ECONNREFUSED 127.0.0.1:10260');

        await expect(new TestProvider().fetch(clusterElement, context, () => Promise.reject(failure))).rejects.toBe(
            failure,
        );

        expect(showErrorMessage).toHaveBeenCalledWith(
            'DocumentDB Local does not appear to be running. (connect ECONNREFUSED 127.0.0.1:10260)',
        );
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.telemetry.properties.diagnosisProviderId).toBe('test');
    });

    it('rethrows the original error object untouched', async () => {
        ConnectionDiagnosticsService.registerProvider({ id: 'test', explain: () => Promise.resolve('explained') });

        class CustomError extends Error {
            public readonly code = 'ECONNREFUSED';
        }
        const failure = new CustomError('raw driver text');

        await expect(
            new TestProvider().fetch(clusterElement, actionContext(), () => Promise.reject(failure)),
        ).rejects.toBe(failure);

        expect(failure.message).toBe('raw driver text');
        expect(failure).toBeInstanceOf(CustomError);
        expect(failure.code).toBe('ECONNREFUSED');
    });

    it('leaves the default notification alone when no provider explains the failure', async () => {
        const context = actionContext();

        await expect(
            new TestProvider().fetch(clusterElement, context, () => Promise.reject(new Error('boom'))),
        ).rejects.toThrow('boom');

        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBeUndefined();
    });

    it('does not consult providers for an element that has no cluster', async () => {
        const explain = jest.fn().mockResolvedValue('should not be used');
        ConnectionDiagnosticsService.registerProvider({ id: 'test', explain });

        await expect(
            new TestProvider().fetch({ id: 'view/folder' } as TreeElement, actionContext(), () =>
                Promise.reject(new Error('boom')),
            ),
        ).rejects.toThrow('boom');

        expect(explain).not.toHaveBeenCalled();
    });
});
