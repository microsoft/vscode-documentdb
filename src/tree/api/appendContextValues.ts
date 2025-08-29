/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';

/**
 * Appends context values to a tree item's contextValue property.
 *
 * This utility function standardizes how context values are combined across all tree providers.
 * It ensures that existing context values are preserved while new ones are added, and uses
 * the proper context value creation mechanism from the Azure Extensions utils.
 *
 * ## Usage Pattern
 *
 * This function is typically used in tree data providers when processing tree elements
 * to ensure they have the correct context values for VS Code's context menu system:
 *
 * ```typescript
 * if (isTreeElementWithContextValue(child)) {
 *     appendContextValues(child, 'branchSpecificValue', Views.CurrentView);
 * }
 * ```
 *
 * ## Context Value Handling
 *
 * - New context values are added to the beginning of the context value list
 * - Existing context values are preserved and appended to the end
 * - The final context value is created using createContextValue for proper formatting
 *
 * @param treeItem The tree item to modify
 * @param contextValuesToAppend The context values to append (order matters)
 */
export function appendContextValues(treeItem: TreeElementWithContextValue, ...contextValuesToAppend: string[]): void {
    const contextValues: string[] = contextValuesToAppend;

    // Keep original contextValues if any
    if (treeItem.contextValue) {
        contextValues.push(treeItem.contextValue);
    }

    treeItem.contextValue = createContextValue(contextValues);
}
