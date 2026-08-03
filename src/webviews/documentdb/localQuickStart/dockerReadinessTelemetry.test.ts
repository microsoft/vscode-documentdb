/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DockerReadiness } from '../../../services/localQuickStart/quickStartTypes';
import { getDockerReadinessTelemetryProperties } from './dockerReadinessTelemetry';

function unknownReadiness(): DockerReadiness {
    return {
        outcome: 'indeterminate',
        environment: 'ssh',
        endpointKind: 'tcp',
        provider: 'unknown',
        providerEvidence: 'none',
        executionTarget: 'ssh',
        failureKind: 'unknown',
        canContinueAnyway: true,
        checkedAtMs: 1,
        cliInstalled: true,
        daemonReachable: false,
        diagnosticSummary: 'unknown; endpoint source dockerHostEnv',
        diagnosticFingerprint: '0123456789abcdef',
    };
}

describe('getDockerReadinessTelemetryProperties', () => {
    it('returns categorized fields and a pre-redacted unknown fingerprint', () => {
        expect(getDockerReadinessTelemetryProperties(unknownReadiness())).toEqual({
            dockerReadinessOutcome: 'indeterminate',
            dockerHostEnvironment: 'ssh',
            dockerEndpointKind: 'tcp',
            dockerProvider: 'unknown',
            dockerProviderEvidence: 'none',
            dockerFailureKind: 'unknown',
            dockerPermissionDetail: 'none',
            dockerStartAction: 'none',
            dockerOsType: 'unknown',
            dockerCanContinueAnyway: 'true',
            dockerDaemonReachable: 'false',
            dockerDiagnosticFingerprint: '0123456789abcdef',
        });
    });

    it('does not emit diagnostics or fingerprints for a diagnosed failure', () => {
        const readiness: DockerReadiness = {
            ...unknownReadiness(),
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            canContinueAnyway: false,
            diagnosticSummary: 'private raw text must not be emitted',
        };

        const properties = getDockerReadinessTelemetryProperties(readiness);

        expect(properties.dockerDiagnosticFingerprint).toBeUndefined();
        expect(Object.values(properties)).not.toContain(readiness.diagnosticSummary);
    });
});