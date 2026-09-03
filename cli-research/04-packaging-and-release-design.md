# Packaging & Release Design — response to `03-where-id-love-your-help.md`

**Author:** Guanzhou Song · **Date:** 2026-09-03 (rev 4) · **Status:** draft for review
**Evidence:** working spike in [`spike/`](./spike/) + CI matrix in
[`.github/workflows/cli-packaging-spike.yml`](../.github/workflows/cli-packaging-spike.yml)
**Verified locally:** macOS arm64 (all acceptance checks green for both finalists, plus the
unpackaged `node` baseline) and Linux x64 (WSL2, Node 24.19.0: SEA + baseline, rev 4). **Verified in CI:** 13/13 jobs green across all six OS/arch targets
([run 33568213084](https://github.com/microsoft/vscode-documentdb/actions/runs/33568213084),
2026-09-01); per-target results and sizes in §2.2.
**Rev 4** adds a working-directory module-resolution probe (§2.3 #14), code-cache and compressed-size
measurements (§2.1), CI cost (§2.2), a map from your questions to sections (§1.2) and two notes for
the auth model (§2.5); the revision notes in §10 list what changed.

---

## 1. TL;DR — recommendation

> **Primary: Node SEA** (Single Executable Applications) built per-target on GitHub's native
> runners, bundled with esbuild.
> **Runner-up: Bun `build --compile`** — better ergonomics, cross-compile, and a native secrets
> API; held back by runtime-substitution risk on exactly our stack (a full Rust rewrite shipped
> on 2026-08-20, and I found no public report of `@mongosh` running on Bun before this spike).
> **Secondary channel regardless of primary: `npm i -g`** — nearly free to ship alongside, and
> the right answer for users/agents that already live in a Node toolchain.

The no-Node/no-`npx` preference is **achievable at reasonable cost**. The make-or-break
requirement — a packaged binary that spawns a detached copy of itself, binds a Unix
socket/named pipe, serves a second invocation, and runs the real `@documentdb-js/shell-runtime`
(`@mongosh/*` + driver + BSON + `node:vm`) — **passes for both finalists**, locally on macOS arm64
(§2.1) and in CI on all six OS/arch targets (§2.2).

Three things changed my view while writing this up, and they are the parts I most want your read on:

1. **Signing is a *who*, not a *how*, question.** Mechanically everything runs on GitHub
   Actions. But this repo already ships the extension through Azure DevOps + OneBranch + ESRP
   signing, and if the CLI ships under the *Microsoft* identity, that is the path I would
   expect to be required — which is exactly the "forces us off GitHub" case you asked me to
   flag. If it ships under the *DocumentDB org* identity, a GitHub-only pipeline with
   org-held certificates is normal. §5 lays out both branches; §1.1 asks for the decision.
2. **The spike exposed daemon-protocol requirements that are independent of packaging**
   (spawn-race arbitration, idle-timeout vs in-flight requests, at-most-once delivery, IPC
   endpoint placement, per-profile isolation). None of them changes the packaging
   recommendation, but all of them belong in the first version of the real daemon. §2.3 and
   §2.4 list them.
3. **Two things the spike did not test could still change the recommendation:** whether the
   daemon works *inside agent-host sandboxes* (Claude Code's sandbox redirects temp
   directories, proxies all network, and can block Unix sockets), and how a single-file binary
   reaches the *OS keychain* that the auth model depends on (needs a native addon or shell-outs;
   macOS ties keychain ACLs to the signing identity; Bun has a native secrets API and Node does
   not). Both are packager-independent in part, but the keychain question is the one axis where
   the runner-up is genuinely ahead. §2.3 #10–11 and §8 make them the next two spikes.

### 1.1 Decisions I need from you

| # | Decision | Why it matters | My default if I hear nothing |
|---|---|---|---|
| 1 | **Which legal identity signs the binaries** — Microsoft (ESRP), or the DocumentDB project? DocumentDB has been a Linux Foundation project since August 2025, so "the DocumentDB org" needs a named legal entity that can hold an Apple Developer ID and a validated Windows signing identity: the LF, Microsoft on the project's behalf, or nobody yet. | Decides whether signing (and, for the Microsoft identity, the whole build) lives on GitHub or on OneBranch/ADO (§5) | Design for both; build the GitHub path first with placeholder secrets |
| 2 | **Which GitHub org/repo hosts the CLI**, and is it public? | Runner labels, quotas, allowed-actions policy and cost differ per org: macOS minutes bill at 10× and arm64 runners are metered on private repos; a green matrix in `microsoft/vscode-documentdb` proves nothing about the DocumentDB org | Move the spike to the CLI's future repo as its first commit |
| 3 | **v1 target list** — is macOS x64 in? | The last Intel runner image (`macos-15-intel`) retires **August 2027** (re-checked 2026-09-03: `macos-26` ships arm64-only; the Intel-capable `macos-26-large` is a paid large runner, still beta); SEA on macOS x64 is untested upstream (it passed in our run) | Ship it via CI while the runner exists; fall back to npm for that target |
| 4 | **npm scope** — `@documentdb/cli`, `@documentdb-js/cli`, or something else? | Existing packages use `@documentdb-js`; I have not confirmed who owns `@documentdb` on npm | `@documentdb-js/cli`, reusing the existing OIDC trusted-publishing setup |
| 5 | **Keep both build paths alive** in the real repo (SEA primary, Bun as a CI-only canary)? | Keeps the SEA-vs-Bun decision reversible with evidence; the credential-store spike (§8) may move the needle | Yes, until v1 ships; then reassess |
| 6 | **Which auth methods must v1 support** — password/SCRAM only, or also Entra ID / OIDC browser and device-code login? | Entra/OIDC login lives in `@mongodb-js/oidc-plugin`, whose browser-opening and HTTP paths are loaded through `eval("import(...)")` and are **dead in the packaged binary today** (§2.3 #2). Making them work is planned engineering, not a packaging switch | Assume Entra/OIDC is required; budget the bundling work |

### 1.2 Where each of your questions is answered

| Your doc 03 | Where |
|---|---|
| Priority 1 — simplest deployment for the user | §6 (GitHub Releases + one-line install scripts; npm alongside) |
| Priority 2 — Windows/macOS/Linux, x64 + arm64, first-class | §2.2 (six native targets executed in CI), §3 |
| Priority 3 — no Node / no `npx`, and tell me honestly what it costs | §1 verdict, §7 the bill |
| Priority 4 — everything on GitHub; flag what forces us off | §4 pipeline, §5.1 (the signing identity is the one thing that can) |
| Priority 5 — must not break the daemon | §2.1–2.2 (the make-or-break test passes for both finalists) |
| Item 1 — Node SEA | §3 row + "honest weaknesses", §4 |
| Item 2 — `@yao-pkg/pkg`, nexe | §3 row (not spiked; reason stated) |
| Item 3 — Bun / Deno | §3 rows; Bun spiked, Deno deliberately not (stated) |
| Item 4 — bundling | esbuild throughout; §2.3 #2 (externals, inventory), §4 (thin-client/daemon split) |
| Item 5 — npm/npx baseline; what comparable tools ship | §3 rows + "What comparable tools actually ship" |
| Item 6 — install/update UX | §6 |
| Item 7 — signing & notarization | §5 |
| Item 8 — daemon compatibility spike | §2, [`spike/`](./spike/) |
| Requested shape: table / recommendation + runner-up / spikes / "where no-npx costs us" | §3 / §1 + §3 "Why SEA over Bun" / §2 / §7 |

## 2. What the spike proved

The spike ([`spike/`](./spike/)) is deliberately representative, not hello-world: it imports
`@documentdb-js/shell-runtime@0.8.1` (→ `@mongosh/shell-api`, `@mongosh/shell-evaluator`,
`@mongosh/service-provider-node-driver`, `mongodb`, `bson`) and evaluates shell JS in a
persistent `vm.Context` inside the daemon, with an unconnected `MongoClient` so no database is
needed.

One thing to state plainly, because the `eval` demo invites the wrong conclusion: `eval` is the
spike's vehicle for exercising the whole dependency graph (`node:vm`, the evaluator, the driver,
BSON) in one call — it is not the agent surface. Per the dual-DX design, agents get structured
commands with JSON in and out; a persistent shell context belongs to the human REPL. What the
daemon holds *for agents* is authenticated connections, not shared shell state (§2.3 #12).

**To try it yourself** (details in [`spike/README.md`](./spike/README.md)):

```bash
git switch cli-research && cd cli-research/spike && npm install
npm run build:sea && npm run test:sea      # Node SEA, native platform only
npm run build:bun && npm run test:bun      # Bun (bun is a devDependency; see README for PATH)
npm run build     && npm run test:node     # unpackaged baseline
```

### 2.1 Acceptance checklist — local, macOS arm64

From your §8 in doc 03, plus the extra checks I added. All run against the **packaged artifact**:

| Check | node (baseline) | Node SEA | Bun compile |
|---|---|---|---|
| Cold call auto-spawns daemon, gets reply | ✅ | ✅ | ✅ |
| Client exits; daemon survives; 2nd call attaches to same pid | ✅ | ✅ | ✅ |
| `eval "x = 41"` then `eval "x + 1"` → 42 across separate processes (persistent `@mongosh` context) | ✅ | ✅ | ✅ |
| `worker_threads` inside packaged daemon | ✅ | ✅ | ✅ |
| 10 concurrent cold clients converge on ONE daemon | ✅ | ✅ (after fix, see §2.3) | ✅ |
| Idle timeout self-exit; next call restarts | ✅ | ✅ | ✅ |
| Explicit stop | ✅ | ✅ | ✅ |

Measured on macOS arm64 (Node 24.9.0, Bun 1.4.0):

| Artifact | Size | Startup (`help`, warm) |
|---|---|---|
| esbuild bundle (`node bundle.cjs`) | 9.9 MB (+ Node) | ~95 ms |
| Node SEA binary | 70.9 MB¹ | ~80 ms |
| Bun binary | 69.8 MB | ~55 ms |

¹ **This local SEA binary is not self-contained, and the size is the tell.** The build script
copies whatever `node` is running, and Homebrew's node is dynamically linked: `otool -L` lists
15 Homebrew dylibs (libuv, OpenSSL, ICU, simdjson, brotli, …), which is why it is 71 MB here and
125 MB in CI, where setup-node uses the official static build. Signed with the hardened runtime
it does not even load (`dyld: Library not loaded: /opt/homebrew/opt/libuv/...`). Consequence for
§4: the release build must start from a **downloaded, checksum-verified official Node tarball**,
never from `process.execPath`, and must gate on `otool -L` / `ldd` showing no non-system
libraries. The CI numbers in §2.2 are the real ones.

Caveat on the startup number: `help` is the cheapest path. What an agent pays hundreds of times
per session is a full client round trip (`ping`), which also parses the 10 MB bundle on every
invocation because the client and the daemon share one bundle; §4 splits them.

Rev 4, Linux x64 (WSL2, Node 24.19.0, Bun 1.4.0; median of 10 runs):

| Measurement | Node SEA | SEA + `useCodeCache` | Bun | `node bundle.cjs` |
|---|---|---|---|---|
| `help` (cold client, no daemon) | 170 ms | **66 ms** | 139 ms | 190 ms |
| `ping` round trip against a warm daemon | 170 ms | **68 ms** | — | — |
| Artifact, raw | 130.1 MB | 130.1 MB | 87.5 MB | 9.8 MB (+ Node) |
| Artifact, gzip -6 / xz -6 | 43.0 / 29.2 MB | same | 36.9 / 28.3 MB | — |

Two things follow. The release configuration (`useCodeCache: true`, §4) removes Bun's startup
edge on this machine, and the per-call cost an agent pays is the 10 MB parse, which the code
cache hides and the thin-client split in §4 removes. And the download gap is 1.2× (gzip) to
nil (xz), not the 1.5× the raw sizes suggest — §3 uses the compressed numbers.

### 2.2 CI matrix — six targets, native runners

The workflow builds **and executes** the packaged acceptance suite on every first-class target
(`ubuntu-latest`, `ubuntu-24.04-arm`, `windows-latest`, `windows-11-arm`, `macos-15`,
`macos-15-intel`), for SEA and for Bun, plus one Linux job that cross-compiles five Bun targets.

Run [33568213084](https://github.com/microsoft/vscode-documentdb/actions/runs/33568213084)
(2026-09-01, triggered by this push): **13/13 jobs green** in 5.5 minutes of wall time. Every
target printed `packaged=true` from inside the artifact and `ALL CHECKS PASSED`.

| Target (runner) | Node SEA | Bun compile |
|---|---|---|
| linux-x64 (`ubuntu-latest`) | ✅ node 24.19.0 · 130.1 MB | ✅ bun 1.4.0 · 87.5 MB |
| linux-arm64 (`ubuntu-24.04-arm`) | ✅ node 24.19.0 · 126.3 MB | ✅ bun 1.4.0 · 87.4 MB |
| windows-x64 (`windows-latest`) | ✅ node 24.19.0 · 98.5 MB | ✅ bun 1.4.0 · 93.5 MB |
| windows-arm64 (`windows-11-arm`) | ✅ node 24.19.0 · 87.5 MB | ✅ bun 1.4.0 · 83.7 MB |
| macos-arm64 (`macos-15`) | ✅ node 24.18.0 · 125.1 MB | ✅ bun 1.4.0 · 69.8 MB |
| macos-x64 (`macos-15-intel`) | ✅ node 24.19.0 · 127.6 MB | ✅ bun 1.4.0 · 76.2 MB |

Sizes are the uncompressed artifacts as reported by the build scripts (MiB). The Bun
cross-compile job produced linux-x64, linux-arm64, windows-x64, darwin-x64 and darwin-arm64
from one Linux runner; each file has exactly the size of its natively built twin, which is
consistent with but not proof of equivalence — the cross-built artifacts should be executed on
their target runners (§4). It does not yet build `bun-windows-arm64` or the musl targets.

What the run says beyond pass/fail:

- **SEA on macOS x64 passed** despite being unsupported upstream. Worth re-running a few times
  before trusting it, but it is not dead on arrival.
- **Bun's size advantage is smaller than I estimated**: 70–94 MB vs SEA's 88–130 MB, and on
  Windows they are nearly equal (93.5 vs 98.5 MB). §3 and §7 use the measured numbers.
- **Floating Node versions drift even within one run**: `node-version: 24` resolved to 24.18.0
  on the macOS arm64 runner and 24.19.0 everywhere else, because setup-node took whatever was in
  each runner's tool cache. Harmless here (each job builds and tests its own binary), but it is
  exactly why the release pipeline must pin an exact version (§4).
- **The arm64 toolchains were native, not emulated**: setup-node used `node/24.19.0/arm64` and
  setup-bun downloaded `bun-windows-aarch64` / `bun-linux-aarch64`. Until rev 4 the suite did
  not assert `process.arch` from inside the artifact, so that run proved the runner's
  architecture, not the artifact's; the suite now asserts both `packaged` and `arch`.
- **Packaging itself is cheap; `npm ci` on Windows is not.** `build:sea` + `test:sea` take
  12–30 s on every OS; `npm ci` takes ~30 s on Linux/macOS and 171–264 s on Windows. Most of
  that is `npm ci` running the install scripts of native addons (kerberos, client-encryption,
  ssh2, cpu-features, os-dns-native, the certificate exporters) that the bundle then discards —
  `--ignore-scripts` removes both the time and the third-party code execution on the machine
  that produces release binaries (§4).
- **Cost, to answer "build complexity on GitHub" with a number:** the 13-job matrix used 27.8
  runner-minutes (Windows 18.2, macOS 5.6, Linux 4.0; the Windows share is almost entirely
  `npm ci`). Free on a public repo; on a private repo at list multipliers (Windows 2×, macOS 10×)
  it is ~96 billed minutes, under a dollar per full run. Not a factor in the decision.
- **What the run does *not* prove:** the artifact always ran with Node on PATH, from inside the
  checkout, with `node_modules` next to it. Anything that resolves modules from disk at runtime
  (§2.3 #2) would pass in CI and fail on a user's machine. The suite must run from an empty
  directory with Node removed from PATH (§2.4).
- Every job carried GitHub's "Node.js 20 is deprecated" annotation for the `@v4` actions; the
  release workflow should use the SHA-pinned v7 actions the rest of the repo already uses.

### 2.3 Findings that change the design (worth reading even if you skip the rest)

Numbering is unchanged from rev 3 so cross-references hold. **Packaging-specific:** #2, #3, #4,
#9, #11 and #14. **Daemon-protocol requirements that packaging merely exposed:** #1, #5, #6,
#7, #8, #10, #12, #13 — these belong in the daemon design doc and will move there; they stay
here so nothing is lost between documents.

1. **The spawn race is real, and packaging exposed it.** With naive "unlink stale socket, then
   bind" logic, 10 concurrent cold clients produced **4 coexisting daemons — but only in the
   packaged build** (slower process startup widened the race window; `node bundle.cjs` always
   passed). Fix: daemons arbitrate via probe-then-bind plus an atomic `mkdir` lock; clients
   never touch the socket file. Whatever daemon library/protocol we pick later, this
   arbitration must be in the first version, and CI must run the concurrency test on the
   packaged artifact — an unpackaged test would have shipped the bug. (The spike's arbitration
   still has holes of its own; see §2.4.) The client side needs the mirror image: today N cold
   clients spawn N ~100 MB daemon processes and let them fight; a client-side spawn lock or
   backoff keeps that to one.
2. **Feature loss in the packaged binary is larger than the externals list, and CI cannot see
   it.** Both bundlers need curated externals: `@mongosh/*` transitively pulls `ssh2` +
   `cpu-features` (native addons, SSH tunnels), `electron` (optional OIDC integration), Babel
   dynamic config probing, plus the driver's 8 optional deps (kerberos, zstd, aws-sdk,
   client-encryption, snappy, socks, gcp-metadata, aws4). Those are lazy at runtime, so marking
   them external works: no SSH tunnels, no kerberos, no CSFLE, no snappy/zstd — documented,
   acceptable for v1. But the bundle **also** contains code the bundler cannot follow:
   - `@mongodb-js/oidc-plugin` loads `open` (browser launch) and `node-fetch` through
     `eval("import(...)")`, and `@mongodb-js/devtools-proxy-support` does the same for
     `node-fetch` and `require.resolve`s `pac-proxy-agent` — so **Entra ID / OIDC browser
     login and PAC/proxy-aware HTTP are dead in the binary when it runs from a clean
     directory, and load whatever the working directory's `node_modules` holds otherwise**
     (#14 — verified with a probe).
   - `system-ca`, `os-dns-native` and the macOS/Windows certificate exporters were bundled as
     their JavaScript wrappers *without* their `.node` files — so the **system CA store and
     native DNS resolution** fall back or fail: TLS-inspecting corporate proxies, private CAs.
   None of this is visible in the spike's tests, and CI ran the binary from inside the checkout
   where `open`, `node-fetch` and the addons exist on disk, so any disk-resolving path passes in
   CI and fails for users. For an Azure product this is the difference between "works in the
   demo" and "works at a customer". Required: a **tool-generated inventory** (esbuild metafile +
   an `eval("import` grep + the list of `.node` dependencies), a decision per item (bundle
   explicitly, replace, sideload, or drop), and a `documentdb doctor`-style **availability probe**
   that exercises each path so the loss is measured, not guessed. Decision §1.1 #6 sets the bar.
3. **Self-spawn works identically in both**: a SEA binary always re-runs its embedded main
   ([nodejs/single-executable#104](https://github.com/nodejs/single-executable/issues/104));
   a bun-compiled binary always re-runs its embedded entry. Since the CLI dispatches on its own
   `daemon` argument, `spawn(process.execPath, ['daemon'], {detached})` is exactly right — but
   it also means the binary can never be used as a general `node` interpreter, and `fork()` of
   helper scripts is off the table. Design daemons/workers as argv modes of the one entry, and
   use `{eval: true}` workers (which is what we tested).
4. **argv: only `argv[0]`/`argv[1]` differ per packaging; user arguments start at index 2
   everywhere.** Measured with a tiny probe binary:

   | Packaging | `process.argv` |
   |---|---|
   | `node main.js …` | `[<node path>, <script path>, …args]` |
   | Node SEA | `[<execPath>, <argv0 as typed>, …args]` |
   | Bun compiled | `["bun", "/$bunfs/root/<name>", …args]` |
   | `bun main.js …` | `[<bun path>, <script path>, …args]` |

   The [SEA docs](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
   say the same ("user-provided arguments are in the `process.argv` array starting from
   index 2"), so `argv.slice(2)` and any standard parser (commander/yargs) work unmodified. The
   real rule is narrower than I first wrote: **never use `argv[1]` to find "the script"** — for
   self-spawn use `process.execPath` plus a packaged check (`node:sea`'s `isSea()`, or Bun's
   `/$bunfs` entry path), which is what the spike does. The spike's "scan argv for a known
   command" workaround is unnecessary and goes away with the other §2.4 cleanups.
5. **The idle timeout must not fire while a request is in flight.** The spike re-arms the
   idle timer at connect and after each response, never during a request, so any request
   longer than the idle window kills the daemon mid-work. Reproduced: with a 1.5 s idle and
   `eval "sleep(3000); 1"` the client ends in `DAEMON_UNREACHABLE`; with the default idle the
   same call succeeds. Trivial to fix (track in-flight count; only arm at zero), but it is a
   *protocol* requirement: the daemon needs request/response ids and an in-flight count from
   day one, and long-running commands (a slow query, a large export) need a streaming or
   keep-alive story rather than a single fixed client timeout.
6. **The client must never re-send a request after it was written — retry connects only.**
   The spike's "spawn and retry" loop re-issues the same command on any failure, including a
   response timeout; in the reproduction above it re-ran the eval on every freshly spawned
   daemon. For a CLI that will execute writes, that violates at-most-once delivery. Split
   "connect" from "send", retry only the former, and keep connect and response timeouts
   separate (today a single ~6 s budget covers both, so any real query over that fails).
7. **The IPC endpoint needs deliberate placement and access control; the daemon holds an
   authenticated connection.** Corrected from rev 2: on Linux, connecting to a Unix socket
   requires *write* permission on the socket file (`unix(7)`), so the spike's `0755` socket is
   **not** connectable by other users — though the same man page says not to rely on that, so
   the fix stands: a per-user `0700` directory and a `0600` socket. The real Linux exposure is
   **availability**: the lock directory and the socket name live in sticky `/tmp` under
   predictable names (sha256 of username, tool, version), a squatter's entry cannot be removed
   by the victim, and the spike swallows that error — every daemon start then fails forever.
   Same family as Windows named-pipe squatting: Node/libuv cannot set a pipe DACL (the default
   grants other non-admin users read-only access, which is acceptable), but the pipe namespace
   is global, so another local user can pre-create the name. Mitigation for both: unpredictable
   per-user directories where the OS gives us one, and a daemon that proves its identity — HMAC
   over a client nonce, keyed from a token file only the owning user can read. Placement must
   also respect #10 below: inside an agent sandbox the only writable temp location may be the
   session's, which the spike's `os.tmpdir()` happens to follow and an `$XDG_RUNTIME_DIR` rule
   would not.
8. **The daemon must not inherit the client's cwd or environment, and upgrades on Windows
   must stop it first.** `lsof` shows the spike's daemon keeps the directory it was launched
   from (Windows cannot delete or eject a directory a process sits in), and it inherits the
   full environment. Spawn with the home directory as cwd and a scrubbed env. A running daemon
   also keeps the `.exe` open, so `install.ps1`/`winget` upgrades must stop daemons before
   replacing the binary, and the endpoint name must be keyed by the *build and channel* (version
   + build id + npm/binary), not just the version string, so a dev build or the npm install never
   attaches to a stale or foreign daemon.
9. **Both runtimes execute code injected through the environment.** Verified on the packaged
   artifacts: `NODE_OPTIONS=--inspect` opened a debugger port on the default SEA build and was
   ignored with `execArgvExtension: "none"` in the SEA config; `BUN_OPTIONS="--preload file.js"`
   executed the file inside the compiled Bun binary, and I found no equivalent switch for Bun.
   Combined with #8, an environment variable set by whatever launches the CLI becomes code
   execution inside the process that holds the credentials. Same trust boundary as the auth
   model's "honest boundary" (same-user), but cheap to close: `execArgvExtension: "none"`, an
   allowlisted environment for the daemon, and strip the Windows signature before injection as
   the SEA docs suggest (the spike does that only on macOS).
10. **Agent-host sandboxes are the environment the daemon actually lives in, and nothing was
    tested there.** Claude Code's sandbox (macOS Seatbelt, Linux/WSL2 bubblewrap; opt-in per
    session or via managed settings, not available on native Windows) is enforced "for every
    Bash command and its child processes": by default only the working directory and a
    **per-session temp directory** are writable and `$TMPDIR` is pointed at it; all network
    egress goes through a proxy with a **domain allowlist that pre-allows nothing**; the optional
    seccomp filter **blocks Unix domain sockets**. Codex and Copilot CLI have sandboxes of their
    own. Consequences, all unverified: the socket must live in the session temp dir (one daemon
    per agent session — acceptable isolation, but one 100 MB process per session); with the
    seccomp filter on there is no IPC at all; the daemon's raw TCP+TLS to the database must be
    allowlisted and may not pass an HTTP proxy at all (the driver's only proxy path is SOCKS,
    which we externalized); and whether a detached child outlives the tool call is undocumented.
    This does not depend on SEA vs Bun, but it decides whether the daemon design serves its
    primary audience. It is the first of the two spikes in §8, and the design needs a defined
    **degraded mode**: if the daemon cannot be spawned or reached, run one-shot with a clear
    structured notice, never fail the command.
11. **The credential store is a packaging problem, and it is where the runner-up is ahead.**
    The auth model resolves named profiles from the OS keychain, silently, from a headless
    daemon. Node has no keychain API: it takes a native addon (`@napi-rs/keyring` or similar)
    that a single-file SEA cannot load from inside the blob — it must ship next to the binary
    and be loaded through an explicit `createRequire` root, since bare resolution never looks
    there (#14) — or shell-outs to `security` / `secret-tool` / PowerShell, or a file store encrypted with a
    key that itself needs the keychain. Bun ships `Bun.secrets` (native, documented as
    experimental). On macOS, keychain item ACLs bind to the **signing identity**: an ad-hoc
    signature is a different identity for every build, so each upgrade re-prompts "wants to
    access…", and a headless daemon in an agent session cannot click. **Developer ID signing is
    therefore needed for credential continuity, independent of Gatekeeper** — which narrows the
    "ship v1 with ad-hoc signing" idea in §5.2 to the execution story only. On Linux the Secret
    Service needs a D-Bus session, absent over SSH, in containers and in CI, so a fallback store
    with an explicit, documented security level is required. This is the second spike in §8;
    its outcome changes the SEA-vs-Bun weighting more than anything else on this page.
12. **One daemon per user is one shared shell context for everyone.** The spike keys the
    daemon by (user, tool, version), and the `x = 41` state is visible to every client — every
    profile, every agent, and a human REPL, in one mutable `vm.Context`. The real daemon must
    isolate **per profile** (a `--profile prod` context never shares state or a connection with
    `--profile dev`) and probably **per client session** (two agents on one machine should not
    see each other's variables), with the read-only scope enforced per context. That is a
    session table inside one daemon, not multiple daemons, but it has to be in the protocol.
13. **Operational basics.** The spike's daemon runs with `stdio: 'ignore'`, so a crash leaves
    no trace. v1 needs a log file under the per-user state directory, a `--foreground` mode for
    debugging, a crash-loop guard on the client side, and a `documentdb daemon status|stop|logs`
    surface. Also: `os.userInfo()` throws for uids without a passwd entry (common in containers);
    key the endpoint by uid with a fallback.
14. **Dynamic imports resolve from the working directory in both packagers — verified, and it
    turns #8 from hygiene into a security requirement.** The cold review of rev 2 claimed this;
    rev 4 reproduces it with a 10-line probe ([`spike/probe/`](./spike/probe/)) built as a SEA
    and as a Bun binary and run from three places on Linux x64 — and pins down the mechanism,
    which is subtler than "cwd":

    | Load path | cwd has `node_modules/probe-pkg` | empty cwd | empty cwd, package next to the binary |
    |---|---|---|---|
    | SEA `require('probe-pkg')` | `ERR_UNKNOWN_BUILTIN_MODULE` | same | same |
    | SEA `eval('import("probe-pkg")')`, **relative** `main` in the SEA config (Node's documented example; the spike's `dist/bundle.cjs`) | **loads the cwd copy** (also from any subdirectory of it: normal walk-up) | `ERR_MODULE_NOT_FOUND` | `ERR_MODULE_NOT_FOUND` |
    | SEA `eval('import("probe-pkg")')`, **absolute** `main` in the SEA config | `ERR_MODULE_NOT_FOUND` | same | same — but **loads a package planted at the build machine's path** (e.g. `/home/runner/work/<repo>/…`), from any cwd |
    | Bun `require` **and** `import()` | **loads the cwd copy** | `MODULE_NOT_FOUND` | `MODULE_NOT_FOUND` |

    So the SEA resolves `import()` relative to the `main` path *as written into the config*: a
    relative path is re-resolved against the runtime cwd; an absolute path freezes the build
    host's directory into the binary, which is public in CI logs and plantable. Neither
    setting is safe on its own. Bun resolves from the cwd regardless.

    Three consequences. (a) An agent that runs `documentdb` inside a checked-out repository
    would have the OIDC/proxy paths in #2 import repository-controlled code into the process
    that holds the credentials — the daemon, if it inherits the client's cwd (#8), or the
    client itself. That is release-blocking, and it is exactly the environment this CLI is
    built for. (b) The "ship the addon next to the binary" option in #11 does not work by
    itself: neither packager consults the binary's directory, so anything sideloaded must be
    loaded through `createRequire(path.dirname(process.execPath) + '/')`, never a bare
    specifier. (c) The esbuild externals (kerberos, snappy, …) are deterministically unavailable
    in the SEA — its `require` only knows builtins and the driver catches the error — but in
    the Bun binary they too would load from cwd. Required: daemon *and* client run from a
    trusted directory; every dynamic import in the #2 inventory is bundled or explicitly rooted
    (a config-level fix does not exist — see the table);
    and the release acceptance suite runs once from a **hostile** directory (a cwd whose
    `node_modules/open` is booby-trapped) and asserts nothing loaded. Explicit roots are also
    the answer for the npm channel, where cwd-relative resolution is Node's default behavior.

### 2.4 Known gaps in the spike itself (not fixed in this revision)

The spike is evidence, not a product. These are the places where it is knowingly wrong, so
that nobody copies them into the real implementation:

- `spike/src/main.ts` — idle timer vs in-flight requests (§2.3 #5); client re-sends after
  failure (§2.3 #6); socket and lock directory not per-user and squattable (§2.3 #7); daemon
  inherits cwd/env (§2.3 #8); one shared context (§2.3 #12); the `KNOWN_COMMANDS` argv scan
  (§2.3 #4); `os.userInfo()` in containers (§2.3 #13); N clients spawn N daemons (§2.3 #1).
- Lock arbitration holes: the stale-lock steal is not atomic (two daemons that both observe a
  stale lock can end up both "holding" it, and the second then unlinks the first's live
  socket); `shutdown()` unlinks the socket path even if another daemon now owns it; a
  non-`EADDRINUSE` listen error exits without releasing the lock; and the client gives up after
  10 s while a stale steal can take 15 s. Fix pattern: pid in the lock + liveness check,
  rename-based steal, compare the socket inode before unlinking.
- `spike/scripts/build-sea.mjs` copies `process.execPath` (§2.1 footnote) — fine for a native
  CI runner with an official Node, wrong everywhere else. No `otool -L`/`ldd` gate.
- **Two driver majors are bundled.** `spike/package.json` pins `mongodb@6`/`bson@6` directly,
  while `@mongosh@5.x` requires `mongodb@7.6`/`bson@7.3`, so the bundle carries both and the
  daemon hands a v6 client to a v7 service provider. The extension resolves a single
  `mongodb@7.2`/`bson@7.2` everywhere and ships older `@mongosh` releases than the spike
  pulled. Align the spike (or better, the real CLI) to the extension's lockfile; cross-version
  BSON `instanceof` failures are a known bug class.
- Test validity (`spike/test/acceptance.mjs`): fixed in rev 4 — the "second invocation attaches
  to the same daemon" check no longer passes vacuously on two undefined pids (it did, observed
  live against a missing binary), and `packaged` and `process.arch` are asserted from inside
  the artifact. Still open: the suite never runs without Node on
  PATH or outside the checkout (§2.2); it never touches the driver's connection path (dns/tls),
  the OIDC/proxy/system-CA paths (§2.3 #2), or a console-close / step-boundary on Windows; and
  the known bugs above should be encoded as expected failures so they cannot be forgotten. A
  real query against the `ghcr.io/documentdb/documentdb/documentdb-local` container on the
  Linux job would close the biggest of these.
- Workflow: actions are pinned by floating tag rather than SHA (the repo convention is SHA +
  Dependabot; GitHub flagged the `@v4` actions as Node 20-based on every job), `npm ci` runs
  native-addon install scripts that are thrown away (§2.2), no `permissions:`,
  `timeout-minutes`, `concurrency` or artifact `retention-days` (13 × ~100 MB per run),
  `bun-version: latest`, Node pinned only to a major (which drifted between 24.18.0 and 24.19.0
  within one run), the SEA job installs the `bun` devDependency it never uses, the Bun
  cross-compile job downloads target runtimes at build time unpinned by hash and omits
  `bun-windows-arm64` and the musl targets, and the cross-built artifacts are never executed.
  All small; listed so the release workflow (§4) does not inherit them.
- Housekeeping: the externals list is duplicated across the two build scripts, and doc 02
  planned `proper-lockfile` + tRPC while the spike uses an `mkdir` lock + newline-delimited
  JSON to keep dependencies at zero. The production choice is still open; the spike's protocol
  is a stand-in, and the arbitration logic ports to either.

### 2.5 Two auth-model claims this work bumped into (notes for your `context/` docs)

Neither is a packaging matter, and both came up in the cold review; I agree with them, so I'd
rather flag them now than have them surface during implementation.

- **"An agent wielding a `--read-only` profile physically cannot write"** (`auth-model.md`) is
  only true when the *stored credential* is read-only on the server. A CLI-side check is
  defense in depth: it has to enumerate every write-shaped path (raw commands, `$out`/`$merge`,
  index and admin commands, any evaluator) and stays one missed path away from wrong. Suggested
  wording: a profile is *server-enforced read-only* when provisioned with a read-only role or
  scoped token, and *best-effort read-only* otherwise — and `login --read-only` should prefer to
  create the former.
- **"TTY present → may prompt the human"** (`execution-modes.md`) is not a safe test for "a
  human is driving": agent hosts allocate pseudo-terminals, and a `/dev/tty` credential prompt
  triggered from an agent's turn is a phishing-shaped flow (repository content → agent runs a
  command that needs an unprovisioned profile → the user sees an unexpected password prompt). An
  explicit agent mode (`--agent` or `DOCUMENTDB_AGENT=1`, set by the Skill) in which the CLI
  never prompts, never opens a browser, and only returns the structured "run `documentdb login
  <name>`" error closes it; the TTY rule then applies only outside that mode.

## 3. Candidate comparison

Every cell is backed by a primary source (linked in §9) or by this spike ("spike").

| Approach | User friction | Node needed | Win x64/arm64 | macOS x64/arm64 | Linux x64/arm64 | Cross-compile | Daemon/IPC packaged | Worker threads | Size | Signing fit | Maintenance risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Node SEA** | one file / `curl \| sh`; nothing to preinstall | No | ✅/✅ | ⚠️ x64 untested upstream (passed once in our CI) / ✅ | ✅/✅ (not Alpine; glibc ≥ 2.28) | Partially² | ✅ **spike** | ✅ eval-mode **spike** | 88–130 MB raw (CI); 43 MB gzip / 29 MB xz | Standard signable binaries; postject step must precede signing; needs Node's JIT entitlements under the hardened runtime; `NODE_OPTIONS` injection unless `execArgvExtension: "none"` | Experimental (Stability 1.1) but first-party; v25.5+ `--build-sea` shows active investment; postject unmaintained (replaced upstream) |
| **Bun compile** | same as SEA | No | ✅/✅ | ✅/✅ | ✅/✅ + musl | ✅ all 8 targets from one runner (downloads target runtimes at build time) | ✅ **spike** | ✅ eval-mode **spike**; file-based workers need extra entrypoints | 70–94 MB raw (CI); 37 MB gzip / 28 MB xz | macOS documented (JIT entitlements); Windows Authenticode fixed v1.2.23; Windows metadata flags unavailable when cross-compiling; notarization unverified; `BUN_OPTIONS` injection with no switch found | Single vendor; Zig→Rust rewrite shipped in 1.4 (Aug 20, 2026); three driver-related bugs reported and **fixed** in 2026 (#24118 Jan, #24374 Mar, #32501 Jun) — the class recurs, the fixes were fast |
| **@yao-pkg/pkg** | same as SEA | No | ✅ | ✅ | ✅ | ✅ via prebuilt patched Node | Likely (not spiked) | V8 snapshot quirks historically | ~90+ MB | Third-party patched Node binaries — awkward provenance story for a Microsoft-signed release | Community fork of an archived Vercel project (active: v6.22 as of Aug 2026) |
| **Deno compile** | same as SEA | No | ✅ | ✅ | ✅ | ✅ | Untested | — | ~70+ MB | OK | **Disqualifying risk (untested):** `node:vm` support is the historic gap, and the entire `@mongosh` eval pipeline runs on `vm` — I chose not to spend a spike on it; say so if you disagree |
| **npm i -g** (baseline) | needs Node ≥ 22 + working PATH; version drift | **Yes** | Node's matrix | Node's matrix | Node's matrix | n/a | ✅ **spike** (baseline) | ✅ | 10 MB package | npm provenance (repo already uses OIDC trusted publishing) | Lowest — but agents cannot self-serve past a missing/old Node |
| **npx** | needs Node; first-run download; cache and version ambiguity | **Yes** | 〃 | 〃 | 〃 | n/a | ✅ | ✅ | cache-dependent | 〃 | Worst fit for agents |

² SEA cannot cross-compile in the classic sense, but the **blob is platform-portable** when
`useSnapshot`/`useCodeCache` are off — you inject it into a downloaded target-platform Node
binary ([docs](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)).
We don't need this today: GitHub has native runners for all six targets, which also gives us
run-the-artifact test evidence per target. It becomes relevant for macOS x64 when the Intel
runner image retires (§8).

**Credential store, per candidate** (the axis the table above does not show): Bun has
`Bun.secrets`, a native keychain API (experimental). Node SEA has nothing built in; the options
are a sideloaded native addon next to the binary (breaks the single-file promise, works),
shell-outs to the OS tools (`security`, `secret-tool`, PowerShell/DPAPI — no native code, more
edge cases), or an encrypted file store as the documented fallback. npm gets the addon for free.
See §2.3 #11 and the spike in §8.

### What comparable tools actually ship (your item 5)

- **Claude Code** — TypeScript, shipped as a **Bun single-file executable** via
  `curl -fsSL claude.ai/install.sh | bash` (≈100 MB) with background auto-update, npm kept as
  a secondary channel. The strongest production datapoint for our runner-up, and aimed at
  exactly our agent audience. It does not use the MongoDB driver, so it does not retire the
  driver-specific Bun risks — but it does retire "nobody ships a Bun-compiled CLI at scale".
- **mongosh** — real Node embedded via boxednode (compile Node from source with the app
  inside): "SEA done heavyweight", hours-long builds per target. Same fidelity instinct as
  SEA, far more CI cost.
- **pnpm** — ships standalone binaries built (as far as I can tell) with `@yao-pkg/pkg`;
  worth confirming if pkg ever comes back on the table.
- **wrangler, vercel, nx, aws-cdk, firebase-tools** — npm-first; firebase-tools additionally
  offers pkg-built standalone binaries. `gh` is Go.

### Why SEA over Bun as primary

Both passed everything we threw at them, and Bun's DX is genuinely better (no esbuild step, no
postject, cross-compile, smaller on disk, a native secrets API). "Faster" dropped off that list
in rev 4: with the SEA code cache on, SEA starts in 66 ms to Bun's 139 ms on Linux x64 (§2.1). SEA wins on one axis that
dominates for a **database** CLI: **engine fidelity**. To be precise about what that means: the
SEA embeds the official Node 24 build — the same V8, libuv, OpenSSL and `net`/`tls` stack the
MongoDB driver and `@mongosh` are tested against in their own CI — while the extension itself
runs on Electron's Node and pins 22.18 in `.nvmrc`, so "identical to the extension" would be an
overstatement; "the runtime the driver is built for" is the claim. With Bun we would be running
`@mongosh` on a runtime reimplementation with no public precedent I could find. Rev 2 cited
three Bun issues on our exact hot paths as open; **all three are closed** (idle replica-set
memory growth, fixed 2026-01-19; TLS handshake failure against certain Atlas clusters, fixed
2026-03-01; a bson import breakage, fixed 2026-06-19). The corrected argument is about the
*class* and *cadence*: driver-level bugs on Bun keep being found and are fixed within weeks, and
Bun 1.4 (2026-08-20) is the first production release of a full Rust rewrite, so the near-term
bug surface is new again. Each of those is fixable; together they mean tracking a fast-moving
runtime for the lifetime of the product. Keep Bun as the documented runner-up; the spike keeps
both build paths alive so the decision is reversible with evidence.

What would flip this recommendation: the credential-store spike (§8) showing that the SEA side
has no acceptable keychain path while `Bun.secrets` just works, or the sandbox spike showing a
Bun-only advantage there. Neither is expected, both are cheap to find out.

SEA's honest weaknesses, so they're on the table:
- Officially experimental (Stability 1.1 in Node 22/24/26 docs) — mitigated by the trajectory:
  v25.5.0 (2026-01-26) added first-party one-step `--build-sea`
  ([release](https://nodejs.org/en/blog/release/v25.5.0),
  [background](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/)),
  which lands in LTS with Node 26 (Oct 2026). Our pipeline should switch to it then and drop
  postject (unmaintained: last release 2023).
- macOS **x64** is explicitly "not currently supported" and skipped in Node's own SEA CI
  ([docs](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)) — our
  matrix runs it as the canary; if it proves flaky, macOS x64 falls back to the npm channel
  (a shrinking user base) or to a pkg-built artifact for that one target.
- Binary is 88–130 MB vs Bun's 70–94 MB raw (CI-measured; on Windows they are nearly equal).
  Compressed, which is what a user downloads, the gap is 43 vs 37 MB (gzip) or 29 vs 28 MB (xz),
  measured in §2.1. Real on disk, immaterial on the wire.
- Official Node binaries need glibc ≥ 2.28 and are not built for Alpine/musl; older distros and
  Alpine images use the npm channel.
- Under the macOS hardened runtime the SEA needs Node's own entitlements (`allow-jit`,
  `allow-unsigned-executable-memory`, `disable-library-validation`; see
  `tools/osx-entitlements.plist` in nodejs/node), which `codesign --remove-signature` throws
  away — the signing step must re-apply them. Rev 2 attributed the entitlement requirement to
  Bun only; both need it, and the reviewer's Bun binary ran under the hardened runtime without.

## 4. Build & release pipeline (design)

The spike workflow is the skeleton; the release version adds provenance, signing, packaging and
release publishing. Two variants, selected by decision §1.1 #1:

```
tag v0.x.y
  └─ release.yml (GitHub Actions, in the CLI's org)
       ├─ build (matrix: 6 native runners)
       │    linux-x64, linux-arm64 (ubuntu-latest, ubuntu-24.04-arm)
       │    windows-x64, windows-arm64 (windows-latest, windows-11-arm)
       │    macos-arm64, macos-x64 (macos-15, macos-15-intel — until Aug 2027, then cross-build)
       │    steps: npm ci --ignore-scripts → esbuild (two bundles: thin client + daemon runtime)
       │           → feature inventory (metafile + eval-import grep + .node list; fails on new
       │             unknowns) → download official Node tarball, verify SHASUMS256 → SEA blob
       │           → inject → otool -L / ldd gate → strip/ad-hoc sign (with Node's entitlements)
       │           → acceptance suite from an EMPTY dir with Node removed from PATH
       │             (asserts packaged, arch, feature availability) and once from a HOSTILE
       │             dir (booby-trapped node_modules; asserts nothing loaded, §2.3 #14)
       │           → upload unsigned artifact
       │
       ├─ Variant A — DocumentDB-project identity, GitHub-only:
       │    ├─ sign-windows   (Authenticode via Azure Trusted Signing or an HSM-backed cert; §5)
       │    ├─ sign-macos     (Developer ID + entitlements + notarytool; staple for .pkg; §5)
       │    ├─ provenance     (SBOM + third-party notices, GitHub artifact attestation / SLSA,
       │    │                  sha256sums.txt)
       │    └─ github-release (per-target archives; skills embedded in the binary as assets)
       │
       └─ Variant B — Microsoft identity:
            └─ the GitHub matrix stays the test gate; an Azure DevOps OneBranch pipeline
               (same shape as .azure-pipelines/build.yml + release.yml today) builds, signs via
               ESRP (Authenticode, macOS sign+notarize, Linux), and publishes the release.
               Expect the BUILD to move there, not just signing: OneBranch Official brings
               CodeQL, CredScan, PoliCheck, BinSkim, Component Governance and AntiMalware gates
               that a 100 MB binary embedding Node plus ~425 packages must pass, and those run
               on what OneBranch built. Treat "ADO signs a GitHub-built binary" as the exception
               to argue for, not the default.

       ├─ npm-publish    (the same daemon-runtime bundle as @documentdb-js/cli with the native
       │                  addons as optionalDependencies; OIDC trusted publishing — infra already
       │                  proven by npm-publish-documentdb-js.yml; scope per §1.1 #4)
       └─ channel-updates (later: Homebrew tap formula bump, winget manifest PR)
```

Notes:
- **Native runners, not cross-compilation**, for both build and test: every claimed target
  executes its own artifact in CI ("do not claim an OS works until the artifact executes
  there"). All six labels are GitHub-hosted and free for public repos; `macos-15-intel` is the
  last Intel image and is available until **August 2027**
  ([actions/runner-images#13045](https://github.com/actions/runner-images/issues/13045)).
  Cross-built artifacts (Bun today, SEA for macOS x64 later) are executed on their target
  runner, not size-compared.
- **Embedded Node provenance.** We re-sign Node under our identity, so the pipeline downloads
  the official tarball for the exact pinned version, verifies `SHASUMS256.txt` (and its
  signature where the tooling allows), and never uses a runner's or a developer's `node`.
- The **packaged acceptance test runs in the release path**, not just research CI — finding
  #1 in §2.3 is the proof of why — and it runs from a clean directory with no Node on PATH,
  because §2.3 #2 is the proof of why *that* matters.
- Node version is pinned to an exact version via `node-version-file`, and the SEA blob must be
  generated by the exact Node version of the copied binary (version mixing crashes:
  [nodejs/node#60327](https://github.com/nodejs/node/issues/60327)).
- **Two bundles, one binary.** The client path (argument parsing, IPC, output formatting) is a
  thin entry; the daemon runtime (`@mongosh`, driver) is a second bundle embedded as a SEA
  asset / Bun asset and loaded only in daemon mode. That removes the 10 MB parse from every
  agent invocation; `useCodeCache: true` (safe with native builds) is the mitigation until then.
- SEA config: `useCodeCache: true` (2.5× faster client start, §2.1), `execArgvExtension: "none"`
  (§2.3 #9), `disableExperimentalSEAWarning: true`. Daemon and client run from a trusted
  directory with an allowlisted environment (§2.3 #8, #14); anything sideloaded is loaded via an
  explicit `createRequire` root, never a bare specifier.
- Workflow hygiene the spike skipped (§2.4): SHA-pinned actions, least-privilege
  `permissions:`, `timeout-minutes`, `concurrency`, artifact `retention-days`, pinned Bun
  version and pinned/cached target runtimes, `npm ci --ignore-scripts`.
- Skills (`SKILL.md`) ship **inside** the binary as embedded assets from day one, so the
  artifact stays a single file and is self-describing for agents; `documentdb skills install`
  writes them into agent-host directories, and `documentdb skills show` prints them. How skills
  reach agents beyond that is an open product question, not blocked by packaging.

## 5. Signing & notarization — the honest part

### 5.1 First the identity question

Everything below runs mechanically on GitHub Actions. What I cannot decide is **which legal
identity the binaries carry**, and that decides where signing — and possibly the build — runs:

- **Microsoft identity.** This repo already ships the extension through Azure DevOps:
  CONTRIBUTING §7.7 ("Run the internal Azure DevOps build pipeline. It produces a signed
  `.vsix`"), `.azure-pipelines/build.yml` (OneBranch Official, `linuxEsrpSigning: true`) and
  `.azure-pipelines/release-npm-packages.yml` (ESRP Release). I would expect a Microsoft-signed
  CLI to be held to the same path — ESRP through OneBranch, with OneBranch's SDL gates running
  on the build — rather than to GitHub-held certificates. That is the one plausible thing that
  forces us off a GitHub-only pipeline, and it is a policy fact I cannot spike; I can only ask.
  Variant B in §4 is the shape if so.
- **DocumentDB-project identity.** DocumentDB is a Linux Foundation project, so this branch
  presumes a legal entity that can enroll with Apple and pass the identity validation that
  Azure Trusted Signing (or any CA) requires — the LF, or Microsoft acting for the project.
  Once that exists, GitHub-held secrets are the normal way open-source projects do this, and
  Variant A applies. Azure Trusted Signing is the obvious Windows option (cloud HSM, `signtool`
  integration, usable from Actions with OIDC); SignPath Foundation's free signing for OSS
  projects is worth checking as an alternative.

### 5.2 The walls are narrower than they look — for execution, not for credentials

- **macOS.** Gatekeeper only evaluates files carrying the quarantine attribute, which browsers
  set and `curl` does not. So a `curl | sh`-installed binary (or a Homebrew formula's binary)
  *executes* today with just an **ad-hoc signature**, which Apple Silicon requires and the spike
  already applies. Developer ID + notarization matter for browser downloads, `.pkg`/`.dmg`,
  casks, and MDM-managed fleets. **But** (§2.3 #11) keychain item ACLs are bound to the
  signing identity, and an ad-hoc identity changes with every build, so profile credentials
  would re-prompt after each upgrade and a headless daemon cannot answer. **Developer ID is
  therefore a v1 requirement on macOS as soon as the keychain-backed auth model ships**, not a
  later polish item. Standalone Mach-O binaries cannot be stapled; Gatekeeper fetches the ticket
  online, which is fine for CLI users, or we ship a `.pkg` later. Pipeline: import cert into a
  temporary keychain → `codesign` with hardened runtime + Node's entitlements + timestamp →
  `xcrun notarytool submit --wait` → staple (for `.pkg`). Runs on a `macos-*` runner; the spike
  already does the remove-signature → inject → re-sign dance that a real identity slots into.
- **Windows.** SmartScreen's "Windows protected your PC" prompt is an Explorer/ShellExecute
  feature for mark-of-the-web files; a console launch of `documentdb.exe` does not show it.
  But PowerShell downloads *do* carry mark-of-the-web, Defender's reputation heuristics *do*
  flag unsigned low-prevalence 100 MB executables (and EDR products notice a hidden detached
  process opening a named pipe), and WDAC/AppLocker/Intune policies require a signature
  regardless. So a real Authenticode signature is still needed for a credible product — it is
  just not what blocks the first install-script release.
- **Linux.** No signing wall; checksums + GitHub artifact attestations cover integrity. A
  checksum served from the same origin as the binary proves nothing on its own, but the install
  script cannot require `gh attestation verify` either — a tool whose point is zero prerequisites
  cannot need another CLI to install. So: the script pins the release version and verifies
  `sha256sums.txt`; the checksum file itself carries a GitHub artifact attestation; and
  `gh attestation verify` (or a cosign bundle) is the documented, optional stronger check, the
  norm for LF projects.

**Net:** the install-script channel can *execute* before any certificate exists, which
decouples the first packaging release from procurement; the **credential store cannot** on
macOS, so certificate procurement sits on the v1 critical path after all. **Recommended next
step:** decide §1.1 #1; I write the complete signing workflow for that variant with placeholder
secrets (or, for Variant B, a OneBranch YAML modelled on the existing pipelines), and we file the
credential requests now. If policy blocks GitHub-held signing credentials, *that* is the finding
that changes the pipeline — and it is isolated to exactly two secrets.

## 6. Install & update channels

Launch (cheap, all GitHub-native):
1. **GitHub Releases** with per-target archives + `sha256sums.txt` + attestations (the
   substrate for everything else).
2. **Install scripts**: `curl -fsSL …/install.sh | sh` and an `irm …/install.ps1 | iex`
   PowerShell equivalent — detect OS/arch, download a pinned version, verify the sha256
   (attestation verification is optional and `gh`-based, §5.2), place on PATH, and
   **stop any running daemon of the previous version first** (Windows cannot replace a running
   `.exe`; §2.3 #8). This is what gives the "one-line install" your doc asks for, and agents
   can run it too. Enterprise reality check: many customers block `curl | sh` / `irm | iex`
   by policy and expect winget/MSI, Homebrew, or a signed installer for a Microsoft-branded
   tool, and Defender's first-run scan of a 100 MB executable adds seconds to the first call —
   so the "later" channels below are not optional for the enterprise audience, only deferred.
3. **`npm i -g @documentdb-js/cli`** — the daemon-runtime bundle with the native addons as
   `optionalDependencies`, near-zero marginal cost, uses the org's existing OIDC trusted
   publishing. Serves Node-havers and constrained environments (Alpine, old glibc, sandboxes
   where a 100 MB download is unwelcome). Without the `optionalDependencies` declaration the npm
   channel loses exactly the same features as the binary.

Later (post-validation, each a small PR-automation job):
4. **Homebrew tap** under whichever org owns the CLI — formula bump automated in release.yml.
5. **winget** manifest (needs the signed Windows binary first) and optionally **Scoop**; an
   MSI if enterprise feedback asks for it.

**Auto-update: explicitly deferred.** It drags in channel management, rollback, integrity, and
daemon/client version-skew handling. Ship `documentdb --version` + an update *check*
(notify-only, **never on stdout**, suppressed under `--format json`, so agents' JSON parsing is
never corrupted) at most; the daemon protocol carries client/server version fields from day one
so a later updater has something to negotiate with, and the endpoint name is keyed by build and
channel so a new client never attaches to an old daemon and the npm and binary installs never
share one.

## 7. Where your no-Node/no-npx preference costs us

You asked for this honestly, so: the preference is **worth keeping**, and here's its real price.

1. **~9–13× artifact size** (88–130 MB vs a 10 MB npm package, CI-measured). Cost is
   bandwidth/disk, not UX — except inside agent sandboxes and on metered runners, where a
   100 MB per-session download is felt.
2. **A 6-way native build matrix + signing pipeline** instead of one `npm publish`. The spike
   shows this is a few hundred lines of workflow, not a project. Ongoing cost: pinned-Node
   bumps, occasional packager churn (postject → `--build-sea` when Node 26 is LTS), and one
   dated migration: macOS x64 moves to a cross-built blob (or to npm) when the Intel runner
   image retires in August 2027.
3. **Feature loss that has to be engineered back** — §2.3 #2. The optional native features
   (SSH tunnels, kerberos, CSFLE, snappy/zstd) are a documented v1 gap; the `eval`-loaded ones
   (Entra/OIDC login, proxy support, system CA) are launch requirements that need explicit
   bundling or replacement work. The npm channel keeps all of them via `optionalDependencies`,
   which is another reason to ship it in parallel.
4. **The credential store becomes a packaging problem** — §2.3 #11. With npm, `@napi-rs/keyring`
   is one dependency; with a single file it is a sideloaded addon, shell-outs, or a fallback
   store, plus Developer ID signing on the critical path.
5. **Signing credentials become our problem.** With npm-only distribution, npm provenance was
   enough. Single binaries put us in the Gatekeeper/SmartScreen/keychain-ACL world — that's the
   §5 work, and under the Microsoft identity it likely means an Azure DevOps leg after all.
6. **postject/SEA experimental churn** until Node 26 LTS makes `--build-sea` boring.
7. **Platform floors:** no Alpine/musl and glibc ≥ 2.28 for the binary; npm covers the rest.

What we get for that price: a `curl | sh`-able, agent-friendly, Go-like install with no runtime
prerequisite, on all six targets — which is the product thesis. Verdict: pay it, and hedge by
shipping the npm channel alongside.

## 8. Risks, open items, and the next two spikes

| Risk | Severity | Mitigation |
|---|---|---|
| Daemon does not work inside agent-host sandboxes (session temp dir, proxy allowlist, Unix sockets blocked, lifetime) | **High — unknown** | Spike A below; defined degraded one-shot mode; endpoint placement follows the session temp dir (§2.3 #10) |
| Credential store unreachable from a single-file binary, or re-prompting after each upgrade on macOS | **High — unknown** | Spike B below; Developer ID on the v1 critical path (§5.2); documented fallback store for headless Linux (§2.3 #11) |
| Silent feature loss incl. Entra/OIDC login and proxy/system-CA support | **High until inventoried** | Tool-generated inventory + availability probe + clean-environment test in the release path (§2.3 #2, §4); decision §1.1 #6 |
| Dynamic imports resolve from the working directory: repository-controlled code inside the credential-holding process | **High — verified** (§2.3 #14) | Trusted cwd for daemon and client; explicit `createRequire` roots for anything sideloaded; hostile-directory run in the release acceptance suite (§4) |
| Microsoft-identity release requires ESRP/OneBranch, including the build | **High** (pipeline-shaping) | Decide §1.1 #1 early; Variant B in §4 keeps GitHub as the test gate either way |
| IPC endpoint squatting (`/tmp` on Linux, global pipe namespace on Windows) | Medium; v1 requirement | Per-user `0700` runtime dir + `0600` socket + per-user lock; daemon proves identity to clients (§2.3 #7) |
| Code injection via `NODE_OPTIONS` / `BUN_OPTIONS` into the credential-holding daemon | Medium | `execArgvExtension: "none"`, allowlisted daemon environment (§2.3 #9) |
| Idle timeout / at-most-once / timeout bugs in the daemon protocol | Medium (design requirement) | In-flight counter, retry-connect-only, separate timeouts, request ids (§2.3 #5–6) |
| One shared shell context across profiles and agents | Medium (design requirement) | Per-profile and per-client-session contexts inside one daemon (§2.3 #12) |
| Release binary built from a non-official or dynamically linked Node | Medium | Download + verify official tarball; `otool -L`/`ldd` gate (§2.1, §4) |
| Build-host supply chain (install scripts of discarded addons; runtime downloads at build time) | Medium | `npm ci --ignore-scripts`; pinned/cached runtimes; SBOM + attestations (§4) |
| SEA experimental-status churn | Medium | Pin Node exactly; migrate to `--build-sea` at Node 26 LTS; Bun path kept warm as fallback |
| macOS x64: untested upstream **and** its runner retires Aug 2027 | Medium (dated) | CI matrix is the canary (green on 2026-09-01); then cross-build the portable blob into darwin-x64 Node and test under Rosetta, or drop to npm/pkg for that target |
| Bundling two driver majors (`mongodb@6` + `@7`) | Medium (spike-only today) | Align to the extension's lockfile; add a duplicate-package check to the bundle step (§2.4) |
| `@mongosh` bundling regressions on dependency bumps | Medium | The packaged acceptance test in CI is the regression gate (it already caught the spawn race) |
| Daemon/client version skew after binary upgrade; npm and binary channels sharing a daemon | Known open | Build- and channel-keyed endpoint + protocol version fields from day one; installer stops old daemons |
| Unix socket path length limits (~104 chars) | Low | Short hashed names in a short per-user directory |
| CI evidence from the wrong org | Low, but real | Re-run the matrix in the CLI's future repo (§1.1 #2) |

**The next two spikes**, in this order, because their outcomes can change the recommendation
and everything else on this page cannot:

- **Spike A — the daemon inside agent sandboxes.** Run the packaged acceptance suite from a
  Claude Code session with the sandbox on (macOS Seatbelt; Linux bubblewrap with and without
  the seccomp filter) and from Copilot CLI: does the daemon start, where does its socket land,
  does it survive the end of the tool call, is it reachable from the next call, and can it
  reach a database host through the proxy allowlist? Record the degraded-mode behavior we want
  for each failure.
- **Spike B — the credential store from a packaged binary.** Write and read a secret,
  headless, from (a) the SEA with a sideloaded `@napi-rs/keyring`, (b) the SEA via OS-tool
  shell-outs, (c) the Bun binary via `Bun.secrets`; repeat after re-signing the binary (ad-hoc
  and Developer ID) to observe the macOS ACL prompt; repeat on Linux without a Secret Service.
  Outcome decides the credential-store design, the v1 signing requirement, and possibly the
  packager.

Other open items before this is "done" by my own definition: the feature inventory and
availability probe (§2.3 #2); the signing workflow with placeholder secrets for the chosen
variant (§5); the install-script prototype with daemon-stop (§6); the spike cleanups in §2.4
folded into whatever becomes the real daemon; the clean-environment and hostile-directory
runs, SHA-pinned actions and an exact Node pin in the workflow.

Branch hygiene, for the record: `cli-research` is a research branch, not a merge candidate.
The folder is excluded from the extension's root ESLint, `tsc` and `.vscodeignore` so the
extension's CI and package are untouched; longer term the spike moves to the CLI's own repo.

## 9. Appendix — key verified sources

- Node SEA docs (v24: stability 1.1; tested platforms — macOS arm64 only, no Alpine/s390x;
  argv from index 2; `execArgv`/`execArgvExtension`; signature removal; cross-platform blob
  note): [v24 docs](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
- `--build-sea` one-step build (v25.5.0, 2026-01-26):
  [release notes](https://nodejs.org/en/blog/release/v25.5.0),
  [nodejs/node#61167](https://github.com/nodejs/node/pull/61167),
  [Joyee Cheung's write-up](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/)
- SEA self-spawn semantics: [nodejs/single-executable#104](https://github.com/nodejs/single-executable/issues/104);
  Windows cluster argv bug: [nodejs/node#62776](https://github.com/nodejs/node/issues/62776)
- Node's macOS signing entitlements: [`tools/osx-entitlements.plist`](https://github.com/nodejs/node/blob/main/tools/osx-entitlements.plist)
- Node binaries: [nodejs.org/dist/v24.20.0](https://nodejs.org/dist/v24.20.0/) (2026-08-26;
  listing shows compressed sizes only)
- Bun executables (targets incl. `bun-windows-arm64` and musl; codesign/entitlements; workers;
  Windows flags not available when cross-compiling): [docs](https://bun.com/docs/bundler/executables);
  Bun 1.4 (Rust rewrite, 2026-08-20): [blog](https://bun.com/blog/bun-v1.4);
  Node-compat page: [docs](https://bun.com/docs/runtime/nodejs-compat);
  `Bun.secrets`: [docs](https://bun.com/docs/runtime/secrets)
- Bun named pipes: raw `net` works, HTTP-over-pipe still open
  ([#15350](https://github.com/oven-sh/bun/issues/15350)); compiled argv shape
  ([#22157](https://github.com/oven-sh/bun/issues/22157)); Windows Authenticode fix in 1.2.23
  ([#20109](https://github.com/oven-sh/bun/issues/20109)); macOS codesign regression 1.3.12
  ([#29120](https://github.com/oven-sh/bun/issues/29120))
- Bun × MongoDB driver, all **closed**: idle replica-set memory
  [#24118](https://github.com/oven-sh/bun/issues/24118) (closed 2026-01-19), TLS
  [#24374](https://github.com/oven-sh/bun/issues/24374) (closed 2026-03-01), bson/`node:v8`
  [#32501](https://github.com/oven-sh/bun/issues/32501) (closed 2026-06-19)
- Claude Code sandbox (session temp dir and `$TMPDIR`, proxy + domain allowlist, seccomp
  Unix-socket blocking, child processes, supported platforms):
  [docs](https://code.claude.com/docs/en/sandboxing)
- Unix socket permissions (connect requires write permission; portability caveat):
  [`unix(7)`](https://man7.org/linux/man-pages/man7/unix.7.html)
- GitHub runners: `macos-15-intel` is the last Intel image, available until Aug 2027
  ([actions/runner-images#13045](https://github.com/actions/runner-images/issues/13045),
  [changelog](https://github.blog/changelog/2025-07-11-upcoming-changes-to-macos-hosted-runners-macos-latest-migration-and-xcode-support-policy-updates/))
- Claude Code as a Bun single-file executable:
  [announcement](https://x.com/jarredsumner/status/1943492457506697482),
  [install docs](https://code.claude.com/docs/en/setup)
- `@yao-pkg/pkg` (maintained fork): [npm](https://www.npmjs.com/package/@yao-pkg/pkg)
- mongosh's own binary uses boxednode (real Node), not a packager:
  [mongodb-js/boxednode](https://github.com/mongodb-js/boxednode)
- This repo's existing signed-release path: `CONTRIBUTING.md` §7.7–7.9,
  `.azure-pipelines/build.yml`, `.azure-pipelines/release.yml`,
  `.azure-pipelines/release-npm-packages.yml`; npm OIDC publishing:
  `.github/workflows/npm-publish-documentdb-js.yml`
- macOS 26 runner images: arm64 GA ([changelog](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/));
  Intel only as the beta large runner ([actions/runner-images#13637](https://github.com/actions/runner-images/issues/13637))
- Node 26.0.0 (2026-05-05; LTS October 2026): [release](https://nodejs.org/en/blog/release/v26.0.0)
- Working-directory resolution probe (rev 4, Linux x64): [`spike/probe/`](./spike/probe/)
- CI evidence for this document: [run 33568213084](https://github.com/microsoft/vscode-documentdb/actions/runs/33568213084)
  on `cli-research` (2026-09-01), 13/13 jobs green; per-target artifacts attached to the run

## 10. Revision notes

**Rev 4 (2026-09-03)** — after re-verifying the rev 3 review against this machine and the repo:
- Verified and adopted: dynamic imports resolve from the working directory in both packagers —
  for the SEA, precisely: relative to the SEA config's `main` path, re-resolved against the
  runtime cwd when relative and frozen to the build host's path when absolute (new §2.3 #14,
  probe in `spike/probe/`); the installer cannot depend on `gh` (§5.2, §6); the
  code cache erases Bun's startup lead and compression erases most of its size lead (§2.1, §3).
- Added: a map from doc 03's questions to sections (§1.2); CI runner-minutes (§2.2); a plain
  statement that `eval` is the spike's vehicle, not the agent surface (§2); a packaging-vs-daemon
  reading guide for §2.3; two auth-model notes for the context docs (§2.5); a Linux x64 local run.
- Not adopted: the review's `macos-26-intel` runner — no such label exists (§1.1 #3).
- Spike: the acceptance suite now fails on undefined pids and asserts `packaged` and `arch`.

**Rev 3 (2026-09-01)** — after an independent cold review of rev 2 by a reviewer with no prior
context; everything adopted was re-verified on this machine:
- Corrected: the three Bun driver issues are closed, not open (§3); a `0755` Unix socket is not
  connectable by other users on Linux — the risk is squatting (§2.3 #7); the hardened-runtime
  entitlement requirement applies to SEA, not only Bun (§3); "same Node as the extension" was
  overstated (§3); the local 71 MB SEA is a dynamically linked Homebrew build (§2.1).
- Added: agent-host sandboxes as a first-class requirement and spike (§2.3 #10, §8); the
  credential store × packaging × signing-identity problem and spike (§2.3 #11, §5.2, §8); the
  fuller feature-loss inventory including Entra/OIDC and proxy/system-CA paths (§2.3 #2, §1.1
  #6); `BUN_OPTIONS`/`NODE_OPTIONS` injection (§2.3 #9); per-profile/per-session isolation
  (§2.3 #12); operational basics (§2.3 #13); provenance of the embedded Node, `--ignore-scripts`,
  SBOM, attestations, thin-client/daemon bundle split, skills as embedded assets (§4); Variant B
  moving the build to OneBranch (§4, §5.1); the Linux Foundation legal-entity question and
  cost dimension in §1.1; enterprise install realities (§6); test-validity gaps (§2.4).
- Where I differ from the reviewer: I keep Deno unspiked (stated as untested rather than
  disproven), and I read the per-session temp directory inside sandboxes as acceptable
  isolation rather than only as a constraint.

**Rev 2 (2026-09-01)** — folded in the first review and the six-target CI run.
