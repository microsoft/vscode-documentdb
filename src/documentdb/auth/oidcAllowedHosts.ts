/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';

const DEFAULT_ALLOWED_HOSTS = ['*.azure.com'];

/**
 * Resolve the OIDC ALLOWED_HOSTS list from a MongoDB connection string.
 *
 * Previously both the auth handler and the playground worker hardcoded
 * `['*.azure.com']`, which blocked sovereign clouds (*.azure.cn, *.azure.us),
 * private endpoints, and custom domains. This helper extracts the actual
 * target hostname(s) so OIDC auth works against any valid endpoint.
 *
 * Multi-host connection strings (e.g. replica sets) are supported by
 * returning a glob per host (`*.hostname`).
 */
export function getOidcAllowedHosts(connectionString: string): string[] {
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        const hosts = parsed.hosts;
        if (hosts && hosts.length > 0) {
            return hosts.map((h) => `*.${h}`);
        }
    } catch {
        // Connection string couldn't be parsed — keep the safe default.
    }
    return DEFAULT_ALLOWED_HOSTS;
}
