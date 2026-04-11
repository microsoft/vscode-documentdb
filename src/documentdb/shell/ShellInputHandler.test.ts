/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellInputHandler, type ShellInputHandlerCallbacks } from './ShellInputHandler';

describe('ShellInputHandler', () => {
    let handler: ShellInputHandler;
    let written: string;
    let lines: string[];
    let interrupts: number;

    beforeEach(() => {
        written = '';
        lines = [];
        interrupts = 0;

        const callbacks: ShellInputHandlerCallbacks = {
            write: (data: string) => {
                written += data;
            },
            onLine: (line: string) => {
                lines.push(line);
            },
            onInterrupt: () => {
                interrupts++;
            },
        };

        handler = new ShellInputHandler(callbacks);
        handler.setPromptWidth(5); // e.g. "db> "
    });

    describe('basic character input', () => {
        it('should echo printable characters', () => {
            handler.handleInput('a');
            expect(written).toBe('a');
            expect(handler.getBuffer()).toBe('a');
        });

        it('should accumulate characters in buffer', () => {
            handler.handleInput('h');
            handler.handleInput('e');
            handler.handleInput('l');
            handler.handleInput('l');
            handler.handleInput('o');
            expect(handler.getBuffer()).toBe('hello');
        });

        it('should handle multi-character input at once', () => {
            handler.handleInput('hello');
            expect(handler.getBuffer()).toBe('hello');
            expect(written).toBe('hello');
        });

        it('should ignore control characters below space (except special ones)', () => {
            handler.handleInput('\x00');
            handler.handleInput('\x02');
            handler.handleInput('\x04');
            expect(handler.getBuffer()).toBe('');
        });
    });

    describe('Enter key', () => {
        it('should deliver line on Enter', () => {
            handler.handleInput('test');
            handler.handleInput('\r');
            expect(lines).toEqual(['test']);
        });

        it('should deliver empty line on bare Enter', () => {
            handler.handleInput('\r');
            expect(lines).toEqual(['']);
        });

        it('should write newline on Enter', () => {
            handler.handleInput('x');
            written = ''; // reset to check only Enter output
            handler.handleInput('\r');
            expect(written).toBe('\r\n');
        });
    });

    describe('Backspace', () => {
        it('should delete character before cursor', () => {
            handler.handleInput('abc');
            handler.handleInput('\x7f'); // Backspace
            expect(handler.getBuffer()).toBe('ab');
        });

        it('should do nothing at start of line', () => {
            handler.handleInput('\x7f');
            expect(handler.getBuffer()).toBe('');
        });

        it('should handle backspace mid-line', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[D'); // Left arrow
            handler.handleInput('\x7f'); // Backspace — deletes 'b'
            expect(handler.getBuffer()).toBe('ac');
        });
    });

    describe('Ctrl+C', () => {
        it('should trigger interrupt', () => {
            handler.handleInput('test');
            handler.handleInput('\x03');
            expect(interrupts).toBe(1);
        });
    });

    describe('arrow key navigation', () => {
        it('should move cursor left', () => {
            handler.handleInput('abc');
            written = '';
            handler.handleInput('\x1b[D'); // Left
            expect(written).toBe('\x1b[D');
        });

        it('should not move cursor left past start', () => {
            handler.handleInput('a');
            handler.handleInput('\x1b[D'); // Left to start
            written = '';
            handler.handleInput('\x1b[D'); // Try left again
            expect(written).toBe(''); // No output — already at start
        });

        it('should move cursor right', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[D'); // Left
            written = '';
            handler.handleInput('\x1b[C'); // Right
            expect(written).toBe('\x1b[C');
        });

        it('should not move cursor right past end', () => {
            handler.handleInput('ab');
            written = '';
            handler.handleInput('\x1b[C'); // Try right — already at end
            expect(written).toBe(''); // No output
        });
    });

    describe('Home/End', () => {
        it('should move cursor to start with Home', () => {
            handler.handleInput('abc');
            written = '';
            handler.handleInput('\x1b[H'); // Home
            expect(written).toContain('\x1b[3D'); // Move left 3
        });

        it('should move cursor to end with End', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[H'); // Home
            written = '';
            handler.handleInput('\x1b[F'); // End
            expect(written).toContain('\x1b[3C'); // Move right 3
        });

        it('should handle Ctrl+A (Home)', () => {
            handler.handleInput('abc');
            written = '';
            handler.handleInput('\x01'); // Ctrl+A
            expect(written).toContain('\x1b[3D');
        });

        it('should handle Ctrl+E (End)', () => {
            handler.handleInput('abc');
            handler.handleInput('\x01'); // Ctrl+A — go home
            written = '';
            handler.handleInput('\x05'); // Ctrl+E — go end
            expect(written).toContain('\x1b[3C');
        });
    });

    describe('Delete key', () => {
        it('should delete character at cursor', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[H'); // Home
            handler.handleInput('\x1b[3~'); // Delete
            expect(handler.getBuffer()).toBe('bc');
        });

        it('should do nothing at end of line', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[3~'); // Delete — at end
            expect(handler.getBuffer()).toBe('abc');
        });
    });

    describe('Ctrl+U — clear before cursor', () => {
        it('should clear everything before cursor', () => {
            handler.handleInput('hello world');
            handler.handleInput('\x15'); // Ctrl+U
            expect(handler.getBuffer()).toBe('');
        });

        it('should preserve text after cursor when at mid-line', () => {
            handler.handleInput('abcdef');
            handler.handleInput('\x1b[D'); // Left
            handler.handleInput('\x1b[D'); // Left — cursor at position 4
            handler.handleInput('\x15'); // Ctrl+U
            expect(handler.getBuffer()).toBe('ef');
        });
    });

    describe('Ctrl+K — clear after cursor', () => {
        it('should clear everything after cursor', () => {
            handler.handleInput('hello');
            handler.handleInput('\x1b[H'); // Home
            handler.handleInput('\x0b'); // Ctrl+K
            expect(handler.getBuffer()).toBe('');
        });
    });

    describe('command history', () => {
        it('should navigate to previous command with Up arrow', () => {
            handler.handleInput('first\r');
            handler.resetLine();
            handler.handleInput('second\r');
            handler.resetLine();

            handler.handleInput('\x1b[A'); // Up
            expect(handler.getBuffer()).toBe('second');
        });

        it('should navigate through multiple history entries', () => {
            handler.handleInput('first\r');
            handler.resetLine();
            handler.handleInput('second\r');
            handler.resetLine();
            handler.handleInput('third\r');
            handler.resetLine();

            handler.handleInput('\x1b[A'); // Up — third
            expect(handler.getBuffer()).toBe('third');

            handler.handleInput('\x1b[A'); // Up — second
            expect(handler.getBuffer()).toBe('second');

            handler.handleInput('\x1b[A'); // Up — first
            expect(handler.getBuffer()).toBe('first');
        });

        it('should return to current input with Down arrow', () => {
            handler.handleInput('first\r');
            handler.resetLine();

            handler.handleInput('current');
            handler.handleInput('\x1b[A'); // Up — first
            expect(handler.getBuffer()).toBe('first');

            handler.handleInput('\x1b[B'); // Down — back to current
            expect(handler.getBuffer()).toBe('current');
        });

        it('should not add empty lines to history', () => {
            handler.handleInput('\r'); // empty Enter
            handler.resetLine();

            handler.handleInput('\x1b[A'); // Up — no history
            expect(handler.getBuffer()).toBe('');
        });

        it('should not add duplicate consecutive entries', () => {
            handler.handleInput('same\r');
            handler.resetLine();
            handler.handleInput('same\r');
            handler.resetLine();

            handler.handleInput('\x1b[A'); // Up — same
            expect(handler.getBuffer()).toBe('same');

            handler.handleInput('\x1b[A'); // Up — still same (only one entry)
            expect(handler.getBuffer()).toBe('same');
        });
    });

    describe('inserting characters mid-line', () => {
        it('should insert at cursor position', () => {
            handler.handleInput('ac');
            handler.handleInput('\x1b[D'); // Left — cursor between a and c
            handler.handleInput('b');
            expect(handler.getBuffer()).toBe('abc');
        });
    });

    describe('enable/disable', () => {
        it('should ignore input when disabled', () => {
            handler.setEnabled(false);
            handler.handleInput('test');
            expect(handler.getBuffer()).toBe('');
            expect(written).toBe('');
        });

        it('should resume processing when re-enabled', () => {
            handler.setEnabled(false);
            handler.handleInput('ignored');
            handler.setEnabled(true);
            handler.handleInput('visible');
            expect(handler.getBuffer()).toBe('visible');
        });
    });

    describe('word navigation', () => {
        it('should move to previous word start with Ctrl+Left', () => {
            handler.handleInput('hello world');
            written = '';
            handler.handleInput('\x1b[1;5D'); // Ctrl+Left
            // Should move cursor to position 6 (start of "world")
            expect(handler.getBuffer()).toBe('hello world');
        });

        it('should move to next word end with Ctrl+Right', () => {
            handler.handleInput('hello world');
            handler.handleInput('\x1b[H'); // Home
            written = '';
            handler.handleInput('\x1b[1;5C'); // Ctrl+Right
            // Should move past "hello"
            expect(handler.getBuffer()).toBe('hello world');
        });
    });

    describe('Ctrl+W — delete word before cursor', () => {
        it('should delete the last word', () => {
            handler.handleInput('hello world');
            handler.handleInput('\x17'); // Ctrl+W
            expect(handler.getBuffer()).toBe('hello ');
        });

        it('should do nothing at start of line', () => {
            handler.handleInput('\x17'); // Ctrl+W
            expect(handler.getBuffer()).toBe('');
        });
    });

    describe('resetLine', () => {
        it('should clear buffer and cursor', () => {
            handler.handleInput('test');
            handler.resetLine();
            expect(handler.getBuffer()).toBe('');
        });
    });
});
