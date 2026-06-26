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
 *   before writing to the "DocumentDB Local Quick Start" OutputChannel (D14):
 *   the generated password must never reach the channel, even when a stream
 *   chunk splits it across a buffer boundary.
 * - `docker run` is detached (D4); because a detached run streams nothing back,
 *   {@link ContainerRuntime.followLogs} streams `docker logs -f` so the channel
 *   isn't silent during the readiness wait.
 * - The image takes credentials as **post-image args** (`--username/--password`),
 *   which the client supports via `runContainer({ command: [...] })` — validated
 *   in WI-0, so no raw-CLI fallback is needed.
 */

import {
    DockerClient,
    type InspectContainersItem,
    type ListContainersItem,
    ShellStreamCommandRunnerFactory,
} from '@microsoft/vscode-container-client';
import { Bash, Cmd, type Shell } from '@microsoft/vscode-processutils';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { Writable } from 'stream';
import * as vscode from 'vscode';
import { MaskingLineBuffer, maskSecrets } from './outputMasking';
import {
    type DockerReadiness,
    QUICK_START_PORT,
    QUICK_START_PORT_BAND_END,
    QUICK_START_PORT_FALLBACK_ATTEMPTS,
} from './quickStartTypes';

/**
 * Shell used to run docker commands. A shell provider is REQUIRED so the runner
 * applies each argument's quoting metadata: without one it sets
 * `windowsVerbatimArguments` on Windows and drops quoting, which splits Go-template
 * `--format {{json .}}` arguments on the space and breaks info/inspect/list.
 */
const SHELL_PROVIDER: Shell = process.platform === 'win32' ? new Cmd() : new Bash();

function errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

let outputChannel: vscode.OutputChannel | undefined;

/** Lazily create the shared OutputChannel. */
export function getQuickStartOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('DocumentDB Local Quick Start');
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
 * Stateless wrapper around a single Docker {@link DockerClient}. Each call
 * builds a fresh runner so its masked stdout/stderr writables don't leak state
 * between commands.
 */
class ContainerRuntimeImpl {
    private readonly client = new DockerClient();

    private makeRunner(secrets: ReadonlyArray<string>, token?: vscode.CancellationToken) {
        const channel = getQuickStartOutputChannel();
        const factory = new ShellStreamCommandRunnerFactory({
            // Non-strict: a non-zero exit still rejects, but harmless stderr warnings
            // (e.g. `docker info`) do not. A shellProvider is required for arg quoting.
            strict: false,
            shellProvider: SHELL_PROVIDER,
            onCommand: (command: string) => channel.appendLine('$ ' + maskSecrets(command, secrets)),
            stdOutPipe: new MaskedChannelWritable(channel, secrets),
            stdErrPipe: new MaskedChannelWritable(channel, secrets),
            cancellationToken: token,
        });
        return factory.getCommandRunner();
    }

    /** CLI-on-PATH + daemon-reachable check (design §9 prereq cards). */
    public async isDockerReady(): Promise<DockerReadiness> {
        // Host CPU architecture check (design §9): x64/arm64 are supported; arm64 may
        // run the amd64 image under emulation. Independent of the Docker checks.
        const arch = process.arch;
        const platformSupported = arch === 'x64' || arch === 'arm64';

        let cliVersion: string | undefined;
        try {
            const runner = this.makeRunner([]);
            cliVersion = (await runner(this.client.checkInstall({}))).trim();
        } catch (error) {
            return { cliInstalled: false, daemonReachable: false, arch, platformSupported, error: errMessage(error) };
        }

        try {
            const runner = this.makeRunner([]);
            await runner(this.client.info({}));
        } catch (error) {
            return {
                cliInstalled: true,
                cliVersion,
                daemonReachable: false,
                arch,
                platformSupported,
                error: errMessage(error),
            };
        }

        return { cliInstalled: true, cliVersion, daemonReachable: true, arch, platformSupported };
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

    /**
     * Pick an available host port (design §8.3): prefer {@link preferred}, else try
     * up to {@link attempts} random ports in `[preferred, bandEnd)`. Returns
     * `undefined` if none are free. Only used for the default (non-explicit) port.
     */
    public async findAvailablePort(
        preferred: number = QUICK_START_PORT,
        bandEnd: number = QUICK_START_PORT_BAND_END,
        attempts: number = QUICK_START_PORT_FALLBACK_ATTEMPTS,
    ): Promise<number | undefined> {
        if (await this.isPortFree(preferred)) {
            return preferred;
        }
        const span = Math.max(1, bandEnd - preferred);
        const tried = new Set<number>([preferred]);
        for (let i = 0; i < attempts; i++) {
            const candidate = preferred + Math.floor(Math.random() * span);
            if (tried.has(candidate)) {
                continue;
            }
            tried.add(candidate);
            if (await this.isPortFree(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    public async pullImage(imageRef: string, token?: vscode.CancellationToken): Promise<void> {
        const runner = this.makeRunner([], token);
        await runner(this.client.pullImage({ imageRef }));
    }

    /** `docker run` detached, returning the new container id. */
    public async createAndRunContainer(
        options: CreateContainerOptions,
        secrets: ReadonlyArray<string>,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const runner = this.makeRunner(secrets, token);
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
        return runner(
            this.client.runContainer({
                imageRef: options.imageRef,
                name: options.name,
                // `detached: true` already emits `-d --tty` (the client adds --tty
                // whenever detached/interactive), matching the image README's `-dt`.
                detached: true,
                labels: { ...options.labels },
                ports: [{ containerPort: options.containerPort, hostPort: options.hostPort }],
                mounts,
                environmentFiles: options.environmentFiles ? [...options.environmentFiles] : undefined,
                command: options.command ? [...options.command] : undefined,
            }),
        );
    }

    public async inspectContainer(nameOrId: string): Promise<InspectContainersItem | undefined> {
        try {
            const runner = this.makeRunner([]);
            const items = await runner(this.client.inspectContainers({ containers: [nameOrId] }));
            return items?.[0];
        } catch {
            return undefined;
        }
    }

    /** Read the host port actually bound to `containerPort` (design §8.3, D11). */
    public getBoundHostPort(item: InspectContainersItem, containerPort: number = QUICK_START_PORT): number | undefined {
        const binding = item.ports?.find((p) => p.containerPort === containerPort && typeof p.hostPort === 'number');
        return binding?.hostPort;
    }

    public isRunning(item: InspectContainersItem | undefined): boolean {
        return !!item?.status && item.status.toLowerCase().includes('running');
    }

    public async startContainer(id: string): Promise<void> {
        const runner = this.makeRunner([]);
        await runner(this.client.startContainers({ container: [id] }));
    }

    public async stopContainer(id: string): Promise<void> {
        const runner = this.makeRunner([]);
        await runner(this.client.stopContainers({ container: [id] }));
    }

    public async removeContainer(id: string, force = true): Promise<void> {
        const runner = this.makeRunner([]);
        await runner(this.client.removeContainers({ containers: [id], force }));
    }

    /** Remove a named volume (best-effort; used for a clean fresh provision and on Delete). */
    public async removeVolume(name: string, force = true): Promise<void> {
        const runner = this.makeRunner([]);
        await runner(this.client.removeVolumes({ volumes: [name], force }));
    }

    /**
     * Run a one-off command inside a running container (`docker exec`). Used to
     * seed the image's built-in sample data via its native init script — see
     * {@link QuickStartService} — instead of baking `--init-data true` into the
     * run args (which re-runs on every restart and crashes the container).
     * `secrets` are masked in the echoed command line and streamed output (D14).
     * Rejects on a non-zero exit so the caller can treat it as best-effort.
     */
    public async execInContainer(
        id: string,
        command: ReadonlyArray<string>,
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
        try {
            for await (const chunk of streamingRunner(
                this.client.execContainer({ container: id, command: [...command] }),
            )) {
                lineBuffer.push(String(chunk));
            }
        } finally {
            lineBuffer.flush();
        }
    }

    public async listByLabel(labels: Record<string, string | boolean>): Promise<ListContainersItem[]> {
        const runner = this.makeRunner([]);
        return runner(this.client.listContainers({ all: true, labels }));
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
}

/** Singleton container runtime. */
export const ContainerRuntime = new ContainerRuntimeImpl();

/**
 * Best-effort launch of Docker Desktop (design §5.3 / §13.2 "Start Docker Desktop").
 * Returns true when a launch was attempted. The user still clicks Retry afterwards —
 * we never block waiting for the daemon. We never install Docker (cross-cutting rule 1).
 */
export async function startDockerDesktop(): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            const roots = [process.env['ProgramFiles'], process.env['ProgramW6432'], 'C:\\Program Files'].filter(
                (r): r is string => !!r,
            );
            const exe = roots
                .map((root) => path.join(root, 'Docker', 'Docker', 'Docker Desktop.exe'))
                .find((candidate) => fs.existsSync(candidate));
            if (!exe) {
                return false;
            }
            spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
            return true;
        }
        if (process.platform === 'darwin') {
            spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref();
            return true;
        }
        // Linux: Docker Desktop launch varies; try the common user service, best-effort.
        spawn('systemctl', ['--user', 'start', 'docker-desktop'], { detached: true, stdio: 'ignore' }).unref();
        return true;
    } catch {
        return false;
    }
}
