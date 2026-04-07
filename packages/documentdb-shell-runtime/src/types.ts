/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Result of evaluating shell code through the DocumentDB shell runtime.
 *
 * This is the runtime's public result type — protocol-agnostic (no IPC
 * serialization). Consumers that need to send results over IPC
 * (e.g. worker → main thread) are responsible for serialization.
 */
export interface ShellEvaluationResult {
    /** The @mongosh result type string (e.g. 'Cursor', 'Document', 'string', 'Help'). */
    readonly type: string | null;
    /** The printable result value — cursors already iterated, arrays normalized. */
    readonly printable: unknown;
    /** Execution duration in milliseconds. */
    readonly durationMs: number;
    /** Source namespace from the @mongosh ShellResult, if available. */
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}

/**
 * Callbacks for runtime events. The runtime is environment-agnostic —
 * it uses callbacks instead of directly calling VS Code APIs or postMessage.
 */
export interface ShellRuntimeCallbacks {
    /** Called when user code produces console output (console.log, print, printjson). */
    onConsoleOutput?: (output: string) => void;
    /** Called for internal log messages from the runtime. */
    onLog?: (level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Configuration options for the shell runtime.
 */
export interface ShellRuntimeOptions {
    /** Product name passed to @mongosh service provider. */
    productName?: string;
    /** Product documentation link passed to @mongosh service provider. */
    productDocsLink?: string;
}
