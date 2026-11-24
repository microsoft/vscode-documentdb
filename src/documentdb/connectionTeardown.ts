/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getPlaygroundEvaluators, stopPlaygroundEvaluator } from '../commands/playground/executePlaygroundCode';
import { SettingsService } from '../services/SettingsService';
import { checkCanProceedAndInformUser } from '../services/taskService/resourceUsageHelper';
import { TaskService } from '../services/taskService/taskService';
import { settingsKeys } from '../settingsKeys';
import { clearEntraTokenFailure } from './auth/entraErrors/entraTokenFailures';
import { ClustersClient } from './ClustersClient';
import { getConnectionSurfaces } from './connectionSurfaces';
import { CredentialCache } from './CredentialCache';
import { getRegisteredShellTerminals } from './shell/ShellTerminalLinkProvider';

export type TeardownReason = 'userDisconnected' | 'connectionRemoved' | 'credentialsChanged';
export type TeardownChoice = 'close' | 'keepOpenDisabled';

type TeardownConfirmation =
    | { readonly outcome: 'confirmed'; readonly choice: TeardownChoice }
    | { readonly outcome: 'blockedByTask' | 'cancelled' };

export interface TeardownOptions {
    readonly reason: TeardownReason;
    readonly choice: TeardownChoice;
    readonly dropCredentials?: boolean;
    /** A caller that fenced a batch or a save must still hold the matching latch. */
    readonly alreadyLatched?: boolean;
    readonly refreshTree: () => void;
}

function clusterIds(target: string | readonly string[]): readonly string[] {
    return typeof target === 'string' ? [target] : [...new Set(target)];
}

function operationName(intent: TeardownReason): string {
    switch (intent) {
        case 'connectionRemoved':
            return vscode.l10n.t('remove this connection');
        case 'credentialsChanged':
            return vscode.l10n.t('update this connection');
        case 'userDisconnected':
            return vscode.l10n.t('disconnect this connection');
    }
}

/** Read-only preflight. A folder can ask once for all its descendants. */
export async function confirmTeardown(
    target: string | readonly string[],
    intent: TeardownReason,
): Promise<TeardownConfirmation> {
    const ids = clusterIds(target);
    for (const clusterId of ids) {
        if (!(await checkCanProceedAndInformUser({ clusterId }, operationName(intent)))) {
            return { outcome: 'blockedByTask' };
        }
    }

    if (intent === 'credentialsChanged') {
        return { outcome: 'confirmed', choice: 'keepOpenDisabled' };
    }

    const setting = SettingsService.getSetting<string>(settingsKeys.openTabsOnDisconnect);
    let choice: TeardownChoice = setting === 'keepOpenDisabled' ? 'keepOpenDisabled' : 'close';
    const closeAll = vscode.l10n.t('Close all');
    if (setting !== 'closeAll' && setting !== 'keepOpenDisabled' && ids.some((id) => getConnectionSurfaces(id).length)) {
        const keepOpen = vscode.l10n.t('Keep open (disabled)');
        const selected = await vscode.window.showWarningMessage(
            intent === 'connectionRemoved'
                ? vscode.l10n.t('Remove the connection?')
                : vscode.l10n.t('Disconnect?'),
            { modal: true, detail: vscode.l10n.t('What should happen to the open tabs for this connection?') },
            closeAll,
            keepOpen,
        );
        if (selected !== closeAll && selected !== keepOpen) {
            return { outcome: 'cancelled' };
        }
        choice = selected === closeAll ? 'close' : 'keepOpenDisabled';
    }

    if (choice === 'close' && ids.some((id) => getConnectionSurfaces(id).some((surface) => surface.isDirty?.()))) {
        const discard = vscode.l10n.t('Discard changes');
        const selected = await vscode.window.showWarningMessage(
            vscode.l10n.t('Discard unsaved document changes?'),
            { modal: true, detail: vscode.l10n.t('Closing these tabs will discard their unsaved changes.') },
            discard,
        );
        if (selected !== discard) {
            return { outcome: 'cancelled' };
        }
    }

    return { outcome: 'confirmed', choice };
}

/** Check the whole batch and fence it synchronously, before any resource is changed. */
export function latchForTeardown(target: string | readonly string[], reason: TeardownReason): boolean {
    const ids = clusterIds(target);
    if (ids.some((clusterId) => TaskService.getConflictingTasks({ clusterId }).length > 0)) {
        return false;
    }
    for (const clusterId of ids) {
        ClustersClient.latch(clusterId, reason);
    }
    return true;
}

export async function commitTeardown(
    clusterId: string,
    options: TeardownOptions,
): Promise<'committed' | 'blockedByTask' | 'superseded'> {
    const { reason, choice, dropCredentials, alreadyLatched, refreshTree } = options;
    if (alreadyLatched) {
        if (ClustersClient.getLatchReason(clusterId) !== reason) {
            return 'superseded';
        }
    } else {
        if (
            reason === 'userDisconnected' &&
            (!ClustersClient.exists(clusterId) || ClustersClient.getLatchReason(clusterId))
        ) {
            return 'superseded';
        }
        if (!latchForTeardown(clusterId, reason)) {
            await checkCanProceedAndInformUser({ clusterId }, operationName(reason));
            return 'blockedByTask';
        }
    }

    try {
        for (const surface of getConnectionSurfaces(clusterId)) {
            if (choice === 'close') {
                surface.dispose();
            } else {
                surface.disable(reason);
            }
        }

        for (const shell of getRegisteredShellTerminals()) {
            if (shell.info.clusterId === clusterId) {
                shell.disconnect?.();
            }
        }
        stopPlaygroundEvaluator(clusterId);

        const closing = ClustersClient.deleteClient(clusterId, { alreadyInvalidated: true });
        clearEntraTokenFailure(clusterId);
        if (dropCredentials) {
            CredentialCache.deleteCredentials(clusterId);
            ClustersClient.clearLastVerifiedIdentity(clusterId);
        }
        await closing;
    } finally {
        refreshTree();
    }
    return 'committed';
}

/** The single-cluster confirm/commit path, with one event covering both phases. */
export async function teardownConnection(
    clusterId: string,
    reason: TeardownReason,
    refreshTree: () => void,
): Promise<void> {
    await callWithTelemetryAndErrorHandling('connection.disconnect', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = true;
        context.telemetry.maskEntireErrorMessage = true;
        context.telemetry.properties.source = {
            userDisconnected: 'command',
            connectionRemoved: 'remove',
            credentialsChanged: 'credentialsChanged',
        }[reason];
        context.telemetry.properties.surfacesChoice = 'none';
        context.telemetry.properties.blockedByTask = 'false';
        context.telemetry.measurements.surfaceCount = getConnectionSurfaces(clusterId).length;
        context.telemetry.measurements.shellCount = getRegisteredShellTerminals().filter(
            (shell) => shell.info.clusterId === clusterId,
        ).length;
        context.telemetry.measurements.playgroundCount = getPlaygroundEvaluators().has(clusterId) ? 1 : 0;

        const confirmed = await confirmTeardown(clusterId, reason);
        if (confirmed.outcome !== 'confirmed') {
            context.telemetry.properties.blockedByTask = confirmed.outcome === 'blockedByTask' ? 'true' : 'false';
            throw new UserCancelledError();
        }
        context.telemetry.properties.surfacesChoice = confirmed.choice;
        try {
            const result = await commitTeardown(clusterId, {
                reason,
                choice: confirmed.choice,
                dropCredentials: reason === 'connectionRemoved',
                refreshTree,
            });
            if (result === 'committed') {
                return;
            }
            context.telemetry.properties.blockedByTask = result === 'blockedByTask' ? 'true' : 'false';
        } catch {
            // Driver cleanup failures may contain connection details. Keep both UI and event bounded.
            throw new Error(vscode.l10n.t('Could not finish closing the connection.'));
        }
        throw new UserCancelledError();
    });
}
