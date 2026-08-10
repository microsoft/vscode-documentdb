/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import {
    detectManagedIdentityHint,
    managedIdentityConfigFromHint,
    stripManagedIdentityMarkers,
} from '../../documentdb/auth/managedIdentityConnectionString';
import { AzureDomains, hasDomainSuffix } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { canonicalizeTlsException } from '../../documentdb/utils/tlsException';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptConnectionStringStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the connection string of your DocumentDB cluster.');
        const newConnectionString = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            placeHolder: l10n.t('Starts with mongodb:// or mongodb+srv://'),
            validateInput: (connectionString?: string) => this.validateInput(connectionString),
            asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
        });
        const trimmedConnectionString = newConnectionString.trim();

        // 1. Parse the connection string and extract credentials
        const parsedConnectionString = new DocumentDBConnectionString(trimmedConnectionString);

        // Managed identity intent must be read BEFORE the username is cleared below: the client ID
        // rides in the username position of the documented driver-native form (design §5.2).
        const managedIdentityHint = detectManagedIdentityHint(parsedConnectionString);

        // Extract credentials to structured nativeAuthConfig
        if (!managedIdentityHint && (parsedConnectionString.username || parsedConnectionString.password)) {
            context.nativeAuthConfig = {
                connectionUser: parsedConnectionString.username || '',
                connectionPassword: parsedConnectionString.password || '',
            };
        }

        // Remove credentials from connection string
        parsedConnectionString.username = '';
        parsedConnectionString.password = '';

        // 2. Remove obsolete authMechanism entry
        if (parsedConnectionString.searchParams.get('authMechanism') === 'SCRAM-SHA-256') {
            parsedConnectionString.searchParams.delete('authMechanism');
        }

        if (managedIdentityHint) {
            // The mechanism markers were inputs to a decision, not state: keeping them in the stored
            // string risks the driver preferring the URL form and taking its own IMDS path (D1).
            stripManagedIdentityMarkers(parsedConnectionString);
            context.managedIdentityHint = managedIdentityHint;
            context.managedIdentityAuthConfig = managedIdentityConfigFromHint(managedIdentityHint);
            context.nativeAuthConfig = undefined;

            // Only an explicit ENVIRONMENT:azure marker is unambiguous enough to skip the method
            // prompt. A bare OIDC string with a GUID username is suggestive, not conclusive, so the
            // user still gets to confirm or switch to interactive Entra ID.
            if (managedIdentityHint.confidence === 'explicit') {
                context.selectedAuthenticationMethod = AuthMethodId.ManagedIdentity;
            }

            if (managedIdentityHint.clientId) {
                context.valuesToMask.push(managedIdentityHint.clientId);
            }

            context.telemetry.properties.managedIdentityHint = managedIdentityHint.confidence;
        }

        context.connectionString = parsedConnectionString.toString();

        // TLS exception (§7): for an all-local/private host, fold any TLS-bypass URL param into the
        // single source of truth (`context.disableEmulatorSecurity`) and strip it from the stored
        // connection string. RESET the decision on every entry (so changing the connection string via
        // Back-navigation re-evaluates it) — set true only for an all-local/private host that requested
        // the bypass, otherwise clear it so the gated TLS step decides (or a public host validates).
        // A public/mixed host keeps its string verbatim: the stored flag is host-gated and would never
        // be honored there, so stripping would delete the user's only way to express the exception.
        const canonicalTls = canonicalizeTlsException(context.connectionString);
        context.connectionString = canonicalTls.connectionString;
        context.disableEmulatorSecurity = canonicalTls.disableEmulatorSecurity ? true : undefined;

        context.valuesToMask.push(context.connectionString);

        // 3. Detect and/or guess available authentication methods
        const supportedAuthMethods: AuthMethodId[] = [AuthMethodId.NativeAuth];

        if (hasDomainSuffix(AzureDomains.vCore, ...parsedConnectionString.hosts)) {
            supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
            // Managed identity is Entra ID on the wire; wherever one is offered, so is the other.
            supportedAuthMethods.push(AuthMethodId.ManagedIdentity);
        }

        // Anonymous ("no authentication") connections are always offered.
        supportedAuthMethods.push(AuthMethodId.NoAuth);

        context.availableAuthenticationMethods = supportedAuthMethods;
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            return l10n.t('Invalid Connection String: {error}', {
                error: l10n.t('Connection string cannot be empty.'),
            });
        }

        try {
            new DocumentDBConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error && error.name === 'MongoParseError') {
                return error.message;
            } else {
                return l10n.t('Invalid Connection String: {error}', { error: parseError(error).message });
            }
        }

        return undefined;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.connectionString;
    }

    public validateInput(this: void, connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!(connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://'))) {
            return l10n.t('"mongodb://" or "mongodb+srv://" must be the prefix of the connection string.');
        }

        return undefined;
    }
}
