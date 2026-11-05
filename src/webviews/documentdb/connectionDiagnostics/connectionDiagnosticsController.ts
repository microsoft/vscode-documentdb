/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type DiagnosticsEntryPoint, type DiagnosticsTarget } from '../../../connectionDiagnostics/types';
import { isFeedbackPermitted } from '../../../utils/feedbackPermission';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './connectionDiagnosticsRouter';
import { type ConnectionDiagnosticsConfiguration } from './connectionDiagnosticsTypes';
import { DiagnosticsPanelSession } from './diagnosticsPanelSession';

interface PanelController {
    readonly controller: AppWebviewController<ConnectionDiagnosticsConfiguration>;
    readonly session: DiagnosticsPanelSession;
}

const panels = new Map<string, PanelController>();

export function openConnectionDiagnostics(options: {
    target: DiagnosticsTarget;
    entryPoint: DiagnosticsEntryPoint;
}): { panelAction: 'created' | 'focused'; diagnosticsSessionId: string } {
    const { target, entryPoint } = options;
    const existing = panels.get(target.clusterId);
    if (existing) {
        existing.controller.panel.reveal();
        existing.session.offerRerun();
        return { panelAction: 'focused', diagnosticsSessionId: existing.session.diagnosticsSessionId };
    }

    const session = new DiagnosticsPanelSession(randomUUID());
    const context: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'connectionDiagnostics',
        target,
        entryPoint,
        session,
    };
    const controller = openAppWebview<ConnectionDiagnosticsConfiguration>({
        title: vscode.l10n.t('Diagnose: {0}', target.displayName),
        webviewName: 'connectionDiagnostics',
        panelViewType: 'vscode-documentdb-connection-diagnostics',
        config: {
            connectionName: target.displayName,
            diagnosticsSessionId: session.diagnosticsSessionId,
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
    return { panelAction: 'created', diagnosticsSessionId: session.diagnosticsSessionId };
}
