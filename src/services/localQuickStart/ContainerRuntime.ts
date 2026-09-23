/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Thin wrapper over `@microsoft/vscode-container-client` (Docker) for the Local
 * Quick Start POC (WI-0).
 *
 * - All runtime stdout/stderr/command lines are routed through a single
 *   {@link MaskedChannelWritable} that **line-buffers** and **redacts secrets**
 *   before writing to the "DocumentDB Local Setup" OutputChannel (D14):
 *   the generated password must never reach the channel, even when a stream
 *   chunk splits it across a buffer boundary. Inspect stdout is the exception:
 *   it carries the container env, so it is not echoed at all.
 * - `docker run` is detached (D4); because a detached run streams nothing back,
 *   {@link ContainerRuntime.followLogs} streams `docker logs -f` so the channel
 *   isn't silent during the readiness wait.
 * - Credentials reach the container through a temp `--env-file`, never argv.
 */

import {
    DockerClient,
    type InspectContainersItem,
    type Like,
    type ListContainersItem,
    ShellStreamCommandRunnerFactory,
} from '@microsoft/vscode-container-client';
import { type Shell, type ShellQuotedString, ShellQuoting } from '@microsoft/vscode-processutils';
import * as net from 'net';
import { Writable } from 'stream';
import * as vscode from 'vscode';
import { type DockerCommandResponse, getDockerShellProvider, runDockerCommand } from './dockerCommand';
import { CapturingTeeWritable } from './dockerProbes';
import { startDockerProvider as launchDockerProvider } from './DockerProviderLauncher';
import { DockerReadinessService } from './DockerReadinessService';
import { MaskingLineBuffer, maskSecrets, sanitizeOutput } from './outputMasking';
import {
    type DockerLaunchResult,
    type DockerReadiness,
    type DockerReadinessRequest,
    QUICK_START_PORT,
} from './quickStartTypes';

/**
 * Shell used to run docker commands. A shell provider is REQUIRED so the runner
 * applies each argument's quoting metadata: without one it sets
 * `windowsVerbatimArguments` on Windows and drops quoting, which splits Go-template
 * `--format {{json .}}` arguments on the space and breaks info/inspect/list.
 */
const SHELL_PROVIDER: Shell = getDockerShellProvider();

/**
 * `docker run -d` normally returns within seconds; on Docker Desktop some ports make it hang forever
 * (65535 on WSL2), so bound it rather than leave setup at "Creating container".
 */
export const CREATE_CONTAINER_TIMEOUT_MS = 90_000;

/** Bound for the status reads polled while the user waits, so a hung daemon cannot stall the wait. */
const POLLED_QUERY_TIMEOUT_MS = 10_000;

/**
 * Bound for start/stop/remove and the container listing. Setup's cleanup runs these right after a
 * `docker run` timed out, against the same daemon; unbounded, setup would never report that timeout.
 */
const DOCKER_COMMAND_TIMEOUT_MS = 60_000;

let outputChannel: vscode.OutputChannel | undefined;

/** Lazily create the shared OutputChannel. */
export function getQuickStartOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('DocumentDB Local Setup');
    }
    return outputChannel;
}

export function disposeQuickStartOutputChannel(): void {
    outputChannel?.dispose();
    outputChannel = undefined;
}

/**
 * Writable that line-buffers incoming chunks and masks each complete line
 * before appending it to the OutputChannel (delegates to {@link MaskingLineBuffer}).
 */
class MaskedChannelWritable extends Writable {
    private readonly lineBuffer: MaskingLineBuffer;

    constructor(channel: vscode.OutputChannel, secrets: ReadonlyArray<string>) {
        super();
        this.lineBuffer = new MaskingLineBuffer((line) => channel.appendLine(line), secrets);
    }

    public override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.lineBuffer.push(String(chunk));
        callback();
    }

    public override _final(callback: (error?: Error | null) => void): void {
        this.lineBuffer.flush();
        callback();
    }
}

export interface CreateContainerOptions {
    readonly imageRef: string;
    readonly name: string;
    readonly labels: Record<string, string>;
    readonly hostPort: number;
    readonly containerPort: number;
    /** Named volume mounted at {@link dataPath} so data survives recreation (§8/§11). */
    readonly volumeName?: string;
    readonly dataPath?: string;
    /** Paths to `--env-file`s carrying credentials, so they stay off the CLI (§8.2). */
    readonly environmentFiles?: ReadonlyArray<string>;
    /** Post-image args appended after the image ref (optional; creds now go via env-file). */
    readonly command?: ReadonlyArray<string>;
}

/**
 * IO surface of the Docker-backed runtime (WI-0). Extracted so {@link QuickStartService}
 * can be unit-tested against a mock runtime with no real Docker daemon. The pure inspectors
 * ({@link getBoundHostPort}, {@link isRunning}) are standalone functions — deliberately NOT part
 * of this contract, which stays an IO-only surface.
 */
export interface IContainerRuntime {
    isDockerReady(request?: DockerReadinessRequest): Promise<DockerReadiness>;
    isPortFree(port?: number): Promise<boolean>;
    pullImage(imageRef: string, token?: vscode.CancellationToken): Promise<void>;
    createAndRunContainer(
        options: CreateContainerOptions,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined>;
    /**
     * `quiet` is for polling: it keeps the command and its JSON out of the setup log, and is bounded
     * and cancellable. Any failure resolves to `undefined`.
     */
    inspectContainer(
        nameOrId: string,
        options?: { quiet?: boolean; token?: vscode.CancellationToken },
    ): Promise<InspectContainersItem | undefined>;
    startContainer(id: string): Promise<void>;
    stopContainer(id: string): Promise<void>;
    removeContainer(id: string, force?: boolean): Promise<void>;
    removeVolume(name: string, force?: boolean): Promise<void>;
    /** Rejects when Docker can't answer, so a failure is never mistaken for "absent". */
    volumeExists(name: string): Promise<boolean>;
    execShellInContainer(
        id: string,
        script: string,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<void>;
    listByLabel(labels: Record<string, string | boolean>): Promise<ListContainersItem[]>;
    followLogs(id: string, secrets: ReadonlyArray<string>, token?: vscode.CancellationToken): Promise<void>;
    /** The container's last `lineCount` log lines, formatting stripped and secrets masked. */
    readRecentLogs(
        id: string,
        lineCount: number,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<string>;
}

/**
 * Stateless wrapper around a single Docker {@link DockerClient}. Each call
 * builds a fresh runner so its line-buffered stdout/stderr writables don't leak state
 * between commands.
 */
class ContainerRuntimeImpl implements IContainerRuntime {
    private readonly client = new DockerClient();
    private readonly readinessService = new DockerReadinessService({
        client: this.client,
        shellProvider: SHELL_PROVIDER,
        createProbeOutput: () => {
            const channel = getQuickStartOutputChannel();
            return {
                onCommand: (command: string) => channel.appendLine('$ ' + maskSecrets(command, [])),
                stdOutPipe: new MaskedChannelWritable(channel, []),
                stdErrPipe: new MaskedChannelWritable(channel, []),
                appendDiagnostic: (line: string) => channel.appendLine(line),
            };
        },
    });

    private makeRunner(
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
        echoStdout = true,
        strict = false,
    ) {
        const channel = getQuickStartOutputChannel();
        const factory = new ShellStreamCommandRunnerFactory({
            // Non-strict parsing silently drops output rows that don't match the expected schema;
            // a non-zero exit still rejects. A shellProvider is required for arg quoting.
            strict,
            shellProvider: SHELL_PROVIDER,
            onCommand: (command: string) => channel.appendLine('$ ' + maskSecrets(command, secrets)),
            stdOutPipe: echoStdout ? new MaskedChannelWritable(channel, secrets) : undefined,
            stdErrPipe: new MaskedChannelWritable(channel, secrets),
            cancellationToken: token,
        });
        return factory.getCommandRunner();
    }

    /**
     * For commands whose failure the user sees: a rejection carries Docker's stderr rather than a
     * bare exit code, and a cancel or deadline stops the process instead of orphaning it.
     */
    private runCommand<T>(
        command: Like<DockerCommandResponse<T>>,
        secrets: ReadonlyArray<string> = [],
        token?: vscode.CancellationToken,
        timeoutMs?: number,
    ): Promise<T | undefined> {
        const channel = getQuickStartOutputChannel();
        return runDockerCommand(command, {
            shellProvider: SHELL_PROVIDER,
            secrets,
            onCommand: (commandLine: string) => channel.appendLine('$ ' + maskSecrets(commandLine, secrets)),
            stdOutPipe: new MaskedChannelWritable(channel, secrets),
            stdErrPipe: new MaskedChannelWritable(channel, secrets),
            cancellationToken: token,
            timeoutMs,
        });
    }

    /** CLI-on-PATH + daemon-reachable check (design §9 prereq cards). */
    public isDockerReady(request?: DockerReadinessRequest): Promise<DockerReadiness> {
        return this.readinessService.getReadiness(request);
    }

    public async startAvailableDockerProvider(): Promise<DockerLaunchResult> {
        const readiness = await this.readinessService.getReadiness({ forceRefresh: true });
        if (!readiness.startAction) {
            return 'notAvailable';
        }
        const result = await launchDockerProvider(readiness.startAction);
        await this.readinessService.recordLaunchResult(result);
        return result;
    }

    /** True if the TCP port can be bound on loopback right now (pre-check, design §8.3). */
    public isPortFree(port: number = QUICK_START_PORT): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => server.close(() => resolve(true)));
            server.listen(port, '127.0.0.1');
        });
    }

    public async pullImage(imageRef: string, token?: vscode.CancellationToken): Promise<void> {
        await this.runCommand(this.client.pullImage({ imageRef }), [], token);
    }

    /** `docker run` detached, returning the new container id. */
    public async createAndRunContainer(
        options: CreateContainerOptions,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const mounts =
            options.volumeName && options.dataPath
                ? [
                      {
                          type: 'volume' as const,
                          source: options.volumeName,
                          destination: options.dataPath,
                          readOnly: false,
                      },
                  ]
                : undefined;
        return this.runCommand(
            this.client.runContainer({
                imageRef: options.imageRef,
                name: options.name,
                // `detached: true` already emits `-d --tty` (the client adds --tty
                // whenever detached/interactive), matching the image README's `-dt`.
                detached: true,
                labels: { ...options.labels },
                // Publish on loopback only. The local instance ships with auto-generated
                // credentials and TLS-allow-invalid, and the UX promises "Runs on: This
                // machine" / localhost — binding 0.0.0.0 would expose it to the LAN.
                // `127.0.0.1` also matches the loopback `isPortFree` pre-check above.
                ports: [{ containerPort: options.containerPort, hostPort: options.hostPort, hostIp: '127.0.0.1' }],
                mounts,
                environmentFiles: options.environmentFiles ? [...options.environmentFiles] : undefined,
                command: options.command ? [...options.command] : undefined,
            }),
            secrets,
            token,
            CREATE_CONTAINER_TIMEOUT_MS,
        );
    }

    public async inspectContainer(
        nameOrId: string,
        options?: { quiet?: boolean; token?: vscode.CancellationToken },
    ): Promise<InspectContainersItem | undefined> {
        try {
            // Don't echo stdout: it carries the container env (PASSWORD=…), and callers often have no secret to mask it with.
            const command = this.client.inspectContainers({ containers: [nameOrId] });
            const items = options?.quiet
                ? await runDockerCommand(command, {
                      shellProvider: SHELL_PROVIDER,
                      cancellationToken: options.token,
                      timeoutMs: POLLED_QUERY_TIMEOUT_MS,
                  })
                : await this.makeRunner([], undefined, false)(command);
            return items?.[0];
        } catch {
            return undefined;
        }
    }

    public async startContainer(id: string): Promise<void> {
        await this.runCommand(
            this.client.startContainers({ container: [id] }),
            [],
            undefined,
            DOCKER_COMMAND_TIMEOUT_MS,
        );
    }

    public async stopContainer(id: string): Promise<void> {
        await this.runCommand(
            this.client.stopContainers({ container: [id] }),
            [],
            undefined,
            DOCKER_COMMAND_TIMEOUT_MS,
        );
    }

    public async removeContainer(id: string, force = true): Promise<void> {
        await this.runCommand(
            this.client.removeContainers({ containers: [id], force }),
            [],
            undefined,
            DOCKER_COMMAND_TIMEOUT_MS,
        );
    }

    /** Remove a named volume (best-effort; used for a clean fresh provision and on Delete). */
    public async removeVolume(name: string, force = true): Promise<void> {
        await this.runCommand(
            this.client.removeVolumes({ volumes: [name], force }),
            [],
            undefined,
            DOCKER_COMMAND_TIMEOUT_MS,
        );
    }

    public async volumeExists(name: string): Promise<boolean> {
        // Strict: a dropped row (e.g. Podman's `Labels` map) would read as "absent" and bypass the wipe gate.
        // No stdout echo: the listing names every volume on the host.
        const runner = this.makeRunner([], undefined, false, true);
        const volumes = await runner(this.client.listVolumes({}));
        return volumes.some((volume) => volume.name === name);
    }

    /**
     * Run a `/bin/sh -c <script>` command inside a running container (`docker exec`).
     * Used to seed the image's built-in sample data via its native init script — see
     * {@link QuickStartService} — instead of baking `--init-data true` into the run args
     * (which re-runs on every restart and crashes older images).
     *
     * The script is passed as a single STRONG-quoted argument (single quotes on bash,
     * double quotes on cmd) so the host shell the command runner spawns through does NOT
     * parse or expand it. Any `$VAR` in the script therefore reaches the CONTAINER's own
     * shell verbatim and is expanded there from the container's environment — never the
     * host's. This is what lets the seed reference the container's `$USERNAME`/`$PASSWORD`
     * without ever placing the credentials on the host command line / process list.
     *
     * `secrets` are masked in the echoed command line and streamed output (D14). Rejects on
     * a non-zero exit so the caller can treat it as best-effort.
     */
    public async execShellInContainer(
        id: string,
        script: string,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        const channel = getQuickStartOutputChannel();
        // `execContainer` is a streaming response, so use the streaming runner and
        // line-buffer + mask its output (D14), mirroring followLogs.
        const lineBuffer = new MaskingLineBuffer((line) => channel.appendLine(line), secrets);
        const factory = new ShellStreamCommandRunnerFactory({
            strict: false,
            shellProvider: SHELL_PROVIDER,
            onCommand: (cmd: string) => channel.appendLine('$ ' + maskSecrets(cmd, secrets)),
            cancellationToken: token,
        });
        const streamingRunner = factory.getStreamingCommandRunner();
        const command: Array<string | ShellQuotedString> = [
            'sh',
            '-c',
            { value: script, quoting: ShellQuoting.Strong },
        ];
        try {
            for await (const chunk of streamingRunner(this.client.execContainer({ container: id, command }))) {
                lineBuffer.push(String(chunk));
            }
        } finally {
            lineBuffer.flush();
        }
    }

    public async listByLabel(labels: Record<string, string | boolean>): Promise<ListContainersItem[]> {
        return (
            (await this.runCommand(
                this.client.listContainers({ all: true, labels }),
                [],
                undefined,
                DOCKER_COMMAND_TIMEOUT_MS,
            )) ?? []
        );
    }

    /**
     * Stream `docker logs -f` into the OutputChannel until the token is cancelled
     * or the container stops. Compensates for detached mode (D2) so the channel
     * shows live output during the readiness wait.
     */
    public async followLogs(
        id: string,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        const channel = getQuickStartOutputChannel();
        // Line-buffer + mask (D14) so a secret split across log chunks can't leak.
        const lineBuffer = new MaskingLineBuffer((line) => channel.appendLine(line), secrets);
        const factory = new ShellStreamCommandRunnerFactory({
            strict: false,
            shellProvider: SHELL_PROVIDER,
            cancellationToken: token,
        });
        const streamingRunner = factory.getStreamingCommandRunner();
        try {
            for await (const chunk of streamingRunner(
                this.client.logsForContainer({ container: id, follow: true, tail: 50 }),
            )) {
                lineBuffer.push(String(chunk));
                if (token?.isCancellationRequested) {
                    break;
                }
            }
        } catch {
            // Following logs ends (throws) when the stream is cancelled or the
            // container stops — both are expected; nothing to surface here.
        } finally {
            lineBuffer.flush();
        }
    }

    public async readRecentLogs(
        id: string,
        lineCount: number,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<string> {
        const stdout = new CapturingTeeWritable();
        const stderr = new CapturingTeeWritable();
        await runDockerCommand(this.client.logsForContainer({ container: id, tail: lineCount }), {
            shellProvider: SHELL_PROVIDER,
            stdOutPipe: stdout,
            stdErrPipe: stderr,
            cancellationToken: token,
            timeoutMs: POLLED_QUERY_TIMEOUT_MS,
        });
        return sanitizeOutput(stdout.getOutput() + stderr.getOutput(), secrets);
    }
}

/** Singleton container runtime. */
/**
 * Read the host port actually bound to `containerPort` (design §8.3, D11). Pure inspector
 * (no IO) — kept off {@link IContainerRuntime} so that contract stays an IO-only surface.
 */
export function getBoundHostPort(
    item: InspectContainersItem,
    containerPort: number = QUICK_START_PORT,
): number | undefined {
    const binding = item.ports?.find((p) => p.containerPort === containerPort && typeof p.hostPort === 'number');
    return binding?.hostPort;
}

/** True when the inspected container reports a "running" status. Pure inspector (no IO). */
export function isRunning(item: InspectContainersItem | undefined): boolean {
    return !!item?.status && item.status.toLowerCase().includes('running');
}

/** True once the container's process has ended (not merely paused or still being created). */
export function hasExited(item: InspectContainersItem): boolean {
    const status = item.status?.toLowerCase();
    return status === 'exited' || status === 'dead';
}

/** The exit code Docker recorded for a stopped container; the normalized item omits it. */
export function getExitCode(item: InspectContainersItem): number | undefined {
    try {
        const raw = JSON.parse(item.raw) as { State?: { ExitCode?: unknown } };
        return typeof raw.State?.ExitCode === 'number' ? raw.State.ExitCode : undefined;
    } catch {
        return undefined;
    }
}

/** Singleton Docker-backed runtime; the default injected into {@link QuickStartService} (WI-0). */
const containerRuntime = new ContainerRuntimeImpl();
export const ContainerRuntime: IContainerRuntime = containerRuntime;

/**
 * Recompute provider capability and revalidate the selected action immediately before launch.
 */
export async function startDockerProvider(): Promise<DockerLaunchResult> {
    return containerRuntime.startAvailableDockerProvider();
}
