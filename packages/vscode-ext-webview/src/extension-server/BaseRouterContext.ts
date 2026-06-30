/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TelemetryContext } from './trpc';

/**
 * Base router context shared by every tRPC procedure invocation. Consumers
 * extend this with their own application-specific properties (e.g. database
 * connection identifiers, view-specific data).
 *
 * The framework populates {@link BaseRouterContext.signal} per-operation and
 * {@link BaseRouterContext.telemetry} (when the corresponding middleware is
 * used). Application code is responsible for the rest.
 */
export interface BaseRouterContext {
    /**
     * Telemetry context populated by the telemetry middleware (e.g.
     * `publicProcedureWithTelemetry` or your own custom middleware).
     * Available when using a procedure that applies a telemetry middleware.
     */
    telemetry?: TelemetryContext;

    /**
     * AbortSignal used to cancel in-flight operations (queries, mutations, and
     * subscriptions).
     *
     * Populated by the framework's `WebviewController` when handling incoming
     * tRPC messages. Each operation receives its own `AbortController`; when
     * the client sends an `'abort'` (for queries/mutations) or
     * `'subscription.stop'` (for subscriptions) message, the controller calls
     * `.abort()` on it.
     *
     * Router procedures can use this signal to gracefully cancel long-running
     * work:
     *
     * ```ts
     * .query(async ({ ctx }) => {
     *     // Option 1: Pass to APIs that accept AbortSignal (e.g. MongoDB driver)
     *     const cursor = collection.find(filter, { signal: ctx.signal });
     *     // Option 2: Check manually
     *     if (ctx.signal?.aborted) return;
     * })
     * ```
     */
    signal?: AbortSignal;
}
