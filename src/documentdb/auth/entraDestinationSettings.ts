/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { settingsKeys } from '../../settingsKeys';
import { evaluateEntraDestination, type EntraDestinationDecision } from './oidcAllowedHosts';

export function getEntraCustomHostnameSuffix(): unknown {
    const setting = vscode.workspace.getConfiguration().inspect<unknown>(settingsKeys.customEnvironment);
    const environment = setting?.globalValue === undefined ? setting?.defaultValue : setting.globalValue;
    return environment && typeof environment === 'object' && 'hostnameSuffix' in environment
        ? environment.hostnameSuffix
        : undefined;
}

export function evaluateEntraDestinationFromSettings(connectionString: string): EntraDestinationDecision {
    return evaluateEntraDestination(connectionString, getEntraCustomHostnameSuffix());
}
