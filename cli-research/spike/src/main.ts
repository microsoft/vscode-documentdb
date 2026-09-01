/*---------------------------------------------------------------------------------------------
 *  Packaging feasibility spike — DocumentDB CLI
 *
 *  One entry point, two roles:
 *    - client:  documentdb-spike ping | eval "<code>" | worker | status | stop
 *    - daemon:  documentdb-spike daemon        (internal; normally auto-spawned)
 *
 *  The client connects to a per-user Unix domain socket (macOS/Linux) or named pipe
 *  (Windows). If no daemon is listening, it spawns a detached copy of ITSELF in daemon
 *  mode and retries. The daemon keeps a persistent @documentdb-js/shell-runtime context
 *  warm, so variables survive across separate CLI invocations — the warm-session value
 *  proposition, demonstrated end-to-end from a packaged binary.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const SPIKE_VERSION = '0.1.0';
const IDLE_TIMEOUT_MS = Number(process.env.DDB_SPIKE_IDLE_MS ?? 120_000);
const CONNECT_TIMEOUT_MS = 1_000;
const SPAWN_WAIT_MS = Number(process.env.DDB_SPIKE_SPAWN_WAIT_MS ?? 10_000);

type Request = { id: number; cmd: string; args?: Record<string, unknown> };
type Response = { id: number; ok: boolean; result?: unknown; error?: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Packaging detection — this is one of the facts the spike exists to verify.
// ---------------------------------------------------------------------------

function isSeaBinary(): boolean {
    try {
        // node:sea exists in Node >= 20.12; throws under Bun and older Node.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sea = require('node:sea') as { isSea?: () => boolean };
        return typeof sea.isSea === 'function' && sea.isSea();
    } catch {
        return false;
    }
}

function isBunCompiled(): boolean {
    if (!process.versions.bun) {
        return false;
    }
    // In a `bun build --compile` binary the entry module lives on an embedded
    // virtual filesystem ("/$bunfs/..." on POSIX, "B:/~BUN/..." on Windows).
    const entry = process.argv[1] ?? '';
    return entry.includes('$bunfs') || entry.includes('~BUN');
}

function isPackaged(): boolean {
    return isSeaBinary() || isBunCompiled();
}

function runtimeDescription(): string {
    if (isSeaBinary()) return `node-sea ${process.version}`;
    if (isBunCompiled()) return `bun-compiled ${process.versions.bun}`;
    if (process.versions.bun) return `bun ${process.versions.bun}`;
    return `node ${process.version}`;
}

// ---------------------------------------------------------------------------
// argv — the [node, script, ...] / [binary, binary, ...] / [bun, /$bunfs/..., ...]
// layouts differ per packaging; locate the first known command token instead of
// assuming a fixed index.
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = new Set(['daemon', 'ping', 'eval', 'worker', 'status', 'stop', 'help']);

function parseArgv(): { command: string; rest: string[] } {
    for (let i = 1; i < process.argv.length; i++) {
        const token = process.argv[i];
        if (KNOWN_COMMANDS.has(token)) {
            return { command: token, rest: process.argv.slice(i + 1) };
        }
    }
    return { command: 'help', rest: [] };
}

// ---------------------------------------------------------------------------
// IPC endpoint — per-user, short path (Unix socket paths are limited to ~104 chars).
// ---------------------------------------------------------------------------

function ipcPath(): string {
    const key = createHash('sha256')
        .update(`${os.userInfo().username}|documentdb-spike|${SPIKE_VERSION}`)
        .digest('hex')
        .slice(0, 12);
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\documentdb-spike-${key}`;
    }
    return path.join(os.tmpdir(), `ddb-spike-${key}.sock`);
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

async function runDaemon(): Promise<void> {
    const endpoint = ipcPath();
    let idleTimer: NodeJS.Timeout | undefined;
    let evalCount = 0;
    const startedAt = Date.now();

    // Lazily-created warm session. The MongoClient is intentionally never
    // connected in this spike: evaluating pure JS through the @mongosh pipeline
    // exercises the real dependency graph (shell-api, shell-evaluator, driver,
    // BSON, node:vm) without needing a database.
    let runtime: import('@documentdb-js/shell-runtime').DocumentDBShellRuntime | undefined;

    async function getRuntime() {
        if (!runtime) {
            const { MongoClient } = await import('mongodb');
            const { DocumentDBShellRuntime } = await import('@documentdb-js/shell-runtime');
            const client = new MongoClient('mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 500 });
            runtime = new DocumentDBShellRuntime(client, {}, { persistent: true, productName: 'documentdb-spike' });
        }
        return runtime;
    }

    function shutdown(reason: string): void {
        server.close();
        removeStaleSocket(endpoint);
        // eslint-disable-next-line no-console
        console.error(`[daemon ${process.pid}] exiting: ${reason}`);
        process.exit(0);
    }

    function resetIdleTimer(): void {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => shutdown(`idle for ${IDLE_TIMEOUT_MS}ms`), IDLE_TIMEOUT_MS);
        idleTimer.unref?.();
    }

    async function handle(req: Request): Promise<Response> {
        switch (req.cmd) {
            case 'ping':
                return ok(req, { pong: true, pid: process.pid, packaged: isPackaged(), runtime: runtimeDescription() });
            case 'status':
                return ok(req, {
                    pid: process.pid,
                    uptimeMs: Date.now() - startedAt,
                    evalCount,
                    packaged: isPackaged(),
                    runtime: runtimeDescription(),
                    execPath: process.execPath,
                    endpoint,
                    idleTimeoutMs: IDLE_TIMEOUT_MS,
                    spikeVersion: SPIKE_VERSION,
                });
            case 'eval': {
                const code = String(req.args?.code ?? '');
                if (!code) return err(req, 'VALIDATION', 'missing args.code');
                try {
                    const rt = await getRuntime();
                    const result = await rt.evaluate(code, 'test');
                    evalCount++;
                    return ok(req, {
                        type: result.type ?? null,
                        printable: toPlainJson(result.printable),
                        durationMs: result.durationMs,
                    });
                } catch (e) {
                    return err(req, 'EVAL_ERROR', e instanceof Error ? e.message : String(e));
                }
            }
            case 'worker': {
                // Prove worker_threads works from inside the packaged artifact.
                try {
                    const { Worker } = await import('node:worker_threads');
                    const answer = await new Promise<number>((resolve, reject) => {
                        const w = new Worker(
                            `const { parentPort } = require('node:worker_threads'); parentPort.postMessage(21 * 2);`,
                            { eval: true },
                        );
                        w.once('message', resolve);
                        w.once('error', reject);
                    });
                    return ok(req, { answer });
                } catch (e) {
                    return err(req, 'WORKER_ERROR', e instanceof Error ? e.message : String(e));
                }
            }
            case 'stop':
                setTimeout(() => shutdown('stop requested'), 50);
                return ok(req, { stopping: true, pid: process.pid });
            default:
                return err(req, 'UNKNOWN_COMMAND', `unknown command: ${req.cmd}`);
        }
    }

    const server = net.createServer((socket) => {
        resetIdleTimer();
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 1);
                if (!line.trim()) continue;
                void (async () => {
                    let response: Response;
                    try {
                        const req = JSON.parse(line) as Request;
                        response = await handle(req);
                    } catch (e) {
                        response = { id: -1, ok: false, error: { code: 'BAD_REQUEST', message: String(e) } };
                    }
                    resetIdleTimer();
                    socket.write(JSON.stringify(response) + '\n');
                })();
            }
        });
        socket.on('error', () => socket.destroy());
    });

    server.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') {
            // Bind race: another daemon won. Exit quietly; the client will reach the winner.
            releaseStartLock();
            process.exit(0);
        }
        // eslint-disable-next-line no-console
        console.error(`[daemon] server error:`, e);
        process.exit(1);
    });

    // Spawn-race arbitration. A stale socket FILE (previous daemon killed hard) must be
    // unlinked before bind — but unlinking a LIVE daemon's socket lets a second daemon
    // bind the same path, splitting clients across two daemons. (We hit exactly this:
    // packaged binaries start slower than `node bundle.cjs`, and the widened window let
    // 4 daemons coexist.) So: probe first, and guard unlink+bind with an atomic mkdir lock.
    if (await isListening(endpoint)) {
        process.exit(0); // a daemon is already serving
    }
    if (!(await acquireStartLock())) {
        process.exit(0); // another starting daemon holds the lock; it will serve
    }
    if (await isListening(endpoint)) {
        releaseStartLock();
        process.exit(0);
    }
    removeStaleSocket(endpoint); // probe said nobody is listening -> the file is stale
    server.listen(endpoint, () => {
        releaseStartLock();
        resetIdleTimer();
        // eslint-disable-next-line no-console
        console.error(`[daemon ${process.pid}] listening on ${endpoint} (${runtimeDescription()})`);
    });
}

/** True if a live daemon accepts connections on the endpoint. */
function isListening(endpoint: string): Promise<boolean> {
    return new Promise((resolve) => {
        const probe = net.connect(endpoint);
        const timer = setTimeout(() => {
            probe.destroy();
            resolve(false);
        }, CONNECT_TIMEOUT_MS);
        probe.on('connect', () => {
            clearTimeout(timer);
            probe.end();
            resolve(true);
        });
        probe.on('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

const START_LOCK_DIR = path.join(os.tmpdir(), 'ddb-spike-start.lock');
const START_LOCK_STALE_MS = 15_000;

/** Atomic mkdir lock serializing the unlink-stale-socket + bind critical section. */
async function acquireStartLock(): Promise<boolean> {
    const deadline = Date.now() + START_LOCK_STALE_MS;
    while (Date.now() < deadline) {
        try {
            fs.mkdirSync(START_LOCK_DIR);
            return true;
        } catch {
            // Lock held by another starting daemon. If it produces a listener, we yield;
            // if the lock goes stale (holder crashed), steal it.
            try {
                const age = Date.now() - fs.statSync(START_LOCK_DIR).mtimeMs;
                if (age > START_LOCK_STALE_MS) {
                    fs.rmdirSync(START_LOCK_DIR);
                    continue;
                }
            } catch {
                continue; // lock vanished between mkdir and stat; retry
            }
            if (await isListening(ipcPath())) {
                return false;
            }
            await sleep(50);
        }
    }
    return false;
}

function releaseStartLock(): void {
    try {
        fs.rmdirSync(START_LOCK_DIR);
    } catch {
        /* not held */
    }
}

function ok(req: Request, result: unknown): Response {
    return { id: req.id, ok: true, result };
}
function err(req: Request, code: string, message: string): Response {
    return { id: req.id, ok: false, error: { code, message } };
}

function removeStaleSocket(endpoint: string): void {
    if (process.platform === 'win32') return; // named pipes vanish with their owner
    try {
        fs.unlinkSync(endpoint);
    } catch {
        /* nonexistent is fine */
    }
}

/** Best-effort plain-JSON conversion of @mongosh printable values (may contain BSON). */
function toPlainJson(value: unknown): unknown {
    try {
        // bson is a dependency of the mongodb driver; EJSON handles ObjectId, Long, etc.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { EJSON } = require('bson') as typeof import('bson');
        return JSON.parse(EJSON.stringify(value as never, { relaxed: true }));
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return String(value);
        }
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function requestOnce(cmd: string, args?: Record<string, unknown>): Promise<Response> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(ipcPath());
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('connect/response timeout'));
        }, CONNECT_TIMEOUT_MS + 5_000);

        socket.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
        });
        socket.on('connect', () => {
            socket.write(JSON.stringify({ id: 1, cmd, args } satisfies Request) + '\n');
        });
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            const nl = buffer.indexOf('\n');
            if (nl === -1) return;
            clearTimeout(timer);
            socket.end();
            try {
                resolve(JSON.parse(buffer.slice(0, nl)) as Response);
            } catch (e) {
                reject(e as Error);
            }
        });
    });
}

function spawnDaemon(): void {
    // THE make-or-break packaging behavior: spawn a detached copy of ourselves.
    // Packaged (SEA / bun-compiled): process.execPath IS the CLI binary.
    // Unpackaged: process.execPath is node/bun and argv[1] is the script.
    const args = isPackaged() ? ['daemon'] : [process.argv[1], 'daemon'];
    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref();
}

async function callDaemon(cmd: string, args?: Record<string, unknown>, autoSpawn = true): Promise<Response> {
    try {
        return await requestOnce(cmd, args);
    } catch (e) {
        if (!autoSpawn) throw e;
    }
    // Never touch the socket file from the client — daemons arbitrate ownership themselves.
    spawnDaemon();
    const deadline = Date.now() + SPAWN_WAIT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
        await sleep(100);
        try {
            return await requestOnce(cmd, args);
        } catch (e) {
            lastError = e;
        }
    }
    throw new Error(`daemon did not become reachable within ${SPAWN_WAIT_MS}ms: ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = `documentdb-spike ${SPIKE_VERSION} — packaging feasibility spike (${'runtime: ' + runtimeDescription()})

Usage:
  documentdb-spike ping              round-trip to the daemon (auto-spawns it)
  documentdb-spike eval "<code>"     evaluate shell JS in the daemon's persistent context
  documentdb-spike worker            run a worker_threads smoke test inside the daemon
  documentdb-spike status            daemon status
  documentdb-spike stop              stop the daemon
  documentdb-spike daemon            run as the daemon (internal; auto-spawned normally)

Output is JSON on stdout. Exit codes: 0 ok, 2 daemon unreachable, 3 command failed.
`;

async function main(): Promise<void> {
    const { command, rest } = parseArgv();

    if (command === 'daemon') {
        await runDaemon();
        return; // daemon keeps the event loop alive via the server
    }
    if (command === 'help') {
        process.stdout.write(HELP);
        return;
    }

    let response: Response;
    try {
        if (command === 'eval') {
            response = await callDaemon('eval', { code: rest.join(' ') });
        } else if (command === 'stop') {
            response = await callDaemon(command, undefined, /* autoSpawn */ false);
        } else {
            response = await callDaemon(command);
        }
    } catch (e) {
        process.stdout.write(
            JSON.stringify({ ok: false, error: { code: 'DAEMON_UNREACHABLE', message: String(e) } }) + '\n',
        );
        process.exit(2);
    }

    process.stdout.write(JSON.stringify(response) + '\n');
    process.exit(response.ok ? 0 : 3);
}

void main();
