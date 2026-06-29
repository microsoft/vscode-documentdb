/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { redactCredentialsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
// FIXME (discovery plugin API coupling): this generic command imports directly from the
// `service-kubernetes` plugin so that duplicate-connection detection can compare two
// port-forwarded targets by their tunnel identity instead of host + username (two tunnels can
// share localhost:<port> yet point at different services). This leaks plugin-specific knowledge
// into core. The discovery plugin API is still experimental and has no source-agnostic way for a
// provider to declare what makes two of its connections "the same".
//
// Potential workaround / target design: have the plugin write a generic `connectionIdentity`
// string into the source-agnostic `context.connectionProperties` bag when it builds a connection.
// The dedup logic below would compare `connectionIdentity` whenever both sides have one and fall
// back to host + username otherwise, keeping this command plugin-agnostic. Tracked in the discovery
// API issue: https://github.com/microsoft/vscode-documentdb/issues/739 (milestone 0.12.0).
import {
    getKubernetesPortForwardIdentity,
    getKubernetesPortForwardMetadata,
} from '../../plugins/service-kubernetes/portForwardMetadata';

import {
    type ConnectionItem,
    ConnectionStorageService,
    ConnectionType,
    ItemType,
} from '../../services/connectionStorageService';
import {
    buildConnectionsViewTreePath,
    buildFullTreePath,
    focusAndRevealInConnectionsView,
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../tree/connections-view/connectionsViewHelpers';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        return withConnectionsViewProgress(async () => {
            const api = context.experience?.api ?? API.DocumentDB;
            const parentId = context.parentId;

            const newConnectionString = context.connectionString!.trim();

            const newAuthenticationMethod = context.selectedAuthenticationMethod;

            // Native credentials only apply to the Native authentication method. When a user
            // pastes a connection string that embeds a username/password but then selects a
            // credential-free method (No Authentication or Microsoft Entra ID), those parsed
            // credentials must be ignored. Otherwise duplicate detection compares against a stale
            // username (incorrectly blocking creation) and the credentials would leak into the
            // stored secrets of a connection that is supposed to be credential-free.
            const usesNativeCredentials = newAuthenticationMethod === AuthMethodId.NativeAuth;
            const newUsername = usesNativeCredentials ? context.nativeAuthConfig?.connectionUser : undefined;

            // Entra ID configuration only applies to the Microsoft Entra ID method. If the user
            // backtracked through the wizard and changed the method (e.g. Entra -> No Authentication
            // or Entra -> Native), stale Entra config could otherwise be persisted onto a connection
            // that is supposed to be credential-free or native. Mirror the native-credential gate.
            const usesEntraId = newAuthenticationMethod === AuthMethodId.MicrosoftEntraID;

            const newAvailableAuthenticationMethods =
                context.availableAuthenticationMethods ?? (newAuthenticationMethod ? [newAuthenticationMethod] : []);

            const newParsedCS = new DocumentDBConnectionString(newConnectionString);
            const newJoinedHosts = [...newParsedCS.hosts].sort().join(',');
            const newPortForwardMetadata = getKubernetesPortForwardMetadata(context.connectionProperties);

            //  Sanity Check 1/2: is there a connection with the same username + host in there?
            const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            const existingDuplicateConnection = existingConnections.find((existingConnection) => {
                const secret = existingConnection.secrets?.connectionString;
                if (!secret) {
                    ext.outputChannel.trace(
                        `[NewConnection] Skipping stored connection "${existingConnection.name}" (id: ${existingConnection.id}) — empty connection string`,
                    );
                    return false;
                }

                try {
                    const existingCS = new DocumentDBConnectionString(secret);
                    const existingHostsJoined = [...existingCS.hosts].sort().join(',');
                    // Use nativeAuthConfig for comparison
                    const existingUsername = existingConnection.secrets.nativeAuthConfig?.connectionUser;
                    const existingPortForwardMetadata = getKubernetesPortForwardMetadata(existingConnection.properties);

                    if (newPortForwardMetadata || existingPortForwardMetadata) {
                        return (
                            existingUsername === newUsername &&
                            !!newPortForwardMetadata &&
                            !!existingPortForwardMetadata &&
                            getKubernetesPortForwardIdentity(existingPortForwardMetadata) ===
                                getKubernetesPortForwardIdentity(newPortForwardMetadata)
                        );
                    }

                    return existingUsername === newUsername && existingHostsJoined === newJoinedHosts;
                } catch (error) {
                    // An existing stored connection has an invalid/corrupt connection string.
                    // Log it but don't block the user from creating a new connection.
                    const rawMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.warn(
                        `[NewConnection] Stored connection "${existingConnection.name}" (id: ${existingConnection.id}) has an invalid connection string and was skipped during duplicate check: ${redactCredentialsFromConnectionString(rawMessage)}`,
                    );
                    return false;
                }
            });

            if (existingDuplicateConnection) {
                // Reveal the existing duplicate connection.
                // Use buildFullTreePath to correctly handle connections inside folders —
                // buildConnectionsViewTreePath produces a flat path that omits folder ancestors,
                // causing findNodeById to fail silently when the connection is in a folder.
                const connectionPath = await buildFullTreePath(existingDuplicateConnection.id, ConnectionType.Clusters);
                await focusAndRevealInConnectionsView(context, connectionPath, {
                    select: true,
                    focus: false,
                    expand: false, // Don't expand to avoid login prompts
                });

                throw new UserFacingError(l10n.t('A connection with the same username and host already exists.'), {
                    details: l10n.t(
                        'The existing connection has been selected in the Connections View.\n\nSelected connection name:\n"{0}"',
                        existingDuplicateConnection.name,
                    ),
                });
            }

            // remove obsolete authMechanism entry
            if (newParsedCS.searchParams.get('authMechanism') === 'SCRAM-SHA-256') {
                newParsedCS.searchParams.delete('authMechanism');
            }
            newParsedCS.username = '';
            newParsedCS.password = '';

            // The connection label is derived from the host(s) only. We intentionally do not
            // prefix it with the username so that all new connections share a consistent,
            // credential-free naming scheme.
            let newConnectionLabel = newJoinedHosts;

            // Sanity Check 2/2: is there a connection with the same 'label' in there?
            // If so, append a number to the label.
            // This scenario is possible as users are allowed to rename their connections.
            let existingDuplicateLabel = existingConnections.find(
                (connection) => connection.name === newConnectionLabel,
            );

            // If a connection with the same label exists, append a number to the label
            while (existingDuplicateLabel) {
                /**
                 * Matches and captures parts of a connection label string.
                 *
                 * The regular expression `^(.*?)(\s*\(\d+\))?$` is used to parse the connection label into two groups:
                 * - The first capturing group `(.*?)` matches the main part of the label (non-greedy match of any characters).
                 * - The second capturing group `(\s*\(\d+\))?` optionally matches a numeric suffix enclosed in parentheses,
                 *   which may be preceded by whitespace. For example, " (123)".
                 *
                 * Examples:
                 * - Input: "ConnectionName (123)" -> Match: ["ConnectionName (123)", "ConnectionName", " (123)"]
                 * - Input: "ConnectionName" -> Match: ["ConnectionName", "ConnectionName", undefined]
                 */
                const match = newConnectionLabel.match(/^(.*?)(\s*\(\d+\))?$/);
                if (match) {
                    const baseName = match[1];
                    const count = match[2] ? parseInt(match[2].replace(/\D/g, ''), 10) + 1 : 1;
                    newConnectionLabel = `${baseName} (${count})`;
                }
                existingDuplicateLabel = existingConnections.find(
                    (connection) => connection.name === newConnectionLabel,
                );
            }

            // Now, we're safe to create a new connection with the new unique label
            const storageId = generateDocumentDBStorageId(newParsedCS.toString());

            const storageItem: ConnectionItem = {
                id: storageId,
                name: newConnectionLabel,
                properties: {
                    ...context.connectionProperties,
                    type: ItemType.Connection,
                    api: api,
                    parentId: parentId ? parentId : undefined, // Set parent folder ID if in a subfolder
                    availableAuthMethods: newAvailableAuthenticationMethods,
                    selectedAuthMethod: newAuthenticationMethod,
                },
                secrets: {
                    connectionString: newParsedCS.toString(),
                    // Persist native credentials only for the Native authentication method.
                    // No Authentication and Microsoft Entra ID are credential-free.
                    nativeAuthConfig: usesNativeCredentials ? context.nativeAuthConfig : undefined,
                    // Persist Entra ID config only for the Microsoft Entra ID method, so a
                    // credential-free or native connection never carries stale Entra metadata.
                    entraIdAuthConfig: usesEntraId ? context.entraIdAuthConfig : undefined,
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, storageItem, true);

            // Build the reveal path based on whether this is in a subfolder
            const connectionPath = context.parentTreeId
                ? `${context.parentTreeId}/${storageId}`
                : buildConnectionsViewTreePath(storageId, false);

            // Refresh the parent to show the new connection
            refreshParentInConnectionsView(connectionPath);

            // Focus and reveal the new connection
            await focusAndRevealInConnectionsView(context, connectionPath);

            showConfirmationAsInSettings(l10n.t('New connection has been added.'));
        });
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
