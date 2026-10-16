/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deep links into the MongoDB Atlas web UI.
 *
 * These exist for the failures the extension can diagnose but cannot fix. A `403` from an enforced
 * IP access list, or a `200 []` caused by a too-narrow role, is only resolvable in Atlas itself,
 * and the settings page is several clicks deep behind an organization picker. Handing the user the
 * exact page turns "your credential needs attention" into something actionable.
 *
 * The URLs follow the shape the Atlas console uses today. They are best-effort navigation aids:
 * an outdated link lands the user on an Atlas page rather than breaking anything, so every builder
 * degrades to the least specific destination it can still be sure about.
 */

import { type AtlasAuthMethod } from './auth/AtlasSession';
import { type AtlasCredentialRecord } from './credentials/atlasCredentialStore';

/** Root of the MongoDB Atlas web console. */
const ATLAS_CLOUD_ROOT = 'https://cloud.mongodb.com';

/**
 * Builds the Atlas access-management URL from the raw identity pieces.
 *
 * {@link buildAtlasAccessUrl} is the preferred form when a stored {@link AtlasCredentialRecord} is
 * available. This lower-level variant exists for the add flow, where no record has been persisted
 * yet but the organization was just resolved live from the authenticated client.
 *
 * - Service Account with a known client ID: its detail page, which is where its roles and its own
 *   IP access list live.
 * - Service Account without a known client ID: the organization's Service Account list.
 * - API Key: the organization's API key list. Per-key deep links need an internal key ID that the
 *   Admin API does not hand back with the data used here, and the list is one click away.
 * - No organization ID: the Atlas console root, a useful landing page rather than a broken link.
 *
 * @param clientId Service Account client ID. Ignored for API keys.
 */
export function buildAtlasAccessUrlFor(authMethod: AtlasAuthMethod, orgId?: string, clientId?: string): string {
    if (!orgId) {
        return ATLAS_CLOUD_ROOT;
    }

    const access = `${ATLAS_CLOUD_ROOT}/v2#/org/${encodeURIComponent(orgId)}/access`;

    if (authMethod !== 'serviceaccount') {
        return `${access}/apiKeys`;
    }

    return clientId ? `${access}/serviceAccounts/${encodeURIComponent(clientId)}` : `${access}/serviceAccounts`;
}

/**
 * Builds the Atlas access-management URL for a stored credential.
 *
 * @param clientId Service Account client ID, read from secret storage. Ignored for API keys.
 */
export function buildAtlasAccessUrl(record: AtlasCredentialRecord, clientId?: string): string {
    return buildAtlasAccessUrlFor(record.authMethod, record.orgId, clientId);
}

/**
 * Builds the Atlas **Network Access** URL for a project, which is where the IP access list lives.
 *
 * MongoDB documents that Atlas allows client connections to a cluster only from addresses on this
 * list, so it is the first thing to check when a connection fails for no obvious reason. Note it
 * is a different list from the API access list attached to each credential.
 */
export function buildAtlasNetworkAccessUrl(projectId: string): string {
    return `${ATLAS_CLOUD_ROOT}/v2/${encodeURIComponent(projectId)}#/security/network/accessList`;
}

/** Builds the Atlas cluster overview URL for a discovered cluster. */
export function buildAtlasClusterUrl(projectId: string, clusterName: string): string {
    return `${ATLAS_CLOUD_ROOT}/v2/${encodeURIComponent(projectId)}#/clusters/detail/${encodeURIComponent(clusterName)}`;
}
