/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Links } from '../../constants';
import { ext } from '../../extensionVariables';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type SrvResolutionSurface } from './prepareDriverConnectionString';

// Developer-preview build only; review this gate before the 0.11.1 release.
export const SHOW_SRV_FALLBACK_PREVIEW_NOTICE = true;

// Only tree connections (ClustersClient) show the notice; the shell and playground resolve on
// their own and report to the trace output only.
const NOTICE_SURFACE: SrvResolutionSurface = 'extension';

const noticedHosts = new Set<string>();

export function resetSrvFallbackPreviewNoticeForTests(): void {
    noticedHosts.clear();
}

function surfaceLabel(surface: SrvResolutionSurface): string {
    switch (surface) {
        case 'extension':
            return vscode.l10n.t('tree');
        case 'shell':
            return vscode.l10n.t('interactive shell');
        case 'playground':
            return vscode.l10n.t('query playground');
    }
}

function copyDetails(report: SrvResolutionReport, surface: SrvResolutionSurface): string {
    const unknown = vscode.l10n.t('unknown');
    const extensionVersion: unknown = (ext.context.extension.packageJSON as { version?: unknown }).version;
    return [
        vscode.l10n.t('DocumentDB SRV DNS fallback (Developer Preview)'),
        vscode.l10n.t('Extension version: {0}', typeof extensionVersion === 'string' ? extensionVersion : unknown),
        vscode.l10n.t('VS Code version: {0}', vscode.version),
        vscode.l10n.t('Platform: {0}', process.platform),
        vscode.l10n.t('Node.js version: {0}', report.nodeRuntimeVersion),
        vscode.l10n.t('c-ares version: {0}', report.aresVersion),
        vscode.l10n.t('Surface: {0} ({1})', surface, surfaceLabel(surface)),
        vscode.l10n.t('SRV host: {0}', report.srvHost),
        vscode.l10n.t('Node DNS error code: {0}', report.nodeErrorCode),
        vscode.l10n.t('DNS servers: {0}', report.dnsServers.join(', ') || unknown),
        vscode.l10n.t('Transport: {0}', report.fallbackTransport?.toUpperCase() ?? unknown),
        vscode.l10n.t('SRV target count: {0}', report.srvTargetCount ?? unknown),
        vscode.l10n.t('Target compressed: {0}', String(report.targetCompressed ?? unknown)),
        vscode.l10n.t('Node probe duration (ms): {0}', report.nodeProbeDurationMs ?? unknown),
        vscode.l10n.t('Fallback duration (ms): {0}', report.fallbackDurationMs ?? unknown),
        vscode.l10n.t('Forced fallback: {0}', String(report.forcedFallback)),
        vscode.l10n.t('Timestamp (UTC): {0}', new Date().toISOString()),
    ].join('\n');
}

export function showSrvFallbackPreviewNotice(report: SrvResolutionReport, surface: SrvResolutionSurface): void {
    try {
        if (
            !SHOW_SRV_FALLBACK_PREVIEW_NOTICE ||
            surface !== NOTICE_SURFACE ||
            report.path !== 'fallback' ||
            report.outcome !== 'succeeded'
        ) {
            return;
        }
        const hostKey = report.srvHost.toLowerCase();
        if (noticedHosts.has(hostKey)) {
            return;
        }
        const unknown = vscode.l10n.t('unknown');
        const reason = report.forcedFallback
            ? vscode.l10n.t(
                  'The DNS workaround was forced by the DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK environment variable (c-ares {0}).',
                  report.aresVersion,
              )
            : `${vscode.l10n.t(
                  "VS Code's built-in DNS resolver could not read the SRV record for this connection ({0}, c-ares {1}).",
                  report.nodeErrorCode,
                  report.aresVersion,
              )} ${vscode.l10n.t('This is a known issue with some routers and VPN or corporate DNS servers.')}`;
        const detail = [
            reason,
            vscode.l10n.t(
                'The extension resolved the host names itself, using the same DNS servers your system is configured with ({0}), and found {1} servers (over {2}).',
                report.dnsServers.join(', ') || unknown,
                report.srvTargetCount ?? unknown,
                report.fallbackTransport?.toUpperCase() ?? unknown,
            ),
            vscode.l10n.t(
                'Your saved connection string is unchanged: the resolved server list is used only for this connection, kept in memory, and looked up again on every new connection.',
            ),
            vscode.l10n.t(
                'This notice is part of a developer preview. Please share your feedback; "Copy Details" copies a summary without credentials.',
            ),
        ].join('\n\n');
        const copy = vscode.l10n.t('Copy Details');
        const guide = vscode.l10n.t('Open Troubleshooting Guide');
        void vscode.window
            .showInformationMessage(
                vscode.l10n.t('Developer Preview: DNS workaround applied for {0}', report.srvHost),
                { modal: true, detail },
                copy,
                guide,
            )
            .then(
                async (selection): Promise<void> => {
                    try {
                        if (selection === copy) {
                            await vscode.env.clipboard.writeText(copyDetails(report, surface));
                        } else if (selection === guide) {
                            await vscode.env.openExternal(vscode.Uri.parse(Links.SrvDnsTroubleshooting));
                        }
                    } catch {
                        // Preview actions must never interfere with a connection.
                    }
                },
                (): void => {},
            );
        noticedHosts.add(hostKey);
    } catch {
        // Building or showing this optional notice must never interfere with a connection.
    }
}
