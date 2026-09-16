/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type EntraIdAuthConfig, type ManagedIdentityAuthConfig } from '../../auth/AuthConfig';
import {
    AuthMethodId,
    authMethodsFromString,
    createAuthMethodQuickPickItems,
    isSupportedAuthMethod,
} from '../../auth/AuthMethod';
import { type ConnectionStringAuthFacts } from '../../auth/managedIdentityConnectionString';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ONLY_PATTERN = /^[0-9a-f]*$/i;

/** Shown wherever the expected shape is explained. Uses letters as well as digits, because both are valid. */
const CLIENT_ID_EXAMPLE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** The 8-4-4-4-12 grouping of a GUID. */
const GUID_GROUP_SIZES = [8, 4, 4, 4, 12];

function stripGuidSeparators(value: string): string {
    return value.trim().replace(/-/g, '');
}

/**
 * Re-inserts the GUID group separators, for as many characters as are present.
 *
 * Anything past the 32nd character is kept as a trailing group so an over-long value stays visible
 * rather than looking correct.
 */
export function groupAsGuid(hexOnly: string): string {
    const groups: string[] = [];
    let position = 0;

    for (const size of GUID_GROUP_SIZES) {
        if (position >= hexOnly.length) {
            break;
        }

        groups.push(hexOnly.slice(position, position + size));
        position += size;
    }

    if (position < hexOnly.length) {
        groups.push(hexOnly.slice(position));
    }

    return groups.join('-');
}

/**
 * Accepts a client ID that was pasted without separators, or with them in the wrong places, and
 * returns it in canonical form. A value that is not 32 hexadecimal characters is only trimmed.
 */
export function normalizeClientId(value: string | undefined): string {
    const trimmed = (value ?? '').trim();
    const hexOnly = stripGuidSeparators(trimmed);

    if (hexOnly.length !== 32 || !HEX_ONLY_PATTERN.test(hexOnly)) {
        return trimmed;
    }

    return groupAsGuid(hexOnly);
}

/** The subset of a wizard context this step needs, so it can serve every wizard that offers the method. */
export interface ManagedIdentitySelectionContext extends IActionContext {
    entraIdAuthConfig?: EntraIdAuthConfig;
    managedIdentityAuthConfig?: ManagedIdentityAuthConfig;
    connectionStringAuthFacts?: ConnectionStringAuthFacts;
    availableAuthenticationMethods?: AuthMethodId[];
    availableAuthMethods?: string[];
}

type IdentityChoice = 'account' | 'manual' | 'systemAssigned' | 'clientId' | 'authMethod';

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
 * The system-assigned identity is the default choice, followed by known client IDs and the manual
 * escape hatch as the final fallback. It is never a dead end; with nothing known it still shows both
 * identity options.
 */
export class SelectEntraTokenSourceStep<T extends ManagedIdentitySelectionContext> extends AzureWizardPromptStep<T> {
    constructor(
        private readonly getSelectedAuthMethod: (context: T) => AuthMethodId | undefined,
        private readonly setSelectedAuthMethod: (context: T, method: AuthMethodId) => void,
    ) {
        super();
    }

    public async prompt(context: T): Promise<void> {
        const prefilledClientId = context.managedIdentityAuthConfig?.clientId;
        const facts = context.connectionStringAuthFacts;
        const suppliedIdentity = facts?.username && !facts.usernameIsGuid ? facts.username : undefined;

        const selected = await context.ui.showQuickPick(
            this.buildItems(prefilledClientId, suppliedIdentity, facts?.usesOidc === true),
            {
                stepName: 'selectEntraTokenSource',
                placeHolder: suppliedIdentity
                    ? l10n.t('Select the identity to use ("{0}" is not a client ID)', suppliedIdentity)
                    : l10n.t('Select the identity to use for this connection'),
                matchOnDetail: true,
                suppressPersistence: true,
            },
        );

        if (selected.choice === 'account') {
            this.applyAuthMethod(context, AuthMethodId.MicrosoftEntraID);
            return;
        }

        if (selected.choice === 'authMethod') {
            await this.selectDifferentAuthMethod(context);
            return;
        }

        if (selected.choice === 'systemAssigned') {
            this.applyAuthMethod(context, AuthMethodId.ManagedIdentity);
            const tenantId = context.managedIdentityAuthConfig?.tenantId;
            // A config without a client ID selects the system-assigned identity.
            context.managedIdentityAuthConfig = tenantId ? { tenantId } : {};
            context.telemetry.properties.managedIdentityKind = 'system';
            context.telemetry.properties.managedIdentityClientIdSource = 'none';
            return;
        }

        if (selected.choice === 'clientId' && selected.clientId) {
            this.applyAuthMethod(context, AuthMethodId.ManagedIdentity);
            this.applyClientId(context, selected.clientId, 'connectionString');
            return;
        }

        const clientId = await context.ui.showInputBox({
            prompt: l10n.t('Enter the client ID of the user-assigned managed identity.'),
            placeHolder: l10n.t('For example, {0}', CLIENT_ID_EXAMPLE),
            value: selected.clientId ?? prefilledClientId,
            ignoreFocusOut: true,
            validateInput: (value?: string) => this.validateClientId(value),
        });

        const normalized = normalizeClientId(clientId);
        this.applyAuthMethod(context, AuthMethodId.ManagedIdentity);
        this.applyClientId(context, normalized, normalized === selected.clientId ? 'connectionString' : 'prompt');
    }

    public shouldPrompt(context: T): boolean {
        const selectedAuthMethod = this.getSelectedAuthMethod(context);
        if (
            selectedAuthMethod !== AuthMethodId.MicrosoftEntraID &&
            selectedAuthMethod !== AuthMethodId.ManagedIdentity
        ) {
            return false;
        }

        const facts = context.connectionStringAuthFacts;
        if (!facts || !facts.declaresAzureMachineWorkflow) {
            return true;
        }

        return !!facts.username && !facts.usernameIsGuid;
    }

    public validateClientId(this: void, value: string | undefined): string | undefined {
        const trimmed = (value ?? '').trim();

        if (trimmed.length === 0) {
            return l10n.t('A client ID is required. Go back to choose the system-assigned identity instead.');
        }

        if (GUID_PATTERN.test(normalizeClientId(trimmed))) {
            return undefined;
        }

        const hexOnly = stripGuidSeparators(trimmed);

        if (!HEX_ONLY_PATTERN.test(hexOnly)) {
            return l10n.t('A client ID uses only 0-9, a-f, and dashes, like {0}.', CLIENT_ID_EXAMPLE);
        }

        // Echoing the grouped reading is more useful than the abstract shape: it shows which group
        // the next character lands in and how much is still missing.
        return l10n.t('Read as {0}. A complete client ID looks like {1}.', groupAsGuid(hexOnly), CLIENT_ID_EXAMPLE);
    }

    /**
     * System-assigned identity first, then the values we know about, with manual entry last.
     * A group with nothing in it contributes no separator, so the list never shows an empty heading.
     *
     * `suppliedIdentity` is a value the connection string put in the identity position that is not
     * usable as a client ID. It is offered for editing rather than dropped, because it is the only
     * evidence of which identity the user meant.
     */
    public buildItems(
        prefilledClientId?: string,
        suppliedIdentity?: string,
        showChangeAuthMethod: boolean = false,
    ): IdentityQuickPickItem[] {
        const items: IdentityQuickPickItem[] = [];

        if (prefilledClientId) {
            items.push({ label: l10n.t('From the connection string'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: l10n.t('Managed identity  {0}', prefilledClientId),
                detail: l10n.t('Use the supplied client ID as a user-assigned managed identity'),
                iconPath: new vscode.ThemeIcon('account'),
                choice: 'clientId',
                clientId: prefilledClientId,
            });
        }

        items.push({ label: l10n.t('Microsoft Entra account'), kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: l10n.t('Sign in with my account'),
            detail: l10n.t('Uses the account you sign in with in Visual Studio Code'),
            iconPath: new vscode.ThemeIcon('sign-in'),
            choice: 'account',
            alwaysShow: true,
        });
        items.push(
            { label: l10n.t('Managed identity'), kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('Use the identity assigned to this machine'),
                detail: l10n.t('Authenticate without a client ID using the system-assigned option'),
                iconPath: new vscode.ThemeIcon('device-desktop'),
                choice: 'systemAssigned',
            },
            {
                label: l10n.t('Use a different managed identity...'),
                detail: l10n.t('Enter the client ID of a user-assigned managed identity'),
                iconPath: new vscode.ThemeIcon('edit'),
                choice: 'manual',
                clientId: suppliedIdentity,
                alwaysShow: true,
            },
        );

        if (showChangeAuthMethod) {
            items.push({ label: l10n.t('Other options'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: l10n.t('Choose a different authentication method...'),
                detail: l10n.t('This connection string asked for Microsoft Entra ID'),
                iconPath: new vscode.ThemeIcon('arrow-swap'),
                choice: 'authMethod',
                alwaysShow: true,
            });
        }

        return items;
    }

    private async selectDifferentAuthMethod(context: T): Promise<void> {
        const availableMethods =
            context.availableAuthenticationMethods ?? authMethodsFromString(context.availableAuthMethods);
        const authMethodItems = createAuthMethodQuickPickItems(availableMethods, { showSupportInfo: true }).filter(
            (item) => item.authMethod !== AuthMethodId.MicrosoftEntraID,
        );
        const selected = await context.ui.showQuickPick(
            authMethodItems,
            {
                placeHolder: l10n.t('Select an authentication method'),
                matchOnDetail: true,
                suppressPersistence: true,
            },
        );

        if (!isSupportedAuthMethod(selected.authMethod)) {
            throw new Error(l10n.t('The selected authentication method is not supported.'));
        }

        this.applyAuthMethod(context, selected.authMethod);
    }

    private applyAuthMethod(context: T, method: AuthMethodId): void {
        this.setSelectedAuthMethod(context, method);

        if (method === AuthMethodId.MicrosoftEntraID) {
            context.managedIdentityAuthConfig = undefined;
        } else if (method === AuthMethodId.ManagedIdentity) {
            context.entraIdAuthConfig = undefined;
        } else {
            context.entraIdAuthConfig = undefined;
            context.managedIdentityAuthConfig = undefined;
        }
    }

    private applyClientId(context: T, clientId: string, source: 'connectionString' | 'prompt'): void {
        context.managedIdentityAuthConfig = { ...context.managedIdentityAuthConfig, clientId };
        context.valuesToMask.push(clientId);
        context.telemetry.properties.managedIdentityKind = 'user';
        context.telemetry.properties.managedIdentityClientIdSource = source;
    }
}
