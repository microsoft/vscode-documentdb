/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, GoBackError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { nonNullProp, nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface TenantActionQuickPickItem extends vscode.QuickPickItem {
    action?: 'back' | 'exit';
}

/**
 * This step is shown when a user selects a tenant that is already signed in.
 * It provides navigation options (back/exit) since there's no action to take.
 */
export class TenantActionStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        const selectedTenant = nonNullValue(context.selectedTenant, 'context.selectedTenant', 'TenantActionStep.ts');
        const tenantId = nonNullProp(selectedTenant, 'tenantId', 'selectedTenant.tenantId', 'TenantActionStep.ts');
        const tenantName = selectedTenant.displayName ?? tenantId;

        // Tenant is already signed in - show info and allow navigation
        const actionItems: TenantActionQuickPickItem[] = [
            {
                label: l10n.t('Back to tenant selection'),
                detail: l10n.t('You are already signed in to tenant "{0}"', tenantName),
                iconPath: new vscode.ThemeIcon('arrow-left'),
                action: 'back',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('Exit'),
                iconPath: new vscode.ThemeIcon('close'),
                action: 'exit',
            },
        ];

        const selectedAction = await context.ui.showQuickPick(actionItems, {
            stepName: 'tenantAction',
            placeHolder: l10n.t('Signed in to tenant "{0}"', tenantName),
            suppressPersistence: true,
        });

        if (selectedAction.action === 'back') {
            context.telemetry.properties.tenantSignInAction = 'back';
            context.selectedTenant = undefined;
            throw new GoBackError();
        } else {
            context.telemetry.properties.tenantSignInAction = 'exit';
            throw new UserCancelledError('exitAccountManagement');
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        // Only show this step if we have a selected tenant (which means it's signed in)
        return !!context.selectedTenant;
    }
}
