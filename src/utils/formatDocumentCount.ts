/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
    // Try to use the user's VS Code locale, fall back to 'en-US' on failure
    let locale = 'en-US';
    try {
        locale = vscode.env.language || 'en-US';
    } catch {
        // Fall back to 'en-US' if vscode.env.language is unavailable
    }

    const formatter = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    });

    return `${formatter.format(count)} docs`;
}
