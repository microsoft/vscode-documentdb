/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Braille spinner frames — the classic npm/ora "dots" animation.
 * A single dot rotates around the Braille cell. All characters are the
 * same width in monospace fonts.
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** ANSI escape: hide the text cursor. */
const CURSOR_HIDE = '\x1b[?25l';
/** ANSI escape: show the text cursor. */
const CURSOR_SHOW = '\x1b[?25h';

/**
 * DocumentDB blue — used for the spinner when color output is enabled.
 */
const ANSI_BLUE = '\x1b[34m';
const ANSI_RESET = '\x1b[0m';

/**
 * Erase one character behind the cursor: backspace, space (overwrite), backspace.
 */
const ERASE_CHAR = '\b \b';

/** Default delay before showing the spinner, in milliseconds. */
const DEFAULT_DELAY_MS = 300;

/** Frame interval for the animation, in milliseconds. 80ms matches ora/cli-spinners "dots". */
const FRAME_INTERVAL_MS = 80;

/**
 * An inline terminal spinner that renders a single animated character
 * at the current cursor position.
 *
 * Unlike line-clearing spinners, this uses backspace (`\b`) to overwrite
 * only its own character, leaving all prior content on the line intact.
 * This makes it safe to use alongside streamed console output (e.g.,
 * `print()` without a trailing newline).
 *
 * Usage:
 * ```ts
 * const spinner = new ShellSpinner(text => writeEmitter.fire(text));
 * spinner.start();          // begins delay countdown
 * // ... await long operation ...
 * spinner.stop();           // erases spinner character, restores cursor
 * ```
 */
export class ShellSpinner {
    private _delayTimer: ReturnType<typeof setTimeout> | undefined;
    private _frameTimer: ReturnType<typeof setInterval> | undefined;
    private _frameIndex = 0;
    /** Whether the spinner has been started and not yet stopped. */
    private _active = false;
    /** Whether a spinner character is currently written on screen. */
    private _rendered = false;
    private _stopped = false;
    private _label: string | undefined;
    /**
     * How many visible characters were last written for the spinner
     * (frame char + optional " label").
     */
    private _lastWriteLen = 0;

    /**
     * @param _write - Callback to write raw text to the terminal.
     * @param _colorEnabled - Whether to apply ANSI color to the spinner.
     * @param _delayMs - Milliseconds to wait before showing the spinner.
     * @param label - Optional text displayed after the spinner character.
     */
    constructor(
        private readonly _write: (data: string) => void,
        private readonly _colorEnabled: boolean = true,
        private readonly _delayMs: number = DEFAULT_DELAY_MS,
        label?: string,
    ) {
        this._label = label;
    }

    /**
     * Start the spinner. The animation won't appear immediately —
     * it waits {@link _delayMs} first.
     */
    start(): void {
        this.stop();
        this._stopped = false;
        this._active = true;
        this._delayTimer = setTimeout(() => {
            if (this._stopped) {
                return;
            }
            this._write(CURSOR_HIDE);
            this.renderFrame();
            this._frameTimer = setInterval(() => {
                this._frameIndex = (this._frameIndex + 1) % SPINNER_FRAMES.length;
                this.renderFrame();
            }, FRAME_INTERVAL_MS);
        }, this._delayMs);
    }

    /**
     * Stop the spinner and erase its character from the terminal.
     * Safe to call multiple times or before the spinner becomes visible.
     */
    stop(): void {
        this._stopped = true;
        this._active = false;

        if (this._delayTimer !== undefined) {
            clearTimeout(this._delayTimer);
            this._delayTimer = undefined;
        }

        if (this._frameTimer !== undefined) {
            clearInterval(this._frameTimer);
            this._frameTimer = undefined;
        }

        if (this._rendered) {
            this.eraseSpinner();
            this._write(CURSOR_SHOW);
            this._rendered = false;
        }

        this._frameIndex = 0;
    }

    /**
     * Change the label text. Pass `undefined` to remove it.
     * If the spinner is rendered, the frame is re-rendered immediately.
     */
    setLabel(label: string | undefined): void {
        this._label = label;
        if (this._rendered && !this._stopped) {
            this.eraseSpinner();
            this.writeFrame();
        }
    }

    /**
     * Whether the spinner is currently active (started and not stopped).
     * Used to coordinate with console output that may arrive mid-spin.
     */
    get isVisible(): boolean {
        return this._active;
    }

    /**
     * Erase the spinner character so that other output can be written
     * at the cursor position. The spinner will re-render on the next
     * interval tick automatically.
     *
     * Call this before writing console output that arrives while the
     * spinner is active.
     */
    hide(): void {
        if (this._rendered) {
            this.eraseSpinner();
            this._rendered = false;
        }
    }

    // ─── Private ─────────────────────────────────────────────────────────

    private renderFrame(): void {
        // If a previous frame is on screen, erase it first
        if (this._rendered) {
            this.eraseSpinner();
        }
        this.writeFrame();
    }

    private writeFrame(): void {
        const frame = SPINNER_FRAMES[this._frameIndex];
        const colorFrame = this._colorEnabled ? `${ANSI_BLUE}${frame}${ANSI_RESET}` : frame;
        const display = this._label ? `${colorFrame} ${this._label}` : colorFrame;
        // Track visible length (1 char + optional space + label length)
        this._lastWriteLen = this._label ? 2 + this._label.length : 1;
        this._write(display);
        this._rendered = true;
    }

    private eraseSpinner(): void {
        // Backspace over each visible character we wrote
        this._write(ERASE_CHAR.repeat(this._lastWriteLen));
    }
}
