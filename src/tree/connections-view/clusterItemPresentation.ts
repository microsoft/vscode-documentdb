/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId, getAuthMethod, isSupportedAuthMethod } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { resolveAllowInvalidCertificates } from '../../documentdb/utils/tlsException';
import { type ConnectionClusterModel } from './models/ConnectionClusterModel';

/**
 * Row presentation (icon, TLS badge, tooltip) shared by every Connections-view cluster node.
 *
 * Extracted from `DocumentDBClusterItem` so a node that cannot inherit from it — the Quick Start
 * managed instance, which sources its credentials from `QuickStartService` rather than from
 * `ConnectionStorageService` — still renders identically instead of re-deriving the same output.
 */

/** The fields a cluster row needs to render; a `Pick` so callers need not own the whole model. */
export type ClusterPresentationModel = Pick<
    ConnectionClusterModel,
    'name' | 'connectionString' | 'emulatorConfiguration' | 'selectedAuthMethod' | 'connectionUser'
>;

/**
 * Escapes markdown special characters so user-provided text is always rendered
 * as plain text rather than being interpreted as markdown formatting or links.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&');
}

/**
 * Extracts the host(s) from the connection string for display in the tooltip.
 * Returns an empty array if the connection string is unavailable or unparseable.
 */
export function getClusterHosts(connectionString: string | undefined): string[] {
    if (!connectionString) {
        return [];
    }
    try {
        return new DocumentDBConnectionString(connectionString).hosts ?? [];
    } catch {
        return [];
    }
}

/**
 * Detects whether the connection string explicitly disables TLS/SSL
 * (e.g. `tls=false` or `ssl=false`). Returns false when the parameter is
 * absent or the connection string cannot be parsed.
 */
export function isTlsExplicitlyDisabled(connectionString: string | undefined): boolean {
    if (!connectionString) {
        return false;
    }
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        const tls = parsed.searchParams.get('tls');
        const ssl = parsed.searchParams.get('ssl');
        return tls === 'false' || ssl === 'false';
    } catch {
        return false;
    }
}

/**
 * The grey row description: a TLS/SSL warning, or `undefined` when the connection is secure.
 *
 * The warning reflects the EFFECTIVE runtime TLS state (the `disableEmulatorSecurity` flag is
 * honored only for local/private hosts — see `resolveAllowInvalidCertificates`), so an orphaned
 * flag on a public host (which the runtime no longer honors) doesn't show a misleading badge.
 */
export function buildClusterDescription(cluster: ClusterPresentationModel): string | undefined {
    if (
        resolveAllowInvalidCertificates(
            cluster.emulatorConfiguration?.disableEmulatorSecurity,
            cluster.connectionString ?? '',
        )
    ) {
        return l10n.t('⚠ TLS/SSL Disabled');
    }
    // Surface a connection-string TLS/SSL override (e.g. tls=false) the same way the
    // emulator's "disable security" state is shown.
    if (!cluster.emulatorConfiguration?.isEmulator && isTlsExplicitlyDisabled(cluster.connectionString)) {
        return l10n.t('⚠ TLS/SSL Disabled');
    }
    return undefined;
}

/**
 * Builds a markdown tooltip showing the connection name, host, auth method,
 * username (SCRAM only), and emulator security status.
 *
 * The cluster name is escaped so it always renders as plain text regardless
 * of characters that might otherwise be interpreted as markdown links or formatting.
 */
export function buildClusterTooltip(cluster: ClusterPresentationModel): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;

    md.appendMarkdown(`### ${escapeMarkdown(cluster.name)}\n\n`);

    const hosts = getClusterHosts(cluster.connectionString);
    if (hosts.length > 0) {
        const escapedHosts = hosts.map((host) => escapeMarkdown(host));
        md.appendMarkdown(`**${l10n.t('Host')}:** ${escapedHosts.join(', ')}\n\n`);
    }

    const authMethodId = cluster.selectedAuthMethod;
    if (authMethodId) {
        const isSupported = isSupportedAuthMethod(authMethodId);
        const authLabel = isSupported ? getAuthMethod(authMethodId).label : authMethodId;
        md.appendMarkdown(`**${l10n.t('Auth')}:** ${escapeMarkdown(authLabel)}\n\n`);

        if (isSupported && authMethodId === AuthMethodId.NativeAuth && cluster.connectionUser) {
            md.appendMarkdown(`**${l10n.t('User')}:** ${escapeMarkdown(cluster.connectionUser)}\n\n`);
        }
    }

    // Security notice: surface a TLS-disabled warning when invalid certificates are actually
    // allowed at runtime (host-gated — an orphaned bypass flag on a public host shows the
    // normal "enabled" state); show enabled for a secure emulator; and also warn on a
    // non-emulator connection string that explicitly disables TLS/SSL (main's behavior).
    if (
        resolveAllowInvalidCertificates(
            cluster.emulatorConfiguration?.disableEmulatorSecurity,
            cluster.connectionString ?? '',
        )
    ) {
        md.appendMarkdown(`⚠️ **${l10n.t('Security')}:** ${l10n.t('TLS/SSL Disabled')}\n\n`);
    } else if (cluster.emulatorConfiguration?.isEmulator) {
        md.appendMarkdown(`✅ **${l10n.t('Security')}:** ${l10n.t('TLS/SSL Enabled')}\n\n`);
    } else if (isTlsExplicitlyDisabled(cluster.connectionString)) {
        md.appendMarkdown(`⚠️ **${l10n.t('Security')}:** ${l10n.t('TLS/SSL Disabled')}\n\n`);
    }

    return md;
}

/** The complete tree item for a Connections-view cluster row. */
export function buildClusterTreeItem(options: {
    id: string;
    contextValue: string;
    cluster: ClusterPresentationModel;
}): vscode.TreeItem {
    const { id, contextValue, cluster } = options;

    return {
        id,
        contextValue,
        label: cluster.name,
        description: buildClusterDescription(cluster),
        iconPath: cluster.emulatorConfiguration?.isEmulator
            ? new vscode.ThemeIcon('plug')
            : new vscode.ThemeIcon('server-environment'),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        tooltip: buildClusterTooltip(cluster),
    };
}
