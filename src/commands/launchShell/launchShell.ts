/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionString } from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { isWindows } from '../../constants';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { MongoRUResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-ru/MongoRUResourceItem';
import { MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Currently it only supports launching the MongoDB shell
 */
export async function launchShell(
    context: IActionContext,
    node: DatabaseItem | CollectionItem | ClusterItemBase,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;

    let rawConnectionString: string | undefined;

    // connection string discovery for these items can be slow, so we need to run it with a temporary description

    if (node instanceof ClusterItemBase) {
        // connecting at the account level
        // we need to discover the connection string
        rawConnectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
            return node.getConnectionString();
        });
    } else {
        // node is instanceof DatabaseItem or CollectionItem and we alrady have the connection string somewhere
        const client: ClustersClient = await ClustersClient.getClient(node.cluster.id);
        rawConnectionString = client.getConnectionStringWithPassword();
    }

    if (!rawConnectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract the connection string from the selected node.'));
        return;
    }
    context.valuesToMask.push(rawConnectionString);

    const connectionString: ConnectionString = new ConnectionString(rawConnectionString);

    const actualPassword = connectionString.password;
    context.valuesToMask.push(actualPassword);

    // Use unique environment variable names to avoid conflicts
    const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit random number string
    const uniquePassEnvVar = `documentdb_${randomSuffix}`; // Use a lowercase, generic-looking variable name to avoid drawing attention in the shell output—this helps prevent bystanders from noticing sensitive info if they're watching the user's screen.

    // Check if PowerShell is being used on Windows
    let isWindowsPowerShell = false;
    if (isWindows) {
        const terminalProfile = vscode.workspace.getConfiguration('terminal.integrated.defaultProfile').get('windows');
        if (terminalProfile === null || typeof terminalProfile === 'undefined') {
            ext.outputChannel.appendLog(
                l10n.t(
                    'Default Windows terminal profile not found in VS Code settings. Assuming PowerShell for launching MongoDB shell.',
                ),
            );
            isWindowsPowerShell = true;
        } else if (typeof terminalProfile === 'string') {
            isWindowsPowerShell =
                terminalProfile.toLowerCase() === 'powershell' || terminalProfile.toLowerCase() === 'pwsh';
        }
    }

    // Use correct variable syntax based on shell
    if (isWindows && isWindowsPowerShell) {
        connectionString.password = `$env:${uniquePassEnvVar}`;
    } else if (isWindows) {
        connectionString.password = `%${uniquePassEnvVar}%`;
    } else {
        connectionString.password = `$${uniquePassEnvVar}`;
    }

    // If the username or password is empty, remove them from the connection string to avoid invalid connection strings
    if (!connectionString.username || !actualPassword) {
        connectionString.password = '';
    }

    if ('databaseInfo' in node && node.databaseInfo?.name) {
        connectionString.pathname = node.databaseInfo.name;
    }

    // } else if (node instanceof CollectionItem) { // --> --eval terminates, we'd have to launch with a script etc. let's look into it latter
    //     const connStringWithDb = addDatabasePathToConnectionString(connectionStringWithUserName, node.databaseInfo.name);
    //     shellParameters = `"${connStringWithDb}" --eval 'db.getCollection("${node.collectionInfo.name}")'`
    // }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: `MongoDB Shell (${connectionString.username || 'default'})`, // Display actual username or a default
        hideFromUser: false,
        env: {
            [uniquePassEnvVar]: actualPassword,
        },
    });

    // Determine if TLS certificate validation should be disabled
    // This only applies to emulator connections with security disabled
    const isRegularCloudAccount = node instanceof MongoVCoreResourceItem || node instanceof MongoRUResourceItem;
    const isEmulatorWithSecurityDisabled =
        !isRegularCloudAccount &&
        node.cluster.emulatorConfiguration &&
        node.cluster.emulatorConfiguration.isEmulator &&
        node.cluster.emulatorConfiguration.disableEmulatorSecurity;

    const tlsConfiguration = isEmulatorWithSecurityDisabled ? '--tlsAllowInvalidCertificates' : '';

    terminal.sendText(`mongosh "${connectionString.toString()}" ${tlsConfiguration}`);
    terminal.show();
}
