/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { isLocalOrPrivateHost } from '../../documentdb/utils/hostClassification';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

/**
 * TLS-exception step (design §7). Shown only when the connection targets a local or
 * private-network host (so a self-signed / untrusted certificate is plausibly expected),
 * and it **defaults to keeping TLS on** — the user must explicitly opt into allowing invalid
 * certificates. The gate (§7.1) only decides whether to offer the choice; the copy warns that
 * a `.local` / single-word host could be managed corporate infrastructure rather than the
 * developer's own machine.
 */
export class PromptTlsExceptionStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const enableTls = {
            id: 'enable',
            label: l10n.t('Enable TLS (default)'),
            detail: l10n.t('Validate the server certificate. Recommended.'),
            alwaysShow: true,
        };
        const allowInvalid = {
            id: 'allow',
            label: l10n.t('Allow invalid certificates'),
            detail: l10n.t(
                'Accept a self-signed or untrusted certificate. Only choose this for a host you trust — a “.local” or single-word name can also be managed corporate infrastructure.',
            ),
            alwaysShow: true,
        };

        const selected = await context.ui.showQuickPick([enableTls, allowInvalid], {
            placeHolder: l10n.t('This connection targets a local or private network host. TLS certificate validation:'),
            stepName: 'tlsException',
            suppressPersistence: true,
        });

        context.disableEmulatorSecurity = selected.id === 'allow';
        context.telemetry.properties.tlsException = context.disableEmulatorSecurity ? 'allowInvalid' : 'enabled';
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        // Already decided (e.g. the connection string already opted in) — don't ask again.
        if (context.disableEmulatorSecurity !== undefined) {
            return false;
        }
        if (!context.connectionString) {
            return false;
        }
        try {
            const hosts = new DocumentDBConnectionString(context.connectionString).hosts;
            // Allow-invalid is client-wide, so only offer the exception when EVERY seed host is
            // local/private — a mixed list (e.g. localhost + a public host) must NOT be able to
            // disable certificate validation for the public host.
            return hosts.length > 0 && hosts.every((host) => isLocalOrPrivateHost(host));
        } catch {
            // A connection string we can't parse won't reach the gate — let later steps handle it.
            return false;
        }
    }
}
