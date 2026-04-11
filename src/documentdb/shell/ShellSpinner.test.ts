/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellSpinner } from './ShellSpinner';

/** Backspace-space-backspace sequence used to erase one character. */
const BS = '\b \b';

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

            expect(output).toBe('');
            expect(spinner.isVisible).toBe(true); // active, just not rendered yet

            spinner.stop();
        });

        it('should render after the delay elapses', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            jest.advanceTimersByTime(300);

            // cursor-hide + first frame character
            expect(output).toContain('\x1b[?25l');
            expect(output).toContain('⠋');

            spinner.stop();
        });

        it('should animate through frames using backspace', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            // First frame
            expect(output).toContain('⠋');

            output = '';
            jest.advanceTimersByTime(80);
            // Should backspace over previous frame & write new one
            expect(output).toContain(BS);
            expect(output).toContain('⠙');

            output = '';
            jest.advanceTimersByTime(80);
            expect(output).toContain(BS);
            expect(output).toContain('⠹');

            spinner.stop();
        });

        it('should erase spinner character on stop', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            output = '';
            spinner.stop();

            // Should erase the character + restore cursor
            expect(output).toContain(BS);
            expect(output).toContain('\x1b[?25h');
        });

        it('should not render if stopped before delay elapses', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            jest.advanceTimersByTime(100);
            spinner.stop();

            jest.advanceTimersByTime(500);
            expect(output).toBe('');
        });

        it('should be safe to call stop multiple times', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            spinner.stop();
            spinner.stop();
            spinner.stop();

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

            expect(output).toContain('\x1b[34m');
            expect(output).toContain('\x1b[0m');

            spinner.stop();
        });

        it('should not apply color codes when color is disabled', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            expect(output).not.toContain('\x1b[34m');
            expect(output).toContain('⠋');

            spinner.stop();
        });
    });

    describe('hide', () => {
        it('should erase the spinner character on hide', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            output = '';
            spinner.hide();
            expect(output).toContain(BS);

            spinner.stop();
        });

        it('should re-render on next interval tick after hide', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            spinner.hide();
            output = '';

            // Next tick should re-render without first erasing (since _rendered is false)
            jest.advanceTimersByTime(80);
            expect(output).toContain('⠙');
            // Should NOT contain a backspace before — nothing to erase
            expect(output).toBe('⠙');

            spinner.stop();
        });

        it('should be a no-op if spinner is not rendered', () => {
            const spinner = new ShellSpinner(write, false, 300);
            spinner.start();

            spinner.hide();
            expect(output).toBe('');

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

        it('should erase full label+spinner on stop', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Working...');
            spinner.start();
            jest.advanceTimersByTime(0);

            output = '';
            spinner.stop();

            // "⠋ Working..." = 1 + 1 + 10 = 12 visible chars → 12 backspace sequences
            // Count literal \x08 (backspace) characters in the output
            const bsCount = output.split('\x08').length - 1;
            // Each erase is \b \b = 2 backspace chars per visible char → 24 total
            expect(bsCount).toBe(24);
        });

        it('should update label via setLabel', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Step 1');
            spinner.start();
            jest.advanceTimersByTime(0);
            expect(output).toContain('Step 1');

            output = '';
            spinner.setLabel('Step 2');
            // Should erase old label+spinner then write new
            expect(output).toContain('Step 2');

            spinner.stop();
        });

        it('should remove label when setLabel(undefined) is called', () => {
            const spinner = new ShellSpinner(write, false, 0, 'Working...');
            spinner.start();
            jest.advanceTimersByTime(0);

            output = '';
            spinner.setLabel(undefined);
            // Should contain just the spinner character, no label text
            expect(output).toContain('⠋');
            expect(output).not.toContain('Working');

            spinner.stop();
        });

        it('should not re-render on setLabel if spinner is not rendered', () => {
            const spinner = new ShellSpinner(write, false, 300, 'Waiting...');
            spinner.start();

            spinner.setLabel('Changed');
            expect(output).toBe('');

            spinner.stop();
        });
    });

    describe('frame cycling', () => {
        it('should cycle back to first frame after full sequence', () => {
            const spinner = new ShellSpinner(write, false, 0);
            spinner.start();
            jest.advanceTimersByTime(0);

            // 10 frames — advance through 9 to reach last, then 1 more wraps
            for (let i = 0; i < 9; i++) {
                jest.advanceTimersByTime(80);
            }

            output = '';
            jest.advanceTimersByTime(80);
            expect(output).toContain('⠋');

            spinner.stop();
        });
    });
});
