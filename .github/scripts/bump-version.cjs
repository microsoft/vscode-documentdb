/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function readVersion() {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    if (
        typeof manifest.version !== 'string' ||
        lock.version !== manifest.version ||
        lock.packages?.['']?.version !== manifest.version
    ) {
        throw new Error('package.json and both root package-lock.json versions must match before and after the bump.');
    }
    return manifest.version;
}

function report(outputs, message) {
    console.log(message);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
            process.env.GITHUB_OUTPUT,
            Object.entries(outputs)
                .map(([key, value]) => `${key}=${value}\n`)
                .join(''),
        );
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Development version bump\n\n${message}\n`);
    }
}

function main() {
    const oldVersion = readVersion();
    const releaseTag = process.env.RELEASE_TAG;
    if (releaseTag && releaseTag !== oldVersion && releaseTag !== `v${oldVersion}`) {
        report(
            { changed: false },
            `Skipped: release ${releaseTag} does not match the current main version ${oldVersion}.`,
        );
        return;
    }
    if (/^\d+\.\d+\.\d+-/.test(oldVersion)) {
        report({ changed: false }, `Skipped: main is already on development version ${oldVersion}.`);
        return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(oldVersion)) {
        throw new Error(`Expected a numeric release version, received ${oldVersion}.`);
    }

    execFileSync(
        'npm',
        [
            'version',
            'prerelease',
            '--preid=alpha',
            '--no-git-tag-version',
            '--ignore-scripts',
            '--workspaces=false',
            '--package-lock=true',
        ],
        { stdio: 'inherit' },
    );
    const newVersion = readVersion();
    if (!/^\d+\.\d+\.\d+-alpha\.0$/.test(newVersion)) {
        throw new Error(`Expected the first alpha of the next patch version, received ${newVersion}.`);
    }
    report(
        { changed: true, 'old-version': oldVersion, 'new-version': newVersion },
        `Updated package.json and both root package-lock.json versions: **${oldVersion} -> ${newVersion}**.`,
    );
}

main();
