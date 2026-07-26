/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { openAtlasCredentialsWebview } from '../../../webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { readAtlasCredentials, removeAllAtlasCredentials } from '../credentials/atlasCredentialStore';
import { resolveCredentialLabel, type AtlasCredentialError } from '../discovery/AtlasDiscoveryService';
import {
    type AtlasCredentialsManagementWizardContext,
    type AtlasCredentialStatus,
} from './AtlasCredentialsManagementWizardContext';

/** Sentinel messages the entry point uses to tell a graceful exit from a real cancellation. */
export const ATLAS_CREDENTIAL_ADDED = 'atlasCredentialAdded';
export const ATLAS_CREDENTIAL_MANAGEMENT_EXIT = 'exitAtlasCredentialManagement';

interface CredentialQuickPickItem extends vscode.QuickPickItem {
    credentialId?: string;
    isAddOption?: boolean;
    isSignOutAllOption?: boolean;
    isExitOption?: boolean;
}

/**
 * First step of the credential-management wizard: the list of stored credentials plus the
 * fleet-level actions (add, sign out of all, exit).
 *
 * Credential management deliberately lives outside the discovery tree, exactly like the Azure
 * account flow, so the healthy tree never has to carry credential-management rows.
 */
export class SelectAtlasCredentialStep extends AzureWizardPromptStep<AtlasCredentialsManagementWizardContext> {
    public async prompt(context: AtlasCredentialsManagementWizardContext): Promise<void> {
        const buildItems = async (): Promise<CredentialQuickPickItem[]> => {
            if (context.credentials.length === 0) {
                context.credentials = await loadCredentialStatuses(context);
            }

            context.telemetry.measurements.atlasCredentialCount = context.credentials.length;
            context.telemetry.measurements.atlasFailedCredentialCount = context.credentials.filter(
                (status) => status.error,
            ).length;

            const credentialItems: CredentialQuickPickItem[] = context.credentials.map((status) => ({
                label: status.label,
                description: status.record.authMethod === 'apikey' ? l10n.t('API Key') : l10n.t('Service Account'),
                detail: status.error ? `$(warning) ${status.error.message}` : l10n.t('$(pass) Signed in'),
                iconPath: new vscode.ThemeIcon(status.record.authMethod === 'apikey' ? 'key' : 'cloud'),
                credentialId: status.record.id,
            }));

            const trailingItems: CredentialQuickPickItem[] = [
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                {
                    label: l10n.t('Add a credential…'),
                    iconPath: new vscode.ThemeIcon('add'),
                    isAddOption: true,
                },
            ];

            if (credentialItems.length > 0) {
                trailingItems.push({
                    label: l10n.t('Sign out of all'),
                    iconPath: new vscode.ThemeIcon('sign-out'),
                    isSignOutAllOption: true,
                });
            }

            trailingItems.push({
                label: l10n.t('Exit'),
                iconPath: new vscode.ThemeIcon('close'),
                isExitOption: true,
            });

            return [...credentialItems, ...trailingItems];
        };

        const selected = await context.ui.showQuickPick(buildItems(), {
            stepName: 'selectAtlasCredential',
            placeHolder: l10n.t('MongoDB Atlas credentials used for service discovery'),
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading MongoDB Atlas credentials…'),
        });

        if (selected.isAddOption) {
            context.telemetry.properties.atlasCredentialAction = 'add';
            const stored = await openAtlasCredentialsWebview();
            if (!stored) {
                // Cancelling the webview stores nothing. Return to the list rather than closing
                // the whole flow, so the user can pick another action.
                context.credentials = [];
                await this.prompt(context);
                return;
            }
            context.changed = true;
            context.discoveryService.invalidate();
            throw new UserCancelledError(ATLAS_CREDENTIAL_ADDED);
        }

        if (selected.isSignOutAllOption) {
            context.telemetry.properties.atlasCredentialAction = 'signOutAll';
            const confirm = l10n.t('Sign out of all');
            await context.ui.showWarningMessage(
                l10n.t('Sign out of every MongoDB Atlas credential?'),
                { modal: true, detail: l10n.t('All stored MongoDB Atlas credentials will be removed.') },
                { title: confirm },
            );

            const removed = await removeAllAtlasCredentials();
            context.telemetry.measurements.atlasCredentialsRemoved = removed;
            context.discoveryService.reset();
            context.changed = true;
            throw new UserCancelledError(ATLAS_CREDENTIAL_MANAGEMENT_EXIT);
        }

        if (selected.isExitOption) {
            context.telemetry.properties.atlasCredentialAction = 'exit';
            throw new UserCancelledError(ATLAS_CREDENTIAL_MANAGEMENT_EXIT);
        }

        context.telemetry.properties.atlasCredentialAction = 'selectCredential';
        context.selectedCredentialId = selected.credentialId;
    }

    public shouldPrompt(context: AtlasCredentialsManagementWizardContext): boolean {
        return !context.selectedCredentialId;
    }
}

/**
 * Reads every credential and pairs it with the failure recorded for it in the latest discovery
 * snapshot. Uses the cached snapshot, so opening the manager does not re-hammer a credential that
 * is already known to be failing.
 */
export async function loadCredentialStatuses(
    context: AtlasCredentialsManagementWizardContext,
): Promise<AtlasCredentialStatus[]> {
    const records = await readAtlasCredentials();
    if (records.length === 0) {
        return [];
    }

    let errorsById = new Map<string, AtlasCredentialError>();
    try {
        const snapshot = await context.discoveryService.listAll();
        errorsById = new Map(snapshot.credentialErrors.map((error) => [error.credentialId, error]));
    } catch {
        // listAll never throws for a single credential; a failure here means the whole read failed,
        // and the list is still worth showing without status annotations.
    }

    return records.map((record) => ({
        record,
        label: resolveCredentialLabel(record),
        error: errorsById.get(record.id),
    }));
}
