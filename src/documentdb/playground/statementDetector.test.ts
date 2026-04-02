/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { detectBlocks, detectCurrentBlock, findBlockAtLine, type CodeBlock } from './statementDetector';

/**
 * Helper to create a mock TextDocument from a multiline string.
 */
function mockDocument(text: string): vscode.TextDocument {
    const lines = text.split('\n');
    return {
        lineCount: lines.length,
        lineAt(lineNumber: number) {
            return { text: lines[lineNumber] ?? '' };
        },
        getText(range?: vscode.Range) {
            if (!range) {
                return text;
            }
            const startOffset =
                lines.slice(0, range.start.line).reduce((acc, l) => acc + l.length + 1, 0) + range.start.character;
            const endOffset =
                lines.slice(0, range.end.line).reduce((acc, l) => acc + l.length + 1, 0) + range.end.character;
            return text.substring(startOffset, endOffset);
        },
    } as unknown as vscode.TextDocument;
}

describe('statementDetector', () => {
    describe('detectBlocks', () => {
        it('returns a single block for code with no blank lines', () => {
            const doc = mockDocument('var a = 1;\nvar b = 2;\nvar c = 3;');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([{ startLine: 0, endLine: 2 }]);
        });

        it('splits on blank lines', () => {
            const doc = mockDocument('db.users.find({});\n\ndb.orders.find({});');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([
                { startLine: 0, endLine: 0 },
                { startLine: 2, endLine: 2 },
            ]);
        });

        it('does NOT split on comment-only lines', () => {
            const doc = mockDocument('// Variables\nvar a = 1;\n// still same block\nvar b = 2;');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([{ startLine: 0, endLine: 3 }]);
        });

        it('splits on whitespace-only lines', () => {
            const doc = mockDocument('line1\n   \nline3');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([
                { startLine: 0, endLine: 0 },
                { startLine: 2, endLine: 2 },
            ]);
        });

        it('handles multiple blank lines between blocks', () => {
            const doc = mockDocument('block1\n\n\n\nblock2');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([
                { startLine: 0, endLine: 0 },
                { startLine: 4, endLine: 4 },
            ]);
        });

        it('handles empty document', () => {
            const doc = mockDocument('');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([]);
        });

        it('handles document with only blank lines', () => {
            const doc = mockDocument('\n\n\n');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([]);
        });

        it('handles file ending without trailing newline', () => {
            const doc = mockDocument('first block\n\nsecond block');
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([
                { startLine: 0, endLine: 0 },
                { startLine: 2, endLine: 2 },
            ]);
        });

        it('handles multi-line blocks', () => {
            const doc = mockDocument(
                [
                    'db.orders.aggregate([',
                    '  { $match: { status: "active" } },',
                    '  { $group: { _id: "$userId" } }',
                    ']);',
                    '',
                    'db.users.find({});',
                ].join('\n'),
            );
            const blocks = detectBlocks(doc);
            expect(blocks).toEqual([
                { startLine: 0, endLine: 3 },
                { startLine: 5, endLine: 5 },
            ]);
        });
    });

    describe('findBlockAtLine', () => {
        const blocks: CodeBlock[] = [
            { startLine: 0, endLine: 2 },
            { startLine: 5, endLine: 7 },
        ];

        it('finds the block containing the line', () => {
            expect(findBlockAtLine(blocks, 1)).toEqual({ startLine: 0, endLine: 2 });
            expect(findBlockAtLine(blocks, 6)).toEqual({ startLine: 5, endLine: 7 });
        });

        it('returns undefined for lines between blocks', () => {
            expect(findBlockAtLine(blocks, 3)).toBeUndefined();
            expect(findBlockAtLine(blocks, 4)).toBeUndefined();
        });

        it('returns undefined for lines after all blocks', () => {
            expect(findBlockAtLine(blocks, 10)).toBeUndefined();
        });
    });

    describe('detectCurrentBlock', () => {
        it('returns the block text at cursor position', () => {
            const doc = mockDocument('line1\nline2\n\nline4');
            const position = new vscode.Position(0, 0);
            const result = detectCurrentBlock(doc, position);
            expect(result).toBe('line1\nline2');
        });

        it('returns empty string when cursor is on a blank line', () => {
            const doc = mockDocument('line1\n\nline3');
            const position = new vscode.Position(1, 0);
            const result = detectCurrentBlock(doc, position);
            expect(result).toBe('');
        });
    });
});
