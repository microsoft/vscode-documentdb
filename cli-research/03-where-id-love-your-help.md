# Where I'd love your help — packaging & deployment

Hi Guanzhou — since we already work together on the DocumentDB extension, you're exactly the right person to poke at this with me. This is the one piece of the CLI plan I'm least sure about, and it's very hands-on: I'd love you to **build a few small spikes**, not just read docs — the goal is to find out what actually works today, on all three OSes, with the least friction for our users. No rush and no fixed answer expected; I mainly want your read on what's feasible.

## The question I'm stuck on

> **What is the simplest, most robust, cross-platform way to deliver this Node/TypeScript CLI to end users in 2026 — ideally a single self-contained artifact — with everything (build, sign, package, release) runnable on GitHub (Actions + our existing compute)?**

## What matters to me (priorities, in order)

1. **Simplest possible deployment for the *user*.** The person installing our tool should do as little as possible. A one-line install or a single downloaded binary is the dream.
2. **Cross-platform: Windows, macOS, Linux** (and ideally both **x64 and arm64**). First-class on all — not "works on Linux, sort of runs elsewhere."
3. **I'd prefer NOT to depend on the user having Node installed, and prefer NOT to rely on `npx`.** I'm very open to being talked out of this — if avoiding Node/`npx` turns out to cost more than it's worth, please just tell me honestly.
4. **Everything buildable on GitHub — staying entirely in the DocumentDB org.** Build, cross-compile, sign, and release should run on **GitHub Actions** (and the compute we already have there in the DocumentDB org). The plan is to keep the *whole* pipeline on GitHub this time — **no Azure DevOps overhead**, at least for now, before any stricter org rules kick in. In theory we might one day be pushed onto Azure DevOps, but that's not expected — so please assume a GitHub-only toolchain and flag anything that would *force* us off it.
5. **It must not break the daemon.** Whatever packaging we pick has to support the tool **re-spawning itself as a background daemon** and talking to it over local IPC (see [`01-architecture-brief.md`](./01-architecture-brief.md) and [`02-nodejs-cli-tech-research.md`](./02-nodejs-cli-tech-research.md)). This is the subtle one — some packaging methods make "spawn a copy of myself as a detached process" awkward, so it's worth verifying end-to-end.

## Concrete things to investigate & compare

For each viable path, it'd help to have your read on: **feasibility, user friction, build complexity on GitHub, artifact size, and daemon/IPC compatibility.**

1. **Node's built-in Single Executable Applications (SEA).** Current state, maturity, which Node LTS, cross-compilation story (can a Linux GitHub runner emit a Windows/macOS binary, or do we need a matrix of native runners?), how it handles native addons and multiple entry points (CLI vs daemon), signing.
2. **Third-party single-exe packagers** — `@yao-pkg/pkg` (the maintained `pkg` fork), `nexe`, and anything newer. Maturity, cross-compile, arm64, size, gotchas.
3. **Alternative runtimes that compile to a binary** — **Bun** (`bun build --compile`) and **Deno** (`deno compile`). Do they run our Node/TS + the `net`/`child_process` daemon code unmodified? Cross-target support? This could sidestep the whole "package Node" problem — evaluate seriously.
4. **Bundling** (esbuild / rollup / `ncc`) as a prerequisite step — collapsing `node_modules` into one file before any of the above. What's the clean 2026 setup?
5. **The "just use npm/npx" baseline** — for honest comparison. `npm i -g`, `npx`, and the friction/version/PATH problems they bring. What do comparable tools (`gh` is Go; but JS tools like `vercel`, `wrangler`, `aws-cdk`, `nx`, `firebase-tools`) actually ship, and how?
6. **Install/update UX** — beyond the raw binary: Homebrew tap, Scoop/winget, a `curl | sh` script, GitHub Releases with per-OS assets, auto-update. Which are cheap to run from GitHub?
7. **Signing & notarization reality** — macOS notarization and Windows code-signing from GitHub Actions: what's actually required so users don't hit "unidentified developer" / SmartScreen walls? Cost/cert implications.
8. **Daemon compatibility check (do this for the top 1–2 candidates).** Actually build a tiny spike: a packaged binary that, on first run, **spawns a detached copy of itself** as a daemon, opens a Unix socket / named pipe, and a second invocation attaches and gets a reply. Confirm it works packaged, on all three OSes. This is the make-or-break test.

## What would help me most to get back

Whatever's easy for you — but if it's useful to have a shape, something like:

- A **comparison table**: approach × {user friction, no-Node-needed?, cross-platform+arm64, GitHub-buildable, artifact size, signing story, **daemon/IPC works?**}.
- A **recommendation** (and a runner-up), with the reasoning and the biggest risks as you see them.
- Any **spikes / proof-of-concept repos** you built, especially the daemon-compatibility one.
- Honest **"here's where your no-npx preference costs us"** notes if that's what you find — I'd genuinely rather know.

## Optional deeper context

If you want the fuller picture of *what the tool is* — the dual human+agent command design, the parameter conventions, the execution modes, and the auth model — see the [`context/`](./context/) folder. **Totally optional** for this; it's there if the product shape helps you judge the tech.

Thanks a lot for taking a look — happy to talk any of it through whenever. — Tomasz
