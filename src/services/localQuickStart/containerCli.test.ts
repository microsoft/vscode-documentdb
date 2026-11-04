/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, PodmanClient } from '@microsoft/vscode-container-client';
import { describe, expect, it } from 'vitest';
import { createContainerClient, isOnPath, resolveContainerCli } from './containerCli';

function lookup(present: ReadonlyArray<string>, platform: NodeJS.Platform = 'darwin', env?: NodeJS.ProcessEnv) {
    return {
        platform,
        environmentVariables: env ?? { PATH: '/usr/local/bin:/opt/podman/bin' },
        isExecutable: (filePath: string) => present.includes(filePath),
    };
}

describe('resolveContainerCli', () => {
    it('prefers docker when both are on PATH', () => {
        expect(resolveContainerCli(lookup(['/usr/local/bin/docker', '/opt/podman/bin/podman']))).toBe('docker');
    });

    it('falls back to podman when docker is missing', () => {
        expect(resolveContainerCli(lookup(['/opt/podman/bin/podman']))).toBe('podman');
    });

    it('stays on docker when neither is installed so readiness reports the missing CLI', () => {
        expect(resolveContainerCli(lookup([]))).toBe('docker');
    });

    it('finds podman.exe through Path and PATHEXT on Windows', () => {
        const env = { Path: 'C:\\Windows;C:\\Program Files\\RedHat\\Podman', PATHEXT: '.COM;.EXE' };
        expect(resolveContainerCli(lookup(['C:\\Program Files\\RedHat\\Podman\\podman.EXE'], 'win32', env))).toBe(
            'podman',
        );
    });

    it('ignores empty PATH entries instead of probing the working directory', () => {
        expect(isOnPath('podman', lookup(['podman'], 'linux', { PATH: ':/usr/bin:' }))).toBe(false);
    });
});

describe('createContainerClient', () => {
    it('builds the matching client', () => {
        expect(createContainerClient('docker')).toBeInstanceOf(DockerClient);
        expect(createContainerClient('podman')).toBeInstanceOf(PodmanClient);
    });
});
