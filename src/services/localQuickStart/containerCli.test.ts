/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, PodmanClient } from '@microsoft/vscode-container-client';
import { describe, expect, it, vi } from 'vitest';
import {
    type ContainerCli,
    createContainerClient,
    findOnPath,
    resolveContainerCli,
    resolvePinnedContainerCli,
} from './containerCli';

function lookup(present: ReadonlyArray<string>, platform: NodeJS.Platform = 'darwin', env?: NodeJS.ProcessEnv) {
    return {
        platform,
        environmentVariables: env ?? { PATH: '/usr/local/bin:/opt/podman/bin' },
        isExecutable: (filePath: string) => present.includes(filePath),
    };
}

const windowsEnv = { Path: 'C:\\Windows;C:\\Program Files\\RedHat\\Podman;C:\\tools', PATHEXT: '.COM;.EXE;.CMD' };

describe('resolveContainerCli', () => {
    it('defaults the preference to Docker', () => {
        expect(
            resolveContainerCli(undefined, lookup(['/usr/local/bin/docker', '/opt/podman/bin/podman'])),
        ).toMatchObject({ cli: 'docker', preferred: 'docker', fellBack: false });
    });

    it('prefers docker when both are on PATH', () => {
        expect(resolveContainerCli('docker', lookup(['/usr/local/bin/docker', '/opt/podman/bin/podman']))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: true },
            preferred: 'docker',
            fellBack: false,
        });
    });

    it('falls back to podman when docker is missing', () => {
        expect(resolveContainerCli('docker', lookup(['/opt/podman/bin/podman']))).toEqual({
            cli: 'podman',
            executable: 'podman',
            onPath: { docker: false, podman: true },
            preferred: 'docker',
            fellBack: true,
        });
    });

    it('stays on docker when neither is installed so readiness reports the missing CLI', () => {
        expect(resolveContainerCli('docker', lookup([]))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: false, podman: false },
            preferred: 'docker',
            fellBack: false,
        });
    });

    it('runs the absolute podman.exe path on Windows, found through Path and PATHEXT', () => {
        expect(
            resolveContainerCli(
                'docker',
                lookup(['C:\\Program Files\\RedHat\\Podman\\podman.EXE'], 'win32', windowsEnv),
            ),
        ).toEqual({
            cli: 'podman',
            executable: 'C:\\Program Files\\RedHat\\Podman\\podman.EXE',
            onPath: { docker: false, podman: true },
            preferred: 'docker',
            fellBack: true,
        });
    });

    it('follows podman to its new location on Windows', () => {
        expect(resolveContainerCli('docker', lookup(['C:\\tools\\podman.CMD'], 'win32', windowsEnv)).executable).toBe(
            'C:\\tools\\podman.CMD',
        );
    });

    it('reads a quoted Windows PATH entry', () => {
        const env = { Path: '"C:\\Program Files\\RedHat\\Podman";C:\\Windows', PATHEXT: '.EXE' };
        expect(
            resolveContainerCli('docker', lookup(['C:\\Program Files\\RedHat\\Podman\\podman.EXE'], 'win32', env)),
        ).toEqual({
            cli: 'podman',
            executable: 'C:\\Program Files\\RedHat\\Podman\\podman.EXE',
            onPath: { docker: false, podman: true },
            preferred: 'docker',
            fellBack: true,
        });
    });

    it('reports Docker alone on PATH without changing the selected executable', () => {
        expect(resolveContainerCli('docker', lookup(['/usr/local/bin/docker']))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: false },
            preferred: 'docker',
            fellBack: false,
        });
    });

    it('looks up each CLI once even when Docker wins', () => {
        const isExecutable = vi.fn(() => true);
        expect(
            resolveContainerCli('docker', {
                platform: 'linux',
                environmentVariables: { PATH: '/usr/bin' },
                isExecutable,
            }),
        ).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: true },
            preferred: 'docker',
            fellBack: false,
        });
        expect(isExecutable.mock.calls).toEqual([['/usr/bin/docker'], ['/usr/bin/podman']]);
    });

    it('ignores empty PATH entries instead of probing the working directory', () => {
        expect(findOnPath('podman', lookup(['podman'], 'linux', { PATH: ':/usr/bin:' }))).toBeUndefined();
    });

    it.each(['docker', 'podman'] as const)('resolves %s across the complete PATH presence matrix', (preferred) => {
        for (const docker of [false, true]) {
            for (const podman of [false, true]) {
                const present = [
                    ...(docker ? ['/usr/local/bin/docker'] : []),
                    ...(podman ? ['/opt/podman/bin/podman'] : []),
                ];
                const other = preferred === 'docker' ? 'podman' : 'docker';
                const onPath = { docker, podman };
                const cli: ContainerCli = onPath[preferred] || !onPath[other] ? preferred : other;
                expect(resolveContainerCli(preferred, lookup(present))).toEqual({
                    cli,
                    executable: cli,
                    onPath,
                    preferred,
                    fellBack: cli !== preferred,
                });
            }
        }
    });

    it('checks both CLIs even when the preferred Podman is found', () => {
        const isExecutable = vi.fn(() => true);
        resolveContainerCli('podman', {
            platform: 'linux',
            environmentVariables: { PATH: '/usr/bin' },
            isExecutable,
        });
        expect(isExecutable.mock.calls).toEqual([['/usr/bin/docker'], ['/usr/bin/podman']]);
    });

    it('re-reads changed PATH on the next resolution', () => {
        const environmentVariables = { PATH: '/old' };
        const options = lookup(['/old/docker', '/new/podman'], 'linux', environmentVariables);
        expect(resolveContainerCli('podman', options)).toMatchObject({ cli: 'docker', fellBack: true });
        environmentVariables.PATH = '/new';
        expect(resolveContainerCli('podman', options)).toMatchObject({ cli: 'podman', fellBack: false });
    });

    it('preserves the preferred Windows executable and PATHEXT order', () => {
        expect(
            resolveContainerCli(
                'podman',
                lookup(
                    ['C:\\tools\\docker.EXE', 'C:\\tools\\podman.COM', 'C:\\tools\\podman.EXE'],
                    'win32',
                    windowsEnv,
                ),
            ),
        ).toMatchObject({
            cli: 'podman',
            executable: 'C:\\tools\\podman.COM',
            preferred: 'podman',
            fellBack: false,
        });
    });
});

describe('createContainerClient', () => {
    it('builds the matching client around the resolved executable', () => {
        expect(createContainerClient({ cli: 'docker', executable: 'docker' })).toBeInstanceOf(DockerClient);
        const podman = createContainerClient({ cli: 'podman', executable: 'C:\\tools\\podman.CMD' });
        expect(podman).toBeInstanceOf(PodmanClient);
        expect(podman.commandName).toBe('C:\\tools\\podman.CMD');
    });

    describe('resolvePinnedContainerCli', () => {
        it('keeps Podman when Docker is also installed', () => {
            expect(
                resolvePinnedContainerCli('podman', lookup(['/usr/local/bin/docker', '/opt/podman/bin/podman'])),
            ).toEqual({
                cli: 'podman',
                executable: 'podman',
                onPath: { docker: true, podman: true },
                preferred: 'podman',
                fellBack: false,
            });
        });

        it('does not fall back to installed Docker when pinned Podman is missing', () => {
            expect(resolvePinnedContainerCli('podman', lookup(['/usr/local/bin/docker']))).toEqual({
                cli: 'podman',
                executable: 'podman',
                onPath: { docker: true, podman: false },
                preferred: 'podman',
                fellBack: false,
            });
        });

        it('uses the pinned absolute executable on Windows', () => {
            expect(
                resolvePinnedContainerCli('podman', lookup(['C:\\tools\\podman.CMD'], 'win32', windowsEnv)),
            ).toMatchObject({ cli: 'podman', executable: 'C:\\tools\\podman.CMD' });
        });
    });
});
