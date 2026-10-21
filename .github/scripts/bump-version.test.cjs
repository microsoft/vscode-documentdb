/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.join(__dirname, 'bump-version.cjs');

function fixture(t, version = '1.0.1') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-version-bump-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const lifecycle = 'node -e "throw new Error(\'Version lifecycle scripts must not run\')"';
    const manifest = {
        name: 'version-bump-fixture',
        version,
        private: true,
        workspaces: ['packages/*'],
        dependencies: { 'fixture-dependency': '7.8.9' },
        scripts: { preversion: lifecycle, version: lifecycle, postversion: lifecycle },
    };
    const lock = {
        name: manifest.name,
        version,
        lockfileVersion: 3,
        requires: true,
        packages: {
            '': {
                name: manifest.name,
                version,
                workspaces: manifest.workspaces,
                dependencies: manifest.dependencies,
            },
            'packages/example': { name: 'fixture-workspace', version: '4.5.6' },
            'node_modules/fixture-workspace': { resolved: 'packages/example', link: true },
            'node_modules/fixture-dependency': { version: '7.8.9' },
        },
    };
    fs.mkdirSync(path.join(directory, 'packages/example'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    fs.writeFileSync(
        path.join(directory, 'packages/example/package.json'),
        `${JSON.stringify({ name: 'fixture-workspace', version: '4.5.6' }, null, 2)}\n`,
    );
    return { directory, manifest, lock };
}

function run(directory, releaseTag = '') {
    return spawnSync(process.execPath, [script], {
        cwd: directory,
        encoding: 'utf8',
        env: {
            ...process.env,
            RELEASE_TAG: releaseTag,
            GITHUB_OUTPUT: path.join(directory, 'outputs'),
            GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
            npm_config_update_notifier: 'false',
        },
    });
}

function read(directory, file) {
    return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
}

for (const releaseTag of ['', 'v1.0.1', '1.0.1']) {
    test(`Bumps only the root manifest and lockfile to alpha.0 (${releaseTag || 'manual'})`, (t) => {
        const { directory, manifest, lock } = fixture(t);
        const workspace = fs.readFileSync(path.join(directory, 'packages/example/package.json'), 'utf8');
        execFileSync('git', ['init', '--quiet'], { cwd: directory });

        const result = run(directory, releaseTag);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(read(directory, 'package.json'), { ...manifest, version: '1.0.2-alpha.0' });
        assert.deepEqual(read(directory, 'package-lock.json'), {
            ...lock,
            version: '1.0.2-alpha.0',
            packages: { ...lock.packages, '': { ...lock.packages[''], version: '1.0.2-alpha.0' } },
        });
        assert.equal(fs.readFileSync(path.join(directory, 'packages/example/package.json'), 'utf8'), workspace);
        assert.equal(
            fs.readFileSync(path.join(directory, 'outputs'), 'utf8'),
            'changed=true\nold-version=1.0.1\nnew-version=1.0.2-alpha.0\n',
        );
        assert.match(fs.readFileSync(path.join(directory, 'summary'), 'utf8'), /1\.0\.1 -> 1\.0\.2-alpha\.0/);
        assert.equal(execFileSync('git', ['tag', '--list'], { cwd: directory, encoding: 'utf8' }), '');
        assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: directory }).status, 0);
    });
}

for (const version of ['1.0.2-alpha.0', '1.0.2-alpha.1', '1.1.0-beta.0']) {
    test(`Does not advance an existing development version (${version})`, (t) => {
        const { directory, manifest, lock } = fixture(t, version);

        const result = run(directory);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(read(directory, 'package.json'), manifest);
        assert.deepEqual(read(directory, 'package-lock.json'), lock);
        assert.equal(fs.readFileSync(path.join(directory, 'outputs'), 'utf8'), 'changed=false\n');
        assert.match(result.stdout, /already on development version/);
    });
}

for (const releaseTag of ['v0.11.2', 'v1.1.0', 'unrelated-package-v1.0.1']) {
    test(`Skips a release that does not match main (${releaseTag})`, (t) => {
        const { directory, manifest, lock } = fixture(t);

        const result = run(directory, releaseTag);

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(read(directory, 'package.json'), manifest);
        assert.deepEqual(read(directory, 'package-lock.json'), lock);
        assert.equal(fs.readFileSync(path.join(directory, 'outputs'), 'utf8'), 'changed=false\n');
        assert.match(result.stdout, /does not match the current main version/);
    });
}

test('A repeated manual run does not produce alpha.1', (t) => {
    const { directory } = fixture(t);
    assert.equal(run(directory).status, 0);
    fs.writeFileSync(path.join(directory, 'outputs'), '');

    const result = run(directory);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(read(directory, 'package.json').version, '1.0.2-alpha.0');
    assert.equal(fs.readFileSync(path.join(directory, 'outputs'), 'utf8'), 'changed=false\n');
});

for (const field of ['version', 'root-package']) {
    test(`Fails before modifying files if the lockfile is out of sync (${field})`, (t) => {
        const { directory, manifest, lock } = fixture(t);
        if (field === 'version') {
            lock.version = '1.0.0';
        } else {
            lock.packages[''].version = '1.0.0';
        }
        fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(lock));

        const result = run(directory);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /both root package-lock.json versions must match/);
        assert.deepEqual(read(directory, 'package.json'), manifest);
        assert.deepEqual(read(directory, 'package-lock.json'), lock);
        assert.equal(fs.existsSync(path.join(directory, 'outputs')), false);
    });
}

test('Fails explicitly for an unsupported version', (t) => {
    const { directory } = fixture(t, 'not-a-version');

    const result = run(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected a numeric release version/);
});
