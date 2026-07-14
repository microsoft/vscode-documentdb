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
 *     `publicProcedure.use(telemetryMiddlewareBody(documentDbTelemetryRunner, { buildEventId }))`.
 *     Use this instead of `publicProcedure` when you want the call to be
 *     tracked automatically.
 *   - The runner contributes the full `IActionContext` to the procedure context
 *     as `ctx.actionContext`, so procedure code can read
 *     `ctx.actionContext.telemetry` (`properties` / `measurements`,
 *     `suppressIfSuccessful`, …) and `ctx.actionContext.errorHandling` without
 *     an ad-hoc cast beyond narrowing `ctx` to the view's `RouterContext`.
 *   - Re-exports of `publicProcedure`, `router`, and `createCallerFactory` so
 *     per-view routers and the controller share a single import location.
 */

import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { initWebviewTrpc, type BaseRouterContext as FrameworkBaseRouterContext } from '@microsoft/vscode-ext-webview';
import { getInvocationSignal, telemetryMiddlewareBody, type TelemetryRunner } from '@microsoft/vscode-ext-webview/host';
import { WEBVIEW_CONFIG } from './configuration';

/**
 * The single tRPC instance for this extension, bound to the framework's
 * `BaseRouterContext`. Every per-view router builds its procedures from the
 * `publicProcedure` / `router` exported below (procedures cast `ctx` to their
 * richer DocumentDB context as needed), and the host dispatcher invokes them
 * through this instance's `createCallerFactory`.
 */
const trpc = initWebviewTrpc<FrameworkBaseRouterContext>();
const { publicProcedure, router, mergeRouters, createCallerFactory } = trpc;

/**
 * Shape the DocumentDB telemetry runner contributes to the procedure context.
 *
 * Procedures reach `ctx.actionContext` — the full `IActionContext` from
 * `@microsoft/vscode-azext-utils` — for telemetry `properties` / `measurements`
 * (`ctx.actionContext.telemetry`), `errorHandling.suppressDisplay`,
 * `telemetry.suppressIfSuccessful`, and so on. The DocumentDB `RouterContext`
 * types declare this field so procedures read it after a plain
 * `ctx as RouterContext` narrowing, with no telemetry-specific cast.
 */
export interface RpcEnrichment {
    actionContext: IActionContext;
}

/**
 * DocumentDB telemetry adapter for the framework's `telemetryMiddlewareBody`.
 *
 * The framework body is a thin delegator: it resolves the event id and hands
 * control here. This runner establishes the VS Code Azure telemetry scope with
 * `callWithTelemetryAndErrorHandling` (which records `duration` and dispatches
 * to Application Insights), contributes the `IActionContext` to the procedure
 * context, and classifies the outcome.
 *
 * `callWithTelemetryAndErrorHandling` would classify a *thrown* error on its
 * own, but tRPC surfaces failures as a result object (`{ ok: false }`) rather
 * than a throw, so this runner translates that: it records `Failed` with
 * `parseError`-derived `error` / `errorMessage` / `errorStack` / `errorCause`
 * (so non-enumerable Error fields are read correctly and circular `cause`
 * chains never throw). Aborted calls are left as `Canceled` with no error
 * fields so a cancellation is never counted as a failure (R766-C01 / R766-C02).
 */
const documentDbTelemetryRunner: TelemetryRunner<RpcEnrichment> = {
    async run(eventId, invocation, invoke) {
        const result = await callWithTelemetryAndErrorHandling(eventId, async (actionContext) => {
            actionContext.errorHandling.suppressDisplay = true;

            const middlewareResult = await invoke({ actionContext });

            const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
            if (aborted) {
                actionContext.telemetry.properties.aborted = 'true';
                actionContext.telemetry.properties.result = 'Canceled';
            } else if (!middlewareResult.ok && middlewareResult.error) {
                const parsed = parseError(middlewareResult.error);
                actionContext.telemetry.properties.result = 'Failed';
                actionContext.telemetry.properties.error = parsed.errorType;
                actionContext.telemetry.properties.errorMessage = parsed.message;
                actionContext.telemetry.properties.errorStack =
                    (middlewareResult.error as { stack?: string }).stack ?? '';
                if (middlewareResult.error.cause) {
                    actionContext.telemetry.properties.errorCause = parseError(middlewareResult.error.cause).message;
                }
            }

            return middlewareResult;
        });

        if (!result) {
            // This should never happen, but TypeScript requires us to handle the case where result is undefined.
            throw new Error(`No result returned from tRPC telemetry wrapper for ${eventId}`);
        }

        return result;
    },
};

/**
 * Base procedure that automatically attaches the DocumentDB Azure telemetry
 * context.
 *
 * Use this instead of {@link publicProcedure} when you want every call to be
 * tracked. The full `IActionContext` is available on `ctx.actionContext` inside
 * your procedure handlers (after narrowing `ctx` to your view's `RouterContext`).
 */
export const publicProcedureWithTelemetry = publicProcedure.use(
    telemetryMiddlewareBody(documentDbTelemetryRunner, {
        buildEventId: ({ type, path }) => `${WEBVIEW_CONFIG.telemetry.rpcEventPrefix}.${type}.${path}`,
    }),
);

// Re-export the tRPC instance, the unprotected procedure builder, the router
// factory, and the caller factory so per-view routers have a single import
// location for everything they need, and the controller can invoke procedures
// against the same tRPC instance the router was built with. Panel factories pass
// `trpc` to `openAppWebview` (R766-N02) so the caller factory rides along with
// the instance and cannot be mismatched with the router.
export { createCallerFactory, mergeRouters, publicProcedure, router, trpc };
