---
feature: local-quickstart
kind: plan
status: active
prs: []
created: 2026-11-10
code:
  - src/services/localQuickStart/containerCli.ts
  - src/services/localQuickStart/ContainerRuntime.ts
  - src/services/localQuickStart/DockerReadinessService.ts
  - src/services/localQuickStart/dockerReadinessClassification.ts
  - src/services/localQuickStart/DockerProviderLauncher.ts
  - src/services/localQuickStart/dockerRecoveryCommands.ts
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/quickStartStore.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/advancedOptions.ts
  - src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts
  - src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts
---

# 12 — Preferred container engine, and starting Podman from a button

> **Approved with the Configure-stage amendment, 2026-11-10; not implemented.** This replaces
> the parked **W1** and **W8** of [iteration 10](./10-container-runtime-transparency.md).
> Configure gets a **Container engine** preference, Docker or Podman, defaulting to Docker
> without any checks. Only execution detects both CLIs, uses the preferred one if installed,
> and falls back to the other otherwise. Start buttons use evidence from that execution,
> combined with the choice. **Start Podman machine** is offered only on platforms that use
> a Podman machine.

- **Branch:** recorded on `dev/tnaum/quickstart-setup-stage-details-pr`, alongside
  [iteration 11](./11-setup-stage-details.md) (Details on the Set up stages). This approval
  records the plan only; it does not implement it or create another branch.
- **Scope note:** the original request said "W1 + W2". W2 landed in `8087eb30`, and the operator's
  notes are about W1 (provider memory) and W8 (Podman start), so this plan covers W1 and W8.
- **Not in scope:** the rest of iteration 10's W5 (wording of the check table, guides and outcome
  messages). This plan adds only the strings it needs and follows W5's vocabulary table.

## 1. Operator direction (2026-11-10)

1. **A "preferred engine" choice in Configure**, Docker or Podman, with **Docker always the
   default**. Configure does not need to know which engine is present and must not run checks,
   including PATH lookups, version commands, daemon probes or platform detection.
2. **Detect both CLIs during execution**, then use the preferred one if installed, or the other
   if it is installed. A choice in Configure is a preference, not a claim about availability.
3. **W8 is gated by platform detection during execution.**
4. **W1: do not store which provider was detected.** "Things can change between runs." Show start
   buttons based on what is known at check time, combined with the preferred engine.

The operator approved the proposal with this simpler Configure stage. This **amends** iteration
10's resolved question 2 ("No setting. Docker always wins when both are installed") and its
draft engine-choice decision ("there is no setting to change this"). That draft's number 0008
is not the accepted stage-Details decision now recorded as 0008 in [decisions.md](../decisions.md).

## 2. How it works today

| Area | Today | Source |
| --- | --- | --- |
| CLI choice | `resolveContainerCli`: Docker if `docker` is on PATH, else Podman if `podman` is, else Docker, so readiness can report a missing CLI. Both PATH results are already returned as `onPath`. It is re-resolved on every readiness check. | `containerCli.ts` |
| Which client runs commands | `ContainerRuntimeImpl` holds **one** `client`. `refreshClient()` replaces it during readiness, and pull, run, inspect, start, stop, remove, volume, exec and logs all use whichever client was last resolved. | `ContainerRuntime.ts` |
| Instance record | `alias`, `displayName`, `port`, `phase`, `imageRef`. It does **not** record which engine holds the container and its data volume. | `quickStartStore.ts` |
| Provider memory | `globalState` key `DOCKER_PROVIDER_MEMORY_KEY`. It is written on every reachable check, for **any** CLI: Podman writes `provider: 'unknown'` over a Docker record. It is read while the daemon is down, to classify `rememberedProvider`, `daemonStarting` and the Docker Desktop start action on Linux. | `DockerReadinessService.ts` (`runReadiness`) |
| The W1 leak | With the Podman CLI and the daemon down, a remembered `dockerDesktop`, or Docker Desktop installed on disk (`installedApplication`), can make the panel offer **Start Docker Desktop** to a Podman user. | `classifyDockerProvider`, `getDockerStartCapability` |
| Start actions | Docker Desktop (Windows, macOS, Linux, Windows from WSL) and rootless Docker Engine (Linux). There is no Podman action yet. | `DockerProviderLauncher.ts` |
| Platform signal | `detectDockerHostEnvironment` returns `windows`, `macos`, `linux`, `wsl`, `ssh`, `devContainer`, `codespaces`, `otherRemote` or `unsupported`. | `DockerReadinessService.ts` |
| Introduction copy (W4) | Plan step 1 says "…Docker is used when both are installed." | `LocalQuickStart.tsx`, `build/verification/browser/scenarios.ts` |

**A gap this plan must close first.** With a preference, Docker and Podman can both be installed
and the instance can live in Podman. Lifecycle commands from the tree (Start, Stop, Delete,
reconcile) would then run against whichever client the last readiness check picked, which may be
Docker. They would report the container as missing, or act on the wrong engine. Containers and
volumes are per engine, so **the instance must remember its engine** (§3.3). That is a fact about
where the instance's data lives, not a guess about the environment, so it is not the kind of
storing that W1 rejects (Q3).

## 3. Design

### 3.1 Execution-time CLI resolution with a preference

```ts
// containerCli.ts — illustrative
export interface ResolvedContainerCli {
    readonly cli: ContainerCli;
    readonly executable: string;
    readonly onPath: ContainerCliPresence;
    /** What the run asked for. */
    readonly preferred: ContainerCli;
    /** The preferred CLI was not on PATH and the other one was used. */
    readonly fellBack: boolean;
}

export function resolveContainerCli(preferred: ContainerCli = 'docker', lookup?: ContainerCliLookup): ResolvedContainerCli;
```

- During Set up's checking stage, **look up both Docker and Podman on PATH on each execution**,
  even if the preferred CLI is found first. Reuse the resolver's existing `onPath` results for
  Details; no Configure-time detection or separate duplicate lookup helper is needed.
- Use the preferred CLI if it is on PATH. Else use the other one if **it** is on PATH
  (`fellBack: true`). Else use the preferred one, so readiness reports `cliMissing` for the engine
  the user asked for (`fellBack: false`).
- **Fall back only when the CLI is not found** (Q2). A preferred engine that is installed but not
  running is not "not detected". The check reports it as not running and offers its start button.
  Detecting both CLIs does not mean running daemon probes against both.
- The default preference is `docker`, so today's fresh-setup resolution is unchanged when the
  user leaves the default selected.

### 3.2 Configure step: a "Container engine" row, with no checks

A new row in the existing settings table (`SettingItem`), placed first, because it decides where
everything else runs:

| State | Summary value | Editor |
| --- | --- | --- |
| Fresh setup, untouched | `Docker` | Radio group: **Docker** · **Podman**, with Docker selected regardless of what is installed. |
| Fresh setup, user chooses Podman | `Podman` | Same radio group. No availability badges or detection results. |
| Recreate onto existing data | `Podman · kept from the existing instance` (read-only example) | None. The stored instance's engine owns its data volume (§3.3); this is not an environment-derived preference default. |

- **Configure performs no engine checks and does not wait for them.** Do not call
  `getDockerStatus`, the CLI resolver, platform detection or readiness from wizard mount,
  Introduction, Configure, or a preference change. Move any existing eager readiness work to
  execution. Metadata needed for an existing instance must be read without contacting an engine.
- Both choices are always available, even when neither CLI is installed. Do not show "Found",
  "Not found on PATH", a detected fallback, or a disabled choice in Configure: availability is
  deliberately unknown at that point.
- Static hint: "Setup uses your preferred engine if installed, or the other one otherwise."
  The summary shows the preference, not a predicted runtime selection.
- `AdvancedQuickStartOptions` gains `preferredEngine?: 'docker' | 'podman'`. It is always sent,
  like the port (review L3: no magic after execute). The router's zod schema accepts exactly
  these two values.
- **The preference is not persisted** (Q4). Every fresh Configure form defaults to Docker,
  never to a detected engine, a previous selection, or the last readiness result. Returning to
  Configure in the same wizard may retain the user's explicit selection.
- The execution result carries both CLI presence results and the selected engine. If the
  existing `getDockerStatus` response needs instance metadata, separate that metadata-only
  access from the execution-time readiness path rather than making Configure depend on checks.
- **The Introduction (W4) copy changes**, because "Docker is used when both are installed" is no
  longer true. Proposed: "Confirms Docker or Podman is installed and can run Linux containers on
  this machine. You choose a preferred engine in the next step; setup uses the other if it is
  not installed." Update the L2 `introduction` scenario.

### 3.3 The instance remembers its engine

- `QuickStartInstanceRecord` gains `engineCli?: 'docker' | 'podman'`. It is written by the same
  `upsertInstance` that writes `imageRef` and `phase: 'ready'`, and by the provisioning lease, so a
  crash mid-setup is reconciled in the right engine.
- **Legacy records** (no `engineCli`) resolve the way they do today: Docker if found, else Podman.
  Nothing changes for an existing user until they set up again. This resolution happens during
  execution, never to populate Configure; before resolution, show that the engine is not recorded.
- `IContainerRuntime` methods that act on an instance take the engine explicitly (or a
  `runtime.forCli(cli)` view). `QuickStartService` passes the record's `engineCli` to lifecycle,
  reconcile, delete and credential-restore calls. Only readiness and a fresh provision use the
  preference.
- **Recreate locks the engine.** `canReuseExistingData` and the existing-instance guard look in the
  instance's engine only. A different preference does not relocate existing data.
- If the instance's engine CLI is gone (for example the user uninstalled Podman), the tree reports
  the instance's engine as unavailable. It never quietly switches to the other engine, where the
  container and data do not exist.

### 3.4 W1, replaced: no stored provider for Podman, and no Docker evidence for a Podman run

- **No new provider-memory storage.** The Podman engine and Podman machine state are detected live
  on each execution-time check. The provider-memory record gains no `cli` field, so there is no
  migration (Q1).
- When the run's CLI is `podman`, the readiness service **neither reads nor writes** provider
  memory. This stops a Podman check from overwriting a Docker user's record, and stops a Docker
  record from guiding a Podman run.
- When the run's CLI is `podman`, `installedApplication` (Docker Desktop on disk) and every Docker
  start action are ignored. A Podman run never offers **Start Docker Desktop**.
- Docker runs keep today's provider memory unchanged. It feeds `daemonStarting` and the Linux
  Docker Desktop start action, and removing it is a separate decision (Q1, option B).

### 3.5 Start buttons: what is known now, combined with the preference

The button is chosen for the **engine this run selected** (preference, then fallback), from
execution-time evidence:

| Run's engine | Platform (`environment`) | Live evidence at check time | Button |
| --- | --- | --- | --- |
| Docker | any | as today (Docker Desktop installed, active context, rootless socket) | as today |
| Podman CLI | `macos`, `windows` | `daemonUnavailable`, and `podman machine list` shows a stopped target machine (§3.6) | **Start Podman machine** |
| Podman CLI | `macos`, `windows` | no machine | none. Guidance: run `podman machine init`, with Copy |
| Podman CLI | `linux`, `wsl` | any | none. Copy command `systemctl --user start podman.socket` |
| Docker CLI connected to Podman (shim, positive) | `macos`, `windows` | as for the Podman CLI, using the `podman` executable when it is on PATH | **Start Podman machine** |
| any | `ssh`, `devContainer`, `codespaces`, `otherRemote` | any | none (the engine is not on this machine) |

- **Platform gate (W8).** Only `macos` and `windows` run Podman in a machine. On Linux and in WSL,
  Podman runs natively, so there is no machine to start, and a socket-down state has only inferred
  evidence. Linux gets copy guidance only. This resolves W8 question (a) with the advisor's
  recommendation.
- **One button only.** A run never shows a start button for the engine it did not select. To use
  the other engine for fresh setup, the user goes back to Configure (Q5).
- The button runs only on a click: never on a readiness check, on wizard open or on retry
  (iteration 10's draft start-action decision, unchanged).

### 3.6 Start Podman machine

- **Detection**, only while computing the start capability after a `daemonUnavailable` failure, so
  a healthy check costs nothing: `<podman> machine list --format json`, bounded by the launcher's
  10 s process deadline.
- **Which machine** (W8 question (b), Q6): the machine with `Default: true`, started **by name**
  (`podman machine start <name>`). If no machine is marked default and exactly one exists, use it.
  If several exist and none is the default, show no button, and guidance names the machines.
  Verify the JSON field names (`Name`, `Default`, `Running`, `Starting`) on Podman 5.x and 6.x
  before relying on them.
- A machine reported as `Starting` shows no button, and the state reads as "starting". The existing
  wait loop then polls.
- **On click:** run the start through the existing launcher, using the absolute executable on
  Windows (#1065). Output goes to the setup log. Then enter the existing wait loop
  (`pollDockerReadiness`, "Waiting {0}", Cancel).
- **Cancel stops waiting, not the start.** Killing `machine start` mid-boot can leave the machine in
  a bad state.
- **Results:** exit 0 means `started`. A non-zero exit means `failed`, with stderr in the setup log.
  If stderr says the machine is already running, treat it as `started`, but only after confirming
  the exact wording on 5.x and 6.x. Otherwise leave it as `failed` and re-check.
- `DockerStartAction` gains `startPodmanMachine`, and `DockerStartLabelKey` gains
  `startPodmanMachine` ("Start Podman machine"). Telemetry `dockerStartAction` gets the new value,
  with no new property.

### 3.7 Showing the preference and the fallback

- **Configure:** only the user's preference and the static fallback explanation, never live
  availability or a predicted fallback.
- **Detail line of stage 1:** after a fallback, the engine segment says so: "Podman 5.8.3 (Docker
  not found)". Without a fallback, nothing changes. This is the one detail-line string this plan
  adds; it follows W5's rule that only detail lines and messages name the engine.
- **Details (iteration 11, checking row):** a "Preferred engine" fact, for example
  "Docker · not found, used Podman", next to the "Command" fact. The two PATH-presence facts
  come from execution, not Configure.
- **Telemetry:** on readiness and provision, add `preferredContainerEngine` (`docker` or `podman`)
  and `containerCliFallback` (`true` or `false`). Both are bounded, and neither name contains
  "error" or "exception".

## 4. Sequencing

Each implementation phase is a separate commit, with Case 1 per commit and Case 2 at hand-over.
This documentation-only approval does not start those implementation checks.

1. **P1 — engine per instance.** `engineCli` on the record and lease, runtime calls with an explicit
   CLI, and legacy records resolving as today. This has no user-visible change, but it must come
   first: without it, P2 can strand an instance.
2. **P2 — preference and execution-time fallback.** `resolveContainerCli(preferred)` detects both
   CLIs using the existing `onPath` shape, `preferredEngine` in options and router, and readiness
   memoized per CLI. Fresh execution re-resolves both CLIs; no Configure result determines it.
3. **P3 — check-free Configure and Introduction copy.** Add the row with Docker always the default,
   remove eager checks from wizard mount and pre-execution steps, and split metadata access from
   readiness where needed. No detection-dependent hints or validation.
4. **P4 — W1 replaced.** No provider memory for Podman runs, and no Docker evidence or start action
   for them.
5. **P5 — W8.** Machine detection, the `startPodmanMachine` action, the platform gate, the button
   and the wait.
6. **P6 — fallback display, telemetry, docs.** The detail-line segment, the Details fact, the user
   manual, the README timeline, and accepted decisions for engine preference and platform-gated
   startup. Use the next available decision numbers; iteration 10's draft numbers must not
   overwrite the accepted stage-Details decision 0008.

## 5. Tests

- `containerCli.test.ts`: every combination of preference × {docker, podman, both, neither} on
  PATH, including Windows `PATHEXT` and the absolute executable. Assert both lookups happen even
  when the preferred CLI is found, and a new execution sees changed PATH contents.
- Configure tests: opening the wizard, moving through Introduction and Configure, and switching
  preferences never invokes PATH lookup, platform detection, `getDockerStatus` or readiness.
  Docker is always the fresh default, including Podman-only and neither-installed environments.
  Both options remain selectable without checks; the chosen preference is sent unchanged.
  Existing-instance metadata is obtained without an engine probe, and legacy records do not
  trigger detection in Configure.
- `QuickStartService.test.ts` and `QuickStartProvisionDurability.test.ts`: the record and lease
  carry `engineCli`. Lifecycle and reconcile use the record's engine even when the other CLI is
  preferred or found first. A legacy record resolves as today during execution. A recreate
  ignores a different preference. An installed but stopped preferred engine does not trigger
  fallback to a running alternative.
- `DockerReadinessService.test.ts`: a Podman run with a remembered `dockerDesktop` and Docker Desktop
  installed gives `podmanNotRunning`, with no start action and no memory write. A Docker run's
  memory behaves exactly as before.
- `DockerProviderLauncher.test.ts`: Start Podman machine on macOS and Windows with a stopped default
  machine. No button on `linux`, `wsl` or remote, with no machine, with several machines and no
  default, or with a machine that is starting. The start runs by explicit name. Cancel leaves the
  process running.
- `advancedOptions.test.ts`, `localQuickStartRouter.test.ts`: `preferredEngine` is always sent and
  the schema rejects other values. Metadata-only access does not call readiness.
- L2 scenarios: `configure-engine-default`, `configure-engine-choice`, `configure-engine-recreate`,
  `setup-engine-fallback`, `podman-machine-stopped-mac` (with the button), and
  `podman-linux-socket-down` (copy only), in all three themes. Assert no pre-execution readiness
  calls, no availability hints, and fallback displayed only after execution. Update
  `introduction` for the new copy.
- Manual matrix (iteration 10, updated): both engines installed with each preference; only Podman
  installed while Configure still defaults to Docker (fallback shown only during execution);
  neither installed (Configure still works, checking stage gives install guidance); a stopped
  Podman machine on macOS and Windows; Linux Podman with the socket down; an instance created in
  Podman, then Docker installed (the tree still manages it in Podman).

## 6. Approved resolutions and considered alternatives

The operator approved the recommended choices below, with Q4 and Q7 amended so Configure
does not check availability and always defaults to Docker for a fresh preference.

| # | Question | Approved resolution |
| --- | --- | --- |
| Q1 | What happens to provider memory? | **A.** None for Podman runs; Docker's memory unchanged |
| Q2 | When does setup fall back to the other engine? | **A.** During execution, only when the preferred CLI is not found |
| Q3 | Does the instance record its engine? | **A.** Yes, `engineCli` on the record |
| Q4 | Is the preference itself persisted? | **A, amended.** No; a fresh Configure form always defaults to Docker, without detection |
| Q5 | When the selected engine is down, is the other engine offered? | **A.** No; one button, for the selected engine only |
| Q6 | Which Podman machine does the button start? | **A.** The `Default: true` machine by name; the only machine if just one; else no button |
| Q7 | Where does the Configure row appear? | **A, amended.** Always, first in the table, with static choices and no availability hints |

### Q1 — What happens to provider memory?

- **A. None for Podman runs; Docker's memory stays as it is.** A Podman run neither reads nor writes
  it, and the record keeps its shape.
  - Pros: it fixes the W1 leak with no schema change and no migration. It follows "don't store"
    for everything new. Docker behavior, including `daemonStarting` after a reboot, is unchanged.
  - Cons: the extension still stores something for Docker, so the two engines behave differently.
- **B. Remove provider memory entirely.**
  - Pros: fully live, and one rule for both engines.
  - Cons: Docker users lose `daemonStarting` ("Docker Desktop is starting") and the Linux Docker
    Desktop start button whenever no context or socket shows Docker Desktop. That is a regression
    of iteration 04's behavior, outside this plan's purpose.
- **C. Iteration 10's W1: add `cli` to the record and treat old records as Docker.**
  - Pros: Podman could also benefit from memory.
  - Cons: it is the storing the operator questioned, and it needs a migration decision.

**Approved: A.** If B is wanted, plan it separately, with its own Docker regression tests.

### Q2 — When does setup fall back to the other engine?

- **A. Only when the preferred CLI is not found, determined during execution.**
  - Pros: it matches "fallback in case it's not detected". The preferred engine is never silently
    swapped because it was merely stopped, and the start button and guidance stay for the engine
    the user chose.
  - Cons: a user who prefers Docker while Docker Desktop is stopped, and Podman is running, is told
    to start Docker. They have to switch engines in Configure.
- **B. Also when the preferred engine's daemon is not reachable.**
  - Pros: setup "just works" more often.
  - Cons: the instance can end up in an engine the user did not choose, and its data volume is
    then split from any earlier one. It becomes hard to explain, and it reverses on the next run
    if Docker is up.
- **C. Never fall back; the preference is strict.**
  - Pros: simple and predictable.
  - Cons: it contradicts the request, and it regresses #1065 for Podman-only users who leave the
    default.

**Approved: A**, with the fallback stated during execution (§3.7), not predicted in Configure.

### Q3 — Does the instance record its engine?

- **A. Yes, `engineCli` on the instance record.**
  - Pros: lifecycle commands always target the engine holding the container and its volume. It is
    a fact about the instance, not a guess about the machine, so it does not go stale the way
    provider memory does.
  - Cons: it is one more stored field, and legacy records need a defined default (today's
    execution-time resolution).
- **B. Find it live: look for the labelled container in both engines.**
  - Pros: nothing stored.
  - Cons: it runs two engines' commands on every reconcile and tree refresh. It is ambiguous when
    both hold a leftover, and it fails when the instance's engine is stopped (no answer is not the
    same as absent).
- **C. Use the current preference for lifecycle too.**
  - Pros: nothing new.
  - Cons: incorrect as soon as the preference differs from the engine that created the instance.

**Approved: A.**

### Q4 — Is the preference itself persisted?

- **A, amended. No; a fresh Configure form always defaults to Docker, without checks.**
  - The user may choose Podman regardless of availability. Only execution detects both CLIs and
    resolves the choice. Existing data remains pinned to its recorded engine (§3.3); that is an
    instance fact, not an automatically chosen preference.
  - Pros: Configure is simpler and does not require availability information. It follows the
    operator's explicit default and "things can change between runs" direction.
  - Cons: a user who sets up again from scratch must choose Podman again; a Docker preference on
    a Podman-only machine is resolved by fallback during execution.
- **B. Remember the last choice in `globalState`.**
  - Pros: one less click on the next fresh setup.
  - Cons: it conflicts with the approved Docker default. A stored choice can point at an engine
    that has since been uninstalled.
- **C. A VS Code setting (`documentDB.localQuickStart.preferredContainerEngine`).**
  - Pros: discoverable, syncs across machines, and can be scripted.
  - Cons: two places to set the same thing. Settings Sync can carry "Podman" to a machine that only
    has Docker.

**Approved: A, amended.** The original detection-derived default is explicitly rejected.

### Q5 — When the selected engine is down, is the other engine offered?

- **A. No. One button, for the selected engine only.** The user switches engines in Configure
  for fresh setup.
  - Pros: no competing actions, and no risk of creating the instance in an engine the user did
    not choose.
  - Cons: one extra step back for a user who would happily use the other engine.
- **B. A secondary action: "Use Podman instead".** It sends the user back to Configure with Podman
  selected.
  - Pros: it shortens the switch.
  - Cons: more copy and state. It needs the other engine's live status to avoid offering one that is
    also down, which means probing it as well.

**Approved: A.** B can be considered later without changing the model.

### Q6 — Which Podman machine does the button start?

- **A. The machine marked `Default: true`, started by explicit name.** If no machine is marked
  default and exactly one exists, use it. Otherwise show no button, and guidance lists the
  machines.
  - Pros: it targets the machine Podman itself uses for connections, and never starts one the
    CLI will not use. This is the advisor's recommendation from iteration 10.
  - Cons: a JSON parse that must be verified across Podman versions.
- **B. A bare `podman machine start`.**
  - Pros: no parsing.
  - Cons: it targets the literal `podman-machine-default`, which may not be the default connection
    or may not exist.

**Approved: A.**

### Q7 — Where does the Configure row appear?

- **A, amended. Always, as the first row, with no availability hints.**
  - Pros: it shows that Podman is supported, and the preference is explicit before anything runs.
    A static hint explains fallback without requiring a check.
  - Cons: one more row for the majority, who only have Docker.
- **B. Only when both CLIs are found.**
  - Pros: a quieter Configure step for single-engine users.
  - Cons: it requires the very Configure-time detection the operator rejected, and hides the
    preference when only one engine is installed.

**Approved: A, amended.** The row is a one-line summary until opened, like the other rows.
