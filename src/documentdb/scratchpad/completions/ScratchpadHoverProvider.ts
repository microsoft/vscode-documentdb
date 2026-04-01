/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hover provider for DocumentDB scratchpad files.
 *
 * Provides inline documentation when hovering over:
 * - Query operators ($gt, $regex, $match, etc.) — from documentdb-constants
 * - BSON constructors (ObjectId, ISODate, etc.) — from documentdb-constants
 * - Known field names — type info from SchemaStore
 *
 * Method/cursor hovers are handled by Layer 1 (TS Server Plugin via JSDoc in .d.ts).
 * This provider handles only DocumentDB-specific items the TS service doesn't know about.
 */

import { getAllCompletions } from '@vscode-documentdb/documentdb-constants';
import { BSONTypes, type FieldEntry } from '@vscode-documentdb/schema-analyzer';
import * as vscode from 'vscode';
import { SchemaStore } from '../../SchemaStore';
import { SCRATCHPAD_LANGUAGE_ID } from '../constants';
import { ScratchpadService } from '../ScratchpadService';
import { detectMethodArgContext } from './scratchpadContextDetector';

/**
 * A callback that resolves a word to field data from the SchemaStore.
 */
type FieldEntryLookup = (word: string) => FieldEntry | undefined;

/**
 * Hover content data (platform-neutral, used by both tests and the VS Code provider).
 */
export interface ScratchpadHoverData {
    contents: Array<{ value: string; isTrusted?: boolean; supportHtml?: boolean }>;
}

/**
 * Returns hover content for a word in a scratchpad file.
 *
 * Tries operators/BSON first (with `$` prefix fallback), then field names.
 * This is a pure function for testability — the VS Code provider wraps it.
 *
 * @param word - The word at the cursor position
 * @param fieldLookup - Optional callback to resolve field names to FieldEntry
 * @returns Hover data or null if no match
 */
export function getScratchpadHoverContent(word: string, fieldLookup?: FieldEntryLookup): ScratchpadHoverData | null {
    if (!word) return null;

    // Try with '$' prefix first (for operators where cursor lands after $)
    // Then try the word as-is (for BSON constructors like ObjectId)
    const candidates = word.startsWith('$') ? [word] : [`$${word}`, word];

    const allEntries = getAllCompletions();

    for (const candidate of candidates) {
        const match = allEntries.find((e) => e.value === candidate);
        if (match) {
            const lines: string[] = [`**${match.value}**`];

            if (match.description || match.link) {
                lines.push('---');
                lines.push('<br>');
            }

            if (match.description) {
                lines.push(match.description);
            }
            if (match.link) {
                lines.push(`[ⓘ Documentation](${match.link})`);
            }

            return {
                contents: [{ value: lines.join('\n\n'), isTrusted: true, supportHtml: true }],
            };
        }
    }

    // If no operator match, try field name lookup
    if (fieldLookup) {
        const fieldData = fieldLookup(word);
        if (fieldData) {
            return buildFieldHover(fieldData);
        }
    }

    return null;
}

/**
 * Builds hover content for a field name.
 */
function buildFieldHover(field: FieldEntry): ScratchpadHoverData {
    let header = `**${escapeMarkdown(field.path)}**`;

    if (field.isSparse) {
        header += ' &nbsp;&nbsp; <small>sparse: not present in all documents</small>';
    }

    const lines: string[] = [header];

    // Show the inferred type
    const displayType = BSONTypes.toDisplayString(field.bsonType as BSONTypes);
    if (field.bsonTypes && field.bsonTypes.length > 1) {
        const displayTypes = field.bsonTypes.map((t) => `\`${BSONTypes.toDisplayString(t as BSONTypes)}\``);
        lines.push('---');
        lines.push('<br>');
        lines.push(`Inferred Type: ${displayTypes.join(', ')}`);
    } else {
        lines.push('---');
        lines.push('<br>');
        lines.push(`Inferred Type: \`${displayType}\``);
    }

    return {
        contents: [{ value: lines.join('\n\n'), supportHtml: true }],
    };
}

/**
 * Escapes markdown metacharacters so user data renders as literal text.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\*_{}[\]()#+\-.!|<>`~&]/g, '\\$&');
}

/**
 * VS Code HoverProvider for DocumentDB scratchpad files.
 *
 * Registered alongside the CompletionItemProvider in ClustersExtension.ts.
 * Only handles DocumentDB-specific items — method/cursor hover docs are
 * provided by Layer 1 (TS Server Plugin via .d.ts JSDoc).
 */
export class ScratchpadHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.Hover | null {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const word = document.getText(wordRange);
        if (!word) return null;

        // Build field lookup from SchemaStore if we have an active connection
        // and the cursor is inside a method argument (where field names are relevant)
        const fieldLookup = this.buildFieldLookup(document, position);

        const hoverData = getScratchpadHoverContent(word, fieldLookup);
        if (!hoverData) return null;

        const markdownContents = hoverData.contents.map((c) => {
            const md = new vscode.MarkdownString(c.value);
            md.isTrusted = c.isTrusted ?? false;
            md.supportHtml = c.supportHtml ?? false;
            return md;
        });

        return new vscode.Hover(markdownContents, wordRange);
    }

    /**
     * Builds a field lookup function from SchemaStore if the cursor is inside
     * a method argument for a known collection.
     */
    private buildFieldLookup(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): FieldEntryLookup | undefined {
        const connection = ScratchpadService.getInstance().getConnection();
        if (!connection) return undefined;

        const text = document.getText();
        const offset = document.offsetAt(position);

        // Check if we're inside a method argument to determine the collection name
        const argCtx = detectMethodArgContext(text, offset);
        if (!argCtx || !argCtx.collectionName) return undefined;

        // Resolve getCollection("name") pattern
        const collectionName = this.resolveCollectionNameForHover(argCtx, text);
        if (!collectionName) return undefined;

        return (word: string) => {
            const fields = SchemaStore.getInstance().getKnownFields(
                connection.clusterId,
                connection.databaseName,
                collectionName,
            );
            return fields.find((f) => f.path === word);
        };
    }

    /**
     * Resolve the collection name, handling db.getCollection("name") pattern.
     */
    private resolveCollectionNameForHover(
        argCtx: { methodName: string; collectionName: string; argStart: number },
        text: string,
    ): string {
        if (argCtx.collectionName === 'getCollection' || argCtx.collectionName === '') {
            const beforeArg = text.substring(0, argCtx.argStart);
            const match = beforeArg.match(/\.getCollection\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*\w+\s*\(\s*$/);
            if (match) {
                return match[1];
            }
        }
        return argCtx.collectionName;
    }

    /**
     * Register the hover provider with VS Code.
     */
    static register(): vscode.Disposable {
        const provider = new ScratchpadHoverProvider();
        return vscode.languages.registerHoverProvider({ language: SCRATCHPAD_LANGUAGE_ID }, provider);
    }
}
