/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { LocalQuickStartController } from '../../webviews/documentdb/localQuickStart/localQuickStartController';

/**
 * Opens the Local Quick Start webview. Primary entry point is the tree rocket
 * row (WI-6); this command is the command-palette / fallback launch (D10).
 */
export function openLocalQuickStart(_context: IActionContext): void {
    const view = new LocalQuickStartController({ id: 'localQuickStart' });
    view.revealToForeground();
}
