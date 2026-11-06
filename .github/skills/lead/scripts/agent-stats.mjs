#!/usr/bin/env node
// Summarises what each subagent of a Copilot session did and cost, from the host's session log
// (<session folder>/events.jsonl). Read-only; no dependencies beyond Node >= 18.
// Reports only what the host recorded; anything missing prints as "not reported by host".
//
// Usage:
//   node agent-stats.mjs [--session <session folder>] [--agent <agent_id> ...] [--since <ISO>]
// --session  The leader's session folder. If omitted, sessions changed in the last 48 hours under
//            ~/.copilot/session-state are searched for the first --agent id.
// --agent    Agent ids to report (repeatable). Default: every subagent in the session.
// --since    Only count usage from this time (for example, when /lead started).
// Exit codes: 0 ok, 2 bad usage, 3 session log not found.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const opts = { session: undefined, agents: [], since: undefined };
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
    else fail(`Unknown argument ${a}`, 2);
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

function emptyStats() {
    return {
        name: '',
        type: '',
        models: new Set(),
        status: 'running',
        firstStart: undefined,
        lastEnd: undefined,
        turns: 0,
        requests: 0,
        requestMs: 0,
        aiu: 0,
        aiuReported: false,
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        tools: new Map(),
        checks: { runs: 0, ms: 0, failed: 0 },
    };
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
    if (opts.since && (!at || at < opts.since)) continue;
    let s = leader;
    if (e.agentId) {
        if (!agents.has(e.agentId)) agents.set(e.agentId, emptyStats());
        s = agents.get(e.agentId);
    }

    switch (e.type) {
        case 'subagent.started':
            s.name = d.agentDisplayName ?? d.agentName ?? '';
            s.type = d.agentName ?? '';
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
            s.requests += 1;
            s.requestMs += u.duration ?? 0;
            if (u.model) s.models.add(u.model);
            s.tokens.input += u.inputTokens ?? 0;
            s.tokens.cacheRead += u.cacheReadTokens ?? 0;
            s.tokens.cacheWrite += u.cacheWriteTokens ?? 0;
            s.tokens.output += u.outputTokens ?? 0;
            const nano = u.copilotUsage?.totalNanoAiu;
            if (typeof nano === 'number') {
                s.aiu += nano / 1e9;
                s.aiuReported = true;
            }
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
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);
const aiuText = (st) => (st.aiuReported ? `${st.aiu.toFixed(1)} AIU` : 'AIU not reported by host');

function describe(id, st) {
    const elapsed = st.firstStart && st.lastEnd ? secs(st.lastEnd - st.firstStart) : 'not reported by host';
    const tools = [...st.tools.entries()]
        .sort((x, y) => y[1].ms - x[1].ms)
        .slice(0, 5)
        .map(([n, t]) => `${n} ${t.calls}x/${secs(t.ms)}`)
        .join(', ');
    const toolMs = [...st.tools.values()].reduce((sum, t) => sum + t.ms, 0);
    const requests = st.requests
        ? `model requests ${st.requests}, ${secs(st.requestMs)} summed`
        : 'model time not reported by host';
    const tokens = st.requests
        ? `tokens in ${k(st.tokens.input)} (cache read ${k(st.tokens.cacheRead)}, cache write ${k(st.tokens.cacheWrite)}), out ${k(st.tokens.output)}`
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

const selected = opts.agents.length ? opts.agents : [...agents.keys()].filter((id) => agents.get(id).name);
console.log(`As of ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, from ${file}`);
for (const id of selected) {
    const st = agents.get(id);
    console.log(st ? describe(id, st) : `${id}: not found in this session log`);
}
const all = [leader, ...agents.values()];
const reported = all.some((st) => st.aiuReported);
const subagentAiu = [...agents.values()].reduce((sum, st) => sum + st.aiu, 0);
console.log(
    `Totals${opts.since ? ` since ${opts.since.toISOString().slice(0, 16)}` : ''}: ` +
        (reported
            ? `leader ${leader.aiu.toFixed(1)} AIU, subagents ${subagentAiu.toFixed(1)} AIU, run ${(leader.aiu + subagentAiu).toFixed(1)} AIU`
            : 'AIU not reported by host') +
        `; leader model requests ${leader.requests}, ${secs(leader.requestMs)} summed.`,
);
