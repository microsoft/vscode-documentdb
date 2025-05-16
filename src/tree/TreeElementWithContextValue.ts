/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a tree element with context value support.
 *
 * @property contextValue - A string representing the context value of the tree element.
 */
export type TreeElementWithContextValue = {
    contextValue: string;
};

export function isTreeElementWithContextValue(node: unknown): node is TreeElementWithContextValue {
    return typeof node === 'object' && node !== null && 'contextValue' in node;
}
