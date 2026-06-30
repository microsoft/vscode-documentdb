/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host surface of `@microsoft/vscode-ext-webview` (the `./host` subpath).
 *
 * Extension-host (Node.js) code imports from here. It pulls in `vscode` and
 * Node APIs and must not be bundled into the webview.
 *
 * The tRPC builders (`initWebviewTrpc`, `router`, `publicProcedure`) live in the
 * shared `.` entry; this entry owns the panel facade
 * ({@link WebviewController}) and the instance-agnostic middleware bodies +
 * adapters.
 */

export { type AnyRouter } from '@trpc/server';
export { attachTrpc, type ActiveSubscription, type AttachTrpcResult, type WebviewCallerFactory } from './attachTrpc';
export {
    consoleProcedureLogger,
    loggingMiddlewareBody,
    telemetryMiddlewareBody,
    type MiddlewareResultLike,
    type ProcedureErrorLike,
    type ProcedureInvocation,
    type ProcedureLogEntry,
    type ProcedureLogger,
    type ProcedureTelemetry,
    type ProcedureType,
    type TelemetryRunner,
} from './middleware';
export { openWebview } from './openWebview';
export { WebviewController, type WebviewControllerOptions, type WebviewSourceLayout } from './WebviewController';
