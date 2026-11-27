/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import * as l10n from '@vscode/l10n';
import { describeCompletion, describeResult, formatError, formatResult } from './resultFormatter';
import { type ExecutionResult, type PlaygroundConnection } from './types';

vi.mock('@vscode/l10n', async (importOriginal) => {
    const original = await importOriginal<typeof import('@vscode/l10n')>();
    return { ...original, t: vi.fn(original.t) };
});

const connection: PlaygroundConnection = {
    clusterId: 'test-cluster',
    clusterDisplayName: 'Test Cluster',
    databaseName: 'testDb',
    viewId: 'connections',
};

describe('resultFormatter', () => {
    it.each([
        [{ type: 'Cursor', printable: [{ _id: 1 }, { _id: 2 }], durationMs: 10 }, 'Cursor (2 documents)'],
        [{ type: 'Cursor', printable: { cursorHasMore: true, documents: [] }, durationMs: 10 }, 'Cursor (0 documents)'],
        [{ type: 'Document', printable: { documents: [] }, durationMs: 10 }, 'Document'],
        [{ type: 'string', printable: 'secret value', durationMs: 10 }, 'string'],
        [{ type: null, printable: [1, 2, 3], durationMs: 10 }, 'Array (3 elements)'],
        [{ type: null, printable: undefined, durationMs: 10 }, undefined],
    ] satisfies readonly (readonly [ExecutionResult, string | undefined])[])('describes only existing count/type metadata for %j', (result, expected) => {
        expect(describeResult(result)).toBe(expected);
    });

    it.each([
        [{ type: null, printable: null, printableIsUndefined: true, durationMs: 10 }, undefined],
        [{ type: 'string', printable: 'serialized value', printableIsUndefined: true, durationMs: 10 }, undefined],
        [{ type: null, printable: null, durationMs: 10 }, 'null'],
        [{ type: null, printable: null, printableIsUndefined: false, durationMs: 10 }, 'null'],
        [{ type: null, printable: 42, durationMs: 10 }, 'number'],
        [{ type: null, printable: { _id: 1 }, durationMs: 10 }, 'object'],
        [{ type: null, printable: 'private value', durationMs: 10 }, 'string'],
        [{ type: null, printable: undefined, durationMs: 10 }, 'undefined'],
        [{ type: 'Document', printable: { _id: 1 }, durationMs: 10 }, 'Document'],
        [{ type: 'Cursor', printable: { cursorHasMore: true, documents: [{ _id: 1 }] }, durationMs: 10 }, 'Cursor (1 documents)'],
        [{ type: null, printable: [1, 2], durationMs: 10 }, 'Array (2 elements)'],
    ] satisfies readonly (readonly [ExecutionResult, string | undefined])[])('describes completion without guessing absence for %j', (result, expected) => {
        expect(describeCompletion(result)).toBe(expected);
    });

    it.each([
        { type: null, printable: null, durationMs: 10 },
        { type: null, printable: 42, durationMs: 10 },
        { type: 'Document', printable: { _id: 1 }, durationMs: 10 },
    ] satisfies readonly ExecutionResult[])('keeps every formatted byte unchanged regardless of the undefined flag for %j', (result) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
        try {
            const unchanged = formatResult(result, 'db.test.findOne()', connection);
            expect(formatResult({ ...result, printableIsUndefined: true }, 'db.test.findOne()', connection)).toBe(unchanged);
            expect(formatResult({ ...result, printableIsUndefined: false }, 'db.test.findOne()', connection)).toBe(unchanged);
            if (result.type === null) {
                expect(unchanged).not.toContain('// Result:');
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [
            { type: 'Cursor', printable: [{ _id: 1 }, { _id: 2 }], durationMs: 10 },
            'Result: Cursor ({0} documents)', 2, '2 documents — résultat du curseur',
        ],
        [
            { type: null, printable: [1, 2, 3], durationMs: 10 },
            'Result: Array ({0} elements)', 3, '3 éléments — résultat du tableau',
        ],
        [
            { type: 'Document', printable: { _id: 1 }, durationMs: 10 },
            'Result: {0}', 'Document', 'Document — résultat',
        ],
    ] satisfies readonly (readonly [ExecutionResult, string, number | string, string])[])(
        'uses the original complete translation key for %j and argument order',
        (result, key, argument, translated) => {
            const translator = vi.mocked(l10n.t).mockReset().mockImplementation((message: unknown, ...args: unknown[]): string =>
                message === key && args[0] === argument ? translated : 'autre traduction',
            );
            try {
                const output = formatResult(result, 'db.test.find()', connection);

                expect(translator).toHaveBeenCalledWith(key, argument);
                expect(output.split('\n')).toContain(`// ${translated}`);
                const usedKeys = translator.mock.calls.map(([message]) => message);
                expect(usedKeys).not.toContain('Cursor ({0} documents)');
                expect(usedKeys).not.toContain('Array ({0} elements)');
            } finally {
                translator.mockReset();
            }
        },
    );

    it.each([
        [{ type: 'Cursor', printable: [{ _id: 1 }], durationMs: 10 }, 'Result: Cursor (1 documents)', '[\n  {\n    "_id": 1\n  }\n]'],
        [{ type: 'Cursor', printable: { cursorHasMore: false, documents: [] }, durationMs: 10 }, 'Result: Cursor (0 documents)', '[]'],
        [{ type: 'Document', printable: { _id: 1 }, durationMs: 10 }, 'Result: Document', '{\n  "_id": 1\n}'],
        [{ type: 'string', printable: 'hello', durationMs: 10 }, 'Result: string', 'hello'],
        [{ type: null, printable: [1], durationMs: 10 }, 'Result: Array (1 elements)', '[\n  1\n]'],
        [{ type: null, printable: undefined, durationMs: 10 }, undefined, 'undefined'],
    ] satisfies readonly (readonly [ExecutionResult, string | undefined, string])[])('preserves every formatted byte for %j', (result, header, value) => {
        const date = new Date('2026-11-27T12:00:00Z');
        vi.useFakeTimers();
        vi.setSystemTime(date);
        try {
            const lines = [
                '// Test Cluster / testDb',
                `// ${date.toLocaleString()}`,
                '//',
                '// ▶ db.test.find()',
                ...(header ? [`// ${header}`] : []),
                '// Executed in 10ms',
                '// ─────────────────────────',
                '',
                value,
            ];
            expect(formatResult(result, 'db.test.find()', connection)).toBe(lines.join('\n'));
        } finally {
            vi.useRealTimers();
        }
    });

    describe('formatError', () => {
        it('strips ANSI color codes from error messages', () => {
            const error = new Error('\x1b[31mSyntaxError\x1b[0m: \x1b[1mMissing semicolon\x1b[0m');
            const result = formatError(error, 'db.test.find(', 10, connection);

            expect(result).not.toContain('\x1b[');
            expect(result).toContain('SyntaxError: Missing semicolon');
        });

        it('handles error messages without ANSI codes', () => {
            const error = new Error('Connection refused');
            const result = formatError(error, 'db.test.find()', 5, connection);

            expect(result).toContain('Connection refused');
        });

        it('strips complex ANSI sequences with multiple parameters', () => {
            const error = new Error('\x1b[1;31mError\x1b[0m: \x1b[33mwarning text\x1b[0m');
            const result = formatError(error, 'bad code', 15, connection);

            expect(result).not.toContain('\x1b[');
            expect(result).toContain('Error: warning text');
        });

        it('strips error code prefix AND ANSI codes', () => {
            const error = new Error('[COMMON-10001] \x1b[31mInvalid operation\x1b[0m');
            const result = formatError(error, 'db.test.find()', 10, connection);

            expect(result).not.toContain('[COMMON-10001]');
            expect(result).not.toContain('\x1b[');
            expect(result).toContain('Invalid operation');
        });
        it('shows maxTimeMS hint for timeout errors with error code 50', () => {
            const error: Error & { code?: number } = new Error('command timeout');
            error.code = 50;
            const result = formatError(error, 'db.test.find()', 30000, connection);

            expect(result).toContain('.maxTimeMS()');
        });

        it('does not show maxTimeMS hint without error code 50', () => {
            const error = new Error('some other error');
            const result = formatError(error, 'db.test.find()', 30000, connection);

            expect(result).not.toContain('.maxTimeMS()');
        });
    });

    describe('formatResult', () => {
        it('formats a simple document result', () => {
            const result = formatResult(
                { type: 'Document', printable: { _id: 1, name: 'test' }, durationMs: 42 },
                'db.test.findOne()',
                connection,
            );

            expect(result).toContain('Result: Document');
            expect(result).toContain('42ms');
            expect(result).toContain('"name": "test"');
        });

        it('formats a cursor result with document count', () => {
            const result = formatResult(
                { type: 'Cursor', printable: [{ _id: 1 }, { _id: 2 }], durationMs: 100 },
                'db.test.find()',
                connection,
            );

            expect(result).toContain('Cursor (2 documents)');
        });
    });
});
