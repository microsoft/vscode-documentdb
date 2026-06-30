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

export { useConfiguration } from './useConfiguration';
export { useRpcEvents } from './useRpcEvents';
export { useTrpcClient, type TrpcClient } from './useTrpcClient';
export { WebviewContext, WithWebviewContext, type WebviewContextValue, type WebviewState } from './WebviewContext';
