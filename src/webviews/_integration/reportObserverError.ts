/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * R766-N05: DocumentDB's opt-in sink for RPC event-channel observer errors.
 *
 * The package (`createEventChannel` / `connectTrpc`) always **isolates** a
 * throwing `events.onSuccess` / `onError` / `onAborted` handler so it cannot
 * break the tRPC call it was only observing, and routes the isolated error to an
 * `onObserverError` sink that defaults to `console.error`. The all-in happy path
 * deliberately does **not** wire anything beyond that default (it would emit
 * events a generic consumer may not want).
 *
 * DocumentDB opts in for itself: this sink keeps the structured `console.error`
 * (path + phase) and additionally elevates the error to the webview's **global
 * error stream** via the `reportError()` global. That gives the "general
 * observability" of the browser error channel — devtools "Uncaught" plus any
 * `window` `error` listener / error-monitoring — while staying safe: it never
 * re-enters the tRPC channel, so a throwing observer cannot cause a report loop.
 */

import { type ObserverErrorHandler } from '@microsoft/vscode-ext-webview/react';

/**
 * Passed to `WithWebviewContext`'s `onObserverError` so DocumentDB webviews
 * surface event-observer failures instead of only isolating them.
 */
export const reportObserverError: ObserverErrorHandler = (error, { info, phase }) => {
    const err = error instanceof Error ? error : new Error(String(error));

    // Structured, always-visible context in the webview devtools console.
    console.error(`[DocumentDB] an RPC event observer threw during '${phase}' of '${info.path}'`, err);

    // Elevate to the webview's global error stream via the DOM `reportError()`
    // global so global error monitoring picks it up too. Guarded because not
    // every runtime exposes it (e.g. tests); the console line above is the floor.
    if (typeof globalThis.reportError === 'function') {
        globalThis.reportError(err);
    }
};
