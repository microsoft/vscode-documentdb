/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getFilteredCompletions, loadOperators } from '@vscode-documentdb/documentdb-constants';
import * as vscode from 'vscode';
import { KEY_POSITION_OPERATORS } from '../../../webviews/documentdbQuery/completions/completionKnowledge';
import { escapeSnippetDollars, stripOuterBraces } from '../../../webviews/documentdbQuery/completions/snippetUtils';
import { detectCursorContext, type CursorContext } from '../../../webviews/documentdbQuery/cursorContext';
import { SchemaStore } from '../../SchemaStore';
import { SCRATCHPAD_LANGUAGE_ID } from '../constants';
import { ScratchpadService } from '../ScratchpadService';
import {
    AGGREGATION_CURSOR_METHODS,
    COLLECTION_METHODS,
    DATABASE_METHODS,
    FIND_CURSOR_METHODS,
    SHELL_GLOBALS,
    type ShellCompletionEntry,
} from './completionRegistry';
import { detectMethodArgContext, detectScratchpadContext } from './scratchpadContextDetector';

// Ensure operators are loaded
loadOperators();

/**
 * Provides context-aware completions for DocumentDB scratchpad files.
 *
 * This is Layer 2 of the two-layer autocompletion system. It handles:
 * - Shell globals and BSON constructors (S1)
 * - Dynamic collection names from SchemaStore (S2)
 * - Query operators and field names inside method arguments (Q1-Q8)
 * - Collection name completions inside strings (S6)
 *
 * Layer 1 (TypeScript Server Plugin + .d.ts) handles method chains,
 * cursor methods, hover docs, and signature help.
 */
export class ScratchpadCompletionItemProvider implements vscode.CompletionItemProvider, vscode.Disposable {
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
        const stringCompletions = this.checkStringLiteralContext(text, offset);
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
            return this.provideMethodArgumentCompletions(resolved, text, offset, context, replaceRange, isDollarPrefix);
        }

        // Stage 1: JS-level context detection
        const scratchpadCtx = detectScratchpadContext(text, offset);

        switch (scratchpadCtx.kind) {
            case 'top-level':
                return this.provideTopLevelCompletions();

            case 'db-dot':
                return this.provideDbDotCompletions();

            case 'collection-method':
                return this.provideCollectionMethodCompletions();

            case 'find-cursor-chain':
                return this.provideFindCursorCompletions();

            case 'aggregate-cursor-chain':
                return this.provideAggCursorCompletions();

            case 'string-literal':
                return this.provideStringCompletions(scratchpadCtx.enclosingCall);

            case 'method-argument':
                // This case is handled above via detectMethodArgContext,
                // but as a fallback, provide generic operator completions
                return this.provideGenericOperatorCompletions();

            default:
                return undefined; // Let TS service handle it
        }
    }

    // -----------------------------------------------------------------------
    // S1: Top-level globals
    // -----------------------------------------------------------------------

    private provideTopLevelCompletions(): vscode.CompletionItem[] {
        return SHELL_GLOBALS.map((entry) => this.toCompletionItem(entry));
    }

    // -----------------------------------------------------------------------
    // S2: db.* completions (database methods + collection names)
    // -----------------------------------------------------------------------

    private provideDbDotCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Database methods
        for (const entry of DATABASE_METHODS) {
            items.push(this.toCompletionItem(entry));
        }

        // Dynamic collection names from SchemaStore
        const connection = ScratchpadService.getInstance().getConnection();
        if (connection) {
            const collectionNames = this.getCollectionNames(connection.clusterId, connection.databaseName);
            for (const name of collectionNames) {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
                item.detail = 'collection';
                item.sortText = `0_${name}`;
                items.push(item);
            }
        }

        return items;
    }

    // -----------------------------------------------------------------------
    // S3: Collection method completions
    // -----------------------------------------------------------------------

    private provideCollectionMethodCompletions(): vscode.CompletionItem[] {
        return COLLECTION_METHODS.map((entry) => this.toCompletionItem(entry));
    }

    // -----------------------------------------------------------------------
    // S4: Find cursor chain completions
    // -----------------------------------------------------------------------

    private provideFindCursorCompletions(): vscode.CompletionItem[] {
        return FIND_CURSOR_METHODS.map((entry) => this.toCompletionItem(entry));
    }

    // -----------------------------------------------------------------------
    // S5: Aggregation cursor chain completions
    // -----------------------------------------------------------------------

    private provideAggCursorCompletions(): vscode.CompletionItem[] {
        return AGGREGATION_CURSOR_METHODS.map((entry) => this.toCompletionItem(entry));
    }

    // -----------------------------------------------------------------------
    // S6: String literal completions (collection names)
    // -----------------------------------------------------------------------

    private provideStringCompletions(enclosingCall: string): vscode.CompletionItem[] | undefined {
        if (enclosingCall === 'getCollection' || enclosingCall === 'use') {
            const connection = ScratchpadService.getInstance().getConnection();
            if (!connection) return undefined;

            const collectionNames = this.getCollectionNames(connection.clusterId, connection.databaseName);
            return collectionNames.map((name) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
                item.detail = 'collection';
                item.sortText = `0_${name}`;
                return item;
            });
        }
        return undefined;
    }

    // -----------------------------------------------------------------------
    // Q1-Q8: Method argument completions (query operators, fields, BSON)
    // -----------------------------------------------------------------------

    private provideMethodArgumentCompletions(
        argCtx: { methodName: string; collectionName: string; argStart: number },
        fullText: string,
        offset: number,
        context: vscode.CompletionContext,
        replaceRange: vscode.Range,
        isDollarPrefix: boolean,
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const argumentText = fullText.substring(argCtx.argStart, offset);
        const cursorOffsetInArg = offset - argCtx.argStart;

        // Use the field type lookup from SchemaStore
        const connection = ScratchpadService.getInstance().getConnection();
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
            for (const field of fields) {
                // Quote field names that contain dots or special characters
                const needsQuoting = /[.\\s-]/.test(field.path);
                const displayName = field.path;
                const insertName = needsQuoting ? `"${field.path}"` : field.path;

                const item = new vscode.CompletionItem(displayName, vscode.CompletionItemKind.Field);
                item.detail = `${field.bsonType}${field.isSparse ? ' (sparse)' : ''}`;
                item.insertText = new vscode.SnippetString(`${insertName}: $1`);
                item.sortText = `0_${field.path}`;
                items.push(item);
            }
        }

        // Key-position operators ($and, $or, $nor, etc.)
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (KEY_POSITION_OPERATORS.has(op.value)) {
                const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
                item.detail = op.description;
                if (op.snippet) {
                    item.insertText = new vscode.SnippetString(escapeSnippetDollars(op.snippet));
                }
                item.sortText = `1_${op.value}`;
                item.range = replaceRange;
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

        // Query operators with braces (value position)
        const allOperators = getFilteredCompletions({ meta: ['query'] });
        for (const op of allOperators) {
            if (KEY_POSITION_OPERATORS.has(op.value)) continue; // Skip key-level operators

            const item = new vscode.CompletionItem(op.value, vscode.CompletionItemKind.Operator);
            item.detail = op.description;
            if (op.snippet) {
                item.insertText = new vscode.SnippetString(escapeSnippetDollars(op.snippet));
            }
            item.sortText = `${getVscodeOperatorSortPrefix(op, fieldBsonTypes)}${op.value}`;
            item.range = replaceRange;
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
            item.sortText = `3_${bson.value}`;
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
    private checkStringLiteralContext(text: string, offset: number): vscode.CompletionItem[] | undefined {
        // Quick check: is the cursor inside a string?
        let inString = false;
        let quoteChar = '';
        for (let i = 0; i < offset; i++) {
            const ch = text[i];
            if (i > 0 && text[i - 1] === '\\') continue;
            if ((ch === '"' || ch === "'") && (!inString || ch === quoteChar)) {
                inString = !inString;
                quoteChar = inString ? ch : '';
            }
        }

        if (!inString) return undefined;

        // Find the enclosing method call
        const argCtx = detectMethodArgContext(text, offset);
        if (!argCtx) return undefined;

        if (argCtx.methodName === 'getCollection' || argCtx.methodName === 'use') {
            return this.provideStringCompletions(argCtx.methodName) ?? [];
        }

        return undefined;
    }

    /**
     * Resolve the actual collection name, handling db.getCollection("name").find({}) pattern.
     * When the user writes `db.getCollection("restaurants").find({...})`, the argContext
     * has collectionName="getCollection" (the method before .find). We need to extract
     * "restaurants" from the getCollection argument.
     */
    private resolveCollectionName(
        argCtx: { methodName: string; collectionName: string; argStart: number },
        text: string,
    ): string {
        if (argCtx.collectionName === 'getCollection') {
            // Look backward from the method for the getCollection("name") pattern
            // The argContext.argStart points to the opening of find({ — we need to find getCollection("name")
            const beforeArg = text.substring(0, argCtx.argStart);
            // Look for .getCollection("name"). or .getCollection('name').
            const match = beforeArg.match(/\.getCollection\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*$/);
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

    private getCollectionNames(clusterId: string, databaseName: string): string[] {
        const store = SchemaStore.getInstance();
        const stats = store.getStats();
        const prefix = `${clusterId}::${databaseName}::`;
        const names: string[] = [];
        for (const coll of stats.collections) {
            if (coll.key.startsWith(prefix)) {
                const collName = coll.key.substring(prefix.length);
                if (collName) names.push(collName);
            }
        }
        return names;
    }

    private toCompletionItem(entry: ShellCompletionEntry): vscode.CompletionItem {
        const kind = mapKind(entry.kind);
        const item = new vscode.CompletionItem(entry.label, kind);
        item.detail = entry.description;
        item.sortText = `${entry.sortPrefix}${entry.label}`;

        if (entry.snippet) {
            item.insertText = new vscode.SnippetString(entry.snippet);
        }

        return item;
    }

    /**
     * Register this provider with VS Code.
     * Returns a disposable that unregisters the provider.
     */
    static register(): vscode.Disposable {
        const provider = new ScratchpadCompletionItemProvider();
        const disposable = vscode.languages.registerCompletionItemProvider(
            { language: SCRATCHPAD_LANGUAGE_ID },
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

function mapKind(kind: ShellCompletionEntry['kind']): vscode.CompletionItemKind {
    switch (kind) {
        case 'function':
            return vscode.CompletionItemKind.Function;
        case 'variable':
            return vscode.CompletionItemKind.Variable;
        case 'method':
            return vscode.CompletionItemKind.Method;
        case 'module':
            return vscode.CompletionItemKind.Module;
        case 'constructor':
            return vscode.CompletionItemKind.Constructor;
    }
}

/**
 * Port of getOperatorSortPrefix from the webview completion provider.
 * Produces sort prefixes for type-aware operator ordering.
 */
function getVscodeOperatorSortPrefix(
    entry: { meta: string; applicableBsonTypes?: readonly string[] },
    fieldBsonTypes: readonly string[] | undefined,
): string {
    if (!fieldBsonTypes || fieldBsonTypes.length === 0) {
        return '';
    }
    if (!entry.applicableBsonTypes || entry.applicableBsonTypes.length === 0) {
        return entry.meta === 'query:comparison' ? '1a_' : '1b_';
    }
    const hasMatch = entry.applicableBsonTypes.some((t) => fieldBsonTypes.includes(t));
    return hasMatch ? '0_' : '2_';
}
