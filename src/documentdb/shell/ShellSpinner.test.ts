/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellSpinner } from './ShellSpinner';

describe('ShellSpinner', () => {
    let output: string;
    let write: (data: string) => void;

    beforeEach(() => {
        jest.useFakeTimers();
        output = '';
        write = (data: string) => {
            output += data;
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('start and stop', () => {
        it('should not render immediately — waits for delay', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            // No output yet — delay hasn't elapsed
            expect(output).toBe('');
            expect(spinner.isVisible).toBe(false);

            spinner.stop();
        });

        it('should render after the delay elapses', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            jest.advanceTimersByTime(300);

            expect(spinner.isVisible).toBe(true);
            // First frame is the first Braille dot
            expect(output).toContain('⠋');

            spinner.stop();
        });

        it('should animate through frames', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();

            // Frame 0 appears immediately (delay=0)
            jest.advanceTimersByTime(0);
            expect(output).toContain('⠋');

            // Advance to next frame
            output = '';
            jest.advanceTimersByTime(80);
            expect(output).toContain('⠙');

            // Advance again
            output = '';
            jest.advanceTimersByTime(80);
            expect(output).toContain('⠹');

            spinner.stop();
        });

        it('should hide cursor when spinner becomes visible', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            // Should contain the cursor-hide escape
            expect(output).toContain('\x1b[?25l');

            spinner.stop();
        });

        it('should clear the line and restore cursor when stopped', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            expect(spinner.isVisible).toBe(true);

            output = '';
            spinner.stop();

            // Should have written clear-line and cursor-show escapes
            expect(output).toContain('\r\x1b[K');
            expect(output).toContain('\x1b[?25h');
            expect(spinner.isVisible).toBe(false);
        });

        it('should not render if stopped before delay elapses', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            // Stop before 300ms
            jest.advanceTimersByTime(100);
            spinner.stop();

            // Advance past original delay — should not render
            jest.advanceTimersByTime(500);
            expect(output).toBe('');
            expect(spinner.isVisible).toBe(false);
        });

        it('should be safe to call stop multiple times', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            spinner.stop();
            spinner.stop();
            spinner.stop();

            // No error; still cleaned up
            expect(spinner.isVisible).toBe(false);
        });

        it('should be safe to call stop without start', () => {
            const spinner = new ShellSpinner(write, false);
            spinner.stop();
            expect(output).toBe('');
        });
    });

    describe('color', () => {
        it('should apply ANSI blue when color is enabled', () => {
            const spinner = new ShellSpinner(write, true, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            // ANSI blue escape code
            expect(output).toContain('\x1b[34m');
            expect(output).toContain('\x1b[0m');

            spinner.stop();
        });

        it('should not apply color codes when color is disabled', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            expect(output).not.toContain('\x1b[34m');
            expect(output).not.toContain('\x1b[0m');
            // Still has the Braille character
            expect(output).toContain('⠋');

            spinner.stop();
        });
    });

    describe('hide and show', () => {
        it('should clear the line on hide without stopping', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            output = '';
            spinner.hide();
            expect(output).toContain('\r\x1b[K');
            // Still visible — hide doesn't change the visible flag
            expect(spinner.isVisible).toBe(true);

            spinner.stop();
        });

        it('should re-render current frame on show', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            spinner.hide();
            output = '';
            spinner.show();

            // Re-renders the current frame
            expect(output).toContain('⠋');

            spinner.stop();
        });

        it('should not render on show if stopped', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            spinner.stop();
            output = '';
            spinner.show();

            // Nothing rendered — spinner was stopped
            expect(output).toBe('');
        });

        it('should not clear on hide if not visible', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();
            // Don't advance — spinner not yet visible

            spinner.hide();
            expect(output).toBe('');

            spinner.stop();
        });
    });

    describe('frame cycling', () => {
        it('should cycle back to first frame after full sequence', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            // 10 frames in the Braille sequence
            // Advance through all 10 frames (9 intervals to get back to frame 0)
            for (let i = 0; i < 9; i++) {
                jest.advanceTimersByTime(80);
            }

            // After 9 intervals we're at frame 9; one more wraps to frame 0 (⠋)
            output = '';
            jest.advanceTimersByTime(80);
            expect(output).toContain('⠋');

            spinner.stop();
        });
    });

    describe('label', () => {
        it('should render label text after the spinner character', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Loading...');
            spinner.start();
            jest.advanceTimersByTime(0);

            expect(output).toContain('⠋ Loading...');

            spinner.stop();
        });

        it('should update label via setLabel', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Step 1');
            spinner.start();
            jest.advanceTimersByTime(0);
            expect(output).toContain('Step 1');

            output = '';
            spinner.setLabel('Step 2');
            expect(output).toContain('Step 2');

            spinner.stop();
        });

        it('should remove label when setLabel(undefined) is called', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Working...');
            spinner.start();
            jest.advanceTimersByTime(0);
            expect(output).toContain('⠋ Working...');

            output = '';
            spinner.setLabel(undefined);
            // Should render just the spinner character, no trailing text
            expect(output).toContain('⠋');
            expect(output).not.toContain('Working');

            spinner.stop();
        });

        it('should not re-render on setLabel if spinner is not visible', () => {
            const spinner = new ShellSpinner(write, false, 300, 'Waiting...');
            spinner.start();

            // Not yet visible — setLabel should not produce output
            spinner.setLabel('Changed');
            expect(output).toBe('');

            spinner.stop();
        });
    });
});
