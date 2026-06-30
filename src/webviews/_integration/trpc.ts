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
 *   - `documentDbTelemetryRunner`: the `TelemetryRunner` adapter that wraps the
 *     framework's `telemetryMiddlewareBody`, forwarding each call to the VS Code
 *     Azure telemetry pipeline using the `documentDB.rpc.*` event-name namespace.
 *   - `publicProcedureWithTelemetry`:
 *     `publicProcedure.use((opts) => telemetryMiddlewareBody(opts, documentDbTelemetryRunner))`.
 *     Use this instead of `publicProcedure` when you want the call to be
 *     tracked automatically.
 *   - `WithTelemetry<T>`: re-types the `telemetry` slot on `ctx` to the
 *     richer `ITelemetryContext` so procedure code can access
 *     `suppressAll`, `suppressIfSuccessful`, etc. without ad-hoc casts.
 *   - Re-exports of `publicProcedure`, `router`, and `createCallerFactory` so
 *     per-view routers and the controller share a single import location.
 */

import { callWithTelemetryAndErrorHandling, parseError, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { initWebviewTrpc, type BaseRouterContext as FrameworkBaseRouterContext } from '@microsoft/vscode-ext-webview';
import { telemetryMiddlewareBody, type ProcedureTelemetry, type TelemetryRunner } from '@microsoft/vscode-ext-webview/host';
import { WEBVIEW_CONFIG } from './configuration';

/**
 * The single tRPC instance for this extension, bound to the framework's
 * `BaseRouterContext`. Every per-view router builds its procedures from the
 * `publicProcedure` / `router` exported below (procedures cast `ctx` to their
 * richer DocumentDB context as needed), and the host dispatcher invokes them
 * through this instance's `createCallerFactory`.
 */
const trpc = initWebviewTrpc<FrameworkBaseRouterContext>();
const { publicProcedure, router, createCallerFactory } = trpc;

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
 * DocumentDB telemetry adapter for the framework's `telemetryMiddlewareBody`.
 *
 * The body owns the generic timing / `Canceled` / `Failed` / error-name +
 * error-message recording; this runner establishes the VS Code Azure telemetry
 * scope (event names follow the `documentDB.rpc.${type}.${path}` convention) and
 * adds the DocumentDB-specific error enrichment the body does not: `parseError`
 * is used so non-enumerable Error fields are read correctly and the telemetry
 * path never throws (e.g. on circular `cause` chains), and `errorStack` /
 * `errorCause` are recorded. The enrichment runs after `execute`, so its
 * `parseError`-derived `error` / `errorMessage` values overwrite the body's
 * plain name / message.
 */
const documentDbTelemetryRunner: TelemetryRunner = {
    async run(invocation, execute) {
        const result = await callWithTelemetryAndErrorHandling(
            `${WEBVIEW_CONFIG.telemetry.rpcEventPrefix}.${invocation.type}.${invocation.path}`,
            async (context) => {
                context.errorHandling.suppressDisplay = true;

                // `ITelemetryContext` is the runtime telemetry object; its
                // `properties` / `measurements` index signatures are wider than
                // the framework's `ProcedureTelemetry` (they also admit
                // `undefined` / `TelemetryTrustedValue`). The framework body only
                // ever writes plain strings / numbers, so the bridge is sound.
                const result = await execute(context.telemetry as unknown as ProcedureTelemetry);

                if (!result.ok && result.error) {
                    const parsed = parseError(result.error);
                    context.telemetry.properties.error = parsed.errorType;
                    context.telemetry.properties.errorMessage = parsed.message;
                    context.telemetry.properties.errorStack = (result.error as { stack?: string }).stack ?? '';
                    if (result.error.cause) {
                        context.telemetry.properties.errorCause = parseError(result.error.cause).message;
                    }
                }

                return result;
            },
        );

        if (!result) {
            // This should never happen, but TypeScript requires us to handle the case where result is undefined.
            throw new Error(`No result returned from tRPC call for ${invocation.type} ${invocation.path}`);
        }

        return result;
    },
};

/**
 * Base procedure that automatically attaches DocumentDB Azure telemetry context.
 *
 * Use this instead of {@link publicProcedure} when you want every call to be
 * tracked. The `telemetry` object is available on `ctx` inside your procedure
 * handlers (cast with `WithTelemetry<YourContext>`).
 */
export const publicProcedureWithTelemetry = publicProcedure.use((opts) =>
    telemetryMiddlewareBody(opts, documentDbTelemetryRunner),
);

// Re-export the unprotected procedure builder, the router factory, and the
// caller factory so per-view routers have a single import location for
// everything they need, and the controller can invoke procedures against the
// same tRPC instance the router was built with.
export { createCallerFactory, publicProcedure, router };
