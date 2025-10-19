#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command-line interface for running AI enhanced tests
 * Usage: node scripts/runAITests.js <config-file-path>
 */

const path = require('path');
const { spawn } = require('child_process');

// Get config file path from command line arguments
const configPath = process.argv[2];

if (!configPath) {
    console.error('Usage: npm run test:ai-enhanced <config-file-path>');
    process.exit(1);
}

// Set environment variable to enable testing API
process.env.VSCODE_DOCUMENTDB_TESTING_API = 'true';

// Path to the test runner script
const testRunnerPath = path.resolve(__dirname, '../out/test/aiEnhancedTests/testRunner.js');

// Launch VS Code test environment
const vscodeTest = spawn(
    'node',
    [
        path.resolve(__dirname, '../node_modules/@vscode/test-cli/out/node.js'),
        '--extensionDevelopmentPath',
        path.resolve(__dirname, '..'),
        '--extensionTestsPath',
        testRunnerPath,
    ],
    {
        stdio: 'inherit',
        env: {
            ...process.env,
            AI_TEST_CONFIG_PATH: path.resolve(configPath),
        },
    },
);

vscodeTest.on('exit', (code) => {
    process.exit(code || 0);
});
