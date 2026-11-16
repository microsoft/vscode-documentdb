/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QUARANTINE = 'quarantine';
const READY = 'ready-to-merge';
// We hold a fresh npm version for a few days before merging it.
const DAYS = 7;
const LOCKFILES = ['package-lock.json', 'api/package-lock.json'];
const SCANNER = path.join(__dirname, '../skills/flagging-fresh-dependencies/scripts/find-fresh-dependencies.mjs');

// Lockfile text is untrusted; one printable line cannot start a workflow command.
function clean(text) {
    return String(text).replace(/[^\x20-\x7e]/g, '?');
}

// Folds the scanner's per-lockfile results (versions the PR adds) into one verdict.
function decide(results, days = DAYS) {
    const failed = results.flatMap((result) => result.failures.map((failure) => failure.name));
    if (failed.length) return { verdict: 'error', reason: `registry lookup failed for ${failed.join(', ')}` };
    const unknown = results.flatMap((result) => result.unknown);
    if (unknown.length) return { verdict: 'error', reason: `no npm publish time for ${unknown.join(', ')}` };
    const fresh = results.flatMap((result) => result.fresh);
    if (!fresh.length) return { verdict: READY, fresh };
    const last = Math.max(...fresh.map((entry) => Date.parse(entry.published)));
    return { verdict: QUARANTINE, fresh, clearsAt: new Date(last + days * 86_400_000).toISOString() };
}

// Only the two quarantine labels move; on-hold and everything else stay as people left them.
function labelChanges(labels, verdict) {
    if (verdict !== QUARANTINE && verdict !== READY) return { add: [], remove: [] };
    const other = verdict === QUARANTINE ? READY : QUARANTINE;
    return { add: labels.includes(verdict) ? [] : [verdict], remove: labels.includes(other) ? [other] : [] };
}

function describe(outcome) {
    const changes = [...outcome.add.map((name) => `+${name}`), ...outcome.remove.map((name) => `-${name}`)];
    const note = changes.length ? changes.join(' ') : 'labels already correct';
    if (outcome.verdict === QUARANTINE) {
        const until = `${outcome.clearsAt.slice(0, 16).replace('T', ' ')} UTC`;
        return `#${outcome.number}: quarantine until ${until}, ${outcome.fresh.length} fresh version(s) (${note})`;
    }
    if (outcome.verdict === READY) return `#${outcome.number}: ready-to-merge (${note})`;
    return `#${outcome.number}: error, labels unchanged (reason in the log)`;
}

async function reconcile({ github, scan, now = new Date(), dryRun = false }) {
    const missing = [];
    for (const name of [QUARANTINE, READY]) if (!(await github.hasLabel(name))) missing.push(name);
    // Adding an unknown label can create it; the labels are maintainer-owned, so stop instead.
    if (missing.length && !dryRun) throw new Error(`Create the label(s) ${missing.join(', ')} first.`);

    const pulls = (await github.openPulls()).filter((pull) => pull.user?.login === 'dependabot[bot]');
    const outcomes = [];
    for (const pull of pulls) {
        try {
            // GitHub diffs a PR against the merge base, so a base branch that moved on adds nothing here.
            const mergeBase = await github.mergeBase(pull.base.sha, pull.head.sha);
            const results = [];
            for (const file of LOCKFILES) {
                const head = await github.file(file, pull.head.sha);
                if (head === null) continue;
                const base = await github.file(file, mergeBase);
                if (head !== base) results.push(await scan(head, base, now));
            }
            const decision = decide(results);
            const labels = pull.labels.map((label) => label.name);
            const outcome = { number: pull.number, ...decision, ...labelChanges(labels, decision.verdict) };
            if (!dryRun) {
                // Add before remove: a failure in between leaves both labels, never neither.
                for (const name of outcome.add) await github.addLabel(pull.number, name);
                for (const name of outcome.remove) await github.removeLabel(pull.number, name);
            }
            outcomes.push(outcome);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            outcomes.push({ number: pull.number, verdict: 'error', reason, add: [], remove: [] });
        }
    }
    return { missing, outcomes };
}

// Lockfile contents only ever reach files and the scanner's JSON.parse, never a shell.
async function scanLockfile(head, base, now, registry) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dependabot-quarantine-'));
    try {
        const args = [SCANNER, '--json', '--days', String(DAYS), '--now', now.toISOString()];
        if (registry) args.push('--registry', registry);
        if (base !== null) {
            fs.writeFileSync(path.join(directory, 'base.json'), base);
            args.push('--baseline', path.join(directory, 'base.json'));
        }
        fs.writeFileSync(path.join(directory, 'head.json'), head);
        args.push(path.join(directory, 'head.json'));
        const run = await new Promise((resolve) => {
            const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 };
            execFile(process.execPath, args, options, (error, stdout, stderr) =>
                resolve({ code: error ? error.code : 0, stdout, stderr }),
            );
        });
        // Exit 3 still prints the result; decide() turns its failures into an error verdict.
        if (run.code !== 0 && run.code !== 3) {
            throw new Error(`Scanner failed (${run.code ?? 'timed out'}): ${run.stderr.trim()}`);
        }
        return JSON.parse(run.stdout).results[0];
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function githubClient(repository, token, api = process.env.GITHUB_API_URL || 'https://api.github.com') {
    async function request(method, endpoint, { accept = 'application/vnd.github+json', body, optional } = {}) {
        const response = await fetch(`${api}/repos/${repository}/${endpoint}`, {
            method,
            headers: {
                accept,
                authorization: `Bearer ${token}`,
                'user-agent': 'dependabot-quarantine',
                'x-github-api-version': '2022-11-28',
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
        });
        if (optional && response.status === 404) return null;
        if (!response.ok) throw new Error(`${method} ${endpoint.split('?')[0]}: HTTP ${response.status}`);
        return accept.endsWith('raw+json') ? response.text() : response.json();
    }
    return {
        async openPulls() {
            const pulls = [];
            for (let page = 1; ; page++) {
                const batch = await request('GET', `pulls?state=open&per_page=100&page=${page}`);
                pulls.push(...batch);
                if (batch.length < 100) return pulls;
            }
        },
        hasLabel: async (name) =>
            (await request('GET', `labels/${encodeURIComponent(name)}`, { optional: true })) !== null,
        mergeBase: async (base, head) => (await request('GET', `compare/${base}...${head}`)).merge_base_commit.sha,
        // Raw media type: the JSON form omits content for files over 1 MB.
        file: (file, ref) =>
            request('GET', `contents/${file}?ref=${ref}`, {
                accept: 'application/vnd.github.raw+json',
                optional: true,
            }),
        addLabel: (number, name) => request('POST', `issues/${number}/labels`, { body: { labels: [name] } }),
        // 404 means someone already removed it.
        removeLabel: (number, name) =>
            request('DELETE', `issues/${number}/labels/${encodeURIComponent(name)}`, { optional: true }),
    };
}

async function main() {
    const repository = process.env.GITHUB_REPOSITORY;
    const token = process.env.GH_TOKEN;
    if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.');
    const dryRun = ['1', 'true'].includes(process.env.DRY_RUN ?? '');

    const { missing, outcomes } = await reconcile({
        github: githubClient(repository, token),
        scan: scanLockfile,
        dryRun,
    });

    const notes = [];
    if (dryRun) notes.push('Dry run: no labels were changed.');
    if (missing.length) notes.push(`Missing labels: ${missing.join(', ')}. Create them before a real run.`);
    if (!outcomes.length) notes.push('No open Dependabot PRs.');
    for (const note of notes) console.log(note);
    const lines = [];
    for (const outcome of outcomes) {
        const line = describe(outcome);
        lines.push(line);
        console.log(line);
        // Package names and errors stay in the log; the summary renders Markdown.
        for (const entry of outcome.fresh ?? []) {
            console.log(clean(`  ${entry.name}@${entry.version} published ${entry.published}`));
        }
        if (outcome.reason) console.log(clean(`  ${outcome.reason}`));
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        const paragraphs = notes.flatMap((note) => [note, '']);
        const summary = ['## Dependabot quarantine', '', ...paragraphs, ...lines.map((line) => `- ${line}`)];
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
    }
    if (outcomes.some((outcome) => outcome.verdict === 'error')) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(clean(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
    });
}

module.exports = { QUARANTINE, READY, decide, labelChanges, describe, reconcile, scanLockfile };
