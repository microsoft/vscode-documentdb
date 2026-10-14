/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The one PR comment for a CI run (decision 0002): which layers ran and why, then code quality and build size.
const MARKER = '<!-- ci-report -->';
const OLD_MARKERS = ['<!-- code-quality-report -->', '<!-- build-size-report -->'];
const FULL_LABEL = 'ci:full-requested';
const LAST_FULL = /<!-- last-full: ([0-9a-f]{7,40}) ([a-z ]+) -->/;
const FULL_LINE = /^\*\*Full run:\*\*.*$/m;

const ICONS = {
    passed: '✅',
    failed: '❌',
    cancelled: '🚫',
    skipped: '⏭️',
    'not run': '⚠️',
    'not available yet': '⏭️',
};
const DRAFT = 'draft PR; runs when marked ready';
const FULL = 'full run requested';
const PACKAGES = '`packages/**`, `package-lock.json` or the CI workflow';
const WEBVIEW_PACKAGE = '`packages/vscode-ext-webview/**`, `package-lock.json` or the CI workflow';
const VERIFICATION =
    '`build/verification/**`, `build/vite/**`, the Vite configs, `package-lock.json` or the CI workflow';
const QUALITY = [
    ['l10n', 'Localization (`l10n`)', 'Run `npm run l10n` and commit the updated files.'],
    ['lint', 'ESLint', 'Run `npm run lint` and fix the reported issues.'],
    ['prettier', 'Prettier formatting', 'Run `npm run prettier-fix` to auto-format, then commit.'],
];
const OUTCOMES = { success: 'passed', failure: 'failed', cancelled: 'cancelled' };

const short = (sha) => sha.slice(0, 7);

/** The steps behind one row; a step without an outcome did not run, unless its job was cancelled. */
function fromSteps(outcomes, jobResult) {
    const results = outcomes.map(
        (outcome) => OUTCOMES[outcome] ?? (jobResult === 'cancelled' ? 'cancelled' : 'not run'),
    );
    return ['failed', 'cancelled', 'not run'].find((result) => results.includes(result)) ?? 'passed';
}

/**
 * One row per layer. The plan job sets every path flag in the full tier and none in the fast tier,
 * so a flag alone says whether its check was meant to run.
 */
function layers({ tier, flags, jobs, steps }) {
    const vsix = tier === 'standard' || tier === 'full';
    const tierWhy = tier === 'full' ? FULL : tier === 'fast' ? DRAFT : null;
    const scoped = (flag, paths) => tierWhy ?? (flag ? `${paths} changed` : `runs when ${paths} change`);
    const row = (layer, expected, outcome, why) => {
        if (!expected) return { layer, result: 'skipped', why };
        const result = outcome();
        return { layer, result, why: result === 'not run' ? 'an earlier job or step failed' : why };
    };
    return [
        row('L0 build, lint and unit tests', true, () => fromSteps([jobs.quality]), 'runs on every push'),
        row('Package checks', flags.packages, () => fromSteps([jobs.packages]), scoped(flags.packages, PACKAGES)),
        row('L1 VSIX inspection', vsix, () => fromSteps([steps.inspect], jobs.l1), tierWhy ?? 'runs on ready PRs'),
        row(
            'L1 negative controls and verification tool tests',
            flags.verification,
            () => fromSteps([steps.prove, steps['verification-tests']], jobs.l1),
            scoped(flags.verification, VERIFICATION),
        ),
        row('L3 activation', vsix, () => fromSteps([steps.activation], jobs.l3), tierWhy ?? 'runs on ready PRs'),
        row(
            'L3 negative control',
            flags.verification,
            () => fromSteps([steps['prove-activation']], jobs.l3),
            scoped(flags.verification, VERIFICATION),
        ),
        row(
            'Unbundled `/host` probe',
            flags.webviewPackage,
            () => fromSteps([steps['host-probe']], jobs.l3),
            scoped(flags.webviewPackage, WEBVIEW_PACKAGE),
        ),
        { layer: 'E2E', result: 'not available yet', why: 'arrives with the E2E iteration, in the full tier' },
    ];
}

function parseLastFull(body) {
    const match = LAST_FULL.exec(body ?? '');
    return match ? { sha: match[1], result: match[2] } : null;
}

function fullRunLine(lastFull) {
    const last = lastFull
        ? `Last full run: ${ICONS[lastFull.result] ?? ''} ${lastFull.result} on \`${short(lastFull.sha)}\`.`
        : 'No full run yet.';
    return `**Full run:** add the \`${FULL_LABEL}\` label to run every layer once on the current commit. ${last}`;
}

/**
 * The comment for one run: `input.flags` and `input.steps` come from the plan and the job outputs,
 * `input.jobs` from the job results, `input.lastFull` from the existing comment.
 */
function ciReport(input) {
    const rows = layers(input);
    const results = rows.map((row) => row.result);
    const result =
        results.includes('failed') || results.includes('not run')
            ? 'failed'
            : results.includes('cancelled')
              ? 'cancelled'
              : 'passed';
    const lastFull = input.tier === 'full' ? { sha: input.headSha, result } : input.lastFull;
    const l1 = rows.find((row) => row.layer === 'L1 VSIX inspection');
    const size =
        input.sizeSection?.trim() ||
        `### Build size\n\nNot measured: ${l1.result === 'skipped' ? l1.why : 'L1 did not write a size section; see the workflow run'}.`;
    const lines = [
        MARKER,
        ...(lastFull ? [`<!-- last-full: ${lastFull.sha} ${lastFull.result} -->`] : []),
        `## ${ICONS[result]} CI ${result}: ${input.tier} tier (${input.reason})`,
        '',
        `Commit \`${short(input.headSha)}\`, [workflow run](${input.runUrl}).`,
        '',
        '| Layer | Result | Why |',
        '|-------|--------|-----|',
        ...rows.map((row) => `| ${row.layer} | ${ICONS[row.result]} ${row.result} | ${row.why} |`),
        '',
        ...(input.tier === 'full' ? [] : [fullRunLine(lastFull), '']),
        '### Code quality',
        '',
        '| Check | Status | How to fix |',
        '|-------|--------|------------|',
        ...QUALITY.map(([key, name, hint]) => {
            const outcome = input.steps[key];
            const status = outcome === 'success' ? '✅ Passed' : outcome === 'failure' ? '❌ Failed' : '⏭️ Not run';
            return `| ${name} | ${status} | ${outcome === 'failure' ? hint : ''} |`;
        }),
        '',
        size,
        '',
        '_Updated in place on every run._',
    ];
    return { body: lines.join('\n'), result };
}

/** A full run that finished after the PR moved on records itself without replacing the newer report. */
function withLastFull(body, lastFull) {
    const marker = `<!-- last-full: ${lastFull.sha} ${lastFull.result} -->`;
    const marked = LAST_FULL.test(body)
        ? body.replace(LAST_FULL, () => marker)
        : body.replace(MARKER, () => `${MARKER}\n${marker}`);
    return marked.replace(FULL_LINE, () => fullRunLine(lastFull));
}

module.exports = { MARKER, OLD_MARKERS, ciReport, parseLastFull, withLastFull };
