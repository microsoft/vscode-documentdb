---
feature: local-quickstart
kind: plan
status: active
prs: [1065]
created: 2026-11-09
code:
  - src/services/localQuickStart/containerCli.ts
  - src/services/localQuickStart/DockerReadinessService.ts
  - src/services/localQuickStart/dockerReadinessClassification.ts
  - src/services/localQuickStart/dockerProbes.ts
  - src/services/localQuickStart/DockerProviderLauncher.ts
  - src/services/localQuickStart/dockerRecoveryCommands.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/services/localQuickStart/quickStartMessages.ts
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/QuickStartDiagnosticsProvider.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts
  - src/webviews/documentdb/localQuickStart/dockerReadinessTelemetry.ts
  - src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts
---

# 10 — Show which container engine Local Quick Start is using

> PR #1065 lets Local Quick Start fall back to Podman when the Docker CLI is missing. The
> fallback works, but the UI still says Docker throughout, and in some cases names the wrong
> product. This plan makes the selected engine visible: one sentence on the Introduction
> page, an accurate engine name in the detail line of the first setup stage (stage headings
> stay fixed), a user-clicked **Start Podman machine** button, and neutral wording everywhere
> else.

- **Builds on:** [#1065](https://github.com/microsoft/vscode-documentdb/pull/1065) ·
  `dev/guanzhousong/quickstart-podman-fallback`
- **Status:** plan only, with no code changes yet

## Why

Ground truth after #1065. The code wins for behavior; this is a snapshot taken 2026-11-09.

| Surface                                                   | What a Podman user sees today                                                                                                                                | Problem                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Introduction subtitle and plan step 1                     | "…for development and testing with Docker." · "Verify your Docker setup"                                                                                     | Podman users cannot tell whether their setup is supported until setup fails or succeeds           |
| Set up stage 1 label                                      | "Checking Docker"                                                                                                                                            | Names the wrong product                                                                           |
| Stage 1 detail line                                       | Provider segment is `unknown`, so it shows **"Docker"** plus the raw `--version` output                                                                      | `podman info` has no `OperatingSystem`, so the provider is `unknown`, and it is labelled "Docker" |
| "What the Docker check found" table                       | "Docker CLI · Found, version …" with "The docker command was located and run…"; Provider "Unknown"                                                           | Incorrect statements: the `docker` command did not run                                            |
| Daemon unavailable, Podman CLI, Docker Desktop remembered | Provider memory (`documentdb.quickstart.dockerProvider`) is shared across CLIs, so "Start Docker Desktop" guidance or action can win over `podmanNotRunning` | **Incorrect diagnosis.** By the review severity scale this is **med**                             |
| Success                                                   | "Docker is ready"                                                                                                                                            | Names the wrong product                                                                           |
| Tree tooltips                                             | "Runs in Docker", "Docker provider: Unknown", "Docker version: podman version 5.x"                                                                           | Names the wrong product; "Unknown" when the engine is known                                       |
| Host error messages                                       | "Docker became unavailable…", "Remove it with Docker…"                                                                                                       | Mostly harmless, but inconsistent                                                                 |
| Setup log                                                 | Already "View setup log"; the channel is "DocumentDB Local Setup"; logged commands show `podman …`                                                           | Already neutral. Only the user manual still says "View Docker output"                             |
| Telemetry                                                 | `dockerProvider=unknown`; the selected CLI is not recorded                                                                                                   | Podman adoption cannot be measured                                                                |

### The two Podman setups

1. **Podman CLI** (added by #1065): `docker` is not on PATH, so `podman` runs. The extension
   already knows this from `readiness.cli === 'podman'`.
2. **Docker CLI connected to a Podman engine** (not handled): `docker` is on PATH but connects to
   Podman. This happens when the `podman-docker` shim replaces `docker`, Podman Desktop points
   `/var/run/docker.sock` at its socket, or `DOCKER_HOST` or a Docker context points at
   `podman.sock`. Today this is reported as **"Docker Engine"** (`liveDaemon`), which is incorrect.

Guiding rule (repo memory): **diagnostics must never show an incorrect answer. Leaving out a
detail is better than showing a wrong one.** Name Podman only from positive evidence; otherwise
use a neutral term.

## Design

### Vocabulary

| Situation                      | User-facing term                                             |
| ------------------------------ | ------------------------------------------------------------ |
| Before anything is detected    | "Docker or Podman" in prose and "container engine" in labels |
| Detected Docker                | "Docker", "Docker Desktop" or "Docker Engine", as today      |
| Detected Podman                | "Podman"; "Podman machine" when relevant                     |
| Docker CLI connected to Podman | "Podman (through the Docker CLI)"                            |
| Unknown or no CLI              | "container engine"                                           |

Product names are not translated. Every new string goes through `l10n.t()` with the engine
name passed as `{0}` where possible, so the bundle does not grow by a full set of strings per
engine.

### A. Introduction page: one static sentence

The Introduction is meant to show no detected facts
([0003](../decisions.md#0003--concept-f-docker-verified-as-the-first-setup-stage)). Keep it
static:

- Subtitle: "Set up DocumentDB locally for development and testing with Docker or Podman."
- Plan step 1: label **"Check your container engine"**, detail **"Confirms Docker or Podman
  is installed and can run Linux containers on this machine. Docker is used when both are
  installed."**

The last sentence states the preference rule once, where a reader who has both will see it.

### B. Set up step: name the detected engine

The webview needs a new readiness fact: `engine: 'docker' | 'podman' | 'unknown'`, plus
`engineEvidence`.

1. **Stage headings are fixed.** Wizard step titles and Set up stage headings never change
   with detection (operator decision, 2026-11-09). Stage 1 is always **"Checking container
   engine"**, before, during and after the check, whatever was found. The engine is named only
   in the detail line below the heading (item 2) and in the messages below that (items 3 to 5).
   An L2 scenario asserts the heading text is identical in the Docker, Podman and unknown
   cases.
2. **Detail line: the place where the engine is named.** Add a `provider` value for Podman,
   and a new segment when the Docker CLI connects to Podman:
   - Podman CLI: `Podman 5.8.3 · Linux arm64 · runs on this machine`
   - Docker CLI connected to Podman: `Podman 5.8.3 (through the Docker CLI) · Linux arm64 · …`
   - Docker unchanged: `Docker Desktop 27.3.1 · …`
   - Version comes from the server: `podman info` `version.Version`, or Docker `ServerVersion`.
     Do not paste the raw `--version` output, such as "podman version 5.8.3", after a product
     name.
3. **"What the check found" table.** Rename the heading to "What the container engine check
   found".
   - Rows: **"Command"** with value `docker 27.3.1` or `podman 5.8.3`, and a note naming the
     command that actually ran.
   - Change "Engine" to replace "Docker daemon" (for Podman, the note says "Podman machine"
     where relevant). Change "Endpoint" to replace "Docker endpoint".
   - The **"Provider"** row gains the values `Podman` and `Podman (through the Docker CLI)`,
     plus evidence notes for each signal below.
4. **Outcome messages.** These are status messages inside the stage, not headings. They
   appear only once the result is known, so they can name the engine. Use "{0} is ready" and
   "{0} is ready now. Nothing has been created on your machine yet." Use the neutral term when
   the engine is `unknown`. Treat the "Waiting for …", "Check … again" and "Stopped waiting for
   …" strings the same way. For Podman, use "Waiting for the Podman machine to start."
5. **Failure labels** (`dockerFailureLabels`). Keep the keys and format the labels by engine:
   "{0} access denied", "{0} engine unavailable", and so on. Contexts are Docker-only, so
   `contextUnavailable` stays Docker-specific.
6. **Guides.** For `cliMissing`, show both an install guide for Docker and one for Podman
   (`https://podman.io/docs/installation`). When the engine is Podman, the
   `dockerTroubleshooting` fallback should point to Podman's troubleshooting page.

### C. Detection: separate the engine from the CLI

New pure function `classifyContainerEngine(evidence)` in `dockerReadinessClassification.ts`.
Signals, strongest first:

| #   | Signal                                                                                                                      | Evidence type         | Cost                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| 1   | Selected CLI is `podman` (`client.id === PodmanClient.ClientId`)                                                            | positive              | free                                                          |
| 2   | `info` output parses as `PodmanInfoSchema` (`host.os` plus `version.Version`)                                               | positive, live daemon | free; already parsed                                          |
| 3   | `--version` stdout starts with `podman version` (the `podman-docker` shim), or stderr has `Emulate Docker CLI using podman` | positive              | free; already captured                                        |
| 4   | Docker `version --format json` → `Server.Components[].Name === 'Podman Engine'`                                             | positive, live daemon | **one extra probe**; run it only once the daemon is reachable |
| 5   | Resolved endpoint path or pipe contains `podman` (`DOCKER_HOST`, context endpoint, `podman-machine-default` pipe)           | inference             | free                                                          |
| 6   | `/var/run/docker.sock` is a symlink whose target contains `podman`                                                          | inference             | one `fs.realpath`; macOS and Linux only                       |

Rules:

- Signals 1 to 4 can name **Podman** in the UI. Signals 5 and 6 can only _add_ an evidence
  note ("The endpoint looks like a Podman socket"). They never change the engine label on
  their own.
- When the daemon is reachable and 2 or 4 identify Podman, `classifyDockerProvider` returns
  `podman` and never `dockerEngine`. This fixes setup 2, which today is reported as
  "Docker Engine".
- Extend `DockerProvider` with `'podman'`. Update `assertNever` call sites and telemetry. This
  is a behavior change in bounded categories, so it is safe for telemetry.

### D. Fix the remembered-provider leak

- Scope `DockerProviderMemory` by CLI: store `cli` in the record, and treat a record as current
  only when `record.cli === readiness.cli`. Records written before this change have no `cli`.
  Treat them as `docker`.
- Use `installedApplication` evidence (Docker Desktop on disk) only when the selected CLI is
  `docker`. When the selected CLI is `podman`, `getStartCapability` must never offer **Start
  Docker Desktop**.
- Podman's own start path is in H.

### H. Start Podman machine: a button, never automatic

Operator decision (2026-11-09): the Podman machine is started **only when the user clicks**.
Nothing starts it during a readiness check, on wizard open or on retry. This is the same
contract as **Start Docker Desktop** today: `startDockerProvider` runs only from the user's
click.

- **New start action.** `DockerStartAction` gains `startPodmanMachine`, and
  `DockerStartLabelKey` gains `startPodmanMachine`, with the label **"Start Podman machine"**.
- **When `getDockerStartCapability` offers it.** All of these must be true:
  - The engine is Podman from _positive_ evidence (C signal 1 or 3).
  - `failureKind` is `daemonUnavailable`.
  - The environment is `windows` or `macos`. On Linux the Podman CLI needs no machine; see
    the last bullet.
  - `podman machine list --format json`, run with the resolved executable, lists at least one
    machine and reports it as not running. This check runs only while the capability is being
    computed, which already happens after a failure, so a healthy check pays nothing.
- **No machine exists:** no button. Guidance says "Podman is installed but has no machine.
  Run `podman machine init`, then start it." A Copy command is provided. `init` downloads an
  image and makes sizing choices, so the user runs it themselves.
- **When the user clicks:**
  - The extension runs `<resolved podman> machine start` (the default machine) through the
    existing launcher, using the absolute path on Windows (see #1065).
  - The output goes to the setup log.
  - It then enters the existing wait loop (`pollDockerReadiness`, "Waiting {0}", Cancel),
    using the Podman wording from B.4.
- **Cancel stops waiting, not the start.** Cancel stops only the wait. The
  `podman machine start` process is left to finish, because killing it mid-boot can leave the
  machine in a bad state. The message reads "Stopped waiting for the Podman machine. It may
  still be starting."
- **Results:**
  - Exit 0 → `started`, then re-check.
  - Non-zero exit → `failed`, and stderr is visible in the setup log. If stderr says the
    machine is already running, treat it as `started` and re-check. Confirm the exact wording
    on Podman 5.x and 6.x before matching it.
- **The Copy command stays.** `podman machine start` is still shown through
  `dockerRecoveryCommands` with Copy, for users who prefer a terminal.
- **Linux, setup 2 only.** A Docker CLI connected to a rootless Podman socket, where the
  socket is down: offer `systemctl --user start podman.socket` behind the same button pattern,
  labelled **"Start Podman service"**. The conditions mirror `startRootlessDockerEngineLinux`:
  - The endpoint matches `/run/user/<uid>/podman/podman.sock`.
  - The `podman.socket` user unit exists.

  Never offer it for a root-managed service.

### E. Neutral wording in the remaining Docker-specific strings

These are not about detection, so use one neutral term, or format with `{0}` when the engine
is known at the call site:

- `quickStartMessages.ts`: "The container engine became unavailable during setup", "The
  container engine could not find the image {0}…", "…restart Docker or the Podman machine."
- `QuickStartService.ts`: in "Remove it with Docker", "Docker could not remove…" and
  "…remove the volume with Docker", replace "Docker" with "your container engine (Docker or
  Podman)" or the engine name from the last readiness snapshot.
- `QuickStartDiagnosticsProvider.ts`: "Docker does not appear to be running…" becomes "{0} does
  not appear to be running…", using the snapshot's engine.
- Tree, `LocalQuickStartItem.ts`:
  - Empty-state tooltip: "Runs in Docker or Podman".
  - Instance tooltip: change "Docker provider", "Docker version" and "Docker endpoint" to
    **"Container engine"**, **"Engine version"** (server version, not CLI output) and
    **"Engine endpoint"**.
  - Rename the action "Review Docker setup" to **"Review container engine setup"**.
- Keep the log surfaces as they are ("View setup log", channel "DocumentDB Local Setup").
  Update the user manual, which still says "View Docker output".
- Comments and identifiers (`DockerReadiness`, `docker logs -f` in JSDoc) are out of scope.
  Renaming types adds churn and no user value.

### F. Telemetry

Add bounded properties to `getDockerReadinessTelemetryProperties`:

- `containerCli`: `docker` or `podman`
- `containerEngine`: `docker`, `podman` or `unknown`
- `containerEngineEvidence`: one of the signal names in C
- The existing `dockerStartAction` and launch-result telemetry gain `startPodmanMachine` and
  `startPodmanSocketLinux` as values. No new property is needed.

Keep the existing `docker*` names for dashboard continuity. None of the new properties
contains `error` or `exception` in its name, so whole-error masking leaves them alone.

### G. User manual

In `docs/user-manual/local-quick-start.md`:

- Rename "Docker requirement" to "Container engine requirement". Document Docker as preferred
  and Podman as the fallback, and explain how a Docker CLI connected to Podman is reported.
- Add a "Podman machine is not running" troubleshooting section. It covers the **Start Podman
  machine** button, which is only ever clicked by the user, the `podman machine init` case,
  and that cancelling the wait does not stop the machine from starting.
- Say that Docker is always preferred when both are installed, and that there is no setting
  to change this.
- Replace "View Docker output" with "View setup log".
- Keep the gaps from #1065 in the PR's _Not covered_ section, and remove each one as this plan
  closes it.

## Work items

Each item is a separate commit. Record progress inline under each item as it lands.

| #   | Item                                                                                                         | Depends on | Tests                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | **D:** scope provider memory by CLI; ignore Docker Desktop install evidence for Podman                       | —          | `DockerReadinessService.test.ts`: Podman CLI plus remembered `dockerDesktop`, daemon down → `podmanNotRunning`, no start action                                                                                                                                                                                                                     |
| W2  | **C:** `classifyContainerEngine`; `DockerProvider` gains `podman`; server version from `info`                | —          | `dockerReadinessClassification.test.ts`: one case per signal, including the shim stdout and the inference-only endpoint; `dockerProbes.test.ts`: Podman `version.Version` → `serverVersion`                                                                                                                                                         |
| W3  | **C4:** `docker version` probe once the daemon is reachable, so a Docker CLI connected to Podman is detected | W2         | Probe skipped when unreachable; `Podman Engine` component → `podman`; malformed JSON → no claim                                                                                                                                                                                                                                                     |
| W4  | **A:** Introduction subtitle and plan step 1                                                                 | —          | Update `build/verification/browser/scenarios.ts` expected content                                                                                                                                                                                                                                                                                   |
| W5  | **B:** fixed neutral stage heading, detail line, findings table, outcome and failure labels, guides          | W2         | `dockerReadinessPresentation.test.ts`: Podman, Docker CLI connected to Podman, unknown; new L2 scenarios `podmanReady`, `podmanMachineStopped` and `dockerCliOnPodman` in light, dark and high-contrast. These scenarios assert that the stage heading is identical in every case                                                                   |
| W6  | **E:** host messages, diagnostics provider, tree tooltips and action label                                   | W2         | `LocalQuickStartItem.test.ts` tooltip snapshots; `quickStartMessages` tests                                                                                                                                                                                                                                                                         |
| W7  | **F:** telemetry properties                                                                                  | W2         | `dockerReadinessTelemetry` test                                                                                                                                                                                                                                                                                                                     |
| W8  | **H:** **Start Podman machine** button (macOS and Windows) and **Start Podman service** (Linux, setup 2)     | W1, W2     | `DockerProviderLauncher.test.ts`: offered only with positive Podman evidence, a stopped machine and `daemonUnavailable`; no machine → no button and `init` guidance; never offered on a readiness check without a click; already-running stderr → `started`; cancel leaves the process running. L2 scenario `podmanMachineStopped` shows the button |
| W9  | **G:** user manual; feature README timeline row; `decisions.md` entries (see below)                          | W1–W8      | none; docs only                                                                                                                                                                                                                                                                                                                                     |

Validation per commit (Case 1): `npm run build` plus the touched tests. The full Case 2 list
runs once at hand-over. Run `npm run l10n` there, because W4 to W6 and W8 change many
`l10n.t()` strings.

### Manual matrix

These are the same platforms #1065 tested, plus setup 2:

- macOS and Windows with Podman only, machine running and stopped
- Machine stopped → click **Start Podman machine** → ready; cancel the wait while it boots;
  click it when the machine is already running; no machine at all (no button, `init`
  guidance)
- Docker and Podman both installed (Docker selected; Podman must never appear)
- macOS Podman Desktop with the `/var/run/docker.sock` compat symlink and `docker` on PATH
  (setup 2)
- Fedora with `podman-docker` installed (setup 2, Linux; #1065 left Linux untested)
- An existing Docker Desktop provider memory, then Docker removed and Podman installed (W1
  regression)

## Decisions to record

Draft `decisions.md` entries for W9. The operator decisions are from 2026-11-09:

> **0008: Name the container engine only from positive evidence, and never in a heading.**
> Docker is preferred when both CLIs are present, and there is no setting to change this. The
> UI names Podman only when one of these says so: the selected CLI, `info`, the shim's version
> output, or the server components reported by `docker version`. Endpoint paths are shown as
> evidence notes, never as the engine label. Wizard step titles and Set up stage headings are
> fixed and neutral; only the detail line and status messages name the engine. A Docker CLI
> connected to Podman is named, not warned about. Internal type names keep the `Docker`
> prefix.
>
> Rejected:
>
> - Renaming all identifiers.
> - Inferring Podman from socket paths alone.
> - Stage headings that change after detection, such as "Checking Docker" turning into
>   "Checking Podman".
> - An engine preference setting.
> - A compatibility warning for a Docker CLI connected to Podman.

> **0009: Podman is started only from a user-clicked button.** **Start Podman machine**
> (macOS and Windows) and **Start Podman service** (Linux, rootless socket) run only when the
> user clicks them. They never run during readiness checks, on wizard open or on retry. They
> are offered only with positive Podman evidence and an existing, stopped machine.
> `podman machine init` is never run by the extension. Cancelling the wait does not stop a
> machine start already in progress.
>
> Rejected:
>
> - Starting the machine automatically.
> - Copy-only recovery with no button.
> - Running `init` on the user's behalf.

## Resolved questions

Operator answers, 2026-11-09:

1. **Podman start.** Started by the user, never automatically. A button is wanted, so it is in
   scope as H and W8.
2. **Engine preference setting.** No setting. Docker always wins when both are installed. This
   is documented in G.
3. **Docker CLI connected to Podman.** Name it only; no warning.
4. **Cost of W3's extra probe.** Not a problem, so W3 is unconditional.
5. **Stage headings.** They never change; only the detail line names the engine (B.1).

## Outcome

_To be written at hand-over: what was verified, and just as plainly, what was not._
