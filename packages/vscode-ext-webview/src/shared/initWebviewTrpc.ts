/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed tRPC initialiser for webview routers.
 *
 * `initTRPC` should be called once per application. Calling
 * `initWebviewTrpc<TContext>()` binds the tRPC root to the consumer's context
 * type, so every procedure built from the returned `publicProcedure` sees
 * `ctx` typed as `TContext` with **no `ctx as RouterContext` cast**.
 *
 * @see https://trpc.io/docs/server/routers
 * @see https://trpc.io/docs/server/context
 *
 * @example
 * ```ts
 * import { initWebviewTrpc, type BaseRouterContext } from '@microsoft/vscode-ext-webview';
 *
 * type RouterContext = BaseRouterContext & { workspaceRoot: string };
 *
 * const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<RouterContext>();
 *
 * export const appRouter = router({
 *   // `ctx.workspaceRoot` is typed; no cast needed.
 *   cwd: publicProcedure.query(({ ctx }) => ctx.workspaceRoot),
 * });
 * ```
 */

import { initTRPC } from '@trpc/server';
import { type BaseRouterContext } from './BaseRouterContext';

/**
 * The set of tRPC builders returned by {@link initWebviewTrpc}, all bound to the
 * consumer's `TContext`.
 *
 * - `router` builds (sub)routers;
 * - `publicProcedure` is the base procedure (`ctx` is typed as `TContext`);
 * - `createCallerFactory` builds a server-side caller for a router (used by
 *   the host dispatcher to invoke procedures);
 * - `middleware` builds reusable middleware bound to this instance.
 */
export type WebviewTrpc<TContext extends BaseRouterContext> = ReturnType<typeof initWebviewTrpc<TContext>>;

/**
 * Create a context-typed tRPC root for a webview application.
 *
 * @template TContext - The router context shape (must extend
 *                      {@link BaseRouterContext}). Defaults to
 *                      `BaseRouterContext`.
 */
export function initWebviewTrpc<TContext extends BaseRouterContext = BaseRouterContext>() {
    const t = initTRPC.context<TContext>().create();

    return {
        router: t.router,
        publicProcedure: t.procedure,
        createCallerFactory: t.createCallerFactory,
        middleware: t.middleware,
    };
}

/**
 * Default tRPC instance backing the convenience re-exports below.
 *
 * Its context is the bare {@link BaseRouterContext}. The same instance also
 * provides the default `createCallerFactory` used by the host dispatcher when a
 * consumer does not pass one, so the default `router` / `publicProcedure` and
 * that default caller factory always belong to a single tRPC instance.
 */
const defaultTrpc = initWebviewTrpc();

/** Convenience `router` builder bound to the default {@link BaseRouterContext}. */
export const router = defaultTrpc.router;

/** Convenience base procedure bound to the default {@link BaseRouterContext}. */
export const publicProcedure = defaultTrpc.publicProcedure;

/**
 * Caller factory for the default instance. The host dispatcher uses this when a
 * consumer does not supply its own `createCallerFactory`.
 */
export const createCallerFactory = defaultTrpc.createCallerFactory;
