/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Error translation for MongoDB Atlas clusters.
 *
 * TRANSLATION ONLY. This provider must never show UI, change an Atlas project, or retry the failed
 * operation; it returns text so a transport-level rejection is not mistaken for bad credentials.
 * See `src/services/connectionDiagnosticsService.ts` and
 * `.github/skills/error-translation/SKILL.md`.
 */

import { CredentialCache } from '../../documentdb/CredentialCache';
import { getHostsFromConnectionString, hasDomainSuffix } from '../../documentdb/utils/connectionStringHelpers';
import {
    type ConnectionDiagnosticsProvider,
    type ConnectionDiagnosticsRequest,
} from '../../services/connectionDiagnosticsService';
import { isAtlasTlsHandshakeRejection, summarizeAtlasTlsHandshakeRejection } from './atlasConnectionErrors';

/** Atlas clusters are addressed under this suffix, which makes them identifiable without any registration. */
const ATLAS_HOST_SUFFIX = 'mongodb.net';

export class AtlasDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'atlas';

    public async explain({ clusterId, error }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        // Cheapest check first: the vast majority of failures are not TLS handshake rejections.
        if (!isAtlasTlsHandshakeRejection(error)) {
            return undefined;
        }

        const connectionString = CredentialCache.getCredentials(clusterId)?.connectionString;
        if (!connectionString) {
            return undefined;
        }

        if (!hasDomainSuffix(ATLAS_HOST_SUFFIX, ...getHostsFromConnectionString(connectionString))) {
            return undefined;
        }

        return summarizeAtlasTlsHandshakeRejection();
    }
}
