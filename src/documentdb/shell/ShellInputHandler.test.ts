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
            handler.handleInput('\x1b[D'); // Left
            expect(handler.getCursor()).toBe(2);
            // Re-render output contains the buffer with repositioned cursor
            expect(written).toContain('abc');
        });

        it('should not move cursor left past start', () => {
            handler.handleInput('a');
            handler.handleInput('\x1b[D'); // Left to start
            written = '';
            handler.handleInput('\x1b[D'); // Try left again
            expect(handler.getCursor()).toBe(0);
            expect(written).toBe(''); // No output — already at start
        });

        it('should move cursor right', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[D'); // Left
            handler.handleInput('\x1b[C'); // Right
            expect(handler.getCursor()).toBe(3);
            // Re-render output contains the buffer
            expect(written).toContain('abc');
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
            handler.handleInput('\x1b[H'); // Home
            expect(handler.getCursor()).toBe(0);
        });

        it('should move cursor to end with End', () => {
            handler.handleInput('abc');
            handler.handleInput('\x1b[H'); // Home
            handler.handleInput('\x1b[F'); // End
            expect(handler.getCursor()).toBe(3);
        });

        it('should handle Ctrl+A (Home)', () => {
            handler.handleInput('abc');
            handler.handleInput('\x01'); // Ctrl+A
            expect(handler.getCursor()).toBe(0);
        });

        it('should handle Ctrl+E (End)', () => {
            handler.handleInput('abc');
            handler.handleInput('\x01'); // Ctrl+A — go home
            handler.handleInput('\x05'); // Ctrl+E — go end
            expect(handler.getCursor()).toBe(3);
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

    describe('Tab key', () => {
        it('should call onTab callback with buffer and cursor', () => {
            let tabBuffer = '';
            let tabCursor = -1;
            const tabCallbacks: ShellInputHandlerCallbacks = {
                write: () => {},
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                onTab: (buffer: string, cursor: number) => {
                    tabBuffer = buffer;
                    tabCursor = cursor;
                },
            };

            const tabHandler = new ShellInputHandler(tabCallbacks);
            tabHandler.handleInput('db.us');
            tabHandler.handleInput('\x09'); // Tab
            expect(tabBuffer).toBe('db.us');
            expect(tabCursor).toBe(5);
        });

        it('should not crash when onTab is not provided', () => {
            // Default handler has no onTab
            handler.handleInput('test');
            handler.handleInput('\x09'); // Tab
            // Should not throw
            expect(handler.getBuffer()).toBe('test');
        });
    });

    describe('getCursor', () => {
        it('should return current cursor position', () => {
            handler.handleInput('hello');
            expect(handler.getCursor()).toBe(5);
        });

        it('should track cursor after left arrow', () => {
            handler.handleInput('hello');
            handler.handleInput('\x1b[D'); // Left
            expect(handler.getCursor()).toBe(4);
        });
    });

    describe('insertText', () => {
        it('should insert text at cursor and update buffer', () => {
            handler.handleInput('db.');
            handler.insertText('users');
            expect(handler.getBuffer()).toBe('db.users');
            expect(handler.getCursor()).toBe(8);
        });

        it('should insert text in the middle of existing buffer', () => {
            handler.handleInput('hello');
            handler.handleInput('\x1b[D'); // Left arrow once
            handler.handleInput('\x1b[D'); // Left arrow twice
            handler.insertText('XX');
            expect(handler.getBuffer()).toBe('helXXlo');
            expect(handler.getCursor()).toBe(5);
        });
    });

    describe('replaceText', () => {
        it('should replace text before cursor with new text', () => {
            handler.handleInput('address.ci');
            handler.replaceText(10, '"address.city"');
            expect(handler.getBuffer()).toBe('"address.city"');
            expect(handler.getCursor()).toBe(14);
        });

        it('should handle replacement shorter than deleted text', () => {
            handler.handleInput('longprefix');
            handler.replaceText(10, 'short');
            expect(handler.getBuffer()).toBe('short');
            expect(handler.getCursor()).toBe(5);
        });

        it('should handle replacement longer than deleted text', () => {
            handler.handleInput('ab');
            handler.replaceText(2, '"address.city"');
            expect(handler.getBuffer()).toBe('"address.city"');
            expect(handler.getCursor()).toBe(14);
        });

        it('should preserve text after cursor', () => {
            handler.handleInput('find({ address.ci })');
            // Move cursor to after 'ci' (position 16)
            for (let i = 0; i < 3; i++) handler.handleInput('\x1b[D'); // Left x3 to go before ' })'
            handler.replaceText(10, '"address.city"');
            expect(handler.getBuffer()).toBe('find({ "address.city" })');
        });

        it('should not delete beyond buffer start', () => {
            handler.handleInput('ab');
            handler.replaceText(100, 'replacement');
            expect(handler.getBuffer()).toBe('replacement');
            expect(handler.getCursor()).toBe(11);
        });

        it('should handle zero deleteCount (pure insert)', () => {
            handler.handleInput('hello');
            handler.replaceText(0, 'X');
            expect(handler.getBuffer()).toBe('helloX');
            expect(handler.getCursor()).toBe(6);
        });
    });

    describe('onBufferChange callback', () => {
        it('should fire after printable char insertion', () => {
            let changeCount = 0;
            const changeCallbacks: ShellInputHandlerCallbacks = {
                write: () => {},
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                onBufferChange: () => {
                    changeCount++;
                },
            };

            const changeHandler = new ShellInputHandler(changeCallbacks);
            changeHandler.handleInput('abc');
            expect(changeCount).toBe(3);
        });

        it('should fire after backspace', () => {
            let lastBuffer = '';
            const changeCallbacks: ShellInputHandlerCallbacks = {
                write: () => {},
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                onBufferChange: (buffer: string) => {
                    lastBuffer = buffer;
                },
            };

            const changeHandler = new ShellInputHandler(changeCallbacks);
            changeHandler.handleInput('ab');
            changeHandler.handleInput('\x7f'); // Backspace
            expect(lastBuffer).toBe('a');
        });
    });

    describe('ghost text acceptance via Right Arrow', () => {
        it('should call onAcceptGhostText when at end of buffer', () => {
            let ghostCalled = false;
            const ghostCallbacks: ShellInputHandlerCallbacks = {
                write: () => {},
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                onAcceptGhostText: () => {
                    ghostCalled = true;
                    return 'aurants';
                },
            };

            const ghostHandler = new ShellInputHandler(ghostCallbacks);
            ghostHandler.handleInput('db.rest');
            ghostHandler.handleInput('\x1b[C'); // Right arrow
            expect(ghostCalled).toBe(true);
        });

        it('should not call onAcceptGhostText when not at end of buffer', () => {
            let ghostCalled = false;
            const ghostCallbacks: ShellInputHandlerCallbacks = {
                write: () => {},
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                onAcceptGhostText: () => {
                    ghostCalled = true;
                    return 'text';
                },
            };

            const ghostHandler = new ShellInputHandler(ghostCallbacks);
            ghostHandler.handleInput('hello');
            ghostHandler.handleInput('\x1b[D'); // Left arrow
            ghostHandler.handleInput('\x1b[C'); // Right arrow
            expect(ghostCalled).toBe(false);
        });
    });

    describe('line wrapping', () => {
        /**
         * Helper: parse the ANSI output to extract the "move up" count from
         * Step 1 of reRenderLine().  Returns 0 if no CUU sequence is found.
         */
        function extractMoveUp(output: string): number {
            // \x1b[<n>A at the START of the output = Step 1 move-up
            // eslint-disable-next-line no-control-regex
            const match = /^\x1b\[(\d+)A/.exec(output);
            return match ? Number(match[1]) : 0;
        }

        it('should NOT move up when typing stays within a single row', () => {
            // prompt=5, cols=80 → 75 chars fit on the first row
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(10));
            written = '';
            handler.handleInput('b');
            // Still on row 0, no move-up expected
            expect(extractMoveUp(written)).toBe(0);
        });

        it('should NOT incorrectly move up at the exact column boundary (deferred-wrap)', () => {
            // prompt=5, cols=80: typing 75 chars fills exactly to column 80
            // The terminal cursor is in deferred-wrap on row 0, NOT row 1.
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(75)); // fills row 0 exactly
            written = '';
            handler.handleInput('b'); // this is the 76th char, wraps to row 1
            // Step 1 should move up 0 rows (cursor WAS on row 0 from the previous render)
            expect(extractMoveUp(written)).toBe(0);
        });

        it('should move up 1 row when cursor is on the second row', () => {
            // prompt=5, cols=80: 76 chars = prompt+buffer = 81 cols → wraps to row 1
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(76)); // cursor ends up on row 1
            written = '';
            handler.handleInput('b'); // 77th char, still on row 1
            // Previous render left cursor on row 1, so Step 1 should move up 1
            expect(extractMoveUp(written)).toBe(1);
        });

        it('should handle cursor movement across row boundaries with Left arrow', () => {
            // prompt=5, cols=80: 76 chars wraps.
            // Char 75 is at (row 0, col 79), char 76 is at (row 1, col 0).
            // Moving left from col 0 of row 1 should cross to row 0, col 79.
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(76)); // cursor at end (row 1, col 1)
            handler.handleInput('\x1b[D'); // Left → cursor at pos 75, (row 1, col 0)
            handler.handleInput('\x1b[D'); // Left → cursor at pos 74, (row 0, col 79)
            expect(handler.getCursor()).toBe(74);
            // Buffer unchanged
            expect(handler.getBuffer()).toBe('a'.repeat(76));
        });

        it('should handle Home across wrapped rows', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(100)); // wraps across 2 rows
            handler.handleInput('\x1b[H'); // Home
            expect(handler.getCursor()).toBe(0);
        });

        it('should handle End across wrapped rows', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(100));
            handler.handleInput('\x1b[H'); // Home
            handler.handleInput('\x1b[F'); // End
            expect(handler.getCursor()).toBe(100);
        });

        it('should handle backspace at the wrap boundary', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(76)); // wraps to row 1
            handler.handleInput('\x7f'); // Backspace — remove last char
            expect(handler.getBuffer()).toBe('a'.repeat(75));
            expect(handler.getCursor()).toBe(75);
        });

        it('should handle double wrap boundary (160+ cols)', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(155)); // 5+155=160 → exactly fills 2 rows
            written = '';
            handler.handleInput('b'); // wraps to row 2
            // Previous render left cursor at deferred-wrap on row 1
            // Step 1 should move up 1 (not 2)
            expect(extractMoveUp(written)).toBe(1);
        });

        it('should re-render correctly when pasting text that wraps', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            // Paste 100 chars at once
            const pastedText = 'x'.repeat(100);
            handler.handleInput(pastedText);
            expect(handler.getBuffer()).toBe(pastedText);
            expect(handler.getCursor()).toBe(100);
        });

        it('should handle insert in the middle of a wrapped line', () => {
            handler.setColumns(80);
            handler.setPromptWidth(5);
            handler.handleInput('a'.repeat(100));
            // Move cursor to position 50 (middle of first row)
            handler.handleInput('\x1b[H'); // Home
            for (let i = 0; i < 50; i++) handler.handleInput('\x1b[C'); // Right x50
            expect(handler.getCursor()).toBe(50);
            handler.handleInput('X'); // Insert in middle
            expect(handler.getBuffer()).toBe('a'.repeat(50) + 'X' + 'a'.repeat(50));
        });
    });
});
