/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cacheSizes, buildSizeComment } = require('./build-size-report.cjs');

const report = {
    vsixBytes: { bytes: 8000 },
    sizeBudget: {
        enforced: true,
        graphs: [
            { graph: 'collectionView', bytes: 6000, limitBytes: 6600, status: 'ok' },
            { graph: 'vsix', bytes: 8000, limitBytes: 8800, status: 'ok' },
        ],
        failures: [],
    },
};
const options = {
    outcome: 'success',
    baseRef: 'main',
    runId: '123',
    runUrl: 'https://github.com/example/project/actions/runs/123',
    vsixUrl: 'https://example.test/vsix',
    bundleUrl: 'https://example.test/bundle',
    l1Url: 'https://example.test/l1',
};

test('Cache contains L1 measurements, not a views.js proxy', () => {
    assert.deepEqual(cacheSizes(report), {
        version: 2,
        vsixSize: 8000,
        graphSizes: { collectionView: 6000, vsix: 8000 },
    });
});

test('Legacy base compares only the VSIX and explicitly withholds per-view deltas', () => {
    const body = buildSizeComment(report, { vsixSize: 10000, webviewSize: 50000 }, options);
    assert.ok(body.includes('| `collectionView` | 6,000 | N/A | N/A | ok (6,600) |'));
    assert.ok(body.includes('| `vsix` | 8,000 | 10,000 | -2,000 (-20.0%) | ok (8,800) |'));
    assert.ok(body.includes('per-graph base values are unavailable'));
});

test('New base compares each matching graph, including exact zero deltas', () => {
    const body = buildSizeComment(report, cacheSizes(report), options);
    assert.ok(body.includes('| `collectionView` | 6,000 | 6,000 | 0 (0.0%) | ok (6,600) |'));
    assert.ok(body.includes('[Bundle-reports-123](https://example.test/bundle)'));
    assert.ok(body.includes('[L1-manifest-report-123](https://example.test/l1)'));
});

test('Absent or partially populated baselines never manufacture deltas', () => {
    assert.ok(buildSizeComment(report, null, options).includes('No baseline cached yet'));
    const body = buildSizeComment(report, { vsixSize: 8000, graphSizes: {} }, options);
    assert.ok(body.includes('| `collectionView` | 6,000 | N/A | N/A |'));
});

test('Budget failures retain the table, failure status and artifact links', () => {
    const failed = structuredClone(report);
    failed.sizeBudget.graphs[0] = { graph: 'collectionView', bytes: 7000, limitBytes: 6600, status: 'over' };
    failed.sizeBudget.failures = ['collectionView'];
    const body = buildSizeComment(failed, cacheSizes(report), { ...options, outcome: 'failure' });
    assert.ok(body.includes('L1 inspection: **failure**'));
    assert.ok(body.includes('Size budget: **FAILED** (collectionView)'));
    assert.ok(body.includes('| `collectionView` | 7,000 | 6,000 | +1,000 (+16.7%) | over (6,600) |'));
    assert.ok(body.includes('[L1-manifest-report-123](https://example.test/l1)'));
});

test('Missing graphs and reports are reported, not hidden behind zero sizes', () => {
    const missing = structuredClone(report);
    missing.sizeBudget.graphs[0] = { graph: 'collectionView', bytes: null, limitBytes: 6600, status: 'missing' };
    missing.sizeBudget.failures = ['collectionView'];
    assert.ok(
        buildSizeComment(missing, cacheSizes(report), options).includes(
            '| `collectionView` | N/A | 6,000 | N/A | missing',
        ),
    );
    assert.ok(
        buildSizeComment(null, null, { ...options, outcome: 'failure' }).includes('no size comparison can be made'),
    );
});

test('Malformed L1 and baseline data fail explicitly', () => {
    assert.throws(
        () => cacheSizes({ ...report, sizeBudget: { ...report.sizeBudget, enforced: false } }),
        /enforced L1/,
    );
    assert.throws(() => buildSizeComment(report, { vsixSize: 'bad' }, options), /Invalid base bytes/);
    assert.throws(() => cacheSizes({ ...report, vsixBytes: { bytes: 9000 } }), /measurements disagree/);
});
