/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { after, before, describe, it } = require('node:test');
const { packageTargetFailures } = require('./package-targets.cjs');
const { extractFiles, readTarball, writeTarball } = require('./tarball.cjs');

const REPO = path.resolve(__dirname, '../../..');
const CHECK = path.join(__dirname, 'check-packages.mjs');

describe('package archives: tarball reader and writer', () => {
    let dir;
    before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-archive-test-'))));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('round-trips files, including a path longer than 100 bytes, and reports the SHA-256', () => {
        const long = `dist/${'nested/'.repeat(14)}index.js`;
        const file = path.join(dir, 'round-trip.tgz');
        writeTarball(file, [
            { path: 'package.json', data: '{"name":"x"}' },
            { path: long, data: 'export {};\n' },
        ]);
        const archive = readTarball(file);
        assert.deepEqual(
            archive.files.map((entry) => [entry.path, entry.data.toString()]),
            [
                ['package.json', '{"name":"x"}'],
                [long, 'export {};\n'],
            ],
        );
        assert.equal(archive.bytes, fs.statSync(file).size);
        assert.match(archive.sha256, /^[0-9a-f]{64}$/);
    });

    it('refuses to extract outside the destination', () => {
        assert.throws(
            () => extractFiles([{ path: '../escape.js', data: Buffer.from('') }], path.join(dir, 'out')),
            /Refusing to extract \.\.\/escape\.js/,
        );
    });

    // Rewrites the size field of the second header (the first member's body is one block).
    const withSizeField = (name, sizeField) => {
        const file = path.join(dir, `${name}.tgz`);
        writeTarball(file, [
            { path: 'package.json', data: '{"name":"x"}' },
            { path: 'index.js', data: 'export {};\n' },
        ]);
        const tar = zlib.gunzipSync(fs.readFileSync(file));
        const header = tar.subarray(1024, 1536);
        header.fill(0, 124, 136);
        header.write(sizeField, 124, 'latin1');
        header.fill(0x20, 148, 156);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
        fs.writeFileSync(file, zlib.gzipSync(tar));
        return file;
    };

    it('rejects a member whose size runs past the end of the archive', () => {
        assert.throws(
            () => readTarball(withSizeField('oversized', '00000177777\0')),
            /oversized\.tgz: tar member at 1024 declares 65535 bytes, past the end of the archive/,
        );
    });

    it('rejects a size field that is not a non-negative octal number', () => {
        for (const sizeField of ['0000000001z\0', '-0000000001\0', '\0']) {
            assert.throws(
                () => readTarball(withSizeField('malformed', sizeField)),
                /malformed\.tgz: invalid tar size field/,
            );
        }
    });

    it('rejects a path that occurs twice, also when spelled differently', () => {
        for (const second of ['package.json', './package.json']) {
            const file = path.join(dir, 'duplicate.tgz');
            writeTarball(file, [
                { path: 'package.json', data: '{"name":"x","main":"a.js"}' },
                { path: 'a.js', data: '' },
                { path: second, data: '{"name":"x","main":"missing.js"}' },
            ]);
            assert.throws(
                () => readTarball(file),
                new RegExp(`duplicate\\.tgz: duplicate tar member ${second.replaceAll('.', '\\.')}$`),
            );
        }
    });
});

describe('package archives: package.json targets', () => {
    const manifest = {
        name: 'fixture',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        files: ['dist', 'typeDefs', 'README.md'],
        exports: {
            '.': { types: './dist/index.d.ts', default: './dist/index.js' },
            './host': { types: './dist/host.d.ts', default: './dist/host.js' },
            './typeDefs/*': './typeDefs/*',
            './package.json': './package.json',
        },
    };
    const files = [
        'package.json',
        'README.md',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/host.js',
        'dist/host.d.ts',
        'typeDefs/api.d.ts',
    ];

    it('accepts a package whose targets are all packed, including `*` subpaths', () => {
        assert.deepEqual(packageTargetFailures('fixture', manifest, files), []);
    });

    it('names every missing exports, main, types and files target', () => {
        const missing = files.filter((file) => !['dist/host.js', 'README.md', 'typeDefs/api.d.ts'].includes(file));
        assert.deepEqual(packageTargetFailures('fixture', manifest, missing), [
            'fixture: exports["./host"]["default"] -> ./dist/host.js is not in the tarball',
            'fixture: exports["./typeDefs/*"] -> ./typeDefs/* is not in the tarball',
            'fixture: files entry "typeDefs" packed nothing',
            'fixture: files entry "README.md" packed nothing',
        ]);
        assert.deepEqual(packageTargetFailures('fixture', { ...manifest, files: [] }, ['package.json']), [
            'fixture: main -> dist/index.js is not in the tarball',
            'fixture: types -> dist/index.d.ts is not in the tarball',
            'fixture: exports["."]["types"] -> ./dist/index.d.ts is not in the tarball',
            'fixture: exports["."]["default"] -> ./dist/index.js is not in the tarball',
            'fixture: exports["./host"]["types"] -> ./dist/host.d.ts is not in the tarball',
            'fixture: exports["./host"]["default"] -> ./dist/host.js is not in the tarball',
            'fixture: exports["./typeDefs/*"] -> ./typeDefs/* is not in the tarball',
        ]);
    });
});

// The ADO route end to end: `npm pack` as pack-npm-packages.ps1 does, then archive mode on the
// tarball as built, with a planted test, and without an exports target.
describe('package archives: check-packages.mjs --archives', () => {
    let dir;
    let good;
    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-archive-cli-'));
        const pack = spawnSync(
            'npm',
            ['pack', '--json', '--pack-destination', dir, '--workspace', 'packages/vscode-ext-webview'],
            { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' },
        );
        assert.equal(pack.status, 0, pack.stderr);
        good = path.join(dir, JSON.parse(pack.stdout)[0].filename);
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const check = (tarball) => {
        const result = spawnSync(process.execPath, [CHECK, '--archives', tarball], { cwd: REPO, encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const variant = (name, mutate) => {
        const file = path.join(dir, `${name}.tgz`);
        writeTarball(file, mutate(readTarball(good).files));
        return file;
    };

    it('passes the tarball as packed, and reports its SHA-256 and the checks it cannot run', () => {
        const result = check(good);
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /\nAll package checks passed\.\n$/);
        assert.ok(result.stdout.includes(`sha256 ${readTarball(good).sha256}`));
        assert.match(result.stdout, /Checks not run: publint .*; @arethetypeswrong\/cli /);
        assert.match(result.stdout, /"vitestWithoutInline": "not applicable/);
    });

    it('rejects a packed test file', () => {
        const result = check(
            variant('with-test', (files) => [...files, { path: 'dist/host.test.js', data: Buffer.from('') }]),
        );
        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /- @microsoft\/vscode-ext-webview: packed test files are forbidden: dist\/host\.test\.js\n/,
        );
    });

    it('rejects a missing exports target', () => {
        const result = check(variant('no-host', (files) => files.filter((file) => file.path !== 'dist/host.js')));
        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /- @microsoft\/vscode-ext-webview: exports\["\.\/host"\]\["default"\] -> \.\/dist\/host\.js is not in the tarball\n/,
        );
    });

    // TMPDIR (TEMP on Windows) points the work directory into a sandbox, so a write that escapes
    // the work directory would still land where the test can see it.
    it('rejects a package name that is not a workspace package, writing nothing outside the work directory', () => {
        for (const name of ['../../../escaped', '..\\..\\..\\escaped', 'left-pad']) {
            const sandbox = fs.mkdtempSync(path.join(dir, 'sandbox-'));
            const tarball = variant('renamed', (files) =>
                files.map((file) => {
                    if (file.path !== 'package.json') return file;
                    const manifest = JSON.parse(file.data.toString('utf8'));
                    return { path: file.path, data: JSON.stringify({ ...manifest, name }) };
                }),
            );
            const result = spawnSync(process.execPath, [CHECK, '--archives', tarball], {
                cwd: REPO,
                encoding: 'utf8',
                env: { ...process.env, TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox },
            });
            assert.equal(result.status, 1, name);
            assert.ok(
                result.stderr.includes(
                    `renamed.tgz: package.json name ${JSON.stringify(name)} is not a workspace package of this repository (`,
                ),
                result.stderr,
            );
            assert.deepEqual(fs.readdirSync(sandbox), [], name);
        }
    });
});
