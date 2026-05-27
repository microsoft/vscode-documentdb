/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is your entry point to setup the root configuration for tRPC on the server.
 * - `initTRPC` should only be used once per app.
 * - We export only the functionality that we use so we can enforce which base
 *   procedures should be used.
 *
 * Learn how to create protected base procedures and other things below:
 * @see https://trpc.io/docs/v11/router
 * @see https://trpc.io/docs/v11/procedures
 */

import { initTRPC, type AnyRouter } from '@trpc/server';
import { type BaseRouterContext } from './BaseRouterContext';

/**
 * Telemetry context interface.
 *
 * Replace this with your telemetry library's context type when implementing a
 * custom middleware. For example, if you use `@microsoft/vscode-azext-utils`
 * with Application Insights, you can use `ITelemetryContext` from that package
 * as the structural equivalent — both expose `properties` and `measurements`
 * records.
 */
export interface TelemetryContext {
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

/**
 * Helper type: transforms a context type to have required (non-optional)
 * telemetry. Use together with `publicProcedureWithTelemetry` (or your own
 * telemetry-attaching procedure) to get type-safe telemetry access inside
 * procedure handlers.
 */
export type WithTelemetry<T extends { telemetry?: unknown }> = T & {
    telemetry: TelemetryContext;
};

/**
 * Initialization of tRPC backend.
 *
 * Please note, this should be done only once per backend.
 */
const t = initTRPC.create();

/**
 * Factory to create a caller (server-side procedure invoker) for a given
 * router. Re-exported from tRPC so consumers do not need a direct dependency.
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * Re-exported `router` builder from tRPC.
 */
export const router = t.router;

/**
 * Unprotected base procedure. Use this for procedures that do not need any
 * middleware applied.
 */
export const publicProcedure = t.procedure;

/**
 * Factory for tRPC middleware bound to this package's tRPC instance.
 *
 * Use it to build custom middleware (telemetry sinks, authentication, etc.)
 * that compose with {@link publicProcedure} and routers created via
 * {@link router}.
 *
 * @example Custom telemetry middleware with `@microsoft/vscode-azext-utils`
 *
 * ```typescript
 * import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
 * import { createMiddleware, publicProcedure, type BaseRouterContext } from '@microsoft/vscode-ext-react-webview/server';
 *
 * const trpcToTelemetry = createMiddleware(async (opts) => {
 *     const result = await callWithTelemetryAndErrorHandling(
 *         `myExtension.rpc.${opts.type}.${opts.path}`,
 *         async (context) => {
 *             context.errorHandling.suppressDisplay = true;
 *             return opts.next({ ctx: { ...opts.ctx, telemetry: context.telemetry } });
 *         },
 *     );
 *     if (!result) {
 *         throw new Error(`No result from tRPC call: ${opts.type} ${opts.path}`);
 *     }
 *     return result;
 * });
 *
 * export const publicProcedureWithTelemetry = publicProcedure.use(trpcToTelemetry);
 * ```
 */
export const createMiddleware = t.middleware;

/**
 * Default telemetry middleware — logs every tRPC call with contextual metadata.
 *
 * The default implementation uses `console.log` so the package works
 * out-of-the-box without any external dependency. For production use, build
 * your own middleware via {@link createMiddleware} (see the example above).
 */
const defaultTrpcToTelemetry = t.middleware(async (opts) => {
    const telemetry: TelemetryContext = {
        properties: {},
        measurements: {},
    };

    const startTime = Date.now();

    const result = await opts.next({
        ctx: {
            ...opts.ctx,
            telemetry,
        },
    });

    const durationMs = Date.now() - startTime;
    telemetry.measurements.durationMs = durationMs;

    // Check if the operation was aborted via AbortSignal
    const signal = (opts.ctx as BaseRouterContext).signal;
    if (signal?.aborted) {
        telemetry.properties.aborted = 'true';
        telemetry.properties.result = 'Canceled';
    }

    if (!result.ok) {
        if (!signal?.aborted) {
            telemetry.properties.result = 'Failed';
        }
        telemetry.properties.error = result.error.name;
        telemetry.properties.errorMessage = result.error.message;
    }

    // Default: log to console. Replace with your telemetry sink.
    console.log(`[tRPC] ${opts.type} ${opts.path} (${durationMs}ms)`, telemetry.properties);

    return result;
});

/**
 * Convenience base procedure that automatically attaches telemetry context
 * using the default console-logging middleware. Suitable for getting started;
 * for production telemetry, build your own procedure using
 * {@link createMiddleware} (see the example on `createMiddleware`).
 */
export const publicProcedureWithTelemetry = publicProcedure.use(defaultTrpcToTelemetry);

// Re-export key tRPC server types so consumers do not need to import @trpc/server directly.
export type { AnyRouter };
