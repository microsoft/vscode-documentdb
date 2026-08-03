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
import {
    getDockerExecutionTargetKey,
    getDockerLastCheckedAtMs,
    getDockerReadinessPresentation,
    isDockerArchitectureCompatible,
} from './dockerReadinessPresentation';

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
        ['daemon starting', { failureKind: 'daemonStarting' as const }, 'starting'],
        ['missing context', { failureKind: 'contextUnavailable' as const }, 'contextUnavailable'],
        ['remote endpoint', { failureKind: 'endpointUnreachable' as const }, 'endpointUnreachable'],
        [
            'probe timeout',
            { outcome: 'indeterminate' as const, failureKind: 'probeTimedOut' as const },
            'checkTimedOut',
        ],
        ['Windows containers', { failureKind: 'windowsContainers' as const }, 'windowsContainers'],
        ['unknown failure', { outcome: 'indeterminate' as const, failureKind: 'unknown' as const }, 'notAccessible'],
    ])('maps %s to %s', (_name, overrides, expectedState) => {
        expect(getDockerReadinessPresentation(readiness(overrides))).toMatchObject({
            state: expectedState,
            showRetry: true,
            showViewOutput: true,
        });
    });

    it('offers the install action only when the Docker CLI is missing', () => {
        expect(
            getDockerReadinessPresentation(readiness({ failureKind: 'cliMissing', cliInstalled: false })),
        ).toMatchObject({
            showInstall: true,
            guide: 'install',
        });
        expect(getDockerReadinessPresentation(readiness({ failureKind: 'daemonUnavailable' })).showInstall).toBe(false);
    });

    it('offers Continue anyway only for an indeterminate result', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({ outcome: 'indeterminate', failureKind: 'unknown', canContinueAnyway: true }),
            ).showContinueAnyway,
        ).toBe(true);
        expect(
            getDockerReadinessPresentation(readiness({ outcome: 'diagnosed', failureKind: 'permissionDenied' }))
                .showContinueAnyway,
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
        ['startDockerDesktopWindows', 'startDockerDesktop'],
        ['startDockerDesktopMacOS', 'startDockerDesktop'],
        ['startDockerDesktopLinux', 'startDockerDesktop'],
        ['startDockerDesktopWindowsFromWsl', 'startDockerDesktop'],
        ['startRootlessDockerEngineLinux', 'startDocker'],
    ] as const)('maps %s to the %s action', (startAction, startLabel) => {
        expect(getDockerReadinessPresentation(readiness({ startAction }))).toMatchObject({
            showStartDockerProvider: true,
            startLabel,
        });
    });

    it('does not infer a start action from the host environment', () => {
        expect(getDockerReadinessPresentation(readiness({ environment: 'windows' }))).toMatchObject({
            showStartDockerProvider: false,
            startLabel: undefined,
        });
    });

    it('keeps installed-application wording provider-neutral while naming the action', () => {
        expect(
            getDockerReadinessPresentation(
                readiness({
                    environment: 'windows',
                    provider: 'dockerDesktop',
                    providerEvidence: 'installedApplication',
                    startAction: 'startDockerDesktopWindows',
                }),
            ),
        ).toMatchObject({
            state: 'notRunning',
            guidance: 'daemonNotRunning',
            startLabel: 'startDockerDesktop',
        });
    });

    it('omits Retry on an unsupported host', () => {
        expect(getDockerReadinessPresentation(readiness({ failureKind: 'unsupportedHost' }))).toMatchObject({
            state: 'unsupported',
            showRetry: false,
        });
    });

    it.each([
        ['WSL Desktop integration', { environment: 'wsl', provider: 'dockerDesktop' as const }, 'notAccessibleFromWsl'],
        ['identified Desktop', { provider: 'dockerDesktop' as const }, 'dockerDesktopNotRunning'],
    ] as const)('refines %s daemon unavailability', (_name, overrides, state) => {
        expect(getDockerReadinessPresentation(readiness(overrides))).toMatchObject({ state });
    });

    it('returns no failure actions when ready', () => {
        expect(getDockerReadinessPresentation(readiness({ outcome: 'ready' }))).toEqual({
            state: 'ready',
            guidance: undefined,
            recoveryNote: undefined,
            guide: 'dockerTroubleshooting',
            startLabel: undefined,
            showInstall: false,
            showStartDockerProvider: false,
            showCopyCommand: false,
            showContinueAnyway: false,
            showRetry: false,
            showViewOutput: false,
        });
    });
});

describe('getDockerExecutionTargetKey', () => {
    it.each(['local', 'wsl', 'ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)(
        'maps %s without host inference',
        (target) => {
            expect(getDockerExecutionTargetKey(target)).toBe(target);
        },
    );
});

describe('getDockerLastCheckedAtMs', () => {
    it('uses the provider record time for remembered evidence', () => {
        expect(
            getDockerLastCheckedAtMs(
                readiness({
                    checkedAtMs: 2_000,
                    providerEvidence: 'rememberedProvider',
                    providerRecordedAtMs: 500,
                }),
            ),
        ).toBe(500);
    });

    it('uses the current check time for live evidence', () => {
        expect(getDockerLastCheckedAtMs(readiness({ checkedAtMs: 2_000, providerEvidence: 'liveDaemon' }))).toBe(2_000);
    });
});

describe('isDockerArchitectureCompatible', () => {
    it.each([
        ['supported x64 host and amd64 daemon', { arch: 'x64', daemonArchitecture: 'amd64' }, true],
        ['supported arm64 host and arm64 daemon', { arch: 'arm64', daemonArchitecture: 'arm64' }, true],
        ['known host and daemon mismatch', { arch: 'arm64', daemonArchitecture: 'amd64' }, false],
        ['unsupported host', { arch: 'ppc64', daemonArchitecture: 'ppc64', platformSupported: false }, false],
        ['daemon architecture not yet known', { arch: 'x64' }, true],
    ] as const)('%s', (_name, overrides, expected) => {
        expect(isDockerArchitectureCompatible(readiness(overrides))).toBe(expected);
    });
});
