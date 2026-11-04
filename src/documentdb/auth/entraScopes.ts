/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The Azure clouds whose DocumentDB token resource is known without any lookup. */
export type DocumentDBEntraCloud = 'AzureCloud' | 'AzureUSGovernment' | 'AzureChinaCloud';

/**
 * The Microsoft Entra ID resource that DocumentDB (and the wider Azure OSS RDBMS family) accepts
 * tokens for, per cloud.
 *
 * Closed on purpose. The values are the `ossrDbmsResourceId` each cloud publishes in its Azure
 * Resource Manager metadata (`/metadata/endpoints?api-version=2022-09-01`), and match Azure CLI's
 * `ossrdbms_resource_id` table. Never derive a token resource from a hostname.
 */
const TOKEN_RESOURCE_BY_CLOUD: Readonly<Record<DocumentDBEntraCloud, string>> = {
    AzureCloud: 'https://ossrdbms-aad.database.windows.net',
    AzureUSGovernment: 'https://ossrdbms-aad.database.usgovcloudapi.net',
    AzureChinaCloud: 'https://ossrdbms-aad.database.chinacloudapi.cn',
};

/**
 * The public-cloud token resource.
 *
 * This is the `TOKEN_RESOURCE` value used in the driver-native connection string form documented on
 * Microsoft Learn, and the base of the public-cloud `.default` scope.
 */
export const DOCUMENTDB_TOKEN_RESOURCE = TOKEN_RESOURCE_BY_CLOUD.AzureCloud;

/** The scope form of {@link DOCUMENTDB_TOKEN_RESOURCE}, as passed to token providers. */
export const DOCUMENTDB_ENTRA_SCOPE = `${DOCUMENTDB_TOKEN_RESOURCE}/.default`;

export function getTokenResourceForCloud(cloud: DocumentDBEntraCloud): string {
    return TOKEN_RESOURCE_BY_CLOUD[cloud];
}

/** Turns a token resource into the `.default` scope token providers expect. */
export function toEntraScope(tokenResource: string): string {
    return `${tokenResource.replace(/\/$/, '')}/.default`;
}

/**
 * Validates a token resource that came from a setting, a connection string, or cloud metadata.
 *
 * Accepts only `https://<host>` with an optional trailing slash, and returns it without the slash.
 * Anything else (another scheme, a path, a query, credentials) returns `undefined`.
 */
export function parseTokenResource(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim();
    const authority = /^https:\/\/([^/?#:@\\]+)\/?$/i.exec(normalized)?.[1];
    if (!authority) {
        return undefined;
    }

    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        return undefined;
    }

    if (
        url.protocol !== 'https:' ||
        !url.hostname ||
        url.hostname !== authority.toLowerCase() ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        (url.pathname !== '/' && url.pathname !== '')
    ) {
        return undefined;
    }

    return `https://${url.hostname.toLowerCase()}`;
}

/** Returns the built-in cloud a token resource belongs to, or `undefined` if it is not a known one. */
export function getCloudForTokenResource(value: string): DocumentDBEntraCloud | undefined {
    const normalized = parseTokenResource(value);
    if (!normalized) {
        return undefined;
    }

    return (Object.keys(TOKEN_RESOURCE_BY_CLOUD) as DocumentDBEntraCloud[]).find(
        (cloud) => TOKEN_RESOURCE_BY_CLOUD[cloud] === normalized,
    );
}
