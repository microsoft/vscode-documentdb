/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Wire-protocol message types shared by both sides of the webview transport.
 *
 * These shapes describe what travels over `postMessage` between the extension
 * host and the webview. They are side-agnostic (no `vscode`, no React) so they
 * can live in the shared `.` entry and be imported by both the host dispatcher
 * (`attachTrpc` / `WebviewController`) and the webview link (`vscodeLink`).
 *
 * The only external type they reference is tRPC's `Operation`, imported as a
 * type and erased at compile time.
 */

import { type Operation } from '@trpc/client';

/**
 * Variant of a tRPC {@link Operation} used for the two control messages that
 * tRPC v11 does not yet model natively:
 *
 * - `subscription.stop` ends a running subscription;
 * - `abort` cancels an in-flight query or mutation.
 *
 * TODO: when tRPC v12 is released, `subscription.stop` should be supported
 * natively; revisit then.
 */
export type StopOperation<TInput = unknown> = Omit<Operation<TInput>, 'type'> & {
    type: 'subscription.stop' | 'abort';
};

/**
 * Messages sent from the webview/client to the extension/server.
 * @id - A unique identifier for the message.
 */
export interface VsCodeLinkRequestMessage {
    id: string;
    // TODO, when tRPC v12 is released, 'subscription.stop' should be supported natively, until then, we're adding it manually.
    // 'abort' is used to cancel in-flight queries and mutations.
    op: Operation<unknown> | StopOperation<unknown>;
}

/**
 * Messages sent back from the extension/server to the webview/client.
 * Each message sent back is a **response** to a previous VsCodeLinkRequestMessage.
 *
 * @id - The unique identifier of the message from the original request.
 */
export interface VsCodeLinkResponseMessage {
    id: string;
    result?: unknown;
    error?: {
        name: string;
        message: string;

        code?: number;
        stack?: string;
        cause?: unknown;
        data?: unknown;
    };
    complete?: boolean;
}
