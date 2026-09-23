/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeCommandResponseLike, type CommandResponseBase, type Like } from '@microsoft/vscode-container-client';
import {
    Bash,
    CancellationError,
    Cmd,
    getSafeExecPath,
    ShellQuoting,
    type CancellationTokenLike,
    type CommandLineArgs,
    type Shell,
} from '@microsoft/vscode-processutils';
import { spawn, type ChildProcess } from 'child_process';
import { type Writable } from 'stream';
import { CapturingTeeWritable, finishCapture } from './dockerProbes';
import { sanitizeOutput } from './outputMasking';

/**
 * `Bash.quote()` renders a strong-quoted `it's` as `'it\'s'`, which bash rejects: backslashes are
 * literal inside single quotes. Close the quote around each apostrophe instead (`'it'\''s'`).
 */
class PosixShell extends Bash {
    public override quote(args: CommandLineArgs): Array<string> {
        return args.map((arg) =>
            typeof arg !== 'string' && arg.quoting === ShellQuoting.Strong
                ? `'${arg.value.replace(/'/g, `'\\''`)}'`
                : super.quote([arg])[0],
        );
    }
}

/** The shell every Quick Start Docker command runs through. */
export function getDockerShellProvider(platform: NodeJS.Platform = process.platform): Shell {
    return platform === 'win32' ? new Cmd() : new PosixShell();
}

/**
 * Docker's own explanation from a failed command's stderr: the first error line, minus the
 * prefixes that only say who is talking and the trailing `--help` hint.
 */
export function summarizeDockerError(stderr: string): string | undefined {
    const lines = stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^(?:see|run) 'docker .*--help'/i.test(line));
    const line = lines.find((candidate) => /error/i.test(candidate)) ?? lines[0];
    return (
        line
            ?.replace(/^docker:\s*/i, '')
            .replace(/^error response from daemon:\s*/i, '')
            .replace(/^error:\s*/i, '') || undefined
    );
}

/** A Docker command exited non-zero. The message is Docker's first error line, not the exit code. */
export class DockerCommandError extends Error {
    public constructor(
        public readonly exitCode: number | undefined,
        /** Everything the command wrote to stderr, with secrets masked. */
        public readonly stderr: string,
    ) {
        super(
            summarizeDockerError(stderr) ??
                (exitCode === undefined ? 'Docker exited unexpectedly.' : `Docker exited with code ${exitCode}.`),
        );
        this.name = 'DockerCommandError';
    }
}

/** A Docker command outlived its deadline and was killed. */
export class DockerCommandTimeoutError extends Error {
    public constructor(public readonly timeoutMs: number) {
        super(`Docker did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
        this.name = 'DockerCommandTimeoutError';
    }
}

export interface DockerCommandOptions {
    readonly shellProvider: Shell;
    /** Masked out of the stderr carried by {@link DockerCommandError}. */
    readonly secrets?: ReadonlyArray<string>;
    readonly onCommand?: (commandLine: string) => void;
    readonly stdOutPipe?: Writable;
    readonly stdErrPipe?: Writable;
    readonly cancellationToken?: CancellationTokenLike;
    /** Kill the command and reject with {@link DockerCommandTimeoutError} once this elapses. */
    readonly timeoutMs?: number;
    /** How long a stopped command gets to exit on SIGTERM before SIGKILL. */
    readonly killGraceMs?: number;
}

const DOCKER_KILL_GRACE_MS = 3_000;

export type DockerCommandResponse<T> = CommandResponseBase & {
    parse?: (output: string, strict: boolean) => Promise<T>;
};

function quoteExecutableIfNeeded(executable: string): string {
    return executable.includes(' ') && !executable.startsWith('"') ? `"${executable}"` : executable;
}

// Keyed on the group rather than the shell's own exit: the shell can die on SIGTERM while the docker
// process it started ignores it and keeps the output pipes open.
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on(
                'error',
                () => undefined,
            );
        } else {
            // Negative pid: the whole process group, so the signal reaches docker and not only the shell.
            process.kill(-child.pid, signal);
        }
    } catch {
        // Already gone.
    }
}

/**
 * Run a Docker CLI command through the shell, keeping what it writes to stderr so a failure can say
 * what Docker said. Unlike the container client's runner, a cancelled or timed-out command is
 * actually stopped: a hung `docker run` ignores SIGTERM, so it is escalated to SIGKILL, and this
 * only settles once the process is gone.
 */
export async function runDockerCommand<T>(
    commandLike: Like<DockerCommandResponse<T>>,
    options: DockerCommandOptions,
): Promise<T | undefined> {
    const response = await normalizeCommandResponseLike(commandLike);
    const token = options.cancellationToken;
    if (token?.isCancellationRequested) {
        throw new CancellationError('Command cancelled', token);
    }

    const commandLine = [
        quoteExecutableIfNeeded(getSafeExecPath(response.command)),
        ...options.shellProvider.quote(response.args),
    ].join(' ');
    options.onCommand?.(commandLine);

    const stdout = new CapturingTeeWritable(options.stdOutPipe);
    const stderr = new CapturingTeeWritable(options.stdErrPipe);
    // Already quoted for the shell, which is what Node would build from separate args anyway.
    const child = spawn(commandLine, {
        shell: options.shellProvider.getShellOrDefault(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
    });
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);

    let stopping = false;
    let stoppedBy: 'cancellation' | 'deadline' | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (reason: 'cancellation' | 'deadline'): void => {
        if (stopping) {
            return;
        }
        stopping = true;
        // If the shell already exited, this only clears descendants still holding the output pipes;
        // its exit code, not the stop, then decides the outcome.
        if (child.exitCode === null && child.signalCode === null) {
            stoppedBy = reason;
        }
        killProcessTree(child, 'SIGTERM');
        killTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), options.killGraceMs ?? DOCKER_KILL_GRACE_MS);
    };
    const cancellation = token?.onCancellationRequested(() => stop('cancellation'));
    if (options.timeoutMs !== undefined) {
        deadlineTimer = setTimeout(() => stop('deadline'), options.timeoutMs);
    }

    let exitCode: number | null;
    try {
        exitCode = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
        });
    } finally {
        clearTimeout(deadlineTimer);
        clearTimeout(killTimer);
        cancellation?.dispose();
        await Promise.all([finishCapture(stdout), finishCapture(stderr)]);
    }

    if (stoppedBy === 'cancellation') {
        throw new CancellationError('Command cancelled', token);
    }
    if (stoppedBy === 'deadline') {
        throw new DockerCommandTimeoutError(options.timeoutMs ?? 0);
    }
    if (exitCode !== 0) {
        throw new DockerCommandError(exitCode ?? undefined, sanitizeOutput(stderr.getOutput(), options.secrets ?? []));
    }
    return response.parse?.(stdout.getOutput(), false);
}
