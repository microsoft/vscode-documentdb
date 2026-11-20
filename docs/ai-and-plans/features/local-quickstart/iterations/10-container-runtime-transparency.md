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
- **Status:** partial implementation; W2 (`8087eb30`), W3 (`1da29012`), W4 (`fb06ae0d`),
  W6 (`2c8deb28`), and W7 (`31775c89`) complete (5/9); W1 and W8 deferred, W5 partial
  with heading-only W5a (`cbc573ba`) complete and the rest parked, and W9 partial
  documentation maintenance. Remaining items are not complete.

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

### Execution status (2026-11-09)

Opus 5.5 advised W1, then W2, then parallel W3, W4→W5, W6 and W7; W8 after its
dependencies; W9 last. Recommendations were W1/W2/W3/W8 on gpt-6.1-sol, W4/W5/W6 on
gpt-6.1-terra, and W7/W9 on gpt-6-luna. Advisor confidence was 84% for W2 contracts and
82% overall; leader scheduling confidence was 99%, not a technical decision. The operator
was unavailable to approve the always-ask gates, so W1, W5, and W8 are parked; source items
W2–W4 and W6–W7 are treated as accepted under /lead's operator-unavailable rule and proceed
without changing those gates. The shim label remains exactly "Podman (through the Docker
CLI)", as specified in the source plan; no new label decision is recorded.

- **W2 — Done (2026-11-09), commit `8087eb30`:** Added the positive-evidence classifier,
  optional engine/evidence/serverVersion facts, strict Podman info parsing, and
  provider-union/map exhaustiveness. The existing persisted shape and probe counts are
  preserved; W1 and W3 remain separate. The source item was treated as accepted under
  /lead's operator-unavailable rule. Opus 5.5 advised the interface (84%) and reviewed the
  logic (87%); leader coordination confidence was 99% and selected Sol for cross-module
  impact. Added 48 tests; `npm run build` passed; focused tests passed across five root
  files (157 tests: classifier, probes, readiness service, integration, and tree item).
- **W3 — Done (2026-11-09), commit `1da29012`:** Sol (`gpt-6.1-sol`) added the
  reachable-only raw server-components probe and inference-only socket-target resolver.
  Inference does not claim a platform. Unexpected probe failures produce code-only
  diagnostics; ordinary optional-probe errors preserve readiness, while caller cancellation
  propagates. Opus 5.5 confidence: design 86%, core logic 90%, error-logging rework 88%, final
  review 92%. Added 63 tests (30 service, 33 probes); 210 focused tests across four files and
  `npm run build` passed. Incidental call counts, mocks, and deferred-probe expectations were
  updated; intent, outcome/cancel, memory, and stdout assertions remain. The initial
  silent-catch advice was strengthened with the same advisor's approval; there were no other
  contrary technical verdicts.
- **W4 — Done (2026-11-09), commit `fb06ae0d`:** Applied the three Introduction strings
  exactly as specified in source A, keeping the presentation static and updating matching
  browser content assertions; no calls, order, or timing changed. The source item was
  treated as accepted under /lead's operator-unavailable rule. Leader mechanical-review
  confidence was 99%; exact source wording required no advisor logic gate. Terra was selected
  for the bounded W4→W5 UI chain. Added 0 tests; strengthened existing expected-content
  assertions. `npm run build` passed; `scenarios.test.ts` passed (15 tests; registry and
  declaration check only, rendered UI not yet tested). Pre-existing observation, not a W4
  behavior change: the mount `getDockerStatus` call can probe readiness while Introduction
  is visible; this was not changed and is out of scope.
- **W6 — Done (2026-11-09), commit `2c8deb28`:** Terra localized neutral host messages and
  added engine-fact diagnostics/tree tooltips using server version only; no ID, credential,
  or control-flow changes. The source item was treated as accepted under /lead's
  operator-unavailable rule. Opus 5.5 review confidence was about 85%. Terra was chosen for
  the bounded UI/message work. Added 16 cases; 93 focused tests across four files and
  `npm run build` passed. An initial nested-test failure was corrected.
- **W7 — Done (2026-11-09), commit `31775c89`:** Added bounded `containerCli` (omitted if
  absent), `containerEngine` (default `unknown`), and `containerEngineEvidence` (default
  `none`), retaining existing `docker*` properties and fingerprint semantics. The source
  item was treated as accepted under /lead's operator-unavailable rule. Leader confidence
  was 99% in classifying the mapping as mechanical, with no advisor logic gate because no
  lifecycle, public API, or schema changed; Luna was chosen for the mechanical work. Added
  2 tests covering 5 CLI/engine/absence combinations; all 4 tests passed. `npm run build`
  passed, as did
  `npx vitest run src/webviews/documentdb/localQuickStart/dockerReadinessTelemetry.test.ts`.
- **W1 — Deferred, escalated (2026-11-09):** Adding the optional CLI field to persisted
  provider memory requires operator approval of migration/retention. Old records would be
  treated as Docker. Options: ignore mismatched records (advisor recommendation), or revise
  the migration. No decision is approved.
- **W5 — Deferred, escalated (2026-11-09):** At 80% confidence, the advisor identified
  always-ask choices about hiding a stale Docker Desktop start label when Podman has positive
  evidence, new guide URLs/labels, neutral unknown-engine sentences, and exact evidence
  notes. The operator was unavailable; those W5 changes remain parked. Options: approve the
  bounded completions (advisor recommendation, not approved) or review the exact wording.
  The operator subsequently requested the heading-only W5a fix: stage 1 now always reads
  `Checking container engine`. W5 remains partial; the rest is parked.
- **W5a — Done (2026-11-09), commit `cbc573ba`:** The operator explicitly requested the
  neutral first-stage heading. Terra (`gpt-6.1-terra`) changed the shared label, without
  detection-dependent wording or lifecycle changes. Leader review confidence was 99%:
  the wording implements B.1 exactly, so no additional advisor decision was needed.
  Added seven regression cases covering the existing setup scenarios; build and all
  22 focused scenario tests passed. All 30 existing browser routes passed across three
  themes, plus direct first-row checks in dark, light and high-contrast. The remaining
  W5 choices are unchanged and parked.
- **W8 — Deferred, escalated (2026-11-09):** (a) Linux socket-down state has only inferred
  evidence, conflicting with the positive-evidence rule and draft 0009’s stopped-machine
  condition. Options: defer the Linux button and retain copy guidance (advisor
  recommendation), allow a button only with retained positive evidence, or revise the
  design. (b) `Default: true` identifies the default CONNECTION, while bare machine start
  targets the literal `podman-machine-default`. Options: select a stopped, non-starting
  `Default: true` machine and launch by explicit name (advisor recommendation), or retain the
  literal default target. No decision is approved.

- **W9 — Partial (2026-11-09), docs commit `8c2daa71`:** The user manual and feature README
  document the implemented subset only. No decision entries were added while the W5/W8
  gates remain unresolved; W9 is not complete. Tooling commit `65c58751` contains generated
  localization and formatting only.

All nine source work items remain: W2, W3, W4, W6, and W7 are done; W1 and W8 are
deferred; W5 and W9 are partial, with heading-only W5a done and the rest of W5 parked.
Case 1 (`npm run build` plus focused tests) is required before each code item's commit.
Run full Case 2 once at the end, including `l10n` and the dedicated browser configuration.

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

W9 remains partial. No 0008/0009 decision entries were recorded while W5/W8 remain blocked.

Before the W5a heading follow-up, Case 1 passed for each completed code item (W2, W3, W4, W6, W7).
Browser verification passed for all 30 existing Local Quick Start routes (10 each in dark, light, and high-contrast),
with 15 assertions and zero errors or failures. W4's exact Introduction content passed in all
three themes. The first browser attempt failed because the browser-tool host did not provide
`setTimeout`; rerunning the unchanged helper with `setTimeout` bound to `page.waitForTimeout`
passed.

Before the W5a heading follow-up, all eight Case 2 commands and the additional browser-harness
command exited 0:

| Command                                                               | Result                                     |
| --------------------------------------------------------------------- | ------------------------------------------ |
| `npm run l10n`                                                        | Passed                                     |
| `npm run prettier-fix`                                                | Passed                                     |
| `npm run l10n:check`                                                  | Passed                                     |
| `npm run lint`                                                        | Passed                                     |
| `npm run build`                                                       | Passed                                     |
| `npm run typecheck:tests`                                             | Passed                                     |
| `npx vitest run`                                                      | Passed: 324 files, 5,776 passed, 1 skipped |
| `npm run package`                                                     | Passed: 202 files, 8.55 MB VSIX            |
| `npx vitest run --config build/verification/browser/vitest.config.ts` | Passed: 6 files, 79 passed                 |

W5a's fresh Case 1 `npm run build` passed, and the focused browser scenario test passed
(1 file, 22 tests). Rendered verification passed all 30 existing browser routes with
15 assertions, including the neutral heading in all setup scenarios. Direct first-row
checks also confirmed the exact heading and absence of `Checking Docker` in all three
themes. Localization regeneration and full Case 2 were deferred for this working change;
the Case 2 results above predate W5a.

The command-runner spans total 6m50; first-turn elapsed time was 8m02. Individual
`prettier-fix` and package durations were not reported.

Models: W2/W3 used gpt-6.1-sol, W4/W6 gpt-6.1-terra, and W7/W9 gpt-6-luna; Opus 5.5 was
the advisor. Reported summed model time/AIU: W2 2m59/50.2; W3 3m45 cumulative/54.6; W4 1m05/10.6;
W6 2m00/15.3; W7 1m14/1.2. No W9 or final aggregate is reported here. The advisor
consultation covered 5 agents and 11 turns: plan (3), W2 review (1), W3 design/review (5),
W5 design (1), and W6 review (1).

This is not ready for review: W1, W5, and W8 remain parked, W9 is partial, and the full
four-stage AI pre-review required by `CONTRIBUTING.md` has not been completed and committed.
Live Podman 5.x/6.x testing on Windows, macOS, and Linux also remains unverified; the
operator should test those environments before pushing. The button-driven machine-start/cancel
checks require W8 to be implemented first.
