/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Handles keystroke processing, line editing, cursor movement, and command history
 * for the interactive shell Pseudoterminal.
 *
 * This class translates raw terminal input sequences into line-editing operations
 * and produces the correct ANSI escape sequences for visual feedback.
 */

import { isExpressionIncomplete } from './bracketDepthCounter';
import { terminalDisplayWidth } from './terminalDisplayWidth';

// ─── ANSI constants ──────────────────────────────────────────────────────────

/**
 * Callbacks for the ShellInputHandler to communicate with the Pseudoterminal.
 */
export interface ShellInputHandlerCallbacks {
    /** Write text to the terminal (visual feedback for keystrokes). */
    write: (data: string) => void;
    /** Called when the user presses Enter — delivers the completed line. */
    onLine: (line: string) => void;
    /** Called when the user presses Ctrl+C. */
    onInterrupt: () => void;
    /** Called when multi-line continuation is needed (PTY shows a continuation prompt). */
    onContinuation: () => void;
    /** Optional: colorize the input buffer for syntax highlighting. */
    colorize?: (input: string) => string;
    /** Called when the user presses Tab — the PTY handles completion logic. */
    onTab?: (buffer: string, cursor: number) => void;
    /** Called after any buffer/cursor change — the PTY uses this for ghost text. */
    onBufferChange?: (buffer: string, cursor: number) => void;
    /** Called when the user presses Right Arrow at end of buffer with ghost text visible. */
    onAcceptGhostText?: () => string | undefined;
}

/** Word character pattern for word navigation (Ctrl+Left/Right). */
const WORD_CHAR_PATTERN = /[a-zA-Z0-9_$]/;
function isWordChar(ch: string): boolean {
    return WORD_CHAR_PATTERN.test(ch);
}

export class ShellInputHandler {
    /** Current line buffer (characters the user has typed). */
    private _buffer: string = '';
    /** Cursor position within the buffer (0 = start of input). */
    private _cursor: number = 0;
    /** Command history — most recent last. */
    private readonly _history: string[] = [];
    /** Current index into history when navigating with Up/Down. -1 = not navigating. */
    private _historyIndex: number = -1;
    /** Saved input from before history navigation started. */
    private _savedInput: string = '';
    /** Maximum history entries. */
    private readonly _maxHistory: number = 500;

    /** Whether input is currently accepted. */
    private _enabled: boolean = true;

    /** Accumulated lines when building a multi-line expression. */
    private _multiLineBuffer: string[] = [];
    /** Remaining paste data to process after the current command finishes executing. */
    private _pendingInput: string = '';

    /** Accumulated escape sequence buffer for multi-byte sequences. */
    private _escapeBuffer: string = '';
    /** Whether we are in the middle of reading an escape sequence. */
    private _inEscape: boolean = false;

    /** Width of the prompt string in characters (for cursor repositioning). */
    private _promptWidth: number = 0;

    /** Terminal width in columns (for wrap-aware re-rendering). */
    private _columns: number = 80;

    /**
     * Tracks the terminal row (relative to the prompt row) where the cursor
     * was left after the last {@link reRenderLine} call. Used in Step 1 of
     * the next re-render to move up the correct number of rows.
     */
    private _lastCursorRow: number = 0;

    private readonly _callbacks: ShellInputHandlerCallbacks;

    constructor(callbacks: ShellInputHandlerCallbacks) {
        this._callbacks = callbacks;
    }

    /**
     * Set the prompt width so cursor positioning accounts for it.
     */
    setPromptWidth(width: number): void {
        this._promptWidth = width;
        // Always called when the cursor is at a fresh prompt row, so reset
        // the tracked cursor row to avoid stale values from the previous line.
        this._lastCursorRow = 0;
    }

    /**
     * Set the terminal width in columns (for wrap-aware re-rendering).
     */
    setColumns(columns: number): void {
        this._columns = columns;
        // Reset tracked cursor row — after a resize xterm.js reflows content,
        // making the previous _lastCursorRow stale.
        this._lastCursorRow = 0;
    }

    /**
     * Enable or disable input processing.
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }

    /**
     * Whether input is currently enabled.
     */
    get isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * Whether the handler is currently accumulating a multi-line expression.
     */
    get isInMultiLineMode(): boolean {
        return this._multiLineBuffer.length > 0;
    }

    /**
     * Reset input state (buffer, cursor, multi-line buffer). Called when displaying a new prompt.
     */
    resetLine(): void {
        this._buffer = '';
        this._cursor = 0;
        this._historyIndex = -1;
        this._savedInput = '';
        this._multiLineBuffer = [];
        this._lastCursorRow = 0;
    }

    /**
     * Process any input that was queued while a command was executing.
     * Called by the PTY after evaluation completes and a new prompt is shown.
     */
    processPendingInput(): void {
        if (this._pendingInput.length > 0) {
            const data = this._pendingInput;
            this._pendingInput = '';
            this.handleInput(data);
        }
    }

    /**
     * Get the current line buffer content.
     */
    getBuffer(): string {
        return this._buffer;
    }

    /**
     * Get the current cursor position within the buffer.
     */
    getCursor(): number {
        return this._cursor;
    }

    /**
     * Force a re-render of the current line (used after PTY-controlled mutations
     * like rewriting the prompt after a completion list is shown).
     */
    renderCurrentLine(): void {
        this.reRenderLine();
    }

    /**
     * Insert text at the current cursor position and update the display.
     * Used by the PTY to insert accepted completions or ghost text.
     *
     * NOTE: This method intentionally does NOT fire `onBufferChange`. It is a
     * PTY-controlled mutation — the PTY is responsible for any follow-up
     * evaluations (e.g., ghost text) after calling this method.
     */
    insertText(text: string): void {
        const before = this._buffer.slice(0, this._cursor);
        const after = this._buffer.slice(this._cursor);
        this._buffer = before + text + after;
        this._cursor += text.length;
        this.reRenderLine();
    }

    /**
     * Replace text before the cursor and insert new text.
     * Used by the PTY when a completion needs to replace the typed prefix
     * (e.g., quoting a dotted field path: `address.ci` → `"address.city"`).
     *
     * NOTE: Like {@link insertText}, this does NOT fire `onBufferChange`.
     *
     * @param deleteCount - number of characters to delete before the cursor
     * @param text - the replacement text to insert
     */
    replaceText(deleteCount: number, text: string): void {
        // Safety: don't delete beyond buffer start
        deleteCount = Math.min(deleteCount, this._cursor);

        const before = this._buffer.slice(0, this._cursor - deleteCount);
        const after = this._buffer.slice(this._cursor);
        this._buffer = before + text + after;
        this._cursor = before.length + text.length;
        this.reRenderLine();
    }

    /**
     * Process raw terminal input data from `handleInput(data)`.
     *
     * Terminal input arrives as individual characters or escape sequences.
     * This method handles:
     * - Printable characters: insert at cursor, echo
     * - Enter (`\r`): deliver line, reset buffer
     * - Backspace (`\x7f`): delete character before cursor
     * - Delete (`\x1b[3~`): delete character at cursor
     * - Left/Right arrows (`\x1b[D`/`\x1b[C`): move cursor
     * - Home/End (`\x1b[H`/`\x1b[F`, `\x1b[1~`/`\x1b[4~`): jump to start/end
     * - Up/Down arrows (`\x1b[A`/`\x1b[B`): history navigation
     * - Ctrl+A / Ctrl+E: home / end
     * - Ctrl+C (`\x03`): interrupt
     * - Ctrl+U: clear line before cursor
     * - Ctrl+K: clear line after cursor
     * - Ctrl+W: delete word before cursor
     * - Ctrl+Left/Right: word navigation
     */
    handleInput(data: string): void {
        // Ctrl+C must always be processed, even when input is disabled,
        // so the user can cancel a running evaluation.
        if (!this._enabled) {
            if (data === '\x03') {
                this._callbacks.onInterrupt();
            }
            return;
        }

        // Use index-based iteration so we can save remaining characters
        // when a command fires onLine (paste queue support).
        for (let i = 0; i < data.length; i++) {
            // If onLine was called (command submitted), queue remaining input
            // for processing after the command finishes executing.
            if (!this._enabled) {
                this._pendingInput += data.slice(i);
                return;
            }

            const ch = data[i];

            if (this._inEscape) {
                this._escapeBuffer += ch;
                if (this.isEscapeComplete(this._escapeBuffer)) {
                    this.processEscapeSequence(this._escapeBuffer);
                    this._escapeBuffer = '';
                    this._inEscape = false;
                }
                continue;
            }

            if (ch === '\x1b') {
                this._inEscape = true;
                this._escapeBuffer = '\x1b';
                continue;
            }

            this.processCharacter(ch);
        }
    }

    // ─── Private: character processing ───────────────────────────────────────

    private processCharacter(ch: string): void {
        switch (ch) {
            case '\r': // Enter (CR)
            case '\n': // Enter (LF — from pasted text with Unix newlines)
                this.handleEnter();
                break;
            case '\x7f': // Backspace
                this.handleBackspace();
                break;
            case '\x03': // Ctrl+C
                if (this._multiLineBuffer.length > 0) {
                    // Cancel multi-line accumulation without killing the worker
                    this._multiLineBuffer = [];
                }
                this._callbacks.onInterrupt();
                break;
            case '\x01': // Ctrl+A — Home
                this.moveCursorTo(0);
                break;
            case '\x05': // Ctrl+E — End
                this.moveCursorTo(this._buffer.length);
                break;
            case '\x15': // Ctrl+U — clear line before cursor
                this.clearBeforeCursor();
                break;
            case '\x0b': // Ctrl+K — clear line after cursor
                this.clearAfterCursor();
                break;
            case '\x17': // Ctrl+W — delete word before cursor
                this.deleteWordBeforeCursor();
                break;
            case '\x09': // Tab — completion
                this._callbacks.onTab?.(this._buffer, this._cursor);
                break;
            default:
                // Printable characters (>= space, not DEL)
                if (ch >= ' ') {
                    this.insertCharacter(ch);
                    this._callbacks.onBufferChange?.(this._buffer, this._cursor);
                }
                break;
        }
    }

    private handleEnter(): void {
        const currentLine = this._buffer;

        // Build the full text from accumulated multi-line buffer + current line
        const allLines = [...this._multiLineBuffer, currentLine];
        const fullText = allLines.join('\n');

        // Check if the expression is incomplete (unclosed brackets, strings, etc.)
        if (isExpressionIncomplete(fullText)) {
            // Accumulate: push current line, show continuation prompt
            this._multiLineBuffer.push(currentLine);
            this._buffer = '';
            this._cursor = 0;
            this._callbacks.write('\r\n');
            this._callbacks.onContinuation();
            return;
        }

        // Expression is complete — add to history and deliver

        // For history, store the full multi-line text. When recalled,
        // newlines are replaced with spaces for single-line display.
        const historyEntry = this._multiLineBuffer.length > 0 ? fullText : currentLine;

        if (historyEntry.trim().length > 0) {
            if (this._history.length === 0 || this._history[this._history.length - 1] !== historyEntry) {
                this._history.push(historyEntry);
                if (this._history.length > this._maxHistory) {
                    this._history.shift();
                }
            }
        }

        // Clear multi-line state
        this._multiLineBuffer = [];

        // Write newline to terminal
        this._callbacks.write('\r\n');

        // Deliver the full text
        this._callbacks.onLine(fullText);
    }

    private handleBackspace(): void {
        if (this._cursor <= 0) {
            return;
        }

        this._buffer = this._buffer.slice(0, this._cursor - 1) + this._buffer.slice(this._cursor);
        this._cursor--;
        this.reRenderLine();
        this._callbacks.onBufferChange?.(this._buffer, this._cursor);
    }

    private insertCharacter(ch: string): void {
        this._buffer = this._buffer.slice(0, this._cursor) + ch + this._buffer.slice(this._cursor);
        this._cursor++;
        this.reRenderLine();
    }

    // ─── Private: escape sequence handling ───────────────────────────────────

    /**
     * Check if an escape sequence buffer is complete (ready to process).
     */
    private isEscapeComplete(seq: string): boolean {
        // CSI sequences: \x1b[ ... <letter>
        if (seq.length >= 3 && seq[1] === '[') {
            const last = seq[seq.length - 1];
            // CSI terminates with a letter (A-Z, a-z) or ~
            if ((last >= 'A' && last <= 'Z') || (last >= 'a' && last <= 'z') || last === '~') {
                return true;
            }
            // Limit to reasonable length to avoid stuck escape state
            if (seq.length > 8) {
                return true;
            }
            return false;
        }
        // SS3 sequences: \x1bO<letter> (used by some terminals for Home/End/F-keys)
        if (seq.length >= 3 && seq[1] === 'O') {
            return true;
        }
        // Single char after ESC (e.g., \x1bb, \x1bf for word navigation)
        if (seq.length === 2 && seq[1] !== '[' && seq[1] !== 'O') {
            return true;
        }
        return false;
    }

    private processEscapeSequence(seq: string): void {
        switch (seq) {
            case '\x1b[A': // Up arrow — history previous
                this.historyPrevious();
                break;
            case '\x1b[B': // Down arrow — history next
                this.historyNext();
                break;
            case '\x1b[C': // Right arrow — move cursor right or accept ghost text
                if (this._cursor >= this._buffer.length) {
                    // At end of buffer — try to accept ghost text
                    const accepted = this._callbacks.onAcceptGhostText?.();
                    if (accepted) {
                        // Ghost text was accepted — insertText handles display
                        return;
                    }
                }
                this.moveCursorRight();
                break;
            case '\x1b[D': // Left arrow — move cursor left
                this.moveCursorLeft();
                break;
            case '\x1b[H': // Home
            case '\x1b[1~': // Home (alternate)
            case '\x1bOH': // Home (SS3)
                this.moveCursorTo(0);
                break;
            case '\x1b[F': // End
            case '\x1b[4~': // End (alternate)
            case '\x1bOF': // End (SS3)
                this.moveCursorTo(this._buffer.length);
                break;
            case '\x1b[3~': // Delete key
                this.handleDelete();
                break;
            case '\x1b[1;5C': // Ctrl+Right — word right
            case '\x1bf': // Alt+F — word right (macOS)
                this.wordRight();
                break;
            case '\x1b[1;5D': // Ctrl+Left — word left
            case '\x1bb': // Alt+B — word left (macOS)
                this.wordLeft();
                break;
            // Unknown sequences are silently ignored
        }
    }

    // ─── Private: cursor movement ────────────────────────────────────────────

    private moveCursorLeft(): void {
        if (this._cursor > 0) {
            this._cursor--;
            // Use full re-render to correctly handle row-boundary crossings.
            // Simple \x1b[D does not wrap to the previous row in xterm.js.
            this.reRenderLine();
        }
    }

    private moveCursorRight(): void {
        if (this._cursor < this._buffer.length) {
            this._cursor++;
            // Use full re-render to correctly handle row-boundary crossings.
            // Simple \x1b[C does not advance to the next row in xterm.js.
            this.reRenderLine();
        }
    }

    private moveCursorTo(position: number): void {
        const target = Math.max(0, Math.min(position, this._buffer.length));
        if (target !== this._cursor) {
            this._cursor = target;
            // Use full re-render to correctly handle row-boundary crossings.
            // Simple \x1b[nD / \x1b[nC do not cross row boundaries.
            this.reRenderLine();
        }
    }

    private wordLeft(): void {
        if (this._cursor <= 0) {
            return;
        }
        let pos = this._cursor - 1;
        // Skip non-word characters (whitespace, punctuation)
        while (pos > 0 && !isWordChar(this._buffer[pos])) {
            pos--;
        }
        // Skip word characters
        while (pos > 0 && isWordChar(this._buffer[pos - 1])) {
            pos--;
        }
        this.moveCursorTo(pos);
    }

    private wordRight(): void {
        if (this._cursor >= this._buffer.length) {
            return;
        }
        let pos = this._cursor;
        // Skip current word characters
        while (pos < this._buffer.length && isWordChar(this._buffer[pos])) {
            pos++;
        }
        // Skip non-word characters (whitespace, punctuation)
        while (pos < this._buffer.length && !isWordChar(this._buffer[pos])) {
            pos++;
        }
        this.moveCursorTo(pos);
    }

    // ─── Private: editing operations ─────────────────────────────────────────

    private handleDelete(): void {
        if (this._cursor >= this._buffer.length) {
            return;
        }

        this._buffer = this._buffer.slice(0, this._cursor) + this._buffer.slice(this._cursor + 1);
        this.reRenderLine();
        this._callbacks.onBufferChange?.(this._buffer, this._cursor);
    }

    private clearBeforeCursor(): void {
        if (this._cursor <= 0) {
            return;
        }

        this._buffer = this._buffer.slice(this._cursor);
        this._cursor = 0;
        this.reRenderLine();
        this._callbacks.onBufferChange?.(this._buffer, this._cursor);
    }

    private clearAfterCursor(): void {
        this._buffer = this._buffer.slice(0, this._cursor);
        this.reRenderLine();
        this._callbacks.onBufferChange?.(this._buffer, this._cursor);
    }

    private deleteWordBeforeCursor(): void {
        if (this._cursor <= 0) {
            return;
        }

        let pos = this._cursor - 1;
        // Skip whitespace
        while (pos > 0 && this._buffer[pos] === ' ') {
            pos--;
        }
        // Skip word characters
        while (pos > 0 && this._buffer[pos - 1] !== ' ') {
            pos--;
        }

        this._buffer = this._buffer.slice(0, pos) + this._buffer.slice(this._cursor);
        this._cursor = pos;
        this.reRenderLine();
        this._callbacks.onBufferChange?.(this._buffer, this._cursor);
    }

    // ─── Private: history navigation ─────────────────────────────────────────

    private historyPrevious(): void {
        if (this._history.length === 0) {
            return;
        }

        if (this._historyIndex === -1) {
            // Starting to navigate — save current input
            this._savedInput = this._buffer;
            this._historyIndex = this._history.length - 1;
        } else if (this._historyIndex > 0) {
            this._historyIndex--;
        } else {
            // Already at oldest entry
            return;
        }

        this.replaceLineWith(this._history[this._historyIndex]);
    }

    private historyNext(): void {
        if (this._historyIndex === -1) {
            return;
        }

        if (this._historyIndex < this._history.length - 1) {
            this._historyIndex++;
            this.replaceLineWith(this._history[this._historyIndex]);
        } else {
            // Past newest entry — restore saved input
            this._historyIndex = -1;
            this.replaceLineWith(this._savedInput);
        }
    }

    /**
     * Replace the entire current line buffer with new text and update the display.
     * Multi-line history entries are flattened to a single line (newlines → spaces).
     */
    private replaceLineWith(newText: string): void {
        // Flatten multi-line history entries for single-line display
        const displayText = newText.replace(/\n/g, ' ');

        this._buffer = displayText;
        this._cursor = displayText.length;
        this.reRenderLine();
    }

    // ─── Private: line re-rendering ──────────────────────────────────────────

    /**
     * Re-render the entire input line with syntax highlighting.
     *
     * This replaces the old per-character echo approach. On every buffer mutation:
     * 1. Move cursor up to the prompt row using the tracked {@link _lastCursorRow}.
     * 2. Move cursor to the start of the input area (after the prompt).
     * 3. Write the (optionally colorized) buffer content.
     * 4. Erase any leftover characters/rows from the previous (longer) buffer.
     * 5. Reposition the cursor to the correct row and column.
     *
     * Row calculations use a deferred-wrap–aware formula: when content exactly
     * fills a terminal row, the cursor stays on that row (not the next) until
     * another character is written.  The formula
     * `absCol > 0 ? Math.floor((absCol - 1) / cols) : 0` accounts for this.
     */
    private reRenderLine(): void {
        const bufferWidth = terminalDisplayWidth(this._buffer);
        const cursorDisplayOffset = terminalDisplayWidth(this._buffer.slice(0, this._cursor));
        const cols = this._columns;

        let output = '';

        // Step 1: Move cursor up to the prompt row.
        // Uses _lastCursorRow (set at the end of the previous call) instead of
        // re-deriving from the new buffer state, which would be wrong because the
        // buffer has already been mutated before this method runs.
        if (this._lastCursorRow > 0) {
            output += `\x1b[${String(this._lastCursorRow)}A`;
        }

        // Step 2: Carriage return + move right past the prompt
        output += '\r';
        if (this._promptWidth > 0) {
            output += `\x1b[${String(this._promptWidth)}C`;
        }

        // Step 3: Write the buffer content, optionally colorized
        const displayText = this._callbacks.colorize ? this._callbacks.colorize(this._buffer) : this._buffer;
        output += displayText;

        // Step 4: Erase from cursor to end of screen (handles wrapped leftover rows)
        output += '\x1b[J';

        // Step 5: Reposition cursor to the correct position.
        // After writing the buffer the terminal cursor is at an absolute column
        // that may be in "deferred wrap" state (exactly fills a row).  We use
        // \r to normalize to column 0 of the current physical row, then navigate
        // to the target row and column with relative movements.
        const endAbsCol = this._promptWidth + bufferWidth;
        const targetAbsCol = this._promptWidth + cursorDisplayOffset;

        if (cols > 0 && endAbsCol !== targetAbsCol) {
            // Deferred-wrap–aware row: when absCol is an exact multiple of cols
            // the cursor hasn't wrapped yet — it's still on the previous row.
            const endRow = endAbsCol > 0 ? Math.floor((endAbsCol - 1) / cols) : 0;
            const targetRow = targetAbsCol > 0 ? Math.floor((targetAbsCol - 1) / cols) : 0;

            // \r normalizes to column 0, avoiding deferred-wrap column ambiguity.
            output += '\r';

            // Move up from end row to target row
            const rowDiff = endRow - targetRow;
            if (rowDiff > 0) {
                output += `\x1b[${String(rowDiff)}A`;
            }

            // Move right to target column (CUF is capped at cols-1 by the terminal,
            // which is visually correct for the deferred-wrap edge case).
            const targetCol = targetAbsCol > 0 ? ((targetAbsCol - 1) % cols) + 1 : 0;
            if (targetCol > 0) {
                output += `\x1b[${String(targetCol)}C`;
            }

            this._lastCursorRow = targetRow;
        } else if (cols > 0) {
            // Cursor is at end of buffer — already positioned correctly.
            this._lastCursorRow = endAbsCol > 0 ? Math.floor((endAbsCol - 1) / cols) : 0;
        } else {
            // Fallback for unknown columns: simple cursor-back
            const tailWidth = terminalDisplayWidth(this._buffer.slice(this._cursor));
            if (tailWidth > 0) {
                output += `\x1b[${String(tailWidth)}D`;
            }
            this._lastCursorRow = 0;
        }

        this._callbacks.write(output);
    }
}
