/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../../.github/skills/lead/scripts/agent-stats.mjs');
const timestamp = '2026-11-10T12:00:00.000Z';

function event(type, data, agentId, at = timestamp) {
    return { type, data, agentId, timestamp: at };
}

function usage(model, values = {}, agentId, at) {
    return event('session.usage_record', { usage: { model, ...values } }, agentId, at);
}

function run(events, args = []) {
    const session = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-agent-stats-'));
    try {
        fs.writeFileSync(path.join(session, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
        return spawnSync(process.execPath, [script, '--session', session, ...args], { encoding: 'utf8' });
    } finally {
        fs.rmSync(session, { recursive: true, force: true });
    }
}

test('summary separates the same model into leading and coding, and totals by role', () => {
    const result = run(
        [
            usage('sol', { duration: 1000, inputTokens: 100, outputTokens: 20, copilotUsage: { totalNanoAiu: 2e9 } }),
            event('subagent.started', { agentName: 'general-purpose', agentDisplayName: 'implementation' }, 'coder'),
            usage(
                'sol',
                { duration: 2000, inputTokens: 200, outputTokens: 30, copilotUsage: { totalNanoAiu: 3e9 } },
                'coder',
            ),
            event('subagent.started', { agentName: 'code-review', agentDisplayName: 'advisor' }, 'reviewer'),
            usage(
                'opus',
                { duration: 3000, inputTokens: 300, outputTokens: 40, copilotUsage: { totalNanoAiu: 5e9 } },
                'reviewer',
            ),
        ],
        ['--summary', '--role', 'reviewer=advisor'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| coding \| 1 \| 2s \| 3\.0 \| 30\.0% \|/);
    assert.match(result.stdout, /\| sol \| leader \| 1 \| 1s \| 2\.0 \| 20\.0% \|/);
    assert.match(result.stdout, /\| opus \| advisor \| 1 \| 3s \| 5\.0 \| 50\.0% \|/);
    assert.match(result.stdout, /\| leader \| 1 \| 1s \| 2\.0 \| 20\.0% \|/);
    assert.match(result.stdout, /\| coding \| 1 \| 2s \| 3\.0 \| 30\.0% \|/);
    assert.match(result.stdout, /leader 2\.0 AIU, subagents 8\.0 AIU, run 10\.0 AIU/);
});

test('summary includes host token categories without adding cache or reasoning to other tokens', () => {
    const result = run(
        [
            usage('sol', {
                inputTokens: 1000,
                outputTokens: 100,
                cacheReadTokens: 800,
                cacheWriteTokens: 150,
                reasoningTokens: 25,
            }),
        ],
        ['--summary'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| leader \| 1,000 \| 100 \| 800 \| 150 \| 25 \|/);
    assert.match(result.stdout, /Cache and reasoning fields may overlap input\/output/);
});

test('missing metrics remain unavailable while explicitly reported zeros remain zero', () => {
    const result = run([usage('sol', { inputTokens: 0, cacheReadTokens: 0 })], ['--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| leader \| 1 \| not reported by host \| not reported by host \| - \|/);
    assert.match(
        result.stdout,
        /\| sol \| leader \| 0 \| not reported by host \| 0 \| not reported by host \| not reported by host \|/,
    );
});

test('partially reported metrics are labelled instead of presented as complete totals', () => {
    const result = run(
        [usage('sol', { duration: 1000, inputTokens: 25, copilotUsage: { totalNanoAiu: 2e9 } }), usage('sol')],
        ['--summary'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1s \(partial\)/);
    assert.match(result.stdout, /2\.0 \(partial\)/);
    assert.match(result.stdout, /25 \(partial\)/);
    assert.match(result.stdout, /Shares use reported AIU only/);
});

test('run totals do not substitute zero for an unreported leader cost or duration', () => {
    const result = run([usage('sol'), usage('luna', { copilotUsage: { totalNanoAiu: 1e9 } }, 'runner')], ['--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /leader AIU not reported by host, subagents 1\.0 AIU, run 1\.0 \(partial\) AIU/);
    assert.match(result.stdout, /leader model requests 1, not reported by host summed/);
});

test('role metadata survives a since cutoff while earlier usage is excluded', () => {
    const result = run(
        [
            event(
                'subagent.started',
                { agentName: 'task', agentDisplayName: 'checks' },
                'runner',
                '2026-11-10T11:00:00Z',
            ),
            usage('old-model', { copilotUsage: { totalNanoAiu: 99e9 } }, 'runner', '2026-11-10T11:00:01Z'),
            usage('new-model', { copilotUsage: { totalNanoAiu: 1e9 } }, 'runner'),
        ],
        ['--summary', '--since', timestamp],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| new-model \| checks \| 1 \|/);
    assert.doesNotMatch(result.stdout, /old-model|99\.0/);
});

test('explicit roles override agent types and all attempts contribute to usage', () => {
    const result = run(
        [
            event('subagent.started', { agentName: 'general-purpose' }, 'advisor'),
            usage('sol', { copilotUsage: { totalNanoAiu: 1e9 } }, 'advisor'),
            event('subagent.failed', { error: 'cancelled' }, 'advisor'),
            event('subagent.started', { agentName: 'explore' }, 'reader'),
            usage('luna', { copilotUsage: { totalNanoAiu: 2e9 } }, 'reader'),
            usage('other', { copilotUsage: { totalNanoAiu: 3e9 } }, 'unknown'),
        ],
        ['--summary', '--role', 'advisor=advisor'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| advisor \|/);
    assert.match(result.stdout, /\| luna \| exploration \|/);
    assert.match(result.stdout, /\| other \| unclassified \|/);
    assert.match(result.stdout, /run 6\.0 AIU/);
});

test('model switches and missing model identifiers are kept in separate rows', () => {
    const result = run([usage('sol'), usage('luna'), usage(undefined)], ['--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| leader \| 1 \|/);
    assert.match(result.stdout, /\| luna \| leader \| 1 \|/);
    assert.match(result.stdout, /\| not reported by host \| leader \| 1 \|/);
});

test('agent detail selection does not narrow whole-run summary totals', () => {
    const result = run(
        [
            usage('sol', { copilotUsage: { totalNanoAiu: 1e9 } }),
            usage('luna', { copilotUsage: { totalNanoAiu: 2e9 } }, 'coder'),
        ],
        ['--summary', '--agent', 'coder', '--role', 'coder=coding'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\| sol \| leader \|/);
    assert.match(result.stdout, /\| luna \| coding \|/);
    assert.match(result.stdout, /run 3\.0 AIU/);
});

test('existing checkpoint details retain elapsed, tool, check and usage reporting', () => {
    const result = run(
        [
            event('subagent.started', { agentName: 'task', agentDisplayName: 'runner' }, 'runner'),
            usage('luna', { duration: 1000, inputTokens: 25, copilotUsage: { totalNanoAiu: 1e9 } }, 'runner'),
            event(
                'tool.execution_start',
                { toolCallId: 'build', toolName: 'bash', arguments: { command: 'npm run build' } },
                'runner',
            ),
            event('tool.execution_complete', { toolCallId: 'build', success: false }, 'runner', '2026-11-10T12:00:02Z'),
            event('subagent.completed', {}, 'runner', '2026-11-10T12:00:03Z'),
        ],
        ['--agent', 'runner'],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runner \[task; luna\] idle, turns 1/);
    assert.match(result.stdout, /elapsed 3s/);
    assert.match(result.stdout, /tests\/builds: 1 run\(s\), 2s, 1 failed/);
    assert.match(result.stdout, /tokens in 25/);
    assert.match(result.stdout, /out not reported by host/);
    assert.doesNotMatch(result.stdout, /Usage by model and role/);
});

test('summary handles an empty usage window', () => {
    const result = run([], ['--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No model usage reported in this window/);
    assert.match(result.stdout, /AIU not reported by host/);
});

test('invalid role assignments fail with actionable CLI errors', () => {
    for (const role of ['coder', 'coder=made-up', '=advisor']) {
        const result = run([], ['--role', role]);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /--role must be <agent_id>=/);
    }
});
