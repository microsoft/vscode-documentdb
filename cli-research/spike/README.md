# Packaging feasibility spike — packaged CLI + self-spawned daemon + shell-runtime

This is the hands-on spike for the question in
[`../03-where-id-love-your-help.md`](../03-where-id-love-your-help.md): can a packaged,
self-contained `documentdb` binary **spawn a detached copy of itself as a daemon**, talk to it
over **local IPC** (Unix domain socket / Windows named pipe), and run the real
**`@documentdb-js/shell-runtime`** (`@mongosh/*`, MongoDB driver, BSON, `node:vm`) — with no
Node installed on the user's machine?

**Answer so far: yes, for both finalists.** See [`../04-packaging-and-release-design.md`](../04-packaging-and-release-design.md)
for the full comparison, recommendation, and the list of things the spike gets knowingly wrong
(design doc §2.4) — it is evidence, not a reference implementation.

## What the binary does

One entry point, two roles (the daemon is a detached copy of the same binary):

```
documentdb-spike ping            # round-trip to the daemon (auto-spawns it on first use)
documentdb-spike eval "x = 41"   # evaluate shell JS in the daemon's persistent @mongosh context
documentdb-spike eval "x + 1"    # -> 42, from a DIFFERENT client process: the warm session works
documentdb-spike worker          # worker_threads smoke test inside the packaged daemon
documentdb-spike status          # pid, uptime, runtime, eval count
documentdb-spike stop            # stop the daemon
```

Output is JSON on stdout (the agent-facing convention from the dual-DX design). The daemon
holds a persistent `DocumentDBShellRuntime` with an **unconnected** `MongoClient` — pure-JS
evaluation exercises the full dependency graph without needing a database.

## Build & test

Requires Node ≥ 22 and npm (verified from a fresh clone on Node 22.22 and 24.19; CI uses 24).
Everything else is a local devDependency — no global Bun or Node tooling needed.

```bash
npm install

# Baseline (unpackaged):
npm run build          # esbuild -> dist/bundle.cjs (single CJS file, ~10 MB)
npm run test:node

# Finalist 1 — Node SEA (native platform only; no cross-compile):
npm run build:sea      # blob -> copy node binary -> postject inject -> (macOS) re-sign
npm run test:sea

# Finalist 2 — Bun (installed as a devDependency; put it on PATH first):
export PATH="$PWD/node_modules/.bin:$PATH"          # bash/zsh
#   $env:PATH = "$PWD\node_modules\.bin;$env:PATH"   # PowerShell
npm run build:bun                             # native target
node scripts/build-bun.mjs bun-windows-x64    # or any cross-compile target
npm run test:bun
```

`test/acceptance.mjs` encodes the make-or-break checklist: cold auto-spawn, client exits while
daemon survives, second client attaches to the same pid, persistent eval state across separate
invocations, worker threads inside the packaged artifact, 10 concurrent cold clients converging
on one daemon, idle-timeout shutdown and restart, stop — and, from inside the artifact, that it
really is packaged (`packaged: true`) and built for this machine's `process.arch`.

Knobs: `DDB_SPIKE_IDLE_MS` (daemon idle timeout; default 120 000 ms, the test uses 3 000) and
`DDB_SPIKE_SPAWN_WAIT_MS` (how long a client waits for a freshly spawned daemon; default 10 000).
`sea-config.json` is the minimal SEA config; the release config in design doc §4 adds
`"useCodeCache": true` (client start 170 → 66 ms on Linux x64, §2.1) and
`"execArgvExtension": "none"` (blocks `NODE_OPTIONS` injection, §2.3 #9) — add them and rebuild
to see the difference.

CI: [`.github/workflows/cli-packaging-spike.yml`](../../.github/workflows/cli-packaging-spike.yml)
runs the same suite on native runners for linux/windows/macos × x64/arm64, plus a
one-Linux-runner Bun cross-compile job.

## Findings worth knowing (captured in full in the design doc, §2.3)

- **The dependency graph needs curated externals.** `@mongosh/*` transitively pulls `ssh2`
  (native addon), `electron` (optional OIDC integration), and Babel dynamic config probing.
  All are optional/lazy at runtime; both bundlers need them marked external
  (see `scripts/build-bundle.mjs` / `scripts/build-bun.mjs`).
- **The spawn race is real.** Packaged binaries start slower than `node bundle.cjs`; our first
  naive "unlink stale socket, then bind" logic let 4 daemons coexist under 10 concurrent cold
  clients — only in the packaged build. The fix: probe-then-bind arbitration with an atomic
  mkdir lock (see `runDaemon()` in `src/main.ts`). Any production daemon needs this from day
  one. The spike's version still has known holes (non-atomic stale steal, unconditional
  unlink on shutdown, lock dir not per-user) — listed in the design doc §2.4.
- **`spawn(process.execPath, ['daemon'])` behaves as needed in both packagers**: a SEA binary
  always re-runs its embedded main; a bun-compiled binary re-runs its embedded entry. The CLI
  dispatches on its own `daemon` argument, so packaged self-spawn "just works".
- **argv: only `argv[0]`/`argv[1]` differ per packaging** (`[node, script, …]` vs
  `[execPath, argv0, …]` vs `["bun", "/$bunfs/…", …]`); **user arguments start at index 2 in
  every case**, so `argv.slice(2)` and standard parsers work. The `KNOWN_COMMANDS` scan in
  `src/main.ts` predates that measurement and is unnecessary; the real rule is "never use
  `argv[1]` to find the script — use `process.execPath` + a packaged check for self-spawn".
- **Dynamic imports resolve from the working directory in both packagers** — `probe/` is a
  10-line probe built as a SEA (twice: relative and absolute `main` in the SEA config) and as a
  Bun binary; `bash probe/run.sh` shows Bun's `require`/`import()` load `node_modules` from the
  *cwd*, and the SEA's `eval("import(...)")` resolves relative to the config's `main` path — against
  the runtime cwd when that path is relative (as in `sea-config.json` here and in Node's docs),
  against the *build host's* directory when absolute. Neither looks next to the binary (design
  doc §2.3 #14). A daemon that inherits an agent's repository cwd would import
  repository-controlled code.
- **Known spike-only bugs, deliberately left in this revision** (design doc §2.3 #5–8 and
  §2.4): the idle timer can fire during a long request; the client re-sends a request after a
  failure; the socket is created `0755` in `os.tmpdir()`; the daemon inherits the client's cwd
  and environment (which, with the resolution behavior above, is how a repository's
  `node_modules` would end up inside the credential-holding process — §2.3 #14); `mongodb@6`
  and `@7` are both bundled. Do not copy these into the real CLI.
