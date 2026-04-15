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

// ─── ANSI constants ──────────────────────────────────────────────────────────

/** Erase from cursor to end of line */
const ERASE_TO_EOL = '\x1b[K';

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

    private readonly _callbacks: ShellInputHandlerCallbacks;

    constructor(callbacks: ShellInputHandlerCallbacks) {
        this._callbacks = callbacks;
    }

    /**
     * Set the prompt width so cursor positioning accounts for it.
     */
    setPromptWidth(width: number): void {
        this._promptWidth = width;
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

        if (after.length > 0) {
            // Insert mode: write text + rest of line, move cursor back
            this._callbacks.write(text + after + '\b'.repeat(after.length));
        } else {
            // Append mode: just echo the text
            this._callbacks.write(text);
        }
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

        // Move cursor back to start of replaced region
        if (deleteCount > 0) {
            this._callbacks.write(`\x1b[${String(deleteCount)}D`);
        }

        // Write new text + remainder of line
        this._callbacks.write(text + after);

        // Erase leftover characters if replacement is shorter than deleted text
        const cleanup = Math.max(0, deleteCount - text.length);
        if (cleanup > 0) {
            this._callbacks.write(' '.repeat(cleanup) + '\b'.repeat(cleanup));
        }

        // Move cursor back to end of inserted text (before 'after' portion)
        if (after.length > 0) {
            this._callbacks.write('\b'.repeat(after.length));
        }

        this._cursor = before.length + text.length;
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
            this._callbacks.write('\x1b[D');
        }
    }

    private moveCursorRight(): void {
        if (this._cursor < this._buffer.length) {
            this._cursor++;
            this._callbacks.write('\x1b[C');
        }
    }

    private moveCursorTo(position: number): void {
        const target = Math.max(0, Math.min(position, this._buffer.length));
        if (target < this._cursor) {
            this._callbacks.write(`\x1b[${String(this._cursor - target)}D`);
        } else if (target > this._cursor) {
            this._callbacks.write(`\x1b[${String(target - this._cursor)}C`);
        }
        this._cursor = target;
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
     * 1. Move cursor to the start of the input area (after the prompt).
     * 2. Write the (optionally colorized) buffer content.
     * 3. Erase any leftover characters from the previous (longer) buffer.
     * 4. Reposition the cursor to the correct position.
     */
    private reRenderLine(): void {
        // Step 1: Move cursor to start of input area
        // Use carriage return + move right past the prompt
        let output = '\r';
        if (this._promptWidth > 0) {
            output += `\x1b[${String(this._promptWidth)}C`;
        }

        // Step 2: Write the buffer content, optionally colorized
        const displayText = this._callbacks.colorize ? this._callbacks.colorize(this._buffer) : this._buffer;
        output += displayText;

        // Step 3: Erase any leftover characters from previous render
        output += ERASE_TO_EOL;

        // Step 4: Reposition cursor if not at end of buffer
        const cursorOffset = this._buffer.length - this._cursor;
        if (cursorOffset > 0) {
            output += `\x1b[${String(cursorOffset)}D`;
        }

        this._callbacks.write(output);
    }
}
