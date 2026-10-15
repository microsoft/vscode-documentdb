/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The VS Code setting (and `EnableFeedback` policy) that decides whether feedback and surveys are permitted. */
export const FEEDBACK_ENABLED_SETTING = 'telemetry.feedback.enabled';

/**
 * Whether the user permits feedback: `telemetry.feedback.enabled`, which defaults to `true`.
 *
 * Only `true` permits. `false`, a non-boolean value, and a settings read that throws all return
 * `false` (fail closed). Read on every call; never cached. Survey events are additionally subject
 * to `telemetry.telemetryLevel` through the VS Code telemetry reporter.
 *
 * See https://code.visualstudio.com/docs/enterprise/telemetry#_configure-feedback-mechanisms
 */
export function isFeedbackPermitted(): boolean {
    try {
        return vscode.workspace.getConfiguration('telemetry').get<boolean>('feedback.enabled', true) === true;
    } catch {
        return false;
    }
}

/** Whether a configuration change can change the result of `isFeedbackPermitted()`. */
export function affectsFeedbackPermission(event: vscode.ConfigurationChangeEvent): boolean {
    try {
        return event.affectsConfiguration(FEEDBACK_ENABLED_SETTING);
    } catch {
        return true;
    }
}
