/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hover provider for DocumentDB query playground files.
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
import { BSONTypes, type FieldEntry } from '@microsoft/vscode-documentdb-schema-analyzer';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../playground/constants';
import { PlaygroundService } from '../../playground/PlaygroundService';
import { SchemaStore } from '../../SchemaStore';
import { extractQuotedKey } from '../shared';
import { detectMethodArgContext } from './playgroundContextDetector';

/**
 * A callback that resolves a word to field data from the SchemaStore.
 */
type FieldEntryLookup = (word: string) => FieldEntry | undefined;

/**
 * Hover content data (platform-neutral, used by both tests and the VS Code provider).
 */
export interface PlaygroundHoverData {
    contents: Array<{ value: string; isTrusted?: boolean; supportHtml?: boolean }>;
}

/**
 * Returns hover content for a word in a query playground file.
 *
 * Tries operators/BSON first (with `$` prefix fallback), then field names.
 * This is a pure function for testability — the VS Code provider wraps it.
 *
 * @param word - The word at the cursor position
 * @param fieldLookup - Optional callback to resolve field names to FieldEntry
 * @param isMemberAccess - If true, the word follows a `.` (property access) — skip `$`-prefix operator lookup
 * @returns Hover data or null if no match
 */
export function getPlaygroundHoverContent(
    word: string,
    fieldLookup?: FieldEntryLookup,
    isMemberAccess?: boolean,
): PlaygroundHoverData | null {
    if (!word) return null;

    // Try with '$' prefix first (for operators where cursor lands after $)
    // Then try the word as-is (for BSON constructors like ObjectId)
    // Skip the $-prefix candidate when the word is in a property access context
    // (e.g., console.log should not match $log)
    const candidates = word.startsWith('$') ? [word] : isMemberAccess ? [word] : [`$${word}`, word];

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
function buildFieldHover(field: FieldEntry): PlaygroundHoverData {
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
 * VS Code HoverProvider for DocumentDB query playground files.
 *
 * Registered alongside the CompletionItemProvider in ClustersExtension.ts.
 * Only handles DocumentDB-specific items — method/cursor hover docs are
 * provided by Layer 1 (TS Server Plugin via .d.ts JSDoc).
 */
export class PlaygroundHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.Hover | null {
        const lineText = document.lineAt(position.line).text;
        const col0 = position.character; // 0-based

        // Build field lookup from SchemaStore if we have an active connection
        // and the cursor is inside a method argument (where field names are relevant)
        const fieldLookup = this.buildFieldLookup(document, position);

        // 1. Try quoted key extraction first (handles "address.street" dotted paths)
        // VS Code's getWordRangeAtPosition breaks on dots and quotes, so for
        // quoted field names we need to extract the full string content.
        const quotedResult = extractQuotedKey(lineText, col0);
        if (quotedResult) {
            const hoverData = getPlaygroundHoverContent(quotedResult.key, fieldLookup);
            if (hoverData) {
                const hoverRange = new vscode.Range(position.line, quotedResult.start, position.line, quotedResult.end);
                return this.toVscodeHover(hoverData, hoverRange);
            }
        }

        // 2. Try $ + next word for operator hover when cursor is on '$'
        // VS Code's getWordRangeAtPosition treats '$' as a word boundary,
        // so hovering on '$' in '$exists' gives word='$' instead of '$exists'.
        if (col0 < lineText.length && lineText[col0] === '$') {
            const afterDollar = lineText.substring(col0 + 1);
            const identMatch = afterDollar.match(/^[a-zA-Z_]\w*/);
            if (identMatch) {
                const operatorName = `$${identMatch[0]}`;
                const hoverData = getPlaygroundHoverContent(operatorName, fieldLookup);
                if (hoverData) {
                    const hoverRange = new vscode.Range(
                        position.line,
                        col0,
                        position.line,
                        col0 + 1 + identMatch[0].length,
                    );
                    return this.toVscodeHover(hoverData, hoverRange);
                }
            }
        }

        // 3. Standard word-based hover
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) return null;

        const word = document.getText(wordRange);
        if (!word) return null;

        // Check if there's a '$' immediately before the word range
        // (e.g., cursor on 'exists' in '$exists')
        const charBefore = wordRange.start.character > 0 ? lineText[wordRange.start.character - 1] : '';
        const effectiveWord = charBefore === '$' ? `$${word}` : word;
        const effectiveRange =
            charBefore === '$' ? new vscode.Range(wordRange.start.translate(0, -1), wordRange.end) : wordRange;

        const hoverData = getPlaygroundHoverContent(effectiveWord, fieldLookup, charBefore === '.');
        if (!hoverData) return null;

        return this.toVscodeHover(hoverData, effectiveRange);
    }

    private toVscodeHover(hoverData: PlaygroundHoverData, range: vscode.Range): vscode.Hover {
        const markdownContents = hoverData.contents.map((c) => {
            const md = new vscode.MarkdownString(c.value);
            md.isTrusted = c.isTrusted ?? false;
            md.supportHtml = c.supportHtml ?? false;
            return md;
        });
        return new vscode.Hover(markdownContents, range);
    }

    /**
     * Builds a field lookup function from SchemaStore if the cursor is inside
     * a method argument for a known collection.
     */
    private buildFieldLookup(document: vscode.TextDocument, position: vscode.Position): FieldEntryLookup | undefined {
        const connection = PlaygroundService.getInstance().getConnection();
        if (!connection) return undefined;

        const text = document.getText();
        const offset = document.offsetAt(position);

        // Try to detect the method argument context.
        // If the cursor is inside a quoted string (e.g., "additionalInfo.isFamilyFriendly"),
        // detectMethodArgContext may fail because skipStringBackward can't find a matching
        // opening quote when scanning from inside the string. In that case, find the string
        // start and scan from before it (same approach as checkStringLiteralContext).
        let argCtx = detectMethodArgContext(text, offset);
        if (!argCtx) {
            const stringStart = this.findEnclosingStringStart(text, offset);
            if (stringStart > 0) {
                argCtx = detectMethodArgContext(text, stringStart);
            }
        }
        if (!argCtx) return undefined;

        // Resolve getCollection("name") pattern — must happen before the empty
        // collectionName check because getCollection chains produce empty collectionName
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
     * Find the start position of the enclosing string literal, if any.
     * Returns the index of the opening quote, or -1 if not inside a string.
     */
    private findEnclosingStringStart(text: string, offset: number): number {
        let inString = false;
        let quoteChar = '';
        let stringStart = -1;
        for (let i = 0; i < offset; i++) {
            const ch = text[i];
            if (i > 0 && text[i - 1] === '\\') continue;
            if ((ch === '"' || ch === "'") && (!inString || ch === quoteChar)) {
                inString = !inString;
                quoteChar = inString ? ch : '';
                if (inString) stringStart = i;
            }
        }
        return inString ? stringStart : -1;
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
        const provider = new PlaygroundHoverProvider();
        return vscode.languages.registerHoverProvider({ language: PLAYGROUND_LANGUAGE_ID }, provider);
    }
}
