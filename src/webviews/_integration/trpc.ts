/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Leaf module that exposes the tRPC primitives every per-view router needs.
 *
 * This file is intentionally a leaf in the module graph: it imports from the
 * framework package and from a few small helpers, but it **must not** import
 * from `appRouter.ts` or from any per-view router. Doing so would create a
 * circular import chain:
 *
 *   appRouter.ts  ->  collectionViewRouter.ts  ->  appRouter.ts
 *
 * which produces the runtime error
 *
 *   "Cannot access 'publicProcedureWithTelemetry' before initialization"
 *
 * because the per-view router executes at the top level (using
 * `publicProcedureWithTelemetry` to declare its procedures) while
 * `appRouter.ts` is still mid-evaluation and has not reached its own
 * `export const publicProcedureWithTelemetry = ...` line yet.
 *
 * Keeping the primitives here breaks the cycle: per-view routers import
 * value bindings (`publicProcedureWithTelemetry`, `router`) from this file,
 * `appRouter.ts` also imports from this file, and nothing here imports
 * back from `appRouter.ts`.
 *
 * What lives here:
 *   - `trpcToTelemetry`: middleware that forwards each call to the VS Code
 *     Azure telemetry pipeline using the `documentDB.rpc.*` event-name
 *     namespace.
 *   - `publicProcedureWithTelemetry`: `publicProcedure.use(trpcToTelemetry)`.
 *     Use this instead of `publicProcedure` when you want the call to be
 *     tracked automatically.
 *   - `WithTelemetry<T>`: re-types the `telemetry` slot on `ctx` to the
 *     richer `ITelemetryContext` so procedure code can access
 *     `suppressAll`, `suppressIfSuccessful`, etc. without ad-hoc casts.
 *   - Re-exports of `publicProcedure` and `router` so per-view routers
 *     have a single import location for everything they need.
 */

import { callWithTelemetryAndErrorHandling, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import {
    createMiddleware,
    publicProcedure,
    router,
    type BaseRouterContext as FrameworkBaseRouterContext,
} from '@microsoft/vscode-ext-react-webview/server';
import { WEBVIEW_CONFIG } from './configuration';

/**
 * DocumentDB-flavoured replacement for the package's `WithTelemetry<T>` helper.
 *
 * The package types `telemetry` as its generic `TelemetryContext`
 * (`{ properties; measurements }`). In this extension, the runtime value is
 * always the richer `ITelemetryContext` from `@microsoft/vscode-azext-utils`
 * (provides `suppressAll`, `suppressIfSuccessful`, etc.). Re-typing the helper
 * here lets procedure code access those fields without ad-hoc casts.
 */
export type WithTelemetry<T extends { telemetry?: unknown }> = Omit<T, 'telemetry'> & {
    telemetry: ITelemetryContext;
};

/**
 * Telemetry middleware that forwards every tRPC call to the VS Code Azure
 * telemetry pipeline. Event names follow the `documentDB.rpc.${type}.${path}`
 * convention.
 */
const trpcToTelemetry = createMiddleware(async (opts) => {
    const result = await callWithTelemetryAndErrorHandling(
        `${WEBVIEW_CONFIG.telemetry.rpcEventPrefix}.${opts.type}.${opts.path}`,
        async (context) => {
            context.errorHandling.suppressDisplay = true;

            const result = await opts.next({
                ctx: {
                    ...opts.ctx,
                    telemetry: context.telemetry,
                },
            });

            // Check if the operation was aborted via AbortSignal
            const signal = (opts.ctx as FrameworkBaseRouterContext).signal;
            if (signal?.aborted) {
                context.telemetry.properties.aborted = 'true';
                context.telemetry.properties.result = 'Canceled';
            }

            if (!result.ok) {
                /**
                 * we're not handling any error here as we just want to log it here and let the
                 * caller of the RPC call handle the error there.
                 */

                if (!signal?.aborted) {
                    context.telemetry.properties.result = 'Failed';
                }
                context.telemetry.properties.error = result.error.name;
                context.telemetry.properties.errorMessage = result.error.message;
                context.telemetry.properties.errorStack = result.error.stack ?? '';
                if (result.error.cause) {
                    context.telemetry.properties.errorCause = JSON.stringify(result.error.cause, null, 0);
                }
            }

            return result;
        },
    );

    if (!result) {
        // This should never happen, but TypeScript requires us to handle the case where result is undefined.
        throw new Error(`No result returned from tRPC call for ${opts.type} ${opts.path}`);
    }

    return result;
});

/**
 * Base procedure that automatically attaches DocumentDB Azure telemetry context.
 *
 * Use this instead of {@link publicProcedure} when you want every call to be
 * tracked. The `telemetry` object is available on `ctx` inside your procedure
 * handlers (cast with `WithTelemetry<YourContext>`).
 */
export const publicProcedureWithTelemetry = publicProcedure.use(trpcToTelemetry);

// Re-export the unprotected procedure builder and router factory so per-view
// routers have a single import location for everything they need to declare
// tRPC procedures.
export { publicProcedure, router };
