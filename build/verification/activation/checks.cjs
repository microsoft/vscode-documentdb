/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGET_ID = 'ms-azuretools.vscode-documentdb';
// These are at the end of activateClustersSupport, including a non-contributed command.
const LATE_COMMANDS = [
    'vscode-documentdb.command.internal.exportDocuments',
    'vscode-documentdb.command.exportDocuments',
    'vscode-documentdb.command.testing.startDemoTask',
];
const INJECTION_MARKER = 'L3_INJECTED_SWALLOWED_ACTIVATION_ERROR';
const SURVEY_DEBUG_REASON =
    'By design registered only in ExtensionMode.Development (src/debug/registerDebugCommands.ts); hidden from the palette otherwise.';
/**
 * Contributed commands that an installed (production) activation does not register, by command id,
 * each with the reason.
 * @type {Readonly<Record<string, string>>}
 */
const LAZY_COMMANDS = Object.freeze({
    'vscode-documentdb.debug.survey.showInvitation': SURVEY_DEBUG_REASON,
    'vscode-documentdb.debug.survey.simulateMilestone': SURVEY_DEBUG_REASON,
    'vscode-documentdb.debug.survey.resetState': SURVEY_DEBUG_REASON,
});

/** @param {string} engine @returns {string} */
function minimumVSCodeVersion(engine) {
    const match = /^(?:\^|>=)?(\d+\.\d+\.\d+)$/.exec(engine);
    if (!match) {
        throw new Error(`Cannot pin the minimum VS Code version from engines.vscode=${JSON.stringify(engine)}.`);
    }
    return match[1];
}

/** @param {string} parent @param {string} child @returns {boolean} */
function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Resolve symlinks, not just textual prefixes: a link inside extensions-dir can still point at the checkout.
 * @param {string} actual @param {string} installed @param {string} extensionsDir @param {string} developmentDir
 * @returns {void}
 */
function assertInstalledPath(actual, installed, extensionsDir, developmentDir) {
    const actualPath = fs.realpathSync(actual);
    const installedPath = fs.realpathSync(installed);
    if (
        actualPath !== installedPath ||
        !isInside(fs.realpathSync(extensionsDir), actualPath) ||
        actualPath === fs.realpathSync(developmentDir) ||
        isInside(fs.realpathSync(developmentDir), actualPath)
    ) {
        throw new Error(`Target loaded from ${actualPath}, not the isolated installed VSIX at ${installedPath}.`);
    }
}

/** @param {readonly string[]} commands @returns {void} */
function assertLateCommands(commands) {
    const missing = LATE_COMMANDS.filter((command) => !commands.includes(command));
    if (missing.length) {
        throw new Error(`Activation stopped before the final command registrations: ${missing.join(', ')}`);
    }
}

/** @param {unknown} manifest @returns {string[]} */
function declaredCommands(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('The installed extension has no package.json to read its declared commands from.');
    }
    const contributed = /** @type {{ contributes?: { commands?: { command: string }[] } }} */ (manifest).contributes;
    return (contributed?.commands ?? []).map((entry) => entry.command);
}

/**
 * Every `contributes.commands` entry must be registered once activation finishes, except the listed
 * lazy ones; an exclusion for a command that is no longer declared fails too, so the list stays current.
 * @param {unknown} manifest @param {readonly string[]} commands
 * @param {Readonly<Record<string, string>>} [lazy] @returns {void}
 */
function assertDeclaredCommands(manifest, commands, lazy = LAZY_COMMANDS) {
    const declared = declaredCommands(manifest);
    const stale = Object.keys(lazy).filter((command) => !declared.includes(command));
    if (stale.length) {
        throw new Error(`Lazy-command exclusions for commands that are not declared: ${stale.join(', ')}`);
    }
    const registered = new Set(commands);
    const missing = declared.filter((command) => !registered.has(command) && !Object.hasOwn(lazy, command));
    if (missing.length) {
        throw new Error(`Declared commands not registered after activation: ${missing.join(', ')}`);
    }
}

/** @param {string} root @returns {string[]} */
function listFiles(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const filename = path.join(root, entry.name);
        return entry.isDirectory() ? listFiles(filename) : entry.isFile() ? [filename] : [];
    });
}

/** @typedef {{ file: string, line: number, text: string }} LogFinding */
/** @typedef {{ hostLogs: string[], outputLogs: string[], errors: LogFinding[], unrelatedHostErrors: LogFinding[] }} LogReport */

/**
 * A host entry includes its continuation/stack lines, so attribution can come from a later frame.
 * @param {string} contents @returns {{ line: number, text: string }[]}
 */
function logEntries(contents) {
    const entries = [];
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
        if (!line.trim()) {
            continue;
        }
        if (/^\d{4}-\d{2}-\d{2}[ T]/.test(line) || entries.length === 0) {
            entries.push({ line: index + 1, text: line });
        } else {
            entries[entries.length - 1].text += `\n${line}`;
        }
    }
    return entries;
}

/** @param {string} text @returns {boolean} */
function isError(text) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const severity = /^(?:\d{4}-\d{2}-\d{2}[ T]\S+\s+)?\[(trace|debug|info|warn|error|critical)\]/i.exec(firstLine);
    if (severity && /^(trace|debug)$/i.test(severity[1])) {
        return false;
    }
    // appendLog from callWithTelemetryAndErrorHandling writes "[info] Error: ...", not "[error]".
    return /\[(?:error|critical)\]|\b(?:error|exception|failed|failure|uncaught|unhandled)\b|\b(?:TypeError|ReferenceError|SyntaxError|RangeError):/i.test(
        text,
    );
}

/**
 * Other extensions and workbench/network services have their own failures. Only errors attributed
 * to this extension fail L3; unowned host errors are explicitly reported rather than hidden.
 * @param {{ file: string, contents: string }[]} logs @param {string} installedPath
 * @returns {LogReport}
 */
function recognizeLogs(logs, installedPath) {
    /** @type {LogReport} */
    const report = { hostLogs: [], outputLogs: [], errors: [], unrelatedHostErrors: [] };
    for (const log of logs) {
        const basename = path.basename(log.file);
        const host = /^exthost(?:\.\d+)?\.log$/i.test(basename);
        const output = /documentdb.*(?:for.*vs.*code|query.*playground).*\.log$/i.test(basename);
        if (!host && !output) {
            continue;
        }
        (host ? report.hostLogs : report.outputLogs).push(log.file);
        for (const entry of logEntries(log.contents)) {
            if (!isError(entry.text)) {
                continue;
            }
            const normalized = entry.text.replaceAll('\\', '/').toLowerCase();
            const owned =
                output ||
                normalized.includes(TARGET_ID) ||
                normalized.includes('vscode-documentdb') ||
                normalized.includes(installedPath.replaceAll('\\', '/').toLowerCase());
            const finding = { file: log.file, ...entry };
            (owned ? report.errors : report.unrelatedHostErrors).push(finding);
        }
    }
    return report;
}

/** @param {string} userDataDir @param {string} installedPath @returns {LogReport} */
function inspectLogs(userDataDir, installedPath) {
    const logRoot = path.join(userDataDir, 'logs');
    if (!fs.existsSync(logRoot)) {
        throw new Error(`VS Code produced no logs at ${logRoot}; activation cannot be verified.`);
    }
    return recognizeLogs(
        listFiles(logRoot)
            .filter((filename) => filename.endsWith('.log'))
            .map((file) => ({
                file,
                contents: fs.readFileSync(file, 'utf8'),
            })),
        installedPath,
    );
}

/** @param {LogReport} report @returns {void} */
function assertCleanLogs(report) {
    if (!report.hostLogs.length || !report.outputLogs.length) {
        throw new Error(
            `Missing actual activation logs: extension host=${report.hostLogs.length}, DocumentDB output=${report.outputLogs.length}.`,
        );
    }
    if (report.errors.length) {
        throw new Error(
            `DocumentDB activation errors:\n${report.errors.map((error) => `${error.file}:${error.line}\n${error.text}`).join('\n')}`,
        );
    }
}

module.exports = {
    TARGET_ID,
    LATE_COMMANDS,
    LAZY_COMMANDS,
    INJECTION_MARKER,
    minimumVSCodeVersion,
    isInside,
    assertInstalledPath,
    assertLateCommands,
    declaredCommands,
    assertDeclaredCommands,
    recognizeLogs,
    inspectLogs,
    assertCleanLogs,
};
