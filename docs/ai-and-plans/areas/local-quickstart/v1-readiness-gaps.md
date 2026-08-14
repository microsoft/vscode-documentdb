---
area: local-quickstart
kind: checklist
status: active
created: 2026-06-26
code:
    - src/commands/localQuickStart/**
    - src/services/localQuickStart/**
    - src/tree/connections-view/LocalQuickStart/**
    - src/webviews/documentdb/localQuickStart/**
verified: 2026-08-14
---

# Local Quick Start — v1 production-readiness gaps

**Status:** In progress · **Date:** 2026-06-26
**Scope:** Gap analysis between the production design
([`local-quickstart-v2.md`](./design.md) §15 v1.0 "must ship" + UX sections
§3–§12) and the current implementation (the POC on branch `feature/local-quickstart/POC`).
**Companion:** [`decision-instance-model.md`](./decisions.md) (single-instance v1).

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
| P1‑4 | **Advanced panel** | §5.2 | ✅ **Done** | Collapsible Advanced panel: custom port (explicit-port branch of P0‑2), custom credentials, image tag, sample-data toggle. On reuse the creds/image fields hide (volume kept). 4-round 5-agent review (security + data-safety). |

## 🟡 P2 — Ecosystem integration (upgrade trust)

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P2‑0 | **Decouple storage-zone from `isEmulator`** (prerequisite) | §7 | ✅ **Done** | Explicit `storageZone` on the model + `resolveStorageZone`; route all ops by it. Unblocks P2‑1/P2‑2. |
| P2‑1 | **Legacy emulator migration** | §4 | ✅ **Done** | One-time copy of `Emulators` → "Local Connections (Legacy)" folder (creds/auth/`emulatorConfiguration` preserved), keep Emulators as rollback, toast, retire `LocalEmulatorsItem`. 3-round 5-agent review; create-if-missing + race reconciliation. |
| P2‑2 | **TLS-exception step in the regular wizard** + connection edit dialog | §7, §7.3 | ✅ **Done** (step); §7.3 edit dialog deferred | The emulator wizard is being removed; this is its replacement. Gated host step defaulting to *Enable TLS*; TLS-allow-invalid now keyed off `disableEmulatorSecurity` alone and host-gated to local/private hosts only. |
| P2‑3 | **Manual-wizard `10255`→`10260`** | §13.5 | ✅ **Done** | Design: *"must be fixed before Quick Start ships."* DocumentDB-local default is now `10260`; `10255` retained only for the Cosmos Mongo‑RU experience. |

## 🔵 P3 — Observability & robustness

| # | Gap | Design | Current | What's needed |
| - | --- | ------ | ------- | ------------- |
| P3‑1 | **Telemetry** | §14 | None | Event taxonomy (`quickstart.*`); never send names/ports/creds, only resolved semver. Expected for production. |
| P3‑2 | **Multi-window coordination** | §12 | Refresh-on-expand only | Destructive actions re-check live state; *"now Stopping from another window"* message. |
| P3‑3 | **Terminal-first transparency** | §5.4 | OutputChannel stream | Design runs docker as VS Code **terminal tasks** (Tomaz emphasized this). Confirm v1 decision vs. accepting the OutputChannel. |
| P3‑4 | **Accessibility** | — | ✅ **Done (v1.1)** | Per-field validation, live regions for staged progress + terminal states, list semantics, focus management (committed `8a08c2c3`). |
| P3‑5 | **Readiness on-timeout actions** | §9.1 | ✅ **Done (v1.1)** | On a readiness timeout the container is KEPT running and the webview offers **Wait longer** (re-probe, no re-pull) / **View logs** / **Start over** (discard; data-safe). Retain-and-resume state machine; 3-round 5-agent review. |

## Recommended v1 cut line

- **Must-have:** P0‑1, P0‑2, P0‑3 · P1‑1, P1‑2 · P2‑1, P2‑3.
- **Strongly-want:** P1‑3 · P3‑1 · P3‑2 · P2‑2.
- **Can slip to v1.1:** P3‑3 terminal-first (**in progress** — decided to align with the design) · P3‑4 a11y (**done**) · P3‑5 on-timeout (**done**).

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

- _2026-06-26_: **P2‑3 manual-wizard default port `10255`→`10260` — DONE (committed `441d9bda`).**
  - `newLocalConnection/PromptConnectionTypeStep.ts`: the **DocumentDB** local branch now defaults to
    `10260`; the **Cosmos Mongo‑RU** branch legitimately keeps `10255` (its real emulator port).
    `PromptPortStep.ts` default is now experience-aware. Resolves the §13.5 "must fix before ship".
  - Gates green: build · lint · jest · l10n.

- _2026-06-26_: **P2‑2 TLS-exception wizard (§7) — DONE (3-round 5-agent review, consensus on correctness).**
  - **Decouple TLS from `isEmulator`:** TLS-allow-invalid is now keyed off
    `emulatorConfiguration.disableEmulatorSecurity` **alone** at all five option-builder sites
    (`connectToClient`, `NativeAuthHandler`, `MicrosoftEntraIDAuthHandler`, `PlaygroundEvaluator`,
    `ShellSessionManager`); the fail-fast `serverSelectionTimeoutMS=4000` and the `ClustersClient`
    friendly-error messages were broadened from `isEmulator` to `isEmulator || disableEmulatorSecurity`.
    All 5 reviewers confirmed this weakens **no** existing connection (only emulator paths set the flag).
    Tree UX (`DocumentDBClusterItem`) keys its TLS description/tooltip off `disableEmulatorSecurity`.
  - **Single source of truth canonicalizer:** new `tlsException.ts` (`canonicalizeTlsException`,
    `stripTlsBypassParams`, `areAllHostsLocal`, `resolveAllowInvalidCertificates`). At **write time** it
    strips every TLS-bypass URL param (`tls/sslAllowInvalidCertificates`, `tlsInsecure`,
    `tls/sslAllowInvalidHostnames`, **and** `rejectUnauthorized` — inverse semantics, case-insensitive)
    from the **stored** string and host-gates the exception, so the wizard/deep-link/update can never
    create an accidental allow-invalid exception for a public host. Applied at all four write paths
    (PromptConnectionStringStep, newConnection/ExecuteStep, updateConnectionString/ExecuteStep,
    vscodeUriHandler).
  - **Host classifier hardening (§7.1):** `isLocalOrPrivateHost` now IDNA-normalizes the host
    (`normalizeHostForClassification`: maps the Unicode full-stop homographs U+3002/U+FF0E/U+FF61 → `.`,
    then `domainToASCII`) so a public domain (e.g. `example。com`, which DNS resolves as `example.com`)
    can't masquerade as a single-word local host.
  - **Hybrid runtime policy:** `resolveAllowInvalidCertificates(disableEmulatorSecurity, cs)` returns
    `true` only when `disableEmulatorSecurity && areAllHostsLocal(cs)`, else `undefined` (**never**
    `false`). The 5 builders honor the stored flag **only for local/private hosts**; for a public host a
    bare orphaned flag is **not** activated (so an old connection whose `tlsAllowInvalidCertificates`
    param was later edited out can't silently disable validation), while an explicit URL param is still
    honored by the driver (a self-hosted DB on a public hostname keeps working).
  - **7 review rounds (GPT‑5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max):**
    - R1 → confirmed the decoupling is safe; found a connection-string second-source-of-truth, a
      mixed-seed-list `.some` gap, the EntraID handler missing the flag, and `ClustersClient`/timeouts
      still keyed off `isEmulator`. Fixed via the shared canonicalizer + `.every` gating.
    - R2/R3 → caught + fixed a **latching BLOCKER** (the flag only ever *upgraded*), the **hostname-bypass**
      strip gap, and a shell **`isEmulator` mislabel**; both ExecuteSteps now authoritatively host-gate.
    - R4/R5 → caught the **Unicode-dot homograph** classifier bypass (fixed via IDNA normalization) and a
      `rejectUnauthorized` hygiene gap (now stripped). A runtime "force-validate public hosts" attempt was
      explored, then **rejected by the product owner** (it broke self-hosted public-host DBs and blocked the
      future §7.3 public-exception dialog).
    - R6/R7 → caught the **orphaned-flag** edge (a pre-existing public connection whose bypass param was
      edited out keeps an inert flag the decoupling would activate) → resolved with the **hybrid runtime
      policy** above, which honors explicit params but not bare flags on public hosts.
    - R8 → **consistency pass**: extended the same host-gate (`resolveAllowInvalidCertificates`) to every
      remaining flag-driven runtime surface — the 4s fail-fast `serverSelectionTimeoutMS`
      (NativeAuthHandler/PlaygroundEvaluator/ShellSessionManager), the `ClustersClient` "local instance"
      friendly-error copy, and the `DocumentDBClusterItem` "⚠ TLS/SSL Disabled" tree badge/tooltip — so an
      orphaned public-host flag is now **fully inert** (no allow-invalid, no fast-fail, no mislabel).
  - **§7.3 connection edit dialog deferred** — the design itself tracks it as a separate issue.
  - Gates green: build · lint · jest (2135/2135) · l10n · prettier · production webpack.

- _2026-06-30_: **P1‑4 Advanced panel (§5.2) — DONE (4-round 5-agent review, unanimous consensus).**
  - **Feature:** collapsible FluentUI Advanced accordion on the review screen — custom **host port**
    (feeds the explicit-port branch of P0‑2: a conflict errors, never auto-relocates), custom
    **username/password**, **image tag**, and a **Load sample data** toggle. A new
    `advancedOptionsSchema` (zod) validates on the wire; the summary + review cards reflect the
    effective port/image/credentials; a failed provision gets an **Edit settings** button back to the
    form. New `AdvancedQuickStartOptions`, `resolveQuickStartImage(tag)`, `StageEvent.boundPort`.
  - **Security (creds off the host shell, §8.2):** sample-data seeding runs the image's init script via
    `ContainerRuntime.execShellInContainer`, which references `"$USERNAME"`/`"$PASSWORD"` from the
    **container's own** env (set by the `--env-file` at run) inside a **`ShellQuoting.Strong`**-quoted
    `sh -c`. Verified end-to-end (WSL bash + lib trace + 5 agents): the host shell never expands the
    refs (single-quoted on bash, escaped-double-quoted on cmd; cmd ignores `$`), so credentials never
    hit the host argv/process list on **either** platform. This let the earlier `%`-in-password band-aid
    be removed (creds are validated control-char-only now — the env-file newline-injection vector stays
    blocked at zod + `writeEnvFile`; `%` round-trips safely via the env-file + percent-encoded conn
    string). _A first cut used the default array-arg quoting (`Escape`), which leaks/empties the refs on
    POSIX and word-splits on Windows — caught by the review and fixed to `Strong`._
  - **Data safety:** the reuse decision is now keyed on **stored credentials existing** (live
    SecretStorage), not the in-memory `Missing` flag, so re-running setup can **never** silently wipe a
    reusable data volume (e.g. after a window reload + external container removal). A fresh,
    volume-wiping provision is strictly the explicit **Delete**-then-recreate path.
  - **Recreate fidelity:** `InstanceMetadata.imageRef` + a durable `globalState` record
    (`documentdb.quickstart.imageRef`, written on provision, **backfilled on reconcile/adopt**, cleared
    on Delete) so a recreate — even across a reload — reuses the **original** image, not `latest`
    (the "image is kept" promise is now true). `getDockerStatus` surfaces a `willReuse` flag computed
    from the **same** predicate `provision()` uses, and the webview derives `isRecreate` strictly from
    it — so the credential/image inputs are hidden (and the summary relabels "Reused/Kept from the
    existing instance") whenever, and only when, the service will actually reuse.
  - **Also:** server-side both-or-neither credential `.refine()` (parity with the client); whitespace
    trim consistent client↔zod↔service; custom port preserved in the success message/conn string via a
    `chosenPort` inspect fallback; telemetry stays booleans-only (`customPort/customCreds/customImage/
    sampleData`).
  - **Review (GPT‑5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max):** R1 → env-file newline + client/server
    validation gaps. R2 → recreate image-tag loss + whitespace divergence + hardcoded review-card port.
    R3 → **the `Escape`→`Strong` seed-quoting fix** (independently reproduced by 3 agents) + durable
    reuse/UI-divergence blockers (GPT‑5.4/5.5/Opus‑4.8). R4 → durable `imageRef` + `willReuse` parity
    landed; GPT‑5.4's last two refinements (reconcile backfill, `isRecreate` strictly `= willReuse`)
    applied and re-confirmed → **unanimous APPROVE**.
  - Gates green: build · lint · jest (2139/2139) · l10n · prettier.

- _2026-06-30_: **P3‑4 Accessibility (v1.1) — DONE (committed `8a08c2c3`, 3-agent review).**
  - Advanced inputs now surface errors via FluentUI `Field` `validationState`/`validationMessage`
    (programmatically associated, `aria-invalid`) instead of one detached message; a polite live
    region streams the current provisioning stage; failed / Docker-not-ready states are announced;
    the stage list is `role="list"`/`listitem` with natural row `aria-label`s and decorative icons
    hidden; on failure the active stage flips to error (no stuck "in progress"); focus moves to the
    primary result action when provisioning ends. WCAG 2.4.3 / 3.3.1 / 1.1.1 / 4.1.3.
  - Gates green: build · lint · jest (2139/2139) · l10n · prettier.

- _2026-06-30_: **P3‑5 Readiness on-timeout actions (§9.1, v1.1) — DONE (3-round 5-agent review).**
  - **Behavior:** a readiness timeout no longer tears the container down. It is KEPT running (it may
    just be slow to initialize) and the webview offers **Wait longer** (re-probe the same container
    for another window — no re-pull), **View Docker output** (the §9.1 "Logs"), and **Start over**
    (discard; a fresh attempt's half-initialized volume is wiped, a reusing attempt's real data is
    kept). New `ReadinessTimeoutError`, `PendingReadiness` retained state, `resumeReadiness` generator,
    `discardTimedOutInstance`, `waitLonger` subscription + `discardTimedOut` mutation, and a
    `canResumeReadiness` status flag so reopening the panel rehydrates the recovery actions.
  - **Data safety (the hard part):** the provision `try/catch/finally` was refactored to extract a
    shared non-yielding `finalizeReadyInstance` while preserving the `setStatus(Running)→success=true`
    ordering (so an unsubscribe after the terminal event can never tear down a healthy container).
    Terminal events are **buffered and yielded after `finally`** so the flags are clean before the
    webview shows Wait longer / Retry (no fast-click race). A webview stream-generation guard ignores
    trailing callbacks from a superseded/cancelled stream.
  - **Reviewed 3 rounds (GPT‑5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max):** R1 → ~12 findings (races, cancel
    handling, resumable-state, telemetry, log streaming, focus) → hardening pass. R2 → **unanimous 5**;
    caught a **data-loss BLOCKER** (a well-meaning `reconcile` volume-removal that `!stored` doesn't
    prove is disposable — reverted to container-only cleanup). R3 (focused) → confirmed; the one
    late-callback concern was **empirically disproven** (the webview tRPC client unregisters its
    handler synchronously on unsubscribe, `vscodeLink.ts:187-199`) and additionally guarded.
  - **Known limitation (deferred to v1.2, all reviewers non-blocking):** after a window reload,
    `reconcile()` adopts a *reusing* timed-out container as `Running` without re-probing readiness —
    it could briefly show a not-yet-ready connection as healthy (no data loss; recoverable via
    Restart/Delete). Fix = a bounded `ping` before promoting to `Running`, or a durable pending marker.
  - Gates green: build · lint · jest (2139/2139) · l10n · prettier.

- _2026-07-01_: **Branch integration — POC merged into `dev/feature/local-quickstart` off `main`.**
  - The POC was **305 commits behind / 38 ahead** of `origin/main`. Created `dev/feature/local-quickstart`
    from `origin/main` and merged `feature/local-quickstart/POC` with `--no-ff` (commit `0a8b50e8`).
  - **3 conflicts resolved:** `ClustersClient.ts` (kept both imports); `DocumentDBClusterItem.ts` imports
    (kept main's superset); the **TLS badge** — semantically integrated POC's host-gated
    `resolveAllowInvalidCertificates` + emulator ✅ with main's non-emulator `isTlsDisabled()` branch
    (`if allow-invalid ⚠ · else if emulator ✅ · else if isTlsDisabled() ⚠`); `l10n/bundle.l10n.json`
    regenerated (1653 keys). Main added the `@kubernetes/client-node` dependency → `npm install`.
  - Verified: build · lint · **jest 2706/2706 (154 suites)** incl. the tlsException/hostClassification
    suites. Pushed explicitly to `dev/feature/local-quickstart` (not main).

- _2026-07-06_: **Holistic PR-readiness review (3 rubber-duck agents + direct code verification).**
  Lenses: **rd-design** (GPT‑5.5, design-completeness) · **rd-prod** (Opus 4.8, production) · **rd-pr**
  (Opus 4.7, PR/maintainer). rd-pr **independently validated the merge** — "no merge regression detected";
  the TLS-badge resolution matches runtime by construction (UI + `connectToClient`/auth handlers consult the
  **same** `resolveAllowInvalidCertificates`). **Bottom line: clean merge, well-reasoned code, but NOT ready
  to land as a single, always-on, unverified PR to main.**
  - **✅ Verified concrete bugs (confirmed in code this session):**
    - 🔴 **Published port binds `0.0.0.0`, not loopback** — `ContainerRuntime.ts:233` omits `hostIp`, and
      `@microsoft/vscode-container-client` `withDockerPortsArg` emits `--publish 10260:10260` → LAN-exposed
      DB, contradicting the "Runs on: This machine / localhost" UX (`LocalQuickStart.tsx:553,846`). **One-line
      fix:** pass `hostIp: '127.0.0.1'` (also makes the bind consistent with the `127.0.0.1` `isPortFree`
      pre-check at `ContainerRuntime.ts:170`).
    - 🟡 **Running tree row loses its description** — `QuickStartClusterItem` (`LocalQuickStartItem.ts:34,37`)
      sets `descriptionOverride = "Running · localhost:{port}"` but inherits `DocumentDBClusterItem.getTreeItem()`
      (`:452-462`), which returns the TLS-computed `description` and **ignores `descriptionOverride`** (the
      grandparent `ClusterItemBase.getTreeItem()` `:376` honors it; the subclass override drops it). So the
      Running row shows "⚠ TLS/SSL Disabled" instead of the port/state. **Pre-existing in the POC, NOT a merge
      regression** (verified against `feature/local-quickstart/POC`). Cosmetic. Fix = have the Quick Start item
      merge `descriptionOverride` with the badge (other state rows are plain `TreeElement`s and render fine).
  - **🔴 Consensus blockers (multiple agents):**
    - **No automated tests on the risk-bearing surface** (rd-prod C1 + rd-pr B2). `provision`/`resumeReadiness`/
      `discardTimedOutInstance`/`reconcile`/`liveStateGuard`/lifecycle — the code where **data loss and races
      live** — is guaranteed only by inspection; only pure functions are covered. Both note infra exists
      (singletons + `src/__mocks__/vscode.js`); the seam to add is an **injectable `ContainerRuntime` interface**.
      Highest-value: the cleanup matrix + `removeVolume` only-when-`!reusing` guard (`:315-317`), reuse decision
      (`:251-266`), timeout→resume (`:435-443`), `reconcile` no-secret-keeps-volume (`:1041-1053`).
    - **Never live-run in the *merged* state** (rd-prod C1/I8 + rd-pr B1). POC was live-verified 3× on Windows
      (each caught a real bug tests can't — verbatim args, restart-safety, false-`Running`); since then +305
      commits + 3 conflicts. **macOS/Linux never verified at all**; `startDockerDesktop` Linux path is a guess
      that returns `true` even when it no-ops (`ContainerRuntime.ts:399`).
    - **Terminal-first (§P3‑3) unresolved** (rd-design + rd-pr B3). Doc says "design-required by Tomaz, in
      progress"; code still uses `OutputChannel`. **Product decision — the item most likely to trigger a rewrite
      request at review.** Needs an explicit yes/no from the design owner before opening the PR.
  - **🟠 Missing (real gaps):** §7.3 TLS edit dialog · user-facing docs (CHANGELOG last at 0.9.1, no
    release-notes, no walkthrough step) · **i18n of service-originated strings** (`QuickStartService.ts` success
    headline `:428` + all error copy `:234,299,326,337,434,570,629,718,899,935` are hardcoded English; the l10n
    gate does **not** catch un-wrapped literals) · telemetry taxonomy reconciled with §14 (`documentDB.quickstart.*`
    vs design `quickstart.*`, **double-emitted** with the tRPC middleware auto-event) + verified against a real sink.
  - **🟠 Not considered (ops/edge):** `viewQuickStartLogs` leaks an **uncancellable `docker logs -f` per click**
    (`localQuickStartCommands.ts:102`) · **no timeout on a hung `docker info`** → dead spinner in `phase==='loading'`
    with no Cancel (`LocalQuickStart.tsx:724-729`) · **unconditional `docker ps` on every activation**
    (`reconcile()` cost for the non-user majority) · partial legacy-migration shows **silent duplicate** nodes ·
    Service Discovery port-forward hosts have **no `PromptTlsExceptionStep` path** · uninstall orphans
    container+volume+secret (inherent; document a pre-uninstall cleanup note).
  - **🔵 Reframed — intentional deviations, NOT oversights (reconcile with design owner; do NOT auto-"fix"):**
    - **Delete drops the volume** — documented v1.0 decision (log above) + matches the user's explicit
      delete-while-running data-loss-warning request. Design §11 keeps the volume on Delete (Reset is the
      destructive v1.2 split). *Needs sign-off, not a code change.*
    - **Success page stays open / no auto-close** and **Open Connection keeps the panel open** — explicit user
      feedback (committed `9342dbff`), deliberately overriding the design's auto-close.
    - **Single instance; recreate reuses volume+creds** — settled decision (`decision-instance-model.md`).
    - **180 s readiness timeout** vs the design's 60 s — chosen for slow first-pull safety; accept or align.
  - **📋 Procedural (rd-pr):** **split the 65-file / +8.8k-line PR into 3** — §7 TLS-exception (affects all
    users, well-tested) · P2 legacy migration (self-contained) · Quick Start (gate behind a flag). A reviewer
    can't catch a §7 regression buried under ~1.6k lines of Quick Start UI. **Add
    `documentDB.experimental.enableLocalQuickStart`** (precedent: `enableAIQueryGeneration`), default off until
    live-verified on all platforms.
  - **What's left for a successful review:**
    1. **Product decisions first (gate everything — for Tomaz):** terminal-first now/defer/renegotiate · PR split
       1-vs-3 · preview flag yes/no.
    2. **Verification:** live E2E on the *merged* branch, Windows + macOS min (fresh provision → legacy migration
       → stop/start/restart/delete → `reconcile()` after reload → Docker-daemon-absent).
    3. **Tests:** state-machine smoke tests (happy path + timeout→resume + `reconcile` cases) with an injected
       `ContainerRuntime`, **or** maintainer sign-off that live-Docker is the v0.10 acceptance bar.
    4. **Ship hygiene:** CHANGELOG + release-notes + tracking issues (§7.3, §P3‑3 if deferred, reconcile-reused-timeout v1.2 slip).
    5. **Quick wins (do now):** loopback bind (🔴 1 line) · Running-row description · `viewQuickStartLogs` follow-stream leak.
  - No code changed in this pass (review only); the three findings above are candidate fixes pending the product decisions.

- _2026-07-06_: **3 quick-win fixes from the PR-readiness review — DONE (5-agent review, all-correct consensus).**
  - **Loopback bind (security):** `ContainerRuntime.createAndRunContainer` now publishes the port with
    `hostIp: '127.0.0.1'` (`--publish 127.0.0.1:<port>:<port>`) so the local instance — auto-generated creds +
    TLS-allow-invalid — is no longer reachable from the LAN. Matches the `127.0.0.1` `isPortFree` pre-check and
    the "Runs on: This machine" UX.
  - **Running tree row description:** `QuickStartClusterItem` now overrides `getTreeItem()` to keep the base
    item (icon, security tooltip, context value) but force the state-aware description, so the Running row shows
    "Running · localhost:<port>" instead of the inherited "⚠ TLS/SSL Disabled" (the base
    `DocumentDBClusterItem.getTreeItem()` derives description from TLS state and ignores `descriptionOverride`).
    Only the Running row is affected; other states are plain `TreeElement` rows.
  - **`viewQuickStartLogs` follow leak:** the command now keeps a single module-level `CancellationTokenSource`
    and cancels/disposes the prior follow before starting a new one, so repeated "View Logs" clicks no longer
    stack concurrent `docker logs -f` streams (verified end-to-end: cancellation `tree-kill`s the child process,
    not just the read loop; the provisioning-side follow uses an independent CTS and is unaffected).
  - **5-agent review (GPT‑5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max):** all five confirmed the three changes are
    **correct and regression-free**; Fixes 2 & 3 unanimous with zero findings. Gates: prettier · lint (0 new) ·
    jest 2706/2706 · build.
  - **Tracked follow-up (out of scope for these quick-wins; feature is unreleased → no shipped users affected):**
    the loopback bind applies only to *newly created* containers — a container created before this fix keeps its
    0.0.0.0 binding through Start/Stop/Restart (Docker fixes port bindings at create time); only a re-provision
    (Delete → Quick Start) re-binds it. **Follow-up:** on `reconcile()`/adopt, detect a non-loopback published
    binding and re-secure via the data-safe recreate (reuse volume + creds), or at minimum a release-note
    callout. Raised by GPT‑5.4 (blocking) + Opus‑4.7 (non-blocking nit); deferred by decision (unreleased →
    a `docker rm` clears interim test containers).