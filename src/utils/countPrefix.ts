/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { COUNT_PREFIX } from '../constants';

/**
 * Returns the count-prefix string based on the user's accessibility setting.
 * Returns an empty string when the user has hidden the visual prefix.
 */
export function getCountPrefix(): string {
    const hide = vscode.workspace.getConfiguration('documentDB').get<boolean>('accessibility.hideCountPrefix', false);
    return hide ? '' : COUNT_PREFIX;
}
