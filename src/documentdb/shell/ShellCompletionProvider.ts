/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provides context-aware completion candidates for the interactive shell.
 *
 * This module is platform-neutral (no VS Code API dependencies) and operates
 * entirely on synchronous cache reads so that Tab completion never blocks.
 *
 * Data sources:
 * - Static lists for top-level commands and `show` subcommands
 * - `ClustersClient` cached data for database/collection names
 * - `SchemaStore` for field names and schema-derived collection names
 * - `operator-registry` for query operators and BSON constructors
 * - `shell-api-types` for shell API method names
 */

import {
    FILTER_COMPLETION_META,
    getFilteredCompletions,
    META_BSON,
    type OperatorEntry,
    STAGE_COMPLETION_META,
    UPDATE_COMPLETION_META,
} from '@documentdb-js/operator-registry';
import { getMethodsByTarget } from '@documentdb-js/shell-api-types';
import { ClustersClient } from '../ClustersClient';
import { SchemaStore } from '../SchemaStore';
import { detectCursorContext, type FieldTypeLookup } from '../query-language/shared/cursorContext';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Completion candidate returned by the provider.
 */
export interface CompletionCandidate {
    /** Display text shown in the completion list. */
    readonly label: string;
    /** Text to insert into the buffer (may differ from label). */
    readonly insertText: string;
    /** Kind of completion (used for sorting and display). */
    readonly kind: 'command' | 'database' | 'collection' | 'method' | 'field' | 'operator' | 'bson';
    /** Optional description shown alongside the label. */
    readonly detail?: string;
}

/**
 * Context required by the completion provider to resolve dynamic completions.
 */
export interface ShellCompletionContext {
    /** Stable cluster ID for cache lookups. */
    readonly clusterId: string;
    /** Current active database name. */
    readonly databaseName: string;
}

/**
 * Result returned by {@link ShellCompletionProvider.getCompletions}.
 */
export interface CompletionResult {
    /** The completion candidates, already filtered by the current prefix. */
    readonly candidates: readonly CompletionCandidate[];
    /** The prefix text used for filtering (text from replacement start to cursor). */
    readonly prefix: string;
    /** The start offset in the buffer where the replacement should begin. */
    readonly replacementStart: number;
}

// ─── Shell context detection ─────────────────────────────────────────────────

/**
 * The detected shell context describing what kind of completions to provide.
 */
type ShellContext =
    | { kind: 'top-level'; prefix: string }
    | { kind: 'show-subcommand'; prefix: string }
    | { kind: 'use-database'; prefix: string }
    | { kind: 'db-dot'; prefix: string }
    | { kind: 'db-bracket'; prefix: string; quote: '"' | "'" | '' }
    | { kind: 'collection-method'; collectionName: string; prefix: string }
    | { kind: 'cursor-chain'; cursorType: 'find' | 'aggregate'; prefix: string }
    | {
          kind: 'method-argument';
          collectionName: string;
          methodName: string;
          argumentText: string;
          cursorOffsetInArg: number;
      }
    | { kind: 'unknown' };

// ─── Static data ─────────────────────────────────────────────────────────────

const TOP_LEVEL_COMMANDS: readonly CompletionCandidate[] = [
    { label: 'show', insertText: 'show', kind: 'command', detail: 'Show databases or collections' },
    { label: 'use', insertText: 'use', kind: 'command', detail: 'Switch database' },
    { label: 'exit', insertText: 'exit', kind: 'command', detail: 'Exit shell' },
    { label: 'quit', insertText: 'quit', kind: 'command', detail: 'Exit shell' },
    { label: 'cls', insertText: 'cls', kind: 'command', detail: 'Clear screen' },
    { label: 'clear', insertText: 'clear', kind: 'command', detail: 'Clear screen' },
    { label: 'help', insertText: 'help', kind: 'command', detail: 'Show help' },
    { label: 'it', insertText: 'it', kind: 'command', detail: 'Iterate cursor' },
    { label: 'db', insertText: 'db', kind: 'command', detail: 'Current database' },
];

const SHOW_SUBCOMMANDS: readonly CompletionCandidate[] = [
    { label: 'dbs', insertText: 'dbs', kind: 'command', detail: 'List databases' },
    { label: 'databases', insertText: 'databases', kind: 'command', detail: 'List databases' },
    { label: 'collections', insertText: 'collections', kind: 'command', detail: 'List collections' },
];

/** Known database methods — derived from shell API types to stay in sync automatically. */
const DATABASE_METHODS = new Set(getMethodsByTarget('database').map((m) => m.name));

/** Methods that return a find cursor. */
const FIND_CURSOR_METHODS = new Set(['find']);

/** Methods that return an aggregation cursor. */
const AGG_CURSOR_METHODS = new Set(['aggregate']);

/**
 * Methods whose first argument is a filter/query object (for field completions).
 */
const FILTER_ARG_METHODS = new Set(['find', 'findOne', 'deleteOne', 'deleteMany', 'countDocuments', 'distinct']);

/**
 * Methods whose first argument is an update operator object.
 */
const UPDATE_ARG_METHODS = new Set(['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne']);

/**
 * Methods whose first argument is an aggregation pipeline.
 */
const PIPELINE_ARG_METHODS = new Set(['aggregate']);

/**
 * Regex to match a completed bracket-notation collection access: db['name'] or db["name"]
 * Captures the collection name and provides the position after the closing `]`.
 */
const DB_BRACKET_COMPLETE_RE = /^db\[(['"])((?:(?!\1).)*)\1\]/;

/**
 * Returns true if a collection name requires bracket notation (contains characters
 * that are not valid in a JavaScript dot-access identifier).
 */
function needsBracketNotation(name: string): boolean {
    return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class ShellCompletionProvider {
    /** Tracks background fetches already triggered to avoid duplicate network requests. */
    private readonly _backgroundFetchTriggered = new Set<string>();

    /**
     * Get completion candidates for the current input buffer and cursor position.
     *
     * All data reads are synchronous (from caches). If a cache is empty, a
     * background fetch is triggered so that subsequent Tab presses have data.
     */
    getCompletions(buffer: string, cursor: number, context: ShellCompletionContext): CompletionResult {
        const shellCtx = this.detectContext(buffer, cursor);

        switch (shellCtx.kind) {
            case 'top-level':
                return this.buildResult(TOP_LEVEL_COMMANDS, shellCtx.prefix, 0);

            case 'show-subcommand':
                return this.buildResult(SHOW_SUBCOMMANDS, shellCtx.prefix, 'show '.length);

            case 'use-database':
                return this.buildResult(this.getDatabaseCandidates(context), shellCtx.prefix, 'use '.length);

            case 'db-dot':
                return this.buildResult(this.getDbDotCandidates(context), shellCtx.prefix, 'db.'.length);

            case 'db-bracket':
                return this.buildResult(
                    this.getDbBracketCandidates(context, shellCtx.quote),
                    shellCtx.prefix,
                    shellCtx.quote ? 'db[x'.length : 'db['.length,
                );

            case 'collection-method':
                return this.buildResult(
                    this.getCollectionMethodCandidates(),
                    shellCtx.prefix,
                    this.findReplacementStart(buffer, cursor),
                );

            case 'cursor-chain':
                return this.buildResult(
                    this.getCursorMethodCandidates(shellCtx.cursorType),
                    shellCtx.prefix,
                    this.findReplacementStart(buffer, cursor),
                );

            case 'method-argument':
                return this.buildResult(
                    this.getMethodArgumentCandidates(shellCtx, context),
                    this.extractArgumentPrefix(shellCtx.argumentText, shellCtx.cursorOffsetInArg),
                    this.findReplacementStart(buffer, cursor),
                );

            case 'unknown':
                return { candidates: [], prefix: '', replacementStart: cursor };
        }
    }

    // ─── Context detection ───────────────────────────────────────────────────

    /**
     * Detect the shell context from the current buffer and cursor position.
     */
    detectContext(buffer: string, cursor: number): ShellContext {
        // Work with text up to the cursor
        const text = buffer.slice(0, cursor);
        const trimmed = text.trimStart();

        // Empty or whitespace-only → top-level
        if (trimmed.length === 0) {
            return { kind: 'top-level', prefix: '' };
        }

        // `show <partial>`
        if (/^show\s+/i.test(trimmed)) {
            const prefix = trimmed.slice(trimmed.indexOf(' ') + 1).trimStart();
            return { kind: 'show-subcommand', prefix };
        }

        // `show` (without space yet, but partial word)
        // This falls through to top-level prefix matching

        // `use <partial>`
        if (/^use\s+/i.test(trimmed)) {
            const prefix = trimmed.slice(trimmed.indexOf(' ') + 1).trimStart();
            return { kind: 'use-database', prefix };
        }

        // Check for completed db['name'] or db["name"] bracket notation
        const bracketCompleteMatch = DB_BRACKET_COMPLETE_RE.exec(trimmed);
        if (bracketCompleteMatch) {
            const collectionName = bracketCompleteMatch[2];
            const afterBracket = trimmed.slice(bracketCompleteMatch[0].length);

            // db['name']. or db['name'].method... — collection method access
            if (afterBracket.startsWith('.')) {
                return this.detectBracketDbContext(trimmed, collectionName, afterBracket.slice(1), cursor);
            }

            // db['name']<cursor> — completed bracket, no completions needed
            return { kind: 'unknown' };
        }

        // Check for db[ bracket notation: db[, db[', db["
        const bracketMatch = /^db\[(["']?)([a-zA-Z0-9_$]*)$/.exec(trimmed);
        if (bracketMatch) {
            const quote = (bracketMatch[1] ?? '') as '"' | "'" | '';
            const prefix = bracketMatch[2] ?? '';
            return { kind: 'db-bracket', prefix, quote };
        }

        // Check for db. patterns
        if (trimmed.startsWith('db.')) {
            return this.detectDbContext(trimmed, text, cursor);
        }

        // Prefix matching against top-level commands
        return { kind: 'top-level', prefix: trimmed };
    }

    /**
     * Detect context for expressions starting with `db.`
     */
    private detectDbContext(trimmed: string, _fullText: string, cursor: number): ShellContext {
        // Extract the chain after `db.`
        const afterDb = trimmed.slice(3); // Skip 'db.'

        // Check if we're inside a method argument: find the outermost open paren
        const argContext = this.detectMethodArgContext(trimmed, cursor);
        if (argContext) {
            return argContext;
        }

        // Check for cursor chain: db.collection.find({}).| or db.collection.find({}).limit(10).|
        const cursorChain = this.detectCursorChain(trimmed);
        if (cursorChain) {
            return cursorChain;
        }

        // db.<collection>.| — check if there's a second dot (collection method access)
        const dotIndex = afterDb.indexOf('.');
        if (dotIndex >= 0) {
            const collectionName = afterDb.slice(0, dotIndex);
            // Skip database methods — they don't have sub-completions
            if (!DATABASE_METHODS.has(collectionName)) {
                const prefix = afterDb.slice(dotIndex + 1);
                return { kind: 'collection-method', collectionName, prefix };
            }
        }

        // db.| or db.<partial> — completing collection name or database method
        return { kind: 'db-dot', prefix: afterDb };
    }

    /**
     * Detect context for expressions starting with `db['name'].` (bracket notation).
     * Mirrors {@link detectDbContext} but extracts the collection name from brackets.
     */
    private detectBracketDbContext(
        trimmed: string,
        collectionName: string,
        afterDot: string,
        cursor: number,
    ): ShellContext {
        // Check if we're inside a method argument
        const argContext = this.detectMethodArgContext(trimmed, cursor);
        if (argContext) {
            return argContext;
        }

        // Check for cursor chain: db['name'].find({}).| or db['name'].find({}).limit(10).|
        const cursorChain = this.detectCursorChain(trimmed);
        if (cursorChain) {
            return cursorChain;
        }

        // db['name'].| or db['name'].<partial> — collection method access
        return { kind: 'collection-method', collectionName, prefix: afterDot };
    }

    /**
     * Detect if the cursor is inside a method call argument.
     * Looks for the last unmatched open parenthesis.
     */
    private detectMethodArgContext(text: string, _cursor: number): ShellContext | undefined {
        // Find the last unmatched `(` — that's the method call we're inside
        let depth = 0;
        let openParenPos = -1;

        for (let i = text.length - 1; i >= 0; i--) {
            const ch = text[i];
            if (ch === ')') {
                depth++;
            } else if (ch === '(') {
                if (depth === 0) {
                    openParenPos = i;
                    break;
                }
                depth--;
            }
        }

        if (openParenPos < 0) {
            return undefined;
        }

        // Extract method name and collection name from the text before `(`
        // Supports both dot notation: db.collection.method(
        // and bracket notation: db['collection'].method(
        const beforeParen = text.slice(0, openParenPos);

        // Try dot notation first: db.collection.method
        let collectionName: string | undefined;
        let methodName: string | undefined;

        const dotMatch = /db\.([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)$/.exec(beforeParen);
        if (dotMatch) {
            collectionName = dotMatch[1];
            methodName = dotMatch[2];
        } else {
            // Try bracket notation: db['collection'].method or db["collection"].method
            const bracketMatch = /db\[(['"])((?:(?!\1).)*)\1\]\.([a-zA-Z0-9_$]+)$/.exec(beforeParen);
            if (bracketMatch) {
                collectionName = bracketMatch[2];
                methodName = bracketMatch[3];
            }
        }

        if (!collectionName || !methodName) {
            return undefined;
        }

        // Don't treat database methods as collection methods
        if (DATABASE_METHODS.has(collectionName)) {
            return undefined;
        }

        const argumentText = text.slice(openParenPos + 1);
        const cursorOffsetInArg = argumentText.length;

        return {
            kind: 'method-argument',
            collectionName,
            methodName,
            argumentText,
            cursorOffsetInArg,
        };
    }

    /**
     * Detect if we're in a cursor chain (after a find/aggregate call).
     * Pattern: db.collection.find({...}).| or db.collection.find({...}).limit(10).|
     */
    private detectCursorChain(text: string): ShellContext | undefined {
        // Check if the text matches the pattern of a completed method call followed by a dot
        // e.g., db.users.find({}).| or db.users.find({}).limit(10).|
        // We need to find a completed call (balanced parens ending with `)`) followed by `.`

        // Walk backward to find `.methodName(...)` followed by the final `.`
        let pos = text.length - 1;

        // Collect the current prefix (after the last dot)
        let prefix = '';
        while (pos >= 0 && /[a-zA-Z0-9_$]/.test(text[pos])) {
            prefix = text[pos] + prefix;
            pos--;
        }

        // Must end with a dot
        if (pos < 0 || text[pos] !== '.') {
            return undefined;
        }
        pos--; // skip the dot

        // Must have a closing paren before the dot
        if (pos < 0 || text[pos] !== ')') {
            return undefined;
        }

        // Find the matching open paren
        let parenDepth = 0;
        let methodCallStart = -1;
        for (let i = pos; i >= 0; i--) {
            if (text[i] === ')') parenDepth++;
            else if (text[i] === '(') {
                parenDepth--;
                if (parenDepth === 0) {
                    methodCallStart = i;
                    break;
                }
            }
        }

        if (methodCallStart < 0) {
            return undefined;
        }

        // Extract the method name before the open paren
        let methodEnd = methodCallStart - 1;
        let methodName = '';
        while (methodEnd >= 0 && /[a-zA-Z0-9_$]/.test(text[methodEnd])) {
            methodName = text[methodEnd] + methodName;
            methodEnd--;
        }

        if (!methodName) {
            return undefined;
        }

        // Determine cursor type based on the originating method
        // Walk further back to see if there's a find() or aggregate() in the chain
        const chainBefore = text.slice(0, methodCallStart);
        let cursorType: 'find' | 'aggregate' = 'find'; // default

        if (/\.aggregate\s*\(/.test(chainBefore)) {
            cursorType = 'aggregate';
        } else if (/\.find\s*\(/.test(chainBefore)) {
            cursorType = 'find';
        } else if (FIND_CURSOR_METHODS.has(methodName)) {
            cursorType = 'find';
        } else if (AGG_CURSOR_METHODS.has(methodName)) {
            cursorType = 'aggregate';
        }

        return { kind: 'cursor-chain', cursorType, prefix };
    }

    // ─── Candidate generation ────────────────────────────────────────────────

    /**
     * Get database name candidates from ClustersClient cache + SchemaStore.
     */
    private getDatabaseCandidates(context: ShellCompletionContext): CompletionCandidate[] {
        const candidates: CompletionCandidate[] = [];
        const seen = new Set<string>();

        // Read from ClustersClient cache (populated by tree view expansion)
        const client = ClustersClient.getExistingClient(context.clusterId);
        if (client) {
            const cached = client.getCachedDatabases();
            if (cached) {
                for (const db of cached) {
                    if (db.name && !seen.has(db.name)) {
                        seen.add(db.name);
                        candidates.push({
                            label: db.name,
                            insertText: db.name,
                            kind: 'database',
                        });
                    }
                }
            } else {
                // No cached data — trigger a background fetch for next Tab press
                const fetchKey = `dbs:${context.clusterId}`;
                if (!this._backgroundFetchTriggered.has(fetchKey)) {
                    this._backgroundFetchTriggered.add(fetchKey);
                    void client
                        .listDatabases()
                        .catch(() => {
                            // Non-critical — degrade gracefully
                        })
                        .finally(() => {
                            this._backgroundFetchTriggered.delete(fetchKey);
                        });
                }
            }
        }

        // Merge database names from SchemaStore
        const store = SchemaStore.getInstance();
        const stats = store.getStats();
        const prefix = `${context.clusterId}::`;
        for (const coll of stats.collections) {
            if (coll.key.startsWith(prefix)) {
                const parts = coll.key.substring(prefix.length).split('::');
                const dbName = parts[0];
                if (dbName && !seen.has(dbName)) {
                    seen.add(dbName);
                    candidates.push({
                        label: dbName,
                        insertText: dbName,
                        kind: 'database',
                    });
                }
            }
        }

        return candidates.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Get candidates for `db.` — collection names + database methods.
     * Collections with special characters get bracket-notation insertText
     * so that `db.sto<Tab>` produces `db['stores (10)']` instead of `db.stores (10)`.
     */
    private getDbDotCandidates(context: ShellCompletionContext): CompletionCandidate[] {
        const candidates: CompletionCandidate[] = [];
        const seen = new Set<string>();

        // Collection names from ClustersClient cache
        const client = ClustersClient.getExistingClient(context.clusterId);
        if (client) {
            const cached = client.getCachedCollections(context.databaseName);
            if (cached) {
                for (const coll of cached) {
                    if (coll.name && !seen.has(coll.name)) {
                        seen.add(coll.name);
                        candidates.push(this.makeCollectionCandidate(coll.name));
                    }
                }
            } else {
                // Trigger background fetch
                const fetchKey = `colls:${context.clusterId}:${context.databaseName}`;
                if (!this._backgroundFetchTriggered.has(fetchKey)) {
                    this._backgroundFetchTriggered.add(fetchKey);
                    void client
                        .listCollections(context.databaseName)
                        .catch(() => {
                            // Non-critical
                        })
                        .finally(() => {
                            this._backgroundFetchTriggered.delete(fetchKey);
                        });
                }
            }
        }

        // Collection names from SchemaStore
        const store = SchemaStore.getInstance();
        const stats = store.getStats();
        const keyPrefix = `${context.clusterId}::${context.databaseName}::`;
        for (const coll of stats.collections) {
            if (coll.key.startsWith(keyPrefix)) {
                const collName = coll.key.substring(keyPrefix.length);
                if (collName && !seen.has(collName)) {
                    seen.add(collName);
                    candidates.push(this.makeCollectionCandidate(collName));
                }
            }
        }

        // Database methods
        const methods = getMethodsByTarget('database');
        for (const method of methods) {
            if (!seen.has(method.name)) {
                seen.add(method.name);
                candidates.push({
                    label: method.name,
                    insertText: method.name,
                    kind: 'method',
                    detail: method.description,
                });
            }
        }

        return candidates.sort((a, b) => {
            // Collections before methods
            if (a.kind !== b.kind) {
                return a.kind === 'collection' ? -1 : 1;
            }
            return a.label.localeCompare(b.label);
        });
    }

    /**
     * Get candidates for `db[` bracket notation — collection names only.
     *
     * Wraps each collection name with the appropriate quote + closing bracket
     * so that completing `db[` inserts e.g. `'restaurants']` and completing
     * `db['` inserts `restaurants']`.
     */
    private getDbBracketCandidates(context: ShellCompletionContext, quote: '"' | "'" | ''): CompletionCandidate[] {
        const candidates: CompletionCandidate[] = [];
        const seen = new Set<string>();

        // The suffix appended after the collection name
        const closeQuote = quote || "'";
        const openQuote = quote ? '' : "'";
        const suffix = `${closeQuote}]`;

        // Collection names from ClustersClient cache
        const client = ClustersClient.getExistingClient(context.clusterId);
        if (client) {
            const cached = client.getCachedCollections(context.databaseName);
            if (cached) {
                for (const coll of cached) {
                    if (coll.name && !seen.has(coll.name)) {
                        seen.add(coll.name);
                        candidates.push({
                            label: coll.name,
                            insertText: `${openQuote}${coll.name}${suffix}`,
                            kind: 'collection',
                        });
                    }
                }
            } else {
                // Trigger background fetch
                const fetchKey = `colls:${context.clusterId}:${context.databaseName}`;
                if (!this._backgroundFetchTriggered.has(fetchKey)) {
                    this._backgroundFetchTriggered.add(fetchKey);
                    void client
                        .listCollections(context.databaseName)
                        .catch(() => {
                            // Non-critical
                        })
                        .finally(() => {
                            this._backgroundFetchTriggered.delete(fetchKey);
                        });
                }
            }
        }

        // Collection names from SchemaStore
        const store = SchemaStore.getInstance();
        const stats = store.getStats();
        const keyPrefix = `${context.clusterId}::${context.databaseName}::`;
        for (const coll of stats.collections) {
            if (coll.key.startsWith(keyPrefix)) {
                const collName = coll.key.substring(keyPrefix.length);
                if (collName && !seen.has(collName)) {
                    seen.add(collName);
                    candidates.push({
                        label: collName,
                        insertText: `${openQuote}${collName}${suffix}`,
                        kind: 'collection',
                    });
                }
            }
        }

        return candidates.sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Get candidates for `db.<collection>.` — collection methods.
     */
    private getCollectionMethodCandidates(): CompletionCandidate[] {
        const methods = getMethodsByTarget('collection');
        return methods.map((m) => ({
            label: m.name,
            insertText: m.name,
            kind: 'method' as const,
            detail: m.description,
        }));
    }

    /**
     * Get candidates for cursor chains (`.limit()`, `.sort()`, etc.).
     */
    private getCursorMethodCandidates(cursorType: 'find' | 'aggregate'): CompletionCandidate[] {
        const target = cursorType === 'find' ? 'findCursor' : 'aggregationCursor';
        const methods = getMethodsByTarget(target);
        return methods.map((m) => ({
            label: m.name,
            insertText: m.name,
            kind: 'method' as const,
            detail: m.description,
        }));
    }

    /**
     * Get candidates for inside a method argument (query object, update, pipeline).
     */
    private getMethodArgumentCandidates(
        ctx: Extract<ShellContext, { kind: 'method-argument' }>,
        shellCtx: ShellCompletionContext,
    ): CompletionCandidate[] {
        const candidates: CompletionCandidate[] = [];

        // Determine what kind of operators are relevant based on the method
        let metaFilter: readonly string[];
        if (FILTER_ARG_METHODS.has(ctx.methodName)) {
            metaFilter = FILTER_COMPLETION_META;
        } else if (UPDATE_ARG_METHODS.has(ctx.methodName)) {
            metaFilter = UPDATE_COMPLETION_META;
        } else if (PIPELINE_ARG_METHODS.has(ctx.methodName)) {
            metaFilter = STAGE_COMPLETION_META;
        } else {
            metaFilter = FILTER_COMPLETION_META;
        }

        // Build a field type lookup from SchemaStore (pre-compute Map for O(1) lookups)
        const fields = SchemaStore.getInstance().getKnownFields(
            shellCtx.clusterId,
            shellCtx.databaseName,
            ctx.collectionName,
        );
        const fieldTypeByPath = new Map(fields.map((f) => [f.path, f.type]));
        const fieldLookup: FieldTypeLookup = (fieldName: string): string | undefined => {
            return fieldTypeByPath.get(fieldName);
        };

        // Use the shared cursor context detection for inner query-object context
        const cursorCtx = detectCursorContext(ctx.argumentText, ctx.cursorOffsetInArg, fieldLookup);

        // Extract the prefix to determine whether the user is typing a $-operator
        const argPrefix = this.extractArgumentPrefix(ctx.argumentText, ctx.cursorOffsetInArg);
        const typingOperator = argPrefix.startsWith('$');

        switch (cursorCtx.position) {
            case 'key':
            case 'array-element': {
                if (typingOperator) {
                    // User typed `$` — show operators only
                    this.addOperatorCandidates(candidates, metaFilter);
                } else {
                    // Show field names only (operators appear once `$` is typed)
                    this.addFieldCandidates(candidates, shellCtx, ctx.collectionName);
                }
                break;
            }
            case 'value': {
                // In value position (e.g., `{ _id: | }`), operators like $gt are
                // not syntactically valid — the user must open a nested object
                // first: `{ _id: { $gt: 5 } }`. Only show BSON constructors here.
                this.addBsonCandidates(candidates);
                break;
            }
            case 'operator': {
                // Operator-position operators
                this.addOperatorCandidates(candidates, metaFilter);
                break;
            }
            default: {
                // Unknown — show fields or operators based on prefix
                if (typingOperator) {
                    this.addOperatorCandidates(candidates, metaFilter);
                } else {
                    this.addFieldCandidates(candidates, shellCtx, ctx.collectionName);
                }
                break;
            }
        }

        return candidates;
    }

    /**
     * Add field name candidates from SchemaStore.
     * Dotted paths (nested fields) get quoted insertText since they must be
     * quoted when used as keys in JavaScript object literals.
     */
    private addFieldCandidates(
        candidates: CompletionCandidate[],
        context: ShellCompletionContext,
        collectionName: string,
    ): void {
        const fields = SchemaStore.getInstance().getKnownFields(
            context.clusterId,
            context.databaseName,
            collectionName,
        );

        for (const field of fields) {
            const needsQuoting = field.path.includes('.');
            candidates.push({
                label: field.path,
                insertText: needsQuoting ? `"${field.path}"` : field.path,
                kind: 'field',
                detail: field.type,
            });
        }
    }

    /**
     * Add operator candidates from operator-registry.
     */
    private addOperatorCandidates(candidates: CompletionCandidate[], metaFilter: readonly string[]): void {
        const operators: readonly OperatorEntry[] = getFilteredCompletions({ meta: metaFilter });

        for (const op of operators) {
            candidates.push({
                label: op.value,
                insertText: op.value,
                kind: 'operator',
                detail: op.description,
            });
        }
    }

    /**
     * Add BSON constructor candidates.
     */
    private addBsonCandidates(candidates: CompletionCandidate[]): void {
        const constructors: readonly OperatorEntry[] = getFilteredCompletions({ meta: [META_BSON] });

        for (const bson of constructors) {
            candidates.push({
                label: bson.value,
                insertText: bson.value,
                kind: 'bson',
                detail: bson.description,
            });
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    /**
     * Create a collection completion candidate for the `db.` context.
     *
     * Collections with names that are valid JS identifiers use plain insertText.
     * Names with special characters (spaces, parens, hyphens, etc.) produce
     * bracket-notation insertText that rewrites the `db.` prefix:
     *   prefix `sto` → insertText `['stores (10)']` → result `db['stores (10)']`
     */
    private makeCollectionCandidate(name: string): CompletionCandidate {
        if (needsBracketNotation(name)) {
            // Escape backslashes first, then single quotes, for safe JS string literal insertion.
            const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return {
                label: name,
                insertText: `['${escaped}']`,
                kind: 'collection',
            };
        }
        return {
            label: name,
            insertText: name,
            kind: 'collection',
        };
    }

    /**
     * Build a CompletionResult by filtering candidates against the given prefix.
     */
    private buildResult(
        candidates: readonly CompletionCandidate[],
        prefix: string,
        replacementStart: number,
    ): CompletionResult {
        const lowerPrefix = prefix.toLowerCase();
        const filtered =
            lowerPrefix.length > 0
                ? candidates.filter((c) => c.label.toLowerCase().startsWith(lowerPrefix))
                : candidates;

        return { candidates: filtered, prefix, replacementStart };
    }

    /**
     * Find the start position of the current word being typed (for replacement).
     * Scans backward from cursor to find the last non-identifier character.
     * Includes '.' to support dotted nested field paths (e.g., 'address.city').
     */
    private findReplacementStart(buffer: string, cursor: number): number {
        let pos = cursor - 1;
        while (pos >= 0 && /[a-zA-Z0-9_$.]/.test(buffer[pos])) {
            pos--;
        }
        return pos + 1;
    }

    /**
     * Extract the prefix being typed inside a method argument.
     * Looks for identifier characters, $, or '.' (for nested field paths) at the cursor position.
     */
    private extractArgumentPrefix(argumentText: string, cursorOffset: number): string {
        let start = cursorOffset - 1;
        while (start >= 0 && /[a-zA-Z0-9_$.]/.test(argumentText[start])) {
            start--;
        }
        return argumentText.slice(start + 1, cursorOffset);
    }
}
