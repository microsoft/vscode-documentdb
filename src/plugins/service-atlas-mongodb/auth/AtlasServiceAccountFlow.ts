/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openAtlasCredentialsWebview } from '../../../webviews/documentdb/atlasCredentials/atlasCredentialsController';
import { type AtlasSessionManager } from './AtlasSessionManager';

/**
 * Opens the guided credential webview for MongoDB Atlas Service Account entry.
 *
 * The webview collects the client id/secret, validates them by fetching a
 * token, and stores them (all host-side, see the webview router). This function
 * only manages the surrounding session state and the success notification,
 * keeping the `Promise<boolean>` contract every caller relies on.
 *
 * @returns true if authentication was successful, false if cancelled or failed
 */
export async function executeServiceAccountFlow(sessionManager: AtlasSessionManager): Promise<boolean> {
    sessionManager.setAuthenticating();

    const success = await openAtlasCredentialsWebview('serviceaccount', sessionManager);

    if (!success) {
        sessionManager.cancelAuthentication();
        return false;
    }

    void vscode.window.showInformationMessage(
        vscode.l10n.t('Successfully authenticated with MongoDB Atlas using Service Account.'),
    );
    return true;
}
