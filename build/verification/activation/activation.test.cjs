/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
    TARGET_ID,
    LATE_COMMANDS,
    INJECTION_MARKER,
    minimumVSCodeVersion,
    assertInstalledPath,
    assertLateCommands,
    recognizeLogs,
    inspectLogs,
    assertCleanLogs,
} = require('./checks.cjs');
const { parseArguments, requireDisplay, runProcess, runActivation, runProof } = require('./runner.cjs');

/** @param {import('node:test').TestContext} context @returns {string} */
function temporaryDirectory(context) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-l3-unit-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

/** @param {string} text @param {string} [file] @returns {ReturnType<typeof recognizeLogs>} */
function recognized(text, file = 'logs/exthost1/output_logging/1-DocumentDB for VS Code.log') {
    return recognizeLogs([
        { file: 'logs/exthost1/exthost.log', contents: '2026-10-01 12:00:00 [info] Extension host started' },
        { file, contents: text },
    ], '/isolated/extensions/ms-azuretools.vscode-documentdb-0.10.2');
}

test('pins the exact minimum instead of stable, a cached newer release, or the probe engine', () => {
    for (const engine of ['^1.105.0', '>=1.105.0', '1.105.0']) {
        assert.equal(minimumVSCodeVersion(engine), '1.105.0');
    }
    for (const engine of ['stable', '^1.105', '>=1.105.0 <2', '*', '^1.105.0 || ^1.108.0']) {
        assert.throws(() => minimumVSCodeVersion(engine), /Cannot pin/);
    }
});

test('parses the future npm entry point, default artifact, and negative-control option', () => {
    const manifest = { name: 'vscode-documentdb', version: '0.10.2' };
    assert.deepEqual(parseArguments([], manifest, '/checkout'), {
        vsix: '/checkout/vscode-documentdb-0.10.2.vsix', injectError: false, keepArtifacts: false,
    });
    assert.deepEqual(parseArguments(['artifacts/prod.vsix', '--inject-error', '--keep-artifacts'], manifest, '/checkout'), {
        vsix: '/checkout/artifacts/prod.vsix', injectError: true, keepArtifacts: true,
    });
    assert.throws(() => parseArguments(['--unknown'], manifest, '/checkout'), /Usage/);
    assert.throws(() => parseArguments(['a.vsix', 'b.vsix'], manifest, '/checkout'), /Usage/);
});

test('rejects the checkout, sibling prefixes, mismatched installs, and symlink escapes', (context) => {
    const root = temporaryDirectory(context);
    const checkout = path.join(root, 'checkout');
    const installedRoot = path.join(root, 'extensions');
    const installed = path.join(installedRoot, 'target');
    const sibling = path.join(root, 'extensions-other', 'target');
    const other = path.join(installedRoot, 'other');
    for (const directory of [checkout, installed, sibling, other]) {
        fs.mkdirSync(directory, { recursive: true });
    }
    assert.doesNotThrow(() => assertInstalledPath(installed, installed, installedRoot, checkout));
    for (const actual of [checkout, sibling, other]) {
        assert.throws(() => assertInstalledPath(actual, installed, installedRoot, checkout), /not the isolated installed/);
    }
    const escaped = path.join(installedRoot, 'linked-checkout');
    fs.symlinkSync(checkout, escaped, 'junction');
    assert.throws(() => assertInstalledPath(escaped, escaped, installedRoot, checkout), /not the isolated installed/);
});

test('requires late registrations including the non-contributed internal export command', () => {
    assert.doesNotThrow(() => assertLateCommands(LATE_COMMANDS));
    assert.throws(() => assertLateCommands(LATE_COMMANDS.slice(1)), /internal.exportDocuments/);
    assert.throws(() => assertLateCommands([]), /final command registrations/);
});

test('catches swallowed telemetry failures logged at info severity and optional startup failures', () => {
    for (const text of [
        '2026-10-01 12:00:00 [info] Error: clustersExtension.activate initialization failed',
        '2026-10-01 12:00:00 [info] Welcome screen error: command not found',
        '2026-10-01 12:00:00 [error] Cannot initialize',
        '2026-10-01 12:00:00 [info] Unhandled promise rejection',
        `2026-10-01 12:00:00 [info] Error: ${INJECTION_MARKER}`,
    ]) {
        const report = recognized(text);
        assert.equal(report.errors.length, 1);
        assert.throws(() => assertCleanLogs(report), /DocumentDB activation errors/);
    }
    assert.doesNotThrow(() => assertCleanLogs(recognized('2026-10-01 12:00:00 [info] Showing welcome screen...')));
});

test('trace initData manifest and debug diagnostic error words are metadata, not error records', () => {
    const manifest = JSON.stringify({
        extensions: [{
            identifier: TARGET_ID,
            description: 'Error reporting and failure diagnostics',
            commands: ['documentdb.error', 'documentdb.failure'],
        }],
    });
    for (const severity of ['trace', 'debug']) {
        const report = recognized(`2026-10-02 06:59:45.329 [${severity}] initData ${manifest}`, 'exthost.log');
        assert.deepEqual(report.errors, []);
        assert.deepEqual(report.unrelatedHostErrors, []);
    }
    const actual = recognized(`2026-10-02 06:59:46.000 [error] ${TARGET_ID} failed; diagnostic text "[trace]"`, 'exthost.log');
    assert.equal(actual.errors.length, 1);
    assert.throws(() => assertCleanLogs(recognized(`2026-10-02 06:59:46.000 [info] Error: ${INJECTION_MARKER}`)), /DocumentDB activation errors/);
});

test('captured successful-run teardown retains the real SchemaStore disposed-channel lifecycle error', () => {
    const host = [
        '2026-10-02 06:59:47.779 [info] Test runner finished successfully.',
        '2026-10-02 06:59:47.783 [info] Extension host terminating: renderer closed the MessagePort',
        `2026-10-02 06:59:47.797 [error] An error occurred when disposing the subscriptions for extension '${TARGET_ID}':`,
        '2026-10-02 06:59:47.797 [error] Error: Channel has been closed',
        '    at Object.appendLine (file:///cache/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:121:2570)',
        `    at AzExtLogOutputChannel.appendLine (/isolated/extensions/${TARGET_ID}-0.11.0/main.js:2:362407)`,
        `    at SchemaStore.logStats (/isolated/extensions/${TARGET_ID}-0.11.0/main.js:2:2174191)`,
        `    at SchemaStore.dispose (/isolated/extensions/${TARGET_ID}-0.11.0/main.js:2:2177230)`,
        '    at SZ.terminate (file:///cache/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:118:10178)',
        '2026-10-02 06:59:47.798 [info] Extension host with pid 3337 exiting with code 0',
    ].join('\n');
    const report = recognizeLogs([
        { file: 'exthost.log', contents: host },
        { file: 'DocumentDB for VS Code.log', contents: '2026-10-02 06:59:46.280 [info] Showing welcome screen...' },
    ], `/isolated/extensions/${TARGET_ID}-0.11.0`);
    assert.equal(report.errors.length, 2);
    assert.equal(report.errors[0].line, 3);
    assert.match(report.errors[1].text, /SchemaStore.dispose/);
    assert.throws(() => assertCleanLogs(report), /Channel has been closed/);

    const activation = recognized(host.split('\n').slice(2).join('\n'), 'exthost.log');
    assert.equal(activation.errors.length, 2, 'the same error before termination must also remain blocking');
});

test('attributes multiline host stacks, Windows paths, and activation errors without an installed path', () => {
    for (const text of [
        '2026-10-01 12:00:00 [error] TypeError: cannot initialize\n    at /isolated/extensions/ms-azuretools.vscode-documentdb-0.10.2/dist/main.js:1:2',
        '2026-10-01 12:00:00 [error] Activating extension ms-azuretools.vscode-documentdb failed',
        '2026-10-01 12:00:00 [error] SyntaxError: invalid\n    at C:\\isolated\\extensions\\ms-azuretools.vscode-documentdb-0.10.2\\dist\\main.js',
    ]) {
        const report = recognized(text, 'logs/exthost1/exthost.log');
        assert.equal(report.errors.length, 1);
        assert.equal(report.errors[0].line, 1);
    }
});

test('explicitly excludes unrelated and unattributed VS Code host errors, not DocumentDB errors', () => {
    const report = recognizeLogs([
        {
            file: 'exthost1/exthost.log',
            contents: [
                '2026-10-01 12:00:00 [error] Activating vscode.git failed',
                '2026-10-01 12:00:01 [error] ECONNREFUSED marketplace service',
                `2026-10-01 12:00:02 [error] Activating ${TARGET_ID} failed`,
            ].join('\n'),
        },
        { file: 'renderer.log', contents: '2026-10-01 12:00:00 [error] GPU unavailable' },
        { file: 'exthost1/output/1-Other Extension.log', contents: 'Error: unrelated' },
        { file: 'exthost1/output/2-DocumentDB Query Playground Output.log', contents: 'Error: initialization failed' },
    ], '/installed');
    assert.equal(report.errors.length, 2);
    assert.equal(report.unrelatedHostErrors.length, 2);
    assert.equal(report.outputLogs.length, 1);
});

test('missing actual logs cannot produce a success-shaped fallback', (context) => {
    const root = temporaryDirectory(context);
    assert.throws(() => inspectLogs(root, '/installed'), /produced no logs/);
    assert.throws(() => assertCleanLogs(recognizeLogs([], '/installed')), /Missing actual activation logs/);
    const hostOnly = recognized('2026-10-01 12:00:00 [info] host ready', 'exthost.log');
    assert.throws(() => assertCleanLogs(hostOnly), /DocumentDB output=0/);
});

test('Linux without DISPLAY fails loudly before network download; non-Linux needs no X11', async () => {
    await assert.rejects(requireDisplay({}, 'linux'), /xvfb-run.*No system packages were installed/);
    await assert.rejects(requireDisplay({ DISPLAY: 'invalid' }, 'linux'), /DISPLAY="invalid"/);
    await assert.rejects(requireDisplay({ DISPLAY: ':98765' }, 'linux'), /Cannot reach DISPLAY/);
    await requireDisplay({}, 'darwin');
    await requireDisplay({}, 'win32');
});

test('process wrapper captures output, reports nonzero exits, missing executables, and timeouts', async (context) => {
    const root = temporaryDirectory(context);
    const log = path.join(root, 'process.log');
    const options = { env: process.env, log, timeout: 10000 };
    await runProcess(process.execPath, ['-e', 'console.log("offline process success")'], options);
    assert.match(fs.readFileSync(log, 'utf8'), /offline process success/);
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], options), /Exit 7/);
    await assert.rejects(runProcess(path.join(root, 'no-executable'), [], options), /ENOENT/);
    await assert.rejects(
        runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeout: 30 }),
        /Timed out/,
    );
});

test('actual probe writes a receipt only after installed-path, active-state, and late-command checks', async (context) => {
    const root = temporaryDirectory(context);
    const checkout = path.join(root, 'checkout');
    const extensions = path.join(root, 'extensions');
    const installed = path.join(extensions, 'target');
    fs.mkdirSync(checkout);
    fs.mkdirSync(installed, { recursive: true });
    const result = path.join(root, 'receipt.json');
    const events = [];
    const target = {
        extensionPath: installed,
        isActive: false,
        activate: async () => {
            events.push('activate');
            target.isActive = true;
        },
    };
    let discovered = true;
    let commands = LATE_COMMANDS;
    const probeModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'probe/tests.cjs'), 'utf8'), {
        module: probeModule,
        require: (name) => {
            if (name === 'node:fs') {
                return fs;
            }
            if (name === '../checks.cjs') {
                return require('./checks.cjs');
            }
            assert.equal(name, 'vscode');
            return {
                extensions: {
                    getExtension: (id) => {
                        assert.equal(id, TARGET_ID);
                        return discovered ? target : undefined;
                    },
                },
                commands: {
                    getCommands: async () => {
                        events.push('commands');
                        return commands;
                    },
                },
            };
        },
        process: {
            env: {
                DOCUMENTDB_L3_INSTALLED_PATH: installed,
                DOCUMENTDB_L3_EXTENSIONS_DIR: extensions,
                DOCUMENTDB_L3_CHECKOUT: checkout,
                DOCUMENTDB_L3_RESULT: result,
            },
        },
        setTimeout: (callback, milliseconds) => {
            assert.equal(milliseconds, 1500);
            callback();
        },
    });
    await probeModule.exports.run();
    assert.deepEqual(events, ['activate', 'commands']);
    assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')).active, true);
    fs.unlinkSync(result);

    commands = [];
    await assert.rejects(probeModule.exports.run(), /final command registrations/);
    target.extensionPath = checkout;
    await assert.rejects(probeModule.exports.run(), /not the isolated installed/);
    target.extensionPath = installed;
    target.activate = async () => {
        target.isActive = false;
    };
    await assert.rejects(probeModule.exports.run(), /did not become active/);
    discovered = false;
    await assert.rejects(probeModule.exports.run(), /was not discovered/);
    assert.equal(fs.existsSync(result), false);
});

/**
 * The fake host evaluates the mutated artifact, not a fabricated log. This exercises real command
 * interception and a telemetry-shaped catch that returns an API despite initialization failure.
 * @param {import('node:test').TestContext} context
 * @param {{ launchFailure?: boolean, missingCommand?: boolean, wrongReceipt?: boolean, missingLogs?: boolean, installFailure?: boolean, displayFailure?: boolean }} [behavior]
 * @returns {{ options: import('./runner.cjs').Options, dependencies: import('./runner.cjs').Dependencies, events: string[], messages: string[], artifact: () => string }}
 */
function fixture(context, behavior = {}) {
    const checkout = path.join(temporaryDirectory(context), 'checkout');
    fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ engines: { vscode: '^1.105.0' } }));
    const vsix = path.join(checkout, 'production.vsix');
    fs.writeFileSync(vsix, 'offline fixture; installation is mocked');
    const events = [];
    const messages = [];
    let artifact = '';
    context.after(() => {
        if (artifact) {
            fs.rmSync(artifact, { recursive: true, force: true });
        }
    });
    return {
        options: { vsix, injectError: false, keepArtifacts: true },
        events,
        messages,
        artifact: () => artifact,
        dependencies: {
            checkout,
            platform: 'linux',
            env: { IS_BUNDLE: 'inherited-dev-value', VSCODE_DEV: '1', DONT_PROMPT_WSL_INSTALL: '0' },
            display: async () => {
                events.push('display');
                if (behavior.displayFailure) {
                    throw new Error('No display; use xvfb-run');
                }
            },
            sdk: () => ({
                downloadAndUnzipVSCode: async (options) => {
                    events.push('download');
                    assert.equal(options.version, '1.105.0');
                    assert.equal(options.cachePath, path.join(checkout, '.vscode-test'));
                    return '/downloaded/code';
                },
                resolveCliArgsFromVSCodeExecutablePath: (_executable, options) => {
                    assert.equal(options.reuseMachineInstall, true);
                    return ['/downloaded/bin/code'];
                },
            }),
            process: async (executable, args, options) => {
                assert.equal(options.env.IS_BUNDLE, undefined);
                assert.equal(options.env.VSCODE_DEV, undefined);
                assert.equal(options.env.DONT_PROMPT_WSL_INSTALL, '1');
                const extensionsDir = args[args.indexOf('--extensions-dir') + 1];
                const userDataDir = args[args.indexOf('--user-data-dir') + 1];
                assert.equal(args.filter((arg) => arg === '--extensions-dir').length, 1);
                artifact = path.dirname(extensionsDir);
                if (executable.endsWith('/bin/code')) {
                    events.push('install');
                    if (behavior.installFailure) {
                        throw new Error('installation failed');
                    }
                    assert.ok(args.includes(vsix));
                    assert.ok(!args.includes('--extensionDevelopmentPath'));
                    const installed = path.join(extensionsDir, 'ms-azuretools.vscode-documentdb-0.10.2');
                    fs.mkdirSync(installed);
                    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({
                        publisher: 'ms-azuretools', name: 'vscode-documentdb', main: './main.cjs',
                    }));
                    fs.writeFileSync(path.join(installed, 'main.cjs'), `
const vscode = require("vscode");
module.exports.activate = async function () {
    try {
        for (const command of ${JSON.stringify(LATE_COMMANDS)}) {
            vscode.commands.registerCommand(command, () => {});
        }
    } catch (error) {
        vscode.window.output.appendLog("Error: " + error.message);
    }
    return { apiVersion: "0.3.0" };
};
`);
                    return;
                }
                events.push('launch');
                assert.equal(args.filter((arg) => arg === '--extensionDevelopmentPath').length, 1);
                assert.equal(args[args.indexOf('--extensionDevelopmentPath') + 1], path.join(__dirname, 'probe'));
                assert.ok(!args.includes(checkout));
                assert.ok(!args.includes('--disable-extensions'));
                const registered = [];
                const output = [];
                const installed = options.env.DOCUMENTDB_L3_INSTALLED_PATH;
                const extensionModule = { exports: {} };
                const vscode = {
                    commands: {
                        registerCommand: (command) => {
                            registered.push(command);
                            return { dispose: () => {} };
                        },
                    },
                    window: { output: { appendLog: (message) => output.push(message) } },
                };
                vm.runInNewContext(fs.readFileSync(path.join(installed, 'main.cjs'), 'utf8'), {
                    module: extensionModule,
                    require: (name) => {
                        assert.equal(name, 'vscode');
                        return vscode;
                    },
                });
                await extensionModule.exports.activate();
                if (!behavior.missingLogs) {
                    const logs = path.join(userDataDir, 'logs/session/exthost1');
                    fs.mkdirSync(path.join(logs, 'output_logging'), { recursive: true });
                    fs.writeFileSync(path.join(logs, 'exthost.log'),
                        `2026-10-01 12:00:00 [info] Activated ${TARGET_ID}\n2026-10-01 12:00:01 [error] vscode.git unrelated failure`);
                    fs.writeFileSync(path.join(logs, 'output_logging/1-DocumentDB for VS Code.log'),
                        output.length ? output.map((message) => `2026-10-01 12:00:01 [info] ${message}`).join('\n')
                            : '2026-10-01 12:00:01 [info] Showing welcome screen...');
                }
                fs.writeFileSync(options.env.DOCUMENTDB_L3_RESULT, JSON.stringify({
                    extensionId: TARGET_ID,
                    extensionPath: behavior.wrongReceipt ? checkout : installed,
                    active: true,
                    commands: behavior.missingCommand ? registered.slice(1) : registered,
                }));
                if (behavior.launchFailure) {
                    throw new Error('extension host exited 1');
                }
            },
            logs: (userDataDir, installed) => {
                events.push('logs');
                return inspectLogs(userDataDir, installed);
            },
            emit: (text) => messages.push(text),
        },
    };
}

test('runner pins download, installs isolated VSIX, launches only probe, and reads logs after exit', async (context) => {
    const data = fixture(context);
    await runActivation(data.options, data.dependencies);
    assert.deepEqual(data.events, ['display', 'download', 'install', 'launch', 'logs']);
    assert.ok(data.messages.some((message) => message.includes('L3 PASS')));
    assert.ok(data.messages.some((message) => message.includes('1 unrelated/unattributed host errors excluded')));
    assert.ok(fs.existsSync(path.join(data.artifact(), 'log-report.json')));
});

test('only Linux GitHub Actions explicitly disables the Electron sandbox, for main and proof', async (context) => {
    for (const [platform, environment, expected] of [
        ['linux', {}, false],
        ['linux', { CI: 'true' }, false],
        ['linux', { GITHUB_ACTIONS: 'false' }, false],
        ['linux', { GITHUB_ACTIONS: '1' }, false],
        ['linux', { GITHUB_ACTIONS: 'true' }, true],
        ['darwin', { GITHUB_ACTIONS: 'true' }, false],
        ['win32', { GITHUB_ACTIONS: 'true' }, false],
    ]) {
        const data = fixture(context);
        data.dependencies.platform = platform;
        data.dependencies.env = { ...data.dependencies.env, ...environment };
        const process = data.dependencies.process;
        data.dependencies.process = async (executable, args, options) => {
            assert.equal(options.env.GITHUB_ACTIONS, environment.GITHUB_ACTIONS);
            assert.equal(options.env.CI, environment.CI);
            const sandboxArgs = args.filter((arg) => arg.startsWith('--') && arg.includes('sandbox'));
            assert.deepEqual(sandboxArgs, !executable.endsWith('/bin/code') && expected ? ['--no-sandbox'] : []);
            await process(executable, args, options);
        };
        await runActivation({ ...data.options, keepArtifacts: false }, data.dependencies);
        if (expected) {
            await runProof(data.options, data.dependencies);
        }
    }
});

test('negative mutation registers all late commands and returns API, but swallowed error fails log gate', async (context) => {
    const data = fixture(context);
    await assert.rejects(
        runActivation({ ...data.options, injectError: true }, data.dependencies),
        (error) => {
            assert.match(error.message, /DocumentDB activation errors/);
            assert.match(error.message, new RegExp(INJECTION_MARKER));
            assert.doesNotMatch(error.message, /final command registrations|did not produce/);
            return true;
        },
    );
    const receipt = JSON.parse(fs.readFileSync(path.join(data.artifact(), 'probe-result.json'), 'utf8'));
    assert.equal(receipt.active, true);
    assert.deepEqual(receipt.commands, LATE_COMMANDS);
    assert.ok(fs.existsSync(data.options.vsix));
    assert.deepEqual(data.events, ['display', 'download', 'install', 'launch', 'logs']);
});

test('negative control cannot pass if the marker is absent from the inspected error records', async (context) => {
    const data = fixture(context);
    const inspect = data.dependencies.logs;
    data.dependencies.logs = (userDataDir, installed) => ({
        ...inspect(userDataDir, installed),
        errors: [],
    });
    await assert.rejects(runActivation({ ...data.options, injectError: true }, data.dependencies), /did not produce/);
    assert.ok(!data.messages.some((message) => message.includes('L3 PASS')));
});

test('proof entry point accepts only the injected log-gate rejection after a successful probe', async (context) => {
    const data = fixture(context);
    await runProof(data.options, data.dependencies);
    assert.ok(data.messages.some((message) => message.includes('L3 PROOF PASS')));
    assert.ok(fs.existsSync(path.join(data.artifact(), 'log-report.json')));
    for (const [behavior, expected] of [
        [{ missingCommand: true }, /final command registrations/],
        [{ wrongReceipt: true }, /not the isolated installed/],
        [{ missingLogs: true }, /produced no logs/],
        [{ launchFailure: true }, /extension host exited 1/],
        [{ displayFailure: true }, /No display/],
        [{ installFailure: true }, /installation failed/],
    ]) {
        const broken = fixture(context, behavior);
        await assert.rejects(runProof(broken.options, broken.dependencies), expected);
        assert.ok(!broken.messages.some((message) => message.includes('L3 PROOF PASS')));
    }
});

test('proof rejects absent marker and unrelated DocumentDB failures, not just arbitrary nonzero exits', async (context) => {
    const absent = fixture(context);
    const inspectAbsent = absent.dependencies.logs;
    absent.dependencies.logs = (userDataDir, installed) => ({
        ...inspectAbsent(userDataDir, installed),
        errors: [],
    });
    await assert.rejects(runProof(absent.options, absent.dependencies), /did not produce/);

    const unrelated = fixture(context);
    const inspectUnrelated = unrelated.dependencies.logs;
    unrelated.dependencies.logs = (userDataDir, installed) => {
        const report = inspectUnrelated(userDataDir, installed);
        report.errors.push({ file: 'DocumentDB for VS Code.log', line: 2, text: 'Error: another initialization failure' });
        return report;
    };
    await assert.rejects(runProof(unrelated.options, unrelated.dependencies), /another initialization failure/);
    assert.ok(!unrelated.messages.some((message) => message.includes('L3 PROOF PASS')));
});

test('runner fails on missing commands, dev-path receipt, absent logs, and still inspects after host failure', async (context) => {
    for (const [behavior, expected] of [
        [{ missingCommand: true }, /final command registrations/],
        [{ wrongReceipt: true }, /not the isolated installed/],
        [{ missingLogs: true }, /produced no logs/],
        [{ launchFailure: true }, /extension host exited 1/],
    ]) {
        const data = fixture(context, behavior);
        await assert.rejects(runActivation(data.options, data.dependencies), expected);
        assert.equal(data.events.at(-1), 'logs');
        assert.ok(fs.existsSync(data.artifact()), 'failed-run artifacts retained');
    }
});

test('runner fails before download without display or VSIX, and never launches after failed installation', async (context) => {
    const headless = fixture(context, { displayFailure: true });
    await assert.rejects(runActivation(headless.options, headless.dependencies), /No display/);
    assert.deepEqual(headless.events, ['display']);
    const missing = fixture(context);
    await assert.rejects(runActivation({ ...missing.options, vsix: '/no-such-artifact.vsix' }, missing.dependencies), /VSIX not found/);
    assert.deepEqual(missing.events, []);
    const brokenInstall = fixture(context, { installFailure: true });
    await assert.rejects(runActivation(brokenInstall.options, brokenInstall.dependencies), /installation failed/);
    assert.deepEqual(brokenInstall.events, ['display', 'download', 'install']);
});

test('successful runs clean their own temporary install unless retention is requested', async (context) => {
    const data = fixture(context);
    await runActivation({ ...data.options, keepArtifacts: false }, data.dependencies);
    assert.equal(fs.existsSync(data.artifact()), false);
});
