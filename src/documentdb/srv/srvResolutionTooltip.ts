/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../ClustersClient';

export function appendSrvResolutionTooltipLine(md: vscode.MarkdownString, clusterId: string): void {
    const summary = ClustersClient.getSrvResolution(clusterId);
    if (summary?.path !== 'fallback') {
        return;
    }

    const message = summary.nodeErrorCode
        ? l10n.t(
              "SRV record resolved by the extension's fallback resolver, because VS Code's DNS resolver could not use the reply ({0}).",
              `\`${summary.nodeErrorCode.replace(/[^A-Z0-9_]/gi, '')}\``,
          )
        : l10n.t("SRV record resolved by the extension's fallback resolver.");
    const markdown = `**${l10n.t('DNS')}:** ${message}`;
    if (!md.value.includes(markdown)) {
        md.appendMarkdown(`\n\n${markdown}\n\n`);
    }
}

export function withSrvResolutionTooltip(
    tooltip: string | vscode.MarkdownString | undefined,
    clusterId: string,
): string | vscode.MarkdownString | undefined {
    if (ClustersClient.getSrvResolution(clusterId)?.path !== 'fallback') {
        return tooltip;
    }
    // Discovery overrides may be reused across renders; never mutate their stored markdown.
    const md = new vscode.MarkdownString();
    if (typeof tooltip === 'string') {
        md.appendText(tooltip);
    } else if (tooltip) {
        Object.assign(md, tooltip);
    }
    appendSrvResolutionTooltipLine(md, clusterId);
    return md;
}
