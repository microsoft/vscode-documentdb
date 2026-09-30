/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs in the extension host that runSmokeTest.js launches.
const assert = require('assert');
const vscode = require('vscode');

const EXTENSION_ID = 'ms-azuretools.vscode-documentdb';
const TIMEOUT_MS = 60_000;

async function smokeTest() {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not loaded`);
    await extension.activate();

    // Activation reports its own errors instead of rejecting, so check what it registered.
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = extension.packageJSON.contributes.commands
        .map((contribution) => contribution.command)
        .filter((command) => !registered.has(command));
    assert.deepStrictEqual(missing, [], `Contributed commands that were never registered: ${missing.join(', ')}`);
}

exports.run = async function run() {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Smoke test did not finish within ${TIMEOUT_MS / 1000}s`)),
            TIMEOUT_MS,
        );
    });
    try {
        await Promise.race([smokeTest(), timeout]);
    } finally {
        clearTimeout(timer);
    }
};
