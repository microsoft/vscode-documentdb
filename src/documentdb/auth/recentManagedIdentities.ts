/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';

/**
 * Client IDs the user has already connected with, so the identity quick pick has something useful
 * to offer on the second and every subsequent connection.
 *
 * A client ID is a tenant-scoped identifier, not a credential, so this lives in `globalState` rather
 * than `SecretStorage`. Nothing here is required for a connection to work; it is purely a
 * convenience list, and losing it is harmless.
 */
const RECENT_MANAGED_IDENTITIES_KEY = 'managedIdentity.recentClientIds';

/** Keeps the quick pick short and the stored blob bounded. */
const MAX_RECENT_ENTRIES = 5;

export interface RecentManagedIdentity {
    readonly clientId: string;
    /** Name of the connection this identity was last used with, for display only. */
    readonly connectionLabel?: string;
}

export function getRecentManagedIdentities(): RecentManagedIdentity[] {
    const stored = ext.context.globalState.get<unknown>(RECENT_MANAGED_IDENTITIES_KEY);
    if (!Array.isArray(stored)) {
        return [];
    }

    return stored.filter(isRecentManagedIdentity).slice(0, MAX_RECENT_ENTRIES);
}

/**
 * Records a client ID as most recently used. System-assigned identities have no client ID and are
 * always offered anyway, so they are not recorded.
 */
export async function rememberManagedIdentity(clientId: string | undefined, connectionLabel?: string): Promise<void> {
    if (!clientId) {
        return;
    }

    const deduplicated = getRecentManagedIdentities().filter(
        (entry) => entry.clientId.toLowerCase() !== clientId.toLowerCase(),
    );
    const updated = [{ clientId, connectionLabel }, ...deduplicated].slice(0, MAX_RECENT_ENTRIES);

    await ext.context.globalState.update(RECENT_MANAGED_IDENTITIES_KEY, updated);
}

function isRecentManagedIdentity(value: unknown): value is RecentManagedIdentity {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as { clientId?: unknown; connectionLabel?: unknown };
    return (
        typeof candidate.clientId === 'string' &&
        candidate.clientId.length > 0 &&
        (candidate.connectionLabel === undefined || typeof candidate.connectionLabel === 'string')
    );
}
