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
    let continuations: number;

    beforeEach(() => {
        written = '';
        lines = [];
        interrupts = 0;
        continuations = 0;

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
            onContinuation: () => {
                continuations++;
            },
        };

        handler = new ShellInputHandler(callbacks);
        handler.setPromptWidth(5); // e.g. "db> "
    });

    describe('basic character input', () => {
        it('should echo printable characters', () => {
            handler.handleInput('a');
            expect(handler.getBuffer()).toBe('a');
            // The re-render output contains ANSI positioning + the character
            expect(written).toContain('a');
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
            // The re-render output contains ANSI positioning + the full text
            expect(written).toContain('hello');
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

        it('should clear multi-line buffer', () => {
            handler.handleInput('db.test.find({');
            handler.handleInput('\r'); // continuation
            expect(handler.isInMultiLineMode).toBe(true);

            handler.resetLine();
            expect(handler.isInMultiLineMode).toBe(false);
        });
    });

    describe('multi-line input', () => {
        it('should show continuation when expression has unclosed brace', () => {
            handler.handleInput('db.test.find({');
            handler.handleInput('\r');

            expect(lines).toEqual([]);
            expect(continuations).toBe(1);
            expect(handler.isInMultiLineMode).toBe(true);
        });

        it('should show continuation when expression has unclosed bracket', () => {
            handler.handleInput('db.test.aggregate([');
            handler.handleInput('\r');

            expect(lines).toEqual([]);
            expect(continuations).toBe(1);
        });

        it('should show continuation when expression has unclosed paren', () => {
            handler.handleInput('db.test.find(');
            handler.handleInput('\r');

            expect(lines).toEqual([]);
            expect(continuations).toBe(1);
        });

        it('should execute when expression is completed', () => {
            handler.handleInput('db.test.find({');
            handler.handleInput('\r'); // continuation
            handler.handleInput('  age: 25');
            handler.handleInput('\r'); // continuation
            handler.handleInput('})');
            handler.handleInput('\r'); // execute

            expect(lines).toEqual(['db.test.find({\n  age: 25\n})']);
            expect(continuations).toBe(2);
        });

        it('should execute balanced expression immediately', () => {
            handler.handleInput('db.test.find({ age: 25 })');
            handler.handleInput('\r');

            expect(lines).toEqual(['db.test.find({ age: 25 })']);
            expect(continuations).toBe(0);
        });

        it('should execute plain text commands immediately', () => {
            handler.handleInput('show dbs');
            handler.handleInput('\r');

            expect(lines).toEqual(['show dbs']);
            expect(continuations).toBe(0);
        });

        it('should clear multi-line buffer on Ctrl+C', () => {
            handler.handleInput('db.test.find({');
            handler.handleInput('\r'); // continuation

            expect(handler.isInMultiLineMode).toBe(true);

            handler.handleInput('\x03'); // Ctrl+C

            expect(handler.isInMultiLineMode).toBe(false);
            expect(interrupts).toBe(1);
        });

        it('should handle \\n (LF) the same as \\r (CR)', () => {
            handler.handleInput('show dbs');
            handler.handleInput('\n');

            expect(lines).toEqual(['show dbs']);
        });

        it('should handle pasted multi-line text with \\n newlines', () => {
            handler.handleInput('db.test.find({\n  age: 25\n})');
            handler.handleInput('\r');

            expect(lines).toEqual(['db.test.find({\n  age: 25\n})']);
        });

        it('should store multi-line commands as single history entry', () => {
            handler.handleInput('db.test.find({');
            handler.handleInput('\r');
            handler.handleInput('})');
            handler.handleInput('\r');

            expect(lines).toEqual(['db.test.find({\n})']);

            // Reset and navigate history
            handler.resetLine();
            handler.handleInput('\x1b[A'); // Up arrow

            // Multi-line history recalled as single line (newlines → spaces)
            expect(handler.getBuffer()).toBe('db.test.find({ })');
        });

        it('should show continuation for unterminated string', () => {
            handler.handleInput("db.test.find({ name: 'hello");
            handler.handleInput('\r');

            expect(lines).toEqual([]);
            expect(continuations).toBe(1);
        });
    });

    describe('paste queue', () => {
        it('should queue remaining input when command is submitted', () => {
            // Simulate the PTY disabling input after onLine fires.
            // The handler's onLine callback will disable input, simulating
            // what the PTY does when it starts evaluating.
            const disablingCallbacks: ShellInputHandlerCallbacks = {
                write: (data: string) => {
                    written += data;
                },
                onLine: (line: string) => {
                    lines.push(line);
                    disablingHandler.setEnabled(false);
                },
                onInterrupt: () => {
                    interrupts++;
                },
                onContinuation: () => {
                    continuations++;
                },
            };

            const disablingHandler = new ShellInputHandler(disablingCallbacks);

            // Paste two commands separated by \n
            disablingHandler.handleInput('show dbs\nuse mydb\n');

            // First command should have been delivered
            expect(lines).toEqual(['show dbs']);

            // Re-enable and process pending input
            disablingHandler.setEnabled(true);
            disablingHandler.resetLine();
            disablingHandler.processPendingInput();

            // Second command should now be delivered
            expect(lines).toEqual(['show dbs', 'use mydb']);
        });
    });
});
