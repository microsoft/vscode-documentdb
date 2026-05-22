/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for the extension-host (server) surface of
 * `@microsoft/vscode-webview-api`.
 *
 * Imported as `@microsoft/vscode-webview-api/server` from the extension's
 * Node.js code (controllers, routers, telemetry middleware). Pulls in
 * Node / VS Code APIs (`fs`, `path`, `vscode`) and must not be bundled into
 * the webview's browser-side code.
 */

export * from './extension-server';
