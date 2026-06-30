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
    type AtlasServiceAccountSession,
    type AtlasSession,
} from './AtlasSession';

const APIKEY_PUBLIC_KEY = `${SECRET_KEY_PREFIX}.apikey.publicKey`;
const APIKEY_PRIVATE_KEY = `${SECRET_KEY_PREFIX}.apikey.privateKey`;
const SA_CLIENT_ID_KEY = `${SECRET_KEY_PREFIX}.serviceaccount.clientId`;
const SA_CLIENT_SECRET_KEY = `${SECRET_KEY_PREFIX}.serviceaccount.clientSecret`;
const SA_ACCESS_TOKEN_KEY = `${SECRET_KEY_PREFIX}.serviceaccount.accessToken`;
const SA_EXPIRES_AT_KEY = `${SECRET_KEY_PREFIX}.serviceaccount.expiresAt`;

/**
 * Manages Atlas authentication sessions, including token storage,
 * refresh, and state transitions.
 *
 * Tokens are persisted in VS Code's SecretStorage (OS-level encryption).
 * Auth method preference is stored in globalState.
 */
export class AtlasSessionManager {
    private _state: AtlasSessionState = AtlasSessionState.None;
    private _stateBeforeAuthenticating: AtlasSessionState = AtlasSessionState.None;
    private _suppressAutoPrompt = false;
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
            // Verify Service Account token hasn't expired
            if (this._cachedSession.type === 'serviceaccount') {
                const expiresAt = await this.secretStorage.get(SA_EXPIRES_AT_KEY);
                if (expiresAt && this.isExpired(expiresAt)) {
                    this._state = AtlasSessionState.Expired;
                    return this.tryRefreshServiceAccount();
                }
            }
            return this._cachedSession;
        }

        return this.restoreSession();
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
     * Stores Service Account credentials and transitions to Active state.
     */
    public async storeServiceAccountCredentials(
        clientId: string,
        clientSecret: string,
        accessToken: string,
        expiresInSeconds: number,
    ): Promise<void> {
        const expiresAt = String(Date.now() + expiresInSeconds * 1000);

        await Promise.all([
            this.secretStorage.store(SA_CLIENT_ID_KEY, clientId),
            this.secretStorage.store(SA_CLIENT_SECRET_KEY, clientSecret),
            this.secretStorage.store(SA_ACCESS_TOKEN_KEY, accessToken),
            this.secretStorage.store(SA_EXPIRES_AT_KEY, expiresAt),
        ]);

        await this.globalState.update(STATE_AUTH_METHOD, 'serviceaccount' satisfies AtlasAuthMethod);

        this._cachedSession = { type: 'serviceaccount', accessToken };
        this.transitionTo(AtlasSessionState.Active);
    }

    /**
     * Clears all stored credentials and resets session state.
     */
    public async signOut(): Promise<void> {
        await Promise.all([
            this.secretStorage.delete(APIKEY_PUBLIC_KEY),
            this.secretStorage.delete(APIKEY_PRIVATE_KEY),
            this.secretStorage.delete(SA_CLIENT_ID_KEY),
            this.secretStorage.delete(SA_CLIENT_SECRET_KEY),
            this.secretStorage.delete(SA_ACCESS_TOKEN_KEY),
            this.secretStorage.delete(SA_EXPIRES_AT_KEY),
        ]);

        await this.globalState.update(STATE_AUTH_METHOD, undefined);
        await this.globalState.update(STATE_USER_DISPLAY_NAME, undefined);

        this._cachedSession = undefined;
        this.transitionTo(AtlasSessionState.None);
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
     * Attempts to refresh the session if it uses token-based auth (Service Account).
     * Used as a recovery mechanism when API calls fail with 401/403.
     * Returns the refreshed session or undefined if refresh is not possible.
     */
    public async tryRefreshIfPossible(): Promise<AtlasSession | undefined> {
        const authMethod = this.getAuthMethod();
        if (authMethod === 'serviceaccount') {
            return this.tryRefreshServiceAccount();
        }
        return undefined;
    }

    /**
     * Transitions to Authenticating state (for UI feedback).
     * Remembers the state that was active before sign-in started so it can be restored
     * if the user cancels (see {@link cancelAuthentication}).
     */
    public setAuthenticating(): void {
        if (this._state !== AtlasSessionState.Authenticating) {
            this._stateBeforeAuthenticating = this._state;
        }
        this.transitionTo(AtlasSessionState.Authenticating);
    }

    /**
     * Reverts an in-progress authentication, restoring the state that was active before
     * {@link setAuthenticating} was called. Used when the user cancels (or the flow fails)
     * so the UI does not stay stuck on “Authenticating…”.
     */
    public cancelAuthentication(): void {
        if (this._state === AtlasSessionState.Authenticating) {
            // Reverting fires a session-change event, which refreshes the discovery tree.
            // Suppress the next auto-prompt so that refresh shows the sign-in node instead of
            // immediately re-opening the authentication prompt (which would loop on cancel).
            this._suppressAutoPrompt = true;
            this.transitionTo(this._stateBeforeAuthenticating);
        }
    }

    /**
     * Returns whether the next discovery-tree auto-prompt should be suppressed (consuming the
     * flag). Set right after a cancelled sign-in so the cancel-triggered refresh does not
     * immediately re-open the authentication prompt.
     */
    public consumeSuppressAutoPrompt(): boolean {
        if (this._suppressAutoPrompt) {
            this._suppressAutoPrompt = false;
            return true;
        }
        return false;
    }

    /**
     * Attempts to restore a session from stored credentials.
     */
    private async restoreSession(): Promise<AtlasSession | undefined> {
        const authMethod = this.getAuthMethod();

        if (authMethod === 'apikey') {
            return this.restoreApiKeySession();
        } else if (authMethod === 'serviceaccount') {
            return this.restoreServiceAccountSession();
        }

        this.transitionTo(AtlasSessionState.None);
        return undefined;
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

    private async restoreServiceAccountSession(): Promise<AtlasServiceAccountSession | undefined> {
        const accessToken = await this.secretStorage.get(SA_ACCESS_TOKEN_KEY);
        const expiresAt = await this.secretStorage.get(SA_EXPIRES_AT_KEY);

        if (!accessToken || (expiresAt && this.isExpired(expiresAt))) {
            // Token missing or expired — attempt silent refresh using stored credentials
            this._state = AtlasSessionState.Expired;
            return this.tryRefreshServiceAccount();
        }

        this._cachedSession = { type: 'serviceaccount', accessToken };
        this.transitionTo(AtlasSessionState.Active);
        return this._cachedSession;
    }

    /**
     * Refreshes the Service Account access token using stored client credentials.
     * Service Accounts use client_credentials grant, so we can always fetch a new token
     * as long as client_id and client_secret are stored.
     */
    private async tryRefreshServiceAccount(): Promise<AtlasServiceAccountSession | undefined> {
        const clientId = await this.secretStorage.get(SA_CLIENT_ID_KEY);
        const clientSecret = await this.secretStorage.get(SA_CLIENT_SECRET_KEY);

        if (!clientId || !clientSecret) {
            await this.signOut();
            return undefined;
        }

        try {
            const { fetchServiceAccountToken } = await import('./AtlasServiceAccountClient');
            const tokenResponse = await fetchServiceAccountToken(clientId, clientSecret);

            await this.storeServiceAccountCredentials(
                clientId,
                clientSecret,
                tokenResponse.access_token,
                tokenResponse.expires_in,
            );

            return this._cachedSession as AtlasServiceAccountSession;
        } catch (error) {
            // If credentials are rejected, sign out
            if (error instanceof Error && error.message.includes('invalid_client')) {
                await this.signOut();
            } else {
                this.transitionTo(AtlasSessionState.Expired);
            }
            return undefined;
        }
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
