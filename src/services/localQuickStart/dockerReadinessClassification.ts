/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerEndpointKind,
    type DockerEndpointProbe,
    type DockerFailureKind,
    type DockerHostEnvironment,
    type DockerProbeEvidence,
    type DockerProvider,
    type DockerProviderEvidence,
    type DockerProviderMemory,
    type DockerReadinessOutcome,
} from './quickStartTypes';

export type DockerFailureClassification =
    | {
          readonly failureKind: Exclude<DockerFailureKind, 'probeTimedOut' | 'unknown'>;
          readonly outcome: Extract<DockerReadinessOutcome, 'diagnosed'>;
      }
    | {
          readonly failureKind: Extract<DockerFailureKind, 'probeTimedOut' | 'unknown'>;
          readonly outcome: Extract<DockerReadinessOutcome, 'indeterminate'>;
      };

export interface DockerFailureEvidence {
    readonly infoProbe: DockerProbeEvidence;
    readonly endpointProbe?: DockerEndpointProbe;
    readonly serverErrors?: ReadonlyArray<string>;
    readonly contextUnavailable?: boolean;
    readonly providerMayBeStarting?: boolean;
}

export interface DockerProviderContext {
    readonly name: string;
    readonly current: boolean;
    readonly containerEndpoint?: string;
}

export interface DockerProviderEndpoint {
    readonly kind: DockerEndpointKind;
    readonly address: string;
}

export interface DockerProviderClassificationEvidence {
    readonly environment: DockerHostEnvironment;
    readonly daemonReachable: boolean;
    readonly daemonOperatingSystem?: string;
    readonly contexts?: ReadonlyArray<DockerProviderContext>;
    readonly activeEndpoint?: DockerProviderEndpoint;
    readonly rememberedProvider?: DockerProviderMemory;
    readonly dockerDesktopInstalled?: boolean;
}

export interface DockerProviderClassification {
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
}

const PERMISSION_SIGNATURES: ReadonlyArray<RegExp> = [
    /(?:permission|access) denied/i,
    /permission_denied/i,
    /connect: eacces/i,
];

const DAEMON_UNAVAILABLE_SIGNATURES: ReadonlyArray<RegExp> = [
    /cannot connect to the docker daemon/i,
    /is the docker daemon running/i,
    /error during connect/i,
    /connection refused/i,
];

const CONTEXT_UNAVAILABLE_SIGNATURES: ReadonlyArray<RegExp> = [
    /context ["'][^"']+["'] (?:does not exist|not found)/i,
    /no context exists with the name/i,
];

const DOCKER_DESKTOP_CONTEXT_NAMES = new Set(['desktop-linux', 'desktop-windows']);
const DOCKER_DESKTOP_ENDPOINT_SIGNATURES: ReadonlyArray<RegExp> = [
    /[\\/]pipe[\\/]dockerdesktoplinuxengine$/i,
    /[\\/]\.docker[\\/](?:desktop|run)[\\/]docker\.sock$/i,
];
const ROOTLESS_DOCKER_ENDPOINT_SIGNATURE = /[\\/]run[\\/]user[\\/]\d+[\\/]docker\.sock$/i;

function hasSignature(values: ReadonlyArray<string>, signatures: ReadonlyArray<RegExp>): boolean {
    return values.some((value) => signatures.some((signature) => signature.test(value)));
}

function classifyDockerFailureCore(evidence: DockerFailureEvidence): DockerFailureClassification {
    if (evidence.infoProbe.spawnErrorCode === 'ENOENT') {
        return { failureKind: 'cliMissing', outcome: 'diagnosed' };
    }

    if (evidence.endpointProbe?.accessErrorCode === 'EACCES') {
        return { failureKind: 'permissionDenied', outcome: 'diagnosed' };
    }

    const errorText = [...(evidence.serverErrors ?? []), evidence.infoProbe.stderr];
    if (hasSignature(errorText, PERMISSION_SIGNATURES)) {
        return { failureKind: 'permissionDenied', outcome: 'diagnosed' };
    }

    if (
        evidence.endpointProbe?.accessErrorCode === 'ENOENT' ||
        evidence.endpointProbe?.accessErrorCode === 'ECONNREFUSED'
    ) {
        return { failureKind: 'daemonUnavailable', outcome: 'diagnosed' };
    }

    if (evidence.contextUnavailable || hasSignature(errorText, CONTEXT_UNAVAILABLE_SIGNATURES)) {
        return { failureKind: 'contextUnavailable', outcome: 'diagnosed' };
    }

    const isLocalEndpoint =
        evidence.endpointProbe?.kind === 'unixSocket' || evidence.endpointProbe?.kind === 'namedPipe';
    if (isLocalEndpoint && hasSignature(errorText, DAEMON_UNAVAILABLE_SIGNATURES)) {
        return { failureKind: 'daemonUnavailable', outcome: 'diagnosed' };
    }

    if (evidence.providerMayBeStarting) {
        return { failureKind: 'daemonStarting', outcome: 'diagnosed' };
    }

    const isRemoteEndpoint = evidence.endpointProbe?.kind === 'tcp' || evidence.endpointProbe?.kind === 'ssh';
    if (isRemoteEndpoint) {
        return { failureKind: 'endpointUnreachable', outcome: 'diagnosed' };
    }

    if (evidence.infoProbe.endedBy === 'deadline') {
        return { failureKind: 'probeTimedOut', outcome: 'indeterminate' };
    }

    return { failureKind: 'unknown', outcome: 'indeterminate' };
}

export function classifyDockerFailure(evidence: DockerFailureEvidence): DockerFailureClassification {
    try {
        return classifyDockerFailureCore(evidence);
    } catch {
        return { failureKind: 'unknown', outcome: 'indeterminate' };
    }
}

function isDockerDesktopOperatingSystem(operatingSystem: string | undefined): boolean {
    return operatingSystem !== undefined && /(?:^|\s)docker desktop(?:\s|$)/i.test(operatingSystem);
}

function isDockerDesktopEndpoint(endpoint: string | undefined): boolean {
    return endpoint !== undefined && DOCKER_DESKTOP_ENDPOINT_SIGNATURES.some((signature) => signature.test(endpoint));
}

export function isRootlessDockerEndpoint(endpoint: string | undefined): boolean {
    return endpoint !== undefined && ROOTLESS_DOCKER_ENDPOINT_SIGNATURE.test(endpoint);
}

function getCurrentContext(contexts: ReadonlyArray<DockerProviderContext>): DockerProviderContext | undefined {
    return contexts.find((context) => context.current);
}

function canUseInstalledDesktopEvidence(environment: DockerHostEnvironment): boolean {
    return environment === 'windows' || environment === 'macos';
}

export function classifyDockerProvider(
    evidence: DockerProviderClassificationEvidence,
): DockerProviderClassification {
    if (evidence.daemonReachable) {
        if (!evidence.daemonOperatingSystem) {
            return { provider: 'unknown', providerEvidence: 'liveDaemon' };
        }
        return {
            provider: isDockerDesktopOperatingSystem(evidence.daemonOperatingSystem)
                ? 'dockerDesktop'
                : 'dockerEngine',
            providerEvidence: 'liveDaemon',
        };
    }

    const currentContext = getCurrentContext(evidence.contexts ?? []);
    if (
        (currentContext && DOCKER_DESKTOP_CONTEXT_NAMES.has(currentContext.name.toLowerCase())) ||
        isDockerDesktopEndpoint(currentContext?.containerEndpoint) ||
        isDockerDesktopEndpoint(evidence.activeEndpoint?.address)
    ) {
        return { provider: 'dockerDesktop', providerEvidence: 'activeContext' };
    }
    if (
        isRootlessDockerEndpoint(currentContext?.containerEndpoint) ||
        isRootlessDockerEndpoint(evidence.activeEndpoint?.address)
    ) {
        return { provider: 'dockerEngine', providerEvidence: 'activeContext' };
    }

    if (
        evidence.rememberedProvider &&
        evidence.rememberedProvider.hostEnvironment === evidence.environment &&
        evidence.rememberedProvider.provider !== 'unknown'
    ) {
        return {
            provider: evidence.rememberedProvider.provider,
            providerEvidence: 'rememberedProvider',
        };
    }

    if (evidence.dockerDesktopInstalled && canUseInstalledDesktopEvidence(evidence.environment)) {
        return { provider: 'dockerDesktop', providerEvidence: 'installedApplication' };
    }

    return { provider: 'unknown', providerEvidence: 'none' };
}
