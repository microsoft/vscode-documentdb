/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

// Operator decision (G8 item 22): a size change only warns, when it reaches either threshold.
const SIZE_CHANGE_FRACTION = 0.05;
const SIZE_CHANGE_BYTES = 50 * 1024;
const THRESHOLDS = `${SIZE_CHANGE_FRACTION * 100}% or ${SIZE_CHANGE_BYTES / 1024} KiB`;
// Per flagged graph, the packages whose approximate size moved most.
const PACKAGE_CHANGE_BYTES = 1024;
const PACKAGE_CHANGE_COUNT = 3;
const OTHER_PACKAGES = '(other)';

// What users wait for, listed first; every other graph follows in L1 report order.
const PRIMARY_GRAPHS = {
    collectionView: 'Collection View page',
    documentView: 'Document View page',
    localQuickStart: 'Local Quick Start page',
    atlasCredentials: 'Atlas Credentials page',
    clusterDashboard: 'Cluster Dashboard page',
    mainStartup: 'Activation',
    main: 'Extension host',
    playgroundWorker: 'Playground worker',
    vsix: 'VSIX',
};

function validatePackages(graphPackages, source) {
    for (const [graph, packages] of Object.entries(graphPackages ?? {})) {
        for (const [name, bytes] of Object.entries(packages)) {
            assert.ok(
                Number.isSafeInteger(bytes) && bytes >= 0,
                `Invalid ${source} package bytes for ${graph}: ${name}`,
            );
        }
    }
}

function validateReport(report) {
    assert.ok(report.graphSizes && typeof report.graphSizes === 'object', 'Missing L1 graphSizes');
    assert.ok(Object.keys(report.graphSizes).length > 0, 'Missing L1 graphs');
    for (const [graph, bytes] of Object.entries(report.graphSizes)) {
        assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, `Invalid L1 bytes for ${graph}`);
    }
    assert.ok(Number.isSafeInteger(report.vsixBytes?.bytes) && report.vsixBytes.bytes >= 0, 'Invalid L1 VSIX bytes');
    assert.equal(report.graphSizes.vsix, report.vsixBytes.bytes, 'L1 VSIX measurements disagree');
    validatePackages(report.graphPackages, 'L1');
    if (report.graphPackages) {
        assert.ok(
            Number.isSafeInteger(report.graphPackagesLimit) && report.graphPackagesLimit > 0,
            'Invalid L1 graphPackagesLimit',
        );
    }
}

function cacheSizes(report) {
    validateReport(report);
    return {
        version: 3,
        vsixSize: report.vsixBytes.bytes,
        graphSizes: { ...report.graphSizes },
        graphPackages: { ...report.graphPackages },
    };
}

function baseBytes(base, graph) {
    const bytes = graph === 'vsix' ? base?.vsixSize : base?.graphSizes?.[graph];
    if (bytes === undefined || bytes === null) return null;
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, `Invalid base bytes for ${graph}`);
    return bytes;
}

/** One row per graph in the PR or the base: primary graphs first, `change` set when a threshold is reached. */
function compareSizes(report, base) {
    validateReport(report);
    const names = new Set([...Object.keys(report.graphSizes), ...Object.keys(base?.graphSizes ?? {})]);
    const ordered = [
        ...Object.keys(PRIMARY_GRAPHS).filter((graph) => names.has(graph)),
        ...[...names].filter((graph) => !Object.hasOwn(PRIMARY_GRAPHS, graph)),
    ];
    return ordered.map((graph) => {
        const bytes = Object.hasOwn(report.graphSizes, graph) ? report.graphSizes[graph] : null;
        const previous = baseBytes(base, graph);
        const delta = bytes === null || previous === null ? null : bytes - previous;
        const moved =
            delta !== null &&
            delta !== 0 &&
            (Math.abs(delta) >= SIZE_CHANGE_BYTES || Math.abs(delta) >= previous * SIZE_CHANGE_FRACTION);
        return { graph, bytes, base: previous, delta, change: moved ? (delta > 0 ? 'growth' : 'decrease') : null };
    });
}

function formatSize(bytes) {
    const size = Math.abs(bytes);
    if (size >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    if (size >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
}

function signed(delta, text) {
    return delta > 0 ? `+${text}` : text;
}

function arrow(delta, text) {
    return `${delta > 0 ? '⬆️' : delta < 0 ? '⬇️' : '✅'} ${signed(delta, text)}`;
}

function formatPercent(delta, base) {
    return base > 0 ? signed(delta, `${((delta / base) * 100).toFixed(1)}%`) : 'n/a';
}

function formatBytes(bytes) {
    return bytes === null ? 'n/a' : bytes.toLocaleString('en-US');
}

function label(graph, code = (name) => `\`${name}\``) {
    return Object.hasOwn(PRIMARY_GRAPHS, graph) ? `${PRIMARY_GRAPHS[graph]} (${code(graph)})` : code(graph);
}

/**
 * The packages of one graph whose approximate bytes changed most, largest first. Empty when either
 * side has no package data (a v2 or legacy base). A package tracked on one side only is marked
 * `entered` or `left`; its delta is known only when the other side has no `(other)` (it is then 0
 * there), otherwise `bytes` is its size on the side that tracks it and `delta` is null.
 */
function packageChanges(report, base, graph) {
    const current = report.graphPackages?.[graph];
    const previous = base?.graphPackages?.[graph];
    if (!current || !previous) return [];
    validatePackages({ [graph]: previous }, 'base');
    const changes = [];
    for (const name of new Set([...Object.keys(current), ...Object.keys(previous)])) {
        if (name === OTHER_PACKAGES) continue;
        const now = current[name] ?? (Object.hasOwn(current, OTHER_PACKAGES) ? undefined : 0);
        const was = previous[name] ?? (Object.hasOwn(previous, OTHER_PACKAGES) ? undefined : 0);
        const delta = now === undefined || was === undefined ? null : now - was;
        const bytes = now ?? was;
        if (Math.abs(delta ?? bytes) < PACKAGE_CHANGE_BYTES) continue;
        const marker = !Object.hasOwn(previous, name) ? 'entered' : !Object.hasOwn(current, name) ? 'left' : null;
        changes.push({ name, delta, bytes, marker });
    }
    return changes
        .sort((a, b) => Math.abs(b.delta ?? b.bytes) - Math.abs(a.delta ?? a.bytes) || (a.name < b.name ? -1 : 1))
        .slice(0, PACKAGE_CHANGE_COUNT);
}

/** Exact bytes for every graph; without a base, the PR sizes only. */
function sizeTable(report, base, currentLabel = 'PR bytes') {
    const rows = compareSizes(report, base);
    if (!base) {
        return [
            `| Graph | ${currentLabel} |`,
            '|-------|------:|',
            ...rows.map((row) => `| ${label(row.graph)} | ${formatBytes(row.bytes)} |`),
        ].join('\n');
    }
    return [
        `| Graph | ${currentLabel} | Base bytes | Delta bytes | Delta % |`,
        '|-------|------:|------:|------:|------:|',
        ...rows.map(
            (row) =>
                `| ${label(row.graph)} | ${formatBytes(row.bytes)} | ${formatBytes(row.base)} | ${row.delta === null ? 'n/a' : arrow(row.delta, formatBytes(row.delta))} | ${row.delta === null ? 'n/a' : formatPercent(row.delta, row.base)} |`,
        ),
    ].join('\n');
}

/** One GitHub warning annotation per graph that grew by a threshold or more. */
function sizeWarnings(report, base, baseRef) {
    if (!report || !base) return [];
    return compareSizes(report, base)
        .filter((row) => row.change === 'growth')
        .map((row) => ({
            title: `Size grew: ${row.graph}`,
            message: `${label(row.graph, (name) => name)} grew by ${formatSize(row.delta)} (${formatPercent(row.delta, row.base)}) against ${baseRef}: ${formatSize(row.bytes)}, was ${formatSize(row.base)}. Warning only, at ${THRESHOLDS} or more.`,
        }));
}

/** The build size section of the CI report comment, also written to the L1 job summary. */
function buildSizeComment(report, base, options) {
    const ref = `\`${options.baseRef}\``;
    const bundleLink = `[Bundle-reports-${options.runId}](${options.bundleUrl || options.runUrl})`;
    const artifacts = `Artifacts: [VSIX](${options.vsixUrl || options.runUrl}) | ${bundleLink} | [L1-manifest-report-${options.runId}](${options.l1Url || options.runUrl})`;
    const lines = ['### Build size', ''];
    if (options.outcome !== 'success') {
        lines.push(`L1 inspection: **${options.outcome}**; see the job log.`, '');
    }
    if (!report) {
        lines.push('L1 did not produce a size report, so no sizes can be compared.', '', artifacts);
        return lines.join('\n');
    }
    const vsix = `VSIX: ${formatSize(report.vsixBytes.bytes)}.`;
    if (!base) {
        lines.push(`No size data for ${ref} yet; sizes only. ${vsix}`);
    } else {
        if (!base.graphSizes) {
            lines.push(`The cached ${ref} sizes predate per-graph data; only the VSIX is compared.`, '');
        }
        const moved = compareSizes(report, base).filter((row) => row.change);
        const top = `top ${report.graphPackagesLimit}`;
        const packageLines = moved.flatMap((row) => {
            const changes = packageChanges(report, base, row.graph);
            if (changes.length === 0) return [];
            const listed = changes.map(
                (change) =>
                    `\`${change.name}\` ${change.delta === null ? formatSize(change.bytes) : signed(change.delta, formatSize(change.delta))}${change.marker ? ` (${change.marker} ${top})` : ''}`,
            );
            return [
                `- ${label(row.graph)}, biggest package changes (approx., before minification): ${listed.join(', ')}`,
            ];
        });
        if (packageLines.length > 0) {
            packageLines.push(
                '',
                `_Only each graph's ${report.graphPackagesLimit} largest packages are tracked; the rest are counted as \`${OTHER_PACKAGES}\`, so "entered/left ${top}" can mean a package crossed that line, not that it was added or removed._`,
            );
        }
        if (moved.length === 0) {
            lines.push(
                base.graphSizes
                    ? `No page, activation, VSIX or other bundle size changed by ${THRESHOLDS} or more against ${ref}. ${vsix}`
                    : `The VSIX size did not change by ${THRESHOLDS} or more against ${ref}. ${vsix}`,
            );
        } else {
            lines.push(
                `Sizes that changed by ${THRESHOLDS} or more against ${ref} (warning only):`,
                '',
                '| Graph | PR | Base | Delta | Delta % |',
                '|-------|---:|-----:|------:|--------:|',
                ...moved.map(
                    (row) =>
                        `| ${label(row.graph)} | ${formatSize(row.bytes)} | ${formatSize(row.base)} | ${row.change === 'growth' ? '⚠️ ' : ''}${arrow(row.delta, formatSize(row.delta))} | ${formatPercent(row.delta, row.base)} |`,
                ),
                '',
                ...(packageLines.length > 0 ? [...packageLines, ''] : []),
                `To find out why, compare the chunks (\`bytes\`, \`moduleIds\`) in \`host.json\` and \`views.json\` from ${bundleLink} with the same reports from a ${ref} build.`,
            );
        }
    }
    lines.push(
        '',
        '<details>',
        '<summary>All graphs (exact bytes)</summary>',
        '',
        sizeTable(report, base),
        '',
        'Packaged bytes. Shared chunks count in every graph that loads them, so rows do not add up.',
        '',
        artifacts,
        '',
        '</details>',
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
            `## Build Sizes\n\n${sizeTable(report, null, 'Bytes')}\n\nCache key: \`build-sizes-${process.env.GITHUB_REF_NAME}-${process.env.GITHUB_SHA}\`\n`,
        );
    }
}

module.exports = { buildSizeComment, cacheSizes, compareSizes, packageChanges, sizeTable, sizeWarnings };
