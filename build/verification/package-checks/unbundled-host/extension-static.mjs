/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `"type": "module"` extension with static imports, the usual form for an ESM extension.

import * as shared from '@microsoft/vscode-ext-webview';
import * as host from '@microsoft/vscode-ext-webview/host';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { exercise } from './exercise.mjs';

/** @param {string} step */
function trace(step) {
    appendFileSync(process.env.DOCUMENTDB_HOST_PROBE_TRACE ?? '', `${step}\n`);
}

trace('module evaluated with static imports');

/** @param {import('vscode').ExtensionContext} context */
export async function activate(context) {
    const result = await exercise({
        vscode,
        context,
        trace,
        load: async () => ({
            host,
            shared,
            resolved: fileURLToPath(import.meta.resolve('@microsoft/vscode-ext-webview/host')),
        }),
    });
    return { result };
}
