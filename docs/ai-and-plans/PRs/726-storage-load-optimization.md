# PR #726: Speed up connection load and clarify in-memory wrapping

**Branch:** `dev/tnaum/storeage-optimization`
**Base:** `main`
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/726
**Commits:** 6 on top of `main` (5 code/perf + 1 l10n)

---

## Why

Two symptoms triggered this work:

1. **"Migration" appeared in traces on every single load.** That is alarming —
   migrations are supposed to be one-time. Reading the code showed nothing was
   actually being migrated to disk on each load; the trace was mislabeling a
   read-time, in-memory transform.
2. **Connection loading felt slow, especially on Remote-WSL.** The storage layer
   keeps connection *metadata* in `globalState` but connection *secrets* in
   `SecretStorage`. Every `SecretStorage.get()` is an RPC to the main process,
   and under Remote-WSL that RPC additionally crosses the WSL2 ↔ Windows
   boundary. So the load cost is dominated by the *number* of secret reads, not
   by CPU work.

Diagnosing the second point revealed three compounding costs during startup:

- The post-migration cleanup re-read every storage zone once **per cleaner**
  (3 cleaners × 2 zones ≈ 6 full zone reads), and each zone read does one
  secret round trip per item.
- That cleanup ran on **every** session, even when there was nothing left to
  clean.
- `getItems()` itself awaited secret reads **one item at a time** in a loop, so
  N items meant N sequential round trips.

The fixes are split into one commit per concern so each can be reviewed,
reasoned about, and reverted independently. The reasoning behind each decision
is captured below because the *why* is the point — the diffs are small.

---

## What was done

### Commit 1 — `refactor(storage): clarify read-time wrapping is in-memory, not migration`

Renamed `migrateToV2` → `wrapV1AsV2` and `migrateToV3` → `wrapV2AsCurrent`, and
rewrote the trace/doc text to say explicitly that wrapping an older stored item
into the current `StoredItem` shape is a **pure in-memory operation, recomputed
on every read and never persisted**.

**Reasoning.** This is deliberately *not* a behavior change — it is a naming and
observability fix. The on-read wrapping is correct and intentionally kept: it
lets old on-disk records (v1/v2) be consumed by current code without rewriting
storage. The problem was purely that calling it "migration" in a per-read trace
made every normal load look like it was doing one-time upgrade work. Renaming
removes that false alarm and makes the genuinely one-time work (the cleanup
pass below) distinguishable from the always-on wrapping.

### Commit 2 — `perf(storage): load each zone once for post-migration cleanup`

`resolvePostMigrationErrors` now loads each zone (`Clusters`, `Emulators`)
**exactly once** and threads that single in-memory array through all three
cleaners (`fixFolderConnectionStrings`,
`cleanupDuplicateConnectionStringParameters`,
`cleanupInvalidConnectionStrings`). The cleaners were refactored to accept the
pre-loaded array and return their counts; the orchestrator aggregates telemetry.

**Reasoning.** Each cleaner previously called `getItems()` itself, so the same
secrets were re-read up to three times per zone. The cleaners operate on
**disjoint** item sets (folders vs. valid connections vs.
invalid/unparseable connections), so a single read per zone is safe — no cleaner
depends on another's writes mid-pass. This cuts startup zone reads from ~6 to 2
without changing what gets cleaned.

### Commit 3 — `perf(storage): gate startup cleanup behind a one-time version marker`

Added `STORAGE_CLEANUP_VERSION` (`'0.8.1'`, the patch this ships with), persisted
to `globalState` under `cleanupCompletedVersion` once a cleanup pass completes.
On later loads, if the stored marker equals the current version, the entire
cleanup pass (folder fixups, duplicate-param cleanup, invalid-connection
removal, orphan sweep) is skipped. Adds `cleanupSkipped`/`cleanupVersion`
telemetry.

**Reasoning.** The cleanup exists to repair historical corruption and finish
one-time format upgrades. Once an install has run it successfully, re-scanning
both zones every session is pure waste. The version marker doubles as a
contract: *"any install carrying 0.8.1 has completed every one-time cleanup up
to that release."* The constant is only bumped when a genuinely new one-time
step is introduced, at which point existing installs re-run the pass exactly
once. Critically, the marker is written **only after a successful run**, so an
interrupted run leaves the marker unset and the pass safely retries next launch
— we never trade correctness for the skip.

### Commit 4 — `perf(storage): read item secrets concurrently in getItems`

`getItems()` now collects all item metadata from `globalState` synchronously
first, then dispatches every secret read together via `Promise.all`, then
assembles the results. The previous per-item `await secretStorage.get()` loop is
gone. Return shape and behavior are unchanged.

**Reasoning.** The sequential loop serialized N independent round trips. Batching
them lets the round trips pipeline over the shared RPC channel, dropping total
wait from ~N round trips to ~1. This is safe because VS Code serializes secret
access **per key** (not globally) and caches the decrypted store after the first
read, so concurrent reads for distinct item keys don't block or corrupt one
another. This is the single biggest win on Remote-WSL, where each saved round
trip is a saved boundary crossing.

### Commit 5 — `chore(storage): drop one-time Azure Databases connection import`

Removed `migrateFromAzureDatabases`, `getMongoMigrationApi`, the
`MongoConnectionMigrationApi` interface, the attempts-counter `globalState` key,
the gating call in `getStorageService`, and the now-unused imports (`apiUtils`,
`vscode`, `l10n`, `isVCoreAndRURolloutEnabled`).

**Reasoning.** This path imported MongoDB cluster connections from the Azure
Databases (`ms-azuretools.vscode-cosmosdb`) extension on first storage access.
It shipped several releases ago and is self-limiting — it only does work when
that extension is installed *and* still holds un-imported connections — yet it
paid a fixed startup cost on every load (extension lookup + cross-extension API
version negotiation) behind an `attempts < 20` counter. The remaining
un-migrated population is effectively flat, so the ongoing per-load cost no
longer earns its keep.

The key judgment call: this is **different from the on-disk format readers**
(`wrapV1AsV2` etc.), which are kept. Dropping a format reader would silently
*lose existing local data* for anyone who hadn't upgraded — unacceptable.
Dropping this cross-extension import only affects a narrow set of users who
installed Azure Databases, created connections there, installed this extension,
and never opened it to trigger the import — and even they have a clear,
non-destructive workaround: re-add the connection. The cost/benefit favors
removal.

### Commit 6 — `chore(l10n): drop strings for removed Azure Databases import`

Ran `npm run l10n`, which removed the three user-facing strings that only
existed in the deleted migration code.

**Reasoning.** Mechanical follow-up required by the PR checklist so the
localization bundle doesn't carry dead keys.

---

## Validation

Full PR checklist, in order:

- `npm run l10n` — removed 3 obsolete strings (committed in Commit 6)
- `npm run prettier-fix` — no changes
- `npm run lint` — clean (only the pre-existing `eslint-env` webpack warning)
- `npx jest --no-coverage` — 1995 tests / 101 suites pass
- `npm run build` — clean (no type errors)

The storage suites (`connectionStorageService.{test,cleanup,orphans,contract}`
and `storageService`, 67 tests) were also run after each individual commit. The
tests were unaffected by the signature and gating changes because they exercise
behavior through the public API and mock `globalState.get` to return a value
that never matches the cleanup version marker, so cleanup always runs under
test.
