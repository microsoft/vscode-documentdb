/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Authentication methods supported by DocumentDB connections
 */
export enum AuthMethod {
    /**
     * Use native MongoDB authentication (username/password)
     */
    NativeAuth = 'NativeAuth',

    /**
     * Use Microsoft Entra ID (formerly Azure AD) authentication via OIDC
     */
    MicrosoftEntraID = 'MicrosoftEntraID',
}

/**
 * Checks if a given string is a supported authentication method.
 */
export function isSupportedAuthMethod(method: string): method is AuthMethod {
    return Object.values(AuthMethod).includes(method as AuthMethod);
}
