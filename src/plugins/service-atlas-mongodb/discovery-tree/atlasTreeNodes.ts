/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type AtlasDiscoverySnapshot, type AtlasErrorKind } from '../discovery/AtlasDiscoveryService';

/** Command that opens the credential-management QuickPick for a discovery provider. */
const MANAGE_CREDENTIALS_COMMAND = 'vscode-documentdb.command.discoveryView.manageCredentials';

/**
 * The shared refresh command. It honours a tree element's own `refresh()` hook, which is what the
 * Atlas root needs here: the plain retry command only re-runs `getChildren()`, and that would
 * re-read the cached snapshot instead of going back to Atlas.
 */
const REFRESH_COMMAND = 'vscode-documentdb.command.refresh';

/**
 * Which recovery the user actually needs, derived from the error taxonomy.
 *
 * A single row can only offer one verb, so it has to pick the right one instead of always
 * assuming the credentials are at fault. Telling someone whose network is down to go and re-enter
 * their API key is both wrong and unactionable.
 */
export type AtlasRecoveryAction = 'retry' | 'revisitCredentials' | 'resolve';

/**
 * Picks the recovery action for a snapshot.
 *
 * `auth` and `forbidden` are the only kinds that point at the stored secret or its roles;
 * everything else (`network`, `rateLimited`, and unexpected statuses) is transient and may clear
 * on a retry. When both are present the user has to triage, so the row leads to the credential
 * manager, which carries both a fleet-wide retry and the per-credential actions.
 */
export function classifyRecoveryAction(snapshot: AtlasDiscoverySnapshot): AtlasRecoveryAction {
    const kinds = new Set<AtlasErrorKind>([
        ...snapshot.credentialErrors.map((error) => error.kind),
        ...snapshot.projectErrors.map((error) => error.kind),
    ]);

    const credentialProblem = kinds.has('auth') || kinds.has('forbidden');
    const transientProblem = kinds.has('network') || kinds.has('rateLimited') || kinds.has('other');

    if (credentialProblem && transientProblem) {
        return 'resolve';
    }
    if (credentialProblem) {
        return 'revisitCredentials';
    }
    return 'retry';
}

/**
 * Builds the single consolidated recovery row shown whenever any credential is unhealthy.
 *
 * There is exactly one row no matter how many credentials failed, so the view stays quiet. Its
 * label, icon and command follow {@link classifyRecoveryAction}; the tooltip always enumerates
 * the affected credentials and their reasons.
 */
export function createRecoveryNode(
    parent: TreeElement,
    snapshot: AtlasDiscoverySnapshot,
): TreeElement & TreeElementWithContextValue {
    const action = classifyRecoveryAction(snapshot);

    return createGenericElementWithContext({
        contextValue: 'error',
        id: `${parent.id}/recovery`,
        label: recoveryLabel(action),
        tooltip: buildRecoveryTooltip(snapshot, action),
        iconPath: new vscode.ThemeIcon(action === 'retry' ? 'refresh' : 'warning'),
        commandId: action === 'retry' ? REFRESH_COMMAND : MANAGE_CREDENTIALS_COMMAND,
        commandArgs: [parent],
    });
}

function recoveryLabel(action: AtlasRecoveryAction): string {
    switch (action) {
        case 'retry':
            return vscode.l10n.t('Click here to retry');
        case 'revisitCredentials':
            return vscode.l10n.t('Click here to revisit credentials');
        default:
            return vscode.l10n.t('Click here to resolve the issues');
    }
}

/**
 * Summarises which credentials need attention and why, for the recovery row's tooltip.
 */
export function buildRecoveryTooltip(
    snapshot: AtlasDiscoverySnapshot,
    action: AtlasRecoveryAction = classifyRecoveryAction(snapshot),
): string {
    const lines: string[] = [];

    if (action === 'retry') {
        // Say this first: the per-credential messages below are raw API text and read like
        // credential problems even when the only thing that failed was the connection itself.
        lines.push(vscode.l10n.t('MongoDB Atlas could not be reached. The stored credentials are most likely fine.'));
        lines.push('');
    }

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
