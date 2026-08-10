/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Coarse classification of a managed identity token failure.
 *
 * Kept separate from the message so telemetry can report the reason without ever carrying
 * user-visible text or identifiers, and without breaking when the extension is translated.
 */
export type ManagedIdentityFailureReason = 'noEndpoint' | 'multipleIdentities' | 'identityNotAssigned' | 'other';

/**
 * Classifies a raw failure from `ManagedIdentityCredential`.
 *
 * `@azure/identity` delegates managed identity to `@azure/msal-node`, and every failure observed so
 * far surfaces as a `CredentialUnavailableError` regardless of cause, with the useful detail only in
 * the message and in the `cause` chain. The error `name` is therefore not a usable signal on its
 * own. The shapes below were captured from the real credential by
 * `managedIdentityEndpoint.harness.test.ts`:
 *
 * - Multiple identities: `...Description: Multiple user assigned identities exist, please specify
 *   the clientId / resourceId of the identity in the token request...`
 * - Not assigned: `...Description: Identity not found...`
 * - Unreachable: `ManagedIdentityCredential: Network unreachable. Message: network_error: ...`
 *
 * None of that is a stable contract, so matching is defensive and always falls through.
 */
export function classifyManagedIdentityError(error: unknown): ManagedIdentityFailureReason {
    const haystack = collectErrorText(error).toLowerCase();

    if (haystack.length === 0) {
        return 'other';
    }

    // The reported incident: the instance metadata service refuses to pick between several
    // identities and asks the caller to disambiguate. Checked first, because the outer error name is
    // the same for every case.
    if (
        haystack.includes('multiple user assigned identities') ||
        haystack.includes('multiple user-assigned identities') ||
        haystack.includes('more than one user-assigned') ||
        haystack.includes('multiple managed identities') ||
        haystack.includes('ambiguous')
    ) {
        return 'multipleIdentities';
    }

    if (
        haystack.includes('identity not found') ||
        haystack.includes('no user assigned identity') ||
        haystack.includes('not assigned') ||
        haystack.includes('identity_not_found')
    ) {
        return 'identityNotAssigned';
    }

    if (
        haystack.includes('network unreachable') ||
        haystack.includes('network_error') ||
        haystack.includes('is unavailable') ||
        haystack.includes('no managed identity endpoint') ||
        haystack.includes('econnrefused') ||
        haystack.includes('ehostunreach') ||
        haystack.includes('enetunreach') ||
        haystack.includes('etimedout') ||
        haystack.includes('timed out')
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
                'No managed identity is available on this machine. Managed identity authentication requires VS Code to be running on an Azure resource, such as an Azure VM, with an identity assigned.',
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
 * Duck-typed rather than `instanceof Error`: an error crossing a worker or VM boundary loses its
 * prototype, and MSAL wraps the informative message one or two levels down, so both a strict
 * `instanceof` check and a look at only the outermost message would classify real failures as
 * `other`.
 */
function collectErrorText(error: unknown, depth: number = 0): string {
    if (depth > 4 || error === null || error === undefined) {
        return '';
    }

    if (typeof error === 'string') {
        return error;
    }

    if (typeof error !== 'object') {
        return typeof error === 'symbol' ? error.toString() : `${error as boolean | number | bigint}`;
    }

    const candidate = error as {
        name?: unknown;
        message?: unknown;
        errorCode?: unknown;
        errorMessage?: unknown;
        cause?: unknown;
    };

    const parts: string[] = [];
    for (const value of [candidate.name, candidate.message, candidate.errorCode, candidate.errorMessage]) {
        if (typeof value === 'string' && value.length > 0) {
            parts.push(value);
        }
    }

    if (candidate.cause !== undefined) {
        parts.push(collectErrorText(candidate.cause, depth + 1));
    }

    if (parts.length === 0) {
        // Nothing recognizable. An object with no message and no cause carries no information worth
        // showing, so it contributes nothing rather than "[object Object]".
        return '';
    }

    return parts.filter((part) => part.length > 0).join(' ');
}

function describeUnknownError(error: unknown): string {
    // Prefer the message on its own: the flattened form is built for matching, not for reading, and
    // it repeats the error name and the whole cause chain.
    if (typeof error === 'object' && error !== null) {
        const { message } = error as { message?: unknown };
        if (typeof message === 'string' && message.length > 0) {
            return message;
        }
    }

    const text = collectErrorText(error);
    return text.length > 0 ? text : l10n.t('no token was returned');
}
