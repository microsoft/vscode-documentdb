/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerClient, type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash, CancellationTokenLike, Cmd, type Shell } from '@microsoft/vscode-processutils';
import { type Writable } from 'stream';
import * as vscode from 'vscode';
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
import { classifyDockerFailure } from './dockerReadinessClassification';
import { getDockerRecoveryCommand } from './dockerRecoveryCommands';
import {
    type DockerEndpointKind,
    type DockerExecutionTarget,
    type DockerHostEnvironment,
    type DockerPermissionDetail,
    type DockerProbeEvidence,
    type DockerReadiness,
    type DockerReadinessRequest,
    type DockerSocketGroupFacts,
} from './quickStartTypes';

export const READINESS_DEADLINE_MS = 15_000;
export const READINESS_MEMO_TTL_MS = 2_000;

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
    readonly createProbeOutput?: () => DockerProbeOutput;
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

export class DockerReadinessService {
    private readonly dependencies: ResolvedDependencies;
    private inFlight: Promise<DockerReadiness> | undefined;
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
            createProbeOutput: dependencies.createProbeOutput,
        };
    }

    public async getReadiness(request: DockerReadinessRequest = {}): Promise<DockerReadiness> {
        if (this.inFlight) {
            return this.inFlight;
        }

        const now = this.dependencies.now();
        if (!request.forceRefresh && this.memoized && now - this.memoized.checkedAtMs < this.dependencies.memoTtlMs) {
            return this.memoized;
        }

        const check = this.runReadiness(request.cancellationToken);
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
    ): Promise<DockerProbeEvidence> {
        const output = this.dependencies.createProbeOutput?.();
        return this.dependencies.runProbe({
            probe,
            command,
            shellProvider: this.dependencies.shellProvider,
            cancellationToken,
            didDeadlineExpire,
            onCommand: output?.onCommand,
            stdOutPipe: output?.stdOutPipe,
            stdErrPipe: output?.stdErrPipe,
            now: this.dependencies.now,
        });
    }

    private async readContexts(
        cancellationToken: vscode.CancellationToken,
        didDeadlineExpire: () => boolean,
    ): Promise<ListContextItem[]> {
        const response = await this.dependencies.client.listContexts({});
        const evidence = await this.runProbe('contexts', response, cancellationToken, didDeadlineExpire);
        if (!isSuccessfulProbe(evidence)) {
            return [];
        }
        try {
            return await response.parse(evidence.stdout, false);
        } catch {
            return [];
        }
    }

    private async runReadiness(callerToken?: vscode.CancellationToken): Promise<DockerReadiness> {
        const environment = detectDockerHostEnvironment(
            this.dependencies.platform,
            this.dependencies.remoteName,
            this.dependencies.environmentVariables,
        );
        const platformSupported = this.dependencies.arch === 'x64' || this.dependencies.arch === 'arm64';
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
                ),
                this.runProbe('info', this.dependencies.client.info({}), cancellationToken, didDeadlineExpire),
            ]);

            if (callerCancelled) {
                throw new vscode.CancellationError();
            }

            const cliVersion = isSuccessfulProbe(versionProbe) ? versionProbe.stdout.trim() : undefined;
            const infoFacts = parseDockerInfoFacts(infoProbe.stdout);
            const infoSucceeded = isSuccessfulProbe(infoProbe) && infoFacts !== undefined;
            const hasServerErrors = (infoFacts?.serverErrors.length ?? 0) > 0;
            if (infoSucceeded && !hasServerErrors) {
                const configuredEndpoint = this.dependencies.environmentVariables['DOCKER_HOST'];
                const endpointKind: DockerEndpointKind = configuredEndpoint
                    ? endpointFromValue(configuredEndpoint, 'dockerHostEnv').kind
                    : 'unknown';
                return {
                    outcome: 'ready',
                    environment,
                    endpointKind,
                    provider: 'unknown',
                    providerEvidence: 'none',
                    executionTarget: getDockerExecutionTarget(environment),
                    canContinueAnyway: false,
                    checkedAtMs: this.dependencies.now(),
                    cliInstalled: true,
                    cliVersion,
                    daemonReachable: true,
                    osType: normalizeDockerOsType(infoFacts.osType),
                    daemonArchitecture: infoFacts.architecture
                        ? normalizeDaemonArchitecture(infoFacts.architecture)
                        : undefined,
                    arch: this.dependencies.arch,
                    platformSupported,
                };
            }

            let contexts: ListContextItem[] = [];
            if (!deadlineExpired && !this.dependencies.environmentVariables['DOCKER_HOST']) {
                contexts = await this.readContexts(cancellationToken, didDeadlineExpire);
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

            const classification = classifyDockerFailure({
                infoProbe,
                endpointProbe,
                serverErrors: infoFacts?.serverErrors,
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
                provider: 'unknown',
                providerEvidence: 'none',
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
