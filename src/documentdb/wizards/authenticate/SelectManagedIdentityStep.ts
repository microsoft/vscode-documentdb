/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type ManagedIdentityAuthConfig } from '../../auth/AuthConfig';
import { type ManagedIdentityHint } from '../../auth/managedIdentityConnectionString';
import { getRecentManagedIdentities } from '../../auth/recentManagedIdentities';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The subset of a wizard context this step needs, so it can serve every wizard that offers the method. */
export interface ManagedIdentitySelectionContext extends IActionContext {
    managedIdentityAuthConfig?: ManagedIdentityAuthConfig;
    managedIdentityHint?: ManagedIdentityHint;
}

type IdentityChoice = 'manual' | 'systemAssigned' | 'clientId';

interface IdentityQuickPickItem extends vscode.QuickPickItem {
    readonly choice?: IdentityChoice;
    readonly clientId?: string;
}

/**
 * Asks which managed identity to authenticate with.
 *
 * The instance metadata service cannot disambiguate between several identities assigned to the same
 * machine, so on such a machine the client ID is not a nicety: without it the connection fails with
 * an error that names no cause. That is the incident this feature exists to close.
 *
 * The list follows the pattern already shipped in `SelectAtlasDatabaseUserStep`: the manual escape
 * hatch is row one, so anyone who already has a GUID is one keystroke away, and the known values sit
 * below it under separator headings. It is never a dead end; with nothing known it still shows the
 * manual entry row and the system-assigned option.
 */
export class SelectManagedIdentityStep<T extends ManagedIdentitySelectionContext> extends AzureWizardPromptStep<T> {
    constructor(private readonly isManagedIdentitySelected: (context: T) => boolean) {
        super();
    }

    public async prompt(context: T): Promise<void> {
        const prefilledClientId = context.managedIdentityAuthConfig?.clientId;

        const selected = await context.ui.showQuickPick(this.buildItems(prefilledClientId), {
            stepName: 'selectManagedIdentity',
            placeHolder: l10n.t('Select the managed identity to use'),
            matchOnDetail: true,
            suppressPersistence: true,
        });

        if (selected.choice === 'systemAssigned') {
            // An empty configuration is meaningful: it selects the system-assigned identity.
            context.managedIdentityAuthConfig = {};
            context.telemetry.properties.managedIdentityKind = 'system';
            context.telemetry.properties.managedIdentityClientIdSource = 'none';
            return;
        }

        if (selected.choice === 'clientId' && selected.clientId) {
            this.applyClientId(
                context,
                selected.clientId,
                prefilledClientId === selected.clientId ? 'connectionString' : 'recent',
            );
            return;
        }

        const clientId = await context.ui.showInputBox({
            prompt: l10n.t('Enter the client ID of the user-assigned managed identity.'),
            placeHolder: l10n.t('For example, 11111111-2222-3333-4444-555555555555'),
            value: prefilledClientId,
            ignoreFocusOut: true,
            validateInput: (value?: string) => this.validateClientId(value),
        });

        this.applyClientId(context, clientId.trim(), 'prompt');
    }

    public shouldPrompt(context: T): boolean {
        if (!this.isManagedIdentitySelected(context)) {
            return false;
        }

        // A connection string that carried ENVIRONMENT:azure already answered this question.
        return context.managedIdentityHint?.confidence !== 'explicit';
    }

    public validateClientId(this: void, value: string | undefined): string | undefined {
        const trimmed = (value ?? '').trim();

        if (trimmed.length === 0) {
            return l10n.t('A client ID is required. Go back to choose the system-assigned identity instead.');
        }

        if (!GUID_PATTERN.test(trimmed)) {
            return l10n.t('A client ID looks like 11111111-2222-3333-4444-555555555555.');
        }

        return undefined;
    }

    /**
     * Manual entry first, then the values we know about, each group under its own heading.
     * A group with nothing in it contributes no separator, so the list never shows an empty heading.
     */
    public buildItems(prefilledClientId?: string): IdentityQuickPickItem[] {
        const items: IdentityQuickPickItem[] = [
            {
                label: l10n.t('Enter a client ID'),
                detail: l10n.t('Type the client ID of a user-assigned managed identity'),
                iconPath: new vscode.ThemeIcon('edit'),
                choice: 'manual',
                alwaysShow: true,
            },
        ];

        items.push({ label: l10n.t('This machine'), kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: l10n.t('System-assigned managed identity'),
            detail: l10n.t("Use this machine's own identity, no client ID needed"),
            // Not the 'vm' icon: the Azure VM discovery provider uses it for a remote machine that
            // hosts a database, which is the opposite end of the connection from this row.
            iconPath: new vscode.ThemeIcon('device-desktop'),
            choice: 'systemAssigned',
        });

        if (prefilledClientId) {
            items.push({ label: l10n.t('From the connection string'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: prefilledClientId,
                iconPath: new vscode.ThemeIcon('account'),
                choice: 'clientId',
                clientId: prefilledClientId,
            });
        }

        const recent = getRecentManagedIdentities().filter(
            (entry) => entry.clientId.toLowerCase() !== prefilledClientId?.toLowerCase(),
        );

        if (recent.length > 0) {
            items.push({ label: l10n.t('Recently used'), kind: vscode.QuickPickItemKind.Separator });
            items.push(
                ...recent.map((entry) => ({
                    label: entry.clientId,
                    detail: entry.connectionLabel
                        ? l10n.t('Used by "{connection}"', { connection: entry.connectionLabel })
                        : undefined,
                    iconPath: new vscode.ThemeIcon('account'),
                    choice: 'clientId' as const,
                    clientId: entry.clientId,
                })),
            );
        }

        return items;
    }

    private applyClientId(context: T, clientId: string, source: 'connectionString' | 'recent' | 'prompt'): void {
        context.managedIdentityAuthConfig = { clientId };
        context.valuesToMask.push(clientId);
        context.telemetry.properties.managedIdentityKind = 'user';
        context.telemetry.properties.managedIdentityClientIdSource = source;
    }
}
