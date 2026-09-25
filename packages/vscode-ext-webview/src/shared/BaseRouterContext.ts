/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Base router context shared by every tRPC procedure invocation. Consumers
 * extend this with their own application-specific properties (e.g. database
 * connection identifiers, view-specific data).
 *
 * The framework populates {@link BaseRouterContext.signal} per-operation. A
 * telemetry {@link TelemetryRunner} (when wired via `telemetryMiddlewareBody`)
 * contributes its own fields to the context — see the field docs below.
 * Application code is responsible for the rest.
 */
export interface BaseRouterContext {
    /**
     * Optional per-call telemetry bag with the minimal `properties` /
     * `measurements` shape.
     *
     * The telemetry middleware does **not** populate this slot itself: the
     * {@link TelemetryRunner} you wire chooses what to contribute to `ctx` (for
     * example an `IActionContext` under `ctx.actionContext`). This field remains
     * as a convenient, telemetry-library-agnostic place for a plain bag when a
     * runner opts to contribute one; richer integrations declare their own field
     * on their context type instead. See `telemetryMiddlewareBody` /
     * `TelemetryRunner` in `@microsoft/vscode-ext-webview/host`.
     */
    telemetry?: {
        properties: Record<string, string>;
        measurements: Record<string, number>;
    };

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
     *     // Option 1: Pass to APIs that accept AbortSignal (e.g. the DocumentDB driver)
     *     const cursor = collection.find(filter, { signal: ctx.signal });
     *     // Option 2: Check manually
     *     if (ctx.signal?.aborted) return;
     * })
     * ```
     */
    signal?: AbortSignal;
}
