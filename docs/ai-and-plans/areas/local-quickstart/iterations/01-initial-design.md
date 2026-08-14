# PR #653: Local DocumentDB Quick Start — Design Decisions

**Status:** Open
**Branch:** `guanzhou/local-quickstart-design`
**Base:** `main`
**Date:** 2026-06-15

## Why this note

This PR adds a design doc only (no shipping code). Before implementation we
benchmarked the design against a proven, shipping reference — the
**PostgreSQL extension's "Local Docker Server"** flow (`ms-ossdata.vscode-pgsql`,
read at the source level). This note records the **non-obvious decisions**:
where we deliberately diverge from that reference and why, where we match it,
and the deviations that override shared/base behavior inside our own codebase.
It exists so human reviewers and review agents don't have to re-derive the
rationale — or mistake a deliberate deviation for an oversight.

Full design: [`../../local-quickstart/local-quickstart-v2.md`](../../local-quickstart/local-quickstart-v2.md)
(iteration 2, supersedes iteration 1). Review-resolution map is in v2 §18.

## Reference: PostgreSQL "Local Docker Server"

A 3-page webview (Home → Prereqs → Create form) that checks Docker (CLI +
daemon) via VS Code tasks, runs a **required-field** form, creates a container
through `@microsoft/vscode-container-client`, passes credentials via a temp
`--env-file`, waits for `pg_isready` **inside** the container, then saves +
reveals the connection and auto-closes the webview. It is **create-and-connect
only** — no persistent volume, no lifecycle (stop/start/delete), no
labels/adopt. The "Easy Management" welcome copy is marketing; no such
commands exist in its source.

## Deliberate deviations from the reference (non-obvious — keep)

| We do                                                 | PG does                        | Why we deviate                                                                                     |
| ----------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Zero required fields** (generate creds/names)       | 3 required fields              | First-run friction is the thing to remove; PG even shipped a "password required before start" bug. |
| **Persistent named volume**                           | No volume (data lost on `rm`)  | A local dev DB that silently loses data on container removal is a footgun.                         |
| **Wire-protocol readiness, 60 s**                     | `pg_isready` in-container, 5 s | DocumentDB has no in-image readiness CLI we can rely on; PG's 5 s is fragile on a cold `initdb`.   |
| **Full lifecycle (7 states; stop/start/delete/logs)** | None (create-only)             | The managed-instance tree is our core value; PG only _markets_ lifecycle.                          |
| **tRPC + FluentUI**                                   | mssql-fork custom RPC          | Matches this repo's webview stack (CollectionView/DocumentView); we are not a fork.                |
| **Stricter telemetry** (resolved semver only)         | sends registry/image/tag       | Avoid leaking image/registry identifiers.                                                          |
| **Docker labels + adopt**                             | name-only refuse               | Lets us recognize and re-attach containers we created.                                             |

## Changes folded back into v2 from the PG study

- **v1.0 create-progress = terminal task + button spinner + auto-close** (the
  in-webview multi-step progress card is descoped to v1.1). PG proves the
  terminal-task model ships without streaming `docker pull` % into a webview.
- **Adopt `@microsoft/vscode-container-client`** (the runtime layer PG uses;
  ships both `DockerClient` and `PodmanClient`) instead of a hand-rolled
  abstraction → makes "OCI/podman later" a driver swap, not a rewrite.
- **Port rule:** only auto-fallback the _default_ port; never silently relocate
  a port the user typed in Advanced (match PG's intent-respecting behavior).
- **Read the real bound host port from `docker inspect`** before composing the
  saved connection string (don't trust the requested port; matters with fallback).
- **Distinguish failed-to-create vs failed-to-start** in error copy (cheap, via inspect).
- **Pre-create duplicate check on both connection name and container name.**

## Deviations that override shared/base behavior (flag for reviewers)

These are the easy-to-miss ones — we extend or override shared infrastructure
rather than add isolated code:

1. **TLS exception folded into the shared new-connection wizard** (gated to
   localhost / private hosts) instead of a separate emulator wizard. This
   overrides the shared wizard with a conditional step, and the old
   `New Local Connection...` entry point is removed.
2. **Canonical port `10260` overrides the shared wizard's hardcoded `10255`**
   (`PromptConnectionTypeStep.ts`, `PromptPortStep.ts`). This is a pre-ship fix
   that changes existing manual-connection defaults — not Quick-Start-local.
3. **Legacy migration mutates the shared `ConnectionType.Emulators` storage
   zone** (moves entries into a `Local Connections (Legacy)` folder; the old
   zone is kept read-only for one release before removal as a rollback path).

## Status

Design only; no implementation in this PR. Open questions are tracked in
v2 §17; the full reviewer-comment → resolution map is in v2 §18.
