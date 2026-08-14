---
area: local-quickstart
kind: iteration
status: historical
created: 2026-08-02
---

# Local Quick Start Docker Readiness - Implementation Plan

**Date:** 2026-08-02
**Status:** Slice A and Slice B implementation complete; cross-platform manual verification handoff remains
**Related design:** [local-quickstart-v2.md](../../design.md)

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

The current implementation is concentrated in [ContainerRuntime.ts](../../../../../../src/services/localQuickStart/ContainerRuntime.ts):

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
  readonly id: 'linuxDockerGroup' | 'linuxStartService' | 'wslStartServiceNoSystemd' | 'wslRestartFromWindows';
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

| State                                           | Card value                   | Guidance                                                                                                             | Primary action                                                                                | Also offered                                                                          |
| ----------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ready                                           | `Reachable`                  | None                                                                                                                 | None                                                                                          | None                                                                                  |
| Desktop identified and unavailable              | `Docker Desktop not running` | `Start Docker Desktop and wait until it is ready.`                                                                   | `Start Docker Desktop`                                                                        | Retry, View Docker output                                                             |
| Docker starting                                 | `Starting…`                  | `Waiting for Docker to start. This can take a minute.`                                                               | None; keep polling with a visible elapsed time and a `Stop waiting` control                   | View Docker output                                                                    |
| Native daemon unavailable                       | `Not running`                | `Start the Docker service, then check again.`                                                                        | `Start Docker` only for positively identified rootless Engine; otherwise platform setup guide | `Copy command`, Retry, View Docker output                                             |
| Unix socket permission, group fix needed        | `Access denied`              | Environment-aware instructions to run the group command and start the required new login or WSL session.             | `Copy command`                                                                                | Recovery note, Linux setup guide, Retry, View Docker output                           |
| Unix socket permission, session restart pending | `Access denied`              | Explain that group membership is already configured and name the exact Linux, WSL, SSH, or container session action. | `Copy command` only for WSL shutdown                                                          | Recovery note when a command is present, Linux setup guide, Retry, View Docker output |
| WSL Desktop integration unavailable             | `Not accessible from WSL`    | `Enable Docker Desktop integration for this WSL distribution, then check again.`                                     | WSL integration guide                                                                         | Retry, View Docker output                                                             |
| Remote daemon unavailable                       | `Not accessible`             | `Docker must be available in the remote environment where this extension is running.`                                | Remote Docker guide                                                                           | Retry, View Docker output                                                             |
| Remote endpoint unreachable                     | `Endpoint unreachable`       | `The configured Docker endpoint did not respond.`                                                                    | `Show details`, which names the endpoint source                                               | Retry, View Docker output                                                             |
| Invalid context                                 | `Context unavailable`        | `The active Docker context is unavailable. Select or repair a valid context, then check again.`                      | Docker context guide                                                                          | Retry, View Docker output                                                             |
| Probe timed out                                 | `Check timed out`            | `Docker did not respond before the readiness check timed out.`                                                       | `Retry`                                                                                       | `Continue anyway`, View Docker output                                                 |
| Unsupported extension host                      | `Unsupported`                | `Local Quick Start is supported when the extension runs on Windows, macOS, or Linux.`                                | Learn more                                                                                    | None                                                                                  |
| Windows-container mode                          | `Linux containers required`  | `Switch Docker to Linux containers, then check again.`                                                               | Setup guide                                                                                   | Retry, View Docker output                                                             |
| Unknown daemon failure                          | `Not accessible`             | `The extension could not connect to the Docker daemon.`                                                              | `Show details`                                                                                | `Continue anyway`, Retry, View Docker output                                          |
| CLI missing                                     | CLI card: `Not found`        | `Install Docker Engine or Docker Desktop, then reopen Quick Start.`                                                  | Platform-appropriate install guide                                                            | Retry                                                                                 |

### Continue Anyway

`Continue anyway` appears only when `outcome` is `indeterminate`, and it proceeds straight to provisioning so the real `docker pull` and `docker run` produce the authoritative error.

This exists because the diagnosis is a heuristic and the feature is not. Consider a user whose endpoint-scanning security agent delays `docker info` past the deadline, or whose `docker` is a wrapper script that does not implement `info` cleanly, while `docker run` works perfectly. Without this control the extension has locked a working environment out of the feature and told the user something untrue about their machine. With it, the worst case is that provisioning fails a few seconds later with Docker's own words, which is strictly more informative than our guess.

`Continue anyway` is never shown for `diagnosed` outcomes: if the socket returned `EACCES`, provisioning cannot succeed and offering the attempt would be dishonest.

### Copyable Recovery Commands

For the failures listed below, render the documented fix as read-only, non-editable text with a `Copy command` button next to it. The extension never executes it, never opens a terminal for it, and never elevates.

| Command ID                 | Failure, environment, and refinement selector                                                  | Command offered                 | Note shown with it                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `linuxDockerGroup`         | `permissionDenied`, Linux or WSL unix socket, `notInGroup` or `unknown`                        | `sudo usermod -aG docker $USER` | `Group membership applies to new login sessions only.`                                                |
| `linuxStartService`        | `daemonUnavailable`, native Linux, or WSL with positively detected active systemd              | `sudo systemctl start docker`   | `Runs the system Docker service.`                                                                     |
| `wslStartServiceNoSystemd` | `daemonUnavailable`, WSL without active systemd and with a positively detected service wrapper | `sudo service docker start`     | `Runs the system Docker service.`                                                                     |
| `wslRestartFromWindows`    | `permissionDenied`, WSL unix socket, `pendingSessionRestart`                                   | `wsl --shutdown`                | `This stops all running WSL distributions so the new group membership applies when WSL starts again.` |

Native Linux with `pendingSessionRestart` intentionally receives no command. The user must sign out of the desktop session and sign back in; reloading the VS Code window does not refresh process groups. SSH users must kill the remote VS Code server and reconnect. Dev-container and Codespaces users must rebuild the container.

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

**Follow-up correction:** The required repository-wide Prettier pass found formatting drift in this module after the work-item commit. The mechanical-only correction is preserved in [commit `4265d8f3`](https://github.com/microsoft/vscode-documentdb/commit/4265d8f3b732d0e0e963e3e495c57812c2c2cf75) rather than rewriting the WI-0 commit.

### WI-1: Add typed readiness contracts

- Add outcome, environment, provider, provider-evidence, failure, start-action, launch-result, recovery-command, and provider-memory types.
- Extend the readiness result without changing provisioning behavior.
- Update router serialization and telemetry typing.
- Add compile-time exhaustive checks for all semantic switches.
- Encode the invariant that `probeTimedOut` and `unknown` occur only with an `indeterminate` outcome.

#### Slice B implementation checkpoint (completed 2026-08-03)

Implemented and pushed in [commit `d6254c1c`](https://github.com/microsoft/vscode-documentdb/commit/d6254c1cd1f30b099b817addee3a36b0f4657140). The shared contract now includes provider, provider-evidence, start-action, launch-result, execution-target, and provider-memory types, and the failure union includes every Slice B category. `DockerReadiness` is now a discriminated union: ready results require a reachable daemon and forbid a failure kind, diagnosed results exclude `probeTimedOut` and `unknown`, and indeterminate results allow only those two kinds and require `canContinueAnyway: true`.

Current readiness construction populates neutral `unknown`/`none` provider facts and a typed execution target, so this checkpoint does not change provisioning or launch decisions before WI-2 through WI-4 implement the evidence. Docker `OSType` is normalized before entering the narrower serialized contract. The classifier result was also changed to a correlated diagnosed/indeterminate union, and presentation switches remain compile-time exhaustive. Newly declared Slice B failures temporarily use the existing provider-neutral fallback presentation; their distinct states are deliberately deferred to WI-6 so partially classified behavior is not exposed.

The focused verification passed 77 readiness, presentation, and provisioning tests. The repository test script also completed its workspace pre-build, targeted ESLint passed, and editor diagnostics were clear for all six changed files.

**Corrections before commit:** The first compile exposed two test fixtures that omitted the new provider facts, a raw string `OSType`, and a classifier return whose outcome and failure kind were not correlated. Those were corrected by constructing only legal union members, normalizing the OS fact, and returning a correlated classifier union. Later checks exposed literal widening in a shared failure result and a TypeScript narrowing issue in the presentation's exhaustive default; the result now preserves literals and the switch narrows a local failure-kind value. No committed history was reset or rewritten.

**Follow-up correction:** WI-3 analysis exposed that the diagnosed variant was too strict: a daemon reporting Windows-container mode is reachable even though Local Quick Start must diagnose `windowsContainers` and block provisioning. [Commit `0720fbe4`](https://github.com/microsoft/vscode-documentdb/commit/0720fbe4eebd3deee9b008cce4c4c2fd3dd57fb3) changes diagnosed `daemonReachable` from the literal `false` to `boolean`; ready and indeterminate invariants remain unchanged. This correction passed 52 focused readiness and presentation tests and is preserved as a separate commit rather than rewriting WI-1.

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

**Fixture provenance gap, now closed:** The original report did not preserve exact versions, so the first checkpoint correctly recorded them as unknown. Follow-up testing confirmed WSL2, Ubuntu-20.04, Docker Engine 28.1.1, socket GID 998, and permissions `srw-rw----`. Commit [`4f363411`](https://github.com/microsoft/vscode-documentdb/commit/4f36341104b21c83fe9f83f9418ee4acd68f10d2) updates the fixture header with those facts rather than inventing provenance.

**Minimal contract dependency:** The probe, endpoint, failure, and outcome contracts needed to compile this checkpoint were added with the classifier. This is the minimum Slice A subset of WI-1, not completion of WI-1; the broader environment, provider, launch, recovery, and provider-memory contracts remain in Slice B.

**Follow-up correction:** The required repository-wide Prettier pass found formatting drift in the classifier and its tests after the work-item commit. The mechanical-only correction is preserved in [commit `4265d8f3`](https://github.com/microsoft/vscode-documentdb/commit/4265d8f3b732d0e0e963e3e495c57812c2c2cf75) rather than rewriting the WI-2 commit.

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `54e13d9d`](https://github.com/microsoft/vscode-documentdb/commit/54e13d9dfb1d6bd818d200c16262a2d494b01ee6). The failure classifier now covers unavailable contexts, remote TCP/SSH endpoints, and provider-start-in-progress while preserving the documented precedence: local errno and structured permission evidence still win over provider state, remote classification, timeout, and the unknown fallback. The classifier remains total and returns `unknown`/`indeterminate` if unexpected evidence throws.

The same pure module now classifies providers from live daemon metadata, active Desktop context/endpoint signatures, rootless Engine endpoint evidence, a valid remembered provider, or an installed Desktop application. Live evidence wins over remembered evidence. Installed-application evidence is accepted only for local Windows and macOS; WSL and remote extension hosts remain provider-neutral, so a Windows Desktop installation cannot override a native WSL socket diagnosis.

Twenty-two focused classifier tests passed. They cover the new failure categories, precedence, total fallback, representative live Desktop and Engine metadata, Desktop contexts, rootless Engine endpoints, remembered facts, local installed-application evidence, and the WSL/remote negative cases. Targeted ESLint passed and editor diagnostics were clear.

**Implementation boundary:** Provider classification is exported but not consumed by the service in this commit. Two options were considered: wire the first provider branches immediately, or keep the pure work item independently testable until WI-3 can apply provider memory, endpoint resolution, and discard rules together. The second option was selected because exposing provider facts without those orchestration rules would create the partially classified UI state prohibited by the delivery plan.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the Slice B classifier and test layout in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-2 commit.

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
- After a unix-socket `permissionDenied` diagnosis, collect socket ownership, process-group, and best-effort local group-membership facts and resolve `permissionDetail` without changing classifier precedence.
- For WSL daemon-unavailable recovery, detect active systemd or an available service wrapper through injected filesystem facts before selecting a command.

#### Slice A implementation checkpoint (completed 2026-08-03)

Implemented the Slice A subset in [commit `e076243a`](https://github.com/microsoft/vscode-documentdb/commit/e076243a72c6585b21ccf3a80dff90c145084d2f). `DockerReadinessService` now owns concurrent `docker -v` and structured `docker info` probes, one shared 15-second deadline, caller cancellation linking, host-environment detection, lazy failure-only context lookup, the documented endpoint precedence, direct endpoint probing, failure classification, a two-second memo, single-flight behavior, and forced refresh. `ContainerRuntime.isDockerReady()` is now a compatibility delegate to that service; pull, run, inspect, lifecycle, and Desktop-launch behavior were not changed.

The success branch reads the locally parsed raw info facts, treats any `ServerErrors` body as a failure even with exit code zero, and reports normalized daemon architecture. The failure branch returns the Slice A outcome/failure fields, `canContinueAnyway`, a safe diagnostic category/source summary, and a fixed copyable recovery command where applicable. `dockerRecoveryCommands.ts` is the only source of command lines; no recovery command is executed.

Eighteen focused orchestrator tests cover the reported Linux `EACCES` path, copyable group command, concurrent callers, one-token deadline cancellation, `ServerErrors` with exit code zero, memo/forced-refresh behavior, host detection, and all endpoint-resolution precedence levels. Together with probe, classifier, and provisioning compatibility tests, 57 host-side tests passed. The root TypeScript build passed and targeted ESLint reported no errors.

**Cancellation implementation deviation:** The plan named `vscode.CancellationTokenSource`. The implementation instead creates one standard `AbortController` and adapts its signal with `CancellationTokenLike.fromAbortSignal()` from the same processutils package used by the command runner. Two options were considered after the focused deadline test exposed that `jest-mock-vscode` explicitly does not implement `CancellationTokenSource`: inject a custom cancellation-source factory used only by tests, or use the existing production adapter that provides the same structural cancellation token to `spawnStreamAsync`. The adapter was selected because it keeps one real production path, preserves process-tree termination in the runner, distinguishes deadline from caller cancellation with explicit flags, and is directly testable. Confidence in this deviation was above 80% because the adapter is supplied by the runner's own dependency for exactly this token-bridging purpose.

**Deliberately deferred WI-3 scope:** Provider memory and all of its discard rules remain in Slice B. Poll-specific OutputChannel echo suppression remains deferred because Slice A does not start provider polling. Unsupported-host early return and context-unavailable/remote-endpoint diagnoses remain deferred with the corresponding Slice B presentation states. On a ready result, `endpointKind` is populated from `DOCKER_HOST` when explicit and otherwise remains `unknown`; querying contexts on the happy path was rejected because it would violate the plan's two-process happy-path requirement. Failure results always resolve and report the active endpoint through the full precedence chain.

**Corrections before commit:** The first service run needed an explicit test-only `CancellationToken` type import. The next exposed that the VS Code Jest host leaves `vscode.env` undefined, so the default remote-name lookup was made host-safe. The deadline test then exposed the unimplemented VS Code cancellation source and led to the adapter decision above. Targeted ESLint also required replacing a dynamic VS Code type annotation with the repository's inline type-import style. No committed implementation was reset or rewritten. ESLint continues to report the pre-existing warning that the unchanged `startDockerDesktop()` function is `async` without `await`; replacing that launcher belongs to WI-4 in Slice B.

**Follow-up correction:** The required repository-wide Prettier pass found formatting drift in the orchestrator and its tests after the work-item commit. The mechanical-only correction is preserved in [commit `4265d8f3`](https://github.com/microsoft/vscode-documentdb/commit/4265d8f3b732d0e0e963e3e495c57812c2c2cf75) rather than rewriting the WI-3 commit.

#### Pending-session refinement checkpoint (completed 2026-08-03)

Implemented the host-side refinement in [commit `8a7780c3`](https://github.com/microsoft/vscode-documentdb/commit/8a7780c341fa271e7d3ec39e1494c93f4cdf073c). After the existing classifier has returned `permissionDenied` for a unix socket, `probeDockerSocketGroup()` reads the socket owner GID, compares it with both the extension host's effective and supplementary GIDs, and performs a best-effort lookup of the current user in the matching local group entry. `resolveDockerPermissionDetail()` implements the four-row refinement table and records `pendingSessionRestart`, `notInGroup`, or `unknown` without changing `DockerFailureKind` or `dockerReadinessClassification.ts`.

The reporter's captured state is covered directly: socket GID 998, process groups `1000 4 20 24 25 27 29 30 44 46 118`, and local `docker:x:998:tnaum` membership resolve to `pendingSessionRestart`. The service calls this probe only after a unix-socket permission diagnosis; named pipes and every non-permission result skip it. The result selects the fixed `wsl --shutdown` command for WSL pending-restart state, while native Linux pending restart deliberately carries no command.

The recovery table now also contains `wslStartServiceNoSystemd` with the fixed `sudo service docker start` command. **Evidence-safety deviation:** the proposed design selected that command whenever `/run/systemd/system` was absent. Two options were considered: treat systemd absence as sufficient, or positively verify that a standard `service` executable is available. The latter was selected with greater than 80% confidence because systemd absence proves only which command will fail; it does not prove another service manager exists. `detectDockerServiceManager()` therefore returns `systemd`, `service`, or `unknown`, and WSL receives no service command when neither mechanism is positively detected. This keeps the recovery action aligned with the plan's positive-evidence rule.

Forty-nine focused probe, resolver, orchestration, and recovery-selection tests passed. Targeted ESLint and the root TypeScript build passed. The first focused run exposed only a heterogeneous `it.each` tuple inferring the empty path list as `never[]`; the test fixture was widened before commit. The root build later caught the new fixed command ID missing from the router clipboard enum; the typed enum was updated in the same work-item commit. No committed history was rewritten.

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `d79aa505`](https://github.com/microsoft/vscode-documentdb/commit/d79aa505fda4809b0ebb8180701cfda2fb97ed07). The orchestrator now returns before spawning Docker on unsupported hosts and returns immediately from `docker info` spawn `ENOENT`. It distinguishes a successfully enumerated but absent `DOCKER_CONTEXT` from a context probe that failed, diagnoses Windows-container mode while honestly retaining `daemonReachable: true`, consumes the WI-2 provider classifier, and persists live provider facts after successful info probes. `OperatingSystem` was added to the retained structured info facts so live Docker Desktop evidence is not inferred from platform.

Provider memory is stored under one global-state key with a seven-day maximum age. It is rejected and cleared on future timestamps, age expiry, environment mismatch, known endpoint-kind mismatch, an explicitly selected context that is positively absent, contradictory active-context provider evidence, explicit Refresh, and a `notAvailable` or `failed` launch result. Concurrent forced refresh callers now wait for any old probe set and share exactly one fresh run; normal callers, memoization, and the two-process happy path remain single-flight. Poll requests can suppress successful command echoes while still writing the failing probe command to the masked OutputChannel.

The broadened Local Quick Start check passed 131 probe, classifier, orchestration, provisioning, and presentation tests; the final orchestrator suite contains 40 tests. Targeted ESLint passed, editor diagnostics were clear, and the workspace package pre-build completed through the repository test script.

**Privacy-preserving context-memory deviation:** The plan says both that provider memory must contain only the listed fields and never a context name, and that it must be discarded when "the context the record describes" is deleted. Those requirements cannot both be implemented literally because the approved record has no context identity. Two options were considered: add and persist a context name, violating the explicit data-minimization contract, or keep the approved record and discard on every observable contradiction. The second option was selected with greater than 80% confidence. An absent explicit `DOCKER_CONTEXT`, endpoint-kind change, or active provider contradiction clears the record; a deleted implicit current context with the same endpoint kind cannot be identified until Refresh, expiry, or another contradiction. This residual limitation is visible and escapable because every state retains Refresh.

**Launcher ownership boundary:** Installed-application and user-service availability evidence is not collected in this commit. Two options were considered: duplicate filesystem/service paths in the orchestrator, or let WI-4's injected launcher own both path detection and launch revalidation. The latter was selected because the maintainability rules require executable and service paths to remain in the launcher, and the local Windows/macOS lower evidence bar cannot be applied safely until that owner exists.

**Corrections before commit:** The initial implementation treated every empty context list as positive absence evidence; it was corrected to carry whether the context probe and parse succeeded. The first forced-refresh implementation also returned an existing in-flight result before clearing memory; it was replaced with a dedicated forced-refresh single flight that queues behind the old check and runs once. No committed history was reset or rewritten.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the readiness service layout in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-3 commit.

### WI-4: Replace the launcher

- Move process launching out of `ContainerRuntime.ts`.
- Implement one named function per supported launch action.
- Select actions through an exhaustive switch, honoring the per-environment evidence bar.
- Await the exit code for short-lived launchers and return a precise `DockerLaunchResult`; reserve `launchAttempted` for detached GUI launches.
- Inject filesystem/process dependencies for unit tests.
- Refuse unavailable, stale, remote, or privilege-requiring actions.

#### Slice B implementation checkpoint (completed 2026-08-03)

Implemented and pushed in [commit `eb3c6828`](https://github.com/microsoft/vscode-documentdb/commit/eb3c6828b68d662998f2f3209e22fd6112fdfd79). `DockerProviderLauncher.ts` now owns every executable, application, and user-service path plus both capability selection and process launch. Local Windows and macOS may offer Desktop from the installed-application evidence bar unless positive Engine evidence contradicts it. Linux Desktop requires positive provider evidence and a loaded `docker-desktop.service`; rootless Engine requires a rootless endpoint and loaded `docker.service`. WSL requires positive Desktop evidence plus the mounted Windows executable. SSH, dev-container, Codespaces, other-remote, unsupported, root-managed Engine, and privilege-requiring cases receive no action.

Availability is rechecked immediately before launch. Windows and WSL GUI launches return `launchAttempted` only after the detached process emits `spawn`. macOS `open -a Docker` and Linux `systemctl --user start ...` are bounded, awaited, and map nonzero exits to `failed`; disappeared applications or services return `notAvailable`. No launcher uses a shell, invokes `sudo`, or starts a root-managed service.

Failure readiness now carries the capability selected by the launcher owner. The exported coordinator force-refreshes readiness, launches only the returned typed action, and passes `notAvailable`/`failed` back to the readiness service so remembered provider state is invalidated. Fifty-nine focused launcher and orchestrator tests passed, including the installed-application asymmetry, native WSL negative case, rootless versus root-managed Linux, remote refusal, launch revalidation, and typed result mapping. Targeted ESLint and the full root TypeScript build passed with no warnings.

**Temporary compatibility boundary:** The old `startDockerDesktop(): Promise<boolean>` export remains for the unchanged WI-5 router name, but it no longer selects by `process.platform` or launches anything directly. It delegates to the typed force-refresh coordinator and maps only `started`/`launchAttempted` to `true`. Two options were considered: change the router in the WI-4 commit, mixing work-item history, or retain a behavior-safe adapter for one commit. The adapter was selected so WI-4 stays independently buildable and WI-5 can record the public procedure rename and telemetry changes in its own commit. WI-5 must remove this adapter.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the launcher, launcher tests, and runtime imports in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-4 commit.

### WI-5: Update router and telemetry

- Return the enriched readiness result.
- Accept a `forceRefresh` input on the readiness query that bypasses the memo and clears the remembered provider record.
- Replace `startDockerDesktop` with `startDockerProvider`.
- Revalidate start capability on the extension host immediately before launch.
- Add a `continueAnyway` path that skips the gate for `indeterminate` outcomes only, and tag the resulting provision telemetry with that fact.
- Record only categorized readiness and launch outcomes, plus the copied recovery-command `id`.
- Record a redacted fingerprint for `unknown` classifications: lowercase the captured stderr, replace digits, paths, and hex runs with placeholders, truncate, and hash. This is what turns unclassified real-world failures into new rules instead of leaving the classifier frozen at whatever this plan imagined.
- Never record raw errors, executable paths, socket paths, context names, or environment variable values.

#### Slice B implementation checkpoint (completed 2026-08-03)

Implemented and pushed in [commit `149025d5`](https://github.com/microsoft/vscode-documentdb/commit/149025d5129e3064422530abd70599ee49640bb6). The public mutation is now `startDockerProvider` and returns `DockerLaunchResult`. It calls the WI-4 coordinator, which force-refreshes readiness and revalidates the selected action on the extension host immediately before launch. Launch telemetry records only `started`, `launchAttempted`, `notAvailable`, or `failed`. The temporary WI-4 boolean adapter and old router procedure were removed.

Readiness telemetry is produced by one pure projection containing only outcome, environment, endpoint kind, provider, provider evidence, failure kind, permission detail, start action, daemon OS type, and boolean readiness/continuation categories. The existing copied-command telemetry remains the fixed command ID only, and provisioning telemetry continues to record only whether the host-validated Continue anyway path was requested.

Unknown diagnostics now receive a host-side redacted fingerprint before the readiness result is serialized. The normalizer lowercases and replaces context names, endpoint URIs, Windows and Unix paths, host/lookup/dial values, IP addresses, DNS-like names, long hex runs, and digits; it collapses whitespace, truncates to 512 characters, hashes with SHA-256, and emits only the first 16 hexadecimal characters. Empty diagnostics produce no fingerprint, and diagnosed failures never emit one. Raw errors, paths, endpoint values, context names, and environment variable values are not telemetry properties.

Twenty-eight focused fingerprint, telemetry-projection, and direct tRPC caller tests passed. The caller test proves the renamed mutation returns and records a typed launch result. Targeted ESLint, editor diagnostics, and the full root TypeScript build passed.

**Contract-boundary choice:** The React call site was changed from `startDockerDesktop` to `startDockerProvider` in this work item, while its fixed five-second delay and presentation behavior remain for WI-6. Two options were considered: leave the client temporarily uncompilable until WI-6, or include the minimal generated-contract consumer rename with WI-5. The latter was selected because each work-item commit must build independently; no WI-6 presentation or polling behavior was pulled forward.

**Correction before commit:** The first direct router-test compile used a string literal for `dbExperience`; it was replaced with the repository's `API.DocumentDB` enum before commit. No committed history was reset or rewritten.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the router, telemetry projection, classifier fingerprint, and associated tests in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-5 commit.

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
- Return environment-aware guidance keys from the pure mapper, including the pending-session restart state; React only localizes and renders those keys.
- Render the mapper-selected recovery note beneath every copyable command.

#### Slice A implementation checkpoint (completed 2026-08-03)

Implemented the Slice A subset in [commit `e0f3251a`](https://github.com/microsoft/vscode-documentdb/commit/e0f3251a490671d1c6f7d9a5beb585cd23eb572b). A pure `getDockerReadinessPresentation()` mapper now owns semantic readiness states and action visibility. The not-ready view renders `Access denied`, `Not running`, `Check timed out`, or provider-neutral `Not accessible` instead of collapsing every failure to `Stopped`. It no longer selects behavior from `process.platform`, raw errors, or Docker error strings.

Every Slice A failure now exposes masked `View Docker output`, forced `Retry`, forced `Refresh`, and a `Last checked` label. Indeterminate outcomes alone expose `Continue anyway`; the provisioning service revalidates that the current result is still indeterminate, so a crafted webview request cannot bypass a diagnosed permission or daemon-unavailable failure. Fixed recovery commands are rendered as read-only code and copied through a host mutation that accepts only a typed command ID; the command line is never accepted from the webview, localized, or executed. Copy success and launch failure are announced accessibly.

The Docker Platform card now uses normalized `daemonArchitecture` and shows `Unknown until Docker is reachable` instead of substituting `process.arch`. The speculative registry/proxy advice was removed. Docker install and troubleshooting guidance is provider-neutral, with the Linux post-install guide selected for permission failures. The ready Review state also includes the always-present Refresh control.

The readiness query now accepts `forceRefresh`, links the tRPC abort signal into the host probe token, and records categorized failure telemetry. The webview cancels superseded readiness queries and aborts an outstanding query on unmount. Recovery-command telemetry records only the fixed command ID, and provisioning telemetry records only whether Continue anyway was requested.

Twelve pure presentation tests cover state/action mapping, including the Continue anyway and copy-command invariants. Two provisioning tests prove that explicit continuation bypasses only an indeterminate result and never a diagnosed result. The final focused run passed 55 presentation, orchestration, and provisioning tests; targeted ESLint and the TypeScript build passed. `npm run l10n` regenerated the localization bundle, and the added-line scan found no U+2014 or U+2013 characters after comment cleanup.

**Intentional Slice A launcher boundary:** The existing `startDockerDesktop` mutation and five-second post-launch delay remain only for local Windows and macOS, selected by the pure mapper. Linux, WSL, SSH, dev-container, and Codespaces states no longer receive that action. Two options were considered: remove the start action everywhere until WI-4, or preserve the existing behavior on the two local platforms that Slice A explicitly promises not to regress. Preserving it on Windows/macOS was selected because the Slice A delivery definition says those launch paths remain untouched. The provider-aware launcher, typed launch result, bounded polling, Docker-starting state, and Stop waiting control remain WI-4/WI-6 work for Slice B.

**Deliberately deferred WI-6 scope:** Provider-specific presentation beyond the Slice A local Desktop compatibility action, execution-target-aware Review copy, remote-session notices, remembered-provider labels, provider-start polling/backoff, and the Docker-starting state remain in Slice B. The `Last checked` label is computed when the readiness result renders; periodic relative-time updates are deferred with the remembered-provider UI because Slice A results are live or at most two seconds memoized.

**Corrections before commit:** The first combined host patch failed to match a test insertion context and applied no changes; it was split into smaller service and router edits. The initial punctuation scan command used unavailable `rg`, so the installed `grep` fallback was used. Added-line scans then found two pre-existing em dashes in comments whose surrounding blocks had been rewritten; both comments were changed to punctuation that also keeps the complete Slice A diff clean. No committed implementation was reset or rewritten.

#### Pending-session presentation checkpoint (completed 2026-08-03)

Implemented in [commit `4f363411`](https://github.com/microsoft/vscode-documentdb/commit/4f36341104b21c83fe9f83f9418ee4acd68f10d2). The pure mapper now returns `accessDeniedPendingRestart`, an environment-aware guidance key, and an optional recovery-note key. React contains no environment switch; it localizes those semantic keys through fixed lookup tables and renders the note beneath the command. Exact guidance now distinguishes native Linux sign-out, WSL shutdown from Windows, remote SSH server restart, and dev-container or Codespaces rebuild.

The WSL reporter state renders `Access denied`, explains that the group change is already configured but the session is stale, offers `wsl --shutdown`, and notes that the command restarts the distribution so membership applies. Unknown membership remains conservative: it retains the usermod command and environment-specific first-time guidance. Telemetry records only `permissionDetail`; no GID, group name, username, or path is emitted.

The focused end-to-end run passed 83 tests across probes, recovery selection, orchestration, presentation, and the unchanged classifier. Targeted ESLint and the root TypeScript build passed, localization added nine keys, and the added-line punctuation scan found no U+2014 or U+2013 characters. The first consolidated JSX patch applied only its usage hunks and left the old switch plus one duplicated line; inspection caught this before validation, and a follow-up working-tree edit completed the lookup declarations and removed the duplicate before the work-item commit. No committed history was rewritten.

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `aea5b048`](https://github.com/microsoft/vscode-documentdb/commit/aea5b048a7c924e1c78a6193d0f0ef55b084d2e9). The pure mapper now covers every Slice B state: identified Desktop unavailable, native daemon unavailable, starting, WSL integration unavailable, remote Docker unavailable, remote endpoint unreachable, invalid context, timeout, unsupported host, Windows-container mode, and the unknown fallback. It owns guide selection and maps only host-returned start actions to `Start Docker Desktop` or `Start Docker`; React no longer infers an action from environment. Installed-application evidence deliberately keeps provider-neutral failure wording while naming the application only on the button.

The fixed five-second delay was replaced with sequential, abortable polling under a 90-second launch deadline and 1/2/3/5-second backoff. Polls never overlap, the first command is echoed, later successful poll echoes are suppressed, and a failing probe remains visible in the masked output. Polling stops on readiness, non-transient diagnosis, deadline, Stop waiting, superseding action, or unmount. The starting state shows visible elapsed time and one polite state announcement; elapsed quarter-second updates are intentionally not live-region announcements.

Review copy now reports the typed execution target for local, WSL, SSH, dev-container, Codespaces, and other remote hosts. WSL and remote targets receive a visible pre-provisioning notice. Success copy no longer implies that a remote `localhost` endpoint is reachable from the user's local machine; it says the connection string is for tools running on the extension host. The daemon architecture card continues to use only normalized daemon facts.

Remembered provider evidence now carries `providerRecordedAtMs` separately from the current probe's `checkedAtMs`, so the relative Last checked label names when the provider fact was actually established. The label updates periodically and remains a polite status. Refresh remains present in every state, including ready and unsupported. Copy success, launch failure, Docker-starting, provisioning, and terminal outcomes retain accessible announcements.

Eighty-seven focused mapper, polling, and orchestrator tests passed. Targeted ESLint, editor diagnostics, the full TypeScript build, localization generation, and the development webview webpack build passed. The source and generated localization added-line scan found no U+2014 or U+2013 characters.

**Implementation choice:** Polling was extracted into a small injected helper rather than embedded entirely in the component. Two options were considered: manage timers and query overlap directly in JSX callbacks, or put deadline/backoff/cancellation sequencing behind a pure async boundary. The helper was selected because tests can prove one in-flight query, cancellation during backoff, transient versus terminal failures, echo suppression after the first poll, and deadline exit without mounting a VS Code webview.

**Corrections before commit:** The first mapper test table widened the WSL literal to `string`, and two exhaustive switches narrowed the whole readiness object to `never`; the tuple was frozen and the switches now narrow local discriminants. The first polling test spread a readiness union into an illegal fixture and was replaced with exact ready/diagnosed variants. React lint then caught `Date.now()` in a state initializer; the clock now initializes to zero and is set when readiness arrives. No committed history was reset or rewritten.

**Manual verification boundary:** This checkpoint validates behavior through focused tests, TypeScript, lint, localization, and webpack. Platform-specific visual and workflow verification is intentionally recorded under WI-9 rather than claimed here.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the React, mapper, polling, and test layout in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-6 commit.

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

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `8e0c0483`](https://github.com/microsoft/vscode-documentdb/commit/8e0c048339c16e10eb3b171f243cea8346d6edf0). A new integration-focused service suite combines the boundaries that isolated unit tests could not: a native WSL unix-socket permission failure remains `permissionDenied` with no Desktop action even when the Windows Desktop executable is visible, and an SSH extension host on an arm64 client reports its reachable remote daemon as normalized `amd64` with the `ssh` execution target.

Additional regressions now prove that caller cancellation rejects instead of becoming a timeout category, probe runner options omit `stdInPipe`, cancellation during an active poll query drops the late result, remembered evidence selects `providerRecordedAtMs` instead of the current probe time, and live evidence selects `checkedAtMs`. Existing tests already covered rejected stdout/stderr capture, zero-exit `ServerErrors`, every provider-memory discard rule, forced Refresh, launch selection/revalidation, single flight, memo TTL, every presentation state, Continue anyway gating, and polling success/deadline/non-overlap.

The complete Local Quick Start test set passed all 15 suites and 227 tests. Targeted ESLint, editor diagnostics, and the full root TypeScript build passed.

**Testability choice:** The command-runner options used by `runDockerProbe()` are now built by an exported pure helper so the stdin omission can be asserted without spawning an SSH process or monkey-patching processutils. The relative-time source selection was similarly extracted from JSX into a pure selector. Both production call sites use the helpers, so the tests cover the exact behavior rather than parallel test-only logic.

**Corrections before commit:** The first cancellation assertion depended on `vscode.CancellationError`, which `jest-mock-vscode` does not implement, and the first stdin test tried to spy on a non-configurable processutils barrel export. The cancellation test now asserts rejection plus cancellation of both probes without relying on the missing mock class, and the stdin test inspects the production runner-options helper. No committed history was reset or rewritten.

**WI-8 boundary:** Daemon disappearance during pull/run and the dev-container published-port explanation are not counted as WI-7 coverage. They require provisioning-path behavior that did not yet exist and remain explicitly assigned to WI-8.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the integration, polling, presentation, and probe test layout in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-7 commit.

### WI-8: Reuse the classifier on the provisioning path

The readiness gate is a snapshot, and the daemon can disappear between the gate and the first `docker pull`. A Docker Desktop auto-update three seconds after the check produces `error during connect: … The system cannot find the file specified`, which today lands in the failure card as a raw string with none of the recovery UI this plan builds.

- Route daemon-class failures raised during pull and run through the same classifier.
- Render the same recovery card, including start action, recovery command, and `View Docker output`.
- Keep registry- and image-specific classification out of scope; only daemon-class failures are in this work item.
- When a readiness timeout follows a successful `docker run` in a dev-container session, add the published-port explanation: the daemon may be the host's, so the container's published port is not necessarily reachable from inside the dev container.

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `77c4bfed`](https://github.com/microsoft/vscode-documentdb/commit/77c4bfede508af9bd20719030f9beb2b6a6f3d6d). Provisioning now tracks only the active `docker pull` and `docker run` stages. If either operation fails, it performs one forced, bounded readiness check through the existing `DockerReadinessService`. A non-ready result is attached to the terminal `StageEvent` and React returns to the same readiness recovery screen, preserving provider start, copyable recovery command, Retry/Refresh, Continue anyway when indeterminate, details, and masked Docker output. The raw operation error is replaced with localized provider-neutral copy in this branch.

If the forced recheck says Docker is ready, the event carries no readiness result and the original provisioning error remains visible. This keeps manifest, registry, proxy, image, and other non-daemon failures out of readiness classification. Provision telemetry records only the categorized Docker failure kind or `none`.

A dev-container readiness timeout after a successful run now appends a localized explanation that Docker may be on the dev-container host, so the published localhost port might not be reachable from inside the dev container. The existing timed-out event carries that message, and the failed view renders it instead of replacing it with generic timeout copy.

Focused tests cover daemon disappearance during both pull and run, preservation of a manifest error when Docker remains ready, and environment-selective dev-container timeout guidance. The complete Local Quick Start set passed all 15 suites and 231 tests. Targeted ESLint, editor diagnostics, localization generation, the source/localization punctuation scan, and the full root TypeScript build passed.

**Classification-path implementation choice:** Two options were considered: retrofit pull/run execution to tee and classify each operation's rejected stderr directly, or re-run the established bounded readiness probes after an operation failure. The second option was selected with greater than 80% confidence. It keeps one evidence collector and one classifier owner, obtains endpoint errno and structured `ServerErrors` rather than relying on operation text, distinguishes a daemon that recovered from a real image error, honors single-flight/deadline behavior, and keeps raw pull/run output in the masked OutputChannel. The tradeoff is one extra bounded probe set after a failed pull or run.

**Corrections before commit:** The first full build found an unused `DockerReadiness` import after event narrowing made an explicit cast unnecessary; the import was removed before commit. No committed history was reset or rewritten.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the provisioning service and React event-consumer layout in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-8 commit.

### WI-9: Build a fixture corpus and manual verification pass

Every test above feeds the classifier text that the implementer wrote, which validates the classifier against its own assumptions. The fragile input is real CLI output, and the readiness gap notes record that macOS and Linux were never verified at all.

- Add `__fixtures__/docker/<os>-<dockerVersion>-<case>.txt` files holding real captured stdout and stderr, each with a provenance comment naming the OS, Docker version, and provider.
- Table-drive the classifier tests from those files rather than from inline strings.
- Record a short manual verification checklist covering, at minimum: Windows with Desktop stopped, macOS with Desktop stopped, native Ubuntu without `docker` group membership, native Ubuntu with the service stopped, and WSL with and without Desktop integration.
- Treat a new Docker version that breaks a signature as a fixture addition, not a rewrite.

#### Slice B implementation checkpoint (completed 2026-08-03)

The verified fixture corpus is implemented and pushed in [commit `c1876d20`](https://github.com/microsoft/vscode-documentdb/commit/c1876d20b6de95ca826f86061cbccb85876d9532). The historical reporter capture is now named `wsl2-ubuntu20.04-docker28.1.1-permission-denied.txt` and carries its confirmed WSL2, Ubuntu, Docker Engine, socket-GID, and permission provenance. A second fixture, `wsl2-ubuntu20.04-docker28.1.1-ready-info.txt`, comes from a live `docker info --format {{json .}}` capture on 2026-08-03. It stores the exact structured subset consumed by the implementation and explicitly discloses that machine ID, hostname, paths, counts, timestamps, and resource values were omitted.

The permission classifier, raw info parser, architecture normalizer, and live Engine provider classifier now consume those files. Both fixture-focused suites passed 43 tests; the complete Local Quick Start set passed all 15 suites and 232 tests. Targeted ESLint and the full root TypeScript build passed.

##### Manual verification checklist

| Scenario                                               | Status                                                      | Evidence and remaining action                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows with Docker Desktop stopped                    | **Not run**                                                 | No Windows extension host is available in this workspace. Verify the installed-application action on the default npipe context, launch result, starting poll, and ready transition on Windows.                                                                                                                                                                                                                     |
| macOS with Docker Desktop stopped                      | **Not run**                                                 | No macOS extension host is available. Verify `open -a Docker`, nonzero launch handling, starting poll, and ready transition on macOS.                                                                                                                                                                                                                                                                              |
| Native Ubuntu without `docker` group membership        | **Not run on native Linux**                                 | The real permission capture is WSL2 rather than native Ubuntu. Automated endpoint/classifier/presentation tests cover native Linux, but a native host must verify the panel and sign-out guidance.                                                                                                                                                                                                                 |
| Native Ubuntu with Docker service stopped              | **Not run**                                                 | Stopping a host service would disrupt the operator environment and may require elevation. Verify `Not running`, the copy-only service command, no privileged automatic launch, and recovery after the operator starts the service.                                                                                                                                                                                 |
| WSL using Docker Desktop integration                   | **Not run**                                                 | Docker Desktop is installed on Windows, but the active WSL endpoint is native Engine. A Desktop-integrated distribution must verify integration-unavailable and Desktop-start paths.                                                                                                                                                                                                                               |
| WSL using native Docker Engine, Desktop also installed | **Live host facts verified; panel automation covered**      | On 2026-08-03: WSL2 Ubuntu 20.04, Docker Engine 28.1.1, `/var/run/docker.sock`, systemd active, daemon OS Ubuntu 20.04.6 LTS, daemon architecture `x86_64`, and the Windows Desktop executable present. The process now includes socket GID 998. Integration tests prove this evidence yields Engine/WSL/`amd64` and no Desktop action. An interactive panel inspection was not available from this agent session. |
| WSL permission denied before the new session           | **Historically captured and operator-confirmed in Slice A** | The fixture preserves the real `EACCES` output. The operator previously confirmed the panel's `pendingSessionRestart` guidance. The destructive `wsl --shutdown` and reconnect sequence remains unverified, as recorded in the Slice A summary.                                                                                                                                                                    |

**Corpus-scope deviation:** The plan asks for real fixtures across operating systems and failure modes, but this workspace provides only WSL2 with native Docker Engine plus the historical WSL permission capture. Three options were considered: invent representative outputs, copy unattributed text from documentation, or commit only verified captures and leave an explicit acquisition checklist. The third option was selected with greater than 80% confidence because classifier fixtures are evidence, and fabricated provenance would make the test suite less trustworthy. New Windows, macOS, native Ubuntu stopped-service, and WSL Desktop captures must be added as new files when those environments are available.

**Manual-pass safety deviation:** The agent did not stop the active Docker service, remove group access, run `sudo`, launch/stop Docker Desktop on the operator's machine, or execute `wsl --shutdown`. Those actions would disrupt the current session, require elevation, or need unavailable platforms. The safe alternatives were automated injected-dependency tests plus command-level inspection of the existing host. The unrun rows above are the operator handoff and are not claimed as acceptance successes.

**Follow-up formatting correction:** The required repository-wide Prettier pass normalized the real-fixture consumer tests in [commit `478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687). This commit is mechanical only and preserves the original WI-9 commit and fixture contents.

### WI-10: Update documentation

- Replace statements that imply Docker Desktop is universally required.
- Document Docker Engine and Docker Desktop as supported provider choices.
- Document Linux group/session restart and WSL integration guidance.
- Keep multi-step setup procedures in linked documentation. The card carries at most the single copyable command from the recovery-command table; it never becomes a shell tutorial.

#### Slice B implementation checkpoint (completed 2026-08-03)

Completed and pushed in [commit `6117a83a`](https://github.com/microsoft/vscode-documentdb/commit/6117a83a0cf74e7e35c2a6337ff31f1a17557e44). The new [DocumentDB Local Quick Start user guide](../../../../../user-manual/local-quick-start.md) documents Docker Engine and Docker Desktop as supported provider choices, the extension-host execution target, the no-install/no-silent-start/no-elevation rules, starting Quick Start, readiness cards, Refresh, masked output, Linux/WSL group recovery, native service recovery, rootless launch limits, WSL Desktop integration, context/remote endpoint recovery, Linux-container mode, provisioning-time Docker recovery, and dev-container published-port behavior.

The local-connection overview, DocumentDB Local manual page, user-manual index, and repository README now link to the guide and distinguish container management from connecting to an already-running instance. The v2 design reference has a prominent supersession note and its normative prerequisite table, Docker-not-ready mockup, and cross-cutting launch rule are provider-neutral rather than Desktop-only.

All six documentation surfaces pass Prettier and whitespace checks. New local documentation links were checked for existing targets. The new guide contains no standalone product use of `MongoDB`, no U+2014/U+2013 characters, and no speculative proxy/registry prerequisite advice.

**Historical-design choice:** Two options were considered for old Desktop-only design material: rewrite every historical iteration and readiness-gap record as if it had always described the final behavior, or preserve history while correcting the authoritative v2 rules and adding an explicit supersession link. The second option was selected because the earlier documents explain past implementation decisions and Slice A boundaries; erasing those statements would make the repository's design history misleading. The user manual and current implementation plan are the authoritative operational guidance.

## Required Test Matrix

| Scenario                                                                     | Expected failure/provider                         | Expected action                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| CLI absent on Linux                                                          | `cliMissing` / `unknown`                          | Linux install guide                                                           |
| Native Ubuntu daemon reachable                                               | Ready / `dockerEngine`                            | None                                                                          |
| Native Ubuntu socket returns `EACCES`                                        | `permissionDenied` / `dockerEngine` or `unknown`  | `Copy command` for the group fix, plus Linux setup guide                      |
| Native Linux user is configured in the socket group but the process is stale | `permissionDenied`, `pendingSessionRestart`       | Sign out of the desktop session and sign back in; never suggest Reload Window |
| WSL user is configured in the socket group but the process is stale          | `permissionDenied`, `pendingSessionRestart`       | Copy `wsl --shutdown` for Windows, then reopen the folder                     |
| Socket-group membership cannot be established                                | `permissionDenied`, `unknown`                     | Conservative usermod command and environment-specific login guidance          |
| WSL daemon stopped, systemd absent, service wrapper present                  | `daemonUnavailable`                               | Copy `sudo service docker start`                                              |
| Native Ubuntu daemon stopped                                                 | `daemonUnavailable` / `dockerEngine` or `unknown` | Service guide and copyable service command, no auto start                     |
| Native rootless Ubuntu user service stopped                                  | `daemonUnavailable` / `dockerEngine`              | Start Docker                                                                  |
| WSL native socket permission denied while Windows Desktop is installed       | `permissionDenied` / native endpoint              | Linux/WSL setup guide, no Desktop button                                      |
| WSL Desktop integration endpoint unavailable                                 | `daemonUnavailable` / `dockerDesktop`             | Start Desktop on Windows or WSL integration guide                             |
| Local Windows Desktop stopped                                                | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                                          |
| Local Windows Desktop stopped on the `default` npipe context                 | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop from the installed-application bar                       |
| Local macOS Desktop stopped                                                  | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                                          |
| Linux Docker Desktop user service stopped                                    | `daemonUnavailable` / `dockerDesktop`             | Start Docker Desktop                                                          |
| Invalid Docker context                                                       | `contextUnavailable`                              | Context guide                                                                 |
| Windows daemon reports Windows containers                                    | `windowsContainers`                               | Linux-container guidance                                                      |
| SSH remote with no daemon                                                    | `daemonUnavailable` / `unknown`                   | Remote Docker guide, no local launch                                          |
| Unknown nonzero `docker info` error                                          | `unknown`, `indeterminate`                        | Show details, Retry, Continue anyway                                          |
| `docker info` never responds                                                 | `probeTimedOut`, `indeterminate`                  | View Docker output, Retry, Continue anyway                                    |
| Deadline expires while a Desktop launch is in flight                         | `daemonStarting`                                  | Keep waiting with elapsed time and a Stop waiting control                     |
| `DOCKER_HOST=tcp://<unreachable>:2375`                                       | `endpointUnreachable`                             | Show details naming the `DOCKER_HOST` source                                  |
| `DOCKER_HOST=ssh://<host>` prompting for a passphrase                        | Probe fails fast, never hangs                     | Show details naming the `DOCKER_HOST` source                                  |
| `docker info` exits zero but the body carries `ServerErrors`                 | Classified as a daemon failure, not ready         | Matching recovery card                                                        |
| Readiness query is canceled                                                  | Cancellation, not a failure category              | Stop probes and render no stale error                                         |
| Two callers request readiness at once                                        | One probe set runs                                | Both receive the same result                                                  |
| Remembered Desktop record, Desktop since uninstalled                         | Launch reports `notAvailable`, record discarded   | Next check is provider-neutral, not a repeated Desktop claim                  |
| Remembered record older than the maximum age                                 | Record ignored                                    | Provider-neutral guidance plus `Last checked` label                           |
| Remembered record whose context no longer exists                             | Record discarded                                  | Provider-neutral guidance                                                     |
| User presses `Refresh` in any state                                          | Memo and remembered record cleared                | All checks rerun and the `Last checked` label updates                         |
| Unsupported Node extension-host platform                                     | `unsupportedHost` / `unknown`                     | Learn more, no Docker launch                                                  |
| SSH extension host with reachable remote amd64 daemon on arm64 client        | Ready / daemon architecture `amd64`               | Show remote target, daemon architecture, remote-endpoint note                 |
| WSL extension host with reachable native daemon                              | Ready / `dockerEngine`                            | Show WSL execution-target notice                                              |
| Daemon disappears between the gate and `docker pull`                         | Same daemon-class failure as readiness            | Same recovery card, not a raw error string                                    |
| Dev container: run succeeds, readiness probe times out                       | Readiness timeout plus published-port explanation | Existing timeout recovery actions                                             |

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
25. A user who runs the offered group command and returns to the panel is told the exact next session action for Linux, WSL, SSH, or a container; Linux is never told that Reload Window is sufficient.
26. The repository completion checks pass in order:
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

#### Slice A executive summary (completed 2026-08-03)

Slice A is implemented and pushed. Probe evidence capture is in [`d832ebc1`](https://github.com/microsoft/vscode-documentdb/commit/d832ebc149a060152b517ff4a15c965448f6f0f3), pure failure classification is in [`8d0cb52d`](https://github.com/microsoft/vscode-documentdb/commit/8d0cb52da7ce5ab53b44732136a6fb8de083eb6c), bounded readiness orchestration is in [`e076243a`](https://github.com/microsoft/vscode-documentdb/commit/e076243a72c6585b21ccf3a80dff90c145084d2f), and the actionable webview/recovery flow is in [`e0f3251a`](https://github.com/microsoft/vscode-documentdb/commit/e0f3251a490671d1c6f7d9a5beb585cd23eb572b). Repository-wide formatting corrections are intentionally preserved as the follow-up commit [`4265d8f3`](https://github.com/microsoft/vscode-documentdb/commit/4265d8f3b732d0e0e963e3e495c57812c2c2cf75).

The pending-session refinement is in [`8a7780c3`](https://github.com/microsoft/vscode-documentdb/commit/8a7780c341fa271e7d3ec39e1494c93f4cdf073c) for host facts and recovery selection, and [`4f363411`](https://github.com/microsoft/vscode-documentdb/commit/4f36341104b21c83fe9f83f9418ee4acd68f10d2) for environment-aware presentation, telemetry, localization, and confirmed fixture provenance. It resolves the post-usermod Retry loop without adding a failure kind or changing classifier precedence.

The reported Ubuntu and WSL socket-permission failure now reaches the UI as `Access denied` from endpoint `EACCES` evidence. Rejected Docker probes retain stdout and stderr, structured `ServerErrors` are honored, and readiness is bounded by one cancellation deadline with single-flight and short memoization. The UI offers the fixed group-membership command as copy-only text, never executes it, exposes masked Docker output for every failure, and keeps forced Retry/Refresh controls. Unknown and timed-out results are indeterminate and alone may use `Continue anyway`; provisioning revalidates that invariant on the extension host.

Linux, WSL, and remote environments no longer receive the unconditional Docker Desktop start action. Existing local Windows/macOS launch behavior is deliberately retained until Slice B replaces it with provider-aware launch selection. The Platform card now reports normalized daemon architecture when known and otherwise says it is unknown until Docker is reachable. All added or changed user-facing strings are localized, and the final added-line scan contains no U+2014 or U+2013 characters.

The main Slice A deviation is the shared-deadline cancellation implementation: it uses `AbortController` plus processutils' `CancellationTokenLike.fromAbortSignal()` instead of `vscode.CancellationTokenSource`. The pending-session refinement adds one evidence-safety deviation: WSL receives `sudo service docker start` only when the service wrapper is positively detected, not merely when systemd is absent. The alternatives and rationale are documented in WI-3. The fixture provenance gap is closed with the confirmed reporter facts. No correction rewrote an existing commit.

The required completion sequence after the pending-session refinement passed in order: localization generation, repository-wide Prettier, repository-wide ESLint, all 194 Jest suites (3,181 tests and 4 snapshots), and the root TypeScript build. ESLint emitted only the existing flat-config migration warning for `webpack.config.views.js`. The classifier implementation remained unchanged, and the final refinement source/localization added-line scan contains no U+2014 or U+2013 characters.

**Manual verification status:** During final implementation checks the machine temporarily represented the `notInGroup` case. The operator then ran the group fix again, restoring the target condition: `id -G` omits socket GID 998 while `id -G "$USER"` and `getent group 998` include it. The operator confirmed that the panel correctly detects `pendingSessionRestart` and renders the WSL guidance. The destructive `wsl --shutdown`, disconnect, and reopen sequence has not yet been completed or claimed as verified.

#### Post-Slice A add-on: better session reset and restart guidance

This add-on was completed after Slice A testing exposed a Retry loop for users who had already run the group-membership fix. Host evidence and recovery selection are implemented in [`8a7780c3`](https://github.com/microsoft/vscode-documentdb/commit/8a7780c341fa271e7d3ec39e1494c93f4cdf073c); environment-aware presentation, telemetry, localization, and fixture provenance are implemented in [`4f363411`](https://github.com/microsoft/vscode-documentdb/commit/4f36341104b21c83fe9f83f9418ee4acd68f10d2). The detailed work-item records are in the WI-3 and WI-6 pending-session checkpoints above.

The add-on keeps `permissionDenied` as the failure kind and adds `permissionDetail` as refining evidence. A unix-socket permission failure now distinguishes a user who still needs the group fix from a user whose configured membership is waiting on a new process session. The latter receives the exact action for the extension-host environment: desktop sign-out and sign-in on native Linux, `wsl --shutdown` from Windows for WSL, killing the remote VS Code server for SSH, or rebuilding a dev container or Codespaces container. Reload Window is never presented as sufficient for a stale native-Linux session.

Recovery commands remain fixed, copy-only, and never executed. WSL daemon recovery uses `sudo systemctl start docker` only with active systemd and `sudo service docker start` only when the service wrapper is positively detected. This is intentionally stricter than selecting the service command from systemd absence alone. The add-on passed the full completion sequence with 194 Jest suites and 3,181 tests; the destructive WSL shutdown verification remains pending for an operator session that again satisfies the captured pending-restart precondition.

Testing produced one wording correction in [`08832118`](https://github.com/microsoft/vscode-documentdb/commit/08832118dfa39b056bcb4c01b4ee642a0d457522). The WSL pending-restart guidance now says to run `wsl --shutdown` in a Windows terminal, warns that the current VS Code WSL window will disconnect, and instructs the user to reopen the folder in WSL. Restarting the local VS Code application is not required. The recovery note also accurately says that the command stops all running WSL distributions; WSL starts again when the user reconnects.

The full suite after that wording change exposed a test-isolation mistake: one orchestration test used the default socket-group probe, so changing the operator machine from `notInGroup` to `pendingSessionRestart` changed the test's expected recovery command. [`1522cdab`](https://github.com/microsoft/vscode-documentdb/commit/1522cdab2b1ac394615995c15bec5291e292bf2b) injects explicit unknown group facts into tests that are not testing group refinement. Production behavior is unchanged, and the service suite is now deterministic across operator group changes.

### Slice B: complete the model

Provider classification and provider memory, the evidence bar and launch matrix (WI-4), router and telemetry (WI-5), the remaining presentation states and execution-target copy (WI-6), the full integration test set (WI-7), provisioning reuse (WI-8), fixtures and manual verification (WI-9), and documentation (WI-10).

Keep each work item independently testable, and do not expose partially classified states in the UI.

The first executable behavior check should be the Linux/WSL permission-denied classifier test, driven by a real captured fixture. It directly reproduces the reported failure and will disconfirm the implementation if it still falls through to `daemonUnavailable` or Docker Desktop guidance. Write it before WI-0 is complete: with today's code it fails because the evidence is missing, which is the point.

#### Slice B executive summary (completed 2026-08-03)

Slice B is implemented and pushed. Typed readiness contracts are in [`d6254c1c`](https://github.com/microsoft/vscode-documentdb/commit/d6254c1cd1f30b099b817addee3a36b0f4657140), with the reachable-diagnosed-daemon correction preserved separately in [`0720fbe4`](https://github.com/microsoft/vscode-documentdb/commit/0720fbe4eebd3deee9b008cce4c4c2fd3dd57fb3). Pure failure/provider classification is in [`54e13d9d`](https://github.com/microsoft/vscode-documentdb/commit/54e13d9dfb1d6bd818d200c16262a2d494b01ee6), provider memory and orchestration are in [`d79aa505`](https://github.com/microsoft/vscode-documentdb/commit/d79aa505fda4809b0ebb8180701cfda2fb97ed07), and the provider-aware launcher is in [`eb3c6828`](https://github.com/microsoft/vscode-documentdb/commit/eb3c6828b68d662998f2f3209e22fd6112fdfd79).

The typed tRPC launch contract and categorized/redacted telemetry are in [`149025d5`](https://github.com/microsoft/vscode-documentdb/commit/149025d5129e3064422530abd70599ee49640bb6). The complete webview state model, provider-start polling, remembered timestamps, execution-target copy, remote notices, and accessibility updates are in [`aea5b048`](https://github.com/microsoft/vscode-documentdb/commit/aea5b048a7c924e1c78a6193d0f0ef55b084d2e9). Integration-focused coverage is in [`8e0c0483`](https://github.com/microsoft/vscode-documentdb/commit/8e0c048339c16e10eb3b171f243cea8346d6edf0), provisioning-time readiness reuse is in [`77c4bfed`](https://github.com/microsoft/vscode-documentdb/commit/77c4bfede508af9bd20719030f9beb2b6a6f3d6d), verified fixtures are in [`c1876d20`](https://github.com/microsoft/vscode-documentdb/commit/c1876d20b6de95ca826f86061cbccb85876d9532), and user documentation is in [`6117a83a`](https://github.com/microsoft/vscode-documentdb/commit/6117a83a0cf74e7e35c2a6337ff31f1a17557e44). The required final repository-wide formatting correction is intentionally preserved in [`478cb836`](https://github.com/microsoft/vscode-documentdb/commit/478cb83625cac5bf7678b4899a7a89e65478d687), not folded back into any work-item commit.

The completed flow now distinguishes CLI absence, endpoint permission, native daemon availability, context failure, remote endpoint reachability, provider startup, timeout, unsupported hosts, Windows-container mode, and unknown failures. Docker Desktop is named as a cause only from positive live, context, or remembered evidence; the lower installed-application evidence bar can name only the launch button on local Windows/macOS. Native Engine, rootless Engine, WSL, and remote launch behavior follow the documented evidence matrix. Provider memory is time-limited, visibly dated, contradicted aggressively, and cleared by Refresh or failed launch.

The webview renders every semantic recovery state, fixed copy-only commands, masked output access, indeterminate-only Continue anyway, and an always-present Refresh. Provider startup uses cancelable sequential backoff without overlapping probes. Review and success copy distinguish local, WSL, SSH, dev-container, Codespaces, and other remote extension hosts, and daemon architecture is never inferred from `process.arch`. Pull/run daemon failures return to the same readiness recovery UI, while ready-daemon image failures stay on the provisioning path.

The principal Slice B deviations are deliberate and documented inline: provider memory does not persist context names, so an implicitly deleted same-kind context cannot be identified until another contradiction, expiry, or Refresh; installed-application and service-path evidence lives in the launcher rather than the orchestrator; provisioning re-runs the bounded readiness probes after pull/run failure instead of classifying raw operation text; and the fixture corpus contains only verified WSL captures rather than fabricated Windows/macOS/native-Linux outputs. The Slice A cancellation adapter and stricter WSL service-wrapper evidence remain unchanged.

The required completion sequence passed in order after the final plan commit: localization generation, repository-wide Prettier, repository-wide ESLint, all 199 Jest suites (3,267 tests and 4 snapshots), and the root TypeScript build. ESLint emitted only the existing flat-config migration warning for `webpack.config.views.js`. An earlier full Jest pass reported one worker that required forced exit after all tests passed; the definitive post-summary run completed with the same passing counts and did not reproduce that warning.

**Manual verification handoff:** The live WSL2 Ubuntu 20.04 native-Engine setup was command-verified with Docker Engine 28.1.1, a reachable `amd64` daemon, active systemd service, socket-group membership, and a coexisting Windows Docker Desktop installation. Windows Desktop stopped, macOS Desktop stopped, native Ubuntu group/service failures, WSL Desktop integration, interactive panel inspection, and the destructive `wsl --shutdown` reconnect remain explicitly unverified. WI-9 records the prerequisites and expected outcomes for each operator-run scenario; none is claimed as passed.

#### Slice B review remediation executive summary (completed 2026-08-03)

The post-implementation review findings selected for this PR are complete in eleven dedicated commits. Provider memory now survives polling, Retry, and pre-launch revalidation while explicit Refresh retains its reset behavior ([`4e37f886`](https://github.com/microsoft/vscode-documentdb/commit/4e37f8863ad0c5661e578b872791d365952b3755)). Provisioning reroutes only positively diagnosed Docker failures and preserves the original operation error ([`214ae1f1`](https://github.com/microsoft/vscode-documentdb/commit/214ae1f1e97ddd8921f017069ad73b535ec847d1)). Successful poll transcripts and poll telemetry are suppressed while failed transcripts remain available ([`d6acaeee`](https://github.com/microsoft/vscode-documentdb/commit/d6acaeeead1224f557dc3638e4d7994b720c0534), [`216abf4b`](https://github.com/microsoft/vscode-documentdb/commit/216abf4b2afa30cbcf019aeca779d340e7c9e39d)).

Architecture compatibility is advisory and visible again on both readiness surfaces ([`ff07f2c8`](https://github.com/microsoft/vscode-documentdb/commit/ff07f2c8300066d71385c15340a39bdfc14306e8)). The panel now shows localized typed diagnostic facts while raw failure and timeout traces go to the Quick Start output channel ([`92b12e82`](https://github.com/microsoft/vscode-documentdb/commit/92b12e8265d5c90916816573dcd7dcef42c92eb1), [`ac83f088`](https://github.com/microsoft/vscode-documentdb/commit/ac83f0881034f91e223bc6eceafcbf87f63eb2a4)). Decorative status glyphs are hidden from assistive technology ([`68b79bef`](https://github.com/microsoft/vscode-documentdb/commit/68b79beffa705ae8dbfd509cba3d125a83900c77)), the missing-CLI state has a primary install action and no dead Refresh flag ([`ed7a1c61`](https://github.com/microsoft/vscode-documentdb/commit/ed7a1c6153c1751576fe1fd70a51aed2bb930e99)), the obsolete readiness error field is removed ([`c2278a24`](https://github.com/microsoft/vscode-documentdb/commit/c2278a245ae5455c6be7ef82df0ad40a13a8f681)), and CLI presence is derived from direct probe evidence rather than failure classification ([`33843404`](https://github.com/microsoft/vscode-documentdb/commit/338434043d8f0162cc307ad1fc0cb9c87f03c74e)).

Two implementation-level deviations were selected with high confidence and disclosed in the review record and PR comments. F-03 reuses stdout/stderr already captured in `DockerProbeEvidence` instead of adding a duplicate writable buffer; this preserves failure-only transcript behavior with less stream state. F-14 uses successful version evidence or a non-`ENOENT` info spawn instead of the plan's literal classification-based fallback, because the literal expression was equivalent to the old value in that branch and did not remove the identified coupling. A focused F-02 test fixture was corrected before its work-item commit after it initially returned the post-failure result during preflight. No existing commit was amended, reordered, or rewritten.

The operator-approved validation cadence used focused tests and checks per work item, broader checks for cross-layer changes, and one definitive final repository pass. The final sequence passed in order: localization generation, repository-wide Prettier, repository-wide ESLint, all 199 Jest suites (3,278 tests and 4 snapshots), and the root TypeScript build. ESLint emitted only the existing flat-config migration warning for `webpack.config.views.js`. F-06, F-10, F-11, and F-15 remain follow-up issues as planned; F-16 remains no-squash with no history rewrite.
