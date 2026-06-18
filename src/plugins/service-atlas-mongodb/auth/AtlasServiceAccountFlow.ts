/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AtlasSessionManager } from './AtlasSessionManager';

/**
 * Prompts the user for Atlas Service Account credentials (client_id + client_secret),
 * validates them by fetching a token, and stores them.
 *
 * @returns true if authentication was successful, false if cancelled or failed
 */
export async function executeServiceAccountFlow(sessionManager: AtlasSessionManager): Promise<boolean> {
    sessionManager.setAuthenticating();

    // Step 1: Prompt for Client ID
    const clientId = await vscode.window.showInputBox({
        title: vscode.l10n.t('Atlas Service Account — Client ID'),
        prompt: vscode.l10n.t('Enter your MongoDB Atlas Service Account client ID'),
        placeHolder: vscode.l10n.t('e.g., mdb_sa_id_6501...'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return vscode.l10n.t('Client ID is required');
            }
            return undefined;
        },
    });

    if (!clientId) {
        sessionManager.cancelAuthentication();
        return false; // User cancelled
    }

    // Step 2: Prompt for Client Secret (masked)
    const clientSecret = await vscode.window.showInputBox({
        title: vscode.l10n.t('Atlas Service Account — Client Secret'),
        prompt: vscode.l10n.t('Enter your MongoDB Atlas Service Account client secret'),
        placeHolder: vscode.l10n.t('mdb_sa_sk_...'),
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return vscode.l10n.t('Client Secret is required');
            }
            return undefined;
        },
    });

    if (!clientSecret) {
        sessionManager.cancelAuthentication();
        return false; // User cancelled
    }

    // Step 3: Validate by fetching a token
    try {
        const { fetchServiceAccountToken } = await import('./AtlasServiceAccountClient');
        const tokenResponse = await fetchServiceAccountToken(clientId.trim(), clientSecret.trim());

        // Step 4: Store credentials and token
        await sessionManager.storeServiceAccountCredentials(
            clientId.trim(),
            clientSecret.trim(),
            tokenResponse.access_token,
            tokenResponse.expires_in,
        );

        void vscode.window.showInformationMessage(
            vscode.l10n.t('Successfully authenticated with MongoDB Atlas using Service Account.'),
        );
        return true;
    } catch (error) {
        sessionManager.cancelAuthentication();
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to authenticate MongoDB Atlas Service Account.'), {
            modal: true,
            detail: vscode.l10n.t('Error: {0}', errorMessage),
        });
        return false;
    }
}
