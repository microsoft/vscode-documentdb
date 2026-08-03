/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerEndpointProbe,
    type DockerFailureKind,
    type DockerProbeEvidence,
    type DockerReadinessOutcome,
} from './quickStartTypes';

export interface DockerFailureClassification {
    readonly failureKind: DockerFailureKind;
    readonly outcome: Exclude<DockerReadinessOutcome, 'ready'>;
}

export interface DockerFailureEvidence {
    readonly infoProbe: DockerProbeEvidence;
    readonly endpointProbe?: DockerEndpointProbe;
    readonly serverErrors?: ReadonlyArray<string>;
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

    const isLocalEndpoint =
        evidence.endpointProbe?.kind === 'unixSocket' || evidence.endpointProbe?.kind === 'namedPipe';
    if (isLocalEndpoint && hasSignature(errorText, DAEMON_UNAVAILABLE_SIGNATURES)) {
        return { failureKind: 'daemonUnavailable', outcome: 'diagnosed' };
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