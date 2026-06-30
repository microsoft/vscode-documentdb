/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for the framework-agnostic webview surface of
 * `@microsoft/vscode-ext-webview` (the `./webview` subpath).
 *
 * Browser-side transport with no React dependency. A consumer using a UI
 * framework other than React imports from here; the React hooks in `./react`
 * are built on top of this entry.
 */

export * from './webview';
