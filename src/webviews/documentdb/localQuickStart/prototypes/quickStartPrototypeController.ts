/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * EXPERIMENT (dev/tnaum/quickstart-brainstorm).
 *
 * Opens one of the Local Quick Start layout prototypes. They reuse the shipping
 * `localQuickStart` tRPC router unchanged — only the React root differs — so a
 * side-by-side comparison exercises the real provisioning flow.
 *
 * Delete this file together with `prototypes/` once a layout is chosen.
 */

import * as vscode from 'vscode';
import { API } from '../../../../DocumentDBExperiences';
import { ext } from '../../../../extensionVariables';
import { type AppWebviewController, openAppWebview } from '../../../_integration/openAppWebview';
import { type WebviewName } from '../../../_integration/WebviewRegistry';
import { type LocalQuickStartConfigurationType } from '../localQuickStartController';
import { type RouterContext } from '../localQuickStartRouter';

export type QuickStartPrototype = 'recommended' | 'express' | 'wizard' | 'guided';

const PROTOTYPES: Record<QuickStartPrototype, { readonly webviewName: WebviewName; readonly title: string }> = {
    recommended: {
        webviewName: 'localQuickStartRecommended',
        title: vscode.l10n.t('Quick Start (Recommended: 2nd iteration)'),
    },
    express: { webviewName: 'localQuickStartExpress', title: vscode.l10n.t('Quick Start (A: Express)') },
    wizard: { webviewName: 'localQuickStartWizard', title: vscode.l10n.t('Quick Start (B: Wizard)') },
    guided: { webviewName: 'localQuickStartGuided', title: vscode.l10n.t('Quick Start (C: Guided)') },
};

export function openQuickStartPrototypeWebview(
    prototype: QuickStartPrototype,
): AppWebviewController<LocalQuickStartConfigurationType> {
    const { webviewName, title } = PROTOTYPES[prototype];
    const handle: { controller?: AppWebviewController<LocalQuickStartConfigurationType> } = {};

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName,
        closePanel: () => {
            handle.controller?.panel.dispose();
        },
    };

    const controller = openAppWebview({
        title,
        webviewName,
        config: { id: webviewName },
        context: trpcContext,
        viewColumn: vscode.ViewColumn.Active,
        icon: {
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
    });

    handle.controller = controller;
    return controller;
}
