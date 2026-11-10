#!/usr/bin/env node
// Summarises what each subagent of a Copilot session did and cost, from the host's session log
// (<session folder>/events.jsonl). Read-only; no dependencies beyond Node >= 18.
// Reports only what the host recorded; anything missing prints as "not reported by host".
//
// Usage:
//   node agent-stats.mjs [--session <session folder>] [--agent <agent_id> ...] [--since <ISO>]
//                       [--summary] [--role <agent_id>=<role> ...]
// --session  The leader's session folder. If omitted, sessions changed in the last 48 hours under
//            ~/.copilot/session-state are searched for the first --agent id.
// --agent    Agent ids to report (repeatable). Default: every subagent in the session.
// --since    Only count usage from this time (for example, when /lead started).
// --summary  Show whole-window model/role and token tables instead of per-agent details.
// --role     Explicit agent role: advisor, coding, checks, exploration, or review.
//            Leader usage is separate automatically; unknown worker types stay unclassified.
// Exit codes: 0 ok, 2 bad usage, 3 session log not found.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ROLES = ['leader', 'coding', 'advisor', 'review', 'checks', 'exploration', 'unclassified'];
const TOKEN_FIELDS = {
    input: 'inputTokens',
    output: 'outputTokens',
    cacheRead: 'cacheReadTokens',
    cacheWrite: 'cacheWriteTokens',
    reasoning: 'reasoningTokens',
};
const opts = { session: undefined, agents: [], since: undefined, summary: false, roles: new Map() };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
        if (i + 1 >= args.length) fail(`Missing value for ${a}`, 2);
        return args[++i];
    };
    if (a === '--session') opts.session = next();
    else if (a === '--agent') opts.agents.push(next());
    else if (a === '--since') opts.since = new Date(next());
    else if (a === '--summary') opts.summary = true;
    else if (a === '--role') {
        const [id, role, extra] = next().split('=');
        if (!id || !ROLES.includes(role) || role === 'leader' || extra !== undefined) {
            fail('--role must be <agent_id>=advisor|coding|checks|exploration|review|unclassified', 2);
        }
        opts.roles.set(id, role);
    } else fail(`Unknown argument ${a}`, 2);
}
if (opts.since && Number.isNaN(opts.since.getTime())) fail('--since must be a valid ISO date', 2);

function fail(message, code) {
    console.error(message);
    process.exit(code);
}

function findLog() {
    if (opts.session) {
        const file = path.join(opts.session, 'events.jsonl');
        if (!fs.existsSync(file)) fail(`No events.jsonl in ${opts.session}`, 3);
        return file;
    }
    if (opts.agents.length === 0) fail('Pass --session, or --agent so the session can be found', 2);
    const root = path.join(os.homedir(), '.copilot', 'session-state');
    const cutoff = Date.now() - 48 * 3_600_000;
    const candidates = fs.existsSync(root)
        ? fs
              .readdirSync(root)
              .map((d) => path.join(root, d, 'events.jsonl'))
              .filter((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= cutoff)
              .sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)
        : [];
    const needle = `"agentId":"${opts.agents[0]}"`;
    const found = candidates.find((f) => fs.readFileSync(f, 'utf8').includes(needle));
    if (!found) fail(`No recent session log mentions agent ${opts.agents[0]}`, 3);
    return found;
}

const CHECK_COMMAND = /\b(vitest|jest|tsc|prettier|npm (run )?(test|build|lint|typecheck|package|l10n))/;

function emptyUsage() {
    return {
        requests: 0,
        requestMs: 0,
        durationReported: 0,
        aiu: 0,
        aiuReported: 0,
        tokens: Object.fromEntries(Object.keys(TOKEN_FIELDS).map((field) => [field, 0])),
        tokensReported: Object.fromEntries(Object.keys(TOKEN_FIELDS).map((field) => [field, 0])),
    };
}

function emptyStats() {
    return {
        ...emptyUsage(),
        name: '',
        type: '',
        models: new Set(),
        byModel: new Map(),
        status: 'running',
        firstStart: undefined,
        lastEnd: undefined,
        turns: 0,
        tools: new Map(),
        checks: { runs: 0, ms: 0, failed: 0 },
    };
}

function recorded(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function addUsage(st, usage) {
    st.requests += 1;
    if (recorded(usage.duration)) {
        st.requestMs += usage.duration;
        st.durationReported += 1;
    }
    for (const [field, hostField] of Object.entries(TOKEN_FIELDS)) {
        if (recorded(usage[hostField])) {
            st.tokens[field] += usage[hostField];
            st.tokensReported[field] += 1;
        }
    }
    const nano = usage.copilotUsage?.totalNanoAiu;
    if (recorded(nano)) {
        st.aiu += nano / 1e9;
        st.aiuReported += 1;
    }
}

function mergeUsage(target, source) {
    for (const field of ['requests', 'requestMs', 'durationReported', 'aiu', 'aiuReported']) {
        target[field] += source[field];
    }
    for (const field of Object.keys(TOKEN_FIELDS)) {
        target.tokens[field] += source.tokens[field];
        target.tokensReported[field] += source.tokensReported[field];
    }
}

const agents = new Map();
const leader = emptyStats();
const openTools = new Map();

const file = findLog();
const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
for await (const line of lines) {
    let e;
    try {
        e = JSON.parse(line);
    } catch {
        continue;
    }
    const d = e.data ?? {};
    const at = e.timestamp ? new Date(e.timestamp) : undefined;
    let s = leader;
    if (e.agentId) {
        if (!agents.has(e.agentId)) agents.set(e.agentId, emptyStats());
        s = agents.get(e.agentId);
    }
    if (e.type === 'subagent.started') {
        s.name = d.agentDisplayName ?? d.agentName ?? '';
        s.type = d.agentType ?? d.agentName ?? '';
    }
    if (opts.since && (!at || Number.isNaN(at.getTime()) || at < opts.since)) continue;

    switch (e.type) {
        case 'subagent.started':
            s.status = 'running';
            s.firstStart ??= at;
            break;
        case 'subagent.completed':
        case 'subagent.failed':
            s.status = e.type === 'subagent.failed' ? `failed (${d.error ?? 'no reason reported'})` : 'idle';
            s.lastEnd = at;
            s.turns += 1;
            break;
        case 'session.usage_record': {
            const u = d.usage ?? {};
            if (u.model) s.models.add(u.model);
            addUsage(s, u);
            const model = u.model || 'not reported by host';
            const modelUsage = s.byModel.get(model) ?? emptyUsage();
            addUsage(modelUsage, u);
            s.byModel.set(model, modelUsage);
            break;
        }
        case 'tool.execution_start':
            openTools.set(d.toolCallId, { at, name: d.toolName, args: JSON.stringify(d.arguments ?? '') });
            break;
        case 'tool.execution_complete': {
            const start = openTools.get(d.toolCallId);
            if (!start || !at || !start.at) break;
            openTools.delete(d.toolCallId);
            const ms = at - start.at;
            const t = s.tools.get(start.name) ?? { calls: 0, ms: 0 };
            t.calls += 1;
            t.ms += ms;
            s.tools.set(start.name, t);
            if (start.name === 'bash' && CHECK_COMMAND.test(start.args)) {
                s.checks.runs += 1;
                s.checks.ms += ms;
                if (d.success === false) s.checks.failed += 1;
            }
            break;
        }
    }
}

const secs = (ms) => {
    const total = Math.round(ms / 1000);
    return total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s` : `${total}s`;
};
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const metric = (value, reported, requests, format) =>
    reported ? `${format(value)}${reported < requests ? ' (partial)' : ''}` : 'not reported by host';
const aiuText = (st) =>
    st.aiuReported ? `${metric(st.aiu, st.aiuReported, st.requests, (n) => n.toFixed(1))} AIU` : 'AIU not reported by host';
const tokenText = (st, field, format = k) =>
    metric(st.tokens[field], st.tokensReported[field], st.requests, format);

function describe(id, st) {
    const elapsed = st.firstStart && st.lastEnd ? secs(st.lastEnd - st.firstStart) : 'not reported by host';
    const tools = [...st.tools.entries()]
        .sort((x, y) => y[1].ms - x[1].ms)
        .slice(0, 5)
        .map(([n, t]) => `${n} ${t.calls}x/${secs(t.ms)}`)
        .join(', ');
    const toolMs = [...st.tools.values()].reduce((sum, t) => sum + t.ms, 0);
    const requests = st.requests
        ? `model requests ${st.requests}, ${metric(st.requestMs, st.durationReported, st.requests, secs)} summed`
        : 'model time not reported by host';
    const tokens = st.requests
        ? `tokens in ${tokenText(st, 'input')} (cache read ${tokenText(st, 'cacheRead')}, cache write ${tokenText(st, 'cacheWrite')}), out ${tokenText(st, 'output')}`
        : 'tokens not reported by host';
    const checks = st.checks.runs
        ? `tests/builds: ${st.checks.runs} run(s), ${secs(st.checks.ms)}, ${st.checks.failed} failed`
        : 'tests/builds: none run';
    return [
        `${st.name || id} [${st.type || 'agent'}; ${[...st.models].join(', ') || 'model not reported'}] ${st.status}, turns ${st.turns}`,
        `  elapsed ${elapsed} (first start to last finish); ${aiuText(st)}`,
        `  ${requests}; tool spans ${secs(toolMs)} summed${tools ? ` (${tools})` : ''}`,
        `  ${checks}; ${tokens}`,
        `  agent_id ${id}`,
    ].join('\n');
}

function roleFor(id, st) {
    if (!id) return 'leader';
    return (
        opts.roles.get(id) ??
        {
            'general-purpose': 'coding',
            task: 'checks',
            explore: 'exploration',
            research: 'exploration',
            'code-review': 'review',
            'security-review': 'review',
            'rubber-duck': 'review',
        }[st.type] ??
        'unclassified'
    );
}

function summary() {
    const groups = new Map();
    const roles = new Map();
    for (const [id, st] of [[undefined, leader], ...agents]) {
        const role = roleFor(id, st);
        for (const [model, usage] of st.byModel) {
            const key = `${model}\0${role}`;
            if (!groups.has(key)) groups.set(key, { model, role, ...emptyUsage() });
            mergeUsage(groups.get(key), usage);
            if (!roles.has(role)) roles.set(role, emptyUsage());
            mergeUsage(roles.get(role), usage);
        }
    }
    if (!groups.size) {
        console.log('No model usage reported in this window.');
        return;
    }
    const totalAiu = [...roles.values()].reduce((sum, st) => sum + st.aiu, 0);
    const cells = (st) => [
        st.requests,
        metric(st.requestMs, st.durationReported, st.requests, secs),
        metric(st.aiu, st.aiuReported, st.requests, (n) => n.toFixed(1)),
        st.aiuReported && totalAiu > 0 ? `${((st.aiu / totalAiu) * 100).toFixed(1)}%` : '-',
    ];
    const row = (values) => console.log(`| ${values.join(' | ')} |`);
    const sorted = [...groups.values()].sort(
        (a, b) => a.model.localeCompare(b.model) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role),
    );
    console.log('\nUsage by model and role (all agents in this window):');
    row(['Model', 'Role', 'Requests', 'Model time', 'AIU', 'AIU share']);
    row(['---', '---', '---:', '---:', '---:', '---:']);
    for (const st of sorted) row([st.model, st.role, ...cells(st)]);

    console.log('\nUsage by role (all models):');
    row(['Role', 'Requests', 'Model time', 'AIU', 'AIU share']);
    row(['---', '---:', '---:', '---:', '---:']);
    for (const role of ROLES) {
        if (roles.has(role)) row([role, ...cells(roles.get(role))]);
    }

    console.log('\nTokens by model and role:');
    row(['Model', 'Role', 'Input', 'Output', 'Cache read', 'Cache write', 'Reasoning']);
    row(['---', '---', '---:', '---:', '---:', '---:', '---:']);
    for (const st of sorted) {
        row([
            st.model,
            st.role,
            ...Object.keys(TOKEN_FIELDS).map((field) => tokenText(st, field, (n) => n.toLocaleString('en-US'))),
        ]);
    }
    console.log(
        'Model time sums request spans, not wall-clock time. Shares use reported AIU only; partial means some requests lack that metric.\n' +
        'Cache and reasoning fields may overlap input/output; do not add them into a token total. AIU are not dollars.',
    );
}

const selected = opts.agents.length ? opts.agents : [...agents.keys()].filter((id) => agents.get(id).name);
console.log(`As of ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, from ${file}`);
if (opts.summary) summary();
else {
    for (const id of selected) {
        const st = agents.get(id);
        console.log(st ? describe(id, st) : `${id}: not found in this session log`);
    }
}
const all = [leader, ...agents.values()];
const reported = all.some((st) => st.aiuReported);
const subagentsUsage = emptyUsage();
for (const st of agents.values()) mergeUsage(subagentsUsage, st);
const runUsage = emptyUsage();
for (const st of all) mergeUsage(runUsage, st);
console.log(
    `Totals${opts.since ? ` since ${opts.since.toISOString().slice(0, 16)}` : ''}: ` +
        (reported
            ? `leader ${aiuText(leader)}, subagents ${aiuText(subagentsUsage)}, run ${aiuText(runUsage)}`
            : 'AIU not reported by host') +
        `; leader model requests ${leader.requests}, ${metric(leader.requestMs, leader.durationReported, leader.requests, secs)} summed.`,
);
