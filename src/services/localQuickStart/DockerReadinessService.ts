/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PodmanClient, type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { CancellationTokenLike, type Shell } from '@microsoft/vscode-processutils';
import { type Writable } from 'stream';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import {
    createContainerClient,
    findOnPath,
    resolveContainerCli,
    resolvePinnedContainerCli,
    type ContainerCli,
    type ResolvedContainerCli,
} from './containerCli';
import { getDockerShellProvider } from './dockerCommand';
import {
    detectDockerServiceManager,
    getErrorCode,
    normalizeDaemonArchitecture,
    parseDockerInfoFacts,
    parseDockerServerComponentNames,
    probeDockerEndpoint,
    probeDockerSocketGroup,
    resolveDockerSocketTarget,
    runDockerProbe,
    type ResolvedDockerEndpoint,
    type RunDockerProbeOptions,
} from './dockerProbes';
import { getDockerStartCapability, type DockerStartCapability } from './DockerProviderLauncher';
import {
    classifyContainerEngine,
    classifyDockerFailure,
    classifyDockerProvider,
    classifyPodmanTarget,
    getDockerDiagnosticFingerprint,
    isDockerCliNotFound,
    parsePodmanDialTarget,
} from './dockerReadinessClassification';
import { getDockerRecoveryCommand } from './dockerRecoveryCommands';
import {
    type ContainerCliPresence,
    type DockerEndpointKind,
    type DockerExecutionTarget,
    type DockerHostEnvironment,
    type DockerLaunchResult,
    type DockerPermissionDetail,
    type DockerProbeEvidence,
    type DockerProviderMemory,
    type DockerReadiness,
    type DockerReadinessRequest,
    type DockerSocketGroupFacts,
    type PodmanTarget,
} from './quickStartTypes';

export const READINESS_DEADLINE_MS = 15_000;
export const READINESS_MEMO_TTL_MS = 2_000;
export const PROVIDER_MEMORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DOCKER_PROVIDER_MEMORY_KEY = 'documentdb.quickstart.dockerProvider';

interface DockerReadinessClient {
    readonly id?: string;
    checkInstall(options: object): Promise<PromiseCommandResponse<string>>;
    info(options: object): Promise<PromiseCommandResponse<unknown>>;
    version(options: object): Promise<PromiseCommandResponse<unknown>>;
    listContexts(options: object): Promise<PromiseCommandResponse<ListContextItem[]>>;
}

export interface DockerProbeOutput {
    readonly onCommand?: (command: string) => void;
    readonly stdOutPipe?: Writable;
    readonly stdErrPipe?: Writable;
    readonly appendDiagnostic?: (line: string) => void;
}

export interface DockerReadinessServiceDependencies {
    readonly client?: DockerReadinessClient;
    /** Called once per check, so a CLI installed or removed since the last one is picked up. */
    readonly getClient?: (resolved: ResolvedContainerCli) => DockerReadinessClient;
    readonly getCliOnPath?: (resolved: ResolvedContainerCli) => ContainerCliPresence | undefined;
    readonly shellProvider?: Shell;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly environmentVariables?: NodeJS.ProcessEnv;
    readonly remoteName?: string;
    readonly deadlineMs?: number;
    readonly memoTtlMs?: number;
    readonly now?: () => number;
    readonly runProbe?: (options: RunDockerProbeOptions) => Promise<DockerProbeEvidence>;
    readonly probeEndpoint?: typeof probeDockerEndpoint;
    readonly probeSocketGroup?: typeof probeDockerSocketGroup;
    readonly resolveDockerSocketTarget?: typeof resolveDockerSocketTarget;
    readonly detectServiceManager?: typeof detectDockerServiceManager;
    readonly getStartCapability?: typeof getDockerStartCapability;
    readonly readProviderMemory?: () => DockerProviderMemory | undefined;
    readonly writeProviderMemory?: (memory: DockerProviderMemory | undefined) => Promise<void>;
    readonly createProbeOutput?: () => DockerProbeOutput;
}

interface ResolvedDependencies {
    readonly getClient: (resolved: ResolvedContainerCli) => DockerReadinessClient;
    readonly getCliOnPath: (resolved: ResolvedContainerCli) => ContainerCliPresence | undefined;
    readonly shellProvider: Shell;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly environmentVariables: NodeJS.ProcessEnv;
    readonly remoteName?: string;
    readonly deadlineMs: number;
    readonly memoTtlMs: number;
    readonly now: () => number;
    readonly runProbe: (options: RunDockerProbeOptions) => Promise<DockerProbeEvidence>;
    readonly probeEndpoint: typeof probeDockerEndpoint;
    readonly probeSocketGroup: typeof probeDockerSocketGroup;
    readonly resolveDockerSocketTarget: typeof resolveDockerSocketTarget;
    readonly detectServiceManager: typeof detectDockerServiceManager;
    readonly getStartCapability: typeof getDockerStartCapability;
    readonly readProviderMemory: () => DockerProviderMemory | undefined;
    readonly writeProviderMemory: (memory: DockerProviderMemory | undefined) => Promise<void>;
    readonly createProbeOutput?: () => DockerProbeOutput;
}

interface DockerContextProbeResult {
    readonly contexts: ReadonlyArray<ListContextItem>;
    readonly succeeded: boolean;
}

function isWslEnvironment(environmentVariables: NodeJS.ProcessEnv): boolean {
    return !!environmentVariables['WSL_DISTRO_NAME'] || !!environmentVariables['WSL_INTEROP'];
}

export function detectDockerHostEnvironment(
    platform: NodeJS.Platform,
    remoteName: string | undefined,
    environmentVariables: NodeJS.ProcessEnv,
): DockerHostEnvironment {
    switch (remoteName) {
        case 'codespaces':
            return 'codespaces';
        case 'dev-container':
            return 'devContainer';
        case 'ssh-remote':
            return 'ssh';
        case 'wsl':
            return 'wsl';
        case undefined:
            break;
        default:
            return 'otherRemote';
    }

    switch (platform) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'macos';
        case 'linux':
            return isWslEnvironment(environmentVariables) ? 'wsl' : 'linux';
        default:
            return 'unsupported';
    }
}

function endpointFromValue(value: string, source: ResolvedDockerEndpoint['source']): ResolvedDockerEndpoint {
    if (value.startsWith('unix://')) {
        return { kind: 'unixSocket', address: value.slice('unix://'.length), source };
    }
    if (value.startsWith('npipe://')) {
        return { kind: 'namedPipe', address: value.slice('npipe://'.length).replaceAll('/', '\\'), source };
    }
    if (value.startsWith('tcp://')) {
        return { kind: 'tcp', address: value, source };
    }
    if (value.startsWith('ssh://')) {
        return { kind: 'ssh', address: value, source };
    }
    return { kind: 'unknown', address: value, source };
}

export function resolveDockerEndpoint(
    platform: NodeJS.Platform,
    environmentVariables: NodeJS.ProcessEnv,
    contexts: ReadonlyArray<ListContextItem>,
): ResolvedDockerEndpoint {
    const dockerHost = environmentVariables['DOCKER_HOST'];
    if (dockerHost) {
        return endpointFromValue(dockerHost, 'dockerHostEnv');
    }

    const dockerContext = environmentVariables['DOCKER_CONTEXT'];
    if (dockerContext) {
        const selected = contexts.find((context) => context.name === dockerContext);
        return endpointFromValue(selected?.containerEndpoint ?? '', 'dockerContextEnv');
    }

    const current = contexts.find((context) => context.current);
    if (current?.containerEndpoint) {
        return endpointFromValue(current.containerEndpoint, 'currentContext');
    }

    if (platform === 'win32') {
        return { kind: 'namedPipe', address: '\\\\.\\pipe\\docker_engine', source: 'platformDefault' };
    }
    return { kind: 'unixSocket', address: '/var/run/docker.sock', source: 'platformDefault' };
}

function isSuccessfulProbe(evidence: DockerProbeEvidence): boolean {
    return evidence.endedBy === 'exit' && evidence.exitCode === undefined && evidence.spawnErrorCode === undefined;
}

function normalizeDockerOsType(osType: string | undefined): 'linux' | 'windows' | undefined {
    switch (osType?.toLowerCase()) {
        case 'linux':
            return 'linux';
        case 'windows':
            return 'windows';
        default:
            return undefined;
    }
}

function readDefaultProviderMemory(): DockerProviderMemory | undefined {
    return ext.context?.globalState.get<DockerProviderMemory>(DOCKER_PROVIDER_MEMORY_KEY);
}

async function writeDefaultProviderMemory(memory: DockerProviderMemory | undefined): Promise<void> {
    await ext.context?.globalState.update(DOCKER_PROVIDER_MEMORY_KEY, memory);
}

function isProviderMemoryCurrent(
    memory: DockerProviderMemory,
    environment: DockerHostEnvironment,
    endpointKind: DockerEndpointKind,
    now: number,
): boolean {
    if (memory.hostEnvironment !== environment || now - memory.recordedAtMs > PROVIDER_MEMORY_MAX_AGE_MS) {
        return false;
    }
    if (memory.recordedAtMs > now) {
        return false;
    }
    return memory.endpointKind === 'unknown' || endpointKind === 'unknown' || memory.endpointKind === endpointKind;
}

interface ReadinessCheckState {
    inFlight?: Promise<DockerReadiness>;
    forcedRefresh?: Promise<DockerReadiness>;
    memoized?: DockerReadiness;
}

export class DockerReadinessService {
    private readonly dependencies: ResolvedDependencies;
    private readonly checks = new Map<string, ReadinessCheckState>();
    private readonly suppliedClient: DockerReadinessClient | undefined;

    public constructor(dependencies: DockerReadinessServiceDependencies = {}) {
        const platform = dependencies.platform ?? process.platform;
        const client = dependencies.client;
        this.suppliedClient = dependencies.client;
        this.dependencies = {
            getClient: dependencies.getClient ?? (client ? () => client : createContainerClient),
            getCliOnPath: dependencies.getCliOnPath ?? (() => undefined),
            shellProvider: dependencies.shellProvider ?? getDockerShellProvider(platform),
            platform,
            arch: dependencies.arch ?? process.arch,
            environmentVariables: dependencies.environmentVariables ?? process.env,
            remoteName: dependencies.remoteName ?? vscode.env?.remoteName,
            deadlineMs: dependencies.deadlineMs ?? READINESS_DEADLINE_MS,
            memoTtlMs: dependencies.memoTtlMs ?? READINESS_MEMO_TTL_MS,
            now: dependencies.now ?? Date.now,
            runProbe: dependencies.runProbe ?? runDockerProbe,
            probeEndpoint: dependencies.probeEndpoint ?? probeDockerEndpoint,
            probeSocketGroup: dependencies.probeSocketGroup ?? probeDockerSocketGroup,
            resolveDockerSocketTarget: dependencies.resolveDockerSocketTarget ?? resolveDockerSocketTarget,
            detectServiceManager: dependencies.detectServiceManager ?? detectDockerServiceManager,
            getStartCapability: dependencies.getStartCapability ?? getDockerStartCapability,
            readProviderMemory: dependencies.readProviderMemory ?? readDefaultProviderMemory,
            writeProviderMemory: dependencies.writeProviderMemory ?? writeDefaultProviderMemory,
            createProbeOutput: dependencies.createProbeOutput,
        };
    }

    public async getReadiness(request: DockerReadinessRequest = {}): Promise<DockerReadiness> {
        const resolved =
            request.engine?.kind === 'pinned'
                ? resolvePinnedContainerCli(request.engine.cli)
                : this.suppliedClient && !request.engine
                  ? resolvePinnedContainerCli(this.suppliedClient.id === PodmanClient.ClientId ? 'podman' : 'docker')
                  : resolveContainerCli(request.engine?.kind === 'preferred' ? request.engine.preferred : 'docker');
        // A check pinned to an instance's owner reports no preference, so it cannot share a memo with one that does.
        const pinned = request.engine?.kind === 'pinned';
        const key = `${resolved.cli}|${resolved.executable}|${resolved.preferred}|${resolved.onPath.docker}|${resolved.onPath.podman}|${pinned}`;
        let state = this.checks.get(key);
        if (!state) {
            state = {};
            this.checks.set(key, state);
        }
        if (request.forceRefresh) {
            if (state.forcedRefresh) {
                return state.forcedRefresh;
            }
            const refresh = this.runForcedRefresh(request, resolved, state);
            state.forcedRefresh = refresh;
            try {
                return await refresh;
            } finally {
                if (state.forcedRefresh === refresh) {
                    state.forcedRefresh = undefined;
                }
            }
        }

        if (state.inFlight) {
            return state.inFlight;
        }

        const now = this.dependencies.now();
        if (state.memoized && now - state.memoized.checkedAtMs < this.dependencies.memoTtlMs) {
            return state.memoized;
        }

        return this.runAndMemoize(request, resolved, state);
    }

    private async runForcedRefresh(
        request: DockerReadinessRequest,
        resolved: ResolvedContainerCli,
        state: ReadinessCheckState,
    ): Promise<DockerReadiness> {
        if (state.inFlight) {
            try {
                await state.inFlight;
            } catch {
                // A forced refresh supersedes a canceled or failed prior check.
            }
        }
        state.memoized = undefined;
        if (resolved.cli === 'docker' && request.resetProviderMemory) {
            await this.dependencies.writeProviderMemory(undefined);
        }
        return this.runAndMemoize(request, resolved, state);
    }

    private async runAndMemoize(
        request: DockerReadinessRequest,
        resolved: ResolvedContainerCli,
        state: ReadinessCheckState,
    ): Promise<DockerReadiness> {
        const client = this.dependencies.getClient(resolved);
        const cliOnPath = this.dependencies.getCliOnPath(resolved);
        const cli = resolved.cli;
        const check = this.runReadiness(
            client,
            cli,
            request.cancellationToken,
            request.suppressCommandEcho === true,
        ).then(
            (readiness): DockerReadiness => ({
                ...readiness,
                cli,
                // The owner of an existing instance was not chosen for this run.
                ...(request.engine?.kind === 'pinned'
                    ? {}
                    : { preferredEngine: resolved.preferred, cliFallback: resolved.fellBack }),
                ...(cliOnPath !== undefined ? { cliOnPath } : {}),
            }),
        );
        state.inFlight = check;
        try {
            const result = await check;
            state.memoized = result;
            return result;
        } finally {
            if (state.inFlight === check) {
                state.inFlight = undefined;
            }
        }
    }

    private runProbe(
        probe: DockerProbeEvidence['probe'],
        command: RunDockerProbeOptions['command'],
        cancellationToken: vscode.CancellationToken,
        didDeadlineExpire: () => boolean,
        suppressCommandEcho: boolean,
    ): Promise<DockerProbeEvidence> {
        const output = suppressCommandEcho ? undefined : this.dependencies.createProbeOutput?.();
        // Raw daemon JSON stays out of the channel; runReadiness logs the info summary instead.
        const echoStdout = probe !== 'info' && probe !== 'serverVersion';
        let commandText: string | undefined;
        return this.dependencies
            .runProbe({
                probe,
                command,
                shellProvider: this.dependencies.shellProvider,
                cancellationToken,
                didDeadlineExpire,
                onCommand: (command: string): void => {
                    commandText = command;
                    if (!suppressCommandEcho) {
                        output?.onCommand?.(command);
                    }
                },
                stdOutPipe: echoStdout ? output?.stdOutPipe : undefined,
                stdErrPipe: output?.stdErrPipe,
                now: this.dependencies.now,
            })
            .then((evidence) => {
                if (suppressCommandEcho && !isSuccessfulProbe(evidence)) {
                    const failureOutput = this.dependencies.createProbeOutput?.();
                    if (commandText) {
                        failureOutput?.onCommand?.(commandText);
                    }
                    if (echoStdout) {
                        failureOutput?.stdOutPipe?.end(evidence.stdout);
                    }
                    failureOutput?.stdErrPipe?.end(evidence.stderr);
                }
                return evidence;
            });
    }

    private async readContexts(
        client: DockerReadinessClient,
        cancellationToken: vscode.CancellationToken,
        didDeadlineExpire: () => boolean,
        suppressCommandEcho: boolean,
    ): Promise<DockerContextProbeResult> {
        let response: PromiseCommandResponse<ListContextItem[]>;
        try {
            response = await client.listContexts({});
        } catch {
            // Podman has no contexts.
            return { contexts: [], succeeded: false };
        }
        const evidence = await this.runProbe(
            'contexts',
            response,
            cancellationToken,
            didDeadlineExpire,
            suppressCommandEcho,
        );
        if (!isSuccessfulProbe(evidence)) {
            return { contexts: [], succeeded: false };
        }
        try {
            return { contexts: await response.parse(evidence.stdout, false), succeeded: true };
        } catch {
            return { contexts: [], succeeded: false };
        }
    }

    public async recordLaunchResult(result: DockerLaunchResult, cli: ContainerCli): Promise<void> {
        if (result === 'notAvailable' || result === 'failed') {
            for (const state of this.checks.values()) {
                state.memoized = undefined;
            }
            if (cli === 'docker') {
                await this.dependencies.writeProviderMemory(undefined);
            }
        }
    }

    private async runReadiness(
        client: DockerReadinessClient,
        cli: 'docker' | 'podman',
        callerToken: vscode.CancellationToken | undefined,
        suppressCommandEcho: boolean,
    ): Promise<DockerReadiness> {
        const environment = detectDockerHostEnvironment(
            this.dependencies.platform,
            this.dependencies.remoteName,
            this.dependencies.environmentVariables,
        );
        const platformSupported = this.dependencies.arch === 'x64' || this.dependencies.arch === 'arm64';
        if (environment === 'unsupported') {
            return {
                outcome: 'diagnosed',
                environment,
                endpointKind: 'unknown',
                provider: 'unknown',
                providerEvidence: 'none',
                executionTarget: getDockerExecutionTarget(environment),
                failureKind: 'unsupportedHost',
                canContinueAnyway: false,
                checkedAtMs: this.dependencies.now(),
                cliInstalled: false,
                ...classifyContainerEngine({ cli, cliInstalled: false }),
                daemonReachable: false,
                arch: this.dependencies.arch,
                platformSupported: false,
            };
        }
        const cancellationController = new AbortController();
        const cancellationToken = CancellationTokenLike.fromAbortSignal(cancellationController.signal);
        let deadlineExpired = false;
        let callerCancelled = callerToken?.isCancellationRequested ?? false;
        const callerCancellation = callerToken?.onCancellationRequested(() => {
            callerCancelled = true;
            cancellationController.abort();
        });
        if (callerCancelled) {
            cancellationController.abort();
        }
        const deadline = setTimeout(() => {
            deadlineExpired = true;
            cancellationController.abort();
        }, this.dependencies.deadlineMs);
        const didDeadlineExpire = (): boolean => deadlineExpired;

        try {
            const [versionProbe, infoProbe] = await Promise.all([
                this.runProbe(
                    'cliVersion',
                    client.checkInstall({}),
                    cancellationToken,
                    didDeadlineExpire,
                    suppressCommandEcho,
                ),
                this.runProbe('info', client.info({}), cancellationToken, didDeadlineExpire, suppressCommandEcho),
            ]);

            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            const cliVersion = isSuccessfulProbe(versionProbe) ? versionProbe.stdout.trim() : undefined;
            // Podman ignores DOCKER_HOST and DOCKER_CONTEXT, so they must not describe or classify it.
            const endpointSettings: NodeJS.ProcessEnv = cli === 'podman' ? {} : this.dependencies.environmentVariables;
            const cliNotFound = isDockerCliNotFound(infoProbe);
            const cliInstalled = isSuccessfulProbe(versionProbe) || !cliNotFound;
            if (cliNotFound) {
                return {
                    outcome: 'diagnosed',
                    environment,
                    endpointKind: 'unknown',
                    provider: 'unknown',
                    providerEvidence: 'none',
                    executionTarget: getDockerExecutionTarget(environment),
                    failureKind: 'cliMissing',
                    canContinueAnyway: false,
                    checkedAtMs: this.dependencies.now(),
                    cliInstalled: false,
                    ...classifyContainerEngine({ cli, cliInstalled: false }),
                    cliVersion,
                    daemonReachable: false,
                    arch: this.dependencies.arch,
                    platformSupported,
                };
            }
            const infoFacts = parseDockerInfoFacts(infoProbe.stdout);
            const engineInput = {
                cli,
                cliInstalled,
                cliVersionStdout: versionProbe.stdout,
                cliVersionStderr: versionProbe.stderr,
                podmanInfo: infoFacts?.podmanInfo,
                daemonOperatingSystem: infoFacts?.operatingSystem,
            };
            const infoSucceeded = isSuccessfulProbe(infoProbe) && infoFacts !== undefined;
            const hasServerErrors = (infoFacts?.serverErrors.length ?? 0) > 0;
            if (infoSucceeded && !hasServerErrors) {
                const configuredEndpoint = endpointSettings['DOCKER_HOST'];
                let engine = classifyContainerEngine({ ...engineInput, endpointAddress: configuredEndpoint });
                if (cli === 'docker' && engine.engine !== 'podman') {
                    try {
                        const response = await client.version({});
                        const serverVersionProbe = await this.runProbe(
                            'serverVersion',
                            response,
                            cancellationToken,
                            didDeadlineExpire,
                            suppressCommandEcho,
                        );
                        if (isSuccessfulProbe(serverVersionProbe)) {
                            engine = classifyContainerEngine({
                                ...engineInput,
                                endpointAddress: configuredEndpoint,
                                serverComponentNames: parseDockerServerComponentNames(serverVersionProbe.stdout),
                            });
                        }
                    } catch (error) {
                        this.dependencies
                            .createProbeOutput?.()
                            ?.appendDiagnostic?.(
                                `[readiness] serverVersion=unavailable code=${getErrorCode(error) ?? 'unknown'}`,
                            );
                    }
                    if (callerCancelled) {
                        throw new vscode.CancellationError();
                    }
                }
                const endpointKind: DockerEndpointKind = configuredEndpoint
                    ? endpointFromValue(configuredEndpoint, 'dockerHostEnv').kind
                    : 'unknown';
                const osType = normalizeDockerOsType(infoFacts.osType);
                const daemonArchitecture = infoFacts.architecture
                    ? normalizeDaemonArchitecture(infoFacts.architecture)
                    : undefined;
                if (!suppressCommandEcho) {
                    this.dependencies
                        .createProbeOutput?.()
                        ?.appendDiagnostic?.(
                            `[readiness] docker server=${infoFacts.serverVersion ?? 'unknown'} os=${infoFacts.osType ?? 'unknown'}${infoFacts.operatingSystem ? ` (${infoFacts.operatingSystem})` : ''} arch=${infoFacts.architecture ?? 'unknown'}`,
                        );
                }
                const provider = classifyDockerProvider({
                    environment,
                    daemonReachable: true,
                    daemonOperatingSystem: infoFacts.operatingSystem,
                    engine: engine.engine,
                });
                if (cli === 'docker') {
                    await this.dependencies.writeProviderMemory({
                        provider: provider.provider === 'podman' ? 'unknown' : provider.provider,
                        endpointKind,
                        hostEnvironment: environment,
                        daemonArchitecture,
                        osType,
                        recordedAtMs: this.dependencies.now(),
                    });
                }
                if (osType === 'windows') {
                    return {
                        outcome: 'diagnosed',
                        environment,
                        endpointKind,
                        ...provider,
                        ...engine,
                        executionTarget: getDockerExecutionTarget(environment),
                        failureKind: 'windowsContainers',
                        canContinueAnyway: false,
                        checkedAtMs: this.dependencies.now(),
                        cliInstalled: true,
                        cliVersion,
                        serverVersion: infoFacts.serverVersion,
                        daemonReachable: true,
                        osType,
                        daemonArchitecture,
                        arch: this.dependencies.arch,
                        platformSupported,
                    };
                }
                return {
                    outcome: 'ready',
                    environment,
                    endpointKind,
                    ...provider,
                    ...engine,
                    executionTarget: getDockerExecutionTarget(environment),
                    canContinueAnyway: false,
                    checkedAtMs: this.dependencies.now(),
                    cliInstalled: true,
                    cliVersion,
                    serverVersion: infoFacts.serverVersion,
                    daemonReachable: true,
                    osType,
                    daemonArchitecture,
                    arch: this.dependencies.arch,
                    platformSupported,
                };
            }

            let contexts: ListContextItem[] = [];
            let contextsResolved = false;
            if (!deadlineExpired && cli !== 'podman' && !endpointSettings['DOCKER_HOST']) {
                const contextResult = await this.readContexts(
                    client,
                    cancellationToken,
                    didDeadlineExpire,
                    suppressCommandEcho,
                );
                contexts = [...contextResult.contexts];
                contextsResolved = contextResult.succeeded;
            }
            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            const endpoint = resolveDockerEndpoint(this.dependencies.platform, endpointSettings, contexts);
            const endpointProbe = await this.dependencies.probeEndpoint(endpoint, cancellationToken);
            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            let dockerSocketTarget: string | undefined;
            if (
                this.dependencies.platform !== 'win32' &&
                endpoint.kind === 'unixSocket' &&
                endpoint.address === '/var/run/docker.sock'
            ) {
                const socketTarget = await this.dependencies.resolveDockerSocketTarget(endpoint.address);
                dockerSocketTarget = socketTarget.target;
                if (socketTarget.errorCode) {
                    this.dependencies
                        .createProbeOutput?.()
                        ?.appendDiagnostic?.(`[readiness] socketLink=unavailable code=${socketTarget.errorCode}`);
                }
                if (callerCancelled) {
                    throw new vscode.CancellationError();
                }
            }

            const requestedContext = endpointSettings['DOCKER_CONTEXT'];
            const contextUnavailable =
                !!requestedContext &&
                contextsResolved &&
                !contexts.some((context) => context.name === requestedContext);
            const storedMemory = cli === 'docker' ? this.dependencies.readProviderMemory() : undefined;
            let rememberedProvider = storedMemory;
            if (contextUnavailable && rememberedProvider) {
                rememberedProvider = undefined;
                await this.dependencies.writeProviderMemory(undefined);
            }
            if (
                rememberedProvider &&
                !isProviderMemoryCurrent(rememberedProvider, environment, endpoint.kind, this.dependencies.now())
            ) {
                rememberedProvider = undefined;
                await this.dependencies.writeProviderMemory(undefined);
            }
            const engine = classifyContainerEngine({
                ...engineInput,
                endpointAddress: endpoint.address,
                dockerSocketTarget,
            });
            const isPodman = cli === 'podman' || engine.engineEvidence === 'podmanShim';
            const provider = !isPodman
                ? classifyDockerProvider({
                      environment,
                      daemonReachable: false,
                      contexts,
                      activeEndpoint: endpoint,
                      rememberedProvider,
                  })
                : { provider: 'unknown' as const, providerEvidence: 'none' as const };
            if (
                rememberedProvider &&
                provider.providerEvidence === 'activeContext' &&
                provider.provider !== rememberedProvider.provider
            ) {
                await this.dependencies.writeProviderMemory(undefined);
            }
            let classification = classifyDockerFailure({
                infoProbe,
                endpointProbe,
                serverErrors: infoFacts?.serverErrors,
                contextUnavailable,
                providerMayBeStarting:
                    provider.provider === 'dockerDesktop' && provider.providerEvidence === 'rememberedProvider',
            });
            let podmanTarget: PodmanTarget | undefined;
            if (isPodman && classification.failureKind === 'daemonUnavailable') {
                // The Podman CLI names the address it dialled; the Docker CLI shim uses the endpoint it resolved.
                podmanTarget = classifyPodmanTarget(
                    cli === 'podman'
                        ? parsePodmanDialTarget(infoProbe.stderr)
                        : endpoint.kind === 'unixSocket'
                          ? { transport: 'unix', path: dockerSocketTarget ?? endpoint.address }
                          : undefined,
                    environment,
                );
                this.dependencies
                    .createProbeOutput?.()
                    ?.appendDiagnostic?.(`[readiness] podmanTarget=${podmanTarget.kind}`);
                if (podmanTarget.kind === 'remote') {
                    classification = { failureKind: 'endpointUnreachable', outcome: 'diagnosed' };
                }
            }
            let startCapability: DockerStartCapability = provider;
            if (
                isPodman &&
                classification.failureKind === 'daemonUnavailable' &&
                (environment === 'macos' || environment === 'windows')
            ) {
                const podmanExecutable = findOnPath('podman', {
                    platform: this.dependencies.platform,
                    environmentVariables: this.dependencies.environmentVariables,
                });
                if (podmanExecutable) {
                    startCapability = await this.dependencies.getStartCapability(
                        {
                            environment,
                            provider: 'podman',
                            providerEvidence: 'none',
                            podmanExecutable,
                            cancellationToken,
                        },
                        { onOutput: (output) => this.dependencies.createProbeOutput?.().appendDiagnostic?.(output) },
                    );
                    if (callerCancelled) {
                        throw new vscode.CancellationError();
                    }
                }
                if (startCapability.podmanMachine?.kind === 'starting') {
                    classification = { failureKind: 'daemonStarting', outcome: 'diagnosed' };
                }
            } else if (!isPodman) {
                startCapability = await this.dependencies.getStartCapability({
                    environment,
                    ...provider,
                    endpointAddress: endpoint.address,
                    cancellationToken,
                });
            }
            let permissionDetail: DockerPermissionDetail | undefined;
            if (!isPodman && classification.failureKind === 'permissionDenied' && endpoint.kind === 'unixSocket') {
                const groupFacts = await this.dependencies.probeSocketGroup(endpoint.address);
                permissionDetail = resolveDockerPermissionDetail(groupFacts);
            }
            const serviceManager =
                !isPodman &&
                classification.failureKind === 'daemonUnavailable' &&
                endpoint.kind === 'unixSocket' &&
                environment === 'wsl'
                    ? await this.dependencies.detectServiceManager()
                    : 'unknown';
            const failureResult = {
                environment,
                ...engine,
                // Podman ignores Docker's endpoint settings, so Docker's endpoint does not describe it.
                ...(cli === 'podman'
                    ? { endpointKind: 'unknown' as const }
                    : { endpointKind: endpoint.kind, endpointSource: endpoint.source }),
                ...startCapability,
                ...(podmanTarget ? { podmanTarget } : {}),
                providerRecordedAtMs:
                    startCapability.providerEvidence === 'rememberedProvider'
                        ? rememberedProvider?.recordedAtMs
                        : undefined,
                executionTarget: getDockerExecutionTarget(environment),
                permissionDetail,
                recoveryCommand: getDockerRecoveryCommand(
                    classification.failureKind,
                    environment,
                    endpoint.kind,
                    permissionDetail,
                    serviceManager,
                    isPodman ? { machine: startCapability.podmanMachine, target: podmanTarget } : undefined,
                ),
                checkedAtMs: this.dependencies.now(),
                cliInstalled,
                cliVersion,
                serverVersion: infoFacts?.serverVersion,
                daemonArchitecture: infoFacts?.architecture
                    ? normalizeDaemonArchitecture(infoFacts.architecture)
                    : undefined,
                diagnosticFingerprint:
                    classification.failureKind === 'unknown'
                        ? getDockerDiagnosticFingerprint([...(infoFacts?.serverErrors ?? []), infoProbe.stderr])
                        : undefined,
                arch: this.dependencies.arch,
                platformSupported,
            } as const;
            const diagnosticOutput = this.dependencies.createProbeOutput?.();
            diagnosticOutput?.appendDiagnostic?.(
                `[readiness] failureKind=${classification.failureKind} outcome=${classification.outcome}`,
            );
            diagnosticOutput?.appendDiagnostic?.(
                `[readiness] environment=${environment} endpoint=${endpoint.kind} source=${endpoint.source}`,
            );
            diagnosticOutput?.appendDiagnostic?.(
                `[readiness] provider=${startCapability.provider} evidence=${startCapability.providerEvidence}`,
            );
            if (infoProbe.stderr.trim()) {
                diagnosticOutput?.appendDiagnostic?.(`[readiness] stderr: ${infoProbe.stderr.trim()}`);
            }
            for (const serverError of infoFacts?.serverErrors ?? []) {
                diagnosticOutput?.appendDiagnostic?.(`[readiness] server error: ${serverError}`);
            }
            if (classification.outcome === 'diagnosed') {
                return {
                    ...failureResult,
                    ...classification,
                    canContinueAnyway: false,
                    daemonReachable: false,
                };
            }
            return {
                ...failureResult,
                ...classification,
                canContinueAnyway: true,
                daemonReachable: false,
            };
        } finally {
            clearTimeout(deadline);
            callerCancellation?.dispose();
        }
    }
}

export function getDockerExecutionTarget(environment: DockerHostEnvironment): DockerExecutionTarget {
    switch (environment) {
        case 'windows':
        case 'macos':
        case 'linux':
        case 'unsupported':
            return 'local';
        case 'wsl':
            return 'wsl';
        case 'ssh':
            return 'ssh';
        case 'devContainer':
            return 'devContainer';
        case 'codespaces':
            return 'codespaces';
        case 'otherRemote':
            return 'otherRemote';
    }
}

export function resolveDockerPermissionDetail(facts: DockerSocketGroupFacts): DockerPermissionDetail {
    if (facts.userIsGroupMember === true && facts.processHasSocketGroup === false) {
        return 'pendingSessionRestart';
    }
    if (facts.userIsGroupMember === false) {
        return 'notInGroup';
    }
    return 'unknown';
}
