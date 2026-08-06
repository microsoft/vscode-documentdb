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
import { secretVariants } from '../../services/localQuickStart/quickStartCredentials';
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

/**
 * Every command below acts on the single service-owned instance. When there is no instance to act
 * on, returning quietly leaves the user with no feedback at all — the bug behind #851, where the
 * commands were also listed in the Command Palette (now gated to `when: never` in package.json).
 *
 * The palette entries are the primary fix; this is the second line of defense, so that ANY route
 * into a command with nothing to act on explains itself instead of doing nothing. Two states are
 * distinguished:
 *
 *  - `CredentialsMissing` — a labelled container (or durable `ready` record) exists but its saved
 *    credentials are gone. The service already detects and logs this; surface it and offer Delete,
 *    which is the only way forward.
 *  - anything else without metadata — no instance yet; offer the Quick Start wizard.
 *
 * Returns `true` when the caller may proceed (metadata is present).
 */
function ensureInstanceOrExplain(context: IActionContext): boolean {
    const status = QuickStartService.getStatus();
    if (status.metadata) {
        return true;
    }
    context.telemetry.properties.noInstanceState = status.state;

    if (status.state === InstanceState.CredentialsMissing) {
        const deleteAction = l10n.t('Delete Container…');
        void vscode.window
            .showWarningMessage(
                l10n.t(
                    'Saved credentials for DocumentDB Local are missing, so this instance cannot be opened. Delete it and set it up again to start fresh (this erases its data).',
                ),
                deleteAction,
            )
            .then((choice) => {
                if (choice === deleteAction) {
                    return vscode.commands.executeCommand('vscode-documentdb.command.localQuickStart.delete');
                }
                return undefined;
            });
        return false;
    }

    const setUpAction = l10n.t('Set up DocumentDB Local');
    void vscode.window
        .showInformationMessage(
            l10n.t('DocumentDB Local is not set up yet. Run Quick Start to create a local instance first.'),
            setUpAction,
        )
        .then((choice) => {
            if (choice === setUpAction) {
                return vscode.commands.executeCommand('vscode-documentdb.command.localQuickStart.open');
            }
            return undefined;
        });
    return false;
}

export async function startQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'start';
    if (!ensureInstanceOrExplain(context)) {
        return;
    }
    await QuickStartService.start();
}

export async function stopQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'stop';
    if (!ensureInstanceOrExplain(context)) {
        return;
    }
    await QuickStartService.stop();
}

export async function restartQuickStartInstance(context: IActionContext): Promise<void> {
    context.telemetry.properties.action = 'restart';
    if (!ensureInstanceOrExplain(context)) {
        return;
    }
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
    const outcome = await QuickStartService.deleteContainer();
    context.telemetry.properties.deleteOutcome = outcome;
    // Only claim success when the instance was actually removed. On 'refused' (a container created
    // outside the extension) or 'error' (Docker refused to remove our container) the service already
    // showed the relevant message; on 'busy' another lifecycle op is running. In all three cases stay
    // silent rather than show a contradictory "deleted" toast (GPT-5.6 review).
    if (outcome === 'deleted') {
        showConfirmationAsInSettings(l10n.t('DocumentDB Local container deleted.'));
    }
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
    if (!ensureInstanceOrExplain(context)) {
        return;
    }
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

export function copyQuickStartPassword(context: IActionContext): void {
    if (!ensureInstanceOrExplain(context)) {
        return;
    }
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
        // The instance exists but its stored connection string carries no password (e.g. it was
        // rewritten outside the extension). Say so rather than leaving the clipboard untouched
        // with no explanation (#851).
        void vscode.window.showWarningMessage(
            l10n.t('No password is stored for the DocumentDB Local instance, so there is nothing to copy.'),
        );
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

/**
 * Stop the active `docker logs -f` follow. Registered as a subscription at command-registration
 * time: without it the last follow's child process outlives extension deactivation until the
 * container stops, since nothing else cancels the token.
 */
export function disposeQuickStartLogFollow(): void {
    activeLogFollow?.cancel();
    activeLogFollow?.dispose();
    activeLogFollow = undefined;
}

export function viewQuickStartLogs(_context: IActionContext): void {
    const channel = getQuickStartOutputChannel();
    channel.show(true);
    // Best-effort: stream the running container's current logs into the channel,
    // masking the password (D14) in case the image ever echoes it.
    const metadata = QuickStartService.getStatus().metadata;
    if (!metadata) {
        // The channel is now in front of the user, so state there why no container logs follow
        // rather than leaving them staring at unrelated output (#851). A notification would be
        // redundant on top of the surface we just revealed.
        channel.appendLine(l10n.t('There is no DocumentDB Local container to follow. Run Quick Start to create one.'));
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
    void ContainerRuntime.followLogs(metadata.containerId, secretVariants(password), token);
}
