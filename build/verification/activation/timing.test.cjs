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
const { TARGET_ID, LATE_COMMANDS } = require('./checks.cjs');
const { parseArguments, parseCodeLoadMs, parseActivateTelemetry, median, summarize, formatSummary, measureRun } = require('./timing.cjs');

/** @param {string} [kind] @returns {string[]} */
function activationLines(kind = 'cjs') {
    return [
        `2026-10-05 16:44:48.939 [info] ExtensionService#_doActivateExtension ${TARGET_ID}, startup: false, activationEvent: 'onStartupFinished'`,
        `2026-10-05 16:44:48.939 [trace] ExtensionService#loadModule [${kind}] -> file:///tmp/extensions/${TARGET_ID}-0.11.0/main`,
        `2026-10-05 16:44:49.317 [trace] ExtensionService#_callActivateOptional ${TARGET_ID}`,
    ];
}

/** @param {object} [measures] @param {string} [result] @returns {string} */
function telemetryLine(measures = { duration: 0.061, mainFileLoad: 0 }, result = 'Succeeded') {
    return `** TELEMETRY("vscode-documentdb/activate", 0.11.0) properties=${JSON.stringify({ result, nested: { message: 'test' } })}, measures=${JSON.stringify(measures)}`;
}

test('parses mandatory VSIX, default five runs, explicit runs, and optional JSON path', () => {
    assert.deepEqual(parseArguments(['baseline.vsix']), { vsix: path.resolve('baseline.vsix'), runs: 5 });
    assert.deepEqual(parseArguments(['baseline.vsix', '--runs', '2', '--json', 'timing.json']), {
        vsix: path.resolve('baseline.vsix'), runs: 2, json: path.resolve('timing.json'),
    });
    assert.equal(parseArguments(['baseline.vsix', '--json', 'timing.json', '--runs', '1']).runs, 1);
    for (const args of [[], ['--runs', '5'], ['a.vsix', 'b.vsix'], ['a.vsix', '--unknown'],
        ['a.vsix', '--runs'], ['a.vsix', '--json'], ['a.vsix', '--runs', '1', '--runs', '2']]) {
        assert.throws(() => parseArguments(args), /Usage/);
    }
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '2x', '9007199254740992']) {
        assert.throws(() => parseArguments(['a.vsix', '--runs', value]), /Usage/);
    }
});

for (const kind of ['cjs', 'esm']) {
    test(`parses ${kind} module loading and ignores other extensions and telemetry metadata`, () => {
        const unrelated = activationLines(kind).map((line) => line.replaceAll(TARGET_ID, 'other.extension'));
        const metadata = `2026-10-05 16:44:48.500 [trace] initData {"identifier":"${TARGET_ID}"}`;
        assert.equal(parseCodeLoadMs([metadata, ...unrelated, ...activationLines(kind)].join('\r\n')), 378);
    });
}

test('code loading crosses midnight with millisecond resolution', () => {
    const lines = activationLines().map((line, index) => line.replace(
        index === 2 ? '2026-10-05 16:44:49.317' : '2026-10-05 16:44:48.939',
        index === 2 ? '2026-10-06 00:00:00.317' : '2026-10-05 23:59:59.939',
    ));
    assert.equal(parseCodeLoadMs(lines.join('\n')), 378);
});

test('code loading rejects missing, duplicate, unsupported, unordered, or untimestamped records', () => {
    const lines = activationLines();
    assert.throws(() => parseCodeLoadMs(''), /Expected exactly one/);
    for (let index = 0; index < lines.length; index++) {
        assert.throws(() => parseCodeLoadMs(lines.filter((_, other) => other !== index).join('\n')), /Expected exactly one/);
        assert.throws(() => parseCodeLoadMs([...lines, lines[index]].join('\n')), /Expected exactly one/);
    }
    assert.throws(() => parseCodeLoadMs(activationLines('unknown').join('\n')), /Expected exactly one/);
    assert.throws(() => parseCodeLoadMs([...lines].reverse().join('\n')), /out of order/);
    assert.throws(() => parseCodeLoadMs(lines.join('\n').replace('16:44:49.317', '16:44:48.100')), /out of order/);
    assert.throws(() => parseCodeLoadMs(lines.join('\n').replace('2026-10-05 16:44:48.939', 'invalid')), /timestamp/);
});

test('activate telemetry converts both seconds measurements to ms and ignores other events', () => {
    const other = telemetryLine().replace('vscode-documentdb/activate', 'vscode-documentdb/other');
    assert.deepEqual(parseActivateTelemetry(`prefix\n${other}\n${telemetryLine()}\n`), { activateMs: 61, mainFileLoadMs: 0 });
    assert.deepEqual(parseActivateTelemetry(telemetryLine({ duration: 0.123, mainFileLoad: 0.012 })), {
        activateMs: 123, mainFileLoadMs: 12,
    });
});

test('activate telemetry rejects missing, ambiguous, malformed, failed, and invalid measurements', () => {
    assert.throws(() => parseActivateTelemetry(''), /Expected exactly one/);
    assert.throws(() => parseActivateTelemetry(`${telemetryLine()}\n${telemetryLine()}`), /Expected exactly one/);
    assert.throws(() => parseActivateTelemetry('** TELEMETRY("vscode-documentdb/activate", 0.11.0) broken'), /Malformed/);
    assert.throws(() => parseActivateTelemetry(telemetryLine().replace('"duration":0.061', '"duration":broken')), SyntaxError);
    assert.throws(() => parseActivateTelemetry(telemetryLine(undefined, 'Failed')), /not Succeeded/);
    for (const measures of [{}, { duration: 1 }, { duration: '0.1', mainFileLoad: 0 },
        { duration: -1, mainFileLoad: 0 }, { duration: 0, mainFileLoad: null },
        { duration: 0, mainFileLoad: -1 }, { duration: 1e308, mainFileLoad: 0 }]) {
        assert.throws(() => parseActivateTelemetry(telemetryLine(measures)), /missing or invalid/);
    }
});

test('median handles odd and even counts, numeric sorting, zeros, and leaves samples unchanged', () => {
    const samples = [100, 2, 10, 1, 3];
    assert.equal(median(samples), 3);
    assert.deepEqual(samples, [100, 2, 10, 1, 3]);
    assert.equal(median([1, 7, 2, 4]), 3);
    assert.equal(median([0]), 0);
    for (const values of [[], [NaN], [Infinity], [-1]]) {
        assert.throws(() => median(values), /nonempty, finite, nonnegative/);
    }
});

test('summarizes per-run totals instead of adding independent medians', () => {
    const summary = summarize([
        { codeLoadMs: 100, activateMs: 10, totalMs: 110, mainFileLoadMs: 0 },
        { codeLoadMs: 200, activateMs: 200, totalMs: 400, mainFileLoadMs: 2 },
        { codeLoadMs: 300, activateMs: 100, totalMs: 400, mainFileLoadMs: 1 },
    ]);
    assert.deepEqual(summary.codeLoadMs, { median: 200, min: 100, max: 300 });
    assert.equal(summary.totalMs.median, 400);
    assert.equal(formatSummary(summary),
        'L3 TIMING: runs=3 codeLoadMs median=200.000 min=100.000 max=300.000; activateMs median=100.000; totalMs median=400.000; mainFileLoadMs median=1.000');
    assert.throws(() => summarize([]), /nonempty/);
});

/**
 * Exercise timing through the actual L3 orchestration, mocking only its external process/SDK.
 * @param {import('node:test').TestContext} context
 * @param {{ fail?: boolean, malformed?: boolean }} [behavior]
 * @returns {{ vsix: string, dependencies: import('./runner.cjs').Dependencies, artifacts: () => string }}
 */
function fixture(context, behavior = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-timing-unit-'));
    let artifacts;
    context.after(() => {
        fs.rmSync(root, { recursive: true, force: true });
        if (artifacts) {
            fs.rmSync(artifacts, { recursive: true, force: true });
        }
    });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { vscode: '^1.109.0' } }));
    const vsix = path.join(root, 'production.vsix');
    fs.writeFileSync(vsix, 'fixture');
    return {
        vsix,
        artifacts: () => artifacts,
        dependencies: {
            checkout: root,
            platform: 'linux',
            env: { DEBUGTELEMETRY: '0' },
            display: async () => {},
            sdk: () => ({
                downloadAndUnzipVSCode: async () => '/fake/code',
                resolveCliArgsFromVSCodeExecutablePath: () => ['/fake/cli'],
            }),
            process: async (_executable, args, options) => {
                assert.equal(options.env.DEBUGTELEMETRY, 'verbose');
                const extensions = args[args.indexOf('--extensions-dir') + 1];
                const installed = path.join(extensions, `${TARGET_ID}-0.11.0`);
                if (args.includes('--install-extension')) {
                    fs.mkdirSync(installed);
                    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({
                        publisher: 'ms-azuretools', name: 'vscode-documentdb', main: './main',
                    }));
                } else {
                    fs.writeFileSync(options.env.DOCUMENTDB_L3_RESULT, JSON.stringify({
                        extensionId: TARGET_ID, extensionPath: installed, active: true, commands: LATE_COMMANDS,
                    }));
                    fs.writeFileSync(options.log, behavior.malformed ? 'no telemetry' : telemetryLine());
                    if (behavior.fail) {
                        throw new Error('fixture launch failed');
                    }
                }
            },
            logs: () => {
                const host = path.join(artifacts, 'exthost.log');
                fs.writeFileSync(host, activationLines().join('\n'));
                return { hostLogs: [host], outputLogs: ['DocumentDB.log'], errors: [], unrelatedHostErrors: [] };
            },
            emit: (text) => {
                if (text.startsWith('L3 artifacts: ')) {
                    artifacts = text.slice('L3 artifacts: '.length);
                }
            },
        },
    };
}

test('full L3 success is required, child telemetry is enabled, and parsed artifacts are deleted', async (context) => {
    const run = fixture(context);
    assert.deepEqual(await measureRun(run.vsix, run.dependencies), {
        codeLoadMs: 378, activateMs: 61, totalMs: 439, mainFileLoadMs: 0,
    });
    assert.equal(run.dependencies.env.DEBUGTELEMETRY, '0');
    assert.equal(fs.existsSync(run.artifacts()), false);
});

test('L3 failures cannot become timing successes and retain diagnostic artifacts', async (context) => {
    const run = fixture(context, { fail: true });
    await assert.rejects(measureRun(run.vsix, run.dependencies), /fixture launch failed.*\nL3 artifacts retained:/);
    assert.equal(fs.existsSync(run.artifacts()), true);
});

test('parse failures fail loudly and retain diagnostics instead of reporting zero timings', async (context) => {
    const run = fixture(context, { malformed: true });
    await assert.rejects(measureRun(run.vsix, run.dependencies), /Cannot measure activation:.*TELEMETRY.*\nL3 artifacts retained:/);
    assert.equal(fs.existsSync(run.artifacts()), true);
});
