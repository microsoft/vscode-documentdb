/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatError, formatResult } from './resultFormatter';
import { type PlaygroundConnection } from './types';

const connection: PlaygroundConnection = {
    clusterId: 'test-cluster',
    clusterDisplayName: 'Test Cluster',
    databaseName: 'testDb',
    viewId: 'connections',
};

describe('resultFormatter', () => {
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
