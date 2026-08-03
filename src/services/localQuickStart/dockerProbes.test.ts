/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Bash, ChildProcessError } from '@microsoft/vscode-processutils';
import { type Writable } from 'stream';
import {
    normalizeDaemonArchitecture,
    parseDockerInfoFacts,
    probeDockerEndpoint,
    runDockerProbe,
    type DockerEndpointProbeDependencies,
} from './dockerProbes';

const command = { command: 'docker', args: ['info'] };

describe('runDockerProbe', () => {
    it('captures stdout and stderr when Docker exits nonzero', async () => {
        const execute = async (_command: unknown, stdout: Writable, stderr: Writable): Promise<void> => {
            stdout.write('{"ServerErrors":["permission denied"]}');
            stderr.write('daemon error');
            throw new ChildProcessError('Process exited with code 1', 1, null);
        };
        const now = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(112);

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
});

describe('parseDockerInfoFacts', () => {
    it('reads raw daemon facts and server errors', () => {
        expect(
            parseDockerInfoFacts(
                JSON.stringify({
                    OSType: 'linux',
                    Architecture: 'x86_64',
                    ServerVersion: '27.5.1',
                    ServerErrors: ['permission denied'],
                    IgnoredByLocalSchema: true,
                }),
            ),
        ).toEqual({
            osType: 'linux',
            architecture: 'x86_64',
            serverVersion: '27.5.1',
            serverErrors: ['permission denied'],
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

describe('probeDockerEndpoint', () => {
    it('returns EACCES without attempting a socket connection', async () => {
        const connect = jest.fn<ReturnType<DockerEndpointProbeDependencies['connect']>, []>();
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
