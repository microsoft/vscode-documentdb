/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { type CancellationToken } from 'vscode';
import { isRootlessDockerEndpoint } from './dockerReadinessClassification';
import {
    type DockerHostEnvironment,
    type DockerLaunchResult,
    type DockerProvider,
    type DockerProviderEvidence,
    type DockerStartAction,
} from './quickStartTypes';

const PROCESS_DEADLINE_MS = 10_000;
const MACOS_DOCKER_APPLICATION = '/Applications/Docker.app';
const WSL_DOCKER_DESKTOP_EXECUTABLE = '/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe';
const DOCKER_DESKTOP_USER_SERVICE = 'docker-desktop.service';
const ROOTLESS_DOCKER_USER_SERVICE = 'docker.service';

interface DockerLauncherProcessResult {
    readonly exitCode?: number;
    readonly stdout: string;
}

export interface DockerStartCapabilityInput {
    readonly environment: DockerHostEnvironment;
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
    readonly endpointAddress?: string;
    readonly cancellationToken?: CancellationToken;
}

export interface DockerStartCapability {
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
    readonly startAction?: DockerStartAction;
}

export interface DockerProviderLauncherDependencies {
    readonly environmentVariables?: NodeJS.ProcessEnv;
    readonly pathExists?: (candidate: string) => Promise<boolean>;
    readonly runProcess?: (
        executable: string,
        args: ReadonlyArray<string>,
        cancellationToken?: CancellationToken,
    ) => Promise<DockerLauncherProcessResult>;
    readonly launchDetached?: (executable: string, args: ReadonlyArray<string>) => Promise<boolean>;
}

interface ResolvedLauncherDependencies {
    readonly environmentVariables: NodeJS.ProcessEnv;
    readonly pathExists: (candidate: string) => Promise<boolean>;
    readonly runProcess: (
        executable: string,
        args: ReadonlyArray<string>,
        cancellationToken?: CancellationToken,
    ) => Promise<DockerLauncherProcessResult>;
    readonly launchDetached: (executable: string, args: ReadonlyArray<string>) => Promise<boolean>;
}

function runBoundedProcess(
    executable: string,
    args: ReadonlyArray<string>,
    cancellationToken?: CancellationToken,
): Promise<DockerLauncherProcessResult> {
    return new Promise((resolve) => {
        const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        let stdout = '';
        let settled = false;
        const finish = (exitCode?: number): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(deadline);
            cancellation?.dispose();
            resolve({ exitCode, stdout });
        };
        const cancel = (): void => {
            child.kill();
            finish();
        };
        const deadline = setTimeout(cancel, PROCESS_DEADLINE_MS);
        const cancellation = cancellationToken?.onCancellationRequested(cancel);
        child.stdout.on('data', (chunk: unknown) => {
            stdout += String(chunk);
        });
        child.once('error', () => finish());
        child.once('close', (code) => finish(code ?? undefined));
        if (cancellationToken?.isCancellationRequested) {
            cancel();
        }
    });
}

function launchDetachedProcess(executable: string, args: ReadonlyArray<string>): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn(executable, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', () => resolve(false));
        child.once('spawn', () => {
            child.unref();
            resolve(true);
        });
    });
}

function resolveDependencies(dependencies: DockerProviderLauncherDependencies): ResolvedLauncherDependencies {
    return {
        environmentVariables: dependencies.environmentVariables ?? process.env,
        pathExists:
            dependencies.pathExists ??
            ((candidate: string): Promise<boolean> => Promise.resolve(fs.existsSync(candidate))),
        runProcess: dependencies.runProcess ?? runBoundedProcess,
        launchDetached: dependencies.launchDetached ?? launchDetachedProcess,
    };
}

function getWindowsDockerDesktopCandidates(environmentVariables: NodeJS.ProcessEnv): ReadonlyArray<string> {
    const roots = [environmentVariables['ProgramFiles'], environmentVariables['ProgramW6432'], 'C:\\Program Files'];
    return [...new Set(roots.filter((root): root is string => !!root))].map((root) =>
        path.join(root, 'Docker', 'Docker', 'Docker Desktop.exe'),
    );
}

async function findFirstExisting(
    candidates: ReadonlyArray<string>,
    dependencies: ResolvedLauncherDependencies,
): Promise<string | undefined> {
    for (const candidate of candidates) {
        if (await dependencies.pathExists(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

async function isUserServiceAvailable(
    service: string,
    dependencies: ResolvedLauncherDependencies,
    cancellationToken?: CancellationToken,
): Promise<boolean> {
    const result = await dependencies.runProcess(
        'systemctl',
        ['--user', 'show', '--property=LoadState', '--value', service],
        cancellationToken,
    );
    const loadState = result.stdout.trim();
    return result.exitCode === 0 && loadState.length > 0 && loadState !== 'not-found';
}

function unchangedCapability(input: DockerStartCapabilityInput): DockerStartCapability {
    return { provider: input.provider, providerEvidence: input.providerEvidence };
}

export async function getDockerStartCapability(
    input: DockerStartCapabilityInput,
    dependencyOverrides: DockerProviderLauncherDependencies = {},
): Promise<DockerStartCapability> {
    const dependencies = resolveDependencies(dependencyOverrides);
    switch (input.environment) {
        case 'windows': {
            if (input.provider === 'dockerEngine') {
                return unchangedCapability(input);
            }
            const executable = await findFirstExisting(
                getWindowsDockerDesktopCandidates(dependencies.environmentVariables),
                dependencies,
            );
            if (!executable) {
                return unchangedCapability(input);
            }
            return {
                provider: 'dockerDesktop',
                providerEvidence: input.provider === 'dockerDesktop' ? input.providerEvidence : 'installedApplication',
                startAction: 'startDockerDesktopWindows',
            };
        }
        case 'macos': {
            if (input.provider === 'dockerEngine' || !(await dependencies.pathExists(MACOS_DOCKER_APPLICATION))) {
                return unchangedCapability(input);
            }
            return {
                provider: 'dockerDesktop',
                providerEvidence: input.provider === 'dockerDesktop' ? input.providerEvidence : 'installedApplication',
                startAction: 'startDockerDesktopMacOS',
            };
        }
        case 'linux':
            if (
                input.provider === 'dockerDesktop' &&
                input.providerEvidence !== 'installedApplication' &&
                (await isUserServiceAvailable(DOCKER_DESKTOP_USER_SERVICE, dependencies, input.cancellationToken))
            ) {
                return { ...unchangedCapability(input), startAction: 'startDockerDesktopLinux' };
            }
            if (
                input.provider === 'dockerEngine' &&
                isRootlessDockerEndpoint(input.endpointAddress) &&
                (await isUserServiceAvailable(ROOTLESS_DOCKER_USER_SERVICE, dependencies, input.cancellationToken))
            ) {
                return { ...unchangedCapability(input), startAction: 'startRootlessDockerEngineLinux' };
            }
            return unchangedCapability(input);
        case 'wsl':
            if (
                input.provider === 'dockerDesktop' &&
                input.providerEvidence !== 'installedApplication' &&
                (await dependencies.pathExists(WSL_DOCKER_DESKTOP_EXECUTABLE))
            ) {
                return { ...unchangedCapability(input), startAction: 'startDockerDesktopWindowsFromWsl' };
            }
            return unchangedCapability(input);
        case 'ssh':
        case 'devContainer':
        case 'codespaces':
        case 'otherRemote':
        case 'unsupported':
            return unchangedCapability(input);
    }
}

async function startUserService(
    service: string,
    dependencies: ResolvedLauncherDependencies,
): Promise<DockerLaunchResult> {
    if (!(await isUserServiceAvailable(service, dependencies))) {
        return 'notAvailable';
    }
    const result = await dependencies.runProcess('systemctl', ['--user', 'start', service]);
    return result.exitCode === 0 ? 'started' : 'failed';
}

export async function startDockerProvider(
    action: DockerStartAction,
    dependencyOverrides: DockerProviderLauncherDependencies = {},
): Promise<DockerLaunchResult> {
    const dependencies = resolveDependencies(dependencyOverrides);
    switch (action) {
        case 'startDockerDesktopWindows': {
            const executable = await findFirstExisting(
                getWindowsDockerDesktopCandidates(dependencies.environmentVariables),
                dependencies,
            );
            if (!executable) {
                return 'notAvailable';
            }
            return (await dependencies.launchDetached(executable, [])) ? 'launchAttempted' : 'failed';
        }
        case 'startDockerDesktopMacOS':
            if (!(await dependencies.pathExists(MACOS_DOCKER_APPLICATION))) {
                return 'notAvailable';
            }
            return (await dependencies.runProcess('open', ['-a', 'Docker'])).exitCode === 0 ? 'started' : 'failed';
        case 'startDockerDesktopLinux':
            return startUserService(DOCKER_DESKTOP_USER_SERVICE, dependencies);
        case 'startDockerDesktopWindowsFromWsl':
            if (!(await dependencies.pathExists(WSL_DOCKER_DESKTOP_EXECUTABLE))) {
                return 'notAvailable';
            }
            return (await dependencies.launchDetached(WSL_DOCKER_DESKTOP_EXECUTABLE, []))
                ? 'launchAttempted'
                : 'failed';
        case 'startRootlessDockerEngineLinux':
            return startUserService(ROOTLESS_DOCKER_USER_SERVICE, dependencies);
    }
}
