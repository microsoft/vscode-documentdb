/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    MARKER,
    OLD_MARKERS,
    ciReport,
    commentBody,
    parseLastFull,
    runningBody,
    withLastFull,
} = require('./ci-report.cjs');

const headSha = 'abcdef0123456789abcdef0123456789abcdef01';
const passedSteps = {
    l10n: 'success',
    lint: 'success',
    prettier: 'success',
    inspect: 'success',
    prove: 'success',
    'verification-tests': 'success',
    activation: 'success',
    'prove-activation': 'success',
    'host-probe': 'success',
};
const allJobs = (result) => ({ static: result, unit: result, packages: result, l1: result, l3: result });
const noFlags = { packages: false, webviewPackage: false, verification: false };
const allFlags = { packages: true, webviewPackage: true, verification: true };
const size = '### Build size\n\nNo page, activation, VSIX or other bundle size changed.';

function input(overrides) {
    return {
        tier: 'standard',
        reason: 'ready PR',
        flags: noFlags,
        headSha,
        runUrl: 'https://github.com/example/project/actions/runs/1',
        jobs: { ...allJobs('success'), packages: 'skipped' },
        steps: { inspect: 'success', activation: 'success', l10n: 'success', lint: 'success', prettier: 'success' },
        sizeSection: size,
        lastFull: null,
        ...overrides,
    };
}

function rows(body) {
    return body.match(/^\| (?!Layer|Check|-).*$/gm).slice(0, 9);
}

test('A draft PR runs static checks and unit tests only, and says why every other check was skipped', () => {
    const { body, result } = ciReport(
        input({
            tier: 'fast',
            reason: 'draft PR',
            jobs: { static: 'success', unit: 'success', packages: 'skipped', l1: 'skipped', l3: 'skipped' },
            steps: { l10n: 'success', lint: 'success', prettier: 'success' },
            sizeSection: null,
        }),
    );
    assert.equal(result, 'passed');
    assert.ok(
        body.startsWith(`${MARKER}\n## ✅ CI passed: fast tier (draft PR)\n\nCommit \`abcdef0\`, [workflow run](`),
    );
    assert.deepEqual(rows(body), [
        '| Static checks | ✅ passed | every push |',
        '| Unit tests | ✅ passed | every push |',
        '| npm packages: verify tarballs | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| VSIX: inspect contents | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| VSIX: self-test of the checks | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| VSIX: activate in VS Code | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| VSIX: self-test of the activation check | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| Webview host in unbundled extensions | ⏭️ skipped | draft PR; runs once the PR is marked ready |',
        '| E2E | ⏭️ not available yet | arrives with the E2E iteration (full tier) |',
    ]);
    assert.ok(body.includes('| Layer | Result | Ran or skipped because |'));
    assert.ok(
        body.includes(
            '**Full run:** add the `ci:full-requested` label to run every layer once on the current commit.<br>No full run yet.',
        ),
    );
    assert.ok(body.includes('| Prettier formatting | ✅ Passed | Nothing to fix |'));
    assert.ok(body.includes('### Build size\n\nNot measured: draft PR; runs once the PR is marked ready.'));
    assert.ok(OLD_MARKERS.every((marker) => !body.includes(marker)));
});

test('A ready PR names the paths behind each path-scoped check and keeps the last full run', () => {
    const lastFull = { sha: '1234567890abcdef1234567890abcdef12345678', result: 'passed' };
    const { body, result } = ciReport(
        input({
            flags: { packages: true, webviewPackage: false, verification: false },
            jobs: allJobs('success'),
            lastFull,
        }),
    );
    assert.equal(result, 'passed');
    assert.deepEqual(rows(body).slice(2, 8), [
        '| npm packages: verify tarballs | ✅ passed | `packages/**`, `package-lock.json` or the CI workflow changed |',
        '| VSIX: inspect contents | ✅ passed | ready PR |',
        '| VSIX: self-test of the checks | ⏭️ skipped | no change to `build/verification/**`, `build/vite/**`, the Vite configs, `package-lock.json` or the CI workflow |',
        '| VSIX: activate in VS Code | ✅ passed | ready PR |',
        '| VSIX: self-test of the activation check | ⏭️ skipped | no change to `build/verification/**`, `build/vite/**`, the Vite configs, `package-lock.json` or the CI workflow |',
        '| Webview host in unbundled extensions | ⏭️ skipped | no change to `packages/vscode-ext-webview/**`, `package-lock.json` or the CI workflow |',
    ]);
    assert.ok(body.includes(`<!-- last-full: ${lastFull.sha} passed -->`));
    assert.ok(body.includes('Last full run: ✅ passed on `1234567`.'));
    assert.deepEqual(parseLastFull(body), lastFull);
    assert.ok(body.includes(`\n${size}\n`));
});

test('A full run runs every layer, records itself and drops the request line', () => {
    const { body, result } = ciReport(
        input({
            tier: 'full',
            reason: 'full run requested by @octocat for abcdef0',
            flags: allFlags,
            jobs: allJobs('success'),
            steps: passedSteps,
            lastFull: { sha: '1234567890abcdef1234567890abcdef12345678', result: 'failed' },
        }),
    );
    assert.equal(result, 'passed');
    assert.ok(body.includes('## ✅ CI passed: full tier (full run requested by @octocat for abcdef0)'));
    assert.deepEqual(
        rows(body)
            .slice(0, 8)
            .map((row) => row.split(' | ').slice(1).join(' | ')),
        [
            '✅ passed | every push |',
            '✅ passed | every push |',
            ...Array.from({ length: 6 }, () => '✅ passed | full run requested |'),
        ],
    );
    assert.deepEqual(parseLastFull(body), { sha: headSha, result: 'passed', runUrl: input().runUrl });
    assert.ok(!body.includes('**Full run:**'));
});

test('A standard run after a full run keeps its requester and link, and the old marker still parses', () => {
    const fullRunUrl = 'https://github.com/example/project/actions/runs/7';
    const full = ciReport(
        input({
            tier: 'full',
            reason: 'full run requested by @octocat for abcdef0',
            requester: 'octocat',
            runUrl: fullRunUrl,
            flags: allFlags,
            jobs: allJobs('success'),
            steps: passedSteps,
        }),
    );
    const lastFull = parseLastFull(full.body);
    assert.deepEqual(lastFull, { sha: headSha, result: 'passed', requester: 'octocat', runUrl: fullRunUrl });
    const { body } = ciReport(input({ headSha: 'feedface'.repeat(5), lastFull }));
    assert.ok(body.includes(`<!-- last-full: ${headSha} passed by=octocat run=${fullRunUrl} -->`));
    assert.ok(body.includes(`Last full run: ✅ passed on \`abcdef0\`, requested by @octocat, [run](${fullRunUrl}).`));
    assert.deepEqual(parseLastFull(body), lastFull);

    assert.deepEqual(parseLastFull(`${MARKER}\n<!-- last-full: ${headSha} failed -->`), {
        sha: headSha,
        result: 'failed',
    });
    const unsafe = ciReport(
        input({ tier: 'full', requester: 'x --> y', runUrl: 'https://example.com/a) <b>', jobs: allJobs('success') }),
    );
    assert.ok(unsafe.body.includes(`<!-- last-full: ${headSha} passed -->`));
});

test('Failures show the fix hint, and a check after a failed step is reported as not run', () => {
    const { body, result } = ciReport(
        input({
            flags: { ...noFlags, verification: true },
            jobs: { ...allJobs('failure'), unit: 'success', packages: 'skipped', l3: 'success' },
            steps: { ...passedSteps, lint: 'failure', inspect: 'failure', prove: '', 'verification-tests': '' },
        }),
    );
    assert.equal(result, 'failed');
    assert.ok(body.startsWith(`${MARKER}\n## ❌ CI failed: standard tier (ready PR)`));
    assert.deepEqual(rows(body).slice(0, 5), [
        '| Static checks | ❌ failed | every push |',
        '| Unit tests | ✅ passed | every push |',
        '| npm packages: verify tarballs | ⏭️ skipped | no change to `packages/**`, `package-lock.json` or the CI workflow |',
        '| VSIX: inspect contents | ❌ failed | ready PR |',
        '| VSIX: self-test of the checks | ⚠️ not run | an earlier job or step failed |',
    ]);
    assert.ok(body.includes('| ESLint | ❌ Failed | Run `npm run lint` and fix the reported issues. |'));
    assert.ok(body.includes('| Localization (`l10n`) | ✅ Passed | Nothing to fix |'));
});

test('Packaging that failed while the other jobs passed leaves the VSIX checks not run, and says why sizes are missing', () => {
    const { body, result } = ciReport(
        input({
            jobs: { static: 'success', unit: 'success', packages: 'skipped', l1: 'skipped', l3: 'skipped' },
            steps: { l10n: 'success', lint: 'success', prettier: 'success' },
            sizeSection: null,
        }),
    );
    assert.equal(result, 'failed');
    assert.ok(rows(body).includes('| VSIX: inspect contents | ⚠️ not run | an earlier job or step failed |'));
    assert.ok(rows(body).includes('| VSIX: activate in VS Code | ⚠️ not run | an earlier job or step failed |'));
    assert.ok(body.includes('Not measured: the VSIX inspection did not write a size section; see the workflow run.'));
});

test('A failed unit test run fails the report and leaves the code quality table as it was', () => {
    const { body, result } = ciReport(input({ jobs: { ...allJobs('success'), unit: 'failure', packages: 'skipped' } }));
    assert.equal(result, 'failed');
    assert.deepEqual(rows(body).slice(0, 2), [
        '| Static checks | ✅ passed | every push |',
        '| Unit tests | ❌ failed | every push |',
    ]);
    assert.ok(body.includes('| ESLint | ✅ Passed | Nothing to fix |'));
    const missing = ciReport(input({ jobs: { ...allJobs('success'), static: 'cancelled' }, steps: {} })).body;
    assert.ok(missing.includes('| ESLint | ⏭️ Not run | Did not run; see the Static checks row above |'));
});

test('A cancelled run reports cancelled layers', () => {
    const { body, result } = ciReport(
        input({
            jobs: { static: 'success', unit: 'success', packages: 'skipped', l1: 'cancelled', l3: 'cancelled' },
            steps: { l10n: 'success', lint: 'success', prettier: 'success', inspect: 'success' },
        }),
    );
    assert.equal(result, 'cancelled');
    assert.ok(body.includes('## 🚫 CI cancelled: standard tier (ready PR)'));
    assert.ok(rows(body).includes('| VSIX: activate in VS Code | 🚫 cancelled | ready PR |'));
});

test('A running report hides the previous results, names them and keeps the last full run', () => {
    const lastFull = { sha: headSha, result: 'passed', requester: 'octocat', runUrl: input().runUrl };
    const previous = ciReport(input({ jobs: { ...allJobs('failure'), packages: 'skipped' }, lastFull })).body;
    const runUrl = 'https://github.com/example/project/actions/runs/2';
    const body = runningBody({
        tier: 'standard',
        reason: 'ready PR',
        headSha: 'feedface'.repeat(5),
        runUrl,
        existingBody: previous,
    });
    assert.ok(body.startsWith(`${MARKER}\n<!-- last-full: ${headSha} passed by=octocat run=`));
    assert.ok(body.includes('## ⏳ CI running: standard tier (ready PR)'));
    assert.ok(body.includes(`Commit \`feedfac\`. [Follow the workflow run](${runUrl})`));
    assert.ok(body.includes('Previous result: ❌ failed on `abcdef0`.'));
    assert.ok(body.includes('Last full run: ✅ passed on `abcdef0`, requested by @octocat'));
    assert.ok(!body.includes('| Layer |'));
    assert.deepEqual(parseLastFull(body), lastFull);

    const full = runningBody({
        tier: 'full',
        reason: 'full run requested by @octocat for feedfac',
        headSha,
        runUrl,
        existingBody: undefined,
    });
    assert.ok(full.includes('No previous result.'));
    assert.ok(!full.includes('**Full run:**'));
    const superseded = runningBody({ tier: 'standard', reason: 'ready PR', headSha, runUrl, existingBody: body });
    assert.ok(superseded.includes('The previous run, on `feedfac`, did not report a result.'));

    const finished = ciReport(input({ lastFull: parseLastFull(body) })).body;
    assert.deepEqual(parseLastFull(finished), lastFull);
});

test('A full run that finished after a newer push updates only the last full run', () => {
    const newer = ciReport(input({ headSha: 'feedface'.repeat(5) })).body;
    const updated = withLastFull(newer, { sha: headSha, result: 'failed' });
    assert.deepEqual(parseLastFull(updated), { sha: headSha, result: 'failed' });
    assert.ok(updated.includes('Last full run: ❌ failed on `abcdef0`.'));
    assert.equal(
        updated.replace(/<!-- last-full: .* -->\n/, '').replace(/<br>Last full run: .*$/m, '<br>No full run yet.'),
        newer,
    );
    const again = withLastFull(updated, { sha: 'feedface'.repeat(5), result: 'passed' });
    assert.equal(again.match(/<!-- last-full:/g).length, 1);
    assert.deepEqual(parseLastFull(again), { sha: 'feedface'.repeat(5), result: 'passed' });
    assert.equal(parseLastFull('no marker'), null);
});

test('A run for an older commit posts only a full run record, and nothing else', () => {
    const fullInput = input({ tier: 'full', requester: 'octocat', flags: allFlags, jobs: allJobs('success') });
    const full = ciReport({ ...fullInput, steps: passedSteps });
    const standard = ciReport(input());
    assert.equal(commentBody(standard, undefined, false), standard.body);
    assert.equal(commentBody(standard, undefined, true), null);
    assert.equal(commentBody(standard, standard.body, true), null);

    const minimal = commentBody(full, undefined, true);
    assert.equal(
        minimal,
        [
            MARKER,
            `<!-- last-full: ${headSha} passed by=octocat run=${fullInput.runUrl} -->`,
            '',
            '**Full run:** add the `ci:full-requested` label to run every layer once on the current commit.<br>' +
                `Last full run: ✅ passed on \`abcdef0\`, requested by @octocat, [run](${fullInput.runUrl}).`,
        ].join('\n'),
    );
    assert.equal(commentBody(full, standard.body, true), withLastFull(standard.body, full.fullRun));
    const next = ciReport(input({ headSha: 'feedface'.repeat(5), lastFull: parseLastFull(minimal) }));
    assert.deepEqual(parseLastFull(next.body), full.fullRun);
});
