/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    QUARANTINE,
    READY,
    decide,
    describe,
    labelChanges,
    reconcile,
    scanLockfile,
} = require('./dependabot-quarantine.cjs');

const now = new Date('2026-11-12T00:00:00.000Z');

function scanResult({ fresh = [], unknown = [], failures = [] } = {}) {
    return { fresh, unknown, failures };
}

function lockfile(versions) {
    const packages = { '': { name: 'fixture', dependencies: {} } };
    for (const [name, version] of Object.entries(versions)) {
        packages[''].dependencies[name] = version;
        packages[`node_modules/${name}`] = { version };
    }
    return JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages });
}

function pull(number, labels = [], login = 'dependabot[bot]') {
    return {
        number,
        user: { login },
        labels: labels.map((name) => ({ name })),
        base: { sha: `base-${number}` },
        head: { sha: `head-${number}` },
    };
}

function fakeGithub({ pulls, files = {}, labels = [QUARANTINE, READY], fail = {} }) {
    const writes = [];
    return {
        writes,
        hasLabel: async (name) => labels.includes(name),
        openPulls: async () => pulls,
        mergeBase: async (base, head) => `merge-base-${head}`,
        file: async (file, ref) => {
            if (fail[ref]) throw new Error(fail[ref]);
            return files[`${ref}:${file}`] ?? null;
        },
        addLabel: async (number, name) => writes.push(['add', number, name]),
        removeLabel: async (number, name) => writes.push(['remove', number, name]),
    };
}

// Maps lockfile text to a canned scan result and records what was scanned.
function fakeScan(results) {
    const calls = [];
    const scan = async (head, base) => {
        calls.push({ head, base });
        return results[head];
    };
    return { scan, calls };
}

test('A PR that adds no npm versions is ready to merge', () => {
    assert.deepEqual(decide([]), { verdict: READY, fresh: [] });
    assert.deepEqual(decide([scanResult(), scanResult()]), { verdict: READY, fresh: [] });
});

test('Fresh added versions quarantine the PR until the newest one clears', () => {
    const older = { name: 'a', version: '1.0.0', published: '2026-11-08T10:00:00.000Z' };
    const newer = { name: '@scope/b', version: '2.0.0', published: '2026-11-10T12:30:00.000Z' };

    const decision = decide([scanResult({ fresh: [older] }), scanResult({ fresh: [newer] })]);

    assert.equal(decision.verdict, QUARANTINE);
    assert.deepEqual(decision.fresh, [older, newer]);
    assert.equal(decision.clearsAt, '2026-11-17T12:30:00.000Z');
});

test('Incomplete lookups give no verdict', () => {
    const fresh = [{ name: 'a', version: '1.0.0', published: '2026-11-10T00:00:00.000Z' }];

    const failed = decide([scanResult({ fresh, failures: [{ name: 'b', error: 'HTTP 503' }] })]);
    const unknown = decide([scanResult(), scanResult({ unknown: ['c@1.0.0'] })]);

    assert.equal(failed.verdict, 'error');
    assert.match(failed.reason, /registry lookup failed for b/);
    assert.equal(unknown.verdict, 'error');
    assert.match(unknown.reason, /no npm publish time for c@1\.0\.0/);
});

test('Label changes touch only the two quarantine labels', () => {
    assert.deepEqual(labelChanges([], QUARANTINE), { add: [QUARANTINE], remove: [] });
    assert.deepEqual(labelChanges(['on-hold', READY, 'dependencies'], QUARANTINE), {
        add: [QUARANTINE],
        remove: [READY],
    });
    assert.deepEqual(labelChanges([QUARANTINE, READY, 'on-hold'], READY), { add: [], remove: [QUARANTINE] });
    assert.deepEqual(labelChanges([READY], READY), { add: [], remove: [] });
    assert.deepEqual(labelChanges([QUARANTINE], 'error'), { add: [], remove: [] });
});

test('Summary lines give the verdict, the clear date and the label changes', () => {
    assert.equal(
        describe({
            number: 7,
            verdict: QUARANTINE,
            fresh: [{}, {}],
            clearsAt: '2026-11-17T12:30:00.000Z',
            add: [QUARANTINE],
            remove: [READY],
        }),
        '#7: quarantine until 2026-11-17 12:30 UTC, 2 fresh version(s) (+quarantine -ready-to-merge)',
    );
    assert.equal(
        describe({ number: 8, verdict: READY, add: [], remove: [] }),
        '#8: ready-to-merge (labels already correct)',
    );
    assert.match(describe({ number: 9, verdict: 'error', add: [], remove: [] }), /^#9: error, labels unchanged/);
});

test('Reconcile scans changed lockfiles of Dependabot PRs against the merge base', async () => {
    const fresh = { name: 'a', version: '2.0.0', published: '2026-11-10T00:00:00.000Z' };
    const github = fakeGithub({
        pulls: [pull(1, ['on-hold']), pull(2, [QUARANTINE]), pull(3, [], 'someone'), pull(4, [READY])],
        files: {
            // #1 bumps the root lockfile and adds the api lockfile.
            'head-1:package-lock.json': 'root-head',
            'merge-base-head-1:package-lock.json': 'root-base',
            'head-1:api/package-lock.json': 'api-new',
            // #2 changes no lockfile, like a github-actions bump.
            'head-2:package-lock.json': 'same',
            'merge-base-head-2:package-lock.json': 'same',
            'head-3:package-lock.json': 'not-dependabot',
            'head-4:package-lock.json': 'clean-head',
            'merge-base-head-4:package-lock.json': 'clean-base',
        },
    });
    const { scan, calls } = fakeScan({
        'root-head': scanResult({ fresh: [fresh] }),
        'api-new': scanResult(),
        'clean-head': scanResult(),
    });

    const { missing, outcomes } = await reconcile({ github, scan, now });

    assert.deepEqual(missing, []);
    assert.deepEqual(calls, [
        { head: 'root-head', base: 'root-base' },
        { head: 'api-new', base: null },
        { head: 'clean-head', base: 'clean-base' },
    ]);
    assert.deepEqual(
        outcomes.map(({ number, verdict }) => [number, verdict]),
        [
            [1, QUARANTINE],
            [2, READY],
            [4, READY],
        ],
    );
    assert.deepEqual(github.writes, [
        ['add', 1, QUARANTINE],
        ['add', 2, READY],
        ['remove', 2, QUARANTINE],
    ]);
});

test('A failing PR keeps its labels and does not stop the others', async () => {
    const github = fakeGithub({
        pulls: [pull(1, [READY]), pull(2), pull(3, [QUARANTINE])],
        files: {
            'head-1:package-lock.json': 'incomplete',
            'merge-base-head-1:package-lock.json': 'base',
            'head-3:package-lock.json': 'clean',
            'merge-base-head-3:package-lock.json': 'base',
        },
        fail: { 'head-2': 'GET contents/package-lock.json: HTTP 502' },
    });
    const { scan } = fakeScan({
        incomplete: scanResult({ failures: [{ name: 'x', error: 'HTTP 503' }] }),
        clean: scanResult(),
    });

    const { outcomes } = await reconcile({ github, scan, now });

    assert.deepEqual(
        outcomes.map(({ number, verdict }) => [number, verdict]),
        [
            [1, 'error'],
            [2, 'error'],
            [3, READY],
        ],
    );
    assert.match(outcomes[1].reason, /HTTP 502/);
    assert.deepEqual(github.writes, [
        ['add', 3, READY],
        ['remove', 3, QUARANTINE],
    ]);
});

test('Dry run reports changes without writing', async () => {
    const github = fakeGithub({ pulls: [pull(1, [QUARANTINE])], labels: [] });

    const { missing, outcomes } = await reconcile({ github, scan: fakeScan({}).scan, now, dryRun: true });

    assert.deepEqual(missing, [QUARANTINE, READY]);
    assert.deepEqual(outcomes[0].add, [READY]);
    assert.deepEqual(outcomes[0].remove, [QUARANTINE]);
    assert.deepEqual(github.writes, []);
});

test('Missing labels stop a real run before any write', async () => {
    const github = fakeGithub({ pulls: [pull(1)], labels: [QUARANTINE] });

    await assert.rejects(reconcile({ github, scan: fakeScan({}).scan, now }), /Create the label\(s\) ready-to-merge/);
    assert.deepEqual(github.writes, []);
});

// Serves npm packuments for the real scanner; `failing` names answer 503.
async function fakeRegistry(t, published, failing = []) {
    const requests = [];
    const server = http.createServer((request, response) => {
        const name = decodeURIComponent(request.url.slice(1));
        requests.push(name);
        if (failing.includes(name)) {
            response.writeHead(503).end();
        } else if (published[name]) {
            response
                .writeHead(200, { 'content-type': 'application/json' })
                .end(JSON.stringify({ time: published[name] }));
        } else {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

test('The scanner looks up and reports only versions the baseline lacks', async (t) => {
    const registry = await fakeRegistry(t, {
        bumped: { '1.0.0': '2026-09-01T00:00:00.000Z', '2.0.0': '2026-11-10T08:00:00.000Z' },
        settled: { '1.0.0': '2026-10-01T00:00:00.000Z', '1.1.0': '2026-11-01T00:00:00.000Z' },
        'already-on-main': { '1.0.0': '2026-11-11T00:00:00.000Z' },
        '@scope/added': { '3.0.0': '2026-11-03T00:00:00.000Z' },
    });
    const base = lockfile({ bumped: '1.0.0', settled: '1.0.0', 'already-on-main': '1.0.0' });
    const head = lockfile({
        bumped: '2.0.0',
        settled: '1.1.0',
        'already-on-main': '1.0.0',
        '@scope/added': '3.0.0',
    });

    const result = await scanLockfile(head, base, now, registry.url);

    assert.equal(result.total, 3);
    assert.deepEqual(
        result.fresh.map(({ name, version, published }) => ({ name, version, published })),
        [{ name: 'bumped', version: '2.0.0', published: '2026-11-10T08:00:00.000Z' }],
    );
    assert.deepEqual(registry.requests.sort(), ['@scope/added', 'bumped', 'settled']);
    assert.equal(decide([result]).clearsAt, '2026-11-17T08:00:00.000Z');
});

test('Without a baseline every locked version counts as added', async (t) => {
    const registry = await fakeRegistry(t, { only: { '1.0.0': '2026-11-11T00:00:00.000Z' } });

    const result = await scanLockfile(lockfile({ only: '1.0.0' }), null, now, registry.url);

    assert.deepEqual(
        result.fresh.map(({ name }) => name),
        ['only'],
    );
});

test('A failed lookup of an added version comes back as an incomplete scan', async (t) => {
    const registry = await fakeRegistry(t, { fine: { '1.0.0': '2026-01-01T00:00:00.000Z' } }, ['flaky']);

    const result = await scanLockfile(
        lockfile({ fine: '1.0.0', flaky: '2.0.0' }),
        lockfile({ fine: '1.0.0' }),
        now,
        registry.url,
    );

    assert.deepEqual(
        result.failures.map(({ name }) => name),
        ['flaky'],
    );
    assert.equal(decide([result]).verdict, 'error');
});

test('The scanner refuses a baseline with more than one lockfile', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-quarantine-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'lock.json');
    fs.writeFileSync(file, lockfile({}));
    const scanner = path.join(__dirname, '../skills/flagging-fresh-dependencies/scripts/find-fresh-dependencies.mjs');

    const run = spawnSync(process.execPath, [scanner, '--baseline', file, file, file], { encoding: 'utf8' });

    assert.equal(run.status, 2);
    assert.match(run.stderr, /--baseline needs exactly one lockfile/);
});
