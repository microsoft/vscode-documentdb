/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `"type": "module"` extension with a dynamic `import()`.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { exercise } from './exercise.mjs';

/** @param {string} step */
function trace(step) {
    appendFileSync(process.env.DOCUMENTDB_HOST_PROBE_TRACE ?? '', `${step}\n`);
}

/** @param {import('vscode').ExtensionContext} context */
export async function activate(context) {
    const result = await exercise({
        vscode,
        context,
        trace,
        load: async () => {
            trace("import('@microsoft/vscode-ext-webview/host')");
            const host = await import('@microsoft/vscode-ext-webview/host');
            trace("import('@microsoft/vscode-ext-webview')");
            const shared = await import('@microsoft/vscode-ext-webview');
            return {
                host,
                shared,
                resolved: fileURLToPath(import.meta.resolve('@microsoft/vscode-ext-webview/host')),
            };
        },
    });
    return { result };
}
