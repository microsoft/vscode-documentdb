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
        if (text.length > 0) {
            write(`\x1b[${String(text.length)}D`);
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
