/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EntraIdAuthConfig, type ManagedIdentityAuthConfig, type NativeAuthConfig } from './AuthConfig';
import { AuthMethodId } from './AuthMethod';

/** The authentication-related parts of a connection, as stored or as assembled by a wizard. */
export interface ConnectionAuthIdentityInput {
    /** Untyped, because stored properties are an open record and the method is kept open-ended there. */
    readonly authMethod?: unknown;
    readonly nativeAuthConfig?: NativeAuthConfig;
    readonly entraIdAuthConfig?: EntraIdAuthConfig;
    readonly managedIdentityAuthConfig?: ManagedIdentityAuthConfig;
}

/**
 * Reduces a connection's authentication choice to a comparable key.
 *
 * Duplicate detection used to compare the native username alone, which made every managed identity
 * on one host look identical (they all have no native username) and blocked a legitimate
 * multi-identity workflow. "Who this connection authenticates as" is method-specific, so each
 * method contributes its own discriminator.
 */
export function getConnectionAuthIdentity(input: ConnectionAuthIdentityInput): string {
    const authMethod = typeof input.authMethod === 'string' ? input.authMethod : undefined;

    switch (authMethod ?? inferAuthMethod(input)) {
        case AuthMethodId.NativeAuth:
            return `native:${input.nativeAuthConfig?.connectionUser ?? ''}`;
        case AuthMethodId.MicrosoftEntraID:
            // The signed-in user is not known until a token is acquired; the tenant is the only
            // durable part of the choice, and an unspecified tenant is itself a distinct choice.
            return `entraId:${input.entraIdAuthConfig?.tenantId ?? ''}`;
        case AuthMethodId.ManagedIdentity:
            // An absent client ID is meaningful: it selects the system-assigned identity.
            return `managedIdentity:${input.managedIdentityAuthConfig?.clientId ?? 'system-assigned'}`;
        default:
            return 'none';
    }
}

/**
 * Connections stored before the authentication method was persisted carry only their secrets.
 * Reading the method back from those secrets keeps such entries comparable.
 */
function inferAuthMethod(input: ConnectionAuthIdentityInput): AuthMethodId | undefined {
    if (input.nativeAuthConfig?.connectionUser) {
        return AuthMethodId.NativeAuth;
    }

    if (input.managedIdentityAuthConfig) {
        return AuthMethodId.ManagedIdentity;
    }

    if (input.entraIdAuthConfig) {
        return AuthMethodId.MicrosoftEntraID;
    }

    return undefined;
}
