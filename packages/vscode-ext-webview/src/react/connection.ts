/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-webview connection memo shared by the React hooks.
 *
 * A webview has exactly one `vscodeApi` (from `acquireVsCodeApi()`), and both
 * {@link useTrpcClient} and {@link useRpcEvents} must hand back parts of the
 * *same* {@link ConnectTrpcResult} so observers on the events channel see the
 * outcomes of calls made through the client. This module keeps a single
 * `connectTrpc` result per `vscodeApi`, keyed in a `WeakMap` so it is released
 * when the api object is.
 *
 * This file is intentionally React-free; the hooks read `vscodeApi` from context
 * and delegate here.
 */

import { type AnyRouter } from '@trpc/server';
import { connectTrpc, type ConnectTrpcResult, type VsCodeApiLike } from '../webview/connectTrpc';

const connections = new WeakMap<VsCodeApiLike, ConnectTrpcResult<AnyRouter>>();

/**
 * Return the shared {@link ConnectTrpcResult} for `vscodeApi`, creating it on
 * first use. Repeated calls with the same `vscodeApi` return the identical
 * `{ client, events }` instance.
 *
 * @template TRouter - The application's root tRPC router type.
 */
export function getWebviewConnection<TRouter extends AnyRouter>(vscodeApi: VsCodeApiLike): ConnectTrpcResult<TRouter> {
    let connection = connections.get(vscodeApi);
    if (!connection) {
        connection = connectTrpc<AnyRouter>(vscodeApi);
        connections.set(vscodeApi, connection);
    }
    return connection as ConnectTrpcResult<TRouter>;
}
