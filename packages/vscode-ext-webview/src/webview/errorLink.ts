/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A tRPC link that observes errors from queries and mutations and forwards
 * them to a consumer-supplied handler before re-emitting them down the link
 * chain.
 *
 * Why this exists. The default tRPC error flow propagates the error to the
 * caller of `.query()` / `.mutation()`, where each call site is responsible
 * for handling it. That works, but it forces every call site to remember to
 * add a `.catch(...)` (or `try/catch` around `await`). When a consumer has
 * a single place where webview-side errors should surface (an ARIA
 * `Announcer`, a FluentUI `Toaster`, telemetry, etc.), this link is the
 * place to plug that handler in once.
 *
 * Important semantics:
 *   - `onError` is invoked **in addition to** the normal tRPC error flow.
 *     The error is re-emitted on the observable so call-site `.catch(...)`
 *     handlers still fire.
 *   - Subscription errors are **not** forwarded to `onError`. Subscriptions
 *     have their own per-call `onError` callback on `.subscribe(...)` which
 *     gives the call site enough control without this link's help. Mixing
 *     the two would surface subscription errors twice.
 */

import { type TRPCClientError, type TRPCLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
// eslint-disable-next-line import/no-internal-modules -- tRPC's own link examples import from /server/observable: https://trpc.io/docs/client/links#example
import { observable } from '@trpc/server/observable';

/**
 * Callback invoked by {@link errorLink} for each query/mutation that errors
 * out. The error is the same value the link is about to re-emit to the
 * caller, normalized to an `Error` instance.
 */
export type ErrorHandler = (error: Error) => void;

/**
 * tRPC link factory. Use this in the `links` array passed to
 * `createTRPCClient`, before {@link vscodeLink}:
 *
 * @example
 * ```ts
 * import { createTRPCClient, loggerLink } from '@trpc/client';
 * import { errorLink, vscodeLink } from '@microsoft/vscode-ext-react-webview';
 *
 * const trpcClient = createTRPCClient<AppRouter>({
 *   links: [
 *     loggerLink(),
 *     errorLink<AppRouter>((err) => announcer.announceError(err.message)),
 *     vscodeLink<AppRouter>({ send, onReceive }),
 *   ],
 * });
 * ```
 *
 * Or pass an `onError` callback to {@link useTrpcClient}, which inserts the
 * link for you.
 */
export function errorLink<TRouter extends AnyRouter>(onError: ErrorHandler): TRPCLink<TRouter> {
    return () => {
        return ({ next, op }) => {
            return observable((observer) => {
                return next(op).subscribe({
                    next(value) {
                        observer.next(value);
                    },
                    error(err: unknown) {
                        // Subscriptions handle their own errors via the
                        // per-call `.subscribe({ onError })` callback. Only
                        // intercept queries and mutations here so we do not
                        // surface subscription errors twice.
                        if (op.type !== 'subscription') {
                            const error = err instanceof Error ? err : new Error(String(err));
                            onError(error);
                        }
                        observer.error(err as TRPCClientError<TRouter>);
                    },
                    complete() {
                        observer.complete();
                    },
                });
            });
        };
    };
}
