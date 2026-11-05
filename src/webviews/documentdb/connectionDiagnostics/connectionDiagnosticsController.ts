/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type TroubleshooterEntryPoint, type TroubleshootTarget } from '../../../connectionDiagnostics/types';
import { isFeedbackPermitted } from '../../../utils/feedbackPermission';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './connectionDiagnosticsRouter';
import { type ConnectivityTroubleshooterConfiguration } from './connectionDiagnosticsTypes';
import { TroubleshooterPanelSession } from './diagnosticsPanelSession';

interface PanelController {
    readonly controller: AppWebviewController<ConnectivityTroubleshooterConfiguration>;
    readonly session: TroubleshooterPanelSession;
}

const panels = new Map<string, PanelController>();

export function openConnectivityTroubleshooter(options: {
    target: TroubleshootTarget;
    entryPoint: TroubleshooterEntryPoint;
}): { panelAction: 'created' | 'focused'; troubleshooterSessionId: string } {
    const { target, entryPoint } = options;
    const existing = panels.get(target.clusterId);
    if (existing) {
        existing.controller.panel.reveal();
        existing.session.offerRerun();
        return { panelAction: 'focused', troubleshooterSessionId: existing.session.troubleshooterSessionId };
    }

    const session = new TroubleshooterPanelSession(randomUUID());
    const context: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'connectivityTroubleshooter',
        target,
        entryPoint,
        session,
    };
    const controller = openAppWebview<ConnectivityTroubleshooterConfiguration>({
        title: vscode.l10n.t('Diagnose: {0}', target.displayName),
        webviewName: 'connectivityTroubleshooter',
        panelViewType: 'vscode-documentdb-connectivity-troubleshooter',
        config: {
            connectionName: target.displayName,
            troubleshooterSessionId: session.troubleshooterSessionId,
            feedbackPermitted: isFeedbackPermitted(),
        },
        context,
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
    panels.set(target.clusterId, { controller, session });
    controller.onDisposed((): void => {
        session.dispose();
        panels.delete(target.clusterId);
    });
    return { panelAction: 'created', troubleshooterSessionId: session.troubleshooterSessionId };
}
