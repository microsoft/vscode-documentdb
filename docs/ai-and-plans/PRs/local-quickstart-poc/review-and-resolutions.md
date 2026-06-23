# Local Quick Start POC — Plan Review & Resolutions

**Artifact under review:** [`poc-implementation-plan.md`](./poc-implementation-plan.md) +
[`description.md`](./description.md) (rev. 1 → rev. 2).
**Branch:** `feature/local-quickstart/POC`
**Date:** 2026-06-22

## What this document is

The POC plan was reviewed by **5 independent agents**, each on a different model and a distinct
lens, before any code was written. This file records each lens's verdict, every finding, and how
the plan was changed in response (the `> ✅ RESOLVED` notes). It exists so the manager, a
co-worker, or a future agent can see *why the plan is shaped the way it is* and continue without
re-deriving the rationale.

## Reviewers and verdicts

| Lens | Agent / model | Initial verdict |
| ---- | ------------- | --------------- |
| Design fidelity vs `local-quickstart-v2.md` | rubber-duck / Opus | APPROVE-WITH-CHANGES |
| Manager (Tomaz) perspective & expectations | rubber-duck / GPT-5.4 | APPROVE-WITH-CHANGES |
| Implementability against the real codebase | rubber-duck / Opus | APPROVE-WITH-CHANGES |
| POC scope & demo effectiveness | rubber-duck / GPT-5.4 | APPROVE-WITH-CHANGES |
| Technical risk & live-demo correctness | rubber-duck / Gemini 3.1 Pro | **NEEDS-WORK** |

**Convergent signal:** 3 of 5 lenses independently flagged the same top issue — the design's
signature **inline managed instance under the Quick Start node** was wrongly relegated to Stretch.
The risk lens (the lone NEEDS-WORK) surfaced two P0 demo-breakers the others didn't.

---

## Findings & resolutions (severity-sorted)

### P0 — Credential leak to the OutputChannel *(risk)*
The plan streams runtime stdout/stderr to an OutputChannel **and** passes `--password` as a CLI
arg, which an entrypoint can echo → the plaintext password could persist in the Output tab.
> ✅ **RESOLVED.** Added **D14** ("never write secrets to the OutputChannel") and a `writeMasked()`
> helper in **WI-0** that redacts the password in every command echo / stdout / stderr line, with
> a **[unit]** acceptance check. `description.md` deviation 2 now states the password is masked.

### P0 — Detached `-dt` makes the OutputChannel silent during the wait *(risk)*
A detached container returns immediately; the stream closes after the container ID, so the channel
shows nothing during the readiness wait → the demo looks frozen.
> ✅ **RESOLVED.** Added `followLogs(id, onLine)` to **WI-0** (stream `docker logs -f` after start);
> noted in **D2** and the §-appendix. Risk table row added.

### P0 — Fresh-machine empty state hides the entry node *(scope + impl; verified first-hand)*
`ConnectionsBranchDataProvider.getRootItems()` returns `null` when there are 0 clusters **and** 0
emulators (`:111-116`), which renders the VS Code *welcome screen* and hides **all** root nodes —
so a naively-inserted Quick Start node never appears in the demo's "fresh machine" scenario.
> ✅ **RESOLVED.** **WI-6** now explicitly handles the zero-connections state (render
> `[LocalQuickStartItem]` instead of `null`, or add a `viewsWelcome` button) and its acceptance
> check is "on a fresh machine (0 connections) the node + rocket appear." Demo §6 step 1 calls it out.

### P1 — Signature inline instance was Stretch *(design + manager + scope — 3-way consensus)*
Iteration 2's headline is "the managed cluster is **inline**… no separate entry" (§2/§3.2). The
plan saved a **separate** connection in the legacy Emulators zone and pushed the inline view to
Stretch — showcasing the exact shape the redesign removed, with possible double-appearance under
the legacy "DocumentDB Local" node.
> ✅ **RESOLVED.** **Promoted to Core.** **D5** rewritten: `QuickStartService` **owns** the
> instance; `LocalQuickStartItem` renders it **inline** as a read-only `DocumentDBClusterItem`
> (browse via `CredentialCache`-from-connection-string, verified by the impl lens). **Nothing is
> written to the Emulators zone in Core → no double-appearance.** Only Stop/Start/Delete stay
> Stretch (WI-7); storage persistence is Stretch (WI-8, which filters the instance out of
> `LocalEmulatorsItem` if it persists there). Scope table + WI-5 updated.

### P1 — "No Tasks infrastructure" is factually wrong; WI-1 over-scoped *(impl)*
`src/services/taskService/` is a full `Task` framework (state machine, `AbortSignal`,
`updateProgress`, telemetry, `TaskService` singleton). The repo only lacks **VS Code
*terminal-task*** integration. WI-1 rebuilt orchestration/state/cancel from scratch.
> ✅ **RESOLVED.** Added **D13**: build `QuickStartService` on the `Task` base class for
> lifecycle/state/cancellation; do **not** use `TaskProgressReportingService` (its numeric
> notification progress conflicts with the in-webview stage model). Corrected the wording in
> `description.md` deviation 2 ("no VS Code *terminal-task* integration"). WI-1 + §2 updated.

### P1 — Readiness 60 s too short for a cold start *(risk)*
First run generates TLS certs + initializes a Postgres-backed gateway; 60 s can time out.
> ✅ **RESOLVED.** **D7** bumped to **180 s + backoff + keep-waiting**; risk table updated.

### P1 — Cancellation lacked `AbortSignal`; pull-cancel "removes a container" is wrong *(risk)*
Without a threaded signal a cancelled provision keeps running and orphans a container; and a pull
creates no container to remove.
> ✅ **RESOLVED.** **D12** rewritten: `provision()` takes an `AbortSignal` threaded into every
> runtime call; **pull-cancel removes nothing**; **create/start-cancel removes by `containerId`**.
> WI-1 acceptance adds a unit check that pull-cancel performs no `removeContainer`.

### P1 — Webview "Data" card claims Persistent, but the POC is ephemeral *(design + manager)*
WI-3/WI-4 mirrored §5.1/§5.5 cards verbatim ("Persistent volume" / "Persisted") while persistence
is deferred — a UI claim the build can't back.
> ✅ **RESOLVED.** Added **deviation 4** (ephemeral, honestly labeled); **WI-3** now specifies the
> Data card reads **"Ephemeral (POC)"**; volume + "Persistent" is Stretch (WI-8).

### P1 — Demo script ends at documents, but Core seeds none *(scope)*
> ✅ **RESOLVED.** Demo §6 now ends at **databases/collections** by default; **WI-5** adds an
> **optional** one-document programmatic seed (a single driver call, *not* the init-script feature)
> for a richer ending if time allows.

### P1 — OutputChannel framed as equivalent to terminal-first *(manager)*
> ✅ **RESOLVED.** **D2** + deviation 2 reworded as a **deliberate compromise, not parity**; the
> demo must still expose the real docker commands/output ("View Docker output", §6 step 3).

### P2 — Destructive ops keyed on name, not id/label *(design)*
> ✅ **RESOLVED.** **D9**/**D12**/**WI-7** state all stop/remove/inspect act on the stored
> `containerId` and verify the `vscode.documentdb.quickstart` label first (§10.1/§13.1).

### P2 — `savedConnections` telemetry off-by-one *(impl)*
`getRootItems` computes `rootItems.length - 2`; a third always-present node skews it.
> ✅ **RESOLVED.** **WI-6** includes fixing the count/comment.

### P2 — Circular-import trap mounting the new router *(impl)*
> ✅ **RESOLVED.** **WI-2** states the router imports tRPC primitives from `./trpc`, not `appRouter`.

### P2 — Webview auto-close mechanism unspecified *(impl)*
> ✅ **RESOLVED (corrected in rev. 3).** **WI-2** passes `closePanel: () => this.panel.dispose()`
> into the trpc context; **WI-4** calls it on success. *Note:* an earlier draft used
> `this.dispose()`, which the impl re-review correctly flagged as wrong — the framework
> deliberately does **not** close the panel from `dispose()` (circular-chain guard); disposing the
> **panel** fires `onDidDispose → dispose()`, so cleanup still runs.

### P2 — Saved connection label would be `user@host` *(design)*
> ✅ **RESOLVED.** **WI-5** sets the name to **"DocumentDB Local"** (§8 default).

### P2 — `DockerClient` post-image-arg support unproven *(risk + impl)*
> ✅ **RESOLVED.** **OPEN-3** + **WI-0** front-load API validation; **fallback to a raw `docker`
> spawn via `src/utils/cp.ts`** (still masked) if the client can't append post-image args.

### P2 — Port 10260 busy → raw Docker error *(risk)*
> ✅ **RESOLVED.** **WI-0** adds an `isPortFree()` pre-check → friendly "Port 10260 is in use".

### P2 — Acceptance checks are Docker-dependent, not CI-runnable *(impl)*
> ✅ **RESOLVED.** §0.8 splits checks into **[unit]** (jest gate) vs **[manual/integration]**;
> each WI tags its checks.

### P2 — Credential-transport open question understated *(design)*
> ✅ **RESOLVED.** **OPEN-1** + the "Tension to flag" note now capture both halves (env support
> *and* avoiding CLI-arg `ps -ef` exposure).

### P2 — Demo resilience too network-only; dirty-machine failures more likely *(scope + risk)*
> ✅ **RESOLVED.** §6 "Prep" now also: verify no stale `vscode-documentdb-local` container, verify
> 10260 free, keep the command-palette launch as a fallback.

---

## Confirmed-accurate (verified by the implementability lens against source — no change needed)

- New-webview file set is correct; the `WebviewRegistry` key **auto-bundles** the component (no
  esbuild/entry wiring). `revealToForeground()` public, `setupTrpc` protected.
- The `streamStage3` subscription generator is a sound template (with rethrow-in-`catch`,
  `finally` cleanup, abort-listener add/remove).
- `MetricsRow` / `MetricBase` / `SummaryCard` are **pure presentational** — not coupled to
  CollectionView context — so the "reuse the query-insights vocabulary" claim holds.
- The TLS / encoding / browse chain is exactly as claimed; **browse works after a plain model
  build** because `DocumentDBClusterItem` primes `CredentialCache` from the connection string.
- `@microsoft/vscode-container-client` is genuinely absent (dep + lockfile + `node_modules`), so
  WI-0 must add it and the API is genuinely unproven — making WI-0's front-loaded validation the
  correct first move.

## Status

Plan revised to **rev. 3** after **two rounds** of 5-agent review. **Consensus reached: all five
lenses approve, no blocking issues.** The round-2 outcomes and the full rev.-3 change list are
recorded immediately above. Ready to implement starting at WI-0.

### Re-review outcomes (rev. 2 → rev. 3)

All five lenses re-reviewed rev. 2. **Result: unanimous approval, no blocking issues.** The prior
NEEDS-WORK (risk) flipped after confirming its P0/P1 fixes. The re-reviews surfaced a focused set of
**non-blocking** refinements, all folded into **rev. 3**:

| Lens | Round 1 | Round 2 (on rev. 2) |
| ---- | ------- | ------------------- |
| POC scope & demo | APPROVE-WITH-CHANGES | **APPROVE** |
| Manager perspective | APPROVE-WITH-CHANGES | **APPROVE-WITH-CHANGES** — P0/P1 resolved |
| Design fidelity | APPROVE-WITH-CHANGES | **APPROVE-WITH-CHANGES** — all resolved, no blocking |
| Implementability | APPROVE-WITH-CHANGES | **APPROVE-WITH-CHANGES** — `Task` API validated |
| Technical risk | **NEEDS-WORK** | **APPROVE-WITH-CHANGES** — prior blockers resolved |

**Validated, not just claimed:** the impl lens verified against source that **every `Task`-API
assumption in D13 is real** (`doWork(signal)`, `stop()→abort`, threaded `AbortSignal`,
`updateProgress`, `onDidChangeState/Status`), that the empty-state fix point and telemetry line are
correct, and that the circular-import / registry-auto-bundle facts hold.

**Rev. 3 changes (from the re-reviews):**

1. **`closePanel` correction (impl, important).** `this.dispose()` does **not** close the panel
   (framework circular-chain guard). → `closePanel: () => this.panel.dispose()` (WI-2, WI-4).
2. **`Task` by composition, not inheritance (impl + risk).** `Task` is single-use (`start()` throws
   if state ≠ Pending; `delete()` disposes emitters), so a singleton that inherits it breaks **Retry**
   and re-provision. → **D13/WI-1** rewritten: the singleton owns a **fresh `Task` per attempt**; a
   service-level `EventEmitter` `StageEvent` sink feeds the tRPC subscription; the tree change-event
   lives on the service. This also resolves the async-generator-vs-`doWork` impedance.
3. **Activation reconciliation (risk).** Persistence is Stretch, so a VS Code reload would orphan the
   running container and block the next `isPortFree(10260)`. → **WI-1** adds reconcile-on-init
   (`listByLabel` → adopt/rehydrate or Reset).
4. **Line-buffered masking (risk).** A secret split across a stdout chunk could evade redaction. →
   **D14** masks **after** line-buffering.
5. **WI-6 must mandate the always-render root node (design).** The `viewsWelcome`-button alternative
   is incompatible with the in-memory Core instance (a fresh machine stays at 0 *stored* connections
   even after provision, hiding the running inline instance behind the welcome screen). → WI-6 now
   **mandates** `LocalQuickStartItem` renders unconditionally; the welcome button is at most an
   addition for the pre-provision state.
6. **Static "Running" description in Core (design).** The demo promises a `Running · localhost:10260`
   row, but the state-aware description was Stretch. → **WI-5** adds a static description in Core.
7. **Honest "Ephemeral" on the Success card (design).** → **WI-4** Data card (if shown) reads
   "Ephemeral (POC)".
8. **OPEN-1 crispness (design).** Clarified that D14 masks only the OutputChannel — the `ps -ef`
   process-table exposure genuinely remains in the POC.
9. **Explicit "no Docker-extension" demo proof (manager).** → §6 prep runs in a VS Code profile
   without the Docker extension, so the checkpoint is *shown*, not just spoken.
10. **Seed fallback for a non-empty final beat (scope).** → §6 prep + WI-5: if the fresh image
    exposes no browsable database/collection, the 1-doc seed becomes a prep requirement.
11. **`ExecuteStep.ts` path disambiguation (impl).** → WI-8 names the `newLocalConnection` file
    (15 files share the name).

**Residual (intentionally deferred, logged for shipping):** OPEN-1 (credential transport),
OPEN-2 (volume data path), OPEN-3 (validated in WI-0). No reviewer considers any of these a blocker
for a POC demo.

**Consensus reached.** The plan is consistent with the design, aligned with the manager's
perspective, and judged implementable. Ready to start at WI-0.

---

## Implementation review (POC code, 2026-06-22)

After implementing WI-0…WI-6, the working POC was reviewed by **5 more agents** against the
running code (functional correctness · design fidelity · webview/tRPC · tree+browse · secret
masking/robustness). **All five returned APPROVE-WITH-CHANGES — no P0, no NEEDS-WORK.** The
security agent **ran the real image** and confirmed no actual password leak today. The core demo
path (provision → masked output → wire-protocol readiness → inline browse) was verified sound.

**12 findings, all fixed** (commit `fix(quickstart): address 5-agent POC review`):

| Sev | Finding | Resolution |
| --- | ------- | ---------- |
| P1 | `followLogs` masked per-chunk, not line-buffered (D14 split-secret gap; design+security) | Route container logs through `MaskingLineBuffer` |
| P1 | `followLogs` leaked on success — `cts` disposed but never cancelled, so `docker logs -f` ran forever (functional) | `cts.cancel()` in `finally` (all outcomes) |
| P1 | Container orphaned if cancelled in the create window (id not yet captured) (functional) | `createAttempted` flag + label-based sweep in `finally` |
| P1 | Re-provision reused a stale `ClustersClient` cached by id (tree) | `ClustersClient.deleteClient(clusterId)` before publishing new creds |
| P1 | Webview could hang in `provisioning` on a busy/empty stream (webview) | `provision()` emits a terminal error when busy + `onComplete` handler recovers to review |
| P2 | Subscription leak on double-click Start (webview) | Unsubscribe-before-resubscribe + null the ref on terminal callbacks |
| P2 | Cancel deferred up to ~30s during an in-flight readiness connect (functional) | Direct `MongoClient` with `serverSelectionTimeoutMS: 3000` |
| P2 | Redundant `-t` in `customOptions` — `detached` already adds `--tty` (functional) | Removed `customOptions` |
| P2 | `savedConnections` telemetry undercounted (tree) | Count real connections/folders by contextValue, excluding synthetic nodes |
| P2 | "Learn more…" row missing from the empty state (design) | Added (opens the DocumentDB repo) |
| P2 | Review screen lacked a Cancel button (design) | Added (closes the panel) |
| P2 | WI-5 sample seed not implemented (design) | Best-effort 1-doc seed after readiness so the tree isn't empty to browse |

**Verified correct by the reviewers (no change needed):** the cancellation plumbing
(`ctx.signal` → mirror → `provision` → `cts` → tree-kill) and `return()` propagation through the
nested generator; the browse/cache-key path (`CredentialCache.setAuthCredentials` under the same
`clusterId` the tree item uses); no double-appearance (nothing written to the Emulators zone);
webview mount/typing/auto-close/bundle-purity; and split-safe masking on the primary paths.

**Post-fix gates:** `npm run lint` ✅ · `npx jest --no-coverage` (2055/2055) ✅ · `npm run build` ✅
· webview webpack bundle ✅.

---

## Manual testing (live on Windows, 2026-06-23)

Running the POC end-to-end surfaced two issues — one launch-recipe gotcha (not a code bug) and one
genuine Windows bug — both resolved.

### 1. Blank webview (launch recipe, not a code bug)

A `webpack-dev` build bakes `DEVSERVER='true'` (via `webpack.config.ext.js` `EnvironmentPlugin`),
so the extension fetches the webview script from the dev server at `http://localhost:18080`. A
one-shot `code --extensionDevelopmentPath=dist` launch does **not** start that dev server → the
webview HTML had no script to load → blank page.

**How to run a standalone manual test (no dev server, no `Watch` task, no problem-matcher
extension):**

```powershell
npm run webpack-prod    # bakes DEVSERVER='' + IS_BUNDLE='true' → loads dist/views.js from disk
code --extensionDevelopmentPath="<repo>\dist" --profile=noExtensionsProfile
```

(Or press **F5**, which starts the dev server via the `Watch` task — but that task references the
`amodio.tsl-problem-matcher` extension, absent in `--profile=noExtensionsProfile`, so install it
first: `code --install-extension amodio.tsl-problem-matcher`.)

### 2. P1 (real bug) — "Docker daemon not reachable" on Windows even when Docker is running

**Symptom:** `isDockerReady()` reported the daemon unreachable; `docker info` worked fine from a
shell.

**Root cause:** `ShellStreamCommandRunnerFactory` **without a `shellProvider`** discards each
argument's quoting metadata (`args.map(a => a.value)`) and sets `windowsVerbatimArguments` on
Windows. Go-template arguments like `--format {{json .}}` were therefore split on the space, so
`docker info` (and `inspect`/`list`) failed — breaking readiness and, latently, the whole flow.

**Fix (commit `fix(quickstart): pass shell provider …`):** provide a platform shell provider —
`Cmd` on Windows, `Bash` elsewhere — to every runner; switch `makeRunner` to `strict:false`
(non-zero exit still rejects, harmless stderr warnings don't). Added the
`@microsoft/vscode-processutils` dependency.

**Live verification (real Docker on Windows):** a full end-to-end run of the exact provision
sequence passed — Docker readiness (the previously-broken `info`), `runContainer` with credential
args + labels, `inspect` bound port, wire-protocol `ping`, sample seed, browse
(`dbs=[quickstart]`), and cleanup. The official image also ships a default `sampledb`, so the demo's
final browse step is never an empty tree.
