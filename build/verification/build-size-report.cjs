/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

function validateReport(report) {
    assert.equal(report.sizeBudget?.enforced, true, 'Build sizes require an enforced L1 sizeBudget report');
    assert.ok(Array.isArray(report.sizeBudget.graphs) && report.sizeBudget.graphs.length > 0, 'Missing L1 graphs');
    assert.ok(Array.isArray(report.sizeBudget.failures), 'Missing L1 budget failures');
    for (const entry of report.sizeBudget.graphs) {
        assert.equal(typeof entry.graph, 'string', 'Invalid L1 graph name');
        assert.ok(
            entry.bytes === null || (Number.isSafeInteger(entry.bytes) && entry.bytes >= 0),
            'Invalid graph bytes',
        );
        assert.ok(['ok', 'below', 'over', 'missing', 'unbudgeted'].includes(entry.status), 'Invalid L1 budget status');
    }
    assert.ok(Number.isSafeInteger(report.vsixBytes?.bytes) && report.vsixBytes.bytes >= 0, 'Invalid L1 VSIX bytes');
    assert.equal(
        report.sizeBudget.graphs.find((entry) => entry.graph === 'vsix')?.bytes,
        report.vsixBytes.bytes,
        'L1 VSIX measurements disagree',
    );
}

function cacheSizes(report) {
    validateReport(report);
    return {
        version: 2,
        vsixSize: report.vsixBytes.bytes,
        graphSizes: Object.fromEntries(report.sizeBudget.graphs.map((entry) => [entry.graph, entry.bytes])),
    };
}

function baseBytes(base, graph) {
    const bytes = graph === 'vsix' ? base?.vsixSize : base?.graphSizes?.[graph];
    if (bytes === undefined || bytes === null) return null;
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, `Invalid base bytes for ${graph}`);
    return bytes;
}

function formatBytes(bytes) {
    return bytes === null ? 'N/A' : bytes.toLocaleString('en-US');
}

function formatDelta(bytes, base) {
    if (bytes === null || base === null) return 'N/A';
    const diff = bytes - base;
    const sign = diff > 0 ? '+' : '';
    const percent = base > 0 ? ` (${sign}${((diff / base) * 100).toFixed(1)}%)` : '';
    return `${sign}${formatBytes(diff)}${percent}`;
}

function sizeTable(report, base, currentLabel = 'PR bytes') {
    validateReport(report);
    return [
        `| Graph | ${currentLabel} | Base bytes | Delta bytes | Budget status (limit bytes) |`,
        '|-------|----------|------------|-------------|-----------------------------|',
        ...report.sizeBudget.graphs.map((entry) => {
            const previous = baseBytes(base, entry.graph);
            return `| \`${entry.graph}\` | ${formatBytes(entry.bytes)} | ${formatBytes(previous)} | ${formatDelta(entry.bytes, previous)} | ${entry.status} (${formatBytes(entry.limitBytes)}) |`;
        }),
    ].join('\n');
}

function buildSizeComment(report, base, options) {
    const lines = ['<!-- build-size-report -->', '## Build Size Report', '', `L1 inspection: **${options.outcome}**.`];
    if (report) {
        lines.push(
            `Size budget: **${report.sizeBudget.failures.length ? 'FAILED' : 'passed'}**${report.sizeBudget.failures.length ? ` (${report.sizeBudget.failures.join(', ')})` : ''}.`,
            '',
            `Baseline branch: \`${options.baseRef}\`. Sizes are packaged bytes; shared chunks count in each graph, so rows must not be summed.`,
            '',
            sizeTable(report, base),
        );
        if (!base) {
            lines.push(
                '',
                '> No baseline cached yet. Seed the base branch with the Build Size Cache workflow, or wait for its next push build.',
            );
        } else if (!base.graphSizes) {
            lines.push(
                '',
                '> Legacy baseline: per-graph base values are unavailable. Only the VSIX delta is comparable; the old webviewSize is not a view graph.',
            );
        } else {
            lines.push('', '> N/A means a graph measurement is unavailable in the PR or base report.');
        }
    } else {
        lines.push(
            '',
            '> L1 did not produce a size-budget report. See the job logs and available artifacts; no size comparison can be made.',
        );
    }
    lines.push(
        '',
        `Artifacts: [VSIX](${options.vsixUrl || options.runUrl}) | [Bundle-reports-${options.runId}](${options.bundleUrl || options.runUrl}) | [L1-manifest-report-${options.runId}](${options.l1Url || options.runUrl})`,
        '',
        '_This marker comment is updated automatically on each push._',
    );
    return lines.join('\n');
}

if (require.main === module) {
    const [reportFile, cacheFile] = process.argv.slice(2);
    assert.ok(reportFile && cacheFile, 'Usage: node build-size-report.cjs <l1-report.json> <build-sizes.json>');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    fs.writeFileSync(cacheFile, JSON.stringify(cacheSizes(report), null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Build Sizes\n\n${sizeTable(report, null, 'Current bytes')}\n\nCache key: \`build-sizes-${process.env.GITHUB_REF_NAME}-${process.env.GITHUB_SHA}\`\n`,
        );
    }
}

module.exports = { cacheSizes, sizeTable, buildSizeComment };
