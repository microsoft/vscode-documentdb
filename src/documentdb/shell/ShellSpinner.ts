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

/**
 * ANSI escape: move cursor to column 1 and clear the entire line.
 */
const CLEAR_LINE = '\r\x1b[K';

/** ANSI escape: hide the text cursor. */
const CURSOR_HIDE = '\x1b[?25l';
/** ANSI escape: show the text cursor. */
const CURSOR_SHOW = '\x1b[?25h';

/**
 * DocumentDB blue — used for the spinner when color output is enabled.
 * ANSI 256-color code 33 is a standard blue that works well on both
 * dark and light terminal backgrounds.
 */
const ANSI_BLUE = '\x1b[34m';
const ANSI_RESET = '\x1b[0m';

/** Default delay before showing the spinner, in milliseconds. */
const DEFAULT_DELAY_MS = 300;

/** Frame interval for the animation, in milliseconds. 80ms matches ora/cli-spinners "dots". */
const FRAME_INTERVAL_MS = 80;

/**
 * An inline terminal spinner that shows the classic Braille dot animation
 * during long-running command evaluations.
 *
 * The spinner starts after a configurable delay so that fast commands
 * complete without any visual noise. It renders on the current line
 * using carriage-return overwrites and is erased cleanly when stopped.
 *
 * Usage:
 * ```ts
 * const spinner = new ShellSpinner(text => writeEmitter.fire(text));
 * spinner.start();          // begins delay countdown
 * // ... await long operation ...
 * spinner.stop();           // erases spinner, restores line
 * ```
 */
export class ShellSpinner {
    private _delayTimer: ReturnType<typeof setTimeout> | undefined;
    private _frameTimer: ReturnType<typeof setInterval> | undefined;
    private _frameIndex = 0;
    private _visible = false;
    private _stopped = false;
    private _label: string | undefined;

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
        this._stopped = false;
        this._delayTimer = setTimeout(() => {
            if (this._stopped) {
                return;
            }
            this._visible = true;
            this._write(CURSOR_HIDE);
            this.renderFrame();
            this._frameTimer = setInterval(() => {
                this._frameIndex = (this._frameIndex + 1) % SPINNER_FRAMES.length;
                this.renderFrame();
            }, FRAME_INTERVAL_MS);
        }, this._delayMs);
    }

    /**
     * Stop the spinner and erase it from the terminal line.
     * Safe to call multiple times or before the spinner becomes visible.
     */
    stop(): void {
        this._stopped = true;

        if (this._delayTimer !== undefined) {
            clearTimeout(this._delayTimer);
            this._delayTimer = undefined;
        }

        if (this._frameTimer !== undefined) {
            clearInterval(this._frameTimer);
            this._frameTimer = undefined;
        }

        if (this._visible) {
            // Erase the spinner line and restore the cursor
            this._write(CLEAR_LINE + CURSOR_SHOW);
            this._visible = false;
        }

        this._frameIndex = 0;
    }

    /**
     * Change the label text. Pass `undefined` to remove it.
     * If the spinner is visible, the frame is re-rendered immediately.
     */
    setLabel(label: string | undefined): void {
        this._label = label;
        if (this._visible && !this._stopped) {
            this.renderFrame();
        }
    }

    /**
     * Whether the spinner is currently visible on the terminal.
     * Used to coordinate with console output that may arrive mid-spin.
     */
    get isVisible(): boolean {
        return this._visible;
    }

    /**
     * Temporarily hide the spinner (erase the line) so that other output
     * can be written cleanly, then resume the animation.
     *
     * Call this before writing console output (e.g., `print()`) that
     * arrives while the spinner is active.
     */
    hide(): void {
        if (this._visible) {
            this._write(CLEAR_LINE);
        }
    }

    /**
     * Re-render the current frame after a {@link hide} call.
     */
    show(): void {
        if (this._visible && !this._stopped) {
            this.renderFrame();
        }
    }

    private renderFrame(): void {
        const frame = SPINNER_FRAMES[this._frameIndex];
        const colorFrame = this._colorEnabled ? `${ANSI_BLUE}${frame}${ANSI_RESET}` : frame;
        const display = this._label ? `${colorFrame} ${this._label}` : colorFrame;
        this._write(`${CLEAR_LINE}${display}`);
    }
}
