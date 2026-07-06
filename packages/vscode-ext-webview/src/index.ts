/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared entry point (`.`) for `@microsoft/vscode-ext-webview`.
 *
 * This is the side-agnostic surface: wire-protocol message types,
 * `TypedEventSink`, and `BaseRouterContext`. It imports neither `vscode` nor
 * React, so it is safe to import from either side of the transport.
 *
 * Extension-host code imports from the `./host` subpath; webview code imports
 * from `./webview` (framework-agnostic) or `./react` (React hooks).
 */

export * from './shared/index';
