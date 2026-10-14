/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { packedTestFailure } = require('./packed-tests.cjs');

test('packed tests reject scripts, declarations, maps and other test companions', () => {
    for (const kind of ['test', 'spec']) {
        for (const extension of [
            'js',
            'cjs',
            'mjs',
            'jsx',
            'ts',
            'cts',
            'mts',
            'tsx',
            'd.ts',
            'd.cts',
            'd.mts',
            'json',
        ]) {
            for (const suffix of ['', '.map']) {
                const file = `dist/nested/x.${kind}.${extension}${suffix}`;
                assert.equal(packedTestFailure('fixture', [file]), `fixture: packed test files are forbidden: ${file}`);
            }
        }
    }
});

test('packed test failures list every offending path in stable order', () => {
    assert.equal(
        packedTestFailure('fixture', ['dist/z.test.js.map', 'dist/index.js', 'x.spec.d.ts', 'dist/a.test.js']),
        'fixture: packed test files are forbidden: dist/a.test.js, dist/z.test.js.map, x.spec.d.ts',
    );
});

test('packed tests allow production scripts, declarations and similarly named directories', () => {
    assert.equal(
        packedTestFailure('fixture', [
            'dist/index.js',
            'dist/index.d.ts',
            'dist/index.js.map',
            'dist/test.js',
            'dist/spec.js',
            'dist/test-utils.js',
            'dist/contest.js',
            'dist/a.test.directory/index.js',
        ]),
        undefined,
    );
    assert.equal(packedTestFailure('fixture', []), undefined);
});
