/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * React surface (the `./react` subpath).
 *
 * The only entry that imports React. Provides the hooks and context wiring a
 * React webview needs (`useTrpcClient`, `useConfiguration`, `WithWebviewContext`)
 * on top of the framework-agnostic `./webview` transport. Reshaped in Phase C to
 * split `useRpcEvents` out of `useTrpcClient`.
 */

export { type AnyRouter } from '@trpc/server';
export { type ObserverErrorContext, type ObserverErrorHandler, type ObserverErrorPhase } from '../webview/events.js';
export { useConfiguration } from './useConfiguration.js';
export { useRpcEvents } from './useRpcEvents.js';
export { useTrpcClient, type TrpcClient } from './useTrpcClient.js';
export { WebviewContext, WithWebviewContext, type WebviewContextValue, type WebviewState } from './WebviewContext.js';
