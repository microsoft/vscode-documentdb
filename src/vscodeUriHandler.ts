/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { openLocalQuickStart } from './commands/localQuickStart/openLocalQuickStart';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import { DocumentDBConnectionString } from './documentdb/utils/DocumentDBConnectionString';
import { canonicalizeTlsException, stripTlsBypassParams } from './documentdb/utils/tlsException';
import { Views } from './documentdb/Views';
import { API } from './DocumentDBExperiences';
import { ext } from './extensionVariables';
import {
    ConnectionStorageService,
    ConnectionType,
    ItemType,
    type ConnectionItem,
} from './services/connectionStorageService';
import { isLegacyEmulatorMigrationComplete } from './services/legacyEmulatorMigration';
import {
    buildConnectionsViewTreePath,
    revealInConnectionsView,
    waitForConnectionsViewReady,
    withConnectionsViewProgress,
} from './tree/connections-view/connectionsViewHelpers';
import { nonNullValue } from './utils/nonNull';
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

/**
 * The actions a deep link is allowed to name.
 *
 * **This list is the security boundary, and it is hand-written on purpose.**
 *
 * A "command switch" is tempting to implement by mapping the URL's verb onto a VS Code command
 * id, because the extension already has a command for everything a link might want. That would
 * also expose `localQuickStart.delete` and `localQuickStart.copyPassword` to any web page able to
 * produce a link — one deletes a container, the other puts a password on the clipboard. A URL
 * arriving from outside VS Code is untrusted input, so the set of things it can reach is
 * enumerated here rather than derived from the command registry.
 *
 * Adding a verb is therefore a deliberate act: it means deciding that the action is safe to
 * trigger from a link on a web page belonging to someone else.
 */
const DEEP_LINK_VERBS = ['connect', 'local'] as const;

type DeepLinkVerb = (typeof DEEP_LINK_VERBS)[number];

/** The local resource types that an external deep link is allowed to open. */
const LOCAL_RESOURCE_TYPES = ['documentdb'] as const;

type LocalResourceType = (typeof LOCAL_RESOURCE_TYPES)[number];

/**
 * The verb assumed when a link names none.
 *
 * Every link published before verbs existed has an empty path and a connection string in the
 * query, so "no verb" has to keep meaning `connect` for as long as those links exist — which is
 * forever, since a link in a blog post cannot be recalled.
 */
const DEFAULT_VERB: DeepLinkVerb = 'connect';

/** A deep link's route: what it asks for, and any path segments qualifying it. */
interface DeepLinkRoute {
    verb: DeepLinkVerb;
    /** Segments after the verb, e.g. the provider id in `/discovery/<provider>`. */
    qualifiers: string[];
}

// #endregion

// #region Main Handler Functions

/**
 * Global URI handler for processing external URIs routed to this extension.
 *
 * A link names an action in its **path** and supplies that action's arguments in its **query**:
 *
 * ```text
 * vscode://ms-azuretools.vscode-documentdb/connect?connectionString=…&database=…&collection=…
 * vscode://ms-azuretools.vscode-documentdb/local
 * vscode://ms-azuretools.vscode-documentdb/local/documentdb
 * vscode://ms-azuretools.vscode-documentdb?connectionString=…              (legacy, means /connect)
 * ```
 *
 * **Why the path and not another query parameter.** The query describes *how* to perform an
 * action; putting *which* action in the same bag means every future reader has to know which keys
 * are the verb and which are its arguments. It also leaves nowhere to namespace the discovery
 * plugins, which will each want their own sub-routes.
 *
 * **Why this is safe to add.** The handler dispatched on `uri.query` alone until now and never
 * read `uri.path`, so every link already in circulation has an empty path. Empty path therefore
 * means {@link DEFAULT_VERB} and those links keep working unchanged.
 *
 * The set of reachable actions is {@link DEEP_LINK_VERBS}, which is a hand-written allow-list
 * rather than a lookup into the command registry — see the note there.
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
        // Record non-sensitive URI diagnostics to help investigate failures.
        context.telemetry.properties.uriScheme = uri.scheme;
        context.telemetry.properties.uriAuthority = uri.authority;
        context.telemetry.properties.uriPathLength = String(uri.path.length);
        context.telemetry.properties.uriQueryLength = String((uri.query ?? '').length);

        try {
            context.telemetry.properties.failureStage = 'parseRoute';
            const route = parseDeepLinkRoute(uri.path);

            // Recorded before the route is validated so an unrecognized verb is measurable:
            // a link format someone published against a future version shows up here rather
            // than as an anonymous parse failure.
            context.telemetry.properties.deepLinkVerb = route?.verb ?? 'unrecognized';
            context.telemetry.properties.deepLinkQualifierCount = String(route?.qualifiers.length ?? 0);

            if (route === undefined) {
                throw new Error(
                    l10n.t(
                        'This DocumentDB link asks for an action the extension does not recognize. It may have been written for a newer version — check for an update, or verify the link.',
                    ),
                );
            }

            switch (route.verb) {
                case 'connect': {
                    context.telemetry.properties.failureStage = 'validateConnectPath';
                    if (route.qualifiers.length > 0) {
                        throw new Error(l10n.t('This DocumentDB connection link has an invalid path. Use /connect.'));
                    }

                    context.telemetry.properties.failureStage = 'extractParams';
                    // Note: uri.query is already decoded once by VS Code when creating the vscode.Uri object
                    const params = extractAndValidateParams(context, uri.query);

                    context.telemetry.properties.failureStage = 'handleRequest';
                    await handleConnectionStringRequest(context, params);
                    break;
                }

                case 'local': {
                    context.telemetry.properties.failureStage = 'validateLocalResourceType';
                    const resourceType = parseLocalResourceType(route.qualifiers);
                    context.telemetry.properties.deepLinkLocalResourceType = resourceType;

                    context.telemetry.properties.failureStage = 'openLocalQuickStart';
                    await handleLocalQuickStartRequest(context, resourceType);
                    break;
                }
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (!context.telemetry.properties.failureStage) {
                context.telemetry.properties.failureStage = 'unknown';
            }
            // Record the error type (not the message, which can carry user data)
            // so we can group failures without exposing connection details.
            context.telemetry.properties.errorName = error instanceof Error ? error.name : 'NonError';
            throw new Error(l10n.t('Failed to process URI: {0}', errMsg));
        }
    });
}

/**
 * Reads the action out of a link's path.
 *
 * @param path - `uri.path`, which VS Code has already decoded once.
 * @returns The route, or `undefined` when the path names something not in
 *          {@link DEEP_LINK_VERBS}. An empty path is not unrecognized — it is
 *          {@link DEFAULT_VERB}, which is what keeps already-published links working.
 */
function parseDeepLinkRoute(path: string): DeepLinkRoute | undefined {
    const segments = path.split('/').filter((segment) => segment.trim() !== '');

    if (segments.length === 0) {
        return { verb: DEFAULT_VERB, qualifiers: [] };
    }

    // Case-insensitive because links are typed by hand and pasted through systems that
    // helpfully "correct" capitalization; the verb is a keyword, not user data.
    const candidate = segments[0].toLowerCase();
    const verb = DEEP_LINK_VERBS.find((known) => known === candidate);

    if (verb === undefined) {
        return undefined;
    }

    return { verb, qualifiers: segments.slice(1) };
}

/**
 * Resolves the local resource type named by a route.
 *
 * `/local` is shorthand for `/local/documentdb`. The allow-list is explicit so an unsupported
 * qualifier never silently opens a different local product.
 */
function parseLocalResourceType(qualifiers: string[]): LocalResourceType {
    if (qualifiers.length === 0) {
        return 'documentdb';
    }

    if (qualifiers.length !== 1) {
        throw new Error(l10n.t('This DocumentDB Local link has an invalid path. Use /local or /local/documentdb.'));
    }

    const candidate = qualifiers[0].toLowerCase();
    const resourceType = LOCAL_RESOURCE_TYPES.find((known) => known === candidate);
    if (resourceType === undefined) {
        throw new Error(
            l10n.t(
                'This DocumentDB Local link asks for an unsupported resource type. Supported resource types: {0}.',
                LOCAL_RESOURCE_TYPES.join(', '),
            ),
        );
    }

    return resourceType;
}

/**
 * Confirms and opens the setup experience for a supported local resource type.
 *
 * External links can be surprising even when the destination is non-mutating, so this uses one
 * lightweight confirmation when URL confirmations are enabled. Unlike `connect`, no additional
 * confirmation is needed because the wizard opens on an introduction page.
 */
async function handleLocalQuickStartRequest(context: IActionContext, resourceType: LocalResourceType): Promise<void> {
    const showUrlHandlingConfirmations = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.showUrlHandlingConfirmations, true);

    if (showUrlHandlingConfirmations) {
        const openSetup = l10n.t('Open setup');
        const confirmation = await vscode.window.showInformationMessage(
            l10n.t('This link wants to open the DocumentDB Local setup in VS Code.'),
            { modal: true },
            openSetup,
        );

        if (confirmation !== openSetup) {
            context.telemetry.properties.userCancelledAtStep = 'OpenLocalQuickStart';
            return;
        }
    }

    switch (resourceType) {
        case 'documentdb':
            await openLocalQuickStart(context);
            break;
    }
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
    // TLS exception (§7): only honor allow-invalid when EVERY host is local/private, and strip the
    // bypass param from the parsed CS so every downstream use (storageId, stored secret, reveal)
    // uses the canonical form — a public deep link can't silently disable certificate validation,
    // and emulatorConfiguration is the single source of truth.
    const disableEmulatorSecurity = canonicalizeTlsException(parsedCS.toString()).disableEmulatorSecurity;
    stripTlsBypassParams(parsedCS);

    // Pick the storage zone for this (possibly emulator) connection. The dedicated
    // Emulators zone is being retired (design §4): once the one-time migration has run,
    // the legacy emulator tree node is hidden, so new local connections must go into the
    // regular Clusters zone (otherwise they would be saved but never shown). Emulator TLS
    // behaviour is preserved via `emulatorConfiguration`, independent of the zone.
    const targetZone =
        isEmulator && !isLegacyEmulatorMigrationComplete() ? ConnectionType.Emulators : ConnectionType.Clusters;
    const isInEmulatorZone = targetZone === ConnectionType.Emulators;

    // Create a label for the new connection
    let newConnectionLabel = createConnectionLabel(parsedCS, joinedHosts);

    // Check for existing connections with the same parameters
    const existingConnections = await ConnectionStorageService.getAll(targetZone);
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
            const detail = [
                ...formatConnectionTargetDetails(newConnectionLabel, selectedDatabase, params.collection),
                '',
                l10n.t('A new connection will be added to your Connections View.'),
                l10n.t('Do you want to continue?'),
                '',
                l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
            ].join('\n');
            const connectionConfirmation = await vscode.window.showInformationMessage(
                l10n.t('You clicked a link that wants to open a DocumentDB connection in VS Code.'),
                { modal: true, detail },
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

        let existingDuplicateLabel = existingConnections.find((connection) => connection.name === newConnectionLabel);
        // If a connection with the same label exists, append a number to the label
        while (existingDuplicateLabel) {
            newConnectionLabel = generateUniqueLabel(newConnectionLabel);
            existingDuplicateLabel = existingConnections.find((connection) => connection.name === newConnectionLabel);
        }

        // Create the the storageItem
        const storageItem: ConnectionItem = {
            id: storageId,
            name: newConnectionLabel,
            // Connection strings handled by this handler are MongoDB-style, so mark the API accordingly.
            properties: {
                type: ItemType.Connection,
                api: API.DocumentDB,
                // Match the wizard's shape: only carry an emulatorConfiguration when at least one
                // flag is set, otherwise leave it undefined (a public deep link is a plain Cluster).
                emulatorConfiguration:
                    isEmulator || disableEmulatorSecurity
                        ? { isEmulator, disableEmulatorSecurity: !!disableEmulatorSecurity }
                        : undefined,
                availableAuthMethods: [],
            },
            secrets: { connectionString: parsedCS.toString() },
        };

        await ConnectionStorageService.save(targetZone, storageItem, true);

        ext.connectionsBranchDataProvider.refresh();

        // add a delay to allow the Connections View to refresh
        await waitForConnectionsViewReady(context);
    }

    // Second confirmation: Ask user about revealing the connection (if enabled)
    if (showUrlHandlingConfirmations) {
        const detail = [
            ...formatConnectionTargetDetails(
                existingDuplicateConnection?.name ?? newConnectionLabel,
                selectedDatabase,
                params.collection,
            ),
            '',
            l10n.t('You might be asked for credentials to establish the connection.'),
            l10n.t('Do you want to continue?'),
            '',
            l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
        ].join('\n');
        const revealConfirmation = await vscode.window.showInformationMessage(
            existingDuplicateConnection
                ? l10n.t('You clicked a link that wants to open a DocumentDB connection in VS Code.')
                : l10n.t('The connection will now be opened in the Connections View.'),
            { modal: true, detail },
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
    // while the second withProgress (via withConnectionsViewProgress) is used to show the 'loading animation' in the Connections View.
    //
    // Known limitation (pre-existing, follow-up): `revealInConnectionsView` /
    // `buildConnectionsViewTreePath` build a FLAT path (`connectionsView/<id>`), which is
    // correct for a root-level connection but not for one nested in a folder. A deep-link that
    // de-dups onto a connection inside a folder (e.g. a connection migrated into "Local
    // Connections (Legacy)") therefore may not auto-reveal. The connection is still found and
    // navigable manually. A folder-aware reveal (via `buildFullTreePath(storageId, zone)` plus
    // recursive `findNodeById`) is tracked as a follow-up.
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Opening DocumentDB connection…'),
            cancellable: false,
        },
        async () => {
            await withConnectionsViewProgress(async () => {
                await revealInConnectionsView(
                    context,
                    storageId,
                    isInEmulatorZone,
                    selectedDatabase,
                    params.collection,
                );
            });
        },
    );

    // Third confirmation: Ask user about opening collection view (if applicable and enabled)
    if (selectedDatabase && params.collection) {
        // Verify that the connection, database, and collection exist in the tree
        // This is an easy way to verify that the connection is valid
        // and that the database and collection exist.
        const treePath = buildConnectionsViewTreePath(storageId, isInEmulatorZone, selectedDatabase, params.collection);
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

function formatConnectionTargetDetails(connectionLabel: string, database?: string, collection?: string): string[] {
    const lines = [l10n.t('Connection: {0}', connectionLabel)];
    if (database) {
        lines.push(l10n.t('Database: {0}', database));
    }
    if (collection) {
        lines.push(l10n.t('Collection: {0}', collection));
    }
    return lines;
}

/**
 * Finds a duplicate connection in the existing connections list
 */
function findDuplicateConnection(
    existingConnections: ConnectionItem[],
    parsedCS: DocumentDBConnectionString,
    joinedHosts: string,
): ConnectionItem | undefined {
    return existingConnections.find((connection) => {
        const secret = connection.secrets?.connectionString;
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
    // Fallback if regex fails - append (1) to ensure we have a numeric suffix for next iteration
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

    // Record non-sensitive shape diagnostics: how many params were present and
    // how many were not ones we recognize. This helps spot malformed deep-links
    // (for example empty queries or links built against an older URL format)
    // without ever capturing the parameter values themselves.
    const knownKeys = new Set(['connectionString', 'database', 'collection']);
    const allParams = new URLSearchParams(queryFragment);
    let paramCount = 0;
    let unknownParamCount = 0;
    for (const [key] of allParams) {
        paramCount++;
        if (!knownKeys.has(key)) {
            unknownParamCount++;
        }
    }
    context.telemetry.properties.uriParamCount = String(paramCount);
    context.telemetry.properties.uriUnknownParamCount = String(unknownParamCount);

    if (!params.connectionString) {
        // Throw a descriptive error so the telemetry wrapper will surface it to the user.
        throw new Error(
            l10n.t(
                'A DocumentDB deep-link was opened without a connection string. Ensure the link includes a connectionString query parameter.',
            ),
        );
    }

    // The scheme is not sensitive and tells us whether a wrong scheme (or none)
    // is a common cause of failures. The value itself is already masked.
    context.telemetry.properties.connectionStringScheme = params.connectionString.startsWith('mongodb+srv://')
        ? 'mongodb+srv'
        : params.connectionString.startsWith('mongodb://')
          ? 'mongodb'
          : 'other';

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
 * @param storageId The stable cluster identifier (storageId) for the connection.
 * @param _isEmulator Unused - kept for backward compatibility with callers.
 * @param database The name of the database to connect to.
 * @param collection The name of the collection to open.
 * @throws Error if database or collection name is not provided.
 * @returns A promise that resolves when the editor is opened.
 */
async function openDedicatedView(
    context: IActionContext,
    storageId: string,
    _isEmulator: boolean,
    database?: string,
    collection?: string,
): Promise<void> {
    // storageId IS the clusterId (stable identifier for Connections View)
    // Note: buildConnectionsViewTreePath returns a treeId, NOT a clusterId
    // openCollectionViewInternal expects the stable clusterId for cache lookups

    // URI handler always opens from Connections View since connections are added there
    return openCollectionViewInternal(context, {
        clusterId: storageId, // ✅ storageId is the stable clusterId for Connections View
        clusterDisplayName: storageId, // URI handler has no display name available
        viewId: Views.ConnectionsView,
        databaseName: nonNullValue(database, 'database', 'vscodeUriHandler.ts'),
        collectionName: nonNullValue(collection, 'collection', 'vscodeUriHandler.ts'),
    });
}
