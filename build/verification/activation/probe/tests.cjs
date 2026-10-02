/* Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License. */
'use strict';

const fs = require('node:fs');
const vscode = require('vscode');
const { TARGET_ID, LATE_COMMANDS, assertInstalledPath, assertLateCommands } = require('../checks.cjs');

/** @param {string} name @returns {string} */
function requiredEnvironment(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing L3 probe environment: ${name}`);
    }
    return value;
}

/** @returns {Promise<void>} */
async function run() {
    const target = vscode.extensions.getExtension(TARGET_ID);
    if (!target) {
        throw new Error(`The installed VSIX extension ${TARGET_ID} was not discovered.`);
    }
    assertInstalledPath(
        target.extensionPath,
        requiredEnvironment('DOCUMENTDB_L3_INSTALLED_PATH'),
        requiredEnvironment('DOCUMENTDB_L3_EXTENSIONS_DIR'),
        requiredEnvironment('DOCUMENTDB_L3_CHECKOUT'),
    );
    await target.activate();
    if (!target.isActive) {
        throw new Error(`${TARGET_ID} did not become active.`);
    }
    assertLateCommands(await vscode.commands.getCommands(true));
    // Let fire-and-forget startup work run before Electron exits and flushes the log channels.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    fs.writeFileSync(
        requiredEnvironment('DOCUMENTDB_L3_RESULT'),
        JSON.stringify({ extensionId: TARGET_ID, extensionPath: target.extensionPath, active: true, commands: LATE_COMMANDS }),
    );
}

module.exports = { run };
