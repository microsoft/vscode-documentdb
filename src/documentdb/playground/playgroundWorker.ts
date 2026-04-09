/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Worker thread entry point for query playground code evaluation.
 *
 * This file runs in a Node.js worker_thread, isolated from the extension host.
 * It owns its own database client instance (authenticated via credentials passed from
 * the main thread at init time) and evaluates user code through the @mongosh pipeline.
 *
 * Communication with the main thread is via postMessage (structured clone).
 * See workerTypes.ts for the message protocol.
 */

import { DocumentDBShellRuntime } from '@microsoft/documentdb-vscode-shell-runtime';
import { randomUUID } from 'crypto';
import { type MongoClientOptions, type MongoClient as MongoClientType } from 'mongodb';
import { parentPort } from 'worker_threads';
import { type MainToWorkerMessage, type WorkerToMainMessage } from './workerTypes';

if (!parentPort) {
    throw new Error('playgroundWorker.ts must be run as a worker_thread');
}

// ─── Worker state ────────────────────────────────────────────────────────────

let mongoClient: MongoClientType | undefined;
let shellRuntime: DocumentDBShellRuntime | undefined;

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

    // Lazy-import the MongoDB API driver
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

    // Create the shell runtime with console output routing to the main thread
    shellRuntime = new DocumentDBShellRuntime(
        mongoClient,
        {
            onConsoleOutput: (output: string) => {
                const consoleMsg: WorkerToMainMessage = { type: 'consoleOutput', output };
                parentPort!.postMessage(consoleMsg);
            },
            onLog: log,
        },
        {
            productName: 'DocumentDB for VS Code Query Playground',
            productDocsLink: 'https://github.com/microsoft/vscode-documentdb',
            persistent: msg.persistent ?? false,
        },
    );

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
    if (!mongoClient || !shellRuntime) {
        throw new Error('Worker not initialized — call init first');
    }

    // Evaluate via shell-runtime (handles @mongosh setup, command interception, result transformation)
    const result = await shellRuntime.evaluate(msg.code, msg.databaseName, {
        displayBatchSize: msg.displayBatchSize,
    });

    // Proactively extract cursorHasMore before serialization.
    // The ResultTransformer may have already extracted it from the { cursorHasMore, documents }
    // wrapper, but in some @mongosh/vm contexts the property survives on the normalized
    // printable array as an own property. Check both the runtime result and the raw printable.
    let cursorHasMore = result.cursorHasMore;
    if (cursorHasMore === undefined && result.type === 'Cursor') {
        const p = result.printable;
        if (typeof p === 'object' && p !== null && 'cursorHasMore' in p) {
            const fallbackValue = (p as { cursorHasMore: unknown }).cursorHasMore;
            if (typeof fallbackValue === 'boolean') {
                cursorHasMore = fallbackValue;
            }
        }
    }

    // Serialize the result for IPC transfer (the runtime returns raw values;
    // serialization to EJSON is the worker's IPC concern)
    let printableStr: string;
    try {
        const { EJSON } = await import('bson');
        printableStr = EJSON.stringify(result.printable, { relaxed: false });
    } catch {
        try {
            printableStr = JSON.stringify(result.printable);
        } catch {
            printableStr = String(result.printable);
        }
    }

    log('trace', `Evaluation complete (${String(result.durationMs)}ms, type: ${result.type ?? 'null'})`);

    const response: WorkerToMainMessage = {
        type: 'evalResult',
        requestId: msg.requestId,
        result: {
            type: result.type,
            printable: printableStr,
            durationMs: result.durationMs,
            cursorHasMore,
            source: result.source,
        },
    };
    parentPort!.postMessage(response);
}

// ─── Shutdown handler ────────────────────────────────────────────────────────

async function handleShutdown(msg: Extract<MainToWorkerMessage, { type: 'shutdown' }>): Promise<void> {
    log('debug', 'Shutting down worker — closing client');

    try {
        if (shellRuntime) {
            shellRuntime.dispose();
            shellRuntime = undefined;
        }
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
