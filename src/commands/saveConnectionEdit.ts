/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { isDeepStrictEqual } from 'node:util';
import { clearEntraTokenFailure } from '../documentdb/auth/entraErrors/entraTokenFailures';
import { ClustersClient } from '../documentdb/ClustersClient';
import { getConnectionSurfaces } from '../documentdb/connectionSurfaces';
import { confirmTeardown, latchForTeardown } from '../documentdb/connectionTeardown';
import { CredentialCache } from '../documentdb/CredentialCache';
import { getRegisteredShellTerminals } from '../documentdb/shell/ShellTerminalLinkProvider';
import { ext } from '../extensionVariables';
import { ConnectionStorageService, isConnection, type StoredItem } from '../services/connectionStorageService';
import { checkCanProceedAndInformUser } from '../services/taskService/resourceUsageHelper';
import { type DocumentDBClusterItem } from '../tree/connections-view/DocumentDBClusterItem';
import { resolveStorageZone } from '../tree/connections-view/models/ConnectionClusterModel';
import { stopPlaygroundEvaluator } from './playground/executePlaygroundCode';

function storedSettings(item: StoredItem | undefined): object | undefined {
    if (!item || !isConnection(item)) {
        return undefined;
    }
    return {
        secrets: item.secrets,
        authMethod: item.properties.selectedAuthMethod,
        emulator: item.properties.emulatorConfiguration,
    };
}

/**
 * Hold the existing latch across storage writes, then use what actually persisted to decide
 * whether to retire views. Secret storage and metadata are not written atomically.
 */
export async function saveConnectionEdit(
    node: DocumentDBClusterItem,
    save: (isCurrent: () => boolean) => Promise<boolean>,
    options?: {
        readonly canStart?: () => boolean;
        readonly publishCredentials?: (connection: StoredItem | undefined) => void;
    },
): Promise<boolean> {
    const { clusterId } = node.cluster;
    const zone = resolveStorageZone(node.cluster);
    if ((await confirmTeardown(clusterId, 'credentialsChanged')).outcome !== 'confirmed') {
        throw new UserCancelledError();
    }

    if (options?.canStart?.() === false) {
        throw new UserCancelledError();
    }
    const previous = ClustersClient.getLatchReason(clusterId);
    if (previous === 'connectionRemoved' || previous === 'credentialsUpdating') {
        throw new Error(vscode.l10n.t('A connection is already being updated or removed. Try again when it finishes.'));
    }
    if (!latchForTeardown(clusterId, 'credentialsUpdating')) {
        await checkCanProceedAndInformUser({ clusterId }, vscode.l10n.t('update this connection'));
        throw new UserCancelledError();
    }

    const epoch = ClustersClient.getEpoch(clusterId);
    const isCurrent = (): boolean => ClustersClient.getEpoch(clusterId) === epoch;
    let changed = false;
    try {
        const before = await ConnectionStorageService.get(node.storageId, zone);
        const originalSettings = structuredClone(storedSettings(before));
        if (!originalSettings) {
            void vscode.window.showErrorMessage(vscode.l10n.t('The connection could not be read from storage.'));
            return false;
        }
        let saved = false;
        try {
            if (!isCurrent()) {
                throw new UserCancelledError();
            }
            saved = await save(isCurrent);
        } finally {
            let after: StoredItem | undefined;
            try {
                after = await ConnectionStorageService.get(node.storageId, zone);
            } catch {
                ext.outputChannel.warn(vscode.l10n.t('Could not verify the saved connection settings.'));
            }
            if (isCurrent() && !isDeepStrictEqual(originalSettings, storedSettings(after))) {
                changed = true;
                ClustersClient.retireBoundViews(clusterId);
                for (const surface of getConnectionSurfaces(clusterId)) {
                    surface.disable('credentialsChanged');
                }
                stopPlaygroundEvaluator(clusterId);
                const closing = ClustersClient.deleteClient(clusterId, { alreadyInvalidated: true });
                CredentialCache.deleteCredentials(clusterId);
                clearEntraTokenFailure(clusterId);
                if (!after || !isConnection(after) || !before || !isConnection(before) ||
                    before.properties.selectedAuthMethod !== after.properties.selectedAuthMethod) {
                    ClustersClient.clearLastVerifiedIdentity(clusterId);
                } else if (before.secrets.entraIdAuthConfig?.tenantId !== after.secrets.entraIdAuthConfig?.tenantId) {
                    ClustersClient.discardEntraPinForDifferentTenant(clusterId, after.secrets.entraIdAuthConfig?.tenantId);
                }
                if (!saved || !after) {
                    void vscode.window.showWarningMessage(
                        vscode.l10n.t('The connection update may be incomplete. Check the saved settings before reconnecting.'),
                    );
                }
                await closing;
                if (isCurrent()) {
                    options?.publishCredentials?.(after);
                }
            }
        }
    } finally {
        if (isCurrent()) {
            if (previous && (!changed || previous === 'userDisconnected')) {
                ClustersClient.latch(clusterId, previous);
            } else {
                ClustersClient.unlatch(clusterId);
            }
        }
    }
    return changed;
}

export async function offerShellDisconnect(node: DocumentDBClusterItem): Promise<void> {
    const shells = getRegisteredShellTerminals().filter(({ info }) => info.clusterId === node.cluster.clusterId);
    if (!shells.length) {
        return;
    }
    const disconnect = vscode.l10n.t('Disconnect');
    const selected = await vscode.window.showInformationMessage(
        vscode.l10n.t('Open shells are still using the previous connection settings.'),
        { modal: true },
        disconnect,
    );
    if (selected === disconnect) {
        for (const shell of shells) {
            shell.disconnect?.();
        }
    }
}
