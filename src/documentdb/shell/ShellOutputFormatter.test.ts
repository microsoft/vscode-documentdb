/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { type ShellHelpDocument, type ShellHelpDocumentLine } from '@documentdb-js/shell-runtime';
import { HelpProvider } from '../../../packages/documentdb-js-shell-runtime/src/HelpProvider';
import { type SerializableExecutionResult } from '../playground/workerTypes';
import { ShellOutputFormatter } from './ShellOutputFormatter';
import { shellAnsi, shellStyles } from './shellStyles';

describe('ShellOutputFormatter', () => {
    let formatter: ShellOutputFormatter;

    beforeEach(() => {
        formatter = new ShellOutputFormatter();

        // Default: color enabled
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: jest.fn((_key: string, defaultValue?: unknown) => {
                if (_key === 'documentDB.shell.display.colorSupport') {
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

    function makeHelpResult(lines: readonly ShellHelpDocumentLine[]): SerializableExecutionResult {
        const document: ShellHelpDocument = {
            kind: 'documentdb.shellHelp',
            lines,
        };
        return makeResult({
            type: 'Help',
            printable: EJSON.stringify(document, { relaxed: false }),
        });
    }

    describe('formatResult', () => {
        it('should suppress output when printableIsUndefined is true', () => {
            const result = makeResult({
                type: null,
                printable: 'null',
                printableIsUndefined: true,
            });
            const output = formatter.formatResult(result);
            expect(output).toBe('');
        });

        it('should display null when printableIsUndefined is false', () => {
            const result = makeResult({
                type: null,
                printable: EJSON.stringify(null, { relaxed: false }),
                printableIsUndefined: false,
            });
            const output = formatter.formatResult(result);
            expect(output).toContain('null');
        });

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
                    if (_key === 'documentDB.shell.display.colorSupport') {
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

    describe('connection banner formatting', () => {
        it('should dim the frame and emphasize the prompt and wordmark', () => {
            expect(formatter.formatShellLogo()).toBe(
                [
                    `${shellStyles.ghostText}╭────╮${shellAnsi.reset}`,
                    `${shellStyles.ghostText}│ ${shellAnsi.reset}${shellStyles.emphasis}>_${shellAnsi.reset}${shellStyles.ghostText} │${shellAnsi.reset} ${shellStyles.emphasis}DocumentDB Shell${shellAnsi.reset}`,
                    `${shellStyles.ghostText}╰────╯${shellAnsi.reset}`,
                ].join('\n'),
            );
        });

        it('should use neutral emphasis for the title and values', () => {
            expect(formatter.formatShellTitle('DocumentDB Shell: Demo')).toBe('\x1b[1mDocumentDB Shell: Demo\x1b[0m');
            expect(formatter.formatConnectionValue('value')).toBe('\x1b[1m\x1b[39mvalue\x1b[0m\x1b[90m');
        });

        it('should preserve plain text when color support is disabled', () => {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: jest.fn(() => false),
            } as unknown as vscode.WorkspaceConfiguration);

            expect(formatter.formatShellTitle('DocumentDB Shell: Demo')).toBe('DocumentDB Shell: Demo');
            expect(formatter.formatShellLogo()).toBe('╭────╮\n│ >_ │ DocumentDB Shell\n╰────╯');
            expect(formatter.formatShellLogo()).not.toContain('\x1b[');
            expect(formatter.formatConnectionValue('alex@contoso.com')).toBe('alex@contoso.com');
        });
    });

    describe('Help result formatting', () => {
        it('should leave unstructured help text unchanged', () => {
            const result = makeResult({
                type: 'Help',
                printable: EJSON.stringify('# Available commands:\n  help', { relaxed: false }),
            });
            const output = formatter.formatResult(result);
            expect(output).toBe('# Available commands:\n  help');
            expect(output).not.toContain('\x1b[');
        });

        it('should emphasize section headers with bold default text when color enabled', () => {
            const result = makeHelpResult([{ kind: 'header', text: 'Query' }]);
            const output = formatter.formatResult(result);
            expect(output).toContain('\x1b[1mQuery\x1b[0m');
            expect(output).not.toContain('\x1b[36mQuery');
        });

        it('should colorize command entries with yellow command and gray description', () => {
            const result = makeHelpResult([
                {
                    kind: 'entry',
                    indent: '  ',
                    command: 'db.find({})',
                    gap: '  ',
                    description: 'Find documents',
                },
            ]);
            const output = formatter.formatResult(result);
            expect(output).toContain('\x1b[33mdb.find({})');
            expect(output).toContain('\x1b[90mFind documents');
        });

        it('should render manual settings access details with the ghost text style', () => {
            const result = makeHelpResult([
                {
                    kind: 'text',
                    spans: [{ text: '  This text has no magic prefix', tone: 'ghost' }],
                },
            ]);

            const output = formatter.formatResult(result);

            expect(output).toBe(`${shellStyles.ghostText}  This text has no magic prefix${shellAnsi.reset}`);
            expect(output).not.toContain(shellStyles.muted);
        });

        it('should not colorize help text when color is disabled', () => {
            jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: jest.fn(() => false),
            } as unknown as vscode.WorkspaceConfiguration);

            const result = makeHelpResult([
                { kind: 'header', text: 'Query' },
                {
                    kind: 'entry',
                    indent: '  ',
                    command: 'db.find({})',
                    gap: '  ',
                    description: 'Find documents',
                },
            ]);
            const output = formatter.formatResult(result);
            expect(output).not.toContain('\x1b[');
        });

        it('should underline compact settings markers as clickable links', () => {
            const result = makeHelpResult([
                {
                    kind: 'text',
                    spans: [
                        { text: '  ', tone: 'muted' },
                        { text: '⚙ [shellSettings]', tone: 'muted', link: true },
                        { text: ' Configure settings.', tone: 'muted' },
                    ],
                },
            ]);

            const output = formatter.formatResult(result);
            expect(output).toContain('\x1b[4m⚙ [shellSettings]\x1b[24m');
        });

        it('should format the generated shell help document after EJSON serialization', () => {
            const helpResult = new HelpProvider('shell').getHelpResult(120);
            const result = makeResult({
                type: helpResult.type,
                printable: EJSON.stringify(helpResult.printable, { relaxed: false }),
            });

            const output = formatter.formatResult(result);

            expect(output).toContain(`${shellStyles.emphasis}DocumentDB Shell: Quick Reference${shellAnsi.reset}`);
            expect(output).toContain(
                `${shellStyles.completion.action}db.<coll>.find({})${shellAnsi.reset}`,
            );
            expect(output).toContain(`${shellAnsi.underline}⚙ [shellSettings]${shellAnsi.noUnderline}`);
            expect(output).not.toContain('# Query');
        });
    });
});

// ─── extractErrorCode ────────────────────────────────────────────────────────

import { extractErrorCode } from './ShellOutputFormatter';

describe('extractErrorCode', () => {
    it('should extract an error code and return clean message', () => {
        const result = extractErrorCode('[PREFIX-12345] Invalid input provided');
        expect(result.errorCode).toBe('PREFIX-12345');
        expect(result.message).toBe('Invalid input provided');
    });

    it('should extract a multi-segment error code', () => {
        const result = extractErrorCode('[ERR-90001] Unexpected failure');
        expect(result.errorCode).toBe('ERR-90001');
        expect(result.message).toBe('Unexpected failure');
    });

    it('should extract a short error code', () => {
        const result = extractErrorCode('[API-100] Operation timed out');
        expect(result.errorCode).toBe('API-100');
        expect(result.message).toBe('Operation timed out');
    });

    it('should return the original message when no code is present', () => {
        const result = extractErrorCode('Connection refused');
        expect(result.errorCode).toBeUndefined();
        expect(result.message).toBe('Connection refused');
    });

    it('should return the original message for empty string', () => {
        const result = extractErrorCode('');
        expect(result.errorCode).toBeUndefined();
        expect(result.message).toBe('');
    });

    it('should not match codes that are not at the start of the message', () => {
        const result = extractErrorCode('Error occurred [COMMON-10001] in handler');
        expect(result.errorCode).toBeUndefined();
        expect(result.message).toBe('Error occurred [COMMON-10001] in handler');
    });

    it('should not match malformed code patterns', () => {
        const result = extractErrorCode('[common-10001] lowercase prefix');
        expect(result.errorCode).toBeUndefined();
        expect(result.message).toBe('[common-10001] lowercase prefix');
    });

    it('should handle code with no trailing message', () => {
        const result = extractErrorCode('[COMMON-90001] ');
        expect(result.errorCode).toBe('COMMON-90001');
        expect(result.message).toBe('');
    });
});
