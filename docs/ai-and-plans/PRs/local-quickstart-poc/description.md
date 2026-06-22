# Local Quick Start — POC: Design Decisions & Scope

**Status:** Planning — **reviewed by 5 agents over two rounds; revised to consensus (rev. 3), all five APPROVE, no blocking issues**. No implementation yet.
**Branch:** `feature/local-quickstart/POC`
**Base:** `guanzhou/local-quickstart-design`
**Date:** 2026-06-22
**Companions:** [`poc-implementation-plan.md`](./poc-implementation-plan.md) (the *how*) ·
[`review-and-resolutions.md`](./review-and-resolutions.md) (the 5-agent review + every resolution).
**Folder note:** rename to `<PR#>-local-quickstart-poc` once a PR is opened (matches the
existing `653-local-quickstart-design` convention).

## Why this note

This document records the **decisions and rationale** behind a **proof-of-concept (POC)**
for the Local Quick Start feature. The POC exists to be **demoed**, not shipped. Its job is
to prove the end-to-end value of the full design ([`local-quickstart-v2.md`](../../local-quickstart/local-quickstart-v2.md))
with the **smallest credible vertical slice**, and to de-risk the parts the design leaves as
"architecture, not an implementation plan."

It is the companion "why" to the step-by-step "how" in
[`poc-implementation-plan.md`](./poc-implementation-plan.md). Read this first.

## One-sentence goal (unchanged from the design)

> From an empty machine-with-Docker to an **open, browsable** local DocumentDB connection,
> in one click, without leaving VS Code.

## What the POC proves (the demo narrative)

1. User opens the **DocumentDB Local – Quick Start** entry (tree rocket or command).
2. A **card-based webview** (same design language as the Query Insights tab) shows Docker
   readiness and a "what we'll do" summary.
3. User clicks **Start DocumentDB Local**. The real container is pulled, created, started.
4. The webview shows **lightweight staged progress** (Checking → Pulling → Creating →
   Starting → Waiting for readiness → Done), driven by a tRPC subscription.
5. A **wire-protocol readiness probe** confirms the DB accepts connections.
6. The connection is **saved and revealed in the Connections view**; the webview auto-closes.
7. User **expands the connection and browses real databases/collections** — using the
   extension's existing tree/browse code, end to end.

If steps 1–7 work live, the POC has proven the design.

## Scope: what the POC focuses on vs. leaves out

The split is driven by one question: **does it move the demo?**

| Area | In POC (focus) | Deferred (left out) | Why |
| ---- | :---: | :---: | ---- |
| Quick Start webview (Review → Progress → Success) | ✅ | | The visual centerpiece of the demo |
| Real container provisioning via `@microsoft/vscode-container-client` | ✅ | | The design-sanctioned runtime; proves it works |
| **Lightweight in-webview staged progress** | ✅ | | See "Key deviation 1" — it's what the manager singled out |
| Wire-protocol readiness probe (180 s, POC) | ✅ | | "Running ≠ ready"; the design's core correctness contract |
| **Inline managed instance** under the Quick Start node + **browse** | ✅ | | The payoff + the design's signature "webview closes, tree takes over" handoff; cheap via `DocumentDBClusterItem` |
| Quick Start tree node + rocket empty state (incl. **fresh-machine** empty state) | ✅ | | The design's entry point |
| Lifecycle actions (Stop / Start / Delete) | ▲ Stretch | | Not needed to prove the provisioning flow |
| Storage persistence across reload + named data volume | ▲ Stretch | | Demo is single-session; volume needs the image data path (OPEN-2) |
| Auto-generated credentials in SecretStorage (masked in all logs) | ✅ | | Zero-friction is the whole point; never leak secrets |
| Legacy emulator migration (§4) | | ✅ | Invisible in a fresh-machine demo |
| TLS-exception wizard step (§7) | | ✅ | Separate slice; POC hardcodes `emulatorConfiguration` |
| Full 7-state machine + complete action matrix (§6) | | ✅ | POC uses a reduced state set |
| Port fallback band (§8.3) | | ✅ | POC pre-checks 10260 and errors clearly if busy (no random band) |
| Container adoption / label-conflict resolution (§10) | | ✅ | POC uses a fixed name + simple message |
| Multi-window coordination / Docker events (§12) | | ✅ | Single-window demo |
| Advanced panel (custom creds/image/seed data) (§5.2, §8.4) | | ✅ | Happy path only |
| Categorized Docker diagnosis (§9, v1.2) | | ✅ | Basic "Docker not ready" message only |
| Telemetry (§14) | | ✅ | Not demo-visible |
| `10255 → 10260` manual-wizard fix (§13.5) | | ✅ | Quick Start uses its own port; unrelated to the POC |

## Key deliberate deviations (POC vs. the v1.0 shipping design)

These are intentional. They make the POC a better demo while staying true to the design's
intent. They are **not** proposals to change the shipping plan.

1. **Include lightweight staged progress (the design's v1.1 "prefer to ship").**
   The shipping design makes v1.0 *terminal-first / spinner-only* and pushes lightweight
   in-webview progress to v1.1. The POC pulls v1.1's lightweight progress **forward**, because:
   (a) a demo must *show* the value, and a silent spinner shows nothing; and (b) this is
   precisely the slice the manager (Tomaz) carved out and singled out as worth shipping
   (commit `ce0224f8`). We still honor the hard constraint: **no `docker pull` percentage
   streaming** — stage-level transitions only.

2. **OutputChannel transparency is a deliberate POC *compromise*, not parity.** The design's
   "terminal-first transparency" runs `docker` as VS Code *terminal tasks*. The repo has **no
   VS Code terminal-task integration** (`vscode.Task`/`ShellExecution`) — though it *does* have a
   general `Task` service framework (`src/services/taskService/`, which the POC reuses for
   lifecycle/cancellation). For the POC we stream the runtime's stdout/stderr to a dedicated
   **Output channel**. This is **not equivalent** to the integrated-terminal experience the design
   anchors on; it is a cheaper stand-in that still lets a viewer see the **real docker commands and
   live output**. The generated password is **masked** in everything written to the channel. Full
   terminal-task transparency is a shipping-time follow-up.

3. **Service-owned instance, rendered inline (no double-appearance).** `QuickStartService` owns the
   managed instance; the **DocumentDB Local - Quick Start** tree node renders it **inline** as a
   read-only `DocumentDBClusterItem` built from the instance's connection string (with
   `emulatorConfiguration = { isEmulator: true, disableEmulatorSecurity: true }`). This buys
   TLS-allow-invalid and **full browse for free**, and — because nothing is written to the shared
   Emulators storage zone in the Core path — the instance shows up **only** under the Quick Start
   node, matching the iteration-2 tree shape (§2/§3.2) and avoiding the duplicated/legacy-zone
   appearance the design was redesigned to remove. **Storage persistence is Stretch (WI-8).**

4. **Ephemeral data, honestly labeled.** The documented `docker run` mounts no volume, and the
   image's internal data path is unverified (OPEN-2). The POC therefore runs **ephemeral**, and the
   webview's **Data card reads "Ephemeral (POC)"** (never "Persistent"/"Persisted") so the demo UI
   does not claim a property the build lacks. A named volume is Stretch (WI-8).

## Codebase reuse strategy (the leverage points)

The POC is small **because** it stands on existing infrastructure (all verified in source):

| Need | Reuse | Path |
| ---- | ----- | ---- |
| Webview panel + tRPC + React | `WebviewControllerBase`, `appRouter`, `WebviewRegistry` | `src/webviews/_integration/*` |
| Webview UI vocabulary | `MetricsRow` / `MetricBase` / `SummaryCard` / `Card`,`Badge`,`Button` | `.../queryInsightsTab/components/*` |
| Streaming progress pattern | subscription generator + `AbortSignal` | `.../queryInsights/queryInsightsEventsRouter.ts` (`streamStage3`) |
| Inline instance + browse (the payoff) | `DocumentDBClusterItem` from a `TreeCluster<ConnectionClusterModel>`; primes `CredentialCache` from the connection string on expand | `src/tree/connections-view/LocalEmulators/LocalEmulatorsItem.ts` (template) |
| Lifecycle / cancellation / state | the `Task` base class (state machine + `AbortSignal` + `updateProgress`) | `src/services/taskService/` |
| Persist a connection (Stretch only) | `ConnectionStorageService.save(ConnectionType.Emulators, …)` + reveal helpers | `src/commands/newLocalConnection/ExecuteStep.ts:177-201` |
| TLS-allow-invalid behavior | `emulatorConfiguration.disableEmulatorSecurity` → `tlsAllowInvalidCertificates` | `src/documentdb/connectToClient.ts` |
| Conn-string composition (already percent-encodes) | `DocumentDBConnectionString` | `src/documentdb/utils/DocumentDBConnectionString.ts` |
| New tree node + refresh | `ConnectionsBranchDataProvider`, `ext.state.notifyChildrenChanged` | `src/tree/connections-view/*` |
| Command + menu registration | `ClustersExtension.activateClustersSupport()` + `package.json` contributes | `src/documentdb/ClustersExtension.ts` |

## Real-world findings that shape implementation

From the **official DocumentDB image** (`github.com/microsoft/documentdb` README):

- **Image:** `ghcr.io/documentdb/documentdb/documentdb-local:latest`
- **Run:** `docker run -dt -p 10260:10260 --name <name> <image> --username <U> --password <P>`
- **Port `10260`** is the documented default — the design's canonical port is already correct.
- **Connection string:** `mongodb://<U>:<P>@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true`
  → maps cleanly onto `emulatorConfiguration`/TLS-allow-invalid.

**Tension to flag:** the image takes credentials as **container CLI args** (`--username` /
`--password` after the image name), **not** as environment variables. This means the password
lands on the host `docker run` command line — re-introducing exactly the `ps -ef` / process-audit
exposure the design's §8.2 `--env-file` was meant to avoid (separate from the `docker inspect`
exposure the design already accepts). **POC decision:** use the documented `--username/--password`
args **and mask the password in all Output-channel writes**; record for the shipping design a
two-part open question — *does the gateway accept env-var credentials*, and if not, *how do we
avoid CLI-arg exposure?*

## Open questions / risks

1. **Credential transport** — does the image accept env-var credentials, or only the
   documented CLI args? (Affects §8.2 hardening. POC uses CLI args.)
2. **Data persistence** — the documented `docker run` mounts no volume; the in-container data
   path for a persistent named volume is unknown. POC treats persistence as a **stretch**;
   ephemeral data is acceptable for a demo.
3. **Readiness probe reuse** — confirm we can drive a one-shot `ping`/`hello` over the wire
   protocol through the existing connect path (`connectToClient.ts` / `ClustersClient`) with
   `tlsAllowInvalidCertificates`, in a 60 s retry loop.
4. **Container client ergonomics** — `@microsoft/vscode-container-client@0.5.4` is installable;
   confirm the `DockerClient` + command-runner API for pull/create/start/inspect/stop and for
   appending post-image args (`--username/--password`).
5. **Double-appearance cosmetic** — the saved Emulators connection may show under both the new
   Quick Start node and the existing **DocumentDB Local** node. Acceptable for the POC.

## Status

Planning only. The detailed work breakdown, acceptance checks, and demo script live in
[`poc-implementation-plan.md`](./poc-implementation-plan.md). The multi-agent review of this
plan and its resolutions will be recorded in `review-and-resolutions.md`.
