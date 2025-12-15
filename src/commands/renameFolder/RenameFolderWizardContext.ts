/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface RenameFolderWizardContext extends IActionContext {
    folderId?: string;
    originalFolderName?: string;
    newFolderName?: string;
    parentFolderId?: string; // To check for duplicate names at the same level
}
