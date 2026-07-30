/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Telemetry middleware body and its adapter interface (`TelemetryRunner`).
 *
 * The body is a thin, dependency-free delegator: it resolves the telemetry
 * event id for a call and hands control to the consumer's
 * {@link TelemetryRunner}, which owns the integration-specific scope (for
 * example wrapping the call in `callWithTelemetryAndErrorHandling` from
 * `@microsoft/vscode-azext-utils`, dispatching to Application Insights, and
 * classifying the outcome).
 *
 * The runner also chooses **what to contribute to the procedure context**: it
 * calls `invoke(enrichment)` with an object of its own shape, and the body
 * merges that object into `ctx` via tRPC's `next({ ctx })`. Procedures then read
 * those fields directly (for example `ctx.actionContext`). The body itself does
 * **not** stamp duration or outcome — the runner's telemetry backend typically
 * records duration already (e.g. `callWithTelemetryAndErrorHandling` measures
 * it), and the runner receives the procedure result so it can classify success,
 * failure, or cancellation however it needs.
 *
 * This is the instance-agnostic telemetry path: the body is wired onto the
 * consumer's own tRPC instance and the runner is a plain object, so neither is
 * tied to a particular `initWebviewTrpc` call.
 */

import { type MiddlewareResultLike, type ProcedureInvocation } from './types';

/**
 * A minimal telemetry bag (`properties` / `measurements`). Exported as a
 * convenience for consumers whose {@link TelemetryRunner} contributes a plain
 * bag to the context; richer integrations contribute their own shape (for
 * example an `IActionContext`) instead.
 */
export interface ProcedureTelemetry {
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

/**
 * Consumer-supplied adapter that runs a procedure inside an integration-specific
 * telemetry scope.
 *
 * The runner:
 *
 *  1. opens whatever telemetry scope it needs (an action context, an
 *     OpenTelemetry span, a plain `console.time`, …), keyed by `eventId`;
 *  2. calls `invoke(enrichment)` exactly once with the fields it wants to push
 *     into the procedure `ctx` — the body merges them via `next({ ctx })`;
 *  3. inspects the returned {@link MiddlewareResultLike} (and the invocation's
 *     `AbortSignal`, via `getInvocationSignal(invocation.ctx)`) to record
 *     success, failure, or cancellation;
 *  4. returns the result untouched so the rest of the middleware chain and the
 *     caller receive it.
 *
 * `TEnrichment` is the precise shape the runner contributes to `ctx` — typically
 * a record with one or two well-known keys (for example `{ actionContext }`).
 * Procedures that need those fields declare them on their context type.
 *
 * @example A runner over `@microsoft/vscode-azext-utils`
 * ```ts
 * const runner: TelemetryRunner<{ actionContext: IActionContext }> = {
 *   async run(eventId, invocation, invoke) {
 *     const result = await callWithTelemetryAndErrorHandling(eventId, async (actionContext) => {
 *       actionContext.errorHandling.suppressDisplay = true;
 *       const middlewareResult = await invoke({ actionContext });
 *       const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
 *       if (aborted) actionContext.telemetry.properties.result = 'Canceled';
 *       else if (!middlewareResult.ok && middlewareResult.error) {
 *         actionContext.telemetry.properties.result = 'Failed';
 *         actionContext.telemetry.properties.error = middlewareResult.error.name ?? '';
 *       }
 *       return middlewareResult;
 *     });
 *     if (!result) throw new Error(`No result for ${eventId}`);
 *     return result;
 *   },
 * };
 * ```
 */
export interface TelemetryRunner<TEnrichment extends object> {
    run<TResult extends MiddlewareResultLike>(
        eventId: string,
        invocation: ProcedureInvocation<TResult>,
        invoke: (enrichment: TEnrichment) => Promise<TResult>,
    ): Promise<TResult>;
}

/** Options for {@link telemetryMiddlewareBody}. */
export interface TelemetryMiddlewareOptions {
    /**
     * Builds the telemetry event id from the invocation. Defaults to
     * `"${type}.${path}"`. Override to add a namespace prefix
     * (for example `myExt.rpc.${type}.${path}`) so event names stay consistent
     * and greppable in one place.
     */
    buildEventId?: (invocation: ProcedureInvocation) => string;
}

/** Default event id: `"${type}.${path}"` (for example `query.collectionView.find`). */
function defaultBuildEventId({ type, path }: ProcedureInvocation): string {
    return `${type}.${path}`;
}

/**
 * Build the body of a telemetry middleware bound to the given runner.
 *
 * The returned function is a plain tRPC middleware — wire it directly onto your
 * own tRPC instance:
 *
 * ```ts
 * const { publicProcedure } = initWebviewTrpc<RouterContext>();
 * const tracked = publicProcedure.use(
 *   telemetryMiddlewareBody(myRunner, { buildEventId: ({ type, path }) => `myExt.rpc.${type}.${path}` }),
 * );
 * ```
 *
 * The body resolves the event id, delegates to `runner.run`, and returns the
 * procedure's result unchanged. All timing and outcome classification live in
 * the runner (see {@link TelemetryRunner}).
 *
 * @param runner  - the consumer's telemetry scope adapter.
 * @param options - optional event-id policy.
 */
export function telemetryMiddlewareBody<TEnrichment extends object>(
    runner: TelemetryRunner<TEnrichment>,
    options: TelemetryMiddlewareOptions = {},
) {
    const buildEventId = options.buildEventId ?? defaultBuildEventId;

    return async <TResult extends MiddlewareResultLike>(invocation: ProcedureInvocation<TResult>): Promise<TResult> => {
        const eventId = buildEventId(invocation);

        let captured: TResult | undefined;
        await runner.run(eventId, invocation, async (enrichment) => {
            const result = await invocation.next({ ctx: enrichment });
            captured = result;
            return result;
        });

        // The runner contract guarantees `invoke` ran exactly once; if the
        // procedure (or the runner) threw, control never reaches here.
        return captured as TResult;
    };
}
