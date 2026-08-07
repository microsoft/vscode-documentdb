# Local Quick Start — Multiple Managed Instances: Implementation Plan

> Full design: [`local-quickstart-v2.md`](../../local-quickstart/local-quickstart-v2.md).
> Reverses: [`decision-instance-model.md`](../../local-quickstart/decision-instance-model.md)
> (single-instance v1 → **multi-instance in v1**, per owner decision 2026-07-06).
> Running gap log: [`v1-readiness-gaps.md`](../../local-quickstart/v1-readiness-gaps.md).
> Review history & resolutions: `review-and-resolutions.md` (created after the 5-agent review).
>
> **Audience:** an implementation agent (Opus/Sonnet-class) or a developer.
> **Status:** **PLAN v3 — round-1 + round-2 5-agent reviews folded in (see
> [`review-and-resolutions.md`](./review-and-resolutions.md)); owner decisions resolved (§10).
> Round-2: WI-0 unanimously READY; remaining items are WI-2-scoped and specified. Ready to start WI-0.**
> **Goal:** let a user run **N** independent managed local DocumentDB instances from Quick
> Start, each with its own container, volume, port, and credentials — while keeping the
> first instance a one-click, zero-decision experience.

---

## 0. How the implementing agent must work (process contract)

1. **Work item by work item.** Numbered **WI-n**. Do one at a time; commit per WI.
2. **This plan is the source of truth.** After each WI, tick its checkbox + append a one-line outcome.
3. **Data-safety gate.** This refactor touches the volume/credential/teardown paths. Every WI that
   changes the service MUST preserve the invariants in §7 and add/extend the tests in §8. If
   confidence in any non-obvious data-safety decision is **< 80%**, stop and ask.
4. **5-agent review** (GPT-5.4/5.5 xhigh, Opus 4.6/4.7/4.8 max) on WI-1, WI-2, and the final
   integration — all must agree before commit (owner workflow).
5. **PR checklist before declaring a WI done:** `npm run l10n` (if user-facing strings changed) →
   `npm run prettier-fix` → `npm run lint` → `npx jest --no-coverage` → `npm run build`. (`npm run
   build`, never `compile`.)
6. **Terminology:** "DocumentDB" for the service; "MongoDB API"/"DocumentDB API" for the wire
   protocol. Never "MongoDB" alone. All user-facing strings via `vscode.l10n.t()`.
7. **No `any`.** `unknown` + type guards. Explicit return types. `instanceof Error` in catch.
8. **Cluster ID rule (repo convention):** cache lookups (CredentialCache/ClustersClient) use the
   stable per-instance `clusterId`, never the tree `treeId`.

---

## 1. Goal, UX narrative, and non-goals

### Goal
From the **DocumentDB Local - Quick Start** node the user can create, browse, and manage **several**
independent local DocumentDB instances side by side — the concrete use cases German raised
(compare image vX vs vY; isolate project A from project B) without leaving the one-click flow.

### UX narrative
- **First instance stays one click.** Empty state → rocket → provisioning panel → Start → Running
  row. No naming step required (a sensible default name is pre-filled).
- **Add another:** a persistent **“＋ New instance”** row under the Quick Start node opens a fresh
  provisioning panel for a new instance (its own port auto-picked, its own credentials).
- **The node lists all instances**, each an expandable Running row (browse inline) or a state row
  (Stopped/Starting/Missing/Error) carrying the existing lifecycle menus. Delete/Stop/Start act on
  **that** instance only.

### Non-goals (unchanged from the design)
- **Adopting unlabelled / hand-run containers** — still out. Recognition stays **label-only**
  (`vscode.documentdb.quickstart=1`); those connect via the regular wizard (design §13.10).
- **Auto-discovery** of non-managed DocumentDB containers — belongs to the generic connections
  experience, not Quick Start.
- **Cross-instance orchestration** (compose, dependency graphs) — out.

---

## 2. Decision reversal (record for reviewers)

`decision-instance-model.md` locked v1 to a single managed instance (raised by German Eichberger,
re-affirmed 2026-06-30). On **2026-07-06** the owner directed building **full multi-instance in
v1**. This plan supersedes that decision; WI-6 updates `decision-instance-model.md` with the
reversal + rationale so the record stays coherent. The label model that decision preserved is
exactly what makes this additive — **there is no data migration for the existing single instance**
beyond re-keying two flat storage keys (§6).

---

## 3. UX design decisions (proposed — reviewers/owner confirm)

| # | Decision | Proposal | Rationale |
| - | -------- | -------- | --------- |
| U1 | **Identity** | Each instance has an immutable **alias** (slug; also the Docker container name + `vscode.documentdb.alias` label) and an editable **display name**. | Alias is the stable key for names/creds/cache; display name is the human label. |
| U2 | **First instance = zero decisions** | The provisioning panel pre-fills a default name; the user can just click **Start**. No mandatory naming prompt. | Preserves the “one click” value prop; naming is opt-in. |
| U3 | **Default alias** | First instance keeps alias/container `vscode-documentdb-local` and volume `vscode-documentdb-local-data` (today’s names). | **Backward compatible** — the existing instance is adopted unchanged. |
| U4 | **New-instance aliases** | Auto-generated, **monotonic** suffix from `registry.nextSuffix` (`vscode-documentdb-local-2`, `-3`, … — never reused after delete, since suffixes leak into container names/logs). Allocation also avoids names held by unlabelled containers (§7 preflight). | Predictable, DNS/label-safe, no user typing; monotonic avoids confusing reuse. |
| U5 | **Creation entry points** | (a) rocket empty-state (instance #1); (b) a persistent **“＋ New instance”** action row when ≥1 instance exists. Both open a provisioning panel bound to a new alias. | Matches the design’s “rocket hides after setup” but replaces it with an explicit add affordance. |
| U6 | **Managing an instance** | Lifecycle via the existing tree context menus (per-row). Reopening the webview for an existing instance (resume on-timeout, next-steps) targets that alias. | Reuses shipped lifecycle UI; only adds alias-scoping. |
| U7 | **Cap** | No hard cap; add a **soft warning** in the panel when many (~5+) are running (owner decision: in scope). | Docker/OS already bounds this; a cap adds a decision. |
| U8 | **Persistence model** | Each instance stays **ephemeral/CredentialCache-based** (not saved into a storage zone), exactly like today’s single instance. | Keeps the ownership boundary; no zone/tree-shape churn. |

**Plan default (per review R15):** U2 **auto-fills** the display name (no prompt, no schema change) so
the first instance stays one click and later ones don't derail into a naming step. Renaming an
instance is deferred (v-next). **OPEN for owner:** if you prefer an explicit **name prompt** on
“＋ New instance”, only the provisioning panel gains a name field — the architecture below is identical.

---

## 4. Architecture: from singleton to per-alias

### 4.1 Identity + keying (the core change)
Introduce pure derivation helpers keyed on `alias` (in `quickStartTypes.ts`), replacing the flat
constants. `DEFAULT_ALIAS = 'vscode-documentdb-local'`.

| Concept | Today (flat) | Per-alias derivation |
| ------- | ------------ | -------------------- |
| Container name | `vscode-documentdb-local` | `containerName(alias) = alias` |
| Volume name | `vscode-documentdb-local-data` | `volumeName(alias) = alias + '-data'` |
| Cache key (clusterId) | `quickstart-local-documentdb` | `clusterId(alias) = 'quickstart-' + alias` *(ephemeral — no migration)* |
| SecretStorage key | `documentdb.quickstart.connectionString` | `secretKey(alias) = 'documentdb.quickstart.' + alias + '.connectionString'` |
| imageRef globalState key | `documentdb.quickstart.imageRef` | `imageRefKey(alias) = 'documentdb.quickstart.' + alias + '.imageRef'` |
| Label(s) | `quickstart=1` (+ `alias` already stamped) | unchanged; the `alias` label is the reconcile join key |
| Port | `10260` default | per-instance, auto-allocated from `[10260,10360)` (existing `findAvailablePort`) |

With `containerName(DEFAULT_ALIAS)==='vscode-documentdb-local'` and
`volumeName(DEFAULT_ALIAS)==='vscode-documentdb-local-data'`, the existing container/volume need
**no rename**. Only `secretKey`/`imageRefKey` differ from the legacy flat keys → one-time migration
(§6).

### 4.2 Instance registry (new, persisted) + reservation & cross-window model
A `globalState` object records known instances + the monotonic suffix + a provisioning lease:

```
documentdb.quickstart.registry = {
  nextSuffix: number,                          // monotonic; HEALED in reconcile (see below)
  instances: Array<{
    alias, displayName,
    port,                                       // AUTHORITATIVE for stopped instances (R3/Major-2)
    phase: 'provisioning' | 'ready',
    operationId?: string,                       // owner nonce of the in-flight provision
    leaseAt?: number,                           // provisioning lease timestamp (crash/cross-window)
  }>,
}
```

**Allocation happens at provision START, inside ONE locked critical section (Minor-1):** pick the next
`nextSuffix`; `findAvailablePort` **excluding every registry `port` (running OR stopped) + in-flight
reservations**; then write `{alias, port, phase:'provisioning', operationId, leaseAt:now}` — the whole
*pick-port → reserve → write* sequence under a single lock acquisition. **“＋ New instance” opens a
draft panel** (draft id, no alias yet); `startQuickStart` performs the allocation — this fixes the
allocate-at-open contradiction (a closed/abandoned draft panel reserves nothing). Fresh registry:
`nextSuffix = 2` (DEFAULT_ALIAS carries no suffix).

**Cross-window safety is best-effort + self-healing, NOT lock-based (Major-1).** A per-process async
lock cannot serialize two VS Code windows over `globalState` (separate hosts; last-writer-wins, no
cross-process CAS). So the model is:
- **Races degrade safely.** Docker **container-name + host-port uniqueness** make a genuine
  double-allocate fail at `docker run` — the loser errors cleanly. Established instances are **never
  lost** because their **persisted per-alias secret ⇒ `reusing=true` ⇒ volume kept**.
- **Pre-clean is `operationId`-guarded (opus47-M2):** the provision pre-clean / `findManagedContainer`
  destructive path removes only a container whose owner nonce matches **this** provision — it **never**
  removes another window's same-alias container. Cleanup on abort removes only this `operationId`'s
  reservation.
- **`nextSuffix` self-heals:** `reconcile()` sets `nextSuffix = max(existing suffixes) + 1`, so a
  clobbered counter corrects itself.
- **Provisioning lease (`leaseAt`):** any window renders a `phase:'provisioning'` entry with a **fresh**
  lease as **Provisioning** (not Missing, not touched); a **stale** lease (> readiness timeout ⇒ crashed
  host) is a recoverable **Missing** and its pre-create reservation is **scavenged** at reconcile
  (closes the crash-orphan hole, §7.8).
- The tree **re-reads the registry on every `refreshLiveState()`**. Multi-window *state sync* stays
  **best-effort** (consistent with the shipped single-instance model, design §12) — but *allocation* and
  *destructive pre-clean* are race-safe. Do **not** claim the lock prevents cross-window clobber.

### 4.3 Service state: `Map<alias, InstanceRuntimeState>`
`QuickStartServiceImpl` today holds single fields (`metadata`, `pendingReadiness`, `provisioning`,
`lifecycleBusy`, `missing`, `state`, `errorMessage`). Replace with a per-alias map:

```
private instances = new Map<string /*alias*/, InstanceRuntimeState>();
interface InstanceRuntimeState {
  alias: string; displayName: string; port?: number;
  metadata?: InstanceMetadata; state: InstanceState;
  provisioning: boolean; lifecycleBusy: boolean; missing: boolean;   // R4: missing is per-alias
  pendingReadiness?: PendingReadiness; errorMessage?: string;
}
```

Every public method gains an `alias` parameter (or returns a keyed collection). **WI-2 keeps
default-alias wrapper overloads** (old signatures delegate to `alias = DEFAULT_ALIAS`) so each WI
stays committable until callers migrate (R13):
- `provision(alias, opts)` / `resumeReadiness(alias)` / `discardTimedOut(alias)`
- `start/stop/restart/deleteContainer/viewLogs(alias)`
- `getStatus(alias)` **and** `listStatuses(): QuickStartStatus[]` (tree uses the list)
- `isBusy(alias)` and `willReuseExistingInstance(alias)` are **alias-scoped** (R4); any aggregate
  status is named explicitly.
- `refreshLiveState()` issues **one** `listByLabel({quickstart:1})`, indexes results by container id,
  and updates every known alias from that single response (R15 — not N `docker inspect`s);
  `liveStateGuard(alias)` scopes to one. **Port caveat (Major-2):** `docker ps -a` omits host-port
  bindings for **stopped** containers, so `refreshLiveState` updates `port` **only for running**
  containers and **never clears** a stored `registry.port`. `registry.port` is **authoritative** for
  stopped instances (populated once via `inspect` at adoption/migration while discoverable).

**Singleton destructive call sites that MUST become per-alias (R7 — exact sites):**
- `findManagedContainer()` returns `listByLabel(...)[0]` (`QuickStartService.ts:825-828`) → **must be
  `findManagedContainer(alias)`** filtering on the `alias` label. Used in provision pre-clean
  (`:310-314`) and the post-failure orphan sweep (`:469`) — otherwise provisioning/failing **B**
  removes **A**.
- Every volume/container op takes the alias: fresh-wipe (`:316`), `discardTimedOutInstance` (`:682`),
  `deleteContainer` (`:972`) → `volumeName(alias)`/`containerName(alias)`.
- `isManaged(id)` (`:850-852`) → `isManaged(id, alias)` requires `quickstart=1` **AND** matching alias
  (legacy no-alias allowed **only** for `DEFAULT_ALIAS`).

**`reconcile()` rules (R2, R14 + round-2):** enumerate `listByLabel({quickstart:1})`, then per container
`const alias = labels[ALIAS_LABEL] || DEFAULT_ALIAS`:
- Adopt into that alias's `InstanceRuntimeState`; populate `registry.port` from `inspect` bindings if
  absent. A container whose alias isn't in the registry is added (adopted) — **never merged**.
- **Heal `nextSuffix = max(existing suffixes) + 1`** so a cross-window-clobbered counter self-corrects.
- **The legacy “no stored secret → remove the container” branch is REMOVED** (R2): a labelled
  container with no recoverable secret is **surfaced** in a **distinct `InstanceState`** (not `Missing`
  — its volume data is unreachable; e.g. `Error` with a “credentials unavailable” message or a
  `NeedsRecreate` token, Minor-2), whose row offers **Delete** (behind the data-loss confirmation) but
  **no silent recreate**, and its **volume is never touched**.
- Two containers sharing one alias → deterministic winner (most recently created), **log** the
  collision, **leave the other untouched**.
- **Lease-based Provisioning vs Missing (Major-1):** a registered alias with **no container** and a
  **fresh** `phase:'provisioning'` lease → render **Provisioning** (don't touch); with a **stale** lease
  (> readiness timeout) or `phase:'ready'` → **Missing** (and scavenge a stale pre-create reservation).

### 4.4 Tree
`LocalQuickStartItem.getChildren()` becomes: `refreshLiveState()` → `listStatuses()` → render **one
row per instance** (per-alias `id = ${this.id}/instance/${alias}`; Running → `QuickStartClusterItem`
expandable, else a state row) → append the persistent **“＋ New instance”** action row. Zero
instances → today’s rocket empty-state (creates instance #1). Row labels use the **display name**
+ `· localhost:<port>`. The per-state switch gains a **per-instance Provisioning** case (R9) with
**no hardcoded port** — today `LocalQuickStartItem.ts:159-168` renders a single global
`Provisioning… · localhost:10260` row that can't represent #2 provisioning while #1 runs.

### 4.5 Webview + router + commands
- The provisioning panel carries a **target alias** (a controller/panel param). Its tRPC
  subscription/mutations (`startQuickStart`, `waitLonger`, `discardTimedOut`, `getDockerStatus`,
  `openConnection`, …) all take/thread the alias.
- **Create-or-reveal per alias (R10):** the controller keeps a `Map<key, AppWebviewController>`;
  on open, if a non-disposed panel exists for that key, `revealToForeground()` and return; evict on
  dispose. **“＋ New instance” opens a DRAFT panel** keyed by a draft id (no alias yet — a
  closed/abandoned draft reserves nothing); `startQuickStart` allocates+registers the alias at Start
  (§4.2). The rocket/`.open` targets `DEFAULT_ALIAS` when none exists; an existing instance's panel is
  keyed by its alias.
- Lifecycle commands (`localQuickStartCommands.ts`) resolve the alias from the **invoking tree node**.
  The alias is **stamped on both node kinds (R11)** — the `QuickStartClusterItem` model row **and**
  the `createGenericElementWithContext` generic rows — so `start/stop/restart/delete/copy*/viewLogs`
  read it uniformly. **All Quick-Start runtime output is alias-scoped** — a **per-alias output channel**
  (or alias-prefixed lines) for `viewQuickStartLogs` **and** the pull/create/start streams — not just
  `viewQuickStartLogs`; `viewQuickStartLogs` also keeps a **`Map<alias, CTS>`** (R15).

---

## 5. Work items (sequenced, each committable + reviewable)

- [x] **WI-0 — Testability seam (R12).** Extract a `ContainerRuntime` **interface** and inject it into
  the service (today it's a module singleton called at **~38 sites**, with **no** service test). The
  **pure inspectors `isRunning(item)` / `getBoundHostPort(item)` become standalone exported functions**
  (no IO → keep the interface = IO surface only). Enables Docker-free tests for every later WI. No
  behavior change. **Unanimously green in round-2 — safe to start immediately, decoupled from WI-1/2.**
  - _Done:_ `IContainerRuntime` (13 IO methods) extracted; `ContainerRuntimeImpl implements
    IContainerRuntime`; `isRunning`/`getBoundHostPort` now standalone exports; `QuickStartServiceImpl`
    gains `constructor(runtime: IContainerRuntime = ContainerRuntime)` + `this.runtime.*` (31 sites) and
    is `export`ed for test injection. Behavior-preserving. Gates: build · lint · jest **2768/2768**.
- [x] **WI-1 — Identity & keying foundation.** Add `DEFAULT_ALIAS` + derivation helpers
  (`containerName/volumeName/clusterId/secretKey/imageRefKey`), the registry (§4.2) + locked
  `globalState` accessors, and the **legacy-key migration** (§6). **Also repoint the still-singleton
  service to the alias-keyed (`DEFAULT_ALIAS`) keys** so WI-1 is independently safe (R1/gpt55): the
  service must not read a flat key the migration just deleted. Pure + storage; fully unit-testable.
  *(5-agent review.)*
  - _Done:_ `DEFAULT_ALIAS` + `containerName/volumeName/clusterId/secretKey/imageRefKey` helpers
    (backward-compat: default maps to the legacy container/volume names) + `LEGACY_*` keys;
    `quickStartRegistry.ts` (registry schema with lease/`operationId`, per-process-locked
    `updateRegistry`, **step-wise resumable** `migrateLegacyQuickStartKeys` — `await`ed before
    reconcile, copy→ensure→delete-legacy-last, port derived from conn-string/inspect); service
    repointed to alias-keyed keys with a **legacy fallback** on the volume-wipe-gating reads + the
    imageRef reuse chain; Delete purges legacy keys. **2 review rounds (initial + fix confirmation),
    5-agent — round-2 unanimous APPROVE.** Note: `QUICK_START_CLUSTER_ID` value changed
    (`quickstart-local-documentdb` → `quickstart-vscode-documentdb-local`) — ephemeral cache key only.
    Deferred to WI-2 (registry becomes read there): `deleteContainer`/`finalizeReadyInstance` must
    remove/upsert the alias's registry record (currently write-only, so inert). Gates: build · lint ·
    jest **2787** (+21 tests).
- [ ] **WI-2 — Service → multi-instance state machine.** `Map<alias, InstanceRuntimeState>` (incl.
  `missing`); alias-parameterize provision/lifecycle/reconcile/getStatus/listStatuses/
  refreshLiveState(**one `listByLabel`**, R15)/liveStateGuard/`isBusy(alias)`/
  `willReuseExistingInstance(alias)`; **keep default-alias wrapper overloads** so the build stays
  green (R13). Convert the **exact** destructive call sites in §4.3 (`findManagedContainer(alias)`,
  `volumeName/containerName(alias)`, `isManaged(id, alias)`). **Port allocation reserves every
  registry port (running + stopped) + in-flight reservations** (R3), and a **collision preflight**
  rejects an unlabelled container holding `containerName(alias)` before pull/create (R6). Remove the
  reconcile no-secret-remove branch (R2). Preserve §7 invariants; add the §8 tests. **The big one.**
  *(5-agent review.)*
  - _In progress — **part 1 done** (commit `0cf022cd`): the registry is now authoritative
    (`upsertInstanceRecord`/`removeInstanceRecord`; `finalizeReadyInstance` upserts the default record
    as `'ready'`; `deleteContainer` removes it). **RESUME HERE →** the core `Map<alias,
    InstanceRuntimeState>` field migration, the alias-parameterized methods, the cross-window
    concurrency model (§4.2 lease/`operationId`/`nextSuffix`-heal, §4.3), the port reservation +
    collision preflight, removing the reconcile no-secret branch (R2), and the 5-agent review all
    remain. The service is `QuickStartService.ts` (~1,120 lines); state fields at `:171-182`; provision
    generator `:250-536`; finalize `:546`; resume `:588`; discard `:690`; reconcile `:1066`._
- [ ] **WI-3 — Tree: N instances + “＋ New instance.”** `listStatuses()`-driven rows, per-alias ids,
  per-instance **Provisioning** row (no hardcoded port), add-instance action + its **command id +
  `package.json` `view/item/context` contribution** (R15); display-name labels.
- [ ] **WI-4 — Webview + router alias-scoping.** Target-alias panel param; alias on every procedure;
  controller **`Map<alias, controller>` create-or-reveal** (R10); `.open` alias selection
  (rocket → `DEFAULT_ALIAS`, ＋New → next-free); resume/next-steps target the right instance.
- [ ] **WI-5 — Commands alias resolution.** Lifecycle/copy/logs commands extract alias from **both**
  tree-node kinds (R11); `viewQuickStartLogs` → `Map<alias, CTS>` + **per-alias output channel** (R15).
- [ ] **WI-6 — Migration hardening + docs.** Verify upgrade path (incl. absent-alias-label container →
  `DEFAULT_ALIAS`); update `decision-instance-model.md` (reversal), `v1-readiness-gaps.md`, release notes.
- [ ] **WI-7 — Live Docker E2E.** Two instances; independent stop/start/delete; **delete-isolation**;
  reconcile after reload with 2 containers; **stopped-sibling port reservation**; upgrade-migration
  from a pre-existing single instance (legacy keys + adopt with no rename).

---

## 6. Backward-compat migration (one-time, on activation — ORDERING IS DATA-SAFETY)

For `DEFAULT_ALIAS` only: if the **legacy flat** `documentdb.quickstart.connectionString` secret
exists and the alias-keyed secret does not, copy flat → `secretKey(DEFAULT_ALIAS)` (and
`documentdb.quickstart.imageRef` → `imageRefKey(DEFAULT_ALIAS)`), add `{DEFAULT_ALIAS, "DocumentDB
Local", port, phase:'ready'}` to the registry — deriving **port** from the legacy connection string,
else the container's `inspect` HostConfig binding, else `QUICK_START_PORT` (**never** a blind
`10260`, since an upgrading user may run on a fallback/custom port; gpt55-#4) — then delete the flat
keys. Idempotent; guarded so it runs once.

**Ordering (R1 — prevents data loss):** the migration is **`await`ed at activation BEFORE
`QuickStartService.reconcile()` and before any command that can call `provision()`** — wire it as
`await migrate(); void reconcile();` in `ClustersExtension.ts:264-273`. Otherwise reconcile reads a
missing alias-keyed secret → removes the container, and the user's re-provision reads no creds →
`reusing=false` → **wipes the default volume**. Belt-and-suspenders: destructive paths (volume wipe,
orphan removal) **fall back to the legacy flat key** if the alias-keyed value is absent.

The existing container/volume are already correctly named (§4.1), so reconcile adopts them with no
Docker changes. **Net upgrade experience:** the user’s existing instance reappears as instance #1.
**Downgrade note:** removing the updated extension after migration leaves the instance unmanageable
until reinstall (one-way migration; standard practice).

---

## 7. Data-safety invariants (MUST hold — the reason this is gated)

1. **Isolation:** Delete/Stop/Restart/**discard**/orphan-sweep on instance A never touches B’s
   container, volume, creds, or cache. All destructive ops resolve names/keys via the **alias’s**
   derivation only (`findManagedContainer(alias)`, `volumeName(alias)` — R7).
2. **Volume-wipe stays per-alias + fresh-only:** the `!reusing ⇒ removeVolume(volumeName(alias))`
   guard; a reusing/recreate path never wipes.
3. **Port allocation reserves EVERY known instance's port (running OR stopped) + in-flight
   reservations** (R3), plus non-managed processes via loopback `isPortFree`. The *pick-port → reserve
   → write* sequence runs inside **one lock acquisition** (Minor-1); `registry.port` is
   **authoritative for stopped** instances and `refreshLiveState` **never clears** it (Major-2).
   Explicit Advanced ports also reject sibling-reserved ports.
4. **Reconcile never cross-adopts and never auto-removes (R2/R14):** `alias = labels[ALIAS_LABEL] ||
   DEFAULT_ALIAS`; unknown alias → its own instance; a labelled container with **no recoverable
   secret is surfaced, never removed**, volume never touched; same-alias duplicates → deterministic
   winner + log + leave the other.
5. **Ownership preflight (R6):** before pull/create, if `containerName(alias)` exists and is **not**
   quickstart-labelled → fail inline, never touch it. `isManaged(id, alias)` requires `quickstart=1`
   **and** matching alias (legacy no-alias only for `DEFAULT_ALIAS`).
6. **Migration ordering + copy-then-delete** (§6, R1): `await`ed before reconcile/provision; copies,
   never moves-destructively; destructive paths fall back to the legacy key.
7. **`missing` is per-alias** — setting one instance Missing never affects another’s badge or guards.
8. **Reservation lifecycle (R5 + Major-1):** a cancelled/errored provision that never created a
   container removes **its own** (`operationId`-matched) reservation; a **crashed** host's stale-lease
   reservation is **scavenged at reconcile**; the pre-clean / destructive path is **`operationId`-
   guarded** so it never removes another window's same-alias container. Cross-window allocation races
   **degrade safely** via Docker name/port uniqueness — established data is never lost.
9. **Loopback bind (shipped) applies per instance** — every instance publishes on `127.0.0.1`.
10. **Credential-unavailable instance** (labelled, no recoverable secret) renders in a **distinct
    state** (not `Missing`); its row offers **Delete behind the data-loss confirmation** and **no
    silent recreate** — a recreate that finds no creds must not take the `reusing=false ⇒ wipe` path
    (Minor-2/opus47-M1).

---

## 8. Testing strategy (also closes the reviewers’ “no state-machine tests” gap)

WI-0 makes `ContainerRuntime` injectable; mock `secretStorage`/`globalState` (jest-mock-vscode is
wired). New `QuickStartService.multiInstance.test.ts`:
- Provision two instances → two containers/volumes/ports/secret keys; no overlap.
- **Provision(B) leaves A’s container AND volume intact** (not just “both exist at the end”).
- **Delete A leaves B** intact (container/volume/creds/registry) — headline isolation test.
- **discardTimedOut(A) / orphan-sweep(A) never touch B**; a cancelled provision(B) doesn’t remove A
  and leaves **no** stale registry/reservation entry.
- Reuse/recreate on A never wipes A’s volume and never touches B.
- `reconcile()` with two labelled containers → two `Running` by alias; a registered alias with no
  container (and no in-flight provision) → `Missing`; **idempotent** on a second run.
- **Absent alias label** container → `DEFAULT_ALIAS` (no phantom); two same-alias containers →
  deterministic winner, other left alone.
- **A labelled container with no recoverable secret is surfaced, NOT removed** (R2).
- Legacy flat-key **migration → default-alias keys, idempotent**; **legacy-only at activation →
  reconcile adopts (doesn’t remove), `getReusableCredentials` recovers via the legacy fallback,
  volume preserved** (R1).
- Port allocation for #2 **skips #1’s port even when #1 is Stopped** (R3); explicit Advanced port
  colliding with a stopped sibling’s baked port → error.
- **Collision preflight:** an unlabelled container holding `containerName(alias)` → provision fails
  inline, container untouched (R6).
- **Labelled same-alias collision (Major-1):** a pre-clean for alias `-N` does **not** remove a
  labelled container it didn't create (`operationId` mismatch) — simulates two windows racing the same
  suffix; both instances survive, the loser fails cleanly.
- **Cross-window heal:** `reconcile()` sets `nextSuffix = max(existing suffix)+1`; a stale-lease
  pre-create reservation is scavenged; a fresh-lease no-container entry renders `Provisioning`.
- **Stopped-port persistence (Major-2):** after a `refreshLiveState()` whose `listByLabel` result has
  no host-port for a stopped instance, `registry.port` is **preserved** (not cleared); #2 still skips it.
- **Credential-unavailable (Minor-2):** an alias with a labelled container but no recoverable secret
  → distinct state; a recreate does **not** wipe the volume without explicit confirmation.
- **Migration port derivation:** a legacy instance on a **non-10260** port → registry `port` picks up
  the real port (from the connection string / inspect), not `10260`.
- On-timeout `pendingReadiness` is per-alias (a timeout on A doesn’t affect B).

---

## 9. Effort, risk, and sequencing note

- **Risk concentration:** WI-2 (service). It is the data-safety-critical core; it gets the tests in
  §8 and a full 5-agent review before commit.
- **Everything else is mechanical** once identity (WI-1) and the service (WI-2) land: tree, webview,
  commands are alias-plumbing.
- **Ship options:** this can land as its own PR on top of the Quick Start feature branch, or fold
  into it. Recommended: a dedicated PR (`feat(local-quickstart): multiple managed instances`) so the
  data-safety refactor is reviewed in isolation.

---

## 10. Owner decisions (resolved 2026-07-06)

1. **Naming:** **auto-fill** a default display name, **no prompt** (one click preserved). Rename UI
   deferred. → no router-schema change (U2/U4 as written).
2. **Ship line:** **multi-instance stays in v1**; the later ship date + larger test bar (WI-0 seam +
   §8 state-machine tests) are accepted.
3. **PR packaging:** **dedicated PR** — `feat(local-quickstart): multiple managed instances` — so the
   data-safety refactor is reviewed in isolation.
4. **Cap:** **no hard cap**; add a **soft warning** in the provisioning panel when many (~5+) instances
   are running (WI-3/WI-4).
5. **Rename an instance:** **deferred** to a later release.
