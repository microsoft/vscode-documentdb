/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Loads the packaged VSIX into a clean VS Code and runs suite.js inside it. Needs `npm run package` first;
// on Linux without a display, run it under `xvfb-run -a`.
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
// The oldest VS Code the manifest accepts, so using a newer API fails here instead of for users.
const vscodeVersion = require('../../package.json').engines.vscode.replace(/^\^/, '');

async function main() {
    const vsix = findVsix();
    // Outside the checkout, so a module left out of the VSIX can't resolve from the repo's node_modules.
    // Short, because VS Code puts its IPC socket under the user-data dir and socket paths max out near 100 chars.
    const workDir = fs.mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ddb-smoke-'));
    execFileSync('unzip', ['-q', vsix, 'extension/*', '-d', workDir]);

    const vscodeExecutablePath = await downloadAndUnzipVSCode({
        version: vscodeVersion,
        cachePath: path.join(repoRoot, '.vscode-test'),
    });
    await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: path.join(workDir, 'extension'),
        extensionTestsPath: path.join(__dirname, 'suite.js'),
        launchArgs: [
            '--disable-extensions',
            '--disable-gpu',
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            `--user-data-dir=${path.join(workDir, 'ud')}`,
            `--extensions-dir=${path.join(workDir, 'ext')}`,
        ],
        // Keeps telemetry local.
        extensionTestsEnv: { DEBUGTELEMETRY: 'v' },
    });
}

function findVsix() {
    const vsixFiles = fs.readdirSync(repoRoot).filter((name) => name.endsWith('.vsix'));
    if (vsixFiles.length !== 1) {
        throw new Error(`Expected one .vsix in ${repoRoot} (run \`npm run package\`), found ${vsixFiles.length}.`);
    }
    return path.join(repoRoot, vsixFiles[0]);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
