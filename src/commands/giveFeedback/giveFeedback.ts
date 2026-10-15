/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSurveyService, type SurveyService } from '../../services/survey/SurveyService';
import { SURVEY_FORM_URL } from '../../services/survey/surveyConfig';
import { isFeedbackPermitted, showFeedbackDisabledMessage } from '../../utils/feedbackPermission';

export const GIVE_FEEDBACK_COMMAND = 'vscode-documentdb.command.giveFeedback';
export const GIVE_FEEDBACK_VIEW_COMMAND = 'vscode-documentdb.command.internal.helpAndFeedback.openSurvey';

export async function giveFeedback(service?: SurveyService): Promise<void> {
    await openFeedbackView('giveFeedbackCommand', service);
}

export async function showFeedbackView(service?: SurveyService): Promise<void> {
    await openFeedbackView('helpAndFeedbackView', service);
}

async function openFeedbackView(
    source: 'giveFeedbackCommand' | 'helpAndFeedbackView',
    service: SurveyService | undefined,
): Promise<void> {
    if (!isFeedbackPermitted()) {
        // The command is hidden and silent when off (D0032); only a stale tree item explains itself.
        if (source === 'helpAndFeedbackView') {
            showFeedbackDisabledMessage();
        }
        return;
    }
    if (!service) {
        await openSurveyInBrowser();
        return;
    }
    let shown = false;
    try {
        shown = await service.showFeedbackForm(source);
    } catch {
        shown = false;
    }
    if (!shown) {
        void vscode.window.showErrorMessage(vscode.l10n.t("We couldn't open the feedback view. Please try again."));
    }
}

/** Fallback when the survey service failed to initialize. */
async function openSurveyInBrowser(): Promise<void> {
    let opened = false;
    try {
        opened = await vscode.env.openExternal(vscode.Uri.parse(SURVEY_FORM_URL));
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
        vscode.commands.registerCommand(
            GIVE_FEEDBACK_VIEW_COMMAND,
            (): Promise<void> => showFeedbackView(service ?? getSurveyService()),
        ),
    );
}
