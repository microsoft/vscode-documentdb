/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ghost text (inline suggestion) rendering for the interactive shell.
 *
 * Shows a dim, gray suggestion after the cursor when there is a single
 * obvious completion. The user accepts the ghost text with Right Arrow
 * or Tab, or dismisses it by typing another character or pressing Escape.
 *
 * Ghost text is rendered using ANSI dim + gray escape codes (`\x1b[2m\x1b[90m`)
 * and the cursor is repositioned back to the editing position so the user
 * continues typing at the same location.
 */

// ─── ANSI constants ──────────────────────────────────────────────────────────

/** Dim + gray for ghost text appearance. */
const GHOST_STYLE = '\x1b[2m\x1b[90m';
const ANSI_RESET = '\x1b[0m';
/** Erase from cursor to end of line. */
const ERASE_TO_EOL = '\x1b[K';

/**
 * Compute the display-column width of a string for the terminal.
 *
 * JavaScript's `String.length` counts UTF-16 code units, but ANSI cursor
 * movement operates on display columns. Surrogate pairs (emoji, symbols
 * above U+FFFF) are 2 code units but typically 1–2 terminal columns.
 *
 * This uses `Intl.Segmenter` (available in Node 16+) to iterate grapheme
 * clusters and counts each one as 1 column unless it is a known
 * full-width/wide character (CJK Unified Ideographs, etc.).
 */
function terminalDisplayWidth(text: string): number {
    // Fast path: ASCII-only strings (common case)
    if (/^[\x20-\x7e]*$/.test(text)) {
        return text.length;
    }

    let width = 0;
    // Use Intl.Segmenter to properly iterate grapheme clusters
    // This handles surrogate pairs, combining marks, ZWJ sequences, etc.
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const { segment } of segmenter.segment(text)) {
        const cp = segment.codePointAt(0) ?? 0;
        // Full-width / wide characters occupy 2 columns
        if (isWideCharacter(cp)) {
            width += 2;
        } else {
            width += 1;
        }
    }

    return width;
}

/**
 * Returns true for code points that occupy 2 terminal columns.
 * Covers CJK Unified Ideographs and common full-width ranges.
 */
function isWideCharacter(cp: number): boolean {
    return (
        (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals, Kangxi, CJK Symbols
        (cp >= 0x3040 && cp <= 0x33bf) || // Hiragana, Katakana, Bopomofo, etc.
        (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
        (cp >= 0x4e00 && cp <= 0xa4cf) || // CJK Unified Ideographs + Yi
        (cp >= 0xa960 && cp <= 0xa97c) || // Hangul Jamo Extended-A
        (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
        (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Compatibility Forms
        (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
        (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth Signs
        (cp >= 0x20000 && cp <= 0x2fffd) || // CJK Unified Ideographs Extension B+
        (cp >= 0x30000 && cp <= 0x3fffd) // CJK Unified Ideographs Extension G+
    );
}

/**
 * Manages the lifecycle of ghost text in the terminal.
 *
 * Usage:
 * 1. Call {@link show} with the suggestion text and a write function
 * 2. Call {@link clear} before any buffer modification
 * 3. Call {@link accept} when the user wants to accept the suggestion
 */
export class ShellGhostText {
    /** The currently displayed ghost text (empty if none). */
    private _currentGhost: string = '';
    /** Whether ghost text is currently visible. */
    private _visible: boolean = false;

    /**
     * Whether ghost text is currently visible.
     */
    get isVisible(): boolean {
        return this._visible;
    }

    /**
     * The currently displayed ghost text.
     */
    get currentText(): string {
        return this._currentGhost;
    }

    /**
     * Show ghost text after the cursor position.
     *
     * @param text - the suggestion text to display (the part NOT yet typed)
     * @param write - function to write ANSI data to the terminal
     */
    show(text: string, write: (data: string) => void): void {
        if (!text || text.length === 0) {
            this.clear(write);
            return;
        }

        // If the same ghost text is already showing, don't re-render
        if (this._visible && this._currentGhost === text) {
            return;
        }

        // Clear any existing ghost text first
        if (this._visible) {
            write(ERASE_TO_EOL);
        }

        this._currentGhost = text;
        this._visible = true;

        // Write ghost text in dim gray, then move cursor back
        write(GHOST_STYLE + text + ANSI_RESET);
        const displayWidth = terminalDisplayWidth(text);
        if (displayWidth > 0) {
            write(`\x1b[${String(displayWidth)}D`);
        }
    }

    /**
     * Clear the currently displayed ghost text.
     *
     * @param write - function to write ANSI data to the terminal
     */
    clear(write: (data: string) => void): void {
        if (!this._visible) {
            return;
        }

        // Erase the ghost text from the display
        write(ERASE_TO_EOL);

        this._currentGhost = '';
        this._visible = false;
    }

    /**
     * Accept the currently displayed ghost text.
     *
     * Returns the ghost text that was accepted (for insertion into the buffer).
     * Clears the ghost state without erasing (the accepted text will be
     * re-rendered in normal color by the caller).
     *
     * @param write - function to write ANSI data to the terminal
     * @returns the accepted ghost text, or empty string if none was visible
     */
    accept(write: (data: string) => void): string {
        if (!this._visible || !this._currentGhost) {
            return '';
        }

        const accepted = this._currentGhost;
        this._currentGhost = '';
        this._visible = false;

        // Erase the dim ghost text
        write(ERASE_TO_EOL);
        // Write the accepted text in normal color
        write(accepted);

        return accepted;
    }

    /**
     * Reset ghost text state without writing anything to the terminal.
     * Used when the prompt is reset or the line is cleared.
     */
    reset(): void {
        this._currentGhost = '';
        this._visible = false;
    }
}
