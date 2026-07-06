/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Base router context shared by every tRPC procedure invocation. Consumers
 * extend this with their own application-specific properties (e.g. database
 * connection identifiers, view-specific data).
 *
 * The framework populates {@link BaseRouterContext.signal} per-operation and
 * the telemetry middleware body (when wired) populates
 * {@link BaseRouterContext.telemetry}. Application code is responsible for the
 * rest.
 */
export interface BaseRouterContext {
    /**
     * Per-call telemetry bag, populated by the telemetry middleware body when
     * one is wired (see `telemetryMiddlewareBody` / `TelemetryRunner` in
     * `@microsoft/vscode-ext-webview/host`).
     *
     * The package does not dictate the telemetry context type: this slot holds
     * a minimal `properties` / `measurements` shape, and consumers typically
     * re-type it to their telemetry library's context (for example
     * `ITelemetryContext` from `@microsoft/vscode-azext-utils`) via an
     * intersection or a telemetry-typing helper they own.
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
