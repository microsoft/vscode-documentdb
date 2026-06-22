# Local Quick Start — POC: Implementation Plan

> Companion to [`description.md`](./description.md) (read that first for the *why*).
> Full design: [`local-quickstart-v2.md`](../../local-quickstart/local-quickstart-v2.md).
> Review history & resolutions: [`review-and-resolutions.md`](./review-and-resolutions.md).
>
> **Audience:** an implementation agent (Opus/Sonnet-class) or a developer.
> **Status:** **Reviewed by 5 agents in two rounds; revised to consensus (rev. 3) — all five APPROVE / no blocking issues.** Not started.
> **Goal of this plan:** a demoable POC, built as small focused work items, grounded in
> the existing codebase so it is *easy to implement*.

---

## 0. How the implementing agent must work (process contract)

1. **Work item by work item.** Numbered **Work Items (WI-n)**. Do one at a time.
2. **Commit per work item** (e.g. `feat(quickstart): add container runtime wrapper (WI-0)`).
3. **Report status** before/after each WI with what changed and check results.
4. **This plan is the source of truth.** After each WI, tick its checkbox + append a one-line outcome.
5. **Confidence gate.** If confidence in any non-obvious decision is **< 80%**, stop and ask.
6. **Phase gating.** A→D ordered. **Phase A+B+C = the demo.** Phase D is stretch.
7. **PR checklist before declaring a phase done:** `npm run l10n` (if user-facing strings
   changed) → `npm run prettier-fix` → `npm run lint` → `npx jest --no-coverage` →
   `npm run build`. All must pass. (`npm run build`, never `npm run compile`.)
8. **Two kinds of acceptance checks.** Each WI marks checks as **[unit]** (must pass under
   `npx jest`, Docker-free — e.g. credential generation, connection-string composition,
   stage-event ordering, password-masking) or **[manual/integration]** (requires a live Docker
   daemon — e.g. pull/create/start/inspect). The §0.7 gate runs the **[unit]** checks;
   **[manual/integration]** checks are run by hand and reported, never assumed.
9. **Terminology:** "DocumentDB" for the service; "MongoDB API"/"DocumentDB API" for the wire
   protocol. Never "MongoDB" alone. All user-facing strings via `vscode.l10n.t()`.
10. **No `any`.** `unknown` + type guards. Explicit return types. `instanceof Error` in catch.

---

## 1. Goal, demo narrative, and non-goals

### Goal
Prove the Local Quick Start vertical slice end-to-end, live: one click → provisioned local
DocumentDB container → **browsable connection rendered inline under the Quick Start node**.

### Demo narrative
Rocket/command → webview (readiness + summary) → **Start** → lightweight staged progress →
wire-protocol readiness → webview **auto-closes** → the **DocumentDB Local - Quick Start** node
shows a **Running** instance **inline**; expand it to browse real databases/collections. (Full
script: §6.)

### Non-goals (explicitly out — see `description.md` scope table)
Legacy migration; TLS-exception wizard; full 7-state machine + complete action matrix; port
**fallback band** (we still detect a busy port and error cleanly); container adoption/label
**conflict** resolution; multi-window coordination/Docker events; Advanced panel; categorized
Docker diagnosis; telemetry; the `10255→10260` manual-wizard fix; init-script seed feature.
**Storage persistence across reloads and a named data volume are Stretch (Phase D).**

---

## 2. Architecture map (where it plugs in — all paths verified against source)

**New code (POC owns these):**

```
src/services/localQuickStart/
  ContainerRuntime.ts        # wrapper over @microsoft/vscode-container-client (Docker)
  QuickStartService.ts       # singleton: orchestration, state, credentials, readiness
  quickStartTypes.ts         # InstanceState, StageEvent union, InstanceMetadata
src/commands/localQuickStart/
  openLocalQuickStart.ts      # command → opens the webview
src/webviews/documentdb/localQuickStart/
  localQuickStartController.ts # extends WebviewControllerBase<Config>
  localQuickStartRouter.ts     # tRPC: getDockerStatus / startQuickStart (sub) / cancel
  LocalQuickStart.tsx          # React entry (Review → Progress → Success)
  components/...               # cards reusing query-insights vocabulary
src/tree/connections-view/LocalQuickStart/
  LocalQuickStartItem.ts       # "DocumentDB Local - Quick Start" node + rocket empty state + inline instance
  QuickStartActionItem.ts      # empty-state "Quick Start..." row (opens webview)
```

**Existing code to modify (small, surgical):**

| File | Change |
| ---- | ------ |
| `package.json` | add `@microsoft/vscode-container-client`; command + menu contributions; (empty-state) viewsWelcome option |
| `src/webviews/_integration/appRouter.ts` | mount `localQuickStart` router (import primitives from `./trpc`, not here) |
| `src/webviews/_integration/WebviewRegistry.ts` | register the React component (auto-bundles — no esbuild change) |
| `src/documentdb/ClustersExtension.ts` | register command(s) + create/attach `QuickStartService` |
| `src/tree/connections-view/ConnectionsBranchDataProvider.ts` | render `LocalQuickStartItem` **including the zero-connections empty state** (§WI-6); fix `savedConnections` count |

**Reuse verbatim (verified reusable):** `WebviewControllerBase`, `useTrpcClient`,
**`MetricsRow`/`MetricBase`/`SummaryCard` (confirmed pure-presentational, NOT coupled to
CollectionView context)**, the subscription-generator pattern from
`queryInsightsEventsRouter.streamStage3` (with its rethrow-in-`catch` / `finally`-cleanup /
abort-listener gotchas), `DocumentDBClusterItem` + the `TreeCluster<ConnectionClusterModel>`
recipe in `LocalEmulatorsItem.ts` (browse works because `DocumentDBClusterItem` primes
`CredentialCache` from the model's `connectionString` on expand), `DocumentDBConnectionString`
(already percent-encodes), `connectToClient.ts` (TLS-allow-invalid), and the **`Task` base
class in `src/services/taskService/`** (see D13).

> **Correction (from review):** the repo **does** have a task framework
> (`src/services/taskService/`: a `Task` state machine with `AbortSignal`, `updateProgress`,
> telemetry, and a `TaskService` singleton). What it lacks is **VS Code *terminal-task***
> integration (`vscode.Task`/`ShellExecution`). D2/D13 are worded accordingly.

---

## 3. Confirmed design decisions

| # | Decision |
| - | -------- |
| D1 | **Runtime = `@microsoft/vscode-container-client` `DockerClient`** (v0.5.4, confirmed installable, not yet a dep). No hand-rolled `docker` strings *as the primary path*. Podman/OCI later = a client swap (§13.8). |
| D2 | **Transparency = a dedicated VS Code OutputChannel** streaming runtime stdout/stderr. **This is a deliberate POC compromise, *not* parity with the design's terminal-task transparency** (the repo has no VS Code terminal-task integration). The demo must still let a viewer see the **real docker commands + live output**. Full terminal-task transparency is a shipping follow-up. |
| D3 | **Progress = lightweight in-webview staged checklist** via a tRPC **subscription** fed by the service-level `StageEvent` sink (D13; template: `streamStage3`). Stage-level only — **no pull-% streaming**. (Pulls design v1.1 forward for the demo; manager-emphasized.) |
| D4 | **Image** = `ghcr.io/documentdb/documentdb/documentdb-local:latest`; **port 10260**; credentials passed as **container args** `--username/--password`; conn-string `mongodb://U:P@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true`. Run detached+tty (`-dt`). |
| D5 | **Service-owned instance, rendered inline.** `QuickStartService` owns the managed instance (state + credentials + connection string). `LocalQuickStartItem` renders it **inline** as a read-only `DocumentDBClusterItem` built from the instance's `connectionString` → browse works for free and **only under the Quick Start node** (no Emulators-zone save in Core → **no double-appearance**, matches §2/§3.2). Storage persistence is **Stretch (WI-8)**. |
| D6 | **Credentials auto-generated** from a URL-safe alphabet `[A-Za-z0-9]`; held in SecretStorage. `DocumentDBConnectionString` already `encodeURIComponent`s them (belt-and-suspenders, §8.1). |
| D7 | **Readiness = wire-protocol `ping`** through the existing connect path with TLS-allow-invalid, retry loop with backoff, **timeout 180 s for the POC** (first cold start generates TLS certs + initializes Postgres; 60 s is too tight). On timeout: keep-waiting / logs / cancel. "Running" only on probe success (§9.1). |
| D8 | **Reduced state set for the POC:** `NotInstalled → Provisioning → Running` (+ `Error`). Stretch adds `Stopped`/`Starting`/`Stopping`. |
| D9 | **Fixed container name** `vscode-documentdb-local` + Docker labels `vscode.documentdb.quickstart=1`, `vscode.documentdb.alias=<alias>` (§10.1). **All destructive/inspect ops act on the stored `containerId`, never the name; any name-collision branch verifies the `vscode.documentdb.quickstart` label before touching a container** (§10.1/§13.1). If an unlabeled container owns the name: show a simple message (no adopt flow in POC). |
| D10 | **Entry point = a tree node + a command.** The node `DocumentDB Local - Quick Start` shows a rocket "Quick Start…" empty-state row that opens the webview; **the node renders even with zero saved connections** (WI-6). Command `vscode-documentdb.command.localQuickStart.open` is the palette/fallback launch. |
| D11 | **Bound port from `docker inspect`** (`NetworkSettings.Ports`) is the source of truth for the saved connection string (§8.3), even though the POC requests a fixed 10260. |
| D12 | **Cancel via `AbortSignal`.** `provision()` accepts an `AbortSignal` threaded into every runtime call. **Pull-phase cancel** aborts the pull — **no container exists to remove**. **Create/Start-phase cancel** removes the container *by `containerId`* and releases the port (§5.6 provisioning rows). Lifecycle-transition cancel is out of POC scope. |
| D13 | **`QuickStartService` (singleton) uses the `Task` framework by *composition*, not inheritance** (`src/services/taskService/`). `Task` is single-use (`start()` throws if state ≠ Pending; `delete()` disposes its emitters), so the singleton owns **a fresh internal `Task` per provisioning attempt** — this is what makes **Retry** (WI-4) and re-provision after Delete (WI-7) work. Reuse `Task` for `doWork(signal)` / `stop()` / `AbortSignal`. **Do not** use `TaskProgressReportingService` (numeric 0-100 → a VS Code *notification*, conflicting with D3's in-webview stage model). Stage progress flows through a **service-level `EventEmitter` `StageEvent` sink** that `doWork` pushes into; the tRPC subscription drains it into an async-iterable (the `streamStage3` pattern). The **tree change-event lives on the service**, not the per-attempt `Task` (whose emitters are disposed on `delete()`). |
| D14 | **Never write secrets to the OutputChannel.** All runtime stdout/stderr is **line-buffered** (split on newlines *before* masking, so a chunk boundary can't split the secret) and passed through a `writeMasked()` helper that redacts the generated password (and any connection string containing it) to `***` in every command echo, stdout, and stderr line. Unit-tested. |

### Still open (resolve at the relevant WI; ask if confidence < 80%)
- **OPEN-1:** credential transport for shipping. The image takes credentials as **CLI args**,
  which puts the password on the host `docker run` command line (`ps -ef`) — re-introducing the
  exact exposure §8.2's `--env-file` avoids. Shipping question is two-fold: *does the image
  accept env-var credentials*, and if not, *how do we avoid CLI-arg exposure*? POC uses CLI args
  + D14 masking. **Note:** D14 masks only the *OutputChannel*; the host process-table (`ps -ef`)
  exposure genuinely **remains** in the POC and is part of the shipping question, not solved by it.
- **OPEN-2:** persistent volume data path inside the image (needed for WI-8 / honest "persisted").
- **OPEN-3:** the `DockerClient` call surface — **WI-0 must validate**: pull-with-streaming,
  create-with-**post-image args** (`--username/--password` after the image), inspect bound port,
  start/stop/remove, list-by-label. **If the client cannot append post-image args, fall back to
  a raw `docker` spawn via `src/utils/cp.ts`** (still centralized, still masked per D14).

---

## 4. Work items

### Phase A — Runtime foundations (no UI)

- [ ] **WI-0 — Container runtime wrapper + API validation.**
  Add `@microsoft/vscode-container-client` to `package.json`. **First, validate OPEN-3** against
  the installed package (a throwaway spike is fine); if post-image args aren't supported, switch
  `ContainerRuntime` to a raw `docker` spawn via `src/utils/cp.ts`. Then implement
  `ContainerRuntime.ts`: `isDockerReady()` (CLI on PATH + daemon reachable),
  `isPortFree(10260)` (pre-check → friendly "Port 10260 is in use" instead of raw Docker stderr),
  `pullImage(ref, onLine)`, `createContainer(opts)` (name, labels, `10260:10260`, post-image args
  `--username/--password`, detached+tty), `startContainer(id)`, **`followLogs(id, onLine)`**
  (because `-dt` detaches, the readiness wait must stream container logs explicitly or the
  channel goes silent), `inspectContainer(id)` (state + bound host port), `stopContainer(id)`,
  `removeContainer(id)`, `listByLabel(label)`. Stream everything to an OutputChannel
  **through a single `writeMasked()` helper that redacts the password (D14)**.
  - *Acceptance:* **[unit]** `writeMasked()` never emits the password; port-busy maps to the
    friendly message. **[manual/integration]** version logs through the wrapper; a hand-created
    container is `inspect`ed for its bound port; `followLogs` shows live output.
  - *Files:* `package.json`, `ContainerRuntime.ts`, `quickStartTypes.ts`.

- [ ] **WI-1 — QuickStartService (orchestration + state + readiness + reconciliation).**
  `QuickStartService.ts` singleton using the `Task` framework **by composition (D13)** — it owns a
  **fresh internal `Task` per provisioning attempt** (so Retry/re-provision work cleanly). Generate
  credentials (D6). The `Task`'s `doWork(signal)` runs the steps and **pushes `StageEvent`s into a
  service-level `EventEmitter` sink** (`checking → pulling → creating → starting → waiting →
  done|error`); the tRPC subscription drains that sink into an async-iterable for the webview (D3).
  Hold `InstanceState` + `InstanceMetadata` (`containerId`, alias, boundPort, clusterId,
  connectionString). Readiness probe per D7 (reuse the connect path; 180 s; backoff). Cancel per
  D12 via the `Task`'s `AbortSignal` (pull-cancel = abort, no removal; create/start-cancel = remove
  by `containerId`). Emit a **service-level** tree change event (not on the per-attempt `Task`).
  **Activation reconciliation:** on init, `listByLabel('vscode.documentdb.quickstart=1')`; if a
  labeled container exists with no in-memory state (e.g. after a window reload), **adopt it**
  (rehydrate `containerId`/port/state from `inspect` + SecretStorage so the inline node reappears),
  or if its credentials can't be recovered, offer a one-click **Reset** (remove). This prevents an
  orphaned container from silently blocking the next `isPortFree(10260)`.
  - *Acceptance:* **[unit]** stage-event ordering; credential alphabet; connection-string
    composition; cancel-during-pull performs **no** `removeContainer`; a second attempt after a
    failed one starts cleanly (fresh `Task`). **[manual/integration]** `provision()` brings the
    container up and resolves `Running`; reload → reconciliation re-shows the running instance;
    cancel during create removes the container by id.
  - *Files:* `QuickStartService.ts`, `quickStartTypes.ts`, `ClustersExtension.ts` (attach).

### Phase B — The Quick Start webview (demo centerpiece)

- [ ] **WI-2 — Webview scaffold (controller + router + React + wiring).**
  `localQuickStartController.ts` (extends `WebviewControllerBase`, mirrors
  `documentsViewController.ts`); **pass `closePanel: () => this.panel.dispose()` into the trpc
  context** (use `this.panel.dispose()`, **not** `this.dispose()` — the framework deliberately does
  not close the panel from `dispose()` to avoid a circular chain; disposing the panel fires
  `onDidDispose → dispose()`, so cleanup still runs). `localQuickStartRouter.ts`
  with `getDockerStatus` (query), `startQuickStart` (subscription → yields `StageEvent`s),
  `cancelQuickStart` (mutation) — **import `publicProcedure*`/`router` from `./trpc`, not
  `appRouter.ts` (circular-import trap)**. Mount under `appRouter`; register the React entry in
  `WebviewRegistry`; `openLocalQuickStart.ts` opens it; register the command in `ClustersExtension`
  + `package.json`.
  - *Acceptance:* **[manual]** the command opens a webview that calls `getDockerStatus` and renders it.

- [ ] **WI-3 — Review & Start view.**
  `LocalQuickStart.tsx` Review state: 4 metric cards (**Docker / Port / Data / Security**) reusing
  `MetricsRow`+`MetricBase`; a "What we'll do" `SummaryCard` (image = the official
  `ghcr.io/documentdb/...` ref, host, credentials, lifetime). **The Data card reads
  "Ephemeral (POC)"** (the POC has no volume — do not claim "Persistent"). **Start** + **Cancel**.
  Basic **Docker-not-ready** variant (single message + Retry; no categorized diagnosis; honors
  opt-in — never auto-starts Docker).
  - *Acceptance:* **[manual]** cards reflect real `getDockerStatus`; Start disabled when not ready;
    Data card says Ephemeral.

- [ ] **WI-4 — Progress + Success (staged progress, D3).**
  On **Start**, subscribe to `startQuickStart`; render the **lightweight staged checklist**
  (done/active/pending) + elapsed timer; **Start** shows a spinner while running. **Inherit the
  subscription gotchas:** rethrow in the router `catch` so `onError` reaches the webview, clean up
  in `finally`, manage the abort listener. On failure: inline error + **Retry** (detail in the
  Output channel via a **"View Docker output"** link). On success: brief Success card (if it shows
  a Data card, it also reads **"Ephemeral (POC)"**) → **auto-close by calling `closePanel`
  (which disposes the panel, per WI-2)** → hand off to the tree.
  - *Acceptance:* **[manual]** Start runs the real flow with live stage transitions; failure shows
    Retry; success auto-closes and the instance appears inline in the tree (WI-5).

### Phase C — Inline instance + entry (the payoff, design-faithful)

- [ ] **WI-5 — Inline managed instance + browse.**
  After readiness success, compose the connection string (D4) from the **inspected bound port**
  (D11) with name **"DocumentDB Local"** (§8 default). `LocalQuickStartItem.getChildren()` returns
  a read-only `DocumentDBClusterItem` built from a `TreeCluster<ConnectionClusterModel>` (reuse the
  `LocalEmulatorsItem.ts:60-80` recipe) carrying `emulatorConfiguration { isEmulator:true,
  disableEmulatorSecurity:true }` and the `connectionString`. Browse works via
  `CredentialCache`-from-connection-string (verified). Give the inline row a **static
  `description = 'Running · localhost:<port>'`** so the demo's "Running" row exists in Core (the
  full state-aware/colored-dot description is WI-7). **Sample data:** programmatically insert one
  sample doc (1 db / 1 collection / 1 doc) — a single driver call, *not* the init-script seed
  feature. Optional polish **unless** the fresh image exposes no browsable database/collection, in
  which case it becomes a **demo-prep requirement** (so the final beat isn't an empty tree).
  - *Acceptance:* **[manual]** after success the instance shows **inline** under the Quick Start
    node (only there), with a `Running · localhost:10260` description, and **expands to real
    databases/collections**; the sample doc is visible.

- [ ] **WI-6 — "DocumentDB Local - Quick Start" node + rocket + empty state.**
  `LocalQuickStartItem.ts` (mirror `LocalEmulatorsItem.ts`): with no managed instance,
  `getChildren()` returns a rocket **"Quick Start — Install & try DocumentDB locally"** row (opens
  the webview). Wire into `ConnectionsBranchDataProvider`. **Critical: handle the zero-connections
  empty state** — `getRootItems()` currently `return null` when there are 0 clusters **and** 0
  emulators (`:111-116`), which renders the *welcome screen* and hides all root nodes.
  **Mandate: `LocalQuickStartItem` must render as a root tree item *unconditionally* — independent of
  the stored-connection count *and* of whether the instance is persisted** (return it before/instead
  of the `null` early-return). **Do not** rely on a `viewsWelcome` button as the fix: because the
  Core instance is in-memory (unsaved, D5), a fresh machine stays at 0 *stored* connections **even
  after a successful provision**, so a `viewsWelcome` view would render empty and the running inline
  instance (WI-5) would be hidden behind the welcome screen — breaking demo §6 step 4. (A welcome
  button may be added *in addition*, for the pre-provision state only.) **Also fix** the
  `savedConnections = rootItems.length - 2` telemetry (`:61`) so the extra always-present node
  doesn't skew the count.
  - *Acceptance:* **[manual]** on a **fresh machine (0 connections)** the node + rocket appear and
    open the webview; telemetry count is correct.

### Phase D — Stretch (only if time before the demo)

- [ ] **WI-7 (stretch) — Minimal lifecycle actions.**
  Inline **Stop / Start / Delete Container** actions wired to `QuickStartService`, **all acting on
  the stored `containerId` and verifying the quickstart label first (D9)**; state-aware row
  description (`Running · localhost:10260`); refresh via `ext.state.notifyChildrenChanged(this.id)`.
- [ ] **WI-8 (stretch) — Persistence + named volume.**
  Persist the instance/connection to storage so it survives reload (mirror
  `src/commands/newLocalConnection/ExecuteStep.ts:177-201` — note ~15 files share the name
  `ExecuteStep.ts`; this is the **`newLocalConnection`** one: build a `ConnectionItem`, call
  `ConnectionStorageService.save(...)`, reveal helpers) and mount a named volume
  `vscode-documentdb-local-data` (resolve OPEN-2) so the Data card can honestly say "Persistent."
  If persisting into the Emulators zone, **filter the managed instance out of `LocalEmulatorsItem`
  rendering** to preserve the single-location UX (D5).

---

## 5. Risks & mitigations

| Risk | Mitigation (in-plan) |
| ---- | -------- |
| **Secret leak to OutputChannel** | D14 `writeMasked()`, unit-tested (WI-0) |
| **`-dt` detach → silent channel during wait** | `followLogs()` streams container logs explicitly (WI-0) |
| **Cold-start readiness > 60 s** | D7: 180 s + backoff + keep-waiting |
| **Cancel orphans a container / crashes on pull-cancel** | D12: `AbortSignal`; pull-cancel removes nothing; create/start-cancel removes by id |
| **`DockerClient` lacks post-image args** | OPEN-3 validated in WI-0; raw-`cp.ts` fallback |
| **Port 10260 busy (no fallback band)** | `isPortFree` pre-check → friendly message (WI-0) |
| **Fresh-machine node hidden by welcome screen** | WI-6 empty-state handling |
| **Image pull slow/blocked on demo network** | Pre-pull in demo prep (§6); already-present image skips the pull stage |
| **Destructive op hits a user's container** | D9: act on `containerId` + verify label |
| **Orphaned container after a VS Code reload blocks the next run** | WI-1 activation reconciliation (adopt-or-reset by label) |
| **`Task` is single-use → Retry / re-provision break; generator-vs-`Task` impedance** | D13 composition: a fresh `Task` per attempt + `EventEmitter`→subscription bridge |
| **Masking misses a secret split across a stream chunk** | D14: line-buffer before `writeMasked()` |

## 6. Demo script

**Prep (do before the demo):** Docker running; **run in a VS Code profile *without* the Docker VS
Code extension** (so "no Docker-extension dependency" is *shown*, not just claimed); **pre-pull**
the image; **verify no stale `vscode-documentdb-local` container** (`docker rm -f` if present);
**verify port 10260 is free**; if the fresh image exposes **no** default browsable database/
collection, ensure the **WI-5 sample-doc seed** runs (so step 5 isn't an empty tree); keep the
command palette (`DocumentDB: Local Quick Start`) ready as a fallback launch.

1. Fresh VS Code, 0 connections. Connections view shows **DocumentDB Local - Quick Start** with
   the **rocket** row (proves the empty-state entry, WI-6).
2. Click the rocket → webview. Point out: **Docker ✅**, **Port 10260**, the **official
   `ghcr.io/documentdb/...` image** in "What we'll do", **Data = Ephemeral (POC)**. Mention it
   needs **no Docker VS Code extension**.
3. **Start DocumentDB Local** → watch staged progress: Checking ✅ → Pulling → Creating →
   Starting → Waiting → Done. (Click **View Docker output** to show the real commands/output.)
4. Webview **auto-closes**; the **Running** instance appears **inline** under the Quick Start node
   (the "webview closes, tree takes over" handoff).
5. Expand it → **admin** → a database → a collection (and, if the optional seed ran, open it to
   show a document).
6. (Stretch) **Stop** / **Start** the instance live.

**Three manager-checkpoints to call out:** official ghcr image; **works without the Docker
extension (running in a profile that doesn't have it — shown, not just claimed)**; the auto-close →
inline-tree handoff.

## 7. Deviation log

- **WI-1 — `QuickStartService` is a standalone service, not built on the `Task` base class
  (deviates from D13).** Rationale: the `Task` base class is single-use (`start()` throws once
  it has run; terminal states don't reset) which conflicts with the **Retry**/re-provision
  requirement, and its progress model is numeric `0-100` driving a VS Code *notification* — at
  odds with D3's in-webview stage checklist. A standalone singleton with a per-attempt
  `AbortSignal` + a `vscode.EventEmitter` status sink satisfies every functional requirement the
  reviewers raised (cancellation threaded to docker, fresh-per-attempt, no single-use breakage)
  with less ceremony. D13 explicitly permits a standalone service; provisioning is an async
  generator consumed directly by the tRPC subscription.
- **`-dt` TTY** is applied via `runContainer({ customOptions: '-t' })` since the typed options
  expose `detached` but no `tty` field. If a manual run shows the placement is wrong, drop it
  (detached alone is sufficient for most images).

---

## Appendix — equivalent raw Docker (reference; we call this via the client, not as strings)

```
docker pull  ghcr.io/documentdb/documentdb/documentdb-local:latest
docker run -dt -p 10260:10260 \
  --name vscode-documentdb-local \
  --label vscode.documentdb.quickstart=1 \
  --label vscode.documentdb.alias=vscode-documentdb-local \
  ghcr.io/documentdb/documentdb/documentdb-local:latest \
  --username <generated> --password <generated>        # masked to *** in all logs (D14)
docker logs -f vscode-documentdb-local                  # stream during readiness wait (D2/-dt)
docker inspect vscode-documentdb-local                  # NetworkSettings.Ports → bound host port
# connection string (creds percent-encoded by DocumentDBConnectionString):
# mongodb://<u>:<p>@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true
```
