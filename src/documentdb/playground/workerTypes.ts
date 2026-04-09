/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * IPC message types for the query playground worker thread.
 *
 * This file is shared between the main thread (PlaygroundEvaluator) and
 * the worker thread (playgroundWorker). It must have zero runtime dependencies —
 * only TypeScript types and string literal unions.
 *
 * Communication uses Node.js `worker_threads` `postMessage()` with the
 * structured clone algorithm. Functions cannot be sent — this is why
 * Entra ID OIDC tokens must be requested via IPC (tokenRequest/tokenResponse).
 */

// ─── Serializable subset of MongoClientOptions ──────────────────────────────

/**
 * Only the MongoClientOptions fields that can survive structured clone.
 * Function-valued options (like OIDC_CALLBACK) are stripped before sending
 * and reconstructed on the worker side.
 */
export interface SerializableMongoClientOptions {
    readonly serverSelectionTimeoutMS?: number;
    readonly tlsAllowInvalidCertificates?: boolean;
    readonly appName?: string;
    readonly tls?: boolean;
}

// ─── Serializable execution result ──────────────────────────────────────────

/**
 * The subset of ExecutionResult that can be sent via postMessage.
 * BSON types are serialized to EJSON strings by the worker before sending.
 */
export interface SerializableExecutionResult {
    readonly type: string | null;
    /** EJSON-serialized printable value */
    readonly printable: string;
    readonly durationMs: number;
    /** Whether the cursor has more documents beyond the returned batch (Cursor results only). */
    readonly cursorHasMore?: boolean;
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}

// ─── Main → Worker messages ─────────────────────────────────────────────────

export type MainToWorkerMessage =
    | {
          readonly type: 'init';
          readonly requestId: string;
          /** Connection string (with embedded credentials for SCRAM, without for Entra ID) */
          readonly connectionString: string;
          readonly clientOptions: SerializableMongoClientOptions;
          readonly databaseName: string;
          readonly authMechanism: 'NativeAuth' | 'MicrosoftEntraID';
          /** Tenant ID for Entra ID clusters */
          readonly tenantId?: string;
          /**
           * When `true`, the worker keeps the @mongosh eval context alive across
           * evaluations (interactive shell mode). When `false` (default), each eval
           * gets a fresh context (query playground mode).
           */
          readonly persistent?: boolean;
      }
    | {
          readonly type: 'eval';
          readonly requestId: string;
          /** JavaScript code to evaluate */
          readonly code: string;
          /** Target database name (may differ from init if user switched databases) */
          readonly databaseName: string;
          /** Display batch size — number of documents per cursor iteration. Read from settings per-eval. */
          readonly displayBatchSize: number;
      }
    | {
          readonly type: 'shutdown';
          readonly requestId: string;
      }
    | {
          readonly type: 'tokenResponse';
          readonly requestId: string;
          readonly accessToken: string;
      }
    | {
          readonly type: 'tokenError';
          readonly requestId: string;
          readonly error: string;
      };

// ─── Worker → Main messages ─────────────────────────────────────────────────

export type WorkerToMainMessage =
    | {
          readonly type: 'initResult';
          readonly requestId: string;
          readonly success: boolean;
          readonly error?: string;
      }
    | {
          readonly type: 'evalResult';
          readonly requestId: string;
          readonly result: SerializableExecutionResult;
      }
    | {
          readonly type: 'evalError';
          readonly requestId: string;
          readonly error: string;
          readonly stack?: string;
      }
    | {
          readonly type: 'shutdownComplete';
          readonly requestId: string;
      }
    | {
          readonly type: 'tokenRequest';
          readonly requestId: string;
          readonly scopes: readonly string[];
          readonly tenantId?: string;
      }
    | {
          readonly type: 'log';
          readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
          readonly message: string;
      }
    | {
          /** User-facing console output from console.log(), print(), printjson() */
          readonly type: 'consoleOutput';
          readonly output: string;
      };
