/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev server (`vite serve`) entry for the webview.
//
// `WebviewController` (extension in development mode, `DEVSERVER` set) boots the webview with
// `import { render } from "http://localhost:18080/views.js"` from a nonce'd inline module script.
// This plugin serves `/views.js` as a tiny module that
//   1. imports the React Refresh preamble from its own dev-server URL. plugin-react normally
//      injects the preamble into `index.html`, which this extension does not have, and an inline
//      script would need the template's nonce. As a module from the dev server origin it is
//      allowed by the development CSP's `script-src`. It must evaluate before any refreshed
//      module, which a first import in `/views.js` guarantees;
//   2. re-exports the real entry, so `render` is the named export the template imports.
// Production builds never load this plugin (`apply: 'serve'`).

import react from '@vitejs/plugin-react';

const PREAMBLE_PATH = '/@documentdb/react-refresh-preamble.js';

/**
 * @param {{ entry: string, isAllowedOrigin: (origin: string) => boolean }} options `entry` is the
 *   root-relative URL of the webview entry module.
 * @returns {import('vite').Plugin}
 */
export function webviewDevEntry({ entry, isAllowedOrigin }) {
    const modules = {
        '/views.js': [`import ${JSON.stringify(PREAMBLE_PATH)};`, `export * from ${JSON.stringify(entry)};`].join('\n'),
        [PREAMBLE_PATH]: react.preambleCode.replace('__BASE__', '/'),
    };

    return {
        name: 'documentdb:webview-dev-entry',
        apply: 'serve',
        configureServer(server) {
            // Runs before Vite's own middlewares (including CORS), so it answers CORS itself.
            server.middlewares.use((request, response, next) => {
                const pathname = request.url?.split('?')[0];
                const body = pathname === undefined ? undefined : modules[pathname];
                if (body === undefined) {
                    next();
                    return;
                }
                const origin = request.headers.origin;
                if (origin && isAllowedOrigin(origin)) {
                    response.setHeader('Access-Control-Allow-Origin', origin);
                    response.setHeader('Vary', 'Origin');
                }
                response.setHeader('Content-Type', 'text/javascript');
                response.setHeader('Cache-Control', 'no-store');
                response.end(body);
            });
        },
    };
}
