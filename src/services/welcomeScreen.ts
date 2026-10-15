/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

const SHOWN_KEY = 'welcomeScreenShown_v1_0_0';
const LEGACY_SHOWN_KEY = 'welcomeScreenShown_v0_4_0';
const DEFERRED_SESSION_KEY = 'welcomeScreenDeferredSession_v1_0_0';

export async function maybeShowWelcomeScreen(): Promise<void> {
    await callWithTelemetryAndErrorHandling('welcomeScreen', async (context): Promise<void> => {
        context.telemetry.properties.isActivationEvent = 'true';
        context.errorHandling.suppressDisplay = true;

        try {
            if (ext.context.globalState.get<boolean>(SHOWN_KEY, false)) {
                context.telemetry.suppressAll = true;
                return;
            }

            if (ext.context.globalState.get<boolean>(LEGACY_SHOWN_KEY, false)) {
                const deferredSession = ext.context.workspaceState.get<string>(DEFERRED_SESSION_KEY);
                if (!deferredSession) {
                    // A live update can leave the workbench using the previous manifest's walkthrough.
                    await ext.context.workspaceState.update(DEFERRED_SESSION_KEY, vscode.env.sessionId);
                    context.telemetry.properties.outcome = 'deferred';
                    ext.outputChannel.appendLog('Deferring the updated welcome screen until a later window session.');
                    return;
                }

                if (deferredSession === vscode.env.sessionId) {
                    context.telemetry.suppressAll = true;
                    return;
                }
            }

            // Let activation finish before opening an editor.
            await new Promise<void>((resolve) => setImmediate(resolve));
            ext.outputChannel.appendLog('Showing welcome screen...');
            await vscode.commands.executeCommand(
                'workbench.action.openWalkthrough',
                'ms-azuretools.vscode-documentdb#documentdb-welcome',
            );
            await ext.context.globalState.update(SHOWN_KEY, true);
            await ext.context.workspaceState.update(DEFERRED_SESSION_KEY, undefined);
            context.telemetry.properties.outcome = 'shown';
            context.telemetry.properties.welcomeScreenShown = 'true';
        } catch (error) {
            ext.outputChannel.appendLog(
                `Welcome screen error: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }
    });
}
