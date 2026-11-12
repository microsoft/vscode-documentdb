/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { openLocalQuickStart } from './commands/localQuickStart/openLocalQuickStart';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import {
    cancelDeepLink,
    failDeepLink,
    measureDeepLinkPhase,
    readDeepLinkTelemetry,
    recordDeepLinkSource,
    type DeepLinkOpenResult,
} from './deepLinks/deepLinkTelemetry';
import { handleAzureResourceLinkRequest } from './deepLinks/handleAzureResourceLink';
import { ClustersClient } from './documentdb/ClustersClient';
import { DocumentDBConnectionString } from './documentdb/utils/DocumentDBConnectionString';
import { isLoopbackHost } from './documentdb/utils/hostClassification';
import { stripTlsBypassParams } from './documentdb/utils/tlsException';
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
import { settingsKeys } from './settingsKeys';
import {
    buildConnectionsViewTargetPath,
    revealInConnectionsView,
    waitForConnectionsViewReady,
    withConnectionsViewProgress,
} from './tree/connections-view/connectionsViewHelpers';
import { suppressAutoOpenDashboard } from './tree/documentdb/autoOpenDashboardSuppression';
import { type TreeElement } from './tree/TreeElement';
import { nonNullValue } from './utils/nonNull';
import { generateDocumentDBStorageId } from './utils/storageUtils';

// #region Type Definitions

const KNOWN_QUERY_PARAMS = new Set([
    'connectionString',
    'resourceId',
    'tenantId',
    'database',
    'collection',
    'open',
    'source',
]);
const OPEN_TARGETS = ['dashboard', 'shell'] as const;
type OpenTarget = (typeof OPEN_TARGETS)[number];

interface SharedUriParams {
    database?: string;
    collection?: string;
    open?: OpenTarget;
}

interface ConnectionStringUriParams extends SharedUriParams {
    connectionString?: string;
}

interface AzureUriParams extends SharedUriParams {
    resourceId?: string;
    tenantId?: string;
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

/** Hand-written allow-list of connection sources, like LOCAL_RESOURCE_TYPES. */
const CONNECT_SOURCES = ['azure'] as const;

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
    /** Segments after the verb, e.g. the source in `/connect/azure`. */
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
 * vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=…
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
        context.telemetry.properties.deepLinkCorrelationId = randomUUID();
        context.telemetry.properties.activationSource = 'deepLink';
        // Record non-sensitive URI diagnostics to help investigate failures.
        context.telemetry.properties.uriScheme = uri.scheme;
        context.telemetry.properties.uriAuthority = uri.authority;
        context.telemetry.measurements.uriPathLength = uri.path.length;
        context.telemetry.measurements.uriQueryLength = (uri.query ?? '').length;
        const queryParams = recordParamsInTelemetry(context, uri.query);
        recordDeepLinkSource(context, queryParams);
        if (context.telemetry.properties.deepLinkSourceStatus === 'invalid') {
            ext.outputChannel.warn(
                '[DeepLink] Ignoring invalid source tag; use one label of 1-64 letters, digits, hyphens or underscores',
            );
        }
        context.telemetry.properties.confirmationsEnabled = vscode.workspace
            .getConfiguration()
            .get<boolean>(settingsKeys.showUrlHandlingConfirmations, true)
            ? 'true'
            : 'false';

        try {
            context.telemetry.properties.failureStage = 'parseRoute';
            const route = parseDeepLinkRoute(uri.path);

            // Recorded before the route is validated so an unrecognized verb is measurable:
            // a link format someone published against a future version shows up here rather
            // than as an anonymous parse failure.
            context.telemetry.properties.deepLinkVerb = route?.verb ?? 'unrecognized';
            context.telemetry.measurements.deepLinkQualifierCount = route?.qualifiers.length ?? 0;
            context.telemetry.properties.deepLinkRouteFormat =
                uri.path.split('/').filter((segment) => segment.trim() !== '').length === 0 ? 'legacy' : 'explicit';
            await callWithTelemetryAndErrorHandling('globalUriHandler.received', async (receivedContext) => {
                Object.assign(receivedContext.telemetry.properties, context.telemetry.properties);
                Object.assign(receivedContext.telemetry.measurements, context.telemetry.measurements);
            });

            let source: 'connectionString' | 'azure' | 'unrecognized' | undefined;
            let resourceType: LocalResourceType | undefined;
            try {
                if (route?.verb === 'connect') {
                    context.telemetry.properties.failureStage = 'validateConnectPath';
                    context.telemetry.properties.deepLinkConnectSource = 'unrecognized';
                    source = 'unrecognized';
                    source = parseConnectSource(route.qualifiers);
                    context.telemetry.properties.deepLinkConnectSource = source;
                } else if (route?.verb === 'local') {
                    context.telemetry.properties.failureStage = 'validateLocalResourceType';
                    resourceType = parseLocalResourceType(route.qualifiers);
                    context.telemetry.properties.deepLinkLocalResourceType = resourceType;
                }
            } finally {
                const parameterNames: string[] = [];
                let unknownParamCount = 0;
                for (const key of queryParams.keys()) {
                    if (KNOWN_QUERY_PARAMS.has(key)) {
                        parameterNames.push(key);
                    } else {
                        unknownParamCount++;
                    }
                }
                const open = OPEN_TARGETS.find((target) => target === queryParams.get('open')?.toLowerCase());
                ext.outputChannel.info(
                    `[DeepLink] Handling link: action=${route?.verb ?? 'unrecognized'}` +
                        (source ? ` source=${source}` : '') +
                        (resourceType ? ` localType=${resourceType}` : '') +
                        ` parameters=${parameterNames.join(',') || 'none'}` +
                        (unknownParamCount ? ` unknown=${unknownParamCount}` : '') +
                        (open ? ` open=${open}` : ''),
                );
            }

            if (route === undefined) {
                context.telemetry.properties.errorReason = 'unrecognizedAction';
                throw new Error(
                    l10n.t(
                        'This DocumentDB link asks for an action the extension does not recognize. It may have been written for a newer version. Check for an update, or verify the link.',
                    ),
                );
            }

            switch (route.verb) {
                case 'connect': {
                    if (source === 'azure') {
                        context.telemetry.properties.failureStage = 'extractParams';
                        const params = extractAndValidateAzureParams(context, queryParams);
                        ext.outputChannel.trace('[DeepLink] Parameters validated');
                        context.telemetry.properties.failureStage = 'handleAzureRequest';
                        ext.outputChannel.trace('[DeepLink] Handing off to the Azure flow');
                        const result = await handleAzureResourceLinkRequest(context, {
                            ...params,
                            resourceId: nonNullValue(params.resourceId, 'resourceId', 'vscodeUriHandler.ts'),
                        });
                        ext.outputChannel.trace(
                            `[DeepLink] Azure flow finished: ${result ? 'opened target' : 'stopped'}`,
                        );
                        if (result) {
                            recordConnectionTelemetry(context, result.clusterId);
                            context.telemetry.properties.failureStage = 'openTarget';
                            if (params.database && params.collection) {
                                const { database, collection } = params;
                                ext.outputChannel.trace('[DeepLink] Opening Collection View');
                                await measureDeepLinkPhase(context, 'openTarget', () =>
                                    openCollectionViewInternal(context, {
                                        clusterId: result.clusterId,
                                        clusterDisplayName: result.clusterNode.cluster.name,
                                        viewId: Views.DiscoveryView,
                                        databaseName: database,
                                        collectionName: collection,
                                    }),
                                );
                                context.telemetry.properties.openTargetResult = 'opened';
                            } else if (params.open) {
                                await openTargetOnNode(context, params.open, result.databaseNode ?? result.clusterNode);
                            }
                        } else if (!context.telemetry.properties.deepLinkOutcome) {
                            failDeepLink(context, 'connectionFailed', 'azureFlowStopped');
                        }
                        break;
                    }

                    context.telemetry.properties.failureStage = 'extractParams';
                    // Note: uri.query is already decoded once by VS Code when creating the vscode.Uri object
                    const params = extractAndValidateParams(context, queryParams);
                    ext.outputChannel.trace('[DeepLink] Parameters validated');

                    context.telemetry.properties.failureStage = 'handleRequest';
                    await handleConnectionStringRequest(context, params);
                    break;
                }

                case 'local': {
                    context.telemetry.properties.deepLinkTarget = 'localSetup';
                    context.telemetry.properties.failureStage = 'openLocalQuickStart';
                    await handleLocalQuickStartRequest(
                        context,
                        nonNullValue(resourceType, 'resourceType', 'vscodeUriHandler.ts'),
                    );
                    break;
                }
            }
            if (!context.telemetry.properties.deepLinkOutcome) {
                context.telemetry.properties.deepLinkOutcome = 'completed';
            }
        } catch (error) {
            context.telemetry.properties.deepLinkOutcome = error instanceof UserCancelledError ? 'canceled' : 'failed';
            context.telemetry.properties.errorReason ??= context.telemetry.properties.failureStage;
            if (!context.telemetry.properties.failureStage) {
                context.telemetry.properties.failureStage = 'unknown';
            }
            // Record the error type (not the message, which can carry user data)
            // so we can group failures without exposing connection details.
            context.telemetry.properties.errorName = error instanceof Error ? error.name : 'NonError';
            ext.outputChannel.error(
                `[DeepLink] Failed: failureStage=${context.telemetry.properties.failureStage} errorName=${context.telemetry.properties.errorName}`,
            );
            throw error;
        } finally {
            context.telemetry.properties.lastStage = context.telemetry.properties.failureStage;
        }
    });
}

function recordConnectionTelemetry(context: IActionContext, clusterId: string): void {
    context.telemetry.properties.connectionCorrelationId ??=
        ClustersClient.getExistingClient(clusterId)?.connectionCorrelationId;
}

async function openTargetOnNode(context: IActionContext, target: OpenTarget, node: TreeElement): Promise<void> {
    ext.outputChannel.trace(`[DeepLink] Opening ${target}`);
    const deepLink = readDeepLinkTelemetry(context.telemetry.properties);
    const result = await measureDeepLinkPhase(
        context,
        'openTarget',
        async (): Promise<DeepLinkOpenResult | undefined> => {
            switch (target) {
                case 'dashboard':
                    return vscode.commands.executeCommand<DeepLinkOpenResult>(
                        'vscode-documentdb.command.clusterDashboard.open',
                        node,
                        null,
                        { activationSource: 'deepLink', deepLink },
                    );
                case 'shell':
                    return vscode.commands.executeCommand<DeepLinkOpenResult>(
                        'vscode-documentdb.command.shell.open',
                        node,
                        null,
                        { deepLink },
                    );
            }
        },
    );
    if (result?.canceled) {
        cancelDeepLink(context, 'OpenTarget');
        context.telemetry.properties.openTargetResult = 'skippedCanceled';
        return;
    }
    if (!result?.opened) {
        context.telemetry.properties.openTargetResult = 'notOpened';
        failDeepLink(context, 'destinationFailed', 'destinationNotOpened');
        return;
    }
    context.telemetry.properties.openTargetResult = 'opened';
    context.telemetry.properties.shellSessionId = result.shellSessionId;
    context.telemetry.properties.dashboardSessionId = result.dashboardSessionId;
    if (result.panelReused !== undefined) {
        context.telemetry.properties.panelReused = result.panelReused ? 'true' : 'false';
    }
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

function parseConnectSource(qualifiers: string[]): 'connectionString' | 'azure' {
    if (qualifiers.length === 0) {
        return 'connectionString';
    }

    if (qualifiers.length === 1) {
        const candidate = qualifiers[0].toLowerCase();
        const source = CONNECT_SOURCES.find((known) => known === candidate);
        if (source !== undefined) {
            return source;
        }
    }

    throw new Error(l10n.t('This DocumentDB connection link has an invalid path. Use /connect or /connect/azure.'));
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
        .get<boolean>(settingsKeys.showUrlHandlingConfirmations, true);

    if (showUrlHandlingConfirmations) {
        const openSetup = l10n.t('Open setup');
        ext.outputChannel.trace('[DeepLink] Showing local setup confirmation');
        const confirmation = await measureDeepLinkPhase(context, 'confirmation', () =>
            vscode.window.showInformationMessage(
                l10n.t('Open DocumentDB Local setup?'),
                {
                    modal: true,
                    detail: [
                        l10n.t('A link wants to open the DocumentDB Local setup in VS Code.'),
                        '',
                        l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
                    ].join('\n'),
                },
                openSetup,
            ),
        );

        ext.outputChannel.trace(
            `[DeepLink] Local setup confirmation: ${confirmation === openSetup ? 'accepted' : 'dismissed'}`,
        );
        if (confirmation !== openSetup) {
            cancelDeepLink(context, 'OpenLocalQuickStart');
            return;
        }
    }

    switch (resourceType) {
        case 'documentdb':
            ext.outputChannel.trace('[DeepLink] Opening the DocumentDB Local wizard');
            await measureDeepLinkPhase(context, 'openTarget', () =>
                openLocalQuickStart(context, undefined, { activationSource: 'deepLink' }),
            );
            context.telemetry.properties.openTargetResult = 'opened';
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
    params: ConnectionStringUriParams,
): Promise<void> {
    // Validate connection string
    context.telemetry.properties.failureStage = 'validateConnectionString';
    validateConnectionString(params.connectionString);

    // Parse the connection string
    context.telemetry.properties.failureStage = 'parseConnectionString';
    const parsedCS = new DocumentDBConnectionString(params.connectionString!);
    context.telemetry.properties.failureStage = 'resolveConnection';

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

    if (params.collection && !selectedDatabase) {
        context.telemetry.properties.failureStage = 'validateCollectionTarget';
        throw new Error(
            l10n.t(
                'This DocumentDB link specifies a collection without a database. Add a database parameter or include the database in the connection string.',
            ),
        );
    }

    // Mask sensitive values in telemetry
    maskSensitiveValuesInTelemetry(context, parsedCS);

    // Process the hosts from the connection string
    const joinedHosts = [...parsedCS.hosts].sort().join(',');

    // Determine if this is an emulator connection
    const isEmulator = isEmulatorConnection(parsedCS);
    // TLS exception (§7): a link comes from outside VS Code, so it may only request allow-invalid
    // certificates for a target on this machine. Private-network, single-word and `.local` hosts
    // can resolve to other machines and are not eligible here (users can still opt in through the
    // connection settings). The bypass params are always stripped so every downstream use
    // (storageId, stored secret, reveal) uses the canonical form, and emulatorConfiguration is the
    // single source of truth.
    const { bypassRequested: tlsBypassRequested } = stripTlsBypassParams(parsedCS);
    const tlsBypassEligible = tlsBypassRequested && areAllHostsLoopback(parsedCS);
    let disableEmulatorSecurity = false;
    context.telemetry.properties.tlsBypassRequested = tlsBypassRequested ? 'true' : 'false';
    context.telemetry.properties.tlsBypassHonored = 'false';

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
    context.telemetry.properties.connectionDisposition = existingDuplicateConnection ? 'reused' : 'new';
    context.telemetry.properties.connectionReused =
        existingDuplicateConnection && ClustersClient.getExistingClient(existingDuplicateConnection.id)
            ? 'true'
            : 'false';
    context.telemetry.properties.deepLinkTarget =
        params.open ?? (params.collection ? 'collection' : selectedDatabase ? 'database' : 'cluster');

    // Check if URL handling confirmations are enabled
    const showUrlHandlingConfirmations = vscode.workspace
        .getConfiguration()
        .get<boolean>(settingsKeys.showUrlHandlingConfirmations, true);

    let storageId: string;
    let surface: string | undefined;
    if (selectedDatabase && params.collection) {
        surface = l10n.t('Collection View');
    } else if (params.open) {
        surface = params.open === 'dashboard' ? l10n.t('Cluster Dashboard') : l10n.t('Interactive Shell');
    }

    ext.outputChannel.trace(
        `[DeepLink] ${existingDuplicateConnection ? 'Existing saved connection found' : 'New connection'}`,
    );
    if (existingDuplicateConnection) {
        // the connection already exists, let's just reveal it later in the Connections View
        storageId = existingDuplicateConnection.id;
    } else {
        // A link from outside VS Code must never add a connection without the user seeing its
        // target, even when URL handling confirmations are disabled.
        const detail = [
            l10n.t('A link wants to add this DocumentDB connection and open it in VS Code.'),
            '',
            ...formatConnectionTargetDetails(newConnectionLabel, selectedDatabase, params.collection),
            ...(surface ? [l10n.t('Opens: {0}', surface)] : []),
            ...(tlsBypassRequested && !tlsBypassEligible
                ? [
                      '',
                      l10n.t(
                          'This link asked to turn off TLS certificate validation. The request was ignored, and certificate validation stays on.',
                      ),
                  ]
                : []),
            '',
            l10n.t('A new connection will be added to your Connections view.'),
            l10n.t('You might be asked for credentials to establish the connection.'),
        ].join('\n');
        ext.outputChannel.trace('[DeepLink] Showing add-and-open confirmation');
        context.telemetry.properties.failureStage = 'confirmNewConnection';
        const connectionConfirmation = await measureDeepLinkPhase(context, 'confirmation', () =>
            vscode.window.showInformationMessage(
                l10n.t('Add and open connection?'),
                { modal: true, detail },
                l10n.t('Add and open'),
            ),
        );

        ext.outputChannel.trace(
            `[DeepLink] Add-and-open confirmation: ${connectionConfirmation === l10n.t('Add and open') ? 'accepted' : 'dismissed'}`,
        );
        if (connectionConfirmation !== l10n.t('Add and open')) {
            cancelDeepLink(context, 'CreateNewConnection');
            return; // User cancelled
        }

        // Relaxing certificate validation always needs the user's explicit consent, independent
        // of the URL handling confirmation setting, and the prompt names the target it applies to.
        if (tlsBypassEligible) {
            const turnOff = l10n.t('Turn off validation');
            const keepOn = l10n.t('Keep validation on');
            ext.outputChannel.trace('[DeepLink] Showing TLS confirmation');
            context.telemetry.properties.failureStage = 'confirmTlsException';
            const tlsChoice = await measureDeepLinkPhase(context, 'confirmation', () =>
                vscode.window.showWarningMessage(
                    l10n.t('Turn off certificate validation?'),
                    {
                        modal: true,
                        detail: [
                            l10n.t('This link asks to turn off TLS certificate validation.'),
                            '',
                            ...formatConnectionTargetDetails(newConnectionLabel, selectedDatabase, params.collection),
                            '',
                            l10n.t(
                                'Without certificate validation, the identity of the server is not verified. Only turn it off for a local emulator or test instance you trust.',
                            ),
                        ].join('\n'),
                    },
                    turnOff,
                    keepOn,
                ),
            );

            ext.outputChannel.trace(
                `[DeepLink] TLS confirmation: ${tlsChoice === undefined ? 'dismissed' : 'accepted'} disableValidation=${tlsChoice === turnOff}`,
            );
            if (tlsChoice === undefined) {
                cancelDeepLink(context, 'TlsException');
                return; // User cancelled
            }

            disableEmulatorSecurity = tlsChoice === turnOff;
            context.telemetry.properties.tlsBypassHonored = disableEmulatorSecurity ? 'true' : 'false';
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
                    isEmulator || disableEmulatorSecurity ? { isEmulator, disableEmulatorSecurity } : undefined,
                availableAuthMethods: [],
            },
            secrets: { connectionString: parsedCS.toString() },
        };

        context.telemetry.properties.failureStage = 'saveConnection';
        await measureDeepLinkPhase(context, 'saveConnection', () =>
            ConnectionStorageService.save(targetZone, storageItem, true),
        );
        context.telemetry.properties.connectionSaved = 'true';
        ext.outputChannel.trace('[DeepLink] Connection saved');

        ext.connectionsBranchDataProvider.refresh();

        // add a delay to allow the Connections View to refresh
        await waitForConnectionsViewReady(context);
    }

    // Ask before opening an existing connection when confirmations are enabled.
    if (existingDuplicateConnection && showUrlHandlingConfirmations) {
        const targetDetails = formatConnectionTargetDetails(
            existingDuplicateConnection.name,
            selectedDatabase,
            params.collection,
        );
        if (surface) {
            targetDetails.push(l10n.t('Opens: {0}', surface));
        }
        const detail = [
            l10n.t('A link wants to open a DocumentDB connection in VS Code.'),
            '',
            ...targetDetails,
            '',
            l10n.t('You might be asked for credentials to establish the connection.'),
            '',
            l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
        ].join('\n');
        ext.outputChannel.trace('[DeepLink] Showing reveal connection confirmation');
        const openButton = l10n.t('Open');
        context.telemetry.properties.failureStage = 'confirmExistingConnection';
        const revealConfirmation = await measureDeepLinkPhase(context, 'confirmation', () =>
            vscode.window.showInformationMessage(l10n.t('Open connection?'), { modal: true, detail }, openButton),
        );

        ext.outputChannel.trace(
            `[DeepLink] Reveal connection confirmation: ${revealConfirmation === openButton ? 'accepted' : 'dismissed'}`,
        );
        if (revealConfirmation !== openButton) {
            cancelDeepLink(context, 'RevealConnection');
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
    ext.outputChannel.trace('[DeepLink] Revealing in the Connections View');
    const release = params.open === 'dashboard' ? suppressAutoOpenDashboard(storageId) : undefined;
    context.telemetry.properties.failureStage = 'revealCluster';
    try {
        await measureDeepLinkPhase(context, 'treeReveal', () =>
            vscode.window.withProgress(
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
            ),
        );
    } finally {
        release?.();
    }
    recordConnectionTelemetry(context, storageId);
    if (context.telemetry.properties.deepLinkOutcome === 'canceled') {
        context.telemetry.properties.openTargetResult = 'skippedCanceled';
        return;
    }

    const clusterPath = await buildConnectionsViewTargetPath(storageId, isInEmulatorZone);
    if (ext.connectionsBranchDataProvider.hasNodeErrorState(clusterPath)) {
        ext.outputChannel.trace('[DeepLink] Cluster expansion failed; the node already explained why');
        context.telemetry.properties.openTargetResult = 'skippedClusterError';
        failDeepLink(context, 'connectionFailed', 'clusterExpansionFailed');
        return;
    }
    const connectionName = existingDuplicateConnection?.name ?? newConnectionLabel;
    if (!ClustersClient.exists(storageId)) {
        ext.outputChannel.trace('[DeepLink] Cluster not connected; not opening the target');
        context.telemetry.properties.openTargetResult = 'skippedNotConnected';
        failDeepLink(context, 'connectionFailed', 'notConnected');
        return;
    }
    if (context.telemetry.properties.revealError) {
        ext.outputChannel.warn('[DeepLink] The requested tree target could not be revealed');
        failDeepLink(context, 'destinationFailed', 'treeRevealFailed');
        return;
    }

    if (params.open) {
        context.telemetry.properties.failureStage = 'openTarget';
        const treePath = await buildConnectionsViewTargetPath(storageId, isInEmulatorZone, selectedDatabase);
        const node = await ext.connectionsBranchDataProvider.findNodeById(treePath, false);
        if (!node) {
            context.telemetry.properties.errorReason = selectedDatabase ? 'databaseNotFound' : 'clusterNotFound';
            if (selectedDatabase) {
                throw new Error(
                    l10n.t(
                        'Could not find database "{0}" on {1}. Check the name and your access, then open the link again.',
                        selectedDatabase,
                        connectionName,
                    ),
                );
            }
            throw new Error(l10n.t('Could not find {0} in the Connections view.', connectionName));
        }
        await openTargetOnNode(context, params.open, node);
    }

    if (selectedDatabase && params.collection) {
        context.telemetry.properties.failureStage = 'findCollection';
        const treePath = await buildConnectionsViewTargetPath(
            storageId,
            isInEmulatorZone,
            selectedDatabase,
            params.collection,
        );
        const collectionNode = await ext.connectionsBranchDataProvider.findNodeById(treePath, false);

        if (!collectionNode) {
            const databasePath = await buildConnectionsViewTargetPath(storageId, isInEmulatorZone, selectedDatabase);
            const databaseNode = await ext.connectionsBranchDataProvider.findNodeById(databasePath, false);
            if (!databaseNode) {
                context.telemetry.properties.errorReason = 'databaseNotFound';
                throw new Error(
                    l10n.t(
                        'Could not find database "{0}" on {1}. Check the name and your access, then open the link again.',
                        selectedDatabase,
                        connectionName,
                    ),
                );
            }
            context.telemetry.properties.errorReason = 'collectionNotFound';
            throw new Error(
                l10n.t(
                    'Could not find collection "{0}" in database "{1}". Check the name and your access, then open the link again.',
                    params.collection,
                    selectedDatabase,
                ),
            );
        }

        ext.outputChannel.trace('[DeepLink] Opening Collection View');
        context.telemetry.properties.failureStage = 'openTarget';
        await measureDeepLinkPhase(context, 'openTarget', () =>
            openDedicatedView(context, storageId, isEmulator, selectedDatabase, params.collection),
        );
        context.telemetry.properties.openTargetResult = 'opened';
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
            l10n.t('Invalid connection string format. It should start with "mongodb://" or "mongodb+srv://".'),
        );
    }
}

/**
 * Determines if a connection is to a local emulator based on host information
 */
function isEmulatorConnection(parsedCS: DocumentDBConnectionString): boolean {
    return areAllHostsLoopback(parsedCS) && parsedCS.hosts.some((host) => host.toLowerCase().includes('localhost'));
}

/**
 * Whether every host in the connection string addresses this machine only.
 */
function areAllHostsLoopback(parsedCS: DocumentDBConnectionString): boolean {
    return parsedCS.hosts?.length > 0 && parsedCS.hosts.every((host) => isLoopbackHost(host));
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

function parseOpenTarget(context: IActionContext, value: string | null): OpenTarget | undefined {
    if (!value) {
        return undefined;
    }

    const target = OPEN_TARGETS.find((candidate) => candidate === value.toLowerCase());
    if (target) {
        return target;
    }

    context.telemetry.properties.errorReason = 'unsupportedOpenTarget';
    throw new Error(
        l10n.t(
            'This DocumentDB link asks to open something the extension does not support. Supported values for open: {0}.',
            OPEN_TARGETS.join(', '),
        ),
    );
}

/** Records parameter shape and masks sensitive values before validation can fail. */
function recordParamsInTelemetry(context: IActionContext, queryFragment: string): URLSearchParams {
    const queryParams = new URLSearchParams(queryFragment);
    const sensitiveKeys = ['connectionString', 'resourceId', 'tenantId', 'database', 'collection'];
    let paramCount = 0;
    let unknownParamCount = 0;
    for (const [key] of queryParams) {
        paramCount++;
        if (!KNOWN_QUERY_PARAMS.has(key)) {
            unknownParamCount++;
        }
    }
    for (const key of sensitiveKeys) {
        const value = queryParams.get(key);
        if (value) {
            context.valuesToMask.push(value);
        }
    }
    context.telemetry.measurements.uriParamCount = paramCount;
    context.telemetry.measurements.uriUnknownParamCount = unknownParamCount;
    context.telemetry.properties.hasParamConnectionString = queryParams.get('connectionString') ? 'true' : undefined;
    context.telemetry.properties.hasParamResourceId = queryParams.get('resourceId') ? 'true' : undefined;
    context.telemetry.properties.hasParamTenantId = queryParams.get('tenantId') ? 'true' : undefined;
    context.telemetry.properties.hasParamDatabase = queryParams.get('database') ? 'true' : undefined;
    context.telemetry.properties.hasParamCollection = queryParams.get('collection') ? 'true' : undefined;
    context.telemetry.properties.hasParamOpen = queryParams.get('open') ? 'true' : undefined;
    return queryParams;
}

function extractSharedParams(context: IActionContext, queryParams: URLSearchParams): SharedUriParams {
    const params: SharedUriParams = {
        database: queryParams.get('database') || undefined,
        collection: queryParams.get('collection') || undefined,
        open: parseOpenTarget(context, queryParams.get('open')),
    };
    context.telemetry.properties.openTarget = params.open ?? 'none';
    context.telemetry.properties.deepLinkTarget =
        params.open ?? (params.collection ? 'collection' : params.database ? 'database' : 'cluster');
    if (params.open && params.collection) {
        context.telemetry.properties.errorReason = 'conflictingOpenTargets';
        throw new Error(
            l10n.t('This DocumentDB link cannot combine a collection with the open parameter. Remove one of them.'),
        );
    }
    return params;
}

function refuseMixedLocators(context: IActionContext): never {
    context.telemetry.properties.mixedLocatorRefused = 'true';
    context.telemetry.properties.errorReason = 'mixedLocators';
    throw new Error(
        l10n.t(
            'This DocumentDB link combines arguments for different link types. Use connectionString with /connect, or resourceId (and optionally tenantId) with /connect/azure.',
        ),
    );
}

/** Extracts and validates parameters for a connection-string link. */
function extractAndValidateParams(context: IActionContext, queryParams: URLSearchParams): ConnectionStringUriParams {
    if (queryParams.has('resourceId') || queryParams.has('tenantId')) {
        refuseMixedLocators(context);
    }
    const params: ConnectionStringUriParams = {
        ...extractSharedParams(context, queryParams),
        connectionString: queryParams.get('connectionString') || undefined,
    };
    if (!params.connectionString) {
        context.telemetry.properties.errorReason = 'missingConnectionString';
        throw new Error(
            l10n.t(
                'This DocumentDB link is missing a connection string. Add a connectionString query parameter to the link.',
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
    return params;
}

/** Extracts and validates parameters for an Azure resource link. */
function extractAndValidateAzureParams(context: IActionContext, queryParams: URLSearchParams): AzureUriParams {
    if (queryParams.has('connectionString')) {
        refuseMixedLocators(context);
    }
    const params: AzureUriParams = {
        ...extractSharedParams(context, queryParams),
        resourceId: queryParams.get('resourceId') || undefined,
        tenantId: queryParams.get('tenantId') || undefined,
    };
    if (!params.resourceId) {
        context.telemetry.properties.errorReason = 'missingResourceId';
        throw new Error(
            l10n.t('This DocumentDB link is missing a resource ID. Add a resourceId query parameter to the link.'),
        );
    }
    if (params.collection && !params.database) {
        context.telemetry.properties.errorReason = 'collectionWithoutDatabase';
        throw new Error(
            l10n.t('This DocumentDB link specifies a collection without a database. Add a database parameter.'),
        );
    }
    return params;
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
