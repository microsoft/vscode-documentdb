/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Consumer-owned configuration for the webview integration layer.
 *
 * Every runtime value a consumer might want to customise (bundle layout,
 * dev-server host, telemetry namespace) lives here. Other files in this
 * folder import the relevant slice rather than declaring constants inline,
 * so a coding agent asked "where do I change the dev port?" or "where is
 * the telemetry namespace?" finds the answer in one place.
 *
 * Keep this file small: live values only, no commented-out templates.
 */

/**
 * Root namespace for every telemetry event emitted by this extension's
 * webview integration. Change this when forking the extension under a
 * different telemetry channel.
 */
const TELEMETRY_NAMESPACE = 'documentDB';

export const WEBVIEW_CONFIG = {
    telemetry: {
        /**
         * Prefix for tRPC procedure events. Event names follow
         * `${rpcEventPrefix}.${type}.${path}` (see appRouter.ts).
         */
        rpcEventPrefix: `${TELEMETRY_NAMESPACE}.rpc`,
        /**
         * Prefix for `reportEvent` calls from the webview. Event names follow
         * `${webviewEventPrefix}.${webviewName}.${eventName}`.
         */
        webviewEventPrefix: `${TELEMETRY_NAMESPACE}.webview.event`,
        /**
         * Prefix for `reportError` calls from the webview. Event names follow
         * `${webviewErrorPrefix}.${webviewName}`.
         */
        webviewErrorPrefix: `${TELEMETRY_NAMESPACE}.webview.error`,
    },
    /**
     * Layout describing where the extension's webview JavaScript lives on
     * disk. `bundled` is used when the extension runs from its webpack
     * output (production: `dist/views.js`). `dev` is used when running
     * from `tsc` output during development (`out/src/webviews/index.js`).
     * These paths are joined with `extensionPath` by the framework at
     * runtime.
     */
    bundle: {
        bundled: { dir: '', file: 'views.js' },
        dev: { dir: 'out/src/webviews', file: 'index.js' },
    },
    /**
     * URL of the local Vite/webpack dev server used when running the
     * extension in development mode.
     */
    devServerHost: 'http://localhost:18080',
} as const;
