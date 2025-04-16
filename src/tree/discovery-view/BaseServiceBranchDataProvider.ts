/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export interface BaseServiceBranchDataProvider<T> extends vscode.TreeDataProvider<T> {
    // each service provider is allowed ot only have one root item, that's why getChildren(undefined) is not used
    // as it would be hearder to restrict the count of root items. Here it's simple, you can't return an array of items
    getRootItem(parentId: string): Promise<T>;

    // getLoginInformation?(item: T): Promise<LoginInformation> | LoginInformation;
    // onConnect?(): Promise<void>;
    // onDisconnect?(): Promise<void>;
}
