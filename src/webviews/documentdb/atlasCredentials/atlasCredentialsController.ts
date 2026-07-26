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
 * it carries **no secret material** - only which auth method to render a form
 * for and whether the panel is adding or updating a credential. The entered credentials
 * travel back to the host through a tRPC mutation.
 */
export type AtlasCredentialsWebviewConfig = {
    /**
     * Pre-selected auth method. When omitted, the webview opens on its method-choice step so the
     * whole add flow stays one guided surface.
     */
    readonly authMethod?: AtlasAuthMethod;
    /** `edit` renders "update" wording; the host replaces the secret of an existing credential. */
    readonly mode: 'add' | 'edit';
    /** Friendly name of the credential being updated, shown in the edit header. */
    readonly credentialLabel?: string;
};

/** Options for {@link openAtlasCredentialsWebview}. */
export interface OpenAtlasCredentialsOptions {
    /** Pre-selected auth method. Omit to let the user choose inside the webview. */
    readonly authMethod?: AtlasAuthMethod;
    /** Existing credential whose secret should be replaced once the new one validates. */
    readonly credentialId?: string;
    /** Friendly name persisted with the credential and shown in the panel header. */
    readonly credentialLabel?: string;
}

/**
 * Opens the guided credential-entry webview and resolves once the user either successfully stores
 * credentials or closes the panel.
 *
 * Returning a `Promise<boolean>` keeps the existing auth-flow contract
 * (`executeAtlasAuthFlow`) intact, so every caller - the discovery tree, the credential-management
 * wizard, and the new-connection wizard - continues to work without change.
 *
 * @returns `true` when credentials were validated and stored; `false` when the
 *          user closed the panel without completing.
 */
export function openAtlasCredentialsWebview(
    authMethodOrOptions: AtlasAuthMethod | OpenAtlasCredentialsOptions | undefined,
    sessionManager: AtlasSessionManager,
): Promise<boolean> {
    const options: OpenAtlasCredentialsOptions =
        typeof authMethodOrOptions === 'string' ? { authMethod: authMethodOrOptions } : (authMethodOrOptions ?? {});

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

        const mode = options.credentialId ? 'edit' : 'add';
        const title = buildTitle(mode, options.authMethod);

        const context: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'atlasCredentials',
            sessionManager,
            credentialId: options.credentialId,
            credentialLabel: options.credentialLabel,
            onCredentialsStored,
        };

        state.controller = openAppWebview<AtlasCredentialsWebviewConfig>({
            title,
            webviewName: 'atlasCredentials',
            config: { authMethod: options.authMethod, mode, credentialLabel: options.credentialLabel },
            context,
        });

        state.controller.onDisposed(() => finish(false));
    });
}

function buildTitle(mode: 'add' | 'edit', authMethod: AtlasAuthMethod | undefined): string {
    if (mode === 'edit') {
        return vscode.l10n.t('Update MongoDB Atlas Credentials');
    }
    if (authMethod === 'apikey') {
        return vscode.l10n.t('Connect with a MongoDB Atlas API Key');
    }
    if (authMethod === 'serviceaccount') {
        return vscode.l10n.t('Connect with a MongoDB Atlas Service Account');
    }
    return vscode.l10n.t('Add a MongoDB Atlas Credential');
}
