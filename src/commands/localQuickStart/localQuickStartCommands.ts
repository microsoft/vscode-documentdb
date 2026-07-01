/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ContainerRuntime, getQuickStartOutputChannel } from '../../services/localQuickStart/ContainerRuntime';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { InstanceState } from '../../services/localQuickStart/quickStartTypes';
import { getConfirmationWithClick } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

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
              'The container is currently running. It will be stopped and permanently removed. All data, logs, and the auto-generated credentials will be lost. This cannot be undone — you can recreate a fresh instance any time with Quick Start.',
          )
        : l10n.t(
              'The container and its data volume will be permanently removed. All data, logs, and the auto-generated credentials will be lost. This cannot be undone — you can recreate a fresh instance any time with Quick Start.',
          );

    const confirmed = await getConfirmationWithClick(l10n.t('Delete DocumentDB Local container?'), detail);
    if (!confirmed) {
        return;
    }
    await QuickStartService.deleteContainer();
    showConfirmationAsInSettings(l10n.t('DocumentDB Local container deleted.'));
}

export function copyQuickStartConnectionString(_context: IActionContext): void {
    const metadata = QuickStartService.getStatus().metadata;
    if (!metadata) {
        return;
    }
    void vscode.env.clipboard.writeText(metadata.connectionString);
    showConfirmationAsInSettings(l10n.t('Connection string copied to clipboard.'));
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

export function viewQuickStartLogs(_context: IActionContext): void {
    const channel = getQuickStartOutputChannel();
    channel.show(true);
    // Best-effort: stream the running container's current logs into the channel,
    // masking the password (D14) in case the image ever echoes it.
    const metadata = QuickStartService.getStatus().metadata;
    if (metadata) {
        let password = '';
        try {
            password = new DocumentDBConnectionString(metadata.connectionString).password;
        } catch {
            password = '';
        }
        void ContainerRuntime.followLogs(metadata.containerId, password ? [password] : [], undefined);
    }
}
