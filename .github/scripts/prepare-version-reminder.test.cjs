/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.join(__dirname, 'prepare-version-reminder.cjs');
const branch = 'bot/bump-1.0.2-alpha.0';
const marker = '<!-- post-release-version:1.0.2-alpha.0 -->';
const issueUrl = 'https://github.com/example/project/issues/17';

function git(directory, ...args) {
    return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function writeVersions(directory, version) {
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
    fs.writeFileSync(
        path.join(directory, 'package-lock.json'),
        `${JSON.stringify({ version, lockfileVersion: 3, packages: { '': { version } } }, null, 2)}\n`,
    );
}

function fixture(t, state = { issues: [] }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-version-reminder-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const remote = path.join(directory, 'remote.git');
    const work = path.join(directory, 'work');
    const bin = path.join(directory, 'bin');
    fs.mkdirSync(work);
    fs.mkdirSync(bin);
    git(directory, 'init', '--bare', remote);
    git(work, 'init');
    git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(work, 'config', 'user.name', 'Fixture');
    git(work, 'config', 'user.email', 'fixture@example.test');
    writeVersions(work, '1.0.1');
    fs.writeFileSync(path.join(work, 'unrelated.txt'), 'Keep this file unchanged.\n');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'Released version');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', 'origin', 'main');
    const mainSha = git(work, 'rev-parse', 'HEAD');
    writeVersions(work, '1.0.2-alpha.0');
    const stateFile = path.join(directory, 'github-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ calls: [], ...state }));
    fs.writeFileSync(
        path.join(bin, 'gh'),
        String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.GH_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
if (args[0] !== 'api' || !args[1].startsWith('repos/example/project/issues')) {
    throw new Error('Unexpected GitHub command: ' + JSON.stringify(args));
}
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const body = method === 'GET' ? undefined : JSON.parse(fs.readFileSync(0, 'utf8'));
state.calls.push({ method, endpoint: args[1], args, body });
fs.writeFileSync(file, JSON.stringify(state));
if (state.fail === method) {
    console.error('GitHub API denied this operation (HTTP 403)');
    process.exit(1);
}
if (method === 'GET') {
    if (!args.includes('--paginate') || !args.includes('--slurp')) throw new Error('Pagination required');
    console.log(JSON.stringify(state.pages || [state.issues]));
} else {
    body.assignees = state.ignoreAssignee ? [] : body.assignees.map((login) => ({ login }));
    let issue;
    if (method === 'POST') {
        issue = { number: 17, html_url: 'https://github.com/example/project/issues/17', ...body };
        state.issues.push(issue);
    } else if (method === 'PATCH') {
        issue = state.issues.find((item) => item.number === Number(args[1].split('/').at(-1)));
        if (!issue) throw new Error('Unknown issue');
        Object.assign(issue, body);
    } else {
        throw new Error('Unexpected API method');
    }
    fs.writeFileSync(file, JSON.stringify(state));
    console.log(JSON.stringify(issue));
}
`,
        { mode: 0o755 },
    );
    return {
        directory,
        work,
        remote,
        mainSha,
        stateFile,
        env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            GH_TEST_STATE: stateFile,
            OLD_VERSION: '1.0.1',
            NEW_VERSION: '1.0.2-alpha.0',
            GITHUB_REPOSITORY: 'example/project',
            GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_RUN_ID: '12345',
            GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
            REMINDER_ASSIGNEE: 'release-maintainer',
            RELEASE_TAG: '',
        },
    };
}

function run(context, env = {}) {
    return spawnSync(process.execPath, [script], {
        cwd: context.work,
        encoding: 'utf8',
        env: { ...context.env, ...env },
    });
}

function state(context) {
    return JSON.parse(fs.readFileSync(context.stateFile, 'utf8'));
}

function assertPrepared(context) {
    assert.equal(git(context.work, 'ls-remote', 'origin', 'refs/heads/main').split('\t')[0], context.mainSha);
    assert.deepEqual(
        git(context.work, 'diff', '--name-only', 'main', branch).split('\n'),
        ['package-lock.json', 'package.json'],
    );
    assert.equal(JSON.parse(git(context.work, 'show', `${branch}:package.json`)).version, '1.0.2-alpha.0');
    const lock = JSON.parse(git(context.work, 'show', `${branch}:package-lock.json`));
    assert.equal(lock.version, '1.0.2-alpha.0');
    assert.equal(lock.packages[''].version, '1.0.2-alpha.0');
    assert.match(git(context.work, 'log', '-1', '--format=%B', branch), /Co-authored-by: Copilot/);
}

test('Pushes only the version files and creates an assigned issue with a prefilled PR link', (t) => {
    const context = fixture(t);

    const result = run(context);

    assert.equal(result.status, 0, result.stderr);
    assertPrepared(context);
    const { issues, calls } = state(context);
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0].assignees, [{ login: 'release-maintainer' }]);
    assert.match(issues[0].body, /<!-- post-release-version:1\.0\.2-alpha\.0 -->/);
    assert.match(issues[0].body, /Old version \| New version/);
    assert.match(issues[0].body, /`package\.json` \| `1\.0\.1` \| \*\*`1\.0\.2-alpha\.0`\*\*/);
    assert.match(issues[0].body, /`package-lock\.json` \(both root version entries\)/);
    assert.match(issues[0].body, /first alpha of the next patch/);
    assert.match(issues[0].body, /Manual workflow run/);
    assert.match(issues[0].body, /normal pull-request CI/);
    const link = issues[0].body.match(/\[Create version-bump PR\]\(([^)]+)\)/)[1];
    const url = new URL(link);
    assert.equal(url.pathname, '/example/project/compare/main...bot/bump-1.0.2-alpha.0');
    assert.equal(url.searchParams.get('expand'), '1');
    assert.equal(url.searchParams.get('title'), 'chore: prepare 1.0.2-alpha.0 development');
    assert.match(url.searchParams.get('body'), /Old version \| New version/);
    assert.match(url.searchParams.get('body'), /already released version/);
    const summary = fs.readFileSync(context.env.GITHUB_STEP_SUMMARY, 'utf8');
    assert.equal(summary.match(/\[Create version-bump PR\]\(([^)]+)\)/)[1], link);
    assert.equal(summary.trimEnd().split('\n').at(-1), `Reminder assigned to @release-maintainer: ${issueUrl}`);
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST']);
});

test('A rerun reuses the remote branch and updates the same issue without another commit', (t) => {
    const context = fixture(t);
    assert.equal(run(context).status, 0);
    const sha = git(context.work, 'rev-parse', branch);
    git(context.work, 'switch', 'main');
    writeVersions(context.work, '1.0.2-alpha.0');

    const result = run(context);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Reusing existing branch/);
    assert.equal(git(context.work, 'rev-parse', branch), sha);
    assert.equal(git(context.work, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0], sha);
    assert.equal(state(context).issues.length, 1);
    assert.deepEqual(state(context).calls.map((call) => call.method), ['GET', 'POST', 'GET', 'PATCH']);
});

test('Reuses a matching branch from the old failed workflow even when main has advanced', (t) => {
    const context = fixture(t);
    git(context.work, 'switch', '-c', branch);
    git(context.work, 'add', 'package.json', 'package-lock.json');
    git(context.work, 'commit', '-m', 'Prepared by the old workflow');
    git(context.work, 'push', 'origin', branch);
    const sha = git(context.work, 'rev-parse', 'HEAD');
    git(context.work, 'switch', 'main');
    fs.appendFileSync(path.join(context.work, 'unrelated.txt'), 'New main commit.\n');
    git(context.work, 'add', 'unrelated.txt');
    git(context.work, 'commit', '-m', 'Main advanced');
    git(context.work, 'push', 'origin', 'main');
    writeVersions(context.work, '1.0.2-alpha.0');

    const result = run(context);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Reusing existing branch/);
    assert.equal(git(context.work, 'rev-parse', branch), sha);
    assert.equal(state(context).issues.length, 1);
});

test('Finds a reminder on later API pages and reopens a closed issue instead of duplicating it', (t) => {
    const existing = { number: 17, html_url: issueUrl, body: marker, state: 'closed' };
    const context = fixture(t, {
        issues: [existing],
        pages: [[{ number: 1, body: 'Unrelated issue' }], [existing]],
    });

    const result = run(context);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(state(context).issues.length, 1);
    assert.equal(state(context).issues[0].state, 'open');
    assert.deepEqual(state(context).calls.map((call) => call.method), ['GET', 'PATCH']);
});

for (const conflict of ['version', 'unrelated-file']) {
    test(`Never overwrites conflicting existing branch content (${conflict})`, (t) => {
        const context = fixture(t);
        git(context.work, 'switch', '-c', branch);
        if (conflict === 'version') {
            writeVersions(context.work, '1.0.2-alpha.1');
        } else {
            fs.appendFileSync(path.join(context.work, 'unrelated.txt'), 'Human change.\n');
        }
        git(context.work, 'add', '.');
        git(context.work, 'commit', '-m', 'Human changes');
        git(context.work, 'push', 'origin', branch);
        const sha = git(context.work, 'rev-parse', 'HEAD');
        git(context.work, 'switch', 'main');
        writeVersions(context.work, '1.0.2-alpha.0');

        const result = run(context);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /refusing to overwrite/);
        assert.equal(git(context.work, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0], sha);
        assert.deepEqual(state(context).calls, []);
    });
}

test('Issue permission failures remain failures, but the prepared branch and PR link remain available', (t) => {
    const context = fixture(t, { issues: [], fail: 'POST' });

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTP 403/);
    assertPrepared(context);
    assert.match(fs.readFileSync(context.env.GITHUB_STEP_SUMMARY, 'utf8'), /Create version-bump PR/);
    assert.equal(state(context).issues.length, 0);
});

test('Reports a silently ignored issue assignment as an error', (t) => {
    const context = fixture(t, { issues: [], ignoreAssignee: true });

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /was not assigned to @release-maintainer/);
    assert.equal(state(context).issues.length, 1);
    assert.match(fs.readFileSync(context.env.GITHUB_STEP_SUMMARY, 'utf8'), /Create version-bump PR/);
});

test('A failed remote lookup is not treated as a missing branch', (t) => {
    const context = fixture(t);
    git(context.work, 'remote', 'set-url', 'origin', path.join(context.directory, 'nonexistent.git'));

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not inspect remote branch/);
    assert.equal(git(context.work, 'branch', '--show-current'), 'main');
    assert.deepEqual(state(context).calls, []);
});

test('Refuses to commit unrelated staged files', (t) => {
    const context = fixture(t);
    fs.appendFileSync(path.join(context.work, 'unrelated.txt'), 'Unrelated staged change.\n');
    git(context.work, 'add', 'unrelated.txt');

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unrelated files are staged/);
    assert.equal(git(context.work, 'rev-parse', 'HEAD'), context.mainSha);
});

test('Rejects a mismatched lockfile before creating a branch or issue', (t) => {
    const context = fixture(t);
    fs.writeFileSync(path.join(context.work, 'package-lock.json'), JSON.stringify({ version: '1.0.1' }));

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /both root lockfile versions must match/);
    assert.deepEqual(state(context).calls, []);
});

test('Includes the triggering release link', (t) => {
    const context = fixture(t);

    const result = run(context, { RELEASE_TAG: 'v1.0.1' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(state(context).issues[0].body, /\[Release v1\.0\.1\]\(https:\/\/github\.com\/example\/project\/releases\/tag\/v1\.0\.1\)/);
});

test('Duplicate reminder markers fail explicitly instead of updating an arbitrary issue', (t) => {
    const context = fixture(t, { issues: [{ number: 17, body: marker }, { number: 18, body: marker }] });

    const result = run(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Multiple reminders exist/);
    assert.deepEqual(state(context).calls.map((call) => call.method), ['GET']);
});

test('A pull request carrying the marker is not mistaken for a reminder issue', (t) => {
    const context = fixture(t, { issues: [{ number: 4, body: marker, pull_request: { url: 'example' } }] });

    const result = run(context);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(state(context).calls.map((call) => call.method), ['GET', 'POST']);
});
