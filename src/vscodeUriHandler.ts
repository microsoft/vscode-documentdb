/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import { DocumentDBConnectionString } from './documentdb/utils/DocumentDBConnectionString';
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
 * @param uri - The VS Code URI to handle, typically from an external source
 * @returns {Promise<void>} A Promise that resolves when the URI has been handled
 */
export async function globalUriHandler(uri: vscode.Uri): Promise<void> {
    return callWithTelemetryAndErrorHandling('globalUriHandler', async (context: IActionContext) => {
        try {
            // Extract and validate parameters
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
    const existingConnections = await getExistingConnections(isEmulator);
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
        await waitForTreeViewReady(context);

        storageId = generateDocumentDBStorageId(parsedCS.toString()); // FYI: working with the parsedConnection string to guarantee a consistent storageId in this file.

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

        // add a delay to allow the Connections View to refresh
        await waitForTreeViewReady(context);
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
        await waitForTreeViewReady(context);
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
    parsedCS: DocumentDBConnectionString,
    joinedHosts: string,
): StorageItem | undefined {
    return existingConnections.find((item) => {
        const secret = item.secrets?.[0];
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

// #region View Operations

/**
 * Builds a tree path for the Connections View based on the provided parameters.
 * This code builds a tree path based on the structure of the Connections View.
 * Any change to the Connections View structure will require changes here.
 *
 * @param storageId - The ID of the connection
 * @param isEmulator - Whether the connection is to a local emulator
 * @param database - Optional database name to include in the path
 * @param collection - Optional collection name to include in the path
 * @returns The constructed tree path string
 */
function buildConnectionsViewTreePath(
    storageId: string,
    isEmulator: boolean,
    database?: string,
    collection?: string,
): string {
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

    return treePath;
}

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
    // Validate that database is provided if collection is specified
    if (collection && !database) {
        throw new Error(l10n.t('Database name is required when collection is specified'));
    }

    // Progressive reveal workaround: The reveal function does not show the opened path
    // if the full search fails, which causes our error nodes not to be shown.
    // We implement a three-step reveal process to ensure intermediate nodes are expanded.

    // Step 1: Reveal connection only
    const connectionPath = buildConnectionsViewTreePath(storageId, isEmulator);
    await revealConnectionsViewElement(context, connectionPath, {
        select: true, // Only select if this is the final step
        focus: !database, // Only focus if this is the final step
        expand: true,
    });

    // Step 2: Reveal with database (if provided)
    if (database) {
        const databasePath = buildConnectionsViewTreePath(storageId, isEmulator, database);
        await revealConnectionsViewElement(context, databasePath, {
            select: true, // Only select if this is the final step
            focus: !collection, // Only focus if this is the final step
            expand: true,
        });

        // Step 3: Reveal with collection (if provided)
        if (collection) {
            const collectionPath = buildConnectionsViewTreePath(storageId, isEmulator, database, collection);
            await revealConnectionsViewElement(context, collectionPath, {
                select: true,
                focus: true,
                expand: true,
            });
        }
    }
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
    params.collection = safeDoubleDecodeURIComponent(queryParams.get('collection'), 'collection');

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

/**
 * Waits for the connections tree view to be accessible with exponential backoff
 */
async function waitForTreeViewReady(context: IActionContext, maxAttempts: number = 5): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;
    let delay = 500; // Start with 500ms

    while (attempt < maxAttempts) {
        try {
            // Try to access the tree view - if this succeeds, we're ready
            const rootElements = await ext.connectionsBranchDataProvider.getChildren();
            if (rootElements !== undefined) {
                // Tree view is ready - record successful activation
                const totalTime = Date.now() - startTime;
                context.telemetry.measurements.connectionViewActivationTimeMs = totalTime;
                context.telemetry.measurements.connectionViewActivationAttempts = attempt + 1;
                context.telemetry.properties.connectionViewActivationResult = 'success';
                return;
            }
        } catch {
            // Tree view not ready yet, continue polling
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
        delay = Math.min(delay * 1.5, 2000); // Cap at 2 seconds
    }

    // Exhausted all attempts - record timeout and continue optimistically
    const totalTime = Date.now() - startTime;
    context.telemetry.measurements.connectionViewActivationTimeMs = totalTime;
    context.telemetry.measurements.connectionViewActivationAttempts = maxAttempts;
    context.telemetry.properties.connectionViewActivationResult = 'timeout';

    // Let's just move forward, maybe it's ready, maybe something has failed
    // The next step will handle the case when the tree view is not ready
}
