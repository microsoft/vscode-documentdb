/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getFilteredCompletions, loadOperators } from '@vscode-documentdb/documentdb-constants';
import { BSONTypes } from '@vscode-documentdb/schema-analyzer';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from '../../playground/constants';
import { PlaygroundService } from '../../playground/PlaygroundService';
import { SchemaStore } from '../../SchemaStore';
import {
    KEY_POSITION_OPERATORS,
    detectCursorContext,
    escapeSnippetDollars,
    getOperatorSortPrefix,
    getTypeSuggestionDefs,
    stripOuterBraces,
    type CursorContext,
} from '../shared';
import { CollectionNameCache } from './CollectionNameCache';
import { detectMethodArgContext, detectPlaygroundContext } from './playgroundContextDetector';

// Ensure operators are loaded
loadOperators();

/**
 * Provides context-aware completions for DocumentDB query playground files.
 *
 * This is Layer 2 of the two-layer autocompletion system. It handles
 * things the TypeScript language service (Layer 1) cannot provide:
 * - Dynamic collection names from SchemaStore (after `db.` and in strings)
 * - Query operators and field names inside method arguments (Q1-Q8)
 *
 * Layer 1 (TS Server Plugin with Inline Snapshot Injection) handles:
 * - Shell globals (`db`, `use`, `print`, BSON constructors)
 * - Database methods (`getCollection`, `runCommand`, etc.)
 * - Collection methods (`find`, `insertOne`, etc.)
 * - Cursor methods (`limit`, `sort`, `toArray`, etc.)
 * - Hover documentation and signature help
 * - Variable type tracking across assignments
 */
export class PlaygroundCompletionItemProvider implements vscode.CompletionItemProvider, vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];

    dispose(): void {
        this.disposables.forEach((d) => {
            d.dispose();
        });
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): vscode.CompletionItem[] | undefined {
        const text = document.getText();
        const offset = document.offsetAt(position);

        // Compute the range that should be replaced when inserting a completion.
        // For `$`-prefixed operators: when the user types `$g`, VS Code's word
        // detection starts at `g` (not `$`). Without extending the range back by 1,
        // selecting `$gt` would insert `$$gt` (double dollar). This mirrors the
        // same fix in the collection view's registerLanguage.ts.
        const line = document.lineAt(position.line);
        const wordRange = document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
        const charBeforeWord = wordRange.start.character > 0 ? line.text[wordRange.start.character - 1] : '';
        const isDollarPrefix = charBeforeWord === '$';
        const replaceRange = isDollarPrefix
            ? new vscode.Range(wordRange.start.translate(0, -1), wordRange.end)
            : wordRange;

        // Check if we're inside a string literal in a method call like
        // db.getCollection("...") or use("..."). Must be checked BEFORE
        // detectMethodArgContext because that treats the entire parenthesized
        // content as a query-object argument.
        const stringCompletions = this.checkStringLiteralContext(text, offset, document.uri);
        if (stringCompletions !== undefined) {
            return stringCompletions;
        }

        // First, check if we're inside a method argument — this is the most
        // common case and needs inner query-object context detection (Stage 2)
        const argContext = detectMethodArgContext(text, offset);
        if (argContext) {
            // For db.getCollection("name").find({...}), extract collection name from getCollection argument
            const effectiveCollectionName = this.resolveCollectionName(argContext, text);
            const resolved = { ...argContext, collectionName: effectiveCollectionName };
            return this.provideMethodArgumentCompletions(
                resolved,
                text,
                offset,
                context,
                replaceRange,
                isDollarPrefix,
                document.uri,
            );
        }

        // Stage 1: JS-level context detection
        const playgroundCtx = detectPlaygroundContext(text, offset);

        switch (playgroundCtx.kind) {
            case 'top-level':
            case 'collection-method':
            case 'find-cursor-chain':
            case 'aggregate-cursor-chain':
                // These are fully handled by Layer 1 (TS Server Plugin).
                // Returning undefined lets the TS service provide completions
                // without duplicates from our custom provider.
                return undefined;

            case 'db-dot':
                // Layer 1 handles database methods (getCollection, runCommand, etc.).
                // We only add dynamic collection names from SchemaStore.
                return this.provideDbDotCompletions(document.uri);

            case 'string-literal':
                return this.provideStringCompletions(playgroundCtx.enclosingCall, document.uri);

            case 'method-argument':
                // This case is handled above via detectMethodArgContext,
                // but as a fallback, provide generic operator completions
                return this.provideGenericOperatorCompletions();

            default:
                return undefined; // Let TS service handle it
        }
    }

    // -----------------------------------------------------------------------
    // S1: Top-level globals — handled by Layer 1 (TS Server Plugin)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // S2: db.* completions — only dynamic collection names
    // Database methods are handled by Layer 1 (TS Server Plugin).
    // -----------------------------------------------------------------------

    private provideDbDotCompletions(documentUri: vscode.Uri): vscode.CompletionItem[] | undefined {
        const connection = PlaygroundService.getInstance().getConnection(documentUri);
        if (!connection) {
            return undefined; // No connection — let TS handle db. methods only
        }

        const collectionNames = CollectionNameCache.getInstance().getCollectionNames(
            connection.clusterId,
            connection.databaseName,
        );
        if (collectionNames.length === 0) {
            return undefined;
        }

        return collectionNames.map((name) => collectionNameToCompletionItem(name));
    }

    // -----------------------------------------------------------------------
    // S3-S5: Collection/cursor methods — handled by Layer 1 (TS Server Plugin)
    // -----------------------------------------------------------------------
    // S6: String literal completions (collection names)
    // -----------------------------------------------------------------------

    private provideStringCompletions(
        enclosingCall: string,
        documentUri?: vscode.Uri,
    ): vscode.CompletionItem[] | undefined {
        // NOTE: use() should suggest database names, not collection names.
        // Database-name completion is tracked in docs/plan/future-nice-to-have.md.
        if (enclosingCall === 'getCollection') {
            if (!documentUri) return undefined;
            const connection = PlaygroundService.getInstance().getConnection(documentUri);
            if (!connection) return undefined;

            const collectionNames = CollectionNameCache.getInstance().getCollectionNames(
                connection.clusterId,
                connection.databaseName,
            );
            return collectionNames.map((name) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
                item.detail = 'discovered collection';
                item.sortText = `!0_${name}`;
                return item;
            });
        }
        return undefined;
    }

    // -----------------------------------------------------------------------
    // Q1-Q8: Method argument completions (query operators, fields, BSON)
    //
    // NOTE (future-pre-shell.md #4): This method currently shows query
    // operators in all method-argument positions regardless of methodName.
    // Aggregate stages, update operators, and second-argument routing are
    // tracked as future work in docs/plan/future-pre-shell.md item 4.
    // -----------------------------------------------------------------------

    private provideMethodArgumentCompletions(
        argCtx: { methodName: string; collectionName: string; argStart: number },
        fullText: string,
        offset: number,
        context: vscode.CompletionContext,
        replaceRange: vscode.Range,
        isDollarPrefix: boolean,
        documentUri: vscode.Uri,
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const argumentText = fullText.substring(argCtx.argStart, offset);
        const cursorOffsetInArg = offset - argCtx.argStart;

        // Use the field type lookup from SchemaStore
        const connection = PlaygroundService.getInstance().getConnection(documentUri);
        const fieldLookup = (fieldName: string): string | undefined => {
            if (!connection) return undefined;
            const fields = SchemaStore.getInstance().getKnownFields(
                connection.clusterId,
                connection.databaseName,
                argCtx.collectionName,
            );
            return fields.find((f) => f.path === fieldName)?.bsonType;
        };

        // Stage 2: Inner query-object context detection (reuses webview logic)
        const cursorCtx = detectCursorContext(argumentText, cursorOffsetInArg, fieldLookup);

        // Determine if the trigger char was '$'
        const dollarTriggered =
            isDollarPrefix ||
            context.triggerCharacter === '$' ||
            (cursorOffsetInArg > 0 && argumentText[cursorOffsetInArg - 1] === '$');

        // Get field BSON types for the current field context
        const fieldBsonTypes = this.getFieldBsonTypes(cursorCtx);

        // Route based on inner context
        switch (cursorCtx.position) {
            case 'key':
            case 'array-element':
                this.addKeyPositionItems(items, argCtx, connection, dollarTriggered, replaceRange);
                break;

            case 'value':
                this.addValuePositionItems(items, cursorCtx, dollarTriggered, replaceRange);
                break;

            case 'operator':
                this.addOperatorPositionItems(items, fieldBsonTypes, dollarTriggered, replaceRange);
                break;

            default:
                // Unknown — provide everything
                this.addKeyPositionItems(items, argCtx, connection, dollarTriggered, replaceRange);
                this.addValuePositionItems(items, cursorCtx, dollarTriggered, replaceRange);
                break;
        }

        return items;
    }

    // -----------------------------------------------------------------------
    // Query-object position builders
    // -----------------------------------------------------------------------

    private addKeyPositionItems(
        items: vscode.CompletionItem[],
        argCtx: { methodName: string; collectionName: string },
        connection: { clusterId: string; databaseName: string } | null | undefined,
        _isDollarPrefix: boolean,
        replaceRange: vscode.Range,
    ): void {
        // Field names from SchemaStore
        if (connection) {
            const fields = SchemaStore.getInstance().getKnownFields(
                connection.clusterId,
                connection.databaseName,
                argCtx.collectionName,
            );

            if (fields.length === 0 && argCtx.collectionName) {
                // No schema data — offer to discover fields
                const scanItem = new vscode.CompletionItem(
                    'Discover fields in collection\u2026',
                    vscode.CompletionItemKind.Event,
                );
                scanItem.detail = 'Sample ~100 documents to discover field names';
                scanItem.sortText = '!00_scan';
                scanItem.insertText = '';
                scanItem.command = {
                    command: PlaygroundCommandIds.scanCollectionSchema,
                    title: 'Discover Fields',
                    arguments: [connection.clusterId, connection.databaseName, argCtx.collectionName],
                };
                items.push(scanItem);
            }

            for (const field of fields) {
                // Quote field names that contain dots or special characters
                const needsQuoting = /[.\\s-]/.test(field.path);
                const displayName = field.path;
                const insertName = needsQuoting ? `"${field.path}"` : field.path;

                const item = new vscode.CompletionItem(displayName, vscode.CompletionItemKind.Field);
                const displayType = BSONTypes.toDisplayString(field.bsonType as BSONTypes);
                item.detail = `${displayType}${field.isSparse ? ' (sparse)' : ''}`;
                item.insertText = new vscode.SnippetString(`${insertName}: $1`);
                item.sortText = `!00_${field.path}`;
                item.command = completionAcceptedCommand('field');
                items.push(item);
            }
        }

        // Key-position operators ($and, $or, $nor, etc.)
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (op.standalone === false) continue;
            if (KEY_POSITION_OPERATORS.has(op.value)) {
                const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
                item.detail = op.description;
                if (op.snippet) {
                    item.insertText = new vscode.SnippetString(escapeSnippetDollars(op.snippet));
                }
                item.sortText = `!1_${op.value}`;
                item.range = replaceRange;
                item.command = completionAcceptedCommand('operator');
                if (op.link) {
                    item.documentation = new vscode.MarkdownString(`${op.description}\n\n[Documentation](${op.link})`);
                }
                items.push(item);
            }
        }
    }

    private addValuePositionItems(
        items: vscode.CompletionItem[],
        cursorCtx: CursorContext,
        _isDollarPrefix: boolean,
        replaceRange: vscode.Range,
    ): void {
        const fieldBsonTypes = this.getFieldBsonTypes(cursorCtx);

        // Type-aware value suggestions (true/false for booleans, range for numbers, etc.)
        const fieldBsonType = cursorCtx.position === 'value' ? cursorCtx.fieldBsonType : undefined;
        const typeSuggestions = getTypeSuggestionDefs(fieldBsonType);
        for (let i = 0; i < typeSuggestions.length; i++) {
            const def = typeSuggestions[i];
            const item = new vscode.CompletionItem(
                def.label,
                def.isSnippet ? vscode.CompletionItemKind.Snippet : vscode.CompletionItemKind.Value,
            );
            item.detail = def.description;
            if (def.isSnippet) {
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(def.insertText));
            } else {
                item.insertText = def.insertText;
            }
            item.sortText = `!00_${String(i).padStart(2, '0')}`;
            if (i === 0) item.preselect = true;
            if (def.documentation) {
                item.documentation = new vscode.MarkdownString(def.documentation);
            }
            item.command = completionAcceptedCommand('typeSuggestion');
            items.push(item);
        }

        // Query operators with braces (value position)
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (op.standalone === false) continue; // Skip nested-only operators
            if (KEY_POSITION_OPERATORS.has(op.value)) continue; // Skip key-level operators

            const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
            item.detail = op.description;
            if (op.snippet) {
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(op.snippet));
            }
            item.sortText = `${getVscodeOperatorSortPrefix(op, fieldBsonTypes)}${op.value}`;
            item.range = replaceRange;
            item.command = completionAcceptedCommand('operator');
            if (op.link) {
                item.documentation = new vscode.MarkdownString(`${op.description}\n\n[Documentation](${op.link})`);
            }
            items.push(item);
        }

        // BSON constructors
        const bsonEntries = getFilteredCompletions({ meta: ['bson'] });
        for (const bson of bsonEntries) {
            const item = new vscode.CompletionItem(bson.value, vscode.CompletionItemKind.Constructor);
            item.detail = bson.description;
            if (bson.snippet) {
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(bson.snippet));
            }
            item.sortText = `!3_${bson.value}`;
            item.command = completionAcceptedCommand('bsonConstructor');
            items.push(item);
        }
    }

    private addOperatorPositionItems(
        items: vscode.CompletionItem[],
        fieldBsonTypes: readonly string[] | undefined,
        _isDollarPrefix: boolean,
        replaceRange: vscode.Range,
    ): void {
        // Operators only (braces stripped, type-aware sorting)
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (op.standalone === false) continue;
            if (KEY_POSITION_OPERATORS.has(op.value)) continue;

            const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
            item.detail = op.description;
            if (op.snippet) {
                // Strip outer braces for operator position
                const stripped = stripOuterBraces(op.snippet);
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(stripped));
            }
            item.sortText = `${getVscodeOperatorSortPrefix(op, fieldBsonTypes)}${op.value}`;
            item.range = replaceRange;
            item.command = completionAcceptedCommand('operator');
            if (op.link) {
                item.documentation = new vscode.MarkdownString(`${op.description}\n\n[Documentation](${op.link})`);
            }
            items.push(item);
        }
    }

    private provideGenericOperatorCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (op.standalone === false) continue;
            const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
            item.detail = op.description;
            if (op.snippet) {
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(op.snippet));
            }
            items.push(item);
        }
        return items;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Check if the cursor is inside a string literal argument to getCollection() or use().
     * Returns collection names if so, undefined to continue with normal flow.
     */
    private checkStringLiteralContext(
        text: string,
        offset: number,
        documentUri: vscode.Uri,
    ): vscode.CompletionItem[] | undefined {
        // Quick check: is the cursor inside a string?
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

        if (!inString) return undefined;

        // Find the enclosing method call by scanning from BEFORE the string started
        // (not from inside the string, which would confuse skipStringBackward)
        const argCtx = stringStart > 0 ? detectMethodArgContext(text, stringStart) : null;
        if (!argCtx) return undefined;

        if (argCtx.methodName === 'getCollection') {
            return this.provideStringCompletions(argCtx.methodName, documentUri) ?? [];
        }

        return undefined;
    }

    /**
     * Resolve the actual collection name, handling db.getCollection("name").find({}) pattern.
     *
     * For `db.getCollection("restaurants").find({...})`, detectMethodArgContext reads backward
     * from `.find(` and hits `)` (the closing paren of getCollection), so `collectionName`
     * may be empty or 'getCollection'. We look backward in the text for the getCollection pattern.
     */
    private resolveCollectionName(
        argCtx: { methodName: string; collectionName: string; argStart: number },
        text: string,
    ): string {
        // When detectMethodArgContext hits a `)` before the method, collectionName is empty.
        // Also handle the case where collectionName is 'getCollection' directly.
        if (argCtx.collectionName === 'getCollection' || argCtx.collectionName === '') {
            const beforeArg = text.substring(0, argCtx.argStart);
            // Match: .getCollection("name").methodName(
            // beforeArg ends with the opening `(` of the current method call,
            // so match it explicitly with trailing `\(\s*`
            const match = beforeArg.match(/\.getCollection\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*\w+\s*\(\s*$/);
            if (match) {
                return match[1];
            }
        }
        return argCtx.collectionName;
    }

    private getFieldBsonTypes(cursorCtx: CursorContext): readonly string[] | undefined {
        if (cursorCtx.position === 'value' || cursorCtx.position === 'operator') {
            const bsonType = cursorCtx.fieldBsonType;
            return bsonType ? [bsonType] : undefined;
        }
        return undefined;
    }

    /**
     * Register this provider with VS Code.
     * Returns a disposable that unregisters the provider.
     */
    static register(): vscode.Disposable {
        const provider = new PlaygroundCompletionItemProvider();
        const disposable = vscode.languages.registerCompletionItemProvider(
            { language: PLAYGROUND_LANGUAGE_ID },
            provider,
            '.',
            '"',
            "'",
            '{',
            '$',
            '(',
            ',',
            ':',
            '[',
        );
        return vscode.Disposable.from(provider, disposable);
    }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Wraps the shared getOperatorSortPrefix with VS Code-specific adjustments:
 * - '!' prefix on all sort values (sorts above TS service completions)
 * - '!5_' for non-matching operators (below BSON '!3_' and globals '!4_')
 *
 * The shared function returns '0_', '1a_', '1b_', '2_' or undefined.
 * We remap '2_' → '5_' to push non-matching operators below BSON/globals,
 * and prepend '!' to all values.
 */
function getVscodeOperatorSortPrefix(
    entry: { meta: string; applicableBsonTypes?: readonly string[] },
    fieldBsonTypes: readonly string[] | undefined,
): string {
    const shared = getOperatorSortPrefix(entry, fieldBsonTypes);
    if (shared === undefined) {
        return '!';
    }
    // Remap '2_' (non-matching) to '5_' so it sorts below BSON (3_) and globals (4_)
    const remapped = shared === '2_' ? '5_' : shared;
    return `!${remapped}`;
}

/**
 * A valid JS identifier can be used directly as a property accessor: `db.myCollection`.
 * Names that don't match (spaces, parens, hyphens, starting with a digit, etc.)
 * must use the bracket/getCollection form: `db.getCollection('my collection')`.
 */
const JS_IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Creates a CompletionItem for a collection name in the `db.` context.
 *
 * - Simple identifiers (e.g. `stores`) insert as-is → `db.stores`
 * - Names with special characters (e.g. `stores (10)`) insert via
 *   `getCollection('...')` → `db.getCollection('stores (10)')`
 *
 * Exported for testing.
 */
export function collectionNameToCompletionItem(name: string): vscode.CompletionItem {
    const needsGetCollection = !JS_IDENTIFIER_PATTERN.test(name);

    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = 'discovered collection';
    item.sortText = `!0_${name}`;
    item.command = completionAcceptedCommand('collectionName');

    if (needsGetCollection) {
        // Escape single quotes and backslashes inside the collection name
        const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        item.insertText = `getCollection('${escaped}')`;
        // filterText must match what the user typed after `db.` so the item
        // still appears when filtering by the bare collection name.
        item.filterText = name;
    }

    return item;
}

/**
 * Creates a VS Code command descriptor for tracking completion acceptance.
 * Fires the internal telemetry command when the user selects this completion item.
 */
function completionAcceptedCommand(category: string): vscode.Command {
    return {
        command: 'vscode-documentdb.command.internal.completionAccepted',
        title: '',
        arguments: [category, 'playground'],
    };
}
