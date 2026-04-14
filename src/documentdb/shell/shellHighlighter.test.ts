/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { colorizeShellInput } from './highlighting/colorizeShellInput';
import { ShellInputHandler, type ShellInputHandlerCallbacks } from './ShellInputHandler';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

/**
 * Create a ShellInputHandler wired up with the real highlighting pipeline.
 * Returns the handler and accessors for test assertions.
 */
function createHighlightedHandler(): {
    handler: ShellInputHandler;
    getWritten: () => string;
    getLastRender: () => string;
    getLines: () => string[];
    getContinuations: () => number;
} {
    let written = '';
    const lines: string[] = [];
    let continuations = 0;

    const callbacks: ShellInputHandlerCallbacks = {
        write: (data: string) => {
            written += data;
        },
        onLine: (line: string) => {
            lines.push(line);
        },
        onInterrupt: () => {
            // no-op for tests
        },
        onContinuation: () => {
            continuations++;
        },
        colorize: colorizeShellInput,
    };

    const handler = new ShellInputHandler(callbacks);
    handler.setPromptWidth(5); // e.g., "db> " (5 chars)

    return {
        handler,
        getWritten: () => written,
        getLastRender: () => {
            // Extract the last re-render (after the last \r)
            const lastCR = written.lastIndexOf('\r');
            return lastCR >= 0 ? written.slice(lastCR) : written;
        },
        getLines: () => lines,
        getContinuations: () => continuations,
    };
}

describe('Shell Syntax Highlighting (integrated)', () => {
    describe('typing a keyword', () => {
        it('should highlight "const" as cyan after typing all characters', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('const');

            const render = getLastRender();
            expect(render).toContain(`${CYAN}const${RESET}`);
        });

        it('should not highlight partial keyword "con"', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('con');

            const render = getLastRender();
            // "con" is not a keyword — should appear without cyan
            expect(render).not.toContain(`${CYAN}con${RESET}`);
            expect(render).toContain('con');
        });
    });

    describe('typing a string', () => {
        it('should highlight a complete double-quoted string in green', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('"hello"');

            const render = getLastRender();
            expect(render).toContain(GREEN);
            expect(render).toContain('hello');
        });
    });

    describe('typing a BSON constructor', () => {
        it('should highlight ObjectId in cyan', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('ObjectId');

            const render = getLastRender();
            expect(render).toContain(`${CYAN}ObjectId${RESET}`);
        });
    });

    describe('typing a DocumentDB operator', () => {
        it('should highlight $gt in yellow', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('$gt');

            const render = getLastRender();
            expect(render).toContain(`${YELLOW}$gt${RESET}`);
        });
    });

    describe('typing a shell command', () => {
        it('should highlight "show" in magenta', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('show');

            const render = getLastRender();
            expect(render).toContain(`${MAGENTA}show${RESET}`);
        });
    });

    describe('typing a number', () => {
        it('should highlight numbers in yellow', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('42');

            const render = getLastRender();
            expect(render).toContain(`${YELLOW}42${RESET}`);
        });
    });

    describe('backspace mid-word', () => {
        it('should update highlighting after backspace changes a keyword to non-keyword', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            // Type "const"
            handler.handleInput('const');
            let render = getLastRender();
            expect(render).toContain(`${CYAN}const${RESET}`);

            // Backspace twice → "con"
            handler.handleInput('\x7f\x7f');
            render = getLastRender();
            // "con" is not a keyword — no cyan
            expect(render).not.toContain(`${CYAN}con${RESET}`);

            // Type "le" → "conle"
            handler.handleInput('le');
            render = getLastRender();
            // "conle" is not a keyword — no cyan
            expect(render).not.toContain(CYAN);
        });
    });

    describe('history recall', () => {
        it('should highlight recalled lines', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            // Type and submit "const x = 1"
            handler.handleInput('const x = 1\r');
            handler.resetLine();

            // Recall with Up arrow
            handler.handleInput('\x1b[A');

            const render = getLastRender();
            // The recalled line should be highlighted
            expect(render).toContain(`${CYAN}const${RESET}`);
            expect(render).toContain(`${YELLOW}1${RESET}`);
        });
    });

    describe('clear line (Ctrl+U)', () => {
        it('should produce empty output after Ctrl+U', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('db.find()');
            handler.handleInput('\x15'); // Ctrl+U

            expect(handler.getBuffer()).toBe('');
            // After clearing, the render should not contain any colored content
            const render = getLastRender();
            expect(render).not.toContain(CYAN);
            expect(render).not.toContain(GREEN);
            expect(render).not.toContain(YELLOW);
            expect(render).not.toContain(MAGENTA);
        });
    });

    describe('mixed expression', () => {
        it('should correctly highlight db.users.find({ $gt: 1 })', () => {
            const { handler, getLastRender } = createHighlightedHandler();

            handler.handleInput('db.users.find({ $gt: 1 })');

            const render = getLastRender();
            // $gt should be yellow (DocumentDB operator)
            expect(render).toContain(`${YELLOW}$gt${RESET}`);
            // 1 should be yellow (number)
            expect(render).toContain(`${YELLOW}1${RESET}`);
            // db, users, find are identifiers — no special color
        });
    });

    describe('colorize disabled', () => {
        it('should not add ANSI codes when colorize is not provided', () => {
            let written = '';
            const callbacks: ShellInputHandlerCallbacks = {
                write: (data: string) => {
                    written += data;
                },
                onLine: () => {},
                onInterrupt: () => {},
                onContinuation: () => {},
                // No colorize callback
            };

            const handler = new ShellInputHandler(callbacks);
            handler.setPromptWidth(5);
            handler.handleInput('const x = 1');

            // Should not contain any ANSI color codes
            expect(written).not.toContain('\x1b[36m'); // Cyan
            expect(written).not.toContain('\x1b[33m'); // Yellow
            expect(written).toContain('const x = 1');
        });
    });
});
