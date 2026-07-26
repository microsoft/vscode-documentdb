/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type AtlasDiscoverySnapshot } from '../discovery/AtlasDiscoveryService';

/** Command that opens the credential-management QuickPick for a discovery provider. */
const MANAGE_CREDENTIALS_COMMAND = 'vscode-documentdb.command.discoveryView.manageCredentials';

/**
 * Builds the single consolidated recovery row shown whenever any credential is unhealthy.
 *
 * The label never changes no matter how many credentials failed, so the view stays quiet; the
 * tooltip enumerates the affected credentials and their reasons, and clicking opens the
 * credential-management flow where the actual recovery happens.
 */
export function createRevisitCredentialsNode(
    parent: TreeElement,
    snapshot: AtlasDiscoverySnapshot,
): TreeElement & TreeElementWithContextValue {
    return createGenericElementWithContext({
        contextValue: 'error',
        id: `${parent.id}/revisit-credentials`,
        label: vscode.l10n.t('Click here to revisit credentials'),
        tooltip: buildRecoveryTooltip(snapshot),
        iconPath: new vscode.ThemeIcon('warning'),
        commandId: MANAGE_CREDENTIALS_COMMAND,
        commandArgs: [parent],
    });
}

/**
 * Summarises which credentials need attention and why, for the recovery row's tooltip.
 */
export function buildRecoveryTooltip(snapshot: AtlasDiscoverySnapshot): string {
    const lines: string[] = [];

    if (snapshot.credentialErrors.length === 1) {
        lines.push(vscode.l10n.t('1 credential needs attention:'));
    } else if (snapshot.credentialErrors.length > 1) {
        lines.push(vscode.l10n.t('{0} credentials need attention:', String(snapshot.credentialErrors.length)));
    }

    for (const error of snapshot.credentialErrors) {
        lines.push(`• ${error.label}: ${error.message}`);
    }

    if (snapshot.projectErrors.length > 0) {
        lines.push('');
        lines.push(vscode.l10n.t('Some projects could not be read:'));
        for (const error of snapshot.projectErrors) {
            lines.push(`• ${error.projectName}: ${error.message}`);
        }
    }

    return lines.join('\n');
}

/**
 * The standard "nothing here" placeholder used across the extension: an `indent` icon, the label
 * `empty`, and the explanation in the tooltip. A healthy `200 []` from Atlas is an authoritative
 * answer, not a failure, so it must not offer a retry.
 */
export function createEmptyPlaceholderNode(
    parent: TreeElement,
    tooltip: string,
): TreeElement & TreeElementWithContextValue {
    return createGenericElementWithContext({
        contextValue: 'info',
        id: `${parent.id}/empty`,
        label: vscode.l10n.t('empty'),
        tooltip,
        iconPath: new vscode.ThemeIcon('indent'),
    });
}
