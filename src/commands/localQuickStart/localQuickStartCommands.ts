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
import { getConfirmationWithClick } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

/**
 * Quick Start managed-instance lifecycle commands (design §6.2 / §11). They act
 * on the single service-owned instance, so the (optional) tree node argument is
 * ignored. The tree refreshes via `QuickStartService.onDidChangeStatus`.
 */

export async function startQuickStartInstance(_context: IActionContext): Promise<void> {
    await QuickStartService.start();
}

export async function stopQuickStartInstance(_context: IActionContext): Promise<void> {
    await QuickStartService.stop();
}

export async function restartQuickStartInstance(_context: IActionContext): Promise<void> {
    await QuickStartService.restart();
}

export async function deleteQuickStartInstance(_context: IActionContext): Promise<void> {
    const confirmed = await getConfirmationWithClick(
        l10n.t('Delete DocumentDB Local container?'),
        l10n.t('This removes the local DocumentDB container. You can recreate it any time with Quick Start.'),
    );
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
