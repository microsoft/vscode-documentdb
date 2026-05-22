/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentDB-tuned re-exports of the tRPC primitives from
 * `@microsoft/vscode-ext-react-webview`.
 *
 * The framework's `publicProcedureWithTelemetry` uses a `console.log` sink by
 * default. We replace it here with a middleware that forwards events to the
 * VS Code Azure telemetry pipeline via `callWithTelemetryAndErrorHandling`
 * using the `documentDB.rpc.*` event-name namespace.
 *
 * Router code throughout the extension imports `router`, `publicProcedure`,
 * `publicProcedureWithTelemetry`, and `WithTelemetry` from this module. The
 * underlying tRPC instance is the one provided by the package — this file is
 * a thin DocumentDB-flavoured adapter.
 */

import { callWithTelemetryAndErrorHandling, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import {
    createMiddleware,
    publicProcedure,
    router,
    type BaseRouterContext,
} from '@microsoft/vscode-ext-react-webview/server';

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
        `documentDB.rpc.${opts.type}.${opts.path}`,
        async (context) => {
            context.errorHandling.suppressDisplay = true;

            const result = await opts.next({
                ctx: {
                    ...opts.ctx,
                    telemetry: context.telemetry,
                },
            });

            // Check if the operation was aborted via AbortSignal
            const signal = (opts.ctx as BaseRouterContext).signal;
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

// Re-export the unprotected procedure builder and router factory so consumers
// have a single import location for everything they need to declare tRPC
// procedures.
export { publicProcedure, router };
