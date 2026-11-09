/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

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
        endpointSource: 'dockerHostEnv',
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
            containerEngine: 'unknown',
            containerEngineEvidence: 'none',
            dockerDiagnosticFingerprint: '0123456789abcdef',
        });
    });

    it('records the selected CLI independently from the detected engine', () => {
        const dockerCliReadiness: DockerReadiness = {
            ...unknownReadiness(),
            cli: 'docker',
            engine: 'docker',
            engineEvidence: 'selectedCli',
        };
        const podmanCliReadiness: DockerReadiness = {
            ...unknownReadiness(),
            cli: 'podman',
            engine: 'podman',
            engineEvidence: 'selectedCli',
        };
        const dockerCliOnPodmanReadiness: DockerReadiness = {
            ...unknownReadiness(),
            cli: 'docker',
            engine: 'podman',
            engineEvidence: 'serverComponents',
        };

        expect(getDockerReadinessTelemetryProperties(dockerCliReadiness)).toMatchObject({
            containerCli: 'docker',
            containerEngine: 'docker',
            containerEngineEvidence: 'selectedCli',
        });
        expect(getDockerReadinessTelemetryProperties(podmanCliReadiness)).toMatchObject({
            containerCli: 'podman',
            containerEngine: 'podman',
            containerEngineEvidence: 'selectedCli',
        });
        expect(getDockerReadinessTelemetryProperties(dockerCliOnPodmanReadiness)).toMatchObject({
            containerCli: 'docker',
            containerEngine: 'podman',
            containerEngineEvidence: 'serverComponents',
        });
    });

    it('keeps endpoint-only evidence inferred and the engine unknown', () => {
        const readiness: DockerReadiness = {
            ...unknownReadiness(),
            cli: 'docker',
            engine: 'unknown',
            engineEvidence: 'endpointPath',
        };

        expect(getDockerReadinessTelemetryProperties(readiness)).toMatchObject({
            containerCli: 'docker',
            containerEngine: 'unknown',
            containerEngineEvidence: 'endpointPath',
        });
    });

    it('does not emit fingerprints for a diagnosed failure', () => {
        const readiness: DockerReadiness = {
            ...unknownReadiness(),
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            canContinueAnyway: false,
        };

        const properties = getDockerReadinessTelemetryProperties(readiness);

        expect(properties.dockerDiagnosticFingerprint).toBeUndefined();
    });
});
