/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// S3-F02: does the *published* `@microsoft/vscode-ext-webview/host` work in an extension that does
// not bundle it? `/host` is ESM and imports `vscode` statically; only VS Code's extension host can
// answer whether that import resolves, so this launches the real product.
//
//   npm run probe:host-unbundled [-- --no-build] [--keep] [--vscode <x.y.z>]
//
// 1. Builds the workspace package (unless --no-build) and `npm pack`s it.
// 2. For each variant, writes a throwaway, unbundled probe extension in a temp directory and
//    installs the tarball into it with `npm install --offline`, plus the required peers pinned to
//    this repository's lockfile (by their resolved URLs, which `npm ci` puts in the npm cache).
// 3. Launches VS Code (the L3 version and download cache) with the probe as the development
//    extension. The probe loads `/host`, opens and disposes a webview through `openWebview`, and
//    writes a receipt; see unbundled-host/exercise.cjs. Each step is also appended to a trace file,
//    which locates a hang when no receipt is written.
// 4. Compares each outcome with the expectation in VARIANTS. The control installs a copy whose
//    host module imports `vscode-does-not-exist` and must fail for exactly that reason.
//
// Exit code 0 only when every variant matches its expectation, including the expected hang.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// eslint-disable-next-line import/no-internal-modules -- reuse L3's display check and process runner
const { requireDisplay, runProcess } = require('../activation/runner.cjs');
// eslint-disable-next-line import/no-internal-modules -- L3's VS Code version pin and path helper
const { minimumVSCodeVersion, isInside } = require('../activation/checks.cjs');

const CHECKOUT = path.resolve(__dirname, '../../..');
const TEMPLATES = path.join(__dirname, 'unbundled-host');
const PACKAGE_DIR = 'packages/vscode-ext-webview';
const PACKAGE_NAME = '@microsoft/vscode-ext-webview';
const PUBLISHER = 'documentdb-verification';
const CONTROL_MODULE = 'dist/host/WebviewController.js';
const CONTROL_SPECIFIER = 'vscode-does-not-exist';
const REQUIRE_HOST = "require('@microsoft/vscode-ext-webview/host')";
// Printed by the VS Code main process when the extension host stops answering its heartbeat.
const UNRESPONSIVE = /Extension host \([^)]*\) is unresponsive/;

/**
 * @typedef {{ status: 'PASS' }
 *   | { status: 'FAIL', stage: string, error: RegExp }
 *   | { status: 'HANG', lastTrace: string }} Expectation
 * @typedef {{
 *   name: string, description: string, type: 'commonjs' | 'module', template: string,
 *   mutate: boolean, timeoutMs: number, expect: Expectation,
 * }} Variant
 */

/** @type {readonly Variant[]} */
const VARIANTS = [
    {
        name: 'commonjs-require',
        description: `CommonJS extension: ${REQUIRE_HOST}`,
        type: 'commonjs',
        template: 'extension-require.cjs',
        mutate: false,
        // VS Code serves ESM `import 'vscode'` from an async loader hook that waits for the
        // extension host's main thread; require(esm) blocks that thread, so this deadlocks.
        timeoutMs: 40000,
        expect: { status: 'HANG', lastTrace: REQUIRE_HOST },
    },
    {
        name: 'commonjs-import',
        description: "CommonJS extension: await import('@microsoft/vscode-ext-webview/host')",
        type: 'commonjs',
        template: 'extension-import.cjs',
        mutate: false,
        timeoutMs: 120000,
        expect: { status: 'PASS' },
    },
    {
        name: 'esm-static',
        description: "ES module extension: import * as host from '@microsoft/vscode-ext-webview/host'",
        type: 'module',
        template: 'extension-static.mjs',
        mutate: false,
        timeoutMs: 120000,
        expect: { status: 'PASS' },
    },
    {
        name: 'esm-dynamic',
        description: "ES module extension: await import('@microsoft/vscode-ext-webview/host')",
        type: 'module',
        template: 'extension-dynamic.mjs',
        mutate: false,
        timeoutMs: 120000,
        expect: { status: 'PASS' },
    },
    {
        name: 'control',
        description: `negative control: commonjs-import with /host importing '${CONTROL_SPECIFIER}'`,
        type: 'commonjs',
        template: 'extension-import.cjs',
        mutate: true,
        timeoutMs: 120000,
        expect: {
            status: 'FAIL',
            stage: 'load',
            error: new RegExp(`Cannot find (?:package|module) '${CONTROL_SPECIFIER}'`),
        },
    },
];

/** @typedef {{ build: boolean, keep: boolean, vscodeVersion: string | undefined }} Options */

/** @param {string[]} args @returns {Options} */
function parseArguments(args) {
    /** @type {Options} */
    const options = { build: true, keep: false, vscodeVersion: undefined };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--no-build') {
            options.build = false;
        } else if (arg === '--keep') {
            options.keep = true;
        } else if (arg === '--vscode' && /^\d+\.\d+\.\d+$/.test(args[index + 1] ?? '')) {
            options.vscodeVersion = args[++index];
        } else {
            throw new Error('Usage: npm run probe:host-unbundled -- [--no-build] [--keep] [--vscode <x.y.z>]');
        }
    }
    return options;
}

/**
 * The peers a consumer must install: every non-optional peer.
 * @param {{ peerDependencies?: Record<string, string>,
 *   peerDependenciesMeta?: Record<string, { optional?: boolean }> }} manifest
 * @returns {string[]}
 */
function requiredPeers(manifest) {
    return Object.keys(manifest.peerDependencies ?? {})
        .filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional)
        .sort();
}

/**
 * Pin each peer to this repository's locked version by its resolved tarball URL. `npm ci` stores
 * those URLs in the npm cache, so `--offline` works without registry metadata (packuments).
 * @param {{ packages: Record<string, { resolved?: string }> }} lock @param {string[]} names
 * @returns {string[]}
 */
function lockedSpecs(lock, names) {
    return names.map((name) => {
        const entry = lock.packages[`node_modules/${name}`];
        if (!entry || typeof entry.resolved !== 'string' || !/^https:\/\//.test(entry.resolved)) {
            throw new Error(`package-lock.json has no resolved registry URL for ${name}.`);
        }
        return entry.resolved;
    });
}

/** @param {Variant} variant @returns {string} */
function mainFile(variant) {
    return variant.type === 'module' ? 'extension.mjs' : 'extension.cjs';
}

/** @param {Variant} variant @returns {string} */
function exerciseFile(variant) {
    return variant.type === 'module' ? 'exercise.mjs' : 'exercise.cjs';
}

/** @param {Variant} variant @param {string} vscodeVersion @returns {Record<string, unknown>} */
function probeManifest(variant, vscodeVersion) {
    return {
        name: `unbundled-host-probe-${variant.name}`,
        displayName: `Unbundled /host probe (${variant.name})`,
        publisher: PUBLISHER,
        version: '0.0.1',
        private: true,
        type: variant.type,
        main: `./${mainFile(variant)}`,
        engines: { vscode: `^${vscodeVersion}` },
        activationEvents: [],
        extensionKind: ['workspace'],
    };
}

/** @param {string} source @returns {string} */
function toEsm(source) {
    const exportLine = 'module.exports = { exercise };';
    if (source.split(exportLine).length !== 2 || /\brequire\(/.test(source)) {
        throw new Error('exercise.cjs must contain one `module.exports = { exercise };` and require nothing.');
    }
    return source.replace(exportLine, 'export { exercise };');
}

/** @param {string} source @returns {string} */
function mutateHostImport(source) {
    const pattern = /from (['"])vscode\1;/g;
    const matches = source.match(pattern) ?? [];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one \`from 'vscode'\` import in ${CONTROL_MODULE}; found ${matches.length}.`);
    }
    return source.replace(pattern, `from '${CONTROL_SPECIFIER}';`);
}

/**
 * @typedef {{ status?: string, stage?: string, resolved?: string, checks?: string[], moduleType?: string,
 *   error?: { name?: string, message?: string, code?: string, stack?: string } }} Receipt
 * @typedef {{ receipt: Receipt | undefined, trace: string[], launchError: string, timedOut: boolean,
 *   unresponsive: boolean }} Observation
 * @typedef {{ outcome: 'PASS' | 'FAIL' | 'HANG', detail: string, asExpected: boolean, problem?: string }} Verdict
 */

/**
 * @param {Variant} variant @param {Observation} observed @param {string} extensionDir
 * @returns {Verdict}
 */
function judge(variant, observed, extensionDir) {
    const { receipt, trace, launchError, timedOut, unresponsive } = observed;
    const lastTrace = trace.length > 0 ? trace[trace.length - 1] : '(nothing traced)';
    const expected = variant.expect;
    /** @param {Verdict} verdict @param {string} problem @returns {Verdict} */
    const unexpected = (verdict, problem) => ({ ...verdict, asExpected: false, problem });

    if (!receipt || (receipt.status !== 'PASS' && receipt.status !== 'FAIL')) {
        if (!timedOut) {
            const verdict = /** @type {Verdict} */ ({
                outcome: 'FAIL',
                detail: `no receipt; last trace: ${lastTrace}`,
                asExpected: false,
            });
            return unexpected(verdict, `The probe wrote no valid receipt. ${launchError}`.trim());
        }
        /** @type {Verdict} */
        const verdict = {
            outcome: 'HANG',
            detail:
                `no receipt before the ${variant.timeoutMs / 1000}s timeout; stuck after: ${lastTrace}; ` +
                `extension host reported unresponsive: ${unresponsive ? 'yes' : 'no'}`,
            asExpected: true,
        };
        if (expected.status !== 'HANG') {
            return unexpected(verdict, `Expected ${expected.status}; the extension host hung.`);
        }
        if (lastTrace !== expected.lastTrace || !unresponsive) {
            return unexpected(
                verdict,
                `Expected an unresponsive extension host stuck in ${expected.lastTrace}; got: ${verdict.detail}`,
            );
        }
        return verdict;
    }

    const error = receipt.error ? `${receipt.error.name}: ${receipt.error.message}` : '';
    const detail = receipt.status === 'PASS' ? (receipt.checks ?? []).join('; ') : `stage ${receipt.stage}: ${error}`;
    /** @type {Verdict} */
    const verdict = { outcome: receipt.status, detail, asExpected: true };
    if (launchError) {
        return unexpected(verdict, `VS Code did not exit cleanly: ${launchError}`);
    }
    if (receipt.moduleType !== variant.type) {
        return unexpected(verdict, `The probe ran as ${receipt.moduleType}, expected a ${variant.type} extension.`);
    }
    const fromProbe =
        typeof receipt.resolved === 'string' && isInside(path.join(extensionDir, 'node_modules'), receipt.resolved);
    if (receipt.resolved !== undefined && !fromProbe) {
        return unexpected(verdict, `/host resolved outside the probe's node_modules: ${receipt.resolved}`);
    }
    if (expected.status === 'PASS') {
        return receipt.status === 'PASS' && fromProbe
            ? verdict
            : unexpected(verdict, `Expected PASS from the probe's own node_modules; got ${receipt.status} ${detail}`);
    }
    if (expected.status === 'HANG') {
        return unexpected(verdict, `Expected a hang in ${expected.lastTrace}; got ${receipt.status} ${detail}`);
    }
    if (receipt.status !== 'FAIL' || receipt.stage !== expected.stage || !expected.error.test(error)) {
        return unexpected(
            verdict,
            `Expected FAIL at stage ${expected.stage} matching ${expected.error}; got ${receipt.status} ${detail}`,
        );
    }
    return verdict;
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32',
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
    };
}

/** @param {string} directory @param {string[]} specs @param {(text: string) => void} emit @returns {string} */
function installOffline(directory, specs, emit) {
    const base = [
        'install',
        '--no-save',
        '--no-package-lock',
        '--legacy-peer-deps',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
    ];
    const offline = run('npm', [...base, '--offline', ...specs], directory);
    if (offline.status === 0) {
        return 'npm install --offline';
    }
    if (!/ENOTCACHED/.test(offline.output)) {
        throw new Error(`npm install --offline failed in ${directory}:\n${offline.output}`);
    }
    // Only a cache miss falls back to the registry; the specs are still the exact locked tarballs.
    emit(`Unbundled host probe: npm cache miss, retrying with --prefer-offline.\n${offline.output.trim()}`);
    const online = run('npm', [...base, '--prefer-offline', ...specs], directory);
    if (online.status !== 0) {
        throw new Error(`npm install --prefer-offline failed in ${directory}:\n${online.output}`);
    }
    return 'npm install --prefer-offline (cache miss)';
}

/** @param {string} directory @returns {void} */
function writeUserSettings(directory) {
    fs.mkdirSync(path.join(directory, 'User'), { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'User/settings.json'),
        JSON.stringify({
            'telemetry.telemetryLevel': 'off',
            'update.mode': 'none',
            'extensions.autoUpdate': false,
            'extensions.autoCheckUpdates': false,
            'workbench.enableExperiments': false,
            'workbench.startupEditor': 'none',
            'security.workspace.trust.enabled': false,
            'window.restoreWindows': 'none',
        }),
    );
}

/** @param {string} file @returns {string} */
function readIfPresent(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * @param {Variant} variant @param {{ temporary: string, specs: string[], vscodeVersion: string,
 *   executable: string, env: NodeJS.ProcessEnv, emit: (text: string) => void }} setup
 * @returns {Promise<{ verdict: Verdict, install: string }>}
 */
async function runVariant(variant, setup) {
    const root = path.join(setup.temporary, variant.name);
    const extensionDir = path.join(root, 'extension');
    const userDataDir = path.join(root, 'user-data');
    const extensionsDir = path.join(root, 'extensions');
    const resultPath = path.join(root, 'result.json');
    const tracePath = path.join(root, 'trace.txt');
    const logPath = path.join(root, 'electron.log');
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(extensionsDir);
    writeUserSettings(userDataDir);
    fs.writeFileSync(
        path.join(extensionDir, 'package.json'),
        JSON.stringify(probeManifest(variant, setup.vscodeVersion), null, 4),
    );
    fs.copyFileSync(path.join(TEMPLATES, variant.template), path.join(extensionDir, mainFile(variant)));
    const exercise = fs.readFileSync(path.join(TEMPLATES, 'exercise.cjs'), 'utf8');
    fs.writeFileSync(
        path.join(extensionDir, exerciseFile(variant)),
        variant.type === 'module' ? toEsm(exercise) : exercise,
    );
    fs.copyFileSync(path.join(TEMPLATES, 'tests.cjs'), path.join(extensionDir, 'tests.cjs'));
    const install = installOffline(extensionDir, setup.specs, setup.emit);
    if (variant.mutate) {
        const target = path.join(extensionDir, 'node_modules', PACKAGE_NAME, CONTROL_MODULE);
        fs.writeFileSync(target, mutateHostImport(fs.readFileSync(target, 'utf8')));
    }

    const launch = [
        '--extensions-dir',
        extensionsDir,
        '--user-data-dir',
        userDataDir,
        '--extensionDevelopmentPath',
        extensionDir,
        '--extensionTestsPath',
        path.join(extensionDir, 'tests.cjs'),
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
        '--disable-telemetry',
        '--new-window',
    ];
    if (process.platform === 'linux') {
        launch.push('--ozone-platform=x11', '--disable-gpu');
        if (setup.env.GITHUB_ACTIONS === 'true') {
            launch.push('--no-sandbox');
        }
    }
    let launchError = '';
    try {
        await runProcess(setup.executable, launch, {
            env: {
                ...setup.env,
                DOCUMENTDB_HOST_PROBE_RESULT: resultPath,
                DOCUMENTDB_HOST_PROBE_TRACE: tracePath,
                DOCUMENTDB_HOST_PROBE_EXTENSION: `${PUBLISHER}.unbundled-host-probe-${variant.name}`,
            },
            log: logPath,
            timeout: variant.timeoutMs,
        });
    } catch (error) {
        launchError = error instanceof Error ? error.message : String(error);
    }
    const receiptText = readIfPresent(resultPath);
    const verdict = judge(
        variant,
        {
            receipt: receiptText ? JSON.parse(receiptText) : undefined,
            trace: readIfPresent(tracePath).split('\n').filter(Boolean),
            launchError,
            timedOut: /^Timed out after/.test(launchError),
            unresponsive: UNRESPONSIVE.test(readIfPresent(logPath)),
        },
        extensionDir,
    );
    return { verdict, install };
}

/** @param {string[]} args @returns {Promise<void>} */
async function main(args) {
    const options = parseArguments(args);
    const emit = (/** @type {string} */ text) => console.log(text);
    const started = Date.now();
    await requireDisplay(process.env, process.platform);

    const rootManifest = JSON.parse(fs.readFileSync(path.join(CHECKOUT, 'package.json'), 'utf8'));
    const vscodeVersion = options.vscodeVersion ?? minimumVSCodeVersion(rootManifest.engines.vscode);
    if (options.build) {
        const build = run('npm', ['run', 'build', '--workspace', PACKAGE_DIR], CHECKOUT);
        if (build.status !== 0) {
            throw new Error(`Building ${PACKAGE_DIR} failed:\n${build.output}`);
        }
    }

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-host-probe-'));
    emit(`Unbundled host probe: VS Code ${vscodeVersion}; artifacts in ${temporary}`);
    let passed = false;
    try {
        const pack = run(
            'npm',
            ['pack', '--json', '--pack-destination', temporary, '--workspace', PACKAGE_DIR],
            CHECKOUT,
        );
        if (pack.status !== 0) {
            throw new Error(`npm pack failed:\n${pack.output}`);
        }
        const [packed] = JSON.parse(pack.stdout);
        if (packed.name !== PACKAGE_NAME) {
            throw new Error(`npm pack produced ${packed.name}, expected ${PACKAGE_NAME}.`);
        }
        const packageManifest = JSON.parse(fs.readFileSync(path.join(CHECKOUT, PACKAGE_DIR, 'package.json'), 'utf8'));
        const lock = JSON.parse(fs.readFileSync(path.join(CHECKOUT, 'package-lock.json'), 'utf8'));
        const peers = requiredPeers(packageManifest);
        const specs = [path.join(temporary, packed.filename), ...lockedSpecs(lock, peers)];
        emit(
            `Unbundled host probe: ${packed.filename} (${packed.entryCount} files), peers ${peers.join(', ')} as locked`,
        );

        const sdk = require('@vscode/test-electron');
        const executable = await sdk.downloadAndUnzipVSCode({
            version: vscodeVersion,
            cachePath: path.join(CHECKOUT, '.vscode-test'),
        });
        const env = { ...process.env, VSCODE_SKIP_PRELAUNCH: '1', DONT_PROMPT_WSL_INSTALL: '1' };
        for (const name of [
            'IS_BUNDLE',
            'VSCODE_DEV',
            'VSCODE_IPC_HOOK_CLI',
            'ELECTRON_RUN_AS_NODE',
            'NODE_PATH',
            'NODE_OPTIONS',
        ]) {
            delete env[name];
        }

        const results = [];
        for (const variant of VARIANTS) {
            const variantStarted = Date.now();
            const { verdict, install } = await runVariant(variant, {
                temporary,
                specs,
                vscodeVersion,
                executable,
                env,
                emit,
            });
            results.push({
                variant: variant.name,
                expected: variant.expect.status,
                ...verdict,
                install,
                seconds: (Date.now() - variantStarted) / 1000,
            });
        }

        emit('');
        emit(`Unbundled host probe results (VS Code ${vscodeVersion}, ${PACKAGE_NAME}@${packed.version}):`);
        for (const [index, result] of results.entries()) {
            emit(
                `  ${result.variant}: ${result.outcome} (expected ${result.expected}) in ${result.seconds.toFixed(1)}s, ${result.install}`,
            );
            emit(`    ${VARIANTS[index].description}`);
            emit(`    ${result.detail}`);
            if (!result.asExpected) {
                emit(`    UNEXPECTED: ${result.problem}`);
            }
        }
        fs.writeFileSync(path.join(temporary, 'report.json'), JSON.stringify({ vscodeVersion, results }, null, 2));
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        const mismatched = results.filter((result) => !result.asExpected).map((result) => result.variant);
        if (mismatched.length > 0) {
            throw new Error(
                `${mismatched.join(', ')} did not match the expectation after ${seconds}s. Artifacts kept: ${temporary}`,
            );
        }
        passed = true;
        emit(
            `UNBUNDLED HOST PROBE PASS in ${seconds}s: import() and ESM imports of /host work unbundled; ` +
                'require() deadlocks the extension host as documented; the control failed as expected.',
        );
    } finally {
        if (passed && !options.keep) {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`UNBUNDLED HOST PROBE FAIL: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    VARIANTS,
    CONTROL_SPECIFIER,
    REQUIRE_HOST,
    parseArguments,
    requiredPeers,
    lockedSpecs,
    probeManifest,
    toEsm,
    mutateHostImport,
    judge,
};
