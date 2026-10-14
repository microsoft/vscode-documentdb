/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { describe, it } = require('node:test');
const {
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
} = require('./unbundled-host-probe.cjs');

const REPO = path.resolve(__dirname, '../../..');
const TEMPLATES = path.join(__dirname, 'unbundled-host');
const EXTENSION = path.join(os.tmpdir(), 'probe-extension');
const INSIDE = path.join(EXTENSION, 'node_modules/@microsoft/vscode-ext-webview/dist/host.js');

/** @param {string} name */
const variant = (name) => {
    const found = VARIANTS.find((candidate) => candidate.name === name);
    assert.ok(found, name);
    return found;
};

const passReceipt = (type = 'commonjs') => ({
    status: 'PASS',
    stage: 'done',
    resolved: INSIDE,
    checks: ['a', 'b'],
    moduleType: type,
});
const observe = (overrides = {}) => ({
    receipt: undefined,
    trace: [],
    launchError: '',
    timedOut: false,
    unresponsive: false,
    ...overrides,
});
const timedOut = { launchError: 'Timed out after 40000ms running code. See electron.log.', timedOut: true };

describe('unbundled host probe: variants', () => {
    it('covers require, import() from CommonJS, ESM static and dynamic imports, and one control', () => {
        assert.deepEqual(
            VARIANTS.map((entry) => [entry.name, entry.type, entry.expect.status]),
            [
                ['commonjs-require', 'commonjs', 'HANG'],
                ['commonjs-import', 'commonjs', 'PASS'],
                ['esm-static', 'module', 'PASS'],
                ['esm-dynamic', 'module', 'PASS'],
                ['control', 'commonjs', 'FAIL'],
            ],
        );
        assert.deepEqual(
            VARIANTS.filter((entry) => entry.mutate).map((entry) => entry.name),
            ['control'],
        );
        for (const entry of VARIANTS) {
            assert.ok(fs.existsSync(path.join(TEMPLATES, entry.template)), entry.template);
            assert.equal(entry.template.endsWith('.mjs'), entry.type === 'module', entry.name);
        }
    });

    it('expects the require variant to stop in the traced require call', () => {
        assert.deepEqual(variant('commonjs-require').expect, { status: 'HANG', lastTrace: REQUIRE_HOST });
        assert.match(
            fs.readFileSync(path.join(TEMPLATES, 'extension-require.cjs'), 'utf8'),
            /trace\("require\('@microsoft\/vscode-ext-webview\/host'\)"\)/,
        );
    });
});

describe('unbundled host probe: arguments and installation inputs', () => {
    it('parses flags', () => {
        assert.deepEqual(parseArguments([]), { build: true, keep: false, vscodeVersion: undefined });
        assert.deepEqual(parseArguments(['--no-build', '--keep', '--vscode', '1.115.0']), {
            build: false,
            keep: true,
            vscodeVersion: '1.115.0',
        });
        assert.throws(() => parseArguments(['--vscode']), /Usage/);
        assert.throws(() => parseArguments(['--vscode', 'stable']), /Usage/);
        assert.throws(() => parseArguments(['extra']), /Usage/);
    });

    it('installs only non-optional peers, pinned to the lockfile tarball URLs', () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(REPO, 'packages/vscode-ext-webview/package.json'), 'utf8'),
        );
        const peers = requiredPeers(manifest);
        assert.deepEqual(peers, ['@trpc/client', '@trpc/server']);
        const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
        for (const spec of lockedSpecs(lock, peers)) {
            assert.match(spec, /^https:\/\/.+\.tgz$/);
        }
        assert.deepEqual(
            requiredPeers({
                peerDependencies: { b: '1', a: '1', c: '1' },
                peerDependenciesMeta: { c: { optional: true } },
            }),
            ['a', 'b'],
        );
        assert.throws(() => lockedSpecs({ packages: {} }, ['missing']), /no resolved registry URL for missing/);
        assert.throws(() => lockedSpecs({ packages: { 'node_modules/x': { resolved: 'file:../x' } } }, ['x']), /x/);
    });

    it('writes a manifest in the variant module format', () => {
        const esm = probeManifest(variant('esm-static'), '1.109.0');
        assert.equal(esm.type, 'module');
        assert.equal(esm.main, './extension.mjs');
        assert.deepEqual(esm.engines, { vscode: '^1.109.0' });
        assert.deepEqual(esm.activationEvents, []);
        const cjs = probeManifest(variant('commonjs-require'), '1.109.0');
        assert.equal(cjs.type, 'commonjs');
        assert.equal(cjs.main, './extension.cjs');
        assert.equal(cjs.name, 'unbundled-host-probe-commonjs-require');
    });
});

describe('unbundled host probe: control mutation', () => {
    it('rewrites the single static vscode import', () => {
        const source = "import * as path from 'path';\nimport * as vscode from 'vscode';\nconst x = 'vscode';\n";
        assert.equal(
            mutateHostImport(source),
            `import * as path from 'path';\nimport * as vscode from '${CONTROL_SPECIFIER}';\nconst x = 'vscode';\n`,
        );
        assert.throws(() => mutateHostImport("import 'path';"), /found 0/);
        assert.throws(() => mutateHostImport('import a from \'vscode\';\nimport b from "vscode";'), /found 2/);
    });

    it('matches the shipped controller source, so the control cannot become a no-op', () => {
        const source = fs.readFileSync(
            path.join(REPO, 'packages/vscode-ext-webview/src/host/WebviewController.ts'),
            'utf8',
        );
        assert.match(mutateHostImport(source), new RegExp(`from '${CONTROL_SPECIFIER}';`));
    });
});

describe('unbundled host probe: judge', () => {
    it('accepts a PASS resolved from the probe extension', () => {
        const verdict = judge(variant('commonjs-import'), observe({ receipt: passReceipt() }), EXTENSION);
        assert.equal(verdict.outcome, 'PASS');
        assert.equal(verdict.asExpected, true);
        assert.equal(verdict.detail, 'a; b');
    });

    it('rejects a PASS that loaded the package from elsewhere, or in the wrong module format', () => {
        const outside = judge(
            variant('esm-static'),
            observe({ receipt: { ...passReceipt('module'), resolved: path.join(REPO, 'packages/x.js') } }),
            EXTENSION,
        );
        assert.equal(outside.asExpected, false);
        assert.match(outside.problem ?? '', /outside the probe's node_modules/);
        const format = judge(variant('esm-static'), observe({ receipt: passReceipt('commonjs') }), EXTENSION);
        assert.equal(format.asExpected, false);
        assert.match(format.problem ?? '', /expected a module extension/);
    });

    it('rejects a FAIL where PASS is expected', () => {
        const receipt = {
            status: 'FAIL',
            stage: 'openWebview',
            moduleType: 'module',
            error: { name: 'TypeError', message: 'boom' },
        };
        const verdict = judge(variant('esm-dynamic'), observe({ receipt }), EXTENSION);
        assert.equal(verdict.outcome, 'FAIL');
        assert.equal(verdict.asExpected, false);
        assert.equal(verdict.detail, 'stage openWebview: TypeError: boom');
    });

    it('accepts the control only for the injected specifier at the load stage', () => {
        const error = { name: 'Error', message: `Cannot find package '${CONTROL_SPECIFIER}' imported from /x.js` };
        const control = variant('control');
        assert.equal(
            judge(
                control,
                observe({ receipt: { status: 'FAIL', stage: 'load', moduleType: 'commonjs', error } }),
                EXTENSION,
            ).asExpected,
            true,
        );
        assert.equal(judge(control, observe({ receipt: passReceipt() }), EXTENSION).asExpected, false);
        assert.equal(
            judge(
                control,
                observe({
                    receipt: {
                        status: 'FAIL',
                        stage: 'load',
                        moduleType: 'commonjs',
                        error: { name: 'Error', message: "Cannot find package 'vscode'" },
                    },
                }),
                EXTENSION,
            ).asExpected,
            false,
        );
        assert.equal(
            judge(
                control,
                observe({ receipt: { status: 'FAIL', stage: 'panel', moduleType: 'commonjs', error } }),
                EXTENSION,
            ).asExpected,
            false,
        );
    });

    it('accepts the expected hang only when stuck in require and VS Code reported it unresponsive', () => {
        const hang = variant('commonjs-require');
        const trace = ['stage load', REQUIRE_HOST];
        const verdict = judge(hang, observe({ ...timedOut, trace, unresponsive: true }), EXTENSION);
        assert.equal(verdict.outcome, 'HANG');
        assert.equal(verdict.asExpected, true);
        assert.equal(judge(hang, observe({ ...timedOut, trace, unresponsive: false }), EXTENSION).asExpected, false);
        assert.equal(
            judge(hang, observe({ ...timedOut, trace: ['stage load'], unresponsive: true }), EXTENSION).asExpected,
            false,
        );
        assert.equal(judge(hang, observe({ receipt: passReceipt() }), EXTENSION).asExpected, false);
    });

    it('treats a hang elsewhere and a missing receipt without timeout as failures', () => {
        const hung = judge(
            variant('esm-static'),
            observe({ ...timedOut, trace: ['stage tab'], unresponsive: true }),
            EXTENSION,
        );
        assert.equal(hung.outcome, 'HANG');
        assert.equal(hung.asExpected, false);
        const crashed = judge(
            variant('esm-static'),
            observe({ launchError: 'Exit 1, signal null running code.' }),
            EXTENSION,
        );
        assert.equal(crashed.outcome, 'FAIL');
        assert.equal(crashed.asExpected, false);
        assert.match(crashed.problem ?? '', /no valid receipt.*Exit 1/);
    });

    it('rejects a receipt when VS Code did not exit cleanly', () => {
        const verdict = judge(
            variant('commonjs-import'),
            observe({ receipt: passReceipt(), launchError: 'Exit 1, signal null' }),
            EXTENSION,
        );
        assert.equal(verdict.asExpected, false);
    });
});

describe('unbundled host probe: exercise (offline, fake host)', () => {
    /** A fake `vscode` and `/host` that model the calls the probe checks. */
    function fakes({ omitOpenWebview = false } = {}) {
        const tabs = [];
        class TabInputWebview {}
        const vscode = {
            TabInputWebview,
            window: {
                tabGroups: {
                    get all() {
                        return [{ tabs }];
                    },
                },
            },
        };
        const host = omitOpenWebview
            ? {}
            : {
                  openWebview(_context, options) {
                      const listeners = [];
                      const tab = { input: new TabInputWebview(), label: options.title };
                      tabs.push(tab);
                      const controller = {
                          isDisposed: false,
                          panel: {
                              viewType: `react-webview-${options.viewType}`,
                              webview: {
                                  html: `<script id="vscode-ext-webview-initial-data"></script><script src="${options.sourceLayout.bundled.file}">`,
                              },
                          },
                          onDisposed: (listener) => listeners.push(listener),
                          dispose() {
                              controller.isDisposed = true;
                              listeners.forEach((listener) => listener());
                              tabs.splice(tabs.indexOf(tab), 1);
                          },
                      };
                      return controller;
                  },
              };
        const shared = {
            initWebviewTrpc: () => ({ router: (routes) => routes, publicProcedure: { query: (fn) => fn } }),
        };
        return { vscode, host, shared };
    }

    for (const format of ['commonjs', 'module']) {
        it(`passes and fails at the right stage (${format})`, async () => {
            let exercise;
            if (format === 'commonjs') {
                ({ exercise } = require(path.join(TEMPLATES, 'exercise.cjs')));
            } else {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-exercise-'));
                try {
                    const file = path.join(dir, 'exercise.mjs');
                    fs.writeFileSync(file, toEsm(fs.readFileSync(path.join(TEMPLATES, 'exercise.cjs'), 'utf8')));
                    ({ exercise } = await import(pathToFileURL(file).href));
                } finally {
                    fs.rmSync(dir, { recursive: true });
                }
            }
            const steps = [];
            const ok = fakes();
            const pass = await exercise({
                vscode: ok.vscode,
                context: {},
                trace: (step) => steps.push(step),
                load: async () => ({ ...ok, resolved: INSIDE }),
            });
            assert.equal(pass.status, 'PASS', JSON.stringify(pass));
            assert.equal(pass.resolved, INSIDE);
            assert.equal(steps.at(-1), 'done');
            assert.equal(pass.checks.length, 5);

            const failed = await exercise({
                vscode: ok.vscode,
                context: {},
                trace: () => {},
                load: async () => {
                    throw new Error("Cannot find package 'vscode'");
                },
            });
            assert.equal(failed.status, 'FAIL');
            assert.equal(failed.stage, 'load');
            assert.match(failed.error.message, /Cannot find package 'vscode'/);

            const missing = fakes({ omitOpenWebview: true });
            const noExport = await exercise({
                vscode: missing.vscode,
                context: {},
                trace: () => {},
                load: async () => ({ ...missing, resolved: INSIDE }),
            });
            assert.equal(noExport.stage, 'exports');
        });
    }

    it('refuses an exercise source the ESM conversion cannot keep equivalent', () => {
        assert.throws(() => toEsm("const x = require('y');\nmodule.exports = { exercise };"), /require nothing/);
        assert.throws(() => toEsm('module.exports = { exercise };\nmodule.exports = { exercise };'), /one/);
        assert.match(
            toEsm(fs.readFileSync(path.join(TEMPLATES, 'exercise.cjs'), 'utf8')),
            /\nexport \{ exercise \};\n$/,
        );
    });
});
