---
feature: local-quickstart
kind: iteration
status: historical
created: 2026-07-06
---

# WI-2 core — execution plan (the multi-instance service state machine)

> Elaborates [`implementation-plan.md`](./implementation-plan.md) §4.2/§4.3/§5 WI-2 + §7/§8 into a
> committable, verifiable sub-step sequence. Round-1/2 findings: [`review-and-resolutions.md`](./review-and-resolutions.md).
> **Status:** IMPLEMENTING — plan v2 (round-1 5-agent review folded in, see §8).
> **Done:** WI-2b (`365dcd72`), WI-2c (`b8af43cc`), WI-2d (`d9f2a133`, registry-driven reconcile + R2
> inversion), **WI-2e-1** (`3dcd4d0f`, RR4 volume-wipe gate + scavenge phase-guard + refreshLiveState
> stale-entry guard — from a 3-agent foundation review, then **5-agent confirmation: 5/5 APPROVE**).
> Full jest 2801/2801, build/lint/prettier green. **Next: WI-2e-2 (allocation core).**
> **WI-2e-2 checklist (folds in review finding C4 — the DEFAULT-hardwired provision path):** allocate a
> fresh alias + port at Start for `+New` (async `updateRegistry` mutator; reserve every registry port
> running+stopped + in-flight; bind the reserved port, never re-pick); write the `provisioning` lease
> AFTER Docker/port checks; `operationId` pre-clean decision table (own-id for recreate, op-guarded for
> `+New`, skip no-op-label); collision preflight (never touch an unlabelled name holder); `nextSuffix`
> self-heal (incl. unlabelled name holders). **Thread the OWNING alias through EVERY `stateFor(...)`/
> `findManagedContainer(...)`/`setStatus(...)` in `provision` (~15 refs incl. the `:572` orphan-sweep +
> `:580` reset), `resumeReadiness` (~7), `discardTimedOutInstance` (~2)** — NOT just the `const alias =`;
> the `pendingReadiness` write especially must use the owning alias or DEFAULT's leaks (opus47/opus48 C4).
> Also skip in-flight aliases in `reconcileAlias` (opus48 S2). Then WI-2f: full matrix + mandatory 5-agent review.
> **Deviation note (WI-2c):** `liveStateGuard(id)` / `confirmStaysRunning(id)` act purely on a container
> id — the per-instance message is a WI-4 l10n change, so no `alias` param was added.
> **Prereqs done:** WI-0 (injectable `ContainerRuntime`), WI-1 (identity + keying + migration),
> WI-2 part 1 (registry authoritative: `upsert/removeInstanceRecord`, finalize upsert, delete remove).

---

## 1. Goal (definition of done)

The **service layer** (`src/services/localQuickStart/QuickStartService.ts`) manages **N independent
instances**, each keyed by an immutable `alias`, each with its own container / volume / port /
credentials / cache key — with the specified cross-window concurrency and **every data-safety
invariant preserved**, and **fully unit-tested**. The existing single-instance UI keeps working
unchanged (via `DEFAULT_ALIAS`) until WI-3 exposes N.

### Non-goals for WI-2 (they CONSUME WI-2's API)
- Tree N rows + "＋ New instance" (WI-3), webview alias-scoping + `Map<alias,controller>` (WI-4),
  command alias resolution + per-alias output channel (WI-5), live Docker E2E (WI-7).

### API WI-2 must expose for WI-3/4/5 (revised per round-1 review)
- `getStatus(alias = DEFAULT_ALIAS): QuickStartStatus` (unchanged; the router keeps calling it no-arg).
- `listStatuses(): InstanceStatus[]` where **`InstanceStatus = { alias; displayName; state:
  InstanceState; missing: boolean; port?: number; errorMessage?; canResumeReadiness: boolean;
  metadata?: InstanceMetadata }`** — a richer per-instance snapshot (m3/gpt54/opus46/gpt55). Rationale:
  `QuickStartStatus.metadata` is absent for Provisioning / Missing / credential-unavailable rows, so the
  tree needs top-level `alias`/`displayName`/`port` to render + key every row. `Missing` has no enum
  value — it's the `missing` boolean overlaid on `state` (as today). Ordering: `DEFAULT_ALIAS` first,
  then registry insertion order (suffix `-2, -3, …`).
- `provision(signal, options?, alias?)`, `resumeReadiness(signal, alias = DEFAULT_ALIAS)`,
  `discardTimedOutInstance(alias = DEFAULT_ALIAS)`. **Allocation is at Start, inside `provision`**
  (NOT a separate `allocateNewInstance` — that contradicted the round-2 "＋New opens a draft panel,
  allocate at Start" decision, impl-plan §4.5, and had no access to `options.port`). When `alias` is
  omitted → `DEFAULT_ALIAS`; a distinct **`draft` marker** (or `alias === undefined && isNewInstance`
  flag) tells provision to **allocate a fresh alias + port from `options`**, then **yield an early
  `StageEvent` carrying the allocated alias** so the draft panel can bind its subscription.
- `start/stop/restart/deleteContainer/viewLogs(alias = DEFAULT_ALIAS)`,
  `willReuseExistingInstance(alias = DEFAULT_ALIAS)`.
- **`isBusy` stays a getter** (`get isBusy(): boolean` = `stateFor(DEFAULT_ALIAS).provisioning ||
  lifecycleBusy`) so `localQuickStartRouter.ts:110`'s property access still compiles; add
  **`isBusyFor(alias): boolean`** for WI-3/4/5 (all 5 reviewers — `isBusy` is a getter, not overloadable).

Optional trailing `alias` params keep every current caller (router/tree/commands) compiling (R13)
**except `isBusy`** (kept as a getter); WI-4/5 pass the real alias.

---

## 2. Starting shape (current single-instance code)

- **State fields** (`:171-182`): `state / metadata / errorMessage / missing / provisioning /
  pendingReadiness / lifecycleBusy` — all single-valued.
- **Methods**: `provision` (`:250`), `finalizeReadyInstance` (`:546`), `resumeReadiness` (`:588`),
  `discardTimedOutInstance` (`:690`), `waitForReadiness` (`:713`), `start/stop/restart` (`:884-980`),
  `deleteContainer` (`:991`), `refreshLiveState`, `reconcile` (`:1066`), `runLifecycle`,
  `liveStateGuard`, `findManagedContainer` (`list[0]`, `:856`), `isManaged` (`:850`),
  `getReusableCredentials`/`readStoredConnectionString`/`willReuseExistingInstance`,
  `populateCredentialCache`.
- **Registry** (WI-1/2a): schema `{alias, displayName, port, phase, operationId?, leaseAt?}` +
  `readRegistry`/`updateRegistry`/`upsertInstanceRecord`/`removeInstanceRecord`/migration —
  **written but not yet READ for logic**.
- Container/volume/keys hardwired to the `DEFAULT_ALIAS`-derived constants.

---

## 3. Sub-steps (each a green, committable commit)

### WI-2b — State model: fields → `Map<alias, InstanceRuntimeState>` (behavior-preserving)
- Add `interface InstanceRuntimeState { alias; displayName; port?; metadata?; state; provisioning;
  lifecycleBusy; missing; pendingReadiness?; errorMessage? }` + `private instances = Map<string,
  InstanceRuntimeState>()` + `private stateFor(alias): InstanceRuntimeState` (lazy default).
- Route every `this.<field>` through `stateFor(alias)`. `setStatus(alias, state, metadata?, error?)`;
  `getStatus(alias = DEFAULT_ALIAS)`; add `listStatuses()` (a per-alias `InstanceStatus` — for 2b, just
  `DEFAULT_ALIAS`). **Keep `get isBusy()`** (DEFAULT); add `isBusyFor(alias)` (m1 — `isBusy` is a getter).
- **PendingReadiness gains `alias` + `displayName`** (opus47-B2) so `finalizeReadyInstance` /
  `resumeReadiness` / `discardTimedOutInstance` operate on the owning alias (finalize today hardcodes
  `alias: DEFAULT_ALIAS`, `clusterId: QUICK_START_CLUSTER_ID` at `:565/:578` — these must derive from
  the alias). Assert `pending.alias === alias` in discard/resume (defensive, opus46).
- **Preserved invariants (do NOT let the mechanical port break these):**
  - `stateFor(alias).provisioning = false` stays **inside `finally`**, and the buffered `terminalEvent`
    is yielded **after** `finally` — the race-avoidance ordering is load-bearing (opus47-B3). Same for
    `resumeReadiness`'s `pendingReadiness` clear + `provisioning=false`.
  - The `statusEmitter` stays a **single shared** emitter (the tree re-reads `listStatuses()` on any
    change) — not per-alias (opus47-s2).
  - `refreshLiveState()` stays **`DEFAULT_ALIAS`-only** in 2b (iterate in 2d).
- **Explicit semantic note (opus47-M5):** routing the `provisioning`/`lifecycleBusy` guards through
  `stateFor(alias)` **narrows** them from *any-instance-busy* to *this-instance-busy*. In single-alias
  use (all callers pass `DEFAULT_ALIAS`) behavior is unchanged; multi-alias concurrency is enabled by
  construction here and exercised in 2d/2e.
- *Verify:* build + full jest green, no observable behavior change.

### WI-2c — Alias-thread the methods + alias-derived names/keys (behavior-preserving)
- Optional trailing `alias = DEFAULT_ALIAS` on the §1 methods **and the private helpers that carry
  `lifecycleBusy`/inspect**: `runLifecycle(alias, …)`, `liveStateGuard(alias)`, `confirmStaysRunning(…, alias)`
  (opus48-Q3), plus `getReusableCredentials(alias)` / `readStoredConnectionString(alias)`.
- Replace hardwired constants with `containerName(alias)/volumeName(alias)/secretKey(alias)/
  imageRefKey(alias)/clusterId(alias)`.
- **`findManagedContainer(alias)` AND `isManaged(id, alias)` both take the legacy fallback (m3/gpt55/
  opus47/opus48):** match a container whose `alias` label equals `alias`, **OR (when `alias ===
  DEFAULT_ALIAS`) whose alias label is absent/empty** — so a pre-alias-label legacy container is still
  found/adopted for `DEFAULT_ALIAS` (2c stays behavior-preserving). `readStoredConnectionString(alias)`
  reads `secretKey(alias)`, legacy fallback **only** for `DEFAULT_ALIAS`.
- *Verify:* build + full jest green (behavior identical at `DEFAULT_ALIAS`).

### WI-2d — Registry-driven reconcile + `listStatuses` + lease Missing (multi-instance becomes real)
- `reconcile()`: **one** `listByLabel({quickstart:1})` → group by `labels[ALIAS_LABEL] || DEFAULT_ALIAS`;
  union with `readRegistry()`; build per-alias `InstanceRuntimeState` by this **precedence** (gpt54/opus48):
  1. **Container present** → adopt (running→Running, exited→Stopped); write **`imageRefKey(alias)`**
     per-alias (opus47-m1). A stale lease with a container present is still **adopted, NOT scavenged**
     (a slow/on-timeout provision keeps its container — opus48-Q4). Backfill `registry.port` from inspect.
  2. **No container + fresh `phase:'provisioning'` lease** → **Provisioning** (regardless of a
     half-created container that isn't listed yet — a fresh in-flight container with no secret is
     Provisioning, **never** credential-unavailable).
  3. **No container + (stale lease OR `phase:'ready'`)** → **Missing** + scavenge the stale pre-create
     reservation.
  4. **Container present + no fresh lease + no recoverable secret** → **credential-unavailable**
     (`InstanceState.Error` + message) — surfaced, **never removed**, volume never touched (R2).
  - Same-alias duplicate containers → deterministic winner (most-recently-created), log, leave the other.
  - **`nextSuffix` self-heal** = `max(existing suffixes across registry + live container names, incl.
    unlabelled name holders)+1` (gpt55-minor9).
- `listStatuses(): InstanceStatus[]` for **every** known alias (registry ∪ adopted), ordered
  `DEFAULT_ALIAS` first then suffix.
- `refreshLiveState()`: single `listByLabel`, index by id, update all known aliases — **but SKIP any
  alias where `stateFor(alias).provisioning || lifecycleBusy`** (never clobber an in-flight alias; a
  sibling being busy does NOT skip others — opus47-M6/opus48-M4). `registry.port` authoritative for
  stopped (never cleared; update port only for running). **Scavenge is NOT done here** — reconcile
  (activation) only (opus48-m5).
- **Update the existing R2 test** `QuickStartService.test.ts:142-162` (`removeContainer` was asserted
  called) → the no-secret orphan is now **surfaced** (Error/credential-unavailable), `removeContainer`
  **NOT** called, volume never touched (opus46/opus47/opus48).
- *Verify:* new multi-instance tests (§6) + all existing tests green.

### WI-2e — Allocation-at-Start + provision concurrency
- **Async registry lock (gpt54/gpt55/opus48-M2 — a required WI-1-code touch):** change
  `updateRegistry` to accept an **async** mutator (`(registry) => T | Promise<T>`, `await` before
  `globalState.update`) so the whole *pick-port → reserve → write* runs under one acquisition.
- **Port reservation (opus48-M2):** allocation must exclude **every registry port (running+stopped) +
  in-flight** — either give `findAvailablePort` an **exclusion set** (interface + impl + mock) or run
  the exclusion loop service-side via `isPortFree`. An explicit `options.port` (Advanced) is honored
  and **rejected if sibling-reserved**. **`provision(alias)` BINDS the reserved `registry.port`** — it
  must NOT re-pick (else bound ≠ reserved, defeating R3).
- **Allocation-at-Start:** for a NEW instance, `provision` (draft path) allocates `nextSuffix` + port +
  writes `{alias, displayName, port, phase:'provisioning', operationId, leaseAt}` **after the Docker/port
  checks pass** (so the Docker-not-ready / port-busy early returns at `:325/:351/:362` never leave a
  phantom reservation — opus48-m4), then yields the alias to the panel. For `DEFAULT_ALIAS`/recreate,
  the lease is written similarly.
- **Pre-clean DECISION TABLE (gpt55-B2/opus47-M7/opus48-M1):**
  | Case | Pre-clean action |
  | --- | --- |
  | Recreate/reuse of an existing instance (alias has a `ready` record/metadata) | Remove the **known owned container id** (from metadata/registry) — no nonce guard; the reused volume is kept |
  | Fresh `+New` allocation, same-alias container with **matching** `op` label | Remove (ours, in-flight) |
  | Same-alias container with a **different/absent** `op` label | **Skip** — another window's in-flight or a legacy container; let `docker run` fail the loser cleanly |
  | `containerName(alias)` held by an **unlabelled** container | Collision preflight → **fail inline**, never touch (R6) |
- **Recreate-of-`ready` registry safety (opus47-M1):** before overwriting a `'ready'` record with a
  `'provisioning'` lease, **snapshot** it; on abort/failure **restore** the prior `'ready'` record
  (don't drop the creds+volume signal). Fully remove the reservation only for a **newly allocated** alias.
- **Lease TTL (opus48-m5):** the provisioning-lease staleness threshold must **exceed the worst-case
  first image pull** (renew `leaseAt` per stage, or a generous TTL) — the pull precedes any container.
- `finalizeReadyInstance(alias)` upserts `'ready'` (clears `op`/`lease`), binds the metadata alias/clusterId.
- **Provision outcome table** (what happens to container + reservation on each exit):
  | Exit | Container | Reservation |
  | --- | --- | --- |
  | success | kept, Running | upsert `ready` (clear op/lease) |
  | readiness timeout | **kept** (+ `pendingReadiness`) | keep `provisioning` lease |
  | resume success | kept | `ready` |
  | discard (Start over) | remove own; wipe volume only if `!reusing` | remove own reservation |
  | cancel/error/unsubscribe before finalize | remove own `op`-container if created | remove own reservation (restore prior `ready` if recreate) |
  | cleanup can't confirm removal | leave as-is | leave lease → reconcile scavenges |
- *Verify:* allocation / port-reservation-incl-stopped / collision-preflight / operationId-recreate /
  early-failure-no-phantom / lease-TTL tests + all green.

### WI-2f — Tests + 5-agent review (the whole WI-2 core)
- The §6 matrix; then the mandated 5-agent review before merge of the WI-2 core. *(Optional: a lighter
  1–3 agent sanity check after 2c, before 2d/2e depend on the alias-threading — opus47-s3.)*

---

## 4. Concurrency model (concrete)
Registry mutations run under a **per-process async lock** (WI-2e upgrades `updateRegistry` to an
**async mutator** so the *pick-port → reserve → write* is one acquisition — the current sync mutator
can't hold the lock across an async port probe). Cross-window safety = **Docker container-name +
host-port uniqueness** (a genuine double-allocate fails at `docker run`; loser errors cleanly) +
**pre-clean per the §3 WI-2e table** (own-id for recreate; op-guarded for `+New`; never touch a
container you didn't create) + **`nextSuffix` self-heal** in reconcile + a **provisioning lease**
(fresh → Provisioning; stale → recoverable Missing + scavenge). The lease TTL must **exceed the
worst-case first image pull** (renew per stage, or a generous TTL) so a slow pull isn't seen as stale;
**scavenge fires only in reconcile (activation)**, never in the per-render `refreshLiveState`.
Established data is never lost: persisted per-alias secret ⇒ `reusing=true` ⇒ volume kept; and the
volume-wipe gate additionally requires a truly-fresh alias / explicit confirmation (§5.2).

## 5. Data-safety invariants (must hold at EVERY sub-step)
1. Delete/Stop/Restart/discard/pre-clean on A never touch B's container/volume/creds/cache.
2. **Volume-wipe requires `!reusing` AND a truly-fresh alias** (no existing managed container/volume
   for this alias) **or an explicit caller confirmation flag** — NOT just `reusing=false`. In
   particular a **credential-unavailable** instance (labelled container + on-disk volume, no readable
   secret) yields `reusing=false`; a `provision(alias)`/recreate on it must **NOT wipe** — it must fail
   or require explicit Delete (RR4 / impl-plan §7.10; gpt55/opus48). Always `volumeName(alias)`.
3. Reconcile never cross-adopts and **never auto-removes** a credential-less labelled container.
4. Port allocation reserves every registry port (running+stopped) + in-flight; explicit Advanced port
   rejects sibling-reserved; `provision` binds the **reserved** port (never re-picks).
5. Collision preflight: never touch an unlabelled container holding `containerName(alias)`.
6. Pre-clean per the §3 WI-2e decision table (own-id for recreate; op-guarded for `+New`; no-op-label
   ⇒ skip); cleanup by owner only.
7. **`refreshLiveState` never clobbers an in-flight alias** (skips `provisioning`/`lifecycleBusy`
   aliases) and **never scavenges** — scavenge is reconcile-only (activation).
8. Migration ordering + legacy fallback (WI-1) intact; loopback bind per instance.

## 6. Test plan (WI-0 injectable runtime + mocked `ext`)
**Isolation & reconcile:**
- Provision two instances → two containers/volumes/ports/secrets, no overlap.
- **Delete A leaves B**; `provision(B)` leaves A's container **and** volume; `discardTimedOut(A)` /
  orphan-sweep use `volumeName(A)` only and never touch B.
- reconcile with two labelled containers → two states by alias; **credential-unavailable → surfaced
  (Error, not removed)**; absent-label → `DEFAULT_ALIAS`; idempotent; `nextSuffix` heal (incl. from
  live container names).
- **Container present + stale lease → adopt, do NOT scavenge** (Q4 invariant, opus48).

**Ports & allocation:**
- Port allocation for #2 skips #1 even when **Stopped**; explicit Advanced port colliding a stopped
  sibling → error; `provision` binds the reserved port.
- Explicit-Advanced-port allocation on a **new** alias reserves + binds that port.

**Concurrency (the per-alias-flag payoff):**
- `provision(A)` ∥ `provision(B)` → both succeed, distinct ports/volumes/secrets; `provisioning(A)` and
  `provisioning(B)` transition independently; no cross-writes to secretStorage/globalState/registry.
- `start(A)` ∥ `stop(B)` → both complete (per-alias `lifecycleBusy`, not global serialization).
- `resumeReadiness(A)` ∥ `provision(B)` → A's `pendingReadiness` untouched; B's finalize doesn't clear A's.
- `provision(B)` racing `deleteContainer(A)`'s `removeInstanceRecord` → registry mutations serialize
  under the (async) per-process lock; both records converge.
- `refreshLiveState` during a `provision(A)` does **not** clobber A's in-flight state.

**Recreate / credential-safety / cross-window:**
- Same-window recreate removes the instance's **own prior container** (created under a *different*
  original nonce) → recreate succeeds (M1).
- **Recreate on a credential-unavailable alias does NOT wipe** the volume (RR4).
- Legacy no-op-label container present for `DEFAULT_ALIAS` → adoption takes over (`reusing=true`), no
  removal, no wipe.
- Lease-scavenge + `nextSuffix`-heal in one reconcile (window A allocated `-3` `provisioning` then
  crashed; window B reconcile scavenges the stale reservation AND heals `nextSuffix`; next allocate
  picks a valid free suffix).
- Recreate-of-`ready` DEFAULT aborts → the prior `'ready'` registry record is restored (creds+volume
  signal intact); volume never touched.
- Migration (WI-1) + a second instance coexist.

## 7. Risks & open decisions
- **Biggest risk:** WI-2b touches every field access in a ~1,120-line stateful file. Mitigation:
  mechanical, method-by-method, existing tests as guardrail, build after each method.
- **Open (minor):** `operationId` label key (propose `vscode.documentdb.op`); keep `getStatus()`
  no-arg for the router until WI-4 (yes); does `deleteContainer(alias)` also `removeInstanceRecord`
  (yes — generalize WI-2a) and `finalize` upsert per alias (yes).
- **Sequencing:** 2b→2c behavior-preserving (green throughout); 2d→2e add multi-instance behavior
  (tested); 2f reviews the whole. Each sub-step is its own commit.

---

## 8. Round-1 plan-review resolutions (2026-07-06)

5 reviewers (GPT-5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max): **4 NEEDS-CHANGES, 1 SOUND-with-NBs.** All
confirmed the 2b→2c→2d→2e sequencing is sound and the round-2 concurrency decisions are carried; the
findings are targeted plan edits (no re-architecture), all folded into v2 above:

| Finding (reviewers) | Resolution |
| --- | --- |
| `operationId` guard breaks single-window recreate (gpt55/opus47/opus48) | §3 WI-2e **pre-clean decision table**: recreate removes the own container id; only `+New` is op-guarded; no-op-label ⇒ skip. |
| Atomic pick-port-under-lock + stopped-exclusion not realizable (gpt54/gpt55/opus48) | §3 WI-2e/§4: **async `updateRegistry` mutator**; `findAvailablePort` **exclusion set**; provision **binds the reserved port**. |
| RR4 credential-unavailable recreate wipe dropped (gpt55/opus48) | §5.2 invariant + §6 test — wipe requires truly-fresh alias / explicit confirmation. |
| `refreshLiveState` clobbers in-flight aliases; scavenge on per-render (opus47/opus48) | §3 WI-2d/§5.7 — skip busy aliases; **scavenge reconcile-only**. |
| `isBusy` is a getter (all 5) | §1 — keep `get isBusy()`, add `isBusyFor(alias)`. |
| `listStatuses(): QuickStartStatus[]` too weak (gpt54/opus46/gpt55) | §1 — `InstanceStatus { alias, displayName, state, missing, port?, … }`. |
| `allocateNewInstance()` vs round-2 draft-panel + explicit port (gpt54/gpt55) | §1/§3 WI-2e — allocate **inside provision at Start** from `options`; yield the alias. |
| `PendingReadiness` lacks `alias`; finalize hardcodes DEFAULT (opus46/opus47) | §3 WI-2b — add `alias`/`displayName`; metadata alias/clusterId derive from alias. |
| buffered-terminalEvent + `provisioning=false`-in-`finally` ordering (opus47) | §3 WI-2b — listed as a **preserved invariant**. |
| WI-2b silently narrows global→per-alias guard (opus47) | §3 WI-2b — stated explicitly. |
| `findManagedContainer` legacy no-label→DEFAULT fallback in 2c (gpt55/opus47/opus48) | §3 WI-2c — fallback on **both** helpers. |
| R2 existing test inverts at 2d (opus46/opus47/opus48) | §3 WI-2d — rewrite `QuickStartService.test.ts:142-162`. |
| lease TTL vs slow first pull; recreate-of-ready registry restore (opus48/opus47) | §3 WI-2e/§4 — TTL > worst-case pull; snapshot/restore the prior `ready` record. |
| early-failure returns leave phantom reservation (opus48) | §3 WI-2e — register lease **after** Docker/port checks pass. |
| per-alias `imageRef` in reconcile; nextSuffix from live names; concurrency tests (opus47/gpt55/opus46) | §3 WI-2d + §6 test matrix. |

**Not blocking / accepted:** `statusEmitter` stays shared; `getStatus()` stays no-arg for the router;
a lighter sanity check after 2c is optional (opus47-s3).

