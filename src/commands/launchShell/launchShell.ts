/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { isWindows } from '../../constants';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { maskSensitiveValuesInTelemetry } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
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
    context.telemetry.properties.isWindows = isWindows.toString();

    let connectionString: string | undefined = undefined;
    let username: string | undefined = undefined;
    let password: string | undefined;
    let authMechanism: AuthMethodId | undefined;

    // 1. In case we're connected, we should use the preferred authentication method and settings
    //    This can be true for ClusterItemBase (cluster level), and will for sure be true on the database and the collection level
    if (ClustersClient.exists(node.cluster.id)) {
        const activeClient: ClustersClient = await ClustersClient.getClient(node.cluster.id);
        const clusterCredentials = activeClient.getCredentials();
        if (clusterCredentials) {
            connectionString = clusterCredentials.connectionString;
            username = clusterCredentials.connectionUser;
            password = clusterCredentials.connectionPassword;
            authMechanism = clusterCredentials.authMechanism;
        }
    } else {
        // it looks like there is no active connection.
        // We can attemp to read connection info from the cluster information in case we're at the cluster level
        if (node instanceof ClusterItemBase) {
            const discoveredClusterCredentials = await ext.state.runWithTemporaryDescription(
                node.id,
                l10n.t('Working…'),
                async () => {
                    return node.getCredentials();
                },
            );

            if (discoveredClusterCredentials) {
                const selectedAuthMethod = discoveredClusterCredentials.selectedAuthMethod;
                const nativeAuthIsAvailable = discoveredClusterCredentials.availableAuthMethods.includes(
                    AuthMethodId.NativeAuth,
                );

                if (selectedAuthMethod === AuthMethodId.NativeAuth || (nativeAuthIsAvailable && !selectedAuthMethod)) {
                    connectionString = discoveredClusterCredentials.connectionString;
                    username = discoveredClusterCredentials.connectionUser;
                    password = discoveredClusterCredentials.connectionPassword;
                    authMechanism = AuthMethodId.NativeAuth;
                } else {
                    // Only SCRAM-SHA-256 (username/password) authentication is supported here.
                    // Today we support Entra ID with Azure Cosmos DB for MongoDB (vCore), and vCore does not support shell connectivity as of today
                    // https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/limits#microsoft-entra-id-authentication
                    throw Error(
                        l10n.t(
                            'Unsupported authentication mechanism. Only "Username and Password" (SCRAM-SHA-256) is supported.',
                        ),
                    );
                }
            }
        }
    }

    if (!connectionString) {
        void vscode.window.showErrorMessage(l10n.t('Failed to extract cluster credentials from the selected node.'));
        return;
    }

    if (authMechanism !== AuthMethodId.NativeAuth) {
        // Only SCRAM-SHA-256 (username/password) authentication is supported here.
        // Today we support Entra ID with Azure Cosmos DB for MongoDB (vCore), and vCore does not support shell connectivity as of today
        // https://learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/limits#microsoft-entra-id-authentication
        throw Error(
            l10n.t('Unsupported authentication mechanism. Only SCRAM-SHA-256 (username/password) is supported.'),
        );
    }

    const parsedConnectionString: DocumentDBConnectionString = new DocumentDBConnectionString(connectionString);
    parsedConnectionString.username = username ?? '';
    maskSensitiveValuesInTelemetry(context, parsedConnectionString);

    // Note to code maintainers:
    // We're encoding the password to ensure it is safe to use in the connection string
    // shared with the shell process.
    const shellSafePassword = encodeURIComponent(password ?? '');
    context.valuesToMask.push(shellSafePassword);

    // Use unique environment variable names to avoid conflicts
    const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit random number string
    const uniquePassEnvVar = `documentdb_${randomSuffix}`; // Use a lowercase, generic-looking variable name to avoid drawing attention in the shell output—this helps prevent bystanders from noticing sensitive info if they're watching the user's screen.

    // Determine appropriate environment variable syntax based on shell type
    let envVarSyntax = '';
    if (isWindows) {
        const terminalProfile = vscode.workspace.getConfiguration('terminal.integrated.defaultProfile').get('windows');

        if (terminalProfile === null || typeof terminalProfile === 'undefined') {
            // Default to PowerShell if no profile is found
            ext.outputChannel.appendLog(
                l10n.t(
                    'Default Windows terminal profile not found in VS Code settings. Assuming PowerShell for launching MongoDB shell.',
                ),
            );
            envVarSyntax = `$env:${uniquePassEnvVar}`;
            context.telemetry.properties.terminalType = 'PowerShell';
        } else if (typeof terminalProfile === 'string') {
            const profile = terminalProfile.toLowerCase();

            if (profile === 'powershell' || profile === 'pwsh' || profile === 'windows powershell') {
                // PowerShell detected
                envVarSyntax = `$env:${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'PowerShell';
            } else if (profile === 'cmd' || profile === 'command prompt') {
                // Command Prompt detected
                envVarSyntax = `%${uniquePassEnvVar}%`;
                context.telemetry.properties.terminalType = 'Cmd';
            } else if (profile === 'git bash') {
                // Git Bash detected
                envVarSyntax = `$${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'GitBash';
            } else if (profile.includes('wsl')) {
                // WSL shell detected
                envVarSyntax = `$${uniquePassEnvVar}`;
                context.telemetry.properties.terminalType = 'WSL';
            } else {
                // Unrecognized profile, default to CMD syntax
                envVarSyntax = `%${uniquePassEnvVar}%`;
                context.telemetry.properties.terminalType = 'Other';
                context.telemetry.properties.terminalProfileValue = terminalProfile;
            }
        }
    } else {
        // Unix-like environment (macOS/Linux)
        envVarSyntax = `$${uniquePassEnvVar}`;
        context.telemetry.properties.terminalType = 'Unix';
    }

    // Note to code maintainers:
    // We're using a sentinel value approach here to avoid URL encoding issues with environment variable
    // references. For example, in PowerShell the environment variable reference "$env:VAR_NAME" contains
    // a colon character (":") which gets URL encoded to "%3A" when added directly to parsedConnectionString.password.
    // This encoding breaks the environment variable reference syntax in the shell.
    //
    // By using a unique sentinel string first and then replacing it with the raw (unencoded) environment
    // variable reference after toString() is called, we ensure the shell correctly interprets the
    // environment variable.
    const PASSWORD_SENTINEL = '__MONGO_PASSWORD_PLACEHOLDER__';
    parsedConnectionString.password = PASSWORD_SENTINEL;

    // If the username or password is empty, remove them from the connection string to avoid invalid connection strings
    if (!parsedConnectionString.username || !shellSafePassword) {
        parsedConnectionString.password = '';
    }

    if ('databaseInfo' in node && node.databaseInfo?.name) {
        parsedConnectionString.pathname = node.databaseInfo.name;
    }

    // } else if (node instanceof CollectionItem) { // --> --eval terminates, we'd have to launch with a script etc. let's look into it latter
    //     const connStringWithDb = addDatabasePathToConnectionString(connectionStringWithUserName, node.databaseInfo.name);
    //     shellParameters = `"${connStringWithDb}" --eval 'db.getCollection("${node.collectionInfo.name}")'`
    // }

    const terminal: vscode.Terminal = vscode.window.createTerminal({
        name: `MongoDB Shell (${parsedConnectionString.username || 'default'})`, // Display actual username or a default
        hideFromUser: false,
        env: {
            [uniquePassEnvVar]: shellSafePassword,
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

    // Get the connection string and replace the sentinel with the environment variable syntax
    const finalConnectionString = parsedConnectionString.toString().replace(PASSWORD_SENTINEL, envVarSyntax);

    terminal.sendText(`mongosh "${finalConnectionString}" ${tlsConfiguration}`);
    terminal.show();
}
