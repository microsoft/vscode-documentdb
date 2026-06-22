/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewControllerBase } from '../../_integration/WebviewControllerBase';
import { type RouterContext } from './localQuickStartRouter';

export type LocalQuickStartConfigurationType = {
    id: string;
};

export class LocalQuickStartController extends WebviewControllerBase<LocalQuickStartConfigurationType> {
    constructor(initialData: LocalQuickStartConfigurationType) {
        super(
            ext.context,
            vscode.l10n.t('DocumentDB Local - Quick Start'),
            'localQuickStart',
            initialData,
            vscode.ViewColumn.Active,
            {
                light: vscode.Uri.joinPath(
                    ext.context.extensionUri,
                    'resources',
                    'icons',
                    'vscode-documentdb-icon-light-themes.svg',
                ),
                dark: vscode.Uri.joinPath(
                    ext.context.extensionUri,
                    'resources',
                    'icons',
                    'vscode-documentdb-icon-dark-themes.svg',
                ),
            },
        );

        const trpcContext: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'localQuickStart',
            // Success auto-close: dispose the PANEL (not the controller). The
            // framework deliberately does not close the panel from `dispose()`
            // (circular-chain guard); disposing the panel fires
            // `onDidDispose → dispose()`, so cleanup still runs.
            closePanel: () => {
                this.panel.dispose();
            },
        };

        this.setupTrpc(trpcContext);
    }
}
