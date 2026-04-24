/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShellInstanceState } from '@mongosh/shell-api';
import { ShellEvaluator } from '@mongosh/shell-evaluator';
import { type MongoClient } from 'mongodb';
import vm from 'vm';
import { CommandInterceptor } from './CommandInterceptor';
import { DocumentDBServiceProvider } from './DocumentDBServiceProvider';
import { HelpProvider } from './HelpProvider';
import { ResultTransformer } from './ResultTransformer';
import {
    type ShellEvalOptions,
    type ShellEvaluationResult,
    type ShellRuntimeCallbacks,
    type ShellRuntimeOptions,
} from './types';

/**
 * Matches `<cmd> <arg>` on a single line. Used to extract the argument text
 * after the scanner has already confirmed that `<cmd>` starts a real top-level
 * `use`/`show` statement (not inside a string, comment, or regex literal).
 */
const DIRECT_COMMAND_LINE_RE = /^(\s*)(use|show)\s+([^(\s][^;]*?)\s*;?\s*$/;

const DEFAULT_OPTIONS: ShellRuntimeOptions = {
    productName: 'DocumentDB for VS Code',
    productDocsLink: 'https://github.com/microsoft/vscode-documentdb',
    displayBatchSize: 50,
    persistent: false,
};

/**
 * Shell runtime abstraction for DocumentDB.
 *
 * Wraps the @mongosh evaluation pipeline behind a clean API that both the
 * query playground (scratchpad) and future interactive shell (Step 9) consume.
 *
 * The runtime:
 * - Intercepts known commands (help) before they reach @mongosh
 * - Creates a fresh @mongosh evaluation context per `evaluate()` call
 * - Transforms raw @mongosh ShellResult into a protocol-agnostic result type
 * - Delegates to `DocumentDBServiceProvider` for database operations
 *
 * The caller owns the `MongoClient` lifecycle — the runtime only uses it.
 *
 * @example
 * ```typescript
 * const runtime = new DocumentDBShellRuntime(mongoClient, {
 *     onConsoleOutput: (output) => console.log(output),
 *     onLog: (level, msg) => logger[level](msg),
 * });
 *
 * const result = await runtime.evaluate('db.users.find({})', 'myDatabase');
 * console.log(result.type, result.printable);
 *
 * runtime.dispose();
 * ```
 */
export class DocumentDBShellRuntime {
    private readonly _mongoClient: MongoClient;
    private readonly _callbacks: ShellRuntimeCallbacks;
    private readonly _options: ShellRuntimeOptions;
    private readonly _commandInterceptor: CommandInterceptor;
    private readonly _resultTransformer: ResultTransformer;
    private _disposed = false;

    // Persistent mode state — reused across evaluate() calls when options.persistent is true
    private _persistent:
        | {
              instanceState: ShellInstanceState;
              evaluator: ShellEvaluator;
              context: Record<string, unknown>;
              vmContext: vm.Context;
          }
        | undefined;

    constructor(mongoClient: MongoClient, callbacks?: ShellRuntimeCallbacks, options?: ShellRuntimeOptions) {
        this._mongoClient = mongoClient;
        this._callbacks = callbacks ?? {};
        this._options = { ...DEFAULT_OPTIONS, ...options };
        const helpSurface = this._options.persistent ? 'shell' : 'playground';
        this._commandInterceptor = new CommandInterceptor(new HelpProvider(helpSurface));
        this._resultTransformer = new ResultTransformer();
    }

    /**
     * Evaluate shell code against the specified database.
     *
     * Creates a fresh @mongosh context per call — no variable leakage between
     * evaluations. The target database is pre-selected via `use()` before
     * executing user code.
     *
     * @param code - JavaScript/shell code string to evaluate
     * @param databaseName - Target database name for execution
     * @param evalOptions - Per-eval overrides (e.g. displayBatchSize from user settings)
     * @returns Evaluation result with type, printable value, and timing
     * @throws Error if the runtime has been disposed
     * @throws Error if @mongosh evaluation fails (syntax error, runtime error, etc.)
     */
    async evaluate(code: string, databaseName: string, evalOptions?: ShellEvalOptions): Promise<ShellEvaluationResult> {
        if (this._disposed) {
            throw new Error('Shell runtime has been disposed');
        }

        // Check for intercepted commands (help, etc.)
        const intercepted = this._commandInterceptor.tryIntercept(code);
        if (intercepted) {
            return intercepted;
        }

        // Normalize bare direct commands (`use dbName`, `show dbs`) into function-call
        // form (`use("dbName")`, `show("dbs")`) so they go through the async rewriter
        // instead of short-circuiting. Without this, a bare `use` as the first token
        // of a multi-line block consumes the entire input and silently drops subsequent
        // statements.
        code = normalizeDirectCommands(code);

        this.log(
            'trace',
            `Evaluating code (${code.split('\n').length} lines, ${code.length} chars, db: ${databaseName})`,
        );

        const startTime = Date.now();

        if (this._options.persistent) {
            return this.evaluatePersistent(code, databaseName, evalOptions, startTime);
        } else {
            return this.evaluateFresh(code, databaseName, evalOptions, startTime);
        }
    }

    /**
     * Fresh-context evaluation (playground mode).
     * Creates a new @mongosh context per call — no variable leakage between evaluations.
     */
    private async evaluateFresh(
        code: string,
        databaseName: string,
        evalOptions: ShellEvalOptions | undefined,
        startTime: number,
    ): Promise<ShellEvaluationResult> {
        // Create fresh shell context per execution
        const { serviceProvider, bus } = DocumentDBServiceProvider.createForDocumentDB(
            this._mongoClient,
            this._options.productName,
            this._options.productDocsLink,
        );
        const instanceState = new ShellInstanceState(serviceProvider, bus);
        try {
            const evaluator = new ShellEvaluator(instanceState);

            this.applyBatchSize(instanceState, evalOptions);
            this.registerConsoleOutputListener(instanceState);

            // Set up eval context with shell globals (db, ObjectId, ISODate, etc.)
            const context = {};
            instanceState.setCtx(context);

            // Custom eval function using vm.runInContext for sandboxed execution
            // eslint-disable-next-line @typescript-eslint/require-await
            const customEvalFn = async (evalCode: string, ctx: object): Promise<unknown> => {
                const vmContext = vm.isContext(ctx) ? ctx : vm.createContext(ctx);
                return vm.runInContext(evalCode, vmContext) as unknown;
            };

            // Pre-select the target database (fresh context each time)
            await evaluator.customEval(customEvalFn, `use(${JSON.stringify(databaseName)})`, context, 'playground');

            // Evaluate user code
            const result = await evaluator.customEval(customEvalFn, code, context, 'playground');
            const durationMs = Date.now() - startTime;

            this.log('trace', `Evaluation complete (${durationMs}ms)`);

            return this._resultTransformer.transform(
                result as {
                    type: string | null;
                    printable: unknown;
                    source?: { namespace?: { db: string; collection: string } };
                },
                durationMs,
            );
        } finally {
            await instanceState.close();
        }
    }

    /**
     * Persistent-context evaluation (interactive shell mode).
     * Reuses the same @mongosh context across calls — variables, cursor state,
     * and the `db` reference persist between evaluations.
     */
    private async evaluatePersistent(
        code: string,
        databaseName: string,
        evalOptions: ShellEvalOptions | undefined,
        startTime: number,
    ): Promise<ShellEvaluationResult> {
        // Initialize persistent state on first call
        if (!this._persistent) {
            const { serviceProvider, bus } = DocumentDBServiceProvider.createForDocumentDB(
                this._mongoClient,
                this._options.productName,
                this._options.productDocsLink,
            );

            const instanceState = new ShellInstanceState(serviceProvider, bus);
            const evaluator = new ShellEvaluator(instanceState);
            const context: Record<string, unknown> = {};
            instanceState.setCtx(context);
            const vmContext = vm.createContext(context);

            this.registerConsoleOutputListener(instanceState);

            // Pre-select the initial database
            await evaluator.customEval(
                // eslint-disable-next-line @typescript-eslint/require-await
                async (evalCode: string, _ctx: object): Promise<unknown> => {
                    return vm.runInContext(evalCode, vmContext) as unknown;
                },
                `use(${JSON.stringify(databaseName)})`,
                context,
                'shell',
            );

            this._persistent = { instanceState, evaluator, context, vmContext };
        }

        const { instanceState, evaluator, context, vmContext } = this._persistent;

        // Apply batch size per-eval (may change between evaluations via settings)
        this.applyBatchSize(instanceState, evalOptions);

        // Evaluate user code using the persistent context
        const result = await evaluator.customEval(
            // eslint-disable-next-line @typescript-eslint/require-await
            async (evalCode: string, _ctx: object): Promise<unknown> => {
                return vm.runInContext(evalCode, vmContext) as unknown;
            },
            code,
            context,
            'shell',
        );
        const durationMs = Date.now() - startTime;

        this.log('trace', `Evaluation complete (${durationMs}ms)`);

        return this._resultTransformer.transform(
            result as {
                type: string | null;
                printable: unknown;
                source?: { namespace?: { db: string; collection: string } };
            },
            durationMs,
        );
    }

    /**
     * Dispose the runtime. After disposal, `evaluate()` calls will throw.
     * Does NOT close the MongoClient — the caller owns its lifecycle.
     */
    dispose(): void {
        this._disposed = true;
        this._persistent = undefined;
    }

    /**
     * Apply the display batch size to the instance state.
     * Uses @mongosh's displayBatchSizeFromDBQuery property which takes
     * precedence over config.get('displayBatchSize') in cursor iteration.
     */
    private applyBatchSize(instanceState: ShellInstanceState, evalOptions?: ShellEvalOptions): void {
        const batchSize =
            evalOptions?.displayBatchSize ?? this._options.displayBatchSize ?? DEFAULT_OPTIONS.displayBatchSize!;
        instanceState.displayBatchSizeFromDBQuery = batchSize;
    }

    /**
     * Register the console output listener on the @mongosh instance state.
     * Routes `print()`, `printjson()`, and `console.log()` output to the
     * caller-provided callback.
     */
    private registerConsoleOutputListener(instanceState: ShellInstanceState): void {
        const onConsoleOutput = this._callbacks.onConsoleOutput;
        if (!onConsoleOutput) {
            return;
        }

        instanceState.setEvaluationListener({
            onPrint(values: Array<{ printable: unknown }>, _type: 'print' | 'printjson'): void {
                const output = values
                    .map((v) => {
                        if (typeof v.printable === 'string') {
                            return v.printable;
                        }
                        try {
                            return JSON.stringify(v.printable, null, 2);
                        } catch {
                            return String(v.printable);
                        }
                    })
                    .join(' ');
                onConsoleOutput(output + '\n');
            },
        });
    }

    private log(level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string): void {
        this._callbacks.onLog?.(level, message);
    }
}

/**
 * Rewrites bare `use <name>` / `show <name>` direct shell commands into
 * function-call form (`use("<name>");` / `show("<name>");`).
 *
 * ## Why this is needed
 *
 * Direct shell commands like `use mydb` are detected by the evaluation
 * pipeline as special tokens. When they appear as the first line of a
 * multi-line code block, the pipeline processes only the direct command
 * and silently discards all subsequent statements. Converting them to
 * function-call form bypasses that short-circuit so the entire block is
 * evaluated normally.
 *
 * ## How it works
 *
 * A single linear scan of the input tracks whether each character sits in
 * plain code, a `//` line comment, a `/* ... *\/` block comment, a `'...'`
 * or `"..."` string literal, a `` `...` `` template literal (including
 * `${...}` expression nesting), or a `/.../` regex literal. Only line
 * starts that fall in the plain-code state are considered candidates for
 * rewriting. The per-line regex extracts the argument once the context
 * check has passed.
 *
 * This avoids the collateral rewrites a naive regex would produce in:
 *
 * - single- and double-quoted string literals
 * - template literals (`` `use mydb` `` as string content)
 * - line and block comments
 * - regular-expression literals (`/use mydb/`)
 *
 * ### Scope note — why a scanner, not a parser
 *
 * This is a lexical scanner, not a syntactic parser. It recognizes the
 * literal forms listed above, which covers every collateral-rewrite
 * failure mode reported so far. It intentionally does **not** understand
 * JavaScript statement structure, so a handful of exotic cases are not
 * distinguished:
 *
 * - `use` / `show` as a declared identifier rather than a statement
 *   starter (e.g. `const use = mydb; use` — runtime-invalid anyway).
 * - `use mydb` nested inside a block such as `if (x) { use mydb }`
 *   (the bare form was never valid inside a block either; rewriting it
 *   to `use("mydb");` is still a legal expression statement).
 * - Contextual keywords used where a regex is legal but the scanner
 *   guessed division, or vice-versa.
 *
 * Getting 100% of these right would require a real JS parser (e.g.
 * `acorn` / `acorn-loose`) or the TypeScript compiler. We deliberately
 * avoid adding that dependency: `@microsoft/documentdb-vscode-shell-runtime`
 * is intended to also ship as a lightweight standalone runtime for CLI
 * tooling, and pulling in a full JS parser would dominate its footprint
 * for an edge case that is not observed in real user input.
 *
 * ## ASI safety
 *
 * The emitted replacement always ends with `;` so a following line that
 * begins with `[`, `(`, `+`, `-`, or `/` starts a fresh statement instead
 * of binding to the call expression.
 */
export function normalizeDirectCommands(code: string): string {
    if (!code.includes('\n')) {
        return code;
    }

    // Cheap early exit: if neither token appears anywhere, skip scanning.
    if (!/\b(use|show)\b/.test(code)) {
        return code;
    }

    const candidateLineStarts = findCodeLineStarts(code);
    if (candidateLineStarts.length === 0) {
        return code;
    }

    type Edit = { lineStart: number; lineEnd: number; replacement: string };
    const edits: Edit[] = [];

    for (const lineStart of candidateLineStarts) {
        const nextNewline = code.indexOf('\n', lineStart);
        const lineEnd = nextNewline === -1 ? code.length : nextNewline;
        const line = code.slice(lineStart, lineEnd);

        const match = DIRECT_COMMAND_LINE_RE.exec(line);
        if (!match) continue;

        const [, indent, cmd, arg] = match;
        edits.push({
            lineStart,
            lineEnd,
            replacement: `${indent}${cmd}(${JSON.stringify(arg)});`,
        });
    }

    if (edits.length === 0) {
        return code;
    }

    // Apply right-to-left so earlier offsets stay valid.
    edits.sort((a, b) => b.lineStart - a.lineStart);
    let result = code;
    for (const edit of edits) {
        result = result.slice(0, edit.lineStart) + edit.replacement + result.slice(edit.lineEnd);
    }
    return result;
}

/**
 * Scan `code` once and return the offsets of every line start that falls in
 * plain-code state (i.e., outside any string, template, comment, or regex
 * literal). The returned offsets are candidates for direct-command rewriting.
 *
 * The scanner covers exactly what we need to avoid false rewrites:
 *
 * - `//` line comments and `/* *\/` block comments
 * - single- and double-quoted strings with `\` escapes
 * - template literals, including nested `${ ... }` expressions (which are
 *   themselves code and can contain further strings/templates)
 * - regex literals, disambiguated from division by tracking whether a `/`
 *   can begin an expression at its position
 *
 * It is **lexical** only; it does not build an AST or understand statement
 * structure. A full parser (e.g. `acorn` / `acorn-loose`) would be needed
 * for 100% syntactic accuracy — see the note on `normalizeDirectCommands`
 * for why that trade-off is intentional here.
 */
function findCodeLineStarts(code: string): number[] {
    const starts: number[] = [];
    // `${...}` nesting inside template literals: each element counts the
    // currently-open `{` inside that expression so we know when to pop back
    // into template-literal state.
    const templateStack: number[] = [];
    let inLineComment = false;
    let inBlockComment = false;
    let stringQuote: '"' | "'" | null = null;
    let inTemplate = false;
    let inRegex = false;
    let regexCharClass = false;
    // Whether a `/` at the current cursor may start a regex literal.
    let canRegex = true;
    // True only at the FIRST offset of a line (offset 0, or the position
    // right after a newline). Cleared as soon as we consume that offset,
    // so we never record the same line twice.
    let atLineStart = true;

    const len = code.length;
    for (let i = 0; i < len; i++) {
        const ch = code[i];
        const next = i + 1 < len ? code[i + 1] : '';

        // Record plain-code line starts (at most once per line).
        if (
            atLineStart &&
            !inLineComment &&
            !inBlockComment &&
            stringQuote === null &&
            !inTemplate &&
            !inRegex &&
            templateStack.length === 0
        ) {
            starts.push(i);
        }
        atLineStart = false;

        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
                atLineStart = true;
                canRegex = true;
            }
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
                canRegex = true;
            } else if (ch === '\n') {
                atLineStart = true;
            }
            continue;
        }
        if (stringQuote !== null) {
            if (ch === '\\' && next !== '') {
                i++;
                continue;
            }
            if (ch === stringQuote) {
                stringQuote = null;
                canRegex = false;
            } else if (ch === '\n') {
                // Unterminated string at newline: recover by exiting string
                // state so we don't swallow the rest of the input.
                stringQuote = null;
                atLineStart = true;
                canRegex = true;
            }
            continue;
        }
        if (inTemplate) {
            if (ch === '\\' && next !== '') {
                i++;
                continue;
            }
            if (ch === '`') {
                inTemplate = false;
                canRegex = false;
            } else if (ch === '$' && next === '{') {
                templateStack.push(1);
                inTemplate = false;
                i++;
                canRegex = true;
            } else if (ch === '\n') {
                atLineStart = true;
            }
            continue;
        }
        if (inRegex) {
            if (ch === '\\' && next !== '') {
                i++;
                continue;
            }
            if (ch === '[') {
                regexCharClass = true;
            } else if (ch === ']') {
                regexCharClass = false;
            } else if (ch === '/' && !regexCharClass) {
                inRegex = false;
                // Consume optional flags.
                while (i + 1 < len && /[a-z]/i.test(code[i + 1])) i++;
                canRegex = false;
            } else if (ch === '\n') {
                // Unterminated regex: recover.
                inRegex = false;
                regexCharClass = false;
                atLineStart = true;
                canRegex = true;
            }
            continue;
        }

        // Plain-code state (outer) or template-expression state (inner).
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            stringQuote = ch as '"' | "'";
            canRegex = false;
            continue;
        }
        if (ch === '`') {
            inTemplate = true;
            canRegex = false;
            continue;
        }
        if (ch === '/' && canRegex) {
            inRegex = true;
            regexCharClass = false;
            continue;
        }
        if (ch === '{' && templateStack.length > 0) {
            templateStack[templateStack.length - 1]++;
        }
        if (ch === '}' && templateStack.length > 0) {
            templateStack[templateStack.length - 1]--;
            if (templateStack[templateStack.length - 1] === 0) {
                templateStack.pop();
                inTemplate = true;
                canRegex = false;
                continue;
            }
        }
        if (ch === '\n') {
            atLineStart = true;
            canRegex = true;
            continue;
        }

        // Heuristic for the regex/division ambiguity: letters/digits/closers
        // disallow a regex at the next `/`; other punctuation allows one.
        // Adequate for line-start candidates, which is all we care about.
        if (/[A-Za-z0-9_$)\]]/.test(ch)) {
            canRegex = false;
        } else if (!/\s/.test(ch)) {
            canRegex = true;
        }
    }

    return starts;
}
