/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ATLAS_OAUTH_DEVICE_AUTHORIZE_URL, ATLAS_OAUTH_TOKEN_URL } from '../config';

/**
 * OAuth token response from Atlas.
 */
export interface AtlasOAuthTokenResponse {
    readonly access_token: string;
    readonly refresh_token: string;
    readonly expires_in: number;
    readonly token_type: string;
}

/**
 * Device authorization response from Atlas.
 */
export interface AtlasDeviceAuthResponse {
    readonly device_code: string;
    readonly user_code: string;
    readonly verification_uri: string;
    readonly expires_in: number;
    readonly interval: number;
}

// Client ID for the Atlas CLI device authorization flow
// Atlas uses a well-known public client ID for device flows
const ATLAS_OAUTH_CLIENT_ID = '0oabtxactgS3gHIR0297';

/**
 * Initiates the OAuth 2.0 device authorization flow with Atlas.
 * Returns the device code and user code for the user to enter in the browser.
 */
export async function requestDeviceAuthorization(
    cancellationToken?: vscode.CancellationToken,
): Promise<AtlasDeviceAuthResponse> {
    const body = new URLSearchParams({
        client_id: ATLAS_OAUTH_CLIENT_ID,
        scope: 'openid profile offline_access',
    });

    const abortController = new AbortController();
    const disposable = cancellationToken?.onCancellationRequested(() => abortController.abort());

    let response: Response;
    try {
        response = await fetch(ATLAS_OAUTH_DEVICE_AUTHORIZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: abortController.signal,
        });
    } finally {
        disposable?.dispose();
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            vscode.l10n.t('Failed to initiate Atlas authentication: {0}', `${response.status} ${errorText}`),
        );
    }

    return (await response.json()) as AtlasDeviceAuthResponse;
}

/**
 * Polls the Atlas token endpoint for a successful device code exchange.
 * Implements the device code polling loop with the interval specified by the authorization response.
 */
export async function pollForDeviceToken(
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
    cancellationToken?: vscode.CancellationToken,
): Promise<AtlasOAuthTokenResponse> {
    const startTime = Date.now();
    const expiresAt = startTime + expiresInSeconds * 1000;
    const pollInterval = Math.max(intervalSeconds, 5) * 1000; // At least 5 seconds

    while (Date.now() < expiresAt) {
        if (cancellationToken?.isCancellationRequested) {
            throw new Error(vscode.l10n.t('Authentication was cancelled'));
        }

        // Wait for the poll interval
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, pollInterval);
            if (cancellationToken) {
                const disposable = cancellationToken.onCancellationRequested(() => {
                    clearTimeout(timeout);
                    disposable.dispose();
                    reject(new Error(vscode.l10n.t('Authentication was cancelled')));
                });
            }
        });

        const body = new URLSearchParams({
            client_id: ATLAS_OAUTH_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            scope: 'openid profile offline_access',
        });

        const response = await fetch(ATLAS_OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (response.ok) {
            return (await response.json()) as AtlasOAuthTokenResponse;
        }

        // Atlas returns errors in its own format: { errorCode: "DEVICE_AUTHORIZATION_PENDING" }
        // Also handle standard OAuth2 format: { error: "authorization_pending" }
        const errorBody = (await response.json()) as { error?: string; errorCode?: string };

        const errorCode = errorBody.errorCode ?? errorBody.error ?? '';

        if (
            errorCode === 'DEVICE_AUTHORIZATION_PENDING' ||
            errorCode === 'authorization_pending'
        ) {
            // User hasn't authenticated yet, continue polling
            continue;
        } else if (errorCode === 'slow_down') {
            // Increase interval — wait extra time on next iteration
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
        } else if (
            errorCode === 'DEVICE_AUTHORIZATION_EXPIRED' ||
            errorCode === 'expired_token'
        ) {
            throw new Error(vscode.l10n.t('Authentication timed out. Please try again.'));
        } else {
            throw new Error(
                vscode.l10n.t('Atlas authentication failed: {0}', errorCode || String(response.status)),
            );
        }
    }

    throw new Error(vscode.l10n.t('Authentication timed out. Please try again.'));
}

/**
 * Refreshes an OAuth token using the stored refresh token.
 */
export async function refreshOAuthToken(refreshToken: string): Promise<AtlasOAuthTokenResponse> {
    const body = new URLSearchParams({
        client_id: ATLAS_OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'openid profile offline_access',
    });

    const response = await fetch(ATLAS_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        let errorDetail = `${response.status}`;
        try {
            const errorBody = (await response.json()) as { error?: string; error_description?: string; errorCode?: string };
            errorDetail = errorBody.error ?? errorBody.errorCode ?? errorDetail;
            if (errorBody.error_description) {
                errorDetail += `: ${errorBody.error_description}`;
            }
        } catch {
            // Ignore JSON parse errors for error body
        }
        throw new Error(vscode.l10n.t('Failed to refresh Atlas session: {0}', errorDetail));
    }

    return (await response.json()) as AtlasOAuthTokenResponse;
}
