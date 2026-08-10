/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Coarse classification of a managed identity token failure.
 *
 * Kept separate from the message so telemetry can report the reason without ever carrying
 * user-visible text or identifiers.
 */
export type ManagedIdentityFailureReason = 'noEndpoint' | 'multipleIdentities' | 'identityNotAssigned' | 'other';

/**
 * Classifies a raw failure from `ManagedIdentityCredential`.
 *
 * `@azure/identity` delegates managed identity to `@azure/msal-node`, so the surfaced error is
 * typically a `CredentialUnavailableError` or `AuthenticationError` wrapping an MSAL
 * `ManagedIdentityError`. Neither the error `name` nor the message is a stable contract, so this
 * matches defensively on both and always has a fallback.
 */
export function classifyManagedIdentityError(error: unknown): ManagedIdentityFailureReason {
    const haystack = collectErrorText(error).toLowerCase();

    if (haystack.length === 0) {
        return 'other';
    }

    // The reported incident: the instance metadata service refuses to pick between several
    // identities and asks the caller to disambiguate.
    if (
        haystack.includes('multiple user assigned identities') ||
        haystack.includes('multiple user-assigned identities') ||
        haystack.includes('more than one user-assigned') ||
        haystack.includes('multiple managed identities') ||
        haystack.includes('please specify') ||
        haystack.includes('ambiguous')
    ) {
        return 'multipleIdentities';
    }

    if (
        haystack.includes('identity not found') ||
        haystack.includes('no user assigned identity') ||
        haystack.includes('was not found') ||
        haystack.includes('not assigned') ||
        haystack.includes('identity_not_found')
    ) {
        return 'identityNotAssigned';
    }

    if (
        haystack.includes('credentialunavailable') ||
        haystack.includes('managedidentitycredential is unavailable') ||
        haystack.includes('econnrefused') ||
        haystack.includes('ehostunreach') ||
        haystack.includes('enetunreach') ||
        haystack.includes('etimedout') ||
        haystack.includes('timed out') ||
        haystack.includes('no managed identity endpoint') ||
        haystack.includes('unavailable')
    ) {
        return 'noEndpoint';
    }

    return 'other';
}

/**
 * Turns a raw credential failure into a sentence a human can act on. Never throws.
 *
 * Per decision D6.2 this is plain-language translation only: no suggested commands, no deep links,
 * no branching remediation UI.
 */
export function describeManagedIdentityError(error: unknown, clientId?: string): string {
    switch (classifyManagedIdentityError(error)) {
        case 'multipleIdentities':
            return l10n.t(
                'This machine has more than one managed identity, so the right one cannot be chosen automatically. Reconnect and enter the client ID you want to use.',
            );
        case 'noEndpoint':
            return l10n.t(
                'No managed identity was found. This method requires VS Code to be running on an Azure VM that has a managed identity assigned.',
            );
        case 'identityNotAssigned':
            return clientId
                ? l10n.t('The managed identity with client ID {0} is not assigned to this machine.', clientId)
                : l10n.t('The requested managed identity is not assigned to this machine.');
        default:
            return l10n.t('Managed Identity authentication failed: {0}', describeUnknownError(error));
    }
}

/**
 * Flattens an error and its `cause` chain into a single searchable string.
 *
 * MSAL wraps the informative message one or two levels down, so matching only on the outermost
 * message would classify most real failures as `other`.
 */
function collectErrorText(error: unknown, depth: number = 0): string {
    if (depth > 4 || error === null || error === undefined) {
        return '';
    }

    if (typeof error === 'string') {
        return error;
    }

    if (!(error instanceof Error)) {
        return typeof error === 'object' ? '' : String(error);
    }

    const parts: string[] = [error.name, error.message];

    const candidate = error as Error & { errorCode?: unknown; cause?: unknown };
    if (typeof candidate.errorCode === 'string') {
        parts.push(candidate.errorCode);
    }
    if (candidate.cause !== undefined) {
        parts.push(collectErrorText(candidate.cause, depth + 1));
    }

    return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' ');
}

function describeUnknownError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (error === undefined || error === null) {
        return l10n.t('no token was returned');
    }
    return String(error);
}
