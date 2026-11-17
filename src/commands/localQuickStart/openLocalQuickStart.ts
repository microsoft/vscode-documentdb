/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { readDeepLinkTelemetry } from '../../deepLinks/deepLinkTelemetry';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { InstanceState, type OpenLocalQuickStartOptions } from '../../services/localQuickStart/quickStartTypes';
import { openLocalQuickStartWebview } from '../../webviews/documentdb/localQuickStart/localQuickStartController';

/**
 * Opens the Local Quick Start webview. Primary entry point is the tree rocket
 * row (WI-6); this command is the command-palette / fallback launch (D10).
 */
export async function openLocalQuickStart(
    context: IActionContext,
    _target?: unknown,
    options?: OpenLocalQuickStartOptions,
): Promise<void> {
    // Every other entry point passes its source; the Command Palette passes no arguments.
    context.telemetry.properties.activationSource = options?.activationSource ?? 'commandPalette';
    // Opening the wizard must not resolve or contact an engine; checks belong to execution.
    // Stored facts alone can already say the credentials are missing, which the live status cannot yet.
    const status = await QuickStartService.getWizardStatus().catch(() => QuickStartService.getStatus());
    const initialDataChoice = options?.initialDataChoice === 'fresh' ? 'fresh' : undefined;
    // Missing credentials and an explicit Start fresh choice both belong on Configure.
    const initialPhase =
        initialDataChoice === 'fresh' || status.state === InstanceState.CredentialsMissing
            ? 'configure'
            : 'introduction';
    const quickStartSessionId = randomUUID();
    context.telemetry.properties.instanceState = status.state;
    context.telemetry.properties.initialStep = initialPhase;
    context.telemetry.properties.quickStartSessionId = quickStartSessionId;
    const view = openLocalQuickStartWebview(
        {
            id: 'localQuickStart',
            initialInstanceState: status.state,
            initialInstanceMissing: status.missing === true,
            initialPhase,
            ...(initialDataChoice ? { initialDataChoice } : {}),
            quickStartSessionId,
        },
        readDeepLinkTelemetry(context.telemetry.properties),
    );
    // Reveal in the panel's own column when it already has one (so reopening the create-or-reveal
    // singleton doesn't move a panel the user parked in another group), falling back to the active
    // column instead of the framework default (ViewColumn.One), which would yank the tab to column 1
    // (GPT-5.6 review + panel follow-up).
    view.revealToForeground(view.panel.viewColumn ?? vscode.ViewColumn.Active);
}
