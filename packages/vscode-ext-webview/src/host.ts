/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point for the extension-host surface of `@microsoft/vscode-ext-webview`
 * (the `./host` subpath).
 *
 * Imported from the extension's Node.js code (controllers, routers, telemetry
 * adapters). Pulls in Node / VS Code APIs (`fs`, `path`, `vscode`) and must not
 * be bundled into the webview's browser-side code.
 */

export * from './host';
