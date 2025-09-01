/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { commands } from 'vscode';
import { Views } from '../../documentdb/Views';

export async function revealView(_context: IActionContext, view: Views): Promise<void> {
    switch (view) {
        case Views.ConnectionsView:
            await commands.executeCommand(`connectionsView.focus`);
            break;
        case Views.DiscoveryView:
            await commands.executeCommand(`discoveryView.focus`);
            break;
        default:
            throw new Error(`Unsupported view: ${view}`);
    }
}
