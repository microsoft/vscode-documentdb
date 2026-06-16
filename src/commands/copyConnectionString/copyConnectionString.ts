/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
// FIXME (discovery plugin API coupling): this generic command imports directly from the
// `service-kubernetes` plugin to provide a port-forward-aware copy experience. This is a leak of
// plugin-specific knowledge into core command code. The discovery plugin API is still experimental
// and currently lacks an extension point for a provider to contribute extra "copy connection
// string" quick-pick items (e.g. the `kubectl port-forward` command) or a custom completion
// message. Until that exists, the dependency is contained to the small surface below.
//
// Potential workaround / target design: add an optional
// `getConnectionStringCopyContribution?(node, credentials)` hook to the DiscoveryProvider API that
// returns extra quick-pick items, a custom completion message, and a "read-only" flag. This command
// would iterate registered providers instead of importing the plugin, moving all Kubernetes knowledge
// (metadata parsing + `kubectl` string building) back into the plugin. Tracked in the discovery API
// issue: https://github.com/microsoft/vscode-documentdb/issues/739 (milestone 0.12.0).
import {
    getKubernetesPortForwardMetadata,
    type KubernetesPortForwardMetadata,
} from '../../plugins/service-kubernetes/portForwardMetadata';
import { type ClusterItemBase, type EphemeralClusterCredentials } from '../../tree/documentdb/ClusterItemBase';
import { nonNullProp, nonNullValue } from '../../utils/nonNull';
import { openUrl } from '../../utils/openUrl';

/**
 * Documentation entry point surfaced from the Kubernetes copy quick pick. Forwards (via aka.ms)
 * to the "Copy Connection String" user-manual page, whose "Kubernetes port-forwarded targets"
 * section explains the machine-local tunnel and how to share access with a teammate.
 */
const KUBERNETES_PORT_FORWARD_LEARN_MORE_URL = 'https://aka.ms/vscode-documentdb-kubernetes-port-forward';

/**
 * Helper function to check if a specific value exists in a delimited context string.
 * Context values are separated by word boundaries (e.g., 'connectionsView;treeitem_documentdbcluster').
 *
 * @param fullContext - The full context string to search in
 * @param value - The value to search for
 * @returns true if the value exists in the context string, false otherwise
 */
const containsDelimited = (fullContext: string | undefined, value: string): boolean => {
    if (!fullContext) {
        return false;
    }
    return new RegExp(`\\b${value}\\b`, 'i').test(fullContext);
};

interface ReadOnlyCopyCredentialsProvider {
    getCredentialsForCopy(): Promise<EphemeralClusterCredentials | undefined>;
}

function hasReadOnlyCopyCredentialsProvider(node: unknown): node is ReadOnlyCopyCredentialsProvider {
    return (
        typeof node === 'object' &&
        node !== null &&
        'getCredentialsForCopy' in node &&
        typeof (node as { getCredentialsForCopy?: unknown }).getCredentialsForCopy === 'function'
    );
}

export async function copyAzureConnectionString(context: IActionContext, node: ClusterItemBase) {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(context: IActionContext, node: ClusterItemBase): Promise<void> {
    const resolved = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;
        // KubernetesResourceItem.contextValue contains "discovery.kubernetesService"; the
        // \b boundary inside containsDelimited treats "." as a non-word boundary so this matches.
        const isKubernetesDiscoveryItem = containsDelimited(node.contextValue, 'kubernetesService');

        const credentials =
            isKubernetesDiscoveryItem && hasReadOnlyCopyCredentialsProvider(node)
                ? await node.getCredentialsForCopy()
                : await node.getCredentials();

        if (!credentials) {
            return undefined;
        }

        return { credentials, isKubernetesDiscoveryItem };
    });

    if (!resolved) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to extract the connection string from the selected account.'),
        );
        return;
    }

    const { credentials, isKubernetesDiscoveryItem } = resolved;

    // Determine origin so we can decide whether to offer the with/without-password choice and
    // for telemetry. Today the prompt fires for saved connections and for Kubernetes-discovered
    // targets, both of which routinely have a real native-auth password attached to credentials.
    const isConnectionsView = containsDelimited(node.contextValue, Views.ConnectionsView);
    context.telemetry.properties.copyOrigin = isConnectionsView
        ? 'connectionsView'
        : isKubernetesDiscoveryItem
          ? 'kubernetesDiscovery'
          : 'other';

    // Kubernetes targets reached through a port-forward tunnel get a richer, grouped picker that
    // also exposes the reproducing `kubectl port-forward` command and a docs entry. Everything else
    // keeps the existing copy behavior (no regression).
    const portForwardMetadata = getKubernetesPortForwardMetadata(credentials.connectionProperties);
    if (portForwardMetadata) {
        context.telemetry.properties.kubernetesPortForwardCopy = 'true';
        await copyKubernetesPortForwardConnection(context, credentials, portForwardMetadata);
        return;
    }

    await copyStandardConnectionString(context, credentials, isConnectionsView, isKubernetesDiscoveryItem);
}

/**
 * Builds the base connection string from resolved credentials, applying the native-auth username
 * and the Microsoft Entra ID auth mechanism when applicable. The password is intentionally left
 * out; callers add it only when the user opts in.
 */
function buildParsedConnectionString(credentials: EphemeralClusterCredentials): DocumentDBConnectionString {
    const parsedConnectionString = new DocumentDBConnectionString(credentials.connectionString);
    parsedConnectionString.username = credentials.nativeAuthConfig?.connectionUser ?? '';

    if (credentials.selectedAuthMethod === AuthMethodId.MicrosoftEntraID) {
        parsedConnectionString.searchParams.set('authMechanism', 'MONGODB-OIDC');
    }

    return parsedConnectionString;
}

/**
 * True when the resolved credentials use native auth and actually carry a password, i.e. when it
 * makes sense to offer the with/without-password choice.
 */
function canIncludeNativePassword(credentials: EphemeralClusterCredentials): boolean {
    // Note: selectedAuthMethod is undefined when it's the only auth method available in legacy
    // connections that haven't been explicitly authenticated yet. In such cases, NativeAuth is assumed.
    const isNativeAuth =
        credentials.selectedAuthMethod === AuthMethodId.NativeAuth || credentials.selectedAuthMethod === undefined;
    return isNativeAuth && !!credentials.nativeAuthConfig?.connectionPassword;
}

/**
 * Reproduces the machine-local tunnel for a teammate, e.g.
 * `kubectl --context <ctx> --namespace <ns> port-forward svc/<svc> <local>:<remote>`.
 */
function buildKubectlPortForwardCommand(metadata: KubernetesPortForwardMetadata): string {
    return [
        'kubectl',
        `--context ${metadata.contextName}`,
        `--namespace ${metadata.namespace}`,
        'port-forward',
        `svc/${metadata.serviceName}`,
        `${String(metadata.localPort)}:${String(metadata.servicePort)}`,
    ].join(' ');
}

/**
 * Standard copy flow for non-Kubernetes targets (and Kubernetes targets that are not reached
 * through a port-forward tunnel). Preserves the original with/without-password prompt.
 */
async function copyStandardConnectionString(
    context: IActionContext,
    credentials: EphemeralClusterCredentials,
    isConnectionsView: boolean,
    isKubernetesDiscoveryItem: boolean,
): Promise<void> {
    const parsedConnectionString = buildParsedConnectionString(credentials);

    // The prompt fires for saved connections and for Kubernetes-discovered targets.
    const shouldOfferPasswordPrompt = isConnectionsView || isKubernetesDiscoveryItem;
    let passwordIncluded: 'true' | 'false' | 'notPrompted' = 'notPrompted';

    if (shouldOfferPasswordPrompt && canIncludeNativePassword(credentials)) {
        const includePassword = await context.ui.showQuickPick(
            [
                {
                    label: l10n.t('Copy without password'),
                    detail: l10n.t('The connection string will not include the password'),
                    includePassword: false,
                },
                {
                    label: l10n.t('Copy with password'),
                    detail: l10n.t('The connection string will include the password'),
                    includePassword: true,
                },
            ],
            {
                placeHolder: l10n.t('Do you want to include the password in the connection string?'),
                suppressPersistence: true,
            },
        );

        if (includePassword.includePassword) {
            parsedConnectionString.password = extractMaskedPassword(context, credentials);
            passwordIncluded = 'true';
        } else {
            passwordIncluded = 'false';
        }
    }

    context.telemetry.properties.passwordIncluded = passwordIncluded;

    await vscode.env.clipboard.writeText(parsedConnectionString.toString());
    void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
}

interface CopyKubernetesQuickPickItem extends vscode.QuickPickItem {
    readonly action: 'withoutPassword' | 'withPassword' | 'portForwardCommand' | 'learnMore';
    readonly group: string;
}

/**
 * Grouped copy picker for Kubernetes ClusterIP targets reached through a port-forward tunnel.
 * Groups the connection-string variants together and adds a "Kubernetes" group with the
 * reproducing `kubectl port-forward` command and a documentation entry.
 */
async function copyKubernetesPortForwardConnection(
    context: IActionContext,
    credentials: EphemeralClusterCredentials,
    metadata: KubernetesPortForwardMetadata,
): Promise<void> {
    const parsedConnectionString = buildParsedConnectionString(credentials);
    const kubectlCommand = buildKubectlPortForwardCommand(metadata);

    const connectionStringGroup = l10n.t('Connection string');
    const kubernetesGroup = l10n.t('Kubernetes');

    const items: CopyKubernetesQuickPickItem[] = [
        {
            label: l10n.t('Copy connection string without password'),
            detail: l10n.t('Safe to share; the password is omitted'),
            action: 'withoutPassword',
            group: connectionStringGroup,
        },
    ];

    if (canIncludeNativePassword(credentials)) {
        items.push({
            label: l10n.t('Copy connection string with password'),
            detail: l10n.t('Works on this machine while the port-forward tunnel is active'),
            action: 'withPassword',
            group: connectionStringGroup,
        });
    }

    items.push(
        {
            label: l10n.t('Copy kubectl port-forward command'),
            detail: kubectlCommand,
            action: 'portForwardCommand',
            group: kubernetesGroup,
        },
        {
            label: l10n.t('Learn more…'),
            detail: l10n.t('How to connect to ClusterIP / port-forwarded targets'),
            action: 'learnMore',
            group: kubernetesGroup,
        },
    );

    const selected = await context.ui.showQuickPick(items, {
        enableGrouping: true,
        placeHolder: l10n.t('Choose what to copy…'),
        stepName: 'copyKubernetesPortForward',
        suppressPersistence: true,
    });

    context.telemetry.properties.copyAction = selected.action;

    if (selected.action === 'learnMore') {
        context.telemetry.properties.passwordIncluded = 'notPrompted';
        await openUrl(KUBERNETES_PORT_FORWARD_LEARN_MORE_URL);
        return;
    }

    if (selected.action === 'portForwardCommand') {
        context.telemetry.properties.passwordIncluded = 'notPrompted';
        await vscode.env.clipboard.writeText(kubectlCommand);
        void vscode.window.showInformationMessage(
            l10n.t('The kubectl port-forward command has been copied to the clipboard'),
        );
        return;
    }

    if (selected.action === 'withPassword') {
        parsedConnectionString.password = extractMaskedPassword(context, credentials);
        context.telemetry.properties.passwordIncluded = 'true';
    } else {
        context.telemetry.properties.passwordIncluded = 'false';
    }

    await vscode.env.clipboard.writeText(parsedConnectionString.toString());
    void vscode.window.showWarningMessage(
        l10n.t(
            'The connection string has been copied. This Kubernetes connection uses port-forwarding and only works on this machine while the tunnel is active.',
        ),
    );
}

/**
 * Pulls the native-auth password out of resolved credentials and registers it for masking in logs.
 */
function extractMaskedPassword(context: IActionContext, credentials: EphemeralClusterCredentials): string {
    const nativeAuthConfig = nonNullValue(
        credentials.nativeAuthConfig,
        'credentials.nativeAuthConfig',
        'copyConnectionString.ts',
    );
    const password = nonNullProp(
        nativeAuthConfig,
        'connectionPassword',
        'nativeAuthConfig.connectionPassword',
        'copyConnectionString.ts',
    );
    context.valuesToMask.push(password);
    return password;
}
