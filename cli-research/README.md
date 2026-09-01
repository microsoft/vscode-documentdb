# CLI Research Pack — DocumentDB CLI

Hi Guanzhou 👋 — this is a small info pack for something I'd love your help with. Since we already work together on the DocumentDB extension, you're the perfect person to sanity-check the trickiest open part of a CLI I'm planning: **how to build and, above all, ship it** as a friction-free, cross-platform tool. It's a hands-on **feasibility investigation** in Node.js/TypeScript — no fixed answer expected, I mainly want your read.

## What's in here

| File | Purpose |
|---|---|
| [`01-architecture-brief.md`](./01-architecture-brief.md) | **The big picture, no reasoning.** CLI + daemon + Skills, and how auth stays out of the agent's context. Read this first — it's short. |
| [`02-nodejs-cli-tech-research.md`](./02-nodejs-cli-tech-research.md) | **What I already looked at** on the Node/TS runtime + daemon/IPC layer. ⚠️ *Overview done a while back (mid-2026) — may be inaccurate today; worth re-verifying.* |
| [`03-where-id-love-your-help.md`](./03-where-id-love-your-help.md) | **The part I'm hoping you can dig into.** The open questions — chiefly: what's the simplest cross-platform *deployment* for our users today, ideally all built on GitHub? |
| [`context/`](./context/) | **Optional deeper context** on the CLI idea itself (dual human + agent design, command-surface parameters, execution modes, auth model). Read only if you want the fuller picture. |

## The one-paragraph summary

I'm building a **DocumentDB CLI** usable equally by a **human at a terminal** and by an **AI agent** (guided by Skills). Because auth is expensive and agents invoke the tool many times, the CLI **self-manages a warm background daemon** over local IPC. I control the whole thing and will build it in **TypeScript/Node**. The runtime/daemon tech is fairly well understood (see doc 02); the **open question is packaging & deployment** — how a user installs and runs this on Windows, macOS, and Linux with the least friction. I'd prefer **not** to depend on `npx`/a Node install on the user's machine — but I'd love to know the current state of the art before deciding, and I'm very open to being talked out of that preference.

## The core question I'm hoping you can help with

> **What is the simplest, most robust, cross-platform way to deliver this tool to users in 2026 — ideally a self-contained artifact — with everything (build, sign, release) runnable on GitHub (Actions + the compute we already have)?** And does the chosen packaging approach play nicely with the self-spawning daemon and local IPC?

Details and sub-questions in [`03-where-id-love-your-help.md`](./03-where-id-love-your-help.md). Thanks a lot for taking a look! — Tomasz
