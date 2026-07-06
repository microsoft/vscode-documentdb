/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Telemetry middleware body and its adapter interface (`TelemetryRunner`).
 *
 * The body owns the reusable orchestration (timing, abort detection, populating
 * standard result properties) and injects a per-call telemetry bag into the
 * procedure context. The {@link TelemetryRunner} adapter, supplied by the
 * consumer, owns the integration-specific scope, for example wrapping the call
 * in `callWithTelemetryAndErrorHandling` from `@microsoft/vscode-azext-utils`
 * and dispatching the populated bag to Application Insights.
 *
 * This is the instance-agnostic telemetry path: the body is wired onto the
 * consumer's own tRPC instance and the runner is a plain object, so neither is
 * tied to a particular `initWebviewTrpc` call.
 */

import { getInvocationSignal, type MiddlewareResultLike, type ProcedureInvocation } from './types';

/**
 * Per-call telemetry bag the body populates and the runner dispatches. Mirrors
 * the structural shape of common telemetry contexts (e.g. `ITelemetryContext`
 * from `@microsoft/vscode-azext-utils`).
 */
export interface ProcedureTelemetry {
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

/**
 * Re-types the `telemetry` slot on a router context `TContext` from the package's
 * minimal shape to a richer telemetry-library context `TTelemetry` (for example
 * `ITelemetryContext` from `@microsoft/vscode-azext-utils`), and makes it
 * required.
 *
 * The telemetry middleware injects whatever bag your {@link TelemetryRunner}
 * hands it into `ctx.telemetry`. When that bag is richer than the package default
 * `{ properties, measurements }`, annotate the procedure's `ctx` with
 * `WithTelemetry<...>` so procedure code reads the extra fields (for example
 * `suppressAll`) without an ad-hoc cast.
 *
 * @template TContext   - the router context (must have an optional `telemetry`).
 * @template TTelemetry - the concrete telemetry context type the runner supplies;
 *                        defaults to the package's {@link ProcedureTelemetry}.
 *
 * @example
 * ```ts
 * import type { ITelemetryContext } from '@microsoft/vscode-azext-utils';
 * import type { WithTelemetry } from '@microsoft/vscode-ext-webview/host';
 *
 * type Ctx = BaseRouterContext & { db: Db };
 * export type TrackedCtx = WithTelemetry<Ctx, ITelemetryContext>;
 *
 * publicProcedure.query(({ ctx }: { ctx: TrackedCtx }) => {
 *   ctx.telemetry.properties.result = 'ok'; // fully typed, no cast
 * });
 * ```
 */
export type WithTelemetry<TContext extends { telemetry?: unknown }, TTelemetry = ProcedureTelemetry> = Omit<
    TContext,
    'telemetry'
> & {
    telemetry: TTelemetry;
};

/**
 * Consumer-supplied adapter that runs a procedure inside an integration-specific
 * telemetry scope.
 *
 * The runner establishes the scope (creating or obtaining a telemetry bag),
 * invokes `execute(bag)` exactly once, and returns its result. The package
 * provides `execute`: it drives the procedure and records duration and outcome
 * into `bag`.
 *
 * @example A runner over `@microsoft/vscode-azext-utils`
 * ```ts
 * const runner: TelemetryRunner = {
 *   async run(invocation, execute) {
 *     const result = await callWithTelemetryAndErrorHandling(
 *       `myExt.rpc.${invocation.type}.${invocation.path}`,
 *       async (context) => {
 *         context.errorHandling.suppressDisplay = true;
 *         return execute(context.telemetry);
 *       },
 *     );
 *     if (!result) throw new Error(`No result for ${invocation.type} ${invocation.path}`);
 *     return result;
 *   },
 * };
 * ```
 */
export interface TelemetryRunner {
    run<TResult extends MiddlewareResultLike>(
        invocation: ProcedureInvocation<TResult>,
        execute: (telemetry: ProcedureTelemetry) => Promise<TResult>,
    ): Promise<TResult>;
}

/**
 * Telemetry middleware body. Delegates to the consumer's {@link TelemetryRunner}
 * to establish a telemetry scope, then within it: injects the telemetry bag into
 * the procedure context, times the call, records cancellation as
 * `Canceled`/`aborted`, records failures as `Failed` with the error name and
 * message, and returns the procedure's result unchanged.
 *
 * Wire it onto your own tRPC instance:
 *
 * ```ts
 * const { publicProcedure } = initWebviewTrpc<RouterContext>();
 * const tracked = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, myRunner));
 * ```
 *
 * @param invocation - the tRPC middleware options for this call.
 * @param runner     - the consumer's telemetry scope adapter.
 */
export async function telemetryMiddlewareBody<TResult extends MiddlewareResultLike>(
    invocation: ProcedureInvocation<TResult>,
    runner: TelemetryRunner,
): Promise<TResult> {
    return runner.run(invocation, async (telemetry) => {
        const start = Date.now();
        const result = await invocation.next({
            ctx: { ...(invocation.ctx as Record<string, unknown>), telemetry },
        });
        telemetry.measurements.durationMs = Date.now() - start;

        const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
        if (aborted) {
            telemetry.properties.aborted = 'true';
            telemetry.properties.result = 'Canceled';
        }

        if (!result.ok && !aborted) {
            // Record the failure and let the RPC caller handle the error. This
            // block is skipped entirely for an aborted call: it is already
            // recorded as 'Canceled' above, and stamping `error` /
            // `errorMessage` on a cancellation would make it look like a
            // failure in telemetry (R766-C01).
            telemetry.properties.result = 'Failed';
            if (result.error?.name) {
                telemetry.properties.error = result.error.name;
            }
            if (result.error?.message) {
                telemetry.properties.errorMessage = result.error.message;
            }
        }

        return result;
    });
}
