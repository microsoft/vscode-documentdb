/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TEMPORARY (modernization Stage 2): routes each unit-test file to exactly one runner while Jest
// and Vitest coexist. A test file belongs to Vitest as soon as it imports from 'vitest'; every
// other test file stays with Jest. Converting a file therefore moves it between runners with no
// config edit. Delete this module when Jest is removed, and replace each `vitestFiles(...)` call in
// vitest.config.ts with the plain globs it receives.

const fs = require('fs');
const path = require('path');

const TEST_FILE = /\.test\.tsx?$/;
const VITEST_IMPORT = /\bfrom\s+['"]vitest['"]/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.vscode-test']);

/**
 * @param {string} dir absolute directory
 * @returns {string[]} absolute paths of every `*.test.ts(x)` file below `dir`
 */
function listTestFiles(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) {
                found.push(...listTestFiles(full));
            }
        } else if (TEST_FILE.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

/**
 * @param {string} file absolute path
 * @returns {boolean} whether the file has been converted to Vitest
 */
function isVitestFile(file) {
    return VITEST_IMPORT.test(fs.readFileSync(file, 'utf8'));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Jest `testPathIgnorePatterns` for a project: the default `node_modules` entry plus one anchored
 * pattern per converted file below `dir`.
 *
 * @param {string} dir absolute directory that holds the project's tests
 * @returns {string[]}
 */
function jestIgnorePatterns(dir) {
    const converted = listTestFiles(dir).filter(isVitestFile);
    return ['/node_modules/', ...converted.map((file) => `^${escapeRegExp(file)}$`)];
}

/**
 * Vitest `include` entries for a project: the converted test files below `root/dir`.
 *
 * @param {string} root absolute project root (Vitest resolves `include` against it)
 * @param {string} dir directory relative to `root` that holds the project's tests
 * @returns {string[]} paths relative to `root`, with forward slashes
 */
function vitestFiles(root, dir) {
    return listTestFiles(path.join(root, dir))
        .filter(isVitestFile)
        .map((file) => path.relative(root, file).split(path.sep).join('/'))
        .sort();
}

module.exports = { isVitestFile, jestIgnorePatterns, listTestFiles, vitestFiles };
