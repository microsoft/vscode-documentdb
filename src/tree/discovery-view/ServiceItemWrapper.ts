/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type BaseServiceBranchDataProvider } from './api/BaseServiceBranchDataProvider';

export interface ServiceItemWrapper {
    provider: BaseServiceBranchDataProvider<TreeElementBase>;
    wrappedItem: TreeElementBase;
    // parent: ServiceItemWrapper<T> | undefined;
}

/**
 * As we're using multiple Service Discovery branch data providers, we need to know, for each item,
 * who's the provider to be used.
 * There are many ways of doing it.. adding a key of the provider to a id, to the context, etc..
 * or just wrappign these items in a 'wrapper' that keeps the reference to the actual provider, as it's done here
 * @param provider
 * @param item
 * @returns
 */
export function wrapServiceItem(
    provider: BaseServiceBranchDataProvider<TreeElementBase>,
    item: TreeElementBase,
): ServiceItemWrapper {
    return {
        provider: provider,
        wrappedItem: item,
    };
}
