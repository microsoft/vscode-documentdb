/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared types for the instance-agnostic middleware bodies.
 *
 * A "middleware body" is a plain async function holding reusable orchestration
 * (timing, abort detection, result inspection). It is wired onto the consumer's
 * own tRPC instance, e.g.
 *
 * ```ts
 * publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger));
 * ```
 *
 * Because the body is not bound to any particular tRPC instance, the same body
 * works across consumers regardless of how they called {@link initWebviewTrpc}.
 * The types here are the structural contract a real tRPC middleware `opts`
 * object satisfies.
 */

/** The kind of tRPC operation being invoked. */
export type ProcedureType = 'query' | 'mutation' | 'subscription';

/**
 * Structural view of an error carried by a failed middleware result. A tRPC
 * `TRPCError` satisfies this shape.
 */
export interface ProcedureErrorLike {
    name?: string;
    message?: string;
    code?: string | number;
    cause?: unknown;
}

/**
 * Structural shape of the value a tRPC middleware's `next()` resolves to. The
 * bodies only read `ok` (and `error` on failure), so this minimal shape keeps
 * them decoupled from tRPC's internal result type while staying assignable from
 * it.
 */
export interface MiddlewareResultLike {
    readonly ok: boolean;
    readonly error?: ProcedureErrorLike;
}

/**
 * Structural subset of a tRPC middleware's options that the middleware bodies
 * consume. A real tRPC middleware `opts` object satisfies this, so a body can
 * be wired as `publicProcedure.use((opts) => body(opts, adapter))`.
 *
 * @template TResult - The exact result type `next()` resolves to. Bodies are
 *                     generic over it and pass it straight through, so wiring a
 *                     body into `.use()` preserves tRPC's own result typing.
 */
export interface ProcedureInvocation<TResult extends MiddlewareResultLike = MiddlewareResultLike> {
    readonly type: ProcedureType;
    readonly path: string;
    readonly ctx: unknown;
    next: (opts?: { ctx?: unknown }) => Promise<TResult>;
}

/**
 * Reads the cooperative `AbortSignal` off a router context without assuming the
 * concrete context type. Returns `undefined` when the context carries no signal.
 */
export function getInvocationSignal(ctx: unknown): AbortSignal | undefined {
    return (ctx as { signal?: AbortSignal } | null | undefined)?.signal;
}
