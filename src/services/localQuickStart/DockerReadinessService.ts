/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash, CancellationTokenLike, Cmd, type Shell } from '@microsoft/vscode-processutils';
import { type Writable } from 'stream';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import {
    detectDockerServiceManager,
    normalizeDaemonArchitecture,
    parseDockerInfoFacts,
    probeDockerEndpoint,
    probeDockerSocketGroup,
    runDockerProbe,
    type ResolvedDockerEndpoint,
    type RunDockerProbeOptions,
} from './dockerProbes';
import { getDockerStartCapability } from './DockerProviderLauncher';
import {
    classifyDockerFailure,
    classifyDockerProvider,
    getDockerDiagnosticFingerprint,
} from './dockerReadinessClassification';
import { getDockerRecoveryCommand } from './dockerRecoveryCommands';
import {
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
} from './quickStartTypes';

export const READINESS_DEADLINE_MS = 15_000;
export const READINESS_MEMO_TTL_MS = 2_000;
export const PROVIDER_MEMORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const DOCKER_PROVIDER_MEMORY_KEY = 'documentdb.quickstart.dockerProvider';

interface DockerReadinessClient {
    checkInstall(options: object): Promise<PromiseCommandResponse<string>>;
    info(options: object): Promise<PromiseCommandResponse<unknown>>;
    listContexts(options: object): Promise<PromiseCommandResponse<ListContextItem[]>>;
}

export interface DockerProbeOutput {
    readonly onCommand?: (command: string) => void;
    readonly stdOutPipe?: Writable;
    readonly stdErrPipe?: Writable;
}

export interface DockerReadinessServiceDependencies {
    readonly client?: DockerReadinessClient;
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
    readonly detectServiceManager?: typeof detectDockerServiceManager;
    readonly getStartCapability?: typeof getDockerStartCapability;
    readonly readProviderMemory?: () => DockerProviderMemory | undefined;
    readonly writeProviderMemory?: (memory: DockerProviderMemory | undefined) => Promise<void>;
    readonly createProbeOutput?: () => DockerProbeOutput;
}

interface ResolvedDependencies {
    readonly client: DockerReadinessClient;
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

function getDefaultShell(platform: NodeJS.Platform): Shell {
    return platform === 'win32' ? new Cmd() : new Bash();
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

export class DockerReadinessService {
    private readonly dependencies: ResolvedDependencies;
    private inFlight: Promise<DockerReadiness> | undefined;
    private forcedRefresh: Promise<DockerReadiness> | undefined;
    private memoized: DockerReadiness | undefined;

    public constructor(dependencies: DockerReadinessServiceDependencies = {}) {
        const platform = dependencies.platform ?? process.platform;
        this.dependencies = {
            client: dependencies.client ?? new DockerClient(),
            shellProvider: dependencies.shellProvider ?? getDefaultShell(platform),
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
            detectServiceManager: dependencies.detectServiceManager ?? detectDockerServiceManager,
            getStartCapability: dependencies.getStartCapability ?? getDockerStartCapability,
            readProviderMemory: dependencies.readProviderMemory ?? readDefaultProviderMemory,
            writeProviderMemory: dependencies.writeProviderMemory ?? writeDefaultProviderMemory,
            createProbeOutput: dependencies.createProbeOutput,
        };
    }

    public async getReadiness(request: DockerReadinessRequest = {}): Promise<DockerReadiness> {
        if (request.forceRefresh) {
            if (this.forcedRefresh) {
                return this.forcedRefresh;
            }
            const refresh = this.runForcedRefresh(request);
            this.forcedRefresh = refresh;
            try {
                return await refresh;
            } finally {
                if (this.forcedRefresh === refresh) {
                    this.forcedRefresh = undefined;
                }
            }
        }

        if (this.inFlight) {
            return this.inFlight;
        }

        const now = this.dependencies.now();
        if (this.memoized && now - this.memoized.checkedAtMs < this.dependencies.memoTtlMs) {
            return this.memoized;
        }

        return this.runAndMemoize(request);
    }

    private async runForcedRefresh(request: DockerReadinessRequest): Promise<DockerReadiness> {
        if (this.inFlight) {
            try {
                await this.inFlight;
            } catch {
                // A forced refresh supersedes a canceled or failed prior check.
            }
        }
        this.memoized = undefined;
        await this.dependencies.writeProviderMemory(undefined);
        return this.runAndMemoize(request);
    }

    private async runAndMemoize(request: DockerReadinessRequest): Promise<DockerReadiness> {
        const check = this.runReadiness(request.cancellationToken, request.suppressCommandEcho === true);
        this.inFlight = check;
        try {
            const result = await check;
            this.memoized = result;
            return result;
        } finally {
            if (this.inFlight === check) {
                this.inFlight = undefined;
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
        const output = this.dependencies.createProbeOutput?.();
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
                stdOutPipe: output?.stdOutPipe,
                stdErrPipe: output?.stdErrPipe,
                now: this.dependencies.now,
            })
            .then((evidence) => {
                if (suppressCommandEcho && !isSuccessfulProbe(evidence) && commandText) {
                    output?.onCommand?.(commandText);
                }
                return evidence;
            });
    }

    private async readContexts(
        cancellationToken: vscode.CancellationToken,
        didDeadlineExpire: () => boolean,
        suppressCommandEcho: boolean,
    ): Promise<DockerContextProbeResult> {
        const response = await this.dependencies.client.listContexts({});
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

    public async recordLaunchResult(result: DockerLaunchResult): Promise<void> {
        if (result === 'notAvailable' || result === 'failed') {
            this.memoized = undefined;
            await this.dependencies.writeProviderMemory(undefined);
        }
    }

    private async runReadiness(
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
                    this.dependencies.client.checkInstall({}),
                    cancellationToken,
                    didDeadlineExpire,
                    suppressCommandEcho,
                ),
                this.runProbe(
                    'info',
                    this.dependencies.client.info({}),
                    cancellationToken,
                    didDeadlineExpire,
                    suppressCommandEcho,
                ),
            ]);

            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            const cliVersion = isSuccessfulProbe(versionProbe) ? versionProbe.stdout.trim() : undefined;
            if (infoProbe.spawnErrorCode === 'ENOENT') {
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
                    cliVersion,
                    daemonReachable: false,
                    arch: this.dependencies.arch,
                    platformSupported,
                };
            }
            const infoFacts = parseDockerInfoFacts(infoProbe.stdout);
            const infoSucceeded = isSuccessfulProbe(infoProbe) && infoFacts !== undefined;
            const hasServerErrors = (infoFacts?.serverErrors.length ?? 0) > 0;
            if (infoSucceeded && !hasServerErrors) {
                const configuredEndpoint = this.dependencies.environmentVariables['DOCKER_HOST'];
                const endpointKind: DockerEndpointKind = configuredEndpoint
                    ? endpointFromValue(configuredEndpoint, 'dockerHostEnv').kind
                    : 'unknown';
                const osType = normalizeDockerOsType(infoFacts.osType);
                const daemonArchitecture = infoFacts.architecture
                    ? normalizeDaemonArchitecture(infoFacts.architecture)
                    : undefined;
                const provider = classifyDockerProvider({
                    environment,
                    daemonReachable: true,
                    daemonOperatingSystem: infoFacts.operatingSystem,
                });
                await this.dependencies.writeProviderMemory({
                    provider: provider.provider,
                    endpointKind,
                    hostEnvironment: environment,
                    daemonArchitecture,
                    osType,
                    recordedAtMs: this.dependencies.now(),
                });
                if (osType === 'windows') {
                    return {
                        outcome: 'diagnosed',
                        environment,
                        endpointKind,
                        ...provider,
                        executionTarget: getDockerExecutionTarget(environment),
                        failureKind: 'windowsContainers',
                        canContinueAnyway: false,
                        checkedAtMs: this.dependencies.now(),
                        cliInstalled: true,
                        cliVersion,
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
                    executionTarget: getDockerExecutionTarget(environment),
                    canContinueAnyway: false,
                    checkedAtMs: this.dependencies.now(),
                    cliInstalled: true,
                    cliVersion,
                    daemonReachable: true,
                    osType,
                    daemonArchitecture,
                    arch: this.dependencies.arch,
                    platformSupported,
                };
            }

            let contexts: ListContextItem[] = [];
            let contextsResolved = false;
            if (!deadlineExpired && !this.dependencies.environmentVariables['DOCKER_HOST']) {
                const contextResult = await this.readContexts(
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

            const endpoint = resolveDockerEndpoint(
                this.dependencies.platform,
                this.dependencies.environmentVariables,
                contexts,
            );
            const endpointProbe = await this.dependencies.probeEndpoint(endpoint, cancellationToken);
            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            const requestedContext = this.dependencies.environmentVariables['DOCKER_CONTEXT'];
            const contextUnavailable =
                !!requestedContext &&
                contextsResolved &&
                !contexts.some((context) => context.name === requestedContext);
            const storedMemory = this.dependencies.readProviderMemory();
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
            const provider = classifyDockerProvider({
                environment,
                daemonReachable: false,
                contexts,
                activeEndpoint: endpoint,
                rememberedProvider,
            });
            if (
                rememberedProvider &&
                provider.providerEvidence === 'activeContext' &&
                provider.provider !== rememberedProvider.provider
            ) {
                await this.dependencies.writeProviderMemory(undefined);
            }
            const classification = classifyDockerFailure({
                infoProbe,
                endpointProbe,
                serverErrors: infoFacts?.serverErrors,
                contextUnavailable,
                providerMayBeStarting:
                    provider.provider === 'dockerDesktop' && provider.providerEvidence === 'rememberedProvider',
            });
            const startCapability = await this.dependencies.getStartCapability({
                environment,
                ...provider,
                endpointAddress: endpoint.address,
                cancellationToken,
            });
            let permissionDetail: DockerPermissionDetail | undefined;
            if (classification.failureKind === 'permissionDenied' && endpoint.kind === 'unixSocket') {
                const groupFacts = await this.dependencies.probeSocketGroup(endpoint.address);
                permissionDetail = resolveDockerPermissionDetail(groupFacts);
            }
            const serviceManager =
                classification.failureKind === 'daemonUnavailable' &&
                endpoint.kind === 'unixSocket' &&
                environment === 'wsl'
                    ? await this.dependencies.detectServiceManager()
                    : 'unknown';
            const failureResult = {
                environment,
                endpointKind: endpoint.kind,
                ...startCapability,
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
                ),
                checkedAtMs: this.dependencies.now(),
                cliInstalled: classification.failureKind !== 'cliMissing',
                cliVersion,
                daemonArchitecture: infoFacts?.architecture
                    ? normalizeDaemonArchitecture(infoFacts.architecture)
                    : undefined,
                diagnosticSummary: `${classification.failureKind}; endpoint source ${endpoint.source}`,
                diagnosticFingerprint:
                    classification.failureKind === 'unknown'
                        ? getDockerDiagnosticFingerprint([...(infoFacts?.serverErrors ?? []), infoProbe.stderr])
                        : undefined,
                arch: this.dependencies.arch,
                platformSupported,
            } as const;
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
