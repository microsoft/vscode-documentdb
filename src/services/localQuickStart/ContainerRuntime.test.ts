/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ContainerClient from '@microsoft/vscode-container-client';
import {
    ShellStreamCommandRunnerFactory,
    type ShellStreamCommandRunnerOptions,
} from '@microsoft/vscode-container-client';
import * as vscode from 'vscode';
import {
    ContainerRuntime,
    disposeQuickStartOutputChannel,
    getExitCode,
    getPublishedHostPort,
} from './ContainerRuntime';
import * as containerCli from './containerCli';
import type * as DockerCommand from './dockerCommand';
import { runDockerCommand, type DockerCommandOptions } from './dockerCommand';
import type * as DockerProbes from './dockerProbes';
import { runDockerProbe } from './dockerProbes';

vi.mock('@microsoft/vscode-container-client', async () => ({
    ...(await vi.importActual<typeof ContainerClient>('@microsoft/vscode-container-client')),
    ShellStreamCommandRunnerFactory: vi.fn(),
}));
vi.mock('./dockerCommand', async () => ({
    ...(await vi.importActual<typeof DockerCommand>('./dockerCommand')),
    runDockerCommand: vi.fn(),
}));
vi.mock('./dockerProbes', async () => ({
    ...(await vi.importActual<typeof DockerProbes>('./dockerProbes')),
    runDockerProbe: vi.fn(),
}));

const PASSWORD = 'hunter2-generated-password';
// `docker container inspect` output: the container env carries the credentials.
const STDOUT_WITH_ENV = JSON.stringify({ Config: { Env: ['USERNAME=admin', `PASSWORD=${PASSWORD}`] } });

const IMAGE_REF = 'ghcr.io/documentdb/documentdb/documentdb-local:latest';
function imageItem(raw: unknown): ContainerClient.InspectImagesItem {
    return {
        id: 'sha256:image-id',
        repoDigests: ['other/repository@sha256:wrong', IMAGE_REF.split(':')[0] + '@sha256:right'],
        labels: { 'org.opencontainers.image.version': '0.116.0', secret: PASSWORD },
        environmentVariables: { PASSWORD },
        createdAt: new Date(),
        raw: JSON.stringify(raw),
    } as unknown as ContainerClient.InspectImagesItem;
}

describe('ContainerRuntime output channel', () => {
    let lines: string[];
    let stdout: string;

    beforeEach(() => {
        lines = [];
        stdout = STDOUT_WITH_ENV;
        disposeQuickStartOutputChannel();
        vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            appendLine: (line: string) => lines.push(line),
            dispose: () => undefined,
        } as unknown as vscode.LogOutputChannel);
        vi.mocked(ShellStreamCommandRunnerFactory).mockImplementation(function (
            options: ShellStreamCommandRunnerOptions,
        ) {
            return {
                getCommandRunner: () => async () => {
                    options.onCommand?.('docker …');
                    options.stdOutPipe?.end(stdout + '\n');
                    return [];
                },
            } as unknown as ShellStreamCommandRunnerFactory<ShellStreamCommandRunnerOptions>;
        });
        vi.mocked(runDockerCommand)
            .mockReset()
            .mockImplementation(async (_command, options: DockerCommandOptions) => {
                options.onCommand?.('docker …');
                options.stdOutPipe?.end(stdout + '\n');
                return undefined;
            });
    });

    afterEach(() => {
        disposeQuickStartOutputChannel();
        vi.restoreAllMocks();
    });

    it('never echoes inspect stdout, which carries the container env', async () => {
        await ContainerRuntime.inspectContainer('c1');
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('$ docker …');
        expect(lines.join('\n')).not.toContain(PASSWORD);
    });

    it('refreshes PATH presence without recreating an unchanged selected client or probing the other CLI', async () => {
        vi.spyOn(containerCli, 'resolveContainerCli')
            .mockReturnValueOnce({
                cli: 'docker',
                executable: 'discovered-docker',
                onPath: { docker: true, podman: false },
            })
            .mockReturnValueOnce({
                cli: 'docker',
                executable: 'discovered-docker',
                onPath: { docker: true, podman: true },
            });
        const createClient = vi.spyOn(containerCli, 'createContainerClient');
        vi.mocked(runDockerProbe).mockImplementation(async (options) => ({
            probe: options.probe,
            stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 1,
        }));

        await expect(ContainerRuntime.isDockerReady({ forceRefresh: true })).resolves.toMatchObject({
            outcome: 'ready',
            cli: 'docker',
            cliOnPath: { docker: true, podman: false },
        });
        await expect(ContainerRuntime.isDockerReady({ forceRefresh: true })).resolves.toMatchObject({
            outcome: 'ready',
            cli: 'docker',
            cliOnPath: { docker: true, podman: true },
        });
        expect(createClient).toHaveBeenCalledTimes(1);
        expect(runDockerProbe).toHaveBeenCalledTimes(6);
        for (const [options] of vi.mocked(runDockerProbe).mock.calls) {
            const command = typeof options.command === 'function' ? await options.command() : await options.command;
            expect(command.command).toBe('discovered-docker');
        }
    });

    it.each([
        ['Docker', { Id: 'sha256:image-id', Created: '2026-10-28T00:00:00Z' }],
        [
            'Podman',
            [
                { Id: 'other', Created: '2025-01-01T00:00:00Z' },
                { Id: 'sha256:image-id', Created: '2026-10-28T00:00:00Z' },
            ],
        ],
    ])('allow-lists %s image evidence without echoing commands, output, labels or env', async (_name, raw) => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem(raw)]);
        const cts = new vscode.CancellationTokenSource();
        const facts = await ContainerRuntime.inspectImage(IMAGE_REF, cts.token);
        expect(facts).toEqual({
            id: 'sha256:image-id',
            digest: 'sha256:right',
            version: '0.116.0',
            createdAtMs: Date.parse('2026-10-28T00:00:00Z'),
        });
        const options = vi.mocked(runDockerCommand).mock.calls[0][1];
        expect(options).toMatchObject({ cancellationToken: cts.token, timeoutMs: 10_000 });
        expect(options.onCommand).toBeUndefined();
        expect(options.stdOutPipe).toBeUndefined();
        expect(options.stdErrPipe).toBeUndefined();
        expect(lines).toEqual([]);
        expect(JSON.stringify(facts)).not.toContain(PASSWORD);
        cts.dispose();
    });

    it.each([undefined, null, '', 'not-a-date', '0001-01-01T00:00:00Z', 1_700_000_000_000])(
        'omits a missing or invalid source creation date (%s), never the client synthesized date',
        async (created) => {
            vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem({ Id: 'sha256:image-id', Created: created })]);
            expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toMatchObject({
                id: 'sha256:image-id',
                createdAtMs: undefined,
            });
        },
    );

    it.each([null, [], [{ Id: 'other', Created: '2026-10-28T00:00:00Z' }], { Id: 'other', Created: '2026-10-28' }])(
        'does not use an unmatched raw record for the image date',
        async (raw) => {
            vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem(raw)]);
            expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toMatchObject({ createdAtMs: undefined });
        },
    );

    it('omits unrelated digests and overlong OCI version labels', async () => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([
            {
                ...imageItem({ Id: 'sha256:image-id' }),
                repoDigests: ['other/repository@sha256:wrong'],
                labels: { 'org.opencontainers.image.version': 'a'.repeat(65) },
            },
        ]);
        expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toEqual({
            id: 'sha256:image-id',
            digest: undefined,
            version: undefined,
            createdAtMs: undefined,
        });
    });

    it('proves absence only with an empty strict reference-filtered listing', async () => {
        vi.mocked(runDockerCommand).mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce([]);
        expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toBe('absent');
        const commandLike = vi.mocked(runDockerCommand).mock.calls[1][0];
        const command = typeof commandLike === 'function' ? await commandLike() : await commandLike;
        expect(command.args).toContainEqual(expect.objectContaining({ value: `reference=${IMAGE_REF}` }));
        expect(() => command.parse?.('invalid listing', false)).toThrow();
    });

    it.each([
        ['inspect failed but image listed', [{ id: 'image' }]],
        ['listing could not answer', undefined],
    ])('does not confuse %s with absence', async (_name, listing) => {
        vi.mocked(runDockerCommand).mockRejectedValueOnce(new Error('inspect failed')).mockResolvedValueOnce(listing);
        expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toBeUndefined();
    });

    it('returns unknown when both inspect and strict listing fail', async () => {
        vi.mocked(runDockerCommand).mockRejectedValue(new Error('daemon unavailable'));
        expect(await ContainerRuntime.inspectImage(IMAGE_REF)).toBeUndefined();
    });

    it('does not infer digest-reference absence from a zero-result reference filter', async () => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        expect(await ContainerRuntime.inspectImage(IMAGE_REF.split(':')[0] + '@sha256:abc')).toBeUndefined();
    });

    it.each([
        ['listByLabel', () => ContainerRuntime.listByLabel({ label: 'x' })],
        ['removeContainer', () => ContainerRuntime.removeContainer('c1')],
    ])('%s still echoes its stdout', async (_name, run) => {
        stdout = 'c1';
        await run();
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('c1');
    });
});

describe('raw inspect readers', () => {
    const record = {
        Id: 'abc',
        State: { ExitCode: 3 },
        HostConfig: { PortBindings: { '10260/tcp': [{ HostIp: '127.0.0.1', HostPort: '39733' }] } },
    };
    const item = (raw: unknown) => ({ id: 'abc', raw: JSON.stringify(raw) }) as ContainerClient.InspectContainersItem;

    it.each([
        ['Docker (one record)', record],
        ['Podman (whole inspect array)', [{ ...record, Id: 'other', State: { ExitCode: 9 } }, record]],
    ])('reads the exit code and published port from %s', (_label, raw) => {
        expect(getExitCode(item(raw))).toBe(3);
        expect(getPublishedHostPort(item(raw))).toBe(39733);
    });
});
