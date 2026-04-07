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
import { ResultTransformer } from './ResultTransformer';
import { type ShellEvaluationResult, type ShellRuntimeCallbacks, type ShellRuntimeOptions } from './types';

const DEFAULT_OPTIONS: ShellRuntimeOptions = {
    productName: 'DocumentDB for VS Code',
    productDocsLink: 'https://github.com/microsoft/vscode-documentdb',
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

    constructor(mongoClient: MongoClient, callbacks?: ShellRuntimeCallbacks, options?: ShellRuntimeOptions) {
        this._mongoClient = mongoClient;
        this._callbacks = callbacks ?? {};
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this._commandInterceptor = new CommandInterceptor();
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
     * @returns Evaluation result with type, printable value, and timing
     * @throws Error if the runtime has been disposed
     * @throws Error if @mongosh evaluation fails (syntax error, runtime error, etc.)
     */
    async evaluate(code: string, databaseName: string): Promise<ShellEvaluationResult> {
        if (this._disposed) {
            throw new Error('Shell runtime has been disposed');
        }

        // Check for intercepted commands (help, etc.)
        const intercepted = this._commandInterceptor.tryIntercept(code);
        if (intercepted) {
            return intercepted;
        }

        this.log(
            'trace',
            `Evaluating code (${code.split('\n').length} lines, ${code.length} chars, db: ${databaseName})`,
        );

        const startTime = Date.now();

        // Create fresh shell context per execution
        const { serviceProvider, bus } = DocumentDBServiceProvider.createForDocumentDB(
            this._mongoClient,
            this._options.productName,
            this._options.productDocsLink,
        );
        const instanceState = new ShellInstanceState(serviceProvider, bus);
        const evaluator = new ShellEvaluator(instanceState);

        // Register evaluation listener for console output
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

        // Transform the raw @mongosh result
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
                onConsoleOutput(output);
            },
        });
    }

    private log(level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string): void {
        this._callbacks.onLog?.(level, message);
    }
}
