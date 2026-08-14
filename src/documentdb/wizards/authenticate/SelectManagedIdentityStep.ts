/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type ManagedIdentityAuthConfig } from '../../auth/AuthConfig';
import { type ManagedIdentityHint } from '../../auth/managedIdentityConnectionString';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ONLY_PATTERN = /^[0-9a-f]*$/i;

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
 * The system-assigned identity is the default choice, followed by known client IDs and the manual
 * escape hatch as the final fallback. It is never a dead end; with nothing known it still shows both
 * identity options.
 */
export class SelectManagedIdentityStep<T extends ManagedIdentitySelectionContext> extends AzureWizardPromptStep<T> {
    constructor(private readonly isManagedIdentitySelected: (context: T) => boolean) {
        super();
    }

    public async prompt(context: T): Promise<void> {
        const prefilledClientId = context.managedIdentityAuthConfig?.clientId;
        const suppliedIdentity = context.managedIdentityHint?.suppliedIdentity;

        const selected = await context.ui.showQuickPick(this.buildItems(prefilledClientId, suppliedIdentity), {
            stepName: 'selectManagedIdentity',
            placeHolder: l10n.t('Select the managed identity to use'),
            matchOnDetail: true,
            suppressPersistence: true,
        });

        if (selected.choice === 'systemAssigned') {
            const tenantId = context.managedIdentityAuthConfig?.tenantId;
            // A config without a client ID selects the system-assigned identity.
            context.managedIdentityAuthConfig = tenantId ? { tenantId } : {};
            context.telemetry.properties.managedIdentityKind = 'system';
            context.telemetry.properties.managedIdentityClientIdSource = 'none';
            return;
        }

        if (selected.choice === 'clientId' && selected.clientId) {
            this.applyClientId(context, selected.clientId, 'connectionString');
            return;
        }

        const clientId = await context.ui.showInputBox({
            prompt: l10n.t('Enter the client ID of the user-assigned managed identity.'),
            placeHolder: l10n.t('For example, 11111111-2222-3333-4444-555555555555'),
            value: selected.clientId ?? prefilledClientId,
            ignoreFocusOut: true,
            validateInput: (value?: string) => this.validateClientId(value),
        });

        const normalized = normalizeClientId(clientId);
        this.applyClientId(context, normalized, normalized === selected.clientId ? 'connectionString' : 'prompt');
    }

    public shouldPrompt(context: T): boolean {
        if (!this.isManagedIdentitySelected(context)) {
            return false;
        }

        const hint = context.managedIdentityHint;

        // A connection string that carried ENVIRONMENT:azure already answered this question, unless
        // the identity it supplied is not usable as-is and therefore needs the user's review.
        return hint?.confidence !== 'explicit' || !!hint.suppliedIdentity;
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
            return l10n.t('A client ID uses only 0-9 and a-f, like 11111111-2222-3333-4444-555555555555.');
        }

        // Echoing the grouped reading is more useful than the abstract shape: it shows which group
        // the next character lands in and how much is still missing.
        return l10n.t(
            'Read as {0}. A complete client ID looks like 11111111-2222-3333-4444-555555555555.',
            groupAsGuid(hexOnly),
        );
    }

    /**
     * System-assigned identity first, then the values we know about, with manual entry last.
     * A group with nothing in it contributes no separator, so the list never shows an empty heading.
     *
     * `suppliedIdentity` is a value the connection string put in the identity position that is not
     * usable as a client ID. It is offered for editing rather than dropped, because it is the only
     * evidence of which identity the user meant.
     */
    public buildItems(prefilledClientId?: string, suppliedIdentity?: string): IdentityQuickPickItem[] {
        const items: IdentityQuickPickItem[] = [
            { label: l10n.t('This machine'), kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('System-assigned managed identity'),
                detail: l10n.t("Use this machine's own identity, no client ID needed"),
                // Not the 'vm' icon: nothing here verifies that the host is a virtual machine.
                iconPath: new vscode.ThemeIcon('device-desktop'),
                choice: 'systemAssigned',
            },
        ];

        if (prefilledClientId) {
            items.push({ label: l10n.t('From the connection string'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: prefilledClientId,
                iconPath: new vscode.ThemeIcon('account'),
                choice: 'clientId',
                clientId: prefilledClientId,
            });
        } else if (suppliedIdentity) {
            items.push({ label: l10n.t('From the connection string'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: suppliedIdentity,
                detail: l10n.t('Not a client ID yet. Select to review or correct this value'),
                iconPath: new vscode.ThemeIcon('warning'),
                // 'manual' so the value opens in the editable field instead of being used as-is.
                choice: 'manual',
                clientId: suppliedIdentity,
            });
        }

        items.push({
            label: l10n.t('Enter a client ID'),
            detail: l10n.t('Type the client ID of a user-assigned managed identity'),
            iconPath: new vscode.ThemeIcon('edit'),
            choice: 'manual',
            alwaysShow: true,
        });

        return items;
    }

    private applyClientId(context: T, clientId: string, source: 'connectionString' | 'prompt'): void {
        context.managedIdentityAuthConfig = { ...context.managedIdentityAuthConfig, clientId };
        context.valuesToMask.push(clientId);
        context.telemetry.properties.managedIdentityKind = 'user';
        context.telemetry.properties.managedIdentityClientIdSource = source;
    }
}
