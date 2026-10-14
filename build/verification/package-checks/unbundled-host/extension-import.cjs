/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CommonJS extension that loads `/host` with a dynamic `import()` (asynchronous, unlike `require`)
// and the shared entry, which does not import `vscode`, with `require`.

'use strict';

const fs = require('node:fs');
const vscode = require('vscode');
const { exercise } = require('./exercise.cjs');

/** @param {string} step */
function trace(step) {
    fs.appendFileSync(process.env.DOCUMENTDB_HOST_PROBE_TRACE ?? '', `${step}\n`);
}

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
    const result = await exercise({
        vscode,
        context,
        trace,
        load: async () => {
            trace("import('@microsoft/vscode-ext-webview/host')");
            const host = await import('@microsoft/vscode-ext-webview/host');
            trace("require('@microsoft/vscode-ext-webview')");
            const shared = require('@microsoft/vscode-ext-webview');
            return { host, shared, resolved: require.resolve('@microsoft/vscode-ext-webview/host') };
        },
    });
    return { result };
}

module.exports = { activate };
