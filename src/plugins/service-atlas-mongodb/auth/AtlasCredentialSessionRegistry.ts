/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-credential session ownership for MongoDB Atlas discovery.
 *
 * The legacy {@link AtlasSessionManager} holds exactly one session, which cannot express a fleet
 * of independent credentials. This registry keys every piece of session state by the credential's
 * stable record ID, so:
 *
 * - each credential restores independently after a reload (separate secret slots, no cross-write);
 * - a Service Account token refresh for credential A never touches credential B; and
 * - a credential whose secret was rejected can be marked failed without disturbing its peers.
 */

import {
    cacheServiceAccountToken,
    readAtlasCredentialSecrets,
    type AtlasCredentialSecrets,
} from '../credentials/atlasCredentialStore';
import { fetchServiceAccountToken } from './AtlasServiceAccountClient';
import { type AtlasSession } from './AtlasSession';

/**
 * Minimal contract the API client needs in order to recover from a rejected access token.
 * Implemented both by the legacy single-session manager and by {@link AtlasCredentialSession}.
 */
export interface AtlasSessionRefresher {
    tryRefreshIfPossible(): Promise<AtlasSession | undefined>;
}

/** Refresh a Service Account token this many milliseconds before it actually expires. */
const EXPIRY_SKEW_MS = 60_000;

function isExpired(expiresAtMs: string | undefined): boolean {
    if (!expiresAtMs) {
        return true;
    }
    const expiresAt = Number(expiresAtMs);
    if (!Number.isFinite(expiresAt)) {
        return true;
    }
    return Date.now() >= expiresAt - EXPIRY_SKEW_MS;
}

/**
 * A refresher bound to exactly one credential. Handed to {@link AtlasApiClient} so a 401/403 on
 * that credential triggers a re-mint for that credential only.
 */
class AtlasCredentialSession implements AtlasSessionRefresher {
    constructor(
        private readonly registry: AtlasCredentialSessionRegistry,
        private readonly credentialId: string,
    ) {}

    public tryRefreshIfPossible(): Promise<AtlasSession | undefined> {
        return this.registry.refreshSession(this.credentialId);
    }
}

/**
 * Owns one {@link AtlasSession} per credential ID.
 *
 * Sessions are derived lazily from the credential store and cached in memory. API Key credentials
 * need no refresh at all; Service Account credentials mint a token on demand and cache it back
 * into their own storage item so the token survives a reload.
 */
export class AtlasCredentialSessionRegistry {
    private readonly sessions = new Map<string, AtlasSession>();
    private readonly inflight = new Map<string, Promise<AtlasSession | undefined>>();

    /**
     * Returns a usable session for the credential, minting or refreshing a Service Account token
     * when required. Returns `undefined` when the credential has no usable secret material or the
     * token endpoint rejected it.
     */
    public async getSession(credentialId: string): Promise<AtlasSession | undefined> {
        const cached = this.sessions.get(credentialId);
        if (cached) {
            return cached;
        }

        const inflight = this.inflight.get(credentialId);
        if (inflight) {
            return inflight;
        }

        const work = this.resolveSession(credentialId).finally(() => {
            if (this.inflight.get(credentialId) === work) {
                this.inflight.delete(credentialId);
            }
        });
        this.inflight.set(credentialId, work);
        return work;
    }

    /**
     * Forces a fresh Service Account token for the credential. API Key credentials have nothing to
     * refresh, so their stored session is simply returned again.
     */
    public async refreshSession(credentialId: string): Promise<AtlasSession | undefined> {
        this.sessions.delete(credentialId);

        const secrets = await readAtlasCredentialSecrets(credentialId);
        if (!secrets) {
            return undefined;
        }

        if (secrets.authMethod === 'apikey') {
            // Digest auth carries no token, so there is nothing to refresh. Re-deriving the
            // session is still the right answer: it picks up a secret the user just replaced.
            return this.storeSession(credentialId, {
                type: 'apikey',
                publicKey: secrets.publicKey,
                privateKey: secrets.privateKey,
            });
        }

        return this.mintServiceAccountToken(credentialId, secrets);
    }

    /**
     * Drops the cached session for one credential, forcing the next request to re-derive it.
     * Used after the credential's secret is replaced or the credential is removed.
     */
    public invalidate(credentialId: string): void {
        this.sessions.delete(credentialId);
        this.inflight.delete(credentialId);
    }

    /** Drops every cached session. Used by "sign out of all". */
    public invalidateAll(): void {
        this.sessions.clear();
        this.inflight.clear();
    }

    /** Returns a refresher scoped to a single credential. */
    public refresherFor(credentialId: string): AtlasSessionRefresher {
        return new AtlasCredentialSession(this, credentialId);
    }

    private async resolveSession(credentialId: string): Promise<AtlasSession | undefined> {
        const secrets = await readAtlasCredentialSecrets(credentialId);
        if (!secrets) {
            return undefined;
        }

        if (secrets.authMethod === 'apikey') {
            return this.storeSession(credentialId, {
                type: 'apikey',
                publicKey: secrets.publicKey,
                privateKey: secrets.privateKey,
            });
        }

        if (secrets.accessToken && !isExpired(secrets.expiresAt)) {
            return this.storeSession(credentialId, { type: 'serviceaccount', accessToken: secrets.accessToken });
        }

        return this.mintServiceAccountToken(credentialId, secrets);
    }

    private async mintServiceAccountToken(
        credentialId: string,
        secrets: AtlasCredentialSecrets & { authMethod: 'serviceaccount' },
    ): Promise<AtlasSession | undefined> {
        try {
            const tokenResponse = await fetchServiceAccountToken(secrets.clientId, secrets.clientSecret);
            await cacheServiceAccountToken(
                credentialId,
                tokenResponse.access_token,
                Date.now() + tokenResponse.expires_in * 1000,
            );
            return this.storeSession(credentialId, {
                type: 'serviceaccount',
                accessToken: tokenResponse.access_token,
            });
        } catch {
            // The credential keeps its stored secret so the user can fix the Atlas-side problem
            // and retry from the credential-management flow without re-entering it.
            return undefined;
        }
    }

    private storeSession(credentialId: string, session: AtlasSession): AtlasSession {
        this.sessions.set(credentialId, session);
        return session;
    }
}
