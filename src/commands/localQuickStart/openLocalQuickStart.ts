/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { openLocalQuickStartWebview } from '../../webviews/documentdb/localQuickStart/localQuickStartController';

/**
 * Opens the Local Quick Start webview. Primary entry point is the tree rocket
 * row (WI-6); this command is the command-palette / fallback launch (D10).
 */
export async function openLocalQuickStart(_context: IActionContext): Promise<void> {
    await QuickStartService.ensureHydrated();
    const view = openLocalQuickStartWebview({ id: 'localQuickStart' });
    // Reveal in the panel's own column when it already has one (so reopening the create-or-reveal
    // singleton doesn't move a panel the user parked in another group), falling back to the active
    // column instead of the framework default (ViewColumn.One), which would yank the tab to column 1
    // (GPT-5.6 review + panel follow-up).
    view.revealToForeground(view.panel.viewColumn ?? vscode.ViewColumn.Active);
}
