/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The one PR comment for a CI run (decision 0002): which layers ran and why, then code quality and build size.
const MARKER = '<!-- ci-report -->';
const OLD_MARKERS = ['<!-- code-quality-report -->', '<!-- build-size-report -->'];
const FULL_LABEL = 'ci:full-requested';
// `by=` and `run=` are optional so a marker written before they existed still parses.
const LAST_FULL =
    /<!-- last-full: ([0-9a-f]{7,40}) ([a-z]+)(?: by=([A-Za-z0-9-]+))?(?: run=(https:\/\/[\w.:/-]+))? -->/;
const LOGIN = /^[A-Za-z0-9-]+$/;
const RUN_URL = /^https:\/\/[\w.:/-]+$/;
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

/** Drops a requester or URL that could break the hidden marker or the Markdown link. */
function fullRun({ sha, result, requester, runUrl }) {
    return {
        sha,
        result,
        ...(LOGIN.test(requester ?? '') && { requester }),
        ...(RUN_URL.test(runUrl ?? '') && { runUrl }),
    };
}

function parseLastFull(body) {
    const match = LAST_FULL.exec(body ?? '');
    return match ? fullRun({ sha: match[1], result: match[2], requester: match[3], runUrl: match[4] }) : null;
}

function lastFullMarker(lastFull) {
    const by = lastFull.requester ? ` by=${lastFull.requester}` : '';
    const run = lastFull.runUrl ? ` run=${lastFull.runUrl}` : '';
    return `<!-- last-full: ${lastFull.sha} ${lastFull.result}${by}${run} -->`;
}

function fullRunLine(lastFull) {
    const last = lastFull
        ? [
              `Last full run: ${ICONS[lastFull.result] ?? ''} ${lastFull.result} on \`${short(lastFull.sha)}\``,
              ...(lastFull.requester ? [`requested by @${lastFull.requester}`] : []),
              ...(lastFull.runUrl ? [`[run](${lastFull.runUrl})`] : []),
          ].join(', ') + '.'
        : 'No full run yet.';
    return `**Full run:** add the \`${FULL_LABEL}\` label to run every layer once on the current commit. ${last}`;
}

/**
 * The comment for one run: `input.flags` and `input.steps` come from the plan and the job outputs,
 * `input.jobs` from the job results, `input.lastFull` from the existing comment.
 * `fullRun` is this run's record when it is a full run.
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
    const thisRun =
        input.tier === 'full'
            ? fullRun({ sha: input.headSha, result, requester: input.requester, runUrl: input.runUrl })
            : null;
    const lastFull = thisRun ?? input.lastFull;
    const l1 = rows.find((row) => row.layer === 'L1 VSIX inspection');
    const size =
        input.sizeSection?.trim() ||
        `### Build size\n\nNot measured: ${l1.result === 'skipped' ? l1.why : 'L1 did not write a size section; see the workflow run'}.`;
    const lines = [
        MARKER,
        ...(lastFull ? [lastFullMarker(lastFull)] : []),
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
    return { body: lines.join('\n'), result, fullRun: thisRun };
}

/** A full run that finished after the PR moved on records itself without replacing the newer report. */
function withLastFull(body, lastFull) {
    const marker = lastFullMarker(fullRun(lastFull));
    const marked = LAST_FULL.test(body)
        ? body.replace(LAST_FULL, () => marker)
        : body.replace(MARKER, () => `${MARKER}\n${marker}`);
    return marked.replace(FULL_LINE, () => fullRunLine(fullRun(lastFull)));
}

/**
 * The comment body to post, or null for none. A run for an older commit never posts its report:
 * a full run records only itself, in a minimal comment if there is none yet.
 */
function commentBody(report, existingBody, stale) {
    if (!stale) return report.body;
    if (!report.fullRun) return null;
    if (existingBody) return withLastFull(existingBody, report.fullRun);
    return [MARKER, lastFullMarker(report.fullRun), '', fullRunLine(report.fullRun)].join('\n');
}

module.exports = { MARKER, OLD_MARKERS, ciReport, commentBody, parseLastFull, withLastFull };
