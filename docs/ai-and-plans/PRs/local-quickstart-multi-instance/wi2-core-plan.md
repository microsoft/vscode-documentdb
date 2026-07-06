# WI-2 core — execution plan (the multi-instance service state machine)

> Elaborates [`implementation-plan.md`](./implementation-plan.md) §4.2/§4.3/§5 WI-2 + §7/§8 into a
> committable, verifiable sub-step sequence. Round-1/2 findings: [`review-and-resolutions.md`](./review-and-resolutions.md).
> **Status:** PLAN — pending 5-agent plan-review, then implement. No code yet.
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

### API WI-2 must expose for WI-3/4/5
- `getStatus(alias = DEFAULT_ALIAS): QuickStartStatus` and `listStatuses(): QuickStartStatus[]` (tree).
- `provision(signal, options?, alias = DEFAULT_ALIAS)`, `resumeReadiness(signal, alias = DEFAULT_ALIAS)`,
  `discardTimedOutInstance(alias = DEFAULT_ALIAS)`.
- `allocateNewInstance(): Promise<string>` (returns the freshly reserved alias for "＋ New instance").
- `start/stop/restart/deleteContainer/viewLogs(alias = DEFAULT_ALIAS)`,
  `willReuseExistingInstance(alias = DEFAULT_ALIAS)`, `isBusy(alias = DEFAULT_ALIAS)`.

Optional trailing `alias` params keep every current caller (router/tree/commands) compiling (R13);
WI-4/5 pass the real alias.

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
- Add:
  ```
  interface InstanceRuntimeState {
    alias: string; displayName: string; port?: number;
    metadata?: InstanceMetadata; state: InstanceState;
    provisioning: boolean; lifecycleBusy: boolean; missing: boolean;
    pendingReadiness?: PendingReadiness; errorMessage?: string;
  }
  private instances = new Map<string, InstanceRuntimeState>();
  private stateFor(alias: string): InstanceRuntimeState   // lazy default (NotInstalled)
  ```
- Route every `this.<field>` through `stateFor(alias)`. `setStatus(alias, state, metadata?, error?)`;
  `getStatus(alias = DEFAULT_ALIAS)`; `isBusy(alias = DEFAULT_ALIAS)`; add `listStatuses()`
  (returns a status per known alias — for 2b, just `DEFAULT_ALIAS`).
- **All callers still use `DEFAULT_ALIAS` → behavior identical; all existing tests stay green.** This
  is the largest mechanical step; the service tests (reconcile-adopt, willReuse, delete) are the guard.
- *Verify:* build + full jest green, no behavior change.

### WI-2c — Alias-thread the methods + alias-derived names/keys (behavior-preserving)
- Optional trailing `alias = DEFAULT_ALIAS` on the §1 methods.
- Replace hardwired constants with `containerName(alias)/volumeName(alias)/secretKey(alias)/
  imageRefKey(alias)/clusterId(alias)`; `findManagedContainer(alias)` (filter the `alias` label — no
  longer `list[0]`); `isManaged(id, alias)` requires both labels (legacy no-alias → `DEFAULT_ALIAS`
  only). `readStoredConnectionString(alias)` reads `secretKey(alias)` (legacy fallback only for
  `DEFAULT_ALIAS`).
- *Verify:* build + full jest green (behavior identical at `DEFAULT_ALIAS`).

### WI-2d — Registry-driven reconcile + `listStatuses` + lease Missing (multi-instance becomes real)
- `reconcile()`: **one** `listByLabel({quickstart:1})` → group by `labels[ALIAS_LABEL] ||
  DEFAULT_ALIAS`; union with `readRegistry()` records; build per-alias `InstanceRuntimeState`.
  - **Remove the no-secret-remove branch (R2):** a labelled container with no recoverable secret is
    surfaced in a **distinct state** (`InstanceState.Error` + "credentials unavailable" message — no
    silent recreate), **never removed**, volume never touched.
  - **Lease-based:** a registered alias with **no container** + a **fresh** `phase:'provisioning'`
    lease → `Provisioning`; a **stale** lease (older than `READINESS_TIMEOUT_MS`) or `phase:'ready'`
    → `Missing` (and scavenge the stale pre-create reservation).
  - **`nextSuffix` self-heal** = `max(existing numeric suffixes)+1`.
  - Same-alias duplicate containers → deterministic winner (most-recently-created), log, leave other.
- `listStatuses()` returns a status for **every** known alias (registry ∪ adopted).
- `refreshLiveState()`: single `listByLabel`, index by id, update all known aliases; **`registry.port`
  authoritative for stopped** (`docker ps -a` omits the binding — never clear it; update port only for
  running).
- *Verify:* new multi-instance service tests (two labelled containers → two states; credential-less →
  surfaced; absent-label → default; stopped-port preserved) + all existing tests green.

### WI-2e — Allocation + provision-at-Start + concurrency
- `allocateNewInstance(): Promise<string>` — inside **one** `updateRegistry` lock: pick `nextSuffix`
  (bump it), `findAvailablePort` **excluding every registry port (running+stopped) + in-flight
  reservations**, write `{alias, displayName, port, phase:'provisioning', operationId: uuid(),
  leaseAt: now}`. Returns the alias.
- `provision(alias)`:
  - If `alias` has no `'provisioning'` lease yet (the `DEFAULT_ALIAS` rocket path), register one first.
  - **Collision preflight:** inspect `containerName(alias)`; if it exists and is **not**
    quickstart-labelled → fail inline (`Error`), never touch it (§10.2 / R6, honors German).
  - Stamp `operationId` on a **third container label** (`vscode.documentdb.op`) + keep it on the
    registry record; the pre-clean / `findManagedContainer(alias)` destructive path is
    **`operationId`-guarded** (only removes a container whose op-label matches this provision).
  - `finalizeReadyInstance` upserts `'ready'` (clears `operationId`/`leaseAt`) — generalize the WI-2a
    upsert to `alias`; port is the bound port.
  - Cleanup on abort/failure-before-create removes only this `operationId`'s reservation.
- Cross-window: races **degrade safely** (Docker name/port uniqueness); `nextSuffix` heal + lease
  scavenge (WI-2d) recover clobbers/crashes.
- *Verify:* allocation/port-reservation/collision-preflight/operationId-guard tests + all green.

### WI-2f — Tests + 5-agent review (the whole WI-2 core)
- The §5 test matrix below; then the mandated 5-agent review before merge of the WI-2 core.

---

## 4. Concurrency model (concrete)
Per-process async lock serializes THIS window's registry RMW. Cross-window safety = **Docker
container-name + host-port uniqueness** (a genuine double-allocate fails at `docker run`; loser errors
cleanly) + **`operationId`-guarded destructive ops** (never touch a container you didn't create) +
**`nextSuffix` self-heal** in reconcile + a **provisioning lease** (fresh → Provisioning; stale →
recoverable Missing + scavenge). Established data never lost: persisted per-alias secret ⇒
`reusing=true` ⇒ volume kept.

## 5. Data-safety invariants (must hold at EVERY sub-step)
1. Delete/Stop/Restart/discard/pre-clean on A never touch B's container/volume/creds/cache.
2. Volume-wipe stays `!reusing` **and** `volumeName(alias)`; reuse/recreate never wipes.
3. Reconcile never cross-adopts and **never auto-removes** a credential-less labelled container.
4. Port allocation reserves every registry port (running+stopped) + in-flight; explicit Advanced port
   rejects sibling-reserved.
5. Collision preflight: never touch an unlabelled container holding `containerName(alias)`.
6. `operationId`-guarded pre-clean; cleanup by owner only.
7. Migration ordering + legacy fallback (WI-1) intact; loopback bind per instance.

## 6. Test plan (WI-0 injectable runtime + mocked `ext`)
- Provision two instances → two containers/volumes/ports/secrets, no overlap.
- **Delete A leaves B**; `provision(B)` leaves A's container **and** volume; `discardTimedOut(A)` /
  orphan-sweep never touch B.
- reconcile with two labelled containers → two states by alias; credential-less → surfaced (not
  removed); absent-label → `DEFAULT_ALIAS`; idempotent; `nextSuffix` heal.
- Port allocation for #2 skips #1 even when **Stopped**; explicit Advanced port colliding a stopped
  sibling → error.
- Collision preflight (unlabelled name holds `containerName(alias)`) → provision fails inline.
- `operationId` mismatch → pre-clean skips a sibling (simulates two windows racing a suffix).
- Migration (WI-1) + a second instance coexist.

## 7. Risks & open decisions
- **Biggest risk:** WI-2b touches every field access in a ~1,120-line stateful file. Mitigation:
  mechanical, method-by-method, existing tests as guardrail, build after each method.
- **Open (minor):** `operationId` label key (propose `vscode.documentdb.op`); keep `getStatus()`
  no-arg for the router until WI-4 (yes); does `deleteContainer(alias)` also `removeInstanceRecord`
  (yes — generalize WI-2a) and `finalize` upsert per alias (yes).
- **Sequencing:** 2b→2c behavior-preserving (green throughout); 2d→2e add multi-instance behavior
  (tested); 2f reviews the whole. Each sub-step is its own commit.
