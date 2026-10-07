/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// `--extensionTestsPath` entry: activates the probe extension, writes its result, and resolves so
// VS Code exits. The receipt carries the outcome; a missing receipt is a harness failure.

'use strict';

const fs = require('node:fs');
const vscode = require('vscode');

/** @param {unknown} error */
function describeError(error) {
    return error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack?.split('\n').slice(0, 12).join('\n') }
        : { name: typeof error, message: String(error) };
}

/** @returns {Promise<void>} */
async function run() {
    const resultPath = process.env.DOCUMENTDB_HOST_PROBE_RESULT;
    const extensionId = process.env.DOCUMENTDB_HOST_PROBE_EXTENSION;
    if (!resultPath || !extensionId) {
        throw new Error('Missing DOCUMENTDB_HOST_PROBE_RESULT or DOCUMENTDB_HOST_PROBE_EXTENSION.');
    }
    const extension = vscode.extensions.getExtension(extensionId);
    let result;
    try {
        if (!extension) {
            throw new Error(`The probe extension ${extensionId} was not discovered.`);
        }
        const api = await extension.activate();
        result =
            api && api.result
                ? api.result
                : {
                      status: 'FAIL',
                      stage: 'activate',
                      checks: [],
                      error: { name: 'Error', message: 'activate() returned no result' },
                  };
    } catch (error) {
        result = { status: 'FAIL', stage: 'activate', checks: [], error: describeError(error) };
    }
    fs.writeFileSync(
        resultPath,
        JSON.stringify(
            {
                ...result,
                extensionId,
                extensionPath: extension?.extensionPath,
                moduleType: extension?.packageJSON.type,
                vscodeVersion: vscode.version,
                nodeVersion: process.versions.node,
            },
            null,
            2,
        ),
    );
}

module.exports = { run };
