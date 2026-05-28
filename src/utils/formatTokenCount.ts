/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Formats a token count for display in trace logs and telemetry-driven UI.
 *
 * Mirrors the {@link formatDocumentCount} pattern: values under 1,000 are
 * returned as-is, larger values use `Intl.NumberFormat`'s compact notation
 * (e.g., `"1.2K"`, `"1.5M"`). Returns just the numeric string so callers can
 * supply their own unit/suffix (e.g., `"tokens"`, `"of context"`).
 *
 * @param count The token count to format
 * @returns Formatted string representation of the count
 */
export function formatTokenCount(count: number): string {
    if (!Number.isFinite(count) || count < 0) {
        return String(count);
    }

    if (count < 1000) {
        return count.toString();
    }

    // Use Intl.NumberFormat for compact notation
    // Try to use the user's VS Code locale, fall back to 'en-US' if unavailable
    const locale = vscode.env?.language || 'en-US';

    const formatter = new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    });

    return formatter.format(count);
}
