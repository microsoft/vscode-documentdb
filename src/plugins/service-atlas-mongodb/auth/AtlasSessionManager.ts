/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    SECRET_KEY_PREFIX,
    STATE_AUTH_METHOD,
    STATE_SELECTED_ORG_ID,
    STATE_SELECTED_PROJECTS,
    STATE_USER_DISPLAY_NAME,
} from '../config';
import {
    AtlasSessionState,
    type AtlasApiKeySession,
    type AtlasAuthMethod,
    type AtlasOAuthSession,
    type AtlasSession,
} from './AtlasSession';

const OAUTH_ACCESS_TOKEN_KEY = `${SECRET_KEY_PREFIX}.oauth.accessToken`;
const OAUTH_REFRESH_TOKEN_KEY = `${SECRET_KEY_PREFIX}.oauth.refreshToken`;
const OAUTH_EXPIRES_AT_KEY = `${SECRET_KEY_PREFIX}.oauth.expiresAt`;
const APIKEY_PUBLIC_KEY = `${SECRET_KEY_PREFIX}.apikey.publicKey`;
const APIKEY_PRIVATE_KEY = `${SECRET_KEY_PREFIX}.apikey.privateKey`;

/**
 * Manages Atlas authentication sessions, including token storage,
 * refresh, and state transitions.
 *
 * Tokens are persisted in VS Code's SecretStorage (OS-level encryption).
 * Auth method preference is stored in globalState.
 */
export class AtlasSessionManager {
    private _state: AtlasSessionState = AtlasSessionState.None;
    private _cachedSession: AtlasSession | undefined;

    private readonly _onDidChangeSession = new vscode.EventEmitter<AtlasSessionState>();
    public readonly onDidChangeSession = this._onDidChangeSession.event;

    constructor(
        private readonly secretStorage: vscode.SecretStorage,
        private readonly globalState: vscode.Memento,
    ) {}

    public get state(): AtlasSessionState {
        return this._state;
    }

    /**
     * Attempts to retrieve or restore a valid session.
     * Returns undefined if no session can be established (user must authenticate).
     */
    public async getSession(): Promise<AtlasSession | undefined> {
        if (this._cachedSession && this._state === AtlasSessionState.Active) {
            // Verify OAuth token hasn't expired
            if (this._cachedSession.type === 'oauth') {
                const expiresAt = await this.secretStorage.get(OAUTH_EXPIRES_AT_KEY);
                if (expiresAt && this.isExpired(expiresAt)) {
                    this._state = AtlasSessionState.Expired;
                    return this.tryRefreshOAuth();
                }
            }
            return this._cachedSession;
        }

        return this.restoreSession();
    }

    /**
     * Stores OAuth tokens and transitions to Active state.
     */
    public async storeOAuthTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): Promise<void> {
        const expiresAt = String(Date.now() + expiresInSeconds * 1000);

        await Promise.all([
            this.secretStorage.store(OAUTH_ACCESS_TOKEN_KEY, accessToken),
            this.secretStorage.store(OAUTH_REFRESH_TOKEN_KEY, refreshToken),
            this.secretStorage.store(OAUTH_EXPIRES_AT_KEY, expiresAt),
        ]);

        await this.globalState.update(STATE_AUTH_METHOD, 'oauth' satisfies AtlasAuthMethod);

        this._cachedSession = { type: 'oauth', accessToken };
        this.transitionTo(AtlasSessionState.Active);
    }

    /**
     * Stores API Key credentials and transitions to Active state.
     */
    public async storeApiKeyCredentials(publicKey: string, privateKey: string): Promise<void> {
        await Promise.all([
            this.secretStorage.store(APIKEY_PUBLIC_KEY, publicKey),
            this.secretStorage.store(APIKEY_PRIVATE_KEY, privateKey),
        ]);

        await this.globalState.update(STATE_AUTH_METHOD, 'apikey' satisfies AtlasAuthMethod);

        this._cachedSession = { type: 'apikey', publicKey, privateKey };
        this.transitionTo(AtlasSessionState.Active);
    }

    /**
     * Clears all stored credentials and resets session state.
     */
    public async signOut(): Promise<void> {
        await Promise.all([
            this.secretStorage.delete(OAUTH_ACCESS_TOKEN_KEY),
            this.secretStorage.delete(OAUTH_REFRESH_TOKEN_KEY),
            this.secretStorage.delete(OAUTH_EXPIRES_AT_KEY),
            this.secretStorage.delete(APIKEY_PUBLIC_KEY),
            this.secretStorage.delete(APIKEY_PRIVATE_KEY),
        ]);

        await this.globalState.update(STATE_AUTH_METHOD, undefined);
        await this.globalState.update(STATE_USER_DISPLAY_NAME, undefined);

        this._cachedSession = undefined;
        this.transitionTo(AtlasSessionState.None);
    }

    /**
     * Returns the stored refresh token for OAuth, if available.
     */
    public async getRefreshToken(): Promise<string | undefined> {
        return this.secretStorage.get(OAUTH_REFRESH_TOKEN_KEY);
    }

    /**
     * Updates the OAuth tokens after a successful refresh.
     */
    public async updateOAuthTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): Promise<void> {
        await this.storeOAuthTokens(accessToken, refreshToken, expiresInSeconds);
    }

    /**
     * Gets the currently stored auth method preference.
     */
    public getAuthMethod(): AtlasAuthMethod | undefined {
        return this.globalState.get<AtlasAuthMethod>(STATE_AUTH_METHOD);
    }

    /**
     * Stores the user display name (email or API key identifier) for UI display.
     */
    public async setUserDisplayName(displayName: string): Promise<void> {
        await this.globalState.update(STATE_USER_DISPLAY_NAME, displayName);
    }

    /**
     * Gets the stored user display name.
     */
    public getUserDisplayName(): string | undefined {
        return this.globalState.get<string>(STATE_USER_DISPLAY_NAME);
    }

    /**
     * Gets the set of project IDs selected for filtering (undefined = show all).
     */
    public getSelectedProjectIds(): string[] | undefined {
        return this.globalState.get<string[]>(STATE_SELECTED_PROJECTS);
    }

    /**
     * Stores the set of project IDs to display (undefined = show all).
     */
    public async setSelectedProjectIds(projectIds: string[] | undefined): Promise<void> {
        await this.globalState.update(STATE_SELECTED_PROJECTS, projectIds);
    }

    /**
     * Gets the selected organization ID for filtering (undefined = show all orgs).
     */
    public getSelectedOrgId(): string | undefined {
        return this.globalState.get<string>(STATE_SELECTED_ORG_ID);
    }

    /**
     * Stores the selected organization ID (undefined = show all orgs).
     */
    public async setSelectedOrgId(orgId: string | undefined): Promise<void> {
        await this.globalState.update(STATE_SELECTED_ORG_ID, orgId);
    }

    /**
     * Attempts to refresh the session if it's an OAuth session.
     * Used as a recovery mechanism when API calls fail with 401/403.
     * Returns the refreshed session or undefined if refresh is not possible.
     */
    public async tryRefreshIfOAuth(): Promise<AtlasSession | undefined> {
        const authMethod = this.getAuthMethod();
        if (authMethod !== 'oauth') {
            return undefined;
        }
        return this.tryRefreshOAuth();
    }

    /**
     * Transitions to Authenticating state (for UI feedback).
     */
    public setAuthenticating(): void {
        this.transitionTo(AtlasSessionState.Authenticating);
    }

    /**
     * Attempts to restore a session from stored credentials.
     */
    private async restoreSession(): Promise<AtlasSession | undefined> {
        const authMethod = this.getAuthMethod();

        if (authMethod === 'oauth') {
            return this.restoreOAuthSession();
        } else if (authMethod === 'apikey') {
            return this.restoreApiKeySession();
        }

        this.transitionTo(AtlasSessionState.None);
        return undefined;
    }

    private async restoreOAuthSession(): Promise<AtlasOAuthSession | undefined> {
        const accessToken = await this.secretStorage.get(OAUTH_ACCESS_TOKEN_KEY);
        const expiresAt = await this.secretStorage.get(OAUTH_EXPIRES_AT_KEY);

        if (!accessToken) {
            this.transitionTo(AtlasSessionState.None);
            return undefined;
        }

        if (expiresAt && this.isExpired(expiresAt)) {
            this._state = AtlasSessionState.Expired;
            return this.tryRefreshOAuth();
        }

        this._cachedSession = { type: 'oauth', accessToken };
        this.transitionTo(AtlasSessionState.Active);
        return this._cachedSession;
    }

    private async restoreApiKeySession(): Promise<AtlasApiKeySession | undefined> {
        const publicKey = await this.secretStorage.get(APIKEY_PUBLIC_KEY);
        const privateKey = await this.secretStorage.get(APIKEY_PRIVATE_KEY);

        if (!publicKey || !privateKey) {
            this.transitionTo(AtlasSessionState.None);
            return undefined;
        }

        this._cachedSession = { type: 'apikey', publicKey, privateKey };
        this.transitionTo(AtlasSessionState.Active);
        return this._cachedSession;
    }

    /**
     * Attempts to refresh the OAuth token using the stored refresh token.
     * Returns undefined if refresh fails (caller should re-prompt authentication).
     *
     * Only signs out when the refresh token is definitively invalid (rejected by server).
     * Transient errors (network issues, server errors) preserve credentials so the user
     * can retry without re-authenticating.
     */
    private async tryRefreshOAuth(): Promise<AtlasOAuthSession | undefined> {
        const refreshToken = await this.secretStorage.get(OAUTH_REFRESH_TOKEN_KEY);

        if (!refreshToken) {
            await this.signOut();
            return undefined;
        }

        try {
            // Dynamically import to avoid circular dependencies
            const { refreshOAuthToken } = await import('./AtlasOAuthClient');
            const tokenResponse = await refreshOAuthToken(refreshToken);

            await this.storeOAuthTokens(
                tokenResponse.access_token,
                tokenResponse.refresh_token,
                tokenResponse.expires_in,
            );

            return this._cachedSession as AtlasOAuthSession;
        } catch (error) {
            // Only sign out if the refresh token is definitively rejected by the server.
            if (this.isRefreshTokenRejected(error)) {
                await this.signOut();
            } else {
                // Keep session in Expired state — user can retry or re-authenticate manually
                this.transitionTo(AtlasSessionState.Expired);
            }
            return undefined;
        }
    }

    private isRefreshTokenRejected(error: unknown): boolean {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            // Server explicitly rejected the refresh token (HTTP 400/401 from token endpoint)
            return message.includes('invalid_grant') ||
                message.includes('invalid_token') ||
                message.includes('token has been revoked') ||
                (message.includes('refresh token') && message.includes('expired'));
        }
        return false;
    }

    private isExpired(expiresAtMs: string): boolean {
        const expiresAt = Number(expiresAtMs);
        // Consider expired 60 seconds before actual expiry to avoid race conditions
        return Date.now() >= expiresAt - 60_000;
    }

    private transitionTo(newState: AtlasSessionState): void {
        if (this._state !== newState) {
            this._state = newState;
            this._onDidChangeSession.fire(newState);
        }
    }
}
