/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for the React surface of `@microsoft/vscode-ext-webview` (the
 * `./react` subpath).
 *
 * The only entry that imports React. Provides `useTrpcClient`,
 * `useConfiguration`, and `WithWebviewContext` for React webviews on top of the
 * framework-agnostic `./webview` transport.
 */

export * from './react';
