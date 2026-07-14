/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './localQuickStartRouter';

export type LocalQuickStartConfigurationType = {
    id: string;
};

/**
 * The single live Local Quick Start panel, or `undefined` when none is open.
 *
 * Local Quick Start is a single-managed-instance feature: the host-side
 * `QuickStartService` is a singleton, so two panels would race the same
 * provisioning / status state (both polling `getDockerStatus`, both able to
 * start provisioning). This module-level handle makes the view a
 * create-or-reveal singleton — a second launch reveals the existing tab instead
 * of opening a duplicate (webview-ext ADVANCED.md §"Create-or-reveal"). It is
 * cleared on panel disposal so a later launch re-creates the panel.
 */
let currentController: AppWebviewController<LocalQuickStartConfigurationType> | undefined;

/**
 * Opens (or reveals) the Local Quick Start webview.
 *
 * Create-or-reveal singleton: if a panel is already open its controller is
 * returned unchanged (the caller brings it to the foreground); otherwise a new
 * one is created. This matches the feature's single-managed-instance model —
 * only one panel may drive the singleton `QuickStartService` at a time.
 *
 * Construction-only otherwise (no instance state, no externally-called methods
 * beyond the handle), so this is a Path B factory per the webview-ext migration
 * manual, replacing the former `WebviewControllerBase` subclass.
 */
export function openLocalQuickStartWebview(
    initialData: LocalQuickStartConfigurationType,
): AppWebviewController<LocalQuickStartConfigurationType> {
    // Create-or-reveal: a live panel already exists — reuse its controller
    // instead of opening a duplicate tab that would race the same singleton
    // service. The caller reveals it (repo convention: the command owns the
    // reveal). `isDisposed` guards against a stale handle if the disposal
    // cleanup below ever races a re-entrant launch.
    if (currentController && !currentController.isDisposed) {
        return currentController;
    }

    // The router context's closePanel needs the controller handle, which only
    // exists after openAppWebview returns. The closure is only invoked at
    // runtime (in response to a tRPC call), well after the handle is assigned.
    const handle: { controller?: AppWebviewController<LocalQuickStartConfigurationType> } = {};

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'localQuickStart',
        // Success auto-close: dispose the PANEL (not the controller). The
        // framework deliberately does not close the panel from `dispose()`
        // (circular-chain guard); disposing the panel fires
        // `onDidDispose → dispose()`, so cleanup still runs.
        closePanel: () => {
            handle.controller?.panel.dispose();
        },
    };

    const controller = openAppWebview({
        title: vscode.l10n.t('DocumentDB Local - Quick Start'),
        webviewName: 'localQuickStart',
        config: initialData,
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
    currentController = controller;

    // Evict the singleton when the panel closes (success auto-close, explicit
    // Close, user tab close, or window reload) so the next launch creates a
    // fresh panel rather than revealing a disposed controller. Guarded so a
    // superseding panel already stored in `currentController` is never cleared.
    controller.onDisposed(() => {
        if (currentController === controller) {
            currentController = undefined;
        }
    });

    return controller;
}
