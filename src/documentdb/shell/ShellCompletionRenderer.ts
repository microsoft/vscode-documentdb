/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Renders completion candidates as a multi-column ANSI-formatted list
 * for display below the shell prompt, similar to bash/zsh tab completion.
 *
 * This module is platform-neutral (no VS Code API dependencies) and
 * produces raw strings with embedded ANSI escape codes.
 */

import { type CompletionCandidate } from './ShellCompletionProvider';

// ─── ANSI constants ──────────────────────────────────────────────────────────

const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_RESET = '\x1b[0m';

/** Maximum number of rows to display before truncating. */
const MAX_DISPLAY_ROWS = 8;

/** Minimum column width (padding included). */
const MIN_COLUMN_WIDTH = 4;

/** Padding between columns. */
const COLUMN_PADDING = 2;

/**
 * Returns the ANSI color code for a completion candidate kind.
 *
 * Color scheme:
 * - Collections: cyan — data containers, visually prominent
 * - Methods/commands: yellow — callable actions
 * - Fields: green — data attributes
 * - Operators: magenta — query operators ($gt, $match, etc.)
 * - Databases, BSON, etc.: gray (default)
 */
function getKindColor(kind: CompletionCandidate['kind']): string {
    switch (kind) {
        case 'collection':
            return ANSI_CYAN;
        case 'method':
        case 'command':
            return ANSI_YELLOW;
        case 'field':
            return ANSI_GREEN;
        case 'operator':
        case 'bson':
            return ANSI_MAGENTA;
        case 'database':
        default:
            return ANSI_GRAY;
    }
}

/**
 * Formats a candidate label for display, adding visual hints based on kind.
 *
 * Methods get a trailing `()` suffix so users can distinguish
 * `restaurants` (collection) from `aggregate()` (method) at a glance.
 */
function formatDisplayLabel(candidate: CompletionCandidate): string {
    if (candidate.kind === 'method') {
        return candidate.label + '()';
    }
    return candidate.label;
}

/**
 * Renders completion candidates in a multi-column layout for the terminal.
 *
 * Output includes:
 * - Candidates arranged in columns (left-to-right, top-to-bottom)
 * - Gray ANSI coloring for visual distinction from output
 * - Truncation with "…and N more" indicator for long lists
 *
 * @param candidates - the candidates to display
 * @param terminalWidth - the terminal width in columns (default 80)
 * @returns the ANSI-formatted string to write to the terminal
 */
export function renderCompletionList(candidates: readonly CompletionCandidate[], terminalWidth: number = 80): string {
    if (candidates.length === 0) {
        return '';
    }

    // Single candidate — no list needed (will be completed inline)
    if (candidates.length === 1) {
        return '';
    }

    // Build display labels (methods get `()` suffix for visual distinction)
    const displayLabels = candidates.map(formatDisplayLabel);

    // Calculate column width from longest display label
    const maxLabelLen = Math.max(...displayLabels.map((l) => l.length));
    const colWidth = Math.max(maxLabelLen + COLUMN_PADDING, MIN_COLUMN_WIDTH);

    // Calculate number of columns that fit
    const numCols = Math.max(1, Math.floor(terminalWidth / colWidth));

    // Calculate number of rows
    const totalRows = Math.ceil(candidates.length / numCols);
    const displayRows = Math.min(totalRows, MAX_DISPLAY_ROWS);
    const displayCount = displayRows * numCols;
    const truncated = candidates.length > displayCount;
    const visibleCandidates = truncated ? candidates.slice(0, displayCount) : [...candidates];
    const visibleLabels = truncated ? displayLabels.slice(0, displayCount) : displayLabels;

    // Build the output with per-candidate coloring
    let output = '';

    for (let row = 0; row < displayRows; row++) {
        output += '\r\n';

        for (let col = 0; col < numCols; col++) {
            const idx = row * numCols + col;
            if (idx >= visibleCandidates.length) break;

            const candidate = visibleCandidates[idx];
            const label = visibleLabels[idx];
            const color = getKindColor(candidate.kind);

            // Pad to column width (except last column)
            const paddedLabel = col < numCols - 1 ? label.padEnd(colWidth) : label;
            output += color + paddedLabel + ANSI_RESET;
        }
    }

    if (truncated) {
        const remaining = candidates.length - displayCount;
        output += '\r\n' + ANSI_GRAY + `\u2026and ${String(remaining)} more` + ANSI_RESET;
    }

    return output;
}

/**
 * Finds the longest common prefix among the given candidates.
 * Used to insert the common prefix when multiple matches share a start.
 *
 * @param candidates - the candidates to find the common prefix of
 * @param currentPrefix - the prefix already typed by the user
 * @returns the additional text to insert (common prefix minus current prefix),
 *          or empty string if no additional common prefix exists
 */
export function findCommonPrefix(candidates: readonly CompletionCandidate[], currentPrefix: string): string {
    if (candidates.length === 0) {
        return '';
    }

    // Start with the first candidate's insertText
    let common = candidates[0].insertText;

    for (let i = 1; i < candidates.length; i++) {
        const text = candidates[i].insertText;
        let j = 0;
        while (j < common.length && j < text.length && common[j].toLowerCase() === text[j].toLowerCase()) {
            j++;
        }
        common = common.slice(0, j);
        if (common.length === 0) break;
    }

    // Return only the additional text beyond what's already typed.
    // Verify the common prefix actually starts with the typed prefix (case-insensitive)
    // to avoid misaligned slicing when insertText has a different structure
    // (e.g., quoted field paths like `"address.city"` vs typed prefix `add`).
    if (common.length > currentPrefix.length && common.toLowerCase().startsWith(currentPrefix.toLowerCase())) {
        return common.slice(currentPrefix.length);
    }

    return '';
}
