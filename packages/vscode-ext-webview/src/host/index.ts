/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host surface of `@microsoft/vscode-ext-webview` (the `./host` subpath).
 *
 * Extension-host (Node.js) code imports from here. It pulls in `vscode` and
 * Node APIs and must not be bundled into the webview. Reshaped across Phase C
 * to add `attachTrpc`, `openWebview`, and the middleware bodies / adapters.
 */

export {
    createCallerFactory,
    createMiddleware,
    publicProcedure,
    publicProcedureWithTelemetry,
    router,
    type AnyRouter,
    type WithTelemetry,
} from './trpc';
export { WebviewController, type WebviewControllerOptions, type WebviewSourceLayout } from './WebviewController';
