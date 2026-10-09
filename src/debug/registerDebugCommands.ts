/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSurveyService, recordSurveyActivity, type SurveyService } from '../services/survey/SurveyService';
import { SURVEY_FEATURE_AREAS } from '../services/survey/surveyTypes';

export const DEVELOPMENT_MODE_CONTEXT = 'documentdb.isDevelopmentMode';
export const SHOW_SURVEY_INVITATION_COMMAND = 'vscode-documentdb.debug.survey.showInvitation';
export const SIMULATE_SURVEY_MILESTONE_COMMAND = 'vscode-documentdb.debug.survey.simulateMilestone';
export const RESET_SURVEY_STATE_COMMAND = 'vscode-documentdb.debug.survey.resetState';

function reportSurveyDebugStatus(service: SurveyService): void {
    const s = service.getDebugStatus();
    if (s.invitationActive) {
        return;
    }
    void vscode.window.showWarningMessage(
        `Survey invitation NOT shown. alwaysInvite=${s.alwaysInvite}, enabled=${s.enabled}, ` +
            `telemetryAll=${s.feedbackPermitted}, optedOut=${s.optedOut}, presenter=${s.presenterRegistered}`,
    );
}

export async function registerDebugCommands(context: vscode.ExtensionContext): Promise<void> {
    if (context.extensionMode !== vscode.ExtensionMode.Development) {
        return;
    }
    await vscode.commands.executeCommand('setContext', DEVELOPMENT_MODE_CONTEXT, true);
    context.subscriptions.push(
        vscode.commands.registerCommand(SHOW_SURVEY_INVITATION_COMMAND, async (): Promise<void> => {
            const service = getSurveyService();
            if (!service) {
                void vscode.window.showWarningMessage('Survey service is not initialized; see the DocumentDB output.');
                return;
            }
            await service.showInvitationForDebug(SURVEY_FEATURE_AREAS[0]);
            reportSurveyDebugStatus(service);
        }),
        vscode.commands.registerCommand(SIMULATE_SURVEY_MILESTONE_COMMAND, async (): Promise<void> => {
            const service = getSurveyService();
            if (!service) {
                void vscode.window.showWarningMessage('Survey service is not initialized; see the DocumentDB output.');
                return;
            }
            recordSurveyActivity(SURVEY_FEATURE_AREAS[0]);
            await service.whenIdle();
            reportSurveyDebugStatus(service);
        }),
        vscode.commands.registerCommand(RESET_SURVEY_STATE_COMMAND, async (): Promise<void> => {
            await getSurveyService()?.resetState();
        }),
    );
}
