/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const {
    TARGET_ID,
    LATE_COMMANDS,
    INJECTION_MARKER,
    minimumVSCodeVersion,
    assertInstalledPath,
    assertLateCommands,
    inspectLogs,
    assertCleanLogs,
    isInside,
} = require('./checks.cjs');

const CHECKOUT = path.resolve(__dirname, '../../..');

class ActivationFailure extends Error {
    /**
     * @param {string[]} failures @param {string} artifacts @param {boolean} probePassed
     * @param {import('./checks.cjs').LogReport | undefined} logReport @param {boolean} logGateRejected
     */
    constructor(failures, artifacts, probePassed, logReport, logGateRejected) {
        super(`${failures.join('\n')}\nL3 artifacts retained: ${artifacts}`);
        this.name = 'ActivationFailure';
        this.probePassed = probePassed;
        this.logReport = logReport;
        this.logGateRejected = logGateRejected;
    }
}

/** @typedef {{ vsix: string, injectError: boolean, keepArtifacts: boolean }} Options */
/**
 * @param {string[]} args @param {{ name: string, version: string }} manifest @param {string} checkout
 * @returns {Options}
 */
function parseArguments(args, manifest, checkout) {
    const flags = new Set(['--inject-error', '--keep-artifacts']);
    const paths = args.filter((arg) => !flags.has(arg));
    if (paths.length > 1 || paths.some((arg) => arg.startsWith('-'))) {
        throw new Error('Usage: npm run test:vsix -- [path-to-vsix] [--inject-error] [--keep-artifacts]');
    }
    return {
        vsix: path.resolve(checkout, paths[0] ?? `${manifest.name}-${manifest.version}.vsix`),
        injectError: args.includes('--inject-error'),
        keepArtifacts: args.includes('--keep-artifacts'),
    };
}

/**
 * Electron is explicitly launched on X11 on Linux, including under xvfb-run. A DISPLAY variable
 * alone is not proof that its server is reachable (for example stale WSLg sockets).
 * @param {NodeJS.ProcessEnv} environment @param {string} platform @returns {Promise<void>}
 */
async function requireDisplay(environment, platform) {
    if (platform !== 'linux') {
        return;
    }
    const display = environment.DISPLAY;
    const match = display && /^(.*):(\d+)(?:\.\d+)?$/.exec(display);
    const help = 'L3 requires a working X11 display. In CI run: xvfb-run -a npm run test:vsix -- <production.vsix>. No system packages were installed.';
    if (!match) {
        throw new Error(`${help} DISPLAY=${JSON.stringify(display)}`);
    }
    const host = match[1];
    // Like Xlib on Linux, try the abstract socket before the filesystem one: a user-local Xvfb
    // cannot create /tmp/.X11-unix/X<n> when that directory is a read-only (WSLg) mount.
    const candidates = !host || host === 'unix'
        ? [{ path: `\0/tmp/.X11-unix/X${match[2]}` }, { path: `/tmp/.X11-unix/X${match[2]}` }]
        : [{ host, port: 6000 + Number(match[2]) }];
    /** @type {Error | undefined} */
    let lastError;
    for (const candidate of candidates) {
        try {
            await new Promise((resolve, reject) => {
                const socket = net.createConnection(candidate);
                socket.setTimeout(1500);
                socket.once('connect', () => {
                    socket.destroy();
                    resolve(undefined);
                });
                socket.once('error', (error) => reject(new Error(`${help} Cannot reach DISPLAY=${display}: ${error.message}`)));
                socket.once('timeout', () => {
                    socket.destroy();
                    reject(new Error(`${help} Timed out reaching DISPLAY=${display}.`));
                });
            });
            return;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    throw lastError;
}

/**
 * Capture stdout/stderr to a retained artifact, bound hangs, and kill only the child we started.
 * @param {string} executable @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv, log: string, timeout: number }} options @returns {Promise<void>}
 */
async function runProcess(executable, args, options) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(options.log);
        const child = spawn(executable, args, {
            env: options.env,
            shell: process.platform === 'win32' && /\.cmd$/i.test(executable),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let timedOut = false;
        let spawnError;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
        }, options.timeout);
        let escalation;
        child.stdout.on('data', (chunk) => {
            output.write(chunk);
            process.stdout.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            output.write(chunk);
            process.stderr.write(chunk);
        });
        output.on('error', (error) => {
            spawnError = error;
            child.kill('SIGTERM');
        });
        child.once('error', (error) => {
            spawnError = error;
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            clearTimeout(escalation);
            output.end(() => {
                if (spawnError) {
                    reject(spawnError);
                } else if (timedOut || code !== 0) {
                    reject(new Error(
                        `${timedOut ? `Timed out after ${options.timeout}ms` : `Exit ${code}, signal ${signal}`} running ${executable}. See ${options.log}.`,
                    ));
                } else {
                    resolve(undefined);
                }
            });
        });
    });
}

/** @param {string} extensionsDir @returns {{ directory: string, manifest: { main: string, type?: string } }} */
function findInstalledExtension(extensionsDir) {
    const matches = fs.readdirSync(extensionsDir, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory()) {
            return [];
        }
        const directory = path.join(extensionsDir, entry.name);
        const manifestPath = path.join(directory, 'package.json');
        if (!fs.existsSync(manifestPath)) {
            return [];
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return `${manifest.publisher}.${manifest.name}` === TARGET_ID ? [{ directory, manifest }] : [];
    });
    if (matches.length !== 1 || typeof matches[0].manifest.main !== 'string') {
        throw new Error(`Expected exactly one installed ${TARGET_ID} with a main entry; found ${matches.length}.`);
    }
    return matches[0];
}

/**
 * Change only the temporary installed artifact. After the final command has really registered,
 * throw inside initialization. The product's real telemetry wrapper must swallow and log it;
 * activation and late-command assertions can still pass, but the post-run log check must fail.
 * @param {string} directory @param {{ main: string, type?: string }} manifest @returns {void}
 */
function injectSwallowedError(directory, manifest) {
    const installedRequire = createRequire(path.join(directory, 'package.json'));
    const entry = fs.realpathSync(installedRequire.resolve(path.resolve(directory, manifest.main)));
    if (!isInside(fs.realpathSync(directory), entry)) {
        throw new Error(`Cannot mutate an activation entry outside the installed VSIX: ${entry}`);
    }
    const source = fs.readFileSync(entry, 'utf8');
    if (source.startsWith('#!')) {
        throw new Error('The L3 negative-control injector does not support a shebang activation entry.');
    }
    const esm = entry.endsWith('.mjs') || (manifest.type === 'module' && !entry.endsWith('.cjs'));
    const loader = esm
        ? 'import { createRequire as __documentdbL3Require } from "node:module"; const __documentdbL3VSCode = __documentdbL3Require(import.meta.url)("vscode");'
        : 'const __documentdbL3VSCode = require("vscode");';
    const prefix = `${loader}
const __documentdbL3Register = __documentdbL3VSCode.commands.registerCommand;
__documentdbL3VSCode.commands.registerCommand = function (...args) {
    const registration = __documentdbL3Register.apply(this, args);
    if (args[0] === ${JSON.stringify(LATE_COMMANDS[LATE_COMMANDS.length - 1])}) {
        __documentdbL3VSCode.commands.registerCommand = __documentdbL3Register;
        throw new Error(${JSON.stringify(INJECTION_MARKER)});
    }
    return registration;
};
`;
    fs.writeFileSync(entry, prefix + source);
}

/** @param {string} resultPath @param {string} installed @param {string} extensionsDir @param {string} checkout @returns {void} */
function verifyProbeResult(resultPath, installed, extensionsDir, checkout) {
    if (!fs.existsSync(resultPath)) {
        throw new Error(`The probe did not write its success receipt at ${resultPath}.`);
    }
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (
        result.extensionId !== TARGET_ID ||
        result.active !== true ||
        typeof result.extensionPath !== 'string' ||
        !Array.isArray(result.commands) ||
        !result.commands.every((command) => typeof command === 'string')
    ) {
        throw new Error(`Invalid activation probe receipt at ${resultPath}.`);
    }
    assertInstalledPath(result.extensionPath, installed, extensionsDir, checkout);
    assertLateCommands(result.commands);
}

/** @typedef {{
 * downloadAndUnzipVSCode: (options: { version: string, cachePath: string }) => Promise<string>,
 * resolveCliArgsFromVSCodeExecutablePath: (executable: string, options: { reuseMachineInstall: boolean }) => string[]
 * }} ElectronSDK */
/** @typedef {{
 * checkout: string, platform: string, env: NodeJS.ProcessEnv,
 * sdk: () => ElectronSDK,
 * display: typeof requireDisplay, process: typeof runProcess,
 * logs: typeof inspectLogs, emit: (text: string) => void
 * }} Dependencies */

/**
 * Injectable boundaries make the entire install/launch/post-exit-log sequence testable offline.
 * @param {Options} options @param {Dependencies} dependencies @returns {Promise<void>}
 */
async function runActivation(options, dependencies) {
    if (!fs.existsSync(options.vsix) || !fs.statSync(options.vsix).isFile()) {
        throw new Error(`VSIX not found: ${options.vsix}. Build a production VSIX first or pass its path.`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dependencies.checkout, 'package.json'), 'utf8'));
    const version = minimumVSCodeVersion(manifest.engines.vscode);
    await dependencies.display(dependencies.env, dependencies.platform);
    const sdk = dependencies.sdk();
    dependencies.emit(`L3: VS Code ${version} (minimum engines.vscode); installed artifact ${options.vsix}`);
    const executable = await sdk.downloadAndUnzipVSCode({
        version,
        cachePath: path.join(dependencies.checkout, '.vscode-test'),
    });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-l3-'));
    const extensionsDir = path.join(temporary, 'extensions');
    const userDataDir = path.join(temporary, 'user-data');
    const resultPath = path.join(temporary, 'probe-result.json');
    fs.mkdirSync(extensionsDir);
    fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'User/settings.json'), JSON.stringify({
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'workbench.enableExperiments': false,
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'window.restoreWindows': 'none',
    }));
    dependencies.emit(`L3 artifacts: ${temporary}`);
    let passed = false;
    try {
        const profileArgs = ['--extensions-dir', extensionsDir, '--user-data-dir', userDataDir];
        const env = { ...dependencies.env, VSCODE_SKIP_PRELAUNCH: '1', DONT_PROMPT_WSL_INSTALL: '1' };
        // Never inherit development flags that could make the product activate differently.
        delete env.IS_BUNDLE;
        delete env.VSCODE_DEV;
        delete env.VSCODE_IPC_HOOK_CLI;
        delete env.ELECTRON_RUN_AS_NODE;
        const [cli, ...cliArgs] = sdk.resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
        await dependencies.process(cli, [...cliArgs, ...profileArgs, '--install-extension', options.vsix, '--force'], {
            env,
            log: path.join(temporary, 'install.log'),
            timeout: 120000,
        });
        const installed = findInstalledExtension(extensionsDir);
        assertInstalledPath(installed.directory, installed.directory, extensionsDir, dependencies.checkout);
        if (options.injectError) {
            injectSwallowedError(installed.directory, installed.manifest);
        }
        const probe = path.join(__dirname, 'probe');
        const args = [
            ...profileArgs,
            '--extensionDevelopmentPath', probe,
            '--extensionTestsPath', path.join(probe, 'tests.cjs'),
            '--disable-workspace-trust',
            '--skip-welcome',
            '--skip-release-notes',
            '--disable-updates',
            '--disable-telemetry',
            '--log', 'trace',
            '--new-window',
        ];
        if (dependencies.platform === 'linux') {
            args.push('--ozone-platform=x11', '--disable-gpu');
            if (dependencies.env.GITHUB_ACTIONS === 'true') {
                args.push('--no-sandbox');
            }
        }
        const failures = [];
        let probePassed = false;
        let logGateRejected = false;
        /** @type {import('./checks.cjs').LogReport | undefined} */
        let logReport;
        try {
            await dependencies.process(executable, args, {
                env: {
                    ...env,
                    DOCUMENTDB_L3_INSTALLED_PATH: installed.directory,
                    DOCUMENTDB_L3_EXTENSIONS_DIR: extensionsDir,
                    DOCUMENTDB_L3_CHECKOUT: dependencies.checkout,
                    DOCUMENTDB_L3_RESULT: resultPath,
                },
                log: path.join(temporary, 'electron.log'),
                timeout: 120000,
            });
            verifyProbeResult(resultPath, installed.directory, extensionsDir, dependencies.checkout);
            probePassed = true;
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }
        // Read real files only after the Electron process has exited, also on a failed probe.
        try {
            const report = dependencies.logs(userDataDir, installed.directory);
            logReport = report;
            fs.writeFileSync(path.join(temporary, 'log-report.json'), JSON.stringify(report, null, 2));
            dependencies.emit(
                `L3 logs: ${report.hostLogs.length} extension host, ${report.outputLogs.length} DocumentDB output. ` +
                `${report.unrelatedHostErrors.length} unrelated/unattributed host errors excluded (see log-report.json).`,
            );
            for (const error of report.unrelatedHostErrors) {
                dependencies.emit(`EXCLUDED host error ${error.file}:${error.line}\n${error.text}`);
            }
            if (options.injectError && !report.errors.some((error) => error.text.includes(INJECTION_MARKER))) {
                failures.push(`Negative control did not produce ${INJECTION_MARKER} in actual DocumentDB/host logs.`);
            }
            logGateRejected = report.hostLogs.length > 0 && report.outputLogs.length > 0 && report.errors.length > 0;
            assertCleanLogs(report);
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }
        if (failures.length) {
            throw new ActivationFailure(failures, temporary, probePassed, logReport, logGateRejected);
        }
        passed = true;
        dependencies.emit('L3 PASS: installed VSIX activated, final commands registered, and DocumentDB activation logs are clean.');
    } finally {
        if (passed && !options.keepArtifacts) {
            fs.rmSync(temporary, { recursive: true });
        }
    }
}

/**
 * An arbitrary nonzero exit is not proof. Require a successful installed-path/activation/command
 * receipt and complete actual logs whose only attributed errors are the injected failure.
 * @param {Options} options @param {Dependencies} dependencies @returns {Promise<void>}
 */
async function runProof(options, dependencies) {
    try {
        await runActivation({ ...options, injectError: true, keepArtifacts: true }, dependencies);
    } catch (error) {
        if (
            error instanceof ActivationFailure &&
            error.probePassed &&
            error.logGateRejected &&
            error.logReport &&
            error.logReport.hostLogs.length > 0 &&
            error.logReport.outputLogs.length > 0 &&
            error.logReport.errors.length > 0 &&
            error.logReport.errors.every((finding) => finding.text.includes(INJECTION_MARKER))
        ) {
            dependencies.emit(`L3 PROOF PASS: activation and final commands passed; actual logs rejected ${INJECTION_MARKER}.`);
            return;
        }
        throw error;
    }
    throw new Error('L3 negative control unexpectedly passed; the activation log gate did not reject the injected failure.');
}

/** @param {string[]} args @param {boolean} [prove] @returns {Promise<void>} */
async function main(args, prove = false) {
    const manifest = JSON.parse(fs.readFileSync(path.join(CHECKOUT, 'package.json'), 'utf8'));
    const run = prove ? runProof : runActivation;
    await run(parseArguments(args, manifest, CHECKOUT), {
        checkout: CHECKOUT,
        platform: process.platform,
        env: process.env,
        sdk: () => require('@vscode/test-electron'),
        display: requireDisplay,
        process: runProcess,
        logs: inspectLogs,
        emit: (text) => console.log(text),
    });
}

module.exports = {
    parseArguments,
    requireDisplay,
    runProcess,
    findInstalledExtension,
    injectSwallowedError,
    verifyProbeResult,
    runActivation,
    runProof,
    main,
};
