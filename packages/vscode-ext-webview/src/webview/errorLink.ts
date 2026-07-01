/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC links that observe the outcome of queries and mutations and publish them
 * into an {@link RpcEventChannel}.
 *
 * Why this exists. The default tRPC error flow propagates the error to the
 * caller of `.query()` / `.mutation()`, where each call site is responsible for
 * handling it. That works, but it forces every call site to remember to add a
 * `.catch(...)`. When a consumer has a single place where webview-side outcomes
 * should surface (an ARIA announcer, a FluentUI `Toaster`, telemetry, etc.),
 * an event channel is where that handler plugs in once.
 *
 * {@link errorLink} is the thin, error-only convenience: it owns a private
 * channel and bridges that channel's `onError` to the supplied callback. The
 * underlying {@link eventLink} is the general publisher that feeds a channel
 * with success / error / aborted outcomes; `connectTrpc` uses it directly so
 * consumers can observe every outcome.
 *
 * Important semantics:
 *   - Observation is **in addition to** the normal tRPC flow. The value/error is
 *     re-emitted on the observable so call-site handlers still fire.
 *   - **Aborts are separated from errors.** When the operation's `AbortSignal`
 *     is already aborted, the outcome is published via `emitAborted`, not
 *     `emitError`, so a user cancel does not surface as an error.
 *   - Subscription outcomes are **not** published to the channel. Subscriptions
 *     have their own per-call callbacks on `.subscribe(...)`; mixing the two
 *     would surface subscription events twice.
 */

import { type TRPCClientError, type TRPCLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
// eslint-disable-next-line import/no-internal-modules -- tRPC's own link examples import from /server/observable: https://trpc.io/docs/client/links#example
import { observable } from '@trpc/server/observable';
import { type CallInfo, createEventChannel, type RpcEventEmitter } from './events';

/**
 * Callback invoked by {@link errorLink} for each query/mutation that errors
 * out. The error is the same value the link is about to re-emit to the caller,
 * normalized to an `Error` instance.
 */
export type ErrorHandler = (error: Error) => void;

/**
 * Normalize an unknown rejection into an `Error` instance.
 */
function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

/**
 * General-purpose publishing link: for each query/mutation it publishes the
 * outcome into `emitter` (`emitSuccess` / `emitError` / `emitAborted`) and
 * re-emits the value/error/complete down the link chain unchanged. Subscription
 * outcomes are passed through without publishing.
 *
 * Not part of the public `./webview` surface; `errorLink` and `connectTrpc`
 * build on it.
 */
export function eventLink<TRouter extends AnyRouter>(emitter: RpcEventEmitter): TRPCLink<TRouter> {
    return () => {
        return ({ next, op }) => {
            const info: CallInfo = { type: op.type, path: op.path, id: op.id };

            return observable((observer) => {
                return next(op).subscribe({
                    next(value) {
                        if (op.type !== 'subscription') {
                            const data = (value as { result?: { data?: unknown } })?.result?.data;
                            emitter.emitSuccess(info, data);
                        }
                        observer.next(value);
                    },
                    error(err: unknown) {
                        // Subscriptions report their own errors via the per-call
                        // `.subscribe({ onError })` callback; only publish
                        // query/mutation outcomes so they are not surfaced twice.
                        if (op.type !== 'subscription') {
                            if (op.signal?.aborted) {
                                emitter.emitAborted(info);
                            } else {
                                emitter.emitError(toError(err), info);
                            }
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

/**
 * Error-only convenience link. Use this in the `links` array passed to
 * `createTRPCClient`, before {@link vscodeLink}:
 *
 * @example
 * ```ts
 * import { createTRPCClient } from '@trpc/client';
 * import { errorLink, vscodeLink } from '@microsoft/vscode-ext-webview/webview';
 *
 * const trpcClient = createTRPCClient<AppRouter>({
 *   links: [
 *     errorLink<AppRouter>((err) => announcer.announceError(err.message)),
 *     vscodeLink<AppRouter>({ send, onReceive }),
 *   ],
 * });
 * ```
 *
 * It is a thin shim over {@link eventLink}: it owns a private channel and
 * forwards that channel's error events to `onError`. For success/aborted
 * observation (or one channel shared by several observers), use `connectTrpc`,
 * which exposes the full {@link RpcEventChannel}.
 */
export function errorLink<TRouter extends AnyRouter>(onError: ErrorHandler): TRPCLink<TRouter> {
    const channel = createEventChannel();
    channel.onError((error) => onError(error));
    return eventLink<TRouter>(channel);
}
