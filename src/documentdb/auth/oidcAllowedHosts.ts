/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolve the OIDC ALLOWED_HOSTS list from a MongoDB connection string.
 *
 * Previously both the auth handler and the playground worker hardcoded
 * `['*.azure.com']`, which blocked sovereign clouds (*.azure.cn, *.azure.us),
 * private endpoints, and custom domains. This helper extracts the actual
 * target hostname so OIDC auth works against any valid endpoint.
 */
export function getOidcAllowedHosts(connectionString: string): string[] {
    try {
        const url = new URL(connectionString);
        const hostname = url.hostname;
        if (hostname) {
            return [hostname];
        }
    } catch {
        // Connection string couldn't be parsed — keep the safe default.
    }
    return ['*.azure.com'];
}
