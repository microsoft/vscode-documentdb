/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { deepStrictEqual } = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');

test('ESLint checks the current checkout but not nested Git checkouts', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'documentdb-eslint-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const source = join(root, 'src');
    const worktree = join(root, 'nested worktree');
    const clone = join(root, 'nested-clone');
    mkdirSync(join(root, '.git'));
    mkdirSync(source);
    mkdirSync(worktree);
    mkdirSync(join(clone, '.git'), { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: ../.git/worktrees/nested\n');
    const localFile = join(source, 'new.js');
    const worktreeFile = join(worktree, 'worktree.js');
    writeFileSync(localFile, '');
    writeFileSync(worktreeFile, '');
    writeFileSync(join(clone, 'clone.js'), '');

    const overrideConfigFile = resolve(__dirname, '../../eslint.config.mjs');
    const lintPaths = async (cwd) => {
        const eslint = new ESLint({ cwd, overrideConfigFile });
        return (await eslint.lintFiles(['.'])).map(({ filePath }) => filePath);
    };

    deepStrictEqual(await lintPaths(root), [localFile]);
    deepStrictEqual(await lintPaths(worktree), [worktreeFile]);
});
