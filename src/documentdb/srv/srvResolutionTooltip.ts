/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../ClustersClient';
import type { SrvResolutionSummary } from './srvResolutionSummary';

function srvResolutionTooltipLine(summary: SrvResolutionSummary): string {
    const message = summary.nodeErrorCode
        ? l10n.t(
              "SRV record resolved by the extension's fallback resolver, because VS Code's DNS resolver could not use the reply ({0}).",
              `\`${summary.nodeErrorCode.replace(/[^A-Z0-9_]/gi, '')}\``,
          )
        : l10n.t("SRV record resolved by the extension's fallback resolver.");
    return `**${l10n.t('DNS')}:** ${message}`;
}

export function appendSrvResolutionTooltipLine(md: vscode.MarkdownString, clusterId: string): void {
    const summary = ClustersClient.getSrvResolution(clusterId);
    if (summary?.path !== 'fallback') {
        return;
    }
    const markdown = srvResolutionTooltipLine(summary);
    if (!md.value.includes(markdown)) {
        md.appendMarkdown(`\n\n${markdown}\n\n`);
    }
}

export function withSrvResolutionTooltip(
    tooltip: string | vscode.MarkdownString | undefined,
    clusterId: string,
): string | vscode.MarkdownString | undefined {
    const summary = ClustersClient.getSrvResolution(clusterId);
    if (summary?.path !== 'fallback') {
        return tooltip;
    }
    const markdown = srvResolutionTooltipLine(summary);
    if (typeof tooltip !== 'string' && tooltip?.value.includes(markdown)) {
        return tooltip;
    }
    // Discovery overrides may be reused across renders; never mutate their stored markdown.
    let md: vscode.MarkdownString;
    if (typeof tooltip === 'string') {
        md = new vscode.MarkdownString();
        md.appendText(tooltip);
    } else if (tooltip) {
        md = new vscode.MarkdownString(tooltip.value, tooltip.supportThemeIcons);
        if (tooltip.isTrusted !== undefined) {
            md.isTrusted = tooltip.isTrusted;
        }
        if (tooltip.supportHtml !== undefined) {
            md.supportHtml = tooltip.supportHtml;
        }
        if (tooltip.baseUri !== undefined) {
            md.baseUri = tooltip.baseUri;
        }
    } else {
        md = new vscode.MarkdownString();
    }
    md.appendMarkdown(`\n\n${markdown}\n\n`);
    return md;
}
