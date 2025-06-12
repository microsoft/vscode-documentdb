/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskUserInfo, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type VSCodeRevealOptions } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../TreeElement';

export async function revealConnectionsViewElement(
    context: IActionContext,
    resourceId: string,
    options?: VSCodeRevealOptions,
): Promise<void> {
    try {
        const item: TreeElement | undefined = await ext.connectionsBranchDataProvider.findNodeById(resourceId, true);
        if (!item) {
            throw new Error(`Element with ID "${resourceId}" not found in the Connections view.`);
        }

        if (item) {
            await ext.connectionsTreeView.reveal(item, options ?? { expand: false, focus: true, select: true });
        }
    } catch (error) {
        context.telemetry.properties.revealError = maskUserInfo(parseError(error).message, []);
    }
}
