/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vite build of the webviews (`src/webviews/index.tsx` -> `dist/views.js` + lazy chunks).
// Runs next to `webpack.config.views.js` until the Stage 4 flip; see
// docs/ai-and-plans/modernization/build-and-test-stack.md (Stage 4).
//
//   npm run vite-prod-wv    production build, writes build/verification/reports/views.json
//   npm run vite-dev-wv     unminified build with source maps, no report
//   npm run vite-serve-wv   dev server on http://localhost:18080 (WebviewController's default)

import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import { bundleReport } from './build/vite/bundle-report.mjs'; // eslint-disable-line import/no-internal-modules
import { inlineCss } from './build/vite/inline-css.mjs'; // eslint-disable-line import/no-internal-modules
import { monacoEditor, monacoVirtualModulePrefix } from './build/vite/monaco.mjs'; // eslint-disable-line import/no-internal-modules
import { webviewDevEntry } from './build/vite/webview-dev-entry.mjs'; // eslint-disable-line import/no-internal-modules

const require = createRequire(import.meta.url);
const root = import.meta.dirname;
const entry = 'src/webviews/index.tsx';

// Same pin as webpack.config.views.js: one `bson` if a view ever imports it (none does today; L1
// allows zero per view graph and rejects two), resolved to bson's browser entry.
const bsonBrowserEntry = path.join(path.dirname(require.resolve('bson')), 'bson.mjs');
if (!fs.existsSync(bsonBrowserEntry)) {
    throw new Error(`bson browser entry not found at ${bsonBrowserEntry}; update the bson alias`);
}

// Dev server origin. Must equal WebviewController's DEFAULT_DEV_SERVER_HOST: the development CSP
// allows exactly this origin, so every URL the dev server hands out has to use it.
const devServerOrigin = 'http://localhost:18080';
const allowedDevOrigins = [
    /^vscode-webview:\/\/[^/]+$/,
    // Vite's default CORS allowance: pages served from the local machine.
    /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/,
];
const isAllowedDevOrigin = (origin) => allowedDevOrigins.some((pattern) => pattern.test(origin));

const inPackages = (...packages) => {
    const pattern = new RegExp(`[\\\\/]node_modules[\\\\/](?:${packages.join('|')})[\\\\/]`);
    return (id) => pattern.test(id);
};

export default defineConfig(async ({ command, mode }) => {
    const isServe = command === 'serve';
    const isProduction = command === 'build' && mode === 'production';
    // Monaco: the features webpack's MonacoWebpackPlugin injected, the `json` language, and the
    // worker trampoline. Rationale in build/vite/monaco.mjs.
    const monaco = await monacoEditor({ languages: ['json'] });

    return {
        root,
        // Chunk-relative asset and preload URLs: Vite resolves them at runtime against
        // `import.meta.url`, which is the `asWebviewUri` resource URL of the chunk. A root-relative
        // base would resolve against the `vscode-webview://` document and fail.
        base: './',
        // `src/webviews/static` only held a `.gitkeep` that webpack copied to `dist/static/`; nothing
        // references it, so the Vite build has no public directory.
        publicDir: false,
        // `vite build --mode development` would still set NODE_ENV to production; match webpack's
        // modes, which `src/webviews/index.tsx` relies on for dead-code elimination.
        define: isServe ? {} : { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
        clearScreen: false,
        resolve: {
            alias: [{ find: /^bson$/, replacement: bsonBrowserEntry }],
        },
        plugins: [
            monaco.plugin,
            react(),
            webviewDevEntry({ entry: `/${entry}`, isAllowedOrigin: isAllowedDevOrigin }),
            inlineCss(),
            isProduction && bundleReport({ outFile: 'build/verification/reports/views.json' }),
        ],
        // Monaco workers: one classic script per worker in builds (see build/vite/monaco.mjs). The
        // dev server serves workers unbundled, which needs ES module workers.
        worker: {
            format: isServe ? 'es' : 'iife',
        },
        build: {
            outDir: 'dist',
            // The extension host build writes to the same directory.
            emptyOutDir: false,
            // Flat output next to views.js, like the webpack build.
            assetsDir: '',
            // Never inline assets: the CSP's `font-src` does not allow `data:`, so the codicon font
            // has to stay a file.
            assetsInlineLimit: 0,
            // One stylesheet, inlined into views.js by build/vite/inline-css.mjs. The webview HTML has
            // no <link rel="stylesheet">, and per-chunk CSS would add preload references to it.
            cssCodeSplit: false,
            target: 'es2023',
            minify: isProduction,
            sourcemap: !isProduction,
            reportCompressedSize: false,
            // Monaco alone is about 4 MB; sizes are tracked by the bundle report and L1 instead.
            chunkSizeWarningLimit: 8192,
            rolldownOptions: {
                input: path.resolve(root, entry),
                // Keep the entry's exports: the webview HTML imports `render` by name. Vite's app
                // default (`false`) would drop it (Cosmos DB #3037: every panel went blank).
                preserveEntrySignatures: 'strict',
                output: {
                    format: 'es',
                    // The name WebviewController loads.
                    entryFileNames: 'views.js',
                    chunkFileNames: '[name]-[hash].js',
                    assetFileNames: '[name]-[hash][extname]',
                    // Vite drops legal comments when minifying; webpack kept them (in *.LICENSE.txt
                    // files). Keep them inline.
                    comments: { legal: true },
                    // Not `keepNames`: swc's `keepClassNames` never reached production, because
                    // webpack's terser pass mangled class names afterwards (1,456 one- or two-letter
                    // class names in the webpack views.js). Keeping names would add about 460 KB.
                    keepNames: false,
                    // Named vendor chunks (`codeSplitting.groups`, which replaces the deprecated
                    // `manualChunks`/`advancedChunks` in Rolldown 1.0). The entry statically loads
                    // React and Fluent UI; Monaco and SlickGrid stay behind the lazy view chunks that
                    // import them. A catch-all vendor group is deliberately absent: a group shared by
                    // the entry and a lazy view would hoist the view's dependencies into the entry's
                    // static graph. Everything else is chunked automatically per view.
                    codeSplitting: {
                        // Rolldown also moves every not-yet-captured dependency of a group's modules
                        // into that group (`includeDependenciesRecursively`, kept on to avoid circular
                        // chunks). Groups are therefore captured from the most shared to the least
                        // shared: otherwise `monaco` would absorb React and Vite's preload helper,
                        // which the entry also needs, and the entry would statically import Monaco.
                        groups: [
                            { name: 'preload-helper', test: /^\0vite\/preload-helper/, priority: 50 },
                            { name: 'react', test: inPackages('react', 'react-dom', 'scheduler'), priority: 40 },
                            { name: 'fluentui', test: inPackages('@fluentui', '@griffel'), priority: 30 },
                            {
                                name: 'slickgrid',
                                test: inPackages('slickgrid-react', '@slickgrid-universal'),
                                priority: 20,
                            },
                            {
                                name: 'monaco',
                                test: (id) =>
                                    id.startsWith(monacoVirtualModulePrefix) ||
                                    inPackages('monaco-editor', '@monaco-editor')(id),
                                priority: 10,
                            },
                        ],
                    },
                },
            },
        },
        optimizeDeps: {
            // Pre-bundled when the dev server starts, so the first panel does not trigger a
            // re-optimization and reload.
            include: [
                '@fluentui/react-components',
                '@fluentui/react-icons',
                '@griffel/react',
                '@griffel/core',
                'react',
                'react-dom',
                'react-dom/client',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                '@monaco-editor/react',
                'slickgrid-react',
                ...monaco.optimizeDepsInclude,
            ],
        },
        server: {
            host: '127.0.0.1',
            port: 18080,
            strictPort: true,
            // Absolute asset and worker URLs on the origin the development CSP allows.
            origin: devServerOrigin,
            // The webview (`vscode-webview://…`) and its blob workers fetch modules cross-origin.
            cors: { origin: allowedDevOrigins },
            warmup: {
                clientFiles: [`./${entry}`, './src/webviews/**/*.tsx'],
            },
        },
    };
});
