/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Worker thread entry point for scratchpad code evaluation.
 *
 * This file runs in a Node.js worker_thread, isolated from the extension host.
 * It owns its own database client instance (authenticated via credentials passed from
 * the main thread at init time) and evaluates user code through the @mongosh pipeline.
 *
 * Communication with the main thread is via postMessage (structured clone).
 * See workerTypes.ts for the message protocol.
 */

import { randomUUID } from 'crypto';
import { type MongoClientOptions, type MongoClient as MongoClientType } from 'mongodb';
import { parentPort } from 'worker_threads';
import { type MainToWorkerMessage, type WorkerToMainMessage } from './workerTypes';

if (!parentPort) {
    throw new Error('scratchpadWorker.ts must be run as a worker_thread');
}

// ─── Worker state ────────────────────────────────────────────────────────────

let mongoClient: MongoClientType | undefined;
let currentDatabaseName: string | undefined;

/**
 * Cache for pending Entra ID token requests from the OIDC callback.
 * The OIDC_CALLBACK in the worker sends a tokenRequest to the main thread
 * and awaits the response via this map.
 */
const pendingTokenRequests = new Map<string, { resolve: (token: string) => void; reject: (err: Error) => void }>();

// ─── Logging helper ──────────────────────────────────────────────────────────

function log(level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const msg: WorkerToMainMessage = { type: 'log', level, message };
    parentPort!.postMessage(msg);
}

// ─── Message handler ─────────────────────────────────────────────────────────

parentPort.on('message', (msg: MainToWorkerMessage) => {
    switch (msg.type) {
        case 'init':
            void handleInit(msg).catch((err: unknown) => {
                const errorMessage = err instanceof Error ? err.message : String(err);
                const response: WorkerToMainMessage = {
                    type: 'initResult',
                    requestId: msg.requestId,
                    success: false,
                    error: errorMessage,
                };
                parentPort!.postMessage(response);
            });
            break;

        case 'eval':
            void handleEval(msg).catch((err: unknown) => {
                const errorMessage = err instanceof Error ? err.message : String(err);
                const stack = err instanceof Error ? err.stack : undefined;
                const response: WorkerToMainMessage = {
                    type: 'evalError',
                    requestId: msg.requestId,
                    error: errorMessage,
                    stack,
                };
                parentPort!.postMessage(response);
            });
            break;

        case 'shutdown':
            void handleShutdown(msg);
            break;

        case 'tokenResponse':
            handleTokenResponse(msg);
            break;

        case 'tokenError':
            handleTokenError(msg);
            break;
    }
});

// ─── Init handler ────────────────────────────────────────────────────────────

async function handleInit(msg: Extract<MainToWorkerMessage, { type: 'init' }>): Promise<void> {
    log('debug', `Initializing worker (auth: ${msg.authMechanism}, db: ${msg.databaseName})`);

    // Lazy-import MongoDB driver
    const { MongoClient } = await import('mongodb');

    // Build client options from the serializable subset
    const options: MongoClientOptions = {
        ...msg.clientOptions,
    };

    // For Entra ID, configure OIDC callback that requests tokens via IPC
    if (msg.authMechanism === 'MicrosoftEntraID') {
        options.authMechanism = 'MONGODB-OIDC';
        options.tls = true;
        options.authMechanismProperties = {
            ALLOWED_HOSTS: ['*.azure.com'],
            OIDC_CALLBACK: async (): Promise<{ accessToken: string; expiresInSeconds: number }> => {
                const requestId = randomUUID();
                const tokenPromise = new Promise<string>((resolve, reject) => {
                    pendingTokenRequests.set(requestId, { resolve, reject });
                });
                const tokenRequest: WorkerToMainMessage = {
                    type: 'tokenRequest',
                    requestId,
                    scopes: ['https://ossrdbms-aad.database.windows.net/.default'],
                    tenantId: msg.tenantId,
                };
                parentPort!.postMessage(tokenRequest);
                const accessToken = await tokenPromise;
                return { accessToken, expiresInSeconds: 0 };
            },
        };
    }

    // Create and connect the database client
    mongoClient = new MongoClient(msg.connectionString, options);
    await mongoClient.connect();
    currentDatabaseName = msg.databaseName;

    log('debug', 'Worker initialized — client connected');

    const response: WorkerToMainMessage = {
        type: 'initResult',
        requestId: msg.requestId,
        success: true,
    };
    parentPort!.postMessage(response);
}

// ─── Eval handler ────────────────────────────────────────────────────────────

async function handleEval(msg: Extract<MainToWorkerMessage, { type: 'eval' }>): Promise<void> {
    if (!mongoClient) {
        throw new Error('Worker not initialized — call init first');
    }

    const lineCount = msg.code.split('\n').length;
    log(
        'trace',
        `Evaluating code (${String(lineCount)} lines, ${String(msg.code.length)} chars, db: ${msg.databaseName})`,
    );

    // Lazy-import @mongosh packages
    const { EventEmitter } = await import('events');
    const vm = await import('vm');
    const { NodeDriverServiceProvider } = await import('@mongosh/service-provider-node-driver');
    const { ShellInstanceState } = await import('@mongosh/shell-api');
    const { ShellEvaluator } = await import('@mongosh/shell-evaluator');

    const startTime = Date.now();

    // Create fresh shell context per execution (no variable leakage between runs)
    const bus = new EventEmitter();
    const serviceProvider = new NodeDriverServiceProvider(mongoClient, bus, {
        productDocsLink: 'https://github.com/microsoft/vscode-documentdb',
        productName: 'DocumentDB for VS Code Scratchpad',
    });
    const instanceState = new ShellInstanceState(serviceProvider, bus);
    const evaluator = new ShellEvaluator(instanceState);

    // Set up eval context with shell globals (db, ObjectId, ISODate, etc.)
    const context = {};
    instanceState.setCtx(context);

    // The eval function using vm.runInContext for @mongosh
    // eslint-disable-next-line @typescript-eslint/require-await
    const customEvalFn = async (code: string, ctx: object): Promise<unknown> => {
        const vmContext = vm.isContext(ctx) ? ctx : vm.createContext(ctx);
        return vm.runInContext(code, vmContext) as unknown;
    };

    // Switch database if different from current
    if (msg.databaseName !== currentDatabaseName) {
        await evaluator.customEval(customEvalFn, `use(${JSON.stringify(msg.databaseName)})`, context, 'scratchpad');
        currentDatabaseName = msg.databaseName;
    } else {
        // Pre-select the target database (fresh context each time)
        await evaluator.customEval(customEvalFn, `use(${JSON.stringify(msg.databaseName)})`, context, 'scratchpad');
    }

    // Evaluate user code
    const result = await evaluator.customEval(customEvalFn, msg.code, context, 'scratchpad');
    const durationMs = Date.now() - startTime;

    // result is a ShellResult { type, printable, rawValue, source? }
    const shellResult = result as {
        type: string | null;
        printable: unknown;
        source?: { namespace?: { db: string; collection: string } };
    };

    // Normalize the printable value for IPC transfer.
    // @mongosh's ShellEvaluator wraps cursor results as { cursorHasMore, documents }
    // when running in a worker context. Extract the documents array so that the
    // main thread receives a clean array (matching the in-process behavior where
    // printable was a CursorIterationResult array).
    let printableValue: unknown = shellResult.printable;
    if (
        shellResult.type === 'Cursor' &&
        typeof shellResult.printable === 'object' &&
        shellResult.printable !== null &&
        'documents' in shellResult.printable &&
        Array.isArray((shellResult.printable as { documents?: unknown }).documents)
    ) {
        printableValue = (shellResult.printable as { documents: unknown[] }).documents;
    } else if (Array.isArray(shellResult.printable)) {
        // Array subclass (CursorIterationResult) — normalize to plain Array
        printableValue = Array.from(shellResult.printable as unknown[]);
    }

    let printableStr: string;
    try {
        const { EJSON } = await import('bson');
        printableStr = EJSON.stringify(printableValue, { relaxed: false });
    } catch {
        // Fallback: try JSON, then plain string
        try {
            printableStr = JSON.stringify(printableValue);
        } catch {
            printableStr = String(printableValue);
        }
    }

    log('trace', `Evaluation complete (${durationMs}ms, type: ${shellResult.type ?? 'null'})`);

    const response: WorkerToMainMessage = {
        type: 'evalResult',
        requestId: msg.requestId,
        result: {
            type: shellResult.type,
            printable: printableStr,
            durationMs,
            source: shellResult.source?.namespace
                ? {
                      namespace: {
                          db: shellResult.source.namespace.db,
                          collection: shellResult.source.namespace.collection,
                      },
                  }
                : undefined,
        },
    };
    parentPort!.postMessage(response);
}

// ─── Shutdown handler ────────────────────────────────────────────────────────

async function handleShutdown(msg: Extract<MainToWorkerMessage, { type: 'shutdown' }>): Promise<void> {
    log('debug', 'Shutting down worker — closing client');

    try {
        if (mongoClient) {
            await mongoClient.close();
            mongoClient = undefined;
        }
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log('warn', `Error closing client during shutdown: ${errorMessage}`);
    }

    const response: WorkerToMainMessage = {
        type: 'shutdownComplete',
        requestId: msg.requestId,
    };
    parentPort!.postMessage(response);
}

// ─── Token response/error handlers (Entra ID) ───────────────────────────────

function handleTokenResponse(msg: Extract<MainToWorkerMessage, { type: 'tokenResponse' }>): void {
    const pending = pendingTokenRequests.get(msg.requestId);
    if (pending) {
        pending.resolve(msg.accessToken);
        pendingTokenRequests.delete(msg.requestId);
    }
}

function handleTokenError(msg: Extract<MainToWorkerMessage, { type: 'tokenError' }>): void {
    const pending = pendingTokenRequests.get(msg.requestId);
    if (pending) {
        pending.reject(new Error(msg.error));
        pendingTokenRequests.delete(msg.requestId);
    }
}

// ─── Uncaught exception handler ──────────────────────────────────────────────

process.on('uncaughtException', (error: Error) => {
    log('error', `Uncaught exception in worker: ${error.message}\n${error.stack ?? ''}`);
});

process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log('error', `Unhandled rejection in worker: ${message}`);
});
