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
const yaml = require('js-yaml');
const { writeTarball } = require('../../build/verification/package-checks/tarball.cjs');

const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, '../workflows/npm-publish-documentdb-js.yml'), 'utf8'),
);
const publish = workflow.jobs.publish.steps.find((step) => step.name.includes('Publish selected packages'));

test('Publish resolves selected tarballs as local files in dependency order', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-npm-publish-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'publish-tarballs'));
    const packages = [
        ['@documentdb-js/shell-runtime', '0.9.1'],
        ['@documentdb-js/srv-resolver', '1.1.0'],
        ['@documentdb-js/connection-diagnostics', '0.1.0'],
    ];
    const tarballs = packages.map(([name, version]) => {
        const filename = `${name.slice(1).replace('/', '-')}-${version}.tgz`;
        const file = path.join(dir, 'publish-tarballs', filename);
        writeTarball(file, [{ path: 'package.json', data: JSON.stringify({ name, version }) }]);
        return file;
    });

    const bash =
        process.platform === 'win32'
            ? path.resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '../../..', 'bin/bash.exe')
            : 'bash';
    const capture = `
        npm() {
            printf 'NPM_CALL'
            printf '\\t%s' "$@"
            printf '\\n'
            command npm pack --offline --dry-run --ignore-scripts "$2" >/dev/null
        }
    `;
    const result = spawnSync(bash, ['-c', `${capture}\n${publish.run}`], {
        cwd: dir,
        encoding: 'utf8',
        env: {
            ...process.env,
            GIT_ALLOW_PROTOCOL: 'file',
            GIT_TERMINAL_PROMPT: '0',
            npm_config_update_notifier: 'false',
            PUBLISH_OPERATOR_REGISTRY: 'false',
            PUBLISH_SCHEMA_ANALYZER: 'false',
            PUBLISH_SHELL_API_TYPES: 'false',
            PUBLISH_SHELL_RUNTIME: 'true',
            PUBLISH_SRV_RESOLVER: 'true',
            PUBLISH_CONNECTION_DIAGNOSTICS: 'true',
        },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = result.stdout
        .trim()
        .split('\n')
        .map((line) => line.split('\t'));
    assert.equal(calls.length, tarballs.length);
    for (const [index, call] of calls.entries()) {
        assert.deepEqual(call.slice(0, 2), ['NPM_CALL', 'publish']);
        assert.equal(path.resolve(dir, call[2]), tarballs[index]);
        assert.deepEqual(call.slice(3), ['--provenance', '--access', 'public', '--ignore-scripts']);
    }
});
