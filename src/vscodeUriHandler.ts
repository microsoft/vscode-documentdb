/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import { DocumentDBConnectionString } from './documentdb/utils/DocumentDBConnectionString';
import { API } from './DocumentDBExperiences';
import { ext } from './extensionVariables';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from './services/connectionStorageService';
import {
    buildConnectionsViewTreePath,
    revealInConnectionsView,
    waitForConnectionsViewReady,
} from './tree/connections-view/connectionsViewHelpers';
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
    /** The name of the collection within the database */
    collection?: string;
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
 * **URL Parameter Encoding:**
 * Input URLs should have double-encoded parameters as documented in how-to-construct-url.md.
 * The double decoding happens automatically in two stages:
 * 1. First decode: VS Code automatically decodes the URI when creating the vscode.Uri object
 * 2. Second decode: URLSearchParams constructor automatically decodes query parameters
 * This ensures proper handling of special characters in connection strings and other parameters.
 *
 * @param uri - The VS Code URI to handle, typically from an external source (already decoded once by VS Code)
 * @returns {Promise<void>} A Promise that resolves when the URI has been handled
 */
export async function globalUriHandler(uri: vscode.Uri): Promise<void> {
    return callWithTelemetryAndErrorHandling('globalUriHandler', async (context: IActionContext) => {
        try {
            // Extract and validate parameters
            // Note: uri.query is already decoded once by VS Code when creating the vscode.Uri object
            const params = extractAndValidateParams(context, uri.query);

            // Process the URI with user confirmation
            await handleConnectionStringRequest(context, params);
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
    const parsedCS = new DocumentDBConnectionString(params.connectionString!);

    // Extract database name from connection string pathname if params.database is not provided
    let selectedDatabase = params.database;
    if (!selectedDatabase && parsedCS.pathname) {
        // Split on '/' and take the first non-empty part
        const pathParts = parsedCS.pathname.split('/');
        const firstPart = pathParts.find((part) => part.trim() !== '');
        if (firstPart) {
            selectedDatabase = firstPart;
            context.telemetry.properties.usedDbFromConnectionString = 'true';
        }
    }

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
    const existingConnections = await ConnectionStorageService.get(
        isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
    );
    const existingDuplicateConnection = findDuplicateConnection(existingConnections, parsedCS, joinedHosts);

    // Check if URL handling confirmations are enabled
    const showUrlHandlingConfirmations = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.showUrlHandlingConfirmations, true);

    let storageId: string;

    if (existingDuplicateConnection) {
        // the connection already exists, let's just reveal it later in the Connections View
        storageId = existingDuplicateConnection.id;
    } else {
        // First confirmation: Ask user about adding new connection (if enabled)
        if (showUrlHandlingConfirmations) {
            const connectionConfirmation = await vscode.window.showInformationMessage(
                l10n.t('You clicked a link that wants to open a DocumentDB connection in VS Code.'),
                {
                    modal: true,
                    detail: l10n.t(
                        'A new connection will be added to your Connections View.\nDo you want to continue?\n\nNote: You can disable these URL handling confirmations in the exension settings.',
                    ),
                },
                l10n.t('Yes, continue'),
            );

            if (connectionConfirmation !== l10n.t('Yes, continue')) {
                context.telemetry.properties.userCancelledAtStep = 'CreateNewConnection';
                return; // User cancelled
            }
        }

        // Show the Connections View
        await vscode.commands.executeCommand(`connectionsView.focus`);
        await waitForConnectionsViewReady(context);

        storageId = generateDocumentDBStorageId(parsedCS.toString()); // FYI: working with the parsedConnection string to guarantee a consistent storageId in this file.

        let existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
        // If a connection with the same label exists, append a number to the label
        while (existingDuplicateLabel) {
            newConnectionLabel = generateUniqueLabel(newConnectionLabel);
            existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
        }

        // Create the the storageItem
        const storageItem: ConnectionItem = {
            id: storageId,
            name: newConnectionLabel,
            // Connection strings handled by this handler are MongoDB-style, so mark the API accordingly.
            properties: {
                api: API.MongoDB,
                emulatorConfiguration: { isEmulator, disableEmulatorSecurity: !!disableEmulatorSecurity },
                availableAuthMethods: [],
            },
            secrets: { connectionString: parsedCS.toString() },
        };

        await ConnectionStorageService.save(
            isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
            storageItem,
            true,
        );

        ext.connectionsBranchDataProvider.refresh();

        // add a delay to allow the Connections View to refresh
        await waitForConnectionsViewReady(context);
    }

    // Second confirmation: Ask user about revealing the connection (if enabled)
    if (showUrlHandlingConfirmations) {
        const revealConfirmation = await vscode.window.showInformationMessage(
            existingDuplicateConnection
                ? l10n.t('You clicked a link that wants to open a DocumentDB connection in VS Code.')
                : l10n.t('The connection will now be opened in the Connections View.'),
            {
                modal: true,
                detail: l10n.t(
                    'You might be asked for credentials to establish the connection.\nDo you want to continue?\n\nNote: You can disable these URL handling confirmations in the extension settings.',
                ),
            },
            l10n.t('Yes, open connection'),
        );

        if (revealConfirmation !== l10n.t('Yes, open connection')) {
            context.telemetry.properties.userCancelledAtStep = 'RevealConnection';
            return; // User cancelled
        }
    }

    if (existingDuplicateConnection) {
        // Show the Connections View
        //
        // Note:
        // This is done only for the existing connection, as the new connection
        // has already been shown in the previous step
        await vscode.commands.executeCommand(`connectionsView.focus`);
        await waitForConnectionsViewReady(context);
    }

    // For future code maintainers:
    // This is a little trick: the first withProgress shows the notification with a user-friendly message,
    // while the second withProgress is used to show the 'loading animation' in the Connections View.
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Opening DocumentDB connection…'),
            cancellable: false,
        },
        async () => {
            await vscode.window.withProgress(
                {
                    location: { viewId: 'connectionsView' },
                    cancellable: false,
                },
                async () => {
                    await revealInConnectionsView(context, storageId, isEmulator, selectedDatabase, params.collection);
                },
            );
        },
    );

    // Third confirmation: Ask user about opening collection view (if applicable and enabled)
    if (selectedDatabase && params.collection) {
        // Verify that the connection, database, and collection exist in the tree
        // This is an easy way to verify that the connection is valid
        // and that the database and collection exist.
        const treePath = buildConnectionsViewTreePath(storageId, isEmulator, selectedDatabase, params.collection);
        const collectionNode = await ext.connectionsBranchDataProvider.findNodeById(treePath, false);

        if (!collectionNode) {
            // Connection verification failed
            throw new Error(
                l10n.t(
                    'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
                ),
            );
        }

        if (showUrlHandlingConfirmations) {
            const collectionViewConfirmation = await vscode.window.showInformationMessage(
                l10n.t('Would you like to open the Collection View?'),
                {
                    modal: true,
                    detail: l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
                },
                l10n.t('Yes, open Collection View'),
            );

            if (collectionViewConfirmation !== l10n.t('Yes, open Collection View')) {
                context.telemetry.properties.userCancelledAtStep = 'CollectionView';
                return;
            }
        }

        await openDedicatedView(context, storageId, isEmulator, selectedDatabase, params.collection);
    }
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
function isEmulatorConnection(parsedCS: DocumentDBConnectionString): boolean {
    return parsedCS.hosts?.length > 0 && parsedCS.hosts[0].includes('localhost');
}

/**
 * Creates a display label for a connection based on parsed connection string
 */
function createConnectionLabel(parsedCS: DocumentDBConnectionString, joinedHosts: string): string {
    return parsedCS.username && parsedCS.username.length > 0 ? `${parsedCS.username}@${joinedHosts}` : joinedHosts;
}

/**
 * Finds a duplicate connection in the existing connections list
 */
function findDuplicateConnection(
    existingConnections: ConnectionItem[],
    parsedCS: DocumentDBConnectionString,
    joinedHosts: string,
): ConnectionItem | undefined {
    return existingConnections.find((item) => {
        const secret = item.secrets?.connectionString;
        if (!secret) {
            return false; // Skip if no secret string is found
        }

        const itemCS = new DocumentDBConnectionString(secret);
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

// #region Parameter Processing

/**
 * Extracts query parameters from a URL query string.
 *
 * @param query - The URL query string to extract parameters from (already decoded once by VS Code)
 * @returns UriParams object containing the extracted parameters
 */
function extractParams(query: string): UriParams {
    const params: UriParams = {};
    // Note: URLSearchParams constructor performs the second URI decode automatically
    // This completes the double decoding process for parameters that were double-encoded in the original URL
    const queryParams = new URLSearchParams(query);

    // URLSearchParams.get() returns already decoded values
    params.connectionString = queryParams.get('connectionString') || undefined;
    params.database = queryParams.get('database') || undefined;
    params.collection = queryParams.get('collection') || undefined;

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

    context.telemetry.properties.hasParamConnectionString = params.connectionString ? 'true' : undefined;
    context.telemetry.properties.hasParamDatabase = params.database ? 'true' : undefined;
    context.telemetry.properties.hasParamCollection = params.collection ? 'true' : undefined;

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
            case 'collection':
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
function maskSensitiveValuesInTelemetry(context: IActionContext, parsedCS: DocumentDBConnectionString): void {
    [parsedCS.username, parsedCS.password, parsedCS.port, ...(parsedCS.hosts || [])]
        .filter(Boolean)
        .forEach((value) => context.valuesToMask.push(value));
}

// #endregion

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
async function openDedicatedView(
    context: IActionContext,
    storageId: string,
    isEmulator: boolean,
    database?: string,
    collection?: string,
): Promise<void> {
    const clusterId = buildConnectionsViewTreePath(storageId, isEmulator);

    return openCollectionViewInternal(context, {
        clusterId: clusterId,
        databaseName: nonNullValue(database, 'database'),
        collectionName: nonNullValue(collection, 'collection'),
    });
}
