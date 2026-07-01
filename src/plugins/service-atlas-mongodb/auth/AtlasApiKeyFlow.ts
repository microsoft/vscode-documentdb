/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AtlasSessionManager } from './AtlasSessionManager';

/**
 * Prompts the user for Atlas API Key credentials (public + private key pair),
 * validates them against the Atlas API, and stores them.
 *
 * @returns true if authentication was successful, false if cancelled or failed
 */
export async function executeApiKeyFlow(sessionManager: AtlasSessionManager): Promise<boolean> {
    sessionManager.setAuthenticating();

    // Step 1: Prompt for public key
    const publicKey = await vscode.window.showInputBox({
        title: vscode.l10n.t('Atlas API Key — Public Key'),
        prompt: vscode.l10n.t('Enter your MongoDB Atlas API public key'),
        placeHolder: vscode.l10n.t('e.g., abcdef12'),
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return vscode.l10n.t('Public key is required');
            }
            return undefined;
        },
    });

    if (!publicKey) {
        sessionManager.cancelAuthentication();
        return false; // User cancelled
    }

    // Step 2: Prompt for private key (masked)
    const privateKey = await vscode.window.showInputBox({
        title: vscode.l10n.t('Atlas API Key — Private Key'),
        prompt: vscode.l10n.t('Enter your MongoDB Atlas API private key'),
        placeHolder: vscode.l10n.t('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return vscode.l10n.t('Private key is required');
            }
            return undefined;
        },
    });

    if (!privateKey) {
        sessionManager.cancelAuthentication();
        return false; // User cancelled
    }

    // Step 3: Validate credentials
    const { AtlasApiError } = await import('../api/AtlasApiClient');
    try {
        await validateApiKeyCredentials(publicKey.trim(), privateKey.trim());
    } catch (error) {
        sessionManager.cancelAuthentication();
        if (error instanceof AtlasApiError && (error.statusCode === 401 || error.statusCode === 403)) {
            const reason =
                error.detail && error.detail.trim().length > 0
                    ? error.detail
                    : vscode.l10n.t('Please verify your public and private key pair.');
            void vscode.window.showErrorMessage(
                vscode.l10n.t('MongoDB Atlas rejected the API key (HTTP {0}).', String(error.statusCode)),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        '{0}\n\nIf the key pair is correct, make sure your current IP address is on the Access List for this API key and that the key has the required project permissions.',
                        reason,
                    ),
                },
            );
            return false;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to validate MongoDB Atlas API key.'), {
            modal: true,
            detail: vscode.l10n.t('Error: {0}', errorMessage),
        });
        return false;
    }

    // Step 4: Store credentials
    await sessionManager.storeApiKeyCredentials(publicKey.trim(), privateKey.trim());

    void vscode.window.showInformationMessage(vscode.l10n.t('Successfully authenticated with MongoDB Atlas.'));
    return true;
}

/**
 * Validates API key credentials by making a lightweight API call.
 * Uses HTTP Digest Authentication as required by the Atlas Admin API.
 *
 * Resolves when the credentials are accepted. Any {@link AtlasApiError} (including 401/403)
 * is propagated so the caller can surface the real reason Atlas rejected the request.
 */
async function validateApiKeyCredentials(publicKey: string, privateKey: string): Promise<void> {
    const { AtlasApiClient } = await import('../api/AtlasApiClient');
    const client = new AtlasApiClient({ type: 'apikey', publicKey, privateKey });

    // A successful call to list projects means the credentials are valid.
    await client.listProjects();
}
