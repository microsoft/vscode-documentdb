/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const yaml = require('js-yaml');

const workflow = (name) => yaml.load(fs.readFileSync(path.join(__dirname, '../workflows', name), 'utf8'));
const automatic = workflow('main.yml');
const requested = workflow('ci-requested.yml');
const shared = workflow('ci-checks.yml');
const planScript = shared.jobs.plan.steps.find((step) => step.id === 'plan').with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function expression(value, github, inputs = {}) {
    return vm.runInNewContext(value.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), {
        github,
        inputs,
        always: () => true,
        format: (template, value) => template.replace('{0}', value),
    });
}

function pullRequest(base, action = 'labeled', label = 'ci:full-requested') {
    return {
        event_name: 'pull_request',
        workflow: requested.name,
        event: {
            action,
            label: { name: label },
            sender: { login: 'requester' },
            pull_request: {
                number: 42,
                draft: true,
                base: { ref: base },
                head: { sha: 'abcdef0123456789' },
            },
        },
    };
}

async function plan(github, files = [], enforceFullRun = false) {
    const outputs = {};
    const removed = [];
    await new AsyncFunction('context', 'github', 'core', 'process', planScript)(
        {
            eventName: github.event_name,
            payload: github.event,
            ref: 'refs/heads/main',
            repo: { owner: 'example', repo: 'project' },
        },
        {
            paginate: async () => files.map((filename) => ({ filename })),
            rest: {
                pulls: { listFiles: 'listFiles' },
                issues: { removeLabel: async (args) => removed.push(args) },
            },
        },
        {
            setOutput: (key, value) => (outputs[key] = value),
            notice: () => {},
            warning: (message) => assert.fail(message),
        },
        { env: { ENFORCE_FULL_RUN: String(enforceFullRun) } },
    );
    return { outputs, removed };
}

test('Automatic CI keeps its existing branches and does not also handle label events', () => {
    assert.deepEqual(automatic.on.pull_request.branches, ['main', 'release/**', 'feature/**']);
    assert.deepEqual(automatic.on.push.branches, ['main', 'release/**']);
    assert.deepEqual(automatic.on.pull_request.types, [
        'opened',
        'synchronize',
        'reopened',
        'ready_for_review',
    ]);
    assert.equal(automatic.on.workflow_dispatch, undefined);
    assert.deepEqual(Object.keys(shared.on), ['workflow_call']);
    for (const entry of [automatic, requested]) {
        assert.equal(entry.jobs.checks.uses, './.github/workflows/ci-checks.yml');
        assert.deepEqual(entry.jobs.checks.permissions, {
            contents: 'read',
            issues: 'write',
            'pull-requests': 'write',
        });
    }
});

test('A full request runs on dev targets as well as main, feature and release targets', async () => {
    assert.deepEqual(requested.on.pull_request, { types: ['labeled'] });
    for (const base of ['dev/example/topic', 'main', 'feature/topic', 'release/1.1.1']) {
        const github = pullRequest(base);
        assert.equal(expression(requested.jobs.checks.if, github), true);
        assert.equal(expression(requested.jobs.gate.if, github), true);
        assert.equal(expression(requested.jobs.gate.name, github), 'Merge gate');
        const { outputs, removed } = await plan(github);
        assert.equal(outputs.tier, 'full');
        for (const flag of ['packages', 'webview-package', 'verification']) {
            assert.equal(outputs[flag], 'true');
        }
        assert.equal(outputs.requester, 'requester');
        assert.match(outputs.reason, /abcdef0/);
        assert.equal(removed.length, 1);
        assert.equal(removed[0].name, 'ci:full-requested');
        assert.equal(removed[0].issue_number, 42);
    }
});

test('Unrelated labels start no checks and cannot replace the required Merge gate', () => {
    for (const label of ['on-hold', 'ci:other']) {
        const github = pullRequest('dev/example/topic', 'labeled', label);
        assert.equal(expression(requested.jobs.checks.if, github), false);
        assert.equal(expression(requested.jobs.gate.if, github), false);
        assert.notEqual(expression(requested.jobs.gate.name, github), 'Merge gate');
    }
});

test('Manual dispatch forwards fast/full selection and only full uses the required check name', async () => {
    const github = { event_name: 'workflow_dispatch', event: {} };
    for (const full of [false, true]) {
        const inputs = { enforce_full_run: full };
        assert.equal(expression(requested.jobs.checks.if, github, inputs), true);
        assert.equal(expression(requested.jobs.gate.if, github, inputs), true);
        const forwarded = expression(requested.jobs.checks.with.enforce_full_run, github, inputs);
        assert.equal(forwarded, full);
        assert.equal((await plan(github, [], forwarded)).outputs.tier, full ? 'full' : 'fast');
        assert.equal(
            expression(requested.jobs.gate.name, github, inputs),
            full ? 'Merge gate' : 'Merge gate (manual fast run)',
        );
    }
});

test('Automatic draft/ready tiers survive extraction and changes to any CI workflow run all scoped checks', async () => {
    const github = pullRequest('main', 'synchronize');
    const draft = await plan(github);
    assert.equal(draft.outputs.tier, 'fast');
    assert.equal(draft.outputs.packages, 'false');
    assert.equal(draft.removed.length, 0);
    github.event.pull_request.draft = false;
    const files = [
        'src/extension.ts',
        ...['main', 'ci-requested', 'ci-checks'].map((name) => `.github/workflows/${name}.yml`),
    ];
    for (const file of files) {
        const { outputs } = await plan(github, [file]);
        assert.equal(outputs.tier, 'standard');
        for (const flag of ['packages', 'webview-package', 'verification']) {
            assert.equal(outputs[flag], String(file.startsWith('.github/workflows/')));
        }
    }
});

test('Automatic pushes and requested runs use independent concurrency groups without a nested cancellation', () => {
    const github = pullRequest('main');
    const group = (entry, context) =>
        entry.concurrency.group.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, value) => expression(value, context));
    const automaticGroup = group(automatic, { ...github, workflow: automatic.name });
    const requestedGroup = group(requested, github);
    const otherLabelGroup = group(requested, pullRequest('main', 'labeled', 'on-hold'));
    assert.notEqual(automaticGroup, requestedGroup);
    assert.notEqual(otherLabelGroup, requestedGroup);
    assert.equal(shared.concurrency, undefined);
});

test('Top-level gates keep the ruleset name and fail closed for a failed or missing shared validation', () => {
    assert.equal(automatic.jobs.gate.name, 'Merge gate');
    assert.equal(shared.on.workflow_call.outputs['gate-result'].value, '${{ jobs.gate.result }}');
    for (const entry of [automatic, requested]) {
        const gate = entry.jobs.gate;
        assert.deepEqual(gate.needs, ['checks']);
        assert.match(gate.if, /always\(\)/);
        assert.equal(gate.steps[0].env.RESULT, '${{ needs.checks.outputs.gate-result }}');
        for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
            const child = spawnSync('bash', ['-e', '-c', gate.steps[0].run], {
                env: { ...process.env, RESULT: result },
                encoding: 'utf8',
            });
            assert.equal(child.status, result === 'success' ? 0 : 1, child.stderr);
            if (result !== 'success') assert.match(child.stdout, /::error::CI validation did not pass/);
        }
    }
});
