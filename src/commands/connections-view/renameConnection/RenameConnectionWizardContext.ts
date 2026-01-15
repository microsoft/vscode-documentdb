/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface RenameConnectionWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;

    originalConnectionName: string;
    newConnectionName?: string;

    /** Tree item path for refresh after rename */
    treeItemPath: string;
}
