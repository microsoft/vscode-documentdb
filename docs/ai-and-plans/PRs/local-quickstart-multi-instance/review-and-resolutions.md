# Multi-Instance Plan — Review & Resolutions

Companion to [`implementation-plan.md`](./implementation-plan.md). Records the 5-agent plan review
and how each finding was resolved into the plan.

## Round 1 — plan review (2026-07-06)

**Reviewers:** GPT-5.4 (xhigh), GPT-5.5 (xhigh), Opus 4.6 (max), Opus 4.7 (max), Opus 4.8 (max),
each reading the plan + the actual Quick Start code.

**Verdict:** 4× NEEDS CHANGES, 1× "sound with clarifications" (Opus 4.6). **No re-architecture
required** — the identity/keying model, backward compat, and migration completeness were
independently **verified correct** by all five. All findings are targeted edits to close
data-safety and lifecycle gaps. Every reviewer confirmed:

- `containerName(DEFAULT_ALIAS)` / `volumeName(DEFAULT_ALIAS)` equal today's constants → existing
  container/volume adopted with **no rename** (`quickStartTypes.ts:51,64`).
- Only two persisted keys exist (`SECRET_KEY`, `IMAGE_REF_STATE_KEY`) → migration is complete.
- `clusterId` is ephemeral (never persisted) → safe to re-derive with no migration.
- Ownership boundary / non-goals preserved (label-only; no adopt-unmanaged; ephemeral instances).

### Findings & resolutions (consensus)

| # | Severity | Finding (raised by) | Resolution in plan |
| - | -------- | ------------------- | ------------------ |
| R1 | **Blocker (data loss)** | Migration must run **before** `reconcile()` and any `provision()`; else reconcile finds no alias-keyed secret → removes the container, and a re-provision reads no creds → `reusing=false` → **wipes the volume** (opus47, gpt55) | §6 rewritten: migration is `await`ed at activation **before** `reconcile()`/any command; wiring becomes `await migrate(); void reconcile();`. §7 adds invariant: destructive paths (volume wipe, orphan removal) **fall back to the legacy flat key** if the alias-keyed value is absent. §8 adds the legacy-only-at-activation test. |
| R2 | **Blocker (data safety)** | reconcile's "labelled container with **no stored secret** → remove container" branch (`QuickStartService.ts:1042-1054`) contradicts §7.4 and can tear down a sibling / adopted instance — German's "stray delete" (opus48) | §4.3/§7.4: the legacy orphan-removal-on-no-secret branch is **removed** for multi-instance. A credential-less/unknown-alias labelled container is **surfaced** as a state row (“needs recreate / credentials unavailable”), **never auto-removed**, volume never touched. |
| R3 | **Blocker** | Port allocation must reserve **stopped** siblings' ports (baked into container config; `docker start` later fails), not just `isPortFree` live binds; registry `{alias,displayName}` can't express this (all 5) | §4.1/§4.2: registry record gains **`port`**. Allocation (and explicit-Advanced-port validation) reserves **every** registry port (running/stopped) **plus** in-flight reservations, then `isPortFree`. §8: “#2 skips a **stopped** #1's port”. |
| R4 | **Blocker/Major** | `InstanceRuntimeState` omits `missing`; `isBusy`/`willReuseExistingInstance` must be per-alias or one instance corrupts another's badge/guards/UI (all 5) | §4.3: add `missing: boolean`; `isBusy(alias)`, `willReuseExistingInstance(alias)` alias-scoped; any aggregate status named explicitly. |
| R5 | **Blocker/Major** | Alias reservation + registry lifecycle race: allocate-on-open vs register-on-provision; parallel provisions + cross-window globalState RMW clobber; tree only reads in-memory aliases (gpt54, opus47, gpt55, opus48) | §4.2 rewritten: **register the alias at provision START** (so a per-instance Provisioning row + panel stay consistent); reconcile **tolerates** a registry alias with no container mid-provision (does not flip to Missing); **cleanup on abort/failure before container creation** (no stale entry). Every registry mutation is `read→mutate→write` under a **per-process async lock**; the tree **re-reads the registry on every refresh**. Alias suffix is **monotonic** (`nextAliasSuffix` in globalState); allocation considers registry + live labels + unlabelled container names. |
| R6 | **Major (ownership boundary)** | Generated aliases need the decision-doc §10.2 **collision preflight** vs unlabelled containers (gpt55) | §7 + WI-2: before pull/create, **inspect `containerName(alias)`**; if it exists and is **not** quickstart-labelled → fail with a clear inline error, **never touch it**. Alias generation skips names held by unlabelled containers. |
| R7 | **Major** | Enumerate the singleton destructive call sites: `findManagedContainer()→list[0]` (used in provision pre-clean + orphan sweep) and hardcoded volume wipes (`:316,:682,:972`); `isManaged` must require **both** labels (opus48, gpt55) | WI-2 lists exact sites: `findManagedContainer(alias)` (filter alias label) at `:310-314`/`:469`; `volumeName(alias)`/`containerName(alias)` at `:316,:682,:972`; `isManaged(id, alias)` requires `quickstart=1` **and** matching alias (legacy no-alias only for `DEFAULT_ALIAS`). §8: `provision(B)` leaves A's container **and** volume. |
| R8 | **Major** | Non-Delete destructive paths uncovered: `discardTimedOut(A)`, orphan reconcile cleanup, failed/cancelled provision (gpt54, opus47, gpt55, opus48) | §7/§8: invariants + tests for discard(A)!→B, orphan-sweep(A)!→B, cancelled provision(B)!→A and leaves **no** stale registry/reservation. |
| R9 | **Major** | Tree “Provisioning…” row is global + hardcoded `localhost:10260`; §4.4 omits a Provisioning state (opus48, opus47) | §4.4: add a **per-instance** Provisioning row (no hardcoded port); registry entry at provision start makes it consistent. |
| R10 | **Major** | Panel create-or-reveal per alias — framework docs say consumer-owned; double-open spawns duplicate panels driving the same alias (opus47, gpt55, opus48) | WI-4: controller keeps `Map<alias, AppWebviewController>`; on open, reveal an existing non-disposed panel; evict on dispose. Applies to recreate-Missing **and** ＋New (its key = the newly allocated alias). |
| R11 | **Major** | Command→alias resolution spans **two** node shapes (`QuickStartClusterItem` model row vs generic element); alias must be stamped on **both** (opus48) | WI-5: stamp the alias uniformly on both node kinds; confirm handlers accept the node arg; `start/stop/restart/delete/copy*/viewLogs` read it consistently. |
| R12 | **Major** | Injectable `ContainerRuntime` seam is a real ~20-site refactor and a prerequisite for **every** test — not a §8 aside (opus48) | New **WI-0**: extract the `ContainerRuntime` interface + inject into the service, first (Docker-free tests become possible). |
| R13 | **Major** | WI-2 breaks the build (contract requires each WI committable) unless callers keep compat (gpt55) | WI-2 keeps **default-alias wrapper overloads** (old signatures delegate to `alias = DEFAULT_ALIAS`) until WI-3/4/5 migrate call sites. |
| R14 | **Minor** | reconcile: a `quickstart=1` container with **absent/empty** alias label must default to `DEFAULT_ALIAS`, not a phantom `undefined` instance (all 5) | §7.4: `const alias = labels[ALIAS_LABEL] || DEFAULT_ALIAS`; two containers sharing an alias → deterministic winner, log, leave the other untouched. §8 covers both. |
| R15 | **Suggestion** | Perf: `refreshLiveState()` per-alias = N sequential `docker inspect`; missing WIs (＋New command + `package.json` contribution, `.open` alias selection); shared OutputChannel interleaves N logs; migration downgrade note; display-name schema/UI vs auto-fill | WI-2: `refreshLiveState()` = **one** `listByLabel` indexed by id. WI-3/5: add ＋New command id + `view/item/context` contribution + `.open` alias selection. WI-5: **per-alias output channels** (or alias-prefixed lines). §6: downgrade note. §3/U2: **auto-fill** display name (no prompt), rename deferred → no schema change needed now. |

### Net (round 1)
Foundation validated by all five; ~15 targeted edits folded in (data-safety ordering, sibling
isolation, port/alias/registry lifecycle, concurrency, collision preflight, testability seam).

## Round 2 — confirmation review (2026-07-06)

Same five reviewers, on plan v2. **opus-4.8 verified every R1–R15 resolution against the code**
(line numbers accurate; the R7 destructive-site enumeration is **complete**). **Verdict: WI-0 is
unanimously READY to start** (2 explicit READY, 3 "READY for WI-0, fix the below before WI-2"); **no
established-data-loss blocker** (persisted per-alias secret ⇒ `reusing=true` ⇒ volume kept). The
residual items are WI-2-scoped plan edits, now folded into **plan v3**:

| # | Severity | Finding (raised by) | Resolution in plan v3 |
| - | -------- | ------------------- | --------------------- |
| RR1 | Blocker→Major | Per-process lock can't serialize two windows; `nextSuffix`/alias/port can clobber; a sibling window can flip a mid-provision alias to Missing; crash leaves a phantom (gpt54, gpt55, opus47, opus48) | §4.2 rewritten: cross-window races **degrade safely** (Docker name/port uniqueness); **`operationId`-guarded pre-clean** (never removes another window's container); **`nextSuffix` self-heals** in reconcile; **provisioning lease** (fresh→Provisioning, stale→scavenge). Don't claim the lock prevents clobber. |
| RR2 | Major | R15's one-`listByLabel` **erases stopped-instance ports** (`docker ps -a` omits host-port for stopped) → reintroduces R3 collision (opus48) | §4.3: `refreshLiveState` updates `port` **only for running**, **never clears** it; `registry.port` **authoritative** for stopped; adoption/migration populate it via `inspect`. §7.3, §8 test. |

## Code review — WI-2b/2c/2d foundation (3-agent data-safety sanity check, 2026-07)

**Reviewers:** Opus 4.8 (max), GPT-5.5 (xhigh), Opus 4.7 (max) — rubber-duck, code-reading only, focused
on the plan §5 data-safety invariants. **Verdict (consensus): the WI-2b/2c/2d foundation has NO
currently-triggerable data-safety bug.** All destructive ops are alias-scoped; reconcile never removes
a container or wipes a volume; `aliasMatches` cannot cross-adopt (suffixed containers always carry their
own label; the empty/absent-label→DEFAULT fallback only ever matches genuine legacy = DEFAULT);
`stateFor` returns a stable per-alias object; migration-before-reconcile ordering intact; the tree does
not regress (a reloaded ready-record-no-container default falls through to the rocket, recreate reuses
the volume). Findings are landmines that activate in WI-2e or cheap hardening:

| # | Severity | Finding (raised by) | Resolution |
| - | -------- | ------------------- | ---------- |
| C1 | **HIGH (data loss)** | `provision(!reusing)` runs `removeVolume` on a **credential-unavailable** instance (container+volume, no secret). WI-2d made it worse: reconcile now *surfaces* it with a "recoverable — use Delete" message, but the only 1-click tree action (rocket → webview → provision) silently wipes (gpt55, opus47) | **FIXED now (WI-2e-1):** `provision` RR4 wipe-gate — when `!reusing` AND (a managed container exists OR a durable `'ready'` record exists), surface `CREDENTIAL_UNAVAILABLE_MESSAGE` and abort instead of removing/wiping. Only a truly-fresh alias (no container, no `'ready'` record) may wipe (a safe no-op/clean-slate). The container-present vs container-absent distinction cleanly separates credential-unavailable (container kept by reconcile) from a dead failed-attempt orphan (container removed by provision's `finally`). Full lease/`operationId` refinement still lands in WI-2e-2. |
| C2 | MEDIUM (concurrency) | reconcile scavenge filters **by alias only**; a concurrent adopt/finalize upsert between the stale-decision and the locked write is dropped (all 3, unanimous) | **FIXED now (WI-2e-1):** phase-guard the delete at write time — remove only if still `phase:'provisioning'` AND still stale inside the locked mutator. Dormant until WI-2e writes leases, but closed now. |
| C3 | MEDIUM (concurrency) | `refreshLiveState` captures `entry`, awaits `inspect`, and a concurrent `deleteContainer` clearing `entry.metadata` makes it write `missing=true` onto cleared metadata (opus47) | **FIXED now (WI-2e-1):** capture `containerId` before the await; skip the mutation if `entry.metadata?.containerId` changed (delete/re-adopt raced). |
| C4 | MEDIUM (WI-2e landmine) | `provision`'s orphan-sweep `findManagedContainer()` (`:572`) + ~24 `stateFor(DEFAULT_ALIAS)` refs in `provision`/`resumeReadiness`/`discardTimedOutInstance` are DEFAULT-hardwired — correct today, cross-instance leak if WI-2e's "allocate at Start" only changes the `const alias` (opus48 N1, opus47) | **WI-2e-2 checklist:** thread the owning `alias` through *every* `stateFor(...)`/`findManagedContainer(...)`/`setStatus(...)` in those 3 methods (not just the `const alias =`); the `pendingReadiness` write especially must use the owning alias or DEFAULT's leaks. Enumerated for the WI-2e PR. |
| C5 | LOW (hardening) | Empty-`alias`-label container buckets to DEFAULT — a hypothetical foreign/malformed empty-label container could be adopted as DEFAULT (gpt55); `deleteContainer` skips `isManaged` when `missing` (gpt55) | **Deferred (WI-2e-2 / optional):** opus48+opus47 rate non-triggerable (we always stamp the alias label; ids aren't recycled). Optional: scope the no-label fallback to `containerName(DEFAULT_ALIAS)`, and always `isManaged`-verify before remove. |
| C6 | LOW (UX) | Adopted-but-unregistered container ⇒ `displayName = raw alias`; credential-unavailable has no 1-click tree Delete (rocket only) (opus47) | **Deferred (WI-3 tree):** derive `DocumentDB Local N`; render credential-unavailable as an instance row with Delete. Safe (no data loss) after C1; purely UX. |
| RR3 | Major | Contradiction: register-at-provision-start (§4.2) vs "＋New allocates alias at panel open" (§4.5/WI-4) reintroduces stale reservations (gpt54, gpt55) | §4.5/§4.2: **＋New opens a DRAFT panel** (draft id, no alias); `startQuickStart` allocates at Start. |
| RR4 | Major | R2 fixed reconcile, but a user-clicked **recreate** on a credential-less instance still hits `reusing=false ⇒ removeVolume` (opus47, opus48) | §4.3/§7.10: credential-unavailable renders a **distinct state** (not Missing); **Delete behind confirmation, no silent recreate-wipe**. §8 test. |
| RR5 | Major | Migration `port` source unspecified — upgrading user may run on a non-10260 port (gpt55) | §6: derive port from legacy conn-string → `inspect` binding → `QUICK_START_PORT`. §8 test. |
| RR6 | Major | Log isolation only scoped `viewQuickStartLogs`; pull/create/start still share one channel (gpt54) | §4.5: **all** Quick-Start runtime output is per-alias (channel or prefixed). |
| RR7 | Minor | Port must be picked **inside** the lock, not just the write (opus47, opus48) | §4.2/§7.3: the whole pick→reserve→write is one lock acquisition. |
| RR8 | Minor | `nextSuffix` initial value unstated (gpt54, opus47) | §4.2: fresh registry `nextSuffix = 2`. |
| RR9 | Minor | WI-0 is ~38 call sites (not ~20); pure inspectors `isRunning`/`getBoundHostPort` should be standalone functions, not interface methods (opus46, opus48) | §5 WI-0 updated. |

### Net (round 2)
No re-architecture; the identity/keying/migration/isolation core is code-verified. **WI-0 can start
immediately** (decoupled, behavior-preserving). The WI-2 concurrency spec is now explicit; a light
round-3 can confirm before the WI-2 PR, but WI-0/WI-1 don't depend on it.
