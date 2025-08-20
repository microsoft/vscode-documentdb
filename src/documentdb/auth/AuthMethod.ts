/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Supported authentication methods.
 */
export const AuthMethod = {
    /** The regular, typical username+password and connection string authentication. */
    NativeAuth: 'NativeAuth',
    /** Microsoft Entra ID (Azure AD) authentication. */
    MicrosoftEntraID: 'MicrosoftEntraID',
} as const;

/**
 * TypeScript type derived from the const object.
 * This creates a union type of the literal values: 'NativeAuth' | 'MicrosoftEntraID'
 */
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

/**
 * @param method - The authentication method string to check
 * @returns True if the method is a known AuthMethod, false otherwise
 */
export function isSupportedAuthMethod(method: string): method is AuthMethod {
    return Object.values(AuthMethod).includes(method as AuthMethod);
}

/**
 * Converts a string to an AuthMethod enum value.
 * @param method The string to convert.
 * @returns The corresponding AuthMethod, or undefined if no match is found.
 */
export function authMethodFromString(method: string | undefined): AuthMethod | undefined {
    if (method && isSupportedAuthMethod(method)) {
        return method;
    }
    return undefined;
}

/**
 * Convert an array of authentication method identifiers (strings)
 * into an array of AuthMethod values.
 *
 * The order of returned AuthMethod values follows the order of valid entries
 * in the input array; no additional deduplication is performed.
 */
export function authMethodsFromString(methods?: string[]) {
    const availableAuthMethods: AuthMethod[] = Array.isArray(methods)
        ? methods.map((m) => authMethodFromString(m)).filter((m) => typeof m !== 'undefined')
        : [];
    return availableAuthMethods;
}
