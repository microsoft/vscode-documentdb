/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { Views } from './documentdb/Views';
import { ext } from './extensionVariables';
import { StorageNames, StorageService, type StorageItem } from './services/storageService';
import { revealConnectionsViewElement } from './tree/api/revealConnectionsViewElement';
import { generateDocumentDBStorageId } from './utils/storageUtils';

// #region Type Definitions

/**
 * Interface for URI parameters used for connecting to DocumentDB resources.
 */
interface UriParams {
    /** The connection string to the DocumentDB/MongoDB account */
    connectionString?: string;
    /** The name of the database in the DocumentDB account */
    database?: string;
    /** The name of the container/collection within the database */
    container?: string;
}

// #endregion

// #region Main Handler Functions

/**
 * Global URI handler for processing external URIs routed to this extension.
 *
 * This function handles URIs that contain a set of parameters:
 * - the default is a connection string to a DocumentDB / MongoDB resource
 * - other modes will be added in the future, these will be handled by our discoverability plugins
 *
 * @param uri - The VS Code URI to handle, typically from an external source
 * @returns {Promise<void>} A Promise that resolves when the URI has been handled
 */
export async function globalUriHandler(uri: vscode.Uri): Promise<void> {
    return callWithTelemetryAndErrorHandling('globalUriHandler', async (context: IActionContext) => {
        try {
            // Extract and validate parameters
            const params = extractAndValidateParams(context, uri.query);

            // Process the URI
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: l10n.t('Importing new DocumentDB Connection…'),
                    cancellable: false,
                },
                async () => {
                    await handleConnectionStringRequest(context, params);
                },
            );
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to process URI: {0}', errMsg));
        }
    });
}

/**
 * Handles connection string requests by connecting to DocumentDB resources.
 *
 * This function processes a connection string and optional parameters to either:
 * 1. Create a new connection from the connection string
 * 2. Reveal an existing connection if one with the same parameters already exists
 *
 * @param context - The action context for telemetry and other VS Code operations
 * @param params - The parameters extracted from the request
 * @throws {Error} when connection string is invalid or missing
 */
async function handleConnectionStringRequest(
    context: IActionContext,
    params: ReturnType<typeof extractParams>,
): Promise<void> {
    // Validate connection string
    validateConnectionString(params.connectionString);

    // Parse the connection string
    const parsedCS = new ConnectionString(params.connectionString!);

    // Mask sensitive values in telemetry
    maskSensitiveValuesInTelemetry(context, parsedCS);

    // Process the hosts from the connection string
    const joinedHosts = [...parsedCS.hosts].sort().join(',');

    // Determine if this is an emulator connection
    const isEmulator = isEmulatorConnection(parsedCS);
    const disableEmulatorSecurity = parsedCS.searchParams.get('tlsAllowInvalidCertificates') === 'true';

    // Create a label for the new connection
    let newConnectionLabel = createConnectionLabel(parsedCS, joinedHosts);

    // Check for existing connections with the same parameters
    const existingConnections = await getExistingConnections(isEmulator);
    const existingDuplicateConnection = findDuplicateConnection(existingConnections, parsedCS, joinedHosts);

    if (!existingDuplicateConnection) {
        const storageId = generateDocumentDBStorageId(parsedCS.toString()); // FYI: working with the parsedConnection string to guarantee a consistent storageId in this file.

        let existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
        // If a connection with the same label exists, append a number to the label
        while (existingDuplicateLabel) {
            newConnectionLabel = generateUniqueLabel(newConnectionLabel);
            existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
        }

        // Create the the storageItem
        const storageItem: StorageItem = {
            id: storageId,
            name: newConnectionLabel,
            properties: { isEmulator: isEmulator, disableEmulatorSecurity: disableEmulatorSecurity },
            secrets: [parsedCS.toString()],
        };

        await StorageService.get(StorageNames.Connections).push(
            isEmulator ? 'emulators' : 'clusters',
            storageItem,
            true,
        );

        ext.connectionsBranchDataProvider.refresh();
        await revealInConnectionsView(context, storageId, isEmulator, params.database, params.container);
    } else {
        // the connection already exists, let's just reveal it in the Connections View
        const storageId = existingDuplicateConnection.id;
        await revealInConnectionsView(context, storageId, isEmulator, params.database, params.container);
    }

    // now we have the storageId of an existing or newly created connection
    // and wa want to reveal it in the Connections View

    // if (params.database && params.container) {
    //     // Open appropriate editor based on API type
    //     await openAppropriateEditorForConnection(context, parsedConnection, params.database, params.container);
    // }
}

// #endregion

// #region Connection Helpers

/**
 * Validates that the connection string is present and has the correct format
 */
function validateConnectionString(connectionString: string | undefined): void {
    if (!connectionString) {
        throw new Error(l10n.t('Connection string is not set'));
    }

    if (!connectionString.startsWith('mongodb://') && !connectionString.startsWith('mongodb+srv://')) {
        throw new Error(
            l10n.t('Invalid connection string format. It should start with "mongodb://" or "mongodb+srv://"'),
        );
    }
}

/**
 * Determines if a connection is to a local emulator based on host information
 */
function isEmulatorConnection(parsedCS: ConnectionString): boolean {
    return parsedCS.hosts?.length > 0 && parsedCS.hosts[0].includes('localhost');
}

/**
 * Creates a display label for a connection based on parsed connection string
 */
function createConnectionLabel(parsedCS: ConnectionString, joinedHosts: string): string {
    return parsedCS.username && parsedCS.username.length > 0 ? `${parsedCS.username}@${joinedHosts}` : joinedHosts;
}

/**
 * Retrieves existing connections of the specified type
 */
async function getExistingConnections(isEmulator: boolean): Promise<StorageItem[]> {
    return await StorageService.get(StorageNames.Connections).getItems(isEmulator ? 'emulators' : 'clusters');
}

/**
 * Finds a duplicate connection in the existing connections list
 */
function findDuplicateConnection(
    existingConnections: StorageItem[],
    parsedCS: ConnectionString,
    joinedHosts: string,
): StorageItem | undefined {
    return existingConnections.find((item) => {
        const secret = item.secrets?.[0];
        if (!secret) {
            return false; // Skip if no secret string is found
        }

        const itemCS = new ConnectionString(secret);
        return itemCS.username === parsedCS.username && [...itemCS.hosts].sort().join(',') === joinedHosts;
    });
}

/**
 * Generates a unique label by appending or incrementing a number
 */
function generateUniqueLabel(existingLabel: string): string {
    /**
     * Matches and captures parts of a connection label string.
     *
     * The regular expression `^(.*?)(\s*\(\d+\))?$` is used to parse the connection label into two groups:
     * - The first capturing group `(.*?)` matches the main part of the label (non-greedy match of any characters).
     * - The second capturing group `(\s*\(\d+\))?` optionally matches a numeric suffix enclosed in parentheses,
     *   which may be preceded by whitespace. For example, " (123)".
     */
    const match = existingLabel.match(/^(.*?)(\s*\(\d+\))?$/);
    if (match) {
        const baseName = match[1];
        const count = match[2] ? parseInt(match[2].replace(/\D/g, ''), 10) + 1 : 1;
        return `${baseName} (${count})`;
    }
    return `${existingLabel} (1)`;
}

// #endregion

// #region View Operations

/**
 * Reveals an element in the Connections View.
 *
 * @param context - The action context for telemetry
 * @param storageId - The ID of the connection to reveal
 * @param isEmulator - Whether the connection is to a local emulator
 * @param database - Optional database name to reveal
 * @param collection - Optional collection name to reveal
 */
async function revealInConnectionsView(
    context: IActionContext,
    storageId: string,
    isEmulator: boolean,
    database?: string,
    collection?: string,
): Promise<void> {
    /**
     * This code builds a tree path based on the structure of the Connections View.
     * Any change to the Connections View structure will require changes here.
     */
    let treePath = `${Views.ConnectionsView}`;

    // Add 'Local Emulators' node to the path, if needed
    if (isEmulator) {
        treePath += '/localEmulators';
    }

    // Add the storage ID
    treePath += `/${storageId}`;

    // Add database if provided
    if (database) {
        treePath += `/${database}`;

        // Add collection only if database is present
        if (collection) {
            treePath += `/${collection}`;
        }
    }

    await revealConnectionsViewElement(context, treePath, {
        select: true,
        focus: true,
        expand: true,
    });
}

// #endregion

// #region Parameter Processing

/**
 * Extracts query parameters from a URL query string.
 *
 * @param query - The URL query string to extract parameters from
 * @returns UriParams object containing the extracted parameters
 */
function extractParams(query: string): UriParams {
    const params: UriParams = {};
    const queryParams = new URLSearchParams(query);

    // Function to safely decode URI components, handling double encoding
    const safeDoubleDecodeURIComponent = (value: string | null, fieldName: string): string | undefined => {
        if (!value) return undefined;

        try {
            // Decode to handle URL encoding
            return decodeURIComponent(value);
        } catch (error) {
            throw new Error(
                l10n.t(
                    'Invalid "{0}" parameter format: {1}',
                    fieldName,
                    error instanceof Error ? error.message : String(error),
                ),
            );
        }
    };

    params.connectionString = safeDoubleDecodeURIComponent(queryParams.get('connectionString'), 'connectionString');
    params.database = safeDoubleDecodeURIComponent(queryParams.get('database'), 'database');
    params.container = safeDoubleDecodeURIComponent(queryParams.get('container'), 'container');

    return params;
}

/**
 * Extracts and validates URI parameters from a query string.
 *
 * @param context - The action context used for telemetry tracking
 * @param queryFragment - The query fragment string from the URL
 * @returns The extracted and validated URI parameters
 * @throws Error when the parameters are invalid
 */
function extractAndValidateParams(context: IActionContext, queryFragment: string): UriParams {
    const params: UriParams = extractParams(queryFragment);

    // Add sensitive values to valuesToMask to prevent sensitive data in logs
    maskParamsInTelemetry(context, params);

    if (!params.connectionString) {
        throw new Error(l10n.t('The connection string is required.'));
    }

    context.telemetry.properties.uriType = 'connectionString';
    context.telemetry.properties.hasDatabase = params.database ? 'true' : 'false';
    context.telemetry.properties.hasContainer = params.container ? 'true' : 'false';

    return params;
}

/**
 * Masks sensitive parameter values in telemetry data
 */
function maskParamsInTelemetry(context: IActionContext, params: UriParams): void {
    Object.entries(params).forEach(([key, value]) => {
        switch (key) {
            case 'connectionString':
            case 'database':
            case 'container':
                if (value !== undefined && typeof value === 'string') {
                    context.valuesToMask.push(value);
                }
                break;
        }
    });
}

/**
 * Adds sensitive values from a connection string to the telemetry masking list
 */
function maskSensitiveValuesInTelemetry(context: IActionContext, parsedCS: ConnectionString): void {
    [parsedCS.username, parsedCS.password, parsedCS.port, ...(parsedCS.hosts || [])]
        .filter(Boolean)
        .forEach((value) => context.valuesToMask.push(value));
}

// #endregion

// #region Commented out code for reference (to be implemented later)

// /**
//  * Creates and attaches a database connection to the workspace.
//  *
//  * @param accountId - The ID of the account to attach
//  * @param accountName - The display name of the account
//  * @param api - The API type (Core, MongoDB, etc.) of the account
//  * @param connectionString - The connection string used to connect to the account
//  * @param isEmulator - Whether this connection is to a local emulator
//  * @param emulatorPort - Optional port number for the emulator connection
//  * @returns A Promise that resolves to the ID of the created/updated connection
//  *
//  * @remarks
//  * This function will:
//  * 1. Focus the Azure Workspace view
//  * 2. Create the connection with the specified parameters
//  * 3. If a connection with the same ID already exists, prompt the user to update it
//  */
// async function createAttachedForConnection(
//     accountId: string,
//     accountName: string,
//     api: API,
//     connectionString: string,
//     isEmulator: boolean,
//     emulatorPort?: string,
//     disableEmulatorSecurity?: boolean,
// ): Promise<string> {
//     const rootId = `${WorkspaceResourceType.MongoClusters}`;
//     const parentId = `${rootId}${isEmulator ? '/localEmulators' : ''}`;
//     const name = !isEmulator ? accountName : getEmulatorItemLabelForApi(api, emulatorPort);
//     const id = !isEmulator ? accountId : getEmulatorItemUniqueId(connectionString);
//     const fulId = `${parentId}/${id}`;
//     // Open the Azure Workspace view
//     await vscode.commands.executeCommand('azureWorkspace.focus');
//     if (rootId !== parentId) {
//         // TODO: this seems to be a bug in revealWorkspaceResource
//         // If the parentId is not the root it will fail to drill down into the hierarchy,
//         // we need to reveal the root first
//         await ext.rgApiV2.resources.revealWorkspaceResource(rootId, {
//             select: true,
//             focus: true,
//             expand: true,
//         });
//     }
//     // Reveal the parent node to show progress in the tree
//     await ext.rgApiV2.resources.revealWorkspaceResource(parentId, {
//         select: true,
//         focus: true,
//         expand: true,
//     });
//     await ext.state.showCreatingChild(parentId, l10n.t('Creating "{nodeName}"…', { nodeName: accountId }), async () => {
//         const storageItem: StorageItem = {
//             id,
//             name,
//             properties: { isEmulator, api, ...(disableEmulatorSecurity && { disableEmulatorSecurity }) },
//             secrets: [connectionString],
//         };

//         try {
//             await StorageService.get(StorageNames.Workspace).push(
//                 WorkspaceResourceType.MongoClusters,
//                 storageItem,
//                 false,
//             );
//         } catch (error) {
//             if (error instanceof Error && error.message.includes('already exists')) {
//                 let confirmed: boolean = false;
//                 try {
//                     confirmed = await getConfirmationAsInSettings(
//                         l10n.t('Update existing {accountType} connection?', {
//                             accountType: getExperienceFromApi(api).longName,
//                         }),
//                         l10n.t('The connection "{connectionName}" already exists. Do you want to update it?', {
//                             connectionName: name,
//                         }),
//                         'update',
//                     );
//                 } catch (error) {
//                     if (error instanceof UserCancelledError) {
//                         confirmed = false;
//                     } else {
//                         throw error;
//                     }
//                 }

//                 if (confirmed) {
//                     await StorageService.get(StorageNames.Workspace).push(
//                         WorkspaceResourceType.AttachedAccounts,
//                         storageItem,
//                         true,
//                     );
//                 }
//             } else {
//                 throw error;
//             }
//         }
//     });
//     return fulId;
// }

/**
 * Opens an appropriate editor for a Cosmos DB connection.
 *
 * @param context The action context.
 * @param parsedConnection The parsed connection information, containing either a Core API connection string or a MongoDB API connection string.
 * @param database The name of the database to connect to. If not provided, it will attempt to use the database name from the connection string.
 * @param container The name of the container (collection) to open.
 * @throws Error if container name is not provided, or if database name is not provided for Core API connections.
 * @returns A promise that resolves when the editor is opened.
 */
// async function openAppropriateEditorForConnection(
//     context: IActionContext,
//     parsedConnection: { api: API.MongoDB | API.MongoClusters; connectionString: ConnectionString },
//     database: string | undefined,
//     container: string | undefined,
// ): Promise<void> {
//     if (!container) {
//         throw new Error(l10n.t("Can't open the Query Editor, Container name is required"));
//     }

//     {
//         // Open MongoDB editor
//         const accountId = generateDocumentDBStorageId(parsedConnection.connectionString.toString()); // FYI: working with the prasedConnection string for to guarantee a consistent accountId in this file.
//         const expectedClusterId = `${WorkspaceResourceType.MongoClusters}/${accountId}`;

//         return openCollectionViewInternal(context, {
//             clusterId: expectedClusterId,
//             databaseName: nonNullValue(database),
//             collectionName: nonNullValue(container),
//         });
//     }
// }

/**
 * Opens the appropriate editor for a Cosmos DB resource in Azure.
 *
 * @param context - The action context for the operation.
 * @param resourceId - The Azure resource ID of the Cosmos DB account.
 * @param database - The name of the database to open. Required for query editor.
 * @param container - The name of the container to open. Required for query editor.
 * @throws Error if database or container names are not provided.
 * @throws Error if the specified database and container combination cannot be found.
 * @throws Error if the experience type for the resource cannot be determined.
 * @returns Promise that resolves when the appropriate editor has been opened.
 */
// async function openAppropriateEditorForAzure(resource: TreeElement): Promise<void> {
//     if (
//         isTreeElementWithExperience(resource) &&
//         isTreeElementWithContextValue(resource) &&
//         (resource.contextValue.includes('treeItem.collection') || resource.contextValue.includes('treeItem.container'))
//     ) {
//         await vscode.commands.executeCommand('vscode-documentdb.command.containerView.open', resource);
//     } else {
//         throw new Error(l10n.t('Unable to determine the experience for the resource'));
//     }
// }

// #endregion
