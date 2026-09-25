/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerReadiness } from '../../../services/localQuickStart/quickStartTypes';

export function getDockerReadinessTelemetryProperties(readiness: DockerReadiness): Readonly<Record<string, string>> {
    const properties: Record<string, string> = {
        dockerReadinessOutcome: readiness.outcome,
        dockerHostEnvironment: readiness.environment,
        dockerEndpointKind: readiness.endpointKind,
        dockerProvider: readiness.provider,
        dockerProviderEvidence: readiness.providerEvidence,
        dockerFailureKind: readiness.failureKind ?? 'none',
        dockerPermissionDetail: readiness.permissionDetail ?? 'none',
        dockerStartAction: readiness.startAction ?? 'none',
        dockerOsType: readiness.osType ?? 'unknown',
        dockerCanContinueAnyway: readiness.canContinueAnyway ? 'true' : 'false',
        dockerDaemonReachable: readiness.daemonReachable ? 'true' : 'false',
    };
    if (readiness.failureKind === 'unknown' && readiness.diagnosticFingerprint) {
        properties.dockerDiagnosticFingerprint = readiness.diagnosticFingerprint;
    }
    return properties;
}
