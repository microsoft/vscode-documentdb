/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Framework-agnostic webview client factory.
 *
 * `connectTrpc` bundles the pieces a webview needs to talk to the extension
 * host into a single call: it creates an {@link RpcEventChannel}, wires the
 * default `postMessage` / `window` `message` transport, and assembles a tRPC
 * client whose links publish every query/mutation outcome into the channel.
 *
 * It has no React dependency, so non-React (or legacy `postMessage`) webviews
 * can use it directly. The React hooks in `./react` are thin wrappers over it.
 */

import { createTRPCClient, type CreateTRPCClient, loggerLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from '../shared/wireProtocol';
import { createEventChannel, type RpcEventChannel } from './events';
import { type ErrorHandler, eventLink } from './errorLink';
import { vscodeLink } from './vscodeLink';

/**
 * The slice of the VS Code webview API that {@link connectTrpc} needs: a way to
 * post a message to the extension host. The full `WebviewApi` from
 * `acquireVsCodeApi()` satisfies this structurally.
 */
export interface VsCodeApiLike {
    postMessage(message: unknown): void;
}

/** Options accepted by {@link connectTrpc}. */
export interface ConnectTrpcOptions {
    /**
     * Convenience error observer for queries and mutations, subscribed to the
     * returned channel's {@link RpcEventChannel.onError | onError}. Equivalent
     * to calling `events.onError((err) => onError(err))` yourself. Aborted
     * calls are reported via `onAborted`, not here.
     */
    onError?: ErrorHandler;
}

/** The pair returned by {@link connectTrpc}. */
export interface ConnectTrpcResult<TRouter extends AnyRouter> {
    /** The fully-typed tRPC client. */
    readonly client: CreateTRPCClient<TRouter>;
    /** Observe-only event channel surfacing every query/mutation outcome. */
    readonly events: RpcEventChannel;
}

/**
 * Connect a webview to the extension host.
 *
 * @template TRouter - The application's root tRPC router type.
 * @param vscodeApi  - The object returned by `acquireVsCodeApi()` (or anything
 *                     with a compatible `postMessage`).
 * @param options    - Optional configuration (see {@link ConnectTrpcOptions}).
 * @returns The tRPC `client` and the observe-only `events` channel.
 *
 * @example
 * ```ts
 * import { connectTrpc } from '@microsoft/vscode-ext-webview/webview';
 * import type { AppRouter } from '../_integration/appRouter';
 *
 * const { client, events } = connectTrpc<AppRouter>(acquireVsCodeApi());
 * events.onAborted((info) => console.debug('canceled', info.path));
 * const rows = await client.documents.find.query({ limit: 10 });
 * ```
 */
export function connectTrpc<TRouter extends AnyRouter>(
    vscodeApi: VsCodeApiLike,
    options?: ConnectTrpcOptions,
): ConnectTrpcResult<TRouter> {
    const channel = createEventChannel();

    if (options?.onError) {
        const onError = options.onError;
        channel.onError((error) => onError(error));
    }

    // Send a request message to the extension host.
    const send = (message: VsCodeLinkRequestMessage): void => {
        vscodeApi.postMessage(message);
    };

    // Register a handler for response messages from the extension host. tRPC
    // calls this when a request is made and the returned unsubscribe when the
    // response has been consumed, so the listener is per-operation.
    const onReceive = (callback: (message: VsCodeLinkResponseMessage) => void): (() => void) => {
        const handler = (event: MessageEvent): void => {
            // Basic type guard: only forward tRPC response messages.
            if ((event.data as VsCodeLinkResponseMessage).id) {
                callback(event.data as VsCodeLinkResponseMessage);
            }
        };

        window.addEventListener('message', handler);
        return () => {
            window.removeEventListener('message', handler);
        };
    };

    const client = createTRPCClient<TRouter>({
        links: [loggerLink(), eventLink<TRouter>(channel), vscodeLink<TRouter>({ send, onReceive })],
    });

    return { client, events: channel };
}
