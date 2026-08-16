/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test and harness utilities for `@microsoft/vscode-ext-webview`.
 *
 * Everything here is for driving a webview **without** an extension host: unit
 * and component tests, and the browser-based visual harness. Nothing in a
 * production webview should import from this entry.
 */

export * from './harness/index';
