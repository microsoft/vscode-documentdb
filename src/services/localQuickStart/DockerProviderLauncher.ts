/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { type CancellationToken } from 'vscode';
import {
    classifyPodmanMachineState,
    isRootlessDockerEndpoint,
    parsePodmanMachineList,
} from './dockerReadinessClassification';
import {
    type DockerHostEnvironment,
    type DockerLaunchResult,
    type DockerProvider,
    type DockerProviderEvidence,
    type DockerStartAction,
    type PodmanMachineState,
} from './quickStartTypes';

const PROCESS_DEADLINE_MS = 10_000;
const STARTUP_OBSERVATION_MS = 3_000;
const MACOS_DOCKER_APPLICATION = '/Applications/Docker.app';
const WSL_DOCKER_DESKTOP_EXECUTABLE = '/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe';
const DOCKER_DESKTOP_USER_SERVICE = 'docker-desktop.service';
const ROOTLESS_DOCKER_USER_SERVICE = 'docker.service';

interface DockerLauncherProcessResult {
    readonly exitCode?: number;
    readonly stdout: string;
}

interface DockerStartupExit {
    readonly exitCode?: number;
    readonly stderr: string;
}

interface DockerStartupProcess {
    readonly spawned: Promise<boolean>;
    readonly exit: Promise<DockerStartupExit>;
}

export interface DockerStartCapabilityInput {
    readonly environment: DockerHostEnvironment;
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
    readonly endpointAddress?: string;
    readonly cancellationToken?: CancellationToken;
    readonly podmanExecutable?: string;
}

export interface DockerStartCapability {
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
    readonly startAction?: DockerStartAction;
    readonly podmanMachine?: PodmanMachineState;
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
    readonly startLongRunning?: (
        executable: string,
        args: ReadonlyArray<string>,
        onOutput: (output: string) => void,
    ) => DockerStartupProcess;
    readonly onOutput?: (output: string) => void;
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
    readonly startLongRunning: NonNullable<DockerProviderLauncherDependencies['startLongRunning']>;
    readonly onOutput: (output: string) => void;
}

function startLongRunningProcess(
    executable: string,
    args: ReadonlyArray<string>,
    onOutput: (output: string) => void,
): DockerStartupProcess {
    let finishSpawn: (spawned: boolean) => void = () => undefined;
    let finishExit: (result: DockerStartupExit) => void = () => undefined;
    const spawned = new Promise<boolean>((resolve) => {
        finishSpawn = resolve;
    });
    const exit = new Promise<DockerStartupExit>((resolve) => {
        finishExit = resolve;
    });
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stdout.on('data', (chunk: unknown) => onOutput(String(chunk)));
    child.stderr.on('data', (chunk: unknown) => {
        stderr += String(chunk);
        onOutput(String(chunk));
    });
    child.once('spawn', () => finishSpawn(true));
    child.once('error', (error) => {
        finishSpawn(false);
        stderr += error.message;
        onOutput(error.message);
        finishExit({ stderr });
    });
    child.once('close', (code) => finishExit({ exitCode: code ?? undefined, stderr }));
    return { spawned, exit };
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
        startLongRunning: dependencies.startLongRunning ?? startLongRunningProcess,
        onOutput: dependencies.onOutput ?? (() => undefined),
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
    if (input.provider === 'podman') {
        if (!input.podmanExecutable || (input.environment !== 'macos' && input.environment !== 'windows')) {
            return unchangedCapability(input);
        }
        if (
            input.environment === 'windows' &&
            (!path.win32.isAbsolute(input.podmanExecutable) || /\.(?:cmd|bat)$/i.test(input.podmanExecutable))
        ) {
            dependencies.onOutput(
                '[readiness] podmanMachine=unknown: an absolute non-batch Podman executable is required',
            );
            return { ...unchangedCapability(input), podmanMachine: { kind: 'unknown' } };
        }
        try {
            const result = await dependencies.runProcess(
                input.podmanExecutable,
                ['machine', 'list', '--format', 'json'],
                input.cancellationToken,
            );
            const machines = result.exitCode === 0 ? parsePodmanMachineList(result.stdout) : undefined;
            if (!machines) {
                dependencies.onOutput(
                    '[readiness] podmanMachine=unknown: machine list failed or returned invalid JSON',
                );
                return { ...unchangedCapability(input), podmanMachine: { kind: 'unknown' } };
            }
            const podmanMachine = classifyPodmanMachineState(machines);
            return {
                ...unchangedCapability(input),
                podmanMachine,
                ...(podmanMachine.kind === 'stopped' ? { startAction: 'startPodmanMachine' as const } : {}),
            };
        } catch (error) {
            dependencies.onOutput(
                `[readiness] podmanMachine=unknown: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { ...unchangedCapability(input), podmanMachine: { kind: 'unknown' } };
        }
    }
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
    input?: DockerStartCapabilityInput,
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
        case 'startPodmanMachine': {
            if (!input?.podmanExecutable || input.provider !== 'podman') {
                return 'notAvailable';
            }
            const capability = await getDockerStartCapability(input, dependencyOverrides);
            if (capability.podmanMachine?.kind === 'running') {
                return 'started';
            }
            if (capability.podmanMachine?.kind === 'starting') {
                return 'launchAttempted';
            }
            if (capability.startAction !== action || capability.podmanMachine?.kind !== 'stopped') {
                return 'notAvailable';
            }
            const name = capability.podmanMachine.name;
            const process = dependencies.startLongRunning(
                input.podmanExecutable,
                ['machine', 'start', name],
                dependencies.onOutput,
            );
            const completion = process.exit.then((result): DockerLaunchResult => {
                const alreadyRunning = result.stderr
                    .split(/\r?\n/)
                    .some(
                        (line) =>
                            line === `Error: unable to start "${name}": already running` ||
                            line === `unable to start "${name}": already running`,
                    );
                const launchResult = result.exitCode === 0 || alreadyRunning ? 'started' : 'failed';
                dependencies.onOutput(
                    `[startup] podman machine "${name}" ${launchResult} (exit=${result.exitCode ?? 'unknown'})${result.stderr ? `\n${result.stderr}` : ''}`,
                );
                return launchResult;
            });
            if (!(await process.spawned)) {
                return 'failed';
            }
            let observation: ReturnType<typeof setTimeout> | undefined;
            try {
                return await Promise.race([
                    completion,
                    new Promise<DockerLaunchResult>((resolve) => {
                        observation = setTimeout(() => resolve('launchAttempted'), STARTUP_OBSERVATION_MS);
                    }),
                ]);
            } finally {
                clearTimeout(observation);
            }
        }
    }
}
