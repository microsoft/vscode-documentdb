/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DockerDiagnosedReadiness,
    type DockerIndeterminateReadiness,
    type DockerReadiness,
    type DockerReadyReadiness,
} from '../../../services/localQuickStart/quickStartTypes';
import { getDockerReadinessPresentation } from './dockerReadinessPresentation';

type DockerReadinessOverrides =
    | (Partial<DockerDiagnosedReadiness> & { readonly outcome?: 'diagnosed' })
    | (Partial<DockerIndeterminateReadiness> & { readonly outcome: 'indeterminate' })
    | (Partial<DockerReadyReadiness> & { readonly outcome: 'ready' });

function readiness(overrides: DockerReadinessOverrides = {}): DockerReadiness {
    const base = {
        environment: 'linux',
        endpointKind: 'unixSocket',
        provider: 'unknown',
        providerEvidence: 'none',
        executionTarget: 'local',
        checkedAtMs: 1,
        cliInstalled: true,
    } as const;
    if (overrides.outcome === 'ready') {
        return {
            ...base,
            ...overrides,
            outcome: 'ready',
            failureKind: undefined,
            canContinueAnyway: false,
            daemonReachable: true,
        };
    }
    if (overrides.outcome === 'indeterminate') {
        return {
            ...base,
            ...overrides,
            outcome: 'indeterminate',
            failureKind: overrides.failureKind ?? 'unknown',
            canContinueAnyway: true,
            daemonReachable: false,
        };
    }
    return {
        ...base,
        ...overrides,
        outcome: 'diagnosed',
        failureKind: overrides.failureKind ?? 'daemonUnavailable',
        canContinueAnyway: false,
        daemonReachable: false,
    };
}

describe('getDockerReadinessPresentation', () => {
    it.each([
        ['permission denied', { failureKind: 'permissionDenied' as const }, 'accessDenied'],
        ['daemon unavailable', { failureKind: 'daemonUnavailable' as const }, 'notRunning'],
        [
            'probe timeout',
            { outcome: 'indeterminate' as const, failureKind: 'probeTimedOut' as const },
            'checkTimedOut',
        ],
        [
            'unknown failure',
            { outcome: 'indeterminate' as const, failureKind: 'unknown' as const },
            'notAccessible',
        ],
    ])('maps %s to %s', (_name, overrides, expectedState) => {
        expect(getDockerReadinessPresentation(readiness(overrides))).toMatchObject({
            state: expectedState,
            showRefresh: true,
            showRetry: true,
            showViewOutput: true,
        });
    });

    it('offers Continue anyway only for an indeterminate result', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'indeterminate', failureKind: 'unknown', canContinueAnyway: true }),
            ).showContinueAnyway,
        ).toBe(true);
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'diagnosed', failureKind: 'permissionDenied' }),
            ).showContinueAnyway,
        ).toBe(false);
    });

    it('offers a copy action only when the host returned a fixed recovery command', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({
                    failureKind: 'permissionDenied',
                    recoveryCommand: {
                        id: 'linuxDockerGroup',
                        commandLine: 'sudo usermod -aG docker $USER',
                        requiresElevation: true,
                    },
                }),
            ).showCopyCommand,
        ).toBe(true);
    });

    it.each([
        ['linux access denied', 'linux', 'unknown', 'accessDenied', 'accessDeniedLinux'],
        ['WSL access denied', 'wsl', 'unknown', 'accessDenied', 'accessDeniedWsl'],
        ['SSH access denied', 'ssh', 'unknown', 'accessDenied', 'accessDeniedRemote'],
        ['dev container access denied', 'devContainer', 'unknown', 'accessDenied', 'accessDeniedRemote'],
        ['Codespaces access denied', 'codespaces', 'unknown', 'accessDenied', 'accessDeniedRemote'],
        [
            'linux pending restart',
            'linux',
            'pendingSessionRestart',
            'accessDeniedPendingRestart',
            'pendingRestartLinux',
        ],
        ['WSL pending restart', 'wsl', 'pendingSessionRestart', 'accessDeniedPendingRestart', 'pendingRestartWsl'],
        ['SSH pending restart', 'ssh', 'pendingSessionRestart', 'accessDeniedPendingRestart', 'pendingRestartSsh'],
        [
            'dev container pending restart',
            'devContainer',
            'pendingSessionRestart',
            'accessDeniedPendingRestart',
            'pendingRestartContainer',
        ],
        [
            'Codespaces pending restart',
            'codespaces',
            'pendingSessionRestart',
            'accessDeniedPendingRestart',
            'pendingRestartContainer',
        ],
    ] as const)('maps $name to its semantic copy keys', (_name, environment, permissionDetail, state, guidance) => {
        expect(
            getDockerReadinessPresentation(
                readiness({ failureKind: 'permissionDenied', environment, permissionDetail }),
            ),
        ).toMatchObject({ state, guidance });
    });

    it.each([
        ['linuxDockerGroup', 'groupMembershipNewSession'],
        ['wslRestartFromWindows', 'restartWslDistribution'],
        ['linuxStartService', 'runsDockerService'],
        ['wslStartServiceNoSystemd', 'runsDockerService'],
    ] as const)('maps %s to the %s recovery note', (id, recoveryNote) => {
        expect(
            getDockerReadinessPresentation(
                readiness({
                    recoveryCommand: {
                        id,
                        commandLine: 'fixed command',
                        requiresElevation: true,
                    },
                }),
            ).recoveryNote,
        ).toBe(recoveryNote);
    });

    it('preserves the conservative usermod path for unknown membership', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({
                    failureKind: 'permissionDenied',
                    environment: 'wsl',
                    permissionDetail: 'unknown',
                    recoveryCommand: {
                        id: 'linuxDockerGroup',
                        commandLine: 'sudo usermod -aG docker $USER',
                        requiresElevation: true,
                    },
                }),
            ),
        ).toMatchObject({
            state: 'accessDenied',
            guidance: 'accessDeniedWsl',
            recoveryNote: 'groupMembershipNewSession',
            showCopyCommand: true,
        });
    });

    it.each([
        ['windows', true],
        ['macos', true],
        ['linux', false],
        ['wsl', false],
        ['ssh', false],
    ] as const)('sets the legacy Desktop action for %s to %s', (environment, expected) => {
        expect(getDockerReadinessPresentation(readiness({ environment })).showStartDockerDesktop).toBe(expected);
    });

    it('returns refresh as the only readiness action when ready', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'ready' }),
            ),
        ).toEqual({
            state: 'ready',
            guidance: undefined,
            recoveryNote: undefined,
            showInstall: false,
            showStartDockerDesktop: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showRefresh: true,
            showViewOutput: false,
        });
    });
});
