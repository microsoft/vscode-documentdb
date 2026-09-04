/**
 * Packaged-daemon acceptance test.
 *
 * Usage:  node test/acceptance.mjs <command> [args-prefix...]
 *   e.g.  node test/acceptance.mjs dist/sea/documentdb-spike
 *         node test/acceptance.mjs node dist/bundle.cjs
 *
 * Encodes the manager's make-or-break checklist:
 *   1. first invocation auto-spawns the daemon and gets a reply
 *   2. the client exits while the daemon stays alive
 *   3. a second invocation attaches to the SAME daemon (same pid)
 *   4. persistent shell state survives across separate CLI invocations
 *      (eval "x = 41" then eval "x + 1" -> 42, via @documentdb-js/shell-runtime)
 *   5. worker_threads works inside the packaged artifact
 *      (plus: packaged=true and process.arch asserted from INSIDE the artifact)
 *   6. N concurrent cold-start clients converge on ONE daemon (spawn race)
 *   7. idle timeout shuts the daemon down; the next call restarts it
 *   8. stop works
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
    console.error('usage: node test/acceptance.mjs <binary-or-command> [args-prefix...]');
    process.exit(1);
}
const [cmd, ...prefix] = argv;
let cmdResolved = cmd === 'node' || cmd === 'bun' ? cmd : path.resolve(cmd);
// On Windows the packaged binaries carry an .exe suffix.
if (cmdResolved !== cmd && !existsSync(cmdResolved) && existsSync(cmdResolved + '.exe')) {
    cmdResolved += '.exe';
}

const IDLE_MS = 3_000;
let failures = 0;

function invoke(args, { env = {}, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve) => {
        execFile(
            cmdResolved,
            [...prefix, ...args],
            { env: { ...process.env, DDB_SPIKE_IDLE_MS: String(IDLE_MS), ...env }, timeout: timeoutMs },
            (error, stdout, stderr) => {
                let json;
                try {
                    json = JSON.parse(stdout.trim().split('\n').pop() ?? '');
                } catch {
                    json = undefined;
                }
                resolve({ code: error?.code ?? 0, stdout, stderr, json });
            },
        );
    });
}

function check(name, condition, detail = '') {
    const status = condition ? 'PASS' : 'FAIL';
    if (!condition) failures++;
    console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n=== packaged-daemon acceptance: ${cmdResolved} ${prefix.join(' ')} ===\n`);

// Clean slate.
await invoke(['stop']);
await sleep(300);

// 1+2+3: cold ping spawns daemon; second ping reaches the same one.
const ping1 = await invoke(['ping']);
check('cold ping auto-spawns daemon and replies', ping1.json?.ok === true, JSON.stringify(ping1.json ?? ping1.stderr));
const pid1 = ping1.json?.result?.pid;
// `node dist/bundle.cjs` is the unpackaged baseline; anything else must report packaged=true.
const expectPackaged = cmd !== 'node' && cmd !== 'bun';
check('daemon reports the expected packaging', ping1.json?.result?.runtime !== undefined && ping1.json?.result?.packaged === expectPackaged, `runtime=${ping1.json?.result?.runtime}, packaged=${ping1.json?.result?.packaged} (expected ${expectPackaged})`);
check('artifact architecture matches this runner', ping1.json?.result?.arch === process.arch, `artifact arch=${ping1.json?.result?.arch}, runner arch=${process.arch}`);

const ping2 = await invoke(['ping']);
check('second invocation attaches to SAME daemon', pid1 !== undefined && ping2.json?.result?.pid === pid1, `pid ${ping2.json?.result?.pid} vs ${pid1}`);

// 4: persistent shell-runtime state across separate CLI processes.
const evalSet = await invoke(['eval', 'x = 41']);
check('eval "x = 41" via shell-runtime succeeds', evalSet.json?.ok === true, JSON.stringify(evalSet.json?.error ?? evalSet.json?.result));
const evalGet = await invoke(['eval', 'x + 1']);
check('persistent context: separate invocation sees x + 1 === 42', evalGet.json?.result?.printable === 42, JSON.stringify(evalGet.json));

// 5: worker_threads inside the packaged artifact.
const worker = await invoke(['worker']);
check('worker_threads runs inside packaged daemon', worker.json?.result?.answer === 42, JSON.stringify(worker.json?.error ?? worker.json?.result));

// 6: spawn race — stop, then 10 concurrent cold clients must converge on one daemon.
await invoke(['stop']);
await sleep(500);
const racers = await Promise.all(Array.from({ length: 10 }, () => invoke(['ping'], { timeoutMs: 60_000 })));
const racerPids = new Set(racers.map((r) => r.json?.result?.pid).filter((p) => p !== undefined));
check('10 concurrent cold clients all get a reply', racers.every((r) => r.json?.ok === true), `${racers.filter((r) => r.json?.ok).length}/10 ok`);
check('spawn race converges on ONE daemon', racerPids.size === 1, `distinct pids: ${[...racerPids].join(', ')}`);

// 7: idle timeout kills the daemon; the next call restarts it with a new pid.
const before = await invoke(['status']);
const pidBeforeIdle = before.json?.result?.pid;
await sleep(IDLE_MS + 2_000);
const afterIdle = await invoke(['ping']);
check('daemon restarts after idle shutdown (new pid)', afterIdle.json?.ok === true && afterIdle.json?.result?.pid !== pidBeforeIdle, `pid ${pidBeforeIdle} -> ${afterIdle.json?.result?.pid}`);

// 8: stop.
const stop = await invoke(['stop']);
check('stop succeeds', stop.json?.ok === true);
await sleep(300);
const afterStop = await invoke(['status']).then(async (r) => {
    // status auto-spawns; instead verify by pid change
    return r;
});
check('daemon after stop is a fresh process', afterStop.json?.result?.pid !== stop.json?.result?.pid, `pid ${stop.json?.result?.pid} -> ${afterStop.json?.result?.pid}`);
await invoke(['stop']);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
