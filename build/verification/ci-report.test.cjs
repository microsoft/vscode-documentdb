/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MARKER, OLD_MARKERS, ciReport, commentBody, parseLastFull, withLastFull } = require('./ci-report.cjs');

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
const allJobs = (result) => ({ quality: result, packages: result, l1: result, l3: result });
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
    return body.match(/^\| (?!Layer|Check|-).*$/gm).slice(0, 8);
}

test('A draft PR runs L0 only and says why every other layer was skipped', () => {
    const { body, result } = ciReport(
        input({
            tier: 'fast',
            reason: 'draft PR',
            jobs: { quality: 'success', packages: 'skipped', l1: 'skipped', l3: 'skipped' },
            steps: { l10n: 'success', lint: 'success', prettier: 'success' },
            sizeSection: null,
        }),
    );
    assert.equal(result, 'passed');
    assert.ok(
        body.startsWith(`${MARKER}\n## ✅ CI passed: fast tier (draft PR)\n\nCommit \`abcdef0\`, [workflow run](`),
    );
    assert.deepEqual(rows(body), [
        '| L0 build, lint and unit tests | ✅ passed | runs on every push |',
        '| Package checks | ⏭️ skipped | draft PR; runs when marked ready |',
        '| L1 VSIX inspection | ⏭️ skipped | draft PR; runs when marked ready |',
        '| L1 negative controls and verification tool tests | ⏭️ skipped | draft PR; runs when marked ready |',
        '| L3 activation | ⏭️ skipped | draft PR; runs when marked ready |',
        '| L3 negative control | ⏭️ skipped | draft PR; runs when marked ready |',
        '| Unbundled `/host` probe | ⏭️ skipped | draft PR; runs when marked ready |',
        '| E2E | ⏭️ not available yet | arrives with the E2E iteration, in the full tier |',
    ]);
    assert.ok(
        body.includes(
            '**Full run:** add the `ci:full-requested` label to run every layer once on the current commit. No full run yet.',
        ),
    );
    assert.ok(body.includes('| Prettier formatting | ✅ Passed |  |'));
    assert.ok(body.includes('### Build size\n\nNot measured: draft PR; runs when marked ready.'));
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
    assert.deepEqual(rows(body).slice(1, 7), [
        '| Package checks | ✅ passed | `packages/**`, `package-lock.json` or the CI workflow changed |',
        '| L1 VSIX inspection | ✅ passed | runs on ready PRs |',
        '| L1 negative controls and verification tool tests | ⏭️ skipped | runs when `build/verification/**`, `build/vite/**`, the Vite configs, `package-lock.json` or the CI workflow change |',
        '| L3 activation | ✅ passed | runs on ready PRs |',
        '| L3 negative control | ⏭️ skipped | runs when `build/verification/**`, `build/vite/**`, the Vite configs, `package-lock.json` or the CI workflow change |',
        '| Unbundled `/host` probe | ⏭️ skipped | runs when `packages/vscode-ext-webview/**`, `package-lock.json` or the CI workflow change |',
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
            .slice(0, 7)
            .map((row) => row.split(' | ').slice(1).join(' | ')),
        ['✅ passed | runs on every push |', ...Array.from({ length: 6 }, () => '✅ passed | full run requested |')],
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
            jobs: { ...allJobs('failure'), packages: 'skipped', l3: 'success' },
            steps: { ...passedSteps, lint: 'failure', inspect: 'failure', prove: '', 'verification-tests': '' },
        }),
    );
    assert.equal(result, 'failed');
    assert.ok(body.startsWith(`${MARKER}\n## ❌ CI failed: standard tier (ready PR)`));
    assert.deepEqual(rows(body).slice(0, 4), [
        '| L0 build, lint and unit tests | ❌ failed | runs on every push |',
        '| Package checks | ⏭️ skipped | runs when `packages/**`, `package-lock.json` or the CI workflow change |',
        '| L1 VSIX inspection | ❌ failed | runs on ready PRs |',
        '| L1 negative controls and verification tool tests | ⚠️ not run | an earlier job or step failed |',
    ]);
    assert.ok(body.includes('| ESLint | ❌ Failed | Run `npm run lint` and fix the reported issues. |'));
});

test('Jobs skipped after an earlier failure are not run, and L1 says why sizes are missing', () => {
    const { body, result } = ciReport(
        input({
            jobs: { quality: 'failure', packages: 'skipped', l1: 'skipped', l3: 'skipped' },
            steps: { l10n: 'success', lint: 'success', prettier: 'failure' },
            sizeSection: null,
        }),
    );
    assert.equal(result, 'failed');
    assert.ok(rows(body).includes('| L1 VSIX inspection | ⚠️ not run | an earlier job or step failed |'));
    assert.ok(body.includes('Not measured: L1 did not write a size section; see the workflow run.'));
});

test('A cancelled run reports cancelled layers', () => {
    const { body, result } = ciReport(
        input({
            jobs: { quality: 'success', packages: 'skipped', l1: 'cancelled', l3: 'cancelled' },
            steps: { l10n: 'success', lint: 'success', prettier: 'success', inspect: 'success' },
        }),
    );
    assert.equal(result, 'cancelled');
    assert.ok(body.includes('## 🚫 CI cancelled: standard tier (ready PR)'));
    assert.ok(rows(body).includes('| L3 activation | 🚫 cancelled | runs on ready PRs |'));
});

test('A full run that finished after a newer push updates only the last full run', () => {
    const newer = ciReport(input({ headSha: 'feedface'.repeat(5) })).body;
    const updated = withLastFull(newer, { sha: headSha, result: 'failed' });
    assert.deepEqual(parseLastFull(updated), { sha: headSha, result: 'failed' });
    assert.ok(updated.includes('Last full run: ❌ failed on `abcdef0`.'));
    assert.equal(
        updated.replace(/<!-- last-full: .* -->\n/, '').replace(/ Last full run: .*$/m, ' No full run yet.'),
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
            '**Full run:** add the `ci:full-requested` label to run every layer once on the current commit. ' +
                `Last full run: ✅ passed on \`abcdef0\`, requested by @octocat, [run](${fullInput.runUrl}).`,
        ].join('\n'),
    );
    assert.equal(commentBody(full, standard.body, true), withLastFull(standard.body, full.fullRun));
    const next = ciReport(input({ headSha: 'feedface'.repeat(5), lastFull: parseLastFull(minimal) }));
    assert.deepEqual(parseLastFull(next.body), full.fullRun);
});
