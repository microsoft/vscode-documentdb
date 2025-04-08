/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

export interface BaseServiceBranchDataProvider<T> extends vscode.TreeDataProvider<T> {
    readonly id: string;
    readonly label: string;
    readonly description?: string;

    readonly icon?:
        | string
        | vscode.Uri
        | {
              light: string | vscode.Uri;
              dark: string | vscode.Uri;
          }
        | vscode.ThemeIcon;

    // each is allowed ot only have one root item, that's why getChildren(undefined) is not used
    getRootItem(): Promise<T>;

    // getLoginInformation?(item: T): Promise<LoginInformation> | LoginInformation;
    // onConnect?(): Promise<void>;
    // onDisconnect?(): Promise<void>;
}
