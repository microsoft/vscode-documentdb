/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type ConnectionItem, type ConnectionType } from '../../../services/connectionStorageService';

/**
 * Quick pick item for folder selection
 */
export interface FolderPickItem {
    label: string;
    description?: string;
    iconPath?: vscode.ThemeIcon;
    data: ConnectionItem | undefined; // undefined = root level
}

export interface MoveItemsWizardContext extends IActionContext {
    // Items being moved
    itemsToMove: ConnectionItem[];

    // Zone (for filtering target folders)
    connectionType: ConnectionType;

    // Source folder ID (to filter from picker - cannot move folder into itself)
    sourceFolderId: string | undefined;

    // Target selection
    targetFolderId: string | undefined; // undefined = root
    targetFolderPath: string | undefined; // Display path for confirmation

    // Pre-cached folder list (survives back navigation - initialized as [])
    cachedFolderList: FolderPickItem[];

    // Conflict detection (no resolution - just detection)
    conflictingNames: string[];
}
