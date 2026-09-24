/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenLike, isCancellationError, ShellQuoting } from '@microsoft/vscode-processutils';
import { spawnSync } from 'child_process';
import {
    DockerCommandError,
    DockerCommandTimeoutError,
    getDockerShellProvider,
    runDockerCommand,
    summarizeDockerError,
} from './dockerCommand';
import { CapturingTeeWritable } from './dockerProbes';

// Real child processes stand in for the docker CLI; process groups are POSIX-only.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

function nodeScript(script: string, ...args: string[]) {
    return {
        command: process.execPath,
        args: [
            { value: '-e', quoting: ShellQuoting.Strong },
            { value: script, quoting: ShellQuoting.Strong },
            ...args.map((value) => ({ value, quoting: ShellQuoting.Strong })),
        ],
    };
}

// By command line, not pid: the child may be killed before it could print one, and a killed
// grandchild lingers as a zombie until init reaps it, which kill(pid, 0) still reports as alive.
function isRunning(marker: string): boolean {
    return spawnSync('pgrep', ['-f', marker]).status === 0;
}

describe('summarizeDockerError', () => {
    // Verbatim stderr from Docker 29.8.
    it.each([
        [
            'Error response from daemon: failed to resolve reference "ghcr.io/x/documentdb-local:0.117.0-nope": ghcr.io/x/documentdb-local:0.117.0-nope: not found\n',
            'failed to resolve reference "ghcr.io/x/documentdb-local:0.117.0-nope": ghcr.io/x/documentdb-local:0.117.0-nope: not found',
        ],
        [
            'docker: Error response from daemon: Conflict. The container name "/vscode-documentdb-local" is already in use by container "bba452bd". You have to remove (or rename) that container to be able to reuse that name.\n\nRun \'docker run --help\' for more information\n',
            'Conflict. The container name "/vscode-documentdb-local" is already in use by container "bba452bd". You have to remove (or rename) that container to be able to reuse that name.',
        ],
        [
            "docker: Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:10260 -> 127.0.0.1:0: listen tcp4 127.0.0.1:10260: bind: address already in use\n\nRun 'docker run --help' for more information\n",
            'ports are not available: exposing port TCP 127.0.0.1:10260 -> 127.0.0.1:0: listen tcp4 127.0.0.1:10260: bind: address already in use',
        ],
        [
            'Error response from daemon: cannot start a paused container, try unpause instead\nfailed to start containers: vscode-documentdb-local\n',
            'cannot start a paused container, try unpause instead',
        ],
    ])('keeps only what Docker said went wrong', (stderr, expected) => {
        expect(summarizeDockerError(stderr)).toBe(expected);
    });

    it('falls back to the first line when nothing is labelled an error', () => {
        expect(summarizeDockerError('\nsomething odd happened\nmore\n')).toBe('something odd happened');
    });

    it('returns nothing for empty stderr, so the error can fall back to the exit code', () => {
        expect(summarizeDockerError('  \n')).toBeUndefined();
        expect(new DockerCommandError(125, '').message).toBe('Docker exited with code 125.');
    });
});

describePosix('runDockerCommand', () => {
    const shellProvider = getDockerShellProvider();

    it('rejects with what Docker wrote to stderr instead of the bare exit code', async () => {
        const stderr = new CapturingTeeWritable();
        const error: unknown = await runDockerCommand(
            nodeScript(
                'process.stderr.write("docker: Error response from daemon: Conflict. The container name \\"/x\\" is already in use.\\n\\nRun \'docker run --help\' for more information\\n"); process.exit(125)',
            ),
            { shellProvider, stdErrPipe: stderr },
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DockerCommandError);
        expect(error).toMatchObject({
            exitCode: 125,
            message: 'Conflict. The container name "/x" is already in use.',
        });
        // Still streamed to the output channel.
        expect(stderr.getOutput()).toContain('Conflict.');
    });

    it('masks secrets in the stderr it keeps', async () => {
        const error: unknown = await runDockerCommand(
            nodeScript('process.stderr.write("Error: bad hunter2"); process.exit(1)'),
            { shellProvider, secrets: ['hunter2'] },
        ).catch((reason: unknown) => reason);

        expect(error).toMatchObject({ stderr: 'Error: bad ***', message: 'bad ***' });
    });

    it('returns the parsed stdout on success', async () => {
        const result = await runDockerCommand(
            {
                ...nodeScript('process.stdout.write("abc123\\n")'),
                parse: (output: string) => Promise.resolve(output.trim()),
            },
            { shellProvider },
        );

        expect(result).toBe('abc123');
    });

    it('passes a strong-quoted path containing an apostrophe through intact', async () => {
        const path = "/tmp/qs it's/x.env";
        const result = await runDockerCommand(
            {
                ...nodeScript('process.stdout.write(process.argv[1])', path),
                parse: (output: string) => Promise.resolve(output),
            },
            { shellProvider },
        );

        expect(result).toBe(path);
    });

    // A hung `docker run` ignores SIGTERM; the old runner rejected at once and left it running.
    it('kills a command that ignores SIGTERM when its deadline passes', async () => {
        const marker = `deadline-${process.pid}-${Date.now()}`;
        const error: unknown = await runDockerCommand(
            nodeScript('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)', marker),
            { shellProvider, timeoutMs: 500, killGraceMs: 100 },
        ).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(DockerCommandTimeoutError);
        expect(isRunning(marker)).toBe(false);
    });

    it('kills a command that ignores SIGTERM when cancelled, and settles only once it is gone', async () => {
        const controller = new AbortController();
        const stdout = new CapturingTeeWritable();
        const marker = `cancel-${process.pid}-${Date.now()}`;
        const pending = runDockerCommand(
            nodeScript(
                'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000)',
                marker,
            ),
            {
                shellProvider,
                stdOutPipe: stdout,
                cancellationToken: CancellationTokenLike.fromAbortSignal(controller.signal),
                killGraceMs: 100,
            },
        ).catch((reason: unknown) => reason);
        // Cancel once it is ignoring SIGTERM, so the test covers the escalation to SIGKILL.
        const started = setInterval(() => stdout.getOutput() && controller.abort(), 20);

        const error = await pending;
        clearInterval(started);

        expect(isCancellationError(error)).toBe(true);
        expect(isRunning(marker)).toBe(false);
    });

    // The shell's own exit does not end the wait: a descendant can keep the output pipes open.
    it('still enforces the deadline when the command exits but leaves a child holding its output', async () => {
        const result = await runDockerCommand(
            {
                ...nodeScript(
                    'require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }); process.stdout.write("done"); setTimeout(() => process.exit(0), 50)',
                ),
                parse: (output: string) => Promise.resolve(output),
            },
            { shellProvider, timeoutMs: 1000, killGraceMs: 100 },
        );

        // It had finished, so the result stands rather than a timeout.
        expect(result).toBe('done');
    });
});
