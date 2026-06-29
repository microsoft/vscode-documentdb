# Local Quick Start — v1 production-readiness gaps

**Status:** In progress · **Date:** 2026-06-26
**Scope:** Gap analysis between the production design
([`local-quickstart-v2.md`](./local-quickstart-v2.md) §15 v1.0 "must ship" + UX sections
§3–§12) and the current implementation (the POC on branch `feature/local-quickstart/POC`).
**Companion:** [`decision-instance-model.md`](./decision-instance-model.md) (single-instance v1).

This is the ranked work list to take Local Quick Start from a demo-POC to a shippable v1.
Ranking is by **user stakes**, not by effort. Each row cites the design section and the current
state. Checked rows are implemented in this branch.

## ✅ Already implemented (POC baseline)

Provision → 180 s wire-protocol readiness → inline browse · full 7-state machine + `Missing`
badge · all 8 lifecycle actions (Open/Start/Stop/Restart/View Logs/Copy Conn String/Copy
Password/Delete) · label-gated ownership (`vscode.documentdb.quickstart=1`) · restart-safe sample
data via `docker exec` of the image's native init script · masked OutputChannel · single managed
instance.

## 🔴 P0 — Correctness & data loss (will bite real users)

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P0‑1 | **Persistent data volume** | §8 defaults; §11 | **Ephemeral** (no volume) | Named volume `vscode-documentdb-local-data` mounted at **`/data`** (verified `DATA_PATH=/data`). Make sample-seeding **idempotent** (skip if `sampledb` exists). Align Delete to §11 (keep volume + creds → Missing); recreate reuses both. |
| P0‑2 | **Port-conflict fallback** | §8.3 | Pre-checks 10260, hard-errors if busy | Try 10260, then up to 10 random ports in `[10260,10360)`; yellow "using 10273 instead" banner; **use the bound port from `docker inspect`** when composing/saving the conn string. Explicit (Advanced) ports are never relocated — error instead. |
| P0‑3 | **Credential transport via env-file** | §8.2 | Password on `--username/--password` **CLI args** (leaks to `ps`/history) | Pass creds as `USERNAME`/`PASSWORD` via a temp `--env-file` (deleted in `finally`). **Verified the image reads these env vars** (entrypoint `${USERNAME:-}/${PASSWORD:-}`; CLI args only override) — resolves OPEN‑1. |

## 🟠 P1 — First-run UX (where impressions are made)

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P1‑1 | **Docker-not-ready diagnosis** | §5.3, §9 | One-line message + Retry | Per-check cards (CLI / daemon / platform), a **"Start Docker Desktop"** action (§13.2), and a Troubleshooting link. Docker-stopped is the most common first-run failure — a dead-end one-liner loses users. |
| P1‑2 | **Platform-supported check** | §9 | Not implemented | Detect unsupported CPU arch (amd64/arm64 ok); warn otherwise. |
| P1‑3 | **Success → tree handoff** | §5.5 | Auto-closes, no card buttons | Brief success card with **Open Connection** (reveal + expand the tree node) so the instance doesn't just "disappear". |
| P1‑4 | **Advanced panel** | §5.2 | Happy-path only | Custom port (drives the explicit-port branch of P0‑2), custom creds, image tag, seed toggle. (Breadth can phase into v1.1.) |

## 🟡 P2 — Ecosystem integration (upgrade trust)

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P2‑0 | **Decouple storage-zone from `isEmulator`** (prerequisite) | §7 | ✅ **Done** | Explicit `storageZone` on the model + `resolveStorageZone`; route all ops by it. Unblocks P2‑1/P2‑2. |
| P2‑1 | **Legacy emulator migration** | §4 | ✅ **Done** | One-time copy of `Emulators` → "Local Connections (Legacy)" folder (creds/auth/`emulatorConfiguration` preserved), keep Emulators as rollback, toast, retire `LocalEmulatorsItem`. 3-round 5-agent review; create-if-missing + race reconciliation. |
| P2‑2 | **TLS-exception step in the regular wizard** + connection edit dialog | §7, §7.3 | Not implemented (now unblocked by P2‑0) | The emulator wizard is being removed; this is its replacement. Gated host step defaulting to *Enable TLS*. |
| P2‑3 | **Manual-wizard `10255`→`10260`** | §13.5 | Not done | Design: *"must be fixed before Quick Start ships."* (Nuance: `10255` is also the Cosmos Mongo‑RU emulator port.) |

## 🔵 P3 — Observability & robustness

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P3‑1 | **Telemetry** | §14 | None | Event taxonomy (`quickstart.*`); never send names/ports/creds, only resolved semver. Expected for production. |
| P3‑2 | **Multi-window coordination** | §12 | Refresh-on-expand only | Destructive actions re-check live state; *"now Stopping from another window"* message. |
| P3‑3 | **Terminal-first transparency** | §5.4 | OutputChannel stream | Design runs docker as VS Code **terminal tasks** (Tomaz emphasized this). Confirm v1 decision vs. accepting the OutputChannel. |
| P3‑4 | **Accessibility** | — | Minimal | Live regions for staged progress + state changes; focus management (repo a11y skill). |
| P3‑5 | **Readiness on-timeout actions** | §9.1 | Errors only; 180 s | *Wait longer / Logs / Reset*; design timeout is 60 s (decide). |

## Recommended v1 cut line

- **Must-have:** P0‑1, P0‑2, P0‑3 · P1‑1, P1‑2 · P2‑1, P2‑3.
- **Strongly-want:** P1‑3 · P3‑1 · P3‑2 · P2‑2.
- **Can slip to v1.1:** P1‑4 breadth · P3‑3 (if OutputChannel accepted) · P3‑4 polish · P3‑5.

## Implementation log

- _2026-06-26_: doc created; image facts verified (`/data` volume mount, env-var creds, init dir
  `/init_doc_db.d`). Starting P0.
- _2026-06-26_: **P0 complete + verified live.**
  - **P0‑1 volume:** named volume `vscode-documentdb-local-data` at `/data`; seeding made
    **idempotent** (skip if `sampledb` exists); **Missing→recreate reuses stored creds + volume**
    (verified: data persists across container removal+recreate); **explicit Delete** now also drops
    the volume (honest clean slate — the data-preserving Reset split is v1.2).
  - **P0‑2 port fallback:** `findAvailablePort` (10260 → up to 10 random in band) + bound-port
    readback; substitution surfaced in the `checking` stage message. (Interactive
    "Change port" banner needs the Advanced panel, P1‑4.)
  - **P0‑3 env-file:** creds now pass via a temp `--env-file` (mode 600, deleted in `finally`) as
    `USERNAME`/`PASSWORD`; **verified live** the image authenticates with env-file creds and nothing
    lands on the docker CLI. Resolves OPEN‑1.
- _2026-06-26_: **P1‑1 + P1‑2 complete (build-verified).**
  - **P1‑2 platform:** `DockerReadiness` gains `arch`/`platformSupported` (host arch x64/arm64).
  - **P1‑1 diagnosis:** Docker-not-ready view rebuilt into per-check cards (CLI / daemon / platform)
    + **"Start Docker Desktop"** action (`startDockerDesktop`, best-effort per-OS launch) + Install /
    Troubleshooting links. Review "Data" card corrected to **Persistent volume**.
  - Gates green: l10n · prettier · lint · jest (2055/2055) · build · webpack-prod.
- _Remaining:_ P1‑4 Advanced panel, P2 (migration / TLS wizard / 10255), P3‑4 a11y, P3‑5
  readiness on-timeout actions.

- _2026-06-26_: **P1‑3 + P3‑1 + P3‑2 complete (build + gates verified).**
  - **P1‑3 success handoff:** success card now shows **Open Connection** (focuses the Connections
    view, then closes) + **Copy Connection String**; auto-close delay extended so the buttons are
    usable. New router mutations `openConnection` / `copyConnectionString`.
  - **P3‑2 multi-window:** `start/stop/restart` now re-check live Docker state via `liveStateGuard`
    immediately before acting; if another window already changed it, the tree refreshes and the user
    is told *"changed in another window (now …)"* instead of acting on stale state (§12).
  - **P3‑1 telemetry:** `documentDB.quickstart.provision` event (result · reused · portFallback ·
    provisionMs); `getDockerStatus` now reports `dockerReadiness` + `platformSupported`; lifecycle
    commands tag `action`. No names/ports/creds sent (§14).
  - Gates green: l10n · prettier · lint · jest (2055/2055) · build · webpack-prod.

- _2026-06-26_: **P2‑1 attempted → REVERTED (architectural blocker found by 5-agent review).**
  - A first cut (copy each `Emulators`-zone connection into a "Local Connections (Legacy)" folder
    in the `Clusters` zone, keep the Emulators zone as rollback, gate the legacy node on a
    completion flag) was implemented and passed all gates (build/lint/jest 2055).
  - The mandatory 5-agent rubber-duck review **caught a release blocker** (GPT‑5.4 + GPT‑5.5 REJECT;
    Opus 4.6/4.7 missed it). **Verified directly in code:** `emulatorConfiguration.isEmulator` is
    **overloaded** — it is the **storage-zone selector** in connect/rename/delete/move/
    update-credentials/update-connection-string paths and in `DocumentDBClusterItem`
    (`isEmulator ? Emulators : Clusters`), *and* `connectToClient.ts:25` **requires**
    `isEmulator && disableEmulatorSecurity` for local TLS-allow-invalid. So a migrated connection
    living in the `Clusters` zone cannot be made correct: keep `isEmulator=true` → all operations
    look it up in the **wrong zone** (broken connect/delete/rename); set `isEmulator=false` →
    **TLS-allow-invalid breaks** (can't reach the self-signed local server). The completion flag would
    then hide the working originals → effectively unreachable.
  - Citations: `src/commands/removeConnection/removeConnection.ts:81`,
    `src/commands/connections-view/moveItems/moveItems.ts:129`,
    `src/commands/updateCredentials/updateCredentials.ts:53`,
    `src/commands/updateConnectionString/updateConnectionString.ts:42`,
    `src/commands/connections-view/renameConnection/renameConnection.ts:24`,
    `src/tree/connections-view/DocumentDBClusterItem.ts:61,101,173`,
    `src/documentdb/connectToClient.ts:25`.
  - Secondary findings (also valid): `getAll()` triggers storage bootstrap **cleanup that iterates
    the Emulators zone** (weakens the "untouched rollback" guarantee); a snapshot **race** if emulator
    data changes during the migration window; corrupt/folder items skipped by the storage wrapper
    become invisible once the node is gated off.
  - **Conclusion:** P2‑1 has a hard **prerequisite (P2‑0)** — decouple *storage-zone selection* from
    `emulatorConfiguration.isEmulator` (add an explicit `storageZone`/`connectionType` on the
    connection model and route all operations by it; make TLS-allow-invalid depend on
    `disableEmulatorSecurity` alone). This is essentially the **§7** "move emulator/TLS handling out
    of a dedicated zone" work, and P2‑2 (TLS wizard) shares the same root cause. Reverted the cut;
    branch left clean.

- _2026-06-26_: **P2‑0 decoupling + P2‑1 migration — DONE (3-round 5-agent review, consensus on correctness).**
  - **P2‑0 (decouple zone from `isEmulator`):** added `storageZone?: StorageZone` to
    `ConnectionClusterModel` + a `resolveStorageZone(cluster)` helper (prefers explicit zone, falls
    back to the old `isEmulator` inference for safety). Stamped `storageZone` at the 3 construction
    sites (`ConnectionsBranchDataProvider`→Clusters, `FolderItem`→`_connectionType`,
    `LocalEmulatorsItem`→Emulators) and routed every zone decision through the helper
    (`DocumentDBClusterItem` ×3, `removeConnection`, `moveItems`, rename/updateCredentials/
    updateConnectionString wizards). `isEmulator` is kept ONLY for behaviour (TLS/timeouts/icons).
    +`resolveStorageZone` unit tests.
  - **P2‑1 (migration), now correct on the decoupled arch:** copies keep `isEmulator:true` for TLS
    and are rendered by `FolderItem` with `storageZone:Clusters`, so all operations route to Clusters.
  - **3 review rounds (GPT‑5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max):**
    - R1 → caught the architectural blocker (above) → led to P2‑0.
    - R2 on P2‑0+P2‑1 → **blocker resolved (5/5)**; found a partial-retry **BLOCKER** (overwrite could
      revert user edits) + a URI-handler **MAJOR** (deep-link saves to the hidden Emulators zone).
      Fixed: migration is now **create-if-missing** (never overwrites); URI handler routes new local
      connections to Clusters once retired.
    - R3 on the fixes → **unanimous the core is correct & data-safe; blocker stays resolved; no
      regression.** Applied the reviewers' remaining hardening: a **reconciliation re-scan** before the
      completion flag (closes the activation-window race), explicit `overwrite:false` (defense-in-depth),
      an `isFolder` guard on the reused legacy folder, and telemetry refinement.
  - **Known follow-up (pre-existing, documented):** the URI handler's deep-link **reveal** uses a flat
    tree path, so auto-reveal of a connection *nested in a folder* (incl. a migrated one) can fail; the
    connection is still found and navigable. Fix = folder-aware reveal via `buildFullTreePath` +
    recursive `findNodeById` (tracked, not a regression).
  - Gates green throughout: build · lint · jest (2058/2058, +3 tests) · l10n · prettier.
