# Local Quick Start Docker Readiness - Implementation Plan

**Date:** 2026-08-02
**Status:** Draft
**Related design:** [local-quickstart-v2.md](local-quickstart-v2.md)

> **User-facing language:** Use **Docker** as the default term in cards, summaries, and general status messages. This keeps the primary experience simple and avoids exposing implementation details that most users do not need. Use **Docker CLI**, **Docker daemon**, **Docker Engine**, or **Docker Desktop** only when the distinction explains a specific failure or names the exact action being offered, such as `Start Docker Desktop`. The implementation must still detect and model these components separately; this simplification applies only to presentation.

> **User-facing punctuation:** No em dashes (U+2014) and no en dashes (U+2013) in any user-facing string, message, notification, card value, button label, tooltip, or accessible announcement. Use a comma, a colon, a semicolon, parentheses, or two sentences instead. A hyphen inside a compound word such as `Docker-not-ready` is fine; only those two characters are banned. This applies to every string passed to `vscode.l10n.t()`, to the generated `l10n/bundle.l10n.json`, and to any literal rendered in the webview. Before review, search the diff for U+2014 and U+2013.
>
> | Written with a banned dash                                  | Write instead                                       |
> | ----------------------------------------------------------- | --------------------------------------------------- |
> | `Docker is starting [U+2014] this can take a minute.`       | `Docker is starting. This can take a minute.`       |
> | `Access denied [U+2013] your user cannot reach the socket.` | `Access denied. Your user cannot reach the socket.` |
> | `Last checked 5 minutes ago [U+2014] Refresh`               | `Last checked 5 minutes ago. Refresh`               |

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
11. The Docker error text is never captured. The command runner rejects with a generic `Process exited with code 1`, and Docker's own stderr goes only to the masked OutputChannel, so `DockerReadiness.error` carries no diagnosable content.
12. Readiness is invoked from the panel, from Retry, and from the provisioning `checking` stage with no deduplication, memoization, or in-flight guard.
13. A daemon failure that occurs _during_ provisioning is surfaced as a raw error string in the failure card, disconnected from the readiness recovery UI.

This creates several correctness problems:

- A permission failure, invalid context, missing socket, and stopped daemon all look identical.
- WSL, SSH, dev containers, native Linux Docker Engine, and Linux Docker Desktop are treated as the same environment.
- Remote users are not told that `local` refers to the remote extension host.
- The Platform card can describe the wrong CPU when the active Docker endpoint is remote.
- The evidence needed to tell these cases apart is discarded before anything can classify it.

There are currently no focused unit tests for readiness classification or provider launch selection.

## Verified Execution-Path Constraints

These facts were confirmed by reading the current code and its dependencies. They are prerequisites for everything below; ignoring any one of them silently defeats the classifier.

| Fact                                                                                                                                                                  | Where                                                          | Consequence for this plan                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A non-zero exit rejects with `ChildProcessError('Process exited with code <n>')`. The Docker error text is **not** part of the rejection.                             | `spawnStreamAsync` in `@microsoft/vscode-processutils`         | A classifier that reads the rejected error's message returns `unknown` for every real failure, including the reported Ubuntu case. Probe evidence must be captured separately (WI-0).                                            |
| stderr is piped only into the masked OutputChannel writable, and the stdout accumulator is destroyed in `finally` when the command rejects, so `parse` never runs.    | `ShellStreamCommandRunnerFactory` in `vscode-container-client` | Both the stderr text and the `docker info` JSON body are discarded on failure. Probes must tee stdout and stderr into their own accumulators.                                                                                    |
| `docker info --format {{json .}}` prints a valid JSON body containing `ServerErrors` **and still exits non-zero** when the daemon is unreachable.                     | Docker CLI behavior                                            | The most stable failure signal is structured, and today it is thrown away. Read it before falling back to stderr text.                                                                                                           |
| Cancellation calls `treeKill(pid)` and rejects with `CancellationError`.                                                                                              | `spawnStreamAsync`                                             | A `CancellationTokenSource` plus a timer is a correct, process-killing timeout. Timeout and user cancellation raise the **same** error type, so they must be distinguished by which source fired, never by inspecting the error. |
| `DockerInfoRecordSchema` keeps only `OperatingSystem` and `OSType` and strips every other field. `InfoItem.raw` still carries the full JSON.                          | `DockerClientBase`                                             | Daemon `Architecture`, `ServerVersion`, and `ServerErrors` must be parsed from `raw` with a local schema. They are not reachable through the typed `InfoItem`.                                                                   |
| `docker info` reports `x86_64` and `aarch64`, not `amd64` and `arm64`.                                                                                                | Docker CLI behavior                                            | Daemon architecture needs a tested normalization function before it reaches the Platform card or the test matrix.                                                                                                                |
| `listContexts()` already exists, runs `docker context ls --format {{json .}}`, returns `name`/`current`/`containerEndpoint`, and does not require a reachable daemon. | `DockerClient`                                                 | Use it for endpoint resolution instead of adding a `docker context inspect` command.                                                                                                                                             |
| Probes already spawn with `stdio[0] = 'ignore'` because no `stdInPipe` is supplied.                                                                                   | `spawnStreamAsync`                                             | This is the only reason an `ssh://` endpoint's passphrase prompt cannot hang a probe forever. It is an invisible property of the current wiring, so it needs a regression test rather than a comment.                            |

## Recovered Design Requirements

The earlier design documents contain useful requirements that were intentionally deferred from v1 or simplified during implementation. This plan records an explicit decision for each one so they are not lost again.

| Earlier requirement or observation                                                                  | Source                                                                        | Current implementation                                            | Decision for this plan                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux user not in the `docker` group receives platform-specific guidance                            | `local-quickstart.md` sections 7.1 and 10                                     | Every `docker info` failure is shown as `Stopped`                 | **Include.** This is the reported Ubuntu/WSL failure and the first classifier acceptance test.                                                                                                                                                 |
| WSL2, SSH, and dev-container sessions explain where `local` runs                                    | `local-quickstart.md` section 4.3; `local-quickstart-v2.md` v1.2 scope        | Review always says `This machine (Docker)`                        | **Include.** Environment detection must drive both failure guidance and a happy-path execution-target notice.                                                                                                                                  |
| Daemon socket, Windows-container mode, WSL setup, and remote daemon failures have distinct guidance | `local-quickstart.md` section 7.1                                             | All daemon failures share Desktop wording                         | **Include.** Implement typed failure categories, with conservative fallback for uncertain cases.                                                                                                                                               |
| Apple Silicon/image architecture is evaluated, with explicit consent before x86 emulation           | `local-quickstart.md` sections 7.1 and 10; `local-quickstart-v2.md` section 9 | `process.arch` alone marks `x64` and `arm64` supported            | **Correct the model now.** Report Docker daemon architecture when available; do not claim image compatibility from extension-host architecture. Handle missing image manifests or emulation consent during pull as a follow-up.                |
| Docker CLI missing offers install help and an `Already installed?` path                             | `local-quickstart.md` section 7.1                                             | Only Docker Desktop install/troubleshooting links are shown       | **Include provider-neutral help.** Offer details/restart guidance for PATH mismatches. Do not add an `Open settings` button unless a real extension setting exists.                                                                            |
| Detailed Docker output is available from readiness and progress failures                            | `local-quickstart.md` sections 7.2 and 17.4                                   | OutputChannel exists, but Docker-not-ready UI does not expose it  | **Include.** Reuse the masked OutputChannel and expose `View Docker output` for every readiness failure.                                                                                                                                       |
| Docker probes cannot leave the readiness UI spinning forever                                        | Later readiness review in `v1-readiness-gaps.md`                              | `docker info` has no explicit timeout                             | **Include.** Every prerequisite probe must be cancelable and bounded.                                                                                                                                                                          |
| Registry/proxy reachability has its own diagnosis                                                   | `local-quickstart.md` section 7.1; `local-quickstart-v2.md` section 9         | UI shows proxy advice without performing a registry check         | **Do not run it as a Docker prerequisite.** Remove speculative advice here and classify actual pull/registry failures in a separate provisioning follow-up.                                                                                    |
| Disk below 2 GB is a non-blocking warning                                                           | `local-quickstart.md` sections 7.1 and 10                                     | No disk check                                                     | **Follow-up.** Add only after defining which filesystem to measure and validating a supported threshold for the image and data volume.                                                                                                         |
| Docker Desktop resource limits too low link to Desktop resources                                    | `local-quickstart.md` section 7.1                                             | No resource check                                                 | **Follow-up.** Surface only from a concrete memory/resource failure and only when Desktop is positively identified.                                                                                                                            |
| Windows Home/WSL2 missing links to WSL setup                                                        | `local-quickstart.md` section 7.1                                             | No Windows/WSL prerequisite classification                        | **Conditional follow-up.** Use only when Desktop is identified and there is positive evidence of a missing WSL2 prerequisite; otherwise show generic Desktop diagnostics.                                                                      |
| Docker commands run as terminal tasks                                                               | `local-quickstart-v2.md` sections 5.4 and 16; POC deviation notes             | Commands stream to a masked OutputChannel                         | **Separate product decision.** Keep the existing masked OutputChannel in this work; do not mix a terminal-execution rewrite into readiness classification.                                                                                     |
| `Start Docker Desktop` or generic `Start Docker` may be offered without privilege escalation        | `local-quickstart.md` sections 1 and 13                                       | Linux always attempts the Desktop user service                    | **Include narrowly.** A positively identified rootless Docker Engine user service may get `Start Docker`; root-managed Engine remains documentation-only and never invokes `sudo`.                                                             |
| Unsupported extension-host OS is rejected explicitly                                                | `local-quickstart.md` section 10                                              | Non-Windows/non-macOS hosts fall through to Linux launch behavior | **Include.** Return an unsupported-host result instead of assuming every other platform is Linux.                                                                                                                                              |
| A permission failure names the exact fix instead of only linking to documentation                   | This review                                                                   | No guidance at all; the failure reads `Stopped`                   | **Include as a copyable command.** Show the documented fix as read-only text with a `Copy command` button. The extension never runs it. See [Copyable Recovery Commands](#copyable-recovery-commands).                                         |
| A wrong or inconclusive diagnosis must not block a user whose Docker actually works                 | This review                                                                   | Any non-ready readiness result hard-gates the Set up button       | **Include.** Indeterminate results keep a `Continue anyway` path that lets the real `docker pull`/`run` produce the authoritative error.                                                                                                       |
| Provider facts learned while Docker worked are reused when Docker is down                           | This review                                                                   | Nothing is remembered between sessions                            | **Include, with an expiry and an exit.** Persist a small last-known-good provider record and treat it as positive evidence, but label it with its check time and keep a `Refresh` that discards it, so a changed setup cannot strand the user. |

The original documents moved categorized Docker readiness and the remote-session banner to v1.1/v1.2 to protect the initial delivery. This plan intentionally takes on that deferred slice; it does not treat the v1 simplification as evidence that those requirements were invalid.

## Scope

### In scope

- Capture the evidence a classification can actually be built on: spawn errno, exit code, `docker info` JSON body, and stderr text.
- Classify common Docker CLI and daemon failures.
- Detect the extension-host environment.
- Explain the execution target in both ready and not-ready states.
- Detect Docker Desktop only from positive provider evidence, including a remembered last-known-good record.
- Offer only recovery actions that are appropriate for the detected environment.
- Offer copyable, never-executed recovery commands for the documented Linux and WSL fixes.
- Correct the daemon card, guidance, links, and buttons.
- Replace the extension-host CPU guess with Docker daemon architecture facts when available.
- Bound and cancel Docker prerequisite probes under a single deadline so readiness cannot spin forever.
- Deduplicate readiness so concurrent callers and polling cannot stack Docker processes.
- Keep a forward path when the diagnosis is indeterminate.
- Route daemon-class failures raised during provisioning through the same classifier and the same recovery UI.
- Make masked Docker output available from every readiness failure.
- Preserve provider-neutral behavior when detection is inconclusive.
- Add focused tests for classification, orchestration, launch selection, and presentation, driven by captured real-world fixtures.
- Update telemetry categories without recording paths, context names, hostnames, or raw errors, and add a redacted fingerprint for unclassified failures.

### Out of scope

- Installing Docker.
- Running `sudo`, changing group membership, changing socket permissions, or enabling services. Offering a command as copyable text is not running it.
- Silently starting any Docker provider.
- Switching the user's Docker context.
- Supporting Podman or other OCI runtimes.
- Diagnosing registry or proxy failures before an image operation is attempted.
- Checking free disk space or Docker Desktop memory limits without a validated requirement and target filesystem.
- Automatically enabling x86 emulation or forcing an image platform without explicit user consent.
- Replacing the masked OutputChannel with VS Code terminal tasks.
- Guaranteeing that every third-party Docker-compatible daemon can be identified by product name.

## Design Principles

| Principle                     | Requirement                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-neutral prerequisite | Treat Docker daemon access as the requirement. Docker Desktop is one possible provider.                                                                                                                   |
| Facts before presentation     | Detection returns typed facts. React chooses localized wording from those facts.                                                                                                                          |
| Evidence hierarchy            | Prefer, in order: process spawn errno, command exit code, structured JSON from Docker, filesystem/socket errno, then error text. Error text is a tiebreaker and is never the only evidence for a verdict. |
| One linear orchestrator       | Readiness follows an explicit sequence with early returns; no nested promise chains or nested ternaries.                                                                                                  |
| Pure classification           | Captured probe evidence and endpoint facts are converted to a typed failure in a pure function with table-driven tests.                                                                                   |
| Explicit platform behavior    | Use exhaustive `switch` statements over typed environment and action values.                                                                                                                              |
| Positive provider evidence    | Never infer Docker Desktop solely from `process.platform` or the presence of a Docker CLI.                                                                                                                |
| Asymmetric action cost        | Weigh a wrong offer against a missing offer per environment. A harmless user-clicked launch may use a lower evidence bar than a stated failure cause.                                                     |
| Diagnosis is advisory         | A readiness verdict must never be the only thing standing between a user and a Docker that actually works. Indeterminate results always keep a path forward.                                              |
| Conservative fallback         | If provider or failure detection is uncertain, report an indeterminate outcome, say `Not accessible`, and offer details/retry rather than guessing a cause.                                               |
| No hidden privilege changes   | The extension may open documentation, offer a copyable command, or launch an identified unprivileged desktop application; it must not alter system configuration.                                         |
| Centralized heuristics        | Endpoint patterns, error signatures, recovery commands, and known application/service locations are named constants in the owning host-side module.                                                       |
| Testable I/O                  | Environment, filesystem, process launch, and command execution dependencies are injected at the service boundary.                                                                                         |
| Correct execution target      | Keep extension-host environment, Docker endpoint, daemon platform, and image platform as distinct facts.                                                                                                  |
| Bounded external work         | Every prerequisite command accepts cancellation and runs under one shared, documented readiness deadline.                                                                                                 |
| Single-flight probing         | Readiness runs at most one probe set at a time and is briefly memoized, so polling and concurrent callers never stack Docker processes.                                                                   |
| Learn from misses             | Unclassified failures emit a redacted fingerprint so new rules come from real data instead of imagination.                                                                                                |

## Proposed Structure

Keep container operations separate from Docker prerequisite diagnosis.

| File                                                                     | Responsibility                                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/localQuickStart/ContainerRuntime.ts`                       | Container pull/run/inspect/start/stop operations. Delegate readiness to the new service and remove provider-launch logic.                            |
| `src/services/localQuickStart/dockerProbes.ts`                           | Run a bounded Docker command and return captured evidence (exit code, spawn errno, stdout, stderr, how it ended). Also probes endpoint reachability. |
| `src/services/localQuickStart/DockerReadinessService.ts`                 | Linear readiness orchestration, single-flight/TTL memoization, provider memory, and collection of command/environment facts.                         |
| `src/services/localQuickStart/dockerReadinessClassification.ts`          | Pure functions that classify captured evidence and provider evidence. No VS Code, filesystem, or process I/O.                                        |
| `src/services/localQuickStart/dockerRecoveryCommands.ts`                 | The fixed table of copyable, never-executed recovery commands keyed by failure and environment.                                                      |
| `src/services/localQuickStart/DockerProviderLauncher.ts`                 | Explicit launch strategies for positively identified Desktop providers and rootless Linux Docker Engine.                                             |
| `src/services/localQuickStart/quickStartTypes.ts`                        | Shared readiness, failure, environment, provider, and recovery-action contracts.                                                                     |
| `src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts` | Pure mapping from typed readiness results to semantic card/action content. No host detection.                                                        |
| `src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx`            | Render the presentation result and invoke the selected router action. No platform or provider heuristics.                                            |
| `src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts`       | Expose readiness and a provider-aware start mutation; record categorized telemetry.                                                                  |

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

/**
 * Three-valued so that "we do not know" is a state of the model rather than a review rule.
 * `probeTimedOut` and `unknown` may ONLY appear with `indeterminate`.
 */
type DockerReadinessOutcome = 'ready' | 'diagnosed' | 'indeterminate';

type DockerFailureKind =
  | 'cliMissing'
  | 'permissionDenied'
  | 'daemonUnavailable'
  | 'daemonStarting'
  | 'contextUnavailable'
  | 'endpointUnreachable'
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

/** `launchAttempted` is the honest result for a detached GUI launch that cannot be confirmed. */
type DockerLaunchResult = 'started' | 'launchAttempted' | 'notAvailable' | 'failed';

/** Everything a probe learned. This is the ONLY input the failure classifier may read. */
interface DockerProbeEvidence {
  readonly probe: 'cliVersion' | 'info' | 'contexts';
  readonly exitCode?: number;
  /** `error.code` from `child_process`, e.g. `ENOENT` when the CLI is not on PATH. */
  readonly spawnErrorCode?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly endedBy: 'exit' | 'deadline' | 'cancellation';
  readonly durationMs: number;
}

/** Direct reachability facts for the resolved endpoint; locale- and version-independent. */
interface DockerEndpointProbe {
  readonly kind: DockerEndpointKind;
  /** `EACCES`, `ENOENT`, or `ECONNREFUSED` from `fs.access` / `net.connect`. */
  readonly accessErrorCode?: string;
  /** How the endpoint was resolved, so `Show details` can explain a surprising value. */
  readonly source: 'dockerHostEnv' | 'dockerContextEnv' | 'currentContext' | 'platformDefault';
}

/** A documented fix shown as read-only text with a Copy button. The extension NEVER runs it. */
interface DockerRecoveryCommand {
  readonly id: 'linuxDockerGroup' | 'linuxStartService' | 'wslRestartFromWindows';
  readonly commandLine: string;
  readonly requiresElevation: boolean;
}

/** Persisted after any successful `docker info`; used as evidence when the daemon is down. */
interface DockerProviderMemory {
  readonly provider: DockerProvider;
  readonly endpointKind: DockerEndpointKind;
  readonly hostEnvironment: DockerHostEnvironment;
  readonly daemonArchitecture?: string;
  readonly osType?: 'linux' | 'windows';
  readonly recordedAtMs: number;
}
```

Extend `DockerReadiness` with:

- `outcome`
- `environment`
- `endpointKind`
- `provider`
- `providerEvidence`, one of `liveDaemon`, `activeContext`, `installedApplication`, `rememberedProvider`, or `none`
- `failureKind`, absent when ready
- `startAction`, present only when the extension can perform that exact action without elevation
- `recoveryCommand`, present only for the failures listed in [Copyable Recovery Commands](#copyable-recovery-commands)
- `canContinueAnyway`, true only when `outcome` is `indeterminate`
- `checkedAtMs`, when this result was produced, so the UI can label a memoized or remembered answer as old
- `osType`, when returned by a reachable daemon
- `daemonArchitecture`, normalized, when returned by a reachable daemon
- an execution-target category suitable for localized Review-screen copy
- a safe optional diagnostic summary for `Show details`

Keep `cliInstalled`, `cliVersion`, and `daemonReachable` during this change to limit call-site churn. Deprecate `arch` and `platformSupported` after the UI moves to daemon architecture; `process.arch` may remain an extension-host diagnostic but must not gate image compatibility. Do not encode contradictory combinations. Builder functions or explicit return branches in the service should construct each valid result.

Daemon architecture is normalized by a pure, tested function: `x86_64` becomes `amd64`, `aarch64` becomes `arm64`, and any other value is passed through unchanged. The Platform card and the test matrix both consume the normalized value.

## Readiness Execution Flow

`DockerReadinessService.getReadiness()` should be readable from top to bottom:

1. If a probe set is already in flight, await it. If a result younger than `READINESS_MEMO_TTL_MS` exists and the caller did not ask for a forced refresh, return it. `Retry` always forces a refresh.
2. Detect the extension-host environment once.
3. If the extension-host platform is unsupported, return `unsupportedHost` immediately.
4. Open one `CancellationTokenSource` for the whole check, armed with `READINESS_DEADLINE_MS`, and linked to the caller's cancellation token.
5. Run `docker -v` and `docker info --format {{json .}}` **concurrently** under that single deadline, capturing evidence for each. These two probes are independent: `docker info` does not need `docker -v` to have succeeded first.
6. If the `docker info` probe failed to spawn with `ENOENT`, return `cliMissing` immediately. The spawn errno is the evidence; do not infer this from the version probe's text.
7. If `docker info` succeeded, parse `InfoItem.raw` with a local schema to read `OSType`, `Architecture`, `ServerVersion`, and `ServerErrors`. A body carrying `ServerErrors` is a failure even when the exit code is zero. Otherwise: record the normalized daemon architecture, reject Windows-container mode, classify the provider, persist the provider memory record, and return `ready`.
8. Only in the failure branch, resolve the active endpoint and probe it. This keeps the happy path at two spawned processes.
9. Classify the failure from the captured evidence, in the precedence order below, and set `outcome` accordingly.
10. Only after failure classification, determine whether a safe provider start action and a copyable recovery command are available.
11. Build an execution-target category for Review-screen copy.
12. Return one typed readiness result and memoize it.

### Endpoint Resolution

Resolve the active endpoint in this exact precedence, and record which source won:

1. `DOCKER_HOST` from the extension host's environment.
2. `DOCKER_CONTEXT` from the extension host's environment.
3. The `current` entry returned by `listContexts()`.
4. The platform default: `unix:///var/run/docker.sock` or `npipe:////./pipe/docker_engine`.

Two notes that matter for real reports. First, the extension host's environment is not the user's terminal environment: a `DOCKER_HOST` exported from a shell profile is invisible to a VS Code instance launched from the macOS Dock or the Windows Start menu, which produces the classic "it works in my terminal" report. When the endpoint came from `DOCKER_HOST` or `DOCKER_CONTEXT`, say so in `Show details`. Second, `docker context ls` works with the daemon down, so it is safe to run in the failure branch.

### Endpoint Reachability Probe

For a `unixSocket` endpoint, `fs.access(socketPath, R_OK | W_OK)` distinguishes `EACCES` from `ENOENT` without reading a single word of English, and `net.connect` adds `ECONNREFUSED` for "the socket file exists but nothing is listening". For a `namedPipe` endpoint, existence of the pipe is the equivalent signal. This is the primary evidence for the reported Ubuntu and WSL failures; Docker's error sentence is only the tiebreaker. Apt, snap, rootless, and third-party installs all word that sentence differently, but they all produce the same errno.

### Deadline Policy

Use one overall `READINESS_DEADLINE_MS` rather than a per-command timeout, so probes cannot stack into a multiple of the budget. Implement it as a `CancellationTokenSource` plus a timer: the runner's cancellation path already calls `treeKill`, so the child process is genuinely terminated rather than abandoned. Because timeout and user cancellation both surface as `CancellationError`, the service must record which source fired and set `endedBy` accordingly.

A slow Docker is not a failed Docker. While a provider launch is in flight, or when the provider memory says Docker Desktop was in use, an expired deadline is classified as `daemonStarting` under a longer `READINESS_LAUNCH_DEADLINE_MS`, not as `probeTimedOut`. Docker Desktop routinely needs 30 to 90 seconds to become reachable after being started, and telling that user `Check timed out` is worse copy than the message they get today.

Use structured JSON output from Docker commands where available. Do not parse human-formatted tables. Prefer `--format {{json .}}` over the newer bare `--format json`, which older CLIs do not accept. Do not use shell pipelines. Each command must be represented as an executable plus an argument array through the existing command-runner abstraction. Centralize timeout durations as named constants and distinguish timeout from user cancellation.

Probes must keep stdin ignored. With `DOCKER_HOST=ssh://…`, an interactive passphrase prompt would otherwise block the probe until the deadline instead of failing immediately.

### Probe Noise

Post-launch polling re-runs the probe set repeatedly. The masked OutputChannel is the fallback diagnostic for every failure state in this plan, so it must stay readable: suppress the `$ docker info` command echo for poll probes and write only the first probe and any failing probe.

## Checks

| Check                        | Exists today | Planned behavior                                                                                                                                       | Platform dependence    | Owner                          |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------ |
| Probe evidence capture       | No           | Tee stdout and stderr per probe and record exit code, spawn errno, and how the probe ended. Nothing downstream can classify without this.              | None                   | Probe module                   |
| Docker CLI on `PATH`         | Yes          | Keep `docker -v` for the version string. `cliMissing` is decided by a spawn `ENOENT`, not by the version probe's text.                                 | None                   | Readiness service              |
| Daemon reachable             | Yes          | Keep `docker info`; read `OSType`, `Architecture`, `ServerVersion`, and `ServerErrors` from `InfoItem.raw`. A `ServerErrors` body is a failure.        | None                   | Readiness service              |
| Extension-host architecture  | Yes          | Keep only as optional diagnostics; do not use it as proof that the daemon can run the image.                                                           | Remote-dependent       | Readiness service              |
| Docker daemon architecture   | No           | Read it from the raw info body, normalize `x86_64`/`aarch64`, and display that fact in the Platform card.                                              | Endpoint-dependent     | Readiness service              |
| Image platform compatibility | No           | Do not guess before image resolution. Classify a real no-matching-manifest failure during pull and require consent before emulation.                   | Daemon/image-dependent | Provisioning follow-up         |
| Extension-host environment   | No           | Prefer `vscode.env.remoteName`; use explicit process/environment fallbacks for WSL tests and unusual hosts.                                            | Yes                    | Readiness service              |
| Execution target disclosure  | No           | Tell users whether Docker will run locally, in WSL, or in another remote extension host before provisioning.                                           | Yes                    | Presentation                   |
| Active endpoint/context      | No           | Resolve by the documented precedence and record the winning source. Use the existing `listContexts()`; do not add a `docker context inspect` command.  | Endpoint-dependent     | Readiness service              |
| Unix socket permission       | No           | Probe the endpoint directly with `fs.access`/`net.connect`. `EACCES` is the **primary** evidence for `permissionDenied`; error text is the tiebreaker. | Linux, WSL, macOS      | Probe module/classifier        |
| Daemon unavailable           | Partial      | Separate `ENOENT`/`ECONNREFUSED` from `EACCES`, and both from an unreachable remote endpoint.                                                          | Endpoint-dependent     | Classifier                     |
| Invalid/unavailable context  | No           | Classify context-not-found and endpoint-resolution failures separately.                                                                                | None                   | Classifier                     |
| Linux-container mode         | No           | When `docker info` succeeds, reject Windows-container mode with targeted guidance.                                                                     | Windows                | Readiness service              |
| Docker provider              | No           | Use daemon metadata, active context metadata, known endpoint evidence, an installed application, and the remembered record. Default to `unknown`.      | Yes                    | Classifier                     |
| Remembered provider          | No           | Persist a small last-known-good record on every successful `docker info` and use it as evidence once the daemon is unreachable.                        | None                   | Readiness service              |
| Launch capability            | Assumed      | Return an action only when the evidence bar for that environment is met and the launch needs no elevation.                                             | Yes                    | Provider launcher              |
| Copyable recovery command    | No           | Return a fixed, never-executed command for the failures listed below.                                                                                  | Yes                    | Recovery-command table         |
| Probe deadline/cancellation  | No           | One shared deadline for the whole check; propagate panel/query cancellation; classify a genuine expiry separately from user cancellation.              | None                   | Readiness service              |
| Probe deduplication          | No           | Single-flight plus a short TTL memo, so the panel, Retry, polling, and the provisioning `checking` stage cannot stack Docker processes.                | None                   | Readiness service              |
| Diagnostic output access     | Partial      | Reuse the masked OutputChannel, expose it from every failure state, and keep poll probes from flooding it.                                             | None                   | Router/presentation            |
| Provisioning daemon failures | No           | Route daemon-class failures raised during pull/run through the same classifier and the same recovery card.                                             | None                   | Provisioning flow              |
| Published-port reachability  | No           | When a readiness timeout follows a successful run in a dev container, say the daemon may be the host's and the published port may be unreachable.      | Dev container          | Provisioning flow              |
| Registry/proxy reachability  | No           | Remove generic proxy advice from this prerequisite card. Diagnose registry failures during pull instead.                                               | None                   | Provisioning flow, future work |

## Classification Precedence

Classification order matters. More actionable evidence must win over broad provider guesses, and structured evidence must win over sentences.

| Priority | Evidence                                                                                    | Result                | Outcome         |
| -------- | ------------------------------------------------------------------------------------------- | --------------------- | --------------- |
| 1        | Extension-host OS is outside the supported set                                              | `unsupportedHost`     | `diagnosed`     |
| 2        | Spawning the Docker executable fails with `ENOENT`                                          | `cliMissing`          | `diagnosed`     |
| 3        | Endpoint probe returns `EACCES` for the active local socket or pipe                         | `permissionDenied`    | `diagnosed`     |
| 4        | `ServerErrors` body or stderr matches a permission signature                                | `permissionDenied`    | `diagnosed`     |
| 5        | Endpoint probe returns `ENOENT` or `ECONNREFUSED` for the active local socket or pipe       | `daemonUnavailable`   | `diagnosed`     |
| 6        | The named context is absent, or no endpoint can be resolved                                 | `contextUnavailable`  | `diagnosed`     |
| 7        | `ServerErrors` body or stderr matches a cannot-connect signature for a local endpoint       | `daemonUnavailable`   | `diagnosed`     |
| 8        | A launch is in flight, or provider memory identifies Desktop and the endpoint is not yet up | `daemonStarting`      | `diagnosed`     |
| 9        | The endpoint is `tcp` or `ssh` and no local signature matched                               | `endpointUnreachable` | `diagnosed`     |
| 10       | A probe ended by deadline expiry without user cancellation                                  | `probeTimedOut`       | `indeterminate` |
| 11       | Failure does not match a tested category                                                    | `unknown`             | `indeterminate` |

`windowsContainers` is not part of this ladder: it is decided on the success branch, from a reachable daemon reporting `OSType: windows`.

Keep error signatures in named, anchored constants or small predicate functions, and keep them subordinate to the errno evidence above them. Each signature needs a test. Do not spread regular expressions across service, router, and React code. The classifier must be total: wrap it so that any unexpected exception yields `unknown` with an `indeterminate` outcome rather than propagating.

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

### Evidence Bar Per Environment

A single strict evidence bar creates a regression on the most common first-run failure. When the daemon is down, the main provider oracle is `docker info`, which is exactly the probe that failed. A local Windows user with Docker Desktop installed, stopped, and running on the `default` npipe context rather than `desktop-linux` would produce no provider evidence at all, so a strict rule removes the Start button they get today and leaves them at a dead end.

Weigh the two error costs per environment. A wrong user-clicked launch on local Windows or macOS is a harmless no-op; a missing one is a dead end. On Linux and WSL the asymmetry reverses, because starting the wrong daemon is genuinely confusing and can contradict the user's setup.

| Environment                    | Bar to **state a cause** naming Docker Desktop      | Bar to **offer a launch action**                                                     |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Local Windows, macOS           | Live daemon, active context, or remembered provider | Also satisfied by the Desktop application existing at its standard path              |
| Native Linux                   | Live daemon, active context, or remembered provider | Same strict bar; no launch from an installed application alone                       |
| WSL                            | Live daemon, active context, or remembered provider | Same strict bar; the Windows executable visible through `/mnt/c` is never sufficient |
| SSH, dev container, Codespaces | Never names a local application                     | No launch action in any case                                                         |

When a launch is offered from the lower bar, the failure wording stays provider-neutral and the button names the application it found. The evidence that produced the decision is recorded in `providerEvidence` so tests can assert it.

### Remembered Provider

On every successful `docker info`, persist a `DockerProviderMemory` record in `globalState`. When the daemon is later unreachable, treat that record as positive evidence.

This is a small change with a large effect on real sessions: a user who provisions successfully on Monday teaches the extension "Docker Desktop, npipe endpoint, amd64". On Tuesday, with Docker stopped, the extension can state the correct cause and offer the correct button instead of falling back to `unknown`. Record only the fields listed in the type; never a path, hostname, or context name.

#### Remembered facts go stale, so they must be visible and disposable

People change their Docker setup. They uninstall Docker Desktop and install Engine, delete the context the record was learned from, switch a WSL distribution off Desktop integration, or move a laptop between local and remote work. A remembered record that silently outlives the configuration it describes turns a helpful shortcut into a trap: the card keeps insisting on Docker Desktop, the Start button keeps launching something that is no longer installed, and nothing the user does in the panel changes the verdict.

Three rules keep that from happening.

**1. Always show when the facts were established.** Any card value or action derived from remembered evidence carries a quiet secondary label naming the time of the last successful check, for example `Last checked 3 days ago`. Remembered evidence is never presented as if it were observed just now.

**2. Always offer a full re-check.** A `Refresh` control sits at the bottom of the readiness form in **every** state, including `ready`, including `unsupportedHost`, and including any state that already has a primary action. It is also available as an inline link next to the `Last checked` label. `Refresh` discards the memoized readiness result, discards the remembered provider record, and reruns every check from scratch. This is the guaranteed exit from any wrong verdict, so it must never be conditional on the current failure kind.

**3. Expire and contradict aggressively.** Discard the record when any of the following holds, and fall back to provider-neutral behavior rather than guessing:

| Condition                                                                        | Reason                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `hostEnvironment` differs from the current environment                           | A laptop that moves between local and remote sessions must not inherit it |
| Older than `PROVIDER_MEMORY_MAX_AGE_MS`                                          | Bounded trust; a stale record is worse than no record                     |
| The endpoint now resolves to a different kind than the remembered `endpointKind` | The user changed their configuration                                      |
| The context the record describes is absent from `listContexts()`                 | The context was deleted or renamed                                        |
| The launch action derived from it returned `notAvailable` or `failed`            | The application is gone; do not offer it again on the next check          |
| The user pressed `Refresh`                                                       | Explicit intent beats remembered state                                    |

A record is also overwritten, not merged, on every successful `docker info`, so a live observation always wins over a remembered one.

The net effect is that remembered evidence can only ever shorten the path to a correct answer. It can never become the reason a user is stuck, because the label tells them the answer is old and the `Refresh` control is one click away in every state.

## UI Plan

Keep the card label `Docker daemon`. Change its value, guidance, link, and primary action from the typed result.

| State                               | Card value                   | Guidance                                                                                           | Primary action                                                                                | Also offered                                 |
| ----------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Ready                               | `Reachable`                  | None                                                                                               | None                                                                                          | None                                         |
| Desktop identified and unavailable  | `Docker Desktop not running` | `Start Docker Desktop and wait until it is ready.`                                                 | `Start Docker Desktop`                                                                        | Retry, View Docker output                    |
| Docker starting                     | `Starting…`                  | `Waiting for Docker to start. This can take a minute.`                                             | None; keep polling with a visible elapsed time and a `Stop waiting` control                   | View Docker output                           |
| Native daemon unavailable           | `Not running`                | `Start the Docker service, then check again.`                                                      | `Start Docker` only for positively identified rootless Engine; otherwise platform setup guide | `Copy command`, Retry, View Docker output    |
| Unix socket permission failure      | `Access denied`              | `Your user cannot access the Docker socket. Update Docker permissions, then restart your session.` | `Copy command`                                                                                | Linux setup guide, Retry, View Docker output |
| WSL Desktop integration unavailable | `Not accessible from WSL`    | `Enable Docker Desktop integration for this WSL distribution, then check again.`                   | WSL integration guide                                                                         | Retry, View Docker output                    |
| Remote daemon unavailable           | `Not accessible`             | `Docker must be available in the remote environment where this extension is running.`              | Remote Docker guide                                                                           | Retry, View Docker output                    |
| Remote endpoint unreachable         | `Endpoint unreachable`       | `The configured Docker endpoint did not respond.`                                                  | `Show details`, which names the endpoint source                                               | Retry, View Docker output                    |
| Invalid context                     | `Context unavailable`        | `The active Docker context is unavailable. Select or repair a valid context, then check again.`    | Docker context guide                                                                          | Retry, View Docker output                    |
| Probe timed out                     | `Check timed out`            | `Docker did not respond before the readiness check timed out.`                                     | `Retry`                                                                                       | `Continue anyway`, View Docker output        |
| Unsupported extension host          | `Unsupported`                | `Local Quick Start is supported when the extension runs on Windows, macOS, or Linux.`              | Learn more                                                                                    | None                                         |
| Windows-container mode              | `Linux containers required`  | `Switch Docker to Linux containers, then check again.`                                             | Setup guide                                                                                   | Retry, View Docker output                    |
| Unknown daemon failure              | `Not accessible`             | `The extension could not connect to the Docker daemon.`                                            | `Show details`                                                                                | `Continue anyway`, Retry, View Docker output |
| CLI missing                         | CLI card: `Not found`        | `Install Docker Engine or Docker Desktop, then reopen Quick Start.`                                | Platform-appropriate install guide                                                            | Retry                                        |

### Continue Anyway

`Continue anyway` appears only when `outcome` is `indeterminate`, and it proceeds straight to provisioning so the real `docker pull` and `docker run` produce the authoritative error.

This exists because the diagnosis is a heuristic and the feature is not. Consider a user whose endpoint-scanning security agent delays `docker info` past the deadline, or whose `docker` is a wrapper script that does not implement `info` cleanly, while `docker run` works perfectly. Without this control the extension has locked a working environment out of the feature and told the user something untrue about their machine. With it, the worst case is that provisioning fails a few seconds later with Docker's own words, which is strictly more informative than our guess.

`Continue anyway` is never shown for `diagnosed` outcomes: if the socket returned `EACCES`, provisioning cannot succeed and offering the attempt would be dishonest.

### Copyable Recovery Commands

For the failures listed below, render the documented fix as read-only, non-editable text with a `Copy command` button next to it. The extension never executes it, never opens a terminal for it, and never elevates.

| Failure and environment                          | Command offered                     | Note shown with it                                     |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| `permissionDenied` on Linux or WSL, unix socket  | `sudo usermod -aG docker $USER`     | Sign out and back in, or start a new WSL session.      |
| `daemonUnavailable` on root-managed Linux Engine | `sudo systemctl start docker`       | Runs the system Docker service.                        |
| `permissionDenied` on WSL after a group change   | `wsl --shutdown` (run from Windows) | Restarts the distribution so group membership applies. |

Rules:

- The command strings live in one constant table keyed by `DockerRecoveryCommand['id']`. They are never assembled from user input, never interpolated with a detected path, and never localized. Only the surrounding description is localized.
- `requiresElevation` is a fact carried on the record so the presentation can label it, not a permission for the extension to elevate.
- Telemetry records the command `id` when it is copied. It never records the command line or the outcome of running it.
- This does not weaken the "no privilege escalation" rule. The user reads the command, decides, and runs it themselves. It replaces a six-click documentation journey with one click for the single most-reported failure in this feature.

Additional UI changes:

- Add a `Refresh` control at the bottom of the readiness form in every state, next to a `Last checked <relative time>` label. It discards the memoized result and the remembered provider record and reruns every check. It is present even when Docker is ready and even when the state already has a primary action, because it is the guaranteed way out of a wrong or outdated verdict.
- When a card value or action was derived from remembered rather than live evidence, say so with the same `Last checked` label instead of presenting it as a fresh observation.
- Rename the router mutation and handler from `startDockerDesktop` to `startDockerProvider`.
- The server must recompute or validate the start action instead of trusting an action supplied by the webview.
- Return a typed `DockerLaunchResult` rather than a boolean. For `open -a Docker` and `systemctl --user start …`, await the exit code under a short bound and map a non-zero exit to `failed`; only a detached GUI launch may report `launchAttempted`. Today `systemctl --user start docker-desktop` printing `Unit docker-desktop.service not found` still returns `true`, and the user is later told the check timed out while the extension already held the real answer.
- When a launch is attempted, poll readiness with backoff under the launch deadline, never with overlapping probes, and stop on success, deadline expiry, panel close, or component unmount.
- Keep `Retry` available for every failure.
- Keep `View Docker output` available for every failure, using the existing masked OutputChannel.
- Show `Start Docker Desktop` only when `startAction` is present and identifies Desktop.
- Show `Continue anyway` only for `indeterminate` outcomes.
- Show `Copy command` only when the readiness result carries a `recoveryCommand`.
- Use provider-neutral Docker installation and troubleshooting links unless a platform/provider-specific guide is selected.
- Remove the unconditional corporate-proxy guidance because no registry check has happened on this screen.
- Replace `This machine (Docker)` with execution-target-aware copy. WSL and remote sessions must get a visible notice before Start, even when Docker is ready.
- In SSH, dev-container, and Codespaces sessions, state on the success card that the endpoint lives on the remote host. The saved connection string is `localhost:10260`, which is correct for the extension host and wrong for any tool the user runs on their own machine, so `Copy Connection String` must not imply otherwise.
- Change the Platform card to report Docker daemon architecture when known. If the daemon is unreachable, show `Unknown until Docker is reachable`; do not substitute `process.arch` as image compatibility.

## Work Items

### WI-0: Capture probe evidence

This is the prerequisite for every classification work item. Without it the classifier has only `Process exited with code 1` to work with, and would return `unknown` for the exact Ubuntu failure this plan exists to fix.

- Add a probe helper that runs one Docker command and returns `DockerProbeEvidence`.
- Tee stdout and stderr into local accumulators **in addition to** the masked OutputChannel writables, so a rejected command still yields its output.
- Record the child-process `error.code` separately from the exit code, so `ENOENT` is a first-class signal.
- Read the `docker info` JSON body from the captured stdout even when the exit code is non-zero, and treat a `ServerErrors` array as a failure regardless of exit code.
- Parse the raw info body with a local schema for `OSType`, `Architecture`, `ServerVersion`, and `ServerErrors`, because the library schema strips everything but `OperatingSystem` and `OSType`.
- Add the daemon architecture normalization function with tests.
- Add the endpoint reachability probe over injected `fs`/`net` dependencies.

#### Slice A implementation checkpoint (completed 2026-08-03)

Implemented in [commit `d832ebc1`](https://github.com/microsoft/vscode-documentdb/commit/d832ebc149a060152b517ff4a15c965448f6f0f3). `runDockerProbe()` normalizes the existing Docker client command descriptor, runs its executable and argument array through `ShellStreamCommandRunnerFactory`, and deliberately omits the client parser so raw output remains available on both successful and rejected commands. Capturing tee writables retain stdout and stderr while forwarding the same chunks to caller-provided masked OutputChannel writables. The returned evidence distinguishes numeric process exit codes from string spawn errno values and records whether completion came from process exit, the shared deadline, or caller cancellation.

The module also adds a local Zod schema for `OSType`, `Architecture`, `ServerVersion`, and `ServerErrors`; architecture normalization for `x86_64`/`aarch64`; and an endpoint probe that checks unix-socket read/write access before attempting a connection. Filesystem and network operations are injected for deterministic tests. Non-local endpoint probing remains for Slice B.

Nine focused tests passed, covering rejected stdout/stderr capture, spawn `ENOENT`, raw info parsing (including `ServerErrors`), invalid JSON, architecture normalization, endpoint `EACCES`, and endpoint `ECONNREFUSED`. Targeted ESLint and the repository TypeScript build also passed.

**Implementation choice:** The helper strips the Docker client response parser and runs the normalized command base through the same runner rather than attempting to recover the runner's destroyed accumulator. Two options were considered: modify or wrap the third-party parser path, or capture the raw streams at the command boundary and parse the retained info body locally. The latter was selected because it preserves the existing runner's quoting, masking, cancellation, and stdin behavior while making failed output available without changing a dependency.

**Corrections before commit:** The first focused run found that the test shell double returned the broader `CommandLineArgs` type rather than the required `string[]`; it was replaced with the real `Bash` implementation. Targeted ESLint then required the repository's inline type-import form for `Writable`; that import was corrected before the work-item commit. No committed implementation was rewritten or reset.

### WI-1: Add typed readiness contracts

- Add outcome, environment, provider, provider-evidence, failure, start-action, launch-result, recovery-command, and provider-memory types.
- Extend the readiness result without changing provisioning behavior.
- Update router serialization and telemetry typing.
- Add compile-time exhaustive checks for all semantic switches.
- Encode the invariant that `probeTimedOut` and `unknown` occur only with an `indeterminate` outcome.

### WI-2: Extract and test pure classification

- Add predicates for permission, context, unavailable-daemon, and unknown failures, all subordinate to the errno evidence captured in WI-0.
- Define precedence in one exported classifier that returns both a failure kind and an outcome.
- Make the classifier total: any unexpected exception becomes `unknown` with an `indeterminate` outcome.
- Add provider classification from structured daemon facts, context facts, endpoint facts, installed applications, and the remembered record, reporting which evidence won.
- Add table-driven unit tests for representative Linux, WSL, Windows, macOS, and remote errors.

#### Slice A implementation checkpoint (completed 2026-08-03)

Implemented the Slice A half of this work item in [commit `8d0cb52d`](https://github.com/microsoft/vscode-documentdb/commit/8d0cb52da7ce5ab53b44732136a6fb8de083eb6c). The new pure classifier applies the required evidence precedence for a missing CLI, local endpoint permission denial, structured or textual permission evidence, missing or refused local endpoints, deadline expiry, and the indeterminate fallback. The classifier is total and returns `unknown`/`indeterminate` if its internal classification path throws. Provider, context-unavailable, remote-endpoint, and platform-specific classification remain intentionally unimplemented for Slice B.

The first executable behavior check was the fixture-backed Ubuntu `EACCES` case required by the delivery plan. It was run red first and returned `unknown`/`indeterminate`; after implementing the classifier, the focused suite passed all seven cases. The changed files also passed targeted ESLint and the repository TypeScript build.

**Implementation-order deviation:** This partial WI-2 checkpoint was completed before WI-0, even though WI-0 is the runtime prerequisite for classification. Two options were considered: finish probe capture first, or write and execute the specified permission-denied classifier test before WI-0 was complete. The second option was selected because the plan explicitly requires that test to be the first executable behavior check. This does not expose the classifier in production yet; WI-0 and WI-3 still have to deliver the endpoint errno to it.

**Fixture provenance limitation:** The recorded report identifies Ubuntu and Docker Engine but does not preserve exact Ubuntu or Docker versions. The fixture states those fields as `not recorded` instead of inventing them. WI-9 remains responsible for replacing or supplementing it with fully versioned captures during the manual verification pass.

**Minimal contract dependency:** The probe, endpoint, failure, and outcome contracts needed to compile this checkpoint were added with the classifier. This is the minimum Slice A subset of WI-1, not completion of WI-1; the broader environment, provider, launch, recovery, and provider-memory contracts remain in Slice B.

### WI-3: Add the readiness orchestrator

- Move prerequisite command sequencing out of `ContainerRuntimeImpl`.
- Add environment detection and the documented endpoint-resolution precedence, recording the winning source.
- Run the version and info probes concurrently under one shared deadline, and resolve the endpoint lazily in the failure branch only.
- Implement the deadline as a `CancellationTokenSource` plus a timer so the child process is killed, and track which source fired to distinguish expiry from user cancellation.
- Add single-flight plus a short TTL memo, with a forced-refresh path for `Retry` and `Refresh`.
- Read daemon architecture from the raw info body rather than treating `process.arch` as image compatibility.
- Persist and read the provider-memory record, and apply every discard rule in [Remembered Provider](#remembered-provider): environment mismatch, maximum age, endpoint-kind change, a context that no longer exists, a launch action that reported `notAvailable` or `failed`, and an explicit refresh.
- Stamp `checkedAtMs` on every returned result so the UI can label an old answer.
- Preserve masked OutputChannel command logging, but suppress command echo for poll probes.
- Return early for CLI failures and use one explicit branch for daemon success/failure.
- Keep a compatibility delegate on `IContainerRuntime` only if needed to avoid unrelated service churn.

### WI-4: Replace the launcher

- Move process launching out of `ContainerRuntime.ts`.
- Implement one named function per supported launch action.
- Select actions through an exhaustive switch, honoring the per-environment evidence bar.
- Await the exit code for short-lived launchers and return a precise `DockerLaunchResult`; reserve `launchAttempted` for detached GUI launches.
- Inject filesystem/process dependencies for unit tests.
- Refuse unavailable, stale, remote, or privilege-requiring actions.

### WI-5: Update router and telemetry

- Return the enriched readiness result.
- Accept a `forceRefresh` input on the readiness query that bypasses the memo and clears the remembered provider record.
- Replace `startDockerDesktop` with `startDockerProvider`.
- Revalidate start capability on the extension host immediately before launch.
- Add a `continueAnyway` path that skips the gate for `indeterminate` outcomes only, and tag the resulting provision telemetry with that fact.
- Record only categorized readiness and launch outcomes, plus the copied recovery-command `id`.
- Record a redacted fingerprint for `unknown` classifications: lowercase the captured stderr, replace digits, paths, and hex runs with placeholders, truncate, and hash. This is what turns unclassified real-world failures into new rules instead of leaving the classifier frozen at whatever this plan imagined.
- Never record raw errors, executable paths, socket paths, context names, or environment variable values.

### WI-6: Update the webview

- Add a pure semantic presentation mapper.
- Render card values and recovery actions from its result.
- Remove platform checks and raw error matching from JSX.
- Replace the fixed five-second wait with cancelable, non-overlapping polling with backoff.
- Add the `Docker starting` state with visible elapsed time and a `Stop waiting` control.
- Add `Continue anyway` for indeterminate outcomes and `Copy command` for recovery commands.
- Add the always-present `Refresh` control and the `Last checked` label, and make the relative time announce politely when it changes after a refresh.
- Add execution-target-aware Review copy and a remote-session notice for ready Docker environments.
- Expose the existing masked Docker output from every readiness failure.
- Render daemon architecture without claiming unverified image compatibility.
- Localize all added or changed user-facing strings, but never the command lines themselves.
- Use no em dashes (U+2014) and no en dashes (U+2013) in any added or changed string.
- Preserve accessible announcements for status changes and launch failures, and announce a successful copy.

### WI-7: Add integration-focused tests

- Test service sequencing with mocked command results.
- Test that a rejected probe still yields its stderr and stdout, so a permission failure is classified rather than reduced to an exit code.
- Test that a `ServerErrors` body with exit code zero is treated as a failure.
- Test that permission denial wins even when Docker Desktop is installed on the Windows host of WSL.
- Test that native WSL Docker never receives a Desktop launch action.
- Test that only positively identified rootless Linux Engine receives `Start Docker`; root-managed Engine never does.
- Test that a local Windows Desktop installation still yields a launch action when the daemon is down and no context evidence exists.
- Test that the provider-memory record produces a Desktop diagnosis on a later unreachable daemon, and that a record from a different host environment is ignored.
- Test every provider-memory discard rule: age, environment mismatch, endpoint-kind change, missing context, and a failed launch action.
- Test that `Refresh` clears the memo and the remembered record and reruns all checks, and that it is rendered in every readiness state including `ready` and `unsupportedHost`.
- Test that a result derived from remembered evidence is labeled with its check time rather than presented as fresh.
- Test that remote environments never launch a local desktop application.
- Test each presentation state and its exact semantic action.
- Test polling cleanup on success, deadline expiry, and unmount, and that polls never overlap.
- Test probe deadline expiry versus user cancellation, and that expiry during a launch yields `daemonStarting`.
- Test single-flight and TTL behavior, including that `Retry` forces a refresh.
- Test that `Continue anyway` is offered only for indeterminate outcomes.
- Test that probes spawn with stdin ignored.
- Test Review-screen execution-target copy for local, WSL, SSH, dev-container, and Codespaces environments.
- Test that normalized daemon architecture, not `process.arch`, drives the Platform card.

### WI-8: Reuse the classifier on the provisioning path

The readiness gate is a snapshot, and the daemon can disappear between the gate and the first `docker pull`. A Docker Desktop auto-update three seconds after the check produces `error during connect: … The system cannot find the file specified`, which today lands in the failure card as a raw string with none of the recovery UI this plan builds.

- Route daemon-class failures raised during pull and run through the same classifier.
- Render the same recovery card, including start action, recovery command, and `View Docker output`.
- Keep registry- and image-specific classification out of scope; only daemon-class failures are in this work item.
- When a readiness timeout follows a successful `docker run` in a dev-container session, add the published-port explanation: the daemon may be the host's, so the container's published port is not necessarily reachable from inside the dev container.

### WI-9: Build a fixture corpus and manual verification pass

Every test above feeds the classifier text that the implementer wrote, which validates the classifier against its own assumptions. The fragile input is real CLI output, and the readiness gap notes record that macOS and Linux were never verified at all.

- Add `__fixtures__/docker/<os>-<dockerVersion>-<case>.txt` files holding real captured stdout and stderr, each with a provenance comment naming the OS, Docker version, and provider.
- Table-drive the classifier tests from those files rather than from inline strings.
- Record a short manual verification checklist covering, at minimum: Windows with Desktop stopped, macOS with Desktop stopped, native Ubuntu without `docker` group membership, native Ubuntu with the service stopped, and WSL with and without Desktop integration.
- Treat a new Docker version that breaks a signature as a fixture addition, not a rewrite.

### WI-10: Update documentation

- Replace statements that imply Docker Desktop is universally required.
- Document Docker Engine and Docker Desktop as supported provider choices.
- Document Linux group/session restart and WSL integration guidance.
- Keep multi-step setup procedures in linked documentation. The card carries at most the single copyable command from the recovery-command table; it never becomes a shell tutorial.

## Required Test Matrix

| Scenario                                                               | Expected failure/provider                         | Expected action                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| CLI absent on Linux                                                    | `cliMissing` / `unknown`                          | Linux install guide                                           |
| Native Ubuntu daemon reachable                                         | Ready / `dockerEngine`                            | None                                                          |
| Native Ubuntu socket returns `EACCES`                                  | `permissionDenied` / `dockerEngine` or `unknown`  | `Copy command` for the group fix, plus Linux setup guide      |
| Native Ubuntu daemon stopped                                           | `daemonUnavailable` / `dockerEngine` or `unknown` | Service guide and copyable service command, no auto start     |
| Native rootless Ubuntu user service stopped                            | `daemonUnavailable` / `dockerEngine`              | Start Docker                                                  |
| WSL native socket permission denied while Windows Desktop is installed | `permissionDenied` / native endpoint              | Linux/WSL setup guide, no Desktop button                      |
| WSL Desktop integration endpoint unavailable                           | `daemonUnavailable` / `dockerDesktop`             | Start Desktop on Windows or WSL integration guide             |
| Local Windows Desktop stopped                                          | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                          |
| Local Windows Desktop stopped on the `default` npipe context           | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop from the installed-application bar       |
| Local macOS Desktop stopped                                            | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                          |
| Linux Docker Desktop user service stopped                              | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                          |
| Invalid Docker context                                                 | `contextUnavailable`                              | Context guide                                                 |
| Windows daemon reports Windows containers                              | `windowsContainers`                               | Linux-container guidance                                      |
| SSH remote with no daemon                                              | `daemonUnavailable` / `unknown`                   | Remote Docker guide, no local launch                          |
| Unknown nonzero `docker info` error                                    | `unknown`, `indeterminate`                        | Show details, Retry, Continue anyway                          |
| `docker info` never responds                                           | `probeTimedOut`, `indeterminate`                  | View Docker output, Retry, Continue anyway                    |
| Deadline expires while a Desktop launch is in flight                   | `daemonStarting`                                  | Keep waiting with elapsed time and a Stop waiting control     |
| `DOCKER_HOST=tcp://<unreachable>:2375`                                 | `endpointUnreachable`                             | Show details naming the `DOCKER_HOST` source                  |
| `DOCKER_HOST=ssh://<host>` prompting for a passphrase                  | Probe fails fast, never hangs                     | Show details naming the `DOCKER_HOST` source                  |
| `docker info` exits zero but the body carries `ServerErrors`           | Classified as a daemon failure, not ready         | Matching recovery card                                        |
| Readiness query is canceled                                            | Cancellation, not a failure category              | Stop probes and render no stale error                         |
| Two callers request readiness at once                                  | One probe set runs                                | Both receive the same result                                  |
| Remembered Desktop record, Desktop since uninstalled                   | Launch reports `notAvailable`, record discarded   | Next check is provider-neutral, not a repeated Desktop claim  |
| Remembered record older than the maximum age                           | Record ignored                                    | Provider-neutral guidance plus `Last checked` label           |
| Remembered record whose context no longer exists                       | Record discarded                                  | Provider-neutral guidance                                     |
| User presses `Refresh` in any state                                    | Memo and remembered record cleared                | All checks rerun and the `Last checked` label updates         |
| Unsupported Node extension-host platform                               | `unsupportedHost` / `unknown`                     | Learn more, no Docker launch                                  |
| SSH extension host with reachable remote amd64 daemon on arm64 client  | Ready / daemon architecture `amd64`               | Show remote target, daemon architecture, remote-endpoint note |
| WSL extension host with reachable native daemon                        | Ready / `dockerEngine`                            | Show WSL execution-target notice                              |
| Daemon disappears between the gate and `docker pull`                   | Same daemon-class failure as readiness            | Same recovery card, not a raw error string                    |
| Dev container: run succeeds, readiness probe times out                 | Readiness timeout plus published-port explanation | Existing timeout recovery actions                             |

## Maintainability Requirements

The implementation is not complete unless these structural constraints hold:

- Every function has an explicit return type.
- No `any` is introduced.
- No platform checks appear in React components.
- No user-facing text is selected in the host-side launcher.
- No error-string matching appears outside the classifier.
- No classification is decided by error text when an errno or structured field answers the same question.
- No classifier input comes from a rejected promise's message; all evidence is captured.
- No executable/service paths appear outside the launcher or named platform constants.
- No recovery command line is built anywhere except the recovery-command constant table.
- No recovery command is executed, and none is passed to a shell, a terminal, or a task.
- No user-facing string contains U+2014 or U+2013.
- No readiness state renders without a `Refresh` control.
- No remembered fact is presented without its check time.
- No nested ternary is used for readiness, provider, failure, or action selection.
- No shell command is assembled as a single interpolated string.
- No command output is parsed with ad hoc line splitting when JSON is available.
- No external readiness command can wait indefinitely.
- No two probe sets run concurrently.
- No start action is inferred from operating system alone.
- No image compatibility decision is inferred from `process.arch` alone.
- All semantic `switch` statements are exhaustive.
- Raw command errors stay out of telemetry and primary UI copy.
- New modules remain focused; avoid a generic framework or class hierarchy for the small set of launch actions.

Prefer straightforward named functions such as:

- `runDockerProbe()`
- `probeDockerEndpoint()`
- `detectHostEnvironment()`
- `resolveDockerEndpoint()`
- `normalizeDaemonArchitecture()`
- `classifyDockerFailure()`
- `classifyDockerProvider()`
- `getAvailableStartAction()`
- `getRecoveryCommand()`
- `startDockerProvider()`
- `getDockerReadinessPresentation()`
- `getDockerExecutionTargetPresentation()`

These names are illustrative, but the final code should preserve this visible execution flow.

## Acceptance Criteria

1. A native Ubuntu or WSL socket permission error is displayed as `Access denied`, not `Stopped`, and that verdict comes from the endpoint errno rather than from an English sentence.
2. Probe evidence reaches the classifier: a failing probe's stderr and JSON body are available, and no classification is derived from `Process exited with code 1`.
3. Installing Docker Desktop on the Windows host does not override a native WSL permission diagnosis.
4. `Docker Desktop` is named as a cause only when Desktop is positively identified, and a launch action is offered under the documented per-environment evidence bar.
5. A local Windows or macOS user with Docker Desktop installed but stopped still gets a working start action, including on the `default` context.
6. Remembered provider facts are labeled with the time of the last successful check, are discarded by every documented rule, and are never the reason a user cannot reach a correct answer.
7. A `Refresh` control that reruns every check and clears remembered state is available in every readiness state, including `ready`.
8. Native Linux Docker Engine users never receive a `Start Docker Desktop` action.
9. Root-managed Linux Docker Engine never triggers a privileged start; rootless Engine receives `Start Docker` only from positive evidence.
10. Remote extension hosts never launch a Docker application on the user's local machine.
11. Unknown and timed-out failures are reported as indeterminate, use provider-neutral language, and retain Retry, details, and `Continue anyway`.
12. `Continue anyway` never appears for a diagnosed failure.
13. The copyable recovery command is shown for the documented failures, is never executed by the extension, and is never localized.
14. WSL and other remote users are told where the container will run before provisioning, and remote users are told the endpoint is remote after it succeeds.
15. A hung Docker probe is killed at the shared deadline and cannot leave the webview spinning indefinitely.
16. A Docker that is merely slow to start is reported as starting, not as timed out.
17. Concurrent readiness callers and post-launch polling never run overlapping probe sets.
18. The Platform card reports normalized daemon architecture when known and does not claim image support from `process.arch`.
19. Masked Docker output is reachable from every readiness failure and is not flooded by polling.
20. A daemon-class failure during provisioning renders the same recovery card as the readiness gate.
21. Existing ready-Docker provisioning behavior is unchanged.
22. Classifier tests are driven by captured real-world fixtures, and unclassified failures emit a redacted fingerprint.
23. Added classification and launch-selection branches have focused tests.
24. All changed user-facing strings are localized and contain no U+2014 or U+2013 characters.
25. The repository completion checks pass in order:
    - `npm run l10n`
    - `npm run prettier-fix`
    - `npm run lint`
    - `npx jest --no-coverage`
    - `npm run build`

## Suggested Delivery Order

Split this into two shippable slices. The work with the highest user value is not the work with the highest regression risk, and they should not ride together: slice B touches the platform combinations that the v1 readiness notes record as never having been verified.

### Slice A: fix the reported failure

WI-0, the permission and daemon-unavailable half of WI-2, the parts of WI-3 needed to run bounded probes and resolve the endpoint, the `Access denied` and indeterminate states from WI-6, the copyable recovery command, `Continue anyway`, the always-present `Refresh` control, and `View Docker output` from every failure.

This resolves the Ubuntu and WSL report end to end while leaving the existing Windows and macOS launch behavior untouched, so its regression surface on unverified platforms is close to zero.

### Slice B: complete the model

Provider classification and provider memory, the evidence bar and launch matrix (WI-4), router and telemetry (WI-5), the remaining presentation states and execution-target copy (WI-6), the full integration test set (WI-7), provisioning reuse (WI-8), fixtures and manual verification (WI-9), and documentation (WI-10).

Keep each work item independently testable, and do not expose partially classified states in the UI.

The first executable behavior check should be the Linux/WSL permission-denied classifier test, driven by a real captured fixture. It directly reproduces the reported failure and will disconfirm the implementation if it still falls through to `daemonUnavailable` or Docker Desktop guidance. Write it before WI-0 is complete: with today's code it fails because the evidence is missing, which is the point.
