/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Root tRPC router for the extension. Bundles each webview's router together
 * with a shared `commonRouter` exposing cross-webview procedures (telemetry
 * helpers, dialog helpers, survey hooks).
 *
 * This file is also the DocumentDB-flavoured adapter on top of the tRPC
 * primitives exported by `@microsoft/vscode-ext-react-webview`:
 *
 *   - `router` and `publicProcedure` are re-exported below for per-view
 *     routers to import from a single location.
 *   - `publicProcedureWithTelemetry` wraps `publicProcedure` with a
 *     middleware that forwards each call to the VS Code Azure telemetry
 *     pipeline using the `documentDB.rpc.*` event-name namespace.
 *   - `WithTelemetry<T>` re-types the `telemetry` slot on `ctx` to the
 *     richer `ITelemetryContext` so procedure code can access
 *     `suppressAll`, `suppressIfSuccessful`, etc. without ad-hoc casts.
 *
 * You can read more about tRPC here:
 * https://trpc.io/docs/quickstart
 */

import { callWithTelemetryAndErrorHandling, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import {
    createMiddleware,
    publicProcedure,
    router,
    type BaseRouterContext as FrameworkBaseRouterContext,
} from '@microsoft/vscode-ext-react-webview/server';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type API } from '../../DocumentDBExperiences';
import { openUrl } from '../../utils/openUrl';
import { openSurvey, promptAfterActionEventually } from '../../utils/survey';
import { UsageImpact } from '../../utils/surveyTypes';
import { collectionsViewRouter as collectionViewRouter } from '../documentdb/collectionView/collectionViewRouter';
import { documentsViewRouter as documentViewRouter } from '../documentdb/documentView/documentsViewRouter';
import { WEBVIEW_CONFIG } from './configuration';

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
        `${WEBVIEW_CONFIG.telemetry.rpcEventPrefix}.${opts.type}.${opts.path}`,
        async (context) => {
            context.errorHandling.suppressDisplay = true;

            const result = await opts.next({
                ctx: {
                    ...opts.ctx,
                    telemetry: context.telemetry,
                },
            });

            // Check if the operation was aborted via AbortSignal
            const signal = (opts.ctx as FrameworkBaseRouterContext).signal;
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

// Re-export the unprotected procedure builder and router factory so per-view
// routers have a single import location for everything they need to declare
// tRPC procedures.
export { publicProcedure, router };

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
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
