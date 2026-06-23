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
import * as net from 'net';
import { Writable } from 'stream';
import * as vscode from 'vscode';
import { MaskingLineBuffer, maskSecrets } from './outputMasking';
import { type DockerReadiness, QUICK_START_PORT } from './quickStartTypes';

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
    /** Post-image args appended after the image ref (e.g. `--username`/`--password`). */
    readonly command: ReadonlyArray<string>;
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
        let cliVersion: string | undefined;
        try {
            const runner = this.makeRunner([]);
            cliVersion = (await runner(this.client.checkInstall({}))).trim();
        } catch (error) {
            return { cliInstalled: false, daemonReachable: false, error: errMessage(error) };
        }

        try {
            const runner = this.makeRunner([]);
            await runner(this.client.info({}));
        } catch (error) {
            return { cliInstalled: true, cliVersion, daemonReachable: false, error: errMessage(error) };
        }

        return { cliInstalled: true, cliVersion, daemonReachable: true };
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
        return runner(
            this.client.runContainer({
                imageRef: options.imageRef,
                name: options.name,
                // `detached: true` already emits `-d --tty` (the client adds --tty
                // whenever detached/interactive), matching the image README's `-dt`.
                detached: true,
                labels: { ...options.labels },
                ports: [{ containerPort: options.containerPort, hostPort: options.hostPort }],
                command: [...options.command],
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
