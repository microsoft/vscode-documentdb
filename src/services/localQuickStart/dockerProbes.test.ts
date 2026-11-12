/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { Bash, ChildProcessError } from '@microsoft/vscode-processutils';
import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import {
    detectDockerServiceManager,
    getDockerProbeRunnerOptions,
    normalizeDaemonArchitecture,
    parseDockerInfoFacts,
    parseDockerServerComponentNames,
    probeDockerEndpoint,
    probeDockerSocketGroup,
    resolveDockerSocketTarget,
    runDockerProbe,
    type DockerEndpointProbeDependencies,
    type DockerSocketGroupProbeDependencies,
} from './dockerProbes';

const command = { command: 'docker', args: ['info'] };

function readFixtureBody(name: string): string {
    return fs
        .readFileSync(path.join(__dirname, '__fixtures__', 'docker', name), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim();
}

describe('runDockerProbe', () => {
    it('captures stdout and stderr when Docker exits nonzero', async () => {
        const execute = async (_command: unknown, stdout: Writable, stderr: Writable): Promise<void> => {
            stdout.write('{"ServerErrors":["permission denied"]}');
            stderr.write('daemon error');
            throw new ChildProcessError('Process exited with code 1', 1, null);
        };
        const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112);

        const result = await runDockerProbe({
            probe: 'info',
            command,
            shellProvider: new Bash(),
            execute,
            now,
        });

        expect(result).toEqual({
            probe: 'info',
            exitCode: 1,
            spawnErrorCode: undefined,
            stdout: '{"ServerErrors":["permission denied"]}',
            stderr: 'daemon error',
            endedBy: 'exit',
            durationMs: 12,
        });
    });

    it('records a spawn errno separately from an exit code', async () => {
        const execute = async (): Promise<void> => {
            throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
        };

        const result = await runDockerProbe({
            probe: 'cliVersion',
            command,
            shellProvider: new Bash(),
            execute,
        });

        expect(result.spawnErrorCode).toBe('ENOENT');
        expect(result.exitCode).toBeUndefined();
    });

    it('keeps stdin ignored so an SSH endpoint cannot prompt for a passphrase', async () => {
        const stdOutPipe = new Writable({ write: (_chunk, _encoding, callback) => callback() });
        const stdErrPipe = new Writable({ write: (_chunk, _encoding, callback) => callback() });

        const runnerOptions = getDockerProbeRunnerOptions(
            {
                probe: 'info',
                command,
                shellProvider: new Bash(),
            },
            stdOutPipe,
            stdErrPipe,
        );

        expect(runnerOptions).not.toHaveProperty('stdInPipe');
        expect(runnerOptions).toMatchObject({ stdOutPipe, stdErrPipe });
    });
});

describe('parseDockerInfoFacts', () => {
    it('reads raw daemon facts and server errors', () => {
        expect(parseDockerInfoFacts(readFixtureBody('wsl2-ubuntu20.04-docker28.1.1-ready-info.txt'))).toEqual({
            osType: 'linux',
            operatingSystem: 'Ubuntu 20.04.6 LTS',
            architecture: 'x86_64',
            serverVersion: '28.1.1',
            serverErrors: [],
        });
    });

    it('reads the same facts from podman info', () => {
        const podmanInfo = JSON.stringify({
            host: { arch: 'arm64', os: 'linux', distribution: { distribution: 'fedora' } },
            version: { Version: '6.0.2' },
        });
        expect(parseDockerInfoFacts(podmanInfo)).toEqual({
            podmanInfo: true,
            osType: 'linux',
            operatingSystem: undefined,
            architecture: 'arm64',
            serverVersion: '6.0.2',
            serverErrors: [],
        });
    });

    it.each([
        ['empty object', {}],
        ['Docker info', { OSType: 'linux', OperatingSystem: 'Docker Desktop', ServerVersion: '28.1.1' }],
        ['host only', { host: { os: 'linux' } }],
        ['version only', { version: { Version: '6.0.2' } }],
        ['missing host OS', { host: { arch: 'arm64' }, version: { Version: '6.0.2' } }],
        ['non-string host OS', { host: { os: 1 }, version: { Version: '6.0.2' } }],
        ['non-string version', { host: { os: 'linux' }, version: { Version: 6 } }],
    ])('does not identify %s as Podman', (_name, info) => {
        expect(parseDockerInfoFacts(JSON.stringify(info))?.podmanInfo).toBeUndefined();
    });

    it('identifies Podman without optional architecture metadata', () => {
        expect(
            parseDockerInfoFacts(JSON.stringify({ host: { os: 'linux' }, version: { Version: '6.0.2' } })),
        ).toMatchObject({
            podmanInfo: true,
            osType: 'linux',
            serverVersion: '6.0.2',
        });
    });

    it('returns undefined for invalid JSON', () => {
        expect(parseDockerInfoFacts('not json')).toBeUndefined();
    });
});

describe('normalizeDaemonArchitecture', () => {
    it.each([
        ['x86_64', 'amd64'],
        ['aarch64', 'arm64'],
        ['riscv64', 'riscv64'],
    ])('normalizes %s to %s', (input, expected) => {
        expect(normalizeDaemonArchitecture(input)).toBe(expected);
    });
});

describe('parseDockerServerComponentNames', () => {
    it('reads component names from raw server JSON without requiring client API metadata', () => {
        expect(
            parseDockerServerComponentNames(
                JSON.stringify({
                    Client: { Version: '28.1.1' },
                    Server: {
                        Version: '6.0.2',
                        Components: [{ Name: 'Podman Engine', Version: '6.0.2' }, { Name: 'conmon' }],
                    },
                }),
            ),
        ).toEqual(['Podman Engine', 'conmon']);
    });

    it('accepts an empty components array without inventing evidence', () => {
        expect(parseDockerServerComponentNames('{"Server":{"Components":[]}}')).toEqual([]);
    });

    it.each([
        '',
        'not json',
        '{"Server":',
        'null',
        '[]',
        '{}',
        '{"Server":null}',
        '{"Components":[{"Name":"Podman Engine"}]}',
        '{"Client":{"Components":[{"Name":"Podman Engine"}]}}',
        '{"Server":{}}',
        '{"Server":{"Components":null}}',
        '{"Server":{"Components":{}}}',
        '{"Server":{"Components":["Podman Engine"]}}',
        '{"Server":{"Components":[{}]}}',
        '{"Server":{"Components":[{"Name":1}]}}',
        '{"Server":{"Components":[{"Name":"Podman Engine"},{"Name":null}]}}',
    ])('makes no partial claim for invalid output %s', (stdout) => {
        expect(parseDockerServerComponentNames(stdout)).toBeUndefined();
    });
});

describe('resolveDockerSocketTarget', () => {
    const socketPath = '/var/run/docker.sock';

    it('uses realpath without reading the link when the target exists', async () => {
        const realpath = vi.fn().mockResolvedValue('/run/podman/podman.sock');
        const readlink = vi.fn();

        await expect(resolveDockerSocketTarget(socketPath, { realpath, readlink })).resolves.toEqual({
            target: '/run/podman/podman.sock',
        });
        expect(realpath).toHaveBeenCalledWith(socketPath);
        expect(readlink).not.toHaveBeenCalled();
    });

    it.each(['ENOENT', 'ENOTDIR', 'ELOOP', 'EINVAL'])(
        'reads the link after realpath returns %s, including a dangling target',
        async (code) => {
            const realpath = vi.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code }));
            const readlink = vi.fn().mockResolvedValue('../run/podman/podman.sock');

            await expect(resolveDockerSocketTarget(socketPath, { realpath, readlink })).resolves.toEqual({
                target: '../run/podman/podman.sock',
            });
            expect(realpath).toHaveBeenCalledTimes(1);
            expect(readlink).toHaveBeenCalledExactlyOnceWith(socketPath);
        },
    );

    it.each(['ENOENT', 'ENOTDIR', 'ELOOP', 'EINVAL'])(
        'silently returns no evidence when readlink returns %s',
        async (code) => {
            const realpath = vi.fn().mockRejectedValue({ code: 'ENOENT' });
            const readlink = vi.fn().mockRejectedValue({ code });

            await expect(resolveDockerSocketTarget(socketPath, { realpath, readlink })).resolves.toEqual({});
            expect(readlink).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        [{ code: 'EACCES' }, 'EACCES'],
        [{ code: 'EIO' }, 'EIO'],
        [new Error('private path'), 'unknown'],
        [{ code: 5 }, 'unknown'],
    ] as const)('reports an unexpected realpath failure without retrying: %j', async (error, errorCode) => {
        const realpath = vi.fn().mockRejectedValue(error);
        const readlink = vi.fn();

        await expect(resolveDockerSocketTarget(socketPath, { realpath, readlink })).resolves.toEqual({ errorCode });
        expect(realpath).toHaveBeenCalledTimes(1);
        expect(readlink).not.toHaveBeenCalled();
    });

    it.each([
        [{ code: 'EACCES' }, 'EACCES'],
        [new Error('private path'), 'unknown'],
    ] as const)('reports an unexpected readlink failure without retrying: %j', async (error, errorCode) => {
        const realpath = vi.fn().mockRejectedValue({ code: 'ENOENT' });
        const readlink = vi.fn().mockRejectedValue(error);

        await expect(resolveDockerSocketTarget(socketPath, { realpath, readlink })).resolves.toEqual({ errorCode });
        expect(realpath).toHaveBeenCalledTimes(1);
        expect(readlink).toHaveBeenCalledTimes(1);
    });
});

describe('probeDockerEndpoint', () => {
    it('returns EACCES without attempting a socket connection', async () => {
        const connect = vi.fn<(...args: []) => ReturnType<DockerEndpointProbeDependencies['connect']>>();
        const dependencies: DockerEndpointProbeDependencies = {
            access: async (): Promise<void> => {
                throw Object.assign(new Error('access denied'), { code: 'EACCES' });
            },
            connect,
        };

        const result = await probeDockerEndpoint(
            { kind: 'unixSocket', address: '/var/run/docker.sock', source: 'platformDefault' },
            undefined,
            dependencies,
        );

        expect(result).toEqual({
            kind: 'unixSocket',
            source: 'platformDefault',
            accessErrorCode: 'EACCES',
        });
        expect(connect).not.toHaveBeenCalled();
    });

    it('returns ECONNREFUSED when an accessible socket has no listener', async () => {
        const dependencies: DockerEndpointProbeDependencies = {
            access: async (): Promise<void> => undefined,
            connect: async (): Promise<void> => {
                throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
            },
        };

        const result = await probeDockerEndpoint(
            { kind: 'unixSocket', address: '/var/run/docker.sock', source: 'currentContext' },
            undefined,
            dependencies,
        );

        expect(result.accessErrorCode).toBe('ECONNREFUSED');
    });
});

describe('probeDockerSocketGroup', () => {
    const reporterProcessGroups = [1000, 4, 20, 24, 25, 27, 29, 30, 44, 46, 118];

    function dependencies(
        overrides: Partial<DockerSocketGroupProbeDependencies> = {},
    ): DockerSocketGroupProbeDependencies {
        return {
            stat: async () => ({ gid: 998 }),
            readGroupFile: async () => 'docker:x:998:tnaum\n',
            getProcessGroups: () => reporterProcessGroups,
            getProcessGid: () => 1000,
            getUsername: () => 'tnaum',
            ...overrides,
        };
    }

    it('detects the reporter membership missing from the current process', async () => {
        await expect(probeDockerSocketGroup('/var/run/docker.sock', dependencies())).resolves.toEqual({
            socketGid: 998,
            processHasSocketGroup: false,
            userIsGroupMember: true,
        });
    });

    it('returns unknown facts when process groups are unavailable', async () => {
        await expect(
            probeDockerSocketGroup('/var/run/docker.sock', dependencies({ getProcessGroups: () => undefined })),
        ).resolves.toEqual({});
    });

    it('keeps membership unknown when the group database is unreadable', async () => {
        const facts = await probeDockerSocketGroup(
            '/var/run/docker.sock',
            dependencies({
                readGroupFile: async () => {
                    throw new Error('unreadable');
                },
            }),
        );

        expect(facts.userIsGroupMember).toBeUndefined();
    });

    it('compares the socket gid with the effective gid as well as supplementary groups', async () => {
        const facts = await probeDockerSocketGroup(
            '/var/run/docker.sock',
            dependencies({ getProcessGroups: () => [], getProcessGid: () => 998 }),
        );

        expect(facts.processHasSocketGroup).toBe(true);
    });
});

describe('detectDockerServiceManager', () => {
    it.each([
        [['/run/systemd/system'], 'systemd'],
        [['/usr/sbin/service'], 'service'],
        [[], 'unknown'],
    ] as const)('detects paths %j as %s', async (existingPaths, expected) => {
        await expect(
            detectDockerServiceManager({
                pathExists: async (candidate) => (existingPaths as ReadonlyArray<string>).includes(candidate),
            }),
        ).resolves.toBe(expected);
    });
});
