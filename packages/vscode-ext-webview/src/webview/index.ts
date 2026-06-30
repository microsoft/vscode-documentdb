/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Framework-agnostic webview surface (the `./webview` subpath).
 *
 * This is the browser-side transport with no React dependency: the tRPC links
 * (`vscodeLink`, `errorLink`) plus the wire-protocol message types. React hooks
 * live in `./react` and build on top of this. Reshaped across Phase C to add
 * `connectTrpc` and `createEventChannel`.
 */

export { errorLink, type ErrorHandler } from './errorLink';
export { vscodeLink, type VSCodeLinkOptions } from './vscodeLink';
export { type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from '../shared/wireProtocol';
