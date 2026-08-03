/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    normalizeCommandResponseLike,
    ShellStreamCommandRunnerFactory,
    type CommandResponseBase,
    type Like,
} from '@microsoft/vscode-container-client';
import { isChildProcessError, type Shell } from '@microsoft/vscode-processutils';
import * as fs from 'fs';
import * as net from 'net';
import { Writable } from 'stream';
import { finished } from 'stream/promises';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type DockerEndpointProbe, type DockerProbeEvidence } from './quickStartTypes';

export interface RunDockerProbeOptions {
    readonly probe: DockerProbeEvidence['probe'];
    readonly command: Like<CommandResponseBase>;
    readonly shellProvider: Shell;
    readonly cancellationToken?: vscode.CancellationToken;
    readonly didDeadlineExpire?: () => boolean;
    readonly onCommand?: (command: string) => void;
    readonly stdOutPipe?: Writable;
    readonly stdErrPipe?: Writable;
    readonly now?: () => number;
    readonly execute?: DockerProbeExecutor;
}

export interface ResolvedDockerEndpoint {
    readonly kind: DockerEndpointProbe['kind'];
    readonly address: string;
    readonly source: DockerEndpointProbe['source'];
}

export interface DockerEndpointProbeDependencies {
    readonly access: (endpoint: string) => Promise<void>;
    readonly connect: (endpoint: string, token?: vscode.CancellationToken) => Promise<void>;
}

export interface DockerInfoFacts {
    readonly osType?: string;
    readonly architecture?: string;
    readonly serverVersion?: string;
    readonly serverErrors: ReadonlyArray<string>;
}

type DockerProbeExecutor = (command: CommandResponseBase, stdOutPipe: Writable, stdErrPipe: Writable) => Promise<void>;

const DockerInfoSchema = z.object({
    OSType: z.string().optional(),
    Architecture: z.string().optional(),
    ServerVersion: z.string().optional(),
    ServerErrors: z.array(z.string()).nullish(),
});

class CapturingTeeWritable extends Writable {
    private readonly chunks: string[] = [];

    public constructor(private readonly destination?: Writable) {
        super();
    }

    public override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        const text = String(chunk);
        this.chunks.push(text);
        this.destination?.write(text);
        callback();
    }

    public override _final(callback: (error?: Error | null) => void): void {
        if (!this.destination) {
            callback();
            return;
        }
        this.destination.end(callback);
    }

    public getOutput(): string {
        return this.chunks.join('');
    }
}

function getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return undefined;
    }
    return typeof error.code === 'string' ? error.code : undefined;
}

function getEndedBy(options: RunDockerProbeOptions): DockerProbeEvidence['endedBy'] {
    if (options.didDeadlineExpire?.()) {
        return 'deadline';
    }
    if (options.cancellationToken?.isCancellationRequested) {
        return 'cancellation';
    }
    return 'exit';
}

async function finishCapture(stream: CapturingTeeWritable): Promise<void> {
    if (!stream.writableEnded) {
        stream.end();
    }
    await finished(stream);
}

export async function runDockerProbe(options: RunDockerProbeOptions): Promise<DockerProbeEvidence> {
    const now = options.now ?? Date.now;
    const startedAt = now();
    const stdOutCapture = new CapturingTeeWritable(options.stdOutPipe);
    const stdErrCapture = new CapturingTeeWritable(options.stdErrPipe);
    const command = await normalizeCommandResponseLike(options.command);
    const execute: DockerProbeExecutor =
        options.execute ??
        (async (commandToRun, stdOutPipe, stdErrPipe): Promise<void> => {
            const factory = new ShellStreamCommandRunnerFactory({
                strict: false,
                shellProvider: options.shellProvider,
                cancellationToken: options.cancellationToken,
                onCommand: options.onCommand,
                stdOutPipe,
                stdErrPipe,
            });
            await factory.getCommandRunner()(commandToRun);
        });

    let exitCode: number | undefined;
    let spawnErrorCode: string | undefined;
    try {
        await execute(command, stdOutCapture, stdErrCapture);
    } catch (error) {
        if (isChildProcessError(error)) {
            exitCode = error.code ?? undefined;
        } else {
            spawnErrorCode = getErrorCode(error);
        }
    } finally {
        await Promise.all([finishCapture(stdOutCapture), finishCapture(stdErrCapture)]);
    }

    return {
        probe: options.probe,
        exitCode,
        spawnErrorCode,
        stdout: stdOutCapture.getOutput(),
        stderr: stdErrCapture.getOutput(),
        endedBy: getEndedBy(options),
        durationMs: Math.max(0, now() - startedAt),
    };
}

export function parseDockerInfoFacts(output: string): DockerInfoFacts | undefined {
    try {
        const result = DockerInfoSchema.safeParse(JSON.parse(output));
        if (!result.success) {
            return undefined;
        }
        return {
            osType: result.data.OSType,
            architecture: result.data.Architecture,
            serverVersion: result.data.ServerVersion,
            serverErrors: result.data.ServerErrors ?? [],
        };
    } catch {
        return undefined;
    }
}

export function normalizeDaemonArchitecture(architecture: string): string {
    switch (architecture) {
        case 'x86_64':
            return 'amd64';
        case 'aarch64':
            return 'arm64';
        default:
            return architecture;
    }
}

function getDefaultEndpointProbeDependencies(): DockerEndpointProbeDependencies {
    return {
        access: async (endpoint: string): Promise<void> => {
            await fs.promises.access(endpoint, fs.constants.R_OK | fs.constants.W_OK);
        },
        connect: (endpoint: string, token?: vscode.CancellationToken): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                const socket = net.createConnection(endpoint);
                const cancellation = token?.onCancellationRequested(() => {
                    socket.destroy();
                    reject(new vscode.CancellationError());
                });
                socket.once('connect', () => {
                    cancellation?.dispose();
                    socket.destroy();
                    resolve();
                });
                socket.once('error', (error) => {
                    cancellation?.dispose();
                    reject(error);
                });
            }),
    };
}

export async function probeDockerEndpoint(
    endpoint: ResolvedDockerEndpoint,
    token?: vscode.CancellationToken,
    dependencies: DockerEndpointProbeDependencies = getDefaultEndpointProbeDependencies(),
): Promise<DockerEndpointProbe> {
    if (endpoint.kind !== 'unixSocket' && endpoint.kind !== 'namedPipe') {
        return { kind: endpoint.kind, source: endpoint.source };
    }

    if (endpoint.kind === 'unixSocket') {
        try {
            await dependencies.access(endpoint.address);
        } catch (error) {
            return { kind: endpoint.kind, source: endpoint.source, accessErrorCode: getErrorCode(error) };
        }
    }

    try {
        await dependencies.connect(endpoint.address, token);
        return { kind: endpoint.kind, source: endpoint.source };
    } catch (error) {
        return { kind: endpoint.kind, source: endpoint.source, accessErrorCode: getErrorCode(error) };
    }
}
