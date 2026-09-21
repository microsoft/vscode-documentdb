/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ghost text (inline suggestion) rendering for the interactive shell.
 *
 * Shows a dim suggestion after the cursor when there is a single
 * obvious completion. The user accepts the ghost text with Right Arrow
 * or Tab, or dismisses it by typing another character or pressing Escape.
 *
 * Ghost text is rendered using ANSI dim intensity without assigning a color,
 * then the cursor is repositioned back to the editing position so the user
 * continues typing at the same location.
 */

import { shellAnsi, shellStyles } from './shellStyles';
import { clipToDisplayWidth, terminalDisplayWidth } from './terminalDisplayWidth';

// ─── ANSI constants ──────────────────────────────────────────────────────────

/** Erase from cursor to end of line. */
const ERASE_TO_EOL = '\x1b[K';
/** Appended when the suggestion is too wide to fit on the current row. */
const ELLIPSIS = '…';

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
    /** The possibly-clipped text actually written to the terminal. */
    private _renderedGhost: string = '';
    /** Whether ghost text is currently visible. */
    private _visible: boolean = false;

    constructor(private readonly _isColorEnabled: () => boolean = () => true) {}

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
     * @param availableColumns - columns left on the cursor's row; the text is
     * clipped to fit. Omit only when the width is genuinely unknown — an
     * unclipped suggestion that wraps strands the cursor on the next row,
     * because the cursor-back sequence below cannot move between rows.
     * @returns `true` if new ghost text was rendered, `false` if skipped (empty or unchanged)
     */
    show(text: string, write: (data: string) => void, availableColumns?: number): boolean {
        if (!text || text.length === 0) {
            this.clear(write);
            return false;
        }

        let renderText = text;
        if (availableColumns !== undefined && terminalDisplayWidth(text) > availableColumns) {
            // Reserve one column for the ellipsis marker.
            renderText = clipToDisplayWidth(text, availableColumns - 1);
            if (renderText.length === 0) {
                this.clear(write);
                return false;
            }
            renderText += ELLIPSIS;
        }

        // If the same ghost text is already showing, don't re-render
        if (this._visible && this._currentGhost === text && this._renderedGhost === renderText) {
            return false;
        }

        // Clear any existing ghost text first
        if (this._visible) {
            write(ERASE_TO_EOL);
        }

        this._currentGhost = text;
        this._renderedGhost = renderText;
        this._visible = true;

        // Ghost text communicates reduced emphasis, not a semantic color category.
        write(this._isColorEnabled() ? shellStyles.ghostText + renderText + shellAnsi.reset : renderText);
        const displayWidth = terminalDisplayWidth(renderText);
        if (displayWidth > 0) {
            write(`\x1b[${String(displayWidth)}D`);
        }

        return true;
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
        this._renderedGhost = '';
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
        this._renderedGhost = '';
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
        this._renderedGhost = '';
        this._visible = false;
    }
}
