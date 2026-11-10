/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, PodmanClient } from '@microsoft/vscode-container-client';
import { describe, expect, it, vi } from 'vitest';
import { createContainerClient, findOnPath, resolveContainerCli } from './containerCli';

function lookup(present: ReadonlyArray<string>, platform: NodeJS.Platform = 'darwin', env?: NodeJS.ProcessEnv) {
    return {
        platform,
        environmentVariables: env ?? { PATH: '/usr/local/bin:/opt/podman/bin' },
        isExecutable: (filePath: string) => present.includes(filePath),
    };
}

const windowsEnv = { Path: 'C:\\Windows;C:\\Program Files\\RedHat\\Podman;C:\\tools', PATHEXT: '.COM;.EXE;.CMD' };

describe('resolveContainerCli', () => {
    it('prefers docker when both are on PATH', () => {
        expect(resolveContainerCli(lookup(['/usr/local/bin/docker', '/opt/podman/bin/podman']))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: true },
        });
    });

    it('falls back to podman when docker is missing', () => {
        expect(resolveContainerCli(lookup(['/opt/podman/bin/podman']))).toEqual({
            cli: 'podman',
            executable: 'podman',
            onPath: { docker: false, podman: true },
        });
    });

    it('stays on docker when neither is installed so readiness reports the missing CLI', () => {
        expect(resolveContainerCli(lookup([]))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: false, podman: false },
        });
    });

    it('runs the absolute podman.exe path on Windows, found through Path and PATHEXT', () => {
        expect(
            resolveContainerCli(lookup(['C:\\Program Files\\RedHat\\Podman\\podman.EXE'], 'win32', windowsEnv)),
        ).toEqual({
            cli: 'podman',
            executable: 'C:\\Program Files\\RedHat\\Podman\\podman.EXE',
            onPath: { docker: false, podman: true },
        });
    });

    it('follows podman to its new location on Windows', () => {
        expect(resolveContainerCli(lookup(['C:\\tools\\podman.CMD'], 'win32', windowsEnv)).executable).toBe(
            'C:\\tools\\podman.CMD',
        );
    });

    it('reads a quoted Windows PATH entry', () => {
        const env = { Path: '"C:\\Program Files\\RedHat\\Podman";C:\\Windows', PATHEXT: '.EXE' };
        expect(resolveContainerCli(lookup(['C:\\Program Files\\RedHat\\Podman\\podman.EXE'], 'win32', env))).toEqual({
            cli: 'podman',
            executable: 'C:\\Program Files\\RedHat\\Podman\\podman.EXE',
            onPath: { docker: false, podman: true },
        });
    });

    it('reports Docker alone on PATH without changing the selected executable', () => {
        expect(resolveContainerCli(lookup(['/usr/local/bin/docker']))).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: false },
        });
    });

    it('looks up each CLI once even when Docker wins', () => {
        const isExecutable = vi.fn(() => true);
        expect(
            resolveContainerCli({
                platform: 'linux',
                environmentVariables: { PATH: '/usr/bin' },
                isExecutable,
            }),
        ).toEqual({
            cli: 'docker',
            executable: 'docker',
            onPath: { docker: true, podman: true },
        });
        expect(isExecutable.mock.calls).toEqual([['/usr/bin/docker'], ['/usr/bin/podman']]);
    });

    it('ignores empty PATH entries instead of probing the working directory', () => {
        expect(findOnPath('podman', lookup(['podman'], 'linux', { PATH: ':/usr/bin:' }))).toBeUndefined();
    });
});

describe('createContainerClient', () => {
    it('builds the matching client around the resolved executable', () => {
        expect(createContainerClient({ cli: 'docker', executable: 'docker' })).toBeInstanceOf(DockerClient);
        const podman = createContainerClient({ cli: 'podman', executable: 'C:\\tools\\podman.CMD' });
        expect(podman).toBeInstanceOf(PodmanClient);
        expect(podman.commandName).toBe('C:\\tools\\podman.CMD');
    });
});
