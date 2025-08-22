/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getIconURI } from '../../constants';

/**
 * Authentication method identifiers
 */
export enum AuthMethodId {
    /** The regular, typical username+password and connection string authentication. */
    NativeAuth = 'NativeAuth',
    /** Microsoft Entra ID (Azure AD) authentication. */
    MicrosoftEntraID = 'MicrosoftEntraID',
}

/**
 * Authentication method metadata
 */
export interface AuthMethodInfo {
    /** The internal identifier for the authentication method */
    readonly id: AuthMethodId;
    /** Localized label for display in UI */
    readonly label: string;
    /** Localized detailed description for display in UI */
    readonly detail: string;
    /** Optional icon identifier for the authentication method */
    readonly iconName?: string;
}

// Individual auth method definitions
export const NativeAuthMethod: AuthMethodInfo = {
    id: AuthMethodId.NativeAuth,
    label: vscode.l10n.t('Username and Password'),
    detail: vscode.l10n.t('Authenticate using a username and password'),
} as const;

export const MicrosoftEntraIDAuthMethod: AuthMethodInfo = {
    id: AuthMethodId.MicrosoftEntraID,
    label: vscode.l10n.t('Entra ID for Azure Cosmos DB for MongoDB (vCore)'),
    detail: vscode.l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
    // iconName: 'Microsoft-Entra-ID-BW-icon.svg',
} as const;

// Arrays for different contexts
const authMethodsArray: AuthMethodInfo[] = [NativeAuthMethod, MicrosoftEntraIDAuthMethod];

// Map for efficient lookup
const authMethodsMap = new Map<AuthMethodId, AuthMethodInfo>(
    authMethodsArray.map((method): [AuthMethodId, AuthMethodInfo] => [method.id, method]),
);

// Utility functions
export function getAllAuthMethods(): AuthMethodInfo[] {
    return [...authMethodsArray]; // Return copy to prevent mutation
}

export function getAuthMethod(id: AuthMethodId): AuthMethodInfo {
    const method = authMethodsMap.get(id);
    if (!method) {
        throw new Error(`Unknown authentication method: ${id}`);
    }
    return method;
}

/**
 * @param method - The authentication method string to check
 * @returns True if the method is a known AuthMethodId, false otherwise
 */
export function isSupportedAuthMethod(method?: string): method is AuthMethodId {
    return Object.values(AuthMethodId).includes(method as AuthMethodId);
}

/**
 * Converts a string to an AuthMethodId enum value.
 * @param method The string to convert.
 * @returns The corresponding AuthMethodId, or undefined if no match is found.
 */
export function authMethodFromString(method: string | undefined): AuthMethodId | undefined {
    if (method && isSupportedAuthMethod(method)) {
        return method;
    }
    return undefined;
}

/**
 * Convert an array of authentication method identifiers (strings)
 * into an array of AuthMethodId values.
 *
 * The order of returned AuthMethodId values follows the order of valid entries
 * in the input array; no additional deduplication is performed.
 */
export function authMethodsFromString(methods?: string[]): AuthMethodId[] {
    const availableAuthMethods: AuthMethodId[] = Array.isArray(methods)
        ? methods.map((m) => authMethodFromString(m)).filter((m) => typeof m !== 'undefined')
        : [];
    return availableAuthMethods;
}

/**
 * Create quick pick items from available authentication methods
 */
export function createAuthMethodQuickPickItems(
    availableMethods?: AuthMethodId[],
    options: { showSupportInfo?: boolean; filterUnsupported?: boolean } = {},
): Array<vscode.QuickPickItem & { authMethod?: AuthMethodId }> {
    const { showSupportInfo = false, filterUnsupported = false } = options;

    let methodsToShow: AuthMethodInfo[];

    if (filterUnsupported && availableMethods) {
        // Discovery scenario: Only show methods that are known to be supported
        methodsToShow = authMethodsArray.filter((method) => availableMethods.includes(method.id));
    } else {
        // Manual/editing scenario: Show all methods, use support info to indicate availability
        methodsToShow = authMethodsArray;
    }

    return methodsToShow.map((method) => ({
        label: method.label,
        detail: method.detail,
        authMethod: method.id,
        iconPath: method.iconName ? getIconURI(method.iconName) : undefined,
        alwaysShow: true,
        description:
            showSupportInfo && availableMethods && !availableMethods.includes(method.id)
                ? vscode.l10n.t('Cluster support unknown $(info)')
                : undefined,
    }));
}

/**
 * Convenience function for service discovery scenarios - only shows supported methods
 */
export function createFilteredAuthMethodQuickPickItems(availableMethods: AuthMethodId[]) {
    return createAuthMethodQuickPickItems(availableMethods, { filterUnsupported: true });
}

/**
 * Convenience function for manual connection scenarios - shows all methods with support info
 */
export function createAuthMethodQuickPickItemsWithSupportInfo(availableMethods?: AuthMethodId[]) {
    return createAuthMethodQuickPickItems(availableMethods, { showSupportInfo: true });
}
