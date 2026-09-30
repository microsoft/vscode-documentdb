#!/usr/bin/env node
// Lists locked npm dependencies whose exact version was published to the public
// npm registry within the last N days. Read-only; no dependencies beyond Node >= 18.
//
// Usage:
//   node find-fresh-dependencies.mjs [lockfile ...] [--days 7] [--now <ISO>]
//        [--registry <url>] [--json] [--fail-on-fresh] [--concurrency 24]
// Default lockfiles: ./package-lock.json and ./api/package-lock.json (if present).
// Exit codes: 0 ok, 1 fresh found (only with --fail-on-fresh), 2 bad usage, 3 incomplete (lookup failures).

import fs from 'node:fs';

const opts = {
    days: 7,
    now: new Date(),
    registry: 'https://registry.npmjs.org',
    json: false,
    failOnFresh: false,
    concurrency: 24,
};
const lockfiles = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
        if (i + 1 >= args.length) fail(`Missing value for ${a}`);
        return args[++i];
    };
    if (a === '--days') opts.days = Number(next());
    else if (a === '--now') opts.now = new Date(next());
    else if (a === '--registry') opts.registry = next().replace(/\/+$/, '');
    else if (a === '--concurrency') opts.concurrency = Number(next());
    else if (a === '--json') opts.json = true;
    else if (a === '--fail-on-fresh') opts.failOnFresh = true;
    else if (a.startsWith('--')) fail(`Unknown option ${a}`);
    else lockfiles.push(a);
}
if (!Number.isFinite(opts.days) || opts.days <= 0) fail('--days must be a positive number');
if (Number.isNaN(opts.now.getTime())) fail('--now must be a valid ISO date');
if (lockfiles.length === 0) {
    for (const f of ['package-lock.json', 'api/package-lock.json']) if (fs.existsSync(f)) lockfiles.push(f);
}
if (lockfiles.length === 0) fail('No lockfile found; pass a path explicitly');

function fail(message) {
    console.error(message);
    process.exit(2);
}

const MS_PER_DAY = 86_400_000;

function nameFromPath(path) {
    return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

// Collects unique name@version entries from a lockfile v2/v3, plus a name-level
// parent map so a fresh package can be traced back to a declared dependency.
function readLockfile(file) {
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!lock.packages) fail(`${file}: lockfileVersion 2 or 3 required (missing "packages")`);
    const versions = new Map();
    const parents = new Map();
    for (const [path, entry] of Object.entries(lock.packages)) {
        const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
        const owner = path === '' ? '<root>' : (entry.name ?? nameFromPath(path));
        if (path === '') Object.assign(deps, entry.devDependencies);
        for (const dep of Object.keys(deps)) {
            if (!parents.has(dep)) parents.set(dep, new Set());
            parents.get(dep).add(owner);
        }
        if (path === '' || !entry.version || entry.link) continue;
        const name = entry.name ?? nameFromPath(path);
        const key = `${name}@${entry.version}`;
        const item = versions.get(key) ?? { name, version: entry.version, dev: true, paths: [] };
        if (!entry.dev) item.dev = false;
        item.paths.push(path);
        versions.set(key, item);
    }
    return { versions, parents };
}

// Shortest chain of package names from a package up to the root manifest.
function chainToRoot(name, parents) {
    const queue = [[name]];
    const seen = new Set([name]);
    while (queue.length) {
        const chain = queue.shift();
        for (const parent of parents.get(chain[0]) ?? []) {
            if (parent === '<root>') return chain;
            if (seen.has(parent)) continue;
            seen.add(parent);
            queue.push([parent, ...chain]);
        }
    }
    return [name];
}

async function fetchTimes(name) {
    const url = `${opts.registry}/${name.replace('/', '%2f')}`;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { accept: 'application/json' } });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json()).time ?? {};
        } catch (error) {
            lastError = error;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
    }
    throw lastError;
}

async function scan(file) {
    const { versions, parents } = readLockfile(file);
    const names = [...new Set([...versions.values()].map((v) => v.name))];
    const times = new Map();
    const failures = [];
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
            while (next < names.length) {
                const name = names[next++];
                try {
                    times.set(name, await fetchTimes(name));
                } catch (error) {
                    failures.push({ name, error: error instanceof Error ? error.message : String(error) });
                }
            }
        }),
    );

    const fresh = [];
    const unknown = [];
    for (const item of versions.values()) {
        const published = times.get(item.name)?.[item.version];
        if (!published) {
            unknown.push(`${item.name}@${item.version}`);
            continue;
        }
        const ageDays = (opts.now - new Date(published)) / MS_PER_DAY;
        if (ageDays <= opts.days) {
            fresh.push({
                name: item.name,
                version: item.version,
                published,
                ageDays: Number(ageDays.toFixed(2)),
                scope: item.dev ? 'dev' : 'prod',
                path: item.paths[0],
                via: chainToRoot(item.name, parents),
            });
        }
    }
    fresh.sort((a, b) => a.ageDays - b.ageDays);
    return { file, total: versions.size, packages: names.length, fresh, unknown, failures };
}

const results = [];
for (const file of lockfiles) results.push(await scan(file));

if (opts.json) {
    console.log(
        JSON.stringify({ now: opts.now.toISOString(), days: opts.days, registry: opts.registry, results }, null, 2),
    );
} else {
    console.log(`Window: ${opts.days} days up to ${opts.now.toISOString()} (registry: ${opts.registry})`);
    for (const r of results) {
        console.log(`\n${r.file}: ${r.total} locked versions, ${r.packages} packages, ${r.fresh.length} fresh`);
        for (const f of r.fresh) {
            console.log(`  ${f.ageDays.toFixed(2)}d  ${f.published}  ${f.scope.padEnd(4)}  ${f.name}@${f.version}`);
            console.log(`         via ${f.via.join(' > ')}   [${f.path}]`);
        }
        if (r.unknown.length) console.log(`  not on the registry (git/private/unpublished): ${r.unknown.length}`);
        if (r.failures.length)
            console.log(
                `  LOOKUP FAILURES (result incomplete): ${r.failures.map((f) => `${f.name} (${f.error})`).join(', ')}`,
            );
    }
}

const incomplete = results.some((r) => r.failures.length > 0);
const anyFresh = results.some((r) => r.fresh.length > 0);
process.exit(incomplete ? 3 : opts.failOnFresh && anyFresh ? 1 : 0);
