/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ConnectionType } from '../../../services/connectionStorageService';

export interface CreateFolderWizardContext extends IActionContext {
    folderName?: string;
    parentFolderId?: string; // undefined means root level
    connectionType?: ConnectionType; // Connection type for the folder
}
