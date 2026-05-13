/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command IDs for Interactive Shell features.
 */
export const ShellCommandIds = {
    /** Open a shell from a tree node (context menu) */
    open: 'vscode-documentdb.command.shell.open',
    /** Open a shell from a tree node (inline button) */
    openInline: 'vscode-documentdb.command.shell.open.inline',
    /** Open a shell with pre-filled input (cross-feature navigation) */
    openWithInput: 'vscode-documentdb.command.shell.open.withInput',
} as const;
