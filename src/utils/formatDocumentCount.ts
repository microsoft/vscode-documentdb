/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formats a document count for display in the tree view.
 * Uses compact notation for large numbers (e.g., "1.2K", "1.5M").
 *
 * @param count The document count to format
 * @returns Formatted string representation of the count
 */
export function formatDocumentCount(count: number): string {
    if (count < 1000) {
        return `${count} docs`;
    }

    // Use Intl.NumberFormat for compact notation
    const formatter = new Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: 1,
    });

    return `${formatter.format(count)} docs`;
}
