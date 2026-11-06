/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { valid } from 'semver';

export interface ClusterVersions {
    readonly engine: string | undefined;
    readonly api: string | undefined;
    readonly server: string | undefined;
}

/**
 * Preserve all reported component versions in server order rather than guessing which one
 * represents the engine release. Malformed entries make the version information unusable.
 */
export function parseDocumentDbEngineVersion(raw: string | undefined): string | undefined {
    const versions =
        raw
            ?.split(';')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '') ?? [];
    const extensionVersion = /^\d+\.\d+-\d+$/;
    if (
        versions.length === 0 ||
        versions.some((version) => valid(version) === null && !extensionVersion.test(version))
    ) {
        return undefined;
    }
    return versions.join(' · ');
}

export function getClusterVersions(metadata: Record<string, string | undefined>): ClusterVersions {
    const rawEngine = metadata['topology_hello_internal_documentdb_versions'];
    const rawServer = metadata['serverInfo_version']?.trim();
    const server = rawServer !== undefined && valid(rawServer) !== null ? rawServer : undefined;
    // Only a server reporting DocumentDB-specific metadata establishes the API/engine distinction.
    const isDocumentDb = rawEngine !== undefined;
    return {
        engine: parseDocumentDbEngineVersion(rawEngine),
        api: isDocumentDb ? server : undefined,
        server: isDocumentDb ? undefined : server,
    };
}
