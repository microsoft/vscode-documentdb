/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, PodmanClient } from '@microsoft/vscode-container-client';
import * as fs from 'fs';
import * as path from 'path';

export type ContainerCli = 'docker' | 'podman';

export interface ContainerCliLookup {
    readonly platform?: NodeJS.Platform;
    readonly environmentVariables?: NodeJS.ProcessEnv;
    readonly isExecutable?: (filePath: string) => boolean;
}

function isExecutableFile(filePath: string): boolean {
    try {
        fs.accessSync(filePath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

export function isOnPath(command: string, lookup: ContainerCliLookup = {}): boolean {
    const platform = lookup.platform ?? process.platform;
    const env = lookup.environmentVariables ?? process.env;
    const isExecutable = lookup.isExecutable ?? isExecutableFile;
    const pathValue = (platform === 'win32' ? (env['Path'] ?? env['PATH']) : env['PATH']) ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const extensions =
        platform === 'win32' ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
    return pathValue
        .split(delimiter)
        .filter(Boolean)
        .some((dir) => extensions.some((extension) => isExecutable(pathApi.join(dir, command + extension))));
}

/**
 * Docker when its CLI is on PATH, else Podman when that is, else Docker so readiness reports the
 * missing CLI the way it always has.
 */
export function resolveContainerCli(lookup: ContainerCliLookup = {}): ContainerCli {
    if (isOnPath('docker', lookup)) {
        return 'docker';
    }
    return isOnPath('podman', lookup) ? 'podman' : 'docker';
}

export function createContainerClient(cli: ContainerCli): DockerClient | PodmanClient {
    return cli === 'podman' ? new PodmanClient() : new DockerClient();
}
