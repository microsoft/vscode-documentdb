/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client-side event channel for observing the outcome of webview tRPC calls.
 *
 * Why this exists. A webview usually has a few cross-cutting observers that
 * want to react to *every* query/mutation outcome in one place: a FluentUI
 * `Toaster`, an ARIA announcer, a status-bar widget, telemetry. Wiring each of
 * those into every call site (or into a single `onError` callback) is
 * repetitive and conflates two genuinely different outcomes: a real error and a
 * user-initiated cancel. The channel separates them:
 *
 *   - {@link RpcEventChannel.onSuccess | onSuccess} - the call resolved;
 *   - {@link RpcEventChannel.onError | onError} - the call rejected with an error;
 *   - {@link RpcEventChannel.onAborted | onAborted} - the call was canceled.
 *
 * Separating *aborted* from *errored* means a user cancel does not surface as an
 * error toast.
 *
 * The channel is intentionally **observer-only**: handlers cannot mutate the
 * value or turn an error into a success. For that, write a `TRPCLink`.
 *
 * `createEventChannel()` returns an object that is both the observe side
 * ({@link RpcEventChannel}) and the publish side ({@link RpcEventEmitter}). The
 * transport links publish into the emit side; consumers receive the channel
 * narrowed to {@link RpcEventChannel}.
 */

/** Unsubscribes a handler that was registered on an {@link RpcEventChannel}. */
export type Unsubscribe = () => void;

/** Identifies the call an event refers to. */
export interface CallInfo {
    /** The tRPC operation type. */
    readonly type: 'query' | 'mutation' | 'subscription';
    /** The dotted procedure path, e.g. `documents.find`. */
    readonly path: string;
    /** The tRPC operation id, when available. */
    readonly id?: number | string;
}

/** Handler invoked when a call resolves successfully. */
export type SuccessHandler = (info: CallInfo, data: unknown) => void;

/** Handler invoked when a call rejects with an error. */
export type ErrorEventHandler = (error: Error, info: CallInfo) => void;

/** Handler invoked when a call is aborted (canceled). */
export type AbortedHandler = (info: CallInfo) => void;

/**
 * The observe side of an event channel. Each `on*` method registers a handler
 * and returns an {@link Unsubscribe} to remove it. Registering or removing a
 * handler while an event is being dispatched is safe and does not affect the
 * in-flight dispatch (handlers are snapshotted before they are called).
 */
export interface RpcEventChannel {
    onSuccess(handler: SuccessHandler): Unsubscribe;
    onError(handler: ErrorEventHandler): Unsubscribe;
    onAborted(handler: AbortedHandler): Unsubscribe;
}

/**
 * The publish side of an event channel. The transport links call these to
 * report outcomes; consumers do not see this surface.
 */
export interface RpcEventEmitter {
    emitSuccess(info: CallInfo, data: unknown): void;
    emitError(error: Error, info: CallInfo): void;
    emitAborted(info: CallInfo): void;
}

/** An event channel that exposes both the observe and publish surfaces. */
export interface EventChannel extends RpcEventChannel, RpcEventEmitter {}

/**
 * Registers `handler` in `handlers` and returns an idempotent unsubscribe.
 */
function subscribe<THandler>(handlers: Set<THandler>, handler: THandler): Unsubscribe {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
}

/**
 * Create a fresh {@link EventChannel}.
 *
 * Dispatch is snapshot-safe: each `emit*` iterates over a copy of the handler
 * set, so a handler that subscribes or unsubscribes another handler during
 * dispatch never corrupts the in-flight iteration.
 */
export function createEventChannel(): EventChannel {
    const successHandlers = new Set<SuccessHandler>();
    const errorHandlers = new Set<ErrorEventHandler>();
    const abortedHandlers = new Set<AbortedHandler>();

    return {
        onSuccess(handler) {
            return subscribe(successHandlers, handler);
        },
        onError(handler) {
            return subscribe(errorHandlers, handler);
        },
        onAborted(handler) {
            return subscribe(abortedHandlers, handler);
        },
        emitSuccess(info, data) {
            for (const handler of [...successHandlers]) {
                handler(info, data);
            }
        },
        emitError(error, info) {
            for (const handler of [...errorHandlers]) {
                handler(error, info);
            }
        },
        emitAborted(info) {
            for (const handler of [...abortedHandlers]) {
                handler(info);
            }
        },
    };
}
