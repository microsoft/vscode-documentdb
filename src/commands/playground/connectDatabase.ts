/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { FolderItem } from '../../tree/connections-view/FolderItem';
import { LocalEmulatorsItem } from '../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { type BaseClusterModel, type TreeCluster } from '../../tree/models/BaseClusterModel';
import { type TreeElement } from '../../tree/TreeElement';
import { pickTreeNode } from '../../utils/pickItem/pickTreeNode';

/**
 * Context-value token marking a database node in the Connections tree.
 * Playgrounds bind at the database level, so this is the picker's leaf target.
 */
const DATABASE_CONTEXT_VALUE = 'treeItem_database';

/**
 * Shows connection information for the active query playground document.
 * Invoked from the CodeLens on line 0 and from the status bar.
 *
 * When the playground is already connected, offer (via a modal) to switch it to
 * a different database. The switch is deferred: the existing connection is only
 * replaced once a new database is actually selected, so cancelling the picker
 * leaves the current connection intact.
 */
export async function showConnectionInfo(context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
        return;
    }

    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(editor.document.uri);

    if (!connection) {
        // Disconnected playgrounds normally route to the connect command directly,
        // but if we get here, just launch the picker.
        await promptAndConnectPlayground(context, editor.document.uri, 'playground.connect');
        return;
    }

    const switchAction = l10n.t('Connect to a different database…');
    const choice = await vscode.window.showInformationMessage(
        l10n.t('This playground is connected to {0} / {1}.', connection.clusterDisplayName, connection.databaseName),
        {
            modal: true,
            detail: l10n.t('Disconnect and connect this playground to a different database?'),
        },
        switchAction,
    );

    context.telemetry.properties.reconnectChoice = choice === switchAction ? 'switch' : 'dismissed';

    if (choice === switchAction) {
        // Re-pick. promptAndConnectPlayground only overwrites the binding once a new
        // database is selected, so aborting the picker preserves the old connection.
        await promptAndConnectPlayground(context, editor.document.uri, 'playground.connect');
    }
}

/**
 * Command entry point: connect (or reconnect) the active query playground to a
 * cluster/database chosen from the Connections tree.
 *
 * Invoked from the "Not connected" CodeLens / StatusBar affordance.
 */
export async function connectPlayground(context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
        return;
    }
    await promptAndConnectPlayground(context, editor.document.uri, 'playground.connect');
}

/**
 * Prompt the user to pick a database from the Connections tree and bind the
 * playground at {@link uri} to it. Reuses the live tree, so picking a cluster
 * triggers the same connect/auth flow as expanding it in the tree view.
 *
 * @param telemetrySource Identifies the calling flow in `documentdb.pickTreeNode`
 *   telemetry (e.g. `'playground.connect'` for the explicit connect affordance,
 *   `'playground.connectOnRun'` for the connect-on-run path), so the callers stay
 *   distinguishable.
 * @returns the bound connection, or `undefined` if the user cancelled or the
 *          selection could not be resolved.
 */
export async function promptAndConnectPlayground(
    context: IActionContext,
    uri: vscode.Uri,
    telemetrySource: string,
): Promise<PlaygroundConnection | undefined> {
    const node = await pickTreeNode({
        leafContextValue: DATABASE_CONTEXT_VALUE,
        telemetrySource,
        placeHolder: l10n.t('Select a database to connect this playground to'),
        getDetail: getNodeDetail,
    });

    if (!node) {
        context.telemetry.properties.outcome = 'cancelled';
        return undefined;
    }

    const connection = toPlaygroundConnection(node);
    if (!connection) {
        context.telemetry.properties.outcome = 'invalidSelection';
        void vscode.window.showErrorMessage(l10n.t('The selected item is not a database.'));
        return undefined;
    }

    context.telemetry.properties.outcome = 'connected';
    context.telemetry.properties.experience = node instanceof DatabaseItem ? node.experience?.api : undefined;

    PlaygroundService.getInstance().setConnection(uri, connection);
    return connection;
}

/**
 * Second-line detail for a pick. Every selectable row gets one so the list has a
 * uniform two-line height (no ragged mix of one- and two-line rows):
 *  - folders          → a static "Folder" tag,
 *  - local emulators  → a static "Local emulators" tag,
 *  - clusters         → their host(s) (falling back to "Cluster"),
 *  - databases        → a static "Database" tag.
 * The connection string read here is the non-secret one stored on the cluster model.
 */
function getNodeDetail(node: TreeElement): string | undefined {
    if (node instanceof FolderItem) {
        return l10n.t('Folder');
    }
    if (node instanceof LocalEmulatorsItem) {
        return l10n.t('Local emulators');
    }
    if (node instanceof DatabaseItem) {
        return l10n.t('Database');
    }

    const cluster = getClusterFromNode(node);
    if (!cluster) {
        return undefined;
    }
    // Cluster node — always return a value so the row stays two lines.
    return tryGetHost(cluster.connectionString) ?? l10n.t('Cluster');
}

/** Parse the host(s) out of a (non-secret) connection string; `undefined` if missing/unparseable. */
function tryGetHost(connectionString: string | undefined): string | undefined {
    if (!connectionString) {
        return undefined;
    }
    try {
        return new DocumentDBConnectionString(connectionString).hosts?.join(', ') || undefined;
    } catch {
        return undefined;
    }
}

/** Duck-typed accessor for the `cluster` carried by cluster and database tree items. */
function getClusterFromNode(node: TreeElement): TreeCluster<BaseClusterModel> | undefined {
    const maybe = node as Partial<{ cluster: unknown }>;
    const cluster = maybe.cluster;
    if (cluster && typeof cluster === 'object' && 'clusterId' in cluster) {
        return cluster as TreeCluster<BaseClusterModel>;
    }
    return undefined;
}

/**
 * Build a {@link PlaygroundConnection} from a picked tree node. Uses the stable
 * `clusterId` (never `treeId`) for cache/credential lookups per the dual-ID rule.
 */
function toPlaygroundConnection(node: TreeElement): PlaygroundConnection | undefined {
    if (!(node instanceof DatabaseItem)) {
        return undefined;
    }
    return {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        databaseName: node.databaseInfo.name,
        viewId: node.cluster.viewId,
    };
}
