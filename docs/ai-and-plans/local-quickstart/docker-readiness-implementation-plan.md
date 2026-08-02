# Local Quick Start Docker Readiness - Implementation Plan

**Date:** 2026-08-02
**Status:** Draft
**Related design:** [local-quickstart-v2.md](local-quickstart-v2.md)

> **User-facing language:** Use **Docker** as the default term in cards, summaries, and general status messages. This keeps the primary experience simple and avoids exposing implementation details that most users do not need. Use **Docker CLI**, **Docker daemon**, **Docker Engine**, or **Docker Desktop** only when the distinction explains a specific failure or names the exact action being offered, such as `Start Docker Desktop`. The implementation must still detect and model these components separately; this simplification applies only to presentation.

## Objective

Make Local Quick Start describe and recover from Docker readiness failures accurately across Windows, macOS, Linux, WSL, and remote VS Code environments. The Review screen must also state where Docker and DocumentDB Local will actually run.

Docker Desktop is not a prerequisite. The actual prerequisite is a Docker CLI that the extension host can use to reach a Linux-container Docker daemon. The UI must mention Docker Desktop only when the extension has positive evidence that Docker Desktop is the relevant provider.

The implementation must have a direct, easy-to-follow execution flow. Platform checks, error classification, launch behavior, and presentation decisions must each have one clear owner. Do not solve this with scattered string checks, nested conditional expressions, dynamic dispatch, or implicit JavaScript coercion.

## Current State

The current implementation is concentrated in [ContainerRuntime.ts](../../../src/services/localQuickStart/ContainerRuntime.ts):

1. `docker -v` checks whether the CLI is available.
2. `docker info` checks whether a daemon is reachable.
3. `process.arch` checks whether the host CPU is `x64` or `arm64`.
4. Any `docker info` failure is returned as `daemonReachable: false` with a raw error string.
5. The webview displays every daemon failure as `Stopped`.
6. The recovery text and button always say `Docker Desktop`.
7. The launcher uses `process.platform`: Windows launches `Docker Desktop.exe`, macOS opens the Docker application, and every Linux environment attempts the `docker-desktop` user service.
8. The Platform card reports `process.arch`, which is the VS Code extension-host architecture, not necessarily the Docker daemon architecture or image platform.
9. The Review screen always says `This machine (Docker)`, even when the extension host and Docker run in WSL, SSH, a dev container, or Codespaces.
10. Docker prerequisite commands have no explicit timeout or cancellation path, so a hung `docker info` can leave the webview on `Checking Docker...` indefinitely.

This creates several correctness problems:

- A permission failure, invalid context, missing socket, and stopped daemon all look identical.
- WSL, SSH, dev containers, native Linux Docker Engine, and Linux Docker Desktop are treated as the same environment.
- Remote users are not told that `local` refers to the remote extension host.
- The Platform card can describe the wrong CPU when the active Docker endpoint is remote.

There are currently no focused unit tests for readiness classification or provider launch selection.

## Recovered Design Requirements

The earlier design documents contain useful requirements that were intentionally deferred from v1 or simplified during implementation. This plan records an explicit decision for each one so they are not lost again.

| Earlier requirement or observation                                                                  | Source                                                                        | Current implementation                                            | Decision for this plan                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux user not in the `docker` group receives platform-specific guidance                            | `local-quickstart.md` sections 7.1 and 10                                     | Every `docker info` failure is shown as `Stopped`                 | **Include.** This is the reported Ubuntu/WSL failure and the first classifier acceptance test.                                                                                                                                  |
| WSL2, SSH, and dev-container sessions explain where `local` runs                                    | `local-quickstart.md` section 4.3; `local-quickstart-v2.md` v1.2 scope        | Review always says `This machine (Docker)`                        | **Include.** Environment detection must drive both failure guidance and a happy-path execution-target notice.                                                                                                                   |
| Daemon socket, Windows-container mode, WSL setup, and remote daemon failures have distinct guidance | `local-quickstart.md` section 7.1                                             | All daemon failures share Desktop wording                         | **Include.** Implement typed failure categories, with conservative fallback for uncertain cases.                                                                                                                                |
| Apple Silicon/image architecture is evaluated, with explicit consent before x86 emulation           | `local-quickstart.md` sections 7.1 and 10; `local-quickstart-v2.md` section 9 | `process.arch` alone marks `x64` and `arm64` supported            | **Correct the model now.** Report Docker daemon architecture when available; do not claim image compatibility from extension-host architecture. Handle missing image manifests or emulation consent during pull as a follow-up. |
| Docker CLI missing offers install help and an `Already installed?` path                             | `local-quickstart.md` section 7.1                                             | Only Docker Desktop install/troubleshooting links are shown       | **Include provider-neutral help.** Offer details/restart guidance for PATH mismatches. Do not add an `Open settings` button unless a real extension setting exists.                                                             |
| Detailed Docker output is available from readiness and progress failures                            | `local-quickstart.md` sections 7.2 and 17.4                                   | OutputChannel exists, but Docker-not-ready UI does not expose it  | **Include.** Reuse the masked OutputChannel and expose `View Docker output` for every readiness failure.                                                                                                                        |
| Docker probes cannot leave the readiness UI spinning forever                                        | Later readiness review in `v1-readiness-gaps.md`                              | `docker info` has no explicit timeout                             | **Include.** Every prerequisite probe must be cancelable and bounded.                                                                                                                                                           |
| Registry/proxy reachability has its own diagnosis                                                   | `local-quickstart.md` section 7.1; `local-quickstart-v2.md` section 9         | UI shows proxy advice without performing a registry check         | **Do not run it as a Docker prerequisite.** Remove speculative advice here and classify actual pull/registry failures in a separate provisioning follow-up.                                                                     |
| Disk below 2 GB is a non-blocking warning                                                           | `local-quickstart.md` sections 7.1 and 10                                     | No disk check                                                     | **Follow-up.** Add only after defining which filesystem to measure and validating a supported threshold for the image and data volume.                                                                                          |
| Docker Desktop resource limits too low link to Desktop resources                                    | `local-quickstart.md` section 7.1                                             | No resource check                                                 | **Follow-up.** Surface only from a concrete memory/resource failure and only when Desktop is positively identified.                                                                                                             |
| Windows Home/WSL2 missing links to WSL setup                                                        | `local-quickstart.md` section 7.1                                             | No Windows/WSL prerequisite classification                        | **Conditional follow-up.** Use only when Desktop is identified and there is positive evidence of a missing WSL2 prerequisite; otherwise show generic Desktop diagnostics.                                                       |
| Docker commands run as terminal tasks                                                               | `local-quickstart-v2.md` sections 5.4 and 16; POC deviation notes             | Commands stream to a masked OutputChannel                         | **Separate product decision.** Keep the existing masked OutputChannel in this work; do not mix a terminal-execution rewrite into readiness classification.                                                                      |
| `Start Docker Desktop` or generic `Start Docker` may be offered without privilege escalation        | `local-quickstart.md` sections 1 and 13                                       | Linux always attempts the Desktop user service                    | **Include narrowly.** A positively identified rootless Docker Engine user service may get `Start Docker`; root-managed Engine remains documentation-only and never invokes `sudo`.                                              |
| Unsupported extension-host OS is rejected explicitly                                                | `local-quickstart.md` section 10                                              | Non-Windows/non-macOS hosts fall through to Linux launch behavior | **Include.** Return an unsupported-host result instead of assuming every other platform is Linux.                                                                                                                               |

The original documents moved categorized Docker readiness and the remote-session banner to v1.1/v1.2 to protect the initial delivery. This plan intentionally takes on that deferred slice; it does not treat the v1 simplification as evidence that those requirements were invalid.

## Scope

### In scope

- Classify common Docker CLI and daemon failures.
- Detect the extension-host environment.
- Explain the execution target in both ready and not-ready states.
- Detect Docker Desktop only from positive provider evidence.
- Offer only recovery actions that are appropriate for the detected environment.
- Correct the daemon card, guidance, links, and buttons.
- Replace the extension-host CPU guess with Docker daemon architecture facts when available.
- Bound and cancel Docker prerequisite probes so readiness cannot spin forever.
- Make masked Docker output available from every readiness failure.
- Preserve provider-neutral behavior when detection is inconclusive.
- Add focused tests for classification, orchestration, launch selection, and presentation.
- Update telemetry categories without recording paths, context names, hostnames, or raw errors.

### Out of scope

- Installing Docker.
- Running `sudo`, changing group membership, changing socket permissions, or enabling services.
- Silently starting any Docker provider.
- Switching the user's Docker context.
- Supporting Podman or other OCI runtimes.
- Diagnosing registry or proxy failures before an image operation is attempted.
- Checking free disk space or Docker Desktop memory limits without a validated requirement and target filesystem.
- Automatically enabling x86 emulation or forcing an image platform without explicit user consent.
- Replacing the masked OutputChannel with VS Code terminal tasks.
- Guaranteeing that every third-party Docker-compatible daemon can be identified by product name.

## Design Principles

| Principle                     | Requirement                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-neutral prerequisite | Treat Docker daemon access as the requirement. Docker Desktop is one possible provider.                                                |
| Facts before presentation     | Detection returns typed facts. React chooses localized wording from those facts.                                                       |
| One linear orchestrator       | Readiness follows an explicit sequence with early returns; no nested promise chains or nested ternaries.                               |
| Pure classification           | Error text and endpoint facts are converted to a typed failure in a pure function with table-driven tests.                             |
| Explicit platform behavior    | Use exhaustive `switch` statements over typed environment and action values.                                                           |
| Positive provider evidence    | Never infer Docker Desktop solely from `process.platform` or the presence of a Docker CLI.                                             |
| Conservative fallback         | If provider or failure detection is uncertain, say `Not accessible` and offer details/retry rather than guessing.                      |
| No hidden privilege changes   | The extension may open documentation or launch an identified unprivileged desktop application; it must not alter system configuration. |
| Centralized heuristics        | Endpoint patterns and known application/service locations are named constants in the owning host-side module.                          |
| Testable I/O                  | Environment, filesystem, process launch, and command execution dependencies are injected at the service boundary.                      |
| Correct execution target      | Keep extension-host environment, Docker endpoint, daemon platform, and image platform as distinct facts.                               |
| Bounded external work         | Every prerequisite command accepts cancellation and has a documented timeout.                                                          |

## Proposed Structure

Keep container operations separate from Docker prerequisite diagnosis.

| File                                                                     | Responsibility                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/services/localQuickStart/ContainerRuntime.ts`                       | Container pull/run/inspect/start/stop operations. Delegate readiness to the new service and remove provider-launch logic. |
| `src/services/localQuickStart/DockerReadinessService.ts`                 | Linear readiness orchestration and collection of command/environment facts.                                               |
| `src/services/localQuickStart/dockerReadinessClassification.ts`          | Pure functions that classify command failures and provider evidence. No VS Code, filesystem, or process I/O.              |
| `src/services/localQuickStart/DockerProviderLauncher.ts`                 | Explicit launch strategies for positively identified Desktop providers and rootless Linux Docker Engine.                  |
| `src/services/localQuickStart/quickStartTypes.ts`                        | Shared readiness, failure, environment, provider, and recovery-action contracts.                                          |
| `src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts` | Pure mapping from typed readiness results to semantic card/action content. No host detection.                             |
| `src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx`            | Render the presentation result and invoke the selected router action. No platform or provider heuristics.                 |
| `src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts`       | Expose readiness and a provider-aware start mutation; record categorized telemetry.                                       |

The implementation may combine a proposed file with a closely related file if the resulting module remains small and has one responsibility. It must not move all behavior back into `ContainerRuntime.ts` or `LocalQuickStart.tsx`.

## Typed Result Model

Use string unions and interfaces consistent with the repository's TypeScript conventions. Keep the values semantic and serializable over tRPC.

```typescript
type DockerHostEnvironment =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'wsl'
  | 'ssh'
  | 'devContainer'
  | 'codespaces'
  | 'otherRemote'
  | 'unsupported';

type DockerProvider = 'dockerDesktop' | 'dockerEngine' | 'unknown';

type DockerEndpointKind = 'unixSocket' | 'namedPipe' | 'tcp' | 'ssh' | 'unknown';

type DockerFailureKind =
  | 'cliMissing'
  | 'permissionDenied'
  | 'daemonUnavailable'
  | 'contextUnavailable'
  | 'probeTimedOut'
  | 'unsupportedHost'
  | 'windowsContainers'
  | 'unknown';

type DockerStartAction =
  | 'startDockerDesktopWindows'
  | 'startDockerDesktopMacOS'
  | 'startDockerDesktopLinux'
  | 'startDockerDesktopWindowsFromWsl'
  | 'startRootlessDockerEngineLinux';
```

Extend `DockerReadiness` with:

- `environment`
- `endpointKind`
- `provider`
- `failureKind`, absent when ready
- `startAction`, present only when the extension can perform that exact action without elevation
- `osType`, when returned by a reachable daemon
- `daemonArchitecture`, when returned by a reachable daemon
- an execution-target category suitable for localized Review-screen copy
- a safe optional diagnostic summary for `Show details`

Keep `cliInstalled`, `cliVersion`, and `daemonReachable` during this change to limit call-site churn. Deprecate `arch` and `platformSupported` after the UI moves to daemon architecture; `process.arch` may remain an extension-host diagnostic but must not gate image compatibility. Do not encode contradictory combinations. Builder functions or explicit return branches in the service should construct each valid result.

## Readiness Execution Flow

`DockerReadinessService.getReadiness()` should be readable from top to bottom:

1. Detect the extension-host environment once.
2. If the extension-host platform is unsupported, return `unsupportedHost` immediately.
3. Run the existing Docker CLI installation check with cancellation and a bounded timeout.
4. If the CLI is missing, return `cliMissing` immediately.
5. Resolve the active Docker endpoint using `DOCKER_HOST` or structured `docker context inspect` output, also bounded and cancelable.
6. Run the existing `docker info` check with cancellation and a bounded timeout.
7. If it succeeds, record daemon architecture, verify Linux-container mode, and classify the provider from returned daemon/context facts.
8. If it fails, classify timeout separately, then classify other failures using the command error and endpoint facts.
9. Only after failure classification, determine whether a safe provider start action is available.
10. Build an execution-target category for Review-screen copy.
11. Return one typed readiness result.

Use structured JSON output from Docker commands where available. Do not parse human-formatted tables. Do not use shell pipelines. Each command must be represented as an executable plus an argument array through the existing command-runner abstraction. Centralize timeout durations as named constants and distinguish timeout from user cancellation.

## Checks

| Check                        | Exists today | Planned behavior                                                                                                                         | Platform dependence    | Owner                          |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ |
| Docker CLI on `PATH`         | Yes          | Keep `docker -v`. A failure becomes `cliMissing`.                                                                                        | None                   | Readiness service              |
| Daemon reachable             | Yes          | Keep `docker info`; retain its structured `osType` and operating-system result.                                                          | None                   | Readiness service              |
| Extension-host architecture  | Yes          | Keep only as optional diagnostics; do not use it as proof that the daemon can run the image.                                             | Remote-dependent       | Readiness service              |
| Docker daemon architecture   | No           | Read structured daemon architecture when reachable and display that fact in the Platform card.                                           | Endpoint-dependent     | Readiness service              |
| Image platform compatibility | No           | Do not guess before image resolution. Classify a real no-matching-manifest failure during pull and require consent before emulation.     | Daemon/image-dependent | Provisioning follow-up         |
| Extension-host environment   | No           | Prefer `vscode.env.remoteName`; use explicit process/environment fallbacks for WSL tests and unusual hosts.                              | Yes                    | Readiness service              |
| Execution target disclosure  | No           | Tell users whether Docker will run locally, in WSL, or in another remote extension host before provisioning.                             | Yes                    | Presentation                   |
| Active endpoint/context      | No           | Respect `DOCKER_HOST`; otherwise inspect the active Docker context using JSON.                                                           | Endpoint-dependent     | Readiness service              |
| Unix socket permission       | No           | Classify `EACCES`/permission-denied failures. If the endpoint is a local Unix socket, inspect accessibility only as supporting evidence. | Linux, WSL, macOS      | Classifier/service             |
| Daemon unavailable           | Partial      | Separate connection-refused/missing-socket failures from permission failures.                                                            | Endpoint-dependent     | Classifier                     |
| Invalid/unavailable context  | No           | Classify context-not-found and endpoint-resolution failures separately.                                                                  | None                   | Classifier                     |
| Linux-container mode         | No           | When `docker info` succeeds, reject Windows-container mode with targeted guidance.                                                       | Windows                | Readiness service              |
| Docker provider              | No           | Use daemon operating-system metadata, active context metadata, and known endpoint evidence. Default to `unknown`.                        | Yes                    | Classifier                     |
| Launch capability            | Assumed      | Return an action only for a positively identified, installed Desktop provider that can be launched without elevation.                    | Yes                    | Provider launcher              |
| Probe timeout/cancellation   | No           | Bound CLI, context, and daemon probes; propagate panel/query cancellation and classify genuine timeouts.                                 | None                   | Readiness service              |
| Diagnostic output access     | Partial      | Reuse the masked OutputChannel and expose it from every failure state.                                                                   | None                   | Router/presentation            |
| Registry/proxy reachability  | No           | Remove generic proxy advice from this prerequisite card. Diagnose registry failures during pull instead.                                 | None                   | Provisioning flow, future work |

## Classification Precedence

Classification order matters. More actionable evidence must win over broad provider guesses.

| Priority | Evidence                                                                                           | Result               |
| -------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| 1        | Extension-host OS is outside the supported set                                                     | `unsupportedHost`    |
| 2        | CLI command cannot be executed                                                                     | `cliMissing`         |
| 3        | A bounded probe expires without user cancellation                                                  | `probeTimedOut`      |
| 4        | `EACCES`, `permission denied`, or equivalent access failure for the active endpoint                | `permissionDenied`   |
| 5        | Docker context does not exist or cannot resolve an endpoint                                        | `contextUnavailable` |
| 6        | Socket missing, connection refused, daemon handshake unavailable, or standard cannot-connect error | `daemonUnavailable`  |
| 7        | Reachable daemon reports Windows containers                                                        | `windowsContainers`  |
| 8        | Failure does not match a tested category                                                           | `unknown`            |

Keep error signatures in named, anchored constants or small predicate functions. Each signature needs a test. Do not spread regular expressions across service, router, and React code.

## Provider And Launch Matrix

| Extension host                   | Positive Docker Desktop evidence                                                                                           | Allowed action                                                   | Otherwise                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Local Windows                    | Active context/daemon identifies Desktop and the standard executable exists                                                | Launch `Docker Desktop.exe`                                      | No start button; show provider-neutral guidance                 |
| Local macOS                      | Active context/daemon identifies Desktop and `Docker.app` exists                                                           | Use `open -a Docker`                                             | No start button; show provider-neutral guidance                 |
| Native Linux Docker Desktop      | Active context/daemon identifies Linux Docker Desktop and its user service is available                                    | Run `systemctl --user start docker-desktop`                      | Show provider-neutral guidance                                  |
| Native Linux rootless Engine     | Endpoint and available user service positively identify rootless Docker Engine                                             | Run `systemctl --user start docker`                              | Show rootless Docker setup guidance                             |
| Native Linux root-managed Engine | Native system socket or other root-managed endpoint                                                                        | No automatic action                                              | Show service documentation; never invoke `sudo`                 |
| WSL using Docker Desktop         | Active endpoint/context points to Docker Desktop integration and the Windows executable is available through the WSL mount | Launch Docker Desktop on Windows                                 | Show WSL integration guidance                                   |
| WSL using native Docker Engine   | Native WSL socket/context                                                                                                  | No automatic start; diagnose permissions or native service state | Show Linux/WSL guidance                                         |
| SSH/dev container/Codespaces     | Provider is in the remote extension-host context                                                                           | No local-machine launch action                                   | Explain that Docker must be available in the remote environment |

The presence of `/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe` alone is not enough to classify a WSL endpoint as Docker Desktop. A native WSL daemon may coexist with that executable.

## UI Plan

Keep the card label `Docker daemon`. Change its value, guidance, link, and primary action from the typed result.

| State                               | Card value                   | Guidance                                                                                           | Primary action                                                                                |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Ready                               | `Reachable`                  | None                                                                                               | None                                                                                          |
| Desktop identified and unavailable  | `Docker Desktop not running` | `Start Docker Desktop and wait until it is ready.`                                                 | `Start Docker Desktop`                                                                        |
| Native daemon unavailable           | `Not running`                | `Start the Docker service, then check again.`                                                      | `Start Docker` only for positively identified rootless Engine; otherwise platform setup guide |
| Unix socket permission failure      | `Access denied`              | `Your user cannot access the Docker socket. Update Docker permissions, then restart your session.` | Linux setup guide                                                                             |
| WSL Desktop integration unavailable | `Not accessible from WSL`    | `Enable Docker Desktop integration for this WSL distribution, then check again.`                   | WSL integration guide                                                                         |
| Remote daemon unavailable           | `Not accessible`             | `Docker must be available in the remote environment where this extension is running.`              | Remote Docker guide                                                                           |
| Invalid context                     | `Context unavailable`        | `The active Docker context is unavailable. Select or repair a valid context, then check again.`    | Docker context guide                                                                          |
| Probe timed out                     | `Check timed out`            | `Docker did not respond before the readiness check timed out.`                                     | `View Docker output`                                                                          |
| Unsupported extension host          | `Unsupported`                | `Local Quick Start is supported when the extension runs on Windows, macOS, or Linux.`              | Learn more                                                                                    |
| Windows-container mode              | `Linux containers required`  | `Switch Docker to Linux containers, then check again.`                                             | Setup guide                                                                                   |
| Unknown daemon failure              | `Not accessible`             | `The extension could not connect to the Docker daemon.`                                            | `Show details`                                                                                |
| CLI missing                         | CLI card: `Not found`        | `Install Docker Engine or Docker Desktop, then reopen Quick Start.`                                | Platform-appropriate install guide                                                            |

Additional UI changes:

- Rename the router mutation and handler from `startDockerDesktop` to `startDockerProvider`.
- The server must recompute or validate the start action instead of trusting an action supplied by the webview.
- Return a typed launch result such as `started`, `notAvailable`, or `failed` rather than a boolean.
- When launch succeeds, poll readiness at a bounded interval and stop on success, timeout, panel close, or component unmount.
- Keep `Retry` available for every failure.
- Keep `View Docker output` available for every failure, using the existing masked OutputChannel.
- Show `Start Docker Desktop` only when `startAction` is present and identifies Desktop.
- Use provider-neutral Docker installation and troubleshooting links unless a platform/provider-specific guide is selected.
- Remove the unconditional corporate-proxy guidance because no registry check has happened on this screen.
- Replace `This machine (Docker)` with execution-target-aware copy. WSL and remote sessions must get a visible notice before Start, even when Docker is ready.
- Change the Platform card to report Docker daemon architecture when known. If the daemon is unreachable, show `Unknown until Docker is reachable`; do not substitute `process.arch` as image compatibility.

## Work Items

### WI-1: Add typed readiness contracts

- Add environment, provider, failure, start-action, and launch-result types.
- Extend the readiness result without changing provisioning behavior.
- Update router serialization and telemetry typing.
- Add compile-time exhaustive checks for all semantic switches.

### WI-2: Extract and test pure classification

- Add predicates for permission, context, unavailable-daemon, and unknown failures.
- Define precedence in one exported classifier.
- Add provider classification from structured daemon/context/endpoint facts.
- Add table-driven unit tests for representative Linux, WSL, Windows, macOS, and remote errors.

### WI-3: Add the readiness orchestrator

- Move prerequisite command sequencing out of `ContainerRuntimeImpl`.
- Add environment and endpoint resolution.
- Add bounded, cancelable command probes and distinguish timeout from user cancellation.
- Read daemon architecture from Docker rather than treating `process.arch` as image compatibility.
- Preserve masked OutputChannel command logging.
- Return early for CLI failures and use one explicit branch for daemon success/failure.
- Keep a compatibility delegate on `IContainerRuntime` only if needed to avoid unrelated service churn.

### WI-4: Replace the launcher

- Move process launching out of `ContainerRuntime.ts`.
- Implement one named function per supported launch action.
- Select actions through an exhaustive switch.
- Inject filesystem/process dependencies for unit tests.
- Refuse unavailable, stale, remote, or privilege-requiring actions.

### WI-5: Update router and telemetry

- Return the enriched readiness result.
- Replace `startDockerDesktop` with `startDockerProvider`.
- Revalidate start capability on the extension host immediately before launch.
- Record only categorized readiness and launch outcomes.
- Never record raw errors, executable paths, socket paths, context names, or environment variable values.

### WI-6: Update the webview

- Add a pure semantic presentation mapper.
- Render card values and recovery actions from its result.
- Remove platform checks and raw error matching from JSX.
- Replace the fixed five-second wait with cancelable bounded polling.
- Add execution-target-aware Review copy and a remote-session notice for ready Docker environments.
- Expose the existing masked Docker output from every readiness failure.
- Render daemon architecture without claiming unverified image compatibility.
- Localize all added or changed user-facing strings.
- Preserve accessible announcements for status changes and launch failures.

### WI-7: Add integration-focused tests

- Test service sequencing with mocked command results.
- Test that permission denial wins even when Docker Desktop is installed on the Windows host of WSL.
- Test that native WSL Docker never receives a Desktop launch action.
- Test that only positively identified rootless Linux Engine receives `Start Docker`; root-managed Engine never does.
- Test that remote environments never launch a local desktop application.
- Test each presentation state and its exact semantic action.
- Test polling cleanup on success, timeout, and unmount.
- Test command timeout versus user cancellation.
- Test Review-screen execution-target copy for local, WSL, SSH, dev-container, and Codespaces environments.
- Test that daemon architecture, not `process.arch`, drives the Platform card.

### WI-8: Update documentation

- Replace statements that imply Docker Desktop is universally required.
- Document Docker Engine and Docker Desktop as supported provider choices.
- Document Linux group/session restart and WSL integration guidance.
- Keep platform-specific setup steps in linked documentation rather than embedding shell commands in the card.

## Required Test Matrix

| Scenario                                                               | Expected failure/provider                         | Expected action                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| CLI absent on Linux                                                    | `cliMissing` / `unknown`                          | Linux install guide                               |
| Native Ubuntu daemon reachable                                         | Ready / `dockerEngine`                            | None                                              |
| Native Ubuntu socket returns permission denied                         | `permissionDenied` / `dockerEngine` or `unknown`  | Linux setup guide                                 |
| Native Ubuntu daemon stopped                                           | `daemonUnavailable` / `dockerEngine` or `unknown` | Service guide, no automatic start                 |
| Native rootless Ubuntu user service stopped                            | `daemonUnavailable` / `dockerEngine`              | Start Docker                                      |
| WSL native socket permission denied while Windows Desktop is installed | `permissionDenied` / native endpoint              | Linux/WSL setup guide, no Desktop button          |
| WSL Desktop integration endpoint unavailable                           | `daemonUnavailable` / `dockerDesktop`             | Start Desktop on Windows or WSL integration guide |
| Local Windows Desktop stopped                                          | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                              |
| Local macOS Desktop stopped                                            | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                              |
| Linux Docker Desktop user service stopped                              | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                              |
| Invalid Docker context                                                 | `contextUnavailable`                              | Context guide                                     |
| Windows daemon reports Windows containers                              | `windowsContainers`                               | Linux-container guidance                          |
| SSH remote with no daemon                                              | `daemonUnavailable` / `unknown`                   | Remote Docker guide, no local launch              |
| Unknown nonzero `docker info` error                                    | `unknown`                                         | Show details and Retry                            |
| `docker info` never responds                                           | `probeTimedOut`                                   | View Docker output and Retry                      |
| Readiness query is canceled                                            | Cancellation, not a failure category              | Stop probes and render no stale error             |
| Unsupported Node extension-host platform                               | `unsupportedHost` / `unknown`                     | Learn more, no Docker launch                      |
| SSH extension host with reachable remote amd64 daemon on arm64 client  | Ready / daemon architecture `amd64`               | Show remote target and daemon architecture        |
| WSL extension host with reachable native daemon                        | Ready / `dockerEngine`                            | Show WSL execution-target notice                  |

## Maintainability Requirements

The implementation is not complete unless these structural constraints hold:

- Every function has an explicit return type.
- No `any` is introduced.
- No platform checks appear in React components.
- No user-facing text is selected in the host-side launcher.
- No error-string matching appears outside the classifier.
- No executable/service paths appear outside the launcher or named platform constants.
- No nested ternary is used for readiness, provider, failure, or action selection.
- No shell command is assembled as a single interpolated string.
- No command output is parsed with ad hoc line splitting when JSON is available.
- No external readiness command can wait indefinitely.
- No start action is inferred from operating system alone.
- No image compatibility decision is inferred from `process.arch` alone.
- All semantic `switch` statements are exhaustive.
- Raw command errors stay out of telemetry and primary UI copy.
- New modules remain focused; avoid a generic framework or class hierarchy for the small set of launch actions.

Prefer straightforward named functions such as:

- `detectHostEnvironment()`
- `resolveDockerEndpoint()`
- `classifyDockerFailure()`
- `classifyDockerProvider()`
- `getAvailableStartAction()`
- `startDockerProvider()`
- `getDockerReadinessPresentation()`
- `getDockerExecutionTargetPresentation()`

These names are illustrative, but the final code should preserve this visible execution flow.

## Acceptance Criteria

1. A native Ubuntu or WSL socket permission error is displayed as `Access denied`, not `Stopped`.
2. Installing Docker Desktop on the Windows host does not override a native WSL permission diagnosis.
3. `Docker Desktop` appears in the card or button only when Desktop is positively identified.
4. Native Linux Docker Engine users never receive a `Start Docker Desktop` action.
5. Root-managed Linux Docker Engine never triggers a privileged start; rootless Engine receives `Start Docker` only from positive evidence.
6. Remote extension hosts never launch a Docker application on the user's local machine.
7. Unknown failures use provider-neutral language and retain Retry/details paths.
8. WSL and other remote users are told where the container will run before provisioning.
9. A hung Docker probe times out and cannot leave the webview spinning indefinitely.
10. The Platform card reports daemon architecture when known and does not claim image support from `process.arch`.
11. Masked Docker output is reachable from every readiness failure.
12. Existing ready-Docker provisioning behavior is unchanged.
13. Added classification and launch-selection branches have focused tests.
14. All changed user-facing strings are localized.
15. The repository completion checks pass in order:
    - `npm run l10n`
    - `npm run prettier-fix`
    - `npm run lint`
    - `npx jest --no-coverage`
    - `npm run build`

## Suggested Delivery Order

Implement WI-1 through WI-4 as the host-side foundation, then WI-5 and WI-6 as one user-visible change. Complete WI-7 before documentation cleanup in WI-8. Keep each work item independently testable, but do not expose partially classified states in the UI.

The first executable behavior check should be the Linux/WSL permission-denied classifier test. It directly reproduces the reported failure and will disconfirm the implementation if it still falls through to `daemonUnavailable` or Docker Desktop guidance.
