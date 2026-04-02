/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A detected code block in a query playground document.
 * Blocks are separated by blank lines (whitespace-only lines).
 * Comment-only lines do NOT act as block separators.
 */
export interface CodeBlock {
    /** 0-based start line of the block (first non-empty line). */
    readonly startLine: number;
    /** 0-based end line of the block (last non-empty line, inclusive). */
    readonly endLine: number;
}

/**
 * Detects code blocks in a query playground document using blank-line separation.
 *
 * Rules:
 * - Lines that are completely empty or whitespace-only are block separators.
 * - Lines containing only comments (`//` or within block comments) are NOT separators.
 * - Each contiguous group of non-blank lines forms a block.
 */
export function detectBlocks(document: vscode.TextDocument): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    let blockStart: number | undefined;

    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        const isBlank = lineText.trim().length === 0;

        if (!isBlank) {
            if (blockStart === undefined) {
                blockStart = i;
            }
        } else {
            if (blockStart !== undefined) {
                blocks.push({ startLine: blockStart, endLine: i - 1 });
                blockStart = undefined;
            }
        }
    }

    // Close final block if file doesn't end with a blank line
    if (blockStart !== undefined) {
        blocks.push({ startLine: blockStart, endLine: document.lineCount - 1 });
    }

    return blocks;
}

/**
 * Returns the text of the code block containing the given cursor position.
 * If the cursor is on a blank line (between blocks), returns an empty string.
 */
export function detectCurrentBlock(document: vscode.TextDocument, position: vscode.Position): string {
    const blocks = detectBlocks(document);

    for (const block of blocks) {
        if (position.line >= block.startLine && position.line <= block.endLine) {
            const range = new vscode.Range(
                block.startLine,
                0,
                block.endLine,
                document.lineAt(block.endLine).text.length,
            );
            return document.getText(range);
        }
    }

    return '';
}

/**
 * Finds the block that contains the given line number.
 * Returns undefined if the line is in a blank region between blocks.
 */
export function findBlockAtLine(blocks: CodeBlock[], line: number): CodeBlock | undefined {
    return blocks.find((b) => line >= b.startLine && line <= b.endLine);
}
