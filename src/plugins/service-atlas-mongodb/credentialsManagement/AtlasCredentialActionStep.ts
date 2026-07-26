/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, GoBackError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { openAtlasCredentialsWebview } from '../../../webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { removeAtlasCredential } from '../credentials/atlasCredentialStore';
import { type AtlasCredentialsManagementWizardContext } from './AtlasCredentialsManagementWizardContext';
import { ATLAS_CREDENTIAL_MANAGEMENT_EXIT } from './SelectAtlasCredentialStep';

interface CredentialActionQuickPickItem extends vscode.QuickPickItem {
    action?: 'retry' | 'update' | 'remove' | 'back' | 'exit';
}

/**
 * Second step of the credential-management wizard: the actions available for one credential.
 *
 * Mirrors the Azure `TenantActionStep`: every path either navigates (`GoBackError`) or exits
 * (`UserCancelledError`), so the QuickPick chain keeps working back and forth without the caller
 * having to re-enter the flow.
 */
export class AtlasCredentialActionStep extends AzureWizardPromptStep<AtlasCredentialsManagementWizardContext> {
    public async prompt(context: AtlasCredentialsManagementWizardContext): Promise<void> {
        const credentialId = context.selectedCredentialId!;
        const status = context.credentials.find((candidate) => candidate.record.id === credentialId);
        const label = status?.label ?? credentialId;

        const actions: CredentialActionQuickPickItem[] = [
            {
                label: l10n.t('Retry'),
                detail: l10n.t('Re-attempt this credential only, leaving the others untouched.'),
                iconPath: new vscode.ThemeIcon('refresh'),
                action: 'retry',
            },
            {
                label: l10n.t('Update credentials…'),
                detail: l10n.t('Enter a new secret. The stored one is replaced only after the new one validates.'),
                iconPath: new vscode.ThemeIcon('key'),
                action: 'update',
            },
            {
                label: l10n.t('Remove'),
                detail: l10n.t('Delete only this credential and its secrets.'),
                iconPath: new vscode.ThemeIcon('trash'),
                action: 'remove',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('Back'),
                iconPath: new vscode.ThemeIcon('arrow-left'),
                action: 'back',
            },
            {
                label: l10n.t('Exit'),
                iconPath: new vscode.ThemeIcon('close'),
                action: 'exit',
            },
        ];

        const selected = await context.ui.showQuickPick(actions, {
            stepName: 'atlasCredentialAction',
            placeHolder: status?.error
                ? l10n.t('{0} needs attention: {1}', label, status.error.message)
                : l10n.t('{0} is signed in', label),
            suppressPersistence: true,
        });

        switch (selected.action) {
            case 'retry':
                await this.retry(context, credentialId, label);
                return;
            case 'update':
                await this.update(context, credentialId, label);
                return;
            case 'remove':
                await this.remove(context, credentialId, label);
                return;
            case 'back':
                context.telemetry.properties.atlasCredentialAction = 'back';
                context.selectedCredentialId = undefined;
                throw new GoBackError();
            default:
                context.telemetry.properties.atlasCredentialAction = 'exit';
                throw new UserCancelledError(ATLAS_CREDENTIAL_MANAGEMENT_EXIT);
        }
    }

    public shouldPrompt(context: AtlasCredentialsManagementWizardContext): boolean {
        return !!context.selectedCredentialId;
    }

    private async retry(
        context: AtlasCredentialsManagementWizardContext,
        credentialId: string,
        label: string,
    ): Promise<never> {
        context.telemetry.properties.atlasCredentialAction = 'retry';

        const snapshot = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: l10n.t('Retrying {0}…', label) },
            () => context.discoveryService.retryCredential(credentialId),
        );

        const stillFailing = snapshot.credentialErrors.some((error) => error.credentialId === credentialId);
        context.telemetry.properties.atlasCredentialRetryResult = stillFailing ? 'failed' : 'succeeded';
        context.changed = true;

        if (!stillFailing) {
            void vscode.window.showInformationMessage(l10n.t('{0} is signed in again.', label));
        }

        // Reload the list so the row reflects the new status, then return to it.
        context.credentials = [];
        context.selectedCredentialId = undefined;
        throw new GoBackError();
    }

    private async update(
        context: AtlasCredentialsManagementWizardContext,
        credentialId: string,
        label: string,
    ): Promise<never> {
        context.telemetry.properties.atlasCredentialAction = 'update';

        const stored = await openAtlasCredentialsWebview({ credentialId, credentialLabel: label });

        context.telemetry.properties.atlasCredentialUpdateResult = stored ? 'succeeded' : 'cancelled';

        if (stored) {
            context.changed = true;
            context.discoveryService.sessionRegistry.invalidate(credentialId);
            context.discoveryService.invalidate();
        }

        // Whether the update succeeded or the user closed the panel, the previous credential is
        // still intact, so the natural landing place is the refreshed credential list.
        context.credentials = [];
        context.selectedCredentialId = undefined;
        throw new GoBackError();
    }

    private async remove(
        context: AtlasCredentialsManagementWizardContext,
        credentialId: string,
        label: string,
    ): Promise<never> {
        context.telemetry.properties.atlasCredentialAction = 'remove';

        await context.ui.showWarningMessage(
            l10n.t('Remove the MongoDB Atlas credential "{0}"?', label),
            {
                modal: true,
                detail: l10n.t('Only this credential and its secrets are deleted. Other credentials stay signed in.'),
            },
            { title: l10n.t('Remove') },
        );

        await removeAtlasCredential(credentialId);
        context.discoveryService.sessionRegistry.invalidate(credentialId);
        context.discoveryService.invalidate();
        context.changed = true;

        void vscode.window.showInformationMessage(l10n.t('Removed the MongoDB Atlas credential "{0}".', label));

        context.credentials = [];
        context.selectedCredentialId = undefined;
        throw new GoBackError();
    }
}
