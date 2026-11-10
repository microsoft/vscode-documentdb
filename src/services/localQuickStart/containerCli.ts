/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, PodmanClient } from '@microsoft/vscode-container-client';
import * as fs from 'fs';
import * as path from 'path';
import { type ContainerCliPresence } from './quickStartTypes';

export type ContainerCli = 'docker' | 'podman';

export type ContainerEngineRequest =
    | { readonly kind: 'preferred'; readonly preferred: ContainerCli }
    | { readonly kind: 'pinned'; readonly cli: ContainerCli };

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

export interface ResolvedContainerCli {
    readonly cli: ContainerCli;
    /** What the client runs: the bare name, or on Windows the absolute path. */
    readonly executable: string;
    readonly onPath: ContainerCliPresence;
    readonly preferred: ContainerCli;
    readonly fellBack: boolean;
}

/** The first match on PATH, honouring PATHEXT on Windows. */
export function findOnPath(command: string, lookup: ContainerCliLookup = {}): string | undefined {
    const platform = lookup.platform ?? process.platform;
    const env = lookup.environmentVariables ?? process.env;
    const isExecutable = lookup.isExecutable ?? isExecutableFile;
    const pathValue = (platform === 'win32' ? (env['Path'] ?? env['PATH']) : env['PATH']) ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const extensions =
        platform === 'win32' ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
    for (const entry of pathValue.split(delimiter).filter(Boolean)) {
        // Windows allows `"C:\Program Files\X";…`; `which` strips the quotes too.
        const dir = entry.replace(/^"(.*)"$/, '$1');
        for (const extension of extensions) {
            const candidate = pathApi.join(dir, command + extension);
            if (isExecutable(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/**
 * Prefer the requested CLI, falling back only when it is missing from PATH.
 */
export function resolveContainerCli(
    preferred: ContainerCli = 'docker',
    lookup: ContainerCliLookup = {},
): ResolvedContainerCli {
    const docker = findOnPath('docker', lookup);
    const podman = findOnPath('podman', lookup);
    const preferredFound = preferred === 'docker' ? docker : podman;
    const other = preferred === 'docker' ? 'podman' : 'docker';
    const otherFound = other === 'docker' ? docker : podman;
    const cli = !preferredFound && otherFound ? other : preferred;
    const found = cli === 'docker' ? docker : podman;
    // On Windows the container client caches each bare name's `which` result for the process
    // lifetime, so a CLI that moved would keep failing; an absolute path skips that cache.
    const executable = (lookup.platform ?? process.platform) === 'win32' && found ? found : cli;
    return {
        cli,
        executable,
        onPath: { docker: !!docker, podman: !!podman },
        preferred,
        fellBack: cli !== preferred,
    };
}

/** An instance's owning engine must never fall back to another engine. */
export function resolvePinnedContainerCli(cli: ContainerCli, lookup: ContainerCliLookup = {}): ResolvedContainerCli {
    const resolved = resolveContainerCli(cli, lookup);
    return {
        ...resolved,
        cli,
        executable: resolved.cli === cli ? resolved.executable : cli,
        fellBack: false,
    };
}

export function createContainerClient({
    cli,
    executable,
}: Pick<ResolvedContainerCli, 'cli' | 'executable'>): DockerClient | PodmanClient {
    return cli === 'podman' ? new PodmanClient(executable) : new DockerClient(executable);
}
