/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vite counterpart of `monaco-editor-webpack-plugin` for the webview build.
//
// What the webpack plugin did (with `languages` set and no `features` option), and how this keeps it:
//
// 1. Features. It wrapped `monaco-editor/esm/vs/editor/editor.api.js` so that every import of it
//    first imported ALL editor features listed in `monaco-editor/esm/metadata.js` (find widget,
//    folding, hover, suggest, context menu, bracket matching, ...). `editor.api` alone has none
//    of them. Here, imports of `editor.api` from outside `monaco-editor` resolve to a virtual
//    wrapper module with the same imports, in the same order. Imports inside `monaco-editor`
//    still reach the real module, so the language contributions' own `editor.api` import is not
//    a cycle through the wrapper.
// 2. Languages. The wrapper imports each language contribution after `editor.api`. Only `json`
//    is kept: no `sql` Monaco language is used anywhere in `src/` (the webpack build listed it).
//    The query editor's JavaScript tokenizer is loaded on demand by `registerLanguage.ts`.
// 3. Workers. `self.MonacoEnvironment.getWorkerUrl` is set before `editor.api` evaluates. Worker
//    scripts are separate files. The page (`vscode-webview://…`) cannot construct a Worker from
//    the resource origin, so `getWorkerUrl` returns a same-origin Blob URL whose only statement
//    imports the absolute worker URL. Monaco 0.52 constructs every `getWorkerUrl` worker with
//    `type: 'module'`, so the Blob must use `import`, not `importScripts` (which throws in a
//    module worker). This is the code webpack emitted: the plugin's `typeof import.meta` check
//    is constant-folded in our ESM output to its `import "<url>"` branch. The cross-origin
//    module fetch needs CORS; VS Code's webview service worker answers resource requests with
//    `Access-Control-Allow-Origin: *` and serves blob-worker clients (microsoft/vscode#244143),
//    as it does for `views.js` and every lazy chunk, which are module fetches too.
//    Production workers are built as classic `iife` scripts: no `import`/`export`, so they run
//    as a module worker today and would also run under a classic `importScripts` trampoline.
//    Under `vite serve` the worker is the unbundled ES module from the dev server; the same
//    trampoline imports it (the dev server sends CORS headers for the webview origin).
//    Rejected: `?worker&inline` (base64 Blob in the chunk, roughly +870 KB, and its fallback
//    is a `data:` worker the CSP forbids) and `new Worker(<resource URL>)` (browsers refuse
//    cross-origin worker scripts whatever the CORS headers).

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const API_SPECIFIER = /^monaco-editor\/esm\/vs\/editor\/editor\.api(?:\.js)?$/;
const ENVIRONMENT_SPECIFIER = 'virtual:documentdb-monaco/environment';

/** Prefix of the module IDs this plugin creates; the chunking config keeps them with Monaco. */
export const monacoVirtualModulePrefix = '\0documentdb-monaco/';
const WRAPPER_ID = `${monacoVirtualModulePrefix}editor-api`;
const ENVIRONMENT_ID = `${monacoVirtualModulePrefix}environment`;

const toSpecifier = (entry) => `monaco-editor/esm/${entry}.js`;

/**
 * @param {{ languages: string[] }} options Monaco language labels to bundle (contribution and worker).
 * @returns {Promise<{ plugin: import('vite').Plugin, optimizeDepsInclude: string[] }>}
 */
export async function monacoEditor({ languages }) {
    const metadata = await import(pathToFileURL(require.resolve('monaco-editor/esm/metadata.js')).href);
    const featureSpecifiers = metadata.features.flatMap((feature) => [].concat(feature.entry)).map(toSpecifier);
    const selected = languages.map((label) => {
        const language = metadata.languages.find((candidate) => candidate.label === label);
        if (!language) {
            throw new Error(`monaco-editor has no language '${label}'`);
        }
        return language;
    });
    const contributionSpecifiers = selected.flatMap((language) => [].concat(language.entry)).map(toSpecifier);
    const workers = [
        { label: 'editorWorkerService', specifier: toSpecifier('vs/editor/editor.worker') },
        ...selected
            .filter((language) => language.worker)
            .map((language) => ({ label: language.label, specifier: toSpecifier(language.worker.entry) })),
    ];

    const wrapperSource = [
        `import ${JSON.stringify(ENVIRONMENT_SPECIFIER)};`,
        ...featureSpecifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
        `export * from ${JSON.stringify(toSpecifier('vs/editor/editor.api'))};`,
        ...contributionSpecifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
    ].join('\n');

    const environmentSource = [
        ...workers.map(
            ({ specifier }, index) => `import worker${index} from ${JSON.stringify(`${specifier}?worker&url`)};`,
        ),
        `const workerUrls = { ${workers.map(({ label }, index) => `${JSON.stringify(label)}: worker${index}`).join(', ')} };`,
        'self.MonacoEnvironment = {',
        '    getWorkerUrl(_moduleId, label) {',
        '        const url = new URL(workerUrls[label] ?? workerUrls.editorWorkerService, import.meta.url).href;',
        "        const source = '/*' + label + '*/import ' + JSON.stringify(url) + ';';",
        "        return URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));",
        '    },',
        '};',
    ].join('\n');

    /** @type {import('vite').Plugin} */
    const plugin = {
        name: 'documentdb:monaco-editor',
        enforce: 'pre',
        resolveId(source, importer) {
            if (source === ENVIRONMENT_SPECIFIER) {
                return ENVIRONMENT_ID;
            }
            if (
                API_SPECIFIER.test(source) &&
                importer !== WRAPPER_ID &&
                !importer?.replace(/\\/g, '/').includes('/node_modules/monaco-editor/')
            ) {
                return WRAPPER_ID;
            }
            return null;
        },
        load(id) {
            if (id === WRAPPER_ID) {
                return wrapperSource;
            }
            if (id === ENVIRONMENT_ID) {
                return environmentSource;
            }
            return null;
        },
    };

    return {
        plugin,
        // Dev server only: pre-bundle every module the wrapper imports in one optimizer run, so
        // opening the first editor neither re-optimizes and reloads nor splits Monaco in two.
        optimizeDepsInclude: [
            ...featureSpecifiers,
            toSpecifier('vs/editor/editor.api'),
            ...contributionSpecifiers,
            toSpecifier('vs/basic-languages/javascript/javascript'),
        ],
    };
}
