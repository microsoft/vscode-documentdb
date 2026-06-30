/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `attachTrpc` is the host-side transport primitive: it wires a tRPC router to a
 * `vscode.WebviewPanel`, owning the message pump that dispatches incoming
 * queries, mutations, and subscriptions and streams results back over
 * `postMessage`.
 *
 * It is the "bring your own panel" entry point. Consumers that already own a
 * panel (a custom tab/base class) call `attachTrpc(panel, ctx, router)` directly;
 * {@link WebviewController} and the {@link openWebview} factory are conveniences
 * layered on top of it.
 *
 * This module imports `vscode` only as types, so it carries no runtime
 * dependency on the VS Code API and is unit-testable with a stub panel.
 */

import { getTRPCErrorFromUnknown, type AnyRouter } from '@trpc/server';
import { type Disposable, type WebviewPanel } from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { createCallerFactory as defaultCreateCallerFactory } from '../shared/initWebviewTrpc';
import { type VsCodeLinkRequestMessage } from '../shared/wireProtocol';

/**
 * A tracked subscription: its per-operation `AbortController` plus the live
 * `AsyncIterator` driving the stream, so the pump can call `iterator.return()`
 * on `subscription.stop` and on teardown.
 */
export interface ActiveSubscription {
    abortController: AbortController;
    iterator: AsyncIterator<unknown>;
}

/**
 * Structural shape of a tRPC `createCallerFactory` as the dispatcher consumes
 * it: given a router it returns a function that, given a context, returns a
 * caller.
 *
 * The context parameter is intentionally `any` so a `createCallerFactory` bound
 * to any consumer `TContext` (from their own `initWebviewTrpc(...)` result) is
 * assignable without a cast. The dispatcher passes the per-operation context it
 * was handed.
 */
export type WebviewCallerFactory = (
    router: AnyRouter,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC caller factories are bound to a specific context type; `any` lets any consumer's factory be passed without a cast.
) => (ctx: any) => unknown;

/**
 * The handle returned by {@link attachTrpc}.
 */
export interface AttachTrpcResult {
    /**
     * Disposes the message listener and aborts every in-flight operation and
     * subscription. Register it with your panel's lifecycle.
     */
    disposable: Disposable;

    /** Live map of in-flight queries / mutations by operation id. */
    activeOperations: Map<string, AbortController>;

    /** Live map of in-flight subscriptions by operation id. */
    activeSubscriptions: Map<string, ActiveSubscription>;
}

/**
 * Normalizes a procedure's subscription return value (which may be an
 * `AsyncIterable`, an `AsyncIterator`, or both - async generators are both) to a
 * single live `AsyncIterator`.
 *
 * Calling `[Symbol.asyncIterator]()` once is required for iterables like
 * `TypedEventSink` (which enforce single-consumer semantics); direct iterators
 * are returned as-is.
 */
function toAsyncIterator(value: unknown): AsyncIterator<unknown> {
    if (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
    ) {
        return (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    }
    return value as AsyncIterator<unknown>;
}

/**
 * Converts an unknown error into a tRPC-compatible error response. Building a
 * plain object with enumerable properties ensures the client receives a properly
 * serialized error over `postMessage`.
 */
function wrapInTrpcErrorMessage(error: unknown, operationId: string) {
    const errorEntry = getTRPCErrorFromUnknown(error);

    return {
        id: operationId,
        error: {
            code: errorEntry.code,
            name: errorEntry.name,
            message: errorEntry.message,
            stack: errorEntry.stack,
            cause: errorEntry.cause,
        },
    };
}

/**
 * Attaches a tRPC dispatch pump to a webview panel.
 *
 * Listens for {@link VsCodeLinkRequestMessage}s on `panel.webview`, routes each
 * to the matching procedure on `router` using `context` (cloned per operation
 * with a fresh `AbortSignal`), and posts results / errors / completion back.
 *
 * @param panel         - the panel whose `webview` carries the transport.
 * @param context       - the base router context for procedure calls; each
 *                        operation receives a shallow clone with its own
 *                        `signal`.
 * @param router        - the application's root tRPC router.
 * @param callerFactory - tRPC `createCallerFactory`, defaulting to the package's
 *                        shared default instance. Pass the one from your own
 *                        `initWebviewTrpc(...)` result when your router is built
 *                        with a typed context.
 */
export function attachTrpc<TRouter extends AnyRouter, TContext extends BaseRouterContext>(
    panel: WebviewPanel,
    context: TContext,
    router: TRouter,
    callerFactory: WebviewCallerFactory = defaultCreateCallerFactory,
): AttachTrpcResult {
    const activeOperations = new Map<string, AbortController>();
    const activeSubscriptions = new Map<string, ActiveSubscription>();
    let disposed = false;

    /**
     * Safely posts a message to the webview. Calling `postMessage` after the
     * panel has been disposed can throw synchronously or reject depending on the
     * VS Code version, so this guards both shapes. Returns `false` if delivery
     * could not be attempted; the boolean is informational.
     */
    const safePostMessage = (message: unknown): boolean => {
        if (disposed) {
            return false;
        }
        try {
            void Promise.resolve(panel.webview.postMessage(message)).catch(() => void 0);
            return true;
        } catch {
            return false;
        }
    };

    const handleSubscriptionMessage = async (message: VsCodeLinkRequestMessage): Promise<void> => {
        // In v12, tRPC will have better cancellation support. For now, we use AbortController.
        const abortController = new AbortController();

        try {
            // Clone context so the signal is per-operation and does not mutate the shared context object
            const opContext: TContext = { ...context, signal: abortController.signal };

            const caller = callerFactory(router)(opContext);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            const procedure = (caller as any)[message.op.path];

            if (typeof procedure !== 'function') {
                // Framework-internal protocol error; not localized - consumers cannot translate it
                // and this code path indicates a programming error in the caller (wrong path).
                throw new Error(`Procedure not found: ${message.op.path}`);
            }

            // Await the procedure call to get the async iterable (the procedure's `async function*`
            // result, which is an AsyncGenerator and therefore both iterable and an iterator).
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
            const asyncIterable = await procedure(message.op.input);

            // Normalize to a live AsyncIterator and store it. We deliberately do *not* use
            // `for await (const value of asyncIterable)` because that would obtain the iterator
            // internally and give us no handle to call `iterator.return()` on `subscription.stop`
            // or panel dispose. Driving `next()`/`return()` ourselves is what lets us release
            // consumers parked on a pending next (e.g. an event sink with no recent emit).
            const iterator: AsyncIterator<unknown> = toAsyncIterator(asyncIterable);

            // Only track the subscription once we actually have an iterator. If procedure
            // lookup or the initial `await procedure(...)` throws, we fall through to the
            // outer catch without ever inserting an entry - so an early failure cannot
            // leave a stale (id, AbortController) pair behind for the lifetime of the panel.
            activeSubscriptions.set(message.id, { abortController, iterator });

            void (async () => {
                try {
                    while (true) {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                        const { value, done } = await iterator.next();
                        if (done) {
                            break;
                        }
                        // Each yielded value is sent to the webview
                        safePostMessage({ id: message.id, result: value });
                    }

                    // On natural completion (procedure returned, or our `return()` propagated
                    // through the generator), inform the client.
                    safePostMessage({ id: message.id, complete: true });
                } catch (error) {
                    safePostMessage(wrapInTrpcErrorMessage(error, message.id));
                } finally {
                    activeSubscriptions.delete(message.id);
                }
            })();
        } catch (error) {
            safePostMessage(wrapInTrpcErrorMessage(error, message.id));
        }
    };

    const handleSubscriptionStopMessage = (message: VsCodeLinkRequestMessage): void => {
        const record = activeSubscriptions.get(message.id);
        if (record) {
            record.abortController.abort();
            // Cooperative abort cannot unblock a parked `iterator.next()`. Calling `return()`
            // here propagates through the procedure's async generator into any inner
            // `for await` (including `TypedEventSink` consumers), which lets parked
            // promises settle with `{ done: true }` and the streaming task exit cleanly.
            // We swallow rejection from `return()` because we have no useful reaction.
            void Promise.resolve(record.iterator.return?.({ value: undefined, done: true })).catch(() => void 0);
            activeSubscriptions.delete(message.id);
        }
    };

    const handleAbortMessage = (message: VsCodeLinkRequestMessage): void => {
        const abortController = activeOperations.get(message.id);
        if (abortController) {
            abortController.abort();
            activeOperations.delete(message.id);
        }
    };

    const handleDefaultMessage = async (message: VsCodeLinkRequestMessage): Promise<void> => {
        // In v12, tRPC will have better cancellation support. For now, we use AbortController.
        const abortController = new AbortController();
        activeOperations.set(message.id, abortController);

        try {
            // Clone context so the signal is per-operation and does not mutate the shared context object
            const opContext: TContext = { ...context, signal: abortController.signal };

            const caller = callerFactory(router)(opContext);

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            const procedure = (caller as any)[message.op.path];

            if (typeof procedure !== 'function') {
                // Framework-internal protocol error; not localized - see handleSubscriptionMessage().
                throw new Error(`Procedure not found: ${message.op.path}`);
            }

            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
            const result = await procedure(message.op.input);

            // Only send the result if the operation was not aborted
            if (!abortController.signal.aborted) {
                // Coalesce undefined -> null so the `result` key survives structured-clone
                // serialization over postMessage (undefined values are stripped by the
                // structured-clone algorithm, which would cause the client-side observable
                // to never complete for void mutations).
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const response = { id: message.id, result: result ?? null };
                safePostMessage(response);
            }
        } catch (error) {
            // Only send error if the operation was not aborted (client already errored locally)
            if (!abortController.signal.aborted) {
                safePostMessage(wrapInTrpcErrorMessage(error, message.id));
            }
        } finally {
            activeOperations.delete(message.id);
        }
    };

    const listener = panel.webview.onDidReceiveMessage(async (message: VsCodeLinkRequestMessage) => {
        switch (message.op.type) {
            case 'subscription':
                await handleSubscriptionMessage(message);
                break;

            case 'subscription.stop':
                handleSubscriptionStopMessage(message);
                break;

            case 'abort':
                handleAbortMessage(message);
                break;

            default:
                await handleDefaultMessage(message);
                break;
        }
    });

    const disposable: Disposable = {
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;

            listener.dispose();

            // Abort all active queries/mutations so server-side procedures can stop early.
            for (const controller of activeOperations.values()) {
                controller.abort();
            }
            activeOperations.clear();

            // Abort all active subscriptions and call `return()` on each iterator so async
            // generators terminate even when parked on `next()`. The abort signal alone
            // cannot unblock a parked `next()`; `return()` propagates through the procedure's
            // `for await` into any inner event sink and settles its pending promise.
            // Rejections from `return()` are swallowed because we have no useful reaction
            // during shutdown.
            for (const { abortController, iterator } of activeSubscriptions.values()) {
                abortController.abort();
                void Promise.resolve(iterator.return?.({ value: undefined, done: true })).catch(() => void 0);
            }
            activeSubscriptions.clear();
        },
    };

    return { disposable, activeOperations, activeSubscriptions };
}
