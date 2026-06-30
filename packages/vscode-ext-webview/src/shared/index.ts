/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared, side-agnostic surface of `@microsoft/vscode-ext-webview`.
 *
 * Everything re-exported here is safe to import from either the extension host
 * or the webview: there are no `vscode` and no React imports anywhere in the
 * `shared/` subtree. The host (`./host`) and webview (`./webview`) entries
 * build on top of these primitives.
 */

export { type BaseRouterContext } from './BaseRouterContext';
export { initWebviewTrpc, publicProcedure, router, type WebviewTrpc } from './initWebviewTrpc';
export { TypedEventSink, type DiscriminatedEvent, type EventOfType, type UntypedEventEmitter } from './TypedEventSink';
export {
    type StopOperation,
    type VsCodeLinkRequestMessage,
    type VsCodeLinkResponseMessage,
} from './wireProtocol';
