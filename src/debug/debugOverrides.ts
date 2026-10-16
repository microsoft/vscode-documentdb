/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const DEBUG_OVERRIDE_PREFIX = 'DOCUMENTDB_DEBUG_';
export const DEBUG_SURVEY_ALWAYS_INVITE_ENV = `${DEBUG_OVERRIDE_PREFIX}SURVEY_ALWAYS_INVITE`;

export interface DebugOverrides {
    readonly surveyAlwaysInvite: boolean;
}

export function readDebugOverrides(extensionMode: vscode.ExtensionMode): DebugOverrides {
    if (extensionMode !== vscode.ExtensionMode.Development) {
        return { surveyAlwaysInvite: false };
    }
    return {
        surveyAlwaysInvite: process.env[DEBUG_SURVEY_ALWAYS_INVITE_ENV] === 'true',
    };
}
