/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TARGET_ID, minimumVSCodeVersion, inspectLogs } = require('./checks.cjs');
const { runActivation, requireDisplay, runProcess } = require('./runner.cjs');

const CHECKOUT = path.resolve(__dirname, '../../..');
const USAGE = 'Usage: npm run measure:activation -- <vsix> [--runs N] [--json <file>]';

/** @typedef {{ vsix: string, runs: number, json?: string }} TimingOptions */
/** @typedef {{ codeLoadMs: number, activateMs: number, totalMs: number, mainFileLoadMs: number }} Timing */
/** @typedef {{ median: number, min: number, max: number }} Statistics */
/** @typedef {{
 * runs: number, codeLoadMs: Statistics, activateMs: Statistics,
 * totalMs: Statistics, mainFileLoadMs: Statistics
 * }} Summary */

/** @param {string[]} args @returns {TimingOptions} */
function parseArguments(args) {
    if (!args[0] || args[0].startsWith('-')) {
        throw new Error(USAGE);
    }
    const options = { vsix: path.resolve(args[0]), runs: 5 };
    const seen = new Set();
    for (let index = 1; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!['--runs', '--json'].includes(flag) || seen.has(flag) || !value || value.startsWith('-')) {
            throw new Error(USAGE);
        }
        seen.add(flag);
        if (flag === '--runs') {
            if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
                throw new Error(`--runs must be a positive safe integer. ${USAGE}`);
            }
            options.runs = Number(value);
        } else {
            options.json = path.resolve(value);
        }
    }
    return options;
}

/** @param {string} line @returns {number} */
function timestamp(line) {
    const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[/.exec(line);
    // Interpret all wall-clock timestamps in the same zone; only their interval is used.
    const value = match ? Date.parse(`${match[1].replace(' ', 'T')}Z`) : NaN;
    if (!Number.isFinite(value)) {
        throw new Error(`Missing or invalid millisecond timestamp: ${line}`);
    }
    return value;
}

/**
 * This is VS Code's load-time interval, not just the extension's activate callback.
 * Require one complete activation of the target, ignoring other extensions.
 * @param {string} contents @returns {number}
 */
function parseCodeLoadMs(contents) {
    const lines = contents.split(/\r?\n/);
    const target = TARGET_ID.replaceAll('.', '\\.');
    const patterns = [
        new RegExp(`ExtensionService#_doActivateExtension ${target},`),
        new RegExp(`ExtensionService#loadModule \\[(?:cjs|esm)\\] -> file://.*[\\\\/]${target}-[^\\\\/]+[\\\\/]`),
        new RegExp(`ExtensionService#_callActivateOptional ${target}(?:$|[ ,])`),
    ];
    const matches = patterns.map((pattern) => lines.flatMap((line, index) => pattern.test(line) ? [{ line, index }] : []));
    if (matches.some((entries) => entries.length !== 1)) {
        throw new Error(
            `Expected exactly one target _doActivateExtension, loadModule [cjs|esm], and _callActivateOptional; found ${matches.map((entries) => entries.length).join(', ')}.`,
        );
    }
    const [start, load, activate] = matches.map((entries) => entries[0]);
    const [startMs, loadMs, activateMs] = [start, load, activate].map((entry) => timestamp(entry.line));
    if (start.index >= load.index || load.index >= activate.index || startMs > loadMs || loadMs > activateMs) {
        throw new Error('Target activation load timestamps or lines are out of order.');
    }
    return activateMs - startMs;
}

/** @param {string} contents @returns {{ activateMs: number, mainFileLoadMs: number }} */
function parseActivateTelemetry(contents) {
    const lines = contents.split(/\r?\n/).filter((line) => line.includes('** TELEMETRY("vscode-documentdb/activate",'));
    if (lines.length !== 1) {
        throw new Error(`Expected exactly one DocumentDB activate TELEMETRY line; found ${lines.length}.`);
    }
    const match = /\*\* TELEMETRY\("vscode-documentdb\/activate", [^)]+\) properties=(\{.*\}), measures=(\{.*\})\s*$/.exec(lines[0]);
    if (!match) {
        throw new Error(`Malformed DocumentDB activate TELEMETRY line: ${lines[0]}`);
    }
    const properties = JSON.parse(match[1]);
    const measures = JSON.parse(match[2]);
    if (properties.result !== 'Succeeded') {
        throw new Error(`DocumentDB activate TELEMETRY result was not Succeeded: ${properties.result}`);
    }
    for (const key of ['duration', 'mainFileLoad']) {
        if (typeof measures[key] !== 'number' || !Number.isFinite(measures[key]) || measures[key] < 0 ||
            !Number.isFinite(measures[key] * 1000)) {
            throw new Error(`DocumentDB activate TELEMETRY has missing or invalid ${key}.`);
        }
    }
    return { activateMs: measures.duration * 1000, mainFileLoadMs: measures.mainFileLoad * 1000 };
}

/** @param {readonly number[]} values @returns {number} */
function median(values) {
    if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
        throw new Error('Timing median requires nonempty, finite, nonnegative measurements.');
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** @param {readonly number[]} values @returns {Statistics} */
function statistics(values) {
    return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** @param {readonly Timing[]} samples @returns {Summary} */
function summarize(samples) {
    return {
        runs: samples.length,
        codeLoadMs: statistics(samples.map((sample) => sample.codeLoadMs)),
        activateMs: statistics(samples.map((sample) => sample.activateMs)),
        totalMs: statistics(samples.map((sample) => sample.totalMs)),
        mainFileLoadMs: statistics(samples.map((sample) => sample.mainFileLoadMs)),
    };
}

/** @param {Summary} summary @returns {string} */
function formatSummary(summary) {
    const load = summary.codeLoadMs;
    return `L3 TIMING: runs=${summary.runs} codeLoadMs median=${load.median.toFixed(3)} min=${load.min.toFixed(3)} max=${load.max.toFixed(3)}; ` +
        `activateMs median=${summary.activateMs.median.toFixed(3)}; totalMs median=${summary.totalMs.median.toFixed(3)}; ` +
        `mainFileLoadMs median=${summary.mainFileLoadMs.median.toFixed(3)}`;
}

/**
 * Reuse the full L3 gate and its retained process/log artifacts without changing the runner.
 * Failed L3 runs or unparseable measurements retain diagnostics; parsed runs are removed.
 * @param {string} vsix @param {import('./runner.cjs').Dependencies} dependencies @returns {Promise<Timing>}
 */
async function measureRun(vsix, dependencies) {
    let artifacts;
    let hostLogs = [];
    await runActivation({ vsix, injectError: false, keepArtifacts: true }, {
        ...dependencies,
        env: { ...dependencies.env, DEBUGTELEMETRY: 'verbose' },
        emit: (text) => {
            if (text.startsWith('L3 artifacts: ')) {
                artifacts = text.slice('L3 artifacts: '.length);
            }
            dependencies.emit(text);
        },
        logs: (userDataDir, installedPath) => {
            const report = dependencies.logs(userDataDir, installedPath);
            hostLogs = report.hostLogs;
            return report;
        },
    });
    if (!artifacts) {
        throw new Error('L3 passed without reporting its artifact directory.');
    }
    let sample;
    try {
        const targetLogs = hostLogs.map((filename) => fs.readFileSync(filename, 'utf8'))
            .filter((contents) => contents.includes(`ExtensionService#_doActivateExtension ${TARGET_ID},`));
        if (targetLogs.length !== 1) {
            throw new Error(`Expected exactly one target activation extension-host log; found ${targetLogs.length}.`);
        }
        const codeLoadMs = parseCodeLoadMs(targetLogs[0]);
        const telemetry = parseActivateTelemetry(fs.readFileSync(path.join(artifacts, 'electron.log'), 'utf8'));
        sample = { codeLoadMs, ...telemetry, totalMs: codeLoadMs + telemetry.activateMs };
    } catch (error) {
        throw new Error(`Cannot measure activation: ${error instanceof Error ? error.message : String(error)}\nL3 artifacts retained: ${artifacts}`);
    }
    fs.rmSync(artifacts, { recursive: true });
    return sample;
}

/** @param {string[]} args @returns {Promise<void>} */
async function main(args) {
    const options = parseArguments(args);
    const manifest = JSON.parse(fs.readFileSync(path.join(CHECKOUT, 'package.json'), 'utf8'));
    const dependencies = {
        checkout: CHECKOUT,
        platform: process.platform,
        env: process.env,
        sdk: () => require('@vscode/test-electron'),
        display: requireDisplay,
        process: runProcess,
        logs: inspectLogs,
        emit: (text) => console.log(text),
    };
    const samples = [];
    for (let run = 1; run <= options.runs; run++) {
        let sample;
        try {
            sample = await measureRun(options.vsix, dependencies);
        } catch (error) {
            throw new Error(`Timing run ${run}/${options.runs} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        samples.push({ run, ...sample });
        console.log(
            `L3 TIMING RUN ${run}/${options.runs}: codeLoadMs=${sample.codeLoadMs.toFixed(3)} activateMs=${sample.activateMs.toFixed(3)} ` +
            `totalMs=${sample.totalMs.toFixed(3)} mainFileLoadMs=${sample.mainFileLoadMs.toFixed(3)}`,
        );
    }
    const summary = summarize(samples);
    if (options.json) {
        fs.writeFileSync(options.json, `${JSON.stringify({
            vsix: options.vsix,
            vscodeVersion: minimumVSCodeVersion(manifest.engines.vscode),
            runs: samples,
            summary,
        }, null, 2)}\n`);
    }
    console.log(formatSummary(summary));
}

module.exports = { parseArguments, parseCodeLoadMs, parseActivateTelemetry, median, summarize, formatSummary, measureRun, main };

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`L3 TIMING FAIL: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
