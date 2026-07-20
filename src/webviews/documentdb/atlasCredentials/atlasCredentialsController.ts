/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { type AtlasAuthMethod } from '../../../plugins/service-atlas-mongodb/auth/AtlasSession';
import { type AtlasSessionManager } from '../../../plugins/service-atlas-mongodb/auth/AtlasSessionManager';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './atlasCredentialsRouter';

/**
 * Configuration passed to the MongoDB Atlas credential webview. Serialised as JSON, so
 * it carries **no secret material** — only which auth method to render a form
 * for. The entered credentials travel back to the host through a tRPC mutation.
 */
export type AtlasCredentialsWebviewConfig = {
    readonly authMethod: AtlasAuthMethod;
};

/**
 * Opens the guided credential-entry webview for the given auth method and
 * resolves once the user either successfully stores credentials or closes the
 * panel.
 *
 * Returning a `Promise<boolean>` keeps the existing auth-flow contract
 * (`executeAtlasAuthFlow`) intact, so every caller — the discovery tree and the
 * new-connection wizard — continues to work without change.
 *
 * @returns `true` when credentials were validated and stored; `false` when the
 *          user closed the panel without completing.
 */
export function openAtlasCredentialsWebview(
    authMethod: AtlasAuthMethod,
    sessionManager: AtlasSessionManager,
): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        // Held in an object so the `onCredentialsStored` closure can reference the
        // controller that is only created further below.
        const state: { controller?: AppWebviewController<AtlasCredentialsWebviewConfig> } = {};

        const finish = (result: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        const onCredentialsStored = (): void => {
            finish(true);
            // Dispose on the next tick so the mutation's success response is
            // delivered to the webview before the panel is torn down.
            setTimeout(() => state.controller?.dispose(), 0);
        };

        const title =
            authMethod === 'apikey'
                ? vscode.l10n.t('Connect with a MongoDB Atlas API Key')
                : vscode.l10n.t('Connect with a MongoDB Atlas Service Account');

        const context: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'atlasCredentials',
            sessionManager,
            onCredentialsStored,
        };

        state.controller = openAppWebview<AtlasCredentialsWebviewConfig>({
            title,
            webviewName: 'atlasCredentials',
            config: { authMethod },
            context,
        });

        state.controller.onDisposed(() => finish(false));
    });
}
