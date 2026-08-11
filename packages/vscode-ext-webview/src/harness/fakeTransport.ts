/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A fake webview transport for tests and the visual harness.
 *
 * {@link connectTrpc} accepts anything with a compatible `postMessage`
 * (`VsCodeApiLike`), so a webview can be driven without an extension host by
 * substituting this object for `acquireVsCodeApi()`. Every procedure the
 * component calls is answered from a **scenario**: a map of procedure path to
 * canned outcome.
 *
 * The point of doing this in the framework rather than in each consumer's test
 * folder is that a scenario written here is **typed against the router**. A path
 * that does not exist, or a `result` whose shape no longer matches the
 * procedure's return type, is a compile error rather than a fixture that quietly
 * describes a state the product can no longer produce.
 *
 * @example
 * ```ts
 * const transport = createFakeTransport<AppRouter>({
 *     scenario: {
 *         'common.openUrl': { result: undefined },
 *     },
 * });
 *
 * const { client } = connectTrpc<AppRouter>(transport);
 * await client.common.openUrl.mutate({ url: 'https://example.com' });
 *
 * expect(transport.callsTo('common.openUrl')).toHaveLength(1);
 * ```
 */

import { type AnyProcedure, type AnyRouter, type inferProcedureOutput } from '@trpc/server';
import { type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from '../shared/wireProtocol';
import { type VsCodeApiLike } from '../webview/connectTrpc';

/** The router's procedure tree, as tRPC stores it (nested, not flattened). */
type ProcedureRecordOf<TRouter extends AnyRouter> = TRouter['_def']['procedures'];

/**
 * Every procedure in `T` as a dotted path.
 *
 * Procedures are the leaves; anything else that is an object is a nested router
 * or a plain grouping record, so it recurses. `AnyProcedure` is tested first
 * because a procedure is itself an object.
 */
type PathsIn<T> = {
    [K in keyof T & string]: T[K] extends AnyProcedure ? K : T[K] extends object ? `${K}.${PathsIn<T[K]>}` : never;
}[keyof T & string];

/** Walks a dotted path back down to the node it names. */
type NodeAt<T, TPath extends string> = TPath extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
        ? NodeAt<T[Head], Rest>
        : never
    : TPath extends keyof T
      ? T[TPath]
      : never;

/** Union of every procedure path in `TRouter`, e.g. `'common.openUrl'`. */
export type ProcedurePath<TRouter extends AnyRouter> = PathsIn<ProcedureRecordOf<TRouter>>;

/** The value a procedure resolves to, given its dotted path. */
export type ProcedureOutput<TRouter extends AnyRouter, TPath extends ProcedurePath<TRouter>> =
    NodeAt<ProcedureRecordOf<TRouter>, TPath> extends infer TNode
        ? TNode extends AnyProcedure
            ? inferProcedureOutput<TNode>
            : never
        : never;

/**
 * The error half of a fixture. Only `message` is required; the rest mirrors what
 * the real host serializes in `attachTrpc`'s `wrapInTrpcErrorMessage`.
 */
export interface FixtureError {
    readonly message: string;
    readonly name?: string;
    readonly code?: number;
    readonly stack?: string;
    readonly cause?: unknown;
    readonly data?: unknown;
}

/**
 * The element type a subscription yields.
 *
 * `inferProcedureOutput` reports a subscription's output as the `AsyncIterable`
 * the generator returns, but a fixture describes the values that travel over the
 * wire — the host posts one message per yielded item. Unwrapping here keeps a
 * `stream` fixture typed as the events a component actually receives.
 */
type StreamElement<TOutput> = TOutput extends AsyncIterable<infer TElement> ? TElement : TOutput;

/**
 * One procedure's canned outcome.
 *
 * - `result` — resolve once (queries and mutations).
 * - `stream` — emit each value, then complete (subscriptions).
 * - `error` — reject.
 */
export type ProcedureFixture<TRouter extends AnyRouter, TPath extends ProcedurePath<TRouter>> =
    | { readonly result: ProcedureOutput<TRouter, TPath> }
    | { readonly stream: readonly StreamElement<ProcedureOutput<TRouter, TPath>>[] }
    | { readonly error: FixtureError };

/**
 * A named UI state, expressed as the answers the host would give.
 *
 * Partial by design: a scenario only needs to cover the procedures the component
 * under test actually calls. Anything else is reported as an unmocked call
 * rather than silently hanging.
 */
export type Scenario<TRouter extends AnyRouter> = {
    readonly [TPath in ProcedurePath<TRouter>]?: ProcedureFixture<TRouter, TPath>;
};

/** One recorded attempt by the webview to reach the host. */
export interface RecordedCall {
    /** Dotted procedure path, e.g. `'common.openUrl'`. */
    readonly path: string;
    /** `'query'`, `'mutation'`, `'subscription'`, `'abort'` or `'subscription.stop'`. */
    readonly type: string;
    /** The procedure input, exactly as the webview sent it. */
    readonly input: unknown;
}

/** Options for {@link createFakeTransport}. */
export interface FakeTransportOptions<TRouter extends AnyRouter> {
    /** The procedure answers for this UI state. */
    readonly scenario: Scenario<TRouter>;
    /**
     * How a response reaches the client. Defaults to `window.postMessage`, which
     * is what `connectTrpc` listens on in a browser. Supply this in a non-DOM
     * test environment.
     */
    readonly deliver?: (message: VsCodeLinkResponseMessage) => void;
}

/** A fake `acquireVsCodeApi()` plus the assertions it makes possible. */
export interface FakeTransport<TRouter extends AnyRouter> extends VsCodeApiLike {
    /**
     * Every host call the webview attempted, in order.
     *
     * This is the assertion surface for behaviour that would otherwise leave the
     * page — "the install button opens the Docker Desktop page" is a check on
     * this array rather than on a real browser navigation.
     */
    readonly calls: readonly RecordedCall[];
    /** The subset of {@link FakeTransport.calls} recorded for one procedure. */
    callsTo(path: ProcedurePath<TRouter>): readonly RecordedCall[];
    /** Clears recorded calls and stops any in-flight streams. */
    reset(): void;
}

/** Structural guard mirroring the host's `isTransportRequestMessage`. */
function isTransportRequestMessage(message: unknown): message is VsCodeLinkRequestMessage {
    if (message === null || typeof message !== 'object') {
        return false;
    }
    const op = (message as { op?: unknown }).op;
    return (
        typeof (message as { id?: unknown }).id === 'string' &&
        op !== null &&
        typeof op === 'object' &&
        typeof (op as { type?: unknown }).type === 'string'
    );
}

/** Posts to the real `window` when there is one. */
function defaultDeliver(message: VsCodeLinkResponseMessage): void {
    const maybeWindow = (globalThis as { window?: { postMessage?: (data: unknown, origin: string) => void } }).window;
    if (typeof maybeWindow?.postMessage === 'function') {
        maybeWindow.postMessage(message, '*');
        return;
    }
    throw new Error(
        'createFakeTransport: no `window.postMessage` in this environment. Pass `deliver` to route responses to the client.',
    );
}

/**
 * Creates a fake transport that answers procedure calls from a typed scenario.
 *
 * @template TRouter - The application's root tRPC router type.
 * @param options    - The scenario, and optionally how responses are delivered.
 * @returns An object usable anywhere `acquireVsCodeApi()` is expected.
 */
export function createFakeTransport<TRouter extends AnyRouter>(
    options: FakeTransportOptions<TRouter>,
): FakeTransport<TRouter> {
    const { scenario, deliver = defaultDeliver } = options;
    const calls: RecordedCall[] = [];
    // Operations whose stream should stop early because the client aborted or
    // unsubscribed. Mirrors the host, which drops a cancelled subscription.
    const cancelled = new Set<string>();

    const fixtureFor = (path: string): ProcedureFixture<TRouter, ProcedurePath<TRouter>> | undefined =>
        (scenario as Record<string, ProcedureFixture<TRouter, ProcedurePath<TRouter>> | undefined>)[path];

    const respond = (message: VsCodeLinkResponseMessage): void => {
        // `postMessage` is asynchronous in a real webview. Matching that here keeps
        // ordering bugs reproducible instead of hiding them behind a synchronous
        // fake that resolves before the caller has finished rendering.
        queueMicrotask(() => {
            deliver(message);
        });
    };

    const respondWithError = (id: string, error: FixtureError): void => {
        respond({
            id,
            error: {
                name: error.name ?? 'TRPCClientError',
                message: error.message,
                code: error.code,
                stack: error.stack,
                cause: error.cause,
                data: error.data,
            },
        });
    };

    const handle = (message: VsCodeLinkRequestMessage): void => {
        const { id, op } = message;
        const path = op.path;

        // Control messages carry no fixture; record them so a test can assert that
        // a component cancelled its work, then stop the stream.
        if (op.type === 'abort' || op.type === 'subscription.stop') {
            cancelled.add(id);
            calls.push({ path, type: op.type, input: op.input });
            return;
        }

        calls.push({ path, type: op.type, input: op.input });

        const fixture = fixtureFor(path);
        if (fixture === undefined) {
            respondWithError(id, {
                name: 'NotFoundError',
                message: `No fixture for '${path}' in this scenario. Add one, or assert the call instead of invoking it.`,
            });
            return;
        }

        if ('error' in fixture) {
            respondWithError(id, fixture.error);
            return;
        }

        if ('stream' in fixture) {
            for (const value of fixture.stream) {
                // A later `subscription.stop` must not replay earlier queued values.
                if (cancelled.has(id)) {
                    return;
                }
                // `?? null` mirrors the host: the structured-clone algorithm strips
                // `undefined`, and the client's observable would never settle.
                respond({ id, result: value ?? null });
            }
            respond({ id, complete: true });
            return;
        }

        respond({ id, result: fixture.result ?? null });
    };

    return {
        calls,
        postMessage(message: unknown): void {
            // Behave like a guest on a shared bus: ignore traffic that is not a
            // transport request rather than throwing on it.
            if (isTransportRequestMessage(message)) {
                handle(message);
            }
        },
        callsTo(path: ProcedurePath<TRouter>): readonly RecordedCall[] {
            return calls.filter((call) => call.path === path);
        },
        reset(): void {
            calls.length = 0;
            cancelled.clear();
        },
    };
}
