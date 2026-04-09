/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { type SerializableExecutionResult } from '../playground/workerTypes';
import { ShellOutputFormatter } from './ShellOutputFormatter';

describe('ShellOutputFormatter', () => {
    let formatter: ShellOutputFormatter;

    beforeEach(() => {
        formatter = new ShellOutputFormatter();

        // Default: color enabled
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: jest.fn((_key: string, defaultValue?: unknown) => {
                if (_key === 'documentDB.shell.display.colorOutput') {
                    return true;
                }
                return defaultValue;
            }),
        } as unknown as vscode.WorkspaceConfiguration);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function makeResult(overrides: Partial<SerializableExecutionResult>): SerializableExecutionResult {
        return {
            type: null,
            printable: '""',
            durationMs: 0,
            ...overrides,
        };
    }

    describe('formatResult', () => {
        it('should format a simple string result', () => {
            const result = makeResult({
                type: 'string',
                printable: EJSON.stringify('hello', { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toBe('hello');
        });

        it('should format a number result with ANSI color', () => {
            const result = makeResult({
                type: 'number',
                printable: EJSON.stringify(42, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('42');
            expect(output).toContain('\x1b[33m'); // Yellow
        });

        it('should format a boolean result with ANSI color', () => {
            const result = makeResult({
                type: 'boolean',
                printable: EJSON.stringify(true, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('true');
            expect(output).toContain('\x1b[35m'); // Magenta
        });

        it('should format null result with ANSI color', () => {
            const result = makeResult({
                type: null,
                printable: EJSON.stringify(null, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('null');
            expect(output).toContain('\x1b[35m'); // Magenta
        });

        it('should format a document result as pretty-printed JSON', () => {
            const doc = { name: 'test', count: 5 };
            const result = makeResult({
                type: 'Document',
                printable: EJSON.stringify(doc, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('"name"');
            expect(output).toContain('"test"');
            expect(output).toContain('5');
        });

        it('should format an array of documents', () => {
            const docs = [{ a: 1 }, { a: 2 }];
            const result = makeResult({
                type: 'Cursor',
                printable: EJSON.stringify(docs, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('"a"');
        });

        it('should show "Type it for more" when cursor has more results', () => {
            const docs = [{ x: 1 }];
            const result = makeResult({
                type: 'Cursor',
                printable: EJSON.stringify(docs, { relaxed: false }),
                cursorHasMore: true,
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('Type "it" for more');
        });

        it('should not show "Type it for more" when cursor is exhausted', () => {
            const docs = [{ x: 1 }];
            const result = makeResult({
                type: 'Cursor',
                printable: EJSON.stringify(docs, { relaxed: false }),
                cursorHasMore: false,
            });
            const output = formatter.formatResult(result);
            expect(output).not.toContain('Type "it" for more');
        });

        it('should unwrap CursorIterationResult wrapper', () => {
            const wrapper = { cursorHasMore: false, documents: [{ a: 1 }] };
            const result = makeResult({
                type: 'Cursor',
                printable: EJSON.stringify(wrapper, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            // Should show the documents array, not the wrapper
            expect(output).not.toContain('cursorHasMore');
        });

        it('should return empty string for undefined result', () => {
            // undefined serializes as "undefined" string in workerTypes
            const result = makeResult({
                type: null,
                printable: '"undefined"',
            });
            const output = formatter.formatResult(result);
            // Parsed as the string "undefined", which is a string value
            expect(output).toBe('undefined');
        });
    });

    describe('formatResult without colors', () => {
        beforeEach(() => {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: jest.fn((_key: string, defaultValue?: unknown) => {
                    if (_key === 'documentDB.shell.display.colorOutput') {
                        return false;
                    }
                    return defaultValue;
                }),
            } as unknown as vscode.WorkspaceConfiguration);
        });

        it('should format without ANSI codes when color disabled', () => {
            const result = makeResult({
                type: 'number',
                printable: EJSON.stringify(42, { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toBe('42');
            expect(output).not.toContain('\x1b[');
        });

        it('should format cursor more hint without color', () => {
            const docs = [{ x: 1 }];
            const result = makeResult({
                type: 'Cursor',
                printable: EJSON.stringify(docs, { relaxed: false }),
                cursorHasMore: true,
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('Type "it" for more');
            // Should not have gray ANSI code from 'it' hint
            const lines = output.split('\r\n');
            const lastLine = lines[lines.length - 1];
            expect(lastLine).not.toContain('\x1b[90m');
        });
    });

    describe('formatError', () => {
        it('should format error in red when color enabled', () => {
            const output = formatter.formatError('Something went wrong');
            expect(output).toContain('Something went wrong');
            expect(output).toContain('\x1b[31m'); // Red
        });

        it('should format error without color when disabled', () => {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: jest.fn(() => false),
            } as unknown as vscode.WorkspaceConfiguration);

            const output = formatter.formatError('Something went wrong');
            expect(output).toBe('Something went wrong');
            expect(output).not.toContain('\x1b[');
        });
    });

    describe('formatSystemMessage', () => {
        it('should format system message in gray when color enabled', () => {
            const output = formatter.formatSystemMessage('Connecting...');
            expect(output).toContain('Connecting...');
            expect(output).toContain('\x1b[90m'); // Gray
        });

        it('should format system message without color when disabled', () => {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: jest.fn(() => false),
            } as unknown as vscode.WorkspaceConfiguration);

            const output = formatter.formatSystemMessage('Connecting...');
            expect(output).toBe('Connecting...');
        });
    });

    describe('Help result formatting', () => {
        it('should format help text directly from string', () => {
            const result = makeResult({
                type: 'Help',
                printable: EJSON.stringify('Available commands:\n  help', { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('Available commands');
        });
    });
});
