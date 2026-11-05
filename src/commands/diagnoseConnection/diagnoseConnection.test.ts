/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { unwrapArgs } from '@microsoft/vscode-azureresources-api';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, DocumentDBExperience } from '../../DocumentDBExperiences';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ConnectionReachabilityService } from '../../services/connectionReachabilityService';
import { ConnectionStorageService, ItemType } from '../../services/connectionStorageService';
import { type TreeElement } from '../../tree/TreeElement';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import {
    CLUSTER_ITEM_CONTEXT_VALUE,
    ClusterItemBase,
    type EphemeralClusterCredentials,
} from '../../tree/documentdb/ClusterItemBase';
import type * as TreeNodePicker from '../../utils/pickItem/pickTreeNode';
import { pickTreeNode } from '../../utils/pickItem/pickTreeNode';
import { openConnectivityTroubleshooter } from '../../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController';
import { troubleshootConnection } from './diagnoseConnection';

const mockPickerContext = vi.hoisted(() => ({
    telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
    errorHandling: {},
    ui: { showQuickPick: vi.fn() },
}));

vi.mock('@microsoft/vscode-azext-utils', async () => ({
    ...(await vi.importActual<Record<string, unknown>>('@microsoft/vscode-azext-utils')),
    UserCancelledError: class UserCancelledError extends Error {},
    createContextValue: (values: string[]): string => values.join(';'),
    callWithTelemetryAndErrorHandling: async (
        _event: string,
        callback: (context: typeof mockPickerContext) => Promise<unknown>,
    ): Promise<unknown> => callback(mockPickerContext),
}));
vi.mock('../../extensionVariables', () => ({
    ext: { connectionsBranchDataProvider: { getChildren: vi.fn() }, outputChannel: { appendLine: vi.fn() } },
}));
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: vi.fn(), setCredentials: vi.fn(), setAuthCredentials: vi.fn() },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), exists: vi.fn().mockReturnValue(false) },
}));
vi.mock('../../utils/pickItem/pickTreeNode', () => ({ pickTreeNode: vi.fn() }));
vi.mock('../../webviews/documentdb/connectionDiagnostics/connectionDiagnosticsController', () => ({
    openConnectivityTroubleshooter: vi.fn(),
}));

class TestClusterItem extends ClusterItemBase {
    public constructor(viewId: Views = Views.ConnectionsView) {
        super({
            treeId: `${viewId}/folder/stable-id`,
            clusterId: 'stable-id',
            name: 'Test connection',
            viewId,
            dbExperience: DocumentDBExperience,
        });
        this.journeyCorrelationId = 'journey-id';
    }

    public override getCredentials = vi
        .fn<() => Promise<EphemeralClusterCredentials | undefined>>()
        .mockResolvedValue(undefined);

    protected authenticateAndConnect(): Promise<ClustersClient | null> {
        throw new Error('Must not authenticate when opening the diagnosis panel');
    }
}

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
    } as unknown as IActionContext;
}

function container(id: string, contextValue: string): TreeElement {
    return {
        id,
        contextValue,
        getTreeItem: () => ({ label: id, contextValue }),
        getChildren: vi.fn().mockResolvedValue([]),
    } as TreeElement;
}

describe('troubleshootConnection', () => {
    let node: TestClusterItem;
    let context: IActionContext;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(pickTreeNode).mockReset();
        vi.mocked(openConnectivityTroubleshooter).mockReturnValue({
            panelAction: 'created',
            troubleshooterSessionId: 'session-id',
        });
        vi.spyOn(ClusterItemBase.prototype, 'connect');
        node = new TestClusterItem();
        context = makeContext();
    });

    afterEach(() => {
        expect(ClusterItemBase.prototype.connect).not.toHaveBeenCalled();
        expect(ClustersClient.getClient).not.toHaveBeenCalled();
        expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
        expect(CredentialCache.setCredentials).not.toHaveBeenCalled();
        expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it.each([
        [undefined, 'contextMenu'],
        ['errorNode', 'errorNode'],
        [[undefined], 'contextMenu'],
    ] as const)('builds a stable target for the node argument %j', async (hint, entryPoint) => {
        await troubleshootConnection(context, ...unwrapArgs<ClusterItemBase>([node, undefined, hint]));

        expect(pickTreeNode).not.toHaveBeenCalled();
        expect(openConnectivityTroubleshooter).toHaveBeenCalledOnce();
        const options = vi.mocked(openConnectivityTroubleshooter).mock.calls[0][0];
        expect(options.entryPoint).toBe(entryPoint);
        expect(options.target).toMatchObject({
            clusterId: 'stable-id',
            displayName: 'Test connection',
            sourceView: Views.ConnectionsView,
        });
        expect(options.target.clusterId).not.toBe(node.cluster.treeId);
        expect(node.getCredentials).not.toHaveBeenCalled();
        expect(context.telemetry.maskEntireErrorMessage).toBe(true);
        expect(context.telemetry.properties).toEqual({
            entryPoint,
            sourceView: Views.ConnectionsView,
            panelAction: 'created',
            troubleshooterSessionId: 'session-id',
            journeyCorrelationId: 'journey-id',
        });

        const diagnosticRead = vi.spyOn(node, 'getCredentialsForDiagnostics');
        const read = { signal: new AbortController().signal };
        await expect(options.target.getCredentials(read)).resolves.toBeUndefined();
        // The target always uses the node's diagnostic read; the base default reads stored data.
        expect(diagnosticRead).toHaveBeenCalledExactlyOnceWith(read);
        expect(node.getCredentials).toHaveBeenCalledExactlyOnceWith();
    });

    it('reads stored-connection credentials without invoking reachability', async (): Promise<void> => {
        const stored = {
            id: 'stable-id',
            name: 'Stored connection',
            properties: { type: ItemType.Connection, api: API.DocumentDB, availableAuthMethods: [] },
            secrets: { connectionString: 'mongodb://localhost:27017/db' },
        };
        vi.spyOn(ConnectionStorageService, 'get').mockResolvedValue(stored);
        vi.spyOn(ConnectionReachabilityService, 'ensureReachable').mockResolvedValue(undefined);
        const storedNode = new DocumentDBClusterItem({ ...node.cluster, storageId: 'stable-id' });
        await troubleshootConnection(context, storedNode);
        const { target } = vi.mocked(openConnectivityTroubleshooter).mock.calls[0][0];
        expect(ConnectionStorageService.get).not.toHaveBeenCalled();
        await expect(target.getCredentials({ signal: new AbortController().signal })).resolves.toMatchObject({
            connectionString: stored.secrets.connectionString,
        });
        expect(ConnectionReachabilityService.ensureReachable).not.toHaveBeenCalled();
    });

    it('preserves the error-node entry point through the real argument unwrapper', async (): Promise<void> => {
        vi.spyOn(
            node as unknown as { authenticateAndConnect(): Promise<ClustersClient | null> },
            'authenticateAndConnect',
        ).mockResolvedValue(null);
        const children = await node.getChildren();
        vi.mocked(CredentialCache.hasCredentials).mockClear();
        const errorNode = children.find((child): boolean => child.id.endsWith('/diagnose'));
        expect(errorNode).toBeDefined();
        const command = (await errorNode?.getTreeItem())?.command;
        expect(command?.command).toBe('vscode-documentdb.command.diagnoseConnection');
        await troubleshootConnection(context, ...unwrapArgs<ClusterItemBase>(command?.arguments));
        expect(openConnectivityTroubleshooter).toHaveBeenCalledWith(
            expect.objectContaining({ entryPoint: 'errorNode' }),
        );
        expect(context.telemetry.properties.entryPoint).toBe('errorNode');
    });

    it.each([Views.ConnectionsView, Views.DiscoveryView, Views.AzureResourcesView, Views.AzureWorkspaceView])(
        'records the owning view %s',
        async (viewId) => {
            await troubleshootConnection(context, new TestClusterItem(viewId));
            expect(context.telemetry.properties.sourceView).toBe(viewId);
        },
    );

    it('infers the view from the tree path for older nodes without viewId', async () => {
        node = new TestClusterItem(Views.DiscoveryView);
        Reflect.deleteProperty(node.cluster, 'viewId');
        await troubleshootConnection(context, node);
        expect(context.telemetry.properties.sourceView).toBe(Views.DiscoveryView);
    });

    it('records a focused panel and keeps its session ID', async () => {
        vi.mocked(openConnectivityTroubleshooter).mockReturnValue({
            panelAction: 'focused',
            troubleshooterSessionId: 'existing-session',
        });
        await troubleshootConnection(context, node);
        expect(context.telemetry.properties.panelAction).toBe('focused');
        expect(context.telemetry.properties.troubleshooterSessionId).toBe('existing-session');
        expect(node.getCredentials).not.toHaveBeenCalled();
    });

    it('uses the existing connection picker and records the palette entry point', async () => {
        vi.mocked(pickTreeNode).mockResolvedValue(node);
        await troubleshootConnection(context, ...unwrapArgs<ClusterItemBase>([]));
        expect(pickTreeNode).toHaveBeenCalledWith(
            expect.objectContaining({
                leafContextValue: CLUSTER_ITEM_CONTEXT_VALUE,
                telemetrySource: 'troubleshootConnection',
                placeHolder: 'Select a connection to diagnose',
            }),
        );
        expect(openConnectivityTroubleshooter).toHaveBeenCalledWith({
            target: expect.objectContaining({ clusterId: 'stable-id', sourceView: 'commandPalette' }),
            entryPoint: 'commandPalette',
        });
        expect(context.telemetry.properties).toMatchObject({
            entryPoint: 'commandPalette',
            sourceView: 'commandPalette',
            panelAction: 'created',
            troubleshooterSessionId: 'session-id',
        });
        expect(node.getCredentials).not.toHaveBeenCalled();
    });

    it('treats a dismissed picker as cancellation, after setting masked palette telemetry', async () => {
        vi.mocked(pickTreeNode).mockImplementation(async () => {
            expect(context.telemetry.maskEntireErrorMessage).toBe(true);
            expect(context.telemetry.properties).toEqual({
                entryPoint: 'commandPalette',
                sourceView: 'commandPalette',
            });
            return undefined;
        });
        await expect(troubleshootConnection(context)).rejects.toBeInstanceOf(UserCancelledError);
        expect(openConnectivityTroubleshooter).not.toHaveBeenCalled();
    });

    it('preserves picker-thrown cancellation', async () => {
        const cancellation = new UserCancelledError();
        vi.mocked(pickTreeNode).mockRejectedValue(cancellation);
        await expect(troubleshootConnection(context)).rejects.toBe(cancellation);
        expect(openConnectivityTroubleshooter).not.toHaveBeenCalled();
    });

    it('browses saved folders and connections without expanding a cluster or Quick Start instance', async () => {
        const folder = container('folder', 'connectionsView;treeItem_folder');
        const local = container('local', 'treeItem_LocalEmulators;connectionsView');
        const quickStart = container('quickStart', 'treeItem_localQuickStart;connectionsView');
        const instance = container('instance', 'treeItem_quickStartInstance;state_running');
        const getChildren = vi.mocked(ext.connectionsBranchDataProvider.getChildren);
        getChildren.mockImplementation(async (element) =>
            element === folder ? [node] : [folder, local, quickStart, instance],
        );
        mockPickerContext.ui.showQuickPick
            .mockImplementationOnce(async (items: Promise<Array<{ data?: TreeElement }>>) =>
                (await items).find((item) => item.data === folder),
            )
            .mockImplementationOnce(async (items: Promise<Array<{ data?: TreeElement }>>) =>
                (await items).find((item) => item.data === node),
            );
        const picker = await vi.importActual<typeof TreeNodePicker>('../../utils/pickItem/pickTreeNode');
        vi.mocked(pickTreeNode).mockImplementation(picker.pickTreeNode);
        await troubleshootConnection(context, ...unwrapArgs<ClusterItemBase>([]));

        expect(getChildren.mock.calls.map(([element]) => element)).toEqual([undefined, folder]);
        expect(quickStart.getChildren).not.toHaveBeenCalled();
        expect(instance.getChildren).not.toHaveBeenCalled();
        expect(node.getCredentials).not.toHaveBeenCalled();
        expect(openConnectivityTroubleshooter).toHaveBeenCalledOnce();
    });
});

interface Manifest {
    contributes: {
        commands: Array<{ command: string; title: string; category?: string }>;
        menus: Record<'view/item/context' | 'commandPalette', Array<{ command: string; when?: string }>>;
    };
}

function readJson<T>(file: string): T {
    return JSON.parse(readFileSync(resolve(__dirname, '../../..', file), 'utf8')) as T;
}

function matchesWhen(when: string, view: string, viewItem: string): boolean {
    return when.split(' && ').every((clause) => {
        if (clause === '!listMultiSelection') {
            return true;
        }
        const match = /^(view|viewItem) =~ \/(.+)\/([a-z]*)$/.exec(clause);
        if (!match) {
            throw new Error(`Unsupported manifest clause: ${clause}`);
        }
        return new RegExp(match[2], match[3]).test(match[1] === 'view' ? view : viewItem);
    });
}

describe('troubleshootConnection manifest and activation', () => {
    const command = 'vscode-documentdb.command.diagnoseConnection';
    const manifest = readJson<Manifest>('package.json');
    const menus = manifest.contributes.menus['view/item/context'].filter((entry) => entry.command === command);

    it('contributes a DocumentDB title and leaves the palette entry visible', () => {
        expect(manifest.contributes.commands.filter((entry) => entry.command === command)).toEqual([
            { command, title: 'Diagnose Connection…', category: 'DocumentDB' },
        ]);
        expect(manifest.contributes.menus.commandPalette.filter((entry) => entry.command === command)).toEqual([]);
    });

    it.each(['connectionsView', 'discoveryView', 'azureResourceGroups', 'azureFocusView'])(
        'shows the cluster context menu in %s, never on a Quick Start instance',
        (view) => {
            expect(menus).toHaveLength(1);
            const when = menus[0].when ?? '';
            expect(matchesWhen(when, view, `${view};${CLUSTER_ITEM_CONTEXT_VALUE};experience_documentDB`)).toBe(true);
            expect(matchesWhen(when, view, 'treeItem_quickStartInstance;state_running;connectionsView')).toBe(false);
            expect(matchesWhen(when, view, 'treeItem_database;experience_documentDB')).toBe(false);
        },
    );

    it('pins the actual Quick Start instance context-value contract', () => {
        const source = readFileSync(
            resolve(__dirname, '../../tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts'),
            'utf8',
        );
        expect(source).toContain("const INSTANCE_CONTEXT = 'treeItem_quickStartInstance';");
        expect(source).toContain('this.contextValue = createContextValue([INSTANCE_CONTEXT, stateToken]);');
    });

    it('registers eagerly with tree unwrapping and command correlation', () => {
        const source = readFileSync(resolve(__dirname, '../../documentdb/ClustersExtension.ts'), 'utf8');
        expect(source).toMatch(
            /registerCommandWithTreeNodeUnwrapping\(\s*'vscode-documentdb\.command\.diagnoseConnection',\s*withTreeNodeCommandCorrelation\(troubleshootConnection\)/,
        );
    });
});
