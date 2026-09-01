# Packaging & Release Design — response to `03-where-id-love-your-help.md`

**Author:** Guanzhou Song · **Date:** 2026-09-01 (rev 2) · **Status:** draft for review
**Evidence:** working spike in [`spike/`](./spike/) + CI matrix in
[`.github/workflows/cli-packaging-spike.yml`](../.github/workflows/cli-packaging-spike.yml)
**Verified locally:** macOS arm64 (all acceptance checks green for both finalists, plus the
unpackaged `node` baseline). **CI matrix:** see §2.2 for the per-target results of the run
triggered by this push.

---

## 1. TL;DR — recommendation

> **Primary: Node SEA** (Single Executable Applications) built per-target on GitHub's native
> runners, bundled with esbuild.
> **Runner-up: Bun `build --compile`** — better ergonomics and cross-compile, held back by
> runtime-substitution risk on exactly our stack (MongoDB driver TLS/memory issues; I found no
> public report of `@mongosh` running on Bun before this spike).
> **Secondary channel regardless of primary: `npm i -g`** — nearly free to ship alongside, and
> the right answer for users/agents that already live in a Node toolchain.

The no-Node/no-`npx` preference is **achievable at reasonable cost**. The make-or-break
requirement — a packaged binary that spawns a detached copy of itself, binds a Unix
socket/named pipe, serves a second invocation, and runs the real `@documentdb-js/shell-runtime`
(`@mongosh/*` + driver + BSON + `node:vm`) — **passes for both finalists** on macOS arm64 (§2.1);
the six-target CI matrix is the evidence for the other platforms (§2.2).

Two things changed my view while writing this up, and they are the parts I most want your read on:

1. **Signing is a *who*, not a *how*, question.** Mechanically everything runs on GitHub
   Actions. But this repo already ships the extension through Azure DevOps + OneBranch + ESRP
   signing, and if the CLI ships under the *Microsoft* identity, that is the path I would
   expect to be required — which is exactly the "forces us off GitHub" case you asked me to
   flag. If it ships under the *DocumentDB org* identity, a GitHub-only pipeline with
   org-held certificates is normal. §5 lays out both branches; §1.1 asks for the decision.
2. **The spike exposed daemon-protocol requirements that are independent of packaging**
   (spawn-race arbitration, idle-timeout vs in-flight requests, at-most-once delivery, IPC
   endpoint permissions). None of them changes the packaging recommendation, but all of them
   belong in the first version of the real daemon. §2.3 and §2.4 list them.

### 1.1 Decisions I need from you

| # | Decision | Why it matters | My default if I hear nothing |
|---|---|---|---|
| 1 | **Which legal identity signs the binaries** — Microsoft (ESRP) or the DocumentDB org (its own Apple Developer ID / Windows identity)? | Decides whether signing lives on GitHub or on OneBranch/ADO (§5) | Design for both; build the GitHub path first with placeholder secrets |
| 2 | **Which GitHub org/repo hosts the CLI** (and therefore where the CI matrix must be proven) | Runner labels, quotas, and allowed-actions policy differ per org; a green matrix in `microsoft/vscode-documentdb` proves nothing about the DocumentDB org | Move the spike to the CLI's future repo as its first commit |
| 3 | **v1 target list** — is macOS x64 in? | The last Intel runner image (`macos-15-intel`) retires **August 2027**; SEA on macOS x64 is untested upstream | Ship it via CI while the runner exists; fall back to npm for that target |
| 4 | **npm scope** — `@documentdb/cli`, `@documentdb-js/cli`, or something else? | Existing packages use `@documentdb-js`; I have not confirmed who owns `@documentdb` on npm | `@documentdb-js/cli`, reusing the existing OIDC trusted-publishing setup |
| 5 | **Keep both build paths alive** in the real repo (SEA primary, Bun as a CI-only canary)? | Keeps the SEA-vs-Bun decision reversible with evidence | Yes, until v1 ships; then reassess |

## 2. What the spike proved

The spike ([`spike/`](./spike/)) is deliberately representative, not hello-world: it imports
`@documentdb-js/shell-runtime@0.8.1` (→ `@mongosh/shell-api`, `@mongosh/shell-evaluator`,
`@mongosh/service-provider-node-driver`, `mongodb`, `bson`) and evaluates shell JS in a
persistent `vm.Context` inside the daemon, with an unconnected `MongoClient` so no database is
needed.

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

¹ SEA size = the Node binary you copy + blob. The local build used Homebrew's node (64 MB);
official nodejs.org binaries are larger. The dist listing only shows *compressed* tarballs
([v24.20.0](https://nodejs.org/dist/v24.20.0/): 32–53 MB), so the real per-target sizes are
the ones the CI run reports in §2.2, not an estimate from the listing.

Caveat on the startup number: `help` is the cheapest path. What an agent pays hundreds of times
per session is a full client round trip (`ping`), which also parses the 10 MB bundle on every
invocation; the real CLI should measure that and turn on SEA's `useCodeCache` (safe because we
build natively; §4).

### 2.2 CI matrix — six targets, native runners

The workflow builds **and executes** the packaged acceptance suite on every first-class target
(`ubuntu-latest`, `ubuntu-24.04-arm`, `windows-latest`, `windows-11-arm`, `macos-15`,
`macos-15-intel`), for SEA and for Bun, plus one Linux job that cross-compiles every Bun target.

_Results of the run triggered by this push will be pasted here (per-target pass/fail and
artifact sizes). Until then, treat every non-macOS-arm64 cell as "expected, not proven"._

One known weakness of this run: the suite does not yet assert `process.arch` inside the
artifact, so on the arm64 runners a pass proves the *runner* is arm64, not that the *artifact*
is (an x64 binary under emulation would pass silently). That assertion is the first follow-up
to the workflow (§8).

### 2.3 Findings that change the design (worth reading even if you skip the rest)

1. **The spawn race is real, and packaging exposed it.** With naive "unlink stale socket, then
   bind" logic, 10 concurrent cold clients produced **4 coexisting daemons — but only in the
   packaged build** (slower process startup widened the race window; `node bundle.cjs` always
   passed). Fix: daemons arbitrate via probe-then-bind plus an atomic `mkdir` lock; clients
   never touch the socket file. Whatever daemon library/protocol we pick later, this
   arbitration must be in the first version, and CI must run the concurrency test on the
   packaged artifact — an unpackaged test would have shipped the bug. (The spike's arbitration
   still has holes of its own; see §2.4.)
2. **The dependency graph needs curated externals** in both bundlers: `@mongosh/*` transitively
   pulls `ssh2` + `cpu-features` (native addons, SSH tunnels), `electron` (optional OIDC
   integration), Babel dynamic config probing, plus the driver's 8 optional deps (kerberos,
   zstd, aws-sdk, client-encryption, snappy, socks, gcp-metadata, aws4). All are optional/lazy
   at runtime, so marking them external works — but it means **those features are silently
   absent from the packaged binary** (no SSH tunnels, no kerberos, no CSFLE, no snappy/zstd
   compression). Fine for v1; must be documented; native-addon sideloading is the escape hatch
   if one becomes required (SEA can `require()` a `.node` file from disk next to the binary).
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
7. **The IPC endpoint needs access control; the daemon holds an authenticated connection.**
   The spike creates its Unix socket with mode `0755` in `os.tmpdir()`. On macOS that
   directory is per-user, so it is safe by accident; on Linux `/tmp` is shared, so **any local
   user could connect and run queries as you**. Required in v1: a per-user `0700` runtime
   directory (`$XDG_RUNTIME_DIR`, falling back to a uid-suffixed dir under `/tmp`), the socket
   `chmod 0600`, and a per-user lock directory. On Windows, Node/libuv cannot set a named-pipe
   DACL; the default only grants other non-admin users *read* access, which is acceptable, but
   the pipe namespace is global, so another local user can pre-create ("squat") a predictable
   pipe name. Either document that limitation, or have the daemon prove its identity — HMAC
   over a client nonce, keyed from a token file only the owning user can read. This is now a
   row in §8.
8. **The daemon must not inherit the client's cwd or environment, and upgrades on Windows
   must stop it first.** `lsof` shows the spike's daemon keeps the directory it was launched
   from (Windows cannot delete or eject a directory a process sits in), and it inherits the
   full environment. Spawn with the home directory as cwd and a scrubbed env. A running daemon
   also keeps the `.exe` open, so `install.ps1`/`winget` upgrades must stop daemons before
   replacing the binary, and the endpoint name must be keyed by the *build* (version + build
   id), not just the version string, so a dev build never attaches to a stale daemon.
9. **SEA config hardening, two lines.** SEA's default `execArgvExtension` is `"env"`, so
   `NODE_OPTIONS` from whatever environment launches the CLI reaches the daemon (`--require`,
   `--inspect`); set it to `"none"`. And the Windows build should strip the signature before
   injection, as the docs suggest (the spike does this only on macOS).

### 2.4 Known gaps in the spike itself (not fixed in this revision)

The spike is evidence, not a product. These are the places where it is knowingly wrong, so
that nobody copies them into the real implementation:

- `spike/src/main.ts` — idle timer vs in-flight requests (§2.3 #5); client re-sends after
  failure (§2.3 #6); socket mode and lock directory not per-user (§2.3 #7); daemon inherits
  cwd/env (§2.3 #8); the `KNOWN_COMMANDS` argv scan (§2.3 #4).
- Lock arbitration holes: the stale-lock steal is not atomic (two daemons that both observe a
  stale lock can end up both "holding" it, and the second then unlinks the first's live
  socket); `shutdown()` unlinks the socket path even if another daemon now owns it; a
  non-`EADDRINUSE` listen error exits without releasing the lock; and the client gives up after
  10 s while a stale steal can take 15 s. Fix pattern: pid in the lock + liveness check,
  rename-based steal, compare the socket inode before unlinking.
- **Two driver majors are bundled.** `spike/package.json` pins `mongodb@6`/`bson@6` directly,
  while `@mongosh@5.x` requires `mongodb@7.6`/`bson@7.3`, so the bundle carries both and the
  daemon hands a v6 client to a v7 service provider. The extension resolves a single
  `mongodb@7.2`/`bson@7.2` everywhere and ships older `@mongosh` releases than the spike
  pulled. So the spike is *not yet* "the exact stack the extension tests daily" — it is close.
  Align the spike (or better, the real CLI) to the extension's lockfile; cross-version BSON
  `instanceof` failures are a known bug class.
- Test gaps: the suite accepts `packaged: false` from a packaged binary (should assert `true`),
  does not assert `process.arch` (§2.2), and never touches the driver's connection path
  (dns/tls). A `db.test.find()` that expects a server-selection error, or a real query against
  the `ghcr.io/documentdb/documentdb/documentdb-local` container on the Linux job, would close
  that.
- Workflow: actions are pinned by floating tag rather than SHA (the repo convention is SHA +
  Dependabot), no `permissions:`/`timeout-minutes`, `bun-version: latest`, Node pinned only to
  a major, and the Bun cross-compile job omits `bun-windows-arm64` and the musl targets that
  Bun documents. All small; listed so the release workflow (§4) does not inherit them.

## 3. Candidate comparison

Every cell is backed by a primary source (linked in §9) or by this spike ("spike").

| Approach | User friction | Node needed | Win x64/arm64 | macOS x64/arm64 | Linux x64/arm64 | Cross-compile | Daemon/IPC packaged | Worker threads | Size | Signing fit | Maintenance risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Node SEA** | one file / `curl \| sh`; nothing to preinstall | No | ✅/✅ | ⚠️ x64 untested upstream / ✅ | ✅/✅ (not Alpine; glibc ≥ 2.28) | Partially² | ✅ **spike** | ✅ eval-mode **spike** | ~90–125 MB | Standard signable binaries; postject step must precede signing | Experimental (Stability 1.1) but first-party; v25.5+ `--build-sea` shows active investment; postject unmaintained (replaced upstream) |
| **Bun compile** | same as SEA | No | ✅/✅ | ✅/✅ | ✅/✅ + musl | ✅ all 8 targets from one runner | ✅ **spike** | ✅ eval-mode **spike**; file-based workers need extra entrypoints | ~50–70 MB | macOS documented (needs JIT entitlements); Windows Authenticode fixed v1.2.23; Windows metadata flags unavailable when cross-compiling; notarization unverified | Single vendor; Zig→Rust rewrite shipped in 1.4 (Aug 20, 2026); driver-relevant open bugs (TLS #24374, idle replica-set memory #24118) |
| **@yao-pkg/pkg** | same as SEA | No | ✅ | ✅ | ✅ | ✅ via prebuilt patched Node | Likely (not spiked) | V8 snapshot quirks historically | ~90+ MB | Third-party patched Node binaries — awkward provenance story for a Microsoft-signed release | Community fork of an archived Vercel project (active: v6.22 as of Aug 2026) |
| **Deno compile** | same as SEA | No | ✅ | ✅ | ✅ | ✅ | Untested | — | ~70+ MB | OK | **Disqualifying risk:** `node:vm` support is the historic gap, and the entire `@mongosh` eval pipeline runs on `vm` — not worth a spike |
| **npm i -g** (baseline) | needs Node ≥ 22 + working PATH; version drift | **Yes** | Node's matrix | Node's matrix | Node's matrix | n/a | ✅ **spike** (baseline) | ✅ | 10 MB package | npm provenance (repo already uses OIDC trusted publishing) | Lowest — but agents cannot self-serve past a missing/old Node |
| **npx** | needs Node; first-run download; cache and version ambiguity | **Yes** | 〃 | 〃 | 〃 | n/a | ✅ | ✅ | cache-dependent | 〃 | Worst fit for agents |

² SEA cannot cross-compile in the classic sense, but the **blob is platform-portable** when
`useSnapshot`/`useCodeCache` are off — you inject it into a downloaded target-platform Node
binary ([docs](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)).
We don't need this today: GitHub has native runners for all six targets, which also gives us
run-the-artifact test evidence per target. It becomes relevant for macOS x64 when the Intel
runner image retires (§8).

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
postject, cross-compile, smaller, faster). SEA wins on one axis that dominates for a
**database** CLI: **runtime fidelity**. With SEA, the thing executing in production is the same
Node.js the extension, driver, and `@mongosh` are tested against daily. With Bun we would be
running `@mongosh` on a runtime reimplementation with no public precedent I could find, and the
known Bun issue list touches our exact hot paths: TLS handshake failures against certain Atlas
clusters ([#24374](https://github.com/oven-sh/bun/issues/24374)), memory growth on **idle
replica-set connections** ([#24118](https://github.com/oven-sh/bun/issues/24118)) — an idle
warm connection is precisely what our daemon holds — and a bson import breakage that shipped in
a Bun patch release ([#32501](https://github.com/oven-sh/bun/issues/32501)). Each is fixable,
but we'd be signing up to track a fast-moving runtime (1.4 just swapped its implementation
language) for the lifetime of the product. Keep Bun as the documented runner-up; the spike
keeps both build paths alive so the decision is reversible with evidence.

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
- Binary is ~90–125 MB vs Bun's ~50–70 MB. Real, but nobody installs a database CLI over
  dial-up; compressed release assets roughly halve it.
- Official Node binaries need glibc ≥ 2.28 and are not built for Alpine/musl; older distros and
  Alpine images use the npm channel.

## 4. Build & release pipeline (design)

The spike workflow is the skeleton; the release version adds signing + packaging + release
publishing. Two variants, selected by decision §1.1 #1:

```
tag v0.x.y
  └─ release.yml (GitHub Actions, in the CLI's org)
       ├─ build (matrix: 6 native runners)
       │    linux-x64, linux-arm64 (ubuntu-latest, ubuntu-24.04-arm)
       │    windows-x64, windows-arm64 (windows-latest, windows-11-arm)
       │    macos-arm64, macos-x64 (macos-15, macos-15-intel — until Aug 2027, then cross-build)
       │    steps: npm ci → esbuild bundle → SEA blob → inject → strip/ad-hoc sign →
       │           packaged daemon acceptance test (asserts packaged + arch) → upload unsigned artifact
       │
       ├─ Variant A — DocumentDB-org identity, GitHub-only:
       │    ├─ sign-windows   (Authenticode via Azure Trusted Signing or an HSM-backed cert; §5)
       │    ├─ sign-macos     (Developer ID + notarytool + staple where applicable; §5)
       │    ├─ checksums + provenance (sha256sums.txt, GitHub artifact attestation / SLSA)
       │    └─ github-release (per-target .tar.gz/.zip + checksums + skills/)
       │
       └─ Variant B — Microsoft identity:
            └─ the GitHub matrix stays the test gate; an Azure DevOps OneBranch pipeline
               (same shape as .azure-pipelines/build.yml + release.yml today) builds, signs via
               ESRP (Authenticode, macOS sign+notarize, Linux), and publishes the release.
               In my understanding OneBranch wants to build from source itself, so treat
               "ADO signs a GitHub-built binary" as unverified.

       ├─ npm-publish    (the same bundle as @documentdb-js/cli, OIDC trusted publishing —
       │                  infra already proven by npm-publish-documentdb-js.yml; scope per §1.1 #4)
       └─ channel-updates (later: Homebrew tap formula bump, winget manifest PR)
```

Notes:
- **Native runners, not cross-compilation**, for both build and test: every claimed target
  executes its own artifact in CI ("do not claim an OS works until the artifact executes
  there"). All six labels are GitHub-hosted and free for public repos; `macos-15-intel` is the
  last Intel image and is available until **August 2027**
  ([actions/runner-images#13045](https://github.com/actions/runner-images/issues/13045)).
- The **packaged acceptance test runs in the release path**, not just research CI — finding
  #1 in §2.3 is the proof of why.
- Node version is pinned to an exact version via `node-version-file`, and the SEA blob must be
  generated by the exact Node version of the copied binary (version mixing crashes:
  [nodejs/node#60327](https://github.com/nodejs/node/issues/60327)).
- SEA config: `useCodeCache: true` (native builds, so safe), `execArgvExtension: "none"` (§2.3
  #9), `disableExperimentalSEAWarning: true`.
- Workflow hygiene the spike skipped (§2.4): SHA-pinned actions, least-privilege
  `permissions:`, `timeout-minutes`, pinned Bun version.
- Skills (`SKILL.md`) ship in the release archive next to the binary from day one (`skills/`
  directory), so the artifact is self-describing for agents; a `documentdb skills install`
  command can later copy them into agent-host directories. How skills reach agents beyond
  that is an open product question, not blocked by packaging.

## 5. Signing & notarization — the honest part

### 5.1 First the identity question

Everything below runs mechanically on GitHub Actions. What I cannot decide is **which legal
identity the binaries carry**, and that decides where signing runs:

- **Microsoft identity.** This repo already ships the extension through Azure DevOps:
  CONTRIBUTING §7.7 ("Run the internal Azure DevOps build pipeline. It produces a signed
  `.vsix`"), `.azure-pipelines/build.yml` (OneBranch Official, `linuxEsrpSigning: true`) and
  `.azure-pipelines/release-npm-packages.yml` (ESRP Release). I would expect a Microsoft-signed
  CLI to be held to the same path — ESRP through OneBranch — rather than to GitHub-held
  certificates. That is the one plausible thing that forces us off a GitHub-only pipeline, and
  it is a policy fact I cannot spike; I can only ask. Variant B in §4 is the shape if so.
- **DocumentDB-org identity.** If the CLI is released by the DocumentDB project (its own
  GitHub org, its own Apple Developer team, its own Windows signing identity), then GitHub-held
  secrets are the normal way open-source projects do this, and Variant A applies. Azure
  Trusted Signing is the obvious Windows option (cloud HSM, `signtool` integration, usable from
  Actions with OIDC; it does require a verified legal entity); SignPath Foundation's free
  signing for OSS projects is worth checking as an alternative.

### 5.2 The walls are narrower than they look

- **macOS.** Gatekeeper only evaluates files carrying the quarantine attribute, which browsers
  set and `curl` does not. So a `curl | sh`-installed binary (or a Homebrew formula's binary)
  runs today with just an **ad-hoc signature**, which Apple Silicon requires and the spike
  already applies. Developer ID + notarization matter for browser downloads, `.pkg`/`.dmg`,
  casks, and MDM-managed fleets. Standalone Mach-O binaries cannot be stapled; Gatekeeper
  fetches the ticket online, which is fine for CLI users, or we ship a `.pkg` later.
  Pipeline: import cert into a temporary keychain → `codesign` with hardened runtime +
  timestamp → `xcrun notarytool submit --wait` → staple (for `.pkg`). Runs on a `macos-*`
  runner; the spike already does the remove-signature → inject → re-sign dance that a real
  identity slots into.
- **Windows.** SmartScreen's "Windows protected your PC" prompt is an Explorer/ShellExecute
  feature for mark-of-the-web files; a console launch of `documentdb.exe` does not show it.
  But PowerShell downloads *do* carry mark-of-the-web, Defender's reputation heuristics *do*
  flag unsigned low-prevalence 100 MB executables, and WDAC/AppLocker/Intune policies require
  a signature regardless. So a real Authenticode signature is still needed for a credible
  product — it is just not what blocks the first install-script release.
- **Linux.** No signing wall; checksums + GitHub artifact attestations cover integrity.

**Net:** the install-script channel can launch before any certificate exists, which decouples
v1 from procurement. **Recommended next step:** decide §1.1 #1; I write the complete signing
workflow for that variant with placeholder secrets (or, for Variant B, a OneBranch YAML
modelled on the existing pipelines), and we file the credential requests. If policy blocks
GitHub-held signing credentials, *that* is the finding that changes the pipeline — and it is
isolated to exactly two secrets.

## 6. Install & update channels

Launch (cheap, all GitHub-native):
1. **GitHub Releases** with per-target archives + `sha256sums.txt` (the substrate for
   everything else).
2. **Install scripts**: `curl -fsSL …/install.sh | sh` and an `irm …/install.ps1 | iex`
   PowerShell equivalent — detect OS/arch, download, verify checksum, place on PATH, and **stop
   any running daemon of the previous version first** (Windows cannot replace a running
   `.exe`; §2.3 #8). This is what gives the "one-line install" your doc asks for, and agents
   can run it too.
3. **`npm i -g @documentdb-js/cli`** — same bundle, near-zero marginal cost, uses the org's
   existing OIDC trusted publishing. Serves Node-havers and constrained environments (Alpine,
   old glibc). Caveat: the "npm keeps the native features" claim in §7 only holds if the
   package declares `kerberos`, `snappy`, `@mongodb-js/zstd`, `mongodb-client-encryption` and
   `ssh2` as `optionalDependencies`; the bundle marks them external, so without that they are
   just as absent as in the binary.

Later (post-validation, each a small PR-automation job):
4. **Homebrew tap** under whichever org owns the CLI — formula bump automated in release.yml.
5. **winget** manifest (needs the signed Windows binary first) and optionally **Scoop**.

**Auto-update: explicitly deferred.** It drags in channel management, rollback, integrity, and
daemon/client version-skew handling. Ship `documentdb --version` + an update *check*
(notify-only) at most; the daemon protocol carries client/server version fields from day one so
a later updater has something to negotiate with, and the endpoint name is keyed by build so a
new client never attaches to an old daemon.

## 7. Where your no-Node/no-npx preference costs us

You asked for this honestly, so: the preference is **worth keeping**, and here's its real price.

1. **~10× artifact size** (90–125 MB vs a 10 MB npm package). Cost is bandwidth/disk, not UX.
2. **A 6-way native build matrix + signing pipeline** instead of one `npm publish`. The spike
   shows this is a few hundred lines of workflow, not a project. Ongoing cost: pinned-Node
   bumps, occasional packager churn (postject → `--build-sea` when Node 26 is LTS), and one
   dated migration: macOS x64 moves to a cross-built blob (or to npm) when the Intel runner
   image retires in August 2027.
3. **Silent loss of optional native features** (SSH tunnels, kerberos, CSFLE, snappy/zstd) —
   §2.3 #2. The npm channel can keep them via `optionalDependencies` (§6), which is another
   reason to ship it in parallel.
4. **Signing credentials become our problem.** With npm-only distribution, npm provenance was
   enough. Single binaries put us in the Gatekeeper/SmartScreen world — that's the §5 work,
   and under the Microsoft identity it likely means an Azure DevOps leg after all.
5. **postject/SEA experimental churn** until Node 26 LTS makes `--build-sea` boring.
6. **Platform floors:** no Alpine/musl and glibc ≥ 2.28 for the binary; npm covers the rest.

What we get for that price: a `curl | sh`-able, agent-friendly, Go-like install with no runtime
prerequisite, on all six targets — which is the product thesis. Verdict: pay it, and hedge by
shipping the npm channel alongside.

## 8. Risks & open items

| Risk | Severity | Mitigation |
|---|---|---|
| Microsoft-identity release requires ESRP/OneBranch (off GitHub) | **High** (pipeline-shaping) | Decide §1.1 #1 early; Variant B in §4 keeps GitHub as the test gate either way |
| IPC endpoint reachable by other local users (Linux `/tmp`, Windows pipe squatting) | **High until fixed**; v1 requirement | Per-user `0700` runtime dir + `0600` socket + per-user lock; document or token-authenticate the Windows pipe (§2.3 #7) |
| Idle timeout / at-most-once / timeout bugs in the daemon protocol | Medium (design requirement) | In-flight counter, retry-connect-only, separate timeouts, request ids (§2.3 #5–6) |
| SEA experimental-status churn | Medium | Pin Node exactly; migrate to `--build-sea` at Node 26 LTS; Bun path kept warm as fallback |
| macOS x64: untested upstream **and** its runner retires Aug 2027 | Medium (dated) | CI matrix is the canary; then cross-build the portable blob into darwin-x64 Node and test under Rosetta, or drop to npm/pkg for that target |
| Bundling two driver majors (`mongodb@6` + `@7`) | Medium (spike-only today) | Align to the extension's lockfile; add a duplicate-package check to the bundle step (§2.4) |
| `@mongosh` bundling regressions on dependency bumps | Medium | The packaged acceptance test in CI is the regression gate (it already caught the spawn race) |
| Daemon/client version skew after binary upgrade | Known open | Build-keyed endpoint + protocol version fields from day one; installer stops old daemons |
| Unix socket path length limits (~104 chars) | Low | Short hashed names in a short per-user directory |
| CI evidence from the wrong org | Low, but real | Re-run the matrix in the CLI's future repo (§1.1 #2) |

Open items before this is "done" by my own definition: per-target CI results and sizes pasted
into §2.2 (this push); the signing workflow with placeholder secrets for the chosen variant
(§5); the install-script prototype with daemon-stop (§6); the spike cleanups in §2.4 folded
into whatever becomes the real daemon.

Branch hygiene, for the record: `cli-research` is a research branch, not a merge candidate.
The extension's root ESLint and `tsc` currently pick up `cli-research/spike/src`, so before any
merge the folder is excluded from both, or (better) the spike moves to the CLI's own repo.

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
- Node binaries: [nodejs.org/dist/v24.20.0](https://nodejs.org/dist/v24.20.0/) (2026-08-26;
  listing shows compressed sizes only)
- Bun executables (targets incl. `bun-windows-arm64` and musl; codesign/entitlements; workers;
  Windows flags not available when cross-compiling): [docs](https://bun.com/docs/bundler/executables);
  Bun 1.4 (Rust rewrite, 2026-08-20): [blog](https://bun.com/blog/bun-v1.4);
  Node-compat page: [docs](https://bun.com/docs/runtime/nodejs-compat)
- Bun named pipes: raw `net` works, HTTP-over-pipe still open
  ([#15350](https://github.com/oven-sh/bun/issues/15350)); compiled argv shape
  ([#22157](https://github.com/oven-sh/bun/issues/22157)); Windows Authenticode fix in 1.2.23
  ([#20109](https://github.com/oven-sh/bun/issues/20109)); macOS codesign regression 1.3.12
  ([#29120](https://github.com/oven-sh/bun/issues/29120))
- Bun × MongoDB driver: TLS [#24374](https://github.com/oven-sh/bun/issues/24374),
  idle replica-set memory [#24118](https://github.com/oven-sh/bun/issues/24118),
  bson/node:v8 [#32501](https://github.com/oven-sh/bun/issues/32501)
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
