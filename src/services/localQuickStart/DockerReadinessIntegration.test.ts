/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash } from '@microsoft/vscode-processutils';
import { DockerReadinessService, type DockerReadinessServiceDependencies } from './DockerReadinessService';
import { getDockerStartCapability } from './DockerProviderLauncher';
import { type RunDockerProbeOptions } from './dockerProbes';
import { type DockerProbeEvidence } from './quickStartTypes';

function commandResponse<T>(args: string[], parse: (output: string) => T): PromiseCommandResponse<T> {
    return {
        command: 'docker',
        args,
        parse: async (output: string): Promise<T> => parse(output),
    };
}

function createClient(): NonNullable<DockerReadinessServiceDependencies['client']> {
    return {
        checkInstall: async () => commandResponse(['-v'], (output) => output),
        info: async () => commandResponse(['info'], (output) => JSON.parse(output) as unknown),
        listContexts: async () =>
            commandResponse<ListContextItem[]>(['context', 'ls'], (output) => JSON.parse(output) as ListContextItem[]),
    };
}

function evidence(
    probe: DockerProbeEvidence['probe'],
    overrides: Partial<DockerProbeEvidence> = {},
): DockerProbeEvidence {
    return {
        probe,
        stdout: '',
        stderr: '',
        endedBy: 'exit',
        durationMs: 1,
        ...overrides,
    };
}

describe('DockerReadinessService integration scenarios', () => {
    it('keeps native WSL permission evidence ahead of an installed Windows Desktop application', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1, stderr: 'permission denied' });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', {
                    stdout: JSON.stringify([
                        { name: 'default', current: true, containerEndpoint: 'unix:///var/run/docker.sock' },
                    ]),
                });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            remoteName: 'wsl',
            environmentVariables: { WSL_DISTRO_NAME: 'Ubuntu' },
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'EACCES',
            }),
            probeSocketGroup: async () => ({}),
            getStartCapability: (input) =>
                getDockerStartCapability(input, {
                    pathExists: async () => true,
                }),
        });

        const result = await service.getReadiness();

        expect(result).toMatchObject({
            environment: 'wsl',
            failureKind: 'permissionDenied',
            provider: 'unknown',
            providerEvidence: 'none',
        });
        expect(result.startAction).toBeUndefined();
    });

    it('reports remote daemon architecture and execution target instead of the client architecture', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({
                        OSType: 'linux',
                        OperatingSystem: 'Ubuntu 24.04',
                        Architecture: 'x86_64',
                        ServerErrors: [],
                    }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            arch: 'arm64',
            remoteName: 'ssh-remote',
            environmentVariables: {},
            runProbe,
            writeProviderMemory: async () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'ready',
            environment: 'ssh',
            executionTarget: 'ssh',
            daemonArchitecture: 'amd64',
            arch: 'arm64',
            provider: 'dockerEngine',
        });
    });
});