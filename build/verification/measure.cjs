/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const outputDirectory = process.argv[2];
if (!outputDirectory) {
    throw new Error('Usage: node build/verification/measure.cjs <output-directory>');
}
fs.mkdirSync(outputDirectory, { recursive: true });

function run(command, args, name) {
    const log = fs.openSync(path.join(outputDirectory, `${name}.log`), 'w');
    const start = process.hrtime.bigint();
    const result = spawnSync(command, args, {
        stdio: ['ignore', log, log],
        shell: process.platform === 'win32',
    });
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    fs.closeSync(log);
    if (result.error || result.status !== 0) {
        throw new Error(`${name} failed: ${result.error?.message || `exit ${result.status}`}; see its log`);
    }
    console.log(`${name}: ${seconds.toFixed(3)}s`);
    return seconds;
}

const measurements = {
    node: process.version,
    npm: spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    webpackSeconds: [],
    unitTestSeconds: [],
};
for (let index = 1; index <= 3; index++) {
    measurements.webpackSeconds.push(run('npm', ['run', 'webpack-prod'], `webpack-${index}`));
    fs.writeFileSync(path.join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2));
}
for (let index = 1; index <= 3; index++) {
    measurements.unitTestSeconds.push(
        run('node', ['node_modules/jest/bin/jest.js', '--no-coverage'], `unit-tests-${index}`),
    );
    fs.writeFileSync(path.join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2));
}
measurements.unitTestMedianSeconds = [...measurements.unitTestSeconds].sort((left, right) => left - right)[1];
const packages = spawnSync('npm', ['ls', '--all', '--parseable'], { encoding: 'utf8' });
if (packages.error || packages.status !== 0) {
    throw new Error(`Package inventory failed: ${packages.error?.message || packages.stderr}`);
}
measurements.installedPackageCount = new Set(packages.stdout.trim().split(/\r?\n/).slice(1)).size;
measurements.distFiles = [];
function inventory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            inventory(filename);
        } else {
            measurements.distFiles.push({
                path: path.relative('dist', filename).split(path.sep).join('/'),
                bytes: fs.statSync(filename).size,
            });
        }
    }
}
inventory('dist');
fs.writeFileSync(path.join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
