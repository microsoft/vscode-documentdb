/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type AtlasAuthMethod } from './AtlasSession';

/**
 * Shows a QuickPick for the user to choose their preferred Atlas authentication method.
 * Returns the selected method or undefined if cancelled.
 */
export async function promptAtlasAuthMethod(): Promise<AtlasAuthMethod | undefined> {
    interface AuthMethodQuickPickItem extends vscode.QuickPickItem {
        authMethod: AtlasAuthMethod;
    }

    const items: AuthMethodQuickPickItem[] = [
        {
            label: vscode.l10n.t('$(globe) Sign in with browser (OAuth 2.0)'),
            description: vscode.l10n.t('Recommended — uses the Atlas device authorization flow'),
            authMethod: 'oauth',
        },
        {
            label: vscode.l10n.t('$(key) Use API Key'),
            description: vscode.l10n.t('Enter an Atlas API public and private key pair'),
            authMethod: 'apikey',
        },
        {
            label: vscode.l10n.t('$(server) Service Account'),
            description: vscode.l10n.t('Use a Service Account client ID and secret (machine-to-machine)'),
            authMethod: 'serviceaccount',
        },
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('How would you like to authenticate with MongoDB Atlas?'),
        ignoreFocusOut: true,
    });

    return selected?.authMethod;
}
