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
