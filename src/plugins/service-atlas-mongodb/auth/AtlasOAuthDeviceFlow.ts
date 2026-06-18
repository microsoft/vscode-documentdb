/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { pollForDeviceToken, requestDeviceAuthorization } from './AtlasOAuthClient';
import { type AtlasSessionManager } from './AtlasSessionManager';

/**
 * Executes the full OAuth 2.0 Device Authorization flow:
 * 1. Requests a device code from Atlas
 * 2. Shows user a notification with the code and opens the browser
 * 3. Polls Atlas for the access token
 * 4. Stores tokens in the session manager
 *
 * @returns true if authentication was successful, false if cancelled or failed
 */
export async function executeOAuthDeviceFlow(sessionManager: AtlasSessionManager): Promise<boolean> {
    sessionManager.setAuthenticating();

    const cts = new vscode.CancellationTokenSource();

    try {
        // Step 1: Request device authorization
        const deviceAuth = await requestDeviceAuthorization(cts.token);

        // Step 2: Show notification and open browser
        const authenticated = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Authenticating with MongoDB Atlas...'),
                cancellable: true,
            },
            async (progress, cancellationToken) => {
                // Link the progress cancellation to our CTS
                cancellationToken.onCancellationRequested(() => cts.cancel());

                progress.report({
                    message: vscode.l10n.t('Code: {0} — Opening browser...', deviceAuth.user_code),
                });

                // Open the verification URI in the browser
                await vscode.env.openExternal(vscode.Uri.parse(deviceAuth.verification_uri));

                // Also copy the code to clipboard for convenience
                await vscode.env.clipboard.writeText(deviceAuth.user_code);

                progress.report({
                    message: vscode.l10n.t(
                        'Enter code {0} in your browser (copied to clipboard). Waiting for authentication...',
                        deviceAuth.user_code,
                    ),
                });

                // Step 3: Poll for the token
                const tokenResponse = await pollForDeviceToken(
                    deviceAuth.device_code,
                    deviceAuth.interval,
                    deviceAuth.expires_in,
                    cts.token,
                );

                // Step 4: Store tokens
                await sessionManager.storeOAuthTokens(
                    tokenResponse.access_token,
                    tokenResponse.refresh_token,
                    tokenResponse.expires_in,
                );

                return true;
            },
        );

        return authenticated;
    } catch (error) {
        // Sign-in did not complete (cancelled or failed). Revert the in-progress
        // "Authenticating" state back to whatever it was before sign-in started so the
        // tree does not stay stuck on "Authenticating…". The progress notification is
        // dismissed automatically once the withProgress callback settles.
        sessionManager.cancelAuthentication();

        if (cts.token.isCancellationRequested) {
            return false;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(vscode.l10n.t('MongoDB Atlas authentication failed.'), {
            modal: true,
            detail: vscode.l10n.t('Error: {0}', errorMessage),
        });
        return false;
    } finally {
        cts.dispose();
    }
}
