/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Root tRPC router for the extension. Bundles each webview's router together
 * with a shared `commonRouter` exposing cross-webview procedures (telemetry
 * helpers, dialog helpers, survey hooks).
 *
 * The tRPC primitives (`publicProcedureWithTelemetry`, `WithTelemetry`, and
 * the re-exports of `publicProcedure` / `router`) live in `./trpc.ts`, a
 * leaf module that this file and every per-view router import from. Keeping
 * them in a separate module avoids a circular import: `appRouter.ts`
 * imports the per-view routers, so the per-view routers must not import
 * value bindings back from `appRouter.ts`.
 *
 * This file also defines the DocumentDB-flavoured `BaseRouterContext` used
 * across procedures.
 *
 * You can read more about tRPC here:
 * https://trpc.io/docs/quickstart
 */

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { type BaseRouterContext as FrameworkBaseRouterContext } from '@microsoft/vscode-ext-react-webview/server';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type API } from '../../DocumentDBExperiences';
import { openUrl } from '../../utils/openUrl';
import { openSurvey, promptAfterActionEventually } from '../../utils/survey';
import { UsageImpact } from '../../utils/surveyTypes';
import { collectionsViewRouter as collectionViewRouter } from '../documentdb/collectionView/collectionViewRouter';
import { documentsViewRouter as documentViewRouter } from '../documentdb/documentView/documentsViewRouter';
import { localQuickStartRouter } from '../documentdb/localQuickStart/localQuickStartRouter';
import { WEBVIEW_CONFIG } from './configuration';
import { publicProcedure, publicProcedureWithTelemetry, router, type WithTelemetry } from './trpc';

// Re-export tRPC primitives for backward compatibility with existing imports.
// Prefer importing directly from `./trpc` in new code.
export { publicProcedure, publicProcedureWithTelemetry, router };
export type { WithTelemetry };

/**
 * DocumentDB-flavoured router context. Extends the framework's
 * `BaseRouterContext` (from `@microsoft/vscode-ext-react-webview`, which
 * already declares `telemetry?` and `signal?`) with the DocumentDB-specific
 * fields every procedure needs. Inheriting `telemetry?` / `signal?` keeps
 * the context shape in lock step with the framework: if the framework adds
 * a field, it lands here automatically without an edit in this file.
 *
 * The `signal?` slot inherited from the framework is populated by
 * `WebviewController` when handling incoming tRPC messages. Each operation
 * receives its own `AbortController`; when the client sends an `'abort'`
 * (for queries/mutations) or `'subscription.stop'` (for subscriptions)
 * message, the controller calls `.abort()` on it. Router procedures can
 * use this signal to gracefully cancel long-running work:
 *
 * ```ts
 * .query(async ({ ctx }) => {
 *     const myCtx = ctx as WithTelemetry<RouterContext>;
 *     // Option 1: pass to APIs that accept AbortSignal (e.g. MongoDB driver)
 *     const cursor = collection.find(filter, { signal: myCtx.signal });
 *     // Option 2: check manually
 *     if (myCtx.signal?.aborted) return;
 * })
 * ```
 */
export type BaseRouterContext = FrameworkBaseRouterContext & {
    dbExperience: API;
    /**
     * Label used in telemetry event names to identify the source webview
     * (combined with `WEBVIEW_CONFIG.telemetry.webviewEventPrefix` to form
     * the final event name, e.g. `documentDB.webview.event.${webviewName}.${eventName}`).
     *
     * This is **not** the same as the registry key passed to the `WebviewControllerBase` constructor.
     */
    webviewName: string;
};

/**
 * eventName: string,
        properties?: Record<string, string>,
        measurements?: Record<string, number>
 */
const commonRouter = router({
    reportEvent: publicProcedure
        // This is the input schema of your procedure, two parameters, both strings
        .input(
            z.object({
                eventName: z.string(),
                properties: z.optional(z.record(z.string(), z.string())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
                measurements: z.optional(z.record(z.string(), z.number())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
            }),
        )
        // Here the procedure (query or mutation)
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as BaseRouterContext;

            void callWithTelemetryAndErrorHandling<void>(
                `${WEBVIEW_CONFIG.telemetry.webviewEventPrefix}.${myCtx.webviewName}.${input.eventName}`,
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = myCtx.dbExperience;
                    Object.assign(context.telemetry.properties, input.properties ?? {});
                    Object.assign(context.telemetry.measurements, input.measurements ?? {});
                },
            );
        }),
    reportError: publicProcedure
        // This is the input schema of your procedure, two parameters, both strings
        .input(
            z.object({
                message: z.string(),
                stack: z.string(),
                componentStack: z.optional(z.string()),
                properties: z.optional(z.record(z.string(), z.string())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
            }),
        )
        // Here the procedure (query or mutation)
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as BaseRouterContext;

            void callWithTelemetryAndErrorHandling<void>(
                `${WEBVIEW_CONFIG.telemetry.webviewErrorPrefix}.${myCtx.webviewName}`,
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = myCtx.dbExperience;

                    Object.assign(context.telemetry.properties, input.properties ?? {});

                    const newError = new Error(input.message);
                    // If it's a rendering error in the webview, swap the stack with the componentStack which is more helpful
                    newError.stack = input.componentStack ?? input.stack;
                    throw newError;
                },
            );
        }),
    displayErrorMessage: publicProcedure
        .input(
            z.object({
                message: z.string(),
                modal: z.boolean(),
                cause: z.string(),
            }),
        )
        .mutation(({ input }) => {
            let message = input.message;
            if (input.cause && !input.modal) {
                message += ` (${input.cause})`;
            }

            void vscode.window.showErrorMessage(message, {
                modal: input.modal,
                detail: input.modal ? input.cause : undefined, // The content of the 'detail' field is only shown when modal is true
            });
        }),
    surveyPing: publicProcedure
        .input(
            z.object({
                usageImpact: z.enum(UsageImpact),
            }),
        )
        .mutation(({ input }) => {
            void promptAfterActionEventually(input.usageImpact);
        }),
    surveyOpen: publicProcedure
        .input(
            z.object({
                triggerAction: z.string(), // Optional action that triggered the survey for telemetry
            }),
        )
        .mutation(({ input }) => {
            void openSurvey(input.triggerAction);
        }),
    openUrl: publicProcedure
        .input(
            z.object({
                url: z.string(), // URL string to open in default browser
            }),
        )
        .mutation(async ({ input }) => {
            await openUrl(input.url);
        }),
});

export const appRouter = router({
    common: commonRouter,
    mongoClusters: {
        documentView: documentViewRouter,
        collectionView: collectionViewRouter,
    },
    localQuickStart: localQuickStartRouter,
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
