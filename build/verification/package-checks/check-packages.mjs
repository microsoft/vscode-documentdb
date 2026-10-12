/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Stage 3 package checks, run on packed tarballs of the workspace packages:
//
//   node build/verification/package-checks/check-packages.mjs [--no-build] [--keep] [--report <file>]
//   node build/verification/package-checks/check-packages.mjs --archives <dir-or-tgz> [--archives ...]
//        [--keep] [--report <file>]
//
// The default mode builds and `npm pack`s every workspace into a temp directory outside the
// repository. Archive mode checks tarballs that were already packed (the ADO npm build's) offline:
// it never builds, packs or runs npm/npx, so it skips step 2. For each tarball:
// 1. Reports its file name and SHA-256, rejects test files, and requires every `files`, `main`,
//    `types` and `exports` target in package.json to be in the tarball.
// 2. publint and @arethetypeswrong/cli (pinned versions, through npx; not in the lockfile).
// 3. Static scan of every shipped .js file for top-level await, which `require(esm)` rejects.
// 4. Two throwaway consumer projects with the tarballs unpacked into node_modules (all other
//    dependencies are linked from the repository's node_modules, so no network is needed):
//    - Node probes: `require()` (CommonJS) and `import()` (ESM) of every entry point;
//    - Vitest probe: imports every entry point under Vitest, with a `vscode` alias for
//      `vscode-ext-webview/host`, and runs the DOM-dependent calls under jsdom.
//    Every probe makes the representative calls in calls.mjs, not only imports.
// 5. Controls: a tarball with a planted test, and Vitest without inlining (when both inlined
//    packages are checked), must fail as documented.
//
// Exit code 0 only when every result matches the expectations below.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { allChecks, ownerOf } from './calls.mjs';
import { packageTargetFailures } from './package-targets.cjs';
import { packedTestFailure } from './packed-tests.cjs';
import { extractFiles, readTarball, writeTarball } from './tarball.cjs';
import { hasTopLevelAwait } from './top-level-await.mjs';

const PUBLINT = 'publint@0.3.24';
const ATTW = '@arethetypeswrong/cli@0.18.5';

// ESM-only by design: `require` from CommonJS works through Node's `require(esm)` (proven by the
// CommonJS probe), but TypeScript's node16 CommonJS resolution reports it as dynamic-import-only.
const ACCEPTED_ATTW_PROBLEMS = new Set(['CJSResolvesToESM']);

// Fluent UI cannot be loaded by plain Node: @fluentui/react-components resolves to CommonJS with
// no detectable named exports, and @fluentui/react-icons' ESM build uses extensionless imports.
// The package README documents inlining it in test runners instead. Errors may name a resolved
// Windows path, hence `[\\/]`.
const EXPECTED_NODE_LOAD_FAILURES = {
    '@microsoft/vscode-ext-webview-fluentui': /@fluentui[\\/]/,
    '@microsoft/vscode-ext-webview-fluentui/components': /@fluentui[\\/]/,
};

// Packages the Vitest probe inlines: fluentui for the reason above; vscode-ext-webview so the
// `vscode` alias reaches the `import 'vscode'` in its host entry.
const VITEST_INLINE = ['@microsoft/vscode-ext-webview', '@microsoft/vscode-ext-webview-fluentui'];

const here = import.meta.dirname;
const repo = path.resolve(here, '../../..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const reportIndex = args.indexOf('--report');
const reportFile = reportIndex >= 0 ? path.resolve(args[reportIndex + 1]) : undefined;
const archiveInputs = args.flatMap((arg, index) => (args[index - 1] === '--archives' ? [path.resolve(arg)] : []));
const archiveMode = args.includes('--archives');
if (archiveMode && archiveInputs.length !== args.filter((arg) => arg === '--archives').length) {
    throw new Error('--archives needs a directory or .tgz file');
}

function run(command, commandArgs, options = {}) {
    // Archive mode needs no network, so it never runs npm, npx or any tool other than Node here.
    if (archiveMode && command !== process.execPath) throw new Error(`Archive mode must not run ${command}`);
    const result = spawnSync(command, commandArgs, {
        cwd: options.cwd ?? repo,
        env: { ...process.env, ...options.env },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // npm and npx are .cmd shims on Windows; Node's own path may contain spaces.
        shell: process.platform === 'win32' && command !== process.execPath,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function archiveFiles(inputs) {
    const files = inputs.flatMap((input) =>
        statSync(input).isDirectory()
            ? readdirSync(input)
                  .filter((name) => name.endsWith('.tgz'))
                  .map((name) => path.join(input, name))
            : [input],
    );
    if (files.length === 0) throw new Error(`No .tgz archives in ${inputs.join(', ')}`);
    return files.sort();
}

function lastJsonLine(text) {
    const line = text
        .trim()
        .split('\n')
        .reverse()
        .find((candidate) => candidate.startsWith('[') || candidate.startsWith('{'));
    return line ? JSON.parse(line) : undefined;
}

function listFiles(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listFiles(full, out);
        else out.push(full);
    }
    return out;
}

function linkDependencies(consumer, ours) {
    const target = path.join(consumer, 'node_modules');
    mkdirSync(target, { recursive: true });
    const source = path.join(repo, 'node_modules');
    for (const entry of readdirSync(source)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
            mkdirSync(path.join(target, entry), { recursive: true });
            for (const scoped of readdirSync(path.join(source, entry))) {
                const name = `${entry}/${scoped}`;
                if (ours.has(name)) continue;
                symlinkSync(path.join(source, entry, scoped), path.join(target, entry, scoped), 'junction');
            }
        } else if (!ours.has(entry)) {
            symlinkSync(path.join(source, entry), path.join(target, entry), 'junction');
        }
    }
}

const CHECKS_RUN = [
    'packed test files',
    'package.json files/main/types/exports targets',
    'top-level await',
    'require() and import() probes',
    'Vitest probe',
    'packed-test control',
    'Vitest-without-inlining control (when both inlined packages are checked)',
];
const ONLINE_ONLY = ['publint', '@arethetypeswrong/cli'];

const failures = [];
const report = {
    node: process.version,
    mode: archiveMode ? 'archives (offline)' : 'npm pack',
    checkoutCommit:
        spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout?.trim() || 'unknown',
    checks: {
        run: archiveMode ? CHECKS_RUN : [...CHECKS_RUN, ...ONLINE_ONLY],
        notRun: archiveMode ? ONLINE_ONLY.map((name) => `${name} (not in the lockfile; npx would download it)`) : [],
    },
    packages: {},
};
const note = (name, key, value) => {
    report.packages[name] ??= {};
    report.packages[name][key] = value;
};

if (!archiveMode && !args.includes('--no-build')) {
    const build = run('npm', ['run', 'build', '--workspaces', '--if-present']);
    if (build.status !== 0) {
        console.error(build.stdout, build.stderr);
        throw new Error('Workspace build failed');
    }
}

const workDir = mkdtempSync(path.join(tmpdir(), 'documentdb-package-check-'));
const tarballs = path.join(workDir, 'tarballs');
mkdirSync(tarballs);
console.log(`Work directory: ${workDir}`);

try {
    let tarballFiles;
    if (archiveMode) {
        tarballFiles = archiveFiles(archiveInputs);
    } else {
        const workspaces = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).workspaces;
        const packageDirs = workspaces.flatMap((pattern) => {
            const base = path.join(repo, pattern.replace(/\/\*$/, ''));
            return readdirSync(base).map((name) => path.join(base, name));
        });
        const pack = run('npm', [
            'pack',
            '--json',
            '--pack-destination',
            tarballs,
            ...packageDirs.flatMap((dir) => ['--workspace', path.relative(repo, dir)]),
        ]);
        if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr}`);
        tarballFiles = JSON.parse(pack.stdout).map((entry) => path.join(tarballs, entry.filename));
    }
    const packed = tarballFiles.map((tarball) => {
        const archive = readTarball(tarball);
        const manifestFile = archive.files.find((file) => file.path === 'package.json');
        if (!manifestFile) throw new Error(`${path.basename(tarball)} has no package.json`);
        const manifest = JSON.parse(manifestFile.data.toString('utf8'));
        return { name: manifest.name, version: manifest.version, manifest, tarball, ...archive };
    });
    const ours = new Set(packed.map((entry) => entry.name));
    console.log(`Mode: ${report.mode} (checkout ${report.checkoutCommit})`);
    for (const entry of packed) {
        console.log(`  ${path.basename(entry.tarball)}  ${entry.bytes} bytes  sha256 ${entry.sha256}`);
    }
    console.log(`Checks run: ${report.checks.run.join('; ')}`);
    if (report.checks.notRun.length > 0) console.log(`Checks not run: ${report.checks.notRun.join('; ')}`);

    // Consumers: tarballs unpacked as real directories, everything else linked.
    const nodeConsumer = path.join(workDir, 'consumer-node');
    const vitestConsumer = path.join(workDir, 'consumer-vitest');
    for (const consumer of [nodeConsumer, vitestConsumer]) {
        mkdirSync(consumer);
        writeFileSync(
            path.join(consumer, 'package.json'),
            JSON.stringify({ name: path.basename(consumer), private: true }),
        );
        linkDependencies(consumer, ours);
        for (const entry of packed) {
            extractFiles(entry.files, path.join(consumer, 'node_modules', entry.name));
        }
    }
    mkdirSync(path.join(nodeConsumer, 'node_modules', 'vscode'));
    writeFileSync(
        path.join(nodeConsumer, 'node_modules', 'vscode', 'package.json'),
        '{"name":"vscode","main":"index.js"}',
    );
    cpSync(path.join(here, 'vscode-stub.cjs'), path.join(nodeConsumer, 'node_modules', 'vscode', 'index.js'));
    for (const file of ['calls.mjs', 'probe-node.cjs', 'probe-node.mjs']) {
        cpSync(path.join(here, file), path.join(nodeConsumer, file));
    }
    for (const file of [
        'calls.mjs',
        'probe.node.test.mjs',
        'probe.dom.test.mjs',
        'vitest.probe.config.mjs',
        'vscode-stub.cjs',
    ]) {
        cpSync(path.join(here, file), path.join(vitestConsumer, file));
    }

    for (const entry of packed) {
        note(
            entry.name,
            'tarball',
            `${path.basename(entry.tarball)} (${entry.files.length} files, ${entry.bytes} bytes)`,
        );
        note(entry.name, 'sha256', entry.sha256);
        const packedPaths = entry.files.map((file) => file.path);
        const testFailure = packedTestFailure(entry.name, packedPaths);
        note(entry.name, 'packedTests', testFailure ?? 'none');
        if (testFailure) failures.push(testFailure);

        const targetFailures = packageTargetFailures(entry.name, entry.manifest, packedPaths);
        note(entry.name, 'targets', targetFailures.length === 0 ? 'all packed' : targetFailures);
        failures.push(...targetFailures);

        if (!Object.keys(allChecks).some((name) => ownerOf(name, [entry.name]))) {
            failures.push(`${entry.name}: calls.mjs has no representative calls for this package`);
        }

        if (!archiveMode) {
            const publint = run('npx', ['--yes', PUBLINT, 'run', entry.tarball, '--strict'], { cwd: workDir });
            const publintOutput = `${publint.stdout}${publint.stderr}`.trim();
            note(entry.name, 'publint', publint.status === 0 ? 'clean' : publintOutput);
            if (publint.status !== 0) failures.push(`${entry.name}: publint\n${publintOutput}`);

            const attw = run('npx', ['--yes', ATTW, entry.tarball, '--format', 'json'], { cwd: workDir });
            const attwStart = attw.stdout.indexOf('{');
            const attwJson = attwStart >= 0 ? JSON.parse(attw.stdout.slice(attwStart)) : undefined;
            if (!attwJson) {
                failures.push(`${entry.name}: attw produced no JSON\n${attw.stderr}`);
            } else {
                const problems = Object.values(attwJson.problems ?? {}).flat();
                const kinds = [
                    ...new Set(problems.map((problem) => `${problem.kind} (${problem.resolutionKind ?? '-'})`)),
                ];
                note(entry.name, 'attw', kinds.length === 0 ? 'clean' : kinds);
                const unexpected = problems.filter((problem) => !ACCEPTED_ATTW_PROBLEMS.has(problem.kind));
                if (unexpected.length > 0) failures.push(`${entry.name}: attw ${JSON.stringify(unexpected)}`);
            }
        }

        const unpacked = path.join(nodeConsumer, 'node_modules', entry.name);
        const scripts = listFiles(unpacked).filter((file) => /\.(?:m?js)$/.test(file));
        const withAwait = scripts.filter((file) => hasTopLevelAwait(readFileSync(file, 'utf8')));
        note(entry.name, 'topLevelAwait', withAwait.length === 0 ? `none in ${scripts.length} files` : withAwait);
        if (withAwait.length > 0) failures.push(`${entry.name}: top-level await in ${withAwait.join(', ')}`);
    }

    // Archive mode probes only the archives' entry points, not the linked workspace sources.
    const probeEnv = { PROBE_PACKAGES: archiveMode ? [...ours].join(',') : '' };
    for (const [kind, file] of [
        ['require', 'probe-node.cjs'],
        ['import', 'probe-node.mjs'],
    ]) {
        const probe = run(process.execPath, [file], { cwd: nodeConsumer, env: probeEnv });
        const results = lastJsonLine(probe.stdout);
        if (!results) {
            failures.push(`${kind} probe produced no results\n${probe.stdout}\n${probe.stderr}`);
            continue;
        }
        for (const result of results) {
            const owner = ownerOf(result.name, ours);
            const expected = EXPECTED_NODE_LOAD_FAILURES[result.name];
            const line = result.ok ? `ok: ${result.detail}` : `FAILED: ${result.error}`;
            if (expected) {
                const asExpected = !result.ok && !result.loaded && expected.test(result.error);
                note(owner, `${kind} ${result.name}`, `${asExpected ? 'expected failure' : 'UNEXPECTED'}: ${line}`);
                if (!asExpected)
                    failures.push(`${kind} ${result.name}: expected the documented Fluent failure, got ${line}`);
            } else {
                note(owner, `${kind} ${result.name}`, line);
                if (!result.ok) failures.push(`${kind} ${result.name}: ${result.error}`);
            }
        }
    }

    const vitestBin = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs');
    const vitestArgs = [
        vitestBin,
        'run',
        '--root',
        vitestConsumer,
        '--config',
        'vitest.probe.config.mjs',
        '--reporter',
        'verbose',
    ];
    const inline = VITEST_INLINE.filter((name) => ours.has(name));
    const vitest = run(process.execPath, vitestArgs, {
        cwd: vitestConsumer,
        env: { ...probeEnv, PROBE_INLINE: inline.join(','), CI: 'true' },
    });
    const vitestOutput = `${vitest.stdout}${vitest.stderr}`;
    for (const match of vitestOutput.matchAll(/PROBE (\S+): (.*)/g)) {
        note(ownerOf(match[1], ours), `vitest ${match[1]}`, `ok: ${match[2]}`);
    }
    const summary = vitestOutput.match(/Tests\s+.*\n/)?.[0]?.trim();
    report.vitest = { inline, status: vitest.status, summary };
    if (vitest.status !== 0) failures.push(`vitest probe failed\n${vitestOutput.slice(-4000)}`);
    const missingSources = vitestOutput
        .split('\n')
        .filter((line) => /points to missing source files/.test(line))
        .map((line) => line.replaceAll('\\', '/'));
    report.vitest.missingSourceWarnings = missingSources.length;
    if (missingSources.some((line) => [...ours].some((name) => line.includes(name)))) {
        failures.push(`vitest reported sourcemaps without sources for our packages:\n${missingSources.join('\n')}`);
    }

    // Archive mode writes the control tarball itself instead of running `npm pack`.
    let testControlFiles;
    if (archiveMode) {
        const testTarball = path.join(tarballs, 'packed-test-control-1.0.0.tgz');
        writeTarball(testTarball, [
            { path: 'package.json', data: JSON.stringify({ name: 'packed-test-control', version: '1.0.0' }) },
            { path: 'dist/x.test.js', data: 'export {};\n' },
        ]);
        testControlFiles = readTarball(testTarball).files.map((file) => file.path);
    } else {
        const testFixture = path.join(workDir, 'packed-test-control');
        mkdirSync(path.join(testFixture, 'dist'), { recursive: true });
        writeFileSync(
            path.join(testFixture, 'package.json'),
            JSON.stringify({ name: 'packed-test-control', version: '1.0.0', files: ['dist'] }),
        );
        writeFileSync(path.join(testFixture, 'dist', 'x.test.js'), 'export {};\n');
        const testPack = run('npm', ['pack', '--json', '--pack-destination', tarballs], { cwd: testFixture });
        assert.equal(testPack.status, 0, `Packed-test control npm pack failed: ${testPack.stderr}`);
        testControlFiles = JSON.parse(testPack.stdout)[0].files.map((file) => file.path);
    }
    const testControlFailure = packedTestFailure('packed-test-control', testControlFiles);
    assert.equal(testControlFailure, 'packed-test-control: packed test files are forbidden: dist/x.test.js');
    report.packedTestControl = { status: 'expected failure', failure: testControlFailure };

    // Control: without inlining, Vitest hands both packages to Node, which must fail exactly as
    // documented (Fluent's named exports; the host entry's bare `vscode` import).
    if (inline.length < VITEST_INLINE.length) {
        report.vitestWithoutInline = `not applicable: needs ${VITEST_INLINE.join(' and ')}`;
    } else {
        const control = run(process.execPath, vitestArgs, {
            cwd: vitestConsumer,
            env: { ...probeEnv, PROBE_INLINE: '', CI: 'true' },
        });
        const controlOutput = `${control.stdout}${control.stderr}`;
        const controlFailures = {
            fluentNamedExports:
                /Named export '[^']+' not found\. The requested module '@fluentui\/react-components'|@fluentui[\\/]react-icons/.test(
                    controlOutput,
                ),
            hostVscode: /Cannot find (?:package|module) 'vscode'/.test(controlOutput),
        };
        report.vitestWithoutInline = {
            status: control.status,
            summary: controlOutput.match(/Tests\s+.*\n/)?.[0]?.trim(),
            ...controlFailures,
        };
        if (control.status === 0 || !controlFailures.fluentNamedExports || !controlFailures.hostVscode) {
            failures.push(
                `vitest control without inlining did not fail as documented: ${JSON.stringify(report.vitestWithoutInline)}`,
            );
        }
    }
} finally {
    report.failures = failures;
    if (reportFile) writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (keep) console.log(`Kept ${workDir}`);
    else if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
    console.error(`\n${failures.length} package check failure(s):\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('\nAll package checks passed.');
