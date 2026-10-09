/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** The VS Code setting that decides whether feedback (cards, surveys, survey events) is permitted. */
export const TELEMETRY_LEVEL_SETTING = 'telemetry.telemetryLevel';

/**
 * Whether the user permits feedback signals: `telemetry.telemetryLevel === 'all'`.
 *
 * `error`, `crash`, `off`, a missing or unrecognized value, and a settings read that throws
 * all return `false` (fail closed). Read on every call; never cached.
 *
 * See https://code.visualstudio.com/docs/setup/enterprise#_configure-telemetry-level
 */
export function isFeedbackPermitted(): boolean {
    try {
        return vscode.workspace.getConfiguration('telemetry').get<string>('telemetryLevel') === 'all';
    } catch {
        return false;
    }
}

/** Whether a configuration change can change the result of `isFeedbackPermitted()`. */
export function affectsFeedbackPermission(event: vscode.ConfigurationChangeEvent): boolean {
    try {
        return event.affectsConfiguration(TELEMETRY_LEVEL_SETTING);
    } catch {
        return true;
    }
}
