/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ContainerRuntime, getQuickStartOutputChannel } from '../../services/localQuickStart/ContainerRuntime';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { InstanceState } from '../../services/localQuickStart/quickStartTypes';
import { type EphemeralClusterCredentials } from '../../tree/documentdb/ClusterItemBase';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { copyStandardConnectionString } from '../copyConnectionString/copyConnectionString';

/**
 * Quick Start managed-instance lifecycle commands (design §6.2 / §11). They act
 * on the single service-owned instance, so the (optional) tree node argument is
 * ignored. The tree refreshes via `QuickStartService.onDidChangeStatus`.
 */

export async function startQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'start';
    await QuickStartService.start();
}

export async function stopQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'stop';
    await QuickStartService.stop();
}

export async function restartQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'restart';
    await QuickStartService.restart();
}

export async function deleteQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'delete';

    // Delete is now offered while Running too, so the container is force-stopped before removal
    // (ContainerRuntime.removeContainer uses force). Warn accordingly and make the data-loss
    // consequences explicit — Delete drops the data volume, so this is a permanent clean slate.
    const wasRunning = QuickStartService.getStatus().state === InstanceState.Running;
    context.telemetry.properties.wasRunning = String(wasRunning);

    const detail = wasRunning
        ? l10n.t(
              'The container is currently running. It will be stopped and permanently removed. All data, logs, and the auto-generated credentials will be lost. This cannot be undone. You can recreate a fresh instance any time with Quick Start.',
          )
        : l10n.t(
              'The container and its data volume will be permanently removed. All data, logs, and the auto-generated credentials will be lost. This cannot be undone. You can recreate a fresh instance any time with Quick Start.',
          );

    const confirmed = await getConfirmationAsInSettings(l10n.t('Delete DocumentDB Local container?'), detail, 'delete');
    if (!confirmed) {
        return;
    }
    await QuickStartService.deleteContainer();
    showConfirmationAsInSettings(l10n.t('DocumentDB Local container deleted.'));
}

/**
 * Build password-free ephemeral credentials for the shared copy flow from a Quick Start instance's
 * (credential-bearing) connection string. The shared flow treats `connectionString` as a password-
 * free base and carries the password only in `nativeAuthConfig`, so we strip the embedded username +
 * password here. Returns `undefined` (fail closed — copy nothing rather than leak) when the string
 * can't be parsed.
 */
export function buildQuickStartCopyCredentials(
    connectionString: string,
    username: string,
): EphemeralClusterCredentials | undefined {
    let parsed: DocumentDBConnectionString;
    try {
        parsed = new DocumentDBConnectionString(connectionString);
    } catch {
        return undefined;
    }
    const password = parsed.password;
    parsed.username = '';
    parsed.password = '';
    return {
        connectionString: parsed.toString(),
        availableAuthMethods: [AuthMethodId.NativeAuth],
        selectedAuthMethod: AuthMethodId.NativeAuth,
        nativeAuthConfig: { connectionUser: username, connectionPassword: password },
    };
}

export async function copyQuickStartConnectionString(context: IActionContext): Promise<void> {
    const metadata = QuickStartService.getStatus().metadata;
    if (!metadata) {
        return;
    }
    // Reuse the shared copy flow so the user gets the same with/without-password QuickPick as every
    // other connection instead of silently copying the password (UX review #7). The Quick Start
    // instance is in-memory (not a stored connection), so we build password-free ephemeral
    // credentials from its metadata rather than going through the storage-backed node.getCredentials().
    const credentials = buildQuickStartCopyCredentials(metadata.connectionString, metadata.username);
    if (!credentials) {
        return;
    }
    context.telemetry.properties.copyOrigin = 'quickStart';
    await copyStandardConnectionString(context, credentials, true, false);
}

export function copyQuickStartPassword(_context: IActionContext): void {
    const metadata = QuickStartService.getStatus().metadata;
    if (!metadata) {
        return;
    }
    let password = '';
    try {
        password = new DocumentDBConnectionString(metadata.connectionString).password;
    } catch {
        password = '';
    }
    if (!password) {
        return;
    }
    void vscode.env.clipboard.writeText(password);
    showConfirmationAsInSettings(l10n.t('Password copied to clipboard.'));
}

/**
 * The single active `docker logs -f` follow. Reused across "View Logs" clicks so
 * repeated invocations don't stack concurrent follows — each would duplicate the
 * channel output and leak an orphaned child process until the container stops.
 */
let activeLogFollow: vscode.CancellationTokenSource | undefined;

export function viewQuickStartLogs(_context: IActionContext): void {
    const channel = getQuickStartOutputChannel();
    channel.show(true);
    // Best-effort: stream the running container's current logs into the channel,
    // masking the password (D14) in case the image ever echoes it.
    const metadata = QuickStartService.getStatus().metadata;
    if (!metadata) {
        return;
    }
    // Cancel any prior follow before starting a new one (see activeLogFollow).
    activeLogFollow?.cancel();
    activeLogFollow?.dispose();
    activeLogFollow = new vscode.CancellationTokenSource();
    const token = activeLogFollow.token;
    let password = '';
    try {
        password = new DocumentDBConnectionString(metadata.connectionString).password;
    } catch {
        password = '';
    }
    void ContainerRuntime.followLogs(metadata.containerId, password ? [password] : [], token);
}
