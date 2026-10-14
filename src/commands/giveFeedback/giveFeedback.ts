/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSurveyService, type SurveyService } from '../../services/survey/SurveyService';
import { SURVEY_FORM_URL } from '../../services/survey/surveyConfig';

export const GIVE_FEEDBACK_COMMAND = 'vscode-documentdb.command.giveFeedback';

export async function giveFeedback(service?: SurveyService): Promise<void> {
    let opened = false;
    try {
        opened = service
            ? (await service.openSurveyFormFromCommand()) !== 'failed'
            : await vscode.env.openExternal(vscode.Uri.parse(SURVEY_FORM_URL));
    } catch {
        opened = false;
    }
    if (!opened) {
        await vscode.window.showErrorMessage(
            vscode.l10n.t("We couldn't open the survey in your browser. Please try again."),
            { modal: true },
        );
    }
}

export function registerGiveFeedbackCommand(context: vscode.ExtensionContext, service?: SurveyService): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            GIVE_FEEDBACK_COMMAND,
            (): Promise<void> => giveFeedback(service ?? getSurveyService()),
        ),
    );
}
