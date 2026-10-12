/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildSizeComment, cacheSizes, sizeWarnings } = require('./build-size-report.cjs');

// The 14 graphs inspect.cjs measures, in its order.
const graphSizes = {
    main: 9_500_000,
    mainStartup: 3_000_000,
    playgroundWorker: 5_300_000,
    playgroundTsPlugin: 6_000,
    viewsEntry: 1_400_000,
    viewsAssets: 80_000,
    collectionView: 6_000_000,
    documentView: 4_800_000,
    localQuickStart: 1_500_000,
    atlasCredentials: 1_500_000,
    clusterDashboard: 1_700_000,
    editorWorker: 260_000,
    jsonWorker: 390_000,
    vsix: 8_000_000,
};
const report = { vsixBytes: { bytes: graphSizes.vsix }, graphAssetBytes: {}, graphSizes };
const base = cacheSizes(report);
const options = {
    outcome: 'success',
    baseRef: 'main',
    runId: '123',
    runUrl: 'https://github.com/example/project/actions/runs/123',
    vsixUrl: 'https://example.test/vsix',
    bundleUrl: 'https://example.test/bundle',
    l1Url: 'https://example.test/l1',
};

function withSizes(changes) {
    const changed = { ...graphSizes, ...changes };
    return { vsixBytes: { bytes: changed.vsix }, graphAssetBytes: {}, graphSizes: changed };
}

function visible(body) {
    return body.split('<details>')[0].trim();
}

test('No change gives a single quiet line, with every graph in the collapsed details', () => {
    const body = buildSizeComment(report, base, options);
    assert.equal(
        visible(body),
        [
            '<!-- build-size-report -->',
            '## Build Size Report',
            '',
            'No page, activation, VSIX or other bundle size changed by 5% or 50 KiB or more against `main`. VSIX: 7.6 MiB.',
        ].join('\n'),
    );
    assert.ok(!body.includes('⚠'));
    assert.ok(body.includes('| Collection View page (`collectionView`) | 6,000,000 | 6,000,000 | 0 | 0.0% |'));
    assert.ok(body.includes('| `jsonWorker` | 390,000 | 390,000 | 0 | 0.0% |'));
    assert.equal(body.match(/^\| (?!Graph|-)/gm).length, 14);
    assert.ok(body.includes('[Bundle-reports-123](https://example.test/bundle)'));
    assert.deepEqual(sizeWarnings(report, base, 'main'), []);
});

test('5% growth on a small graph is flagged with a warning sign and an annotation', () => {
    const grown = withSizes({ playgroundTsPlugin: 6_300 });
    const body = buildSizeComment(grown, base, options);
    assert.ok(visible(body).includes('Sizes that changed by 5% or 50 KiB or more against `main` (warning only):'));
    assert.ok(visible(body).includes('| `playgroundTsPlugin` | 6.2 KiB | 5.9 KiB | ⚠ +300 B | +5.0% |'));
    assert.equal(visible(body).match(/^\| (?!Graph|-)/gm).length, 1);
    assert.ok(visible(body).includes('To find out why'));
    assert.ok(visible(body).includes('[Bundle-reports-123](https://example.test/bundle)'));
    assert.deepEqual(sizeWarnings(grown, base, 'main'), [
        {
            title: 'Size grew: playgroundTsPlugin',
            message:
                'playgroundTsPlugin grew by 300 B (+5.0%) against main: 6.2 KiB, was 5.9 KiB. Warning only, at 5% or 50 KiB or more.',
        },
    ]);
});

test('50 KiB growth on a large graph is flagged even under 5%', () => {
    const grown = withSizes({ collectionView: 6_000_000 + 51_200 });
    const body = buildSizeComment(grown, base, options);
    assert.ok(
        visible(body).includes('| Collection View page (`collectionView`) | 5.8 MiB | 5.7 MiB | ⚠ +50.0 KiB | +0.9% |'),
    );
    assert.deepEqual(
        sizeWarnings(grown, base, 'main').map((warning) => warning.title),
        ['Size grew: collectionView'],
    );
    assert.match(
        sizeWarnings(grown, base, 'main')[0].message,
        /^Collection View page \(collectionView\) grew by 50\.0 KiB \(\+0\.9%\) against main: /,
    );
});

test('Growth below both thresholds is not flagged', () => {
    const grown = withSizes({ collectionView: 6_000_000 + 51_199, playgroundTsPlugin: 6_299 });
    const body = buildSizeComment(grown, base, options);
    assert.ok(visible(body).includes('No page, activation, VSIX or other bundle size changed'));
    assert.ok(!body.includes('⚠'));
    assert.ok(body.includes('| Collection View page (`collectionView`) | 6,051,199 | 6,000,000 | +51,199 | +0.9% |'));
    assert.deepEqual(sizeWarnings(grown, base, 'main'), []);
});

test('A decrease beyond the threshold is listed without a warning', () => {
    const shrunk = withSizes({ mainStartup: 2_820_000 });
    const body = buildSizeComment(shrunk, base, options);
    assert.ok(visible(body).includes('| Activation (`mainStartup`) | 2.7 MiB | 2.9 MiB | -175.8 KiB | -6.0% |'));
    assert.ok(!body.includes('⚠'));
    assert.deepEqual(sizeWarnings(shrunk, base, 'main'), []);
});

test('Flagged rows list primary graphs first and include secondary graphs', () => {
    const changed = withSizes({ viewsAssets: 100_000, documentView: 4_000_000, vsix: 9_000_000 });
    const rows = visible(buildSizeComment(changed, base, options)).match(/^\| (?!Graph|-).*$/gm);
    assert.deepEqual(
        rows.map((row) => row.split(' | ')[0]),
        ['| Document View page (`documentView`)', '| VSIX (`vsix`)', '| `viewsAssets`'],
    );
});

test('A missing base gives an explicit note and sizes only', () => {
    const body = buildSizeComment(report, null, options);
    assert.ok(visible(body).endsWith('No size data for `main` yet; sizes only. VSIX: 7.6 MiB.'));
    assert.ok(body.includes('| Graph | PR bytes |'));
    assert.ok(body.includes('| Collection View page (`collectionView`) | 6,000,000 |'));
    assert.ok(!body.includes('Base bytes'));
    assert.deepEqual(sizeWarnings(report, null, 'main'), []);
});

test('A legacy cache entry compares only the VSIX and says so', () => {
    const legacy = { vsixSize: 8_000_000, webviewSize: 50_000 };
    const body = buildSizeComment(report, legacy, options);
    assert.ok(visible(body).includes('The cached `main` sizes predate per-graph data; only the VSIX is compared.'));
    assert.ok(visible(body).includes('The VSIX size did not change by 5% or 50 KiB or more against `main`.'));
    assert.ok(body.includes('| Collection View page (`collectionView`) | 6,000,000 | n/a | n/a | n/a |'));
    assert.ok(body.includes('| VSIX (`vsix`) | 8,000,000 | 8,000,000 | 0 | 0.0% |'));
    const grown = buildSizeComment(report, { ...legacy, vsixSize: 7_200_000 }, options);
    assert.ok(visible(grown).includes('| VSIX (`vsix`) | 7.6 MiB | 6.9 MiB | ⚠ +781.3 KiB | +11.1% |'));
    assert.deepEqual(
        sizeWarnings(report, { ...legacy, vsixSize: 7_200_000 }, 'main').map((warning) => warning.title),
        ['Size grew: vsix'],
    );
});

test('Graphs present on one side only show n/a and are never flagged', () => {
    const renamed = { ...graphSizes, renamedView: 1_000 };
    delete renamed.clusterDashboard;
    const body = buildSizeComment(
        { vsixBytes: report.vsixBytes, graphAssetBytes: {}, graphSizes: renamed },
        base,
        options,
    );
    assert.ok(visible(body).includes('No page, activation, VSIX or other bundle size changed'));
    assert.ok(body.includes('| Cluster Dashboard page (`clusterDashboard`) | n/a | 1,700,000 | n/a | n/a |'));
    assert.ok(body.includes('| `renamedView` | 1,000 | n/a | n/a | n/a |'));
});

test('The v2 cache keeps the L1 graph names, and the CLI writes it', () => {
    assert.deepEqual(base, { version: 2, vsixSize: 8_000_000, graphSizes });
    assert.deepEqual(Object.keys(base.graphSizes), [
        'main',
        'mainStartup',
        'playgroundWorker',
        'playgroundTsPlugin',
        'viewsEntry',
        'viewsAssets',
        'collectionView',
        'documentView',
        'localQuickStart',
        'atlasCredentials',
        'clusterDashboard',
        'editorWorker',
        'jsonWorker',
        'vsix',
    ]);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-build-sizes-'));
    try {
        const reportFile = path.join(directory, 'l1.json');
        const cacheFile = path.join(directory, 'build-sizes.json');
        fs.writeFileSync(reportFile, JSON.stringify(report));
        const env = { ...process.env };
        delete env.GITHUB_STEP_SUMMARY;
        execFileSync(process.execPath, [path.join(__dirname, 'build-size-report.cjs'), reportFile, cacheFile], { env });
        assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), base);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('An L1 failure without a report says no sizes can be compared', () => {
    const body = buildSizeComment(null, base, { ...options, outcome: 'failure' });
    assert.ok(body.includes('L1 inspection: **failure**; see the job log.'));
    assert.ok(body.includes('L1 did not produce a size report, so no sizes can be compared.'));
    assert.ok(body.includes('[L1-manifest-report-123](https://example.test/l1)'));
    assert.deepEqual(sizeWarnings(null, base, 'main'), []);
});

test('Malformed L1 and base data fail explicitly', () => {
    assert.throws(() => cacheSizes({ vsixBytes: { bytes: 1 } }), /Missing L1 graphSizes/);
    assert.throws(() => cacheSizes({ ...report, vsixBytes: { bytes: 9000 } }), /measurements disagree/);
    assert.throws(() => cacheSizes(withSizes({ main: -1 })), /Invalid L1 bytes for main/);
    assert.throws(() => buildSizeComment(report, { vsixSize: 'bad' }, options), /Invalid base bytes/);
});
