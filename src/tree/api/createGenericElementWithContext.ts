/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericElementOptions } from '@microsoft/vscode-azext-utils';
import { Uri, type IconPath, type TreeItem } from 'vscode';
import { nonNullValue } from '../../utils/nonNull';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';

/**
 * Convert TreeItemIconPath to IconPath by ensuring strings are converted to Uri
 */
function convertIconPath(iconPath: GenericElementOptions['iconPath']): IconPath | undefined {
    if (!iconPath) {
        return undefined;
    }
    if (typeof iconPath === 'string') {
        return Uri.file(iconPath);
    }
    if (typeof iconPath === 'object' && 'light' in iconPath && 'dark' in iconPath) {
        return {
            light: typeof iconPath.light === 'string' ? Uri.file(iconPath.light) : iconPath.light,
            dark: typeof iconPath.dark === 'string' ? Uri.file(iconPath.dark) : iconPath.dark,
        };
    }
    return iconPath;
}

export function createGenericElementWithContext(
    options: GenericElementOptions,
): TreeElement & TreeElementWithContextValue {
    let commandArgs = options.commandArgs;
    const item = {
        id: nonNullValue(options.id, 'options.id', 'createGenericElementWithContext.ts'),
        contextValue: nonNullValue(options.contextValue, 'options.contextValue', 'createGenericElementWithContext.ts'),

        getTreeItem(): TreeItem {
            const { iconPath, ...restOptions } = options;
            return {
                ...restOptions,
                iconPath: convertIconPath(iconPath),
                command: options.commandId
                    ? {
                          title: '',
                          command: options.commandId,
                          arguments: commandArgs,
                      }
                    : undefined,
            };
        },
    };

    // if command args is not set, then set it to the item itself
    commandArgs ??= [item];
    return item;
}
