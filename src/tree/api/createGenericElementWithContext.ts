/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericElementOptions } from '@microsoft/vscode-azext-utils';
import { type TreeItem } from 'vscode';
import { nonNullValue } from '../../utils/nonNull';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';

export function createGenericElementWithContext(
    options: GenericElementOptions,
): TreeElement & TreeElementWithContextValue {
    let commandArgs = options.commandArgs;
    const item = {
        id: nonNullValue(options.id, 'options.id', 'createGenericElementWithContext.ts'),
        contextValue: nonNullValue(options.contextValue, 'options.contextValue', 'createGenericElementWithContext.ts'),

        getTreeItem(): TreeItem {
            return {
                ...options,
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
